import * as assert from 'assert';
import { FdeAiEngine, IntrospectedTableSummary } from '../../../fde/aiEngine';

suite('FDE Suite — FdeAiEngine', () => {
  test('standardizes raw column names and types into clean staging schema', () => {
    const rawCols = `
      CUST_NBR_ID:varchar(50)
      TXN_AMT:numeric(12,2)
      CREATED_TS:timestamptz
      IS_ACTIVE_FLG:tinyint(1)
      RAW_PAYLOAD:jsonb
    `;

    const result = FdeAiEngine.analyzeAndCleanStagingSchema(rawCols, 'client_orders_raw');

    assert.strictEqual(result.targetModelName, 'stg_orders');
    assert.strictEqual(result.targetOutputPath, 'models/staging/stg_orders.sql');
    assert.ok(result.targetColumnsText.includes('cust_nbr_id:string') || result.targetColumnsText.includes('cust_nbr_id:numeric'));
    assert.ok(result.targetColumnsText.includes('txn_amt:numeric'));
    assert.ok(result.targetColumnsText.includes('created_ts:timestamp'));
    assert.ok(result.targetColumnsText.includes('is_active_flg:boolean'));
    assert.ok(result.targetColumnsText.includes('raw_payload:json'));
  });

  test('detects sensitive PII and generates privacy masking rules', () => {
    const rawCols = `
      user_id:string
      email_address:string
      phone_number:string
      tax_id_ssn:string
    `;

    const result = FdeAiEngine.analyzeAndCleanStagingSchema(rawCols, 'users', { enablePiiMasking: true });

    assert.strictEqual(result.piiDetected.length, 3);
    assert.ok(result.targetColumnsText.includes('hashed_email_address:string'));
    assert.ok(result.targetColumnsText.includes('masked_tax_id_ssn:string'));
  });

  test('discovers relational Mart recipes with foreign key matching', () => {
    const allTables: IntrospectedTableSummary[] = [
      {
        tableName: 'account_deletion_requests',
        schema: 'public',
        columns: [
          { name: 'id', type: 'string' },
          { name: 'user_id', type: 'string' },
          { name: 'reason', type: 'string' },
          { name: 'grace_period_ends', type: 'timestamp' },
          { name: 'status', type: 'string' },
        ],
      },
      {
        tableName: 'users',
        schema: 'public',
        columns: [
          { name: 'id', type: 'string' },
          { name: 'email', type: 'string' },
          { name: 'tier', type: 'string' },
          { name: 'country', type: 'string' },
        ],
      },
    ];

    const recipes = FdeAiEngine.discoverMartRecipes('account_deletion_requests', allTables);

    assert.ok(recipes.length >= 2);
    const relRecipe = recipes.find(r => r.joinModel.includes('user'));
    assert.ok(relRecipe, 'Expected relational recipe joining users');
    assert.strictEqual(relRecipe?.joinCondition, 'account_deletion_requests.user_id = user.id');
    assert.ok(relRecipe?.dimensions.some(d => d.includes('status') || d.includes('reason')));
    assert.ok(relRecipe?.metrics.some(m => m.name.includes('total_account_deletion_requests')));
  });

  test('generates customized mart configuration from natural language prompt', () => {
    const allTables: IntrospectedTableSummary[] = [
      {
        tableName: 'orders',
        schema: 'public',
        columns: [
          { name: 'order_id', type: 'string' },
          { name: 'customer_id', type: 'string' },
          { name: 'amount', type: 'numeric' },
          { name: 'status', type: 'string' },
        ],
      },
      {
        tableName: 'customers',
        schema: 'public',
        columns: [
          { name: 'id', type: 'string' },
          { name: 'country', type: 'string' },
          { name: 'email', type: 'string' },
        ],
      },
    ];

    const mart = FdeAiEngine.generateMartFromNaturalLanguage('Calculate monthly sales and revenue by customer country', allTables);

    assert.ok(mart !== null);
    assert.ok(mart?.title.includes('Revenue'));
    assert.ok(mart?.baseModel.includes('orders'));
  });
});
