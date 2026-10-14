/**
 * test/suite/offline/microCharts.test.ts — Unit tests for Offline Micro-Visualization Engine
 */

import * as assert from 'assert';
import { MicroCharts } from '../../../offline/microCharts';
import { DataProfiler } from '../../../offline/dataProfiler';

suite('Offline MicroCharts & In-Grid Micro-Visualizations Suite', () => {
  test('generates KDE distribution sparkline for numerical values', () => {
    const values = [12, 15, 18, 19, 22, 25, 29, 31, 35, 40, 42, 50];
    const svg = MicroCharts.generateNumericSparkline(values, { width: 90, height: 20, type: 'kde' });

    assert.ok(svg.startsWith('<svg width="90" height="20"'));
    assert.ok(svg.includes('<linearGradient'));
    assert.ok(svg.includes('<path d="M '));
    assert.ok(svg.includes('stroke="#38bdf8"'));
  });

  test('generates mini-histogram and linear sparklines', () => {
    const values = [5, 10, 15, 20, 25, 30, 35, 40];
    const barSvg = MicroCharts.generateNumericSparkline(values, { type: 'bars', width: 80, height: 16 });
    assert.ok(barSvg.includes('<rect x="'));

    const lineSvg = MicroCharts.generateNumericSparkline(values, { type: 'line', width: 80, height: 16 });
    assert.ok(lineSvg.includes('<circle cx="'));
  });

  test('handles edge case arrays (empty or single value) gracefully', () => {
    const emptySvg = MicroCharts.generateNumericSparkline([], { width: 80, height: 18 });
    assert.ok(emptySvg.includes('stroke-dasharray="2,2"'));

    const singleSvg = MicroCharts.generateNumericSparkline([42], { width: 80, height: 18 });
    assert.ok(singleSvg.includes('stroke-dasharray="2,2"'));
  });

  test('generates 1D missingness barcode for complete and incomplete data', () => {
    // 100% complete
    const completeMask = [false, false, false, false, false];
    const completeSvg = MicroCharts.generateMissingnessBarcode(completeMask, { width: 70, height: 12 });
    assert.ok(completeSvg.includes('title="Complete: 0% missing"'));

    // Partial nulls
    const partialMask = [false, true, false, true, false, false, true];
    const partialSvg = MicroCharts.generateMissingnessBarcode(partialMask, { width: 70, height: 12 });
    assert.ok(partialSvg.includes('Missing: 3/7 (42.9%)'));
    assert.ok(partialSvg.includes('<rect x="'));
  });

  test('generates categorical diversity stacked bar', () => {
    const categories = [
      { label: 'Electronics', count: 120, percentage: 60.0 },
      { label: 'Clothing', count: 50, percentage: 25.0 },
      { label: 'Groceries', count: 30, percentage: 15.0 },
    ];
    const divSvg = MicroCharts.generateCategoricalDiversityBar(categories, { width: 70, height: 10 });

    assert.ok(divSvg.startsWith('<svg width="70" height="10"'));
    assert.ok(divSvg.includes('Electronics: 60.0%'));
    assert.ok(divSvg.includes('Clothing: 25.0%'));
  });

  test('DataProfiler integrates microCharts into column profiles', () => {
    const csv = `id,amount,status
1,150.50,completed
2,220.00,pending
3,,completed
4,310.20,failed
5,450.00,completed`;

    const profile = DataProfiler.profileText(csv, 'test.csv', csv.length);
    assert.strictEqual(profile.columns.length, 3);

    const amountCol = profile.columns.find(c => c.name === 'amount');
    assert.ok(amountCol);
    assert.ok(amountCol.sparklineSvg, 'Numeric column must have sparklineSvg');
    assert.ok(amountCol.missingnessBarcodeSvg, 'Column with nulls must have missingnessBarcodeSvg');

    const statusCol = profile.columns.find(c => c.name === 'status');
    assert.ok(statusCol);
    assert.ok(statusCol.diversityBarSvg, 'Categorical column must have diversityBarSvg');
  });
});
