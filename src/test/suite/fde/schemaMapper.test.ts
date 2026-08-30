import * as assert from 'assert';
import { SchemaMapperEngine, ColumnDefinition } from '../../../fde/schemaMapper';

suite('FDE Suite — SchemaMapperEngine', () => {
  test('scores exact and synonym matches with high confidence', () => {
    assert.strictEqual(SchemaMapperEngine.scoreFieldMatch('customer_id', 'customer_id'), 1.0);
    const score1 = SchemaMapperEngine.scoreFieldMatch('cust_nbr_id', 'customer_id');
    assert.ok(score1 >= 0.7, `Expected score >= 0.7 for cust_nbr_id vs customer_id, got ${score1}`);

    const score2 = SchemaMapperEngine.scoreFieldMatch('tx_amt', 'transaction_amount');
    assert.ok(score2 >= 0.7, `Expected score >= 0.7 for tx_amt vs transaction_amount, got ${score2}`);
  });

  test('maps source schema to target model with appropriate type casts', () => {
    const srcCols: ColumnDefinition[] = [
      { name: 'CUST_NBR_ID', type: 'string' },
      { name: 'TXN_AMT', type: 'string' },
      { name: 'CREATED_TS', type: 'string' },
      { name: 'IS_ACTIVE_FLG', type: 'string' },
      { name: 'MISC_LEGACY_CODE', type: 'string' },
    ];

    const tgtCols: ColumnDefinition[] = [
      { name: 'customer_id', type: 'string' },
      { name: 'transaction_amount', type: 'numeric' },
      { name: 'created_at', type: 'timestamp' },
      { name: 'is_active', type: 'boolean' },
    ];

    const result = SchemaMapperEngine.mapSchemas(srcCols, tgtCols, 'raw_orders', 'stg_orders');

    assert.strictEqual(result.mappings.length, 4);
    assert.strictEqual(result.unmappedSource.length, 1);
    assert.strictEqual(result.unmappedSource[0], 'MISC_LEGACY_CODE');

    assert.ok(result.dbtSql.includes(`-- dbt Staging Model: stg_orders`));
    assert.ok(result.dbtSql.includes(`AS customer_id`));
    assert.ok(result.dbtSql.includes(`TRY_CAST(CREATED_TS AS TIMESTAMP)`));
    assert.ok(result.dbtSql.includes(`AS raw_misc_legacy_code`));

    assert.ok(result.pysparkCode.includes(`def transform_stg_orders(raw_df):`));
    assert.ok(result.sqlView.includes(`CREATE OR REPLACE VIEW v_stg_orders AS`));
  });

  test('generates dbt dimensional data mart model with joins and metrics', () => {
    const mart = SchemaMapperEngine.generateDataMartModel(
      'fct_customer_orders',
      'stg_orders',
      [{ joinType: 'LEFT', targetModel: 'stg_users', onCondition: 'orders.customer_id = users.user_id' }],
      ['orders.customer_id', 'orders.created_at', 'users.email'],
      [
        { name: 'total_orders', expression: 'count(distinct orders.order_id)' },
        { name: 'total_revenue', expression: 'sum(orders.transaction_amount)' },
      ],
      'dbt'
    );

    assert.ok(mart.dbtSql.includes(`-- dbt Data Mart Model: fct_customer_orders`));
    assert.ok(mart.dbtSql.includes(`{{ ref('stg_orders') }}`));
    assert.ok(mart.dbtSql.includes(`{{ ref('stg_users') }}`));
    assert.ok(mart.dbtSql.includes(`LEFT JOIN users ON orders.customer_id = users.user_id`) || mart.dbtSql.includes(`LEFT JOIN stg_users ON orders.customer_id = users.user_id`));
    assert.ok(mart.dbtSql.includes(`count(distinct orders.order_id) AS total_orders`));
    assert.ok(mart.dbtSql.includes(`sum(orders.transaction_amount) AS total_revenue`));
    assert.ok(mart.pysparkCode.includes(`def build_mart_fct_customer_orders`));
    assert.ok(mart.sqlView.includes(`CREATE OR REPLACE VIEW v_fct_customer_orders AS`));
  });

  test('suggests foreign key join conditions automatically with high confidence', () => {
    const baseCols = ['order_id', 'customer_id', 'amount', 'created_at'];
    const joinCols = ['id', 'email', 'country_code', 'registered_at'];

    const match1 = SchemaMapperEngine.suggestJoinKeys(baseCols, joinCols, 'stg_orders', 'stg_customers');
    assert.strictEqual(match1.condition, 'orders.customer_id = customers.id');
    assert.ok(match1.confidence >= 0.9);

    const tripCols = ['trip_id', 'driver_id', 'passenger_id', 'fare'];
    const driverCols = ['id', 'driver_name', 'vehicle_model'];
    const match2 = SchemaMapperEngine.suggestJoinKeys(tripCols, driverCols, 'trips', 'drivers');
    assert.strictEqual(match2.condition, 'trips.driver_id = drivers.id');
    assert.ok(match2.confidence >= 0.9);
  });

  test('generates dbt schema YAML test definitions for dimensional marts', () => {
    const yaml = SchemaMapperEngine.generateDbtSchemaYaml(
      'fct_customer_orders',
      ['orders.customer_id', 'users.email'],
      [
        { name: 'total_orders', expr: 'count(distinct orders.order_id)' },
        { name: 'total_revenue', expr: 'sum(orders.transaction_amount)' },
      ]
    );

    assert.ok(yaml.includes(`name: fct_customer_orders`));
    assert.ok(yaml.includes(`- name: customer_id`));
    assert.ok(yaml.includes(`- not_null`));
    assert.ok(yaml.includes(`- name: total_revenue`));
    assert.ok(yaml.includes(`Aggregated metric formula: sum(orders.transaction_amount)`));
  });
});
