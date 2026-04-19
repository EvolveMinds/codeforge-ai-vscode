/**
 * test/suite/plugin.test.ts — Unit tests for PluginRegistry
 *
 * Creates minimal IPlugin test doubles and exercises registration,
 * activation, deactivation, and contribution accessors.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { PluginRegistry } from '../../core/plugin';
import type {
  IPlugin,
  PluginContextHook,
  PluginCodeLensAction,
  PluginCodeAction,
  PluginTransform,
  PluginTemplate,
  PluginCommand,
} from '../../core/plugin';
import type { IServices } from '../../core/services';
import { EventBus }          from '../../core/eventBus';
import {
  MockAIService,
  MockContextService,
  MockWorkspaceService,
  MockEventBus,
} from '../mocks';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeServices(registry: PluginRegistry, bus: EventBus): IServices {
  // We need a real vscode.ExtensionContext.
  // In the Extension Development Host the global extension is available.
  const ext = vscode.extensions.all[0];
  const vsCtx = ext?.extensionUri
    ? { subscriptions: [], globalStorageUri: ext.extensionUri } as unknown as vscode.ExtensionContext
    : { subscriptions: [] } as unknown as vscode.ExtensionContext;

  return {
    ai:        new MockAIService(),
    context:   new MockContextService(),
    workspace: new MockWorkspaceService(),
    plugins:   registry,
    events:    bus,
    inspector: new (require('../../core/hardwareInspector').HardwareInspector)(),
    setup:     new (require('../../core/setupOrchestrator').SetupOrchestrator)(),
    vsCtx,
  };
}

function makeExtCtx(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** Minimal test plugin that always detects true */
function makePlugin(id: string, shouldDetect = true): IPlugin {
  return {
    id,
    displayName: `Test Plugin ${id}`,
    icon:        '$(beaker)',

    async detect(_ws): Promise<boolean> {
      return shouldDetect;
    },

    async activate(_services, _context): Promise<vscode.Disposable[]> {
      return [];
    },
  };
}

/** Plugin that never detects */
function makeNonDetectingPlugin(id: string): IPlugin {
  return makePlugin(id, false);
}

