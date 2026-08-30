export type RlsEngine = "postgres" | "snowflake" | "bigquery" | "supabase";
export interface RlsPolicyOptions {
  tableName: string;
  tenantColumn: string;
  engine: RlsEngine;
  roles?: string[];
}
export interface RlsPolicyResult {
  policySql: string;
  testVerificationSql: string;
  documentation: string;
  writtenPath: string;
}
