import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  RepoQualityGatekeeper,
  QualityGateReport,
  QualityFinding
} from '../../../fde/codebaseGraph';

suite('FDE Suite — RepoQualityGatekeeper Pre-Push Pipeline Gate', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-quality-test-'));
  });

  teardown(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('1. SQL Validation: detects unbounded DELETE, unbalanced parens, and trailing commas', () => {
    const brokenSql = `
      -- Test broken SQL queries
      SELECT id, name,
      FROM users
      WHERE (active = 1;

      DELETE FROM orders;
    `;
    fs.writeFileSync(path.join(tempDir, 'broken.sql'), brokenSql, 'utf8');

    const report = RepoQualityGatekeeper.scan(tempDir, { includeTypeCheck: false });

    assert.strictEqual(report.pass, false);
    assert.strictEqual(report.verdict, 'BLOCKED');
    assert.ok(report.summary.blockers >= 2, `Expected at least 2 blockers, got ${report.summary.blockers}`);
    assert.ok(report.summary.sqlCount >= 2);

    const parensFinding = report.findings.find(f => f.matchedRule === 'QG_SQL_UNBALANCED_PARENS');
    assert.ok(parensFinding, 'Expected unbalanced parens finding');

    const deleteFinding = report.findings.find(f => f.matchedRule === 'QG_SQL_UNBOUNDED_MUTATION');
    assert.ok(deleteFinding, 'Expected unbounded DELETE finding');
  });

  test('2. Lint Analysis: detects debugger, eval, console.log, and loose equality', () => {
    const messyCode = `
      export function processPayment(amount: number) {
        console.log("Processing amount:", amount);
        debugger;
        if (amount == 0) {
          eval("alert('invalid')");
        }
        try {
          doRisky();
        } catch (e) {}
      }
    `;
    fs.writeFileSync(path.join(tempDir, 'payment.ts'), messyCode, 'utf8');

    const report = RepoQualityGatekeeper.scan(tempDir, { includeTypeCheck: false });

    assert.strictEqual(report.pass, false, 'Should be blocked due to debugger and eval');
    assert.strictEqual(report.verdict, 'BLOCKED');

    const debuggerFinding = report.findings.find(f => f.matchedRule === 'QG_LINT_NO_DEBUGGER');
    assert.ok(debuggerFinding, 'Expected debugger finding');
    assert.strictEqual(debuggerFinding?.severity, 'blocker');

    const evalFinding = report.findings.find(f => f.matchedRule === 'QG_LINT_NO_EVAL');
    assert.ok(evalFinding, 'Expected eval finding');
    assert.strictEqual(evalFinding?.severity, 'blocker');

    const consoleFinding = report.findings.find(f => f.matchedRule === 'QG_LINT_NO_CONSOLE_LOG');
    assert.ok(consoleFinding, 'Expected console.log finding');
    assert.strictEqual(consoleFinding?.severity, 'warning');

    const eqFinding = report.findings.find(f => f.matchedRule === 'QG_LINT_EQEQEQ');
    assert.ok(eqFinding, 'Expected loose equality finding');
  });

  test('3. Format & Hygiene: detects trailing whitespace, missing newline, and invalid JSON', () => {
    // File with trailing whitespace and no trailing newline
    const unformatted = 'function test() {   \n  return 42;\t\t';
    fs.writeFileSync(path.join(tempDir, 'format_test.ts'), unformatted, 'utf8');

    // Broken JSON file
    const badJson = '{\n  "name": "project",\n  "version": "1.0.0",\n}'; // trailing comma
    fs.writeFileSync(path.join(tempDir, 'package.json'), badJson, 'utf8');

    const report = RepoQualityGatekeeper.scan(tempDir, { includeTypeCheck: false });

    const wsFinding = report.findings.find(f => f.matchedRule === 'QG_FMT_TRAILING_WHITESPACE');
    assert.ok(wsFinding, 'Expected trailing whitespace finding');

    const eofFinding = report.findings.find(f => f.matchedRule === 'QG_FMT_EOF_NEWLINE');
    assert.ok(eofFinding, 'Expected missing EOF newline finding');

    const jsonFinding = report.findings.find(f => f.matchedRule === 'QG_FMT_JSON_INVALID');
    assert.ok(jsonFinding, 'Expected invalid JSON finding');
  });

  test('4. 1-Click Auto-Fix: successfully fixes whitespace, newlines, and debugger statements', () => {
    const fileToFix = 'function foo() {   \n  debugger;\n  return true;  ';
    const filePath = path.join(tempDir, 'fixable.ts');
    fs.writeFileSync(filePath, fileToFix, 'utf8');

    const sqlToFix = 'select id, name from users where active = 1';
    const sqlPath = path.join(tempDir, 'query.sql');
    fs.writeFileSync(sqlPath, sqlToFix, 'utf8');

    const fixRes = RepoQualityGatekeeper.applyQualityFix(tempDir, { action: 'fix_all_safe' });
    assert.strictEqual(fixRes.success, true);
    assert.ok(fixRes.filesModified.length >= 1);

    const fixedCode = fs.readFileSync(filePath, 'utf8');
    assert.ok(!fixedCode.includes('debugger;'), 'debugger; should be removed');
    assert.ok(!/[ \t]+$/m.test(fixedCode), 'trailing whitespace should be stripped');
    assert.ok(fixedCode.endsWith('\n'), 'EOF newline should be appended');

    const fixedSql = fs.readFileSync(sqlPath, 'utf8');
    assert.ok(fixedSql.includes('SELECT'), 'SQL keywords should be uppercased');
  });

  test('5. Pre-Push Hook Installer: creates .git/hooks/pre-push script', () => {
    // Create mock .git directory
    fs.mkdirSync(path.join(tempDir, '.git', 'hooks'), { recursive: true });

    assert.strictEqual(RepoQualityGatekeeper.checkPrePushHookInstalled(tempDir), false);

    const installRes = RepoQualityGatekeeper.installPrePushHook(tempDir);
    assert.strictEqual(installRes.success, true);
    assert.ok(fs.existsSync(installRes.hookPath));

    assert.strictEqual(RepoQualityGatekeeper.checkPrePushHookInstalled(tempDir), true);
  });

  test('6. Report Generators: produce valid Markdown and HTML reports', () => {
    const report: QualityGateReport = {
      timestamp: Date.now(),
      repoPath: tempDir,
      score: 85,
      verdict: 'WARNING',
      pass: true,
      scannedFilesCount: 12,
      scanDurationMs: 45,
      prePushHookInstalled: true,
      summary: {
        total: 2,
        active: 2,
        ignored: 0,
        blockers: 0,
        warnings: 2,
        info: 0,
        fixableCount: 1,
        sqlCount: 1,
        lintCount: 1,
        formatCount: 0,
        typecheckCount: 0,
        infraCount: 0
      },
      findings: [
        {
          id: 'TEST-01',
          file: 'src/query.sql',
          line: 10,
          severity: 'warning',
          category: 'sql',
          title: 'Wildcard SELECT',
          description: 'SELECT * detected',
          matchedRule: 'QG_SQL_WILDCARD_SELECT',
          remediation: 'Specify explicit column names',
          fixable: false
        }
      ]
    };

    const md = RepoQualityGatekeeper.generateQualityReportMarkdown(report);
    assert.ok(md.includes('Quality Gatekeeper Report'));
    assert.ok(md.includes('src/query.sql'));

    const html = RepoQualityGatekeeper.generateQualityReportHtml(report);
    assert.ok(html.includes('Quality Gatekeeper Report'));
    assert.ok(html.includes('<!DOCTYPE html>'));
  });
});
