/**
 * offline/advancedVisuals.ts — Hand-rolled SVG chart generators.
 *
 * Covers the visual grammar the Studio was missing: flow (Sankey), hierarchy
 * (treemap), high-dimensional comparison (parallel coordinates), geography
 * (choropleth / point map) and time (series + forecast cone, decomposition).
 *
 * Every generator here is a pure function returning an SVG string, matching the
 * convention already used by `dataScientistEngine._renderWaterfallSvg` and
 * friends. No runtime dependencies, no DOM required — these render identically
 * in the Electron renderer, a VS Code webview and a standalone HTML report.
 *
 * Styling matches the existing dark analytic surface (#090d16 ground, #1e293b
 * borders, slate text) so new charts sit beside the old ones without a reskin.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const SURFACE = '#090d16';
const BORDER = '#1e293b';
const TEXT_DIM = '#94a3b8';
const TEXT = '#cbd5e1';

export const PALETTE = [
  '#38bdf8', '#a855f7', '#f472b6', '#fbbf24', '#34d399',
  '#60a5fa', '#fb923c', '#4ade80', '#f87171', '#c084fc',
];

/** Escape text destined for an SVG text node or attribute. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 2))}..` : s;
}

export function formatCompact(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (abs >= 10) return n.toFixed(0);
  if (abs === 0) return '0';
  return n.toFixed(2);
}

function emptyState(message: string): string {
  return `<div style="font-size:12px;color:${TEXT_DIM};padding:20px;text-align:center;">${esc(message)}</div>`;
}

function frame(width: number, height: number, body: string): string {
  return `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="background:${SURFACE};border-radius:6px;border:1px solid ${BORDER};font-family:sans-serif;">${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Sankey — stage-to-stage flow
// ---------------------------------------------------------------------------

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

interface SankeyNodeLayout {
  name: string;
  depth: number;
  value: number;
  x: number;
  y: number;
  height: number;
  color: string;
}

/**
 * Layered Sankey. Node depth comes from the longest path from any source, which
 * keeps flows strictly left-to-right; cycles are broken by capping depth.
 * Ribbons are cubic Béziers whose thickness encodes value.
 */
