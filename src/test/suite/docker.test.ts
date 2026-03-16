/**
 * test/suite/docker.test.ts — Unit tests for the Docker plugin
 */

import * as assert from 'assert';
import * as path   from 'path';
import * as fs     from 'fs';
import * as os     from 'os';
import { DockerPlugin } from '../../plugins/docker';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docker-test-'));
}

function makeWorkspaceFolder(fsPath: string): any {
  return { uri: { fsPath }, name: path.basename(fsPath), index: 0 };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('DockerPlugin', () => {
  let plugin: DockerPlugin;

  setup(() => {
    plugin = new DockerPlugin();
  });

  // ── Identity ───────────────────────────────────────────────────────────────

  suite('identity', () => {
    test('id is docker', () => {
      assert.strictEqual(plugin.id, 'docker');
    });

    test('displayName is Docker', () => {
      assert.strictEqual(plugin.displayName, 'Docker');
    });

    test('icon is $(package)', () => {
      assert.strictEqual(plugin.icon, '$(package)');
    });
  });

  // ── detect() ──────────────────────────────────────────────────────────────

  suite('detect()', () => {
    test('returns false when workspace is undefined', async () => {
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, false);
    });

    test('returns false for empty directory with no Docker markers', async () => {
      const tmpDir = makeTmpDir();
      try {
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, false);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when Dockerfile is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(
          path.join(tmpDir, 'Dockerfile'),
          'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["node","index.js"]\n'
        );
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when docker-compose.yml is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(
          path.join(tmpDir, 'docker-compose.yml'),
          'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "80:80"\n'
        );
        const ws = makeWorkspaceFolder(tmpDir);
        const result = await plugin.detect(ws);
        assert.strictEqual(result, true);
      } finally {
        fs.rmdirSync(tmpDir, { recursive: true });
      }
    });

    test('returns true when .dockerignore is present', async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, '.dockerignore'), 'node_modules\n.git\n');
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
    test('contains multi-stage term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(
        prompt.toLowerCase().includes('multi-stage') || prompt.toLowerCase().includes('multistage'),
        'Expected multi-stage in system prompt'
      );
    });

    test('contains HEALTHCHECK term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('HEALTHCHECK'), 'Expected "HEALTHCHECK" in system prompt');
    });

    test('contains layer term', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('layer'), 'Expected "layer" in system prompt');
    });

    test('contains USER instruction reference', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.includes('USER'), 'Expected "USER" in system prompt');
    });

    test('contains Docker Compose reference', () => {
      const prompt = plugin.systemPromptSection!();
      assert.ok(prompt.toLowerCase().includes('compose'), 'Expected "compose" in system prompt');
    });
  });

  // ── commands ──────────────────────────────────────────────────────────────

  suite('commands', () => {
    test('has exactly 6 commands', () => {
      assert.strictEqual(plugin.commands!.length, 6);
    });

    test('first command is aiForge.docker.explainDockerfile', () => {
      assert.strictEqual(plugin.commands![0].id, 'aiForge.docker.explainDockerfile');
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

    test('command IDs all start with aiForge.docker.', () => {
      for (const cmd of plugin.commands!) {
        assert.ok(cmd.id.startsWith('aiForge.docker.'), `Expected command ID to start with aiForge.docker.: ${cmd.id}`);
      }
    });
  });
});
