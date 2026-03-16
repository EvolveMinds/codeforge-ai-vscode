/**
 * test/suite/eventBus.test.ts — Unit tests for the EventBus
 *
 * EventBus wraps vscode.EventEmitter with a typed interface.
 * All tests here verify subscription, emission, unsubscription,
 * and isolation between different event names.
 */

import * as assert from 'assert';
import { EventBus } from '../../core/eventBus';

suite('EventBus', () => {
  let bus: EventBus;

  setup(() => {
    bus = new EventBus();
  });

  teardown(() => {
    bus.dispose();
  });

  // ── Basic subscription and emission ────────────────────────────────────────

  test('subscriber receives emitted payload', () => {
    let received: { provider: string; model: string } | null = null;

    bus.on('provider.changed', payload => {
      received = payload;
    });

    bus.emit('provider.changed', { provider: 'ollama', model: 'qwen2.5-coder:7b' });

    assert.deepStrictEqual(received, { provider: 'ollama', model: 'qwen2.5-coder:7b' });
  });

  test('payload fields are passed correctly', () => {
    let pluginId = '';
    let displayName = '';

    bus.on('plugin.activated', payload => {
      pluginId = payload.pluginId;
      displayName = payload.displayName;
    });

    bus.emit('plugin.activated', { pluginId: 'databricks', displayName: 'Databricks' });

    assert.strictEqual(pluginId, 'databricks');
    assert.strictEqual(displayName, 'Databricks');
  });

  // ── Multiple listeners ─────────────────────────────────────────────────────

  test('multiple listeners on same event all fire', () => {
    const calls: number[] = [];

    bus.on('ai.request.start', () => { calls.push(1); });
    bus.on('ai.request.start', () => { calls.push(2); });
    bus.on('ai.request.start', () => { calls.push(3); });

    bus.emit('ai.request.start', { instruction: 'test', mode: 'edit' });

    assert.deepStrictEqual(calls, [1, 2, 3]);
  });

  test('each listener receives the same payload', () => {
    const payloads: Array<{ instruction: string; mode: string }> = [];

    bus.on('ai.request.start', p => { payloads.push(p); });
    bus.on('ai.request.start', p => { payloads.push(p); });

    bus.emit('ai.request.start', { instruction: 'explain', mode: 'explain' });

    assert.strictEqual(payloads.length, 2);
    assert.deepStrictEqual(payloads[0], { instruction: 'explain', mode: 'explain' });
    assert.deepStrictEqual(payloads[1], { instruction: 'explain', mode: 'explain' });
  });

  // ── Unsubscription (dispose) ───────────────────────────────────────────────

  test('dispose() prevents further calls to listener', () => {
    let callCount = 0;

    const disposable = bus.on('file.edited', () => { callCount++; });

    bus.emit('file.edited', { filePath: '/a/b.py', linesChanged: 5 });
    assert.strictEqual(callCount, 1);

    disposable.dispose();
    bus.emit('file.edited', { filePath: '/a/b.py', linesChanged: 5 });
    assert.strictEqual(callCount, 1, 'listener should not fire after dispose');
  });

  test('dispose() is idempotent — calling twice does not throw', () => {
    const disposable = bus.on('file.edited', () => {});

    assert.doesNotThrow(() => {
      disposable.dispose();
      disposable.dispose();
    });
  });

  test('only disposed listener stops firing — other listeners keep firing', () => {
    const calls: string[] = [];

    const d1 = bus.on('files.created', () => { calls.push('listener-1'); });
    bus.on('files.created', () => { calls.push('listener-2'); });

    bus.emit('files.created', { filePaths: ['a.py'] });
    assert.deepStrictEqual(calls, ['listener-1', 'listener-2']);

    d1.dispose();
    bus.emit('files.created', { filePaths: ['b.py'] });
    assert.deepStrictEqual(calls, ['listener-1', 'listener-2', 'listener-2']);
  });

  // ── No listeners edge case ─────────────────────────────────────────────────

  test('emitting event with no listeners does not throw', () => {
    assert.doesNotThrow(() => {
      bus.emit('context.refreshed', { activePlugins: ['databricks'] });
    });
  });

  // ── Event isolation ────────────────────────────────────────────────────────

  test('events with different names do not cross-fire', () => {
    const startCalls: number[] = [];
    const doneCalls:  number[] = [];

    bus.on('ai.request.start', () => { startCalls.push(1); });
    bus.on('ai.request.done',  () => { doneCalls.push(1); });

    bus.emit('ai.request.start', { instruction: 'fix', mode: 'fix' });

    assert.strictEqual(startCalls.length, 1);
    assert.strictEqual(doneCalls.length, 0, 'done listener must not fire when start is emitted');
  });

  test('listener added after emit does not retroactively receive past events', () => {
    let callCount = 0;

    bus.emit('ui.notify', { message: 'hello', level: 'info' });

    // Listener registered AFTER the emit
    bus.on('ui.notify', () => { callCount++; });

    assert.strictEqual(callCount, 0, 'late-registered listener should not receive past events');
  });

  // ── Complex payload types ──────────────────────────────────────────────────

  test('ui.notify payload level field accepted for all valid levels', () => {
    const levels: Array<'info' | 'warning' | 'error'> = [];

    bus.on('ui.notify', p => { levels.push(p.level); });

    bus.emit('ui.notify', { message: 'msg1', level: 'info' });
    bus.emit('ui.notify', { message: 'msg2', level: 'warning' });
    bus.emit('ui.notify', { message: 'msg3', level: 'error' });

    assert.deepStrictEqual(levels, ['info', 'warning', 'error']);
  });

  test('files.created payload carries array of paths', () => {
    let received: string[] = [];

    bus.on('files.created', p => { received = p.filePaths; });

    bus.emit('files.created', { filePaths: ['src/a.py', 'src/b.py', 'src/c.py'] });

    assert.strictEqual(received.length, 3);
    assert.ok(received.includes('src/a.py'));
  });

  // ── Bus-level dispose ──────────────────────────────────────────────────────

  test('bus.dispose() clears all emitters without throwing', () => {
    bus.on('provider.changed', () => {});
    bus.on('plugin.activated', () => {});

    assert.doesNotThrow(() => {
      bus.dispose();
    });
  });
});
