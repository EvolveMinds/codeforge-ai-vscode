export type SqlDialect = 'oracle' | 'tsql' | 'teradata' | 'redshift' | 'postgres' | 'mysql' | 'snowflake' | 'bigquery';
export interface SqlTranspileOptions {
  sourceDialect: SqlDialect;
  targetDialect: SqlDialect;
  sourceSql: string;
  modelName?: string;
  materialization?: 'table' | 'view' | 'incremental' | 'ephemeral';
  targetSchema?: string;
  addDbtConfig?: boolean;
}
export interface SqlTranspileResult {
  transpiledSql: string;
  sourceDialect: SqlDialect;
  targetDialect: SqlDialect;
  functionsConverted: { from: string; to: string; count: number }[];
  dataTypesConverted: { from: string; to: string }[];
  warnings: string[];
  readinessScore: number;
  dbtModelPath?: string;
}
