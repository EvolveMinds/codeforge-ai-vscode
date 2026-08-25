/**
 * test/suite/offline/sqlFormatter.test.ts — Unit tests for offline SQL formatter
 */

import * as assert from 'assert';
import { SqlFormatter } from '../../../offline/sqlFormatter';

suite('Offline SQL Formatter Suite', () => {
  test('formats basic SELECT FROM WHERE query with keyword uppercase', () => {
    const input = 'select id, name, email from users where active = true and age > 18 order by name asc';
    const formatted = SqlFormatter.format(input, { dialect: 'ansi', keywordCase: 'upper' });

    assert.ok(formatted.includes('SELECT'));
    assert.ok(formatted.includes('FROM'));
    assert.ok(formatted.includes('WHERE'));
    assert.ok(formatted.includes('AND'));
    assert.ok(formatted.includes('ORDER BY'));
  });

  test('formats multi-table JOINs and preserves quotes in BigQuery/Databricks', () => {
    const input = 'select o.id, c.name from `my-project.dataset.orders` o left join `customers` c on o.cust_id = c.id where o.amount > 100';
    const formatted = SqlFormatter.format(input, { dialect: 'bigquery', keywordCase: 'upper' });

    assert.ok(formatted.includes('SELECT'));
    assert.ok(formatted.includes('LEFT JOIN'));
    assert.ok(formatted.includes('`my-project.dataset.orders`'));
    assert.ok(formatted.includes('`customers`'));
  });

  test('formats CTEs and CASE statements with nested indentation', () => {
    const input = 'with summary as (select dept, sum(salary) as total_sal from employees group by dept) select dept, case when total_sal > 100000 then \'high\' else \'standard\' end as category from summary';
    const formatted = SqlFormatter.format(input, { dialect: 'snowflake' });

    assert.ok(formatted.includes('WITH summary AS ('));
    assert.ok(formatted.includes('GROUP BY'));
    assert.ok(formatted.includes('CASE'));
    assert.ok(formatted.includes('WHEN'));
    assert.ok(formatted.includes('THEN'));
    assert.ok(formatted.includes('ELSE'));
    assert.ok(formatted.includes('END'));
  });

  test('preserves Jinja expressions in dbt models', () => {
    const input = "select id, {{ dbt_utils.generate_surrogate_key(['id', 'email']) }} as user_key from {{ ref('raw_users') }} where dt = '{{ var(\"run_date\") }}'";
    const formatted = SqlFormatter.format(input, { dialect: 'databricks' });

    assert.ok(formatted.includes("{{ dbt_utils.generate_surrogate_key(['id', 'email']) }}"));
    assert.ok(formatted.includes("{{ ref('raw_users') }}"));
    assert.ok(formatted.includes("{{ var(\"run_date\") }}"));
  });

  test('supports leading comma style', () => {
    const input = 'select a, b, c from tbl';
    const formatted = SqlFormatter.format(input, { commaStyle: 'leading' });

    assert.ok(formatted.includes(', b'));
    assert.ok(formatted.includes(', c'));
  });
});
