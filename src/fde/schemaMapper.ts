/**
 * fde/schemaMapper.ts — Semantic Schema Mapper & Staging Model Generator
 *
 * Designed for Forward Deployed Engineers (FDEs) to rapidly map legacy/foreign
 * client data (CSV, JSON, SQL tables, Oracle dumps) into standard platform schemas.
 *
 * Capabilities:
 *  - Calculates string distance (Levenshtein) and semantic token similarity.
 *  - Discovers common prefix/suffix conventions (`CUST_ID` <-> `customer_id`, `TX_TS` <-> `transaction_timestamp`).
 *  - Recommends explicit SQL casts and format converters (e.g. `TO_TIMESTAMP`, `TRY_CAST`, `COALESCE`).
 *  - Emits production-ready dbt SQL models, PySpark transformation scripts, or SQL Views.
 */

import { MappedColumn, SchemaMappingSession } from './fdeContext';

export interface ColumnDefinition {
  name: string;
  type?: string;
  nullable?: boolean;
  description?: string;
}

export interface SchemaMappingResult {
  mappings: MappedColumn[];
  unmappedSource: string[];
  unmappedTarget: string[];
  dbtSql: string;
  pysparkCode: string;
  sqlView: string;
}

// ── Standard Synonyms & Token Normalization ───────────────────────────────────

const SYNONYM_MAP: Record<string, string> = {
  'cust': 'customer',
  'cust_id': 'customer_id',
  'cust_nbr': 'customer_id',
  'usr': 'user',
  'usr_id': 'user_id',
  'tx': 'transaction',
  'tx_id': 'transaction_id',
  'txn': 'transaction',
  'amt': 'amount',
  'ts': 'timestamp',
  'dt': 'date',
  'nbr': 'number',
  'no': 'number',
  'num': 'number',
  'cd': 'code',
  'desc': 'description',
  'dsc': 'description',
  'addr': 'address',
  'qty': 'quantity',
  'org': 'organization',
  'dept': 'department',
  'emp': 'employee',
  'auth': 'authorization',
  'curr': 'currency',
  'msg': 'message',
  'stat': 'status',
  'flg': 'flag',
  'ind': 'indicator',
};

export class SchemaMapperEngine {
  /**
   * Calculates similarity score (0.0 to 1.0) between source and target column names.
   */
  static scoreFieldMatch(source: string, target: string): number {
    const sNorm = this.normalizeName(source);
    const tNorm = this.normalizeName(target);

    if (sNorm === tNorm) return 1.0;

    // Check token overlap
    const sTokens = this.tokenize(source);
    const tTokens = this.tokenize(target);

    if (sTokens.length > 0 && tTokens.length > 0) {
      const matchCount = sTokens.filter(t => tTokens.includes(t)).length;
      const jaccard = matchCount / (sTokens.length + tTokens.length - matchCount);
      if (jaccard > 0.6) return Math.min(0.95, 0.5 + jaccard * 0.45);
    }

    // Levenshtein distance similarity
    const maxLen = Math.max(sNorm.length, tNorm.length);
    if (maxLen === 0) return 1.0;
    const dist = this.levenshtein(sNorm, tNorm);
    const levScore = 1 - (dist / maxLen);

    return Math.max(0, levScore);
  }

  static normalizeName(name: string): string {
    const lower = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const parts = lower.split('_').filter(Boolean);
    const normalizedParts = parts.map(p => SYNONYM_MAP[p] || p);
    return normalizedParts.join('_');
  }

  static tokenize(name: string): string[] {
    const lower = name.toLowerCase().replace(/[^a-z0-9]/g, ' ');
    return lower.split(/\s+/).filter(Boolean).map(p => SYNONYM_MAP[p] || p);
  }

  static levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Maps a list of source columns to target columns with suggested casts.
   */
  static mapSchemas(
    sourceColumns: ColumnDefinition[],
    targetColumns: ColumnDefinition[],
    sourceTableName = 'raw_source',
    targetModelName = 'stg_client_model'
  ): SchemaMappingResult {
    const mappings: MappedColumn[] = [];
    const usedTarget = new Set<string>();
    const usedSource = new Set<string>();

    // Step 1: Find best matches above threshold
    for (const src of sourceColumns) {
      let bestTarget: ColumnDefinition | null = null;
      let bestScore = 0;

      for (const tgt of targetColumns) {
        if (usedTarget.has(tgt.name)) continue;
        const score = this.scoreFieldMatch(src.name, tgt.name);
        if (score > bestScore && score >= 0.45) {
          bestScore = score;
          bestTarget = tgt;
        }
      }

      if (bestTarget) {
        usedTarget.add(bestTarget.name);
        usedSource.add(src.name);

        const transformation = this.inferTransformation(src, bestTarget);
        mappings.push({
          sourceColumn: src.name,
          targetColumn: bestTarget.name,
          sourceType: src.type || 'string',
          targetType: bestTarget.type || 'string',
          confidence: Math.round(bestScore * 100) / 100,
          transformation,
          notes: bestScore < 0.8 ? 'Fuzzy matched — verify semantic alignment' : undefined,
        });
      }
    }

    const unmappedSource = sourceColumns.filter(c => !usedSource.has(c.name)).map(c => c.name);
    const unmappedTarget = targetColumns.filter(c => !usedTarget.has(c.name)).map(c => c.name);

    const dbtSql = this.generateDbtModel(mappings, unmappedSource, sourceTableName, targetModelName);
    const pysparkCode = this.generatePySparkCode(mappings, sourceTableName, targetModelName);
    const sqlView = this.generateSqlView(mappings, sourceTableName, targetModelName);

    return {
      mappings,
      unmappedSource,
      unmappedTarget,
      dbtSql,
      pysparkCode,
      sqlView,
    };
  }

