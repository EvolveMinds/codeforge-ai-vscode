/**
 * plugins/pythonStudio/dataFrameSniffer.ts
 *
 * Silent Bug Sniffer & Performance Profiler for Pandas & Polars Data Pipelines.
 * Detects:
 *  - Iterative row loops (iterrows/itertuples) that degrade performance by 100x
 *  - Cartesian join / merge explosions that cause container Out-Of-Memory (OOM)
 *  - SettingWithCopy chained indexing mutations
 *  - High-memory CSV vs Parquet anti-patterns
 *  - 1-Click Polars lazy evaluation recommendations
 */

export interface DataFrameAnomaly {
  line: number;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestedFix?: string;
  framework: 'pandas' | 'polars' | 'general';
}

export interface DataFrameSnifferReport {
  anomalies: DataFrameAnomaly[];
  pandasDetected: boolean;
  polarsDetected: boolean;
  optimizationTips: string[];
}

export class DataFrameSniffer {
  /**
   * Scans Python code for data engineering & analytics anti-patterns.
   */
  static sniffDataCode(source: string): DataFrameSnifferReport {
    const anomalies: DataFrameAnomaly[] = [];
    const lines = source.split(/\r?\n/);

    const pandasDetected = /import\s+pandas|from\s+pandas\b/i.test(source);
    const polarsDetected = /import\s+polars|from\s+polars\b/i.test(source);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 1. iterrows() / itertuples() slow iteration loop
      if (/\.iterrows\(\)/.test(line)) {
        anomalies.push({
          line: i + 1,
          severity: 'warning',
          code: 'SLOW_ITERROWS_LOOP',
          framework: 'pandas',
          message: 'Severe bottleneck: df.iterrows() creates a new Series per row. It is 100x slower than vectorized operations.',
          suggestedFix: 'Replace loop with vectorized expressions, np.select, or pl.DataFrame expressions.',
        });
      }

      // 2. Chained indexing assignment: df['a']['b'] = ... or df[mask]['b'] = ...
      if (/([a-zA-Z0-9_]+)\[[^\]]+\]\[[^\]]+\]\s*=/.test(line)) {
        anomalies.push({
          line: i + 1,
          severity: 'error',
          code: 'SETTING_WITH_COPY_WARNING',
          framework: 'pandas',
          message: "Chained assignment hazard: modifying a slice copy rather than original DataFrame (SettingWithCopyWarning).",
          suggestedFix: 'Use df.loc[row_indexer, col_indexer] = value instead.',
        });
      }

      // 3. Cartesian Join Risk: pd.merge without 'on' or explicit join keys
      if (/pd\.merge\(\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*\)/.test(line)) {
        anomalies.push({
          line: i + 1,
          severity: 'warning',
          code: 'CARTESIAN_MERGE_RISK',
          framework: 'pandas',
          message: "Merge without explicit 'on=' key. If columns don't match, this can produce an accidental Cartesian product explosion.",
          suggestedFix: "Always specify merge keys explicitly: pd.merge(df1, df2, on=['id'], how='inner').",
        });
      }

      // 4. Large CSV reading vs Parquet
      if (/pd\.read_csv\(/.test(line) && !line.includes('chunksize') && !line.includes('nrows')) {
        if (/large|dump|export|data\.csv|transactions/i.test(line)) {
          anomalies.push({
            line: i + 1,
            severity: 'info',
            code: 'LARGE_CSV_MEMORY_RISK',
            framework: 'pandas',
            message: 'Reading large CSV unchunked into memory. Consider Parquet or chunksize=50000 to prevent OOM in cloud containers.',
            suggestedFix: 'Use pl.scan_csv() (lazy) or switch data format to Parquet.',
          });
        }
      }

      // 5. Polars uncollected lazy frame discarded
      if (/pl\.scan_parquet|pl\.scan_csv/.test(line) && !source.includes('.collect()')) {
        anomalies.push({
          line: i + 1,
          severity: 'info',
          code: 'POLARS_LAZY_UNCOLLECTED',
          framework: 'polars',
          message: 'Polars LazyFrame initialized without .collect() execution.',
          suggestedFix: 'Call .collect() when you are ready to evaluate the execution plan.',
        });
      }

      // 6. Inefficient inplace=True (deprecated in modern Pandas)
      if (/\binplace\s*=\s*True\b/.test(line)) {
        anomalies.push({
          line: i + 1,
          severity: 'info',
          code: 'INPLACE_TRUE_DEPRECATED',
          framework: 'pandas',
          message: "'inplace=True' provides no memory savings in Pandas and is being deprecated in Pandas 3.0.",
          suggestedFix: 'Assign result directly: df = df.drop(...) instead of inplace=True.',
        });
      }
    }

    const optimizationTips: string[] = [];
    if (pandasDetected && !polarsDetected) {
      optimizationTips.push('Consider migrating heavy ETL pipelines to Polars for 5x–20x faster multithreaded processing.');
    }
    if (anomalies.some(a => a.code === 'SLOW_ITERROWS_LOOP')) {
      optimizationTips.push('Vectorize row computations using numpy / polars expressions.');
    }

    return {
      anomalies,
      pandasDetected,
      polarsDetected,
      optimizationTips,
    };
  }
}
