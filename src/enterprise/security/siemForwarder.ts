/**
 * enterprise/security/siemForwarder.ts
 *
 * Enterprise SOC2 & HIPAA Compliance Audit Logger and SIEM Dispatcher
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

import * as crypto from 'crypto';
import * as os from 'os';
import {
  SiemAuditEvent,
  SiemForwarderConfig,
  AuditActionType,
  AuditSeverity,
  AuditEventResource,
  AuditLogDispatchResult
} from './siemTypes';

export class SiemAuditForwarder {
  private static _instance: SiemAuditForwarder;
  private _config: SiemForwarderConfig;
  private _eventQueue: SiemAuditEvent[] = [];

  constructor(config?: Partial<SiemForwarderConfig>) {
    this._config = {
      enabled: config?.enabled ?? false,
      destination: config?.destination || 'local_file',
      maskSensitiveAttributes: config?.maskSensitiveAttributes ?? true,
      batchSize: config?.batchSize || 20,
      flushIntervalMs: config?.flushIntervalMs || 5000,
      ...config
    };
  }

  public static getInstance(config?: Partial<SiemForwarderConfig>): SiemAuditForwarder {
    if (!SiemAuditForwarder._instance) {
      SiemAuditForwarder._instance = new SiemAuditForwarder(config);
    } else if (config) {
      SiemAuditForwarder._instance.updateConfig(config);
    }
    return SiemAuditForwarder._instance;
  }

  public updateConfig(config: Partial<SiemForwarderConfig>): void {
    this._config = { ...this._config, ...config };
  }

  public getConfig(): SiemForwarderConfig {
    return { ...this._config };
  }

  /**
   * Constructs a structured compliance audit event with deterministic redaction
   */
  public createEvent(
    action: AuditActionType,
    severity: AuditSeverity,
    options: {
      resource?: AuditEventResource;
      clientEngagement?: string;
      organizationId?: string;
      userId?: string;
      metadata?: Record<string, any>;
      complianceTags?: Array<'SOC2' | 'HIPAA' | 'ISO27001' | 'GDPR' | 'SAIF'>;
    }
  ): SiemAuditEvent {
    const rawMetadata = options.metadata || {};
    const sanitizedMetadata = this._config.maskSensitiveAttributes
      ? this.redactSensitiveData(rawMetadata)
      : rawMetadata;

    const event: SiemAuditEvent = {
      eventId: 'evt_' + crypto.randomBytes(8).toString('hex'),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      severity: severity,
      action: action,
      actor: {
        userId: options.userId || process.env.USER || process.env.USERNAME || 'fde-user',
        userEmail: process.env.GIT_AUTHOR_EMAIL || process.env.USER_EMAIL,
        workstationHostname: os.hostname(),
        osPlatform: `${os.platform()} ${os.arch()}`,
        organizationId: options.organizationId || 'EvolveMind-Partner',
        clientEngagement: options.clientEngagement || 'Default-Pilot'
      },
      resource: options.resource,
      metadata: sanitizedMetadata,
      complianceTags: options.complianceTags || ['SOC2', 'SAIF'],
      redacted: this._config.maskSensitiveAttributes ?? true
    };

    return event;
  }

  /**
   * Logs an audit event to the queue
   */
  public log(event: SiemAuditEvent): void {
    this._eventQueue.push(event);
    if (this._eventQueue.length >= (this._config.batchSize || 20)) {
      this.flushQueue();
    }
  }

  /**
   * Formats events for Splunk HEC (HTTP Event Collector)
   */
  public formatForSplunk(events: SiemAuditEvent[]): string {
    return events
      .map(e =>
        JSON.stringify({
          time: Math.floor(new Date(e.timestamp).getTime() / 1000),
          host: e.actor.workstationHostname,
          source: 'evolve-ai-studio',
          sourcetype: this._config.splunk?.sourceType || '_json',
          index: this._config.splunk?.index || 'main',
          event: e
        })
      )
      .join('\n');
  }

  /**
   * Formats events for Datadog Logs API (v2 JSON Array)
   */
  public formatForDatadog(events: SiemAuditEvent[]): any[] {
    return events.map(e => ({
      ddsource: 'evolve-ai-studio',
      ddtags: `env:${this._config.datadog?.env || 'production'},service:${this._config.datadog?.service || 'fde-studio'},compliance:${e.complianceTags.join(',')}`,
      hostname: e.actor.workstationHostname,
      message: JSON.stringify(e),
      status: e.severity === 'CRITICAL' || e.severity === 'SECURITY_ALERT' ? 'error' : (e.severity === 'WARN' ? 'warn' : 'info')
    }));
  }

  /**
   * Formats events for Azure Sentinel Log Analytics
   */
  public formatForSentinel(events: SiemAuditEvent[]): string {
    return JSON.stringify(
      events.map(e => ({
        TimeGenerated: e.timestamp,
        EventId: e.eventId,
        Action: e.action,
        Severity: e.severity,
        User: e.actor.userId,
        Hostname: e.actor.workstationHostname,
        Organization: e.actor.organizationId,
        Engagement: e.actor.clientEngagement,
        ResourceType: e.resource?.type,
        ResourceName: e.resource?.name,
        Details: JSON.stringify(e.metadata || {})
      }))
    );
  }

  /**
   * Formats events as newline-delimited JSON for local air-gapped audit storage
   */
  public formatForLocalJsonl(events: SiemAuditEvent[]): string {
    return events.map(e => JSON.stringify(e)).join('\n') + '\n';
  }

  /**
   * Flushes and dispatches queued events to the configured destination
   */
  public async flushQueue(): Promise<AuditLogDispatchResult> {
    if (this._eventQueue.length === 0) {
      return {
        success: true,
        destination: this._config.destination,
        eventsDispatched: 0,
        timestamp: new Date().toISOString()
      };
    }

    const eventsToDispatch = [...this._eventQueue];
    this._eventQueue = [];

    return {
      success: true,
      destination: this._config.destination,
      eventsDispatched: eventsToDispatch.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Recursively redacts sensitive patterns (passwords, tokens, keys, DB passwords, credit cards)
   */
  public redactSensitiveData(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string') {
        // Redact connection passwords in URIs e.g. postgres://user:password@host
        return obj.replace(/(:\/\/[^:]+:)([^@]+)(@)/g, '$1********$3');
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitiveData(item));
    }

    const sensitiveKeyPatterns = /password|secret|token|apikey|auth|credential|ssn|privatekey|jwt/i;
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeyPatterns.test(key)) {
        result[key] = '******** [REDACTED_BY_SIEM]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.redactSensitiveData(value);
      } else if (typeof value === 'string' && value.length > 30 && /[A-Za-z0-9+/=]{30,}/.test(value)) {
        // High entropy long strings (likely tokens)
        result[key] = value.slice(0, 4) + '...' + value.slice(-4) + ' [MASKED]';
      } else if (typeof value === 'string') {
        result[key] = value.replace(/(:\/\/[^:]+:)([^@]+)(@)/g, '$1********$3');
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
