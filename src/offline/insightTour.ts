/**
 * offline/insightTour.ts — Turns computed findings into a narrated walkthrough.
 *
 * The engine already discovers more than a user can absorb from a wall of
 * panels: drivers, changepoints, Pareto concentration, cohort gaps, outliers.
 * This module sequences those findings into an ordered story — headline, then
 * cause, then who it concentrates in, then what to do — with each step pointing
 * at the visual that proves it.
 *
 * No new analysis happens here. It is pure orchestration over results the
 * engine has already produced, which is precisely why it is cheap to maintain:
 * when the analytics improve, the tour improves with them.
 */

import type {
  BottleneckStage,
  CohortMetric,
  KeyDriver,
  OutlierRecord,
  ParetoAnalysis,
} from './dataScientistEngine';
import type { TimeSeriesAnalysis } from './timeIntelligence';

export type TourVisual =
  | 'timeseries' | 'decomposition' | 'waterfall' | 'tornado'
  | 'pareto' | 'cohort' | 'correlation' | 'manifold'
  | 'sankey' | 'treemap' | 'geo' | 'parcoords' | 'none';

export interface TourStep {
  id: string;
  /** Order in the narration, 1-based. */
  order: number;
  title: string;
  /** One or two sentences, written for a non-statistician. */
  narrative: string;
  /** Which panel to show while this step is read. */
  visual: TourVisual;
  /** Why this step earned its place — shown on hover as provenance. */
  evidence: string;
  /** 0..1. Steps below the threshold are dropped rather than hedged. */
  confidence: number;
  kind: 'headline' | 'trend' | 'change' | 'driver' | 'concentration' | 'cohort' | 'outlier' | 'action';
  /** Row indices this step refers to, so the tour can drive cross-filtering. */
  focusIndices?: number[];
}

export interface InsightTour {
  title: string;
  subtitle: string;
  steps: TourStep[];
  /** Everything in one paragraph, for a report abstract or chat reply. */
  executiveSummary: string;
}

export interface TourInput {
  datasetTitle: string;
  targetKpiName: string;
  targetKpiUnit?: string;
  totalRecords: number;
  timeSeries?: TimeSeriesAnalysis | null;
  keyDrivers?: KeyDriver[];
  bottlenecks?: BottleneckStage[];
  pareto?: ParetoAnalysis | null;
  cohorts?: CohortMetric[];
  outliers?: OutlierRecord[];
  prescriptiveActions?: Array<{ action: string; expectedRoi: string; priority: string }>;
  hasGeo?: boolean;
  hasFlow?: boolean;
}

/** Steps weaker than this are omitted. A quiet tour beats a padded one. */
const MIN_CONFIDENCE = 0.35;

