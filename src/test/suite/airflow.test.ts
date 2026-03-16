/**
 * test/suite/airflow.test.ts — Unit tests for the Airflow plugin
 *
 * Tests run without a live VS Code instance — pure logic checks on the
 * plugin's identity, structure, and configuration.
 */

import * as assert from 'assert';
import { AirflowPlugin } from '../../plugins/airflow';

suite('AirflowPlugin', () => {

  suite('Identity', () => {
    test('has correct id', () => {
      const plugin = new AirflowPlugin();
      assert.strictEqual(plugin.id, 'airflow');
    });

    test('has correct displayName', () => {
      const plugin = new AirflowPlugin();
      assert.strictEqual(plugin.displayName, 'Apache Airflow');
    });

    test('has correct icon', () => {
      const plugin = new AirflowPlugin();
      assert.strictEqual(plugin.icon, '$(play-circle)');
    });
  });

  suite('Detection', () => {
    test('returns false when workspace is undefined', async () => {
      const plugin = new AirflowPlugin();
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, false);
    });

    // Note: detect() with real filesystem markers is validated via integration tests.
    // Unit-level validation checks the detection logic structure indirectly.
  });

  suite('System Prompt Section', () => {
    test('returns a non-empty string', () => {
      const plugin = new AirflowPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(typeof prompt === 'string' && prompt.length > 100);
    });

    test('contains TaskFlow keyword', () => {
      const plugin = new AirflowPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('TaskFlow') || prompt.includes('@task'),
        'Expected TaskFlow API content in system prompt'
      );
    });

    test('contains @task decorator reference', () => {
      const plugin = new AirflowPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('@task'), 'Expected "@task" in system prompt');
    });

    test('contains operator keyword', () => {
      const plugin = new AirflowPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('operator'),
        'Expected "operator" content in system prompt'
      );
    });

    test('contains sensor keyword', () => {
      const plugin = new AirflowPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('sensor'),
        'Expected "sensor" content in system prompt'
      );
    });

    test('contains XCom keyword', () => {
      const plugin = new AirflowPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('XCom') || prompt.includes('xcom'),
        'Expected XCom content in system prompt'
      );
    });

    test('contains scheduling keyword', () => {
      const plugin = new AirflowPlugin();
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('schedule'),
        'Expected scheduling content in system prompt'
      );
    });
  });

  suite('Commands', () => {
    test('has exactly 6 commands', () => {
      const plugin = new AirflowPlugin();
      assert.ok(plugin.commands, 'commands array should be defined');
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('all commands start with aiForge.airflow.', () => {
      const plugin = new AirflowPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(
          cmd.id.startsWith('aiForge.airflow.'),
          `Command "${cmd.id}" should start with "aiForge.airflow."`
        );
      }
    });

    test('contains explainDag command', () => {
      const plugin = new AirflowPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.airflow.explainDag'), 'missing aiForge.airflow.explainDag');
    });

    test('contains convertToTaskflow command', () => {
      const plugin = new AirflowPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.airflow.convertToTaskflow'), 'missing aiForge.airflow.convertToTaskflow');
    });

    test('contains addSensor command', () => {
      const plugin = new AirflowPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.airflow.addSensor'), 'missing aiForge.airflow.addSensor');
    });

    test('contains addRetryPolicy command', () => {
      const plugin = new AirflowPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.airflow.addRetryPolicy'), 'missing aiForge.airflow.addRetryPolicy');
    });

    test('contains generateDag command', () => {
      const plugin = new AirflowPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.airflow.generateDag'), 'missing aiForge.airflow.generateDag');
    });

    test('contains addMonitoring command', () => {
      const plugin = new AirflowPlugin();
      const ids = plugin.commands!.map(c => c.id);
      assert.ok(ids.includes('aiForge.airflow.addMonitoring'), 'missing aiForge.airflow.addMonitoring');
    });

    test('all commands have handlers', () => {
      const plugin = new AirflowPlugin();
      for (const cmd of plugin.commands!) {
        assert.ok(typeof cmd.handler === 'function', `Command "${cmd.id}" missing handler`);
      }
    });
  });

  suite('Context Hooks', () => {
    test('has contextHooks defined', () => {
      const plugin = new AirflowPlugin();
      assert.ok(Array.isArray(plugin.contextHooks), 'contextHooks should be an array');
    });

    test('has airflow.dags hook', () => {
      const plugin = new AirflowPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('airflow.dags'), 'missing airflow.dags hook');
    });

    test('has airflow.config hook', () => {
      const plugin = new AirflowPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('airflow.config'), 'missing airflow.config hook');
    });

    test('has airflow.operators hook', () => {
      const plugin = new AirflowPlugin();
      const keys = plugin.contextHooks!.map(h => h.key);
      assert.ok(keys.includes('airflow.operators'), 'missing airflow.operators hook');
    });

    test('all hooks have collect and format functions', () => {
      const plugin = new AirflowPlugin();
      for (const hook of plugin.contextHooks!) {
        assert.ok(typeof hook.collect === 'function', `Hook "${hook.key}" missing collect()`);
        assert.ok(typeof hook.format === 'function',  `Hook "${hook.key}" missing format()`);
      }
    });
  });

  suite('Code Lens Actions', () => {
    test('has codeLensActions defined', () => {
      const plugin = new AirflowPlugin();
      assert.ok(Array.isArray(plugin.codeLensActions));
    });

    test('has 3 codeLensActions', () => {
      const plugin = new AirflowPlugin();
      assert.strictEqual(plugin.codeLensActions!.length, 3);
    });

    test('all codeLensActions have required fields', () => {
      const plugin = new AirflowPlugin();
      for (const action of plugin.codeLensActions!) {
        assert.ok(typeof action.title === 'string',      'title missing on action');
        assert.ok(typeof action.command === 'string',    'command missing on action');
        assert.ok(action.linePattern instanceof RegExp,  'linePattern must be a RegExp');
        assert.ok(Array.isArray(action.languages),       'languages must be an array');
      }
    });
  });

  suite('Transforms', () => {
    test('has 2 transforms', () => {
      const plugin = new AirflowPlugin();
      assert.ok(plugin.transforms, 'transforms should be defined');
      assert.strictEqual(plugin.transforms!.length, 2);
    });

    test('all transforms have required fields', () => {
      const plugin = new AirflowPlugin();
      for (const t of plugin.transforms!) {
        assert.ok(typeof t.label === 'string',       'label missing');
        assert.ok(typeof t.description === 'string', 'description missing');
        assert.ok(Array.isArray(t.extensions),       'extensions must be array');
        assert.ok(typeof t.apply === 'function',     'apply must be function');
      }
    });
  });

  suite('Templates', () => {
    test('has 3 templates', () => {
      const plugin = new AirflowPlugin();
      assert.ok(plugin.templates, 'templates should be defined');
      assert.strictEqual(plugin.templates!.length, 3);
    });

    test('all templates have required fields', () => {
      const plugin = new AirflowPlugin();
      for (const t of plugin.templates!) {
        assert.ok(typeof t.label === 'string',       'label missing');
        assert.ok(typeof t.description === 'string', 'description missing');
        assert.ok(typeof t.prompt === 'function',    'prompt must be function');
      }
    });

    test('template prompts return non-empty strings', () => {
      const plugin = new AirflowPlugin();
      for (const t of plugin.templates!) {
        const result = t.prompt('/workspace/test');
        assert.ok(
          typeof result === 'string' && result.length > 0,
          `Template "${t.label}" prompt returned empty`
        );
      }
    });
  });

  suite('Status Item', () => {
    test('has statusItem defined', () => {
      const plugin = new AirflowPlugin();
      assert.ok(plugin.statusItem, 'statusItem should be defined');
    });

    test('statusItem.text() returns a non-empty string', async () => {
      const plugin = new AirflowPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(
        typeof text === 'string' && text.length > 0,
        'statusItem.text() should return non-empty string'
      );
    });

    test('statusItem.text() contains play-circle icon', async () => {
      const plugin = new AirflowPlugin();
      const text = await plugin.statusItem!.text();
      assert.ok(text.includes('$(play-circle)'), 'statusItem should include the play-circle icon');
    });
  });
});
