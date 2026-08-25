/**
 * offline/dataProfiler.ts — Offline dataset profiler and data quality auditor
 *
 * 100% deterministic, offline statistical computation. Zero external network calls.
 */

export interface ColumnProfile {
  name: string;
  inferredType: 'integer' | 'float' | 'boolean' | 'datetime' | 'date' | 'json' | 'string';
  totalCount: number;
  nullCount: number;
  nullPercentage: number;
  distinctCount: number;
  uniquenessRatio: number;
  isPrimaryKeyCandidate: boolean;
  sampleValues: (string | number | boolean | null)[];
  // Numeric metrics
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  zeroCount?: number;
  negativeCount?: number;
  // Datetime metrics
  minDate?: string;
  maxDate?: string;
  durationDays?: number;
  // Categorical metrics
  topValues?: { value: string; count: number; percentage: number }[];
  // Quality alerts
  anomalies: string[];
}

export interface DatasetProfile {
  fileName: string;
  fileSizeBytes: number;
  totalRows: number;
  totalColumns: number;
  columns: ColumnProfile[];
  anomaliesSummary: { column: string; issue: string; severity: 'warning' | 'error' | 'info' }[];
  generatedAt: string;
}

export class DataProfiler {
  /**
   * Profiles tabular text (CSV, TSV, or JSON string)
   */
  static profileText(content: string, fileName: string = 'dataset.csv', fileSizeBytes: number = 0): DatasetProfile {
    const profiler = new DataProfiler();
    return profiler.profile(content, fileName, fileSizeBytes);
  }

  profile(content: string, fileName: string, fileSizeBytes: number): DatasetProfile {
    const trimmed = content.trim();
    if (!trimmed) {
      return {
        fileName,
        fileSizeBytes,
        totalRows: 0,
        totalColumns: 0,
        columns: [],
        anomaliesSummary: [{ column: 'ALL', issue: 'File is empty', severity: 'error' }],
        generatedAt: new Date().toISOString(),
      };
    }

    let rows: Record<string, string>[] = [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      rows = this._parseJson(trimmed);
    } else {
      rows = this._parseCsv(trimmed);
    }

    if (rows.length === 0) {
      return {
        fileName,
        fileSizeBytes: fileSizeBytes || content.length,
        totalRows: 0,
        totalColumns: 0,
        columns: [],
        anomaliesSummary: [{ column: 'ALL', issue: 'No valid rows parsed', severity: 'warning' }],
        generatedAt: new Date().toISOString(),
      };
    }

    const columnNames = Object.keys(rows[0] || {});
    const columns: ColumnProfile[] = [];
    const anomaliesSummary: { column: string; issue: string; severity: 'warning' | 'error' | 'info' }[] = [];

    for (const colName of columnNames) {
      const rawValues = rows.map(r => r[colName]);
      const profile = this._profileColumn(colName, rawValues, rows.length);
      columns.push(profile);

      for (const anomaly of profile.anomalies) {
        anomaliesSummary.push({
          column: colName,
          issue: anomaly,
          severity: anomaly.includes('Missing > 20%') || anomaly.includes('Single constant') ? 'warning' : 'info',
        });
      }
    }

    return {
      fileName,
      fileSizeBytes: fileSizeBytes || Buffer.byteLength(content, 'utf8'),
      totalRows: rows.length,
      totalColumns: columnNames.length,
      columns,
      anomaliesSummary,
      generatedAt: new Date().toISOString(),
    };
  }

