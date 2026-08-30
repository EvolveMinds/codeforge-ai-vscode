import * as assert from 'assert';
import { PrivateModelClient } from '../../../enterprise';

suite('Enterprise Suite — Private Air-Gapped Model Serving Client', () => {
  test('initializes with custom vLLM / Triton endpoint and retry configuration', () => {
    const client = new PrivateModelClient({
      endpoint: 'https://vllm.ai.vpc.internal:8000/v1',
      servingEngine: 'vllm',
      defaultModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      apiKey: 'priv-tok-abcdef123456',
      mtls: {
        rejectUnauthorized: false
      },
      retryOptions: {
        maxRetries: 4,
        initialBackoffMs: 200
      }
    });

    assert.ok(client, 'Client initialized successfully');
  });

  test('checks health against offline host gracefully without throwing fatal unhandled errors', async () => {
    const client = new PrivateModelClient({
      endpoint: 'http://127.0.0.1:59999/v1',
      servingEngine: 'vllm',
      defaultModel: 'mock-model',
      timeoutMs: 500
    });

    const health = await client.checkHealth();
    assert.strictEqual(health.ok, false);
    assert.strictEqual(health.engine, 'vllm');
    assert.ok(health.statusText.length > 0);
  });
});
