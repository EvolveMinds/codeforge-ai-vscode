/**
 * test/suite/kubernetes.test.ts — Unit tests for the Kubernetes plugin
 */

import * as assert from 'assert';
import * as path   from 'path';
import * as fs     from 'fs';
import * as os     from 'os';
import { KubernetesPlugin } from '../../plugins/kubernetes';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'k8s-test-'));
}

function makeWorkspaceFolder(fsPath: string): any {
  return { uri: { fsPath }, name: path.basename(fsPath), index: 0 };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('KubernetesPlugin', () => {
  let plugin: KubernetesPlugin;

  setup(() => {
    plugin = new KubernetesPlugin();
  });

  // ── Identity ───────────────────────────────────────────────────────────────

  suite('identity', () => {
    test('id is kubernetes', () => {
      assert.strictEqual(plugin.id, 'kubernetes');
    });

    test('displayName is Kubernetes', () => {
      assert.strictEqual(plugin.displayName, 'Kubernetes');
    });

    test('icon is $(server-process)', () => {
      assert.strictEqual(plugin.icon, '$(server-process)');
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

    test('returns true when YAML file contains apiVersion and kind', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(
          path.join(tmpDir, 'deployment.yaml'),
          'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n'
        );
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when Chart.yaml is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(
          path.join(tmpDir, 'Chart.yaml'),
          'name: my-chart\nversion: 1.0.0\napiVersion: v2\n'
        );
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when kustomization.yaml is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'kustomization.yaml'), 'resources:\n  - base\n');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns false for YAML without apiVersion+kind', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'server:\n  port: 8080\n');
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, false);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });
  });

  // ── systemPromptSection() ─────────────────────────────────────────────────

  suite('systemPromptSection()', () => {
    test('contains Pod', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('Pod'), 'Expected "Pod" in system prompt');
    });

    test('contains Deployment', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('Deployment'), 'Expected "Deployment" in system prompt');
    });

    test('contains probe', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('probe'), 'Expected "probe" in system prompt');
    });

    test('contains Helm', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('Helm'), 'Expected "Helm" in system prompt');
    });

    test('contains RBAC', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('RBAC'), 'Expected "RBAC" in system prompt');
    });
  });

  // ── commands ──────────────────────────────────────────────────────────────

  suite('commands', () => {
    test('has exactly 6 commands', () => {
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('first command is aiForge.k8s.explainResource', () => {
      assert.strictEqual(plugin.commands![0].id, 'aiForge.k8s.explainResource');
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

    test('command IDs all start with aiForge.k8s.', () => {
      for (const cmd of plugin.commands!) {
        assert.ok(cmd.id.startsWith('aiForge.k8s.'), `Expected command ID to start with aiForge.k8s.: ${cmd.id}`);
      }
    });
  });
});