function fmt(n: number, unit?: string): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1_000_000) s = `${(n / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) s = `${(n / 1_000).toFixed(1)}K`;
  else if (abs >= 10) s = n.toFixed(0);
  else s = n.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}

/**
 * Build the tour. Ordering is fixed by narrative logic rather than by
 * confidence: what changed comes before why, which comes before who, which
 * comes before what to do. A story reordered by p-value is not a story.
 */
export function buildInsightTour(input: TourInput): InsightTour {
  const steps: TourStep[] = [];
  const unit = input.targetKpiUnit;
  const kpi = input.targetKpiName;

  // 1. Headline — always present, anchors the rest.
  steps.push({
    id: 'headline',
    order: 0,
    title: 'What we looked at',
    narrative:
      `${input.totalRecords.toLocaleString()} records analysed, with ${kpi} as the measure of interest.`,
    visual: 'none',
    evidence: `Dataset: ${input.datasetTitle}`,
    confidence: 1,
    kind: 'headline',
  });

  // 2. Trend.
  const ts = input.timeSeries;
  if (ts && ts.series.length >= 4) {
    if (ts.trendDirection !== 'flat') {
      steps.push({
        id: 'trend',
        order: 0,
        title: ts.trendDirection === 'rising' ? 'The trend is rising' : 'The trend is falling',
        narrative:
          `Over ${ts.series.length} ${ts.grain}s, ${kpi} moved ${ts.trendDirection} at about ` +
          `${Math.abs(ts.trendPctPerPeriod).toFixed(1)}% per ${ts.grain}.` +
          (ts.forecast.length
            ? ` Projected forward, it reaches ${fmt(ts.forecast[ts.forecast.length - 1].value, unit)} in ${ts.forecast.length} ${ts.grain}s.`
            : ''),
        visual: 'timeseries',
        evidence: `Least-squares slope over ${ts.series.length} points; Holt-Winters projection.`,
        confidence: 0.8,
        kind: 'trend',
      });
    }

    if (ts.seasonalityDetected && ts.seasonalPeriod) {
      steps.push({
        id: 'seasonality',
        order: 0,
        title: 'There is a repeating cycle',
        narrative:
          `${kpi} repeats on a ${ts.seasonalPeriod}-${ts.grain} cycle. Comparing one ${ts.grain} ` +
          `to the previous one will mislead; compare like-for-like points in the cycle instead.`,
        visual: 'decomposition',
        evidence: `Autocorrelation peak at lag ${ts.seasonalPeriod}.`,
        confidence: 0.7,
        kind: 'trend',
      });
    }

    // 3. Changepoint — usually the single most valuable statement.
    //
    // `changepoints` arrives in chronological order so a chart can draw it, but
    // the tour has room for one and must lead with the most significant, not
    // merely the earliest. Ranking by confidence then magnitude: on a series
    // with a seasonal dip early and a real step later, taking [0] narrated the
    // dip and stayed silent about the step that actually mattered.
    const cp = [...ts.changepoints].sort((a, b) =>
      (b.confidence - a.confidence) || (Math.abs(b.magnitudePct) - Math.abs(a.magnitudePct)),
    )[0];
    if (cp && cp.confidence >= 0.4) {
      steps.push({
        id: 'changepoint',
        order: 0,
        title: `Something changed on ${cp.date}`,
        narrative:
          `${kpi} ${cp.direction === 'up' ? 'stepped up' : 'stepped down'} by ` +
          `${Math.abs(cp.magnitudePct).toFixed(1)}% around ${cp.date} ` +
          `(${fmt(cp.before, unit)} → ${fmt(cp.after, unit)}) and stayed there. ` +
          `Whatever changed then is worth finding.`,
        visual: 'timeseries',
        evidence: `Binary segmentation; effect size vs in-segment noise, confidence ${(cp.confidence * 100).toFixed(0)}%.`,
        confidence: cp.confidence,
        kind: 'change',
      });
    }
  }

  // 4. Drivers.
  const drivers = (input.keyDrivers ?? []).filter(d => isFinite(d.absCorrelation));
  const topDriver = drivers.slice().sort((a, b) => b.absCorrelation - a.absCorrelation)[0];
  if (topDriver && topDriver.absCorrelation >= 0.3) {
    const r2 = topDriver.correlation * topDriver.correlation;
    steps.push({
      id: 'driver',
      order: 0,
      title: `${topDriver.featureName} moves with ${kpi}`,
      narrative:
        `${topDriver.featureName} has the strongest relationship with ${kpi} ` +
        `(r = ${topDriver.correlation.toFixed(2)}, ${(r2 * 100).toFixed(0)}% of variance). ` +
        `As ${topDriver.featureName} rises, ${kpi} tends to ` +
        `${topDriver.direction === 'positive' ? 'rise' : 'fall'}. ` +
        `This is association, not proof of cause.`,
      visual: 'tornado',
      evidence: `Pearson correlation across ${input.totalRecords.toLocaleString()} records.`,
      confidence: Math.min(0.9, topDriver.absCorrelation),
      kind: 'driver',
    });
  }

  // 5. Bottleneck.
  const chokepoint = (input.bottlenecks ?? []).find(b => b.isPrimaryBottleneck);
  if (chokepoint && chokepoint.pctOfTotalLatency > 15) {
    steps.push({
      id: 'bottleneck',
      order: 0,
      title: `${chokepoint.stageName} is the chokepoint`,
      narrative:
        `${chokepoint.stageName} accounts for ${chokepoint.pctOfTotalLatency.toFixed(0)}% of total ` +
        `cycle time, averaging ${chokepoint.avgDurationHours.toFixed(1)} hours. ` +
        `Improving anything else moves the total far less.`,
      visual: 'waterfall',
      evidence: `Stage duration share across ${chokepoint.count.toLocaleString()} observations.`,
      confidence: Math.min(0.9, chokepoint.pctOfTotalLatency / 100 + 0.4),
      kind: 'driver',
    });
  }

  // 6. Concentration.
  const pareto = input.pareto;
  if (pareto && pareto.capturedImpactPercent > 50) {
    steps.push({
      id: 'pareto',
      order: 0,
      title: pareto.isParetoConfirmed ? 'A small share drives most of the total' : 'Impact is spread out',
      narrative:
        `The top ${pareto.topPercentile}% of records account for ` +
        `${pareto.capturedImpactPercent.toFixed(0)}% of total ${kpi}. ` +
        (pareto.isParetoConfirmed
          ? 'Concentrating effort on that group is the highest-leverage move available.'
          : 'Impact is more evenly distributed than the 80/20 rule would suggest, so broad changes beat targeted ones.'),
      visual: 'pareto',
      evidence: pareto.summaryText || 'Cumulative impact curve with inflection detection.',
      confidence: 0.75,
      kind: 'concentration',
    });
  }

  // 7. Cohort gap.
  const cohorts = (input.cohorts ?? []).filter(c => isFinite(c.targetMean));
  if (cohorts.length >= 2) {
    const sorted = [...cohorts].sort((a, b) => b.targetMean - a.targetMean);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best && worst && best.cohortName !== worst.cohortName && worst.targetMean !== 0) {
      const gapPct = ((best.targetMean - worst.targetMean) / Math.abs(worst.targetMean)) * 100;
      if (Math.abs(gapPct) > 15) {
        steps.push({
          id: 'cohort',
          order: 0,
          title: `${best.cohortName} and ${worst.cohortName} are not the same business`,
          narrative:
            `${best.cohortName} averages ${fmt(best.targetMean, unit)} against ` +
            `${worst.cohortName} at ${fmt(worst.targetMean, unit)} — a ${Math.abs(gapPct).toFixed(0)}% gap. ` +
            `Any average across both hides this.`,
          visual: 'cohort',
          evidence: `Segment means across ${cohorts.length} cohorts (${best.recordCount.toLocaleString()} vs ${worst.recordCount.toLocaleString()} records).`,
          confidence: Math.min(0.85, 0.4 + Math.abs(gapPct) / 200),
          kind: 'cohort',
        });
      }
    }
  }

  // 8. Outliers — carries focus indices so the tour can drive cross-filtering.
  const outliers = input.outliers ?? [];
  if (outliers.length > 0) {
    const severe = outliers.filter(o => o.severityScore >= 70);
    if (severe.length) {
      const pct = (severe.length / Math.max(1, input.totalRecords)) * 100;
      const focusIndices = severe
        .map(o => (typeof o.id === 'number' ? o.id : Number(o.id)))
        .filter(n => Number.isInteger(n) && n >= 0);
      steps.push({
        id: 'outliers',
        order: 0,
        title: `${severe.length} records behave differently`,
        narrative:
          `${severe.length} records (${pct.toFixed(1)}%) sit far outside the normal range for ${kpi}. ` +
          (severe[0]?.category
            ? `They concentrate in ${severe[0].category}. `
            : '') +
          `Select them to see how every other panel changes.`,
        visual: 'manifold',
        evidence: `Tukey IQR fences and z-score screening; severity ≥ 70.`,
        confidence: 0.7,
        kind: 'outlier',
        focusIndices: focusIndices.length ? focusIndices : undefined,
      });
    }
  }

  // 9. Supplementary views, mentioned only when the data supports them.
  if (input.hasFlow) {
    steps.push({
      id: 'flow',
      order: 0,
      title: 'How volume moves between stages',
      narrative: `The flow view shows where volume accumulates and where it drops away between stages.`,
      visual: 'sankey',
      evidence: 'Stage-to-stage aggregated flow.',
      confidence: 0.5,
      kind: 'concentration',
    });
  }
  if (input.hasGeo) {
    steps.push({
      id: 'geo',
      order: 0,
      title: 'Where this happens',
      narrative: `${kpi} is not evenly distributed geographically — the map shows where it concentrates.`,
      visual: 'geo',
      evidence: 'Location column resolved to map coordinates.',
      confidence: 0.5,
      kind: 'concentration',
    });
  }

  // 10. Action.
  const action = (input.prescriptiveActions ?? [])[0];
  if (action) {
    steps.push({
      id: 'action',
      order: 0,
      title: 'What to do first',
      narrative: `${action.action} Expected return: ${action.expectedRoi}.`,
      visual: 'none',
      evidence: `Highest-priority recommendation (${action.priority}).`,
      confidence: 0.6,
      kind: 'action',
    });
  }

  const kept = steps.filter(s => s.confidence >= MIN_CONFIDENCE);
  kept.forEach((s, i) => { s.order = i + 1; });

  const summaryParts = kept
    .filter(s => s.kind !== 'headline')
    .slice(0, 4)
    .map(s => s.narrative.split('. ')[0].replace(/\.$/, ''));

  return {
    title: `What the data says about ${kpi}`,
    subtitle: `${kept.length} findings from ${input.totalRecords.toLocaleString()} records`,
    steps: kept,
    executiveSummary: summaryParts.length
      ? `${summaryParts.join('. ')}.`
      : `No strong patterns surfaced in ${kpi} across ${input.totalRecords.toLocaleString()} records.`,
  };
}

/** Render the tour as standalone HTML for reports and webviews. */
export function renderTourHtml(tour: InsightTour): string {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const icons: Record<TourStep['kind'], string> = {
    headline: '◆', trend: '📈', change: '⚡', driver: '🔗',
    concentration: '🎯', cohort: '👥', outlier: '🚨', action: '✅',
  };

  const steps = tour.steps
    .map(s => `
      <li class="tour-step" data-visual="${esc(s.visual)}" data-step="${s.order}">
        <div class="tour-step-marker">${icons[s.kind] ?? '•'}</div>
        <div class="tour-step-body">
          <div class="tour-step-head">
            <span class="tour-step-num">${s.order}</span>
            <h4>${esc(s.title)}</h4>
            <span class="tour-conf" title="Confidence">${(s.confidence * 100).toFixed(0)}%</span>
          </div>
          <p>${esc(s.narrative)}</p>
          <div class="tour-evidence" title="${esc(s.evidence)}">${esc(s.evidence)}</div>
        </div>
      </li>`)
    .join('');

  return `
