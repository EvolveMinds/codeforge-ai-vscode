export type MaskingStrategy = "hash_sha256" | "redact_full" | "redact_partial" | "fernet_encrypt" | "date_shift";
export interface ColumnMaskingRule {
  columnName: string;
  piiType: "ssn" | "credit_card" | "email" | "phone" | "name" | "mrn" | "address" | "ip" | "salary";
  strategy: MaskingStrategy;
}
export interface PiiSanitizeOptions {
  modelName: string;
  sourceTable: string;
  rules: ColumnMaskingRule[];
}
export interface PiiSanitizeResult {
  dbtMacroSql: string;
  stagingModelSql: string;
  pythonSanitizerCode: string;
  auditMarkdown: string;
  writtenFiles: { dbtMacroPath: string; stagingModelPath: string; pythonPath: string };
}
