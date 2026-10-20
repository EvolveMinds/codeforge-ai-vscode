import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PreflightAuditor } from '../../../deployment/preflightAuditor';

suite('FDE Suite — PreflightAuditor', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-fde-audit-'));
  });

  teardown(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* skip */ }
  });

  test('scans and cleans dangling backup/temp files', () => {
    // Create test dummy files
    fs.writeFileSync(path.join(tempDir, 'app.ts'), 'console.log("main");', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'app.ts.bak'), 'console.log("bak");', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'schema_OLD.sql'), 'SELECT 1;', 'utf8');

    const report = PreflightAuditor.scanWorkspace(tempDir);

    assert.strictEqual(report.temporaryFiles.length, 2);
    assert.ok(report.findings.some(f => f.code === 'PRE-TEMP-01'));

    const cleanRes = PreflightAuditor.cleanTemporaryFiles(report.temporaryFiles);
    assert.strictEqual(cleanRes.cleaned, 2);

    const reReport = PreflightAuditor.scanWorkspace(tempDir);
    assert.strictEqual(reReport.temporaryFiles.length, 0);
  });

  test('detects missing environment variables against .env.example', () => {
    fs.writeFileSync(path.join(tempDir, '.env.example'), 'API_KEY=\nDATABASE_URL=\nPORT=3000\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, '.env.production'), 'API_KEY=xyz\n', 'utf8');

    const report = PreflightAuditor.scanWorkspace(tempDir);

    assert.strictEqual(report.environmentSummary.exampleKeysCount, 3);
    assert.ok(report.environmentSummary.missingProdKeys.includes('DATABASE_URL'));
    assert.ok(report.environmentSummary.missingProdKeys.includes('PORT'));
    assert.ok(report.findings.some(f => f.code === 'PRE-ENV-01'));
  });

  test('detects forbidden DB2 DDL mutation when untouched DB2 contract is mandated', () => {
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Target\nUNTOUCHED & ZERO DDL MUTATION\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'migration_v2.sql'), 'ALTER TABLE DB2_HCM_EMP_MASTER ADD COLUMN SALARY_NEW DECIMAL(15,2);', 'utf8');

    const report = PreflightAuditor.scanWorkspace(tempDir);
    assert.strictEqual(report.pass, false);
    assert.ok(report.findings.some(f => f.code === 'PRE-DB2-MUTATION'));
  });
});