<div class="insight-tour">
  <style>
    .insight-tour { font-family: system-ui, -apple-system, sans-serif; color: #cbd5e1; }
    .insight-tour h3 { margin: 0 0 4px; font-size: 16px; color: #f1f5f9; }
    .insight-tour .tour-sub { font-size: 11.5px; color: #64748b; margin-bottom: 14px; }
    .insight-tour ol { list-style: none; margin: 0; padding: 0; }
    .tour-step { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #1e293b; }
    .tour-step:last-child { border-bottom: none; }
    .tour-step-marker { font-size: 15px; width: 26px; height: 26px; flex: none;
      display: flex; align-items: center; justify-content: center;
      background: #0f172a; border: 1px solid #1e293b; border-radius: 50%; }
    .tour-step-body { flex: 1; min-width: 0; }
    .tour-step-head { display: flex; align-items: center; gap: 8px; }
    .tour-step-head h4 { margin: 0; font-size: 13.5px; color: #f1f5f9; font-weight: 600; }
    .tour-step-num { font-size: 10px; color: #475569; font-variant-numeric: tabular-nums; }
    .tour-conf { margin-left: auto; font-size: 10px; color: #38bdf8;
      background: rgba(56,189,248,.12); padding: 1px 6px; border-radius: 999px; }
    .tour-step-body p { margin: 5px 0 6px; font-size: 12.5px; line-height: 1.55; color: #cbd5e1; }
    .tour-evidence { font-size: 10.5px; color: #64748b; font-style: italic;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tour-summary { margin-top: 14px; padding: 11px 13px; background: #0f172a;
      border-left: 3px solid #38bdf8; border-radius: 4px; font-size: 12.5px; line-height: 1.6; }
  </style>
  <h3>${esc(tour.title)}</h3>
  <div class="tour-sub">${esc(tour.subtitle)}</div>
  <ol>${steps}</ol>
  <div class="tour-summary"><strong>In short:</strong> ${esc(tour.executiveSummary)}</div>
</div>`;
}
