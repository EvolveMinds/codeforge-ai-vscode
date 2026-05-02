/**
 * ui/queryAnalysisStore.ts — Per-statement analysis cache (DE #2)
 *
 * The CodeLens lazily asks the store for "do you have a cached analysis for
 * this SQL hash?" — and only triggers a fresh run on explicit user action
 * (clicking the lens or invoking the command). Analysis runs are NOT
 * automatic, because EXPLAIN consumes warehouse seconds even on Databricks.
 *
 * Cache TTL: 5 minutes per SQL hash. User can force re-run via the "Refresh"
 * button in the panel.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import type { QueryAnalysis, PluginQueryAnalyzer } from '../core/plugin';
import type { FileContext } from '../core/contextService';

const TTL_MS = 5 * 60 * 1000;

export interface AnalysisRecord {
  analysis: QueryAnalysis;
  /** When this record was placed in the cache */
  cachedAt: number;
}

export class QueryAnalysisStore {
  private _byHash = new Map<string, AnalysisRecord>();
  private _inflight = new Map<string, Promise<QueryAnalysis>>();
  private readonly _emitter = new vscode.EventEmitter<{ sqlHash: string; analysis: QueryAnalysis }>();
  readonly onDidChange = this._emitter.event;

  constructor(private readonly _svc: IServices) {
    _svc.vsCtx.subscriptions.push({ dispose: () => this.dispose() });
  }

  /** Cached analysis for a hash, or undefined if stale / absent. */
  get(sqlHash: string): QueryAnalysis | undefined {
    const rec = this._byHash.get(sqlHash);
    if (!rec) return undefined;
    if ((Date.now() - rec.cachedAt) > TTL_MS) { this._byHash.delete(sqlHash); return undefined; }
    return rec.analysis;
  }

  /** Has any analyzer registered for the given file? */
  hasAnalyzerFor(file: FileContext): boolean {
    return this._svc.plugins.queryAnalyzers.some(a => a.supports(file));
  }

  /** Pick the best analyzer for the given file. First match wins. */
  pickAnalyzer(file: FileContext): PluginQueryAnalyzer | undefined {
    return this._svc.plugins.queryAnalyzers.find(a => a.supports(file));
  }

  /**
   * Run analysis for `sql` using the first analyzer that supports the file.
   * Coalesces concurrent calls for the same hash.
   */
  async analyse(sql: string, file: FileContext, force = false): Promise<QueryAnalysis> {
    const sqlHash = await sha1Local(sql);
    if (!force) {
      const hit = this.get(sqlHash);
      if (hit) return hit;
    }
    const inflight = this._inflight.get(sqlHash);
    if (inflight) return inflight;

    const analyzer = this.pickAnalyzer(file);
    if (!analyzer) {
      const fallback: QueryAnalysis = {
        engine: 'other',
        sqlHash,
        sql,
        warnings: [],
        error: 'No connected query engine. Connect to Databricks or GCP for cost preview.',
        elapsedMs: 0,
        analysedAt: Date.now(),
      };
      return fallback;
    }

    const p = (async () => {
      try {
        const result = await analyzer.analyze(sql);
        this._byHash.set(sqlHash, { analysis: result, cachedAt: Date.now() });
        this._emitter.fire({ sqlHash, analysis: result });
        return result;
      } finally {
        this._inflight.delete(sqlHash);
      }
    })();
    this._inflight.set(sqlHash, p);
    return p;
  }

  invalidateAll(): void {
    this._byHash.clear();
  }

  dispose(): void {
    this._emitter.dispose();
    this._byHash.clear();
    this._inflight.clear();
  }
}

// Re-export sha1 lookup using node:crypto so this file stays vscode-import-free
// for tests; loaded lazily to avoid a hard dependency at module init.
async function sha1Local(text: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha1').update(text, 'utf8').digest('hex');
}
