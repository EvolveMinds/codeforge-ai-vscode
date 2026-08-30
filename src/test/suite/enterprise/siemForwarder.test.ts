import * as assert from 'assert';
import { SiemAuditForwarder } from '../../../enterprise';

suite('Enterprise Suite — SIEM & Compliance Audit Forwarder', () => {
  test('creates structured audit event with automatic redaction of sensitive credentials', () => {
    const forwarder = new SiemAuditForwarder({
      enabled: true,
      destination: 'splunk',
      maskSensitiveAttributes: true
    });

    const event = forwarder.createEvent('DB_INTROSPECTION_EXECUTED', 'INFO', {
      clientEngagement: 'Acme Health Pilot',
      organizationId: 'Acme-Corp',
      resource: {
        type: 'DATABASE_TABLE',
        name: 'patients_records',
        databaseDialect: 'postgres'
      },
      metadata: {
        connectionUri: 'postgres://fde_admin:superSecretPassword123@db.internal:5432/health_db',
        apiSecretKey: 'sk-prod-99887766554433221100aabbccddeeff',
        queriedColumns: ['id', 'patient_name', 'dob', 'diagnosis']
      },
      complianceTags: ['HIPAA', 'SOC2']
    });

    assert.strictEqual(event.action, 'DB_INTROSPECTION_EXECUTED');
    assert.strictEqual(event.severity, 'INFO');
    assert.strictEqual(event.actor.clientEngagement, 'Acme Health Pilot');
    assert.strictEqual(event.actor.organizationId, 'Acme-Corp');
    assert.deepStrictEqual(event.complianceTags, ['HIPAA', 'SOC2']);
    assert.strictEqual(event.redacted, true);

    // Verify URI password was redacted
    assert.strictEqual(
      event.metadata?.connectionUri.includes('superSecretPassword123'),
      false,
      'Database password should be redacted in URI'
    );

    // Verify API secret key was redacted
    assert.strictEqual(
      event.metadata?.apiSecretKey.includes('[REDACTED_BY_SIEM]'),
      true,
      'API secret key should be masked'
    );
  });

  test('formats events properly for Splunk, Datadog, Sentinel, and Local JSONL', () => {
    const forwarder = new SiemAuditForwarder({
      enabled: true,
      destination: 'splunk',
      splunk: {
        endpoint: 'https://splunk.internal:8088/services/collector/raw',
        token: 'splunk-hec-token-123',
        index: 'security_audit',
        sourceType: '_json'
      }
    });

    const event = forwarder.createEvent('DEPLOYMENT_EXECUTED', 'WARN', {
      clientEngagement: 'Global FinTech PoC',
      resource: {
        type: 'CLOUD_DEPLOYMENT',
        name: 'k8s_deployment_pilot',
        cloudProvider: 'aws'
      }
    });

    // 1. Splunk
    const splunkOutput = forwarder.formatForSplunk([event]);
    assert.strictEqual(splunkOutput.includes('"index":"security_audit"'), true);
    assert.strictEqual(splunkOutput.includes('"source":"evolve-ai-studio"'), true);

    // 2. Datadog
    const datadogOutput = forwarder.formatForDatadog([event]);
    assert.strictEqual(Array.isArray(datadogOutput), true);
    assert.strictEqual(datadogOutput[0].ddsource, 'evolve-ai-studio');
    assert.strictEqual(datadogOutput[0].status, 'warn');

    // 3. Sentinel
    const sentinelOutput = forwarder.formatForSentinel([event]);
    assert.strictEqual(sentinelOutput.includes('TimeGenerated'), true);
    assert.strictEqual(sentinelOutput.includes('DEPLOYMENT_EXECUTED'), true);

    // 4. Local JSONL
    const jsonlOutput = forwarder.formatForLocalJsonl([event]);
    assert.strictEqual(jsonlOutput.endsWith('\n'), true);
    const parsed = JSON.parse(jsonlOutput.trim());
    assert.strictEqual(parsed.action, 'DEPLOYMENT_EXECUTED');
  });
});
