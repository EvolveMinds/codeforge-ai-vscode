import * as assert from 'assert';
import { assessModelForDataAnalysis, parseParamSizeB } from '../../core/modelCapability';

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

/**
 * Parameter-size matching used to be done with a bare alternation
 * (`/0.5b|1b|1.5b|2b|3b/`) tested against the whole model id. Because it had no
 * separator and no word boundary, the digits matched INSIDE larger sizes: "32b"
 * contains "2b" and "13b" contains "1b", so current, perfectly capable models
 * were reported to the user as "Underpowered for Data Science".
 *
 * The same bug class was already found and fixed on the conversion path — see
 * the `[:\-](?:[1-3](?:\.\d+)?)b\b` entry in KNOWN_MODELS and the comment above
 * it. These tests pin the fix on this path too, because a user being told their
 * 32B model is too small is worse than no advice at all.
 */
suite('Model Capability — parameter size matching', () => {
  const notUnderpowered = (model: string) => {
    const v = assessModelForDataAnalysis('ollama', model, 16);
    assert.notStrictEqual(
      v.verdict, 'suboptimal',
      `${model} must not be reported as underpowered (got "${v.badge}")`);
    assert.strictEqual(v.isOptimal, true, `${model} should be usable`);
  };

  test('a 32B model is not "underpowered" because "32b" contains "2b"', () => {
    notUnderpowered('qwen3:32b');
  });

  test('a 13B model is not "underpowered" because "13b" contains "1b"', () => {
    notUnderpowered('llama3.2:13b');
  });

  test('a 22B model is not "underpowered" because "22b" contains "2b"', () => {
    notUnderpowered('codestral:22b');
  });

  test('genuinely small models are still flagged', () => {
    for (const small of ['llama3.2:1b', 'llama3.2:3b', 'qwen2.5:0.5b', 'gemma2:2b']) {
      const v = assessModelForDataAnalysis('ollama', small, 16);
      assert.strictEqual(v.isOptimal, false, `${small} should be flagged as underpowered`);
      assert.strictEqual(v.verdict, 'suboptimal', `${small} should be suboptimal`);
    }
  });

  test('a 70B model is not caught by the small-model branch', () => {
    notUnderpowered('llama3.3:70b');
  });

  test('mid-size models are recognised as capable, not left in the generic fallback', () => {
    for (const m of ['qwen3:32b', 'llama3.2:13b']) {
      const v = assessModelForDataAnalysis('ollama', m, 16);
      assert.strictEqual(v.tier, 'good', `${m} should be graded, not left unrecognised`);
    }
  });
});

suite('Model Capability — parseParamSizeB()', () => {
  test('reads a stated parameter count', () => {
    assert.strictEqual(parseParamSizeB('qwen3:32b'), 32);
    assert.strictEqual(parseParamSizeB('llama3.2:13b'), 13);
    assert.strictEqual(parseParamSizeB('qwen2.5:0.5b'), 0.5);
    assert.strictEqual(parseParamSizeB('llama3.2:1b'), 1);
  });

  test('takes the expert size from an MoE name', () => {
    assert.strictEqual(parseParamSizeB('mixtral:8x7b'), 7);
  });

  test('does not read a size out of a longer number', () => {
    // The old alternation matched the "70b" inside "170b" and "7b" inside "97b".
    assert.strictEqual(parseParamSizeB('foo:170b'), 170);
    assert.strictEqual(parseParamSizeB('bar:97b'), 97);
  });

  test('returns null when the id states no size — never guess', () => {
    assert.strictEqual(parseParamSizeB('nomic-embed-text'), null);
    assert.strictEqual(parseParamSizeB('codestral'), null);
    assert.strictEqual(parseParamSizeB('gpt-4o'), null);
  });
});
