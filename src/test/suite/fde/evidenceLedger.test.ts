import * as assert from 'assert';
import { EvidenceLedger } from '../../../fde/provenance';

suite('FDE Suite — EvidenceLedger & Zero-Hallucination Grounding', () => {
  test('records and deduplicates verifiable evidence records', () => {
    const ledger = new EvidenceLedger();

    const rec1 = ledger.record({
      kind: 'decompiled_artifact',
      confidence: 'exact',
      sourceUri: 'AcmeBilling.dll#Services.InvoiceProcessor',
      span: { symbol: 'CalculateTax', startLine: 42 },
      summary: 'Extracts 10% GST calculation formula from IL instructions',
      rawProof: 'ldc.r8 0.1; mul; ret;'
    });

    assert.ok(rec1.id.startsWith('ev_'));
    assert.strictEqual(ledger.getAll().length, 1);

    // Recording identical proof returns the same record without duplicating
    const rec2 = ledger.record({
      kind: 'decompiled_artifact',
      confidence: 'exact',
      sourceUri: 'AcmeBilling.dll#Services.InvoiceProcessor',
      span: { symbol: 'CalculateTax', startLine: 42 },
      summary: 'Extracts 10% GST calculation formula from IL instructions',
      rawProof: 'ldc.r8 0.1; mul; ret;'
    });

    assert.strictEqual(rec1.id, rec2.id);
    assert.strictEqual(ledger.getAll().length, 1);
  });

  test('tracks unresolved unknowns and detects blocking issues', () => {
    const ledger = new EvidenceLedger();

    assert.strictEqual(ledger.hasBlockingUnknowns(), false);

    ledger.recordUnknown({
      target: 'Reflection invocation in Assembly.Load()',
      reason: 'Target DLL name is constructed from dynamic configuration',
      severity: 'warning',
      remediation: 'Provide static config map or run dynamic trace'
    });

    assert.strictEqual(ledger.hasBlockingUnknowns(), false);
    assert.strictEqual(ledger.getUnknowns().length, 1);

    ledger.recordUnknown({
      target: 'Unmapped native pointer offset 0x48',
      reason: 'Memory layout depends on unverified C ABI alignment',
      severity: 'blocking',
      remediation: 'Run test suite against native header or inspect via debugger'
    });

    assert.strictEqual(ledger.hasBlockingUnknowns(), true);
    assert.strictEqual(ledger.getBlockingUnknowns().length, 1);
  });

  test('exports audit manifest with cryptographic digest and renders markdown', () => {
    const ledger = new EvidenceLedger();

    ledger.record({
      kind: 'schema_introspection',
      confidence: 'exact',
      sourceUri: 'postgresql://prod-db/orders',
      summary: 'Primary key order_id is UUID v4',
      rawProof: 'CONSTRAINT pk_orders PRIMARY KEY (order_id)'
    });

    ledger.recordUnknown({
      target: 'Partitioning scheme',
      reason: 'pg_partitions catalog query not executed',
      severity: 'informational',
      remediation: 'Run SELECT * FROM pg_partitions in live mode'
    });

    const manifest = ledger.exportManifest();
    assert.strictEqual(manifest.recordsCount, 1);
    assert.strictEqual(manifest.unknownsCount, 1);
    assert.strictEqual(manifest.blockingUnknownsCount, 0);
    assert.ok(manifest.digest.startsWith('sha_'));

    const md = ledger.renderMarkdownAudit();
    assert.ok(md.includes('Verifiable Grounding & Evidence Ledger'));
    assert.ok(md.includes('Total Verified Claims'));
    assert.ok(md.includes('Unresolved Unknowns'));
    assert.ok(md.includes('postgresql://prod-db/orders'));
    assert.ok(md.includes('Partitioning scheme'));
  });
});
