/**
 * plugins/databricksLineage.ts — Databricks / Spark lineage provider (DE #1)
 *
 * Extracts Spark table references from PySpark and Databricks notebook code
 * and resolves them against Unity Catalog for real column schemas.
 *
 * Supported patterns:
 *   spark.table("catalog.schema.table")
 *   spark.read.table("catalog.schema.table")
 *   spark.sql("SELECT ... FROM catalog.schema.table")
 *   DeltaTable.forName(spark, "catalog.schema.table")
 *
 * Widget-aware: resolves dbutils.widgets.get("x") when a default was declared
 * earlier in the same file (notebook / .py). Cross-file / cross-notebook widget
 * resolution is intentionally out of scope for v1.
 */

import * as vscode from 'vscode';
import type {
  PluginLineageHook,
  LineageRef,
  LineageSchema,
  LineageColumn,
} from '../core/plugin';
import type { FileContext } from '../core/contextService';

// Minimal client contract — whatever the connected plugin gives us.
export interface DatabricksLineageClient {
  getTable(fullName: string): Promise<{
    name:          string;
    catalog_name:  string;
    schema_name:   string;
    table_type:    string;
    comment?:      string;
    columns?:      Array<{
      name:      string;
      type_text: string;
      comment?:  string;
      nullable?: boolean;
    }>;
  }>;
}

// ── Ref extraction ───────────────────────────────────────────────────────────

