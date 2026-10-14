/**
 * offline/ragEvalEngine.ts — Offline RAG & LLM Golden Eval Studio Engine
 *
 * 100% deterministic, offline evaluation & annotation engine for Retrieval-Augmented Generation.
 * Evaluates the RAG Triad:
 * 1. Context Relevance: Did the retrieval engine fetch relevant chunks for the user prompt?
 * 2. Groundedness / Faithfulness: Are the claims in the model response supported by the retrieved context?
 * 3. Answer Completeness: Did the model answer the question asked without omissions?
 *
 * Provides:
 * - Sentence-level claim extraction & numeric fact verification
 * - Active Learning Uncertainty Queue (prioritizes ambiguous edge cases for human review)
 * - Hotkey triage & multi-criteria Likert ratings
 * - Export to RAGAS JSONL, CSV, and Evolve AI Golden Benchmark suite
 */

export type RagAnnotationLabel = 'grounded' | 'hallucination' | 'irrelevant_context' | 'incomplete';

export interface RagClaimVerification {
  claim: string;
  isGrounded: boolean;
  confidence: number;
  matchingChunkIndex?: number;
  ungroundedTokens?: string[];
}

export interface RagAutomatedMetrics {
  contextRelevanceScore: number; // 0.0 - 1.0
  faithfulnessScore: number;     // 0.0 - 1.0
  answerCompletenessScore: number;// 0.0 - 1.0
  overallQualityScore: number;   // 0.0 - 1.0
  ambiguityScore: number;        // 0.0 - 1.0 (high = borderline / requires human triage)
  suggestedLabel: RagAnnotationLabel;
  claims: RagClaimVerification[];
}

export interface RagAnnotation {
  label: RagAnnotationLabel;
  faithfulnessRating: number;      // 1 - 5 scale
  contextRelevanceRating: number;  // 1 - 5 scale
  hallucinatedClaims?: string[];
  notes?: string;
  annotator?: string;
  timestamp: string;
  verified: boolean;
}

export interface RagEvalTriplet {
  id: string;
  query: string;
  contexts: string[];
  response: string;
  groundTruth?: string;
  metadata?: Record<string, any>;
  annotation?: RagAnnotation;
  automatedMetrics?: RagAutomatedMetrics;
}

export interface RagEvalDatasetSummary {
  totalCount: number;
  evaluatedCount: number;
  pendingCount: number;
  groundedCount: number;
  hallucinationCount: number;
  irrelevantCount: number;
  incompleteCount: number;
  groundedRatePct: number;
  hallucinationRatePct: number;
  avgFaithfulness: number;
  avgContextRelevance: number;
  uncertaintyQueueCount: number;
  generatedAt: string;
}

export class RagEvalEngine {
  /**
   * Evaluates a single RAG triplet using deterministic offline lexical, n-gram, and entity heuristics.
   */
  static evaluateTriplet(triplet: RagEvalTriplet): RagAutomatedMetrics {
    const query = triplet.query || '';
    const contexts = Array.isArray(triplet.contexts) ? triplet.contexts : [];
    const response = triplet.response || '';

    // 1. Context Relevance
    const contextRelevanceScore = this.computeContextRelevance(query, contexts);

    // 2. Sentence-level claims and faithfulness
    const claims = this.extractClaims(response);
    const claimVerifications = claims.map(c => this.verifyClaimAgainstContexts(c, contexts));

    const totalClaims = claimVerifications.length;
    const groundedClaimsCount = claimVerifications.filter(c => c.isGrounded).length;
    const faithfulnessScore = totalClaims > 0 ? Number((groundedClaimsCount / totalClaims).toFixed(3)) : 1.0;

    // 3. Answer Completeness
    const answerCompletenessScore = this.computeAnswerCompleteness(query, response);

    // 4. Overall Quality
    const overallQualityScore = Number((
      (contextRelevanceScore * 0.3) +
      (faithfulnessScore * 0.5) +
      (answerCompletenessScore * 0.2)
    ).toFixed(3));

    // 5. Ambiguity score (Active Learning uncertainty sampling)
    // Borderline items where faithfulness is between 0.35 and 0.70, or where context is relevant but answer diverges
    const faithfulnessDistanceToBoundary = Math.abs(faithfulnessScore - 0.5);
    const conflictGap = Math.abs(contextRelevanceScore - faithfulnessScore);
    const ambiguityScore = Number(
      Math.min(1.0, Math.max(0.0, (1.0 - (faithfulnessDistanceToBoundary * 2)) * 0.7 + (conflictGap * 0.3))).toFixed(3)
    );

    // 6. Heuristic suggested label
    let suggestedLabel: RagAnnotationLabel = 'grounded';
    if (contextRelevanceScore < 0.3) {
      suggestedLabel = 'irrelevant_context';
    } else if (faithfulnessScore < 0.6) {
      suggestedLabel = 'hallucination';
    } else if (answerCompletenessScore < 0.4) {
      suggestedLabel = 'incomplete';
    }

    return {
      contextRelevanceScore,
      faithfulnessScore,
      answerCompletenessScore,
      overallQualityScore,
      ambiguityScore,
      suggestedLabel,
      claims: claimVerifications
    };
  }

