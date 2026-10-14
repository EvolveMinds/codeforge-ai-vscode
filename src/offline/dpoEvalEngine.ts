/**
 * Evolve AI — Pairwise LLM Preference Annotation & Offline DPO / RLHF Arena Engine
 *
 * Provides sovereign, 100% air-gapped side-by-side model comparison, blind evaluation,
 * Elo rating computation, critique tagging, and export to industry-standard DPO/ORPO JSONL.
 *
 * Zero external network calls. 100% offline mathematical and deterministic processing.
 */

export type DpoPreferenceVerdict = 'model_a' | 'model_b' | 'tie' | 'both_bad' | 'unrated';

export interface DpoScenarioItem {
  id: string;
  prompt: string;
  systemPrompt?: string;
  contextChunks?: Array<{ documentId: string; chunkId: string; text: string }>;
  modelA: {
    modelId: string;
    modelDisplayName?: string;
    response: string;
    latencyMs?: number;
    tokenCount?: number;
  };
  modelB: {
    modelId: string;
    modelDisplayName?: string;
    response: string;
    latencyMs?: number;
    tokenCount?: number;
  };
  verdict?: DpoPreferenceVerdict;
  critiqueTags?: string[];
  evaluatorNotes?: string;
  evaluatedAt?: string;
  metadata?: {
    domain?: string;
    taskType?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
  };
}

export interface DpoLeaderboardEntry {
  modelId: string;
  modelDisplayName: string;
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  bothBad: number;
  winRate: number; // 0..1
  eloScore: number; // standard starting 1200
}

export interface DpoLeaderboardSummary {
  totalComparisons: number;
  ratedComparisons: number;
  pendingComparisons: number;
  models: DpoLeaderboardEntry[];
  topCritiqueTags: Array<{ tag: string; count: number }>;
}

