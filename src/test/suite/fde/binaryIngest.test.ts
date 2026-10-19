import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BinaryIngestionEngine } from '../../../core/binaryIngest';
import { detectSourceLanguage, languageById } from '../../../core/codeConvert';
import { EvidenceLedger } from '../../../fde/provenance';

suite('FDE Suite — BinaryIngest & Legacy Modernization', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-bin-test-'));
  });

  teardown(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('recognizes binary and bytecode file extensions', () => {
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('LegacyBilling.dll'), true);
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('App.exe'), true);
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('OrderService.class'), true);
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('enterprise-core.jar'), true);
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('crypto.wasm'), true);
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('legacy.il'), true);
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('script.py'), false);
    assert.strictEqual(BinaryIngestionEngine.isBinaryArtifact('main.go'), false);
  });

  test('detects source language IDs in codeConvert catalog', () => {
    assert.strictEqual(detectSourceLanguage('PaymentGateway.dll'), 'dotnet-cil');
    assert.strictEqual(detectSourceLanguage('LegacyApp.exe'), 'dotnet-cil');
    assert.strictEqual(detectSourceLanguage('AccountRecord.class'), 'jvm-bytecode');
    assert.strictEqual(detectSourceLanguage('engine.wasm'), 'wasm-binary');

    const cilSpec = languageById('dotnet-cil');
    assert.ok(cilSpec);
    assert.strictEqual(cilSpec.group, 'Legacy');
    assert.strictEqual(cilSpec.fence, 'cil');

    const jvmSpec = languageById('jvm-bytecode');
    assert.ok(jvmSpec);
    assert.strictEqual(jvmSpec.group, 'JVM');
  });

  test('ingests .NET assembly and records verifiable evidence in ledger', async () => {
    const ledger = new EvidenceLedger();
    const fakeDllPath = path.join(tmpDir, 'BillingService.dll');

    // Create a mock PE binary containing CLI metadata strings
    const header = Buffer.from([0x4D, 0x5A, 0x90, 0x00]); // MZ
    const metadataString = Buffer.from('BillingManager\0InvoiceProcessor\0CalculateGst\0ProcessPayment\0Assembly.Load\0');
    const fakeDll = Buffer.concat([header, Buffer.alloc(100), metadataString, Buffer.alloc(100)]);
    fs.writeFileSync(fakeDllPath, fakeDll);

    const result = await BinaryIngestionEngine.ingestArtifact(fakeDllPath, ledger);

    assert.strictEqual(result.metadata.type, 'dotnet_assembly');
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].relPath, 'BillingService.cs');
    assert.strictEqual(result.files[0].langId, 'csharp');
    assert.ok(result.files[0].content.includes('BillingManager'));
    assert.ok(result.files[0].content.includes('InvoiceProcessor'));

    // Check evidence was recorded
    const evidence = ledger.getAll();
    assert.ok(evidence.length >= 1);
    assert.strictEqual(evidence[0].kind, 'decompiled_artifact');
    assert.strictEqual(evidence[0].confidence, 'exact');

    // Check reflection unknown was detected and recorded
    const unknowns = ledger.getUnknowns();
    assert.ok(unknowns.some(u => u.target.includes('Dynamic Reflection Resolution')));
  });

  test('ingests Java .class bytecode with 0xCAFEBABE header', async () => {
    const ledger = new EvidenceLedger();
    const classPath = path.join(tmpDir, 'OrderHandler.class');

    // Construct valid minimal Java class file header
    const magic = Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]); // Magic
    const minor = Buffer.from([0x00, 0x00]);
    const major = Buffer.from([0x00, 0x3D]); // Java 17 (major 61 = 0x3D)
    const cpCount = Buffer.from([0x00, 0x03]); // 2 entries

    // Entry 1: CONSTANT_Utf8 (tag 1) length 12: "handleOrder"
    const utf8Tag = Buffer.from([0x01]);
    const strBytes = Buffer.from('handleOrder');
    const strLen = Buffer.alloc(2);
    strLen.writeUInt16BE(strBytes.length, 0);

    const fakeClass = Buffer.concat([magic, minor, major, cpCount, utf8Tag, strLen, strBytes, Buffer.alloc(50)]);
    fs.writeFileSync(classPath, fakeClass);

    const result = await BinaryIngestionEngine.ingestArtifact(classPath, ledger);

    assert.strictEqual(result.metadata.type, 'jvm_class');
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].relPath, 'OrderHandler.java');
    assert.strictEqual(result.files[0].langId, 'java');
    assert.ok(result.files[0].content.includes('public class OrderHandler'));
    assert.ok(result.files[0].content.includes('handleOrder'));

    assert.ok(ledger.getAll().some(e => e.sourceUri.includes('OrderHandler')));
  });

  test('ingests WebAssembly binary module', async () => {
    const ledger = new EvidenceLedger();
    const wasmPath = path.join(tmpDir, 'calc.wasm');

    const magic = Buffer.from([0x00, 0x61, 0x73, 0x6D]); // \0asm
    const version = Buffer.from([0x01, 0x00, 0x00, 0x00]); // version 1
    fs.writeFileSync(wasmPath, Buffer.concat([magic, version]));

    const result = await BinaryIngestionEngine.ingestArtifact(wasmPath, ledger);

    assert.strictEqual(result.metadata.type, 'wasm_module');
    assert.strictEqual(result.files[0].relPath, 'calc.wat');
    assert.strictEqual(result.files[0].langId, 'wasm');
    assert.ok(result.files[0].content.includes('(module'));
    assert.ok(result.files[0].content.includes('calc_init'));
  });

  test('ingests Electron ASAR package and recovers JS modules', async () => {
    const ledger = new EvidenceLedger();
    const asarPath = path.join(tmpDir, 'app.asar');

    const fileContent = 'module.exports = { run: () => 42 };';
    const jsonHeader = {
      files: {
        'index.js': {
          size: Buffer.byteLength(fileContent),
          offset: '0'
        }
      }
    };

    const jsonBuf = Buffer.from(JSON.stringify(jsonHeader), 'utf8');
    const headerBuf = Buffer.alloc(16);
    headerBuf.writeUInt32LE(4, 0); // size of size
    headerBuf.writeUInt32LE(jsonBuf.length + 8, 4); // header size
    headerBuf.writeUInt32LE(jsonBuf.length + 4, 8); // meta size
    headerBuf.writeUInt32LE(jsonBuf.length, 12); // json size

    const contentBuf = Buffer.from(fileContent, 'utf8');
    const fullAsar = Buffer.concat([headerBuf, jsonBuf, contentBuf]);
    fs.writeFileSync(asarPath, fullAsar);

    const result = await BinaryIngestionEngine.ingestArtifact(asarPath, ledger);

    assert.strictEqual(result.metadata.type, 'electron_asar');
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].relPath, 'index.js');
    assert.strictEqual(result.files[0].content, fileContent);
    assert.ok(ledger.getAll().some(e => e.summary.includes('Electron ASAR archive')));
  });
});
