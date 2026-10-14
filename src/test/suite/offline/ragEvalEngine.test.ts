/**
 * test/suite/offline/ragEvalEngine.test.ts — Unit tests for Offline RAG & LLM Golden Eval Engine
 */

import * as assert from 'assert';
import { RagEvalEngine, RagEvalTriplet } from '../../../offline/ragEvalEngine';

suite('Offline RAG & LLM Golden Eval Engine Suite', () => {
  test('evaluates grounded triplet with high faithfulness and context relevance', () => {
    const groundedTriplet: RagEvalTriplet = {
      id: 'test_grounded',
      query: 'What was the Q3 operating margin for Cloud Services?',
      contexts: [
        'Cloud Services segment operating income reached $4.2B in Q3 2026, representing an operating margin of 32.4%, up 210 basis points year-over-year.'
      ],
      response: 'In Q3 2026, the operating margin for Cloud Services was 32.4%, reflecting a 210 basis point increase YoY.'
    };

    const metrics = RagEvalEngine.evaluateTriplet(groundedTriplet);

    assert.ok(metrics.contextRelevanceScore >= 0.7, 'Context relevance should be high');
    assert.ok(metrics.faithfulnessScore >= 0.8, 'Faithfulness should be high');
    assert.strictEqual(metrics.suggestedLabel, 'grounded');
    assert.ok(metrics.claims.length > 0);
    assert.ok(metrics.claims.every(c => c.isGrounded));
  });

  test('detects hallucination with invented numbers not present in context', () => {
    const hallucinationTriplet: RagEvalTriplet = {
      id: 'test_hallucination',
      query: 'What was the capital expenditure on AI clusters?',
      contexts: [
        'Total enterprise infrastructure capital expenditure for 2026 was projected at $12.8B across compute and storage.'
      ],
      response: 'The company allocated exactly $8.5B specifically for AI GPU clusters, purchasing 45,000 H100 units.'
    };

    const metrics = RagEvalEngine.evaluateTriplet(hallucinationTriplet);

    assert.ok(metrics.faithfulnessScore < 0.6, 'Faithfulness should be penalized for invented numbers');
    assert.strictEqual(metrics.suggestedLabel, 'hallucination');
    assert.ok(metrics.claims.some(c => !c.isGrounded));
  });

  test('detects irrelevant context retrieval when context does not match query', () => {
    const irrelevantTriplet: RagEvalTriplet = {
      id: 'test_irrelevant',
      query: 'What are the indemnification limits under Section 14 for intellectual property claims?',
      contexts: [
        'Section 8: Termination for convenience requires thirty (30) days prior written notice by either party.'
      ],
      response: 'Section 14 provides an aggregate liability cap equal to twelve months of fees.'
    };

    const metrics = RagEvalEngine.evaluateTriplet(irrelevantTriplet);

    assert.ok(metrics.contextRelevanceScore < 0.3, 'Context relevance should be low');
    assert.strictEqual(metrics.suggestedLabel, 'irrelevant_context');
  });

  test('extracts claims and filters conversational greetings and filler', () => {
    const text = 'Hello! Sure, here is your answer. Cloud margins expanded to 32.4% in Q3. Operating income reached $4.2B. I hope this helps!';
    const claims = RagEvalEngine.extractClaims(text);

    assert.strictEqual(claims.length, 2);
    assert.ok(claims.includes('Cloud margins expanded to 32.4% in Q3.'));
    assert.ok(claims.includes('Operating income reached $4.2B.'));
  });

  test('analyzes batch and generates accurate dataset summary scorecard', () => {
    const demoData = RagEvalEngine.generateDemoDataset();
    assert.strictEqual(demoData.length, 5);

    const { triplets, summary } = RagEvalEngine.analyzeBatch(demoData);

    assert.strictEqual(summary.totalCount, 5);
    assert.ok(summary.avgFaithfulness >= 0.4);
    assert.ok(summary.avgContextRelevance > 0.3);

    // Annotate one triplet as verified
    triplets[0].annotation = {
      label: 'grounded',
      faithfulnessRating: 5,
      contextRelevanceRating: 5,
      timestamp: new Date().toISOString(),
      verified: true
    };

    const updatedSummary = RagEvalEngine.computeSummary(triplets);
    assert.strictEqual(updatedSummary.evaluatedCount, 1);
    assert.strictEqual(updatedSummary.groundedCount, 1);
    assert.strictEqual(updatedSummary.groundedRatePct, 100);
  });

  test('triages uncertainty queue with highest ambiguity items first', () => {
    const demoData = RagEvalEngine.generateDemoDataset();
    const { triplets } = RagEvalEngine.analyzeBatch(demoData);

    const triaged = RagEvalEngine.triageUncertaintyQueue(triplets);
    assert.strictEqual(triaged.length, 5);

    // First item should have an ambiguity score greater than or equal to later unverified items
    const amb0 = triaged[0].automatedMetrics?.ambiguityScore ?? 0;
    const ambLast = triaged[triaged.length - 1].automatedMetrics?.ambiguityScore ?? 0;
    assert.ok(amb0 >= ambLast, 'Uncertainty queue must prioritize higher ambiguity scores');
  });

  test('exports to RAGAS JSONL and Evolve AI Golden Benchmark schema', () => {
    const demoData = RagEvalEngine.generateDemoDataset();
    demoData[0].annotation = {
      label: 'grounded',
      faithfulnessRating: 5,
      contextRelevanceRating: 5,
      timestamp: new Date().toISOString(),
      verified: true
    };

    // RAGAS JSONL
    const jsonl = RagEvalEngine.exportToRagasJsonl(demoData);
    const lines = jsonl.split('\n');
    assert.strictEqual(lines.length, 5);
    const firstParsed = JSON.parse(lines[0]);
    assert.strictEqual(firstParsed.question, demoData[0].query);
    assert.strictEqual(firstParsed.user_annotation, 'grounded');

    // Golden Benchmark Suite
    const suite = RagEvalEngine.exportToGoldenBenchmark(demoData, 'enterprise_eval_suite');
    assert.strictEqual(suite.suiteName, 'enterprise_eval_suite');
    assert.strictEqual(suite.framework, 'EvolveAI_RAG_GoldenBenchmark_v1');
    assert.ok(suite.testCases.length > 0);

    // CSV
    const csv = RagEvalEngine.exportToCsv(demoData);
    assert.ok(csv.startsWith('id,query,response,label'));

    // Markdown Report
    const md = RagEvalEngine.exportExecutiveReportMarkdown(demoData);
    assert.ok(md.includes('# Evolve AI: RAG & LLM Golden Evaluation Scorecard'));
  });
});
