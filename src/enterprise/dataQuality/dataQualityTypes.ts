/**
 * enterprise/dataQuality/dataQualityTypes.ts
 *
 * Enterprise Data Quality, Great Expectations & Schema Drift Assertions
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

export interface ColumnQualityRule {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  isUnique?: boolean;
  minValue?: number | string;
  maxValue?: number | string;
  allowedValues?: string[];
  regexPattern?: string;
  foreignKeyRef?: {
    table: string;
    column: string;
  };
}

export interface TableQualitySuiteOptions {
  tableName: string;
  modelName: string;
  databaseDialect?: string;
  columns: ColumnQualityRule[];
  enforceOrdering?: boolean;
  enforceNoExtraColumns?: boolean;
  freshnessThresholdHours?: number;
  freshnessTimestampColumn?: string;
  anomalyZScoreThreshold?: number;
  criticalityTier?: 'P0_CRITICAL' | 'P1_CORE' | 'P2_ANALYTICS';
}

export interface GreatExpectationsSuiteResult {
  suiteName: string;
  jsonContent: string;
  filePath: string;
}

export interface SodaCoreCheckResult {
  tableName: string;
  yamlContent: string;
  filePath: string;
}

export interface DbtTestYamlResult {
  modelName: string;
  yamlContent: string;
  filePath: string;
}

export interface ConsolidatedDataQualityPackage {
  modelName: string;
  tableName: string;
  greatExpectations: GreatExpectationsSuiteResult;
  sodaCore: SodaCoreCheckResult;
  dbtSchemaTests: DbtTestYamlResult;
  ciGateScriptSh: string;
  ciGateScriptPs1: string;
}
