import { SqlTranspileOptions, SqlTranspileResult } from './sqlTranspilerTypes';
export class SqlTranspiler {
  static transpile(opts: SqlTranspileOptions): SqlTranspileResult {
    let sql = opts.sourceSql || '';
    const functionsConverted: { from: string; to: string; count: number }[] = [];
    const dataTypesConverted: { from: string; to: string }[] = [];
    const warnings: string[] = [];

    if (opts.sourceDialect === 'oracle') {
      if (/\bNVL\s*\(/i.test(sql)) {
        const count = (sql.match(/\bNVL\s*\(/gi) || []).length;
        sql = sql.replace(/\bNVL\s*\(/gi, 'COALESCE(');
        functionsConverted.push({ from: 'NVL', to: 'COALESCE', count });
      }
      if (/\bSYSDATE\b/i.test(sql)) {
        sql = sql.replace(/\bSYSDATE\b/gi, opts.targetDialect === 'bigquery' ? 'CURRENT_TIMESTAMP()' : 'CURRENT_TIMESTAMP');
        functionsConverted.push({ from: 'SYSDATE', to: 'CURRENT_TIMESTAMP', count: 1 });
      }
      if (/\bVARCHAR2\b/i.test(sql)) {
        sql = sql.replace(/\bVARCHAR2\s*\((\d+)\)/gi, opts.targetDialect === 'bigquery' ? 'STRING' : 'VARCHAR($1)');
        dataTypesConverted.push({ from: 'VARCHAR2', to: opts.targetDialect === 'bigquery' ? 'STRING' : 'VARCHAR' });
      }
      if (/\bNUMBER\b/i.test(sql)) {
        sql = sql.replace(/\bNUMBER\s*\((\d+)\s*,\s*(\d+)\)/gi, 'NUMERIC($1,$2)');
        sql = sql.replace(/\bNUMBER\b/gi, opts.targetDialect === 'bigquery' ? 'NUMERIC' : 'NUMERIC(38,0)');
        dataTypesConverted.push({ from: 'NUMBER', to: 'NUMERIC' });
      }
    }

    if (opts.sourceDialect === 'tsql') {
      if (/\bISNULL\s*\(/i.test(sql)) {
        sql = sql.replace(/\bISNULL\s*\(/gi, 'COALESCE(');
        functionsConverted.push({ from: 'ISNULL', to: 'COALESCE', count: 1 });
      }
      if (/\bGETDATE\s*\(\s*\)/i.test(sql)) {
        sql = sql.replace(/\bGETDATE\s*\(\s*\)/gi, opts.targetDialect === 'bigquery' ? 'CURRENT_TIMESTAMP()' : 'CURRENT_TIMESTAMP');
        functionsConverted.push({ from: 'GETDATE()', to: 'CURRENT_TIMESTAMP', count: 1 });
      }
      if (/\bDATETIME2\b/i.test(sql)) {
        sql = sql.replace(/\bDATETIME2\b/gi, 'TIMESTAMP');
        dataTypesConverted.push({ from: 'DATETIME2', to: 'TIMESTAMP' });
      }
    }

    let finalSql = sql;
    if (opts.addDbtConfig) {
      const mat = opts.materialization || 'table';
      const schema = opts.targetSchema ? ', schema=\'' + opts.targetSchema + '\'' : '';
      finalSql = '{{\n  config(\n    materialized=\'' + mat + '\'' + schema + '\n  )\n}}\n\n' + finalSql;
    }

    const readinessScore = Math.max(85, 100 - warnings.length * 10);
    const modelName = (opts.modelName || 'migrated_model').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return {
      transpiledSql: finalSql,
      sourceDialect: opts.sourceDialect,
      targetDialect: opts.targetDialect,
      functionsConverted,
      dataTypesConverted,
      warnings,
      readinessScore,
      dbtModelPath: 'models/marts/' + modelName + '.sql'
    };
  }
}
