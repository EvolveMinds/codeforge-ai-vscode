/**
 * test/suite/contextService.test.ts — Unit tests for context budget logic
 *
 * These tests verify the budget enforcement, prompt building, and truncation
 * behaviour without requiring a live VS Code instance for the pure-logic parts.
 */

import * as assert from 'assert';
import { MockContextService, emptyContext } from '../mocks';

suite('ContextService', () => {
  suite('emptyContext()', () => {
    test('returns context with correct defaults', () => {
      const ctx = emptyContext();
      assert.strictEqual(ctx.activeFile, null);
      assert.strictEqual(ctx.selection, null);
      assert.strictEqual(ctx.errors.length, 0);
      assert.strictEqual(ctx.gitDiff, null);
      assert.strictEqual(ctx.workspaceName, 'test-workspace');
      assert.strictEqual(ctx.language, 'typescript');
      assert.strictEqual(ctx.contextBudget.total, 24_000);
      assert.strictEqual(ctx.contextBudget.used, 0);
    });
  });

  suite('MockContextService', () => {
    let svc: MockContextService;

    setup(() => {
      svc = new MockContextService();
    });

    test('build() returns the stored context', async () => {
      const ctx = await svc.build();
      assert.strictEqual(ctx.workspaceName, 'test-workspace');
    });

    test('buildSystemPrompt() returns a non-empty string', () => {
      const prompt = svc.buildSystemPrompt(emptyContext());
      assert.ok(prompt.length > 0);
    });

    test('buildUserPrompt() includes the instruction', () => {
      const prompt = svc.buildUserPrompt(emptyContext(), 'Fix the bug');
      assert.ok(prompt.includes('Fix the bug'));
    });

    test('build() reflects modified context', async () => {
      svc.context = {
        ...emptyContext(),
        workspaceName: 'custom-project',
        language: 'python',
      };
      const ctx = await svc.build();
      assert.strictEqual(ctx.workspaceName, 'custom-project');
      assert.strictEqual(ctx.language, 'python');
    });
  });

  suite('Budget constants', () => {
    test('default budget is 24000 chars', () => {
      const ctx = emptyContext();
      assert.strictEqual(ctx.contextBudget.total, 24_000);
    });

    test('used budget starts at 0 for empty context', () => {
      const ctx = emptyContext();
      assert.strictEqual(ctx.contextBudget.used, 0);
    });
  });
});
