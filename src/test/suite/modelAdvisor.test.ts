/**
 * test/suite/modelAdvisor.test.ts
 *
 * The advisor makes claims to users about what their models are for, so these
 * tests pin the properties that keep those claims honest:
 *
 *   - detected facts beat guesses, and the difference is reported
 *   - a specialist model is not described as a generalist
 *   - among equals, the SMALLEST model wins (parsimony)
 *   - we never claim to forecast with a language model
 */

import * as assert from 'assert';
import {
  JOB_CATALOG,
  fitnessFor,
  inferJobFromTask,
  profileModel,
  recommendForJob,
  type ModelJob,
  type ModelProfile,
} from '../../core/modelAdvisor';

suite('Model Advisor — profileModel()', () => {
  test('detected capabilities beat the model name', () => {
    // The name says nothing about vision; the server says it has it.
    const p = profileModel('mystery-model:7b', 'ollama', {
      capabilities: ['completion', 'vision'],
      contextTokens: 32768,
    });
    assert.strictEqual(fitnessFor(p, 'vision'), 'native');
    assert.strictEqual(p.source, 'detected');
  });

  test('an embedding model is not offered as a chat model', () => {
    const p = profileModel('nomic-embed-text', 'ollama', { capabilities: ['embedding'] });
    assert.strictEqual(fitnessFor(p, 'embedding'), 'native');
    assert.strictEqual(fitnessFor(p, 'chat'), 'unsupported');
    assert.strictEqual(fitnessFor(p, 'code-agentic'), 'unsupported');
  });

  test('an embedding model is recognised from its name when the server is silent', () => {
    const p = profileModel('mxbai-embed-large', 'ollama');
    assert.strictEqual(fitnessFor(p, 'embedding'), 'native');
    assert.strictEqual(fitnessFor(p, 'chat'), 'unsupported');
    assert.notStrictEqual(p.source, 'detected', 'a name is a guess, not a detection');
  });

  test('"insert" is reported as fill-in-the-middle capability', () => {
    const p = profileModel('qwen2.5-coder:7b', 'ollama', {
      capabilities: ['completion', 'tools', 'insert'],
      contextTokens: 32768,
      family: 'qwen2',
      parameterSize: '7.6B',
    });
    assert.strictEqual(fitnessFor(p, 'code-fim'), 'native');
    assert.strictEqual(fitnessFor(p, 'code-agentic'), 'native');
    assert.strictEqual(p.attributes.family, 'qwen2');
    assert.strictEqual(p.attributes.parametersB, 7.6);
  });

  test('a tiny general model is a poor bet for demanding code work', () => {
    const p = profileModel('llama3.2:1b', 'ollama');
    assert.strictEqual(fitnessFor(p, 'code-agentic'), 'poor');
  });

  test('cloud models are marked as API-deployed and not open-weight', () => {
    const p = profileModel('claude-sonnet-4-6', 'anthropic');
    assert.strictEqual(p.attributes.deployability, 'api');
    assert.strictEqual(p.attributes.openWeight, undefined);
  });

  test('an unknown local model reports assumed limits rather than inventing them', () => {
    const p = profileModel('some-unheard-of-model', 'ollama');
    assert.strictEqual(p.source, 'assumed');
  });

  test('MoE naming is recorded as an attribute, not as a job', () => {
    const p = profileModel('mixtral:8x7b', 'ollama');
    assert.strictEqual(p.attributes.architecture, 'moe');
    // MoE is not a capability — it must not appear among the jobs.
    assert.ok(!(('moe' as unknown as ModelJob) in p.jobs));
  });
});

