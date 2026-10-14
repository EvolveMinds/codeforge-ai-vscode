/**
 * Tabular Anomaly & Column Semantic Governance Engine
 *
 * Provides sovereign, 100% offline tabular data annotation:
 * 1. Cell-level outlier disposition (confirmed anomaly vs. legitimate extreme vs. null mask).
 * 2. Column-level semantic classification (Business Role, PII sensitivity, glossary description).
 * 3. Automated generation of production dbt `schema.yml`, SQL sanitization queries, and governance audit reports.
 *
 * Designed for air-gapped enterprise environments.
 */

export type OutlierDispositionType = 'anomaly' | 'legitimate_extreme' | 'mask_null';
export type ColumnSensitivity = 'public' | 'internal' | 'confidential' | 'pii_restricted';
export type ColumnBusinessRole = 'pk' | 'fk' | 'metric' | 'dimension' | 'timestamp' | 'other';

export interface OutlierDisposition {
  cellId: string; // e.g. `${tableName}:${rowIndex}:${columnName}`
  tableName: string;
  rowIndex: number;
  columnName: string;
  value: any;
  disposition: OutlierDispositionType;
  notes?: string;
  tagged_at: string;
}

export interface ColumnSemanticTag {
  tableName: string;
  columnName: string;
  sensitivity: ColumnSensitivity;
  businessRole: ColumnBusinessRole;
  description?: string;
  dataTests?: string[]; // e.g. ['unique', 'not_null']
  tagged_at: string;
}

export interface TableAnnotationState {
  tableName: string;
  columns: Record<string, ColumnSemanticTag>;
  outliers: Record<string, OutlierDisposition>;
  lastModified: string;
}

export interface OutlierCandidate {
  rowIndex: number;
  columnName: string;
  value: any;
  reason: string;
  score?: number;
}

export class TabularAnnotationEngine {
  /**
   * Initializes or normalizes a table annotation state container.
   */
  public static createInitialState(tableName: string): TableAnnotationState {
    return {
      tableName,
      columns: {},
      outliers: {},
      lastModified: new Date().toISOString()
    };
  }

