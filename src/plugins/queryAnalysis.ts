/**
 * plugins/queryAnalysis.ts — Shared helpers for query cost/perf analysis (DE #2)
 *
 *   - extractSqlStatements(): walk a doc and find each top-level SELECT / WITH /
 *     INSERT / MERGE / CREATE TABLE AS, plus any spark.sql("...") block in
 *     Python files. Returns ranges so the CodeLens can attach to them.
 *   - sha1():               deterministic cache key for a SQL string
 *   - heuristicWarnings():  engine-agnostic checks (SELECT *, missing partition
 *                           filter, cross join, large date range)
 *   - formatBytes / formatUsd: small display helpers shared by UI + prompt
 */

import { createHash } from 'crypto';
import type { QueryWarning } from '../core/plugin';

// ── SQL statement extraction ─────────────────────────────────────────────────

export interface SqlStatement {
  /** SQL text */
  sql: string;
  /** 1-based line where the statement begins */
  startLine: number;
  /** 1-based line where the statement ends */
  endLine: number;
  /** Where this came from — used to format the CodeLens label */
  origin: 'sql_file' | 'spark_sql' | 'notebook_sql_cell';
}

const SQL_LEAD = /^\s*(?:WITH\b|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|MERGE\b|CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\b|CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b|REPLACE\s+TABLE\b)/i;

/**
 * Lightweight SQL splitter. Splits on `;` at the top level (ignoring `;` inside
 * single/double-quoted strings or comments) and keeps only chunks whose first
 * non-comment word looks like a query.
 */
export function splitSqlFile(content: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  const lines = content.split('\n');
  let cur: string[] = [];
  let curStart = 1;
  let inSingle = false, inDouble = false, inLineComment = false, inBlockComment = false;

  const flush = (endLine: number) => {
    const sql = cur.join('\n').trim();
    cur = [];
    if (!sql) { curStart = endLine + 1; return; }
    // Strip leading line / block comments so a statement preceded by `--` or
    // `/* ... */` is still detected as SQL.
    let probe = sql;
    let prev: string;
    do {
      prev = probe;
      probe = probe.replace(/^\s*--[^\n]*\n?/, '');
      probe = probe.replace(/^\s*\/\*[\s\S]*?\*\//, '');
    } while (probe !== prev);
    if (!SQL_LEAD.test(probe.trimStart())) { curStart = endLine + 1; return; }
    out.push({ sql, startLine: curStart, endLine, origin: 'sql_file' });
    curStart = endLine + 1;
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let buf = '';
    inLineComment = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (inLineComment) { buf += ch; continue; }
      if (inBlockComment) {
        buf += ch;
        if (ch === '*' && next === '/') { buf += next; i++; inBlockComment = false; }
        continue;
      }
      if (inSingle) { buf += ch; if (ch === "'" && line[i - 1] !== '\\') inSingle = false; continue; }
      if (inDouble) { buf += ch; if (ch === '"' && line[i - 1] !== '\\') inDouble = false; continue; }
      if (ch === '-' && next === '-') { inLineComment = true; buf += ch; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; buf += ch; continue; }
      if (ch === "'") { inSingle = true; buf += ch; continue; }
      if (ch === '"') { inDouble = true; buf += ch; continue; }
      if (ch === ';') {
        cur.push(buf);
        buf = '';
        flush(lineIdx + 1);
        continue;
      }
      buf += ch;
    }
    cur.push(buf);
  }
  flush(lines.length);
  return out;
}

const RE_SPARK_SQL = /spark\s*\.\s*sql\s*\(\s*(?:f?["']([^"'\\]+)["']|f?"""([\s\S]*?)"""|f?'''([\s\S]*?)''')\s*\)/g;

/** Extract SQL embedded in `spark.sql(...)` calls inside a Python file. */
export function extractSparkSql(content: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(RE_SPARK_SQL.source, 'g');
  while ((m = re.exec(content)) !== null) {
    const sql = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!sql) continue;
    const lineNo = content.slice(0, m.index).split('\n').length;
    const endLine = lineNo + sql.split('\n').length - 1;
    out.push({ sql, startLine: lineNo, endLine, origin: 'spark_sql' });
  }
  return out;
}

/** Pick statements from a file regardless of language. */
export function extractStatementsFromFile(content: string, language: string, relPath: string): SqlStatement[] {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.sql') || language === 'sql' || language === 'jinja-sql') {
    // dbt-flavoured SQL contains Jinja that EXPLAIN won't accept. Skip
    // statements that still carry `{{ ref(...) }}` or `{{ source(...) }}`
    // — the analyzer would just error.
    return splitSqlFile(content).filter(s => !s.sql.includes('{{ ref(') && !s.sql.includes('{{ source('));
  }
  if (lower.endsWith('.py') || lower.endsWith('.ipynb') || language === 'python') {
    return extractSparkSql(content);
  }
  return [];
}

// ── Hashing ──────────────────────────────────────────────────────────────────

export function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

// ── Engine-agnostic warning heuristics ───────────────────────────────────────

export function heuristicWarnings(sql: string): QueryWarning[] {
  const warnings: QueryWarning[] = [];
  const lower = sql.toLowerCase();

  if (/\bselect\s+\*/.test(lower)) {
    warnings.push({
      code: 'select-star',
      severity: 'warning',
      message: 'SELECT * scans every column. Project only the columns you need.',
    });
  }

  // CROSS JOIN or implicit cartesian (FROM a, b without WHERE join)
  if (/\bcross\s+join\b/.test(lower)) {
    warnings.push({
      code: 'cross-join',
      severity: 'warning',
      message: 'CROSS JOIN can be expensive — confirm the cardinality is intentional.',
    });
  }

  // Common partition columns. If the query touches a date-y column but has no
  // WHERE filter on it, suggest one.
  const partitionish = /(event_date|event_dt|date|dt|partition_date|year|month|day)/i;
  const hasFromTable = /\bfrom\s+[\w.`"]+/i.test(lower);
  if (hasFromTable && partitionish.test(sql) && !/\bwhere\b/i.test(lower)) {
    warnings.push({
      code: 'missing-partition-filter',
      severity: 'warning',
      message: 'No WHERE filter detected. Add a partition filter (e.g. on a date column) to avoid full-table scans.',
    });
  }

  // Date-range >180 days: rough — match BETWEEN dates or DATE_SUB(... 365)
  const wideRange = /\bdate_sub\s*\(\s*[^,]+,\s*(\d{3,})\s*\)/i;
  const m = wideRange.exec(sql);
  if (m && Number(m[1]) > 180) {
    warnings.push({
      code: 'wide-date-range',
      severity: 'info',
      message: `Date range spans ${m[1]} days — consider narrowing for cheaper runs.`,
    });
  }

  return warnings;
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`;
}

export function formatUsd(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '?';
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function summariseAnalysisOneLine(a: { bytesScanned?: number; estimatedCostUsd?: number; warnings: QueryWarning[]; error?: string }): string {
  if (a.error) return `error: ${a.error.slice(0, 120)}`;
  const parts: string[] = [];
  if (a.bytesScanned !== undefined) parts.push(formatBytes(a.bytesScanned));
  if (a.estimatedCostUsd !== undefined) parts.push(`~${formatUsd(a.estimatedCostUsd)}`);
  if (a.warnings.length > 0) parts.push(`${a.warnings.length} warning${a.warnings.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'no data';
}
