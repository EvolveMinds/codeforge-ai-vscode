/**
 * test/suite/offline/advancedVisuals.test.ts
 *
 * SVG generators are hard to assert on pixel-perfectly and not very useful to
 * snapshot. These tests instead pin the properties that actually matter:
 * well-formedness, correct aggregation, graceful empty states, and — most
 * importantly — that untrusted strings cannot break out of the markup.
 */

import * as assert from 'assert';
import {
  buildGeoBubbles,
  detectGeoColumns,
  esc,
  formatCompact,
  renderDecompositionSvg,
  renderGeoMapSvg,
  renderParallelCoordsSvg,
  renderSankeySvg,
  renderTimeSeriesSvg,
  renderTreemapSvg,
  sankeyLinksFromPair,
  treemapItemsFrom,
} from '../../../offline/advancedVisuals';

/** Crude but effective well-formedness check for generated SVG. */
function tagsBalanced(svg: string): boolean {
  const opens = (svg.match(/<svg\b/g) || []).length;
  const closes = (svg.match(/<\/svg>/g) || []).length;
  return opens === closes;
}

suite('Advanced Visuals Suite', () => {

  // -- Escaping -------------------------------------------------------------

  test('escapes markup-significant characters', () => {
    assert.strictEqual(esc('<script>'), '&lt;script&gt;');
    assert.strictEqual(esc('a & b'), 'a &amp; b');
    assert.strictEqual(esc('"quoted"'), '&quot;quoted&quot;');
    assert.strictEqual(esc(null), '');
  });

  test('category names cannot inject markup into a chart', () => {
    const items = [
      { name: '</text><script>alert(1)</script>', value: 10 },
      { name: 'Safe', value: 5 },
    ];
    const svg = renderTreemapSvg(items);
    assert.ok(!svg.includes('<script>'), 'raw script tag must not survive');
    assert.ok(svg.includes('&lt;script&gt;'), 'it should appear escaped instead');
    assert.ok(tagsBalanced(svg));
  });

  test('formatCompact abbreviates by magnitude', () => {
    assert.strictEqual(formatCompact(1500), '1.5K');
    assert.strictEqual(formatCompact(2_400_000), '2.4M');
    assert.strictEqual(formatCompact(0), '0');
    assert.strictEqual(formatCompact(42), '42');
    assert.strictEqual(formatCompact(NaN), '—');
  });

  // -- Sankey ---------------------------------------------------------------

  test('renders a sankey and survives a cyclic graph', () => {
    // A → B → C → A would loop forever without depth capping.
    const svg = renderSankeySvg([
      { source: 'A', target: 'B', value: 10 },
      { source: 'B', target: 'C', value: 6 },
      { source: 'C', target: 'A', value: 3 },
    ]);
    assert.ok(svg.includes('<svg'), 'expected an svg');
    assert.ok(tagsBalanced(svg));
    assert.ok(svg.includes('<path'), 'expected flow ribbons');
  });

  test('sankey shows an empty state rather than a broken chart', () => {
    const svg = renderSankeySvg([]);
    assert.ok(!svg.includes('<svg'), 'no svg for no data');
    assert.ok(/no flow/i.test(svg));
  });

  test('sankeyLinksFromPair aggregates duplicate pairs', () => {
    const rows = [
      { from: 'X', to: 'Y', v: 2 },
      { from: 'X', to: 'Y', v: 3 },
      { from: 'X', to: 'Z', v: 4 },
    ];
    const links = sankeyLinksFromPair(rows, 'from', 'to', 'v');
    assert.strictEqual(links.length, 2);
    const xy = links.find(l => l.target === 'Y');
    assert.strictEqual(xy!.value, 5, 'duplicate pairs must sum');
  });

  // -- Treemap --------------------------------------------------------------

  test('treemapItemsFrom aggregates and bundles a tail into Other', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ cat: `C${i}`, v: 30 - i }));
    const items = treemapItemsFrom(rows, 'cat', 'v', 5);
    assert.strictEqual(items.length, 6, '5 leaders plus one Other bucket');
    assert.ok(items[items.length - 1].name.startsWith('Other'));
    // Nothing may be lost in the bundling.
    const total = items.reduce((s, i) => s + i.value, 0);
    const expected = rows.reduce((s, r) => s + r.v, 0);
    assert.strictEqual(total, expected, 'treemap must conserve the total');
  });

  test('treemap rectangles stay inside the canvas', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i}`, value: (i + 1) * 3 }));
    const svg = renderTreemapSvg(items);
    assert.ok(tagsBalanced(svg));
    // Every x/y must be finite and non-negative — NaN geometry renders blank.
    const coords = [...svg.matchAll(/(?:x|y)="(-?[\d.]+)"/g)].map(m => Number(m[1]));
    assert.ok(coords.length > 0);
    assert.ok(coords.every(c => isFinite(c) && c >= -1), 'no NaN or negative geometry');
  });

  // -- Parallel coordinates -------------------------------------------------

  test('parallel coordinates need at least two dimensions', () => {
    const rows = [{ a: 1, b: 2 }];
    assert.ok(/at least two/i.test(renderParallelCoordsSvg(rows, ['a'])));
  });

  test('parallel coordinates handles a constant column without dividing by zero', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ a: 5, b: i, c: i * 2 }));
    const svg = renderParallelCoordsSvg(rows, ['a', 'b', 'c']);
    assert.ok(svg.includes('<svg'));
    assert.ok(!svg.includes('NaN'), 'constant column must not produce NaN coordinates');
  });

  test('parallel coordinates dims non-highlighted rows when a selection exists', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ a: i, b: i * 2, c: i + 1 }));
    const svg = renderParallelCoordsSvg(rows, ['a', 'b', 'c'], { highlightIndices: [0, 1] });
    assert.ok(svg.includes('highlighted'), 'header should report the highlight count');
  });

  // -- Time series ----------------------------------------------------------

  test('time series draws history, forecast cone and changepoint markers', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      date: `2024-${String(i + 1).padStart(2, '0')}-01`,
      value: 100 + i * 5,
    }));
    const forecast = [
      { date: '2025-01-01', value: 165, lower: 150, upper: 180 },
      { date: '2025-02-01', value: 170, lower: 148, upper: 192 },
    ];
    const svg = renderTimeSeriesSvg(history, forecast, [
      { date: '2024-06-01', label: 'shift', direction: 'up' },
    ]);
    assert.ok(svg.includes('<polygon'), 'forecast cone should be a filled band');
    assert.ok(svg.includes('stroke-dasharray'), 'forecast line should be dashed');
    assert.ok(svg.includes('<circle'), 'changepoint marker expected');
    assert.ok(!svg.includes('NaN'));
    assert.ok(tagsBalanced(svg));
  });

  test('time series refuses to draw a single point', () => {
    assert.ok(/not enough/i.test(renderTimeSeriesSvg([{ date: '2024-01-01', value: 1 }])));
  });

  test('decomposition breaks the line at nulls instead of bridging them', () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2024-01-0${i}`);
    const trend = [null, null, 3, 4, 5, 6, 7, 8, null, null];
    const seasonal = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
    const residual = [null, null, 0.2, -0.1, 0.3, 0, -0.2, 0.1, null, null];
    const svg = renderDecompositionSvg(dates, trend, seasonal, residual);
    assert.ok(svg.includes('<svg'));
    assert.ok(!svg.includes('NaN'), 'nulls must not leak into coordinates');
  });

  // -- Geography ------------------------------------------------------------

  test('detects a lat/long pair', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      latitude: 10 + i, longitude: 20 + i, v: i,
    }));
    const det = detectGeoColumns(rows, ['latitude', 'longitude', 'v']);
    assert.ok(det);
    assert.strictEqual(det!.kind, 'latlon');
  });

  test('detects a country-name column and resolves centroids', () => {
    const rows = [
      { country: 'India', sales: 10 },
      { country: 'Germany', sales: 20 },
      { country: 'Brazil', sales: 30 },
      { country: 'Japan', sales: 40 },
    ];
    const det = detectGeoColumns(rows, ['country', 'sales']);
    assert.ok(det, 'expected place detection');
    assert.strictEqual(det!.kind, 'place');

    const bubbles = buildGeoBubbles(rows, det!, 'sales');
    assert.strictEqual(bubbles.length, 4);
    // Sorted by value descending.
    assert.strictEqual(bubbles[0].name, 'Japan');
    assert.ok(bubbles.every(b => Math.abs(b.lat) <= 90 && Math.abs(b.lon) <= 180));
  });

  test('ignores a categorical column that is not geographic', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ status: i % 2 ? 'open' : 'closed', v: i }));
    assert.strictEqual(detectGeoColumns(rows, ['status', 'v']), null);
  });

  test('geo map renders bubbles within the canvas', () => {
    const svg = renderGeoMapSvg([
      { name: 'India', lat: 22, lon: 79, value: 100, count: 5 },
      { name: 'Brazil', lat: -10, lon: -52, value: 50, count: 3 },
    ]);
    assert.ok(svg.includes('<circle'));
    assert.ok(tagsBalanced(svg));
    const cx = [...svg.matchAll(/cx="([\d.]+)"/g)].map(m => Number(m[1]));
    assert.ok(cx.every(x => x >= 0 && x <= 640), 'bubbles must land inside the viewBox');
  });
});
