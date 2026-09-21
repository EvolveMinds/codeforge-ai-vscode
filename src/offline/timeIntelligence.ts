/**
 * offline/timeIntelligence.ts — Zero-dependency time-series intelligence.
 *
 * Answers the two questions the Studio could not previously answer:
 *   "When did this change?"  → changepoint detection
 *   "What happens next?"     → Holt-Winters forecast with a prediction interval
 *
 * Everything here is pure: given rows in, an analysis comes out. No Electron, no
 * VS Code host, no runtime dependencies. That keeps air-gap mode intact and makes
 * the whole module unit-testable in isolation.
 *
 * Design notes worth preserving:
 *  - Date parsing is deliberately conservative. A column only counts as a date
 *    column if a strong majority of its values parse AND the parsed values span a
 *    plausible range. Guessing wrong here poisons every downstream number.
 *  - Ambiguous DD/MM vs MM/DD is resolved by evidence across the whole column
 *    (a value >12 in the first position proves day-first), never by locale.
 *  - Seasonality is detected by autocorrelation, not assumed from the grain. A
 *    daily series is not automatically weekly-seasonal.
 */

export type TimeGrainUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface TimePoint {
  /** Epoch milliseconds, UTC-normalised to the start of the grain bucket. */
  t: number;
  /** ISO date (YYYY-MM-DD) for display. */
  date: string;
  value: number;
  /** How many source rows were aggregated into this bucket. */
  count: number;
}

export interface Changepoint {
  index: number;
  date: string;
  /** Mean before / after the break. */
  before: number;
  after: number;
  /** Signed percentage change, e.g. -18.4 */
  magnitudePct: number;
  direction: 'up' | 'down';
  /** 0..1 — how confident we are this is a real level shift, not noise. */
  confidence: number;
  /** Plain-language sentence, ready to show a user. */
  narrative: string;
}

export interface ForecastPoint {
  date: string;
  value: number;
  lower: number;
  upper: number;
}

export interface Decomposition {
  trend: Array<number | null>;
  seasonal: number[];
  residual: Array<number | null>;
}

export interface TimeSeriesAnalysis {
  dateColumn: string;
  valueColumn: string;
  grain: TimeGrainUnit;
  series: TimePoint[];
  decomposition: Decomposition;
  changepoints: Changepoint[];
  forecast: ForecastPoint[];
  seasonalityDetected: boolean;
  seasonalPeriod: number | null;
  /** Least-squares slope per bucket, and the same expressed as % of mean. */
  trendSlope: number;
  trendPctPerPeriod: number;
  trendDirection: 'rising' | 'falling' | 'flat';
  narrative: string;
}

export interface TimeIntelligenceOptions {
  /** Buckets to project forward. Default 12. */
  horizon?: number;
  /** Force a grain instead of inferring one. */
  grain?: TimeGrainUnit;
  /** Aggregation used when several rows fall in one bucket. Default 'sum'. */
  agg?: 'sum' | 'mean';
}

/** A column is only treated as dates if at least this share of values parse. */
const DATE_PARSE_THRESHOLD = 0.7;
/** Series shorter than this cannot support decomposition or forecasting. */
const MIN_POINTS = 4;
/** Changepoint search ignores this many buckets at each end. */
const CHANGEPOINT_EDGE_GUARD = 2;

const MS_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Parse one value to epoch ms, or null. `dayFirst` disambiguates X/Y/ZZZZ forms;
 * it is decided for the column as a whole by {@link detectDateColumn}.
 */
export function parseDateValue(raw: unknown, dayFirst = false): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.getTime();

  if (typeof raw === 'number' && isFinite(raw)) return fromEpochNumber(raw);

  const s = String(raw).trim();
  if (!s) return null;

  // Pure digits → epoch seconds or milliseconds.
  if (/^\d+$/.test(s)) {
    // A bare 4-digit number is a year, not an epoch.
    if (s.length === 4) {
      const y = Number(s);
      if (y >= 1900 && y <= 2200) return Date.UTC(y, 0, 1);
    }
    return fromEpochNumber(Number(s));
  }

  // ISO-ish: YYYY-MM-DD, YYYY/MM/DD, with optional time.
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return utc(Number(m[1]), Number(m[2]), Number(m[3]));

  // YYYY-MM
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m) return utc(Number(m[1]), Number(m[2]), 1);

  // X/Y/ZZZZ — order decided by the column, not by locale.
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const day = dayFirst ? a : b;
    const month = dayFirst ? b : a;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return utc(year, month, day);
  }

  // Month-name forms: "12 Mar 2024", "Mar 12, 2024", "March 2024".
  const parsedName = parseMonthName(s);
  if (parsedName !== null) return parsedName;

  return null;
}