  private _profileColumn(name: string, rawValues: (string | undefined | null)[], totalRows: number): ColumnProfile {
    let nullCount = 0;
    const nonNullValues: string[] = [];

    for (const val of rawValues) {
      if (val === undefined || val === null || val === '' || val.trim().toUpperCase() === 'NULL' || val.trim().toUpperCase() === 'NA' || val.trim().toUpperCase() === 'NAN') {
        nullCount++;
      } else {
        nonNullValues.push(val.trim());
      }
    }

    const nullPercentage = totalRows > 0 ? Number(((nullCount / totalRows) * 100).toFixed(2)) : 0;
    const distinctSet = new Set(nonNullValues);
    const distinctCount = distinctSet.size;
    const uniquenessRatio = totalRows > 0 ? Number((distinctCount / totalRows).toFixed(4)) : 0;
    const isPrimaryKeyCandidate = nullCount === 0 && distinctCount === totalRows && totalRows > 1;

    const inferredType = this._inferType(nonNullValues);
    const anomalies: string[] = [];

    if (distinctCount === 1 && totalRows > 1) {
      anomalies.push(`Single constant value across all rows: "${nonNullValues[0]}"`);
    }
    if (nullPercentage >= 20) {
      anomalies.push(`High missing rate: ${nullPercentage}% nulls (${nullCount}/${totalRows} rows)`);
    }
    if (isPrimaryKeyCandidate) {
      anomalies.push('100% Unique & Not Null: Primary Key candidate');
    }

    const sampleValues = nonNullValues.slice(0, 5);

    const profile: ColumnProfile = {
      name,
      inferredType,
      totalCount: totalRows,
      nullCount,
      nullPercentage,
      distinctCount,
      uniquenessRatio,
      isPrimaryKeyCandidate,
      sampleValues,
      anomalies,
    };

    if (inferredType === 'integer' || inferredType === 'float') {
      const numbers = nonNullValues.map(v => parseFloat(v.replace(/,/g, ''))).filter(n => !isNaN(n));
      if (numbers.length > 0) {
        numbers.sort((a, b) => a - b);
        const min = numbers[0];
        const max = numbers[numbers.length - 1];
        const sum = numbers.reduce((acc, v) => acc + v, 0);
        const mean = Number((sum / numbers.length).toFixed(4));
        const median = numbers[Math.floor(numbers.length / 2)];

        const variance = numbers.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / numbers.length;
        const stdDev = Number(Math.sqrt(variance).toFixed(4));
        const zeroCount = numbers.filter(n => n === 0).length;
        const negativeCount = numbers.filter(n => n < 0).length;

        profile.min = min;
        profile.max = max;
        profile.mean = mean;
        profile.median = median;
        profile.stdDev = stdDev;
        profile.zeroCount = zeroCount;
        profile.negativeCount = negativeCount;

        // Check for potential price/quantity negative anomaly
        if (negativeCount > 0 && /price|qty|quantity|amount|age|count|size/i.test(name)) {
          anomalies.push(`Detected ${negativeCount} negative values in typically positive column "${name}"`);
        }
      }
    } else if (inferredType === 'datetime' || inferredType === 'date') {
      const timestamps = nonNullValues.map(v => Date.parse(v)).filter(t => !isNaN(t));
      if (timestamps.length > 0) {
        timestamps.sort((a, b) => a - b);
        const minDate = new Date(timestamps[0]).toISOString();
        const maxDate = new Date(timestamps[timestamps.length - 1]).toISOString();
        const durationDays = Number(((timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24)).toFixed(2));

        profile.minDate = minDate;
        profile.maxDate = maxDate;
        profile.durationDays = durationDays;
      }
    } else {
      // String / Categorical top frequencies
      const counts: Record<string, number> = {};
      for (const val of nonNullValues) {
        counts[val] = (counts[val] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      profile.topValues = sorted.slice(0, 10).map(([val, cnt]) => ({
        value: val,
        count: cnt,
        percentage: Number(((cnt / totalRows) * 100).toFixed(2)),
      }));
    }

    return profile;
  }

  private _inferType(values: string[]): 'integer' | 'float' | 'boolean' | 'datetime' | 'date' | 'json' | 'string' {
    if (values.length === 0) return 'string';

    let intHits = 0;
    let floatHits = 0;
    let boolHits = 0;
    let dateHits = 0;
    let jsonHits = 0;

    const checkLimit = Math.min(values.length, 100);

    for (let i = 0; i < checkLimit; i++) {
      const v = values[i];
      if (/^(true|false|t|f|yes|no|1|0)$/i.test(v)) boolHits++;
      if (/^-?\d+$/.test(v.replace(/,/g, ''))) intHits++;
      else if (/^-?\d*(\.\d+)?([eE][+-]?\d+)?$/.test(v.replace(/,/g, '')) && !isNaN(parseFloat(v))) floatHits++;
      if (/^\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v))) dateHits++;
      if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
        try { JSON.parse(v); jsonHits++; } catch { /* ignore */ }
      }
    }

