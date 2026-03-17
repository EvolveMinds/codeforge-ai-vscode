/**
 * test/suite/pytest.test.ts — Unit tests for the pytest plugin
 *
 * Tests run without a live VS Code instance — pure logic checks on the
 * plugin's identity, structure, and detection configuration.
 */

import * as assert from 'assert';
import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';
import { PytestPlugin } from '../../plugins/pytest';

/** Create a temporary workspace directory and return its path */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-ai-pytest-test-'));
}

/** Remove a directory recursively */
function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Build a minimal vscode.WorkspaceFolder-like object pointing at wsPath */
function fakeWs(wsPath: string): any {
  return { uri: { fsPath: wsPath }, name: 'test', index: 0 };
}

suite('PytestPlugin', () => {

  suite('Identity', () => {
    test('id === "pytest"', () => {
      const plugin = new PytestPlugin();
      assert.strictEqual(plugin.id, 'pytest');
    });

    test('displayName === "pytest"', () => {
      const plugin = new PytestPlugin();
      assert.strictEqual(plugin.displayName, 'pytest');
    });

    test('icon === "$(beaker)"', () => {
      const plugin = new PytestPlugin();
      assert.strictEqual(plugin.icon, '$(beaker)');
    });
  });

  suite('Detection', () => {
    test('returns false when workspace is undefined', async () => {
      const plugin = new PytestPlugin();
      assert.strictEqual(await plugin.detect(undefined), false);
    });

    test('detects pytest.ini present → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'pytest.ini'), '[pytest]\naddopts = -v\n');
        const plugin = new PytestPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('detects conftest.py present → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'conftest.py'), 'import pytest\n');
        const plugin = new PytestPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('detects pyproject.toml with [tool.pytest → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'pyproject.toml'),
          '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
        const plugin = new PytestPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('returns false without any pytest markers', async () => {
      const tmp = makeTmpDir();
      try {
        // Empty workspace — no markers
        const plugin = new PytestPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), false);
      } finally { rmDir(tmp); }
    });
  });

  suite('System Prompt Section', () => {
    test('returns a non-empty string', () => {
      const plugin = new PytestPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(typeof prompt === 'string' && prompt.length > 100);
    });

    test('contains "fixture" keyword', () => {
      const plugin = new PytestPlugin();
      assert.ok(plugin.systemPromptSection().toLowerCase().includes('fixture'),
        'Expected "fixture" in system prompt');
    });

    test('contains "parametrize" keyword', () => {
      const plugin = new PytestPlugin();
      assert.ok(plugin.systemPromptSection().toLowerCase().includes('parametrize'),
        'Expected "parametrize" in system prompt');
    });

    test('contains "mark" keyword', () => {
      const plugin = new PytestPlugin();
      assert.ok(plugin.systemPromptSection().toLowerCase().includes('mark'),
        'Expected "mark" in system prompt');
    });
  });

  suite('Commands', () => {
    test('commands array has exactly 6 entries', () => {
      const plugin = new PytestPlugin();
      assert.ok(plugin.commands, 'commands array should be defined');
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('all commands start with "aiForge.pytest."', () => {
      const plugin = new PytestPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(cmd.id.startsWith('aiForge.pytest.'),
          `Command "${cmd.id}" should start with "aiForge.pytest."`);
      }
    });

    test('contains aiForge.pytest.generateTest', () => {
      const plugin = new PytestPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.pytest.generateTest'));
    });

    test('contains aiForge.pytest.addFixture', () => {
      const plugin = new PytestPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.pytest.addFixture'));
    });

    test('contains aiForge.pytest.addParametrize', () => {
      const plugin = new PytestPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.pytest.addParametrize'));
    });

    test('contains aiForge.pytest.convertUnittest', () => {
      const plugin = new PytestPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.pytest.convertUnittest'));
    });

    test('contains aiForge.pytest.addCoverage', () => {
      const plugin = new PytestPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.pytest.addCoverage'));
    });

    test('contains aiForge.pytest.explainTest', () => {
      const plugin = new PytestPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.pytest.explainTest'));
    });

    test('all commands have handler functions', () => {
      const plugin = new PytestPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(typeof cmd.handler === 'function', `Command "${cmd.id}" missing handler`);
      }
    });
  });

  suite('Context Hooks', () => {
    test('has 3 context hooks', () => {
      const plugin = new PytestPlugin();
      assert.ok(Array.isArray(plugin.contextHooks));
      assert.strictEqual(plugin.contextHooks!.length, 3);
    });

    test('has pytest.config hook', () => {
      const plugin = new PytestPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('pytest.config'));
    });

    test('has pytest.fixtures hook', () => {
      const plugin = new PytestPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('pytest.fixtures'));
    });

    test('has pytest.structure hook', () => {
      const plugin = new PytestPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('pytest.structure'));
    });

    test('all hooks have collect and format functions', () => {
      const plugin = new PytestPlugin();
      for (const hook of plugin.contextHooks!) {
        assert.ok(typeof hook.collect === 'function', `Hook "${hook.key}" missing collect()`);
        assert.ok(typeof hook.format === 'function',  `Hook "${hook.key}" missing format()`);
      }
    });
  });

  suite('Code Lens Actions', () => {
    test('has 3 codeLensActions', () => {
      const plugin = new PytestPlugin();
      assert.ok(Array.isArray(plugin.codeLensActions));
      assert.strictEqual(plugin.codeLensActions!.length, 3);
    });

    test('all codeLensActions have required fields', () => {
      const plugin = new PytestPlugin();
      for (const action of plugin.codeLensActions!) {
        assert.ok(typeof action.title   === 'string',     'title missing');
        assert.ok(typeof action.command === 'string',     'command missing');
        assert.ok(action.linePattern instanceof RegExp,   'linePattern must be RegExp');
        assert.ok(Array.isArray(action.languages),        'languages must be array');
      }
    });
  });

  suite('Transforms', () => {
    test('has 2 transforms', () => {
      const plugin = new PytestPlugin();
      assert.ok(plugin.transforms, 'transforms should be defined');
      assert.strictEqual(plugin.transforms!.length, 2);
    });

    test('all transforms have required fields', () => {
      const plugin = new PytestPlugin();
      for (const t of plugin.transforms!) {
        assert.ok(typeof t.label       === 'string',  'label missing');
        assert.ok(typeof t.description === 'string',  'description missing');
        assert.ok(Array.isArray(t.extensions),        'extensions must be array');
        assert.ok(typeof t.apply       === 'function','apply must be function');
      }
    });
  });

  suite('Templates', () => {
    test('has 3 templates', () => {
      const plugin = new PytestPlugin();
      assert.ok(plugin.templates, 'templates should be defined');
      assert.strictEqual(plugin.templates!.length, 3);
    });

    test('all templates have required fields', () => {
      const plugin = new PytestPlugin();
      for (const t of plugin.templates!) {
        assert.ok(typeof t.label       === 'string',  'label missing');
        assert.ok(typeof t.description === 'string',  'description missing');
        assert.ok(typeof t.prompt      === 'function','prompt must be function');
      }
    });

    test('template prompts return non-empty strings', () => {
      const plugin = new PytestPlugin();
      for (const t of plugin.templates!) {
        const result = t.prompt('/workspace/test');
        assert.ok(typeof result === 'string' && result.length > 0,
          `Template "${t.label}" prompt returned empty`);
      }
    });
  });

  suite('Status Item', () => {
    test('has statusItem defined', () => {
      const plugin = new PytestPlugin();
      assert.ok(plugin.statusItem, 'statusItem should be defined');
    });

    test('statusItem.text() returns a non-empty string', async () => {
      const plugin = new PytestPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(typeof text === 'string' && text.length > 0,
        'statusItem.text() should return non-empty string');
    });

    test('statusItem.text() contains beaker icon', async () => {
      const plugin = new PytestPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(text.includes('$(beaker)'), 'statusItem should include beaker icon');
    });
  });
});