function fromEpochNumber(n: number): number | null {
  if (!isFinite(n) || n <= 0) return null;
  // Heuristic: >1e11 is already milliseconds; otherwise treat as seconds.
  const ms = n > 1e11 ? n : n * 1000;
  const year = new Date(ms).getUTCFullYear();
  return year >= 1970 && year <= 2200 ? ms : null;
}

function utc(y: number, mo: number, d: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  // Reject rollovers like 31 February.
  const back = new Date(ms);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseMonthName(s: string): number | null {
  const lower = s.toLowerCase();
  const monthIdx = MONTHS.findIndex(mn => lower.includes(mn));
  if (monthIdx === -1) return null;
  const yearMatch = /\b(\d{4})\b/.exec(s);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  // A 1-2 digit number that is not the year is the day.
  const dayMatch = /\b(\d{1,2})\b/.exec(s.replace(yearMatch[1], ''));
  const day = dayMatch ? Number(dayMatch[1]) : 1;
  return utc(year, monthIdx + 1, day >= 1 && day <= 31 ? day : 1);
}

export interface DateColumnDetection {
  column: string;
  dayFirst: boolean;
  parseRate: number;
}

/**
 * Pick the best date column. Name hints break ties but never override evidence —
 * a column called `date` whose values do not parse is not a date column.
 */
export function detectDateColumn(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): DateColumnDetection | null {
  if (!rows.length || !columns.length) return null;
  const sample = rows.slice(0, 400);
  let best: DateColumnDetection | null = null;
  let bestScore = -1;

  for (const col of columns) {
    const values = sample.map(r => r?.[col]).filter(v => v !== null && v !== undefined && v !== '');
    if (values.length < 2) continue;

    // Decide day-first from evidence: any first component >12 proves day-first.
    let dayFirstEvidence = 0;
    let monthFirstEvidence = 0;
    for (const v of values) {
      const m = /^(\d{1,2})[-/](\d{1,2})[-/]\d{2,4}$/.exec(String(v).trim());
      if (!m) continue;
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a > 12 && b <= 12) dayFirstEvidence++;
      else if (b > 12 && a <= 12) monthFirstEvidence++;
    }
    const dayFirst = dayFirstEvidence > monthFirstEvidence;

    const parsed = values.map(v => parseDateValue(v, dayFirst)).filter((n): n is number => n !== null);
    const parseRate = parsed.length / values.length;
    if (parseRate < DATE_PARSE_THRESHOLD) continue;

    // Need at least two distinct instants to form a series.
    const distinct = new Set(parsed).size;
    if (distinct < 2) continue;

    // Reject plain integer ID columns that happen to look like epochs.
    const allIntegers = values.every(v => /^\d+$/.test(String(v).trim()));
    const nameLooksTemporal = /date|time|day|month|year|created|updated|timestamp|period|week/i.test(col);
    if (allIntegers && !nameLooksTemporal) continue;

    let score = parseRate * 100 + Math.min(distinct, 50);
    if (nameLooksTemporal) score += 60;

    if (score > bestScore) {
      bestScore = score;
      best = { column: col, dayFirst, parseRate };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Grain inference & bucketing
// ---------------------------------------------------------------------------

/** Infer a sensible bucket size from the median gap between observations. */
export function inferGrain(sortedTimes: number[]): TimeGrainUnit {
  if (sortedTimes.length < 2) return 'day';
  const gaps: number[] = [];
  for (let i = 1; i < sortedTimes.length; i++) {
    const g = sortedTimes[i] - sortedTimes[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return 'day';
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  const days = medianGap / MS_DAY;

  if (days <= 1.5) return 'day';
  if (days <= 10) return 'week';
  if (days <= 45) return 'month';
  if (days <= 130) return 'quarter';
  return 'year';
}

/** Snap an instant to the start of its bucket, in UTC. */
export function bucketStart(ms: number, grain: TimeGrainUnit): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  switch (grain) {
    case 'year':
      return Date.UTC(y, 0, 1);
    case 'quarter':
      return Date.UTC(y, Math.floor(mo / 3) * 3, 1);
    case 'month':
      return Date.UTC(y, mo, 1);
    case 'week': {
      // ISO weeks start Monday.
      const day = new Date(Date.UTC(y, mo, d.getUTCDate())).getUTCDay();
      const back = (day + 6) % 7;
      return Date.UTC(y, mo, d.getUTCDate()) - back * MS_DAY;
    }
    default:
      return Date.UTC(y, mo, d.getUTCDate());
  }
}

/** Step one bucket forward. Calendar-aware for month/quarter/year. */
export function advanceBucket(ms: number, grain: TimeGrainUnit, steps = 1): number {
  const d = new Date(ms);
  switch (grain) {
    case 'year':
      return Date.UTC(d.getUTCFullYear() + steps, d.getUTCMonth(), d.getUTCDate());
    case 'quarter':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * steps, d.getUTCDate());
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + steps, d.getUTCDate());
    case 'week':
      return ms + steps * 7 * MS_DAY;
    default:
      return ms + steps * MS_DAY;
  }
}

export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Aggregate rows into an evenly-spaced series. Empty buckets between the first
 * and last observation are filled with 0 (sum) or carried-forward mean, because
 * a gap in a time series is information, not an absence of it.
 */
export function buildSeries(
  rows: Array<Record<string, unknown>>,
  dateCol: string,
  valueCol: string,
  grain: TimeGrainUnit,
  dayFirst: boolean,
  agg: 'sum' | 'mean',
): TimePoint[] {
  const buckets = new Map<number, { sum: number; count: number }>();

  for (const row of rows) {
    const ms = parseDateValue(row?.[dateCol], dayFirst);
    if (ms === null) continue;
    const raw = row?.[valueCol];
    const num = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    if (!isFinite(num)) continue;
    const key = bucketStart(ms, grain);
    const cur = buckets.get(key);
    if (cur) {
      cur.sum += num;
      cur.count += 1;
    } else {
      buckets.set(key, { sum: num, count: 1 });
    }
  }

  if (!buckets.size) return [];

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const out: TimePoint[] = [];
  let cursor = keys[0];
  const last = keys[keys.length - 1];
  // Guard against a pathological range producing an unbounded loop.
  let guard = 0;
  while (cursor <= last && guard++ < 20_000) {
    const b = buckets.get(cursor);
    const value = b ? (agg === 'mean' ? b.sum / b.count : b.sum) : 0;
    out.push({ t: cursor, date: toIsoDate(cursor), value, count: b ? b.count : 0 });
    cursor = bucketStart(advanceBucket(cursor, grain), grain);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seasonality, decomposition
// ---------------------------------------------------------------------------

/** Autocorrelation at a given lag. */
function autocorrelation(values: number[], lag: number): number {
  const n = values.length;
  if (lag >= n) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    den += d * d;
    if (i + lag < n) num += d * (values[i + lag] - mean);
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Remove a least-squares linear trend. Essential before testing periodicity: a
 * pure ramp is strongly autocorrelated at *every* lag, so an undetrended series
 * reports seasonality that does not exist.
 */
function detrend(values: number[]): number[] {
  const n = values.length;
  if (n < 3) return [...values];
  const xm = (n - 1) / 2;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (values[i] - ym);
    den += (i - xm) * (i - xm);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = ym - slope * xm;
  return values.map((v, i) => v - (slope * i + intercept));
}

/**
 * Detect a seasonal period by autocorrelation of the *detrended* series.
 *
 * A candidate must clear three bars, each of which exists to reject a specific
 * false positive seen in practice:
 *  1. Absolute strength — weak wobble is not a cycle.
 *  2. Beat its own neighbours (lag p vs p±1) — a genuine period shows a local
 *     autocorrelation peak; a slow drift does not.
 *  3. At least two full cycles present — one cycle is an anecdote.
 *
 * Known limitation, accepted deliberately: a large level shift inside a short
 * series inflates the variance the autocorrelation is measured against and can
 * mask a real cycle. A 24-month series with a genuine 12-month cycle and a +45%
 * step at month 14 measures only ~0.30 at lag 12 and is rejected here. Lowering
 * the floor to catch it admits far more false cycles than it recovers real
 * ones, so the trade is made in favour of silence. Removing the changepoints
 * before this test would fix it properly, and is the right future change.
 */
export function detectSeasonality(values: number[], grain: TimeGrainUnit): number | null {
  const candidates: number[] =
    grain === 'day' ? [7, 30] :
    grain === 'week' ? [4, 13, 52] :
    grain === 'month' ? [3, 4, 6, 12] :
    grain === 'quarter' ? [4] :
    [];

  if (!candidates.length) return null;

  const resid = detrend(values);
  // A detrended constant series has no variance and no cycle.
  const spread = Math.sqrt(variance(resid));
  const scale = Math.abs(mean(values)) || 1;
  if (spread / scale < 1e-6) return null;

  let best: number | null = null;
  let bestAc = 0.35; // acceptance floor on the detrended series

  for (const p of candidates) {
    if (values.length < p * 2) continue;
    const ac = autocorrelation(resid, p);
    if (ac <= bestAc) continue;

    // Must be a local peak, not a point on a slow decay.
    const neighbourhood = [p - 1, p + 1]
      .filter(l => l > 0 && l < resid.length)
      .map(l => autocorrelation(resid, l));
    if (neighbourhood.some(nAc => nAc > ac)) continue;

    bestAc = ac;
    best = p;
  }

  return best;
}

/**
 * Classical additive decomposition. Trend is a centred moving average; seasonal
 * is the period-average of the detrended series (mean-centred); residual is what
 * is left. Ends of `trend`/`residual` are null where the window does not fit —
 * that is honest, and callers render gaps rather than invented values.
 */
export function decompose(values: number[], period: number | null): Decomposition {
  const n = values.length;
  const trend: Array<number | null> = new Array(n).fill(null);

  const window = period && period > 1 ? period : Math.max(3, Math.min(7, Math.floor(n / 4) || 3));
  const half = Math.floor(window / 2);

  for (let i = 0; i < n; i++) {
    if (i - half < 0 || i + half >= n) continue;
    let sum = 0;
    let cnt = 0;
    for (let j = i - half; j <= i + half; j++) {
      sum += values[j];
      cnt++;
    }
    trend[i] = sum / cnt;
  }

  const seasonal: number[] = new Array(n).fill(0);
  if (period && period > 1 && n >= period * 2) {
    const bucketSums = new Array(period).fill(0);
    const bucketCounts = new Array(period).fill(0);
    for (let i = 0; i < n; i++) {
      const tr = trend[i];
      if (tr === null) continue;
      bucketSums[i % period] += values[i] - tr;
      bucketCounts[i % period] += 1;
    }
    const means = bucketSums.map((s, i) => (bucketCounts[i] ? s / bucketCounts[i] : 0));
    // Centre so the seasonal component sums to ~zero and does not shift the level.
    const gm = means.reduce((a, b) => a + b, 0) / period;
    const centred = means.map(m => m - gm);
    for (let i = 0; i < n; i++) seasonal[i] = centred[i % period];
  }

  const residual: Array<number | null> = values.map((v, i) =>
    trend[i] === null ? null : v - (trend[i] as number) - seasonal[i],
  );

  return { trend, seasonal, residual };
}

// ---------------------------------------------------------------------------
// Changepoints
// ---------------------------------------------------------------------------

function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function variance(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (a.length - 1);
}

/**
 * Binary segmentation on the mean. At each level we take the split that most
 * reduces within-segment variance, accept it only if the shift clears a noise
 * threshold, then recurse into both halves.
 *
 * Returned confidence blends effect size (how big the shift is relative to
 * in-segment noise) with segment length, so a large shift measured over three
 * points does not outrank a moderate one measured over thirty.
 */
export function detectChangepoints(
  series: TimePoint[],
  maxPoints = 3,
  minRelativeShift = 0.12,
): Changepoint[] {
  const values = series.map(p => p.value);
  if (values.length < MIN_POINTS * 2) return [];

  const found: Changepoint[] = [];

  const search = (lo: number, hi: number, depth: number): void => {
    if (depth > 3 || found.length >= maxPoints) return;
    const len = hi - lo;
    if (len < MIN_POINTS * 2) return;

    const seg = values.slice(lo, hi);
    const segMean = Math.abs(mean(seg));
    const segSd = Math.sqrt(variance(seg));

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = lo + CHANGEPOINT_EDGE_GUARD; i < hi - CHANGEPOINT_EDGE_GUARD; i++) {
      const left = values.slice(lo, i);
      const right = values.slice(i, hi);
      if (left.length < 2 || right.length < 2) continue;
      const diff = Math.abs(mean(right) - mean(left));
      // Weight by harmonic-ish balance so mid-segment splits are preferred.
      const balance = (left.length * right.length) / (len * len);
      const score = diff * balance;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) return;

    const left = values.slice(lo, bestIdx);
    const right = values.slice(bestIdx, hi);
    const mBefore = mean(left);
    const mAfter = mean(right);
    const shift = mAfter - mBefore;
    const denom = segMean > 1e-9 ? segMean : 1;
    const relShift = Math.abs(shift) / denom;

    if (relShift < minRelativeShift) return;
    // A shift smaller than the segment's own noise is not a changepoint.
    if (segSd > 0 && Math.abs(shift) < segSd * 0.8) return;

    const effect = segSd > 0 ? Math.abs(shift) / segSd : 3;
    const lengthWeight = Math.min(1, Math.min(left.length, right.length) / 8);
    const confidence = Math.max(0, Math.min(0.99, (effect / 3) * 0.7 + lengthWeight * 0.3));

    const point = series[bestIdx];
    const magnitudePct = mBefore !== 0 ? (shift / Math.abs(mBefore)) * 100 : 0;
    const direction: 'up' | 'down' = shift >= 0 ? 'up' : 'down';
    const verb = direction === 'up' ? 'rose' : 'fell';

    found.push({
      index: bestIdx,
      date: point.date,
      before: mBefore,
      after: mAfter,
      magnitudePct,
      direction,
      confidence,
      narrative:
        `Level shift on ${point.date}: the series ${verb} ` +
        `${Math.abs(magnitudePct).toFixed(1)}% ` +
        `(${formatNum(mBefore)} → ${formatNum(mAfter)}) and held.`,
    });

    search(lo, bestIdx, depth + 1);
    search(bestIdx, hi, depth + 1);
  };

  search(0, values.length, 0);

  return found
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxPoints)
    .sort((a, b) => a.index - b.index);
}

function formatNum(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (abs >= 10) return n.toFixed(0);
  return n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

/**
 * Holt-Winters additive triple exponential smoothing, falling back to Holt's
 * linear method when no seasonality is present and to a flat mean when the
 * series is too short for either.
 *
 * The prediction interval widens with the square root of the horizon — the
 * standard random-walk assumption. It is approximate and labelled as such in
 * the UI; the alternative (pretending to a precision we do not have) is worse.
 */
export function forecastSeries(
  series: TimePoint[],
  grain: TimeGrainUnit,
  horizon: number,
  period: number | null,
): ForecastPoint[] {
  const values = series.map(p => p.value);
  const n = values.length;
  if (n < 2 || horizon <= 0) return [];

  const lastT = series[n - 1].t;
  const out: ForecastPoint[] = [];

  let fitted: number[] = [];
  let project: (h: number) => number;

  if (period && n >= period * 2) {
    const alpha = 0.4;
    const beta = 0.1;
    const gamma = 0.3;

    // Seed level/trend from the first cycle, seasonals from cycle averages.
    const firstCycle = values.slice(0, period);
    let level = mean(firstCycle);
    const secondCycle = values.slice(period, period * 2);
    let trend = (mean(secondCycle) - level) / period;
    const seasonals = firstCycle.map(v => v - level);

    fitted = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const s = seasonals[i % period];
      fitted[i] = level + trend + s;
      const prevLevel = level;
      level = alpha * (values[i] - s) + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      seasonals[i % period] = gamma * (values[i] - level) + (1 - gamma) * s;
    }
    const finalLevel = level;
    const finalTrend = trend;
    const finalSeasonals = [...seasonals];
    project = (h: number) => finalLevel + h * finalTrend + finalSeasonals[(n + h - 1) % period];
  } else if (n >= 3) {
    const alpha = 0.5;
    const beta = 0.2;
    let level = values[0];
    let trend = values[1] - values[0];
    fitted = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      fitted[i] = level + trend;
      const prevLevel = level;
      level = alpha * values[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }
    const finalLevel = level;
    const finalTrend = trend;
    project = (h: number) => finalLevel + h * finalTrend;
  } else {
    const m = mean(values);
    fitted = values.map(() => m);
    project = () => m;
  }

  // Residual spread of the in-sample fit drives the interval width.
  const errs: number[] = [];
  for (let i = 1; i < n; i++) errs.push(values[i] - fitted[i]);
  const sd = Math.sqrt(variance(errs.length ? errs : [0, 0]));

  let cursor = lastT;
  for (let h = 1; h <= horizon; h++) {
    cursor = bucketStart(advanceBucket(cursor, grain), grain);
    const v = project(h);
    // ~95% interval, widening as sqrt(h).
    const band = 1.96 * sd * Math.sqrt(h);
    out.push({
      date: toIsoDate(cursor),
      value: v,
      lower: v - band,
      upper: v + band,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (values[i] - ym);
    den += (i - xm) * (i - xm);
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Full time-series analysis, or null when the data cannot support one.
 * Returning null (rather than a zero-filled result) is deliberate: callers
 * treat absence as "no temporal story here" and hide the UI entirely.
 */
export function analyzeTimeSeries(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  valueColumn: string,
  options: TimeIntelligenceOptions = {},
): TimeSeriesAnalysis | null {
  if (!rows || rows.length < MIN_POINTS) return null;

  const detection = detectDateColumn(rows, columns);
  if (!detection) return null;

  const agg = options.agg ?? 'sum';
  const horizon = options.horizon ?? 12;

  const times = rows
    .map(r => parseDateValue(r?.[detection.column], detection.dayFirst))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (times.length < MIN_POINTS) return null;

  const grain = options.grain ?? inferGrain(times);
  const series = buildSeries(rows, detection.column, valueColumn, grain, detection.dayFirst, agg);
  if (series.length < MIN_POINTS) return null;

  const values = series.map(p => p.value);
  const seasonalPeriod = detectSeasonality(values, grain);
  const decomposition = decompose(values, seasonalPeriod);
  const changepoints = detectChangepoints(series);
  const forecast = forecastSeries(series, grain, horizon, seasonalPeriod);

  const slope = linearSlope(values);
  const avg = mean(values);
  const pctPerPeriod = avg !== 0 ? (slope / Math.abs(avg)) * 100 : 0;
  const trendDirection: 'rising' | 'falling' | 'flat' =
    Math.abs(pctPerPeriod) < 0.5 ? 'flat' : pctPerPeriod > 0 ? 'rising' : 'falling';

  const parts: string[] = [];
  parts.push(
    `${valueColumn} tracked by ${detection.column} at ${grain} grain across ${series.length} periods.`,
  );
  if (trendDirection === 'flat') {
    parts.push('The underlying trend is essentially flat.');
  } else {
    parts.push(
      `The trend is ${trendDirection} at roughly ${Math.abs(pctPerPeriod).toFixed(1)}% per ${grain}.`,
    );
  }
  if (seasonalPeriod) {
    parts.push(`A repeating ${seasonalPeriod}-${grain} seasonal cycle is present.`);
  }
  if (changepoints.length) {
    parts.push(changepoints[0].narrative);
  }

  return {
    dateColumn: detection.column,
    valueColumn,
    grain,
    series,
    decomposition,
    changepoints,
    forecast,
    seasonalityDetected: seasonalPeriod !== null,
    seasonalPeriod,
    trendSlope: slope,
    trendPctPerPeriod: pctPerPeriod,
    trendDirection,
    narrative: parts.join(' '),
  };
}