  /**
   * Scans a sample dataset to detect numeric and statistical outlier candidates using IQR.
   */
  public static detectOutliers(
    columns: Array<{ name: string; type?: string }>,
    rows: Array<Record<string, any>>
  ): OutlierCandidate[] {
    const candidates: OutlierCandidate[] = [];
    if (!rows || rows.length < 4) return candidates;

    // Identify numeric columns
    const numericCols = columns.filter(c => {
      const type = (c.type || '').toLowerCase();
      if (['int', 'integer', 'float', 'double', 'numeric', 'decimal', 'number', 'real', 'bigint'].some(t => type.includes(t))) {
        return true;
      }
      // Heuristic test across sample values
      const nonNullValues = rows.map(r => r[c.name]).filter(v => v !== null && v !== undefined && v !== '');
      if (nonNullValues.length >= 4 && nonNullValues.every(v => typeof v === 'number' || (!isNaN(Number(v)) && isFinite(Number(v))))) {
        return true;
      }
      return false;
    });

    for (const col of numericCols) {
      const valuesWithIndex: Array<{ val: number; rIdx: number }> = [];
      rows.forEach((r, idx) => {
        const raw = r[col.name];
        if (raw !== null && raw !== undefined && raw !== '') {
          const num = Number(raw);
          if (!isNaN(num) && isFinite(num)) {
            valuesWithIndex.push({ val: num, rIdx: idx });
          }
        }
      });

      if (valuesWithIndex.length < 4) continue;

      // Sort values to compute quartiles
      valuesWithIndex.sort((a, b) => a.val - b.val);
      const n = valuesWithIndex.length;
      const q1Index = Math.floor(n * 0.25);
      const q3Index = Math.floor(n * 0.75);
      const q1 = valuesWithIndex[q1Index].val;
      const q3 = valuesWithIndex[q3Index].val;
      const iqr = q3 - q1;

      // Only evaluate if variance exists
      if (iqr > 0) {
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        for (const item of valuesWithIndex) {
          if (item.val < lowerBound || item.val > upperBound) {
            const isHigh = item.val > upperBound;
            candidates.push({
              rowIndex: item.rIdx,
              columnName: col.name,
              value: item.val,
              reason: isHigh
                ? `Value ${item.val} exceeds upper IQR threshold (${upperBound.toFixed(2)})`
                : `Value ${item.val} below lower IQR threshold (${lowerBound.toFixed(2)})`,
              score: isHigh ? Number(((item.val - upperBound) / iqr).toFixed(2)) : Number(((lowerBound - item.val) / iqr).toFixed(2))
            });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Records or updates an outlier disposition on a specific cell.
   */
  public static recordOutlierDisposition(
    state: TableAnnotationState,
    disposition: OutlierDisposition
  ): TableAnnotationState {
    const updated: TableAnnotationState = {
      tableName: state.tableName,
      columns: { ...state.columns },
      outliers: { ...state.outliers },
      lastModified: new Date().toISOString()
    };

    const cellKey = disposition.cellId || `${disposition.tableName}:${disposition.rowIndex}:${disposition.columnName}`;
    updated.outliers[cellKey] = {
      ...disposition,
      cellId: cellKey,
      tagged_at: disposition.tagged_at || new Date().toISOString()
    };

    return updated;
  }

  /**
   * Records or updates a semantic tag on a table column.
   */
  public static recordColumnTag(
    state: TableAnnotationState,
    tag: ColumnSemanticTag
  ): TableAnnotationState {
    const updated: TableAnnotationState = {
      tableName: state.tableName,
      columns: { ...state.columns },
      outliers: { ...state.outliers },
      lastModified: new Date().toISOString()
    };

    updated.columns[tag.columnName] = {
      ...tag,
      tagged_at: tag.tagged_at || new Date().toISOString()
    };

    return updated;
  }

  /**
   * Generates a production-ready dbt `schema.yml` document.
   */
  public static exportDbtSchemaYaml(
    state: TableAnnotationState,
    modelDescription?: string
  ): string {
    const lines: string[] = [];
    lines.push('version: 2');
    lines.push('');
    lines.push('models:');
    lines.push(`  - name: ${state.tableName}`);
    const desc = modelDescription || `Introspected model for ${state.tableName} with human-verified semantic tags and governance policies.`;
    lines.push(`    description: "${desc.replace(/"/g, '\\"')}"`);
    lines.push('    columns:');

    const columnNames = Object.keys(state.columns);
    if (columnNames.length === 0) {
      lines.push('      # No columns annotated yet');
    } else {
      for (const colName of columnNames) {
        const col = state.columns[colName];
        lines.push(`      - name: ${col.columnName}`);
        if (col.description) {
          lines.push(`        description: "${col.description.replace(/"/g, '\\"')}"`);
        } else {
          lines.push(`        description: "${col.businessRole.toUpperCase()} attribute in ${state.tableName}"`);
        }

        // Meta tags for governance
        lines.push('        meta:');
        lines.push(`          business_role: ${col.businessRole}`);
        lines.push(`          security_level: ${col.sensitivity.toUpperCase()}`);

        // Tests
        const tests: string[] = col.dataTests && col.dataTests.length > 0 ? [...col.dataTests] : [];
        if (col.businessRole === 'pk') {
          if (!tests.includes('unique')) tests.push('unique');
          if (!tests.includes('not_null')) tests.push('not_null');
        }

        if (tests.length > 0) {
          lines.push('        tests:');
          for (const test of tests) {
            lines.push(`          - ${test}`);
          }
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generates a SQL cleaning & sanitization script handling marked anomalies and null masks.
   */
  public static exportSanitizationSql(
    state: TableAnnotationState,
    dialect: 'postgres' | 'snowflake' | 'bigquery' = 'postgres'
  ): string {
    const lines: string[] = [];
    lines.push(`-- ===================================================================`);
    lines.push(`-- SANITIZATION SCRIPT FOR TABLE: ${state.tableName}`);
    lines.push(`-- Generated: ${new Date().toISOString()} (Dialect: ${dialect.toUpperCase()})`);
    lines.push(`-- ===================================================================\n`);

    const outlierList = Object.values(state.outliers);
    const anomalies = outlierList.filter(o => o.disposition === 'anomaly');
    const masks = outlierList.filter(o => o.disposition === 'mask_null');

    if (anomalies.length === 0 && masks.length === 0) {
      lines.push(`-- No cell anomalies or masking dispositions flagged. Table data passes quality checks.`);
      lines.push(`SELECT * FROM ${state.tableName};`);
      return lines.join('\n');
    }

    lines.push(`-- 1. Quarantine flagged anomalies into dead-letter / inspection table`);
    lines.push(`CREATE TABLE IF NOT EXISTS ${state.tableName}_anomalies_quarantine AS`);
    lines.push(`SELECT`);
    lines.push(`    CURRENT_TIMESTAMP as flagged_at,`);
    lines.push(`    t.*`);
    lines.push(`FROM ${state.tableName} t`);
    lines.push(`WHERE 1 = 0; -- Schema initialized\n`);

    // Group anomalous and masked row values by column
    const anomaliesByCol: Record<string, any[]> = {};
    for (const a of [...anomalies, ...masks]) {
      if (!anomaliesByCol[a.columnName]) anomaliesByCol[a.columnName] = [];
      anomaliesByCol[a.columnName].push(a.value);
    }

    lines.push(`-- 2. Sanitized transformation view (cleaning bad rows and masking sensitive/null targets)`);
    lines.push(`CREATE OR REPLACE VIEW ${state.tableName}_sanitized AS`);
    lines.push(`SELECT`);

    // Collect all column names from explicit tags and registered cell outliers
    const colKeysSet = new Set<string>([
      ...Object.keys(state.columns),
      ...Object.values(state.outliers).map(o => o.columnName)
    ]);
    const colKeys = Array.from(colKeysSet);

    if (colKeys.length > 0) {
      const colSelects = colKeys.map(cName => {
        const col = state.columns[cName];
        if (col && col.sensitivity === 'pii_restricted') {
          return `    -- PII Masking applied for ${cName}\n    MD5(CAST(${cName} AS VARCHAR)) AS ${cName}_masked`;
        }
        if (anomaliesByCol[cName] && anomaliesByCol[cName].length > 0) {
          const badVals = anomaliesByCol[cName].map(v => typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`).join(', ');
          return `    CASE WHEN ${cName} IN (${badVals}) THEN NULL ELSE ${cName} END AS ${cName}`;
        }
        return `    ${cName}`;
      });
      lines.push(colSelects.join(',\n'));
    } else {
      lines.push(`    *`);
    }

    lines.push(`FROM ${state.tableName};`);
    return lines.join('\n');
  }

  /**
   * Generates a Data Governance & Anomaly Audit report in Markdown.
   */
  public static exportAuditMarkdown(state: TableAnnotationState): string {
    const lines: string[] = [];
    lines.push(`# Data Governance & Anomaly Audit Report: \`${state.tableName}\``);
    lines.push(`**Generated:** ${new Date().toISOString()}`);
    lines.push(`**Last State Modified:** ${state.lastModified}\n`);

    lines.push(`## 1. Column Semantic & Sensitivity Summary`);
    lines.push(`| Column Name | Business Role | Sensitivity | Tests Configured | Description |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);

    const colKeys = Object.keys(state.columns);
    if (colKeys.length === 0) {
      lines.push(`| *None* | *None* | *None* | *None* | *No columns annotated* |`);
    } else {
      for (const cName of colKeys) {
        const col = state.columns[cName];
        const tests = (col.dataTests || []).join(', ') || 'None';
        const desc = col.description || '—';
        lines.push(`| **${col.columnName}** | \`${col.businessRole}\` | \`${col.sensitivity}\` | ${tests} | ${desc} |`);
      }
    }

    lines.push(`\n## 2. Cell Outlier Dispositions`);
    const outlierList = Object.values(state.outliers);
    if (outlierList.length === 0) {
      lines.push(`No cell-level outliers have been dispositioned for this table.`);
    } else {
      lines.push(`| Cell ID | Row | Column | Value | Disposition | Evaluator Notes |`);
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
      for (const o of outlierList) {
        lines.push(`| \`${o.cellId}\` | ${o.rowIndex + 1} | \`${o.columnName}\` | \`${o.value}\` | **${o.disposition.toUpperCase()}** | ${o.notes || '—'} |`);
      }
    }

    lines.push(`\n## 3. Governance Risk Assessment`);
    const piiCols = Object.values(state.columns).filter(c => c.sensitivity === 'pii_restricted' || c.sensitivity === 'confidential');
    if (piiCols.length > 0) {
      lines.push(`> [!WARNING]`);
      lines.push(`> Table contains **${piiCols.length}** columns classified as Sensitive/PII: ${piiCols.map(c => `\`${c.columnName}\``).join(', ')}.`);
      lines.push(`> Ensure appropriate masking and RBAC permissions are enforced in target warehouse.`);
    } else {
      lines.push(`> [!NOTE]`);
      lines.push(`> No restricted PII columns detected in active annotations.`);
    }

    return lines.join('\n');
  }
}
