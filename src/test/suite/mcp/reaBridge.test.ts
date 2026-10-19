import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CompactSchemaProfile } from '../../../mcp/compactSchema';
import { ReaMcpBridge } from '../../../mcp/reaBridge';
import { EvidenceLedger } from '../../../fde/provenance';

suite('MCP Suite — REA Bridge & Compact Schema Profile', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-mcp-test-'));
  });

  teardown(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('CompactSchemaProfile compresses bloated tool schemas to sub-13KB budget', () => {
    // Generate an artificially bloated tool definition (25 KB+)
    const giantProperties: Record<string, any> = {};
    for (let i = 0; i < 60; i++) {
      giantProperties[`field_${i}`] = {
        type: 'string',
        title: `Verbose Title For Field ${i}`,
        description: `This is a very long documentation string explaining in excessive detail why field_${i} is required for telemetry, billing, enterprise security, and audit compliance across all client environments.`,
        examples: [`example_val_${i}`, `fallback_val_${i}`],
        pattern: '^[a-zA-Z0-9_-]+$',
        $schema: 'http://json-schema.org/draft-07/schema#'
      };
    }

    const bloatedTool = {
      name: 'giant_enterprise_tool',
      description: 'A heavily bloated enterprise tool designed to test the Compact Schema Profile compressor under adversarial conditions.',
      inputSchema: {
        type: 'object' as const,
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'BloatedRootSchema',
        properties: giantProperties,
        required: ['field_0', 'field_1']
      }
    };

    const initialSize = Buffer.byteLength(JSON.stringify(bloatedTool), 'utf8');
    assert.ok(initialSize > 15000, `Expected initial size to exceed 15 KB, got ${initialSize} bytes`);

    const compressed = CompactSchemaProfile.compressTool(bloatedTool, 12 * 1024);
    const compressedSize = Buffer.byteLength(JSON.stringify(compressed), 'utf8');

    assert.ok(compressedSize <= 12 * 1024, `Expected compressed size <= 12288 bytes, got ${compressedSize} bytes`);
    assert.strictEqual(compressed.inputSchema.required?.length, 2);
    assert.strictEqual(compressed.name, 'giant_enterprise_tool');
    assert.strictEqual(compressed.inputSchema.title, undefined);
    assert.strictEqual(compressed.inputSchema.properties?.field_0?.examples, undefined);
  });

  test('all REA MCP tools pass Compact Schema budget (<12 KB each)', () => {
    const tools = ReaMcpBridge.getTools();
    assert.ok(tools.length >= 4);

    const audit = CompactSchemaProfile.auditBudget(tools, 12 * 1024);
    assert.strictEqual(audit.valid, true, `Tools exceeded budget: ${audit.oversizedTools.join(', ')}`);
    assert.strictEqual(audit.oversizedTools.length, 0);

    for (const tool of tools) {
      const size = audit.toolSizes[tool.name];
      assert.ok(size > 0 && size < 12 * 1024, `Tool ${tool.name} size ${size} bytes`);
    }
  });

  test('rea_analyze_binary disassembles mock .NET PE assembly and anchors proof', async () => {
    const ledger = new EvidenceLedger();
    const fakeDllPath = path.join(tmpDir, 'BillingModule.dll');

    // Minimal mock PE file with CLI type tokens
    const header = Buffer.from([0x4D, 0x5A, 0x90, 0x00]); // MZ
    const typeTokens = Buffer.from('PaymentProcessor\0AccountRepository\0InvoiceService\0');
    fs.writeFileSync(fakeDllPath, Buffer.concat([header, Buffer.alloc(50), typeTokens, Buffer.alloc(50)]));

    const result = await ReaMcpBridge.handleToolCall(
      'rea_analyze_binary',
      { filePath: fakeDllPath },
      ledger
    );

    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(result.content.length, 1);

    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.status, 'SUCCESS');
    assert.strictEqual(parsed.artifact, 'BillingModule.dll');
    assert.strictEqual(parsed.type, 'dotnet_assembly');
    assert.ok(parsed.extractedModules.includes('PaymentProcessor'));
    assert.ok(parsed.extractedModules.includes('AccountRepository'));

    const evidence = ledger.getAll();
    assert.ok(evidence.some(e => e.kind === 'decompiled_artifact' && e.rawProof?.includes('PaymentProcessor')));
  });

  test('rea_introspect_application extracts databases, routes, and IPC channels', async () => {
    const ledger = new EvidenceLedger();
    const appDir = path.join(tmpDir, 'client-app');
    fs.mkdirSync(appDir, { recursive: true });

    // Mock Express router & database query
    fs.writeFileSync(path.join(appDir, 'routes.ts'), `
      app.get('/api/v1/customers', (req, res) => res.json([]));
      app.post('/api/v1/customers/register', (req, res) => res.json({}));
      const dbUrl = 'postgres://dbuser:pass123@db.cloud.internal:5432/crm_prod';
      db.query('SELECT customer_id, company_name, email FROM clients');
    `);

    // Mock Electron IPC
    fs.writeFileSync(path.join(appDir, 'preload.ts'), `
      ipcRenderer.send('sync-offline-cache');
    `);

    const result = await ReaMcpBridge.handleToolCall(
      'rea_introspect_application',
      { targetPath: appDir, appName: 'CrmEnterprise' },
      ledger
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);

    assert.strictEqual(parsed.status, 'SUCCESS');
    assert.strictEqual(parsed.appName, 'CrmEnterprise');
    assert.ok(parsed.discoveredDatabasesCount >= 1);
    assert.ok(parsed.discoveredTablesCount >= 1);
    assert.ok(parsed.discoveredRoutesCount >= 2);
    assert.ok(parsed.discoveredIpcChannelsCount >= 1);
    assert.ok(parsed.architectureBlueprintPreview.includes('System Architecture & Integration Blueprint'));
  });

  test('rea_generate_dbt_models creates staging models and sources.yml', async () => {
    const result = await ReaMcpBridge.handleToolCall('rea_generate_dbt_models', {
      sourceName: 'erp_raw',
      tables: [
        { name: 'general_ledger', columns: ['entry_id', 'account_code', 'debit_amount', 'entry_date'] }
      ]
    });

    assert.strictEqual(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);

    assert.strictEqual(parsed.status, 'SUCCESS');
    assert.strictEqual(parsed.generatedModelsCount, 1);
    assert.ok(parsed.models[0].path.includes('stg_erp_raw__general_ledger.sql'));
    assert.ok(parsed.models[0].sql.includes("source('erp_raw', 'general_ledger')"));
    assert.ok(parsed.sourcesYaml.includes('name: erp_raw'));
  });

  test('rea_verify_evidence audits ledger manifest and checks Zero-Hallucination status', async () => {
    const ledger = new EvidenceLedger();
    ledger.record({
      kind: 'decompiled_artifact',
      confidence: 'exact',
      sourceUri: 'LegacyCore.dll#TypeCatalog',
      summary: 'Verified 42 class definitions via CLI metadata streams',
      rawProof: '0x0020_TypeDef'
    });

    ledger.recordUnknown({
      target: 'Dynamic Plugin Loader',
      reason: 'Reflection via Assembly.Load requires runtime trace',
      severity: 'warning',
      remediation: 'Attach live trace agent'
    });

    const result = await ReaMcpBridge.handleToolCall('rea_verify_evidence', {}, ledger);
    assert.strictEqual(result.isError, undefined);

    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.status, 'SUCCESS');
    assert.strictEqual(parsed.verifiedRecordsCount, 1);
    assert.strictEqual(parsed.unknownsCount, 1);
    assert.strictEqual(parsed.blockingUnknownsCount, 0);
    assert.strictEqual(parsed.isZeroHallucinationProven, true);
    assert.ok(parsed.auditDigest.startsWith('sha_'));
  });
});
