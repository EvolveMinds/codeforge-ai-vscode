/**
 * test/suite/offline/dbtSynchronizer.test.ts — Unit tests for dbt schema.yml synchronizer
 */

import * as assert from 'assert';
import { DbtSynchronizer } from '../../../offline/dbtSynchronizer';

suite('Offline dbt Synchronizer Suite', () => {
  test('extracts output columns from complex dbt SQL with CTEs and aliases', () => {
    const sql = `
      with raw_source as (
        select user_id, email, first_name as fname, created_at from {{ source('jaffle_shop', 'users') }}
      ),
      transformed as (
        select
          user_id,
          email,
          fname as customer_first_name,
          date(created_at) as signup_date
        from raw_source
      )
      select
        user_id,
        email,
        customer_first_name,
        signup_date
      from transformed
    `;

    const cols = DbtSynchronizer.extractColumnsFromSql(sql);
    assert.deepStrictEqual(cols, ['user_id', 'email', 'customer_first_name', 'signup_date']);
  });

  test('scaffolds new schema.yml content when no existing YAML is present', () => {
    const cols = ['order_id', 'customer_id', 'order_total', 'status'];
    const result = DbtSynchronizer.mergeColumnsIntoYaml('', 'stg_orders', cols);

    assert.strictEqual(result.addedColumns.length, 4);
    assert.ok(result.updatedYamlContent.includes('models:'));
    assert.ok(result.updatedYamlContent.includes('- name: stg_orders'));
    assert.ok(result.updatedYamlContent.includes('- name: order_id'));
    assert.ok(result.updatedYamlContent.includes('- name: order_total'));
  });

  test('appends only missing columns to existing schema.yml without overwriting existing descriptions', () => {
    const existingYaml = `
version: 2

models:
  - name: stg_orders
    description: "Existing human written doc"
    columns:
      - name: order_id
        description: "Primary key"
        tests:
          - unique
          - not_null
`;

    const cols = ['order_id', 'customer_id', 'new_metric'];
    const result = DbtSynchronizer.mergeColumnsIntoYaml(existingYaml, 'stg_orders', cols);

    assert.deepStrictEqual(result.addedColumns, ['customer_id', 'new_metric']);
    assert.ok(result.updatedYamlContent.includes('Existing human written doc'));
    assert.ok(result.updatedYamlContent.includes('Primary key'));
    assert.ok(result.updatedYamlContent.includes('- name: customer_id'));
    assert.ok(result.updatedYamlContent.includes('- name: new_metric'));
  });
});