const RE_SPARK_TABLE = /\bspark\s*\.\s*(?:read\s*\.\s*)?table\s*\(\s*(?:f?['"])([\w.${}]+)['"]\s*\)/g;
const RE_DELTA_FORNAME = /DeltaTable\s*\.\s*forName\s*\(\s*[\w.]+\s*,\s*(?:f?['"])([\w.${}]+)['"]\s*\)/g;
const RE_FROM_TABLE  = /\b(?:FROM|JOIN)\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*){1,2})\b/gi;
const RE_SPARK_SQL   = /spark\s*\.\s*sql\s*\(\s*(?:f?['"]([^'"\\]+)['"]|f?"""([\s\S]*?)"""|f?'''([\s\S]*?)''')\s*\)/g;

// Widget declaration: dbutils.widgets.text("name", "default_value")
const RE_WIDGET_DECL = /dbutils\s*\.\s*widgets\s*\.\s*(?:text|dropdown|combobox|get|multiselect)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;

export function extractSparkRefs(file: FileContext): LineageRef[] {
  if (!isSparkFile(file)) return [];

  // Build widget default lookup first
  const widgets = new Map<string, string>();
  let wm: RegExpExecArray | null;
  const widgetRe = new RegExp(RE_WIDGET_DECL.source, 'g');
  while ((wm = widgetRe.exec(file.content)) !== null) {
    widgets.set(wm[1], wm[2]);
  }

  const resolveFqn = (raw: string): string | null => {
    // Expand ${widget} or {widget} placeholders
    return raw.replace(/\$?\{([^}]+)\}/g, (_, name) => {
      const v = widgets.get(name.trim());
      return v ?? `__${name.trim()}__`; // mark unresolved for later filtering
    });
  };

  const refs: LineageRef[] = [];
  const lines = file.content.split('\n');

  // Table/DeltaTable refs — line-based so we keep origin info
  const pushMatch = (lineIdx: number, col: number, raw: string, kind: 'spark_table' | 'sql_table') => {
    const fqn = resolveFqn(raw);
    if (!fqn || fqn.includes('__')) return; // unresolved widget — skip
    refs.push({ fqn, kind, origin: { line: lineIdx + 1, col: col + 1 } });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isStrippableLine(line)) continue;

    let m: RegExpExecArray | null;
    const tableRe = new RegExp(RE_SPARK_TABLE.source, 'g');
    while ((m = tableRe.exec(line)) !== null) pushMatch(i, m.index, m[1], 'spark_table');

    const deltaRe = new RegExp(RE_DELTA_FORNAME.source, 'g');
    while ((m = deltaRe.exec(line)) !== null) pushMatch(i, m.index, m[1], 'spark_table');
  }

  // spark.sql(...) — parse the SQL string for FROM/JOIN refs
  const sqlRe = new RegExp(RE_SPARK_SQL.source, 'g');
  let sm: RegExpExecArray | null;
  while ((sm = sqlRe.exec(file.content)) !== null) {
    const sql = sm[1] ?? sm[2] ?? sm[3] ?? '';
    const startLine = file.content.slice(0, sm.index).split('\n').length;
    const fromRe = new RegExp(RE_FROM_TABLE.source, 'gi');
    let fm: RegExpExecArray | null;
    while ((fm = fromRe.exec(sql)) !== null) {
      const raw = fm[1];
      // Skip obvious CTEs and subqueries — very short single-word matches are suspicious
      if (!raw.includes('.')) continue;
      const fqn = resolveFqn(raw);
      if (!fqn || fqn.includes('__')) continue;
      refs.push({ fqn, kind: 'sql_table', origin: { line: startLine, col: 1 } });
    }
  }

  // Raw .sql files (non-notebook) — just FROM/JOIN
  if (file.relPath.endsWith('.sql') && !file.content.includes('{{ ref(') && !file.content.includes('{{ source(')) {
    const fromRe = new RegExp(RE_FROM_TABLE.source, 'gi');
    let fm: RegExpExecArray | null;
    while ((fm = fromRe.exec(file.content)) !== null) {
      const raw = fm[1];
      if (!raw.includes('.')) continue;
      const lineIdx = file.content.slice(0, fm.index).split('\n').length;
      refs.push({ fqn: raw, kind: 'sql_table', origin: { line: lineIdx, col: 1 } });
    }
  }

  return dedupe(refs);
}

function isSparkFile(file: FileContext): boolean {
  const rel = file.relPath.replace(/\\/g, '/');
  if (rel.endsWith('.py') || rel.endsWith('.ipynb')) {
    return /\b(spark|pyspark|SparkSession|dbutils|DeltaTable)\b/.test(file.content);
  }
  if (rel.endsWith('.sql')) {
    // Skip dbt-flavoured SQL (has ref()/source()) — dbt provider handles those
    return !file.content.includes('{{ ref(') && !file.content.includes('{{ source(');
  }
  return false;
}

function isStrippableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('#') || t.startsWith('--') || t.startsWith('//');
}

function dedupe(refs: LineageRef[]): LineageRef[] {
  const seen = new Set<string>();
  const out: LineageRef[] = [];
  for (const r of refs) {
    const key = `${r.kind}::${r.fqn.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── The hook ─────────────────────────────────────────────────────────────────

export class DatabricksLineageHook implements PluginLineageHook {
  readonly key = 'databricks.unityCatalog';

  constructor(private readonly _clientGetter: () => DatabricksLineageClient | null) {}

  async extract(file: FileContext): Promise<LineageRef[]> {
    return extractSparkRefs(file);
  }

  async resolve(refs: LineageRef[]): Promise<LineageSchema[]> {
    const client = this._clientGetter();
    if (!client) return [];

    // UC requires three-part names. Skip refs that aren't fully qualified.
    const ucRefs = refs.filter(r => r.fqn.split('.').length === 3);
    if (ucRefs.length === 0) return [];

    const out: LineageSchema[] = [];
    await Promise.all(ucRefs.map(async ref => {
      try {
        const tbl = await client.getTable(ref.fqn);
        const columns: LineageColumn[] = (tbl.columns ?? []).map(c => ({
          name: c.name,
          type: c.type_text,
          description: c.comment || undefined,
          // UC column tags aren't on the base table response — left empty for now.
          // DE #7 will extend this via /unity-catalog/tables/{id}/tags.
          tags: undefined,
        }));
        // Filter to referencedColumns when resolvable
        const referenced = ref.referencedColumns;
        const filteredCols = referenced && referenced.length > 0
          ? columns.filter(c => referenced.includes(c.name))
          : columns;
        out.push({
          fqn: ref.fqn,
          displayName: `${tbl.catalog_name}.${tbl.schema_name}.${tbl.name}`,
          source: 'unity_catalog',
          columns: filteredCols.length > 0 ? filteredCols : columns,
          meta: {
            note: tbl.comment ? `UC: ${tbl.comment.slice(0, 100)}` : undefined,
          },
        });
      } catch (e) {
        console.warn(`[Evolve AI] UC lookup failed for ${ref.fqn}:`, e);
      }
    }));
    return out;
  }
}
