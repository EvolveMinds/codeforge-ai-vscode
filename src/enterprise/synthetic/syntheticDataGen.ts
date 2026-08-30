import { SyntheticDataOptions, SyntheticDataResult } from "./syntheticDataTypes";
export class SyntheticDataGenerator {
  static generateDataset(opts: SyntheticDataOptions): SyntheticDataResult {
    const count = Math.min(Math.max(opts.rowCount || 100, 10), 10000);
    let custCsv = "customer_id,company_name,industry,tier,created_date,contact_email,is_active\n";
    for (let i = 1; i <= count; i++) {
      custCsv += "CUST-" + (10000 + i) + ",Client Corp " + i + ",Healthcare,Enterprise,2026-01-15,fde+" + i + "@corp.com,true\n";
    }
    let invCsv = "invoice_id,customer_id,amount_cents,currency,status,issued_date,due_date\n";
    for (let i = 1; i <= count * 2; i++) {
      invCsv += "INV-" + (50000 + i) + ",CUST-" + (10000 + ((i % count) + 1)) + ",15400,USD,PAID,2026-02-01,2026-03-01\n";
    }
    const eventsJson = JSON.stringify([{ event_id: "evt_1", customer_id: "CUST-10001", status_code: 200 }], null, 2);
    const seedSql = "CREATE TABLE IF NOT EXISTS mock_customers (customer_id VARCHAR(32) PRIMARY KEY, company_name VARCHAR(128));\n";
    return {
      customersCsv: custCsv,
      invoicesCsv: invCsv,
      eventsJson,
      seedSql,
      writtenFiles: {
        customersCsvPath: "seeds/mock_customers.csv",
        invoicesCsvPath: "seeds/mock_invoices.csv",
        seedSqlPath: "data/mock_golden_dataset.sql"
      }
    };
  }
}