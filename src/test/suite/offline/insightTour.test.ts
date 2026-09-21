/**
 * test/suite/offline/insightTour.test.ts
 *
 * The tour's job is editorial: say what is true, in an order a human can
 * follow, and stay quiet when there is nothing to say. These tests pin exactly
 * that — narrative ordering, suppression of weak findings, and the guarantee
 * that findings never leak unescaped into the rendered HTML.
 */

import * as assert from 'assert';
import { buildInsightTour, renderTourHtml, type TourInput } from '../../../offline/insightTour';

function baseInput(overrides: Partial<TourInput> = {}): TourInput {
  return {
    datasetTitle: 'orders.csv',
    targetKpiName: 'revenue',
    targetKpiUnit: 'USD',
    totalRecords: 5000,
    ...overrides,
  };
}

suite('Insight Tour Suite', () => {

  test('always opens with a headline that anchors the dataset', () => {
    const tour = buildInsightTour(baseInput());
    assert.ok(tour.steps.length >= 1);
    assert.strictEqual(tour.steps[0].kind, 'headline');
    assert.strictEqual(tour.steps[0].order, 1);
    assert.ok(tour.steps[0].narrative.includes('5,000'), 'record count should be formatted');
  });

  test('stays quiet when the data says nothing', () => {
    const tour = buildInsightTour(baseInput());
    // Only the headline survives — no invented findings.
    assert.strictEqual(tour.steps.length, 1);
    assert.ok(/no strong patterns/i.test(tour.executiveSummary));
  });

  test('orders findings as a narrative, not by confidence', () => {
    const tour = buildInsightTour(baseInput({
      keyDrivers: [{
        featureName: 'discount', correlation: 0.82, absCorrelation: 0.82,
        direction: 'positive', importanceWeight: 80, elasticityDescription: 'strong',
      }],
      cohorts: [
        { cohortName: 'Enterprise', recordCount: 100, pctOfTotal: 20, targetMean: 900,
          targetMedian: 880, outlierRate: 1, performanceGrade: 'A', gapAnalysis: '' },
        { cohortName: 'SMB', recordCount: 400, pctOfTotal: 80, targetMean: 300,
          targetMedian: 290, outlierRate: 2, performanceGrade: 'C', gapAnalysis: '' },
      ],
      prescriptiveActions: [{ action: 'Rebalance discounting.', expectedRoi: '+8%', priority: 'HIGH' }],
    }));

    const kinds = tour.steps.map(s => s.kind);
    // Driver must precede cohort, and the action must come last.
    assert.ok(kinds.indexOf('driver') < kinds.indexOf('cohort'), 'cause before segment');
    assert.strictEqual(kinds[kinds.length - 1], 'action', 'recommendation closes the tour');
    // Orders are contiguous and 1-based after filtering.
    tour.steps.forEach((s, i) => assert.strictEqual(s.order, i + 1));
  });

  test('suppresses a weak driver rather than hedging about it', () => {
    const tour = buildInsightTour(baseInput({
      keyDrivers: [{
        featureName: 'noise', correlation: 0.05, absCorrelation: 0.05,
        direction: 'positive', importanceWeight: 2, elasticityDescription: 'negligible',
      }],
    }));
    assert.ok(!tour.steps.some(s => s.kind === 'driver'), 'r = 0.05 is not a finding');
  });

  test('states association rather than causation for drivers', () => {
    const tour = buildInsightTour(baseInput({
      keyDrivers: [{
        featureName: 'ad_spend', correlation: 0.76, absCorrelation: 0.76,
        direction: 'positive', importanceWeight: 70, elasticityDescription: 'strong',
      }],
    }));
    const driver = tour.steps.find(s => s.kind === 'driver');
    assert.ok(driver, 'expected a driver step');
    assert.ok(/not proof of cause/i.test(driver!.narrative),
      'the tour must not imply causation from correlation');
  });

  test('reports a changepoint with its date and direction', () => {
    const tour = buildInsightTour(baseInput({
      timeSeries: {
        dateColumn: 'order_date', valueColumn: 'revenue', grain: 'month',
        series: Array.from({ length: 24 }, (_, i) => ({
          t: Date.UTC(2023, i, 1), date: `2023-${String((i % 12) + 1).padStart(2, '0')}-01`,
          value: 100 + i, count: 1,
        })),
        decomposition: { trend: [], seasonal: [], residual: [] },
        changepoints: [{
          index: 12, date: '2024-03-14', before: 100, after: 82,
          magnitudePct: -18, direction: 'down', confidence: 0.85,
          narrative: 'Level shift on 2024-03-14.',
        }],
        forecast: [], seasonalityDetected: false, seasonalPeriod: null,
        trendSlope: 1, trendPctPerPeriod: 1.2, trendDirection: 'rising',
        narrative: 'rising',
      },
    }));

    const cp = tour.steps.find(s => s.kind === 'change');
    assert.ok(cp, 'expected a changepoint step');
    assert.ok(cp!.title.includes('2024-03-14'));
    assert.ok(cp!.narrative.includes('18.0%'));
    assert.ok(/stepped down/.test(cp!.narrative));
  });

  test('leads with the most significant changepoint, not the earliest', () => {
    // Regression guard: `changepoints` is chronological so charts can draw it,
    // but the tour has room for one headline. Taking [0] narrated an early
    // seasonal dip and stayed silent about the larger step that followed.
    const mkSeries = () => Array.from({ length: 24 }, (_, i) => ({
      t: Date.UTC(2023, i, 1), date: `2023-${String(i + 1).padStart(2, '0')}-01`,
      value: 100, count: 1,
    }));

    const tour = buildInsightTour(baseInput({
      timeSeries: {
        dateColumn: 'd', valueColumn: 'revenue', grain: 'month',
        series: mkSeries(),
        decomposition: { trend: [], seasonal: [], residual: [] },
        changepoints: [
          { index: 6, date: '2023-07-01', before: 100, after: 76, magnitudePct: -24,
            direction: 'down', confidence: 0.57, narrative: 'early dip' },
          { index: 14, date: '2024-03-01', before: 100, after: 138, magnitudePct: 37.6,
            direction: 'up', confidence: 0.59, narrative: 'the real step' },
        ],
        forecast: [], seasonalityDetected: false, seasonalPeriod: null,
        trendSlope: 0, trendPctPerPeriod: 0.1, trendDirection: 'flat',
        narrative: 'x',
      },
    }));

    const cp = tour.steps.find(s => s.kind === 'change');
    assert.ok(cp, 'expected a changepoint step');
    assert.ok(cp!.title.includes('2024-03-01'),
      `should lead with the highest-confidence shift, got "${cp!.title}"`);
    assert.ok(/stepped up/.test(cp!.narrative));
  });

  test('drops a low-confidence changepoint', () => {
    const tour = buildInsightTour(baseInput({
      timeSeries: {
        dateColumn: 'd', valueColumn: 'revenue', grain: 'day',
        series: Array.from({ length: 10 }, (_, i) => ({
          t: i, date: `2024-01-0${i}`, value: 10, count: 1,
        })),
        decomposition: { trend: [], seasonal: [], residual: [] },
        changepoints: [{
          index: 5, date: '2024-01-05', before: 10, after: 11,
          magnitudePct: 10, direction: 'up', confidence: 0.2,
          narrative: 'weak',
        }],
        forecast: [], seasonalityDetected: false, seasonalPeriod: null,
        trendSlope: 0, trendPctPerPeriod: 0, trendDirection: 'flat',
        narrative: 'flat',
      },
    }));
    assert.ok(!tour.steps.some(s => s.kind === 'change'), 'confidence 0.2 should be suppressed');
  });

  test('carries outlier row indices so the tour can drive cross-filtering', () => {
    const tour = buildInsightTour(baseInput({
      outliers: [
        { id: 4, primaryLabel: 'A', category: 'North', targetValue: 900, zScore: 4,
          iqrDeviation: 3, severityScore: 95, rootCauseInsight: '', isBottleneck: false },
        { id: 9, primaryLabel: 'B', category: 'North', targetValue: 880, zScore: 3.8,
          iqrDeviation: 2.9, severityScore: 88, rootCauseInsight: '', isBottleneck: false },
      ],
    }));
    const step = tour.steps.find(s => s.kind === 'outlier');
    assert.ok(step);
    assert.deepStrictEqual(step!.focusIndices, [4, 9]);
  });

  test('ignores mild outliers', () => {
    const tour = buildInsightTour(baseInput({
      outliers: [{
        id: 1, primaryLabel: 'A', category: 'X', targetValue: 10, zScore: 1,
        iqrDeviation: 0.5, severityScore: 20, rootCauseInsight: '', isBottleneck: false,
      }],
    }));
    assert.ok(!tour.steps.some(s => s.kind === 'outlier'), 'severity 20 is not a finding');
  });

  // -- Rendering ------------------------------------------------------------

  test('renders HTML and escapes untrusted field values', () => {
    const tour = buildInsightTour(baseInput({
      targetKpiName: '<img src=x onerror=alert(1)>',
      cohorts: [
        { cohortName: '</h4><script>bad()</script>', recordCount: 50, pctOfTotal: 50,
          targetMean: 900, targetMedian: 880, outlierRate: 1, performanceGrade: 'A', gapAnalysis: '' },
        { cohortName: 'Normal', recordCount: 50, pctOfTotal: 50, targetMean: 100,
          targetMedian: 90, outlierRate: 1, performanceGrade: 'C', gapAnalysis: '' },
      ],
    }));

    const html = renderTourHtml(tour);
    assert.ok(!html.includes('<script>bad()'), 'script must not survive unescaped');
    assert.ok(!html.includes('<img src=x'), 'img payload must not survive unescaped');
    assert.ok(html.includes('&lt;'), 'escaped entities expected');
    assert.ok(html.includes('insight-tour'), 'wrapper class expected');
  });

  test('executive summary condenses the leading findings', () => {
    const tour = buildInsightTour(baseInput({
      pareto: {
        topPercentile: 20, capturedImpactPercent: 81, inflectionIndex: 10,
        isParetoConfirmed: true, summaryText: '80/20 holds',
      },
    }));
    assert.ok(tour.executiveSummary.length > 10);
    assert.ok(!/^no strong patterns/i.test(tour.executiveSummary));
  });
});
