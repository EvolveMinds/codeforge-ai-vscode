/**
 * test/suite/django.test.ts — Unit tests for the Django plugin
 *
 * Tests run without a live VS Code instance — pure logic checks on the
 * plugin's identity, structure, and detection configuration.
 */

import * as assert from 'assert';
import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';
import { DjangoPlugin } from '../../plugins/django';

/** Create a temporary workspace directory and return its path */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-forge-django-test-'));
}

/** Remove a directory recursively */
function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Build a minimal vscode.WorkspaceFolder-like object pointing at wsPath */
function fakeWs(wsPath: string): any {
  return { uri: { fsPath: wsPath }, name: 'test', index: 0 };
}

suite('DjangoPlugin', () => {

  suite('Identity', () => {
    test('id === "django"', () => {
      const plugin = new DjangoPlugin();
      assert.strictEqual(plugin.id, 'django');
    });

    test('displayName === "Django"', () => {
      const plugin = new DjangoPlugin();
      assert.strictEqual(plugin.displayName, 'Django');
    });

    test('icon === "$(globe)"', () => {
      const plugin = new DjangoPlugin();
      assert.strictEqual(plugin.icon, '$(globe)');
    });
  });

  suite('Detection', () => {
    test('returns false when workspace is undefined', async () => {
      const plugin = new DjangoPlugin();
      assert.strictEqual(await plugin.detect(undefined), false);
    });

    test('detects manage.py → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'manage.py'),
          '#!/usr/bin/env python\nimport os\nimport sys\n\ndef main():\n    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "myproject.settings")\n');
        const plugin = new DjangoPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('detects django in requirements.txt → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'requirements.txt'), 'Django==4.2\ndjangorestframework==3.14\n');
        const plugin = new DjangoPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('detects django in pyproject.toml → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'pyproject.toml'),
          '[tool.poetry.dependencies]\nDjango = "^4.2"\n');
        const plugin = new DjangoPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('detects settings.py with INSTALLED_APPS → true', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'settings.py'),
          'INSTALLED_APPS = [\n    "django.contrib.admin",\n    "myapp",\n]\n');
        const plugin = new DjangoPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), true);
      } finally { rmDir(tmp); }
    });

    test('returns false without any Django markers', async () => {
      const tmp = makeTmpDir();
      try {
        // Empty workspace — no markers
        const plugin = new DjangoPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), false);
      } finally { rmDir(tmp); }
    });

    test('returns false for non-django requirements.txt', async () => {
      const tmp = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmp, 'requirements.txt'), 'fastapi==0.110.0\nuvicorn[standard]\n');
        const plugin = new DjangoPlugin();
        assert.strictEqual(await plugin.detect(fakeWs(tmp)), false);
      } finally { rmDir(tmp); }
    });
  });

  suite('System Prompt Section', () => {
    test('returns a non-empty string', () => {
      const plugin = new DjangoPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(typeof prompt === 'string' && prompt.length > 100);
    });

    test('contains ORM-related terms', () => {
      const plugin = new DjangoPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('QuerySet') || prompt.includes('ORM'),
        'Expected ORM terms in system prompt');
    });

    test('contains "select_related" keyword', () => {
      const plugin = new DjangoPlugin();
      assert.ok(plugin.systemPromptSection().includes('select_related'),
        'Expected "select_related" in system prompt');
    });

    test('contains "serializer" or "Serializer" keyword', () => {
      const plugin = new DjangoPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('serializer'),
        'Expected serializer terms in system prompt'
      );
    });

    test('contains DRF-related content', () => {
      const plugin = new DjangoPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('REST Framework') || prompt.includes('ViewSet') || prompt.includes('DRF'),
        'Expected DRF content in system prompt'
      );
    });

    test('contains "migrate" or "migration" keyword', () => {
      const plugin = new DjangoPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('migrat'),
        'Expected migration terms in system prompt'
      );
    });

    test('contains security guidance', () => {
      const plugin = new DjangoPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('CSRF') || prompt.includes('SECRET_KEY') || prompt.includes('ALLOWED_HOSTS'),
        'Expected security guidance in system prompt'
      );
    });
  });

  suite('Commands', () => {
    test('commands array has exactly 6 entries', () => {
      const plugin = new DjangoPlugin();
      assert.ok(plugin.commands, 'commands array should be defined');
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('all commands start with "aiForge.django."', () => {
      const plugin = new DjangoPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(cmd.id.startsWith('aiForge.django.'),
          `Command "${cmd.id}" should start with "aiForge.django."`);
      }
    });

    test('contains aiForge.django.explainModel', () => {
      const plugin = new DjangoPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.django.explainModel'));
    });

    test('contains aiForge.django.addSerializer', () => {
      const plugin = new DjangoPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.django.addSerializer'));
    });

    test('contains aiForge.django.addAdmin', () => {
      const plugin = new DjangoPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.django.addAdmin'));
    });

    test('contains aiForge.django.addView', () => {
      const plugin = new DjangoPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.django.addView'));
    });

    test('contains aiForge.django.addUrls', () => {
      const plugin = new DjangoPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.django.addUrls'));
    });

    test('contains aiForge.django.addTest', () => {
      const plugin = new DjangoPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.django.addTest'));
    });

    test('all commands have handler functions', () => {
      const plugin = new DjangoPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(typeof cmd.handler === 'function', `Command "${cmd.id}" missing handler`);
      }
    });
  });

  suite('Context Hooks', () => {
    test('has 3 context hooks', () => {
      const plugin = new DjangoPlugin();
      assert.ok(Array.isArray(plugin.contextHooks));
      assert.strictEqual(plugin.contextHooks!.length, 3);
    });

    test('has django.apps hook', () => {
      const plugin = new DjangoPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('django.apps'));
    });

    test('has django.models hook', () => {
      const plugin = new DjangoPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('django.models'));
    });

    test('has django.settings hook', () => {
      const plugin = new DjangoPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('django.settings'));
    });

    test('all hooks have collect and format functions', () => {
      const plugin = new DjangoPlugin();
      for (const hook of plugin.contextHooks!) {
        assert.ok(typeof hook.collect === 'function', `Hook "${hook.key}" missing collect()`);
        assert.ok(typeof hook.format  === 'function', `Hook "${hook.key}" missing format()`);
      }
    });

    test('django.apps format returns non-empty string', () => {
      const plugin = new DjangoPlugin();
      const hook = plugin.contextHooks!.find(h => h.key === 'django.apps')!;
      const result = hook.format([]);
      assert.ok(typeof result === 'string' && result.length > 0);
    });

    test('django.models format returns non-empty string', () => {
      const plugin = new DjangoPlugin();
      const hook = plugin.contextHooks!.find(h => h.key === 'django.models')!;
      const result = hook.format([]);
      assert.ok(typeof result === 'string' && result.length > 0);
    });
  });

  suite('Code Lens Actions', () => {
    test('has 3 codeLensActions', () => {
      const plugin = new DjangoPlugin();
      assert.ok(Array.isArray(plugin.codeLensActions));
      assert.strictEqual(plugin.codeLensActions!.length, 3);
    });

    test('all codeLensActions have required fields', () => {
      const plugin = new DjangoPlugin();
      for (const action of plugin.codeLensActions!) {
        assert.ok(typeof action.title   === 'string',   'title missing');
        assert.ok(typeof action.command === 'string',   'command missing');
        assert.ok(action.linePattern instanceof RegExp, 'linePattern must be RegExp');
        assert.ok(Array.isArray(action.languages),      'languages must be array');
      }
    });

    test('linePatterns match Django model class declarations', () => {
      const plugin = new DjangoPlugin();
      const sampleLine = 'class Product(models.Model):';
      for (const action of plugin.codeLensActions!) {
        assert.ok(
          action.linePattern.test(sampleLine),
          `Pattern for "${action.title}" should match Django model class`
        );
      }
    });
  });

  suite('Code Actions', () => {
    test('has 4 codeActions', () => {
      const plugin = new DjangoPlugin();
      assert.ok(Array.isArray(plugin.codeActions));
      assert.strictEqual(plugin.codeActions!.length, 4);
    });

    test('all codeActions have required fields', () => {
      const plugin = new DjangoPlugin();
      for (const action of plugin.codeActions!) {
        assert.ok(typeof action.title   === 'string', 'title missing');
        assert.ok(typeof action.command === 'string', 'command missing');
        assert.ok(action.kind === 'quickfix' || action.kind === 'refactor', 'invalid kind');
        assert.ok(Array.isArray(action.languages),   'languages must be array');
      }
    });
  });

  suite('Transforms', () => {
    test('has 3 transforms', () => {
      const plugin = new DjangoPlugin();
      assert.ok(plugin.transforms, 'transforms should be defined');
      assert.strictEqual(plugin.transforms!.length, 3);
    });

    test('all transforms have required fields', () => {
      const plugin = new DjangoPlugin();
      for (const t of plugin.transforms!) {
        assert.ok(typeof t.label       === 'string',   'label missing');
        assert.ok(typeof t.description === 'string',   'description missing');
        assert.ok(Array.isArray(t.extensions),         'extensions must be array');
        assert.ok(typeof t.apply       === 'function', 'apply must be function');
      }
    });

    test('all transforms target .py files', () => {
      const plugin = new DjangoPlugin();
      for (const t of plugin.transforms!) {
        assert.ok(t.extensions.includes('.py'), `Transform "${t.label}" should include .py`);
      }
    });
  });

  suite('Templates', () => {
    test('has 4 templates', () => {
      const plugin = new DjangoPlugin();
      assert.ok(plugin.templates, 'templates should be defined');
      assert.strictEqual(plugin.templates!.length, 4);
    });

    test('all templates have required fields', () => {
      const plugin = new DjangoPlugin();
      for (const t of plugin.templates!) {
        assert.ok(typeof t.label       === 'string',   'label missing');
        assert.ok(typeof t.description === 'string',   'description missing');
        assert.ok(typeof t.prompt      === 'function', 'prompt must be function');
      }
    });

    test('template prompts return non-empty strings', () => {
      const plugin = new DjangoPlugin();
      for (const t of plugin.templates!) {
        const result = t.prompt('/workspace/test');
        assert.ok(typeof result === 'string' && result.length > 0,
          `Template "${t.label}" prompt returned empty`);
      }
    });
  });

  suite('Status Item', () => {
    test('has statusItem defined', () => {
      const plugin = new DjangoPlugin();
      assert.ok(plugin.statusItem, 'statusItem should be defined');
    });

    test('statusItem.text() returns a non-empty string', async () => {
      const plugin = new DjangoPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(typeof text === 'string' && text.length > 0,
        'statusItem.text() should return non-empty string');
    });

    test('statusItem.text() contains globe icon', async () => {
      const plugin = new DjangoPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(text.includes('$(globe)'), 'statusItem should include globe icon');
    });

    test('statusItem.text() contains "Django"', async () => {
      const plugin = new DjangoPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(text.includes('Django'), 'statusItem should include "Django"');
    });
  });
});
