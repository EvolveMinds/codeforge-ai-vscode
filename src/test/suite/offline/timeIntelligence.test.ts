/**
 * test/suite/offline/timeIntelligence.test.ts
 *
 * These tests use synthetic series with known ground truth — a planted
 * changepoint at a known index, a planted seasonal period, a known linear
 * trend — so a regression in the maths fails loudly rather than producing a
 * plausible-looking wrong answer.
 */

import * as assert from 'assert';
import {
  analyzeTimeSeries,
  bucketStart,
  buildSeries,
  detectChangepoints,
  detectDateColumn,
  detectSeasonality,
  decompose,
  forecastSeries,
  inferGrain,
  parseDateValue,
  toIsoDate,
} from '../../../offline/timeIntelligence';

suite('Time Intelligence Suite', () => {

  // -- Date parsing ---------------------------------------------------------

  test('parses ISO, slash, epoch and month-name date forms', () => {
    assert.strictEqual(toIsoDate(parseDateValue('2024-03-14')!), '2024-03-14');
    assert.strictEqual(toIsoDate(parseDateValue('2024/03/14')!), '2024-03-14');
    assert.strictEqual(toIsoDate(parseDateValue('2024-03-14T09:30:00Z')!), '2024-03-14');
    assert.strictEqual(toIsoDate(parseDateValue('14 Mar 2024')!), '2024-03-14');
    assert.strictEqual(toIsoDate(parseDateValue(1710374400000)!), '2024-03-14');
    assert.strictEqual(toIsoDate(parseDateValue(1710374400)!), '2024-03-14');
  });

  test('respects day-first vs month-first disambiguation', () => {
    // Same string, different column-level convention → different dates.
    assert.strictEqual(toIsoDate(parseDateValue('03/04/2024', false)!), '2024-03-04');
    assert.strictEqual(toIsoDate(parseDateValue('03/04/2024', true)!), '2024-04-03');
  });

  test('rejects non-dates and impossible calendar dates', () => {
    assert.strictEqual(parseDateValue('hello'), null);
    assert.strictEqual(parseDateValue(''), null);
    assert.strictEqual(parseDateValue(null), null);
    // 31 February must not silently roll into March.
    assert.strictEqual(parseDateValue('2024-02-31'), null);
    assert.strictEqual(parseDateValue('2024-13-01'), null);
  });

  test('detects the date column by evidence, not by name alone', () => {
    const rows = [
      { label: 'date', when: '2024-01-01', qty: 5 },
      { label: 'date', when: '2024-01-02', qty: 6 },
      { label: 'date', when: '2024-01-03', qty: 7 },
      { label: 'date', when: '2024-01-04', qty: 8 },
    ];
    // `label` is literally the word "date" but holds no parseable dates.
    const found = detectDateColumn(rows, ['label', 'when', 'qty']);
    assert.ok(found, 'expected a date column to be detected');
    assert.strictEqual(found!.column, 'when');
  });

  test('does not mistake an integer id column for dates', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: 1700000000 + i, v: i }));
    const found = detectDateColumn(rows, ['id', 'v']);
    // `id` has no temporal name, so epoch-looking integers must not qualify.
    assert.strictEqual(found, null);
  });

  test('infers day-first from evidence across the column', () => {
    const rows = [
      { d: '25/03/2024' }, // 25 proves day-first
      { d: '04/03/2024' },
      { d: '17/03/2024' },
      { d: '02/04/2024' },
    ];
    const found = detectDateColumn(rows, ['d']);
    assert.ok(found);
    assert.strictEqual(found!.dayFirst, true);
  });

  // -- Grain & bucketing ----------------------------------------------------

  test('infers grain from median spacing', () => {
    const daily = [0, 1, 2, 3, 4].map(i => Date.UTC(2024, 0, 1 + i));
    assert.strictEqual(inferGrain(daily), 'day');

    const monthly = [0, 1, 2, 3, 4].map(i => Date.UTC(2024, i, 1));
    assert.strictEqual(inferGrain(monthly), 'month');

    const yearly = [0, 1, 2, 3].map(i => Date.UTC(2020 + i, 0, 1));
    assert.strictEqual(inferGrain(yearly), 'year');
  });

  test('bucketStart snaps to period boundaries', () => {
    const mid = Date.UTC(2024, 4, 17); // 17 May 2024
    assert.strictEqual(toIsoDate(bucketStart(mid, 'month')), '2024-05-01');
    assert.strictEqual(toIsoDate(bucketStart(mid, 'quarter')), '2024-04-01');
    assert.strictEqual(toIsoDate(bucketStart(mid, 'year')), '2024-01-01');
  });

  test('buildSeries aggregates and fills gaps between observations', () => {
    const rows = [
      { d: '2024-01-01', v: 5 },
      { d: '2024-01-01', v: 5 },  // same bucket → summed
      { d: '2024-01-03', v: 7 },  // 2 Jan missing → filled with 0
    ];
    const series = buildSeries(rows, 'd', 'v', 'day', false, 'sum');
    assert.strictEqual(series.length, 3);
    assert.strictEqual(series[0].value, 10);
    assert.strictEqual(series[1].value, 0, 'gap bucket should be zero-filled');
    assert.strictEqual(series[2].value, 7);
  });

  // -- Seasonality & decomposition -----------------------------------------

  test('recovers a planted seasonal period', () => {
    // Monthly data with a clean 12-month cycle.
    const values = Array.from({ length: 48 }, (_, i) => 100 + 20 * Math.sin((2 * Math.PI * i) / 12));
    assert.strictEqual(detectSeasonality(values, 'month'), 12);
  });

  test('reports no seasonality for a pure trend', () => {
    const values = Array.from({ length: 40 }, (_, i) => 10 + i * 2);
    assert.strictEqual(detectSeasonality(values, 'month'), null);
  });

  test('decomposition seasonal component is mean-centred', () => {
    const values = Array.from({ length: 36 }, (_, i) => 100 + 15 * Math.sin((2 * Math.PI * i) / 12));
    const d = decompose(values, 12);
    const seasonalMean = d.seasonal.reduce((a, b) => a + b, 0) / d.seasonal.length;
    // Centring matters: a non-zero mean would shift the level and corrupt trend.
    assert.ok(Math.abs(seasonalMean) < 1e-6, `seasonal mean ${seasonalMean} should be ~0`);
    assert.strictEqual(d.trend.length, values.length);
    assert.strictEqual(d.residual.length, values.length);
  });

  test('decomposition leaves nulls where the window does not fit', () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    const d = decompose(values, null);
    assert.strictEqual(d.trend[0], null, 'first point cannot have a centred average');
    assert.strictEqual(d.trend[values.length - 1], null, 'last point cannot either');
    assert.ok(d.trend.some(v => v !== null), 'interior points must be populated');
  });

  // -- Changepoints ---------------------------------------------------------

  test('detects a planted level shift at the right index', () => {
    // 20 points at ~100, then 20 at ~160. The break is at index 20.
    const series = Array.from({ length: 40 }, (_, i) => ({
      t: Date.UTC(2024, 0, 1 + i),
      date: toIsoDate(Date.UTC(2024, 0, 1 + i)),
      value: i < 20 ? 100 + (i % 3) : 160 + (i % 3),
      count: 1,
    }));

    const cps = detectChangepoints(series);
    assert.ok(cps.length >= 1, 'expected at least one changepoint');
    const top = cps[0];
    assert.ok(Math.abs(top.index - 20) <= 1, `changepoint at ${top.index}, expected ~20`);
    assert.strictEqual(top.direction, 'up');
    assert.ok(top.magnitudePct > 40, `expected a large jump, got ${top.magnitudePct}%`);
    assert.ok(top.narrative.includes(top.date));
  });

  test('does not invent changepoints in stationary noise', () => {
    // Deterministic pseudo-noise around a constant level.
    const series = Array.from({ length: 40 }, (_, i) => ({
      t: Date.UTC(2024, 0, 1 + i),
      date: toIsoDate(Date.UTC(2024, 0, 1 + i)),
      value: 100 + Math.sin(i * 1.7) * 2,
      count: 1,
    }));
    const cps = detectChangepoints(series);
    assert.strictEqual(cps.length, 0, 'flat noisy series should yield no changepoints');
  });

  // -- Forecast -------------------------------------------------------------

  test('forecast continues a linear trend and widens its interval', () => {
    const series = Array.from({ length: 24 }, (_, i) => ({
      t: Date.UTC(2024, 0, 1 + i),
      date: toIsoDate(Date.UTC(2024, 0, 1 + i)),
      value: 10 + i * 3,
      count: 1,
    }));

    const fc = forecastSeries(series, 'day', 6, null);
    assert.strictEqual(fc.length, 6);
    // Should keep rising, roughly following slope 3.
    assert.ok(fc[0].value > 70, `expected continuation above 70, got ${fc[0].value}`);
    assert.ok(fc[5].value > fc[0].value, 'forecast should keep rising');
    // Uncertainty must grow with horizon.
    const w0 = fc[0].upper - fc[0].lower;
    const w5 = fc[5].upper - fc[5].lower;
    assert.ok(w5 > w0, `interval should widen: ${w0} → ${w5}`);
    // Bounds must bracket the projection.
    for (const p of fc) {
      assert.ok(p.lower <= p.value && p.value <= p.upper, 'value must sit inside its interval');
    }
  });

  test('forecast dates advance by the requested grain', () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      t: Date.UTC(2024, i, 1),
      date: toIsoDate(Date.UTC(2024, i, 1)),
      value: 50 + i,
      count: 1,
    }));
    const fc = forecastSeries(series, 'month', 3, null);
    assert.deepStrictEqual(fc.map(f => f.date), ['2025-01-01', '2025-02-01', '2025-03-01']);
  });

  // -- End-to-end -----------------------------------------------------------

  test('analyzeTimeSeries returns a coherent whole', () => {
    const rows = Array.from({ length: 36 }, (_, i) => ({
      order_date: toIsoDate(Date.UTC(2022, i, 1)),
      revenue: 1000 + i * 25 + (i >= 18 ? 500 : 0),
      region: i % 2 === 0 ? 'North' : 'South',
    }));

    const res = analyzeTimeSeries(rows, ['order_date', 'revenue', 'region'], 'revenue');
    assert.ok(res, 'expected an analysis');
    assert.strictEqual(res!.dateColumn, 'order_date');
    assert.strictEqual(res!.grain, 'month');
    assert.strictEqual(res!.series.length, 36);
    assert.strictEqual(res!.trendDirection, 'rising');
    assert.ok(res!.forecast.length === 12);
    assert.ok(res!.changepoints.length >= 1, 'planted step at month 18 should be found');
    assert.ok(res!.narrative.length > 20);
  });

  test('returns null rather than a fake result when there is no date column', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ a: i, b: i * 2 }));
    assert.strictEqual(analyzeTimeSeries(rows, ['a', 'b'], 'b'), null);
  });

  test('returns null for too few rows', () => {
    const rows = [{ d: '2024-01-01', v: 1 }, { d: '2024-01-02', v: 2 }];
    assert.strictEqual(analyzeTimeSeries(rows, ['d', 'v'], 'v'), null);
  });
});
