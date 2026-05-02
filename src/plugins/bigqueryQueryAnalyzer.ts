/**
 * plugins/bigqueryQueryAnalyzer.ts — BigQuery dry-run analyzer (DE #2)
 *
 * Calls jobs.insert with dryRun: true. Returns totalBytesProcessed and the list
 * of referenced tables. BigQuery on-demand pricing is roughly $5 per TB scanned
 * (override via setting), so the cost estimate is bytes/(1024^4) * usdPerTb.
 *
 * Cost: zero — dry-run is free.
 */

import type {
  PluginQueryAnalyzer,
  QueryAnalysis,
  QueryWarning,
} from '../core/plugin';
import type { FileContext } from '../core/contextService';
import { sha1, heuristicWarnings } from './queryAnalysis';

export interface BqAnalyzerClient {
  dryRunQuery(sql: string, useLegacySql?: boolean): Promise<{
    status: { state: string; errorResult?: { reason: string; message: string } };
    statistics?: {
      totalBytesProcessed?: string;
      query?: {
        referencedTables?: Array<{ projectId: string; datasetId: string; tableId: string }>;
      };
    };
  }>;
}

const DEFAULT_USD_PER_TB = 5;

export class BigQueryQueryAnalyzer implements PluginQueryAnalyzer {
  readonly engine = 'bigquery' as const;
  readonly displayName = 'BigQuery (dry-run)';

  constructor(
    private readonly _clientGetter: () => BqAnalyzerClient | null,
    private readonly _usdPerTb: () => number = () => DEFAULT_USD_PER_TB,
  ) {}

  supports(file: FileContext): boolean {
    const lower = file.relPath.toLowerCase();
    return lower.endsWith('.sql') || lower.endsWith('.py') || lower.endsWith('.ipynb');
  }

  async analyze(sql: string): Promise<QueryAnalysis> {
    const t0 = Date.now();
    const baseWarnings = heuristicWarnings(sql);
    const baseAnalysis: QueryAnalysis = {
      engine: this.engine,
      sqlHash: sha1(sql),
      sql,
      warnings: baseWarnings,
      elapsedMs: 0,
      analysedAt: t0,
    };

    const client = this._clientGetter();
    if (!client) {
      return {
        ...baseAnalysis,
        error: 'GCP not connected. Run "GCP: Connect" to enable BigQuery dry-run.',
        elapsedMs: Date.now() - t0,
      };
    }

    let resp;
    try {
      resp = await client.dryRunQuery(sql);
    } catch (e) {
      const msg = String(e);
      return { ...baseAnalysis, error: `Dry-run failed: ${msg.slice(0, 200)}`, elapsedMs: Date.now() - t0 };
    }

    if (resp.status.errorResult) {
      return {
        ...baseAnalysis,
        error: `BigQuery: ${resp.status.errorResult.reason} — ${resp.status.errorResult.message}`,
        elapsedMs: Date.now() - t0,
      };
    }

    const bytesScanned = resp.statistics?.totalBytesProcessed
      ? Number(resp.statistics.totalBytesProcessed)
      : undefined;
    const usdPerTb = this._usdPerTb();
    const estimatedCostUsd = bytesScanned !== undefined
      ? (bytesScanned / (1024 ** 4)) * usdPerTb
      : undefined;

    const tables = (resp.statistics?.query?.referencedTables ?? []).map(t => ({
      fqn: `${t.projectId}.${t.datasetId}.${t.tableId}`,
    }));

    const warnings: QueryWarning[] = [...baseWarnings];
    if (bytesScanned !== undefined && bytesScanned > 50 * 1024 ** 3) {
      warnings.push({
        code: 'large-scan',
        severity: 'warning',
        message: `Query will scan ${(bytesScanned / 1024 ** 3).toFixed(1)} GB. Consider narrowing the date range or selecting fewer columns.`,
      });
    }

    return {
      ...baseAnalysis,
      bytesScanned,
      estimatedCostUsd,
      tablesRead: tables.length > 0 ? tables : undefined,
      warnings,
      elapsedMs: Date.now() - t0,
    };
  }
}
