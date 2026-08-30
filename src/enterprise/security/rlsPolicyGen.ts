import { RlsPolicyOptions, RlsPolicyResult } from "./rlsPolicyTypes";
export class RlsPolicyGenerator {
  static generateRlsPolicies(opts: RlsPolicyOptions): RlsPolicyResult {
    const table = opts.tableName || "fct_client_invoices";
    const tenantCol = opts.tenantColumn || "tenant_id";
    const roles = opts.roles || ["app_client_role", "admin_role"];
    let policySql = "";
    let testVerificationSql = "";
    if (opts.engine === "postgres" || opts.engine === "supabase") {
      policySql = "ALTER TABLE " + table + " ENABLE ROW LEVEL SECURITY;\nALTER TABLE " + table + " FORCE ROW LEVEL SECURITY;\n\nCREATE POLICY tenant_isolation_policy ON " + table + "\n  FOR ALL\n  TO " + roles.join(", ") + "\n  USING (" + tenantCol + " = CURRENT_SETTING('app.current_tenant_id', true))\n  WITH CHECK (" + tenantCol + " = CURRENT_SETTING('app.current_tenant_id', true));\n";
      testVerificationSql = "SET LOCAL app.current_tenant_id = 'tenant_alpha';\nSELECT COUNT(*) FROM " + table + ";\n";
    } else if (opts.engine === "snowflake") {
      policySql = "CREATE OR REPLACE ROW ACCESS POLICY " + table + "_tenant_policy AS (" + tenantCol + " VARCHAR)\nRETURNS BOOLEAN ->\n  CURRENT_ROLE() IN ('ACCOUNTADMIN', 'SECURITYADMIN')\n  OR " + tenantCol + " = CURRENT_ACCOUNT();\n\nALTER TABLE " + table + " ADD ROW ACCESS POLICY " + table + "_tenant_policy ON (" + tenantCol + ");\n";
      testVerificationSql = "SELECT * FROM " + table + " LIMIT 10;\n";
    } else {
      policySql = "CREATE OR REPLACE ROW ACCESS POLICY tenant_filter_policy\nON `" + table + "`\nGRANT TO (\"group:client-analytics@corp.com\")\nFILTER USING (" + tenantCol + " = SESSION_USER());\n";
      testVerificationSql = "SELECT COUNT(*) FROM `" + table + "`;";
    }
    const documentation = "# Zero-Trust RLS Security Architecture\n**Target Table**: `" + table + "`\n**Tenant Isolation Column**: `" + tenantCol + "`\n**Engine**: `" + opts.engine.toUpperCase() + "`\n";
    return {
      policySql,
      testVerificationSql,
      documentation,
      writtenPath: "security/rls_" + table + ".sql"
    };
  }
}