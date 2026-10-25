/**
 * src/fde/learningsEngine.ts
 *
 * Compound Learning Engine for Evolve AI Forward Deployed Engineers.
 * Resolves GAP-11.
 *
 * Enforces in-repo institutional learning capture so engineering pitfalls,
 * edge cases, and architectural discoveries compound into permanent repository
 * intelligence rather than disappearing upon session close.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LearningRecord {
  id: string;
  issueId?: string;
  title: string;
  subsystem: string;
  context: string;
  pitfallDiscovered: string;
  rootCause: string;
  verifiedSolution: string;
  antiPatternsToAvoid: string[];
  createdAt: number;
}

export class LearningsEngine {
  private _learningsDir: string;

  constructor(private readonly _workspaceRoot: string) {
    this._learningsDir = path.join(this._workspaceRoot, 'docs', 'artifacts', 'learnings');
  }

  public async capture(
    data: Omit<LearningRecord, 'id' | 'createdAt'>
  ): Promise<{ id: string; filePath: string }> {
    if (!fs.existsSync(this._learningsDir)) {
      try {
        await fs.promises.mkdir(this._learningsDir, { recursive: true });
      } catch {}
    }

    const id = `LEARNING-${Date.now().toString(36).toUpperCase()}`;
    const cleanTitle = data.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 35);
    const fileName = `${id}-${cleanTitle}.md`;
    const fullPath = path.join(this._learningsDir, fileName);

    const markdown = `# ${id}: ${data.title}

> **Subsystem**: \`${data.subsystem}\` | **Date**: ${new Date().toISOString()} ${data.issueId ? `| **Issue**: #${data.issueId}` : ''}

---

## 1. Context & Objective
${data.context}

---

## 2. Discovered Pitfall & Root Cause Analysis
${data.pitfallDiscovered}

**Root Cause**:
${data.rootCause}

---

## 3. Verified Solution & Reusable Pattern
${data.verifiedSolution}

---

## 4. Anti-Patterns to Avoid
${data.antiPatternsToAvoid.map(a => `- ❌ **AVOID**: ${a}`).join('\n')}
`;

    await fs.promises.writeFile(fullPath, markdown, 'utf8');
    return { id, filePath: fullPath };
  }

  public async retrieveRelevantLearnings(query: string, maxItems = 3): Promise<string[]> {
    if (!fs.existsSync(this._learningsDir)) return [];

    let files: string[] = [];
    try {
      files = await fs.promises.readdir(this._learningsDir);
    } catch {
      return [];
    }

    const mdFiles = files.filter(f => f.endsWith('.md'));
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    const scored: Array<{ content: string; score: number }> = [];

    for (const f of mdFiles) {
      try {
        const full = path.join(this._learningsDir, f);
        const text = await fs.promises.readFile(full, 'utf8');
        const lower = text.toLowerCase();

        let score = 0;
        for (const term of terms) {
          if (lower.includes(term)) {
            score += 1;
          }
        }

        if (score > 0) {
          scored.push({ content: text, score });
        }
      } catch {}
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxItems).map(s => s.content);
  }
}
