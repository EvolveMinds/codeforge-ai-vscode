/**
 * plugins/databricksQueryAnalyzer.ts — EXPLAIN COST analyzer for Databricks (DE #2)
 *
 * Runs `EXPLAIN COST` on a Databricks SQL warehouse to estimate scan size and
 * row counts BEFORE the user runs the actual query. The output is parsed for
 * the cost estimator's "Statistics" line:
 *
 *   == Optimized Logical Plan ==
 *   ...
 *   Statistics(sizeInBytes=12.3 GB, rowCount=1.5E+9)
 *
 * Falls back to plain EXPLAIN when EXPLAIN COST isn't supported (older
 * runtimes). All execution goes through the existing executeSQL pipeline —
 * this never runs the actual user query, only the EXPLAIN.
 */

import type {
  PluginQueryAnalyzer,
  QueryAnalysis,
  QueryWarning,
} from '../core/plugin';
import type { FileContext } from '../core/contextService';
import { sha1, heuristicWarnings } from './queryAnalysis';

// Minimal contract — whatever the connected plugin gives us.
export interface DatabricksAnalyzerClient {
  executeSQL(warehouseId: string, sql: string): Promise<{
    statement_id: string;
    status: { state: string; error?: { message: string } };
    result?: { data_array?: string[][] };
  }>;
  listWarehouses(): Promise<Array<{ id: string; name: string; state: string }>>;
}

// Photon / DBSQL pricing per TB-scanned varies by SKU; use a conservative DBU
// proxy: Serverless ~ $5 per TB scanned. Override via setting if needed.
const DEFAULT_USD_PER_TB = 5;

export class DatabricksQueryAnalyzer implements PluginQueryAnalyzer {
  readonly engine = 'databricks' as const;
  readonly displayName = 'Databricks (EXPLAIN COST)';

  constructor(
    private readonly _clientGetter: () => DatabricksAnalyzerClient | null,
    private readonly _warehousePicker: () => Promise<string | undefined>,
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
        error: 'Databricks not connected. Run "Databricks: Connect" to enable cost preview.',
        elapsedMs: Date.now() - t0,
      };
    }

    let warehouseId: string | undefined;
    try {
      warehouseId = await this._warehousePicker();
    } catch (e) {
      return { ...baseAnalysis, error: `Warehouse picker failed: ${String(e)}`, elapsedMs: Date.now() - t0 };
    }
    if (!warehouseId) {
      return { ...baseAnalysis, error: 'No SQL warehouse selected.', elapsedMs: Date.now() - t0 };
    }

    // Strip a trailing semicolon — EXPLAIN doesn't accept one.
    const cleanSql = sql.trim().replace(/;\s*$/, '');
    let explainSql = `EXPLAIN COST ${cleanSql}`;
    let stmt;
    try {
      stmt = await client.executeSQL(warehouseId, explainSql);
    } catch (e) {
      // Older runtimes don't support EXPLAIN COST — fall back to plain EXPLAIN.
      const msg = String(e);
      if (/EXPLAIN COST|UnsupportedOperation/i.test(msg)) {
        explainSql = `EXPLAIN ${cleanSql}`;
        try {
          stmt = await client.executeSQL(warehouseId, explainSql);
        } catch (e2) {
          return { ...baseAnalysis, error: `EXPLAIN failed: ${String(e2).slice(0, 200)}`, elapsedMs: Date.now() - t0 };
        }
      } else {
        return { ...baseAnalysis, error: `EXPLAIN failed: ${msg.slice(0, 200)}`, elapsedMs: Date.now() - t0 };
      }
    }

    if (stmt.status.state !== 'SUCCEEDED') {
      return {
        ...baseAnalysis,
        error: stmt.status.error?.message ?? `EXPLAIN returned state ${stmt.status.state}`,
        elapsedMs: Date.now() - t0,
      };
    }

    // EXPLAIN result is a single column, multi-row array of plan lines
    const planLines = (stmt.result?.data_array ?? []).map(r => r[0] ?? '').filter(s => s.length > 0);
    const planText = planLines.join('\n');
    const parsed = parseExplainCost(planText);

    const usdPerTb = this._usdPerTb();
    const estimatedCostUsd = parsed.bytesScanned !== undefined
      ? (parsed.bytesScanned / (1024 ** 4)) * usdPerTb
      : undefined;

    const warnings: QueryWarning[] = [...baseWarnings];
    if (parsed.bytesScanned !== undefined && parsed.bytesScanned > 50 * 1024 ** 3) {
      warnings.push({
        code: 'large-scan',
        severity: 'warning',
        message: `Query estimates ${(parsed.bytesScanned / 1024 ** 3).toFixed(1)} GB scanned. Consider filtering by partition.`,
      });
    }

    return {
      ...baseAnalysis,
      bytesScanned:     parsed.bytesScanned,
      rowsProcessed:    parsed.rowCount,
      estimatedCostUsd,
      tablesRead:       parsed.tables,
      plan:             planText.slice(0, 8_000),  // panel cap
      warnings,
      elapsedMs:        Date.now() - t0,
    };
  }
}

// ── EXPLAIN COST parser ──────────────────────────────────────────────────────
// Looks for `Statistics(sizeInBytes=..., rowCount=...)` lines and the file/
// table source list at the top. Defensive — Databricks plan format varies.

interface ParsedExplain {
  bytesScanned?: number;
  rowCount?: number;
  tables?: Array<{ fqn: string; bytes?: number }>;
}

const RE_STATS = /Statistics\(\s*sizeInBytes\s*=\s*([\d.]+)\s*([KMGTPE]?)B?\s*(?:,\s*rowCount\s*=\s*([\d.eE+]+))?\s*\)/g;
const RE_RELATION = /(?:Relation\s+|FileScan\s+\w+\s+)([\w]+(?:\.[\w]+){0,2})/gi;

const SUFFIX_MULT: Record<string, number> = {
  '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5, E: 1024 ** 6,
};

export function parseExplainCost(plan: string): ParsedExplain {
  const out: ParsedExplain = {};

  // Statistics lines — take the LARGEST one, which usually corresponds to the
  // root scan rather than an intermediate aggregate.
  let m: RegExpExecArray | null;
  let maxBytes = -1;
  let maxRows: number | undefined;
  const statsRe = new RegExp(RE_STATS.source, 'g');
  while ((m = statsRe.exec(plan)) !== null) {
    const value = parseFloat(m[1]);
    const suffix = (m[2] ?? '').toUpperCase();
    const bytes = value * (SUFFIX_MULT[suffix] ?? 1);
    if (bytes > maxBytes) {
      maxBytes = bytes;
      if (m[3]) maxRows = parseFloat(m[3]);
    }
  }
  if (maxBytes >= 0) out.bytesScanned = maxBytes;
  if (maxRows !== undefined && Number.isFinite(maxRows)) out.rowCount = maxRows;

  // Tables — dedup, cap to 10
  const seen = new Set<string>();
  const tables: Array<{ fqn: string }> = [];
  const relRe = new RegExp(RE_RELATION.source, 'gi');
  while ((m = relRe.exec(plan)) !== null) {
    const fqn = m[1];
    if (seen.has(fqn.toLowerCase())) continue;
    seen.add(fqn.toLowerCase());
    tables.push({ fqn });
    if (tables.length >= 10) break;
  }
  if (tables.length > 0) out.tables = tables;

  return out;
}