export function renderSankeySvg(links: SankeyLink[], title = 'Flow'): string {
  const clean = (links || []).filter(l => l && l.source && l.target && isFinite(l.value) && l.value > 0);
  if (clean.length === 0) return emptyState('No flow relationships detected for a Sankey diagram.');

  const width = 640;
  const height = 300;
  const padX = 12;
  const padY = 34;
  const nodeWidth = 14;

  // Depth assignment with cycle protection.
  const names = new Set<string>();
  for (const l of clean) { names.add(l.source); names.add(l.target); }
  const depth = new Map<string, number>();
  for (const n of names) depth.set(n, 0);
  const MAX_DEPTH = 8;
  for (let pass = 0; pass < MAX_DEPTH; pass++) {
    let changed = false;
    for (const l of clean) {
      const d = (depth.get(l.source) ?? 0) + 1;
      if (d > (depth.get(l.target) ?? 0) && d <= MAX_DEPTH) {
        depth.set(l.target, d);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const maxDepth = Math.max(...[...depth.values()]);
  const columns: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of names) columns[depth.get(n) ?? 0].push(n);

  // Node value = max(inflow, outflow) so a node is never thinner than its traffic.
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of clean) {
    outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
    inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
  }
  const nodeValue = (n: string) => Math.max(inflow.get(n) ?? 0, outflow.get(n) ?? 0);

  const usableH = height - padY - 18;
  const colGap = maxDepth > 0 ? (width - padX * 2 - nodeWidth) / maxDepth : 0;

  const layout = new Map<string, SankeyNodeLayout>();
  let colorIdx = 0;
  for (let d = 0; d <= maxDepth; d++) {
    const col = columns[d].sort((a, b) => nodeValue(b) - nodeValue(a));
    const total = col.reduce((s, n) => s + nodeValue(n), 0) || 1;
    const gapCount = Math.max(0, col.length - 1);
    const availH = usableH - gapCount * 6;
    let y = padY;
    for (const n of col) {
      const v = nodeValue(n);
      const h = Math.max(6, (v / total) * availH);
      layout.set(n, {
        name: n,
        depth: d,
        value: v,
        x: padX + d * colGap,
        y,
        height: h,
        color: PALETTE[colorIdx++ % PALETTE.length],
      });
      y += h + 6;
    }
  }

  // Ribbons, thickest first so small flows stay visible on top.
  const sourceCursor = new Map<string, number>();
  const targetCursor = new Map<string, number>();
  const ribbons = [...clean]
    .sort((a, b) => b.value - a.value)
    .map(l => {
      const s = layout.get(l.source);
      const t = layout.get(l.target);
      if (!s || !t) return '';
      const sTotal = outflow.get(l.source) ?? 1;
      const tTotal = inflow.get(l.target) ?? 1;
      const sh = (l.value / sTotal) * s.height;
      const th = (l.value / tTotal) * t.height;
      const sy = s.y + (sourceCursor.get(l.source) ?? 0);
      const ty = t.y + (targetCursor.get(l.target) ?? 0);
      sourceCursor.set(l.source, (sourceCursor.get(l.source) ?? 0) + sh);
      targetCursor.set(l.target, (targetCursor.get(l.target) ?? 0) + th);

      const x0 = s.x + nodeWidth;
      const x1 = t.x;
      const mx = (x0 + x1) / 2;
      const d = [
        `M${x0},${sy}`,
        `C${mx},${sy} ${mx},${ty} ${x1},${ty}`,
        `L${x1},${ty + th}`,
        `C${mx},${ty + th} ${mx},${sy + sh} ${x0},${sy + sh}`,
        'Z',
      ].join(' ');
      return `<path d="${d}" fill="${s.color}" opacity="0.28"><title>${esc(l.source)} → ${esc(l.target)}: ${formatCompact(l.value)}</title></path>`;
    })
    .join('');

  const nodes = [...layout.values()]
    .map(n => {
      const labelRight = n.depth < maxDepth;
      const lx = labelRight ? n.x + nodeWidth + 5 : n.x - 5;
      const anchor = labelRight ? 'start' : 'end';
      return `
        <g>
          <rect x="${n.x}" y="${n.y}" width="${nodeWidth}" height="${n.height}" fill="${n.color}" rx="3">
            <title>${esc(n.name)}: ${formatCompact(n.value)}</title>
          </rect>
          <text x="${lx}" y="${n.y + n.height / 2 + 3.5}" fill="${TEXT}" font-size="10" text-anchor="${anchor}">${esc(truncate(n.name, 16))}</text>
        </g>`;
    })
    .join('');

  return frame(width, height, `
    <text x="10" y="18" fill="${TEXT_DIM}" font-size="10" font-weight="bold" letter-spacing="0.5">${esc(title.toUpperCase())}</text>
    ${ribbons}${nodes}
  `);
}

/** Build Sankey links from consecutive stage columns in wide-format rows. */
export function sankeyLinksFromStages(
  rows: Array<Record<string, unknown>>,
  stageColumns: string[],
): SankeyLink[] {
  if (stageColumns.length < 2) return [];
  const agg = new Map<string, number>();
  for (let i = 0; i < stageColumns.length - 1; i++) {
    const a = stageColumns[i];
    const b = stageColumns[i + 1];
    let sum = 0;
    for (const r of rows) {
      const v = Number(r?.[b]);
      if (isFinite(v)) sum += Math.abs(v);
    }
    if (sum > 0) agg.set(`${a}\u0000${b}`, sum);
  }
  return [...agg.entries()].map(([k, value]) => {
    const [source, target] = k.split('\u0000');
    return { source, target, value };
  });
}

/** Build Sankey links between two categorical columns (long format). */
export function sankeyLinksFromPair(
  rows: Array<Record<string, unknown>>,
  fromCol: string,
  toCol: string,
  valueCol?: string,
  maxLinks = 24,
): SankeyLink[] {
  const agg = new Map<string, number>();
  for (const r of rows) {
    const a = r?.[fromCol];
    const b = r?.[toCol];
    if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') continue;
    const v = valueCol ? Number(r?.[valueCol]) : 1;
    if (!isFinite(v) || v <= 0) continue;
    const key = `${String(a)}\u0000${String(b)}`;
    agg.set(key, (agg.get(key) ?? 0) + v);
  }
  return [...agg.entries()]
    .map(([k, value]) => {
      const [source, target] = k.split('\u0000');
      return { source, target, value };
    })
    .sort((x, y) => y.value - x.value)
    .slice(0, maxLinks);
}

// ---------------------------------------------------------------------------
// Treemap — squarified nested contribution
// ---------------------------------------------------------------------------

export interface TreemapItem {
  name: string;
  value: number;
}

interface Rect { x: number; y: number; w: number; h: number; }

/**
 * Squarified treemap (Bruls/Huizing/van Wijk). Squarified rather than slice-and-
 * dice because long thin slivers are unreadable and unclickable.
 */
function squarify(items: TreemapItem[], rect: Rect, out: Array<TreemapItem & Rect>): void {
  if (!items.length) return;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return;

  let remaining = [...items];
  let area = { ...rect };
  let areaTotal = total;

  while (remaining.length) {
    const horizontal = area.w >= area.h;
    const side = horizontal ? area.h : area.w;
    const scale = (horizontal ? area.w * area.h : area.w * area.h) / areaTotal;

    const row: TreemapItem[] = [];
    let rowSum = 0;
    let bestRatio = Infinity;

    for (const item of remaining) {
      const trySum = rowSum + item.value;
      const tryRow = [...row, item];
      const thickness = (trySum * scale) / side;
      let worst = 0;
      for (const r of tryRow) {
        const len = (r.value * scale) / Math.max(thickness, 1e-9);
        worst = Math.max(worst, Math.max(thickness / Math.max(len, 1e-9), len / Math.max(thickness, 1e-9)));
      }
      if (worst > bestRatio && row.length > 0) break;
      bestRatio = worst;
      row.push(item);
      rowSum = trySum;
    }

    const thickness = (rowSum * scale) / side;
    let cursor = horizontal ? area.y : area.x;
    for (const r of row) {
      const len = (r.value * scale) / Math.max(thickness, 1e-9);
      if (horizontal) {
        out.push({ ...r, x: area.x, y: cursor, w: thickness, h: len });
      } else {
        out.push({ ...r, x: cursor, y: area.y, w: len, h: thickness });
      }
      cursor += len;
    }

    if (horizontal) {
      area = { x: area.x + thickness, y: area.y, w: Math.max(0, area.w - thickness), h: area.h };
    } else {
      area = { x: area.x, y: area.y + thickness, w: area.w, h: Math.max(0, area.h - thickness) };
    }
    areaTotal -= rowSum;
    remaining = remaining.slice(row.length);
    if (area.w <= 0.5 || area.h <= 0.5) break;
  }
}

export function renderTreemapSvg(items: TreemapItem[], title = 'Contribution'): string {
  const clean = (items || [])
    .filter(i => i && isFinite(i.value) && i.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 40);
  if (clean.length === 0) return emptyState('No positive values available for a treemap.');

  const width = 640;
  const height = 300;
  const top = 28;
  const total = clean.reduce((s, i) => s + i.value, 0);

  const placed: Array<TreemapItem & Rect> = [];
  squarify(clean, { x: 4, y: top, w: width - 8, h: height - top - 4 }, placed);

  const cells = placed
    .map((p, i) => {
      const color = PALETTE[i % PALETTE.length];
      const pct = (p.value / total) * 100;
      const showLabel = p.w > 46 && p.h > 22;
      const showValue = p.w > 60 && p.h > 34;
      return `
        <g>
          <rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${Math.max(0, p.w - 1.5).toFixed(1)}" height="${Math.max(0, p.h - 1.5).toFixed(1)}"
                fill="${color}" opacity="0.72" rx="3" stroke="${SURFACE}" stroke-width="1">
            <title>${esc(p.name)}: ${formatCompact(p.value)} (${pct.toFixed(1)}%)</title>
          </rect>
          ${showLabel ? `<text x="${(p.x + 6).toFixed(1)}" y="${(p.y + 15).toFixed(1)}" fill="#0b1120" font-size="10.5" font-weight="bold">${esc(truncate(p.name, Math.floor(p.w / 6.5)))}</text>` : ''}
          ${showValue ? `<text x="${(p.x + 6).toFixed(1)}" y="${(p.y + 28).toFixed(1)}" fill="#0b1120" font-size="9.5" opacity="0.85">${formatCompact(p.value)} · ${pct.toFixed(1)}%</text>` : ''}
        </g>`;
    })
    .join('');

  return frame(width, height, `
    <text x="10" y="18" fill="${TEXT_DIM}" font-size="10" font-weight="bold" letter-spacing="0.5">${esc(title.toUpperCase())} · ${clean.length} SEGMENTS</text>
    ${cells}
  `);
}

/** Aggregate rows into treemap items by a categorical column. */
export function treemapItemsFrom(
  rows: Array<Record<string, unknown>>,
  dimension: string,
  measure?: string,
  topN = 24,
): TreemapItem[] {
  const agg = new Map<string, number>();
  for (const r of rows) {
    const k = r?.[dimension];
    if (k === null || k === undefined || k === '') continue;
    const v = measure ? Number(r?.[measure]) : 1;
    if (!isFinite(v) || v <= 0) continue;
    const key = String(k);
    agg.set(key, (agg.get(key) ?? 0) + v);
  }
  const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, topN).map(([name, value]) => ({ name, value }));
  const tail = sorted.slice(topN);
  if (tail.length) {
    head.push({ name: `Other (${tail.length})`, value: tail.reduce((s, [, v]) => s + v, 0) });
  }
  return head;
}

