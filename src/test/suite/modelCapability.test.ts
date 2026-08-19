import * as assert from 'assert';
import { assessModelForDataAnalysis } from '../../core/modelCapability';

suite('Model Capability — assessModelForDataAnalysis()', () => {
  test('evaluates cloud models as optimal', () => {
    const verdict = assessModelForDataAnalysis('anthropic', 'claude-3-5-sonnet');
    assert.strictEqual(verdict.isOptimal, true);
    assert.strictEqual(verdict.verdict, 'optimal');
    assert.strictEqual(verdict.badge.includes('Cloud'), true);
  });

  test('evaluates fast cloud models with fast badge', () => {
    const verdict = assessModelForDataAnalysis('gemini', 'gemini-2.5-flash');
    assert.strictEqual(verdict.isOptimal, true);
    assert.strictEqual(verdict.tier, 'good');
    assert.strictEqual(verdict.badge.includes('Fast'), true);
  });

  test('evaluates strong local coder models as optimal', () => {
    const verdict = assessModelForDataAnalysis('ollama', 'qwen2.5-coder:14b', 16);
    assert.strictEqual(verdict.isOptimal, true);
    assert.strictEqual(verdict.verdict, 'optimal');
    assert.strictEqual(verdict.badge.includes('Optimal Local Coder'), true);
  });

  test('evaluates 7B coder models as recommended local coder', () => {
    const verdict = assessModelForDataAnalysis('ollama', 'qwen2.5-coder:7b', 16);
    assert.strictEqual(verdict.isOptimal, true);
    assert.strictEqual(verdict.verdict, 'good');
    assert.strictEqual(verdict.badge.includes('Recommended Local Coder'), true);
  });

  test('flags underpowered models (<7B) as suboptimal and recommends qwen2.5-coder', () => {
    const verdict = assessModelForDataAnalysis('ollama', 'llama3.2:3b', 8);
    assert.strictEqual(verdict.isOptimal, false);
    assert.strictEqual(verdict.verdict, 'suboptimal');
    assert.strictEqual(verdict.badge.includes('Underpowered'), true);
    assert.strictEqual(verdict.suggestedLocalModel, 'qwen2.5-coder:7b');
    assert.strictEqual(verdict.recommendation?.includes('qwen2.5-coder:7b'), true);
  });

  test('suggests qwen2.5-coder:14b for underpowered models on machines with 16GB+ RAM', () => {
    const verdict = assessModelForDataAnalysis('ollama', 'llama3.2:1b', 32);
    assert.strictEqual(verdict.isOptimal, false);
    assert.strictEqual(verdict.suggestedLocalModel, 'qwen2.5-coder:14b');
    assert.strictEqual(verdict.recommendation?.includes('qwen2.5-coder:14b'), true);
  });
});
