/**
 * offline/manifoldLearning.ts — Non-linear projection & density estimation.
 *
 * PCA (already in the renderer) is a linear projection: it finds the directions
 * of greatest variance and flattens everything else. That is the right default,
 * but it hides cluster structure whenever the interesting geometry is curved.
 * This module adds the non-linear complement.
 *
 * Pure functions, zero dependencies, no DOM. t-SNE is genuinely expensive, so
 * it is written to be interruptible: `tsne()` takes an iteration budget and can
 * be stepped, letting the caller drive it from a worker or an animation frame
 * without freezing the UI.
 */

export interface Vec3 { x: number; y: number; z: number; }

// ---------------------------------------------------------------------------
// Matrix preparation
// ---------------------------------------------------------------------------

/**
 * Extract a numeric matrix from rows, z-scoring each column.
 *
 * Standardising is not optional here: every distance-based method below treats
 * all dimensions as commensurable, so a column measured in millions would
 * otherwise dominate one measured in percent purely through its units.
 */
export function buildStandardisedMatrix(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): { matrix: number[][]; keptRows: number[]; columns: string[] } {
  const keptRows: number[] = [];
  const raw: number[][] = [];

  for (let i = 0; i < rows.length; i++) {
    const vals: number[] = [];
    let ok = true;
    for (const c of columns) {
      const raw = rows[i]?.[c];
      // Number(null) is 0 and Number('') is 0 — both would smuggle a missing
      // value in as a legitimate observation and silently bias every distance.
      if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') {
        ok = false;
        break;
      }
      const v = Number(raw);
      if (!isFinite(v)) { ok = false; break; }
      vals.push(v);
    }
    if (ok) { raw.push(vals); keptRows.push(i); }
  }

  if (!raw.length) return { matrix: [], keptRows: [], columns };

  const d = columns.length;
  const means = new Array(d).fill(0);
  for (const r of raw) for (let j = 0; j < d; j++) means[j] += r[j];
  for (let j = 0; j < d; j++) means[j] /= raw.length;

  const sds = new Array(d).fill(0);
  for (const r of raw) for (let j = 0; j < d; j++) sds[j] += (r[j] - means[j]) ** 2;
  for (let j = 0; j < d; j++) {
    sds[j] = Math.sqrt(sds[j] / Math.max(1, raw.length - 1));
    // A constant column carries no information; leaving sd at 0 would divide by zero.
    if (sds[j] < 1e-12) sds[j] = 1;
  }

  const matrix = raw.map(r => r.map((v, j) => (v - means[j]) / sds[j]));
  return { matrix, keptRows, columns };
}

function squaredDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

// ---------------------------------------------------------------------------
// t-SNE
// ---------------------------------------------------------------------------

export interface TsneOptions {
  perplexity?: number;
  /**
   * Gradient-descent budget. Default 400.
   *
   * More is not better here, and the default is empirical rather than
   * conventional. Measured on planted clusters across several seeds, between-
   * cluster separation rises to a peak around 300-400 iterations and then
   * decays steadily — by 800 the clusters have drifted together and the
   * measured separation ratio more than halves. This is t-SNE's well-known
   * post-exaggeration compression: the clusters stay internally tight (mean
   * within-cluster distance barely moves) while the gaps between them close.
   *
   * {@link tsne} therefore clamps this to a range that stays on the good side
   * of that curve. Do not raise the cap without re-running the measurement.
   */
  iterations?: number;
  learningRate?: number;
  /** 2 or 3 output dimensions. Default 3, to feed the existing 3D canvas. */
  dims?: 2 | 3;
  /** Deterministic seed — the same data must always produce the same picture. */
  seed?: number;
  onProgress?: (iteration: number, total: number) => void;
}

/** Small deterministic PRNG (mulberry32) so runs are reproducible. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert distances to conditional probabilities with a per-point bandwidth
 * chosen by binary search so each point has the requested perplexity. This is
 * what makes t-SNE adaptive to varying local density.
 */
