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

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

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
            await vscode.window.showTextDocument(doc);
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

      case 'generateSchemaMapping': {
        const srcCols: ColumnDefinition[] = (msg.sourceCols || '').split('\n').filter(Boolean).map((line: string) => {
          const [name, type] = line.split(':').map((s: string) => s.trim());
          return { name, type: type || 'string' };
        });
        const tgtCols: ColumnDefinition[] = (msg.targetCols || '').split('\n').filter(Boolean).map((line: string) => {
          const [name, type] = line.split(':').map((s: string) => s.trim());
          return { name, type: type || 'string' };
        });

        const result = SchemaMapperEngine.mapSchemas(srcCols, tgtCols, msg.sourceName || 'raw_source', msg.modelName || 'stg_client_model');

        await this._contextManager.recordSchemaMapping({
          sourceName: msg.sourceName || 'raw_source',
          targetModelName: msg.modelName || 'stg_client_model',
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
          const outPath = path.join(dbtDir, `${msg.modelName || 'stg_client_model'}.sql`);
          fs.writeFileSync(outPath, result.dbtSql, 'utf8');
          writtenFile = `models/staging/${msg.modelName || 'stg_client_model'}.sql`;
          vscode.window.showInformationMessage(`Created dbt model: ${writtenFile}`);
        }

        this._panel.webview.postMessage({ type: 'schemaMappingResult', result, writtenFile });
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
        if (!ws) return;
        const state = this._contextManager.getState();
        const docsDir = path.join(ws, 'docs');
        if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

        const archDoc = RunbookGenerator.generateArchitectureDoc(state);
        const deployRunbook = RunbookGenerator.generateDeploymentRunbook(state);
        const dataDict = RunbookGenerator.generateDataDictionary(state);

        fs.writeFileSync(path.join(docsDir, 'ARCHITECTURE.md'), archDoc, 'utf8');
        fs.writeFileSync(path.join(docsDir, 'DEPLOYMENT_RUNBOOK.md'), deployRunbook, 'utf8');
        fs.writeFileSync(path.join(docsDir, 'DATA_DICTIONARY.md'), dataDict, 'utf8');

        vscode.window.showInformationMessage('✓ Generated ARCHITECTURE.md, DEPLOYMENT_RUNBOOK.md, and DATA_DICTIONARY.md in docs/');
        this._panel.webview.postMessage({ type: 'runbooksDone', files: ['docs/ARCHITECTURE.md', 'docs/DEPLOYMENT_RUNBOOK.md', 'docs/DATA_DICTIONARY.md'] });
        break;
      }
    }
  }

  private _update(): void {
    const state = this._contextManager.getState();
    this._panel.webview.html = this._getHtmlForWebview(state);
  }

  private _getHtmlForWebview(state: FdeEngagementState): string {
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
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }
    .header-title {
      font-size: 20px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .beta-pill {
      font-size: 11px;
      background: var(--accent);
      color: var(--accent-fg);
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
    }

    /* Overall Engagement Progress Bar */
    .progress-bar-container {
      background: var(--border);
      height: 6px;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 20px;
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
    h3 { margin-top: 0; margin-bottom: 6px; font-size: 17px; }
    h4 { margin-top: 20px; margin-bottom: 10px; font-size: 14px; }
    p.desc { font-size: 13px; opacity: 0.85; line-height: 1.5; margin-top: 0; margin-bottom: 16px; }
    
    /* Inputs */
    textarea, input, select {
      width: 100%;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 13px;
      margin-bottom: 12px;
      transition: border-color 0.15s ease;
    }
    textarea:focus, input:focus, select:focus {
      outline: none;
      border-color: var(--accent);
    }
    textarea { font-family: 'Consolas', 'Courier New', monospace; min-height: 110px; resize: vertical; }

    /* Buttons */
    .btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      padding: 9px 18px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-secondary:hover {
      background: var(--card-alt);
      border-color: var(--accent);
    }
    .btn-quick {
      padding: 4px 10px;
      font-size: 11px;
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
    <div style="display: flex; gap: 8px; align-items: center;">
      <button class="btn btn-secondary" onclick="toggleRoadmap()" style="padding: 5px 12px; font-size: 12px;">🗺️ Roadmap &amp; Playbook</button>
      <input type="text" id="clientNameInput" value="${state.clientName}" placeholder="Client Name..." style="width: 210px; margin-bottom: 0;" onchange="updateClientName(this.value)">
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
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h3>📊 Semantic Schema Mapper &amp; Staging Generator</h3>
            <p class="desc">Align dirty client tables, CSVs, or legacy dumps with your standard platform data model.</p>
          </div>
          <button class="btn-quick" onclick="loadSampleSchema()">⚡ Load Sample Orders CSV</button>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div>
            <label style="font-size: 11px; font-weight: bold;">Source Columns (e.g. CUST_NBR_ID:string)</label>
            <textarea id="srcCols" placeholder="CUST_NBR_ID:string&#10;TXN_AMT:float&#10;CREATED_TS:timestamp&#10;IS_ACTIVE_FLG:string"></textarea>
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold;">Target Model Columns (e.g. customer_id:string)</label>
            <textarea id="tgtCols" placeholder="customer_id:string&#10;transaction_amount:numeric&#10;created_at:timestamp&#10;is_active:boolean"></textarea>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="btn" onclick="generateSchemaMapping()">Generate dbt Staging Model</button>
        </div>

        <div id="schemaResultBox" style="margin-top: 20px; display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h4 style="margin: 0;">Generated Staging Code</h4>
            <div id="schemaSavedBadge" style="font-size: 11px; color: var(--success); font-weight: 600;"></div>
          </div>
          <div class="code-preview" id="schemaCodePreview"></div>
          
          <h4 style="margin-top: 16px;">Column Mapping Breakdown</h4>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div class="code-tabs">
              <button class="code-tab active" id="tabTs" onclick="switchApiTab('ts')">TypeScript</button>
              <button class="code-tab" id="tabPy" onclick="switchApiTab('py')">Python</button>
            </div>
            <div id="apiSavedBadge" style="font-size: 11px; color: var(--success); font-weight: 600;"></div>
          </div>
          <div class="code-preview" id="apiCodePreview"></div>
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
        <p class="desc">Auto-generate comprehensive architecture blueprints, operations runbooks, and data dictionaries connecting everything built in Steps 1–3.</p>

        <div style="background: var(--bg); padding: 18px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 20px;">
          <div style="font-weight: 700; margin-bottom: 10px; font-size: 13px;">Generated Documentation Artifacts:</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="font-weight: 600; font-size: 13px;">ARCHITECTURE.md</div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 8px 0;">Mermaid system diagrams &amp; topology</div>
              <button class="btn-quick" onclick="openDoc('docs/ARCHITECTURE.md')">Open File</button>
            </div>
            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="font-weight: 600; font-size: 13px;">DEPLOYMENT_RUNBOOK.md</div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 8px 0;">Operations, rollback &amp; troubleshooting</div>
              <button class="btn-quick" onclick="openDoc('docs/DEPLOYMENT_RUNBOOK.md')">Open File</button>
            </div>
            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <div style="font-weight: 600; font-size: 13px;">DATA_DICTIONARY.md</div>
              <div style="font-size: 11px; opacity: 0.8; margin: 4px 0 8px 0;">Column transformation mappings</div>
              <button class="btn-quick" onclick="openDoc('docs/DATA_DICTIONARY.md')">Open File</button>
            </div>
          </div>
        </div>

        <button class="btn" onclick="generateRunbooks()">Generate All Client Handoff Docs</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div id="toast"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentTsCode = '';
    let currentPyCode = '';

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

    function loadSampleSchema() {
      document.getElementById('srcCols').value = "CUST_NBR_ID:string\\nTXN_AMT:float\\nCREATED_TS:timestamp\\nIS_ACTIVE_FLG:string\\nRAW_GEO_CODE:string";
      document.getElementById('tgtCols').value = "customer_id:string\\ntransaction_amount:numeric\\ncreated_at:timestamp\\nis_active:boolean";
      showToast('Sample dataset loaded');
    }

    function loadSampleApi() {
      document.getElementById('connName').value = "StripeBillingApi";
      document.getElementById('connBaseUrl').value = "https://api.stripe.internal/v1";
      document.getElementById('connAuthType').value = "bearer";
      showToast('Sample API spec loaded');
    }

    function generateSchemaMapping() {
      const src = document.getElementById('srcCols').value;
      const tgt = document.getElementById('tgtCols').value;
      vscode.postMessage({
        command: 'generateSchemaMapping',
        sourceCols: src,
        targetCols: tgt,
        sourceName: 'client_orders_raw',
        modelName: 'stg_orders',
        writeToFile: true
      });
    }

    function generateApiConnector(lang) {
      const name = document.getElementById('connName').value;
      const url = document.getElementById('connBaseUrl').value;
      const auth = document.getElementById('connAuthType').value;
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

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'auditResult') {
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
        document.getElementById('schemaCodePreview').innerText = msg.result.dbtSql;
        if (msg.writtenFile) {
          document.getElementById('schemaSavedBadge').innerText = '✓ Saved to ' + msg.writtenFile;
        }

        let tableHtml = '<table class="mapping-table"><thead><tr><th>Target Column</th><th>Source Column</th><th>Target Type</th><th>Transformation Rule</th><th>Confidence</th></tr></thead><tbody>';
        msg.result.mappings.forEach(m => {
          const confClass = m.confidence >= 0.8 ? 'conf-high' : 'conf-mid';
          tableHtml += '<tr><td><strong>' + m.targetColumn + '</strong></td><td>' + m.sourceColumn + '</td><td>' + m.targetType + '</td><td><code>' + (m.transformation || 'direct') + '</code></td><td><span class="conf-pill ' + confClass + '">' + Math.round(m.confidence * 100) + '%</span></td></tr>';
        });
        tableHtml += '</tbody></table>';
        document.getElementById('schemaTableContainer').innerHTML = tableHtml;
        showToast('✓ dbt Staging Model Generated!');
      } else if (msg.type === 'apiConnectorResult') {
        document.getElementById('apiResultBox').style.display = 'block';
        currentTsCode = msg.tsCode;
        currentPyCode = msg.pyCode;
        document.getElementById('apiCodePreview').innerText = currentTsCode;
        if (msg.writtenFile) {
          document.getElementById('apiSavedBadge').innerText = '✓ Saved to ' + msg.writtenFile;
        }
        showToast('✓ Client API SDK Scaffolded!');
      } else if (msg.type === 'scaffoldDone') {
        document.getElementById('scaffoldResultBox').style.display = 'block';
        showToast('✓ Full-Stack Deployment Scaffolded!');
      } else if (msg.type === 'runbooksDone') {
        showToast('✓ All Client Handoff Docs Generated in docs/!');
      }
    });
  </script>
</body>
</html>`;
  }
}
