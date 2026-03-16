/**
 * test/suite/pytorch.test.ts — Unit tests for the PyTorch plugin
 */

import * as assert from 'assert';
import * as path   from 'path';
import * as fs     from 'fs';
import * as os     from 'os';
import { PyTorchPlugin } from '../../plugins/pytorch';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pytorch-test-'));
}

function makeWorkspaceFolder(fsPath: string): any {
  return { uri: { fsPath }, name: path.basename(fsPath), index: 0 };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('PyTorchPlugin', () => {
  let plugin: PyTorchPlugin;

  setup(() => {
    plugin = new PyTorchPlugin();
  });

  // ── Identity ──────────────────────────────────────────────────────────────

  suite('identity', () => {
    test('id is pytorch', () => {
      assert.strictEqual(plugin.id, 'pytorch');
    });

    test('displayName is PyTorch', () => {
      assert.strictEqual(plugin.displayName, 'PyTorch');
    });

    test('icon is $(flame)', () => {
      assert.strictEqual(plugin.icon, '$(flame)');
    });
  });

  // ── detect() ─────────────────────────────────────────────────────────────

  suite('detect()', () => {
    test('returns false when workspace is undefined', async () => {
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, false);
    });

    test('returns false for empty directory with no PyTorch markers', async () => {
      const tmpDir = makeTmpDir();
      try {
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, false);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when torch is in requirements.txt', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'torch==2.1.0\ntorchvision\n');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when Python file contains import torch', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'model.py'), 'import torch\nimport torch.nn as nn\n');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when Python file uses from torch import', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'train.py'), 'from torch import nn, optim\n');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });
  });

  // ── systemPromptSection() ────────────────────────────────────────────────

  suite('systemPromptSection()', () => {
    test('contains nn.Module term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('nn.Module'), 'Expected "nn.Module" in system prompt');
    });

    test('contains autograd or gradient term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(
        prompt.toLowerCase().includes('autograd') || prompt.toLowerCase().includes('gradient'),
        'Expected autograd/gradient reference in system prompt'
      );
    });

    test('contains DataLoader term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('DataLoader'), 'Expected "DataLoader" in system prompt');
    });

    test('contains optimizer term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(
        prompt.toLowerCase().includes('optimizer') || prompt.includes('AdamW'),
        'Expected optimizer reference in system prompt'
      );
    });

    test('contains mixed precision term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(
        prompt.includes('autocast') || prompt.includes('GradScaler') || prompt.toLowerCase().includes('mixed precision'),
        'Expected mixed precision reference in system prompt'
      );
    });
  });

  // ── commands ─────────────────────────────────────────────────────────────

  suite('commands', () => {
    test('has exactly 6 commands', () => {
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('first command is aiForge.pytorch.explainModel', () => {
      assert.strictEqual(plugin.commands![0].id, 'aiForge.pytorch.explainModel');
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

    test('command IDs all start with aiForge.pytorch.', () => {
      for (const cmd of plugin.commands!) {
        assert.ok(
          cmd.id.startsWith('aiForge.pytorch.'),
          `Expected command ID to start with aiForge.pytorch.: ${cmd.id}`
        );
      }
    });
  });
});
