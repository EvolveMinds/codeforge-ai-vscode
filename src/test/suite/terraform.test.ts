/**
 * test/suite/terraform.test.ts — Unit tests for the Terraform plugin
 */

import * as assert from 'assert';
import * as path   from 'path';
import * as fs     from 'fs';
import * as os     from 'os';
import { TerraformPlugin } from '../../plugins/terraform';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-test-'));
}

function makeWorkspaceFolder(fsPath: string): any {
  return { uri: { fsPath }, name: path.basename(fsPath), index: 0 };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('TerraformPlugin', () => {
  let plugin: TerraformPlugin;

  setup(() => {
    plugin = new TerraformPlugin();
  });

  // ── Identity ───────────────────────────────────────────────────────────────

  suite('identity', () => {
    test('id is terraform', () => {
      assert.strictEqual(plugin.id, 'terraform');
    });

    test('displayName is Terraform', () => {
      assert.strictEqual(plugin.displayName, 'Terraform');
    });

    test('icon is $(cloud-upload)', () => {
      assert.strictEqual(plugin.icon, '$(cloud-upload)');
    });
  });

  // ── detect() ──────────────────────────────────────────────────────────────

  suite('detect()', () => {
    test('returns false when workspace is undefined', async () => {
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, false);
    });

    test('returns false for empty directory with no markers', async () => {
      const tmpDir = makeTmpDir();
      try {
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, false);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when .tf file is present in root', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'main.tf'), 'resource "aws_s3_bucket" "example" {}');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when .tfvars file is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'terraform.tfvars'), 'environment = "prod"');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when .terraform directory is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.mkdirSync(path.join(tmpDir, '.terraform'));
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when terragrunt.hcl is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'terragrunt.hcl'), 'remote_state {}');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });
  });

  // ── systemPromptSection() ──────────────────────────────────────────────────

  suite('systemPromptSection()', () => {
    test('contains HCL', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('HCL'), 'Expected "HCL" in system prompt');
    });

    test('contains resource', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('resource'), 'Expected "resource" in system prompt');
    });

    test('contains provider', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('provider'), 'Expected "provider" in system prompt');
    });

    test('contains variable', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('variable'), 'Expected "variable" in system prompt');
    });

    test('contains Terragrunt', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('Terragrunt'), 'Expected "Terragrunt" in system prompt');
    });
  });

  // ── commands ──────────────────────────────────────────────────────────────

  suite('commands', () => {
    test('has exactly 6 commands', () => {
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('first command is aiForge.terraform.explainResource', () => {
      assert.strictEqual(plugin.commands![0].id, 'aiForge.terraform.explainResource');
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
  });
});
