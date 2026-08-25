/**
 * test/suite/offline/dataProfiler.test.ts — Unit tests for offline Data Profiler & Quality Auditor
 */

import * as assert from 'assert';
import { DataProfiler } from '../../../offline/dataProfiler';

suite('Offline Data Profiler Suite', () => {
  test('profiles CSV data and infers column types and descriptive statistics', () => {
    const csv = [
      'id,name,age,salary,signup_date,is_active',
      '1,Alice,28,75000.50,2023-01-15,true',
      '2,Bob,34,92000.00,2023-02-20,false',
      '3,Charlie,42,115000.75,2023-03-10,true',
      '4,Diana,,68000.00,2023-04-05,true',
    ].join('\n');

    const profile = DataProfiler.profileText(csv, 'users.csv');

    assert.strictEqual(profile.totalRows, 4);
    assert.strictEqual(profile.totalColumns, 6);

    const idCol = profile.columns.find(c => c.name === 'id');
    assert.ok(idCol);
    assert.strictEqual(idCol.inferredType, 'integer');
    assert.strictEqual(idCol.nullCount, 0);
    assert.strictEqual(idCol.isPrimaryKeyCandidate, true);

    const ageCol = profile.columns.find(c => c.name === 'age');
    assert.ok(ageCol);
    assert.strictEqual(ageCol.inferredType, 'integer');
    assert.strictEqual(ageCol.nullCount, 1);
    assert.strictEqual(ageCol.nullPercentage, 25.0);
    assert.strictEqual(ageCol.min, 28);
    assert.strictEqual(ageCol.max, 42);

    const salaryCol = profile.columns.find(c => c.name === 'salary');
    assert.ok(salaryCol);
    assert.strictEqual(salaryCol.inferredType, 'float');
    assert.strictEqual(salaryCol.nullCount, 0);

    const dateCol = profile.columns.find(c => c.name === 'signup_date');
    assert.ok(dateCol);
    assert.strictEqual(dateCol.inferredType, 'datetime');
    assert.ok(dateCol.minDate);
    assert.ok(dateCol.maxDate);
  });

  test('profiles JSON dataset and generates dbt YAML test assertions', () => {
    const json = JSON.stringify([
      { order_id: 101, status: 'completed', amount: 250 },
      { order_id: 102, status: 'pending', amount: 120 },
      { order_id: 103, status: 'completed', amount: 450 },
    ]);

    const profile = DataProfiler.profileText(json, 'orders.json');
    assert.strictEqual(profile.totalRows, 3);
    assert.strictEqual(profile.totalColumns, 3);

    const dbtYaml = DataProfiler.exportDbtTestsYaml(profile, 'stg_orders');
    assert.ok(dbtYaml.includes('models:'));
    assert.ok(dbtYaml.includes('- name: stg_orders'));
    assert.ok(dbtYaml.includes('- name: order_id'));
    assert.ok(dbtYaml.includes('unique'));
    assert.ok(dbtYaml.includes('not_null'));
  });

  test('detects quality anomalies such as high missingness and constant columns', () => {
    const csv = [
      'id,country,missing_col',
      '1,USA,val1',
      '2,USA,',
      '3,USA,',
      '4,USA,',
    ].join('\n');

    const profile = DataProfiler.profileText(csv, 'anomalies.csv');
    assert.strictEqual(profile.totalRows, 4);

    const countryCol = profile.columns.find(c => c.name === 'country');
    assert.ok(countryCol?.anomalies.some(a => a.includes('Single constant value')));

    const missingCol = profile.columns.find(c => c.name === 'missing_col');
    assert.ok(missingCol?.anomalies.some(a => a.includes('High missing rate')));
  });

  test('exports Great Expectations suite and Markdown report', () => {
    const csv = 'id,score\n1,95\n2,88\n3,72';
    const profile = DataProfiler.profileText(csv, 'scores.csv');

    const geSuite = DataProfiler.exportGreatExpectationsSuite(profile);
    const parsedGe = JSON.parse(geSuite);
    assert.ok(parsedGe.expectations.length > 0);

    const md = DataProfiler.exportMarkdown(profile);
    assert.ok(md.includes('# 📊 Data Profile: scores.csv'));
    assert.ok(md.includes('score'));
  });
});
