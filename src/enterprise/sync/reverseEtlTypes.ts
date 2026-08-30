export type ReverseEtlSink = "salesforce" | "hubspot" | "stripe" | "webhook" | "kafka";
export interface ReverseEtlOptions {
  syncName: string;
  sourceModel: string;
  sink: ReverseEtlSink;
  targetEndpoint?: string;
  batchSize?: number;
  rateLimitPerSec?: number;
  idempotencyKeyColumn?: string;
  cursorColumn?: string;
}
export interface ReverseEtlResult {
  pythonWorker: string;
  typeScriptWorker: string;
  dockerCompose: string;
  writtenFiles: { pythonWorkerPath: string; typeScriptWorkerPath: string };
}