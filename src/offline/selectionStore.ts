/**
 * offline/selectionStore.ts — Shared selection state for linked brushing.
 *
 * Before this, every visual in the Studio was an island: selecting an outlier in
 * the 3D manifold told the waterfall, Pareto and cohort panels nothing. This is
 * the one piece of shared state that turns a set of charts into an instrument —
 * lasso a cluster, and every other panel re-explains itself around that subset.
 *
 * Deliberately framework-free and DOM-free so it can be unit-tested and reused
 * from the Electron renderer, a VS Code webview, or a headless report build.
 *
 * Design rules that matter:
 *  - Selection is a set of ROW INDICES into the canonical row array. Indices,
 *    not copies, so every view agrees on identity and nothing goes stale.
 *  - Notification is debounced and coalesced. Brushing fires continuously; the
 *    expensive recompute downstream must not.
 *  - An empty selection means "no filter", never "zero rows". Callers that need
 *    to distinguish should read `isActive`.
 */

export type SelectionSource = 'manifold' | 'cosmos' | 'chart' | 'table' | 'parcoords' | 'external';

export interface SelectionState {
  /** Row indices currently selected. Empty = no filter applied. */
  indices: number[];
  /** Which view created this selection. */
  source: SelectionSource;
  /** Human-readable description, e.g. "lasso · 42 points". */
  description: string;
  /** Total rows in the population, for "N of M" display. */
  total: number;
  /** False when nothing is selected (i.e. full population). */
  isActive: boolean;
}

export type SelectionListener = (state: SelectionState) => void;

/**
 * Below this many rows, derived statistics (correlation, regression, cohort
 * gaps) stop being trustworthy. Views should show a caution instead of numbers.
 */
export const MIN_RELIABLE_SELECTION = 12;

export interface SelectionStoreOptions {
  /** Coalescing window in ms. Default 150. */
  debounceMs?: number;
  /** Injectable timer, for tests. */
  scheduler?: (fn: () => void, ms: number) => unknown;
  cancelScheduler?: (handle: unknown) => void;
}

export class SelectionStore {
  private selected = new Set<number>();
  private source: SelectionSource = 'external';
  private description = '';
  private total = 0;
  private listeners = new Set<SelectionListener>();
  private pending: unknown = null;

  private readonly debounceMs: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(options: SelectionStoreOptions = {}) {
    this.debounceMs = options.debounceMs ?? 150;
    this.schedule = options.scheduler ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancelScheduler ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Tell the store how large the population is. Clears any stale selection. */
  setTotal(total: number): void {
    if (total === this.total) return;
    this.total = Math.max(0, total);
    if (this.selected.size) {
      this.selected.clear();
      this.description = '';
      this.emit();
    }
  }

  getTotal(): number {
    return this.total;
  }

  /** Replace the selection wholesale. */
  set(indices: Iterable<number>, source: SelectionSource, description = ''): void {
    const next = new Set<number>();
    for (const i of indices) {
      if (Number.isInteger(i) && i >= 0 && (this.total === 0 || i < this.total)) next.add(i);
    }
    if (setsEqual(next, this.selected)) {
      // Source/description may still have changed; keep the newest.
      this.source = source;
      this.description = description || this.description;
      return;
    }
    this.selected = next;
    this.source = source;
    this.description = description || `${next.size} selected`;
    this.emit();
  }

  /** Add to the selection (shift-drag semantics). */
  add(indices: Iterable<number>, source: SelectionSource, description = ''): void {
    const before = this.selected.size;
    for (const i of indices) {
      if (Number.isInteger(i) && i >= 0 && (this.total === 0 || i < this.total)) this.selected.add(i);
    }
    if (this.selected.size === before) return;
    this.source = source;
    this.description = description || `${this.selected.size} selected`;
    this.emit();
  }

  /** Remove from the selection (alt-drag semantics). */
  remove(indices: Iterable<number>, source: SelectionSource): void {
    const before = this.selected.size;
    for (const i of indices) this.selected.delete(i);
    if (this.selected.size === before) return;
    this.source = source;
    this.description = `${this.selected.size} selected`;
    this.emit();
  }

  /** Toggle one row — click behaviour. */
  toggle(index: number, source: SelectionSource): void {
    if (!Number.isInteger(index) || index < 0) return;
    if (this.selected.has(index)) this.selected.delete(index);
    else this.selected.add(index);
    this.source = source;
    this.description = `${this.selected.size} selected`;
    this.emit();
  }

  clear(source: SelectionSource = 'external'): void {
    if (!this.selected.size) return;
    this.selected.clear();
    this.source = source;
    this.description = '';
    this.emit();
  }

  has(index: number): boolean {
    return this.selected.has(index);
  }

  get size(): number {
    return this.selected.size;
  }

  get isActive(): boolean {
    return this.selected.size > 0;
  }

  /** True when a selection exists but is too small for reliable statistics. */
  get isUnderpowered(): boolean {
    return this.isActive && this.selected.size < MIN_RELIABLE_SELECTION;
  }

  getState(): SelectionState {
    return {
      indices: [...this.selected].sort((a, b) => a - b),
      source: this.source,
      description: this.description,
      total: this.total,
      isActive: this.isActive,
    };
  }

  /**
   * Apply the selection to a row array. Returns the original array when no
   * selection is active, so callers can use the result unconditionally.
   */
  filter<T>(rows: T[]): T[] {
    if (!this.isActive) return rows;
    const out: T[] = [];
    for (const i of this.selected) {
      if (i < rows.length) out.push(rows[i]);
    }
    return out;
  }

  /**
   * Subscribe. Returns an unsubscribe function. New subscribers are called
   * immediately with the current state so a late-mounting view is never blank.
   */
  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getState());
    } catch {
      /* a broken listener must not break subscription */
    }
    return () => { this.listeners.delete(listener); };
  }

  /** Flush any pending debounced notification immediately. */
  flush(): void {
    if (this.pending !== null) {
      this.cancel(this.pending);
      this.pending = null;
      this.notify();
    }
  }

  dispose(): void {
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = null;
    this.listeners.clear();
  }

  private emit(): void {
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = this.schedule(() => {
      this.pending = null;
      this.notify();
    }, this.debounceMs);
  }

  private notify(): void {
    const state = this.getState();
    for (const l of [...this.listeners]) {
      try {
        l(state);
      } catch {
        /* one failing view must not stop the others updating */
      }
    }
  }
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Geometry helpers for lasso / box selection
// ---------------------------------------------------------------------------

export interface Point2D { x: number; y: number; }

/**
 * Even-odd ray casting. Used to hit-test projected screen coordinates against a
 * freehand lasso, so selection works identically in 2D and 3D views (the 3D
 * engine already keeps screen-space coordinates for every rendered node).
 */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersects = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInRect(point: Point2D, a: Point2D, b: Point2D): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

/**
 * Drop points that barely moved. A raw pointer trail has hundreds of nearly
 * identical vertices, and polygon tests are O(vertices) per candidate point.
 */
export function simplifyPolygon(points: Point2D[], tolerance = 3): Point2D[] {
  if (points.length < 3) return points;
  const out: Point2D[] = [points[0]];
  const tol2 = tolerance * tolerance;
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    const dx = points[i].x - last.x;
    const dy = points[i].y - last.y;
    if (dx * dx + dy * dy >= tol2) out.push(points[i]);
  }
  return out.length >= 3 ? out : points;
}
