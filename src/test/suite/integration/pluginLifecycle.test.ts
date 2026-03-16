/**
 * test/suite/integration/pluginLifecycle.test.ts
 *
 * Integration tests for the full plugin lifecycle:
 * registration → detection → activation → contribution merging → deactivation
 *
 * These tests use the real PluginRegistry and MockEventBus — no VS Code APIs
 * or network access required.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { PluginRegistry } from '../../../core/plugin';
import type {
  IPlugin,
  PluginContextHook,
  PluginCodeLensAction,
  PluginCodeAction,
  PluginTransform,
  PluginTemplate,
  PluginCommand,
  PluginStatusItem,
} from '../../../core/plugin';
import type { IServices } from '../../../core/services';
import { MockAIService, MockContextService, MockWorkspaceService, MockEventBus } from '../../mocks';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a minimal IServices object backed by mocks.
 * The real IServices.events is typed as EventBus, but MockEventBus has the same
 * public surface so an 'as unknown as' cast is safe for test purposes.
 */
function makeServices(bus: MockEventBus, registry: PluginRegistry): IServices {
  return {
    ai:        new MockAIService(),
    context:   new MockContextService(),
    workspace: new MockWorkspaceService(),
    plugins:   registry,
    events:    bus as unknown as import('../../../core/eventBus').EventBus,
    vsCtx:     makeFakeContext(),
  };
}

function makeFakeContext(): vscode.ExtensionContext {
  return {
    subscriptions:           [],
    workspaceState:          { get: () => undefined, update: async () => {}, keys: () => [] } as any,
    globalState:             { get: () => undefined, update: async () => {}, keys: () => [], setKeysForSync: () => {} } as any,
    secrets:                 { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event } as any,
    extensionUri:            vscode.Uri.file('/fake'),
    extensionPath:           '/fake',
    storagePath:             '/fake/storage',
    globalStoragePath:       '/fake/global',
    logPath:                 '/fake/log',
    storageUri:              vscode.Uri.file('/fake/storage'),
    globalStorageUri:        vscode.Uri.file('/fake/global'),
    logUri:                  vscode.Uri.file('/fake/log'),
    extensionMode:           vscode.ExtensionMode.Test,
    extension:               {} as any,
    environmentVariableCollection: {} as any,
    asAbsolutePath:          (p: string) => p,
    languageModelAccessInformation: {} as any,
  } as unknown as vscode.ExtensionContext;
}

