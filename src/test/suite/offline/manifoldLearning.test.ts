/**
 * test/suite/offline/manifoldLearning.test.ts
 *
 * t-SNE has no single "correct" output, so asserting exact coordinates would be
 * meaningless. These tests pin the properties that make it trustworthy instead:
 * determinism (same input → same picture), bounded output, and — the one that
 * actually proves it works — that three well-separated input clusters remain
 * separated in the embedding.
 */

import * as assert from 'assert';
import {
  buildStandardisedMatrix,
  buildTrajectories,
  kernelDensity2D,
  normaliseToRange,
  subsampleForEmbedding,
  tsne,
} from '../../../offline/manifoldLearning';

/** Deterministic pseudo-random in [0,1) so fixtures never flake. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

suite('Manifold Learning Suite', () => {

  // -- Standardisation ------------------------------------------------------

  test('z-scores each column to zero mean and unit variance', () => {
    const rows = [
      { a: 10, b: 1000 },
      { a: 20, b: 2000 },
      { a: 30, b: 3000 },
      { a: 40, b: 4000 },
    ];
    const { matrix, keptRows } = buildStandardisedMatrix(rows, ['a', 'b']);
    assert.strictEqual(keptRows.length, 4);

    for (let col = 0; col < 2; col++) {
      const vals = matrix.map(r => r[col]);
      const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
      assert.ok(Math.abs(mean) < 1e-9, `column ${col} mean should be ~0, got ${mean}`);
    }
    // Both columns must end up on the same scale despite a 100x unit difference.
    assert.ok(Math.abs(matrix[0][0] - matrix[0][1]) < 1e-9,
      'columns with identical shape must standardise identically');
  });

  test('drops rows with non-numeric values rather than coercing them', () => {
    const rows = [
      { a: 1, b: 2 },
      { a: 'nope', b: 3 },
      { a: 3, b: 4 },
      { a: 4, b: null },
    ];
    const { matrix, keptRows } = buildStandardisedMatrix(rows as never, ['a', 'b']);
    assert.strictEqual(matrix.length, 2);
    assert.deepStrictEqual(keptRows, [0, 2]);
  });

  test('a constant column does not produce NaN', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: 7, b: i }));
    const { matrix } = buildStandardisedMatrix(rows, ['a', 'b']);
    assert.ok(matrix.every(r => r.every(v => isFinite(v))), 'zero-variance column must be handled');
  });

  // -- t-SNE ----------------------------------------------------------------

  test('is deterministic for a given seed', () => {
    const rnd = prng(7);
    const matrix = Array.from({ length: 30 }, () => [rnd(), rnd(), rnd()]);
    const a = tsne(matrix, { iterations: 40, seed: 123, dims: 2 });
    const b = tsne(matrix, { iterations: 40, seed: 123, dims: 2 });
    assert.deepStrictEqual(a, b, 'same seed must reproduce the same embedding');
  });

  test('output is bounded and finite', () => {
    const rnd = prng(11);
    const matrix = Array.from({ length: 40 }, () => [rnd(), rnd(), rnd(), rnd()]);
    const out = tsne(matrix, { iterations: 50, seed: 1, dims: 3 });
    assert.strictEqual(out.length, 40);
    for (const p of out) {
      assert.strictEqual(p.length, 3);
      for (const v of p) {
        assert.ok(isFinite(v), 'coordinates must be finite');
        assert.ok(Math.abs(v) <= 101, `expected |v| <= 100, got ${v}`);
      }
    }
  });

  test('keeps well-separated clusters apart in the embedding', () => {
    // Three tight clusters, far apart in 4D.
    const rnd = prng(5);
    const centres = [[0, 0, 0, 0], [50, 50, 50, 50], [-50, -50, 50, -50]];
    const matrix: number[][] = [];
    const truth: number[] = [];
    for (let c = 0; c < centres.length; c++) {
      for (let i = 0; i < 15; i++) {
        matrix.push(centres[c].map(v => v + (rnd() - 0.5) * 2));
        truth.push(c);
      }
    }

    const out = tsne(matrix, { iterations: 250, seed: 42, dims: 2, perplexity: 8 });

    // Mean within-cluster distance must be clearly below between-cluster distance.
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let within = 0, withinN = 0, between = 0, betweenN = 0;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = dist(out[i], out[j]);
        if (truth[i] === truth[j]) { within += d; withinN++; }
        else { between += d; betweenN++; }
      }
    }
    const meanWithin = within / withinN;
    const meanBetween = between / betweenN;
    assert.ok(meanBetween > meanWithin * 1.5,
      `clusters should stay separated: within=${meanWithin.toFixed(1)} between=${meanBetween.toFixed(1)}`);
  });

  test('a larger iteration budget never degrades the embedding', () => {
    // Regression guard. t-SNE over-compresses once early exaggeration ends:
    // separation peaked near 400 iterations and then more than halved by 800,
    // so raising "quality" made the picture worse. tsne() now clamps the
    // budget; this test fails if that clamp is ever removed.
    const rnd = prng(5);
    const centres = [[0, 0, 0, 0], [50, 50, 50, 50], [-50, -50, 50, -50]];
    const matrix: number[][] = [];
    const truth: number[] = [];
    for (let c = 0; c < centres.length; c++) {
      for (let i = 0; i < 15; i++) {
        matrix.push(centres[c].map(v => v + (rnd() - 0.5) * 2));
        truth.push(c);
      }
    }

    const separation = (out: number[][]): number => {
      const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      let w = 0, wn = 0, b = 0, bn = 0;
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const d = dist(out[i], out[j]);
          if (truth[i] === truth[j]) { w += d; wn++; } else { b += d; bn++; }
        }
      }
      return (b / bn) / (w / wn);
    };

    const at400 = separation(tsne(matrix, { iterations: 400, seed: 42, dims: 2, perplexity: 8 }));
    const at2000 = separation(tsne(matrix, { iterations: 2000, seed: 42, dims: 2, perplexity: 8 }));

    assert.ok(at2000 > 1.5, `a huge budget must still separate clusters, got ${at2000.toFixed(2)}`);
    assert.ok(at2000 >= at400 * 0.6,
      `budget 2000 (${at2000.toFixed(2)}) must not collapse vs 400 (${at400.toFixed(2)})`);
  });

  test('degenerate inputs return safely', () => {
    assert.deepStrictEqual(tsne([], { dims: 2 }), []);
    const tiny = tsne([[1, 2], [3, 4]], { dims: 2 });
    assert.strictEqual(tiny.length, 2);
    assert.ok(tiny.every(p => p.every(v => isFinite(v))));
  });

  test('normaliseToRange centres and scales without distorting aspect', () => {
    const pts = [[0, 0], [10, 5], [20, 10]];
    const out = normaliseToRange(pts, 100);
    const xs = out.map(p => p[0]);
    // Widest axis spans the full +/-extent.
    assert.ok(Math.abs(Math.min(...xs) + 100) < 1e-6);
    assert.ok(Math.abs(Math.max(...xs) - 100) < 1e-6);
    // The narrower axis must be scaled by the same factor, not stretched.
    const ys = out.map(p => p[1]);
    assert.ok(Math.abs((Math.max(...ys) - Math.min(...ys)) - 100) < 1e-6,
      'y spanned half of x originally, so it must span half the range after');
  });

  // -- Subsampling ----------------------------------------------------------

  test('subsample keeps mandatory indices and respects the limit', () => {
    const idx = subsampleForEmbedding(1000, 50, [3, 7, 999]);
    assert.ok(idx.length <= 50);
    for (const must of [3, 7, 999]) {
      assert.ok(idx.includes(must), `outlier ${must} must survive subsampling`);
    }
    // Sorted ascending, no duplicates.
    assert.deepStrictEqual(idx, [...new Set(idx)].sort((a, b) => a - b));
  });

  test('subsample returns everything when under the limit', () => {
    assert.deepStrictEqual(subsampleForEmbedding(5, 100), [0, 1, 2, 3, 4]);
  });

  // -- Density --------------------------------------------------------------

  test('density peaks where the points are', () => {
    // Dense blob at (0,0), sparse tail far away.
    const xs = [...Array.from({ length: 60 }, () => 0), 40, 41];
    const ys = [...Array.from({ length: 60 }, () => 0), 40, 41];
    const grid = kernelDensity2D(xs, ys, 32);
    assert.ok(grid, 'expected a grid');

    // Find the argmax cell and confirm it maps near (0,0).
    let maxI = 0;
    for (let i = 1; i < grid!.values.length; i++) {
      if (grid!.values[i] > grid!.values[maxI]) maxI = i;
    }
    const gx = maxI % grid!.width;
    const gy = Math.floor(maxI / grid!.width);
    const cellX = grid!.minX + (gx / (grid!.width - 1)) * (grid!.maxX - grid!.minX);
    const cellY = grid!.minY + (gy / (grid!.height - 1)) * (grid!.maxY - grid!.minY);
    assert.ok(Math.abs(cellX) < 8 && Math.abs(cellY) < 8,
      `density peak at (${cellX.toFixed(1)}, ${cellY.toFixed(1)}) should sit near the blob`);
  });

  test('density is normalised to 0..1', () => {
    const rnd = prng(3);
    const xs = Array.from({ length: 50 }, () => rnd() * 10);
    const ys = Array.from({ length: 50 }, () => rnd() * 10);
    const grid = kernelDensity2D(xs, ys, 24);
    assert.ok(grid);
    assert.ok(grid!.values.every(v => v >= 0 && v <= 1));
    assert.ok(Math.max(...grid!.values) > 0.99, 'peak should reach 1 after normalisation');
  });

  test('density declines too few points rather than guessing', () => {
    assert.strictEqual(kernelDensity2D([1], [1]), null);
  });

  // -- Trajectories ---------------------------------------------------------

  test('groups points into per-entity paths ordered by time', () => {
    const points = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 },
      { x: 5, y: 5, z: 5 }, { x: 6, y: 6, z: 6 },
    ];
    const keys = ['A', 'A', 'A', 'B', 'B'];
    // Deliberately out of order to prove sorting happens.
    const order = [3, 1, 2, 2, 1];

    const trajectories = buildTrajectories(points, keys, order);
    assert.strictEqual(trajectories.length, 2);

    const a = trajectories.find(t => t.key === 'A')!;
    assert.deepStrictEqual(a.points.map(p => p.order), [1, 2, 3], 'path must be time-ordered');
  });

  test('drops single-point groups, which are not paths', () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }];
    const trajectories = buildTrajectories(points, ['A', 'B'], [1, 1]);
    assert.strictEqual(trajectories.length, 0);
  });
});