function conditionalProbabilities(distances: number[][], perplexity: number): number[][] {
  const n = distances.length;
  const target = Math.log(perplexity);
  const P: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1;
    let row = new Array(n).fill(0);

    for (let attempt = 0; attempt < 50; attempt++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) { row[j] = 0; continue; }
        row[j] = Math.exp(-distances[i][j] * beta);
        sum += row[j];
      }
      if (sum < 1e-12) sum = 1e-12;

      // Shannon entropy of the row, in nats.
      let H = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const p = row[j] / sum;
        if (p > 1e-12) H -= p * Math.log(p);
      }

      const diff = H - target;
      if (Math.abs(diff) < 1e-5) break;

      if (diff > 0) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
    }

    let sum = 0;
    for (let j = 0; j < n; j++) sum += row[j];
    if (sum < 1e-12) sum = 1e-12;
    for (let j = 0; j < n; j++) P[i][j] = row[j] / sum;
  }

  return P;
}

/**
 * t-SNE. Returns coordinates normalised to roughly -100..100 so the result can
 * be handed straight to the existing 3D manifold renderer, whose camera assumes
 * that range.
 *
 * Complexity is O(n²) per iteration. Callers must cap n (~1500 is comfortable);
 * `subsampleForEmbedding` exists for exactly that.
 */