  private static inferTransformation(src: ColumnDefinition, tgt: ColumnDefinition): string {
    const sType = (src.type || 'string').toLowerCase();
    const tType = (tgt.type || 'string').toLowerCase();

    if (tType.includes('timestamp') || tType.includes('datetime')) {
      return `TRY_CAST(${src.name} AS TIMESTAMP)`;
    }
    if (tType.includes('date')) {
      return `TRY_CAST(${src.name} AS DATE)`;
    }
    if (tType.includes('int') || tType.includes('bigint')) {
      return `TRY_CAST(${src.name} AS BIGINT)`;
    }
    if (tType.includes('float') || tType.includes('double') || tType.includes('decimal') || tType.includes('numeric')) {
      return `TRY_CAST(REPLACE(REPLACE(${src.name}, '$', ''), ',', '') AS NUMERIC(18, 2))`;
    }
    if (tType.includes('bool')) {
      return `CASE WHEN LOWER(TRIM(${src.name})) IN ('true', '1', 'y', 'yes') THEN TRUE WHEN LOWER(TRIM(${src.name})) IN ('false', '0', 'n', 'no') THEN FALSE ELSE NULL END`;
    }
    return `TRIM(${src.name})`;
  }

  private static generateDbtModel(
    mappings: MappedColumn[],
    unmappedSource: string[],
    sourceName: string,
    modelName: string
  ): string {
    const lines: string[] = [
      `-- ===================================================================`,
      `-- dbt Staging Model: ${modelName}`,
      `-- Generated by Evolve AI (Forward Deployed Engineer Suite)`,
      `-- Source: {{ source('client_raw', '${sourceName}') }}`,
      `-- ===================================================================`,
      ``,
      `WITH source_data AS (`,
      `    SELECT * FROM {{ source('client_raw', '${sourceName}') }}`,
      `),`,
      ``,
      `renamed AS (`,
      `    SELECT`,
    ];

    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      const comma = i === mappings.length - 1 && unmappedSource.length === 0 ? '' : ',';
      const expr = m.transformation || m.sourceColumn;
      lines.push(`        ${expr.padEnd(50)} AS ${m.targetColumn}${comma}`);
    }

    if (unmappedSource.length > 0) {
      lines.push(`        -- Unmapped raw columns preserved for audit:`);
      for (let i = 0; i < unmappedSource.length; i++) {
        const u = unmappedSource[i];
        const comma = i === unmappedSource.length - 1 ? '' : ',';
        lines.push(`        ${u.padEnd(50)} AS raw_${u.toLowerCase()}${comma}`);
      }
    }

    lines.push(`    FROM source_data`);
    lines.push(`)`);
    lines.push(``);
    lines.push(`SELECT * FROM renamed;`);

    return lines.join('\n');
  }

  private static generatePySparkCode(
    mappings: MappedColumn[],
    sourceName: string,
    modelName: string
  ): string {
    const lines: string[] = [
      `# PySpark Transformation Pipeline: ${modelName}`,
      `# Generated by Evolve AI — Forward Deployed Engineer Suite`,
      `from pyspark.sql import functions as F`,
      `from pyspark.sql.types import *`,
      ``,
      `def transform_${modelName.replace(/[^a-zA-Z0-9_]/g, '_')}(raw_df):`,
      `    return raw_df.select(`,
    ];

    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      const comma = i === mappings.length - 1 ? '' : ',';
      lines.push(`        F.col("${m.sourceColumn}").alias("${m.targetColumn}")${comma}`);
    }

    lines.push(`    )`);
    return lines.join('\n');
  }

  private static generateSqlView(
    mappings: MappedColumn[],
    sourceName: string,
    modelName: string
  ): string {
    const lines: string[] = [
      `CREATE OR REPLACE VIEW v_${modelName} AS`,
      `SELECT`,
    ];

    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      const comma = i === mappings.length - 1 ? '' : ',';
      lines.push(`    ${m.transformation || m.sourceColumn} AS ${m.targetColumn}${comma}`);
    }

    lines.push(`FROM ${sourceName};`);
    return lines.join('\n');
  }
}
