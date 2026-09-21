/**
 * test/suite/offline/selectionStore.test.ts
 *
 * The store is the backbone of cross-filtering, so the contract it must honour
 * is behavioural: coalesce bursts, never notify spuriously, survive a throwing
 * listener, and treat "nothing selected" as "no filter" rather than "no rows".
 *
 * Debounce timing is tested with an injected scheduler so the suite stays
 * deterministic and instant rather than sleeping on real timers.
 */

import * as assert from 'assert';
import {
  MIN_RELIABLE_SELECTION,
  SelectionStore,
  pointInPolygon,
  pointInRect,
  simplifyPolygon,
} from '../../../offline/selectionStore';

/** Scheduler that records pending callbacks and fires them on demand. */
function manualScheduler() {
  let pending: Array<() => void> = [];
  return {
    scheduler: (fn: () => void) => {
      pending.push(fn);
      return pending.length - 1;
    },
    cancelScheduler: (handle: unknown) => {
      const i = handle as number;
      if (i >= 0 && i < pending.length) pending[i] = () => { /* cancelled */ };
    },
    flush: () => {
      const toRun = pending;
      pending = [];
      for (const fn of toRun) fn();
    },
    get pendingCount() { return pending.length; },
  };
}

function makeStore(total = 100) {
  const sched = manualScheduler();
  const store = new SelectionStore({
    scheduler: sched.scheduler,
    cancelScheduler: sched.cancelScheduler,
  });
  store.setTotal(total);
  return { store, sched };
}

suite('Selection Store Suite', () => {

  test('starts inactive and reports the full population', () => {
    const { store } = makeStore(50);
    assert.strictEqual(store.isActive, false);
    assert.strictEqual(store.size, 0);
    assert.strictEqual(store.getTotal(), 50);
  });

  test('an empty selection means no filter, not zero rows', () => {
    const { store } = makeStore(3);
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    assert.strictEqual(store.filter(rows), rows, 'should return the original array untouched');
    assert.strictEqual(store.filter(rows).length, 3);
  });

  test('filters rows by index once a selection exists', () => {
    const { store, sched } = makeStore(4);
    const rows = [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }];
    store.set([1, 3], 'manifold', 'lasso');
    sched.flush();
    const filtered = store.filter(rows);
    assert.deepStrictEqual(filtered.map(r => r.a), [1, 3]);
  });

  test('rejects out-of-range and non-integer indices', () => {
    const { store, sched } = makeStore(5);
    store.set([-1, 2, 99, 1.5 as number], 'chart');
    sched.flush();
    assert.deepStrictEqual(store.getState().indices, [2]);
  });

  test('coalesces a burst of updates into a single notification', () => {
    const { store, sched } = makeStore(100);
    let notifications = 0;
    store.subscribe(() => { notifications++; });
    // Subscribing fires once immediately with current state.
    assert.strictEqual(notifications, 1);

    // Simulate a drag: many rapid set() calls.
    for (let i = 1; i <= 25; i++) store.set([i], 'manifold');
    assert.strictEqual(notifications, 1, 'nothing should fire before the debounce elapses');

    sched.flush();
    assert.strictEqual(notifications, 2, 'the whole burst collapses to one notification');
  });

  test('does not notify when the selection is unchanged', () => {
    const { store, sched } = makeStore(10);
    store.set([1, 2, 3], 'chart');
    sched.flush();

    let after = 0;
    store.subscribe(() => { after++; });
    assert.strictEqual(after, 1);

    store.set([3, 2, 1], 'chart'); // same set, different order
    sched.flush();
    assert.strictEqual(after, 1, 'an identical selection must not re-notify');
  });

  test('add, remove and toggle behave as expected', () => {
    const { store, sched } = makeStore(10);
    store.set([1, 2], 'chart');
    store.add([3], 'chart');
    sched.flush();
    assert.deepStrictEqual(store.getState().indices, [1, 2, 3]);

    store.remove([2], 'chart');
    sched.flush();
    assert.deepStrictEqual(store.getState().indices, [1, 3]);

    store.toggle(1, 'chart');
    sched.flush();
    assert.deepStrictEqual(store.getState().indices, [3]);

    store.toggle(5, 'chart');
    sched.flush();
    assert.deepStrictEqual(store.getState().indices, [3, 5]);
  });

  test('clear resets to the full population', () => {
    const { store, sched } = makeStore(10);
    store.set([1, 2, 3], 'manifold');
    sched.flush();
    assert.strictEqual(store.isActive, true);

    store.clear();
    sched.flush();
    assert.strictEqual(store.isActive, false);
    assert.strictEqual(store.size, 0);
  });

  test('flags an underpowered selection', () => {
    const { store, sched } = makeStore(500);
    store.set([1, 2, 3], 'manifold');
    sched.flush();
    assert.strictEqual(store.isUnderpowered, true, '3 rows cannot support reliable statistics');

    store.set(Array.from({ length: MIN_RELIABLE_SELECTION + 1 }, (_, i) => i), 'manifold');
    sched.flush();
    assert.strictEqual(store.isUnderpowered, false);
  });

  test('changing the population clears a stale selection', () => {
    const { store, sched } = makeStore(10);
    store.set([1, 2], 'chart');
    sched.flush();
    store.setTotal(20);
    sched.flush();
    assert.strictEqual(store.isActive, false, 'new dataset must not inherit old indices');
  });

  test('one throwing listener does not stop the others', () => {
    const { store, sched } = makeStore(10);
    let reached = false;
    store.subscribe(() => { throw new Error('boom'); });
    store.subscribe(() => { reached = true; });

    store.set([1], 'chart');
    sched.flush();
    assert.strictEqual(reached, true, 'the second listener must still run');
  });

  test('unsubscribe stops delivery', () => {
    const { store, sched } = makeStore(10);
    let count = 0;
    const off = store.subscribe(() => { count++; });
    const baseline = count;
    off();
    store.set([1, 2], 'chart');
    sched.flush();
    assert.strictEqual(count, baseline, 'no delivery after unsubscribe');
  });

  // -- Geometry -------------------------------------------------------------

  test('pointInPolygon hit-tests a lasso correctly', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    assert.strictEqual(pointInPolygon({ x: 5, y: 5 }, square), true);
    assert.strictEqual(pointInPolygon({ x: 15, y: 5 }, square), false);
    assert.strictEqual(pointInPolygon({ x: -1, y: -1 }, square), false);
  });

  test('pointInPolygon handles a concave shape', () => {
    // An L-shape: the notch must read as outside.
    const l = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 },
      { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
    ];
    assert.strictEqual(pointInPolygon({ x: 2, y: 2 }, l), true);
    assert.strictEqual(pointInPolygon({ x: 8, y: 8 }, l), false, 'the notch is outside');
  });

  test('a degenerate polygon selects nothing', () => {
    assert.strictEqual(pointInPolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 2, y: 2 }]), false);
  });

  test('pointInRect is order-independent', () => {
    assert.strictEqual(pointInRect({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 }), true);
    assert.strictEqual(pointInRect({ x: 5, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 0 }), true);
    assert.strictEqual(pointInRect({ x: 50, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 }), false);
  });

  test('simplifyPolygon drops near-duplicate vertices', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.1, y: 0 }));
    const simplified = simplifyPolygon(noisy, 3);
    assert.ok(simplified.length < noisy.length, 'should shed redundant points');
  });

  test('simplifyPolygon never returns a degenerate shape', () => {
    const tiny = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.2, y: 0 }];
    const simplified = simplifyPolygon(tiny, 50);
    assert.ok(simplified.length >= 3, 'must fall back to the original rather than collapse');
  });
});