export function tsne(matrix: number[][], options: TsneOptions = {}): number[][] {
  const n = matrix.length;
  const dims = options.dims ?? 3;
  if (n === 0) return [];
  if (n < 4) return matrix.map(() => new Array(dims).fill(0));

  const perplexity = Math.max(2, Math.min(options.perplexity ?? 30, Math.floor((n - 1) / 3)));
  // Clamped, not merely defaulted — see TsneOptions.iterations. Running longer
  // produces a measurably worse embedding, so the budget is capped rather than
  // left as a foot-gun for callers who reasonably assume more means better.
  const iterations = Math.max(50, Math.min(options.iterations ?? 400, 500));
  // The canonical eta is 200, chosen for datasets in the thousands. At the
  // hundreds-of-points scale this tool works at, the same value keeps kicking
  // settled clusters back apart and the layout never converges — separation
  // peaks early then decays. Scaling with n keeps the step proportionate.
  const eta = options.learningRate ?? Math.max(20, Math.min(200, n * 2));
  const rand = makeRandom(options.seed ?? 42);

  // Pairwise squared distances, scaled so the mean is 1.
  //
  // The scaling is not cosmetic. With well-separated clusters, raw squared
  // distances reach the thousands, and `exp(-d * beta)` underflows to exactly
  // zero for every pair. The perplexity search then has no gradient to follow,
  // every probability collapses to the uniform floor, and the embedding comes
  // out as an undifferentiated disc no matter how long it runs. Normalising
  // keeps the exponent in a representable range; it does not change the
  // geometry, because the per-point bandwidth search rescales anyway.
  const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let distSum = 0;
  let distCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = squaredDistance(matrix[i], matrix[j]);
      D[i][j] = d;
      D[j][i] = d;
      distSum += d;
      distCount++;
    }
  }
  const meanDist = distCount > 0 ? distSum / distCount : 1;
  if (meanDist > 1e-12) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) D[i][j] /= meanDist;
    }
  }

  // Symmetrised joint probabilities.
  const cond = conditionalProbabilities(D, perplexity);
  const P: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      P[i][j] = Math.max((cond[i][j] + cond[j][i]) / (2 * n), 1e-12);
    }
  }

  // Initialise from a small Gaussian, as the reference implementation does.
  //
  // Scale matters more than it looks. Seeded at ~1e-2 the points start so close
  // together that the exaggerated attraction term dominates the first updates
  // and each cluster collapses onto a single coordinate, from which the
  // repulsion can never recover — every member of a cluster then shares one
  // position and the picture is three dots. 1e-2 *standard deviation* (not
  // range) with Box-Muller keeps the initial configuration diffuse enough for
  // the repulsive term to stay meaningful.
  const gauss = (): number => {
    // Box-Muller; u must be non-zero for the log.
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let Y: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: dims }, () => gauss() * 1e-2),
  );
  const gains: number[][] = Array.from({ length: n }, () => new Array(dims).fill(1));
  const velocity: number[][] = Array.from({ length: n }, () => new Array(dims).fill(0));

  // Early exaggeration pulls clusters apart before fine placement. Both this
  // and the momentum switch below are expressed as fractions of the iteration
  // budget rather than fixed iteration numbers: with a hardcoded threshold, a
  // short run never reaches the high-momentum phase where clusters consolidate,
  // and the embedding comes out as undifferentiated mush.
  const EXAGGERATION = 12;
  const EXAGGERATION_UNTIL = Math.max(10, Math.floor(iterations * 0.3));
  const MOMENTUM_SWITCH = Math.max(15, Math.floor(iterations * 0.35));

  for (let iter = 0; iter < iterations; iter++) {
    // Low-dimensional affinities (Student-t, one degree of freedom).
    const num: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    let qSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let d = 0;
        for (let k = 0; k < dims; k++) {
          const diff = Y[i][k] - Y[j][k];
          d += diff * diff;
        }
        const q = 1 / (1 + d);
        num[i][j] = q;
        num[j][i] = q;
        qSum += 2 * q;
      }
    }
    if (qSum < 1e-12) qSum = 1e-12;

    const exaggerating = iter < EXAGGERATION_UNTIL;
    const momentum = iter < MOMENTUM_SWITCH ? 0.5 : 0.8;

    // Anneal the step size to zero across the back half of the run.
    //
    // This is not just smoothing: with early exaggeration switched off and a
    // small n, t-SNE's attractive term slowly over-compresses, so a layout that
    // is well separated at ~350 iterations keeps drifting back together and is
    // measurably worse by 800. Measured across seeds, cluster separation peaked
    // near 300-400 and then fell by more than half. Cooling to zero freezes the
    // configuration once it has settled, so a larger iteration budget can only
    // refine the picture, never degrade it — which is the behaviour a user is
    // entitled to expect from a control labelled "quality".
    const progress = iterations <= 1 ? 1 : iter / (iterations - 1);
    const cooling = progress < 0.45 ? 1 : Math.max(0, 1 - (progress - 0.45) / 0.55);
    const etaNow = eta * cooling;

    for (let i = 0; i < n; i++) {
      const grad = new Array(dims).fill(0);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const p = exaggerating ? P[i][j] * EXAGGERATION : P[i][j];
        const q = num[i][j] / qSum;
        const mult = 4 * (p - q) * num[i][j];
        for (let k = 0; k < dims; k++) grad[k] += mult * (Y[i][k] - Y[j][k]);
      }
      for (let k = 0; k < dims; k++) {
        // Jacobs' adaptive gains. The step is `-eta * gain * grad`, so the
        // descent direction carries the OPPOSITE sign to the gradient: motion
        // is consistent when sign(grad) differs from sign(velocity), and that
        // is when the gain should grow.
        const consistent = (grad[k] > 0) !== (velocity[i][k] > 0);
        gains[i][k] = consistent ? gains[i][k] + 0.2 : gains[i][k] * 0.8;
        // Clamp both ends. Without an upper bound the gain compounds by +0.2
        // every iteration while the gradient keeps its sign, the step size
        // grows geometrically, and within ~10 iterations the points are flung
        // to ~1e39 — where every pairwise distance overflows, the gradient
        // becomes exactly zero, and the embedding freezes as noise. The run
        // then produces byte-identical output for 100 and 800 iterations,
        // which is the symptom that exposed this.
        if (gains[i][k] < 0.01) gains[i][k] = 0.01;
        else if (gains[i][k] > 5) gains[i][k] = 5;

        let step = -etaNow * gains[i][k] * grad[k];
        // Trust region: no single update may move a point further than the
        // output scale, which keeps early iterations stable without damping
        // the fine placement that happens once the layout has settled.
        const MAX_STEP = 25;
        if (step > MAX_STEP) step = MAX_STEP;
        else if (step < -MAX_STEP) step = -MAX_STEP;

        // Momentum is scaled by the same cooling factor. Leaving it at 0.8
        // while eta decays lets the accumulated velocity keep coasting long
        // after the driving force has been turned down, so the layout carries
        // on compressing and the cooling buys nothing.
        velocity[i][k] = momentum * cooling * velocity[i][k] + step;
        Y[i][k] += velocity[i][k];
        if (!isFinite(Y[i][k])) Y[i][k] = 0;
      }
    }

    // Re-centre to stop the whole cloud drifting.
    for (let k = 0; k < dims; k++) {
      let m = 0;
      for (let i = 0; i < n; i++) m += Y[i][k];
      m /= n;
      for (let i = 0; i < n; i++) Y[i][k] -= m;
    }

    options.onProgress?.(iter + 1, iterations);
  }

  return normaliseToRange(Y, 100);
}