  /**
   * Analyzes an entire batch of triplets, populating automatedMetrics on each item.
   */
  static analyzeBatch(triplets: RagEvalTriplet[]): { triplets: RagEvalTriplet[]; summary: RagEvalDatasetSummary } {
    const analyzed = (triplets || []).map(t => {
      const metrics = this.evaluateTriplet(t);
      return {
        ...t,
        automatedMetrics: metrics
      };
    });

    const summary = this.computeSummary(analyzed);
    return { triplets: analyzed, summary };
  }

  /**
   * Extracts factual sentence claims from response text, filtering conversational filler.
   */
  static extractClaims(text: string): string[] {
    if (!text || !text.trim()) return [];

    // Split by sentence terminators
    const rawSentences = text
      .split(/(?<=[.?!])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);

    const filtered = rawSentences.filter(s => {
      // Exclude generic greetings and conversational filler
      return !/^(hello|hi|sure|here is|certainly|i hope this helps|let me know|as an ai|in summary|thank you)/i.test(s);
    });

    return filtered.length > 0 ? filtered : rawSentences;
  }

  /**
   * Computes context relevance between query and context chunks.
   */
  private static computeContextRelevance(query: string, contexts: string[]): number {
    if (!query.trim() || contexts.length === 0) return 0.0;

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return 0.0;

    const combinedContext = contexts.join(' ');
    const contextTokens = new Set(this.tokenize(combinedContext));

    let matched = 0;
    for (const qt of queryTokens) {
      if (contextTokens.has(qt)) matched++;
    }

    const tokenOverlapRatio = matched / queryTokens.length;

    // Check for key entity / number alignment
    const queryNumbers = query.match(/\b\d+(\.\d+)?\b/g) || [];
    let numberHits = 0;
    if (queryNumbers.length > 0) {
      for (const num of queryNumbers) {
        if (combinedContext.includes(num)) numberHits++;
      }
      const numRatio = numberHits / queryNumbers.length;
      return Number(Math.min(1.0, (tokenOverlapRatio * 0.7) + (numRatio * 0.3)).toFixed(3));
    }

    return Number(Math.min(1.0, tokenOverlapRatio).toFixed(3));
  }

  /**
   * Verifies an individual sentence claim against retrieved context chunks.
   */
  private static verifyClaimAgainstContexts(claim: string, contexts: string[]): RagClaimVerification {
    if (contexts.length === 0) {
      return { claim, isGrounded: false, confidence: 0.0 };
    }

    const claimTokens = this.tokenize(claim);
    if (claimTokens.length === 0) {
      return { claim, isGrounded: true, confidence: 1.0 };
    }

    // Check for numbers and monetary amounts in claim
    const claimNumbers = claim.match(/(\$\s*\d+[\d,]*(\.\d+)?|\b\d+[\d,]*(\.\d+)?\b)/g) || [];

    let bestChunkIndex = -1;
    let highestOverlap = 0;
    let numberMismatch = false;

    for (let i = 0; i < contexts.length; i++) {
      const chunk = contexts[i];
      const chunkTokens = new Set(this.tokenize(chunk));

      let hits = 0;
      for (const ct of claimTokens) {
        if (chunkTokens.has(ct)) hits++;
      }
      const overlap = hits / claimTokens.length;

      if (overlap > highestOverlap) {
        highestOverlap = overlap;
        bestChunkIndex = i;
      }

      // Check numbers in this chunk
      if (claimNumbers.length > 0) {
        for (const cn of claimNumbers) {
          const cleanNum = cn.replace(/[$,]/g, '').trim();
          if (chunk.includes(cleanNum)) {
            // Number confirmed in chunk
            highestOverlap += 0.15;
          }
        }
      }
    }

    // If claim contains specific numbers not found in any context, flag as potential hallucination
    if (claimNumbers.length > 0) {
      const allChunksText = contexts.join(' ');
      const missingNumbers = claimNumbers.filter(cn => {
        const clean = cn.replace(/[$,]/g, '').trim();
        return !allChunksText.includes(clean);
      });
      if (missingNumbers.length > 0) {
        numberMismatch = true;
      }
    }

    const ungroundedTokens = claimTokens.filter(ct => {
      return !contexts.some(c => c.toLowerCase().includes(ct));
    });

    const isGrounded = highestOverlap >= 0.45 && !numberMismatch;
    const confidence = Number(Math.min(1.0, Math.max(0.0, highestOverlap)).toFixed(3));

    return {
      claim,
      isGrounded,
      confidence,
      matchingChunkIndex: bestChunkIndex >= 0 ? bestChunkIndex : undefined,
      ungroundedTokens: ungroundedTokens.slice(0, 5)
    };
  }