suite('Model Advisor — recommendForJob()', () => {
  const profiles = (): ModelProfile[] => [
    profileModel('qwen2.5-coder:7b', 'ollama', { capabilities: ['completion', 'insert'], parameterSize: '7.6B' }),
    profileModel('qwen2.5-coder:32b', 'ollama', { capabilities: ['completion', 'insert'], parameterSize: '32B' }),
    profileModel('nomic-embed-text', 'ollama', { capabilities: ['embedding'] }),
  ];

  test('parsimony — the smallest model that does the job wins', () => {
    const rec = recommendForJob('code-agentic', profiles());
    assert.strictEqual(rec.pick?.id, 'qwen2.5-coder:7b',
      'should prefer the 7B over the equally-native 32B');
  });

  test('a local model is preferred over a cloud one at equal fitness', () => {
    const list = [
      profileModel('claude-sonnet-4-6', 'anthropic'),
      profileModel('qwen2.5-coder:7b', 'ollama', { capabilities: ['completion', 'insert'] }),
    ];
    const rec = recommendForJob('code-agentic', list);
    assert.strictEqual(rec.pick?.provider, 'ollama');
  });

  test('using an embedding model for chat is called out as the wrong tool', () => {
    const rec = recommendForJob('chat', profiles(), { current: 'nomic-embed-text' });
    assert.strictEqual(rec.verdict, 'unsupported');
    assert.ok(/cannot do/i.test(rec.headline), rec.headline);
  });

  test('a good current model is confirmed rather than second-guessed', () => {
    const rec = recommendForJob('embedding', profiles(), { current: 'nomic-embed-text' });
    assert.strictEqual(rec.verdict, 'ideal');
    assert.strictEqual(rec.alternatives.length, 0, 'no churn when the choice is already right');
  });

  test('when nothing installed fits, it suggests something pullable', () => {
    const rec = recommendForJob('vision', [profileModel('qwen2.5:7b', 'ollama')]);
    assert.strictEqual(rec.verdict, 'unsupported');
    assert.ok(rec.alternatives.length > 0);
    assert.ok(rec.alternatives.every(a => !a.installed));
    assert.ok(rec.alternatives.some(a => a.pullCommand?.startsWith('ollama pull')));
  });

  test('forecasting is answered with the statistical engine, never a model', () => {
    const rec = recommendForJob('timeseries', profiles(), { current: 'qwen2.5-coder:32b' });
    assert.strictEqual(rec.verdict, 'wrong-tool');
    assert.strictEqual(rec.pick, undefined, 'must not nominate a language model');
    assert.ok(/statistical|Holt-Winters/i.test(rec.rationale), rec.rationale);
  });

  test('provenance is the weakest of the inputs the verdict rests on', () => {
    const list = [
      profileModel('qwen2.5-coder:7b', 'ollama', { capabilities: ['completion', 'insert'] }), // detected
      profileModel('totally-unknown-thing', 'ollama'),                                        // assumed
    ];
    const rec = recommendForJob('code-agentic', list, { current: 'totally-unknown-thing' });
    assert.strictEqual(rec.source, 'assumed',
      'a verdict resting on a guess must not be presented as detected');
  });
});

suite('Model Advisor — inferJobFromTask()', () => {
  test('arithmetic over structured data suggests no model at all', () => {
    const r = inferJobFromTask('reconcile invoice totals against the ledger', 'structured_data');
    assert.strictEqual(r.confidence, 'low');
    assert.ok(/rule or SQL/i.test(r.note ?? ''), r.note);
  });

  test('retrieval language maps to embeddings', () => {
    assert.strictEqual(inferJobFromTask('semantic search over our docs').job, 'embedding');
  });

  test('autocomplete maps to fill-in-the-middle, not general code generation', () => {
    assert.strictEqual(inferJobFromTask('inline completion as you type').job, 'code-fim');
  });

  test('forecasting carries the "use the statistical engine" note', () => {
    const r = inferJobFromTask('forecast next quarter revenue');
    assert.strictEqual(r.job, 'timeseries');
    assert.ok(/statistical/i.test(r.note ?? ''), r.note);
  });

  test('multimodal input implies vision', () => {
    assert.strictEqual(inferJobFromTask('summarise this', 'multimodal').job, 'vision');
  });
});

suite('Model Advisor — JOB_CATALOG', () => {
  test('every job in the catalog is unique', () => {
    const ids = JOB_CATALOG.map(j => j.job);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('every entry explains itself and names the mistake it prevents', () => {
    for (const j of JOB_CATALOG) {
      assert.ok(j.label.length > 0, `${j.job} needs a label`);
      assert.ok(j.whatItDoes.length > 20, `${j.job} needs a real description`);
      assert.ok(j.whenToUse.length > 10, `${j.job} needs guidance on when to use it`);
      assert.ok(j.commonMistake.length > 20, `${j.job} needs a common mistake`);
    }
  });

  test('forecasting warns against using a language model', () => {
    const ts = JOB_CATALOG.find(j => j.job === 'timeseries');
    assert.ok(/statistical forecaster/i.test(ts?.commonMistake ?? ''), ts?.commonMistake);
  });
});
