/**
 * test/suite/jupyter.test.ts — Unit tests for the Jupyter plugin
 */

import * as assert from 'assert';
import * as path   from 'path';
import * as fs     from 'fs';
import * as os     from 'os';
import { JupyterPlugin } from '../../plugins/jupyter';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jupyter-test-'));
}

function makeWorkspaceFolder(fsPath: string): any {
  return { uri: { fsPath }, name: path.basename(fsPath), index: 0 };
}

function makeMinimalNotebook(kernelName = 'python3'): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: kernelName, display_name: 'Python 3', language: 'python' },
      language_info: { name: 'python', version: '3.10.0' },
    },
    cells: [
      { cell_type: 'markdown', source: ['# Title'], metadata: {}, outputs: [] },
      { cell_type: 'code', source: ['import pandas as pd'], metadata: {}, outputs: [], execution_count: 1 },
      { cell_type: 'code', source: ['df = pd.DataFrame()'], metadata: {}, outputs: [], execution_count: 2 },
    ],
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('JupyterPlugin', () => {
  let plugin: JupyterPlugin;

  setup(() => {
    plugin = new JupyterPlugin();
  });

  // ── Identity ───────────────────────────────────────────────────────────────

  suite('identity', () => {
    test('id is jupyter', () => {
      assert.strictEqual(plugin.id, 'jupyter');
    });

    test('displayName is Jupyter', () => {
      assert.strictEqual(plugin.displayName, 'Jupyter');
    });

    test('icon is $(notebook)', () => {
      assert.strictEqual(plugin.icon, '$(notebook)');
    });
  });

  // ── detect() ──────────────────────────────────────────────────────────────

  suite('detect()', () => {
    test('returns false when workspace is undefined', async () => {
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, false);
    });

    test('returns false for empty directory with no Jupyter markers', async () => {
      const tmpDir = makeTmpDir();
      try {
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, false);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when .ipynb file is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'analysis.ipynb'), makeMinimalNotebook());
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when jupyter_notebook_config.py is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'jupyter_notebook_config.py'), '# Jupyter config\n');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });
  });

  // ── systemPromptSection() ─────────────────────────────────────────────────

  suite('systemPromptSection()', () => {
    test('contains cell term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('cell'), 'Expected "cell" in system prompt');
    });

    test('contains kernel term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('kernel'), 'Expected "kernel" in system prompt');
    });

    test('contains magic term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('magic') || prompt.includes('%timeit'), 'Expected magic command reference in system prompt');
    });

    test('contains papermill term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('papermill'), 'Expected "papermill" in system prompt');
    });

    test('contains ipywidgets term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('ipywidgets') || prompt.toLowerCase().includes('widget'), 'Expected widgets reference in system prompt');
    });
  });

  // ── commands ──────────────────────────────────────────────────────────────

  suite('commands', () => {
    test('has exactly 5 commands', () => {
      assert.strictEqual(plugin.commands!.length, 5);
    });

    test('first command is aiForge.jupyter.explainNotebook', () => {
      assert.strictEqual(plugin.commands![0].id, 'aiForge.jupyter.explainNotebook');
    });

    test('all commands have handler functions', () => {
      for (const cmd of plugin.commands!) {
        assert.strictEqual(typeof cmd.handler, 'function', `Command ${cmd.id} missing handler`);
      }
    });

    test('all commands have non-empty titles', () => {
      for (const cmd of plugin.commands!) {
        assert.ok(cmd.title.length > 0, `Command ${cmd.id} has empty title`);
      }
    });

    test('command IDs all start with aiForge.jupyter.', () => {
      for (const cmd of plugin.commands!) {
        assert.ok(cmd.id.startsWith('aiForge.jupyter.'), `Expected command ID to start with aiForge.jupyter.: ${cmd.id}`);
      }
    });
  });
});
