/**
 * ui/fdeCockpitPanel.ts — Forward Deployed Engineer (FDE) Delivery Studio Webview Panel
 *
 * Dedicated full-view UI for managing client delivery engagements across 4 phases:
 *   1. Data & Schema Ingest
 *   2. Client API Connectors
 *   3. Pilot Deployment & Pre-Flight Delivery
 *   4. Client Handoff & Runbooks
 *
 * 100% Offline & Air-Gapped — Zero external CDN resources.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FdeContextManager, FdeEngagementState } from '../fde/fdeContext';
import { SchemaMapperEngine, ColumnDefinition } from '../fde/schemaMapper';
import { ApiConnectorGenerator, ApiEndpointSpec } from '../fde/apiConnectorGen';
import { PreflightAuditor, PreflightReport } from '../deployment/preflightAuditor';
import { FirebaseConfigGenerator } from '../deployment/firebaseConfigGen';
import { DeployScriptScaffolder } from '../deployment/deployScriptScaffolder';
import { RunbookGenerator } from '../fde/runbookGenerator';

export class FdeCockpitPanel {
  public static currentPanel: FdeCockpitPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _vsCtx: vscode.ExtensionContext;
  private readonly _contextManager: FdeContextManager;
  private _disposables: vscode.Disposable[] = [];
  private _lastAuditReport?: PreflightReport;

  public static createOrShow(vsCtx: vscode.ExtensionContext): FdeCockpitPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (FdeCockpitPanel.currentPanel) {
      FdeCockpitPanel.currentPanel._panel.reveal(column);
      return FdeCockpitPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiForge.fdeCockpit',
      'FDE Delivery Studio (Beta)',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    FdeCockpitPanel.currentPanel = new FdeCockpitPanel(panel, vsCtx);
    return FdeCockpitPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, vsCtx: vscode.ExtensionContext) {
    this._panel = panel;
    this._vsCtx = vsCtx;
    this._contextManager = new FdeContextManager(vsCtx);

    this._update();

    this._panel.onDidDispose(() => {
      FdeCockpitPanel.currentPanel = undefined;
      while (this._disposables.length) {
        const x = this._disposables.pop();
        if (x) x.dispose();
      }
    }, null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );
  }

  public dispose(): void {
    FdeCockpitPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private async _handleMessage(msg: any): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    switch (msg.command) {
      case 'createProject': {
        const name = msg.projectName || 'New Client Engagement';
        const vpc = msg.targetVpc || 'gcp-firebase';
        const goal = msg.engagementGoal || 'Deploy standard platform integration & data pipeline on client infrastructure';
        await this._contextManager.createProject(name, vpc, goal);
        vscode.window.showInformationMessage(`✓ Created engagement project: "${name}"`);
        this._update();
        break;
      }

      case 'switchProject': {
        if (msg.projectId) {
          await this._contextManager.switchProject(msg.projectId);
          this._update();
        }
        break;
      }

      case 'requestResetProject': {
        const state = this._contextManager.getState();
        const choice = await vscode.window.showWarningMessage(
          `Are you sure you want to reset engagement "${state.clientName}"? This will clear all mapped schemas, APIs, deployments, and progress so you can redo cleanly.`,
          { modal: true },
          'Reset Engagement'
        );
        if (choice === 'Reset Engagement') {
          await this._contextManager.resetCurrentProject();
          vscode.window.showInformationMessage(`✓ Engagement "${state.clientName}" reset cleanly.`);
          this._update();
        }
        break;
      }

      case 'resetProject': {
        await this._contextManager.resetCurrentProject();
        vscode.window.showInformationMessage('✓ Active engagement project reset cleanly. All steps cleared.');
        this._update();
        break;
      }

      case 'requestDeleteProject': {
        const state = this._contextManager.getState();
        const choice = await vscode.window.showWarningMessage(
          `Are you sure you want to delete engagement project "${state.clientName}"?`,
          { modal: true },
          'Delete Engagement'
        );
        if (choice === 'Delete Engagement') {
          await this._contextManager.deleteProject(msg.projectId || state.id);
          vscode.window.showInformationMessage(`Engagement "${state.clientName}" deleted.`);
          this._update();
        }
        break;
      }

      case 'deleteProject': {
        if (msg.projectId) {
          await this._contextManager.deleteProject(msg.projectId);
          vscode.window.showInformationMessage('Engagement project deleted.');
          this._update();
        }
        break;
      }

      case 'requestDeleteSchemaMapping': {
        if (msg.sourceName) {
          const choice = await vscode.window.showWarningMessage(
            `Remove mapped staging model for "${msg.sourceName}"?`,
            { modal: true },
            'Remove Model'
          );
          if (choice === 'Remove Model') {
            await this._contextManager.deleteSchemaMapping(msg.sourceName);
            vscode.window.showInformationMessage(`Removed mapped schema: ${msg.sourceName}`);
            this._update();
          }
        }
        break;
      }

      case 'deleteSchemaMapping': {
        if (msg.sourceName) {
          await this._contextManager.deleteSchemaMapping(msg.sourceName);
          vscode.window.showInformationMessage(`Removed mapped schema: ${msg.sourceName}`);
          this._update();
        }
        break;
      }

      case 'requestDeleteApiConnector': {
        if (msg.connectorName) {
          const choice = await vscode.window.showWarningMessage(
            `Remove client API connector "${msg.connectorName}"?`,
            { modal: true },
            'Remove Connector'
          );
          if (choice === 'Remove Connector') {
            await this._contextManager.deleteApiConnector(msg.connectorName);
            vscode.window.showInformationMessage(`Removed API connector: ${msg.connectorName}`);
            this._update();
          }
        }
        break;
      }

      case 'deleteApiConnector': {
        if (msg.connectorName) {
          await this._contextManager.deleteApiConnector(msg.connectorName);
          vscode.window.showInformationMessage(`Removed API connector: ${msg.connectorName}`);
          this._update();
        }
        break;
      }

      case 'updateClientName':
        await this._contextManager.updateState(s => ({ ...s, clientName: msg.clientName }));
        this._update();
        break;

      case 'setActivePhase':
        await this._contextManager.updateState(s => ({ ...s, activePhase: msg.phase }));
        this._update();
        break;

      case 'openFileInEditor': {
        if (ws && msg.relativePath) {
          const fullPath = path.join(ws, msg.relativePath);
          if (fs.existsSync(fullPath)) {
            const doc = await vscode.workspace.openTextDocument(fullPath);
            await vscode.window.showTextDocument(doc, { preview: false });
          } else {
            vscode.window.showWarningMessage(`File not found: ${msg.relativePath}. Click "Generate All Client Handoff Docs" first.`);
          }
        }
        break;
      }

      case 'previewMarkdown': {
        if (ws && msg.relativePath) {
          const fullPath = path.join(ws, msg.relativePath);
          if (fs.existsSync(fullPath)) {
            const uri = vscode.Uri.file(fullPath);
            await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
          } else {
            vscode.window.showWarningMessage(`File not found: ${msg.relativePath}. Click "Generate All Client Handoff Docs" first.`);
          }
        }
        break;
      }

      case 'runPreflightAudit': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace folder first to run Pre-Flight Audit.');
          return;
        }
        this._lastAuditReport = PreflightAuditor.scanWorkspace(ws);
        this._panel.webview.postMessage({ type: 'auditResult', report: this._lastAuditReport });
        break;
      }

      case 'cleanTemporaryFiles': {
        if (this._lastAuditReport && this._lastAuditReport.temporaryFiles.length > 0) {
          const res = PreflightAuditor.cleanTemporaryFiles(this._lastAuditReport.temporaryFiles);
          vscode.window.showInformationMessage(`Pre-Flight Cleanup: Removed ${res.cleaned} temporary/backup files.`);
          if (ws) {
            this._lastAuditReport = PreflightAuditor.scanWorkspace(ws);
            this._panel.webview.postMessage({ type: 'auditResult', report: this._lastAuditReport, toast: `Cleaned ${res.cleaned} temporary files.` });
          }
        }
        break;
      }

      case 'pickSchemaFile': {
        const fileUris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Select Data or Schema File',
          filters: {
            'Data & Schema Files': ['csv', 'tsv', 'json', 'sql'],
            'All Files': ['*']
          }
        });
        if (fileUris && fileUris.length > 0) {
          const filePath = fileUris[0].fsPath;
          const ext = path.extname(filePath).toLowerCase();
          const content = fs.readFileSync(filePath, 'utf8');
          let extractedCols: Array<{ name: string; type: string }> = [];

          if (ext === '.csv' || ext === '.tsv') {
            const delimiter = ext === '.tsv' ? '\t' : ',';
            const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (lines.length > 0) {
              const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
              const sampleVals = lines.length > 1 ? lines[1].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, '')) : [];
              extractedCols = headers.map((h, i) => {
                const val = sampleVals[i] || '';
                let type = 'string';
                if (/^-?\d+$/.test(val)) type = 'integer';
                else if (/^-?\d*\.\d+$/.test(val)) type = 'float';
                else if (/^\d{4}-\d{2}-\d{2}/.test(val)) type = 'timestamp';
                else if (/^(true|false)$/i.test(val)) type = 'boolean';
                return { name: h, type };
              });
            }
          } else if (ext === '.json') {
            try {
              const parsed = JSON.parse(content);
              const sampleObj = Array.isArray(parsed) ? parsed[0] : parsed;
              if (sampleObj && typeof sampleObj === 'object') {
                extractedCols = Object.keys(sampleObj).map(k => {
                  const val = sampleObj[k];
                  let type: string = typeof val;
                  if (val === null) type = 'string';
                  else if (typeof val === 'number') type = Number.isInteger(val) ? 'integer' : 'float';
                  else if (typeof val === 'boolean') type = 'boolean';
                  else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) type = 'timestamp';
                  return { name: k, type };
                });
              }
            } catch (e) {
              vscode.window.showErrorMessage('Failed to parse JSON schema file.');
            }
          } else if (ext === '.sql') {
            const colRegex = /([a-zA-Z0-9_]+)\s+(VARCHAR|TEXT|INT|INTEGER|FLOAT|DOUBLE|NUMERIC|DECIMAL|TIMESTAMP|DATE|BOOLEAN|BIGINT)/gi;
            let match;
            while ((match = colRegex.exec(content)) !== null) {
              extractedCols.push({ name: match[1], type: match[2].toLowerCase() });
            }
          }

          if (extractedCols.length > 0) {
            const colsString = extractedCols.map(c => `${c.name}:${c.type}`).join('\n');
            const baseName = path.basename(filePath, ext).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            this._panel.webview.postMessage({
              type: 'schemaFileLoaded',
              fileName: path.basename(filePath),
              sourceName: `client_${baseName}_raw`,
              modelName: `stg_${baseName}`,
              colsString
            });
            vscode.window.showInformationMessage(`✓ Loaded ${extractedCols.length} columns from ${path.basename(filePath)}`);
          } else {
            vscode.window.showWarningMessage('No columns could be automatically detected from the selected file. Please enter them manually.');
          }
        }
        break;
      }

      case 'generateSchemaMapping': {
        const srcCols: ColumnDefinition[] = (msg.sourceCols || '').split('\n').map((l: string) => l.trim()).filter(Boolean).map((line: string) => {
          const [name, type] = line.split(':').map((s: string) => s.trim());
          return { name, type: type || 'string' };
        });
        const tgtCols: ColumnDefinition[] = (msg.targetCols || '').split('\n').map((l: string) => l.trim()).filter(Boolean).map((line: string) => {
          const [name, type] = line.split(':').map((s: string) => s.trim());
          return { name, type: type || 'string' };
        });

        if (srcCols.length === 0 || tgtCols.length === 0) {
          vscode.window.showWarningMessage('⚠️ Please provide both Source Columns and Target Model Columns before generating.');
          this._panel.webview.postMessage({
            type: 'schemaMappingError',
            error: 'Please load a CSV / schema file, pick a preset, or enter source and target columns.'
          });
          return;
        }

        const sourceName = (msg.sourceName || 'client_orders_raw').trim();
        const modelName = (msg.modelName || 'stg_orders').trim();

        const result = SchemaMapperEngine.mapSchemas(srcCols, tgtCols, sourceName, modelName);

        await this._contextManager.recordSchemaMapping({
          sourceName,
          targetModelName: modelName,
          dialect: 'dbt',
          columns: result.mappings,
          unmappedSource: result.unmappedSource,
          unmappedTarget: result.unmappedTarget,
          createdAt: Date.now(),
        });

        let writtenFile = '';
        if (ws && msg.writeToFile) {
          const dbtDir = path.join(ws, 'models', 'staging');
          if (!fs.existsSync(dbtDir)) fs.mkdirSync(dbtDir, { recursive: true });
          const outPath = path.join(dbtDir, `${modelName}.sql`);
          fs.writeFileSync(outPath, result.dbtSql, 'utf8');
          writtenFile = `models/staging/${modelName}.sql`;
          vscode.window.showInformationMessage(`✓ Created dbt staging model: ${writtenFile}`);
        }

        this._panel.webview.postMessage({
          type: 'schemaMappingResult',
          result,
          writtenFile,
          modelName,
          sourceName
        });
        this._update();
        break;
      }

      case 'generateApiConnector': {
        const endpoints: ApiEndpointSpec[] = (msg.endpoints || []).map((e: any) => ({
          name: e.name,
          method: e.method || 'GET',
          path: e.path || '/',
          description: e.description,
        }));

        const tsCode = ApiConnectorGenerator.generateTypeScriptSdk({
          connectorName: msg.connectorName || 'ClientApi',
          baseUrl: msg.baseUrl || 'https://api.client.com',
          authType: msg.authType || 'bearer',
          targetLanguage: 'typescript',
          endpoints,
        });

        const pyCode = ApiConnectorGenerator.generatePythonSdk({
          connectorName: msg.connectorName || 'ClientApi',
          baseUrl: msg.baseUrl || 'https://api.client.com',
          authType: msg.authType || 'bearer',
          targetLanguage: 'python',
          endpoints,
        });

        await this._contextManager.recordApiConnector({
          connectorName: msg.connectorName || 'ClientApi',
          targetLanguage: msg.targetLanguage || 'typescript',
          baseUrl: msg.baseUrl || 'https://api.client.com',
          authType: msg.authType || 'bearer',
          endpoints,
          createdAt: Date.now(),
        });

        let writtenFile = '';
        if (ws && msg.writeToFile) {
          const ext = msg.targetLanguage === 'python' ? 'py' : 'ts';
          const code = msg.targetLanguage === 'python' ? pyCode : tsCode;
          const outDir = path.join(ws, 'src', 'connectors');
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
          const outPath = path.join(outDir, `${(msg.connectorName || 'clientApi').toLowerCase()}.${ext}`);
          fs.writeFileSync(outPath, code, 'utf8');
          writtenFile = `src/connectors/${(msg.connectorName || 'clientApi').toLowerCase()}.${ext}`;
          vscode.window.showInformationMessage(`Scaffolded API Connector: ${writtenFile}`);
        }

        this._panel.webview.postMessage({ type: 'apiConnectorResult', tsCode, pyCode, writtenFile });
        this._update();
        break;
      }

      case 'scaffoldFullstackDeployment': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace first.');
          return;
        }
        const state = this._contextManager.getState();
        const projId = msg.projectId || 'client-pilot-project';
        const pubDir = msg.publicDir || 'dist';

        // 1. firebase.json & .firebaserc
        const fbJson = FirebaseConfigGenerator.generateFirebaseJson({ projectId: projId, defaultPublicDir: pubDir });
        const fbRc = FirebaseConfigGenerator.generateFirebaseRc({ projectId: projId });
        fs.writeFileSync(path.join(ws, 'firebase.json'), fbJson, 'utf8');
        fs.writeFileSync(path.join(ws, '.firebaserc'), fbRc, 'utf8');

        // 2. scripts/
        const scriptsDir = path.join(ws, 'scripts');
        if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
        
        const bashScript = DeployScriptScaffolder.generateBashDeployScript({ projectName: state.clientName.toLowerCase().replace(/[^a-z0-9]/g, '-'), projectId: projId, includeCloudRunBackend: true });
        const psScript = DeployScriptScaffolder.generatePowerShellDeployScript({ projectName: state.clientName.toLowerCase().replace(/[^a-z0-9]/g, '-'), projectId: projId, includeCloudRunBackend: true });
        const prepScript = DeployScriptScaffolder.generatePrepareDeploymentScript();

        fs.writeFileSync(path.join(scriptsDir, 'deploy.sh'), bashScript, { encoding: 'utf8', mode: 0o755 });
        fs.writeFileSync(path.join(scriptsDir, 'deploy.ps1'), psScript, 'utf8');
        fs.writeFileSync(path.join(scriptsDir, 'prepare-deployment.js'), prepScript, 'utf8');

        // 3. CI/CD Workflow
        const wfDir = path.join(ws, '.github', 'workflows');
        if (!fs.existsSync(wfDir)) fs.mkdirSync(wfDir, { recursive: true });
        const ciWorkflow = DeployScriptScaffolder.generateGitHubActionsDeployWorkflow({ projectName: state.clientName.toLowerCase().replace(/[^a-z0-9]/g, '-'), projectId: projId });
        fs.writeFileSync(path.join(wfDir, 'deploy.yml'), ciWorkflow, 'utf8');

        await this._contextManager.recordDeployment({
          clientName: projId,
          environment: 'pilot',
          targetVpc: 'gcp-firebase',
          deployedAt: Date.now(),
        });

        vscode.window.showInformationMessage('✓ Successfully scaffolded Firebase config, deployment scripts, and CI/CD workflow!');
        this._panel.webview.postMessage({ type: 'scaffoldDone', files: ['firebase.json', '.firebaserc', 'scripts/deploy.sh', 'scripts/deploy.ps1', '.github/workflows/deploy.yml'] });
        this._update();
        break;
      }

      case 'generateRunbooks': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace folder first to generate handoff documents.');
          return;
        }
        const state = this._contextManager.getState();
        const docsDir = path.join(ws, 'docs');
        if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

        const archDoc = RunbookGenerator.generateArchitectureDoc(state);
        const deployRunbook = RunbookGenerator.generateDeploymentRunbook(state);
        const dataDict = RunbookGenerator.generateDataDictionary(state);
        const envCatalog = RunbookGenerator.generateEnvironmentCatalog(state);
        const completeHandoff = RunbookGenerator.generateCompleteHandoffPackage(state);

        fs.writeFileSync(path.join(docsDir, 'ARCHITECTURE.md'), archDoc, 'utf8');
        fs.writeFileSync(path.join(docsDir, 'DEPLOYMENT_RUNBOOK.md'), deployRunbook, 'utf8');
        fs.writeFileSync(path.join(docsDir, 'DATA_DICTIONARY.md'), dataDict, 'utf8');
        fs.writeFileSync(path.join(docsDir, 'ENVIRONMENT_CATALOG.md'), envCatalog, 'utf8');
        fs.writeFileSync(path.join(docsDir, 'CLIENT_HANDOFF_COMPLETE.md'), completeHandoff, 'utf8');

        await this._contextManager.recordRunbooksGenerated();

        vscode.window.showInformationMessage('✓ Generated 5 complete client handoff docs in docs/');
        this._panel.webview.postMessage({
          type: 'runbooksDone',
          files: ['docs/ARCHITECTURE.md', 'docs/DEPLOYMENT_RUNBOOK.md', 'docs/DATA_DICTIONARY.md', 'docs/ENVIRONMENT_CATALOG.md', 'docs/CLIENT_HANDOFF_COMPLETE.md'],
          archDoc,
          deployRunbook,
          dataDict,
          envCatalog,
          completeHandoff,
          docsPath: docsDir
        });
        this._update();
        break;
      }
    }
  }

  private _update(): void {
    const state = this._contextManager.getState();
    this._panel.webview.html = this._getHtmlForWebview(state);
  }

  private _getHtmlForWebview(state: FdeEngagementState): string {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const store = this._contextManager.getStore();
    const allProjects = store.projects;
    const activeProjectId = store.activeProjectId;

    const archPath = ws ? path.join(ws, 'docs', 'ARCHITECTURE.md') : '';
    const deployPath = ws ? path.join(ws, 'docs', 'DEPLOYMENT_RUNBOOK.md') : '';
    const dataDictPath = ws ? path.join(ws, 'docs', 'DATA_DICTIONARY.md') : '';
    const envPath = ws ? path.join(ws, 'docs', 'ENVIRONMENT_CATALOG.md') : '';
    const completePath = ws ? path.join(ws, 'docs', 'CLIENT_HANDOFF_COMPLETE.md') : '';
    const archExists = archPath ? fs.existsSync(archPath) : false;
    const deployExists = deployPath ? fs.existsSync(deployPath) : false;
    const dataDictExists = dataDictPath ? fs.existsSync(dataDictPath) : false;
    const envExists = envPath ? fs.existsSync(envPath) : false;
    const completeExists = completePath ? fs.existsSync(completePath) : false;
    const anyDocExists = archExists || deployExists || dataDictExists || envExists || completeExists;

    const initialArchDoc = archExists ? fs.readFileSync(archPath, 'utf8') : RunbookGenerator.generateArchitectureDoc(state);
    const initialDeployDoc = deployExists ? fs.readFileSync(deployPath, 'utf8') : RunbookGenerator.generateDeploymentRunbook(state);
    const initialDataDictDoc = dataDictExists ? fs.readFileSync(dataDictPath, 'utf8') : RunbookGenerator.generateDataDictionary(state);
    const initialEnvDoc = envExists ? fs.readFileSync(envPath, 'utf8') : RunbookGenerator.generateEnvironmentCatalog(state);
    const initialCompleteDoc = completeExists ? fs.readFileSync(completePath, 'utf8') : RunbookGenerator.generateCompleteHandoffPackage(state);

    const progressPercent = Math.round((state.completedPhases.length / 4) * 100);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FDE Delivery Studio (Beta)</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #cccccc);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --card-alt: var(--vscode-sideBar-background, #2d2d2d);
      --border: var(--vscode-widget-border, #3c3c3c);
      --accent: var(--vscode-button-background, #0078d4);
      --accent-hover: var(--vscode-button-hoverBackground, #0063b1);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --success: #4ec9b0;
      --success-bg: rgba(78, 201, 176, 0.15);
      --warn: #cca700;
      --warn-bg: rgba(204, 167, 0, 0.15);
      --error: #f14c4c;
      --error-bg: rgba(241, 76, 76, 0.15);
    }
    * { box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .header-title {
      font-size: 20px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .beta-pill {
      font-size: 11px;
      background: var(--accent);
      color: var(--accent-fg);
      padding: 2px 8px;
      border-radius: 12px;
      text-transform: uppercase;
      font-weight: 600;
    }

    /* Overall Progress Bar */
    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: var(--card-bg);
      border-radius: 3px;
      margin-bottom: 20px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--success));
      width: ${progressPercent}%;
      transition: width 0.3s ease;
    }

    /* Stepper */
    .stepper {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .step-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }
    .step-card:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .step-card.active {
      border-color: var(--accent);
      background: var(--card-alt);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .step-card.completed::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: var(--success);
    }
    .step-num {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--accent);
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }
    .step-name {
      font-size: 14px;
      font-weight: 600;
    }

    /* Main Grid */
    .main-grid {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 24px;
    }
    .sidebar-nav {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .nav-btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 12px 14px;
      border-radius: 6px;
      text-align: left;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.15s ease;
    }
    .nav-btn:hover {
      background: var(--card-alt);
      border-color: var(--accent);
    }
    .nav-btn.active {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
      font-weight: 600;
    }

    /* Content Cards */
    .content-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }
    .content-card h3 {
      margin-top: 0;
      margin-bottom: 6px;
      font-size: 16px;
    }
    .content-card p.desc {
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 18px;
    }

    /* Inputs & Form Controls */
    input[type="text"], select, textarea {
      width: 100%;
      padding: 8px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 4px;
      font-family: inherit;
      font-size: 13px;
      margin-bottom: 14px;
    }
    textarea {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 12px;
      resize: vertical;
    }
    input[type="text"]:focus, select:focus, textarea:focus {
      outline: 1px solid var(--accent);
      border-color: var(--accent);
    }
    
    /* Buttons */
    .btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-secondary:hover {
      background: var(--card-alt);
      border-color: var(--fg);
    }
    .btn-quick {
      font-size: 11px;
      padding: 3px 8px;
      background: var(--card-alt);
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 8px;
      display: inline-block;
    }
    .btn-quick:hover { border-color: var(--accent); color: var(--accent); }

    /* Preflight Badge & Findings */
    .audit-score-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 24px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 6px;
      margin-bottom: 12px;
    }
    .finding-row {
      padding: 10px 14px;
      background: var(--bg);
      border-left: 4px solid var(--warn);
      margin-bottom: 8px;
      font-size: 12px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .finding-row.error { border-color: var(--error); background: var(--error-bg); }
    .finding-row.warning { border-color: var(--warn); background: var(--warn-bg); }

    /* Code Preview & Tabs */
    .code-tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .code-tab {
      padding: 4px 12px;
      font-size: 12px;
      background: var(--card-alt);
      border: 1px solid var(--border);
      border-bottom: none;
      cursor: pointer;
      border-radius: 4px 4px 0 0;
    }
    .code-tab.active {
      background: var(--bg);
      border-color: var(--accent);
      font-weight: 600;
    }
    .code-preview {
      background: var(--bg);
      padding: 14px;
      border-radius: 6px;
      border: 1px solid var(--border);
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 12px;
      max-height: 280px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    /* Table */
    .mapping-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 12px;
    }
    .mapping-table th, .mapping-table td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
    }
    .mapping-table th { background: var(--card-alt); font-weight: 600; }
    .conf-pill {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: bold;
    }
    .conf-high { background: var(--success-bg); color: var(--success); }
    .conf-mid { background: var(--warn-bg); color: var(--warn); }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--card-bg);
      border: 1px solid var(--accent);
      color: var(--fg);
      padding: 12px 18px;
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      display: none;
      z-index: 1000;
      font-size: 13px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-title">
      <span>🚀</span> FDE Delivery Studio <span class="beta-pill">Beta</span>
    </div>
    <div style="display: flex; gap: 10px; align-items: center;">
      <button class="btn btn-secondary" onclick="toggleRoadmap()" style="padding: 5px 12px; font-size: 12px;">🗺️ Roadmap &amp; Playbook</button>
      <div style="display: flex; align-items: center; gap: 6px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px;">
        <span style="font-size: 11px; font-weight: 700; opacity: 0.85;">Client:</span>
        <input type="text" id="clientNameInput" value="${state.clientName}" placeholder="Client Name..." style="width: 200px; margin-bottom: 0; padding: 4px 8px; border: none; background: transparent; font-weight: 600;" onchange="updateClientName(this.value)">
      </div>
    </div>
  </div>

  <!-- Multi-Project Switcher & Toolbar -->
  <div style="background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--accent);">Engagement:</span>
      <select id="projectSelector" onchange="switchProject(this.value)" style="padding: 5px 10px; font-size: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--fg); font-weight: 600; width: auto; margin-bottom: 0; min-width: 240px;">
        ${allProjects.map(p => `<option value="${p.id}" ${p.id === activeProjectId ? 'selected' : ''}>🏢 ${p.clientName} (${p.targetVpc})</option>`).join('')}
      </select>
      <button class="btn-quick" style="margin-bottom: 0;" onclick="promptNewProject()">➕ New Project</button>
      <button class="btn-quick" style="margin-bottom: 0; color: var(--warn); border-color: var(--warn);" onclick="confirmResetProject()">🧹 Reset / Redo</button>
      ${allProjects.length > 1 ? `<button class="btn-quick" style="margin-bottom: 0; color: var(--error); border-color: var(--error);" onclick="confirmDeleteProject('${state.id}')">🗑️ Delete</button>` : ''}
    </div>
    <div style="font-size: 11px; opacity: 0.85;">
      <span><strong>Target VPC:</strong> <code>${state.targetVpc}</code></span>
      <span style="margin: 0 8px;">•</span>
      <span><strong>Artifacts:</strong> ${state.schemaMappings.length} models, ${state.apiConnectors.length} APIs</span>
    </div>
  </div>

  <!-- Overall Progress Bar -->
  <div class="progress-bar-container" title="Engagement Progress: ${progressPercent}%">
    <div class="progress-bar-fill"></div>
  </div>

  <!-- DIAGRAMMATIC ROADMAP & PLAYBOOK BANNER -->
  <div id="roadmapBanner" style="display: none; background: var(--card-bg); border: 1px solid var(--accent); border-radius: 8px; padding: 18px 22px; margin-bottom: 24px; box-shadow: 0 6px 20px rgba(0,0,0,0.25);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <h4 style="margin: 0; font-size: 15px; color: var(--accent); font-weight: 700;">🗺️ 14-Day Forward Deployed Delivery Roadmap</h4>
      <button class="btn-secondary" onclick="toggleRoadmap()" style="border: none; cursor: pointer; font-size: 14px;">✕</button>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px;">
      <div style="background: var(--bg); padding: 14px; border-radius: 6px; border-top: 3px solid var(--accent);">
        <div style="font-size: 11px; font-weight: bold; color: var(--accent);">PHASE 1 (DAYS 1–3)</div>
        <div style="font-size: 13px; font-weight: 600; margin: 4px 0;">Data &amp; Schema Ingest</div>
        <div style="font-size: 11px; opacity: 0.85; line-height: 1.4;">
          • Ingest dirty CSV / Oracle / SQL<br>
          • Semantic field alignment<br>
          • Generate dbt / PySpark staging<br>
          • Data quality anomaly audit
        </div>
      </div>

      <div style="background: var(--bg); padding: 14px; border-radius: 6px; border-top: 3px solid var(--accent);">
        <div style="font-size: 11px; font-weight: bold; color: var(--accent);">PHASE 2 (DAYS 4–7)</div>
        <div style="font-size: 13px; font-weight: 600; margin: 4px 0;">Client API Integrations</div>
        <div style="font-size: 11px; opacity: 0.85; line-height: 1.4;">
          • Paste cURL / OpenAPI specs<br>
          • Generate typed TypeScript/Python SDK<br>
          • Exponential backoff &amp; rate limits<br>
          • Offline mock unit test fixtures
        </div>
      </div>

      <div style="background: var(--bg); padding: 14px; border-radius: 6px; border-top: 3px solid var(--accent);">
        <div style="font-size: 11px; font-weight: bold; color: var(--accent);">PHASE 3 (DAYS 8–11)</div>
        <div style="font-size: 13px; font-weight: 600; margin: 4px 0;">Validate &amp; Pilot Deploy</div>
        <div style="font-size: 11px; opacity: 0.85; line-height: 1.4;">
          • Deterministic Pre-Flight Audit<br>
          • Clean .bak &amp; temp files<br>
          • Scaffold Firebase &amp; Cloud Run<br>
          • Execute deploy.sh / deploy.ps1
        </div>
      </div>

      <div style="background: var(--bg); padding: 14px; border-radius: 6px; border-top: 3px solid var(--accent);">
        <div style="font-size: 11px; font-weight: bold; color: var(--accent);">PHASE 4 (DAYS 12–14)</div>
        <div style="font-size: 13px; font-weight: 600; margin: 4px 0;">Handoff &amp; Runbooks</div>
        <div style="font-size: 11px; opacity: 0.85; line-height: 1.4;">
          • Render Mermaid architecture diagrams<br>
          • Compile DEPLOYMENT_RUNBOOK.md<br>
          • Auto-generate DATA_DICTIONARY.md<br>
          • Operational handoff to client IT
        </div>
      </div>
    </div>
    
    <div style="font-size: 12px; opacity: 0.85; border-top: 1px solid var(--border); padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
      <span>💡 Full playbook with Mermaid architecture diagrams available in <code>docs/FDE_PLAYBOOK.md</code>.</span>
      <button class="btn btn-secondary" onclick="openDoc('docs/FDE_PLAYBOOK.md')" style="padding: 3px 8px; font-size: 11px;">Open Playbook</button>
    </div>
  </div>

  <!-- Stepper -->
  <div class="stepper">
    <div class="step-card ${state.activePhase === 1 ? 'active' : ''} ${state.completedPhases.includes(1) ? 'completed' : ''}" onclick="setPhase(1)">
      <div class="step-num"><span>Step 1</span> ${state.completedPhases.includes(1) ? '<span style="color:var(--success)">✓ Done</span>' : ''}</div>
      <div class="step-name">Ingest &amp; Map</div>
    </div>
    <div class="step-card ${state.activePhase === 2 ? 'active' : ''} ${state.completedPhases.includes(2) ? 'completed' : ''}" onclick="setPhase(2)">
      <div class="step-num"><span>Step 2</span> ${state.completedPhases.includes(2) ? '<span style="color:var(--success)">✓ Done</span>' : ''}</div>
      <div class="step-name">Client APIs</div>
    </div>
    <div class="step-card ${state.activePhase === 3 ? 'active' : ''} ${state.completedPhases.includes(3) ? 'completed' : ''}" onclick="setPhase(3)">
      <div class="step-num"><span>Step 3</span> ${state.completedPhases.includes(3) ? '<span style="color:var(--success)">✓ Done</span>' : ''}</div>
      <div class="step-name">Validate &amp; Deploy</div>
    </div>
    <div class="step-card ${state.activePhase === 4 ? 'active' : ''} ${state.completedPhases.includes(4) ? 'completed' : ''}" onclick="setPhase(4)">
      <div class="step-num"><span>Step 4</span> ${state.completedPhases.includes(4) ? '<span style="color:var(--success)">✓ Done</span>' : ''}</div>
      <div class="step-name">Handoff &amp; Docs</div>
    </div>
  </div>

  <!-- Main Grid -->
  <div class="main-grid">
    <div class="sidebar-nav">
      <button class="nav-btn ${state.activePhase === 1 ? 'active' : ''}" onclick="setPhase(1)">📊 1. Schema Mapper</button>
      <button class="nav-btn ${state.activePhase === 2 ? 'active' : ''}" onclick="setPhase(2)">🔌 2. Client API Studio</button>
      <button class="nav-btn ${state.activePhase === 3 ? 'active' : ''}" onclick="setPhase(3)">⚡ 3. Pilot Deployment</button>
      <button class="nav-btn ${state.activePhase === 4 ? 'active' : ''}" onclick="setPhase(4)">📑 4. Runbook Factory</button>
    </div>

    <div>
      <!-- PHASE 1: SCHEMA MAPPER -->
      <div class="content-card" id="phase1" style="display: ${state.activePhase === 1 ? 'block' : 'none'};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
          <div>
            <h3>📊 Semantic Schema Mapper &amp; Staging Generator</h3>
            <p class="desc">Align foreign client CSVs, JSON feeds, or SQL tables with your standard platform target models using fuzzy semantic matching.</p>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn-quick" onclick="pickSchemaFile()">📁 Browse CSV / Schema File</button>
            <button class="btn-quick" onclick="loadSampleSchema('orders')">⚡ Sample Orders</button>
            <button class="btn-quick" onclick="loadSampleSchema('users')">⚡ Sample Users</button>
          </div>
        </div>

        <!-- Mapped Schemas in Current Engagement -->
        ${state.schemaMappings.length > 0 ? `
        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px; color: var(--success);">
            Mapped Models in Active Engagement (${state.schemaMappings.length}):
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${state.schemaMappings.map(m => `
              <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px;">
                <div>
                  <strong>${m.targetModelName}</strong> <span style="opacity: 0.75;">(from <code>${m.sourceName}</code> • ${m.columns.length} cols • ${m.dialect})</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="openDoc('models/staging/${m.targetModelName}.sql')">📄 Open</button>
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px; color: var(--error); border-color: var(--error);" onclick="deleteSchemaMapping('${m.sourceName}')">🗑️ Remove</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Guided Step Helper Banner -->
        <div style="background: var(--card-alt); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-weight: 700; color: var(--accent);">📌 Quick Start:</span>
            <span> Browse a local CSV/SQL file, click a sample, or paste columns in <code>COLUMN:type</code> format.</span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <span style="font-size: 11px; opacity: 0.8;">Target Presets:</span>
            <button class="btn-quick" style="margin-bottom: 0;" onclick="loadTargetPreset('orders')">📦 Orders</button>
            <button class="btn-quick" style="margin-bottom: 0;" onclick="loadTargetPreset('users')">👥 Users</button>
            <button class="btn-quick" style="margin-bottom: 0;" onclick="loadTargetPreset('payments')">💳 Payments</button>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label style="font-size: 11px; font-weight: bold;">Source Columns (Raw Client Schema)</label>
              <span id="srcFileBadge" style="font-size: 10px; opacity: 0.85; font-family: monospace; color: var(--success);"></span>
            </div>
            <textarea id="srcCols" style="height: 140px;" placeholder="Paste raw columns here or click 'Browse CSV / Schema File'...&#10;e.g.&#10;CUST_NBR_ID:string&#10;TXN_AMT:float&#10;CREATED_TS:timestamp&#10;IS_ACTIVE_FLG:string"></textarea>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label style="font-size: 11px; font-weight: bold;">Target Model Columns (Platform Standard)</label>
              <span style="font-size: 10px; opacity: 0.8;">Standardized schema</span>
            </div>
            <textarea id="tgtCols" style="height: 140px;" placeholder="Target columns or pick a preset above...&#10;e.g.&#10;customer_id:string&#10;transaction_amount:numeric&#10;created_at:timestamp&#10;is_active:boolean"></textarea>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px;">
          <div>
            <label style="font-size: 11px; font-weight: bold;">Source Table / Dataset Name</label>
            <input type="text" id="srcNameInput" value="client_orders_raw" placeholder="e.g. client_orders_raw">
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold;">Target Model Name (dbt / View)</label>
            <input type="text" id="modelNameInput" value="stg_orders" placeholder="e.g. stg_orders">
          </div>
        </div>

        <div id="schemaErrorAlert" style="display: none; background: var(--error-bg); border: 1px solid var(--error); color: var(--error); padding: 10px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 14px;"></div>

        <div style="display: flex; gap: 10px; align-items: center;">
          <button class="btn" onclick="generateSchemaMapping()">🚀 Generate dbt Staging Model</button>
          <span style="font-size: 11px; opacity: 0.75;">Automatically creates <code>models/staging/&lt;model_name&gt;.sql</code></span>
        </div>

        <!-- Generated Model Result Card -->
        <div id="schemaResultBox" style="margin-top: 20px; display: none;">
          <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 12px 16px; border-radius: 6px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="color: var(--success); font-weight: 700; font-size: 13px;">✓ Staging Model Successfully Generated</div>
              <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;" id="schemaSavedBadge">Location: <code>models/staging/stg_orders.sql</code></div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn-quick" style="margin-bottom: 0;" onclick="openGeneratedModel()">📄 Open Model in Editor</button>
              <button class="btn-quick" style="margin-bottom: 0;" onclick="copyModelCode()">📋 Copy Code</button>
            </div>
          </div>

          <div class="code-tabs">
            <div class="code-tab active" id="tabDbt" onclick="switchSchemaTab('dbt')">🧱 dbt SQL Model</div>
            <div class="code-tab" id="tabPySpark" onclick="switchSchemaTab('pyspark')">⚡ PySpark Script</div>
            <div class="code-tab" id="tabSqlView" onclick="switchSchemaTab('sqlView')">🗄️ Standard SQL View</div>
          </div>
          <pre id="schemaCodePreview" class="code-preview" style="max-height: 260px;"></pre>
          
          <h4 style="margin: 18px 0 10px 0;">Column Semantic Mapping Breakdown</h4>
          <div id="schemaTableContainer"></div>
        </div>
      </div>

      <!-- PHASE 2: API CONNECTORS -->
      <div class="content-card" id="phase2" style="display: ${state.activePhase === 2 ? 'block' : 'none'};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h3>🔌 Resilient Client API &amp; Webhook Studio</h3>
            <p class="desc">Scaffold fault-tolerant client SDKs with exponential backoff, rate-limiting, and auth handling.</p>
          </div>
          <button class="btn-quick" onclick="loadSampleApi()">⚡ Load Sample Billing API</button>
        </div>

        <!-- Configured APIs in Current Engagement -->
        ${state.apiConnectors.length > 0 ? `
        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px; color: var(--success);">
            Connected APIs in Active Engagement (${state.apiConnectors.length}):
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${state.apiConnectors.map(c => `
              <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px;">
                <div>
                  <strong>${c.connectorName}</strong> <span style="opacity: 0.75;">(<code>${c.baseUrl}</code> • Auth: ${c.authType} • ${c.targetLanguage})</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="openDoc('src/connectors/${c.connectorName.toLowerCase()}.${c.targetLanguage === 'python' ? 'py' : 'ts'}')">📄 Open</button>
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px; color: var(--error); border-color: var(--error);" onclick="deleteApiConnector('${c.connectorName}')">🗑️ Remove</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div>
            <label style="font-size: 11px; font-weight: bold;">Connector Name</label>
            <input type="text" id="connName" value="ClientBillingApi">
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold;">Base URL</label>
            <input type="text" id="connBaseUrl" value="https://api.client-vpc.internal/v1">
          </div>
        </div>

        <label style="font-size: 11px; font-weight: bold;">Authentication Strategy</label>
        <select id="connAuthType">
          <option value="bearer">Bearer Token (Authorization: Bearer ...)</option>
          <option value="apiKey">API Key (x-api-key header)</option>
          <option value="oauth2">OAuth2 Client Credentials</option>
          <option value="none">None / Public</option>
        </select>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="btn" onclick="generateApiConnector('typescript')">Scaffold TypeScript SDK</button>
          <button class="btn btn-secondary" onclick="generateApiConnector('python')">Scaffold Python SDK</button>
        </div>

        <div id="apiResultBox" style="margin-top: 20px; display: none;">
          <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 12px 16px; border-radius: 6px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="color: var(--success); font-weight: 700; font-size: 13px;">✓ Client API Connector Scaffolded</div>
              <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;" id="apiSavedBadge">Location: <code>src/connectors/ClientBillingApi.ts</code></div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn-quick" style="margin-bottom: 0;" onclick="openGeneratedApiSdk()">📄 Open SDK in Editor</button>
              <button class="btn-quick" style="margin-bottom: 0;" onclick="copyApiSdkCode()">📋 Copy SDK</button>
            </div>
          </div>

          <div class="code-tabs">
            <div class="code-tab active" id="tabTs" onclick="switchApiTab('ts')">TypeScript SDK</div>
            <div class="code-tab" id="tabPy" onclick="switchApiTab('py')">Python SDK</div>
          </div>
          <pre class="code-preview" id="apiCodePreview"></pre>
        </div>
      </div>

      <!-- PHASE 3: PILOT DEPLOYMENT & PRE-FLIGHT -->
      <div class="content-card" id="phase3" style="display: ${state.activePhase === 3 ? 'block' : 'none'};">
        <h3>⚡ Pilot Deployment &amp; Pre-Flight Delivery</h3>
        <p class="desc">Audit workspace health, configure Firebase Hosting + Cloud Run, and generate deploy automation.</p>

        <!-- Pre-Flight Audit Card -->
        <div style="background: var(--bg); padding: 18px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 14px;">🛡️ Pre-Flight Health Auditor (100% Deterministic)</div>
              <div style="font-size: 12px; opacity: 0.85;">Scans for dangling backup files, secret leaks, and .env parity with 0 network calls.</div>
            </div>
            <button class="btn" onclick="runAudit()">Run Pre-Flight Audit</button>
          </div>
          
          <div id="auditBox" style="margin-top: 16px; display: none;">
            <div class="audit-score-pill" id="auditScoreVal">--</div>
            <div id="findingsList"></div>
            <div id="cleanupBtnContainer" style="margin-top: 10px; display: none;">
              <button class="btn btn-secondary" onclick="cleanTempFiles()">🧹 Clean All Temporary Files</button>
            </div>
          </div>
        </div>

        <!-- 1-Click Scaffolder -->
        <h4>📦 1-Click Deployment Scaffolding (Firebase + Cloud Run)</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div>
            <label style="font-size: 11px; font-weight: bold;">GCP / Firebase Project ID</label>
            <input type="text" id="gcpProjId" value="acme-pilot-2026">
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold;">Frontend Public Build Directory</label>
            <input type="text" id="pubBuildDir" value="dist">
          </div>
        </div>

        <button class="btn" onclick="scaffoldDeployment()">Scaffold Firebase, Cloud Run &amp; Deploy Scripts</button>
        
        <div id="scaffoldResultBox" style="margin-top: 16px; display: none;">
          <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 12px; border-radius: 6px; font-size: 12px;">
            <strong>✓ Successfully Scaffolded:</strong>
            <ul style="margin: 6px 0 0 0; padding-left: 18px;">
              <li><code>firebase.json</code> (SPA rewrites, immutable caching rules, security headers)</li>
              <li><code>.firebaserc</code> (multi-target mapping: dev, test, pilot, prod)</li>
              <li><code>scripts/deploy.sh</code> &amp; <code>scripts/deploy.ps1</code></li>
              <li><code>.github/workflows/deploy.yml</code></li>
            </ul>
          </div>
        </div>
      </div>

      <!-- PHASE 4: RUNBOOK FACTORY -->
      <div class="content-card" id="phase4" style="display: ${state.activePhase === 4 ? 'block' : 'none'};">
        <h3>📑 Client Engagement Handoff &amp; Runbook Factory</h3>
        <p class="desc">Auto-generate comprehensive architecture blueprints with dynamic lineage, operations runbooks, data dictionaries, and executive handoff bundles connecting everything built in Steps 1–3.</p>

        <div style="background: var(--bg); padding: 18px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 20px;">
          <div style="font-weight: 700; margin-bottom: 12px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
            <span>Generated Documentation Artifacts:</span>
            <span style="font-size: 11px; opacity: 0.85; font-family: monospace;" id="docsPathBadge">📁 ${ws ? path.join(ws, 'docs') : 'docs/'}</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 600; font-size: 12px;">🏛️ ARCHITECTURE.md</div>
                <span id="badgeArch" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${archExists ? 'var(--success-bg)' : 'var(--badge-bg)'}; color: ${archExists ? 'var(--success)' : 'inherit'}; font-weight: 600;">${archExists ? '✓ Ready' : 'Not generated'}</span>
              </div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 10px 0;">Mermaid data lineage &amp; topology</div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-quick" onclick="openDoc('docs/ARCHITECTURE.md')">📄 Open</button>
                <button class="btn-quick" onclick="previewDoc('docs/ARCHITECTURE.md')">👁️ Preview</button>
              </div>
            </div>

            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 600; font-size: 12px;">🚀 DEPLOYMENT_RUNBOOK.md</div>
                <span id="badgeDeploy" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${deployExists ? 'var(--success-bg)' : 'var(--badge-bg)'}; color: ${deployExists ? 'var(--success)' : 'inherit'}; font-weight: 600;">${deployExists ? '✓ Ready' : 'Not generated'}</span>
              </div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 10px 0;">Operations, rollback &amp; diagnostics</div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-quick" onclick="openDoc('docs/DEPLOYMENT_RUNBOOK.md')">📄 Open</button>
                <button class="btn-quick" onclick="previewDoc('docs/DEPLOYMENT_RUNBOOK.md')">👁️ Preview</button>
              </div>
            </div>

            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 600; font-size: 12px;">📖 DATA_DICTIONARY.md</div>
                <span id="badgeDataDict" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${dataDictExists ? 'var(--success-bg)' : 'var(--badge-bg)'}; color: ${dataDictExists ? 'var(--success)' : 'inherit'}; font-weight: 600;">${dataDictExists ? '✓ Ready' : 'Not generated'}</span>
              </div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 10px 0;">Column transformation mappings</div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-quick" onclick="openDoc('docs/DATA_DICTIONARY.md')">📄 Open</button>
                <button class="btn-quick" onclick="previewDoc('docs/DATA_DICTIONARY.md')">👁️ Preview</button>
              </div>
            </div>

            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 600; font-size: 12px;">🔐 ENVIRONMENT_CATALOG.md</div>
                <span id="badgeEnv" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${envExists ? 'var(--success-bg)' : 'var(--badge-bg)'}; color: ${envExists ? 'var(--success)' : 'inherit'}; font-weight: 600;">${envExists ? '✓ Ready' : 'Not generated'}</span>
              </div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 10px 0;">Required env vars &amp; secret reference</div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-quick" onclick="openDoc('docs/ENVIRONMENT_CATALOG.md')">📄 Open</button>
                <button class="btn-quick" onclick="previewDoc('docs/ENVIRONMENT_CATALOG.md')">👁️ Preview</button>
              </div>
            </div>

            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 600; font-size: 12px;">📦 CLIENT_HANDOFF_COMPLETE.md</div>
                <span id="badgeComplete" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: ${completeExists ? 'var(--success-bg)' : 'var(--badge-bg)'}; color: ${completeExists ? 'var(--success)' : 'inherit'}; font-weight: 600;">${completeExists ? '✓ Ready' : 'Not generated'}</span>
              </div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 10px 0;">All-in-one consolidated delivery bundle</div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-quick" onclick="openDoc('docs/CLIENT_HANDOFF_COMPLETE.md')">📄 Open</button>
                <button class="btn-quick" onclick="previewDoc('docs/CLIENT_HANDOFF_COMPLETE.md')">👁️ Preview</button>
              </div>
            </div>
          </div>
        </div>

        <button class="btn" onclick="generateRunbooks()">🚀 Generate All Client Handoff Docs</button>

        <!-- Live Document Viewer Container -->
        <div id="runbookResultBox" style="margin-top: 20px; display: ${anyDocExists ? 'block' : 'none'};">
          <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 12px 16px; border-radius: 6px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="color: var(--success); font-weight: 700; font-size: 13px;">✓ Client Handoff Documents Ready on Disk</div>
              <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;" id="docsPathLabel">Location: <code>${ws ? path.join(ws, 'docs') : 'docs/'}</code></div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn-quick" style="margin-bottom: 0;" onclick="openActiveDoc()">📄 Open in Editor</button>
              <button class="btn-quick" style="margin-bottom: 0;" onclick="previewActiveDoc()">👁️ Rendered Preview</button>
            </div>
          </div>

          <div class="code-tabs">
            <div class="code-tab active" id="tabArch" onclick="switchDocTab('arch')">🏛️ ARCHITECTURE.md</div>
            <div class="code-tab" id="tabDeploy" onclick="switchDocTab('deploy')">🚀 DEPLOYMENT_RUNBOOK.md</div>
            <div class="code-tab" id="tabDataDict" onclick="switchDocTab('dataDict')">📖 DATA_DICTIONARY.md</div>
            <div class="code-tab" id="tabEnv" onclick="switchDocTab('env')">🔐 ENVIRONMENT_CATALOG.md</div>
            <div class="code-tab" id="tabComplete" onclick="switchDocTab('complete')">📦 CLIENT_HANDOFF_COMPLETE.md</div>
          </div>
          <pre id="docCodePreview" class="code-preview" style="max-height: 380px;"></pre>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal for Creating New Engagement Project -->
  <div id="newProjectModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.6); z-index: 2000; align-items: center; justify-content: center;">
    <div style="background: var(--card-bg); border: 1px solid var(--accent); border-radius: 8px; padding: 24px; width: 440px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);">
      <h3 style="margin: 0 0 14px 0; font-size: 16px; color: var(--accent);">➕ Create New Client Engagement Project</h3>
      
      <label style="font-size: 11px; font-weight: bold;">Client / Project Name</label>
      <input type="text" id="newProjName" placeholder="e.g. Acme Health Pilot" style="margin-bottom: 12px;">
      
      <label style="font-size: 11px; font-weight: bold;">Target Infrastructure / VPC</label>
      <select id="newProjVpc" style="margin-bottom: 12px;">
        <option value="gcp-firebase">Google Cloud (Firebase + Cloud Run + BigQuery)</option>
        <option value="aws">AWS (ECS + Fargate + S3 + Glue)</option>
        <option value="docker">On-Premise / Air-Gapped Docker</option>
        <option value="azure">Azure (Container Apps + Blob)</option>
      </select>

      <label style="font-size: 11px; font-weight: bold;">Engagement Objective / Goal</label>
      <input type="text" id="newProjGoal" placeholder="e.g. Ingest EHR patient records and deploy staging models" style="margin-bottom: 18px;">

      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary" onclick="closeNewProjectModal()">Cancel</button>
        <button class="btn" onclick="submitNewProject()">Create Project</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentTsCode = '';
    let currentPyCode = '';
    let currentWrittenApiSdk = '';
    let currentDbtSql = '';
    let currentPySparkSql = '';
    let currentSqlView = '';
    let currentWrittenModelPath = '';
    let activeSchemaTab = 'dbt';
    let currentArchDoc = ${JSON.stringify(initialArchDoc)};
    let currentDeployDoc = ${JSON.stringify(initialDeployDoc)};
    let currentDataDictDoc = ${JSON.stringify(initialDataDictDoc)};
    let currentEnvDoc = ${JSON.stringify(initialEnvDoc)};
    let currentCompleteDoc = ${JSON.stringify(initialCompleteDoc)};
    let activeDocTab = 'arch';

    function showToast(msg) {
      const t = document.getElementById('toast');
      if (t) {
        t.innerText = msg;
        t.style.display = 'block';
        setTimeout(() => { t.style.display = 'none'; }, 3500);
      }
    }

    function toggleRoadmap() {
      const banner = document.getElementById('roadmapBanner');
      if (banner) {
        banner.style.display = (banner.style.display === 'none' || !banner.style.display) ? 'block' : 'none';
      }
    }

    function switchProject(id) {
      vscode.postMessage({ command: 'switchProject', projectId: id });
    }

    function promptNewProject() {
      const modal = document.getElementById('newProjectModal');
      if (modal) {
        modal.style.display = 'flex';
        const nameInput = document.getElementById('newProjName');
        if (nameInput) nameInput.focus();
      }
    }

    function closeNewProjectModal() {
      const modal = document.getElementById('newProjectModal');
      if (modal) modal.style.display = 'none';
    }

    function submitNewProject() {
      const name = document.getElementById('newProjName').value.trim();
      const vpc = document.getElementById('newProjVpc').value;
      const goal = document.getElementById('newProjGoal').value.trim();
      if (!name) {
        showToast('⚠️ Please enter a project name!');
        return;
      }
      vscode.postMessage({
        command: 'createProject',
        projectName: name,
        targetVpc: vpc,
        engagementGoal: goal
      });
      closeNewProjectModal();
    }

    function confirmResetProject() {
      vscode.postMessage({ command: 'requestResetProject' });
    }

    function confirmDeleteProject(id) {
      vscode.postMessage({ command: 'requestDeleteProject', projectId: id });
    }

    function deleteSchemaMapping(srcName) {
      vscode.postMessage({ command: 'requestDeleteSchemaMapping', sourceName: srcName });
    }

    function deleteApiConnector(connName) {
      vscode.postMessage({ command: 'requestDeleteApiConnector', connectorName: connName });
    }

    function updateClientName(val) {
      vscode.postMessage({ command: 'updateClientName', clientName: val });
      showToast('Client Name updated');
    }

    function setPhase(p) {
      vscode.postMessage({ command: 'setActivePhase', phase: p });
    }

    function openDoc(relPath) {
      vscode.postMessage({ command: 'openFileInEditor', relativePath: relPath });
    }

    function previewDoc(relPath) {
      vscode.postMessage({ command: 'previewMarkdown', relativePath: relPath });
    }

    function openActiveDoc() {
      const map = {
        arch: 'docs/ARCHITECTURE.md',
        deploy: 'docs/DEPLOYMENT_RUNBOOK.md',
        dataDict: 'docs/DATA_DICTIONARY.md',
        env: 'docs/ENVIRONMENT_CATALOG.md',
        complete: 'docs/CLIENT_HANDOFF_COMPLETE.md'
      };
      openDoc(map[activeDocTab] || 'docs/ARCHITECTURE.md');
    }

    function previewActiveDoc() {
      const map = {
        arch: 'docs/ARCHITECTURE.md',
        deploy: 'docs/DEPLOYMENT_RUNBOOK.md',
        dataDict: 'docs/DATA_DICTIONARY.md',
        env: 'docs/ENVIRONMENT_CATALOG.md',
        complete: 'docs/CLIENT_HANDOFF_COMPLETE.md'
      };
      previewDoc(map[activeDocTab] || 'docs/ARCHITECTURE.md');
    }

    function switchDocTab(docId) {
      activeDocTab = docId;
      const tabA = document.getElementById('tabArch');
      const tabD = document.getElementById('tabDeploy');
      const tabDD = document.getElementById('tabDataDict');
      const tabE = document.getElementById('tabEnv');
      const tabC = document.getElementById('tabComplete');
      if (tabA) tabA.className = 'code-tab ' + (docId === 'arch' ? 'active' : '');
      if (tabD) tabD.className = 'code-tab ' + (docId === 'deploy' ? 'active' : '');
      if (tabDD) tabDD.className = 'code-tab ' + (docId === 'dataDict' ? 'active' : '');
      if (tabE) tabE.className = 'code-tab ' + (docId === 'env' ? 'active' : '');
      if (tabC) tabC.className = 'code-tab ' + (docId === 'complete' ? 'active' : '');
      
      const prevEl = document.getElementById('docCodePreview');
      if (prevEl) {
        if (docId === 'arch') prevEl.innerText = currentArchDoc;
        else if (docId === 'deploy') prevEl.innerText = currentDeployDoc;
        else if (docId === 'dataDict') prevEl.innerText = currentDataDictDoc;
        else if (docId === 'env') prevEl.innerText = currentEnvDoc;
        else if (docId === 'complete') prevEl.innerText = currentCompleteDoc;
      }
    }

    function pickSchemaFile() {
      vscode.postMessage({ command: 'pickSchemaFile' });
    }

    function loadSampleSchema(kind) {
      if (kind === 'users') {
        document.getElementById('srcCols').value = "USR_UID:string\\nEMAIL_ADDR:string\\nREG_DT:date\\nROLE_CD:string\\nIS_ACTIVE_FLG:string";
        document.getElementById('tgtCols').value = "user_id:string\\nemail:string\\nregistered_at:timestamp\\nrole:string\\nis_active:boolean";
        document.getElementById('srcNameInput').value = "client_users_raw";
        document.getElementById('modelNameInput').value = "stg_users";
      } else {
        document.getElementById('srcCols').value = "CUST_NBR_ID:string\\nTXN_AMT:float\\nCREATED_TS:timestamp\\nIS_ACTIVE_FLG:string\\nRAW_GEO_CODE:string";
        document.getElementById('tgtCols').value = "customer_id:string\\ntransaction_amount:numeric\\ncreated_at:timestamp\\nis_active:boolean";
        document.getElementById('srcNameInput').value = "client_orders_raw";
        document.getElementById('modelNameInput').value = "stg_orders";
      }
      const errEl = document.getElementById('schemaErrorAlert');
      if (errEl) errEl.style.display = 'none';
      showToast('Sample schema loaded');
    }

    function loadTargetPreset(preset) {
      if (preset === 'orders') {
        document.getElementById('tgtCols').value = "customer_id:string\\ntransaction_amount:numeric\\ncreated_at:timestamp\\nis_active:boolean";
        document.getElementById('modelNameInput').value = "stg_orders";
      } else if (preset === 'users') {
        document.getElementById('tgtCols').value = "user_id:string\\nemail:string\\nregistered_at:timestamp\\nrole:string\\nis_active:boolean";
        document.getElementById('modelNameInput').value = "stg_users";
      } else if (preset === 'payments') {
        document.getElementById('tgtCols').value = "payment_id:string\\namount:numeric\\ncurrency:string\\nstatus:string\\ncreated_at:timestamp";
        document.getElementById('modelNameInput').value = "stg_payments";
      }
      showToast('Target preset loaded');
    }

    function generateSchemaMapping() {
      const src = document.getElementById('srcCols').value.trim();
      const tgt = document.getElementById('tgtCols').value.trim();
      const errEl = document.getElementById('schemaErrorAlert');

      if (!src || !tgt) {
        if (errEl) {
          errEl.innerHTML = '<strong>⚠️ Missing Input:</strong> Please load a CSV/schema file, click a sample button, or enter both Source and Target columns before generating.';
          errEl.style.display = 'block';
        }
        showToast('⚠️ Please provide source and target columns first!');
        return;
      }
      if (errEl) errEl.style.display = 'none';

      const srcName = document.getElementById('srcNameInput').value.trim() || 'client_orders_raw';
      const modelName = document.getElementById('modelNameInput').value.trim() || 'stg_orders';

      vscode.postMessage({
        command: 'generateSchemaMapping',
        sourceCols: src,
        targetCols: tgt,
        sourceName: srcName,
        modelName: modelName,
        writeToFile: true
      });
    }

    function switchSchemaTab(tab) {
      activeSchemaTab = tab;
      const tabDbt = document.getElementById('tabDbt');
      const tabPy = document.getElementById('tabPySpark');
      const tabView = document.getElementById('tabSqlView');
      if (tabDbt) tabDbt.className = 'code-tab ' + (tab === 'dbt' ? 'active' : '');
      if (tabPy) tabPy.className = 'code-tab ' + (tab === 'pyspark' ? 'active' : '');
      if (tabView) tabView.className = 'code-tab ' + (tab === 'sqlView' ? 'active' : '');

      const previewEl = document.getElementById('schemaCodePreview');
      if (previewEl) {
        if (tab === 'dbt') previewEl.innerText = currentDbtSql;
        else if (tab === 'pyspark') previewEl.innerText = currentPySparkSql;
        else if (tab === 'sqlView') previewEl.innerText = currentSqlView;
      }
    }

    function openGeneratedModel() {
      if (currentWrittenModelPath) {
        openDoc(currentWrittenModelPath);
      }
    }

    function copyModelCode() {
      const text = activeSchemaTab === 'dbt' ? currentDbtSql : (activeSchemaTab === 'pyspark' ? currentPySparkSql : currentSqlView);
      navigator.clipboard.writeText(text);
      showToast('✓ Code copied to clipboard!');
    }

    function loadSampleApi() {
      document.getElementById('connName').value = "StripeBillingApi";
      document.getElementById('connBaseUrl').value = "https://api.stripe.internal/v1";
      document.getElementById('connAuthType').value = "bearer";
      showToast('Sample API spec loaded');
    }

    function generateApiConnector(lang) {
      const name = document.getElementById('connName').value.trim();
      const url = document.getElementById('connBaseUrl').value.trim();
      const auth = document.getElementById('connAuthType').value;
      if (!name || !url) {
        showToast('⚠️ Please provide Connector Name and Base URL!');
        return;
      }
      vscode.postMessage({
        command: 'generateApiConnector',
        connectorName: name,
        baseUrl: url,
        authType: auth,
        targetLanguage: lang,
        endpoints: [
          { name: 'getInvoices', method: 'GET', path: '/invoices', description: 'Retrieve invoices' },
          { name: 'createInvoice', method: 'POST', path: '/invoices', description: 'Create a new invoice' }
        ],
        writeToFile: true
      });
    }

    function switchApiTab(lang) {
      document.getElementById('tabTs').className = 'code-tab ' + (lang === 'ts' ? 'active' : '');
      document.getElementById('tabPy').className = 'code-tab ' + (lang === 'py' ? 'active' : '');
      document.getElementById('apiCodePreview').innerText = lang === 'ts' ? currentTsCode : currentPyCode;
    }

    function openGeneratedApiSdk() {
      if (currentWrittenApiSdk) {
        openDoc(currentWrittenApiSdk);
      }
    }

    function copyApiSdkCode() {
      navigator.clipboard.writeText(currentTsCode || currentPyCode);
      showToast('✓ SDK code copied to clipboard!');
    }

    function runAudit() {
      vscode.postMessage({ command: 'runPreflightAudit' });
    }

    function cleanTempFiles() {
      vscode.postMessage({ command: 'cleanTemporaryFiles' });
    }

    function scaffoldDeployment() {
      const projId = document.getElementById('gcpProjId').value;
      const pubDir = document.getElementById('pubBuildDir').value;
      vscode.postMessage({
        command: 'scaffoldFullstackDeployment',
        projectId: projId,
        publicDir: pubDir
      });
    }

    function generateRunbooks() {
      vscode.postMessage({ command: 'generateRunbooks' });
    }

    // Initialize document preview on load
    switchDocTab('arch');

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'schemaFileLoaded') {
        document.getElementById('srcCols').value = msg.colsString;
        document.getElementById('srcNameInput').value = msg.sourceName;
        document.getElementById('modelNameInput').value = msg.modelName;
        const badge = document.getElementById('srcFileBadge');
        if (badge) badge.innerText = '📁 ' + msg.fileName;
        const errEl = document.getElementById('schemaErrorAlert');
        if (errEl) errEl.style.display = 'none';
        showToast('✓ Loaded ' + msg.fileName);
      } else if (msg.type === 'schemaMappingError') {
        const errEl = document.getElementById('schemaErrorAlert');
        if (errEl) {
          errEl.innerHTML = '<strong>⚠️ Error:</strong> ' + msg.error;
          errEl.style.display = 'block';
        }
      } else if (msg.type === 'auditResult') {
        const r = msg.report;
        document.getElementById('auditBox').style.display = 'block';
        const scoreEl = document.getElementById('auditScoreVal');
        scoreEl.innerText = r.score + ' / 100 ' + (r.pass ? '✓ Ready' : '⚠️ Action Needed');
        scoreEl.style.background = r.pass ? 'var(--success-bg)' : 'var(--warn-bg)';
        scoreEl.style.color = r.pass ? 'var(--success)' : 'var(--warn)';
        
        let html = '';
        r.findings.forEach(f => {
          html += '<div class="finding-row ' + f.severity + '"><span>[' + f.code + '] ' + f.message + '</span></div>';
        });
        document.getElementById('findingsList').innerHTML = html || '<div style="color: var(--success); font-size: 13px; font-weight:600;">✓ All pre-flight checks passed cleanly!</div>';
        document.getElementById('cleanupBtnContainer').style.display = r.temporaryFiles.length > 0 ? 'block' : 'none';
        if (msg.toast) showToast(msg.toast);
      } else if (msg.type === 'schemaMappingResult') {
        document.getElementById('schemaResultBox').style.display = 'block';
        currentDbtSql = msg.result.dbtSql;
        currentPySparkSql = msg.result.pysparkCode;
        currentSqlView = msg.result.sqlView;
        currentWrittenModelPath = msg.writtenFile;

        switchSchemaTab('dbt');

        if (msg.writtenFile) {
          document.getElementById('schemaSavedBadge').innerHTML = 'Location: <code>' + msg.writtenFile + '</code>';
        }

        let tableHtml = '<table class="mapping-table"><thead><tr><th>Target Column</th><th>Source Column</th><th>Target Type</th><th>Transformation Rule</th><th>Confidence</th></tr></thead><tbody>';
        msg.result.mappings.forEach(m => {
          const confClass = m.confidence >= 0.8 ? 'conf-high' : 'conf-mid';
          tableHtml += '<tr><td><strong>' + m.targetColumn + '</strong></td><td>' + m.sourceColumn + '</td><td>' + m.targetType + '</td><td><code>' + (m.transformation || 'direct') + '</code></td><td><span class="conf-pill ' + confClass + '">' + Math.round(m.confidence * 100) + '%</span></td></tr>';
        });
        tableHtml += '</tbody></table>';

        if (msg.result.unmappedSource.length > 0 || msg.result.unmappedTarget.length > 0) {
          tableHtml += '<div style="margin-top: 10px; font-size: 11px; opacity: 0.85;">';
          if (msg.result.unmappedSource.length > 0) {
            tableHtml += '<div><strong>Unmapped Source Fields:</strong> ' + msg.result.unmappedSource.map(u => '<code>' + u + '</code>').join(', ') + '</div>';
          }
          if (msg.result.unmappedTarget.length > 0) {
            tableHtml += '<div><strong>Unmapped Target Fields:</strong> ' + msg.result.unmappedTarget.map(u => '<code>' + u + '</code>').join(', ') + '</div>';
          }
          tableHtml += '</div>';
        }

        document.getElementById('schemaTableContainer').innerHTML = tableHtml;
        showToast('✓ dbt Staging Model Generated!');
      } else if (msg.type === 'apiConnectorResult') {
        document.getElementById('apiResultBox').style.display = 'block';
        currentTsCode = msg.tsCode;
        currentPyCode = msg.pyCode;
        currentWrittenApiSdk = msg.writtenFile;
        document.getElementById('apiCodePreview').innerText = currentTsCode;
        if (msg.writtenFile) {
          document.getElementById('apiSavedBadge').innerHTML = 'Location: <code>' + msg.writtenFile + '</code>';
        }
        showToast('✓ Client API SDK Scaffolded!');
      } else if (msg.type === 'scaffoldDone') {
        document.getElementById('scaffoldResultBox').style.display = 'block';
        showToast('✓ Full-Stack Deployment Scaffolded!');
      } else if (msg.type === 'runbooksDone') {
        const box = document.getElementById('runbookResultBox');
        if (box) box.style.display = 'block';
        currentArchDoc = msg.archDoc || currentArchDoc;
        currentDeployDoc = msg.deployRunbook || currentDeployDoc;
        currentDataDictDoc = msg.dataDict || currentDataDictDoc;
        currentEnvDoc = msg.envCatalog || currentEnvDoc;
        currentCompleteDoc = msg.completeHandoff || currentCompleteDoc;
        
        const pathEl = document.getElementById('docsPathLabel');
        if (pathEl && msg.docsPath) {
          pathEl.innerHTML = 'Location: <code>' + msg.docsPath + '</code>';
        }
        
        ['badgeArch', 'badgeDeploy', 'badgeDataDict', 'badgeEnv', 'badgeComplete'].forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.innerText = '✓ Ready';
            el.style.background = 'var(--success-bg)';
            el.style.color = 'var(--success)';
          }
        });

        switchDocTab(activeDocTab);
        showToast('✓ Generated 5 Complete Client Handoff Documents in docs/!');
      }
    });
  </script>
</body>
</html>`;
  }
}
