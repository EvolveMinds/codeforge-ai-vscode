/**
 * enterprise/loadTesting/loadTestTypes.ts
 *
 * Type contracts for automated performance & SLA load test generation.
 * Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

export interface LoadTestStage {
  duration: string; // e.g. "30s", "2m", "5m"
  target: number;   // concurrent Virtual Users (VUs)
}

export interface SlaThresholds {
  p95LatencyMs: number; // default 150ms
  p99LatencyMs: number; // default 300ms
  maxErrorRatePercent: number; // default 1.0%
}

export interface LoadTestOptions {
  serviceName: string;
  targetUrl: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  authType?: 'none' | 'bearer' | 'basic' | 'apikey';
  authHeaderName?: string;
  authSecretEnvVar?: string;
  stages?: LoadTestStage[];
  sla?: SlaThresholds;
  requestBody?: string | Record<string, any>;
  headers?: Record<string, string>;
  rampPreset?: 'smoke' | 'standard' | 'stress' | 'spike';
}

export interface GeneratedLoadTestSuite {
  k6Script: string;
  k6FilePath: string;
  locustScript: string;
  locustFilePath: string;
  shellRunner: string;
  psRunner: string;
}