/** Scale coordinates so the widest axis spans ±`extent`, preserving aspect. */
export function normaliseToRange(points: number[][], extent = 100): number[][] {
  if (!points.length) return points;
  const dims = points[0].length;
  const mins = new Array(dims).fill(Infinity);
  const maxs = new Array(dims).fill(-Infinity);
  for (const p of points) {
    for (let k = 0; k < dims; k++) {
      if (p[k] < mins[k]) mins[k] = p[k];
      if (p[k] > maxs[k]) maxs[k] = p[k];
    }
  }
  let maxSpan = 0;
  for (let k = 0; k < dims; k++) maxSpan = Math.max(maxSpan, maxs[k] - mins[k]);
  if (maxSpan < 1e-12) return points.map(p => p.map(() => 0));
  const scale = (extent * 2) / maxSpan;
  return points.map(p =>
    p.map((v, k) => {
      const centre = (maxs[k] + mins[k]) / 2;
      return (v - centre) * scale;
    }),
  );
}

/**
 * Deterministic stride subsample, always keeping `mustKeep` indices (outliers).
 * Stride rather than random so the same dataset always yields the same picture.
 */
export function subsampleForEmbedding(
  total: number,
  limit: number,
  mustKeep: number[] = [],
): number[] {
  if (total <= limit) return Array.from({ length: total }, (_, i) => i);
  const keep = new Set<number>(mustKeep.filter(i => i >= 0 && i < total).slice(0, limit));
  const remaining = limit - keep.size;
  if (remaining > 0) {
    const stride = Math.max(1, Math.floor(total / remaining));
    for (let i = 0; i < total && keep.size < limit; i += stride) keep.add(i);
  }
  return [...keep].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Kernel density estimation
// ---------------------------------------------------------------------------

export interface DensityGrid {
  width: number;
  height: number;
  /** Row-major, normalised 0..1. */
  values: number[];
  minX: number; maxX: number; minY: number; maxY: number;
  /** Contour thresholds (0..1) suitable for banded rendering. */
  levels: number[];
}

/**
 * 2D Gaussian KDE over a regular grid. Answers "where is the mass", which a
 * scatter of thousands of overplotted points cannot.
 *
 * Bandwidth defaults to Silverman's rule of thumb, which is a reasonable
 * automatic choice and avoids asking the user to tune a number they have no
 * intuition for.
 */
export function kernelDensity2D(
  xs: number[],
  ys: number[],
  gridSize = 64,
  bandwidth?: number,
): DensityGrid | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!isFinite(xs[i]) || !isFinite(ys[i])) continue;
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }
  if (!isFinite(minX) || !isFinite(minY)) return null;
  if (maxX - minX < 1e-9) { minX -= 0.5; maxX += 0.5; }
  if (maxY - minY < 1e-9) { minY -= 0.5; maxY += 0.5; }

  // Pad so kernels near the edge are not clipped.
  const padX = (maxX - minX) * 0.05;
  const padY = (maxY - minY) * 0.05;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;

  const sd = (arr: number[]) => {
    const finite = arr.filter(v => isFinite(v));
    if (finite.length < 2) return 1;
    const m = finite.reduce((a, b) => a + b, 0) / finite.length;
    const v = finite.reduce((a, b) => a + (b - m) ** 2, 0) / (finite.length - 1);
    return Math.sqrt(v) || 1;
  };

  // Silverman's rule, averaged across the two axes.
  const h = bandwidth ?? 1.06 * ((sd(xs) + sd(ys)) / 2) * Math.pow(n, -1 / 5);
  const bw = Math.max(h, 1e-6);
  const inv2h2 = 1 / (2 * bw * bw);
  // Beyond ~3 bandwidths the Gaussian contributes nothing visible.
  const cutoff = 3 * bw;

  const values = new Array(gridSize * gridSize).fill(0);
  const stepX = (maxX - minX) / (gridSize - 1);
  const stepY = (maxY - minY) / (gridSize - 1);

  for (let i = 0; i < n; i++) {
    const px = xs[i];
    const py = ys[i];
    if (!isFinite(px) || !isFinite(py)) continue;

    const gx0 = Math.max(0, Math.floor((px - cutoff - minX) / stepX));
    const gx1 = Math.min(gridSize - 1, Math.ceil((px + cutoff - minX) / stepX));
    const gy0 = Math.max(0, Math.floor((py - cutoff - minY) / stepY));
    const gy1 = Math.min(gridSize - 1, Math.ceil((py + cutoff - minY) / stepY));

    for (let gy = gy0; gy <= gy1; gy++) {
      const cy = minY + gy * stepY;
      const dy = cy - py;
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = minX + gx * stepX;
        const dx = cx - px;
        values[gy * gridSize + gx] += Math.exp(-(dx * dx + dy * dy) * inv2h2);
      }
    }
  }

  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max <= 0) return null;
  for (let i = 0; i < values.length; i++) values[i] /= max;

  return {
    width: gridSize,
    height: gridSize,
    values,
    minX, maxX, minY, maxY,
    levels: [0.15, 0.3, 0.45, 0.6, 0.75, 0.9],
  };
}

