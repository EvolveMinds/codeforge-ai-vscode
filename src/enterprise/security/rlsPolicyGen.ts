import { RlsPolicyOptions, RlsPolicyResult } from "./rlsPolicyTypes";

export class RlsPolicyGenerator {
  static generateRlsPolicies(opts: RlsPolicyOptions): RlsPolicyResult {
    const safeOpts = opts || ({} as any);
    const table = safeOpts.tableName || "fct_client_invoices";
    const tenantCol = safeOpts.tenantColumn || "tenant_id";
    const roles = Array.isArray(safeOpts.roles) ? safeOpts.roles : ["app_client_role", "admin_role"];
    const engine = (safeOpts.engine || (safeOpts as any).dialect || "postgres").toLowerCase();

    let policySql = "";
    let testVerificationSql = "";

    if (engine === "postgres" || engine === "supabase") {
      policySql = "ALTER TABLE " + table + " ENABLE ROW LEVEL SECURITY;\nALTER TABLE " + table + " FORCE ROW LEVEL SECURITY;\n\nCREATE POLICY tenant_isolation_policy ON " + table + "\n  FOR ALL\n  TO " + roles.join(", ") + "\n  USING (" + tenantCol + " = CURRENT_SETTING('app.current_tenant_id', true))\n  WITH CHECK (" + tenantCol + " = CURRENT_SETTING('app.current_tenant_id', true));\n";
      testVerificationSql = "SET LOCAL app.current_tenant_id = 'tenant_alpha';\nSELECT COUNT(*) FROM " + table + ";\n";
    } else if (engine === "snowflake") {
      policySql = "CREATE OR REPLACE ROW ACCESS POLICY " + table + "_tenant_policy AS (" + tenantCol + " VARCHAR)\nRETURNS BOOLEAN ->\n  CURRENT_ROLE() IN ('ACCOUNTADMIN', 'SECURITYADMIN')\n  OR " + tenantCol + " = CURRENT_ACCOUNT();\n\nALTER TABLE " + table + " ADD ROW ACCESS POLICY " + table + "_tenant_policy ON (" + tenantCol + ");\n";
      testVerificationSql = "SELECT * FROM " + table + " LIMIT 10;\n";
    } else {
      policySql = "CREATE OR REPLACE ROW ACCESS POLICY tenant_filter_policy\nON `" + table + "`\nGRANT TO (\"group:client-analytics@corp.com\")\nFILTER USING (" + tenantCol + " = SESSION_USER());\n";
      testVerificationSql = "SELECT COUNT(*) FROM `" + table + "`;";
    }

    const documentation = "# Zero-Trust RLS Security Architecture\n**Target Table**: `" + table + "`\n**Tenant Isolation Column**: `" + tenantCol + "`\n**Engine**: `" + engine.toUpperCase() + "`\n";

    return {
      policySql,
      testVerificationSql,
      documentation,
      sql: policySql,
      writtenPath: "security/rls_" + table + ".sql"
    };
  }
}