// ---------------------------------------------------------------------------
// Parallel coordinates — honest high-dimensional comparison
// ---------------------------------------------------------------------------

export interface ParallelCoordsOptions {
  /** Row indices to highlight; everything else is dimmed. */
  highlightIndices?: number[];
  maxLines?: number;
  title?: string;
}

/**
 * Parallel coordinates for 3+ numeric dimensions. Each axis is independently
 * min-max scaled, which is the only honest way to place unrelated units on one
 * chart — the axis labels carry the real ranges.
 */
export function renderParallelCoordsSvg(
  rows: Array<Record<string, unknown>>,
  dimensions: string[],
  options: ParallelCoordsOptions = {},
): string {
  const dims = (dimensions || []).slice(0, 8);
  if (dims.length < 2) return emptyState('Parallel coordinates need at least two numeric dimensions.');
  if (!rows || !rows.length) return emptyState('No rows available for parallel coordinates.');

  const maxLines = options.maxLines ?? 400;
  const width = 640;
  const height = 300;
  const padL = 44;
  const padR = 44;
  const padT = 40;
  const padB = 30;
  const plotH = height - padT - padB;
  const axisGap = dims.length > 1 ? (width - padL - padR) / (dims.length - 1) : 0;

  const ranges = dims.map(d => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const v = Number(r?.[d]);
      if (!isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
    if (min === max) return { min: min - 0.5, max: max + 0.5 };
    return { min, max };
  });

  const highlight = options.highlightIndices ? new Set(options.highlightIndices) : null;

  // Sample deterministically (stride) so the picture is stable across renders.
  const stride = Math.max(1, Math.ceil(rows.length / maxLines));
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i += stride) {
    const r = rows[i];
    const pts: string[] = [];
    let valid = true;
    for (let d = 0; d < dims.length; d++) {
      const v = Number(r?.[dims[d]]);
      if (!isFinite(v)) { valid = false; break; }
      const { min, max } = ranges[d];
      const norm = (v - min) / (max - min);
      const x = padL + d * axisGap;
      const y = padT + plotH - norm * plotH;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    if (!valid) continue;
    const isHi = highlight ? highlight.has(i) : false;
    const stroke = isHi ? '#38bdf8' : highlight ? '#334155' : PALETTE[i % PALETTE.length];
    const opacity = isHi ? 0.95 : highlight ? 0.18 : 0.3;
    const w = isHi ? 1.6 : 1;
    lines.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${w}" opacity="${opacity}"/>`);
  }

  const axes = dims
    .map((d, i) => {
      const x = padL + i * axisGap;
      const { min, max } = ranges[i];
      return `
        <g>
          <line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="${BORDER}" stroke-width="1.5"/>
          <text x="${x}" y="${padT - 10}" fill="${TEXT}" font-size="10" font-weight="bold" text-anchor="middle">${esc(truncate(d, 12))}</text>
          <text x="${x}" y="${padT - 1}" fill="${TEXT_DIM}" font-size="8" text-anchor="middle">${formatCompact(max)}</text>
          <text x="${x}" y="${padT + plotH + 12}" fill="${TEXT_DIM}" font-size="8" text-anchor="middle">${formatCompact(min)}</text>
        </g>`;
    })
    .join('');

  const note = highlight ? ` · ${highlight.size} highlighted` : '';
  return frame(width, height, `
    <text x="10" y="16" fill="${TEXT_DIM}" font-size="10" font-weight="bold" letter-spacing="0.5">${esc((options.title ?? 'Parallel Coordinates').toUpperCase())}${esc(note)}</text>
    ${lines.join('')}${axes}
  `);
}

