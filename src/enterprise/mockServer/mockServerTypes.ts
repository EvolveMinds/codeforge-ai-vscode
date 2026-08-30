export interface MockServerOptions {
  port?: number;
  latencyMs?: number;
  chaosRateLimitPercent?: number;
  chaosErrorPercent?: number;
}
export interface MockServerResult {
  nodeServerJs: string;
  pythonServerPy: string;
  shellRunner: string;
  writtenFiles: { nodeServerPath: string; pythonServerPath: string; runnerPath: string };
}