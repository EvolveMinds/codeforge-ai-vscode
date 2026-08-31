/**
 * Evolve AI Enterprise Desktop Edition — Central IPC Request Handlers
 */

import { DESKTOP_CHANNELS } from '../shared/eventChannels';
import { DesktopWorkspaceManager } from './workspaceManager';
import { DesktopTerminalManager } from './terminalManager';
import { DesktopLicenseAuth } from './licenseAuth';
import { DesktopSecretVault } from './secretVault';
import { DesktopUpdater } from './updater';

// Enterprise Engines
import { SqlTranspiler } from '../../enterprise/migration/sqlTranspiler';
import { PiiSanitizer } from '../../enterprise/security/piiSanitizer';
import { ReverseEtlGenerator } from '../../enterprise/sync/reverseEtlGen';
import { RlsPolicyGenerator } from '../../enterprise/security/rlsPolicyGen';
import { SyntheticDataGenerator } from '../../enterprise/synthetic/syntheticDataGen';
import { MockServerGenerator } from '../../enterprise/mockServer/mockServerGen';
import { DataQualityGenerator } from '../../enterprise/dataQuality/dataQualityGenerator';
import { LoadTestGenerator } from '../../enterprise/loadTesting/loadTestGenerator';
import { RagPipelineScaffolder } from '../../enterprise/rag/ragPipelineScaffolder';
import { SiemAuditForwarder } from '../../enterprise/security/siemForwarder';
import { PrivateModelClient } from '../../enterprise/serving/privateModelClient';

// FDE Core & Deployment Engines
import { DbIntrospector } from '../../fde/dbIntrospector';
import { FdeAiEngine } from '../../fde/aiEngine';
import { SchemaMapperEngine } from '../../fde/schemaMapper';
import { ApiConnectorGenerator } from '../../fde/apiConnectorGen';
import { RunbookGenerator } from '../../fde/runbookGenerator';
import { DeployScriptScaffolder } from '../../deployment/deployScriptScaffolder';
import { PreflightAuditor } from '../../deployment/preflightAuditor';

export interface IpcRegistryContext {
  workspaceMgr: DesktopWorkspaceManager;
  terminalMgr: DesktopTerminalManager;
  licenseAuth: DesktopLicenseAuth;
  secretVault: DesktopSecretVault;
  updater: DesktopUpdater;
}

export class DesktopIpcHandlers {
  private _ctx: IpcRegistryContext;

  constructor(ctx: IpcRegistryContext) {
    this._ctx = ctx;
  }