  /**
   * Computes whether the response answers key question aspects.
   */
  private static computeAnswerCompleteness(query: string, response: string): number {
    if (!query.trim() || !response.trim()) return 0.0;

    const respLen = response.trim().length;
    if (respLen < 20) return 0.2; // Too brief

    const queryTokens = this.tokenize(query);
    const respTokens = new Set(this.tokenize(response));

    let matched = 0;
    for (const qt of queryTokens) {
      if (respTokens.has(qt)) matched++;
    }

    const overlap = queryTokens.length > 0 ? matched / queryTokens.length : 0.5;
    return Number(Math.min(1.0, Math.max(0.2, overlap * 1.2)).toFixed(3));
  }

  /**
   * Tokenizes text into lowercase normalized words, omitting stopwords.
   */
  private static tokenize(text: string): string[] {
    const stopwords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to',
      'for', 'of', 'with', 'by', 'from', 'this', 'that', 'these', 'those', 'it', 'its', 'as'
    ]);

    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w));
  }

  /**
   * Computes aggregate dataset statistics across evaluated and pending triplets.
   */
  static computeSummary(triplets: RagEvalTriplet[]): RagEvalDatasetSummary {
    const totalCount = triplets.length;
    let evaluatedCount = 0;
    let groundedCount = 0;
    let hallucinationCount = 0;
    let irrelevantCount = 0;
    let incompleteCount = 0;
    let sumFaithfulness = 0;
    let sumContextRelevance = 0;
    let uncertaintyQueueCount = 0;

    for (const t of triplets) {
      if (t.annotation?.verified) {
        evaluatedCount++;
        const l = t.annotation.label;
        if (l === 'grounded') groundedCount++;
        else if (l === 'hallucination') hallucinationCount++;
        else if (l === 'irrelevant_context') irrelevantCount++;
        else if (l === 'incomplete') incompleteCount++;
      } else if (t.automatedMetrics?.ambiguityScore && t.automatedMetrics.ambiguityScore > 0.4) {
        uncertaintyQueueCount++;
      }

      if (t.automatedMetrics) {
        sumFaithfulness += t.automatedMetrics.faithfulnessScore;
        sumContextRelevance += t.automatedMetrics.contextRelevanceScore;
      }
    }

    const pendingCount = totalCount - evaluatedCount;
    const evaluatedBase = evaluatedCount || 1;

    return {
      totalCount,
      evaluatedCount,
      pendingCount,
      groundedCount,
      hallucinationCount,
      irrelevantCount,
      incompleteCount,
      groundedRatePct: Number(((groundedCount / evaluatedBase) * 100).toFixed(1)),
      hallucinationRatePct: Number(((hallucinationCount / evaluatedBase) * 100).toFixed(1)),
      avgFaithfulness: totalCount > 0 ? Number((sumFaithfulness / totalCount).toFixed(3)) : 0.0,
      avgContextRelevance: totalCount > 0 ? Number((sumContextRelevance / totalCount).toFixed(3)) : 0.0,
      uncertaintyQueueCount,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Sorts triplets by descending ambiguity score, presenting highest uncertainty items first.
   */
  static triageUncertaintyQueue(triplets: RagEvalTriplet[]): RagEvalTriplet[] {
    return [...triplets].sort((a, b) => {
      // Unverified items come first
      const aVerified = a.annotation?.verified ? 1 : 0;
      const bVerified = b.annotation?.verified ? 1 : 0;
      if (aVerified !== bVerified) return aVerified - bVerified;

      // Higher ambiguity first
      const ambA = a.automatedMetrics?.ambiguityScore ?? 0;
      const ambB = b.automatedMetrics?.ambiguityScore ?? 0;
      return ambB - ambA;
    });
  }

  /**
   * Built-in Demo Dataset generator: produces 5 realistic enterprise RAG scenarios.
   */
  static generateDemoDataset(): RagEvalTriplet[] {
    return [
      {
        id: 'rag_001_fin_grounded',
        query: 'What was the Q3 operating margin for Cloud Services and what drove the increase?',
        contexts: [
          'Cloud Services segment operating income reached $4.2B in Q3 2026, representing an operating margin of 32.4%, up 210 basis points year-over-year.',
          'The margin expansion was primarily driven by server efficiency optimization, favorable memory component pricing, and reduced datacenter cooling overhead.'
        ],
        response: 'In Q3 2026, the operating margin for Cloud Services was 32.4% (up 210 basis points YoY). The expansion was driven by server efficiency optimization, lower memory component costs, and reduced cooling overhead.',
        metadata: { domain: 'Finance & Earnings', model: 'llama-3.3-70b' }
      },
      {
        id: 'rag_002_fin_hallucination',
        query: 'What was the total capital expenditure allocated to AI GPU clusters in 2026?',
        contexts: [
          'Total enterprise infrastructure capital expenditure for 2026 was projected at $12.8B across compute, storage, and networking.',
          'The board approved initial cluster expansion projects in Oregon and Dublin facilities.'
        ],
        response: 'The company allocated exactly $8.5B specifically for AI GPU clusters in 2026, purchasing 45,000 H100 units from Nvidia.',
        metadata: { domain: 'Finance & Capex', model: 'qwen2.5-coder' }
      },
      {
        id: 'rag_003_legal_irrelevant',
        query: 'What are the indemnification limits under Section 14 for intellectual property claims?',
        contexts: [
          'Section 8: Termination for convenience requires thirty (30) days prior written notice by either party.',
          'Section 9: Governing law shall be the laws of the State of New York without regard to conflict of law principles.'
        ],
        response: 'Section 14 provides an aggregate liability cap equal to twelve months of fees paid prior to the claim.',
        metadata: { domain: 'Legal & Compliance', model: 'claude-3.5-sonnet' }
      },
      {
        id: 'rag_004_health_grounded',
        query: 'What is the required fasting period prior to the metabolic lipid panel?',
        contexts: [
          'Patients scheduled for a comprehensive metabolic lipid panel must fast for a minimum of 8 to 12 hours prior to venipuncture.',
          'Plain water consumption is permitted and encouraged to maintain adequate hydration.'
        ],
        response: 'Patients must fast for 8 to 12 hours before the metabolic lipid panel. Drinking plain water is permitted and encouraged.',
        metadata: { domain: 'Clinical Protocol', model: 'gpt-4o' }
      },
      {
        id: 'rag_005_ops_incomplete',
        query: 'What are the three mandatory failover verification steps for the Redis cluster?',
        contexts: [
          'Failover verification requires: Step 1: Confirm replica promotion via SENTINEL get-master-addr-by-name.',
          'Step 2: Verify write traffic routing to the promoted primary.',
          'Step 3: Confirm replica synchronization lag is under 200ms across all secondary nodes.'
        ],
        response: 'First, check replica promotion using the Sentinel address lookup command.',
        metadata: { domain: 'Cloud SRE', model: 'deepseek-v3' }
      }
    ];
  }

  /**
   * Exports annotated triplets to RAGAS / DeepEval compatible JSONL.
   */
  static exportToRagasJsonl(triplets: RagEvalTriplet[]): string {
    return triplets.map(t => {
      const record = {
        question: t.query,
        contexts: t.contexts,
        answer: t.response,
        ground_truth: t.groundTruth || null,
        user_annotation: t.annotation?.label || null,
        faithfulness_rating: t.annotation?.faithfulnessRating || null,
        context_relevance_rating: t.annotation?.contextRelevanceRating || null,
        automated_faithfulness: t.automatedMetrics?.faithfulnessScore || null,
        automated_relevance: t.automatedMetrics?.contextRelevanceScore || null,
        metadata: t.metadata || {}
      };
      return JSON.stringify(record);
    }).join('\n');
  }

  /**
   * Exports annotated dataset to Evolve AI Golden Benchmark suite structure.
   */
  static exportToGoldenBenchmark(triplets: RagEvalTriplet[], suiteName: string = 'rag_eval_golden_suite'): any {
    const verifiedTriplets = triplets.filter(t => t.annotation?.verified);
    const activeSet = verifiedTriplets.length > 0 ? verifiedTriplets : triplets;

    return {
      suiteName,
      createdAt: new Date().toISOString(),
      framework: 'EvolveAI_RAG_GoldenBenchmark_v1',
      totalCases: activeSet.length,
      evaluationThresholds: {
        minimumFaithfulness: 0.85,
        minimumContextRelevance: 0.70,
        maximumHallucinationRatePct: 5.0
      },
      testCases: activeSet.map(t => ({
        id: t.id,
        query: t.query,
        expectedContexts: t.contexts,
        expectedBehavior: t.annotation?.label === 'hallucination' ? 'REJECT_OR_FLAG' : 'GROUNDED_ANSWER',
        targetLabel: t.annotation?.label || t.automatedMetrics?.suggestedLabel || 'grounded',
        expectedResponseSubstring: t.groundTruth || undefined,
        knownHallucinatedClaims: t.annotation?.hallucinatedClaims || []
      }))
    };
  }

  /**
   * Exports dataset to tabular CSV for spreadsheet analysis.
   */
  static exportToCsv(triplets: RagEvalTriplet[]): string {
    const header = ['id', 'query', 'response', 'label', 'verified', 'faithfulness', 'context_relevance', 'ambiguity'];
    const rows = triplets.map(t => {
      const esc = (s: any) => `"${String(s || '').replace(/"/g, '""')}"`;
      return [
        esc(t.id),
        esc(t.query),
        esc(t.response),
        esc(t.annotation?.label || t.automatedMetrics?.suggestedLabel || 'unlabeled'),
        esc(t.annotation?.verified ? 'true' : 'false'),
        esc(t.automatedMetrics?.faithfulnessScore ?? ''),
        esc(t.automatedMetrics?.contextRelevanceScore ?? ''),
        esc(t.automatedMetrics?.ambiguityScore ?? '')
      ].join(',');
    });

    return [header.join(','), ...rows].join('\n');
  }

  /**
   * Generates an executive Markdown report scorecard.
   */
  static exportExecutiveReportMarkdown(triplets: RagEvalTriplet[]): string {
    const summary = this.computeSummary(triplets);
    const dateStr = new Date().toLocaleDateString();

    return `# Evolve AI: RAG & LLM Golden Evaluation Scorecard

**Date:** ${dateStr}  
**Air-Gapped Sovereign Audit** &middot; 100% Deterministic Verification

---

## 1. Executive Summary

| Metric | Score / Value | Status |
| :--- | :--- | :--- |
| **Total Test Scenarios** | ${summary.totalCount} | Completed |
| **Human Verified** | ${summary.evaluatedCount} / ${summary.totalCount} (${((summary.evaluatedCount / (summary.totalCount || 1)) * 100).toFixed(0)}%) | ${summary.pendingCount === 0 ? '✓ Complete' : 'In Progress'} |
| **Grounded Answer Rate** | **${summary.groundedRatePct}%** | ${summary.groundedRatePct >= 80 ? '🟢 Pass' : '🔴 Review Required'} |
| **Hallucination Rate** | **${summary.hallucinationRatePct}%** | ${summary.hallucinationRatePct <= 10 ? '🟢 Safe' : '🚨 High Risk'} |
| **Average Faithfulness** | ${(summary.avgFaithfulness * 100).toFixed(1)}% | Triad Grounding |
| **Average Context Relevance** | ${(summary.avgContextRelevance * 100).toFixed(1)}% | Retrieval Quality |

---

## 2. Evaluation Breakdown

* **Grounded / Accurate Answers:** ${summary.groundedCount}
* **Detected Hallucinations:** ${summary.hallucinationCount}
* **Irrelevant Context Retrievals:** ${summary.irrelevantCount}
* **Incomplete / Truncated Answers:** ${summary.incompleteCount}
* **Pending Uncertainty Queue Items:** ${summary.uncertaintyQueueCount}

---

## 3. Individual Test Case Ledger

${triplets.map((t, idx) => {
  const label = t.annotation?.label || t.automatedMetrics?.suggestedLabel || 'unlabeled';
  const labelBadge = label === 'grounded' ? '🟢 GROUNDED' : label === 'hallucination' ? '🔴 HALLUCINATION' : label === 'irrelevant_context' ? '🟡 IRRELEVANT RETRIEVAL' : '⚪ INCOMPLETE';
  return `### ${idx + 1}. [${t.id}] ${labelBadge}
* **Query:** ${t.query}
* **Response:** ${t.response}
* **Context Count:** ${t.contexts.length} chunks
* **Faithfulness Score:** ${t.automatedMetrics?.faithfulnessScore ?? '—'}
* **Context Relevance:** ${t.automatedMetrics?.contextRelevanceScore ?? '—'}
`;
}).join('\n')}
`;
  }
}
