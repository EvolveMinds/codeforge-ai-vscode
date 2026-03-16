/**
 * test/suite/aiService.test.ts — Tests for AIService types, constants, and interface
 *
 * AIService requires vscode.SecretStorage at construction time, so we cannot
 * instantiate it directly in unit tests. Instead we:
 *  - Verify exported type shapes via compile-time assignments
 *  - Verify exported constant values
 *  - Verify that MockAIService fully satisfies IAIService
 */

import * as assert from 'assert';
import type { ProviderName, AIRequest, RequestInterceptor } from '../../core/aiService';
import { SECRET_ANTHROPIC, SECRET_OPENAI, SECRET_HUGGINGFACE } from '../../core/aiService';
import type { IAIService } from '../../core/interfaces';
import { MockAIService } from '../mocks';

suite('AIService', () => {

  // ── Secret key constants ────────────────────────────────────────────────────

  test('SECRET_ANTHROPIC has expected string value', () => {
    assert.strictEqual(SECRET_ANTHROPIC, 'aiForge.anthropicKey');
  });

  test('SECRET_OPENAI has expected string value', () => {
    assert.strictEqual(SECRET_OPENAI, 'aiForge.openaiKey');
  });

  test('SECRET_HUGGINGFACE has expected string value', () => {
    assert.strictEqual(SECRET_HUGGINGFACE, 'aiForge.huggingfaceKey');
  });

  test('all three secret keys are distinct', () => {
    const keys = new Set([SECRET_ANTHROPIC, SECRET_OPENAI, SECRET_HUGGINGFACE]);
    assert.strictEqual(keys.size, 3, 'All secret key constants must be unique');
  });

  // ── ProviderName type — valid assignments ──────────────────────────────────

  test('ProviderName accepts all documented values', () => {
    // Type-level check: these assignments must compile without error.
    const a: ProviderName = 'auto';
    const b: ProviderName = 'ollama';
    const c: ProviderName = 'anthropic';
    const d: ProviderName = 'openai';
    const e: ProviderName = 'huggingface';
    const f: ProviderName = 'offline';

    const all = [a, b, c, d, e, f];
    assert.strictEqual(all.length, 6, 'All six provider names should be assignable');
  });

  // ── AIRequest interface shape ───────────────────────────────────────────────

  test('AIRequest can be constructed with required fields', () => {
    const req: AIRequest = {
      messages:    [{ role: 'user', content: 'hello' }],
      system:      'You are helpful.',
      instruction: 'Say hello',
      mode:        'chat',
    };
    assert.strictEqual(req.messages.length, 1);
    assert.strictEqual(req.system, 'You are helpful.');
    assert.strictEqual(req.instruction, 'Say hello');
    assert.strictEqual(req.mode, 'chat');
  });

  test('AIRequest accepts optional signal field', () => {
    const controller = new AbortController();
    const req: AIRequest = {
      messages:    [],
      system:      '',
      instruction: 'test',
      mode:        'edit',
      signal:      controller.signal,
    };
    assert.ok(req.signal !== undefined, 'signal field should be accepted');
  });

  test('Message role accepts user, assistant, and system', () => {
    const msgs: AIRequest['messages'] = [
      { role: 'user',      content: 'question' },
      { role: 'assistant', content: 'answer' },
      { role: 'system',    content: 'instructions' },
    ];
    assert.strictEqual(msgs.length, 3);
  });

  // ── RequestInterceptor interface ────────────────────────────────────────────

  test('RequestInterceptor can be implemented with intercept method', () => {
    const interceptor: RequestInterceptor = {
      intercept(req: AIRequest): AIRequest {
        return { ...req, instruction: '[modified] ' + req.instruction };
      },
    };

    const req: AIRequest = {
      messages: [], system: '', instruction: 'fix bug', mode: 'fix',
    };
    const modified = interceptor.intercept(req);
    assert.strictEqual(modified.instruction, '[modified] fix bug');
  });

  // ── MockAIService satisfies IAIService ──────────────────────────────────────

  test('MockAIService implements all IAIService methods', () => {
    const svc: IAIService = new MockAIService();

    assert.strictEqual(typeof svc.detectProvider,   'function');
    assert.strictEqual(typeof svc.isOllamaRunning,  'function');
    assert.strictEqual(typeof svc.getOllamaModels,  'function');
    assert.strictEqual(typeof svc.stream,            'function');
    assert.strictEqual(typeof svc.send,              'function');
    assert.strictEqual(typeof svc.addInterceptor,    'function');
    assert.strictEqual(typeof svc.storeSecret,       'function');
    assert.strictEqual(typeof svc.getSecret,         'function');
  });

  test('MockAIService.detectProvider returns offline', async () => {
    const svc = new MockAIService();
    const provider = await svc.detectProvider();
    assert.strictEqual(provider, 'offline');
  });

  test('MockAIService.send returns configured response', async () => {
    const svc = new MockAIService();
    svc.response = 'custom response';
    const req: AIRequest = { messages: [], system: '', instruction: 'test', mode: 'test' };
    const result = await svc.send(req);
    assert.strictEqual(result, 'custom response');
  });

  test('MockAIService.stream yields configured response', async () => {
    const svc = new MockAIService();
    svc.response = 'streamed chunk';
    const req: AIRequest = { messages: [], system: '', instruction: 'test', mode: 'test' };

    const chunks: string[] = [];
    for await (const chunk of svc.stream(req)) {
      chunks.push(chunk);
    }
    assert.ok(chunks.includes('streamed chunk'));
  });

  test('MockAIService.getSecret returns undefined by default', async () => {
    const svc = new MockAIService();
    const val = await svc.getSecret('somekey');
    assert.strictEqual(val, undefined);
  });

  test('MockAIService.addInterceptor returns a disposable', () => {
    const svc = new MockAIService();
    const interceptor: RequestInterceptor = { intercept: (r) => r };
    const disposable = svc.addInterceptor(interceptor);
    assert.strictEqual(typeof disposable.dispose, 'function');
    assert.doesNotThrow(() => { disposable.dispose(); });
  });
});