// ---------------------------------------------------------------------------
// Time-series charts
// ---------------------------------------------------------------------------

export interface TimeSeriesChartPoint { date: string; value: number; }
export interface TimeSeriesForecastPoint { date: string; value: number; lower: number; upper: number; }
export interface TimeSeriesMarker { date: string; label: string; direction?: 'up' | 'down'; }

/**
 * Historical line plus forecast cone. The cone is drawn as a filled band so the
 * uncertainty is impossible to miss — a forecast line alone reads as a promise.
 */
export function renderTimeSeriesSvg(
  history: TimeSeriesChartPoint[],
  forecast: TimeSeriesForecastPoint[] = [],
  markers: TimeSeriesMarker[] = [],
  title = 'Trend & Forecast',
): string {
  const hist = (history || []).filter(p => p && isFinite(p.value));
  if (hist.length < 2) return emptyState('Not enough time points to draw a trend.');

  const width = 640;
  const height = 280;
  const padL = 48;
  const padR = 14;
  const padT = 38;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const fc = (forecast || []).filter(p => p && isFinite(p.value));
  const totalPts = hist.length + fc.length;

  let min = Infinity;
  let max = -Infinity;
  for (const p of hist) { min = Math.min(min, p.value); max = Math.max(max, p.value); }
  for (const p of fc) {
    min = Math.min(min, p.lower, p.value);
    max = Math.max(max, p.upper, p.value);
  }
  if (!isFinite(min) || !isFinite(max)) return emptyState('Time series contains no finite values.');
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const xAt = (i: number) => padL + (totalPts <= 1 ? 0 : (i / (totalPts - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - ((v - min) / (max - min)) * plotH;

  // Gridlines
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(f => {
      const y = padT + plotH - f * plotH;
      const v = min + f * (max - min);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="${BORDER}" stroke-width="0.7" opacity="0.6"/>
              <text x="${padL - 6}" y="${(y + 3).toFixed(1)}" fill="${TEXT_DIM}" font-size="9" text-anchor="end">${formatCompact(v)}</text>`;
    })
    .join('');

  const histPts = hist.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ');

  let cone = '';
  let fcLine = '';
  if (fc.length) {
    const lastIdx = hist.length - 1;
    const upper = fc.map((p, i) => `${xAt(lastIdx + 1 + i).toFixed(1)},${yAt(p.upper).toFixed(1)}`);
    const lower = fc.map((p, i) => `${xAt(lastIdx + 1 + i).toFixed(1)},${yAt(p.lower).toFixed(1)}`).reverse();
    const anchor = `${xAt(lastIdx).toFixed(1)},${yAt(hist[lastIdx].value).toFixed(1)}`;
    cone = `<polygon points="${anchor} ${upper.join(' ')} ${lower.join(' ')}" fill="#a855f7" opacity="0.16"/>`;
    fcLine = `<polyline points="${anchor} ${fc.map((p, i) => `${xAt(lastIdx + 1 + i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ')}"
                fill="none" stroke="#a855f7" stroke-width="2" stroke-dasharray="5,4"/>`;
  }

  const markerSvg = (markers || [])
    .map(m => {
      const idx = hist.findIndex(p => p.date === m.date);
      if (idx === -1) return '';
      const x = xAt(idx);
      const color = m.direction === 'down' ? '#f87171' : '#34d399';
      return `
        <g>
          <line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" stroke="${color}" stroke-width="1.4" stroke-dasharray="3,3" opacity="0.9"/>
          <circle cx="${x.toFixed(1)}" cy="${padT + 4}" r="3.5" fill="${color}"><title>${esc(m.label)}</title></circle>
        </g>`;
    })
    .join('');

  // A handful of x labels, evenly spaced.
  const labelStep = Math.max(1, Math.floor(hist.length / 5));
  const xLabels = hist
    .map((p, i) => (i % labelStep === 0 ? `<text x="${xAt(i).toFixed(1)}" y="${height - 12}" fill="${TEXT_DIM}" font-size="8.5" text-anchor="middle">${esc(p.date)}</text>` : ''))
    .join('');

  const legend = fc.length
    ? `<g>
         <line x1="${width - 168}" y1="14" x2="${width - 150}" y2="14" stroke="#38bdf8" stroke-width="2"/>
         <text x="${width - 146}" y="17.5" fill="${TEXT_DIM}" font-size="9">actual</text>
         <line x1="${width - 104}" y1="14" x2="${width - 86}" y2="14" stroke="#a855f7" stroke-width="2" stroke-dasharray="5,4"/>
         <text x="${width - 82}" y="17.5" fill="${TEXT_DIM}" font-size="9">forecast ±95%</text>
       </g>`
    : '';

  return frame(width, height, `
    <text x="10" y="18" fill="${TEXT_DIM}" font-size="10" font-weight="bold" letter-spacing="0.5">${esc(title.toUpperCase())}</text>
    ${legend}${grid}${cone}
    <polyline points="${histPts}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    ${fcLine}${markerSvg}${xLabels}
  `);
}

/** Small-multiple decomposition: trend, seasonal and residual stacked. */
export function renderDecompositionSvg(
  dates: string[],
  trend: Array<number | null>,
  seasonal: number[],
  residual: Array<number | null>,
): string {
  if (!dates.length) return emptyState('No series to decompose.');

  const width = 640;
  const rowH = 74;
  const height = rowH * 3 + 34;
  const padL = 46;
  const padR = 12;
  const plotW = width - padL - padR;

  const panel = (
    label: string,
    values: Array<number | null>,
    top: number,
    color: string,
  ): string => {
    const finite = values.filter((v): v is number => v !== null && isFinite(v));
    if (!finite.length) return '';
    let lo = Math.min(...finite);
    let hi = Math.max(...finite);
    if (lo === hi) { lo -= 1; hi += 1; }
    const h = rowH - 20;
    const xAt = (i: number) => padL + (values.length <= 1 ? 0 : (i / (values.length - 1)) * plotW);
    const yAt = (v: number) => top + h - ((v - lo) / (hi - lo)) * h;

    // Break the polyline wherever the value is null rather than bridging a gap.
    const segments: string[][] = [];
    let cur: string[] = [];
    values.forEach((v, i) => {
      if (v === null || !isFinite(v)) {
        if (cur.length > 1) segments.push(cur);
        cur = [];
      } else {
        cur.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
      }
    });
    if (cur.length > 1) segments.push(cur);

    const zeroLine = lo < 0 && hi > 0
      ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${width - padR}" y2="${yAt(0).toFixed(1)}" stroke="${BORDER}" stroke-width="0.8"/>`
      : '';

    return `
      <g>
        <text x="10" y="${top + 9}" fill="${TEXT_DIM}" font-size="9" font-weight="bold">${esc(label)}</text>
        <text x="${padL - 6}" y="${top + 9}" fill="${TEXT_DIM}" font-size="8" text-anchor="end">${formatCompact(hi)}</text>
        <text x="${padL - 6}" y="${(top + h + 4).toFixed(1)}" fill="${TEXT_DIM}" font-size="8" text-anchor="end">${formatCompact(lo)}</text>
        ${zeroLine}
        ${segments.map(s => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"/>`).join('')}
      </g>`;
  };

  return frame(width, height, `
    <text x="10" y="16" fill="${TEXT_DIM}" font-size="10" font-weight="bold" letter-spacing="0.5">SEASONAL DECOMPOSITION</text>
    ${panel('TREND', trend, 30, '#38bdf8')}
    ${panel('SEASONAL', seasonal, 30 + rowH, '#fbbf24')}
    ${panel('RESIDUAL', residual, 30 + rowH * 2, '#f472b6')}
  `);
}

// ---------------------------------------------------------------------------
// Geospatial
// ---------------------------------------------------------------------------

/**
 * Approximate centroids (lon, lat) for countries and common region names.
 * Deliberately small and bundled rather than fetched: air-gap mode must keep
 * working, and a full TopoJSON is neither needed nor affordable for a bubble
 * map. Choropleth-by-shape is a later upgrade; this delivers the insight now.
 */
const PLACE_CENTROIDS: Record<string, [number, number]> = {
  afghanistan: [66, 33], argentina: [-64, -34], australia: [133, -25], austria: [14, 47.5],
  bangladesh: [90, 24], belgium: [4.5, 50.8], brazil: [-52, -10], canada: [-106, 56],
  chile: [-71, -30], china: [105, 35], colombia: [-74, 4], denmark: [10, 56],
  egypt: [30, 27], finland: [26, 64], france: [2, 46], germany: [10, 51],
  greece: [22, 39], 'hong kong': [114.1, 22.4], india: [79, 22], indonesia: [120, -5],
  iran: [53, 32], iraq: [44, 33], ireland: [-8, 53], israel: [35, 31],
  italy: [12.5, 42.8], japan: [138, 36], kenya: [38, 0], malaysia: [102, 4],
  mexico: [-102, 23], netherlands: [5.75, 52.5], 'new zealand': [174, -41], nigeria: [8, 10],
  norway: [10, 62], pakistan: [70, 30], peru: [-76, -10], philippines: [122, 13],
  poland: [20, 52], portugal: [-8, 39.5], qatar: [51.2, 25.3], romania: [25, 46],
  russia: [100, 60], 'saudi arabia': [45, 24], singapore: [103.8, 1.36], 'south africa': [24, -29],
  'south korea': [128, 36], korea: [128, 36], spain: [-4, 40], sweden: [15, 62],
  switzerland: [8, 47], taiwan: [121, 23.7], thailand: [101, 15], turkey: [35, 39],
  ukraine: [32, 49], 'united arab emirates': [54, 24], uae: [54, 24],
  'united kingdom': [-2, 54], uk: [-2, 54], england: [-1.5, 52.5], scotland: [-4, 56.5],
  'united states': [-97, 39], usa: [-97, 39], us: [-97, 39], america: [-97, 39],
  vietnam: [106, 16], venezuela: [-66, 8],
  // Coarse regions — placed at a representative point.
  emea: [15, 45], apac: [110, 10], amer: [-80, 20], americas: [-80, 20],
  europe: [15, 50], asia: [100, 35], africa: [20, 0], 'north america': [-100, 45],
  'south america': [-60, -15], 'middle east': [45, 28], oceania: [140, -25],
};

export interface GeoDetection {
  kind: 'latlon' | 'place';
  latColumn?: string;
  lonColumn?: string;
  placeColumn?: string;
  /** Share of rows that resolved to a location. */
  coverage: number;
}

/** Find either a lat/long pair or a resolvable place-name column. */
export function detectGeoColumns(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): GeoDetection | null {
  if (!rows?.length || !columns?.length) return null;
  const sample = rows.slice(0, 300);

  const latCol = columns.find(c => /^(lat|latitude|y_?lat)$/i.test(c) || /latitude/i.test(c));
  const lonCol = columns.find(c => /^(lon|lng|long|longitude)$/i.test(c) || /longitude/i.test(c));
  if (latCol && lonCol) {
    let ok = 0;
    for (const r of sample) {
      const la = Number(r?.[latCol]);
      const lo = Number(r?.[lonCol]);
      if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) ok++;
    }
    const coverage = ok / sample.length;
    if (coverage > 0.5) return { kind: 'latlon', latColumn: latCol, lonColumn: lonCol, coverage };
  }

  // Place names: prefer a column whose values actually resolve.
  let best: GeoDetection | null = null;
  for (const c of columns) {
    const vals = sample.map(r => r?.[c]).filter(v => typeof v === 'string' && v.trim() !== '') as string[];
    if (vals.length < Math.max(3, sample.length * 0.4)) continue;
    const hits = vals.filter(v => PLACE_CENTROIDS[v.trim().toLowerCase()] !== undefined).length;
    const coverage = hits / vals.length;
    if (coverage > 0.5 && (!best || coverage > best.coverage)) {
      best = { kind: 'place', placeColumn: c, coverage };
    }
  }
  return best;
}

export interface GeoBubble { name: string; lat: number; lon: number; value: number; count: number; }

/** Resolve rows to weighted map bubbles. */
export function buildGeoBubbles(
  rows: Array<Record<string, unknown>>,
  detection: GeoDetection,
  measure?: string,
): GeoBubble[] {
  const agg = new Map<string, GeoBubble>();

  for (const r of rows) {
    let lat: number | null = null;
    let lon: number | null = null;
    let name = '';

    if (detection.kind === 'latlon' && detection.latColumn && detection.lonColumn) {
      const la = Number(r?.[detection.latColumn]);
      const lo = Number(r?.[detection.lonColumn]);
      if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
      lat = la; lon = lo;
      // Bucket to ~1 degree so nearby points merge into one readable bubble.
      name = `${la.toFixed(1)}, ${lo.toFixed(1)}`;
    } else if (detection.placeColumn) {
      const raw = r?.[detection.placeColumn];
      if (typeof raw !== 'string') continue;
      const key = raw.trim().toLowerCase();
      const c = PLACE_CENTROIDS[key];
      if (!c) continue;
      lon = c[0]; lat = c[1];
      name = raw.trim();
    }

    if (lat === null || lon === null) continue;
    const v = measure ? Number(r?.[measure]) : 1;
    if (!isFinite(v)) continue;

    const existing = agg.get(name);
    if (existing) {
      existing.value += v;
      existing.count += 1;
    } else {
      agg.set(name, { name, lat, lon, value: v, count: 1 });
    }
  }

  return [...agg.values()].sort((a, b) => b.value - a.value);
}

/**
 * Equirectangular world bubble map. Equirectangular rather than Mercator
 * because at world scale Mercator's polar distortion misleads far more than the
 * projection buys, and we are placing points, not comparing areas.
 */
export function renderGeoMapSvg(bubbles: GeoBubble[], title = 'Geographic Distribution'): string {
  const pts = (bubbles || []).filter(b => isFinite(b.lat) && isFinite(b.lon) && b.value > 0);
  if (!pts.length) return emptyState('No resolvable geographic values found.');

  const width = 640;
  const height = 320;
  const padT = 30;
  const mapH = height - padT - 10;

  const xAt = (lon: number) => ((lon + 180) / 360) * width;
  const yAt = (lat: number) => padT + ((90 - lat) / 180) * mapH;

  const maxV = Math.max(...pts.map(p => p.value));
  const rAt = (v: number) => 3 + Math.sqrt(v / maxV) * 19;

  // Graticule stands in for coastlines — enough to orient without a shapefile.
  const grat: string[] = [];
  for (let lon = -180; lon <= 180; lon += 30) {
    grat.push(`<line x1="${xAt(lon).toFixed(1)}" y1="${padT}" x2="${xAt(lon).toFixed(1)}" y2="${padT + mapH}" stroke="${BORDER}" stroke-width="0.6" opacity="0.55"/>`);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    grat.push(`<line x1="0" y1="${yAt(lat).toFixed(1)}" x2="${width}" y2="${yAt(lat).toFixed(1)}" stroke="${BORDER}" stroke-width="0.6" opacity="0.55"/>`);
  }
  grat.push(`<line x1="0" y1="${yAt(0).toFixed(1)}" x2="${width}" y2="${yAt(0).toFixed(1)}" stroke="${BORDER}" stroke-width="1.1" opacity="0.9"/>`);

  const circles = pts
    .slice(0, 300)
    .map((p, i) => {
      const r = rAt(p.value);
      const color = PALETTE[i % PALETTE.length];
      return `<circle cx="${xAt(p.lon).toFixed(1)}" cy="${yAt(p.lat).toFixed(1)}" r="${r.toFixed(1)}"
                fill="${color}" opacity="0.55" stroke="${color}" stroke-width="1.2">
                <title>${esc(p.name)}: ${formatCompact(p.value)} (${p.count} rows)</title>
              </circle>`;
    })
    .join('');

  // Label only the largest few, or the map becomes unreadable.
  const labels = pts
    .slice(0, 6)
    .map(p => `<text x="${xAt(p.lon).toFixed(1)}" y="${(yAt(p.lat) - rAt(p.value) - 4).toFixed(1)}" fill="${TEXT}" font-size="9" font-weight="bold" text-anchor="middle">${esc(truncate(p.name, 16))}</text>`)
    .join('');

  return frame(width, height, `
    <text x="10" y="18" fill="${TEXT_DIM}" font-size="10" font-weight="bold" letter-spacing="0.5">${esc(title.toUpperCase())} · ${pts.length} LOCATIONS</text>
    <rect x="0" y="${padT}" width="${width}" height="${mapH}" fill="#0b1120"/>
    ${grat.join('')}${circles}${labels}
  `);
}