    const threshold = checkLimit * 0.8;
    if (intHits >= threshold) return 'integer';
    if (intHits + floatHits >= threshold) return 'float';
    if (dateHits >= threshold) return 'datetime';
    if (boolHits >= threshold) return 'boolean';
    if (jsonHits >= threshold) return 'json';
    return 'string';
  }

  private _parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 1) return [];

    // Detect delimiter from first line (comma, tab, semicolon, pipe)
    const headerLine = lines[0];
    const commaCount = (headerLine.match(/,/g) || []).length;
    const tabCount = (headerLine.match(/\t/g) || []).length;
    const semiCount = (headerLine.match(/;/g) || []).length;
    const pipeCount = (headerLine.match(/\|/g) || []).length;

    let delimiter = ',';
    if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
    else if (semiCount > commaCount) delimiter = ';';
    else if (pipeCount > commaCount) delimiter = '|';

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let inQuotes = false;
      let field = '';

      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === delimiter && !inQuotes) {
          result.push(field);
          field = '';
        } else {
          field += c;
        }
      }
      result.push(field);
      return result;
    };

    const headers = parseLine(lines[0]).map(h => h.trim().replace(/^["']|["']$/g, ''));
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = parseLine(lines[i]);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = (parts[j] !== undefined ? parts[j] : '').trim();
      }
      rows.push(row);
    }

    return rows;
  }

  private _parseJson(text: string): Record<string, string>[] {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(item => {
          const row: Record<string, string> = {};
          if (typeof item === 'object' && item !== null) {
            for (const [k, v] of Object.entries(item)) {
              row[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
            }
          }
          return row;
        });
      } else if (typeof parsed === 'object' && parsed !== null) {
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          row[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
        }
        return [row];
      }
    } catch {
      // Attempt JSONL line-by-line parsing
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
      const rows: Record<string, string>[] = [];
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (typeof item === 'object' && item !== null) {
            const row: Record<string, string> = {};
            for (const [k, v] of Object.entries(item)) {
              row[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
            }
            rows.push(row);
          }
        } catch { /* skip corrupted lines */ }
      }
      return rows;
    }
    return [];
  }

  /**
   * Generates dbt schema YAML tests based on discovered statistical properties
   */
  static exportDbtTestsYaml(profile: DatasetProfile, modelName?: string): string {
    const targetModel = modelName || profile.fileName.replace(/\.[^/.]+$/, '');
    const lines: string[] = [
      'version: 2',
      '',
      'models:',
      `  - name: ${targetModel}`,
      `    description: "Auto-generated documentation and tests for ${targetModel}"`,
      '    columns:',
    ];

    for (const col of profile.columns) {
      lines.push(`      - name: ${col.name}`);
      lines.push(`        description: "${col.inferredType} column with ${col.distinctCount} distinct values"`);

      const tests: string[] = [];
      if (col.nullCount === 0 && col.totalCount > 0) {
        tests.push('unique');
        tests.push('not_null');
      } else if (col.nullPercentage < 1.0) {
        tests.push('not_null');
      }

      if (col.topValues && col.distinctCount <= 5 && col.distinctCount > 1) {
        const valuesList = col.topValues.map(v => `'${v.value.replace(/'/g, "''")}'`).join(', ');
        lines.push('        tests:');
        for (const t of tests) lines.push(`          - ${t}`);
        lines.push('          - accepted_values:');
        lines.push(`              values: [${valuesList}]`);
        continue;
      }

      if (tests.length > 0) {
        lines.push('        tests:');
        for (const t of tests) {
          lines.push(`          - ${t}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Generates Great Expectations assertion JSON suite
   */
  static exportGreatExpectationsSuite(profile: DatasetProfile, suiteName?: string): string {
    const name = suiteName || `${profile.fileName.replace(/\.[^/.]+$/, '')}_suite`;
    const expectations: object[] = [];

    for (const col of profile.columns) {
      if (col.nullCount === 0 && col.totalCount > 0) {
        expectations.push({
          expectation_type: 'expect_column_values_to_not_be_null',
          kwargs: { column: col.name },
        });
      }
      if (col.isPrimaryKeyCandidate) {
        expectations.push({
          expectation_type: 'expect_column_values_to_be_unique',
          kwargs: { column: col.name },
        });
      }
      if ((col.inferredType === 'integer' || col.inferredType === 'float') && col.min !== undefined && col.max !== undefined) {
        expectations.push({
          expectation_type: 'expect_column_min_to_be_between',
          kwargs: { column: col.name, min_value: col.min, max_value: col.min },
        });
        expectations.push({
          expectation_type: 'expect_column_max_to_be_between',
          kwargs: { column: col.name, min_value: col.max, max_value: col.max },
        });
      }
      if (col.topValues && col.distinctCount <= 8 && col.distinctCount > 1) {
        expectations.push({
          expectation_type: 'expect_column_values_to_be_in_set',
          kwargs: { column: col.name, value_set: col.topValues.map(v => v.value) },
        });
      }
    }

    return JSON.stringify({
      data_asset_type: 'Dataset',
      expectation_suite_name: name,
      expectations,
      meta: {
        generated_by: 'Evolve AI Offline Data Profiler',
        created_at: profile.generatedAt,
      },
    }, null, 2);
  }

  /**
   * Generates Markdown profile report
   */
  static exportMarkdown(profile: DatasetProfile): string {
    const lines: string[] = [
      `# 📊 Data Profile: ${profile.fileName}`,
      '',
      `**Rows**: ${profile.totalRows.toLocaleString()} | **Columns**: ${profile.totalColumns} | **Size**: ${(profile.fileSizeBytes / 1024).toFixed(2)} KB`,
      '',
      '## Column Summary',
      '',
      '| Column | Type | Nulls (%) | Unique Count | Min / Earliest | Max / Latest | Sample Values |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    ];

    for (const col of profile.columns) {
      const minVal = col.min !== undefined ? String(col.min) : (col.minDate ? col.minDate.slice(0, 10) : '—');
      const maxVal = col.max !== undefined ? String(col.max) : (col.maxDate ? col.maxDate.slice(0, 10) : '—');
      const sample = col.sampleValues.slice(0, 3).map(v => `\`${String(v)}\``).join(', ');
      lines.push(`| **${col.name}** | \`${col.inferredType}\` | ${col.nullCount} (${col.nullPercentage}%) | ${col.distinctCount.toLocaleString()} | ${minVal} | ${maxVal} | ${sample} |`);
    }

    if (profile.anomaliesSummary.length > 0) {
      lines.push('');
      lines.push('## ⚠️ Data Quality & Anomaly Alerts');
      lines.push('');
      for (const a of profile.anomaliesSummary) {
        const icon = a.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`- ${icon} **${a.column}**: ${a.issue}`);
      }
    }

    return lines.join('\n');
  }
}