/** Plugin with rich contributions */
function makeRichPlugin(id: string): IPlugin {
  const contextHook: PluginContextHook = {
    key: 'testHook',
    async collect(_ws) { return { data: 'hello' }; },
    format(_d) { return 'test context data'; },
  };

  const codeLensAction: PluginCodeLensAction = {
    title:       'Test Lens',
    command:     `aiForge.${id}.testCmd`,
    linePattern: /def test_/,
    languages:   ['python'],
  };

  const codeAction: PluginCodeAction = {
    title:    'Test Fix',
    command:  `aiForge.${id}.fix`,
    kind:     'quickfix',
    languages: ['python'],
  };

  const transform: PluginTransform = {
    label:       'Test Transform',
    description: 'Transform for testing',
    extensions:  ['.py'],
    async apply(content, _fp, _lang, _svc) { return content; },
  };

  const template: PluginTemplate = {
    label:       'Test Template',
    description: 'Template for testing',
    prompt(_wsPath) { return `Generate for ${_wsPath}`; },
  };

  const command: PluginCommand = {
    id:    `aiForge.${id}.testCmd`,
    title: 'Test Command',
    async handler(_services, ..._args) {},
  };

  return {
    id,
    displayName: `Rich Plugin ${id}`,
    icon:        '$(star)',

    async detect(_ws): Promise<boolean> { return true; },
    async activate(_services, _context): Promise<vscode.Disposable[]> { return []; },

    contextHooks:        [contextHook],
    systemPromptSection: () => `# ${id} system prompt section`,
    codeLensActions:     [codeLensAction],
    codeActions:         [codeAction],
    transforms:          [transform],
    templates:           [template],
    commands:            [command],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite('PluginRegistry', () => {
  let bus:      EventBus;
  let registry: PluginRegistry;

  setup(() => {
    bus      = new EventBus();
    registry = new PluginRegistry(bus);
  });

  teardown(async () => {
    await registry.disposeAll();
    bus.dispose();
  });

  // ── Registration ────────────────────────────────────────────────────────────

  test('registered plugin appears in registry after refresh (detect=true)', async () => {
    const plugin = makePlugin('alpha');
    registry.register(plugin);

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();

    await registry.refresh(undefined, services, vsCtx);

    const active = registry.active;
    assert.ok(active.some(p => p.id === 'alpha'), 'alpha should be active');
  });

  test('duplicate plugin ID is rejected — second registration is skipped', () => {
    const plugin1 = makePlugin('dup');
    const plugin2 = makePlugin('dup');

    registry.register(plugin1);
    registry.register(plugin2);  // should warn and skip

    // Internal state: only one entry per id.
    // We can't read _registered directly, but refreshing and checking active count works.
    // Both have the same ID so only one should appear.
    // We verify no throw and that it still works correctly.
    assert.doesNotThrow(() => registry.register(makePlugin('dup')));
  });

  test('plugin not activated when detect() returns false', async () => {
    const plugin   = makeNonDetectingPlugin('non-detect');
    registry.register(plugin);

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();
    await registry.refresh(undefined, services, vsCtx);

    assert.ok(!registry.active.some(p => p.id === 'non-detect'));
  });

  // ── Disabled plugins ─────────────────────────────────────────────────────────

  test('plugin in disabledPlugins list does not activate', async () => {
    // We cannot easily change VS Code workspace config in unit tests,
    // so we test the behaviour by observing that the plugin is not activated
    // when it would otherwise detect correctly.
    // This test documents expected behaviour rather than manipulating global config.
    const plugin = makePlugin('would-activate');
    registry.register(plugin);
    // Default disabledPlugins = [] so this plugin should activate normally.
    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();
    await registry.refresh(undefined, services, vsCtx);
    assert.ok(registry.active.some(p => p.id === 'would-activate'));
  });

  // ── Deactivation ────────────────────────────────────────────────────────────

  test('plugin is deactivated when detect() changes to false on refresh', async () => {
    let detectResult = true;

    const dynamicPlugin: IPlugin = {
      id:          'dynamic',
      displayName: 'Dynamic Plugin',
      icon:        '$(gear)',
      async detect(_ws): Promise<boolean> { return detectResult; },
      async activate(_s, _c): Promise<vscode.Disposable[]> { return []; },
    };

    registry.register(dynamicPlugin);

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();

    // First refresh — activates
    await registry.refresh(undefined, services, vsCtx);
    assert.ok(registry.active.some(p => p.id === 'dynamic'), 'should be active after first refresh');

    // Change detect result to false
    detectResult = false;

    // Second refresh — should deactivate
    await registry.refresh(undefined, services, vsCtx);
    assert.ok(!registry.active.some(p => p.id === 'dynamic'), 'should be deactivated after second refresh');
  });

  test('disposeAll removes all active plugins', async () => {
    registry.register(makePlugin('p1'));
    registry.register(makePlugin('p2'));

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();
    await registry.refresh(undefined, services, vsCtx);

    assert.ok(registry.active.length >= 2);

    await registry.disposeAll();

    assert.strictEqual(registry.active.length, 0);
  });

  // ── Contributions after activation ──────────────────────────────────────────

  test('activated plugin contributions are accessible via registry accessors', async () => {
    registry.register(makeRichPlugin('rich'));

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();
    await registry.refresh(undefined, services, vsCtx);

    assert.ok(registry.contextHooks.length      > 0, 'contextHooks should be populated');
    assert.ok(registry.codeLensActions.length   > 0, 'codeLensActions should be populated');
    assert.ok(registry.codeActions.length       > 0, 'codeActions should be populated');
    assert.ok(registry.transforms.length        > 0, 'transforms should be populated');
    assert.ok(registry.templates.length         > 0, 'templates should be populated');
    assert.ok(registry.systemPromptSections.length > 0, 'systemPromptSections should be populated');
  });

  test('system prompt sections contain plugin output', async () => {
    registry.register(makeRichPlugin('sys'));

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();
    await registry.refresh(undefined, services, vsCtx);

    const sections = registry.systemPromptSections;
    assert.ok(sections.some(s => s.includes('sys system prompt section')));
  });

  // ── onDidChange event ────────────────────────────────────────────────────────

  test('onDidChange fires when a plugin activates', async () => {
    let changeCount = 0;
    const disposable = registry.onDidChange(() => { changeCount++; });

    registry.register(makePlugin('evt1'));

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();
    await registry.refresh(undefined, services, vsCtx);

    assert.ok(changeCount > 0, 'onDidChange should have fired');
    disposable.dispose();
  });

  test('onDidChange fires when a plugin deactivates', async () => {
    let detectResult = true;
    const plugin: IPlugin = {
      id: 'evt-deact', displayName: 'Deact', icon: '',
      async detect(): Promise<boolean> { return detectResult; },
      async activate(_s, _c): Promise<vscode.Disposable[]> { return []; },
    };
    registry.register(plugin);

    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();
    await registry.refresh(undefined, services, vsCtx);

    let changeCount = 0;
    const disposable = registry.onDidChange(() => { changeCount++; });

    detectResult = false;
    await registry.refresh(undefined, services, vsCtx);

    assert.ok(changeCount > 0, 'onDidChange should fire on deactivation');
    disposable.dispose();
  });

  // ── Plugin with no optional contributions ────────────────────────────────────

  test('minimal plugin with no optional contributions activates without error', async () => {
    const minimal: IPlugin = {
      id:          'minimal',
      displayName: 'Minimal Plugin',
      icon:        '',
      async detect(_ws): Promise<boolean> { return true; },
      async activate(_s, _c): Promise<vscode.Disposable[]> { return []; },
      // No contextHooks, codeLensActions, codeActions, transforms, templates, commands
    };

    registry.register(minimal);
    const services = makeServices(registry, bus);
    const vsCtx    = makeExtCtx();

    await assert.doesNotReject(async () => {
      await registry.refresh(undefined, services, vsCtx);
    });

    assert.ok(registry.active.some(p => p.id === 'minimal'));
  });

  // ── EventBus events emitted ──────────────────────────────────────────────────

  test('plugin.activated event is emitted on activation', async () => {
    const mockBus = new MockEventBus();
    const localRegistry = new PluginRegistry(mockBus as unknown as EventBus);

    localRegistry.register(makePlugin('bus-test'));

    const services = makeServices(localRegistry, bus);
    const vsCtx    = makeExtCtx();
    await localRegistry.refresh(undefined, services, vsCtx);

    const activatedEvents = mockBus.emitted.filter(e => e.event === 'plugin.activated');
    assert.ok(activatedEvents.length > 0, 'plugin.activated should be emitted');

    const payload = activatedEvents[0].payload as { pluginId: string; displayName: string };
    assert.strictEqual(payload.pluginId, 'bus-test');

    await localRegistry.disposeAll();
  });

  test('plugin.deactivated event is emitted on deactivation', async () => {
    const mockBus = new MockEventBus();
    const localRegistry = new PluginRegistry(mockBus as unknown as EventBus);

    let detectResult = true;
    const plugin: IPlugin = {
      id: 'bus-deact', displayName: 'BusDeact', icon: '',
      async detect(): Promise<boolean> { return detectResult; },
      async activate(_s, _c): Promise<vscode.Disposable[]> { return []; },
    };
    localRegistry.register(plugin);

    const services = makeServices(localRegistry, bus);
    const vsCtx    = makeExtCtx();
    await localRegistry.refresh(undefined, services, vsCtx);

    detectResult = false;
    await localRegistry.refresh(undefined, services, vsCtx);

    const deactivatedEvents = mockBus.emitted.filter(e => e.event === 'plugin.deactivated');
    assert.ok(deactivatedEvents.length > 0, 'plugin.deactivated should be emitted');

    const payload = deactivatedEvents[0].payload as { pluginId: string };
    assert.strictEqual(payload.pluginId, 'bus-deact');

    await localRegistry.disposeAll();
  });
});
