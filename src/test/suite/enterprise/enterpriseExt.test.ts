import * as assert from "assert";
import {
  SqlTranspiler,
  PiiSanitizer,
  ReverseEtlGenerator,
  RlsPolicyGenerator,
  SyntheticDataGenerator,
  MockServerGenerator
} from "../../../enterprise";

suite("Enterprise Suite — Extended Commercial FDE Modules", () => {
  test("SqlTranspiler converts Oracle and T-SQL to BigQuery & Snowflake with dbt headers", () => {
    const res = SqlTranspiler.transpile({
      sourceDialect: "oracle",
      targetDialect: "bigquery",
      sourceSql: "SELECT NVL(col1, 0), SYSDATE, col2 FROM my_table",
      modelName: "fct_orders",
      addDbtConfig: true
    });
    assert.ok(res.transpiledSql.includes("COALESCE(col1, 0)"));
    assert.ok(res.transpiledSql.includes("CURRENT_TIMESTAMP()"));
    assert.ok(res.transpiledSql.includes("config("));
    assert.strictEqual(res.readinessScore >= 80, true);
  });

  test("PiiSanitizer generates dbt masking macros, safe staging models & Python script", () => {
    const res = PiiSanitizer.generatePiiMaskingSuite({
      modelName: "stg_patients",
      sourceTable: "raw_ehr_patients",
      rules: [
        { columnName: "ssn", piiType: "ssn", strategy: "redact_partial" },
        { columnName: "email", piiType: "email", strategy: "hash_sha256" }
      ]
    });
    assert.ok(res.dbtMacroSql.includes("mask_pii_column"));
    assert.ok(res.stagingModelSql.includes("ssn_masked"));
    assert.ok(res.stagingModelSql.includes("email_tokenized"));
    assert.ok(res.pythonSanitizerCode.includes("DEFAULT_SALT"));
  });

  test("ReverseEtlGenerator generates resilient sync worker with idempotency keys", () => {
    const res = ReverseEtlGenerator.generateReverseEtlSync({
      syncName: "sync_hubspot_deals",
      sourceModel: "fct_deals",
      sink: "hubspot",
      rateLimitPerSec: 20
    });
    assert.ok(res.pythonWorker.includes("compute_idempotency_key"));
    assert.ok(res.pythonWorker.includes("HUBSPOT_ENDPOINT"));
    assert.ok(res.typeScriptWorker.includes("ReverseEtlWorker"));
  });

  test("RlsPolicyGenerator generates PostgreSQL, Snowflake, and BigQuery RLS policies", () => {
    const pg = RlsPolicyGenerator.generateRlsPolicies({
      tableName: "fct_invoices",
      tenantColumn: "client_id",
      engine: "postgres"
    });
    assert.ok(pg.policySql.includes("ENABLE ROW LEVEL SECURITY"));
    assert.ok(pg.policySql.includes("tenant_isolation_policy"));

    const sf = RlsPolicyGenerator.generateRlsPolicies({
      tableName: "fct_invoices",
      tenantColumn: "client_id",
      engine: "snowflake"
    });
    assert.ok(sf.policySql.includes("CREATE OR REPLACE ROW ACCESS POLICY"));
  });

  test("SyntheticDataGenerator produces referentially intact customers & invoices CSV", () => {
    const res = SyntheticDataGenerator.generateDataset({
      datasetName: "pilot_golden",
      rowCount: 50
    });
    assert.ok(res.customersCsv.includes("customer_id,company_name"));
    assert.ok(res.invoicesCsv.includes("invoice_id,customer_id"));
    assert.ok(res.seedSql.includes("CREATE TABLE IF NOT EXISTS mock_customers"));
  });

  test("MockServerGenerator generates standalone Node.js and Python mock API servers", () => {
    const res = MockServerGenerator.generateMockServer({
      port: 9090,
      latencyMs: 120
    });
    assert.ok(res.nodeServerJs.includes("LATENCY_MS = 120"));
    assert.ok(res.nodeServerJs.includes("/api/v1/invoices"));
    assert.ok(res.pythonServerPy.includes("MockHandler"));
  });
});