  public registerAll(ipcMain: any): void {
    const { workspaceMgr, terminalMgr, licenseAuth, secretVault, updater } = this._ctx;

    // --- WORKSPACE CHANNELS ---
    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.GET_CURRENT, async () => {
      return workspaceMgr.getCurrentWorkspace();
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.GET_RECENT, async () => {
      return workspaceMgr.getRecentWorkspaces();
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.SET_CURRENT, async (_: any, folderPath: string) => {
      return workspaceMgr.setCurrentWorkspace(folderPath);
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.GET_FILE_TREE, async (_: any, dirPath?: string, maxDepth?: number) => {
      return workspaceMgr.getFileTree(dirPath, maxDepth);
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.READ_FILE, async (_: any, filePath: string) => {
      return workspaceMgr.readFile(filePath);
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.WRITE_FILE, async (_: any, filePath: string, content: string) => {
      return workspaceMgr.writeFile(filePath, content);
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.CREATE_FILE, async (_: any, filePath: string, content: string = '') => {
      return workspaceMgr.writeFile(filePath, content);
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.CREATE_DIR, async (_: any, dirPath: string) => {
      return workspaceMgr.createDirectory(dirPath);
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.DELETE_ITEM, async (_: any, targetPath: string) => {
      return workspaceMgr.deleteItem(targetPath);
    });

    ipcMain.handle(DESKTOP_CHANNELS.WORKSPACE.RENAME_ITEM, async (_: any, oldPath: string, newPath: string) => {
      return workspaceMgr.renameItem(oldPath, newPath);
    });

    // --- TERMINAL CHANNELS ---
    ipcMain.handle(DESKTOP_CHANNELS.TERMINAL.SPAWN, async (_: any, options: any) => {
      const ws = workspaceMgr.getCurrentWorkspace();
      const spawnOpts = {
        ...options,
        cwd: options?.cwd || (ws ? ws.path : process.cwd())
      };
      return terminalMgr.spawnSession(spawnOpts);
    });

    ipcMain.handle(DESKTOP_CHANNELS.TERMINAL.INPUT, async (_: any, id: string, data: string) => {
      return terminalMgr.writeData(id, data);
    });

    ipcMain.handle(DESKTOP_CHANNELS.TERMINAL.KILL, async (_: any, id: string) => {
      return terminalMgr.killSession(id);
    });

    ipcMain.handle(DESKTOP_CHANNELS.TERMINAL.LIST, async () => {
      return terminalMgr.listSessions();
    });

    // --- LICENSE & IDENTITY CHANNELS ---
    ipcMain.handle(DESKTOP_CHANNELS.LICENSE.GET_STATE, async () => {
      return licenseAuth.getLicenseState();
    });

    ipcMain.handle(DESKTOP_CHANNELS.LICENSE.ACTIVATE_KEY, async (_: any, key: string) => {
      return await licenseAuth.activateLicenseKey(key);
    });

    ipcMain.handle(DESKTOP_CHANNELS.LICENSE.GET_FINGERPRINT, async () => {
      return licenseAuth.getHardwareFingerprint();
    });

    ipcMain.handle(DESKTOP_CHANNELS.LICENSE.EXPORT_CHALLENGE, async (_: any, userId: string, orgName: string) => {
      return licenseAuth.generateOfflineChallenge(userId, orgName);
    });

    ipcMain.handle(DESKTOP_CHANNELS.LICENSE.IMPORT_OFFLINE_LICENSE, async (_: any, filePath: string) => {
      return await licenseAuth.importOfflineLicenseFile(filePath);
    });

    ipcMain.handle(DESKTOP_CHANNELS.LICENSE.GET_PROFILE, async () => {
      return licenseAuth.getProfile();
    });

    ipcMain.handle(DESKTOP_CHANNELS.LICENSE.SAVE_PROFILE, async (_: any, profile: any) => {
      return licenseAuth.saveProfile(profile);
    });

    // --- VAULT CHANNELS ---
    ipcMain.handle(DESKTOP_CHANNELS.VAULT.GET_SECRET, async (_: any, key: string) => {
      return secretVault.getSecret(key);
    });

    ipcMain.handle(DESKTOP_CHANNELS.VAULT.SET_SECRET, async (_: any, key: string, val: string) => {
      secretVault.setSecret(key, val);
      return true;
    });

    ipcMain.handle(DESKTOP_CHANNELS.VAULT.LIST_KEYS, async () => {
      return secretVault.listKeys();
    });

    ipcMain.handle(DESKTOP_CHANNELS.VAULT.DELETE_SECRET, async (_: any, key: string) => {
      return secretVault.deleteSecret(key);
    });

    // --- UPDATER CHANNELS ---
    ipcMain.handle(DESKTOP_CHANNELS.UPDATER.CHECK_UPDATE, async () => {
      return await updater.checkForUpdates();
    });

    ipcMain.handle(DESKTOP_CHANNELS.UPDATER.APPLY_OFFLINE_PATCH, async (_: any, patchPath: string) => {
      return updater.applyOfflinePatch(patchPath);
    });

    // --- ENTERPRISE & FDE CORE ENGINES ---
    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.TRANSPILE_SQL, async (_: any, req: any) => {
      return SqlTranspiler.transpile(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.PII_MASKING, async (_: any, req: any) => {
      return PiiSanitizer.generatePiiMaskingSuite(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.REVERSE_ETL, async (_: any, req: any) => {
      return ReverseEtlGenerator.generateReverseEtlSync(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.RLS_POLICIES, async (_: any, req: any) => {
      return RlsPolicyGenerator.generateRlsPolicies(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.SYNTHETIC_DATA, async (_: any, req: any) => {
      return SyntheticDataGenerator.generateDataset(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.MOCK_SERVER, async (_: any, req: any) => {
      return MockServerGenerator.generateMockServer(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.DATA_QUALITY, async (_: any, req: any) => {
      return DataQualityGenerator.generateQualityPackage(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.LOAD_TEST, async (_: any, req: any) => {
      return LoadTestGenerator.generateSuite(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.RAG_PIPELINE, async (_: any, req: any) => {
      return RagPipelineScaffolder.scaffold(req);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.SIEM_AUDIT, async (_: any, event: any) => {
      const fwd = SiemAuditForwarder.getInstance();
      return fwd.createEvent(event.action || 'system_access', event.severity || 'info', event.options || {});
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.PRIVATE_SERVING, async (_: any, config: any) => {
      const client = new PrivateModelClient(config);
      return await client.checkHealth();
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.INTROSPECT_DB, async (_: any, dialect: any, connUri: string) => {
      return await DbIntrospector.introspect(dialect, connUri);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.MAP_SCHEMA, async (_: any, rawColumnsText: string, srcName: string) => {
      return FdeAiEngine.analyzeAndCleanStagingSchema(rawColumnsText, srcName);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.BUILD_MART, async (_: any, config: any) => {
      const sql = SchemaMapperEngine.generateDataMartModel(
        config.martName,
        config.materialization || 'table',
        config.baseModel,
        config.joins || [],
        config.dimensions || [],
        config.metrics || []
      );
      const schemaYaml = SchemaMapperEngine.generateDbtSchemaYaml(
        config.martName,
        config.dimensions || [],
        config.metrics || []
      );
      return { sql, schemaYaml };
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.GENERATE_API_SDK, async (_: any, config: any) => {
      const tsCode = ApiConnectorGenerator.generateTypeScriptSdk(config);
      const pyCode = ApiConnectorGenerator.generatePythonSdk(config);
      return { tsCode, pyCode };
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.PARSE_CURL, async (_: any, curlStr: string) => {
      return ApiConnectorGenerator.parseCurlCommand(curlStr);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.PARSE_OPENAPI, async (_: any, openApiStr: string) => {
      return ApiConnectorGenerator.parseOpenApiSpec(openApiStr);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.SCAFFOLD_DEPLOY, async (_: any, config: any) => {
      const terraform = DeployScriptScaffolder.generateTerraform(config);
      const kubernetes = DeployScriptScaffolder.generateKubernetesManifest(config);
      const dockerCompose = DeployScriptScaffolder.generateDockerCompose(config);
      const cicd = DeployScriptScaffolder.generateGitHubActionsDeployWorkflow(config);
      return { terraform, kubernetes, dockerCompose, cicd };
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.RUN_PREFLIGHT_AUDIT, async (_: any, dirPath?: string) => {
      const ws = workspaceMgr.getCurrentWorkspace();
      const targetDir = dirPath || (ws ? ws.path : process.cwd());
      return PreflightAuditor.scanWorkspace(targetDir);
    });

    ipcMain.handle(DESKTOP_CHANNELS.ENGINES.GENERATE_RUNBOOKS, async (_: any, state: any) => {
      return {
        architectureDoc: RunbookGenerator.generateArchitectureDoc(state),
        deploymentRunbook: RunbookGenerator.generateDeploymentRunbook(state),
        dataDictionary: RunbookGenerator.generateDataDictionary(state),
        environmentCatalog: RunbookGenerator.generateEnvironmentCatalog(state),
        completeHandoffPackage: RunbookGenerator.generateCompleteHandoffPackage(state)
      };
    });
  }
}
