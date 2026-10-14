import * as assert from 'assert';
import { DpoEvalEngine, DpoScenarioItem } from '../../../offline/dpoEvalEngine';

suite('Offline Pairwise LLM Preference & DPO Arena Engine Suite', () => {
  test('generates valid enterprise demo scenarios across domains', () => {
    const demos = DpoEvalEngine.generateDemoScenarios();
    assert.strictEqual(demos.length, 4);

    for (const d of demos) {
      assert.ok(d.id.startsWith('dpo_'));
      assert.ok(d.prompt.length > 10);
      assert.ok(d.modelA.modelId);
      assert.ok(d.modelA.response.length > 5);
      assert.ok(d.modelB.modelId);
      assert.ok(d.modelB.response.length > 5);
      assert.ok(d.metadata?.domain);
    }
  });

  test('records preference verdicts, critique tags, and evaluator notes', () => {
    const demos = DpoEvalEngine.generateDemoScenarios();
    const item = demos[0];

    const updated = DpoEvalEngine.recordVerdict(
      item,
      'model_a',
      ['accurate_math', 'more_grounded'],
      'Model A computed exact step-by-step arithmetic.'
    );

    assert.strictEqual(updated.verdict, 'model_a');
    assert.deepStrictEqual(updated.critiqueTags, ['accurate_math', 'more_grounded']);
    assert.strictEqual(updated.evaluatorNotes, 'Model A computed exact step-by-step arithmetic.');
    assert.ok(updated.evaluatedAt);
  });

  test('computes Elo ratings and win rates accurately', () => {
    const demos = DpoEvalEngine.generateDemoScenarios();

    // dpo_001: Model A wins
    demos[0] = DpoEvalEngine.recordVerdict(demos[0], 'model_a');
    // dpo_002: Model B wins
    demos[1] = DpoEvalEngine.recordVerdict(demos[1], 'model_b');
    // dpo_003: Model A wins
    demos[2] = DpoEvalEngine.recordVerdict(demos[2], 'model_a');
    // dpo_004: Tie
    demos[3] = DpoEvalEngine.recordVerdict(demos[3], 'tie');

    const summary = DpoEvalEngine.computeLeaderboard(demos);

    assert.strictEqual(summary.totalComparisons, 4);
    assert.strictEqual(summary.ratedComparisons, 4);
    assert.strictEqual(summary.pendingComparisons, 0);
    assert.strictEqual(summary.models.length, 2);

    const modelA = summary.models.find(m => m.modelId === 'qwen2.5-coder:7b');
    const modelB = summary.models.find(m => m.modelId === 'deepseek-r1:8b');

    assert.ok(modelA);
    assert.ok(modelB);

    assert.strictEqual(modelA!.wins, 2);
    assert.strictEqual(modelA!.losses, 1);
    assert.strictEqual(modelA!.ties, 1);

    assert.strictEqual(modelB!.wins, 1);
    assert.strictEqual(modelB!.losses, 2);
    assert.strictEqual(modelB!.ties, 1);

    // Model A has more wins, so its Elo score must be higher than Model B
    assert.ok(modelA!.eloScore > modelB!.eloScore, `Model A Elo (${modelA!.eloScore}) should be > Model B (${modelB!.eloScore})`);
  });

  test('exports to standard Hugging Face DPO JSONL format with chosen and rejected', () => {
    const demos = DpoEvalEngine.generateDemoScenarios();
    demos[0] = DpoEvalEngine.recordVerdict(demos[0], 'model_a', ['math_verified']);
    demos[1] = DpoEvalEngine.recordVerdict(demos[1], 'model_b', ['clinical_compliance']);
    demos[2] = DpoEvalEngine.recordVerdict(demos[2], 'tie'); // Ties should be excluded from DPO training pairs

    const jsonl = DpoEvalEngine.exportDpoJsonl(demos);
    const lines = jsonl.trim().split('\n').map(l => JSON.parse(l));

    assert.strictEqual(lines.length, 2); // only model_a and model_b winners

    assert.strictEqual(lines[0].prompt, demos[0].prompt);
    assert.strictEqual(lines[0].chosen, demos[0].modelA.response);
    assert.strictEqual(lines[0].rejected, demos[0].modelB.response);
    assert.strictEqual(lines[0].chosen_model, 'qwen2.5-coder:7b');

    assert.strictEqual(lines[1].prompt, demos[1].prompt);
    assert.strictEqual(lines[1].chosen, demos[1].modelB.response);
    assert.strictEqual(lines[1].rejected, demos[1].modelA.response);
    assert.strictEqual(lines[1].chosen_model, 'deepseek-r1:8b');
  });

  test('exports executive markdown and enterprise benchmark suite schemas', () => {
    const demos = DpoEvalEngine.generateDemoScenarios();
    demos[0] = DpoEvalEngine.recordVerdict(demos[0], 'model_a');

    const md = DpoEvalEngine.exportMarkdownReport(demos);
    assert.ok(md.includes('Pairwise Model Preference & Elo Arena Report'));
    assert.ok(md.includes('Model Elo Leaderboard'));
    assert.ok(md.includes('qwen2.5-coder:7b'));

    const suiteJson = DpoEvalEngine.exportEnterpriseSuite(demos);
    const suite = JSON.parse(suiteJson);
    assert.strictEqual(suite.suiteName, 'Evolve AI Sovereign DPO Preference Benchmark Suite');
    assert.strictEqual(suite.governance.airGapped, true);
    assert.strictEqual(suite.scenarios.length, 4);
  });
});