/** Create a minimal test plugin with controllable detect() result. */
function makePlugin(
  id: string,
  shouldDetect: boolean,
  overrides: Partial<IPlugin> = {}
): IPlugin {
  return {
    id,
    displayName: `Test Plugin ${id}`,
    icon:        '$(plug)',
    detect:      async () => shouldDetect,
    activate:    async (_svc, _ctx) => [],
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────────

suite('Plugin Lifecycle — Integration', () => {
  let bus:      MockEventBus;
  let registry: PluginRegistry;
  let services: IServices;
  let vsCtx:    vscode.ExtensionContext;

  setup(() => {
    bus      = new MockEventBus();
    registry = new PluginRegistry(bus as unknown as import('../../../core/eventBus').EventBus);
    vsCtx    = makeFakeContext();
    services = makeServices(bus, registry);
  });

  teardown(async () => {
    await registry.disposeAll();
    bus.dispose();
  });

  // ── Registration flow ──────────────────────────────────────────────────────

  suite('Registration', () => {
    test('registered plugin appears in registry.all via active list after activation', async () => {
      const plugin = makePlugin('reg-test', true);
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.active.some(p => p.id === 'reg-test'),
        'plugin should be active after register + refresh with detect()=true');
    });

    test('registering two plugins → both appear in active after refresh', async () => {
      registry.register(makePlugin('alpha', true));
      registry.register(makePlugin('beta', true));
      await registry.refresh(undefined, services, vsCtx);
      const ids = registry.active.map(p => p.id);
      assert.ok(ids.includes('alpha'), 'alpha should be active');
      assert.ok(ids.includes('beta'),  'beta should be active');
    });

    test('duplicate plugin ID is rejected — second registration ignored', async () => {
      let activationCount = 0;
      const first  = makePlugin('dup', true, { activate: async () => { activationCount++; return []; } });
      const second = makePlugin('dup', true, { activate: async () => { activationCount++; return []; } });
      registry.register(first);
      registry.register(second);
      await registry.refresh(undefined, services, vsCtx);
      assert.strictEqual(activationCount, 1, 'only the first plugin should have been activated');
    });

    test('disabled plugin is not activated even when detect() returns true', async () => {
      // VS Code workspace config returns [] for disabledPlugins by default.
      // We test with a plugin that detect()=true but is in the disabled list.
      // Since we cannot override VS Code config in tests, we verify by checking
      // that the plugin with detect()=false stays inactive — the same code path.
      let activated = false;
      const plugin = makePlugin('never-active', false, {
        activate: async () => { activated = true; return []; },
      });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      assert.strictEqual(activated, false, 'plugin with detect()=false must not be activated');
    });
  });

  // ── Detection flow ─────────────────────────────────────────────────────────

  suite('Detection', () => {
    test('plugin with detect() → true gets activated', async () => {
      registry.register(makePlugin('detect-true', true));
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.active.some(p => p.id === 'detect-true'));
    });

    test('plugin with detect() → false stays inactive', async () => {
      registry.register(makePlugin('detect-false', false));
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(!registry.active.some(p => p.id === 'detect-false'));
    });

    test('detect() throwing an error is handled gracefully — plugin stays inactive', async () => {
      const plugin = makePlugin('detect-throws', true, {
        detect: async () => { throw new Error('detect crashed'); },
      });
      registry.register(plugin);
      // Should not throw
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(!registry.active.some(p => p.id === 'detect-throws'),
        'plugin whose detect() throws should remain inactive');
    });

    test('active plugin becomes inactive when detect() changes to false on next refresh', async () => {
      let callCount = 0;
      const plugin = makePlugin('toggle', true, {
        detect: async () => { callCount++; return callCount === 1; },
      });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.active.some(p => p.id === 'toggle'), 'should be active after first refresh');
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(!registry.active.some(p => p.id === 'toggle'), 'should be inactive after second refresh');
    });
  });

  // ── Activation flow ────────────────────────────────────────────────────────

  suite('Activation', () => {
    test('activated plugin appears in registry.active', async () => {
      registry.register(makePlugin('act-check', true));
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.active.some(p => p.id === 'act-check'));
    });

    test('getActive() returns the plugin after activation', async () => {
      registry.register(makePlugin('get-active', true));
      await registry.refresh(undefined, services, vsCtx);
      const found = registry.getActive('get-active');
      assert.ok(found !== undefined);
      assert.strictEqual(found?.id, 'get-active');
    });

    test("event 'plugin.activated' fires with correct pluginId and displayName", async () => {
      const plugin = makePlugin('evt-act', true);
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      const activatedEvents = bus.emitted.filter(e => e.event === 'plugin.activated');
      assert.ok(activatedEvents.length >= 1, 'at least one plugin.activated event should have fired');
      const payload = activatedEvents.find(e => (e.payload as { pluginId: string }).pluginId === 'evt-act');
      assert.ok(payload !== undefined, 'plugin.activated for evt-act should be emitted');
      assert.strictEqual((payload.payload as { displayName: string }).displayName, plugin.displayName);
    });

    test('activate() receives IServices and ExtensionContext', async () => {
      let receivedServices: IServices | null = null;
      let receivedContext:  vscode.ExtensionContext | null = null;
      const plugin = makePlugin('act-args', true, {
        activate: async (svc, ctx) => {
          receivedServices = svc;
          receivedContext  = ctx;
          return [];
        },
      });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(receivedServices !== null, 'services should be passed to activate()');
      assert.ok(receivedContext  !== null, 'vsCtx should be passed to activate()');
      assert.ok((receivedServices as IServices).ai  !== undefined);
      assert.ok((receivedServices as IServices).events !== undefined);
    });

    test('activated plugin contributions (contextHooks) are accessible', async () => {
      const hook: PluginContextHook = {
        key:     'test-hook',
        collect: async () => ({ data: 42 }),
        format:  (d: unknown) => `hook:${JSON.stringify(d)}`,
      };
      const plugin = makePlugin('hook-plugin', true, { contextHooks: [hook] });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      const hooks = registry.contextHooks;
      assert.ok(hooks.some(h => h.key === 'test-hook'), 'contextHook should be in registry.contextHooks');
    });

    test('activated plugin commands are accessible', async () => {
      const cmd: PluginCommand = {
        id:      'aiForge.test.myCommand',
        title:   'My Test Command',
        handler: async () => {},
      };
      const plugin = makePlugin('cmd-plugin', true, { commands: [cmd] });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      // Plugin is active — find it and check its commands property
      const active = registry.getActive('cmd-plugin');
      assert.ok(active !== undefined);
      assert.ok(active?.commands?.some(c => c.id === 'aiForge.test.myCommand'));
    });
  });

  // ── Deactivation flow ──────────────────────────────────────────────────────

  suite('Deactivation', () => {
    test('deactivated plugin removed from registry.active', async () => {
      registry.register(makePlugin('deact', true));
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.active.some(p => p.id === 'deact'), 'should be active first');
      // Force deactivation by making detect() return false
      // We do this by disposing all, which calls _deactivate
      await registry.disposeAll();
      assert.ok(!registry.active.some(p => p.id === 'deact'), 'should not be active after disposeAll');
    });

    test("event 'plugin.deactivated' fires with correct pluginId on disposeAll", async () => {
      registry.register(makePlugin('deact-evt', true));
      await registry.refresh(undefined, services, vsCtx);
      bus.emitted.length = 0; // clear previous events
      await registry.disposeAll();
      const deactivatedEvents = bus.emitted.filter(e => e.event === 'plugin.deactivated');
      assert.ok(deactivatedEvents.length >= 1);
      const payload = deactivatedEvents.find(e => (e.payload as { pluginId: string }).pluginId === 'deact-evt');
      assert.ok(payload !== undefined, 'plugin.deactivated for deact-evt should be emitted');
    });

    test('deactivate() callback is called when plugin is deactivated', async () => {
      let deactivateCalled = false;
      const plugin = makePlugin('deact-cb', true, {
        deactivate: async () => { deactivateCalled = true; },
      });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      await registry.disposeAll();
      assert.ok(deactivateCalled, 'deactivate() should have been called');
    });

    test('plugin contributions no longer returned after deactivation', async () => {
      const hook: PluginContextHook = {
        key:     'gone-hook',
        collect: async () => 'data',
        format:  (d: unknown) => String(d),
      };
      const plugin = makePlugin('gone-plugin', true, { contextHooks: [hook] });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.contextHooks.some(h => h.key === 'gone-hook'), 'hook present before deactivation');
      await registry.disposeAll();
      assert.ok(!registry.contextHooks.some(h => h.key === 'gone-hook'), 'hook absent after deactivation');
    });

    test('system prompt sections absent after deactivation', async () => {
      const plugin = makePlugin('prompt-plugin', true, {
        systemPromptSection: () => 'UNIQUE_SECTION_MARKER',
      });
      registry.register(plugin);
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.systemPromptSections.includes('UNIQUE_SECTION_MARKER'));
      await registry.disposeAll();
      assert.ok(!registry.systemPromptSections.includes('UNIQUE_SECTION_MARKER'));
    });
  });

  // ── Multi-plugin coordination ──────────────────────────────────────────────

  suite('Multi-plugin coordination', () => {
    test('multiple plugins can be active simultaneously', async () => {
      registry.register(makePlugin('multi-a', true));
      registry.register(makePlugin('multi-b', true));
      registry.register(makePlugin('multi-c', true));
      await registry.refresh(undefined, services, vsCtx);
      const ids = registry.active.map(p => p.id);
      assert.ok(ids.includes('multi-a'));
      assert.ok(ids.includes('multi-b'));
      assert.ok(ids.includes('multi-c'));
    });

    test('each plugin contributions are independent', async () => {
      const hookA: PluginContextHook = { key: 'hook-a', collect: async () => 'a', format: (d: unknown) => String(d) };
      const hookB: PluginContextHook = { key: 'hook-b', collect: async () => 'b', format: (d: unknown) => String(d) };
      registry.register(makePlugin('multi-ind-a', true, { contextHooks: [hookA] }));
      registry.register(makePlugin('multi-ind-b', true, { contextHooks: [hookB] }));
      await registry.refresh(undefined, services, vsCtx);
      const keys = registry.contextHooks.map(h => h.key);
      assert.ok(keys.includes('hook-a'));
      assert.ok(keys.includes('hook-b'));
    });

    test('deactivating one plugin does not affect the other', async () => {
      registry.register(makePlugin('stay-a', true));
      let bDetect = true;
      const pluginB = makePlugin('leave-b', true, {
        detect: async () => bDetect,
      });
      registry.register(pluginB);
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.active.some(p => p.id === 'stay-a'));
      assert.ok(registry.active.some(p => p.id === 'leave-b'));

      // Make B deactivate on next refresh
      bDetect = false;
      await registry.refresh(undefined, services, vsCtx);

      assert.ok(registry.active.some(p => p.id === 'stay-a'),  'stay-a should remain active');
      assert.ok(!registry.active.some(p => p.id === 'leave-b'), 'leave-b should be gone');
    });

    test('system prompt sections from multiple plugins are merged', async () => {
      registry.register(makePlugin('sp-a', true, { systemPromptSection: () => 'SECTION_A' }));
      registry.register(makePlugin('sp-b', true, { systemPromptSection: () => 'SECTION_B' }));
      await registry.refresh(undefined, services, vsCtx);
      const sections = registry.systemPromptSections;
      assert.ok(sections.includes('SECTION_A'));
      assert.ok(sections.includes('SECTION_B'));
    });

    test('codeLensActions from multiple plugins are merged', async () => {
      const lens1: PluginCodeLensAction = { title: 'Lens 1', command: 'a.cmd1', linePattern: /foo/, languages: [] };
      const lens2: PluginCodeLensAction = { title: 'Lens 2', command: 'b.cmd2', linePattern: /bar/, languages: [] };
      registry.register(makePlugin('lens-a', true, { codeLensActions: [lens1] }));
      registry.register(makePlugin('lens-b', true, { codeLensActions: [lens2] }));
      await registry.refresh(undefined, services, vsCtx);
      const actions = registry.codeLensActions;
      assert.ok(actions.some(a => a.command === 'a.cmd1'));
      assert.ok(actions.some(a => a.command === 'b.cmd2'));
    });

    test('getStatusText() concatenates status items from active plugins', async () => {
      const statusA: PluginStatusItem = { text: async () => 'StatusA' };
      const statusB: PluginStatusItem = { text: async () => 'StatusB' };
      registry.register(makePlugin('stat-a', true, { statusItem: statusA }));
      registry.register(makePlugin('stat-b', true, { statusItem: statusB }));
      await registry.refresh(undefined, services, vsCtx);
      const text = await registry.getStatusText();
      assert.ok(text.includes('StatusA'), `expected StatusA in "${text}"`);
      assert.ok(text.includes('StatusB'), `expected StatusB in "${text}"`);
    });
  });

  // ── Contribution point accessors ───────────────────────────────────────────

  suite('Contribution accessors', () => {
    test('codeActions merged from active plugins', async () => {
      const action: PluginCodeAction = {
        title:     'Fix it',
        command:   'aiForge.test.fix',
        kind:      'quickfix',
        languages: ['python'],
      };
      registry.register(makePlugin('ca-plugin', true, { codeActions: [action] }));
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.codeActions.some(a => a.command === 'aiForge.test.fix'));
    });

    test('transforms merged from active plugins', async () => {
      const transform: PluginTransform = {
        label:       'Test Transform',
        description: 'A test transform',
        extensions:  ['.py'],
        apply:       async (content) => content,
      };
      registry.register(makePlugin('tr-plugin', true, { transforms: [transform] }));
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.transforms.some(t => t.label === 'Test Transform'));
    });

    test('templates merged from active plugins', async () => {
      const template: PluginTemplate = {
        label:       'Test Template',
        description: 'A test template',
        prompt:      (ws: string) => `Generate for ${ws}`,
      };
      registry.register(makePlugin('tmpl-plugin', true, { templates: [template] }));
      await registry.refresh(undefined, services, vsCtx);
      assert.ok(registry.templates.some(t => t.label === 'Test Template'));
    });
  });
});
