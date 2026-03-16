/**
 * test/suite/fastapi.test.ts — Unit tests for the FastAPI plugin
 *
 * Tests run without a live VS Code instance — pure logic checks on the
 * plugin's identity, structure, and detection configuration.
 */

import * as assert from 'assert';
import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';
import { FastAPIPlugin } from '../../plugins/fastapi';

/** Create a temporary workspace directory and return its path */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-forge-fastapi-test-'));
}

/** Remove a directory recursively */
function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Build a minimal vscode.WorkspaceFolder-like object pointing at wsPath */
function fakeWs(wsPath: string): any {
  return { uri: { fsPath: wsPath }, name: 'test', index: 0 };
}

suite('FastAPIPlugin', () => {

  suite('Identity', () => {
    test('id === "fastapi"', () => {
      const plugin = new FastAPIPlugin();
      assert.strictEqual(plugin.id, 'fastapi');
    });

    test('displayName === "FastAPI"', () => {
      const plugin = new FastAPIPlugin();
      assert.strictEqual(plugin.displayName, 'FastAPI');
    });

    test('icon === "$(zap)"', () => {
      const plugin = new FastAPIPlugin();
      assert.strictEqual(plugin.icon, '$(zap)');
    });
  });

  suite('Detection', () => {
    test('returns false when workspace is undefined', async () => {
      const plugin = new FastAPIPlugin();
      assert.strictEqual(await plugin.detect(undefined), false);
    });

    test('detects fastapi in requirements.txt → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'requirements.txt'), 'fastapi==0.110.0\nuvicorn[standard]\n');
        const plugin = new FastAPIPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('detects fastapi in pyproject.toml → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'pyproject.toml'),
          '[tool.poetry.dependencies]\nfastapi = "^0.110.0"\n');
        const plugin = new FastAPIPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('detects fastapi import in main.py → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'main.py'),
          'from fastapi import FastAPI\napp = FastAPI()\n');
        const plugin = new FastAPIPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('returns false without any FastAPI markers', async () => {
      const tmp = makeTmpDir();
      try {
        // Empty workspace — no markers
        const plugin = new FastAPIPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), false);
      } finally { rmDir(tmp); }
    });

    test('returns false for non-fastapi requirements.txt', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'requirements.txt'), 'django==4.2\ndjango-rest-framework\n');
        const plugin = new FastAPIPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), false);
      } finally { rmDir(tmp); }
    });
  });

  suite('System Prompt Section', () => {
    test('returns a non-empty string', () => {
      const plugin = new FastAPIPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(typeof prompt === 'string' && prompt.length > 100);
    });

    test('contains "Pydantic" keyword', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(plugin.systemPromptSection().includes('Pydantic'),
        'Expected "Pydantic" in system prompt');
    });

    test('contains "Depends" keyword', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(plugin.systemPromptSection().includes('Depends'),
        'Expected "Depends" in system prompt');
    });

    test('contains route decorator terms', () => {
      const plugin = new FastAPIPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('@app.get') || prompt.includes('get/post'),
        'Expected route decorator terms in system prompt');
    });

    test('contains "response_model" keyword', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(plugin.systemPromptSection().includes('response_model'),
        'Expected "response_model" in system prompt');
    });
  });

  suite('Commands', () => {
    test('commands array has exactly 6 entries', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(plugin.commands, 'commands array should be defined');
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('all commands start with "aiForge.fastapi."', () => {
      const plugin = new FastAPIPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(cmd.id.startsWith('aiForge.fastapi.'),
          `Command "${cmd.id}" should start with "aiForge.fastapi."`);
      }
    });

    test('contains aiForge.fastapi.explainEndpoint', () => {
      const plugin = new FastAPIPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.fastapi.explainEndpoint'));
    });

    test('contains aiForge.fastapi.addValidation', () => {
      const plugin = new FastAPIPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.fastapi.addValidation'));
    });

    test('contains aiForge.fastapi.addResponseModel', () => {
      const plugin = new FastAPIPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.fastapi.addResponseModel'));
    });

    test('contains aiForge.fastapi.generateCrud', () => {
      const plugin = new FastAPIPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.fastapi.generateCrud'));
    });

    test('contains aiForge.fastapi.addAuth', () => {
      const plugin = new FastAPIPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.fastapi.addAuth'));
    });

    test('contains aiForge.fastapi.addTest', () => {
      const plugin = new FastAPIPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.fastapi.addTest'));
    });

    test('all commands have handler functions', () => {
      const plugin = new FastAPIPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(typeof cmd.handler === 'function', `Command "${cmd.id}" missing handler`);
      }
    });
  });

  suite('Context Hooks', () => {
    test('has 3 context hooks', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(Array.isArray(plugin.contextHooks));
      assert.strictEqual(plugin.contextHooks!.length, 3);
    });

    test('has fastapi.routes hook', () => {
      const plugin = new FastAPIPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('fastapi.routes'));
    });

    test('has fastapi.models hook', () => {
      const plugin = new FastAPIPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('fastapi.models'));
    });

    test('has fastapi.dependencies hook', () => {
      const plugin = new FastAPIPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('fastapi.dependencies'));
    });

    test('all hooks have collect and format functions', () => {
      const plugin = new FastAPIPlugin();
      for (const hook of plugin.contextHooks!) {
        assert.ok(typeof hook.collect === 'function', `Hook "${hook.key}" missing collect()`);
        assert.ok(typeof hook.format  === 'function', `Hook "${hook.key}" missing format()`);
      }
    });
  });

  suite('Code Lens Actions', () => {
    test('has 3 codeLensActions', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(Array.isArray(plugin.codeLensActions));
      assert.strictEqual(plugin.codeLensActions!.length, 3);
    });

    test('all codeLensActions have required fields', () => {
      const plugin = new FastAPIPlugin();
      for (const action of plugin.codeLensActions!) {
        assert.ok(typeof action.title   === 'string',   'title missing');
        assert.ok(typeof action.command === 'string',   'command missing');
        assert.ok(action.linePattern instanceof RegExp, 'linePattern must be RegExp');
        assert.ok(Array.isArray(action.languages),      'languages must be array');
      }
    });
  });

  suite('Transforms', () => {
    test('has 2 transforms', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(plugin.transforms, 'transforms should be defined');
      assert.strictEqual(plugin.transforms!.length, 2);
    });

    test('all transforms have required fields', () => {
      const plugin = new FastAPIPlugin();
      for (const t of plugin.transforms!) {
        assert.ok(typeof t.label       === 'string',   'label missing');
        assert.ok(typeof t.description === 'string',   'description missing');
        assert.ok(Array.isArray(t.extensions),         'extensions must be array');
        assert.ok(typeof t.apply       === 'function', 'apply must be function');
      }
    });
  });

  suite('Templates', () => {
    test('has 4 templates', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(plugin.templates, 'templates should be defined');
      assert.strictEqual(plugin.templates!.length, 4);
    });

    test('all templates have required fields', () => {
      const plugin = new FastAPIPlugin();
      for (const t of plugin.templates!) {
        assert.ok(typeof t.label       === 'string',   'label missing');
        assert.ok(typeof t.description === 'string',   'description missing');
        assert.ok(typeof t.prompt      === 'function', 'prompt must be function');
      }
    });

    test('template prompts return non-empty strings', () => {
      const plugin = new FastAPIPlugin();
      for (const t of plugin.templates!) {
        const result = t.prompt('/workspace/test');
        assert.ok(typeof result === 'string' && result.length > 0,
          `Template "${t.label}" prompt returned empty`);
      }
    });
  });

  suite('Status Item', () => {
    test('has statusItem defined', () => {
      const plugin = new FastAPIPlugin();
      assert.ok(plugin.statusItem, 'statusItem should be defined');
    });

    test('statusItem.text() returns a non-empty string', async () => {
      const plugin = new FastAPIPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(typeof text === 'string' && text.length > 0,
        'statusItem.text() should return non-empty string');
    });

    test('statusItem.text() contains zap icon', async () => {
      const plugin = new FastAPIPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(text.includes('$(zap)'), 'statusItem should include zap icon');
    });
  });
});
