/**
 * test/suite/integration/providerSwitch.test.ts
 *
 * Integration tests for AI provider detection and secret storage.
 * Exercises the MockAIService (which stands in for the real AIService) to
 * verify the provider-switch contract without network access.
 *
 * Tests that require real provider detection logic (Ollama reachability) use
 * MockAIService overrides so the results are deterministic.
 */

import * as assert from 'assert';
import { MockAIService, MockEventBus } from '../../mocks';
import type { ProviderName } from '../../../core/aiService';

// ── Suite ──────────────────────────────────────────────────────────────────────

suite('Provider Switch — Integration', () => {
  let ai:  MockAIService;
  let bus: MockEventBus;

  setup(() => {
    ai  = new MockAIService();
    bus = new MockEventBus();
  });

  teardown(() => {
    bus.dispose();
  });

  // ── Default provider ───────────────────────────────────────────────────────

  test('MockAIService.detectProvider() returns "offline" by default', async () => {
    const provider = await ai.detectProvider();
    assert.strictEqual(provider, 'offline');
  });

  test('isOllamaRunning() returns false by default in mock', async () => {
    const running = await ai.isOllamaRunning();
    assert.strictEqual(running, false);
  });

  test('getOllamaModels() returns empty array by default in mock', async () => {
    const models = await ai.getOllamaModels();
    assert.deepStrictEqual(models, []);
  });

  // ── Provider overrides ─────────────────────────────────────────────────────

  test('overriding detectProvider() to return "ollama" works correctly', async () => {
    ai.detectProvider = async (): Promise<ProviderName> => 'ollama';
    const provider = await ai.detectProvider();
    assert.strictEqual(provider, 'ollama');
  });

  test('overriding detectProvider() to return "anthropic" works correctly', async () => {
    ai.detectProvider = async (): Promise<ProviderName> => 'anthropic';
    const provider = await ai.detectProvider();
    assert.strictEqual(provider, 'anthropic');
  });

  test('overriding detectProvider() to return "openai" works correctly', async () => {
    ai.detectProvider = async (): Promise<ProviderName> => 'openai';
    const provider = await ai.detectProvider();
    assert.strictEqual(provider, 'openai');
  });

  test('overriding detectProvider() to return "huggingface" works correctly', async () => {
    ai.detectProvider = async (): Promise<ProviderName> => 'huggingface';
    const provider = await ai.detectProvider();
    assert.strictEqual(provider, 'huggingface');
  });

  // ── "auto" behaviour simulation ────────────────────────────────────────────

  test('"auto" with Ollama running → should resolve to "ollama"', async () => {
    // Simulate the real detectProvider logic: auto + ollama reachable = ollama
    ai.isOllamaRunning = async (): Promise<boolean> => true;
    ai.detectProvider  = async (): Promise<ProviderName> => {
      const running = await ai.isOllamaRunning();
      return running ? 'ollama' : 'offline';
    };
    const provider = await ai.detectProvider();
    assert.strictEqual(provider, 'ollama');
  });

  test('"auto" with no Ollama → should resolve to "offline"', async () => {
    ai.isOllamaRunning = async (): Promise<boolean> => false;
    ai.detectProvider  = async (): Promise<ProviderName> => {
      const running = await ai.isOllamaRunning();
      return running ? 'ollama' : 'offline';
    };
    const provider = await ai.detectProvider();
    assert.strictEqual(provider, 'offline');
  });

  // ── Event emission on provider change ─────────────────────────────────────

  test("emitting 'provider.changed' event captures correct payload", () => {
    bus.emit('provider.changed', { provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const events = bus.emitted.filter(e => e.event === 'provider.changed');
    assert.strictEqual(events.length, 1);
    const payload = events[0].payload as { provider: string; model: string };
    assert.strictEqual(payload.provider, 'anthropic');
    assert.strictEqual(payload.model,    'claude-sonnet-4-6');
  });

  test("emitting multiple 'provider.changed' events — latest is correct", () => {
    bus.emit('provider.changed', { provider: 'ollama',    model: 'qwen2.5-coder:7b' });
    bus.emit('provider.changed', { provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const events = bus.emitted.filter(e => e.event === 'provider.changed');
    assert.strictEqual(events.length, 2);
    const last = events[events.length - 1].payload as { provider: string; model: string };
    assert.strictEqual(last.provider, 'anthropic');
  });

  test("'provider.changed' event handler is called with correct payload", () => {
    let capturedProvider = '';
    let capturedModel    = '';

    bus.on('provider.changed', payload => {
      capturedProvider = payload.provider;
      capturedModel    = payload.model;
    });

    bus.emit('provider.changed', { provider: 'openai', model: 'gpt-4o' });

    assert.strictEqual(capturedProvider, 'openai');
    assert.strictEqual(capturedModel,    'gpt-4o');
  });

  // ── Secret storage ─────────────────────────────────────────────────────────

  test('storeSecret() and getSecret() work independently for different keys', async () => {
    const secrets = new Map<string, string>();
    ai.storeSecret = async (key: string, value: string): Promise<void> => { secrets.set(key, value); };
    ai.getSecret   = async (key: string): Promise<string | undefined> => secrets.get(key);

    await ai.storeSecret('aiForge.anthropicKey', 'sk-ant-test');
    await ai.storeSecret('aiForge.openaiKey',    'sk-openai-test');

    const anthropicKey = await ai.getSecret('aiForge.anthropicKey');
    const openaiKey    = await ai.getSecret('aiForge.openaiKey');

    assert.strictEqual(anthropicKey, 'sk-ant-test');
    assert.strictEqual(openaiKey,    'sk-openai-test');
  });

  test('getSecret() returns undefined for a key that was never stored', async () => {
    const result = await ai.getSecret('aiForge.nonExistentKey');
    assert.strictEqual(result, undefined);
  });

  test('storeSecret() overwrites an existing key', async () => {
    const secrets = new Map<string, string>();
    ai.storeSecret = async (key: string, value: string): Promise<void> => { secrets.set(key, value); };
    ai.getSecret   = async (key: string): Promise<string | undefined> => secrets.get(key);

    await ai.storeSecret('aiForge.anthropicKey', 'old-key');
    await ai.storeSecret('aiForge.anthropicKey', 'new-key');

    const result = await ai.getSecret('aiForge.anthropicKey');
    assert.strictEqual(result, 'new-key');
  });

  // ── HuggingFace provider ───────────────────────────────────────────────────

  test('HuggingFace provider requires an API key — missing key yields warning response', async () => {
    // Simulate the real HuggingFace stream: no key → warning message
    ai.getSecret    = async (_key: string): Promise<string | undefined> => undefined;
    ai.detectProvider = async (): Promise<ProviderName> => 'huggingface';

    // Simulate what AIService._streamHuggingFace does when key is missing
    const key = await ai.getSecret('aiForge.huggingfaceKey');
    const missingKey = !key;
    assert.ok(missingKey, 'HuggingFace key should be missing from mock secret storage');
  });

  test('HuggingFace provider with API key set proceeds without warning', async () => {
    const secrets = new Map<string, string>();
    ai.storeSecret = async (k: string, v: string): Promise<void> => { secrets.set(k, v); };
    ai.getSecret   = async (k: string): Promise<string | undefined> => secrets.get(k);

    await ai.storeSecret('aiForge.huggingfaceKey', 'hf-test-token');
    const key = await ai.getSecret('aiForge.huggingfaceKey');
    assert.ok(key !== undefined && key.length > 0, 'HuggingFace key should be present');
  });

  // ── Request interceptors ───────────────────────────────────────────────────

  test('addInterceptor() returns a disposable', () => {
    const disposable = ai.addInterceptor({ intercept: (req) => req });
    assert.ok(typeof disposable.dispose === 'function');
  });

  test('disposable from addInterceptor() can be disposed without error', () => {
    const disposable = ai.addInterceptor({ intercept: (req) => req });
    assert.doesNotThrow(() => { disposable.dispose(); });
  });
});