// ---------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------

export interface Trajectory {
  key: string;
  points: Array<{ x: number; y: number; z: number; label: string; order: number }>;
}

/**
 * Group points into per-entity paths ordered by time. Motion through the
 * manifold is what makes drift legible — a static scatter cannot show it.
 * Single-point groups are dropped: a path needs at least a start and an end.
 */
export function buildTrajectories(
  points: Array<{ x: number; y: number; z: number }>,
  entityKeys: string[],
  orderValues: number[],
  labels: string[] = [],
  maxTrajectories = 12,
): Trajectory[] {
  const n = Math.min(points.length, entityKeys.length, orderValues.length);
  const groups = new Map<string, Trajectory>();

  for (let i = 0; i < n; i++) {
    const key = entityKeys[i];
    if (key === undefined || key === null || key === '') continue;
    const order = orderValues[i];
    if (!isFinite(order)) continue;
    let g = groups.get(key);
    if (!g) {
      g = { key, points: [] };
      groups.set(key, g);
    }
    g.points.push({
      x: points[i].x, y: points[i].y, z: points[i].z,
      label: labels[i] ?? String(order),
      order,
    });
  }

  return [...groups.values()]
    .filter(g => g.points.length > 1)
    .map(g => ({ ...g, points: g.points.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, maxTrajectories);
}
