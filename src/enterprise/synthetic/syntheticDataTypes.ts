export interface SyntheticDataOptions {
  datasetName: string;
  rowCount: number;
  includeInvoices?: boolean;
  includeEvents?: boolean;
  format?: "csv" | "json" | "sql";
}
export interface SyntheticDataResult {
  customersCsv: string;
  invoicesCsv: string;
  eventsJson: string;
  seedSql: string;
  writtenFiles: { customersCsvPath: string; invoicesCsvPath: string; seedSqlPath: string };
}