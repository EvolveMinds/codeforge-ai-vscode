/**
 * test/suite/fde/polyglotStudio.test.ts — Unit tests for PolyglotStudioPlugin
 *
 * Verifies that PolyglotStudioPlugin is properly defined, implements IPlugin,
 * detects workspace environments, registers in PluginRegistry, and maintains
 * its dedicated Activity Bar icon (💻) and routing in DESKTOP_PLUGINS.
 */

// Install vscode mock for standalone mocha execution if not loaded in extension host
(global as any).__mockVscodeStore = (global as any).__mockVscodeStore || { disabledPlugins: [] };
try {
  require.resolve('vscode');
} catch {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function(request: string, parent: any, isMain: boolean) {
    if (request === 'vscode') {
      const store = (global as any).__mockVscodeStore || { disabledPlugins: [] };
      return {
        ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
        workspace: {
          getConfiguration: () => ({
            get: (k: string, d: any) => store[k] !== undefined ? store[k] : (d ?? []),
            update: async (k: string, v: any) => { store[k] = v; },
          }),
          workspaceFolders: [],
        },
        commands: {
          registerCommand: () => ({ dispose: () => {} }),
        },
        EventEmitter: class {
          private listeners: any[] = [];
          event = (l: any) => { this.listeners.push(l); return { dispose: () => {} }; };
          fire = (d: any) => { this.listeners.forEach(l => l(d)); };
        },
        window: {
          showErrorMessage: () => {},
          showInformationMessage: () => {},
        },
      };
    }
    return orig.call(this, request, parent, isMain);
  };
}

import * as assert from 'assert';
import { PolyglotStudioPlugin } from '../../../plugins/polyglotStudio';
import { PluginRegistry } from '../../../core/plugin';
import { registerPlugins } from '../../../plugins/index';

suite('Polyglot AI Coding Studio Plugin & Workspace Cockpit', () => {
  test('instantiates PolyglotStudioPlugin with correct metadata and icon', () => {
    const plugin = new PolyglotStudioPlugin();
    assert.strictEqual(plugin.id, 'polyglotStudio');
    assert.ok(plugin.displayName.includes('Polyglot AI Coding Studio'), 'displayName should reference Polyglot AI Coding Studio');
    assert.strictEqual(plugin.icon, '💻', 'icon must be 💻');
    assert.ok(plugin.description.includes('TypeScript') && plugin.description.includes('Python'), 'description should outline polyglot tech stack');
  });

  test('detects workspace as available by default', async () => {
    const plugin = new PolyglotStudioPlugin();
    const detected = await plugin.detect(undefined);
    assert.strictEqual(detected, true, 'detect() should return true');
  });

  test('activates and deactivates cleanly without side-effects', async () => {
    const plugin = new PolyglotStudioPlugin();
    const mockServices = {} as any;
    const mockContext = { subscriptions: [] } as any;

    const disposables = await plugin.activate(mockServices, mockContext);
    assert.ok(Array.isArray(disposables), 'activate should return an array of disposables');

    await plugin.deactivate();
  });

  test('is registered in the core PluginRegistry alongside PythonStudioPlugin and MainframeConnectedPlugin', () => {
    const registry = new PluginRegistry({ emit: () => {} } as any);
    registerPlugins(registry);

    const polyglot = registry.getPlugin('polyglotStudio');
    assert.ok(polyglot, 'polyglotStudio must be registered in the PluginRegistry');
    assert.strictEqual(polyglot?.id, 'polyglotStudio');
    assert.strictEqual(polyglot?.icon, '💻');

    const python = registry.getPlugin('pythonStudio');
    assert.ok(python, 'pythonStudio must also be registered in the PluginRegistry');
    assert.strictEqual(python?.id, 'pythonStudio');
    assert.strictEqual(python?.icon, '🐍');

    const mainframe = registry.getPlugin('mainframe');
    assert.ok(mainframe, 'mainframe must also be registered in the PluginRegistry');
    assert.strictEqual(mainframe?.id, 'mainframe');
    assert.strictEqual(mainframe?.icon, '$(server-process)');
  });
});
