/**
 * src/fde/codebaseGraph/cosmosContextBridge.ts
 *
 * Codebase Cosmos to Agent Brainstorm Bridge for Evolve AI.
 * Resolves GAP-08.
 *
 * Extracts deep brownfield intelligence from Git commit history, AST import DAGs,
 * temporal co-commit couplings, and database schema mappings, injecting actionable
 * engineering context directly into FDE planning and brainstorm prompts.
 */

import * as path from 'path';
import { CodebaseGraphEngine } from './index';

export interface CosmosSummaryOptions {
  maxCommits?: number;
  daysWindow?: number;
  focusFiles?: string[];
  includeDbLinks?: boolean;
}

export class CosmosContextBridge {
  constructor(private readonly _workspaceRoot: string) {}

  public async getContextSummary(options?: CosmosSummaryOptions): Promise<string> {
    try {
      const result = await CodebaseGraphEngine.analyze(this._workspaceRoot, {
        maxCommits: options?.maxCommits || 1000,
        daysWindow: options?.daysWindow || 90
      });

      const focusSet = options?.focusFiles && options.focusFiles.length > 0
        ? new Set(options.focusFiles.map(f => this._normalize(f)))
        : null;

      const hotspotLines: string[] = [];
      const couplingLines: string[] = [];
      const dbLinkLines: string[] = [];
      const cycleLines: string[] = [];

      // 1. Churn & Defect Hotspots
      const sortedByHotspot = [...result.nodes]
        .filter(n => !focusSet || focusSet.has(n.id))
        .sort((a, b) => b.hotspotScore - a.hotspotScore);

      for (const node of sortedByHotspot.slice(0, 5)) {
        if (node.hotspotScore > 10) {
          hotspotLines.push(
            `  • \`${node.id}\`: Hotspot Score ${node.hotspotScore.toFixed(0)} (Churn: ${node.churnLines} lines across ${node.commitCount} commits, Defects: ${node.defectCount})`
          );
        }
      }

      // 2. Temporal Couplings (Hidden Co-Commit Architectural Dependencies)
      for (const tc of result.temporalCouplings || []) {
        if (!focusSet || focusSet.has(tc.fileA) || focusSet.has(tc.fileB)) {
          couplingLines.push(
            `  • \`${tc.fileA}\` ↔ \`${tc.fileB}\`: Co-committed in ${tc.coCommits} changes (Jaccard ${(tc.jaccard * 100).toFixed(0)}%). Keep in sync.`
          );
        }
      }

      // 3. Database Entity Links
      for (const node of result.nodes) {
        if ((!focusSet || focusSet.has(node.id)) && node.linkedTables && node.linkedTables.length > 0) {
          dbLinkLines.push(`  • \`${node.id}\` queries/maps database tables: [${node.linkedTables.join(', ')}]`);
        }
      }

      // 4. Circular Dependencies (Tarjan SCC)
      for (const loop of result.circularDependencies || []) {
        if (loop.cycle && loop.cycle.length > 1) {
          cycleLines.push(`  • Circular Loop detected: [${loop.cycle.join(' → ')}]`);
        }
      }

      const sections: string[] = [];

      if (hotspotLines.length > 0) {
        sections.push(`### High-Churn Hotspots (Surgical Changes Mandated)\n${hotspotLines.join('\n')}`);
      }
      if (couplingLines.length > 0) {
        sections.push(`### Hidden Temporal Couplings (Check Dependent Files)\n${couplingLines.slice(0, 5).join('\n')}`);
      }
      if (dbLinkLines.length > 0) {
        sections.push(`### Database Schema Dependencies\n${dbLinkLines.slice(0, 5).join('\n')}`);
      }
      if (cycleLines.length > 0) {
        sections.push(`### Circular Dependencies (Refactoring Opportunities)\n${cycleLines.slice(0, 3).join('\n')}`);
      }

      if (sections.length === 0) {
        return 'Codebase Cosmos: Clean architectural boundaries with zero high-churn hotspots or circular dependencies.';
      }

      return `## 🌐 Codebase Cosmos Intelligence\n\n${sections.join('\n\n')}`;
    } catch (err: any) {
      return `Codebase Cosmos analysis skipped: ${err.message}`;
    }
  }

  private _normalize(filePath: string): string {
    const rel = path.isAbsolute(filePath)
      ? path.relative(this._workspaceRoot, filePath)
      : filePath;
    return rel.replace(/\\/g, '/');
  }
}