export class DpoEvalEngine {
  /**
   * Generates a realistic set of enterprise demo scenarios comparing two models
   * across finance, clinical compliance, architecture, and coding tasks.
   */
  public static generateDemoScenarios(): DpoScenarioItem[] {
    return [
      {
        id: 'dpo_001',
        prompt: 'Calculate ACME Corp gross margin and operating income given revenue $45.2M, COGS $22.1M, and OpEx $11.4M.',
        systemPrompt: 'You are an executive enterprise financial auditor. Provide exact calculations with step-by-step arithmetic.',
        contextChunks: [
          {
            documentId: 'acme_10q.pdf',
            chunkId: 'c1',
            text: 'For the fiscal quarter ended Sept 30, ACME Corp recorded revenue of $45.2M, Cost of Goods Sold of $22.1M, and Operating Expenses of $11.4M.'
          }
        ],
        modelA: {
          modelId: 'qwen2.5-coder:7b',
          modelDisplayName: 'Qwen 2.5 Coder (7B Local)',
          response: 'Gross Profit = $45.2M - $22.1M = $23.1M.\nGross Margin = $23.1M / $45.2M = 51.11%.\nOperating Income = $23.1M - $11.4M = $11.7M (Operating Margin: 25.88%).\nAll figures verified against SEC filing.',
          latencyMs: 420,
          tokenCount: 68
        },
        modelB: {
          modelId: 'deepseek-r1:8b',
          modelDisplayName: 'DeepSeek R1 (8B Reasoning)',
          response: 'The company did fairly well. Gross margin is roughly 50% and operating income is approximately $10M after accounting for corporate overhead and operating costs.',
          latencyMs: 780,
          tokenCount: 42
        },
        metadata: {
          domain: 'Finance',
          taskType: 'Financial Arithmetic',
          difficulty: 'easy'
        }
      },
      {
        id: 'dpo_002',
        prompt: 'Provide the dosage schedule and renal adjustment protocol for Ceftriaxone in adult patients with CrCl < 30 mL/min.',
        systemPrompt: 'You are a clinical pharmacotherapy specialist. Be precise on dose titrations and organ clearance limits.',
        contextChunks: [
          {
            documentId: 'fda_package_insert.pdf',
            chunkId: 'c1',
            text: 'Ceftriaxone is eliminated via both biliary and renal mechanisms. No dosage adjustment is required for patients with renal impairment alone up to 2 g daily, unless concurrent hepatic impairment exists.'
          }
        ],
        modelA: {
          modelId: 'qwen2.5-coder:7b',
          modelDisplayName: 'Qwen 2.5 Coder (7B Local)',
          response: 'Reduce dosage by 50% immediately to 500mg daily to avoid severe renal toxicity and drug accumulation in the kidneys.',
          latencyMs: 380,
          tokenCount: 38
        },
        modelB: {
          modelId: 'deepseek-r1:8b',
          modelDisplayName: 'DeepSeek R1 (8B Reasoning)',
          response: 'Unlike most cephalosporins, Ceftriaxone exhibits dual biliary and renal excretion. According to clinical protocols, no dosage adjustment is necessary for isolated renal impairment (up to 2g/day) provided hepatic function is intact.',
          latencyMs: 650,
          tokenCount: 62
        },
        metadata: {
          domain: 'Healthcare',
          taskType: 'Clinical Protocol',
          difficulty: 'hard'
        }
      },
      {
        id: 'dpo_003',
        prompt: 'Write an idempotent PostgreSQL migration to add an email column to users table with a unique index without locking table writes.',
        systemPrompt: 'You are a staff database reliability engineer. Prioritize zero-downtime DDL.',
        contextChunks: [],
        modelA: {
          modelId: 'qwen2.5-coder:7b',
          modelDisplayName: 'Qwen 2.5 Coder (7B Local)',
          response: 'ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_uniq ON users (email);',
          latencyMs: 310,
          tokenCount: 44
        },
        modelB: {
          modelId: 'deepseek-r1:8b',
          modelDisplayName: 'DeepSeek R1 (8B Reasoning)',
          response: 'ALTER TABLE users ADD COLUMN email VARCHAR(255) UNIQUE;',
          latencyMs: 290,
          tokenCount: 18
        },
        metadata: {
          domain: 'Database Engineering',
          taskType: 'Zero-Downtime DDL',
          difficulty: 'medium'
        }
      },
      {
        id: 'dpo_004',
        prompt: 'What are the SOC 2 Type II audit requirements for cryptographic key management in AWS KMS?',
        systemPrompt: 'You are an enterprise cybersecurity compliance architect.',
        contextChunks: [
          {
            documentId: 'soc2_cc6.pdf',
            chunkId: 'c1',
            text: 'Trust Services Criteria CC6.1 and CC6.7 require annual key rotation, role-based key policies restricting decryption, and AWS CloudTrail logging for all KMS API actions.'
          }
        ],
        modelA: {
          modelId: 'qwen2.5-coder:7b',
          modelDisplayName: 'Qwen 2.5 Coder (7B Local)',
          response: 'SOC 2 CC6 criteria requires: 1) Automated annual key rotation via KMS CMK policies; 2) Principle of least privilege key access policies decoupled from IAM roles; 3) Unalterable CloudTrail event logging for all Decrypt/GenerateDataKey API calls.',
          latencyMs: 510,
          tokenCount: 72
        },
        modelB: {
          modelId: 'deepseek-r1:8b',
          modelDisplayName: 'DeepSeek R1 (8B Reasoning)',
          response: 'SOC 2 requires encryption at rest. KMS automatically handles this without any special configuration or audit logging necessary.',
          latencyMs: 440,
          tokenCount: 30
        },
        metadata: {
          domain: 'Cybersecurity',
          taskType: 'SOC 2 Compliance',
          difficulty: 'medium'
        }
      }
    ];
  }

