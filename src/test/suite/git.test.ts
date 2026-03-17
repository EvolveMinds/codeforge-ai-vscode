/**
 * test/suite/git.test.ts — Unit tests for the Git plugin
 *
 * Tests plugin identity, detection logic, system prompt content,
 * command count, and status item format without requiring a live
 * VS Code instance or a real git repository.
 */

import * as assert from 'assert';
import * as path   from 'path';
import * as os     from 'os';
import * as fs     from 'fs';
import { GitPlugin } from '../../plugins/git';

suite('GitPlugin', () => {

  let plugin: GitPlugin;

  setup(() => {
    plugin = new GitPlugin();
  });

  // ── Identity ──────────────────────────────────────────────────────────────

  suite('identity', () => {
    test('id is "git"', () => {
      assert.strictEqual(plugin.id, 'git');
    });

    test('displayName is "Git"', () => {
      assert.strictEqual(plugin.displayName, 'Git');
    });

    test('icon is "$(git-branch)"', () => {
      assert.strictEqual(plugin.icon, '$(git-branch)');
    });
  });

  // ── Detection ─────────────────────────────────────────────────────────────

  suite('detect()', () => {
    test('returns false when workspace is undefined', async () => {
      const result = await plugin.detect(undefined);
      assert.strictEqual(result, false);
    });

    test('returns true when .git/ directory exists', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-ai-git-test-'));
      try {
        const gitDir = path.join(tmpDir, '.git');
        fs.mkdirSync(gitDir);

        const fakeWs = {
          uri:   { fsPath: tmpDir } as any,
          name:  'test',
          index: 0,
        };
        const result = await plugin.detect(fakeWs as any);
        assert.strictEqual(result, true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('returns false when .git/ directory does not exist', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-ai-git-nodir-'));
      try {
        const fakeWs = {
          uri:   { fsPath: tmpDir } as any,
          name:  'test',
          index: 0,
        };
        const result = await plugin.detect(fakeWs as any);
        assert.strictEqual(result, false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ── System prompt ─────────────────────────────────────────────────────────

  suite('systemPromptSection()', () => {
    test('contains conventional commits text', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('Conventional Commits'), 'Should mention Conventional Commits');
    });

    test('contains feat and fix commit types', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('feat'), 'Should mention feat type');
      assert.ok(prompt.includes('fix'),  'Should mention fix type');
    });

    test('contains branch naming conventions', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.toLowerCase().includes('branch'), 'Should include branch naming');
    });

    test('contains PR best practices', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.toLowerCase().includes('pull request') || prompt.toLowerCase().includes('pr'),
        'Should include PR guidance'
      );
    });

    test('contains git workflow information', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(
        prompt.includes('trunk') || prompt.includes('GitHub Flow') || prompt.includes('Gitflow'),
        'Should mention at least one git workflow pattern'
      );
    });

    test('contains .gitignore patterns', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.includes('.gitignore'), 'Should mention .gitignore patterns');
    });

    test('returns a non-trivially long string (~2KB)', () => {
      const prompt = plugin.systemPromptSection();
      assert.ok(prompt.length > 1000, `Prompt should be > 1000 chars, got ${prompt.length}`);
    });
  });

  // ── Commands ──────────────────────────────────────────────────────────────

  suite('commands', () => {
    test('has exactly 4 commands', () => {
      assert.strictEqual(plugin.commands?.length, 4);
    });

    test('command IDs are correct', () => {
      const ids = (plugin.commands ?? []).map(c => c.id);
      assert.ok(ids.includes('aiForge.git.blame'),         'Should include blame command');
      assert.ok(ids.includes('aiForge.git.changelog'),     'Should include changelog command');
      assert.ok(ids.includes('aiForge.git.commitMessage'), 'Should include commitMessage command');
      assert.ok(ids.includes('aiForge.git.prTemplate'),    'Should include prTemplate command');
    });
  });

  // ── Context hooks ─────────────────────────────────────────────────────────

  suite('contextHooks', () => {
    test('has exactly 2 context hooks', () => {
      assert.strictEqual(plugin.contextHooks?.length, 2);
    });

    test('first hook key is "git.status"', () => {
      assert.strictEqual(plugin.contextHooks?.[0]?.key, 'git.status');
    });

    test('second hook key is "git.recentCommits"', () => {
      assert.strictEqual(plugin.contextHooks?.[1]?.key, 'git.recentCommits');
    });

    test('git.status format returns branch info', () => {
      const hook = plugin.contextHooks?.[0];
      if (!hook) { assert.fail('hook is undefined'); }
      const formatted = hook.format({
        branch:    'main',
        modified:  2,
        staged:    1,
        untracked: 0,
        remoteUrl: 'https://github.com/example/repo.git',
      });
      assert.ok(formatted.includes('main'),   'Should include branch name');
      assert.ok(formatted.includes('Staged'), 'Should mention staged changes');
    });

    test('git.recentCommits format returns commit list', () => {
      const hook = plugin.contextHooks?.[1];
      if (!hook) { assert.fail('hook is undefined'); }
      const formatted = hook.format({
        commits: ['abc1234 feat: add login', 'def5678 fix: resolve null pointer'],
      });
      assert.ok(formatted.includes('feat: add login'), 'Should include commit messages');
    });
  });

  // ── Status item ───────────────────────────────────────────────────────────

  suite('statusItem', () => {
    test('statusItem is defined', () => {
      assert.ok(plugin.statusItem, 'statusItem should be defined');
    });

    test('statusItem.text is a function', () => {
      assert.strictEqual(typeof plugin.statusItem?.text, 'function');
    });
  });
});
