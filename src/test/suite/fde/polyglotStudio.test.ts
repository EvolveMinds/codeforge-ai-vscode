/**
 * test/suite/fde/polyglotStudio.test.ts — Unit tests for PolyglotStudioPlugin
 *
 * Verifies that PolyglotStudioPlugin is properly defined, implements IPlugin,
 * detects workspace environments, registers in PluginRegistry, and maintains
 * its dedicated Activity Bar icon (💻) and routing in DESKTOP_PLUGINS.
 */

// Install vscode mock for standalone mocha execution if not loaded in extension host
try {
  require.resolve('vscode');
} catch {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function(request: string, parent: any, isMain: boolean) {
    if (request === 'vscode') {
      return {
        workspace: {
          getConfiguration: () => ({ get: () => [] }),
        },
        commands: {
          registerCommand: () => ({ dispose: () => {} }),
        },
        EventEmitter: class {
          event = () => ({ dispose: () => {} });
          fire() {}
        },
        window: {
          showErrorMessage: () => {},
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

describe('Polyglot AI Coding Studio Plugin & Workspace Cockpit', () => {
  it('instantiates PolyglotStudioPlugin with correct metadata and icon', () => {
    const plugin = new PolyglotStudioPlugin();
    assert.strictEqual(plugin.id, 'polyglotStudio');
    assert.ok(plugin.displayName.includes('Polyglot AI Coding Studio'), 'displayName should reference Polyglot AI Coding Studio');
    assert.strictEqual(plugin.icon, '💻', 'icon must be 💻');
    assert.ok(plugin.description.includes('TypeScript') && plugin.description.includes('Python'), 'description should outline polyglot tech stack');
  });

  it('detects workspace as available by default', async () => {
    const plugin = new PolyglotStudioPlugin();
    const detected = await plugin.detect(undefined);
    assert.strictEqual(detected, true, 'detect() should return true');
  });

  it('activates and deactivates cleanly without side-effects', async () => {
    const plugin = new PolyglotStudioPlugin();
    const mockServices = {} as any;
    const mockContext = { subscriptions: [] } as any;

    const disposables = await plugin.activate(mockServices, mockContext);
    assert.ok(Array.isArray(disposables), 'activate should return an array of disposables');

    await plugin.deactivate();
  });

  it('is registered in the core PluginRegistry alongside PythonStudioPlugin and MainframeConnectedPlugin', () => {
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
