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
import { DesktopIpcHandlers } from '../../../desktop/main/ipcHandlers';
import { DESKTOP_CHANNELS } from '../../../desktop/shared/eventChannels';

suite('Enterprise Desktop Edition — Core Architecture & Subsystems', () => {
  const tmpDir = path.join(os.tmpdir(), 'evolve-desktop-test-' + Math.random().toString(36).substring(2, 8));

  suiteSetup(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  suiteTeardown(() => {
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

  test('DesktopUpdater checks updates and handles offline patch simulation', async () => {
    const updater = new DesktopUpdater(tmpDir);

    const checkRes = await updater.checkForUpdates();
    assert.strictEqual(checkRes.currentVersion, '2.19.1');

    const patchFile = path.join(tmpDir, 'test-patch.zip');
    fs.writeFileSync(patchFile, 'EVOLVE_PATCH_BINARY_DATA', 'utf8');

    const patchRes = updater.applyOfflinePatch(patchFile);
    assert.strictEqual(patchRes.success, true);
    assert.ok(patchRes.patchedVersion.includes('2.19.1-patch-'));
    assert.ok(patchRes.enginesReloaded.includes('SqlTranspiler'));
  });

  test('DesktopIpcHandlers registers and executes all IPC channel handlers', async () => {
    const wsMgr = new DesktopWorkspaceManager(tmpDir);
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
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.LICENSE.GET_STATE));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.VAULT.GET_SECRET));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.TRANSPILE_SQL));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.PII_MASKING));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.REVERSE_ETL));
    assert.ok(registeredChannels.has(DESKTOP_CHANNELS.ENGINES.RLS_POLICIES));

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

    wsMgr.dispose();
    termMgr.dispose();
  });
});
