import * as assert from 'assert';
import { DataQualityGenerator, TableQualitySuiteOptions } from '../../../enterprise';

suite('Enterprise Suite — Data Quality & Schema Drift Suite Generator', () => {
  const sampleOptions: TableQualitySuiteOptions = {
    tableName: 'fct_account_deletion_requests',
    modelName: 'fct_account_deletion_requests',
    databaseDialect: 'postgres',
    enforceOrdering: true,
    enforceNoExtraColumns: true,
    freshnessTimestampColumn: 'requested_at',
    freshnessThresholdHours: 24,
    criticalityTier: 'P0_CRITICAL',
    columns: [
      { columnName: 'id', dataType: 'varchar', isNullable: false, isUnique: true },
      { columnName: 'user_id', dataType: 'varchar', isNullable: false, foreignKeyRef: { table: 'dim_users', column: 'id' } },
      { columnName: 'status', dataType: 'varchar', isNullable: false, allowedValues: ['pending', 'processing', 'completed', 'failed'] },
      { columnName: 'requested_at', dataType: 'timestamptz', isNullable: false },
      { columnName: 'deletion_count', dataType: 'integer', isNullable: false, minValue: 1, maxValue: 1000 }
    ]
  };

  test('generates valid Great Expectations JSON suite with schema drift gates', () => {
    const ge = DataQualityGenerator.generateGreatExpectationsSuite(sampleOptions);

    assert.strictEqual(ge.suiteName, 'fct_account_deletion_requests_quality_suite');
    assert.strictEqual(ge.filePath.includes('expectations/'), true);

    const parsed = JSON.parse(ge.jsonContent);
    assert.strictEqual(parsed.expectation_suite_name, 'fct_account_deletion_requests_quality_suite');
    assert.strictEqual(Array.isArray(parsed.expectations), true);

    // Verify schema drift ordered set check
    const orderedSetExp = parsed.expectations.find((e: any) => e.expectation_type === 'expect_table_columns_to_match_ordered_set');
    assert.ok(orderedSetExp, 'Must include expect_table_columns_to_match_ordered_set');
    assert.deepStrictEqual(orderedSetExp.kwargs.column_list, ['id', 'user_id', 'status', 'requested_at', 'deletion_count']);

    // Verify unique check on id
    const uniqueExp = parsed.expectations.find((e: any) => e.expectation_type === 'expect_column_values_to_be_unique');
    assert.ok(uniqueExp, 'Must include unique check');
    assert.strictEqual(uniqueExp.kwargs.column, 'id');
  });

  test('generates valid Soda Core checks YAML with volume and categorical gates', () => {
    const soda = DataQualityGenerator.generateSodaCoreChecks(sampleOptions);

    assert.strictEqual(soda.tableName, 'fct_account_deletion_requests');
    assert.strictEqual(soda.yamlContent.includes('checks for fct_account_deletion_requests:'), true);
    assert.strictEqual(soda.yamlContent.includes('row_count > 0:'), true);
    assert.strictEqual(soda.yamlContent.includes('missing_count(id) = 0:'), true);
    assert.strictEqual(soda.yamlContent.includes('duplicate_count(id) = 0:'), true);
    assert.strictEqual(soda.yamlContent.includes("['pending', 'processing', 'completed', 'failed']"), true);
    assert.strictEqual(soda.yamlContent.includes('freshness(requested_at) < 24h:'), true);
  });

  test('generates valid dbt schema tests YAML and CI/CD quality gate runner scripts', () => {
    const pkg = DataQualityGenerator.generateQualityPackage(sampleOptions);

    assert.strictEqual(pkg.modelName, 'fct_account_deletion_requests');
    assert.strictEqual(pkg.dbtSchemaTests.yamlContent.includes('relationships:'), true);
    assert.strictEqual(pkg.dbtSchemaTests.yamlContent.includes("to: ref('dim_users')"), true);

    // Verify shell and powershell scripts
    assert.strictEqual(pkg.ciGateScriptSh.includes('dbt test --select fct_account_deletion_requests'), true);
    assert.strictEqual(pkg.ciGateScriptPs1.includes('dbt test --select fct_account_deletion_requests'), true);
  });
});
