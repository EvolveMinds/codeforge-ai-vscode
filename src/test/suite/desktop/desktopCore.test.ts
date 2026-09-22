/**
 * Test Suite: Evolve AI Enterprise Desktop Edition Core Engine
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DesktopWorkspaceManager } from '../../../desktop/main/workspaceManager';
import { DesktopTerminalManager } from '../../../desktop/main/terminalManager';
import { DesktopLicenseAuth } from '../../../desktop/main/licenseAuth';
import { DesktopSecretVault } from '../../../desktop/main/secretVault';
import { DesktopUpdater } from '../../../desktop/main/updater';
import { getAppVersion, _setAppVersionForTests } from '../../../desktop/shared/appVersion';
import { DesktopIpcHandlers } from '../../../desktop/main/ipcHandlers';
import { DESKTOP_CHANNELS } from '../../../desktop/shared/eventChannels';

suite('Enterprise Desktop Edition — Core Architecture & Subsystems', function () {
  this.timeout(20000);
  const tmpDir = path.join(os.tmpdir(), 'evolve-desktop-test-' + Math.random().toString(36).substring(2, 8));

  suiteSetup(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  suiteTeardown(async () => {
    await new Promise(r => setTimeout(r, 600));
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('DesktopWorkspaceManager initializes, builds file tree, and writes/reads files', () => {
    const wsMgr = new DesktopWorkspaceManager(tmpDir);

    // Setup sample directory structure
    const sampleWs = path.join(tmpDir, 'client-engagement-pilot');
    fs.mkdirSync(path.join(sampleWs, 'models', 'staging'), { recursive: true });
    fs.writeFileSync(path.join(sampleWs, 'models', 'staging', 'stg_orders.sql'), 'SELECT * FROM raw_orders;', 'utf8');
    fs.writeFileSync(path.join(sampleWs, 'package.json'), '{"name": "pilot"}', 'utf8');

    // 1. Set current workspace
    const ws = wsMgr.setCurrentWorkspace(sampleWs);
    assert.strictEqual(ws.name, 'client-engagement-pilot');
    assert.strictEqual(ws.isGitRepo, false);

    // 2. Build file tree
    const tree = wsMgr.getFileTree(sampleWs);
    assert.strictEqual(tree.isDirectory, true);
    assert.ok(tree.children && tree.children.length >= 2, 'Should list top-level directories and files');

    // 3. Read file
    const fileRes = wsMgr.readFile('models/staging/stg_orders.sql');
    assert.strictEqual(fileRes.language, 'sql');
    assert.strictEqual(fileRes.content, 'SELECT * FROM raw_orders;');

    // 4. Write new file
    const saveRes = wsMgr.writeFile('docs/ARCHITECTURE.md', '# Architecture Runbook');
    assert.strictEqual(saveRes.success, true);
    assert.ok(fs.existsSync(path.join(sampleWs, 'docs', 'ARCHITECTURE.md')));

    // 5. Recent workspaces
    const recent = wsMgr.getRecentWorkspaces();
    assert.ok(recent.some(r => r.path === sampleWs));

    wsMgr.dispose();
  });

  test('DesktopTerminalManager detects shells, spawns sessions, and captures output', (done) => {
    const termMgr = new DesktopTerminalManager();
    const shells = termMgr.getAvailableShells();
    assert.ok(shells.length > 0, 'Should detect at least one shell');

    const defaultShell = termMgr.getDefaultShell();
    assert.ok(typeof defaultShell === 'string' && defaultShell.length > 0);

    const session = termMgr.spawnSession({ name: 'Test Shell' });
    assert.ok(session.id.startsWith('term_'));
    assert.strictEqual(session.active, true);

    const list = termMgr.listSessions();
    assert.strictEqual(list.length, 1);

    termMgr.killSession(session.id);
    termMgr.dispose();
    done();
  });

  test('DesktopLicenseAuth computes hardware fingerprint and generates offline challenge', () => {
    const licAuth = new DesktopLicenseAuth(tmpDir);

    // 1. Hardware fingerprint
    const hw = licAuth.getHardwareFingerprint();
    assert.ok(hw.machineFingerprint.startsWith('sha256:'));
    assert.ok(hw.hostname.length > 0);
    assert.ok(hw.platform.length > 0);

    // 2. Offline activation challenge
    const challenge = licAuth.generateOfflineChallenge('alex.turner@acme.com', 'Acme Financial Corp');
    assert.ok(challenge.challengeId.startsWith('REQ-'));
    assert.strictEqual(challenge.userId, 'alex.turner@acme.com');
    assert.strictEqual(challenge.organization, 'Acme Financial Corp');
    assert.strictEqual(challenge.machineFingerprint, hw.machineFingerprint);

    // 3. User profile
    const profile = licAuth.saveProfile({
      email: 'lead.fde@evolve.com',
      organization: 'Evolve Mind Solutions',
      role: 'Principal FDE'
    });
    assert.strictEqual(profile.email, 'lead.fde@evolve.com');
    assert.strictEqual(profile.organization, 'Evolve Mind Solutions');

    const retrieved = licAuth.getProfile();
    assert.strictEqual(retrieved.role, 'Principal FDE');
  });

  test('DesktopSecretVault encrypts and decrypts credentials with machine entropy', () => {
    const vault = new DesktopSecretVault(tmpDir);

    // 1. Store secret
    vault.setSecret('db_postgres_pass', 'SuperSecretP@ssword!2026');
    vault.setSecret('salesforce_api_token', 'sf_live_token_abc987');

    // 2. Retrieve secret
    const pass = vault.getSecret('db_postgres_pass');
    const token = vault.getSecret('salesforce_api_token');
    assert.strictEqual(pass, 'SuperSecretP@ssword!2026');
    assert.strictEqual(token, 'sf_live_token_abc987');

    // 3. Non-existent secret
    assert.strictEqual(vault.getSecret('unknown_key'), null);

    // 4. List keys & delete
    const keys = vault.listKeys();
    assert.ok(keys.includes('db_postgres_pass'));
    assert.ok(keys.includes('salesforce_api_token'));

    const deleted = vault.deleteSecret('db_postgres_pass');
    assert.strictEqual(deleted, true);
    assert.strictEqual(vault.getSecret('db_postgres_pass'), null);
  });

  test('app version never reports the Electron runtime version as our own', () => {
    // Regression guard for a real bug: running the desktop entry directly
    //   npx electron <path>/out/desktop/main/main.js
    // made the app display "v44.4.3" — an Electron release number. Electron's
    // app.getVersion() does not fail when the app has no version of its own; it
    // silently returns Electron's version, and main.ts trusted it first.
    //
    // getAppVersion() must read package.json itself and, failing that, return
    // the obvious '0.0.0' sentinel rather than anything that looks like a real
    // release.
    const pkgVersion = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8')
    ).version;

    _setAppVersionForTests(null);
    const resolved = getAppVersion();

    assert.strictEqual(resolved, pkgVersion, 'getAppVersion() must resolve from package.json');
    assert.notStrictEqual(
      resolved,
      process.versions.electron,
      'app version must never equal the Electron runtime version'
    );
    // Electron majors are far ahead of ours; a leak shows up as an implausible major.
    assert.ok(
      Number(resolved.split('.')[0]) < 40,
      `implausible major version ${resolved} — likely an Electron version leaking through`
    );
  });

  test('DesktopUpdater checks updates and handles offline patch simulation', async () => {
    const updater = new DesktopUpdater(tmpDir);

    // Assert against package.json rather than a literal: the updater's whole
    // job is to report the version it was built at, so pinning a number here
    // means every release bump breaks the test for the wrong reason.
    const expectedVersion = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8')
    ).version;

    const checkRes = await updater.checkForUpdates();
    assert.strictEqual(checkRes.currentVersion, expectedVersion);

    // Test Air-Gapped / Intranet Enclave fallback handling
    process.env.EVOLVE_UPDATE_URL = 'http://127.0.0.1:59999/nonexistent-airgap';
    try {
      const offlineRes = await updater.checkForUpdates();
      assert.strictEqual(offlineRes.currentVersion, expectedVersion);
      assert.strictEqual(offlineRes.isAirGapped, true);
      assert.strictEqual(offlineRes.networkStatus, 'offline');
      assert.ok(offlineRes.statusMessage?.includes('Air-gapped / Intranet'));
    } finally {
      delete process.env.EVOLVE_UPDATE_URL;
    }

    const patchFile = path.join(tmpDir, 'test-patch.zip');
    fs.writeFileSync(patchFile, 'EVOLVE_PATCH_BINARY_DATA', 'utf8');

    const patchRes = updater.applyOfflinePatch(patchFile);
    assert.strictEqual(patchRes.success, true);
    assert.ok(patchRes.patchedVersion.includes(`${expectedVersion}-patch-`));
    assert.ok(patchRes.enginesReloaded.includes('SqlTranspiler'));
  });

  test('DesktopIpcHandlers registers and executes all IPC channel handlers', async function () {
    this.timeout(30000);
    const wsMgr = new DesktopWorkspaceManager(tmpDir);
    wsMgr.setCurrentWorkspace(tmpDir);
    const termMgr = new DesktopTerminalManager();
    const licAuth = new DesktopLicenseAuth(tmpDir);
    const secretVault = new DesktopSecretVault(tmpDir);
    const updater = new DesktopUpdater(tmpDir);

    const handlers = new DesktopIpcHandlers({
      workspaceMgr: wsMgr,
      terminalMgr: termMgr,
      licenseAuth: licAuth,
      secretVault: secretVault,
      updater: updater
    });

    // Mock ipcMain dispatcher
    const registeredChannels = new Map<string, Function>();
    const mockIpcMain = {
      handle: (channel: string, listener: Function) => {
        registeredChannels.set(channel, listener);
      }
    };

    handlers.registerAll(mockIpcMain);

    // Verify key channel registrations
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.WORKSPACE.GET_CURRENT));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.TERMINAL.SPAWN));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.HARDWARE.INSPECT));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.CONVERTER.CONVERT));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.GIT.INSPECT));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.CLOUD.TEST_CONNECTION));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.LICENSE.GET_STATE));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.VAULT.GET_SECRET));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.TRANSPILE_SQL));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.PII_MASKING));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.REVERSE_ETL));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.RLS_POLICIES));

    // Test invoking Hardware Inspection IPC handler
    const hwFn = registeredChannels.get(DESKTOP_CHANNELS.HARDWARE.INSPECT)!;
    const hwRes = await hwFn(null);
    assert.ok(hwRes.profile !== undefined);
    assert.ok(typeof hwRes.profile.ramGb === 'number');

    // Test invoking Polyglot Code Converter IPC handler
    const convFn = registeredChannels.get(DESKTOP_CHANNELS.CONVERTER.CONVERT)!;
    const convRes = await convFn(null, {
      sourceCode: 'def process_item(val):\n    print(val)',
      fromLang: 'python',
      toLang: 'typescript'
    });
    assert.ok(convRes.convertedCode.includes('process_item') || convRes.convertedCode.includes('processItem'), 'Must contain function identifier');

    // Test invoking Code Converter IPC handler for Python -> SAS
    const sasConvRes = await convFn(null, {
      sourceCode: 'def calculate_metrics(data):\n    result = []\n    for item in data:\n        result.append(item["value"] * 2)\n    return result',
      fromLang: 'python',
      toLang: 'sas'
    });
    assert.strictEqual(sasConvRes.targetLang, 'SAS');
    assert.strictEqual(sasConvRes.targetExt, '.sas');
    assert.ok(sasConvRes.convertedCode.includes('DATA') || sasConvRes.convertedCode.includes('data'));
    assert.ok(!sasConvRes.convertedCode.includes('function calculate_metrics(data) {'), 'Must not produce invalid JS/Python hybrid in SAS');
    assert.ok(!sasConvRes.convertedCode.includes('// Transpiled target code'), 'Must not produce // comment in SAS');
    assert.ok(sasConvRes.targetFileName.endsWith('.sas'));

    // Test invoking SQL Transpiler IPC handler directly
    const transpileFn = registeredChannels.get(DESKTOP_CHANNELS.ENGINES.TRANSPILE_SQL)!;
    const transpileRes = await transpileFn(null, {
      sourceSql: 'SELECT NVL(cust_id, 0) FROM orders;',
      sourceDialect: 'oracle',
      targetDialect: 'bigquery',
      materialization: 'table',
      targetModelName: 'stg_orders'
    });

    assert.ok(transpileRes.transpiledSql.includes('COALESCE(cust_id, 0)'));
    assert.strictEqual(transpileRes.targetDialect, 'bigquery');

    // Test invoking PII Masking IPC handler directly
    const piiFn = registeredChannels.get(DESKTOP_CHANNELS.ENGINES.PII_MASKING)!;
    const piiRes = await piiFn(null, {
      modelName: 'stg_customers_pii',
      sourceTable: 'raw_customers',
      rules: [
        { columnName: 'ssn', piiType: 'ssn', strategy: 'hash_sha256' }
      ]
    });
    assert.ok(piiRes.dbtMacroSql.includes('mask_pii_column'));

    // Test invoking Cloud Connection test IPC handler
    const cloudFn = registeredChannels.get(DESKTOP_CHANNELS.CLOUD.TEST_CONNECTION)!;
    const cloudRes = await cloudFn(null, 'gcp-firebase');
    assert.strictEqual(cloudRes.provider, 'gcp-firebase');
    assert.strictEqual(cloudRes.status, 'CONNECTED');

    // Test invoking FDE Discovery State IPC handler
    const fdeGetStateFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.GET_STATE)!;
    const fdeState = await fdeGetStateFn(null);
    // GET_STATE reads .evolve/fde_state.json from the active workspace. A clean
    // checkout has no saved engagement, so assert on shape rather than on content
    // that only exists once someone has used the Studio.
    assert.ok(fdeState.discovery !== undefined);
    assert.strictEqual(typeof fdeState.discovery.rawClientAsk, 'string');

    // Test invoking FDE Calculate ROI (The Controller's 3 Numbers)
    const fdeRoiFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.CALCULATE_ROI)!;
    const fdeRoi = await fdeRoiFn(null, { volume: 10000, handleTimeMins: 15, hourlyWage: 35 });
    assert.strictEqual(fdeRoi.volume, 10000);
    assert.strictEqual(fdeRoi.fteHoursReclaimed, 1750);
    // Savings apply the loaded-cost multiplier (1.3x) to the raw wage: 1750h x $45.50.
    assert.strictEqual(fdeRoi.monthlyCostSavedUsd, 79625);
    assert.strictEqual(fdeRoi.annualSavingsUsd, 955500);
    // Capacity uses productive hours per FTE month (135), not 160 calendar hours.
    assert.strictEqual(fdeRoi.fteCapacity, '13.0');

    // Every assumption behind the headline must be returned so an FDE can defend it.
    assert.strictEqual(fdeRoi.assumptions.automationRatioPct, 70);
    assert.strictEqual(fdeRoi.assumptions.loadedCostMultiplier, 1.3);
    assert.strictEqual(fdeRoi.assumptions.productiveHoursPerMonth, 135);
    assert.ok(Array.isArray(fdeRoi.derivation) && fdeRoi.derivation.length > 0);

    // A range, not a false-precision point estimate.
    assert.strictEqual(fdeRoi.range.lowMonthlyUsd, 63700);
    assert.strictEqual(fdeRoi.range.highMonthlyUsd, 95550);

    // Error-rate reduction is NOT asserted as a constant: with no measured baseline
    // supplied it must report as unknown rather than inventing a percentage.
    assert.strictEqual(fdeRoi.errorRateReductionKnown, false);
    assert.strictEqual(fdeRoi.errorRateReductionPct, 0);

    // With a measured baseline it is derived from the client's own numbers.
    const fdeRoiMeasured = await fdeRoiFn(null, {
      volume: 10000, handleTimeMins: 15, hourlyWage: 35,
      baselineErrorRatePct: 8, residualErrorRatePct: 2, reworkCostPerError: 12
    });
    assert.strictEqual(fdeRoiMeasured.errorRateReductionKnown, true);
    assert.strictEqual(fdeRoiMeasured.errorRateReductionPct, 75);
    assert.strictEqual(fdeRoiMeasured.monthlyReworkSavedUsd, 7200);

    // Test invoking FDE Save Discovery Scope
    const fdeSaveFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.SAVE_DISCOVERY)!;
    const fdeSaved = await fdeSaveFn(null, {
      rawClientAsk: 'Custom customer query',
      reframedProblem: 'Custom reframed goal',
      archetype: 'fin-reconcile'
    });
    assert.strictEqual(fdeSaved.success, true);
    assert.strictEqual(fdeSaved.state.discovery.archetype, 'fin-reconcile');

    // Test invoking FDE Workflow Topology Generation
    const fdeTopoFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.GENERATE_TOPOLOGY)!;
    const fdeTopo = await fdeTopoFn(null, { archetype: 'support-copilot' });
    assert.ok(fdeTopo.futureDiagram.includes('Rule vs Model Gate'));
    assert.ok(fdeTopo.legacyDiagram.includes('Manual Human Operator'));

    // Test invoking FDE Evaluate Rule vs Model Gate
    const fdeEvalGateFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.EVALUATE_RULE_VS_MODEL)!;
    assert.ok(fdeEvalGateFn !== undefined, 'EVALUATE_RULE_VS_MODEL handler should be registered');
    const mathEval = await fdeEvalGateFn(null, {
      taskDescription: 'Reconcile ledger accounts and calculate daily revenue balance',
      requiresStrictArithmetic: true,
      latencyBudgetMs: 5
    });
    assert.strictEqual(mathEval.recommendedLevel, 1);
    assert.strictEqual(mathEval.paradigm, 'Pure Rule Engine / Compiled SQL');

    const routerEval = await fdeEvalGateFn(null, {
      taskDescription: 'Triage customer support tickets and classify intent',
      latencyBudgetMs: 25
    });
    assert.strictEqual(routerEval.recommendedLevel, 2);

    // Test invoking Runbook Generator with empty/undefined state (must not throw)
    const runbookFn = registeredChannels.get(DESKTOP_CHANNELS.ENGINES.GENERATE_RUNBOOKS)!;
    const runbookRes = await runbookFn(null, {});
    assert.strictEqual(runbookRes.success, true);
    assert.ok(runbookRes.architectureDoc.length > 0);

    // Test invoking Reverse ETL with empty options (must not throw)
    const revEtlFn = registeredChannels.get(DESKTOP_CHANNELS.ENGINES.REVERSE_ETL)!;
    const revEtlRes = await revEtlFn(null, {});
    assert.ok(revEtlRes.pythonWorker.length > 0);

    // Test invoking RLS Policies with empty options (must not throw)
    const rlsFn = registeredChannels.get(DESKTOP_CHANNELS.ENGINES.RLS_POLICIES)!;
    const rlsRes = await rlsFn(null, {});
    assert.ok(rlsRes.policySql.length > 0);

    // Test invoking Golden Evaluation Benchmark Suite Runner (Section 4A)
    const benchFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.RUN_GOLDEN_BENCHMARK)!;
    assert.ok(benchFn !== undefined, 'RUN_GOLDEN_BENCHMARK handler should be registered');
    const customCases = [
      { id: 'T-001', category: 'Arithmetic & Limits', prompt: 'Refund $50', expectedOutput: 'Approved', status: 'PASSED', latencyMs: 5, costUsd: 0.0005, citations: ['SOP-1'] },
      { id: 'T-002', category: 'Arithmetic & Limits', prompt: 'Refund $500', expectedOutput: 'Escalated', status: 'PASSED', latencyMs: 8, costUsd: 0.0006, citations: ['SOP-1'] },
      { id: 'T-003', category: 'PII & Security', prompt: 'SSN check', expectedOutput: 'Redacted', status: 'PASSED', latencyMs: 4, costUsd: 0.0004, citations: ['SOP-2'] }
    ];
    const benchRes = await benchFn(null, {
      suiteSize: 3,
      domain: 'fintech',
      customCases,
      slaTargets: { minAccuracy: 90, maxLatencyP95: 100, maxCost: 0.001, minGroundedness: 95 }
    });
    assert.strictEqual(benchRes.totalCases, 3);
    assert.strictEqual(benchRes.passedCases, 3);
    assert.strictEqual(benchRes.accuracyScorePct, 100.0);
    assert.strictEqual(benchRes.isSlaMet, true);
    assert.ok(benchRes.p50LatencyMs > 0);

    // Verify benchmark reports written to disk
    const reportJsonPath = path.join(tmpDir, 'evals', 'golden_benchmark_report.json');
    const reportMdPath = path.join(tmpDir, 'evals', 'BENCHMARK.md');
    assert.ok(fs.existsSync(reportJsonPath), 'golden_benchmark_report.json should exist');
    assert.ok(fs.existsSync(reportMdPath), 'BENCHMARK.md should exist');

    // Test invoking Export Benchmark Runner (Jest & PyTest)
    const exportRunnerFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.EXPORT_BENCHMARK_RUNNER)!;
    assert.ok(exportRunnerFn !== undefined, 'EXPORT_BENCHMARK_RUNNER handler should be registered');
    const jestRes = await exportRunnerFn(null, {
      format: 'jest',
      suiteName: 'Test FinTech Suite',
      cases: customCases
    });
    assert.strictEqual(jestRes.success, true);
    assert.strictEqual(jestRes.format, 'jest');
    const jestFilePath = path.join(tmpDir, 'evals', 'benchmark.test.ts');
    assert.ok(fs.existsSync(jestFilePath), 'benchmark.test.ts should exist');
    const jestContent = fs.readFileSync(jestFilePath, 'utf8');
    assert.ok(jestContent.includes('@jest/globals'));
    assert.ok(jestContent.includes('Test FinTech Suite'));

    const pytestRes = await exportRunnerFn(null, {
      format: 'pytest',
      suiteName: 'Test FinTech Suite',
      cases: customCases
    });
    assert.strictEqual(pytestRes.success, true);
    assert.strictEqual(pytestRes.format, 'pytest');
    const pytestFilePath = path.join(tmpDir, 'evals', 'test_benchmark.py');
    assert.ok(fs.existsSync(pytestFilePath), 'test_benchmark.py should exist');
    const pytestContent = fs.readFileSync(pytestFilePath, 'utf8');
    assert.ok(pytestContent.includes('pytest.mark.parametrize'));

    // Test invoking AI Benchmark Case Generator
    const genCasesFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.GENERATE_BENCHMARK_CASES)!;
    assert.ok(genCasesFn !== undefined, 'GENERATE_BENCHMARK_CASES handler should be registered');
    const aiCasesRes = await genCasesFn(null, {
      prompt: 'mortgage appraisal loan fraud detection',
      domain: 'fintech',
      count: 5
    });
    assert.strictEqual(aiCasesRes.count, 5);
    assert.strictEqual(aiCasesRes.cases.length, 5);
    assert.ok(aiCasesRes.cases[0].prompt.length > 0);
    assert.ok(aiCasesRes.cases[0].expectedOutput.length > 0);

    // Test invoking Target Connection Test (TEST_TARGET_CONNECTION)
    const testConnFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.TEST_TARGET_CONNECTION)!;
    assert.ok(testConnFn !== undefined, 'TEST_TARGET_CONNECTION handler should be registered');
    const localRuleConn = await testConnFn(null, { type: 'rule_engine' });
    assert.strictEqual(localRuleConn.ok, true);
    assert.ok(localRuleConn.message.includes('Local Rule Engine'));

    const unconfiguredLlmConn = await testConnFn(null, { type: 'llm_gemini', apiKey: '' });
    assert.strictEqual(unconfiguredLlmConn.ok, false);
    assert.ok(unconfiguredLlmConn.message.includes('API key'));

    // Test invoking Benchmark Suite with honest target failure when target is missing credentials
    const failedTargetBenchRes = await benchFn(null, {
      suiteSize: 3,
      domain: 'fintech',
      customCases,
      targetConfig: { type: 'llm_openai', apiKey: '' }
    });
    assert.ok(failedTargetBenchRes.error !== undefined, 'Should honestly report error when target is unreachable/unconfigured');
    assert.strictEqual(failedTargetBenchRes.totalCases, 0);

    // Test invoking Groundedness Verification Gate (VERIFY_GROUNDEDNESS)
    const verifyGroundedFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.VERIFY_GROUNDEDNESS)!;
    assert.ok(verifyGroundedFn !== undefined, 'VERIFY_GROUNDEDNESS handler should be registered');

    // Valid claim scenario
    const validGroundedRes = await verifyGroundedFn(null, {
      generatedClaim: 'Refund requests under $100 require no manager override per section 4.2 of the policy.',
      handbookChunks: [{
        chunkId: 'chk-sop-42',
        title: 'Merchant SOP §4.2',
        text: 'Refunds strictly under $100 require no manager override. Any transaction of $100 or above mandates supervisor escalation.'
      }]
    });
    assert.strictEqual(validGroundedRes.isGrounded, true);
    assert.ok(validGroundedRes.groundednessScorePct >= 65);
    assert.ok(validGroundedRes.auditSignature !== null);
    // A SHA-256 content digest, not a signature: there is no keypair, so the
    // old 'ed25519_sig_' prefix claimed a guarantee the product cannot provide.
    assert.ok(validGroundedRes.auditSignature.startsWith('sha256:'));
    assert.strictEqual(validGroundedRes.cryptographicallySigned, false);

    // Groundedness Violation scenario (ungrounded hallucinated claim)
    const violationGroundedRes = await verifyGroundedFn(null, {
      generatedClaim: 'Unconditional refunds of up to $50,000 are authorized with zero human approval and immediate crypto payout.',
      handbookChunks: [{
        chunkId: 'chk-sop-42',
        title: 'Merchant SOP §4.2',
        text: 'Refunds strictly under $100 require no manager override. Any transaction of $100 or above mandates supervisor escalation.'
      }]
    });
    assert.strictEqual(violationGroundedRes.isGrounded, false);
    assert.ok(violationGroundedRes.groundednessScorePct < 65);
    assert.strictEqual(violationGroundedRes.auditSignature, null, 'Signature must be withheld on groundedness violation');
    assert.ok(violationGroundedRes.unmatchedEntities.length > 0);

    // Test invoking HITL Action Logger (LOG_HITL_ACTION)
    const logHitlFn = registeredChannels.get(DESKTOP_CHANNELS.FDE.LOG_HITL_ACTION)!;
    assert.ok(logHitlFn !== undefined, 'LOG_HITL_ACTION handler should be registered');
    const hitlLogRes = await logHitlFn(null, {
      transactionId: 'TX-9482',
      action: 'APPROVED',
      amount: 150.00,
      supervisorId: 'SUP-EVAL-01',
      timestamp: new Date().toISOString(),
      notes: 'Supervisor verified client authorization'
    });
    assert.strictEqual(hitlLogRes.success, true);
    assert.strictEqual(hitlLogRes.entry.transactionId, 'TX-9482');

    // Test invoking Universal Multi-Industry HITL Action with Four-Eyes Dual Sign-Off (Agentic MCP)
    const agenticHitlLogRes = await logHitlFn(null, {
      transactionId: 'CALL-8921',
      action: 'APPROVED',
      amount: 32000,
      unit: 'Tokens',
      domain: 'agentic_mcp',
      customer: 'Lead-DevOps-Agent (MCP: kubernetes-exec)',
      supervisor: 'AI-SAFETY-OFFICER',
      secondSupervisor: 'DIR-RISK-01',
      dualSigned: true,
      confidence: 74,
      mutationType: 'destructive',
      blastRadius: 'global',
      priority: 'CRITICAL',
      ceilingThreshold: 25000,
      notes: 'Dual sign-off authorized by AI Safety Officer and Risk Director'
    });
    assert.strictEqual(agenticHitlLogRes.success, true);
    assert.strictEqual(agenticHitlLogRes.entry.transactionId, 'CALL-8921');
    assert.strictEqual(agenticHitlLogRes.entry.dualSigned, true);
    assert.strictEqual(agenticHitlLogRes.entry.secondSupervisor, 'DIR-RISK-01');
    assert.strictEqual(agenticHitlLogRes.entry.domain, 'agentic_mcp');
    assert.strictEqual(agenticHitlLogRes.entry.unit, 'Tokens');

    const hitlAuditPath = path.join(tmpDir, 'evals', 'hitl_audit_log.json');
    assert.ok(fs.existsSync(hitlAuditPath), 'hitl_audit_log.json should exist in workspace');
    const hitlAuditEntries = JSON.parse(fs.readFileSync(hitlAuditPath, 'utf8'));
    assert.ok(hitlAuditEntries.some((e: any) => e.transactionId === 'TX-9482' && e.action === 'APPROVED'));
    assert.ok(hitlAuditEntries.some((e: any) => e.transactionId === 'CALL-8921' && e.dualSigned === true && e.domain === 'agentic_mcp'));

    wsMgr.dispose();
    termMgr.dispose();
  });
});
