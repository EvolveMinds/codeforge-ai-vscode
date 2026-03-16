/**
 * test/suite/workspaceService.test.ts — Unit tests for WorkspaceService logic
 *
 * Tests that can run without VS Code APIs use MockWorkspaceService or the
 * real WorkspaceService's pure methods accessed via a subclass test wrapper.
 *
 * For isSafePath and shellEscape (module-private helpers), we test them
 * indirectly through parseMultiFileOutput and getRuntimeCommand, which are the
 * public surfaces that exercise those helpers.
 */

import * as assert from 'assert';
import { MockWorkspaceService } from '../mocks';
import { WorkspaceService, EXT_LANG } from '../../core/workspaceService';
import { MockAIService, MockContextService, MockEventBus } from '../mocks';
import { PluginRegistry } from '../../core/plugin';
import * as vscode from 'vscode';

// ── Test subclass to expose pure methods without needing full VS Code context ──

function makeWorkspaceService(): WorkspaceService {
  const bus      = new MockEventBus();
  const registry = new PluginRegistry(bus as unknown as import('../../core/eventBus').EventBus);
  const ai       = new MockAIService();
  const context  = new MockContextService();
  const vsCtx    = {
    subscriptions:    [],
    globalStorageUri: vscode.Uri.file('/tmp/aiforge-test'),
  } as unknown as vscode.ExtensionContext;

  return new WorkspaceService(
    registry,
    ai,
    context,
    vsCtx,
    bus as unknown as import('../../core/eventBus').EventBus
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite('WorkspaceService', () => {

  suite('parseMultiFileOutput()', () => {
    test('extracts a file from ## heading + fenced code block', () => {
      const svc   = makeWorkspaceService();
      const base  = '/workspace/project';
      const input = `## src/hello.py\n\`\`\`python\nprint("hello")\n\`\`\`\n`;

      const files = svc.parseMultiFileOutput(input, base);

      assert.ok(files.length >= 1, `expected at least 1 file, got ${files.length}`);
      const found = files.find(f => f.path.includes('hello.py'));
      assert.ok(found !== undefined, 'expected hello.py to be parsed');
      assert.ok(found!.content.includes('print("hello")'));
    });

    test('extracts multiple files from a single AI output', () => {
      const svc  = makeWorkspaceService();
      const base = '/workspace/project';
      const input = [
        '## models/user.py',
        '```python',
        'class User: pass',
        '```',
        '',
        '## models/post.py',
        '```python',
        'class Post: pass',
        '```',
      ].join('\n');

      const files = svc.parseMultiFileOutput(input, base);

      assert.ok(files.length >= 2, `expected at least 2 files, got ${files.length}`);
    });

    test('returns fallback generated.txt for non-parseable input', () => {
      const svc   = makeWorkspaceService();
      const base  = '/workspace/project';
      const input = 'This is just some text with no file markers.';

      const files = svc.parseMultiFileOutput(input, base);

      assert.strictEqual(files.length, 1);
      assert.ok(files[0].path.endsWith('generated.txt'), `expected generated.txt, got ${files[0].path}`);
      assert.ok(files[0].content.includes('This is just some text'));
    });

    test('returns empty array for empty string input', () => {
      const svc  = makeWorkspaceService();
      const base = '/workspace/project';

      const files = svc.parseMultiFileOutput('', base);

      assert.strictEqual(files.length, 0);
    });

    test('blocks path traversal via ".." in AI-generated filename', () => {
      const svc   = makeWorkspaceService();
      const base  = '/workspace/project';
      // AI output tries to escape the base directory
      const input = `## ../../etc/passwd\n\`\`\`\nroot:x:0\n\`\`\`\n`;

      const files = svc.parseMultiFileOutput(input, base);

      // The traversal file should NOT be in the output
      const escaped = files.find(f => f.path.includes('etc') && f.path.includes('passwd'));
      assert.strictEqual(escaped, undefined, 'path traversal should be blocked');
    });

    test('allows a safe nested path within the base directory', () => {
      const svc   = makeWorkspaceService();
      const base  = '/workspace/project';
      const input = `## src/utils/helper.ts\n\`\`\`typescript\nexport const x = 1;\n\`\`\`\n`;

      const files = svc.parseMultiFileOutput(input, base);

      const found = files.find(f => f.path.includes('helper.ts'));
      assert.ok(found !== undefined, 'safe nested path should be allowed');
      assert.ok(found!.path.startsWith(base), 'path should remain inside base directory');
    });
  });

  suite('getRuntimeCommand()', () => {
    test('returns python3 command for python language', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/workspace/script.py', 'python');
      assert.ok(cmd !== null);
      assert.ok(cmd!.startsWith('python3 '));
      assert.ok(cmd!.includes('script.py'));
    });

    test('returns node command for javascript language', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/workspace/app.js', 'javascript');
      assert.ok(cmd !== null);
      assert.ok(cmd!.startsWith('node '));
    });

    test('returns npx ts-node command for typescript language', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/workspace/main.ts', 'typescript');
      assert.ok(cmd !== null);
      assert.ok(cmd!.includes('ts-node'));
    });

    test('returns go run command for go language', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/workspace/main.go', 'go');
      assert.ok(cmd !== null);
      assert.ok(cmd!.startsWith('go run '));
    });

    test('returns null for unknown extension / language', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/workspace/file.xyz', 'unknown-lang');
      assert.strictEqual(cmd, null);
    });

    test('shell-escapes file paths with spaces (single-quote wrapping)', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/my workspace/my script.py', 'python');
      assert.ok(cmd !== null);
      // The path should be wrapped in single quotes to be shell-safe
      assert.ok(cmd!.includes("'"), 'expected single-quote escaping in command');
    });

    test('returns bash command for shellscript language', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/workspace/deploy.sh', 'shellscript');
      assert.ok(cmd !== null);
      assert.ok(cmd!.startsWith('bash '));
    });

    test('returns ruby command for ruby language', () => {
      const svc = makeWorkspaceService();
      const cmd = svc.getRuntimeCommand('/workspace/app.rb', 'ruby');
      assert.ok(cmd !== null);
      assert.ok(cmd!.startsWith('ruby '));
    });
  });

  suite('EXT_LANG mapping', () => {
    test('.py maps to python', () => {
      assert.strictEqual(EXT_LANG['.py'], 'python');
    });

    test('.js maps to javascript', () => {
      assert.strictEqual(EXT_LANG['.js'], 'javascript');
    });

    test('.ts maps to typescript', () => {
      assert.strictEqual(EXT_LANG['.ts'], 'typescript');
    });

    test('.go maps to go', () => {
      assert.strictEqual(EXT_LANG['.go'], 'go');
    });

    test('unknown extension is not in map', () => {
      assert.strictEqual(EXT_LANG['.xyz'], undefined);
    });
  });

  suite('MockWorkspaceService', () => {
    test('applyToActiveFile() stores the applied content', async () => {
      const svc = new MockWorkspaceService();
      await svc.applyToActiveFile('const x = 1;');
      assert.strictEqual(svc.appliedContent, 'const x = 1;');
    });

    test('writeFile() records written files', async () => {
      const svc = new MockWorkspaceService();
      await svc.writeFile('/out/result.ts', 'export {};');
      assert.strictEqual(svc.writtenFiles.length, 1);
      assert.strictEqual(svc.writtenFiles[0].path, '/out/result.ts');
      assert.strictEqual(svc.writtenFiles[0].content, 'export {};');
    });

    test('showDiff() returns "apply" in mock', async () => {
      const svc    = new MockWorkspaceService();
      const result = await svc.showDiff('old', 'new', 'Test diff');
      assert.strictEqual(result, 'apply');
    });

    test('getRuntimeCommand() returns null in mock', () => {
      const svc = new MockWorkspaceService();
      assert.strictEqual(svc.getRuntimeCommand('/file.py', 'python'), null);
    });
  });
});
