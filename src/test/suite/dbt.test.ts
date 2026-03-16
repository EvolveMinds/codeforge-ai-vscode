/**
 * test/suite/dbt.test.ts — Unit tests for the dbt plugin
 *
 * Tests run without a live VS Code instance — pure logic checks on the
 * plugin's identity, structure, and configuration.
 */

import * as assert from 'assert';
import { DbtPlugin } from '../../plugins/dbt';

suite('DbtPlugin', () => {

  suite('Identity', () => {
    test('has correct id', () => {
      const plugin = new DbtPlugin();
      assert.strictEqual(plugin.id, 'dbt');
    });

    test('has correct displayName', () => {
      const plugin = new DbtPlugin();
      assert.strictEqual(plugin.displayName, 'dbt');
    });

    test('has correct icon', () => {
      const plugin = new DbtPlugin();
      assert.strictEqual(plugin.icon, '$(database)');
    });
  });

  suite('Detection', () => {
    test('returns false when workspace is undefined', async () => {
      const plugin = new DbtPlugin();
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, false);
    });

    // Note: detect() with a real workspace folder is tested via integration tests.
    // Unit-level detection logic is validated by the helper function behaviour.
  });

  suite('System Prompt Section', () => {
    test('contains "ref" keyword', () => {
      const plugin = new DbtPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('ref('), `Expected "ref(" in system prompt`);
    });

    test('contains "source" keyword', () => {
      const plugin = new DbtPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('source('), `Expected "source(" in system prompt`);
    });

    test('contains "materialization" keyword', () => {
      const plugin = new DbtPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('materialization') || prompt.toLowerCase().includes('materialized'),
        `Expected materialization content in system prompt`
      );
    });

    test('contains "incremental" keyword', () => {
      const plugin = new DbtPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('incremental'), `Expected "incremental" in system prompt`);
    });

    test('contains "is_incremental" keyword', () => {
      const plugin = new DbtPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('is_incremental'), `Expected "is_incremental" in system prompt`);
    });

    test('returns a non-empty string', () => {
      const plugin = new DbtPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(typeof prompt === 'string' && prompt.length > 100);
    });
  });

  suite('Commands', () => {
    test('has exactly 6 commands', () => {
      const plugin = new DbtPlugin();
      assert.ok(plugin.commands, 'commands array should be defined');
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('all commands start with aiForge.dbt.', () => {
      const plugin = new DbtPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(
          cmd.id.startsWith('aiForge.dbt.'),
          `Command "${cmd.id}" should start with "aiForge.dbt."`
        );
      }
    });

    test('contains explainModel command', () => {
      const plugin = new DbtPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.dbt.explainModel'), 'missing aiForge.dbt.explainModel');
    });

    test('contains addTest command', () => {
      const plugin = new DbtPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.dbt.addTest'), 'missing aiForge.dbt.addTest');
    });

    test('contains convertIncremental command', () => {
      const plugin = new DbtPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.dbt.convertIncremental'), 'missing aiForge.dbt.convertIncremental');
    });

    test('contains generateDocs command', () => {
      const plugin = new DbtPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.dbt.generateDocs'), 'missing aiForge.dbt.generateDocs');
    });

    test('contains optimiseModel command', () => {
      const plugin = new DbtPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.dbt.optimiseModel'), 'missing aiForge.dbt.optimiseModel');
    });

    test('contains addSourceYaml command', () => {
      const plugin = new DbtPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.dbt.addSourceYaml'), 'missing aiForge.dbt.addSourceYaml');
    });

    test('all commands have handlers', () => {
      const plugin = new DbtPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(typeof cmd.handler === 'function', `Command "${cmd.id}" missing handler`);
      }
    });
  });

  suite('Context Hooks', () => {
    test('has contextHooks defined', () => {
      const plugin = new DbtPlugin();
      assert.ok(Array.isArray(plugin.contextHooks), 'contextHooks should be an array');
    });

    test('has dbt.project hook', () => {
      const plugin = new DbtPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('dbt.project'), 'missing dbt.project hook');
    });

    test('has dbt.models hook', () => {
      const plugin = new DbtPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('dbt.models'), 'missing dbt.models hook');
    });

    test('has dbt.sources hook', () => {
      const plugin = new DbtPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('dbt.sources'), 'missing dbt.sources hook');
    });

    test('all hooks have collect and format functions', () => {
      const plugin = new DbtPlugin();
      for (const hook of plugin.contextHooks!) {
        assert.ok(typeof hook.collect === 'function', `Hook "${hook.key}" missing collect()`);
        assert.ok(typeof hook.format === 'function', `Hook "${hook.key}" missing format()`);
      }
    });
  });

  suite('Code Lens Actions', () => {
    test('has codeLensActions defined', () => {
      const plugin = new DbtPlugin();
      assert.ok(Array.isArray(plugin.codeLensActions));
    });

    test('all codeLensActions have required fields', () => {
      const plugin = new DbtPlugin();
      for (const action of plugin.codeLensActions!) {
        assert.ok(typeof action.title === 'string', `title missing on action`);
        assert.ok(typeof action.command === 'string', `command missing on action`);
        assert.ok(action.linePattern instanceof RegExp, `linePattern must be a RegExp`);
        assert.ok(Array.isArray(action.languages), `languages must be an array`);
      }
    });
  });

  suite('Transforms', () => {
    test('has 3 transforms', () => {
      const plugin = new DbtPlugin();
      assert.ok(plugin.transforms, 'transforms should be defined');
      assert.strictEqual(plugin.transforms!.length, 3);
    });

    test('all transforms have required fields', () => {
      const plugin = new DbtPlugin();
      for (const t of plugin.transforms!) {
        assert.ok(typeof t.label === 'string', `label missing`);
        assert.ok(typeof t.description === 'string', `description missing`);
        assert.ok(Array.isArray(t.extensions), `extensions must be array`);
        assert.ok(typeof t.apply === 'function', `apply must be function`);
      }
    });
  });

  suite('Templates', () => {
    test('has 3 templates', () => {
      const plugin = new DbtPlugin();
      assert.ok(plugin.templates, 'templates should be defined');
      assert.strictEqual(plugin.templates!.length, 3);
    });

    test('all templates have required fields', () => {
      const plugin = new DbtPlugin();
      for (const t of plugin.templates!) {
        assert.ok(typeof t.label === 'string', `label missing`);
        assert.ok(typeof t.description === 'string', `description missing`);
        assert.ok(typeof t.prompt === 'function', `prompt must be function`);
      }
    });

    test('template prompts return non-empty strings', () => {
      const plugin = new DbtPlugin();
      for (const t of plugin.templates!) {
        const result = t.prompt('/workspace/test');
        assert.ok(typeof result === 'string' && result.length > 0, `Template "${t.label}" prompt returned empty`);
      }
    });
  });

  suite('Status Item', () => {
    test('has statusItem defined', () => {
      const plugin = new DbtPlugin();
      assert.ok(plugin.statusItem, 'statusItem should be defined');
    });

    test('statusItem.text() returns a string', async () => {
      const plugin = new DbtPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(typeof text === 'string' && text.length > 0, 'statusItem.text() should return non-empty string');
    });
  });
});