  /**
   * Records a user preference verdict, timestamp, critique tags, and notes on a scenario.
   */
  public static recordVerdict(
    item: DpoScenarioItem,
    verdict: DpoPreferenceVerdict,
    critiqueTags?: string[],
    notes?: string
  ): DpoScenarioItem {
    return {
      ...item,
      verdict,
      critiqueTags: critiqueTags ? [...critiqueTags] : item.critiqueTags || [],
      evaluatorNotes: notes !== undefined ? notes : item.evaluatorNotes,
      evaluatedAt: new Date().toISOString()
    };
  }

  /**
   * Computes Elo ratings and win rates across all models evaluated in the dataset.
   * Standard Elo formula: E_A = 1 / (1 + 10^((R_B - R_A)/400)), K-factor = 32.
   */
  public static computeLeaderboard(items: DpoScenarioItem[]): DpoLeaderboardSummary {
    const modelStats = new Map<string, {
      name: string;
      matches: number;
      wins: number;
      losses: number;
      ties: number;
      bothBad: number;
      elo: number;
    }>();

    const tagCounts = new Map<string, number>();

    const getOrInit = (id: string, displayName?: string) => {
      if (!modelStats.has(id)) {
        modelStats.set(id, {
          name: displayName || id,
          matches: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          bothBad: 0,
          elo: 1200
        });
      }
      return modelStats.get(id)!;
    };

    let totalComparisons = items.length;
    let ratedComparisons = 0;

    for (const it of items) {
      const v = it.verdict;
      if (!v || v === 'unrated') continue;

      ratedComparisons++;
      const mA = getOrInit(it.modelA.modelId, it.modelA.modelDisplayName);
      const mB = getOrInit(it.modelB.modelId, it.modelB.modelDisplayName);

      mA.matches++;
      mB.matches++;

      // Count tags
      if (it.critiqueTags && it.critiqueTags.length > 0) {
        for (const t of it.critiqueTags) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }

      // Elo calculation
      const k = 32;
      const rA = mA.elo;
      const rB = mB.elo;
      const expA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
      const expB = 1 / (1 + Math.pow(10, (rA - rB) / 400));

      let scoreA = 0.5;
      let scoreB = 0.5;

      if (v === 'model_a') {
        mA.wins++;
        mB.losses++;
        scoreA = 1.0;
        scoreB = 0.0;
      } else if (v === 'model_b') {
        mB.wins++;
        mA.losses++;
        scoreA = 0.0;
        scoreB = 1.0;
      } else if (v === 'tie') {
        mA.ties++;
        mB.ties++;
        scoreA = 0.5;
        scoreB = 0.5;
      } else if (v === 'both_bad') {
        mA.bothBad++;
        mB.bothBad++;
        scoreA = 0.0;
        scoreB = 0.0;
      }

      mA.elo = Math.round(mA.elo + k * (scoreA - expA));
      mB.elo = Math.round(mB.elo + k * (scoreB - expB));
    }

    const leaderboard: DpoLeaderboardEntry[] = Array.from(modelStats.entries()).map(([id, s]) => {
      const decMatches = s.wins + s.losses + s.ties;
      const winRate = decMatches > 0 ? (s.wins + 0.5 * s.ties) / decMatches : 0;
      return {
        modelId: id,
        modelDisplayName: s.name,
        matches: s.matches,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        bothBad: s.bothBad,
        winRate: Math.round(winRate * 100) / 100,
        eloScore: s.elo
      };
    });

    leaderboard.sort((a, b) => b.eloScore - a.eloScore || b.winRate - a.winRate);

    const sortedTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalComparisons,
      ratedComparisons,
      pendingComparisons: totalComparisons - ratedComparisons,
      models: leaderboard,
      topCritiqueTags: sortedTags
    };
  }

  /**
   * Exports pairwise verdicts into Hugging Face / TRL standard DPO JSONL format:
   * {"prompt": "...", "chosen": "...", "rejected": "..."}
   * Excludes ties, unrated, and both_bad items from pairwise preference datasets.
   */
  public static exportDpoJsonl(items: DpoScenarioItem[]): string {
    const validPairs = items.filter(it => it.verdict === 'model_a' || it.verdict === 'model_b');
    return validPairs.map(it => {
      const isAChosen = it.verdict === 'model_a';
      const chosenModel = isAChosen ? it.modelA : it.modelB;
      const rejectedModel = isAChosen ? it.modelB : it.modelA;

      return JSON.stringify({
        prompt: it.prompt,
        system: it.systemPrompt || '',
        chosen: chosenModel.response,
        rejected: rejectedModel.response,
        chosen_model: chosenModel.modelId,
        rejected_model: rejectedModel.modelId,
        critique_tags: it.critiqueTags || [],
        metadata: {
          scenario_id: it.id,
          domain: it.metadata?.domain || 'general',
          evaluated_at: it.evaluatedAt || new Date().toISOString()
        }
      });
    }).join('\n');
  }

  /**
   * Exports an executive Markdown comparison report with Elo leaderboard and scenario breakdowns.
   */
  public static exportMarkdownReport(items: DpoScenarioItem[]): string {
    const summary = this.computeLeaderboard(items);
    let md = `# Evolve AI — Pairwise Model Preference & Elo Arena Report\n\n`;
    md += `*Generated: ${new Date().toISOString()} • Sovereign Air-Gapped Evaluation*\n\n`;
    md += `### Summary Metrics\n`;
    md += `- **Total Scenarios**: ${summary.totalComparisons}\n`;
    md += `- **Evaluated Matches**: ${summary.ratedComparisons}\n`;
    md += `- **Pending Triage**: ${summary.pendingComparisons}\n\n`;

    md += `### Model Elo Leaderboard\n\n`;
    md += `| Rank | Model Name | Model ID | Elo Rating | Win Rate | Wins | Losses | Ties | Both Bad |\n`;
    md += `| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    summary.models.forEach((m, idx) => {
      md += `| ${idx + 1} | **${m.modelDisplayName}** | \`${m.modelId}\` | **${m.eloScore}** | ${(m.winRate * 100).toFixed(0)}% | ${m.wins} | ${m.losses} | ${m.ties} | ${m.bothBad} |\n`;
    });

    md += `\n### Evaluated Scenario Pairs\n\n`;
    items.forEach((it, idx) => {
      const vLabel = it.verdict === 'model_a'
        ? `🟢 Won by ${it.modelA.modelDisplayName || it.modelA.modelId}`
        : it.verdict === 'model_b'
        ? `🟢 Won by ${it.modelB.modelDisplayName || it.modelB.modelId}`
        : it.verdict === 'tie'
        ? `🟡 Tie (Equally Good)`
        : it.verdict === 'both_bad'
        ? `🔴 Both Defective / Hallucinated`
        : `⚪ Unrated`;

      md += `#### Scenario ${idx + 1}: ${it.id} (${it.metadata?.domain || 'General'})\n`;
      md += `**Prompt**: ${it.prompt}\n\n`;
      md += `- **Verdict**: **${vLabel}**\n`;
      if (it.critiqueTags && it.critiqueTags.length > 0) {
        md += `- **Critique Tags**: ${it.critiqueTags.join(', ')}\n`;
      }
      if (it.evaluatorNotes) {
        md += `- **Notes**: ${it.evaluatorNotes}\n`;
      }
      md += `\n`;
    });

    return md;
  }

  /**
   * Exports an enterprise Golden DPO Benchmark test suite schema.
   */
  public static exportEnterpriseSuite(items: DpoScenarioItem[]): string {
    const summary = this.computeLeaderboard(items);
    return JSON.stringify({
      suiteName: 'Evolve AI Sovereign DPO Preference Benchmark Suite',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      governance: {
        airGapped: true,
        certifiedOffline: true,
        evaluatorTool: 'Evolve AI Arena v2.28'
      },
      leaderboard: summary,
      scenarios: items
    }, null, 2);
  }
}
