/**
 * enterprise/security/siemTypes.ts
 *
 * Enterprise Security & Compliance Audit Definitions (SOC2, HIPAA, ISO 27001, SAIF)
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

export type SiemDestinationType = 'splunk' | 'datadog' | 'sentinel' | 'cloudwatch' | 'elasticsearch' | 'webhook' | 'local_file';

export type AuditSeverity = 'INFO' | 'WARN' | 'CRITICAL' | 'SECURITY_ALERT';

export type AuditActionType =
  | 'DB_INTROSPECTION_EXECUTED'
  | 'SCHEMA_MAPPED'
  | 'PII_MASK_APPLIED'
  | 'DIMENSIONAL_MART_CREATED'
  | 'API_CONNECTOR_GENERATED'
  | 'PREFLIGHT_AUDIT_RUN'
  | 'DEPLOYMENT_SCAFFOLDED'
  | 'DEPLOYMENT_EXECUTED'
  | 'RUNBOOK_GENERATED'
  | 'LICENSE_ACTIVATED'
  | 'LICENSE_VALIDATION_FAILED'
  | 'SECRET_ACCESSED'
  | 'MODEL_INFERENCE_REQUESTED'
  | 'AIR_GAP_NETWORK_BLOCKED';

export interface AuditEventActor {
  userId?: string;
  userEmail?: string;
  workstationHostname?: string;
  osPlatform?: string;
  organizationId?: string;
  clientEngagement?: string;
}

export interface AuditEventResource {
  type: 'DATABASE_TABLE' | 'STAGING_MODEL' | 'MART_MODEL' | 'API_CONNECTOR' | 'SECRET' | 'CLOUD_DEPLOYMENT' | 'RUNBOOK';
  name: string;
  databaseDialect?: string;
  cloudProvider?: string;
  targetPath?: string;
}

export interface SiemAuditEvent {
  eventId: string;
  timestamp: string;
  version: string;
  severity: AuditSeverity;
  action: AuditActionType;
  actor: AuditEventActor;
  resource?: AuditEventResource;
  metadata?: Record<string, any>;
  complianceTags: Array<'SOC2' | 'HIPAA' | 'ISO27001' | 'GDPR' | 'SAIF'>;
  clientIp?: string;
  redacted: boolean;
}

export interface SplunkHecConfig {
  endpoint: string; // e.g. https://splunk.corp.internal:8088/services/collector/raw
  token: string;
  index?: string;
  sourceType?: string;
}

export interface DatadogLogsConfig {
  endpoint?: string; // e.g. https://http-intake.logs.datadoghq.com/api/v2/logs
  apiKey: string;
  service?: string;
  env?: string;
}

export interface AzureSentinelConfig {
  workspaceId: string;
  sharedKey: string;
  logType: string;
}

export interface CloudWatchLogsConfig {
  logGroupName: string;
  logStreamName: string;
  region: string;
}

export interface SiemForwarderConfig {
  enabled: boolean;
  destination: SiemDestinationType;
  splunk?: SplunkHecConfig;
  datadog?: DatadogLogsConfig;
  sentinel?: AzureSentinelConfig;
  cloudwatch?: CloudWatchLogsConfig;
  webhookUrl?: string;
  localLogFilePath?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maskSensitiveAttributes?: boolean;
}

export interface AuditLogDispatchResult {
  success: boolean;
  destination: SiemDestinationType;
  eventsDispatched: number;
  error?: string;
  timestamp: string;
}
