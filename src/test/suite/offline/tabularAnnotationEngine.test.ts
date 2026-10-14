import * as assert from 'assert';
import {
  TabularAnnotationEngine,
  TableAnnotationState,
  OutlierDisposition,
  ColumnSemanticTag
} from '../../../offline/tabularAnnotationEngine';

suite('Offline Tabular Anomaly & Column Governance Engine Suite', () => {
  test('detectOutliers identifies statistical extreme values via IQR', () => {
    const cols = [
      { name: 'order_id', type: 'integer' },
      { name: 'amount', type: 'numeric' },
      { name: 'customer_name', type: 'varchar' }
    ];

    // 10 normal amounts around 100-200, plus one extreme outlier at 99999
    const rows = [
      { order_id: 1, amount: 105, customer_name: 'Alice' },
      { order_id: 2, amount: 110, customer_name: 'Bob' },
      { order_id: 3, amount: 115, customer_name: 'Charlie' },
      { order_id: 4, amount: 120, customer_name: 'Dave' },
      { order_id: 5, amount: 125, customer_name: 'Eve' },
      { order_id: 6, amount: 130, customer_name: 'Frank' },
      { order_id: 7, amount: 135, customer_name: 'Grace' },
      { order_id: 8, amount: 140, customer_name: 'Heidi' },
      { order_id: 9, amount: 99999, customer_name: 'Ivan' } // Extreme outlier
    ];

    const outliers = TabularAnnotationEngine.detectOutliers(cols, rows);
    assert.ok(outliers.length >= 1, 'Should identify at least 1 outlier');
    const outlier = outliers.find(o => o.columnName === 'amount');
    assert.ok(outlier, 'Should flag amount column');
    assert.strictEqual(outlier?.value, 99999);
    assert.strictEqual(outlier?.rowIndex, 8);
    assert.ok(outlier?.reason.includes('exceeds upper IQR threshold'));
  });

  test('recordOutlierDisposition registers cell decisions correctly', () => {
    let state = TabularAnnotationEngine.createInitialState('orders');

    const disposition: OutlierDisposition = {
      cellId: 'orders:8:amount',
      tableName: 'orders',
      rowIndex: 8,
      columnName: 'amount',
      value: 99999,
      disposition: 'anomaly',
      notes: 'Test transaction accidentally billed in cents instead of dollars',
      tagged_at: new Date().toISOString()
    };

    state = TabularAnnotationEngine.recordOutlierDisposition(state, disposition);

    assert.strictEqual(Object.keys(state.outliers).length, 1);
    assert.strictEqual(state.outliers['orders:8:amount'].disposition, 'anomaly');
    assert.strictEqual(state.outliers['orders:8:amount'].notes, 'Test transaction accidentally billed in cents instead of dollars');
  });

  test('recordColumnTag saves business roles, PII levels, and dbt tests', () => {
    let state = TabularAnnotationEngine.createInitialState('customers');

    const ssnTag: ColumnSemanticTag = {
      tableName: 'customers',
      columnName: 'ssn_token',
      sensitivity: 'pii_restricted',
      businessRole: 'dimension',
      description: 'National tax identifier hash token',
      dataTests: ['not_null'],
      tagged_at: new Date().toISOString()
    };

    const pkTag: ColumnSemanticTag = {
      tableName: 'customers',
      columnName: 'customer_id',
      sensitivity: 'internal',
      businessRole: 'pk',
      description: 'Unique primary identifier for customer',
      dataTests: ['unique', 'not_null'],
      tagged_at: new Date().toISOString()
    };

    state = TabularAnnotationEngine.recordColumnTag(state, ssnTag);
    state = TabularAnnotationEngine.recordColumnTag(state, pkTag);

    assert.strictEqual(Object.keys(state.columns).length, 2);
    assert.strictEqual(state.columns['ssn_token'].sensitivity, 'pii_restricted');
    assert.strictEqual(state.columns['customer_id'].businessRole, 'pk');
  });

  test('exportDbtSchemaYaml produces standard production dbt schema specification', () => {
    let state = TabularAnnotationEngine.createInitialState('client_orders');

    state = TabularAnnotationEngine.recordColumnTag(state, {
      tableName: 'client_orders',
      columnName: 'order_id',
      sensitivity: 'internal',
      businessRole: 'pk',
      description: 'Primary surrogate order key',
      dataTests: ['unique', 'not_null'],
      tagged_at: new Date().toISOString()
    });

    state = TabularAnnotationEngine.recordColumnTag(state, {
      tableName: 'client_orders',
      columnName: 'card_hash',
      sensitivity: 'pii_restricted',
      businessRole: 'dimension',
      description: 'Hashed payment card token',
      dataTests: ['not_null'],
      tagged_at: new Date().toISOString()
    });

    const yaml = TabularAnnotationEngine.exportDbtSchemaYaml(state);

    assert.ok(yaml.includes('version: 2'));
    assert.ok(yaml.includes('models:'));
    assert.ok(yaml.includes('- name: client_orders'));
    assert.ok(yaml.includes('- name: order_id'));
    assert.ok(yaml.includes('business_role: pk'));
    assert.ok(yaml.includes('security_level: INTERNAL'));
    assert.ok(yaml.includes('security_level: PII_RESTRICTED'));
    assert.ok(yaml.includes('- unique'));
    assert.ok(yaml.includes('- not_null'));
  });

  test('exportSanitizationSql generates quarantine and masking SQL views', () => {
    let state = TabularAnnotationEngine.createInitialState('sales_transactions');

    state = TabularAnnotationEngine.recordColumnTag(state, {
      tableName: 'sales_transactions',
      columnName: 'tax_number',
      sensitivity: 'pii_restricted',
      businessRole: 'dimension',
      tagged_at: new Date().toISOString()
    });

    state = TabularAnnotationEngine.recordOutlierDisposition(state, {
      cellId: 'sales_transactions:12:revenue',
      tableName: 'sales_transactions',
      rowIndex: 12,
      columnName: 'revenue',
      value: -500000,
      disposition: 'anomaly',
      tagged_at: new Date().toISOString()
    });

    const sql = TabularAnnotationEngine.exportSanitizationSql(state, 'postgres');

    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS sales_transactions_anomalies_quarantine'));
    assert.ok(sql.includes('CREATE OR REPLACE VIEW sales_transactions_sanitized'));
    assert.ok(sql.includes('MD5(CAST(tax_number AS VARCHAR)) AS tax_number_masked'));
    assert.ok(sql.includes('CASE WHEN revenue IN (-500000) THEN NULL ELSE revenue END'));
  });

  test('exportAuditMarkdown produces executive governance audit report', () => {
    let state = TabularAnnotationEngine.createInitialState('employees');

    state = TabularAnnotationEngine.recordColumnTag(state, {
      tableName: 'employees',
      columnName: 'salary_usd',
      sensitivity: 'confidential',
      businessRole: 'metric',
      description: 'Annual base compensation',
      dataTests: ['not_null'],
      tagged_at: new Date().toISOString()
    });

    state = TabularAnnotationEngine.recordOutlierDisposition(state, {
      cellId: 'employees:3:salary_usd',
      tableName: 'employees',
      rowIndex: 3,
      columnName: 'salary_usd',
      value: 12000000,
      disposition: 'legitimate_extreme',
      notes: 'Executive compensation for CEO',
      tagged_at: new Date().toISOString()
    });

    const md = TabularAnnotationEngine.exportAuditMarkdown(state);

    assert.ok(md.includes('# Data Governance & Anomaly Audit Report: `employees`'));
    assert.ok(md.includes('**salary_usd**'));
    assert.ok(md.includes('`confidential`'));
    assert.ok(md.includes('**LEGITIMATE_EXTREME**'));
    assert.ok(md.includes('Executive compensation for CEO'));
    assert.ok(md.includes('Table contains **1** columns classified as Sensitive/PII'));
  });
});
