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
import * as os from 'os';
import type { IServices } from '../core/services';
import { FdeContextManager, FdeEngagementState } from '../fde/fdeContext';
import { SchemaMapperEngine, ColumnDefinition } from '../fde/schemaMapper';
import { FdeAiEngine } from '../fde/aiEngine';
import { DbIntrospector, DbConnectionOptions } from '../fde/dbIntrospector';
import { ApiConnectorGenerator, ApiEndpointSpec } from '../fde/apiConnectorGen';
import { PreflightAuditor, PreflightReport } from '../deployment/preflightAuditor';
import { FirebaseConfigGenerator } from '../deployment/firebaseConfigGen';
import { DeployScriptScaffolder } from '../deployment/deployScriptScaffolder';
import { CloudResourceDiscovery } from '../deployment/cloudResourceDiscovery';
import { RunbookGenerator } from '../fde/runbookGenerator';
import { runCommand, runForStdout } from '../core/processUtil';
import { LicenseValidator, LicenseGenerator, LoadTestGenerator, RagPipelineScaffolder, RagPipelineOptions } from '../enterprise';

export class FdeCockpitPanel {
  public static currentPanel: FdeCockpitPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _vsCtx: vscode.ExtensionContext;
  private readonly _svc?: IServices;
  private readonly _contextManager: FdeContextManager;
  private _disposables: vscode.Disposable[] = [];
  private _lastAuditReport?: PreflightReport;

  public static createOrShow(vsCtx: vscode.ExtensionContext, svc?: IServices): FdeCockpitPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (FdeCockpitPanel.currentPanel) {
      FdeCockpitPanel.currentPanel._panel.reveal(column);
      return FdeCockpitPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiForge.fdeCockpit',
      'Forward-Deployed Engineers Delivery Studio (Beta)',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    FdeCockpitPanel.currentPanel = new FdeCockpitPanel(panel, vsCtx, svc);
    return FdeCockpitPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, vsCtx: vscode.ExtensionContext, svc?: IServices) {
    this._panel = panel;
    this._vsCtx = vsCtx;
    this._svc = svc;
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

  private getOrCreateGitTerminal(): vscode.Terminal {
    const termName = '🚀 FDE: Git Hub';
    const existing = vscode.window.terminals.find(t => t.name === termName);
    if (existing) return existing;
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return vscode.window.createTerminal({
      name: termName,
      cwd: ws,
    });
  }

  private getOrCreateCloudTerminal(): vscode.Terminal {
    const termName = '🚀 FDE: Cloud Auth';
    const existing = vscode.window.terminals.find(t => t.name === termName);
    if (existing) return existing;
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return vscode.window.createTerminal({
      name: termName,
      cwd: ws,
    });
  }

  private async _getGitBranches(ws: string): Promise<{ current: string; all: string[] }> {
    let current = 'main';
    const all: string[] = [];

    try {
      const cur = await runForStdout('git', ['branch', '--show-current'], { cwd: ws, timeoutMs: 3000 });
      if (cur && cur.trim()) current = cur.trim();
    } catch {}

    try {
      const raw = await runForStdout('git', ['branch', '-a', '--format=%(refname:short)'], { cwd: ws, timeoutMs: 3000 });
      if (raw) {
        const list = raw.trim().split('\n').map(b => b.trim()).filter(Boolean);
        for (const b of list) {
          if (!all.includes(b) && !b.includes('HEAD')) {
            all.push(b);
          }
        }
      }
    } catch {}

    if (!all.includes(current)) all.unshift(current);
    if (all.length === 0) all.push('main');
    return { current, all };
  }

  private async _getSshPublicKey(): Promise<{ exists: boolean; publicKey: string; keyPath: string }> {
    try {
      const homeDir = os.homedir();
      const edPath = path.join(homeDir, '.ssh', 'id_ed25519.pub');
      const rsaPath = path.join(homeDir, '.ssh', 'id_rsa.pub');

      if (fs.existsSync(edPath)) {
        return { exists: true, publicKey: fs.readFileSync(edPath, 'utf8').trim(), keyPath: '~/.ssh/id_ed25519.pub' };
      }
      if (fs.existsSync(rsaPath)) {
        return { exists: true, publicKey: fs.readFileSync(rsaPath, 'utf8').trim(), keyPath: '~/.ssh/id_rsa.pub' };
      }
    } catch {}
    return { exists: false, publicKey: '', keyPath: '' };
  }

  private async _generateCommitDraft(ws: string): Promise<{ title: string; description: string; changedFiles: Array<{ status: string; path: string }> }> {
    const statusOut = await runForStdout('git', ['status', '--porcelain'], { cwd: ws, timeoutMs: 4000 });
    const changedFiles: Array<{ status: string; path: string }> = [];
    if (statusOut) {
      const lines = statusOut.trim().split('\n').filter(Boolean);
      for (const l of lines) {
        const status = l.slice(0, 2).trim();
        const filePath = l.slice(3).trim();
        changedFiles.push({ status: status || 'M', path: filePath });
      }
    }

    const diffStat = (await runForStdout('git', ['diff', '--stat', 'HEAD'], { cwd: ws, timeoutMs: 4000 })) 
      || (await runForStdout('git', ['diff', '--stat'], { cwd: ws, timeoutMs: 4000 })) || '';

    let title = '';
    let description = '';

    // If AI service is available, draft an AI commit message
    if (this._svc?.ai && changedFiles.length > 0) {
      try {
        const diffSummary = (await runForStdout('git', ['diff', '-U1', 'HEAD'], { cwd: ws, timeoutMs: 5000 }))
          || (await runForStdout('git', ['diff', '-U1'], { cwd: ws, timeoutMs: 5000 })) || '';
        const sampleDiff = diffSummary.slice(0, 2500);

        const prompt = `You are an expert engineer writing a clear, professional Conventional Commit message.
Files changed:
${changedFiles.map(f => `${f.status} ${f.path}`).slice(0, 15).join('\n')}

Diff summary:
${diffStat.slice(0, 1000)}

Sample diff:
${sampleDiff}

Generate:
1. Conventional Commit title on line 1 (e.g. feat(fde): implement dimensional mart builder and live db introspector). Max 72 chars.
2. A blank line.
3. 2-4 concise bullet points summarizing what was created or changed.
Output ONLY the message without markdown code fences.`;

        const aiResponse = await this._svc.ai.send({
          system: 'You generate only clean conventional commit messages with bullet points.',
          instruction: prompt,
          mode: 'agent',
          messages: [{ role: 'user', content: prompt }],
        });

        if (aiResponse && aiResponse.trim()) {
          const cleaned = aiResponse.replace(/```[a-z]*\n?/g, '').trim();
          const parts = cleaned.split('\n\n');
          title = parts[0].trim().replace(/^commit:\s*/i, '');
          description = parts.slice(1).join('\n\n').trim();
        }
      } catch (e) {
        console.warn('AI commit generation fallback to heuristic:', e);
      }
    }

    // Heuristic Fallback
    if (!title && changedFiles.length > 0) {
      const paths = changedFiles.map(f => f.path);
      let type = 'feat';
      let scope = 'fde';

      if (paths.some(p => p.includes('test/'))) {
        type = 'test'; scope = 'suite';
      } else if (paths.every(p => p.endsWith('.md') || p.startsWith('docs/'))) {
        type = 'docs'; scope = 'runbooks';
      } else if (paths.some(p => p.includes('model') || p.includes('mart') || p.endsWith('.sql'))) {
        type = 'feat'; scope = 'marts';
      } else if (paths.some(p => p.includes('ui/') || p.includes('Panel'))) {
        type = 'feat'; scope = 'ui';
      } else if (paths.some(p => p.includes('deploy') || p.includes('terraform') || p.includes('k8s') || p.includes('firebase'))) {
        type = 'feat'; scope = 'deploy';
      }

      const firstFew = paths.slice(0, 3).map(p => path.basename(p)).join(', ');
      title = `${type}(${scope}): update ${firstFew}${paths.length > 3 ? ` and ${paths.length - 3} more files` : ''}`;

      const bullets = changedFiles.slice(0, 6).map(f => {
        const action = f.status === 'A' || f.status === '??' ? 'Add' : (f.status === 'D' ? 'Remove' : 'Update');
        return `- ${action} ${f.path}`;
      });
      if (changedFiles.length > 6) {
        bullets.push(`- Plus ${changedFiles.length - 6} additional modified files`);
      }
      description = bullets.join('\n');
    } else if (!title) {
      title = `chore(fde): client pilot deliverables update (${new Date().toISOString().slice(0, 10)})`;
      description = '- Staged and committed client project deliverables';
    }

    return { title, description, changedFiles };
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
          const userPath = (msg.outputPath || '').trim();
          let outPath = '';
          if (userPath) {
            outPath = path.isAbsolute(userPath) ? userPath : path.join(ws, userPath);
            const parentDir = path.dirname(outPath);
            if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
            writtenFile = path.relative(ws, outPath).replace(/\\/g, '/');
          } else {
            const dbtDir = path.join(ws, 'models', 'staging');
            if (!fs.existsSync(dbtDir)) fs.mkdirSync(dbtDir, { recursive: true });
            outPath = path.join(dbtDir, `${modelName}.sql`);
            writtenFile = `models/staging/${modelName}.sql`;
          }
          fs.writeFileSync(outPath, result.dbtSql, 'utf8');
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

      case 'aiAnalyzeStagingSchema': {
        const rawCols = msg.rawCols || '';
        const tableName = msg.tableName || 'data';
        const enablePiiMasking = !!msg.enablePiiMasking;
        const customInstruction = msg.customInstruction || '';
        const result = FdeAiEngine.analyzeAndCleanStagingSchema(rawCols, tableName, {
          enablePiiMasking,
          customInstruction,
        });
        vscode.window.showInformationMessage(result.summary);
        this._panel.webview.postMessage({
          type: 'aiStagingAnalysisResult',
          result,
        });
        break;
      }

      case 'aiDiscoverMartRecipes': {
        const baseModel = msg.baseModel || '';
        const allTables = this._contextManager.getLastIntrospectedTables();
        const recipes = FdeAiEngine.discoverMartRecipes(baseModel, allTables);
        this._panel.webview.postMessage({
          type: 'aiMartRecipesResult',
          recipes,
          baseModel,
        });
        if (recipes.length > 0) {
          vscode.window.showInformationMessage(`✨ AI discovered ${recipes.length} dimensional Mart recipes for ${baseModel || 'workspace'}`);
        } else {
          vscode.window.showInformationMessage(`AI: Select a Base Model or connect database to discover mart relationships.`);
        }
        break;
      }

      case 'aiGenerateMartFromPrompt': {
        const prompt = msg.prompt || '';
        const allTables = this._contextManager.getLastIntrospectedTables();
        const recipe = FdeAiEngine.generateMartFromNaturalLanguage(prompt, allTables);
        if (recipe) {
          vscode.window.showInformationMessage(`✨ AI generated mart configuration for: "${prompt}"`);
          this._panel.webview.postMessage({
            type: 'aiMartFromResult',
            recipe,
          });
        } else {
          vscode.window.showWarningMessage(`Could not generate a Mart configuration for "${prompt}". Please connect to database tables first.`);
        }
        break;
      }

      case 'introspectDatabase': {
        const options: DbConnectionOptions = msg.options || { dialect: 'postgres' };
        
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${options.dialect.toUpperCase()} database and introspecting tables...`,
          cancellable: false,
        }, async () => {
          try {
            const result = await DbIntrospector.introspect(options, ws);

            if (msg.saveSecret && options.password) {
              const state = this._contextManager.getState();
              await this._vsCtx.secrets.store(`fde_db_pwd_${state.id}`, options.password);
            }

            if (result.success) {
              await this._contextManager.recordDbConnection({
                dialect: options.dialect,
                host: options.host,
                database: result.database || options.database,
                schema: result.schema || options.schema,
              });
              if (result.tables && result.tables.length > 0) {
                await this._contextManager.recordIntrospectedTables(result.tables);
              }
              vscode.window.showInformationMessage(`✓ ${result.message || `Discovered ${result.tables.length} tables`}`);
            } else {
              vscode.window.showWarningMessage(`Database inspection: ${result.error || result.message || 'No tables returned'}`);
            }

            this._panel.webview.postMessage({
              type: 'dbIntrospectResult',
              result,
            });
          } catch (e: any) {
            vscode.window.showErrorMessage(`Database connection failed: ${e?.message || e}`);
            this._panel.webview.postMessage({
              type: 'dbIntrospectResult',
              result: { success: false, dialect: options.dialect, tables: [], error: e?.message || String(e) },
            });
          }
        });
        break;
      }

      case 'testDbConnection': {
        const options: DbConnectionOptions = {
          dialect: msg.dialect || 'postgres',
          connectionUri: msg.connectionUri,
          database: msg.database,
          schema: msg.schema,
          host: msg.host,
          port: msg.port,
          username: msg.username,
          password: msg.password,
        };

        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Testing connection to ${options.dialect.toUpperCase()} database...`,
        }, async () => {
          try {
            const result = await DbIntrospector.testConnection(options, ws);
            if (result.success) {
              vscode.window.showInformationMessage(result.message);
            } else {
              vscode.window.showErrorMessage(result.message);
            }
            this._panel.webview.postMessage({
              type: 'dbTestResult',
              result,
            });
          } catch (e: any) {
            vscode.window.showErrorMessage(`Connection test failed: ${e?.message || e}`);
            this._panel.webview.postMessage({
              type: 'dbTestResult',
              result: { success: false, latencyMs: 0, message: e?.message || String(e) },
            });
          }
        });
        break;
      }

      case 'detectWorkspaceDbConfig': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace first.');
          return;
        }
        const detected = DbIntrospector.detectWorkspaceConfig(ws);
        this._panel.webview.postMessage({
          type: 'dbConfigDetected',
          detected,
        });
        if (detected.found) {
          vscode.window.showInformationMessage(`✓ Found ${detected.dialect?.toUpperCase()} configuration in ${detected.sourceFile}`);
        } else {
          vscode.window.showInformationMessage('No database connection settings found in workspace .env, prisma, or config files.');
        }
        break;
      }

      case 'wipeDbSecrets': {
        const state = this._contextManager.getState();
        await this._vsCtx.secrets.delete(`fde_db_pwd_${state.id}`);
        vscode.window.showInformationMessage('✓ Stored database credentials wiped from secure OS vault.');
        this._panel.webview.postMessage({ type: 'dbSecretsWiped' });
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

      case 'parseCurl': {
        const parsed = ApiConnectorGenerator.parseCurlCommand(msg.curlStr || '');
        this._panel.webview.postMessage({ type: 'curlParsed', parsed });
        vscode.window.showInformationMessage(`✓ Parsed cURL command into connector: ${parsed.connectorName || 'ClientApi'}`);
        break;
      }

      case 'parseOpenApi': {
        const parsed = ApiConnectorGenerator.parseOpenApiSpec(msg.specStr || '');
        this._panel.webview.postMessage({ type: 'openApiParsed', parsed });
        vscode.window.showInformationMessage(`✓ Parsed OpenAPI spec: ${parsed.endpoints?.length || 0} endpoints discovered.`);
        break;
      }

      case 'testApiEndpoint': {
        const url = msg.url || '';
        if (!url) {
          vscode.window.showWarningMessage('Please enter a valid Base URL first.');
          return;
        }
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Testing HTTP reachability for ${url}...`,
        }, async () => {
          try {
            const start = Date.now();
            const https = url.startsWith('https') ? require('https') : require('http');
            const parsedUrl = new URL(url);
            const req = https.request({
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
              path: parsedUrl.pathname || '/',
              method: 'GET',
              timeout: 6000,
              headers: { 'User-Agent': 'EvolveAI-FDE-Connector-Test/2.19.0' },
              rejectUnauthorized: false
            }, (res: any) => {
              const latency = Date.now() - start;
              const status = res.statusCode || 200;
              vscode.window.showInformationMessage(`✓ API Endpoint responded: HTTP ${status} in ${latency}ms`);
              this._panel.webview.postMessage({
                type: 'apiTestResult',
                success: true,
                status,
                latencyMs: latency,
                url
              });
            });
            req.on('error', (err: any) => {
              const latency = Date.now() - start;
              vscode.window.showWarningMessage(`API endpoint test: ${err.message} (${latency}ms)`);
              this._panel.webview.postMessage({
                type: 'apiTestResult',
                success: false,
                error: err.message,
                latencyMs: latency,
                url
              });
            });
            req.setTimeout(6000, () => {
              req.destroy();
              vscode.window.showErrorMessage(`API test timed out after 6000ms`);
              this._panel.webview.postMessage({
                type: 'apiTestResult',
                success: false,
                error: 'Connection timed out',
                latencyMs: 6000,
                url
              });
            });
            req.end();
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to test endpoint: ${e.message}`);
          }
        });
        break;
      }

      case 'generateDataMart': {
        const martName = (msg.martName || 'fct_customer_orders').trim();
        const baseModel = (msg.baseModel || 'stg_orders').trim();
        const joins = msg.joins || [];
        const dimensions = (msg.dimensions || []).map((s: string) => s.trim()).filter(Boolean);
        const metrics = (msg.metrics || []).map((m: any) => {
          if (typeof m === 'string') {
            const parts = m.split(':');
            return { name: parts[0].trim(), expr: parts[1] ? parts[1].trim() : parts[0].trim() };
          }
          return { name: m.name, expr: m.expression || m.expr || 'count(*)' };
        });
        const dialect = msg.dialect || 'dbt';

        const result = SchemaMapperEngine.generateDataMartModel(martName, baseModel, joins, dimensions, metrics, dialect);

        await this._contextManager.recordDataMart({
          martName,
          baseModel,
          joins,
          dimensions,
          metrics,
          dialect,
          generatedSql: result.dbtSql,
          createdAt: Date.now(),
        });

        let writtenFile = '';
        if (ws && msg.writeToFile) {
          const userPath = (msg.outputPath || '').trim();
          let outPath = '';
          let martsDir = '';
          if (userPath) {
            outPath = path.isAbsolute(userPath) ? userPath : path.join(ws, userPath);
            martsDir = path.dirname(outPath);
            if (!fs.existsSync(martsDir)) fs.mkdirSync(martsDir, { recursive: true });
            writtenFile = path.relative(ws, outPath).replace(/\\/g, '/');
          } else {
            martsDir = path.join(ws, 'models', 'marts');
            if (!fs.existsSync(martsDir)) fs.mkdirSync(martsDir, { recursive: true });
            outPath = path.join(martsDir, `${martName}.sql`);
            writtenFile = `models/marts/${martName}.sql`;
          }
          fs.writeFileSync(outPath, result.dbtSql, 'utf8');

          const schemaYamlPath = path.join(martsDir, 'schema.yml');
          const schemaYamlContent = SchemaMapperEngine.generateDbtSchemaYaml(martName, dimensions, metrics);
          fs.writeFileSync(schemaYamlPath, schemaYamlContent, 'utf8');

          vscode.window.showInformationMessage(`✓ Created dbt dimensional mart: ${writtenFile} & schema.yml`);
        }

        this._panel.webview.postMessage({
          type: 'dataMartResult',
          result,
          writtenFile,
          martName
        });
        this._update();
        break;
      }

      case 'requestDeleteDataMart': {
        if (msg.martName) {
          const choice = await vscode.window.showWarningMessage(
            `Remove dimensional data mart "${msg.martName}"?`,
            { modal: true },
            'Remove Mart'
          );
          if (choice === 'Remove Mart') {
            await this._contextManager.deleteDataMart(msg.martName);
            vscode.window.showInformationMessage(`Removed data mart: ${msg.martName}`);
            this._update();
          }
        }
        break;
      }

      case 'deleteDataMart': {
        if (msg.martName) {
          await this._contextManager.deleteDataMart(msg.martName);
          vscode.window.showInformationMessage(`Removed data mart: ${msg.martName}`);
          this._update();
        }
        break;
      }

      case 'discoverCloudResources': {
        const state = this._contextManager.getState();
        const prov = msg.provider || state.targetVpc || 'gcp-firebase';
        const proj = msg.projectId || undefined;
        const reg = msg.region || undefined;

        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Discovering ${prov.toUpperCase()} cloud resources...`,
          cancellable: false
        }, async () => {
          try {
            const disc = await CloudResourceDiscovery.discover({
              provider: prov,
              projectId: proj,
              region: reg,
              cwd: ws || undefined
            });

            await this._contextManager.recordDeploymentSettings({
              discoveredCloudResources: disc,
            });

            this._panel.webview.postMessage({
              type: 'cloudResourcesDiscovered',
              resources: disc,
            });

            if (disc.authenticated) {
              vscode.window.showInformationMessage(`✓ Discovered ${disc.vpcs.length} VPCs and ${disc.subnets.length} subnets in ${disc.activeProject || disc.provider}.`);
            } else if (disc.authHelpPrompt) {
              vscode.window.showWarningMessage(`Cloud CLI not authenticated: ${disc.authHelpPrompt}`);
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(`Cloud discovery error: ${e?.message || e}`);
          }
        });
        break;
      }

      case 'saveDeploymentMatrix': {
        await this._contextManager.recordDeploymentSettings({
          cpu: msg.cpu,
          memory: msg.memory,
          gpu: msg.gpu,
          ingress: msg.ingress,
          minInstances: parseInt(msg.minInstances || '0', 10),
          maxInstances: parseInt(msg.maxInstances || '10', 10),
          secretsProvider: msg.secretsProvider,
          vpcId: msg.vpcId,
          subnetId: msg.subnetId,
          securityGroups: msg.securityGroups,
        });
        break;
      }

      case 'generateTerraformIaC': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace first.');
          return;
        }
        const state = this._contextManager.getState();
        await this._contextManager.recordDeploymentSettings({
          cpu: msg.cpu,
          memory: msg.memory,
          gpu: msg.gpu,
          ingress: msg.ingress,
          minInstances: parseInt(msg.minInstances || '0', 10),
          maxInstances: parseInt(msg.maxInstances || '10', 10),
          secretsProvider: msg.secretsProvider,
          vpcId: msg.vpcId,
          subnetId: msg.subnetId,
          securityGroups: msg.securityGroups,
        });

        const tfCode = DeployScriptScaffolder.generateTerraform({
          projectName: state.clientName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          projectId: msg.projectId || 'client-pilot-project',
          region: msg.region || 'australia-southeast1',
          cpu: msg.cpu || '1',
          memory: msg.memory || '1Gi',
          gpu: msg.gpu || 'none',
          minInstances: parseInt(msg.minInstances || '0', 10),
          maxInstances: parseInt(msg.maxInstances || '10', 10),
          ingress: msg.ingress || 'all',
          secretsProvider: msg.secretsProvider || 'gcp-secret-manager',
          vpcId: msg.vpcId || undefined,
          subnetId: msg.subnetId || undefined,
          securityGroups: msg.securityGroups || undefined,
          targetVpc: state.targetVpc,
        });
        const tfDir = path.join(ws, 'terraform');
        if (!fs.existsSync(tfDir)) fs.mkdirSync(tfDir, { recursive: true });
        const tfPath = path.join(tfDir, 'main.tf');
        fs.writeFileSync(tfPath, tfCode, 'utf8');
        vscode.window.showInformationMessage('✓ Generated Terraform: terraform/main.tf');
        this._panel.webview.postMessage({ type: 'iacGenerated', file: 'terraform/main.tf', code: tfCode });
        break;
      }

      case 'generateKubernetesIaC': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace first.');
          return;
        }
        const state = this._contextManager.getState();
        await this._contextManager.recordDeploymentSettings({
          cpu: msg.cpu,
          memory: msg.memory,
          gpu: msg.gpu,
          minInstances: parseInt(msg.minInstances || '2', 10),
          subnetId: msg.subnetId,
        });

        const k8sCode = DeployScriptScaffolder.generateKubernetesManifest({
          projectName: state.clientName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          projectId: msg.projectId || 'client-pilot-project',
          cpu: msg.cpu || '1',
          memory: msg.memory || '1Gi',
          gpu: msg.gpu || 'none',
          minInstances: parseInt(msg.minInstances || '2', 10),
          subnetId: msg.subnetId || undefined,
        });
        const k8sDir = path.join(ws, 'k8s');
        if (!fs.existsSync(k8sDir)) fs.mkdirSync(k8sDir, { recursive: true });
        const k8sPath = path.join(k8sDir, 'deployment.yaml');
        fs.writeFileSync(k8sPath, k8sCode, 'utf8');
        vscode.window.showInformationMessage('✓ Generated Kubernetes manifest: k8s/deployment.yaml');
        this._panel.webview.postMessage({ type: 'iacGenerated', file: 'k8s/deployment.yaml', code: k8sCode });
        break;
      }

      case 'generateDockerComposeIaC': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace first.');
          return;
        }
        const state = this._contextManager.getState();
        await this._contextManager.recordDeploymentSettings({
          cpu: msg.cpu,
          memory: msg.memory,
          gpu: msg.gpu,
          vpcId: msg.vpcId,
        });

        const dcCode = DeployScriptScaffolder.generateDockerCompose({
          projectName: state.clientName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          projectId: msg.projectId || 'client-pilot-project',
          cpu: msg.cpu || '1',
          memory: msg.memory || '1Gi',
          gpu: msg.gpu || 'none',
          vpcId: msg.vpcId || undefined,
        });
        fs.writeFileSync(path.join(ws, 'docker-compose.yml'), dcCode, 'utf8');
        vscode.window.showInformationMessage('✓ Generated Docker Compose: docker-compose.yml');
        this._panel.webview.postMessage({ type: 'iacGenerated', file: 'docker-compose.yml', code: dcCode });
        break;
      }

      case 'getGitAndCloudStatus': {
        let gitBranch = 'main';
        let gitBranches: string[] = ['main'];
        let gitRemote = '';
        let isDirty = false;
        let uncommittedCount = 0;
        let changedFiles: Array<{ status: string; path: string }> = [];
        let sshKeyInfo = { exists: false, publicKey: '', keyPath: '' };
        let gcpStatus = false;
        let awsStatus = false;
        let dockerStatus = false;

        if (ws) {
          try {
            const branchInfo = await this._getGitBranches(ws);
            gitBranch = branchInfo.current;
            gitBranches = branchInfo.all;

            const remoteOut = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws, timeoutMs: 3000 });
            if (remoteOut && remoteOut.trim() && !remoteOut.includes('fatal:')) {
              gitRemote = remoteOut.trim();
            } else {
              gitRemote = 'No remote origin configured';
            }

            const statusOut = await runForStdout('git', ['status', '--porcelain'], { cwd: ws, timeoutMs: 3000 });
            if (statusOut) {
              const lines = statusOut.trim().split('\n').filter(Boolean);
              uncommittedCount = lines.length;
              isDirty = uncommittedCount > 0;
              for (const l of lines) {
                const status = l.slice(0, 2).trim();
                const filePath = l.slice(3).trim();
                changedFiles.push({ status: status || 'M', path: filePath });
              }
            }

            sshKeyInfo = await this._getSshPublicKey();
          } catch {
            gitRemote = 'No Git repository detected';
          }

          try {
            const gcpOut = await runForStdout('gcloud', ['--version'], { cwd: ws, timeoutMs: 3000 });
            gcpStatus = !!gcpOut;
          } catch {}

          try {
            const awsOut = await runForStdout('aws', ['--version'], { cwd: ws, timeoutMs: 3000 });
            awsStatus = !!awsOut;
          } catch {}

          try {
            const dockerOut = await runForStdout('docker', ['--version'], { cwd: ws, timeoutMs: 3000 });
            dockerStatus = !!dockerOut;
          } catch {}
        }

        this._panel.webview.postMessage({
          type: 'gitAndCloudStatus',
          gitBranch,
          gitBranches,
          gitRemote,
          isDirty,
          uncommittedCount,
          changedFiles,
          sshKeyInfo,
          gcpStatus,
          awsStatus,
          dockerStatus,
        });
        break;
      }

      case 'switchGitBranch': {
        if (!ws) return;
        const targetBranch = (msg.branch || '').trim();
        if (!targetBranch) return;

        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Checking out branch "${targetBranch}"...`,
          cancellable: false
        }, async () => {
          let res: any;
          if (targetBranch.startsWith('origin/')) {
            const localName = targetBranch.replace(/^origin\//, '');
            res = await runCommand('git', ['checkout', '-b', localName, '--track', targetBranch], { cwd: ws, timeoutMs: 15000 });
            if (res && res.code !== 0) {
              res = await runCommand('git', ['checkout', localName], { cwd: ws, timeoutMs: 15000 });
            }
          } else {
            res = await runCommand('git', ['checkout', targetBranch], { cwd: ws, timeoutMs: 15000 });
          }

          if (res && res.code === 0) {
            vscode.window.showInformationMessage(`✓ Switched to branch "${targetBranch}"`);
            this._panel.webview.postMessage({ type: 'gitResult', success: true, message: `Switched to branch "${targetBranch}"` });
          } else {
            vscode.window.showWarningMessage(`Could not switch branch: ${res?.stderr || 'Check uncommitted changes'}`);
            this._panel.webview.postMessage({ type: 'gitResult', success: false, error: res?.stderr || 'Branch checkout failed' });
          }
        });
        break;
      }

      case 'createGitBranch': {
        if (!ws) return;
        const branchName = (msg.branchName || '').trim();
        if (!branchName) {
          vscode.window.showWarningMessage('Please enter a branch name.');
          return;
        }

        const res = await runCommand('git', ['checkout', '-b', branchName], { cwd: ws, timeoutMs: 15000 });
        if (res && res.code === 0) {
          vscode.window.showInformationMessage(`✓ Created and checked out new branch "${branchName}"`);
          this._panel.webview.postMessage({ type: 'gitResult', success: true, message: `Created branch "${branchName}"` });
        } else {
          vscode.window.showErrorMessage(`Failed to create branch: ${res?.stderr || 'Invalid branch name'}`);
          this._panel.webview.postMessage({ type: 'gitResult', success: false, error: res?.stderr || 'Branch creation failed' });
        }
        break;
      }

      case 'copySshPublicKey': {
        const sshInfo = await this._getSshPublicKey();
        if (sshInfo.exists && sshInfo.publicKey) {
          await vscode.env.clipboard.writeText(sshInfo.publicKey);
          vscode.window.showInformationMessage(`📋 Public SSH key (${sshInfo.keyPath}) copied to clipboard! Paste it into Bitbucket/GitHub SSH keys.`);
          this._panel.webview.postMessage({ type: 'toast', message: '📋 SSH Public Key copied to clipboard!' });
        } else {
          const gen = await vscode.window.showWarningMessage(
            'No SSH public key found (~/.ssh/id_ed25519.pub or id_rsa.pub). Would you like to generate one now?',
            'Generate SSH Key', 'Cancel'
          );
          if (gen === 'Generate SSH Key') {
            const homeDir = os.homedir();
            const sshDir = path.join(homeDir, '.ssh');
            if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });
            const keyPath = path.join(sshDir, 'id_ed25519');
            const genRes = await runCommand('ssh-keygen', ['-t', 'ed25519', '-C', 'evolve-ai-fde', '-N', '', '-f', keyPath], { cwd: homeDir, timeoutMs: 10000 });
            if (genRes && genRes.code === 0 && fs.existsSync(keyPath + '.pub')) {
              const pubKey = fs.readFileSync(keyPath + '.pub', 'utf8').trim();
              await vscode.env.clipboard.writeText(pubKey);
              vscode.window.showInformationMessage(`✓ Generated new ed25519 SSH key and copied public key to clipboard!`);
              this._panel.webview.postMessage({ type: 'gitResult', success: true, message: 'Generated & copied SSH Key' });
            } else {
              vscode.window.showErrorMessage(`Failed to generate SSH key: ${genRes?.stderr || 'Run ssh-keygen manually'}`);
            }
          }
        }
        break;
      }

      case 'configureHttpsAuth': {
        if (!ws) return;
        const repoUrl = (msg.repoUrl || '').trim();
        const username = (msg.username || '').trim();
        const token = (msg.token || '').trim();

        if (!repoUrl) {
          vscode.window.showWarningMessage('Please enter a remote repository URL.');
          return;
        }

        let authenticatedUrl = repoUrl;
        if (username && token) {
          try {
            let clean = repoUrl.replace(/^git@([^:]+):/, 'https://$1/');
            if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
              clean = 'https://' + clean;
            }
            const u = new URL(clean);
            u.username = encodeURIComponent(username);
            u.password = encodeURIComponent(token);
            authenticatedUrl = u.toString();
          } catch {
            authenticatedUrl = repoUrl;
          }
        }

        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Configuring Git remote origin and testing authentication...',
          cancellable: false
        }, async () => {
          try {
            const checkOut = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws });
            if (checkOut && !checkOut.includes('fatal:')) {
              await runCommand('git', ['remote', 'set-url', 'origin', authenticatedUrl], { cwd: ws });
            } else {
              await runCommand('git', ['remote', 'add', 'origin', authenticatedUrl], { cwd: ws });
            }

            // Test remote
            const testOut = await runForStdout('git', ['ls-remote', '--heads', 'origin'], { cwd: ws, timeoutMs: 10000 });
            const isOk = testOut && !testOut.includes('fatal:') && !testOut.includes('Authentication failed');

            if (isOk) {
              vscode.window.showInformationMessage(`✓ Git Remote Origin configured and authenticated successfully!`);
              this._panel.webview.postMessage({
                type: 'gitAuthResult',
                success: true,
                remoteUrl: repoUrl,
                message: '✓ Remote authenticated & ready!'
              });
            } else {
              vscode.window.showWarningMessage(`Remote configured, but verification reported: ${testOut || 'Check credentials / token permissions'}`);
              this._panel.webview.postMessage({
                type: 'gitAuthResult',
                success: false,
                remoteUrl: repoUrl,
                message: `⚠️ Remote set, verification: ${testOut || 'Check token permissions'}`
              });
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to configure git remote: ${e?.message || e}`);
          }
        });
        break;
      }

      case 'initializeGitRepo': {
        if (!ws) return;
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Initializing Git repository...',
          cancellable: false
        }, async () => {
          const initRes = await runCommand('git', ['init', '-b', 'main'], { cwd: ws });
          if (initRes && initRes.code === 0) {
            vscode.window.showInformationMessage(`✓ Initialized Git repository on branch "main"`);
            this._panel.webview.postMessage({ type: 'gitResult', success: true, message: 'Git repository initialized' });
          } else {
            vscode.window.showErrorMessage(`Git init failed: ${initRes?.stderr || 'Check permissions'}`);
          }
        });
        break;
      }

      case 'requestCommitDraft': {
        if (!ws) return;
        const draft = await this._generateCommitDraft(ws);
        this._panel.webview.postMessage({
          type: 'commitDraftResult',
          title: draft.title,
          description: draft.description,
          changedFiles: draft.changedFiles,
        });
        break;
      }

      case 'gitFetch': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace folder first.');
          return;
        }
        if (msg.runInTerminal) {
          const terminal = this.getOrCreateGitTerminal();
          terminal.show();
          terminal.sendText('git fetch --all --prune --verbose');
          vscode.window.showInformationMessage('🔄 Running "git fetch" in integrated terminal...');
        } else {
          vscode.window.showInformationMessage('🔄 Git: Fetching latest branches and commits...');
          const res = await runCommand('git', ['fetch', '--all'], { cwd: ws, timeoutMs: 20000 });
          if (res && res.code === 0) {
            vscode.window.showInformationMessage('✓ Git: Fetched latest changes from remote.');
          } else {
            vscode.window.showWarningMessage(`Git fetch completed (${res?.stderr || 'Check remote origin'}).`);
          }
          this._panel.webview.postMessage({ type: 'gitResult', success: res?.code === 0, message: res?.stderr || 'Fetch completed' });
        }
        break;
      }

      case 'gitCommitAndPush': {
        if (!ws) {
          vscode.window.showWarningMessage('Open a workspace folder first.');
          return;
        }

        const title = (msg.title || msg.commitMessage || `feat(fde): client pilot deliverables (${new Date().toISOString().slice(0, 10)})`).trim();
        const desc = (msg.description || '').trim();
        const fullMessage = desc ? `${title}\n\n${desc}` : title;
        const pushToRemote = msg.pushToRemote !== false;
        const runInTerminal = msg.runInTerminal !== false;

        if (runInTerminal) {
          const terminal = this.getOrCreateGitTerminal();
          terminal.show();
          const isWin = process.platform === 'win32';
          const safeMsg = fullMessage.replace(/"/g, '\"');
          
          if (pushToRemote) {
            const cmd = isWin
              ? `git add -A; git commit -m "${safeMsg}"; git push origin HEAD`
              : `git add -A && git commit -m "${safeMsg}" && git push origin HEAD`;
            terminal.sendText(cmd);
          } else {
            const cmd = isWin
              ? `git add -A; git commit -m "${safeMsg}"`
              : `git add -A && git commit -m "${safeMsg}"`;
            terminal.sendText(cmd);
          }
          vscode.window.showInformationMessage('📦 Running Commit & Push in terminal...');
        } else {
          vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Staging, committing and pushing to remote...',
            cancellable: false
          }, async () => {
            await runCommand('git', ['add', '-A'], { cwd: ws, timeoutMs: 15000 });
            const commitRes = await runCommand('git', ['commit', '-m', fullMessage], { cwd: ws, timeoutMs: 15000 });
            
            if (pushToRemote) {
              const pushRes = await runCommand('git', ['push', 'origin', 'HEAD'], { cwd: ws, timeoutMs: 30000 });
              if (pushRes && pushRes.code === 0) {
                vscode.window.showInformationMessage(`✓ Git: Committed & pushed deliverables to remote origin!`);
                this._panel.webview.postMessage({ type: 'gitResult', success: true, message: 'Committed & Pushed successfully!' });
              } else {
                vscode.window.showWarningMessage(`✓ Git: Committed locally. (Push: ${pushRes?.stderr || 'Check remote credentials'})`);
                this._panel.webview.postMessage({ type: 'gitResult', success: false, error: pushRes?.stderr || 'Push failed' });
              }
            } else {
              vscode.window.showInformationMessage(`✓ Git: Committed locally.`);
              this._panel.webview.postMessage({ type: 'gitResult', success: true, message: 'Committed locally' });
            }
          });
        }
        break;
      }

      case 'setGitRemote': {
        if (!ws) return;
        const remoteUrl = (msg.remoteUrl || '').trim();
        if (!remoteUrl) {
          vscode.window.showWarningMessage('Please provide a valid remote URL.');
          return;
        }
        try {
          const checkOut = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws });
          if (checkOut && !checkOut.includes('fatal:')) {
            await runCommand('git', ['remote', 'set-url', 'origin', remoteUrl], { cwd: ws });
          } else {
            await runCommand('git', ['remote', 'add', 'origin', remoteUrl], { cwd: ws });
          }
          vscode.window.showInformationMessage(`✓ Git remote origin configured: ${remoteUrl}`);
          this._panel.webview.postMessage({ type: 'gitRemoteUpdated', remoteUrl });
        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to set git remote: ${e?.message || e}`);
        }
        break;
      }

      case 'openExternalUrl': {
        if (msg.url) {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
      }

      case 'getEnterpriseLicenseState': {
        const licenseState = this._svc?.license?.getState() || {
          isLicensed: false,
          plan: 'community',
          organization: 'Community User',
          licenseId: '',
          expiresAt: '',
          daysRemaining: 0,
          features: [],
        };
        this._panel.webview.postMessage({
          type: 'enterpriseLicenseState',
          state: licenseState,
        });
        break;
      }

      case 'activateEnterpriseLicense': {
        if (!this._svc?.license) return;
        const key = (msg.key || '').trim();
        const result = await this._svc.license.activateLicense(key);
        if (result.valid) {
          vscode.window.showInformationMessage(`✓ Enterprise License Activated for ${result.payload?.organization}!`);
        } else {
          vscode.window.showWarningMessage(`⚠️ ${result.error || 'Failed to validate license key.'}`);
        }
        this._panel.webview.postMessage({
          type: 'enterpriseLicenseResult',
          success: result.valid,
          message: result.valid
            ? `✓ Enterprise License Activated for ${result.payload?.organization} (${result.daysRemaining} days remaining)`
            : `⚠️ ${result.error || 'Failed to activate license'}`,
          state: this._svc.license.getState(),
        });
        break;
      }

      case 'deactivateEnterpriseLicense': {
        if (!this._svc?.license) return;
        await this._svc.license.deactivateLicense();
        vscode.window.showInformationMessage('Enterprise license deactivated. Reverted to Community Edition.');
        this._panel.webview.postMessage({
          type: 'enterpriseLicenseResult',
          success: true,
          message: 'License deactivated. Reverted to Community Edition.',
          state: this._svc.license.getState(),
        });
        break;
      }

      case 'generateDemoEnterpriseKey': {
        if (!this._svc?.license) return;
        const trialKey = LicenseGenerator.generateTrialKey(msg.orgName || 'Demo Enterprise Partner', 30);
        const result = await this._svc.license.activateLicense(trialKey);
        vscode.window.showInformationMessage(`✓ 30-Day Enterprise Platinum Trial Activated for ${result.payload?.organization}!`);
        this._panel.webview.postMessage({
          type: 'enterpriseLicenseResult',
          success: true,
          message: '✓ 30-Day Enterprise Platinum Trial Activated!',
          state: this._svc.license.getState(),
        });
        break;
      }

      case 'generateLoadTestSuite': {
        if (!ws) return;
        const isUnlocked = this._svc?.license?.isFeatureUnlocked('load_testing') ?? true; // Allow trial generation
        const suite = LoadTestGenerator.generateSuite({
          serviceName: msg.serviceName || 'ClientService',
          targetUrl: msg.targetUrl || 'http://localhost:8080/api/v1/invoices',
          method: msg.method || 'GET',
          authType: msg.authType || 'none',
          rampPreset: msg.rampPreset || 'standard',
          sla: {
            p95LatencyMs: parseInt(msg.p95LatencyMs) || 150,
            p99LatencyMs: parseInt(msg.p99LatencyMs) || 300,
            maxErrorRatePercent: parseFloat(msg.maxErrorRatePercent) || 1.0,
          },
          requestBody: msg.requestBody || undefined,
        });

        if (msg.writeToFile) {
          const k6Full = path.join(ws, suite.k6FilePath);
          const locustFull = path.join(ws, suite.locustFilePath);
          const shFull = path.join(ws, 'tests', 'load', 'run_load_test.sh');
          const psFull = path.join(ws, 'tests', 'load', 'run_load_test.ps1');

          fs.mkdirSync(path.dirname(k6Full), { recursive: true });
          fs.writeFileSync(k6Full, suite.k6Script, 'utf8');
          fs.writeFileSync(locustFull, suite.locustScript, 'utf8');
          fs.writeFileSync(shFull, suite.shellRunner, 'utf8');
          fs.writeFileSync(psFull, suite.psRunner, 'utf8');

          vscode.window.showInformationMessage(`✓ Generated k6 & Locust Load Test Suite in tests/load/`);
          try {
            const doc = await vscode.workspace.openTextDocument(k6Full);
            vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
          } catch {}
        }

        this._panel.webview.postMessage({
          type: 'loadTestSuiteGenerated',
          suite: suite,
          isLicensed: isUnlocked,
        });
        break;
      }

      case 'runLoadTestInTerminal': {
        if (!ws) return;
        const terminal = vscode.window.terminals.find(t => t.name === '🚀 FDE: Load Test')
          || vscode.window.createTerminal('🚀 FDE: Load Test');
        terminal.show();
        if (process.platform === 'win32') {
          terminal.sendText(`powershell -ExecutionPolicy Bypass -File .\\tests\\load\\run_load_test.ps1`);
        } else {
          terminal.sendText(`bash ./tests/load/run_load_test.sh`);
        }
        break;
      }

      case 'scaffoldRagPipeline': {
        if (!ws) return;
        const licenseMgr = this._svc?.licenseManager;
        const isUnlocked = licenseMgr ? licenseMgr.hasFeature('rag_scaffolder') : false;

        const options: RagPipelineOptions = {
          serviceName: msg.serviceName || 'ClientIntelApi',
          language: msg.language || 'python',
          vectorStore: msg.vectorStore || 'pgvector',
          embeddingProvider: msg.embeddingProvider || 'ollama_local',
          embeddingModel: msg.embeddingModel || 'nomic-embed-text',
          embeddingDimensions: msg.embeddingDimensions || 768,
          chunkSize: msg.chunkSize || 512,
          chunkOverlap: msg.chunkOverlap || 64,
          chunkingStrategy: msg.chunkingStrategy || 'recursive_character',
          distanceMetric: msg.distanceMetric || 'cosine',
          topK: msg.topK || 5,
          similarityThreshold: msg.similarityThreshold || 0.75,
          enableHybridSearch: msg.enableHybridSearch ?? true,
          enableGuardrails: msg.enableGuardrails ?? true,
          collectionName: msg.collectionName,
          databaseUri: msg.databaseUri
        };

        const scaffolded = RagPipelineScaffolder.scaffold(options);

        if (msg.writeToFile) {
          RagPipelineScaffolder.writeToDisk(ws, scaffolded);
          const ext = options.language === 'python' ? 'py' : 'ts';
          const pipelineFile = path.join(ws, `src/rag/rag_pipeline.${ext}`);
          try {
            const doc = await vscode.workspace.openTextDocument(pipelineFile);
            vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
          } catch {}
        }

        this._panel.webview.postMessage({
          type: 'ragPipelineScaffolded',
          files: scaffolded,
          isLicensed: isUnlocked
        });
        break;
      }

      case 'runRagTestsInTerminal': {
        if (!ws) return;
        const isPy = (msg.language || 'python') === 'python';
        const terminal = vscode.window.terminals.find(t => t.name === '🧠 FDE: RAG Pipeline')
          || vscode.window.createTerminal('🧠 FDE: RAG Pipeline');
        terminal.show();
        if (isPy) {
          terminal.sendText(`python -m unittest tests/test_rag_pipeline.py`);
        } else {
          terminal.sendText(`npm test tests/ragPipeline.test.ts`);
        }
        break;
      }

      case 'diagnoseGitConnection': {
        if (!ws) return;
        const target = msg.target || 'bitbucket';
        const host = target === 'bitbucket' ? 'git@bitbucket.org' : 'git@github.com';
        
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Diagnosing SSH connectivity to ${target.toUpperCase()} (${host})...`,
          cancellable: false
        }, async () => {
          const out = await runForStdout('ssh', ['-T', '-o', 'StrictHostKeyChecking=accept-new', host], { cwd: ws, timeoutMs: 8000 });
          const isSuccess = out && (out.includes('authenticated') || out.includes('logged in') || out.includes('successful'));
          
          this._panel.webview.postMessage({
            type: 'gitDiagnosticResult',
            target,
            success: isSuccess,
            rawOutput: out || 'No response or timed out. Check SSH key permissions (~/.ssh/id_rsa or id_ed25519).',
          });

          if (isSuccess) {
            vscode.window.showInformationMessage(`✓ ${target.toUpperCase()} SSH connection authenticated!`);
          } else {
            vscode.window.showWarningMessage(`SSH test response: ${out || 'Could not reach server. Verify SSH keys.'}`);
          }
        });
        break;
      }

      case 'openGitTerminal': {
        const terminal = this.getOrCreateGitTerminal();
        terminal.show();
        terminal.sendText('git status');
        break;
      }

      case 'createPullRequest': {
        if (!ws) return;
        const remoteOut = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws, timeoutMs: 3000 });
        if (remoteOut && /github\.com|gitlab\.com|bitbucket\.org/i.test(remoteOut)) {
          let url = remoteOut.trim().replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
          if (url.includes('github.com')) url += '/pull/new';
          else if (url.includes('gitlab.com')) url += '/-/merge_requests/new';
          else if (url.includes('bitbucket.org')) url += '/pull-requests/new';
          vscode.env.openExternal(vscode.Uri.parse(url));
          vscode.window.showInformationMessage(`🚀 Opening Pull Request in browser: ${url}`);
        } else {
          vscode.window.showInformationMessage('Open a Git repository with an origin remote to create Pull Requests.');
        }
        break;
      }

      case 'testCloudConnection': {
        if (!ws) return;
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Checking cloud provider CLI connections (GCP, AWS, Azure, Docker)...',
          cancellable: false
        }, async () => {
          let gcpInstalled = false, gcpOk = false, gcpAccount = '', gcpProject = '';
          let awsInstalled = false, awsOk = false, awsAccount = '';
          let azureInstalled = false, azureOk = false, azureAccount = '';
          let dockerInstalled = false, dockerRunning = false, dockerVersion = '';

          // 1. GCP Check
          try {
            const gVer = await runForStdout('gcloud', ['--version'], { cwd: ws, timeoutMs: 4000 });
            gcpInstalled = !!gVer && !gVer.includes('not recognized');
          } catch {}

          if (gcpInstalled) {
            try {
              const g = await runForStdout('gcloud', ['auth', 'list', '--format=json'], { cwd: ws, timeoutMs: 5000 });
              if (g && !g.includes('ERROR')) {
                const parsed = JSON.parse(g);
                const active = Array.isArray(parsed) ? parsed.find(a => a.status === 'ACTIVE') : null;
                if (active) {
                  gcpOk = true;
                  gcpAccount = active.account || '';
                }
              }
              const gProj = await runForStdout('gcloud', ['config', 'get-value', 'project'], { cwd: ws, timeoutMs: 3000 });
              if (gProj && !gProj.includes('unset') && !gProj.includes('ERROR')) gcpProject = gProj.trim();
            } catch {}
          }

          // 2. AWS Check
          try {
            const aVer = await runForStdout('aws', ['--version'], { cwd: ws, timeoutMs: 4000 });
            awsInstalled = !!aVer && !aVer.includes('not recognized');
          } catch {}

          if (awsInstalled) {
            try {
              const a = await runForStdout('aws', ['sts', 'get-caller-identity', '--output', 'json'], { cwd: ws, timeoutMs: 5000 });
              if (a && !a.includes('error')) {
                const parsed = JSON.parse(a);
                if (parsed.Arn) {
                  awsOk = true;
                  awsAccount = parsed.Arn.split('/').pop() || parsed.Account || 'Active';
                }
              }
            } catch {}
          }

          // 3. Azure Check
          try {
            const azVer = await runForStdout('az', ['version'], { cwd: ws, timeoutMs: 4000 });
            azureInstalled = !!azVer && !azVer.includes('not recognized');
          } catch {}

          if (azureInstalled) {
            try {
              const az = await runForStdout('az', ['account', 'show', '--output', 'json'], { cwd: ws, timeoutMs: 5000 });
              if (az && !az.includes('error')) {
                const parsed = JSON.parse(az);
                if (parsed.name || parsed.id) {
                  azureOk = true;
                  azureAccount = parsed.user?.name || parsed.name || 'Active';
                }
              }
            } catch {}
          }

          // 4. Docker Check
          try {
            const dVer = await runForStdout('docker', ['--version'], { cwd: ws, timeoutMs: 4000 });
            dockerInstalled = !!dVer && !dVer.includes('not recognized');
          } catch {}

          if (dockerInstalled) {
            try {
              const d = await runForStdout('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: ws, timeoutMs: 4000 });
              if (d && !d.includes('error') && !d.includes('Cannot connect') && !d.includes('failed to connect')) {
                dockerRunning = true;
                dockerVersion = `v${d.trim()}`;
              }
            } catch {}
          }

          this._panel.webview.postMessage({
            type: 'cloudDetailedStatus',
            gcp: { installed: gcpInstalled, ok: gcpOk, account: gcpAccount, project: gcpProject },
            aws: { installed: awsInstalled, ok: awsOk, account: awsAccount },
            azure: { installed: azureInstalled, ok: azureOk, account: azureAccount },
            docker: { installed: dockerInstalled, ok: dockerRunning, version: dockerVersion },
          });

          const summary = [
            `GCP: ${gcpOk ? '✓ Active' : (gcpInstalled ? '○ Not Logged In' : '⚠️ CLI Missing')}`,
            `AWS: ${awsOk ? '✓ Active' : (awsInstalled ? '○ Not Configured' : '⚠️ CLI Missing')}`,
            `Azure: ${azureOk ? '✓ Active' : (azureInstalled ? '○ Not Logged In' : '⚠️ CLI Missing')}`,
            `Docker: ${dockerRunning ? '✓ Active' : (dockerInstalled ? '⚠️ Daemon Stopped' : '⚠️ Missing')}`,
          ].join(' | ');

          vscode.window.showInformationMessage(`Cloud Health — ${summary}`);
        });
        break;
      }

      case 'connectCloudAccount': {
        const provider = msg.provider || 'gcp';
        const action = msg.action || 'login';
        const terminal = this.getOrCreateCloudTerminal();
        terminal.show();

        const isWin = process.platform === 'win32';
        const isMac = process.platform === 'darwin';

        if (provider === 'gcp') {
          if (action === 'install') {
            const cmd = isWin ? 'winget install -e --id Google.CloudSDK' : (isMac ? 'brew install --cask google-cloud-sdk' : 'curl https://sdk.cloud.google.com | bash');
            terminal.sendText(cmd);
            vscode.window.showInformationMessage('⬇️ Installing Google Cloud SDK in terminal...');
          } else {
            terminal.sendText('gcloud auth login');
            vscode.window.showInformationMessage('🔑 Initiated Google Cloud authentication in terminal. Follow the browser prompt to log in.');
          }
        } else if (provider === 'aws') {
          if (action === 'install') {
            const cmd = isWin ? 'winget install -e --id Amazon.AWSCLI' : (isMac ? 'brew install awscli' : 'sudo apt-get install awscli');
            terminal.sendText(cmd);
            vscode.window.showInformationMessage('⬇️ Installing AWS CLI in terminal...');
          } else {
            terminal.sendText('aws configure');
            vscode.window.showInformationMessage('🔑 Enter your AWS Access Key ID and Secret Access Key in the terminal.');
          }
        } else if (provider === 'azure') {
          if (action === 'install') {
            const cmd = isWin ? 'winget install -e --id Microsoft.AzureCLI' : (isMac ? 'brew install azure-cli' : 'curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash');
            terminal.sendText(cmd);
            vscode.window.showInformationMessage('⬇️ Installing Azure CLI via winget in terminal...');
          } else {
            terminal.sendText('az login');
            vscode.window.showInformationMessage('🔑 Initiated Azure login in terminal. Follow the browser prompt to log in.');
          }
        } else if (provider === 'docker') {
          if (action === 'startDocker') {
            if (isWin) {
              terminal.sendText('Start-Process "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" -ErrorAction SilentlyContinue');
              vscode.window.showInformationMessage('🐳 Launching Docker Desktop application on Windows...');
            } else if (isMac) {
              terminal.sendText('open /Applications/Docker.app');
              vscode.window.showInformationMessage('🐳 Launching Docker Desktop application...');
            } else {
              terminal.sendText('sudo systemctl start docker');
            }
          } else if (action === 'install') {
            const cmd = isWin ? 'winget install -e --id Docker.DockerDesktop' : (isMac ? 'brew install --cask docker' : 'curl -fsSL https://get.docker.com | sh');
            terminal.sendText(cmd);
            vscode.window.showInformationMessage('⬇️ Installing Docker Desktop in terminal...');
          } else {
            terminal.sendText('docker info');
          }
        }
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
    const allProjects = store.projects || [];
    const activeProjectId = store.activeProjectId || '';

    state.completedPhases = state.completedPhases || [];
    state.schemaMappings = state.schemaMappings || [];
    state.dataMarts = state.dataMarts || [];
    state.apiConnectors = state.apiConnectors || [];
    state.discoveredEnvVars = state.discoveredEnvVars || [];

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

    const safeJson = (val: any) => JSON.stringify(val || '').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

    const progressPercent = Math.round(((state.completedPhases || []).length / 4) * 100);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Forward-Deployed Engineers Delivery Studio (Beta)</title>
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

    /* Mart Builder & Columns */
    .mart-col-tray {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 6px;
      max-height: 110px;
      overflow-y: auto;
      background: var(--bg);
      padding: 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .mart-chip {
      font-size: 11px;
      padding: 3px 7px;
      border-radius: 3px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s;
    }
    .mart-chip:hover {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div>
      <div class="header-title">
        <span>🚀</span> Forward-Deployed Engineers Delivery Studio <span class="beta-pill">Beta</span>
      </div>
      <div style="font-size: 11px; margin-top: 3px; opacity: 0.85;">
        Built by <a href="https://www.evolveminds.com.au/" target="_blank" style="color: var(--accent); text-decoration: none; font-weight: 700;">Evolve Mind Solutions Pty Ltd</a> • Enterprise Client Delivery System
      </div>
    </div>
    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <button class="btn-quick" id="btnLicenseStatus" onclick="toggleEnterpriseLicenseDrawer()" style="padding: 5px 12px; font-size: 12px; margin-bottom: 0; font-weight: 700; color: #4ec9b0; border-color: rgba(78,201,176,0.5); background: rgba(78,201,176,0.1);" title="Click to view license status or activate enterprise key">
        💎 License: <span id="headerLicenseTier">Community (Free)</span>
      </button>
      <button class="btn btn-secondary" onclick="toggleRoadmap()" style="padding: 5px 12px; font-size: 12px;">🗺️ Roadmap &amp; Playbook</button>
      <div style="display: flex; align-items: center; gap: 6px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 4px; padding: 2px 8px;">
        <span style="font-size: 11px; font-weight: 700; opacity: 0.85;">Client:</span>
        <input type="text" id="clientNameInput" value="${state.clientName}" placeholder="Client Name..." style="width: 200px; margin-bottom: 0; padding: 4px 8px; border: none; background: transparent; font-weight: 600;" onchange="updateClientName(this.value)">
      </div>
    </div>
  </div>

  <!-- Enterprise License Management Drawer -->
  <div id="enterpriseLicenseDrawer" style="display: none; background: var(--card-bg); border: 1px solid var(--accent); border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.45);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 18px;">💎</span>
        <div>
          <div style="font-weight: 700; color: var(--accent); font-size: 14px;">Evolve AI Enterprise License Hub</div>
          <div style="font-size: 11px; opacity: 0.8;">100% Offline Cryptographic Verification &amp; Air-Gapped Compatibility</div>
        </div>
      </div>
      <button class="btn-quick" style="margin-bottom: 0;" onclick="toggleEnterpriseLicenseDrawer()">✕ Close</button>
    </div>

    <!-- Active License Status Card -->
    <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span style="font-size: 11px; font-weight: 700; opacity: 0.85;">ACTIVE PLAN:</span>
          <span id="drawerLicensePlanBadge" style="font-size: 11px; font-weight: 700; background: rgba(78,201,176,0.15); color: var(--accent); border: 1px solid rgba(78,201,176,0.4); padding: 2px 8px; border-radius: 12px;">🟢 Community Edition (Free)</span>
        </div>
        <div style="font-size: 12px;">
          <strong>Organization:</strong> <span id="drawerLicenseOrg">Community User</span>
          <span style="margin: 0 8px; opacity: 0.4;">|</span>
          <strong>Status:</strong> <span id="drawerLicenseStatus" style="color: var(--success); font-weight: 600;">Active</span>
          <span style="margin: 0 8px; opacity: 0.4;">|</span>
          <strong>Days Remaining:</strong> <span id="drawerLicenseDays">Unlimited (Free Core)</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn-quick" style="margin-bottom: 0; color: var(--warn); border-color: var(--warn);" onclick="deactivateEnterpriseLicense()">🗑️ Deactivate Key</button>
        <button class="btn-quick" style="margin-bottom: 0; color: var(--accent); border-color: var(--accent); font-weight: 700;" onclick="generateTrialLicense()">⚡ 30-Day Trial</button>
      </div>
    </div>

    <!-- Key Activation Input Form -->
    <div style="background: var(--card-alt); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; margin-bottom: 14px;">
      <label style="font-size: 11px; font-weight: 700; margin-bottom: 6px; display: block; color: var(--fg);">Activate Enterprise Key (format: <code>EM-ENT-V1.&lt;payload&gt;.&lt;signature&gt;</code>):</label>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" id="enterpriseLicenseInput" placeholder="Paste your Evolve Mind Solutions Enterprise Key here..." style="flex: 1; margin-bottom: 0; padding: 7px 10px; font-family: monospace; font-size: 11px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--fg);">
        <button class="btn" style="margin-bottom: 0; padding: 7px 16px; font-size: 12px; font-weight: 700;" onclick="activateEnterpriseLicense()">🚀 Activate</button>
      </div>
    </div>

    <!-- Enterprise Features & Procurement Banner -->
    <div style="background: rgba(78, 201, 176, 0.06); border: 1px dashed rgba(78, 201, 176, 0.4); border-radius: 6px; padding: 14px 18px; margin-bottom: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
        <div style="font-size: 13px; font-weight: 700; color: var(--accent);">💎 Enterprise Capabilities Unlocked with Active License:</div>
        <button class="btn" style="background: var(--accent); color: var(--bg); font-weight: 700; padding: 6px 14px; font-size: 11px; margin-bottom: 0;" onclick="openExternalUrl('https://www.evolveminds.com.au/contact')">🌐 Request Custom Enterprise License ↗</button>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: var(--success);">⚡ Automated Performance &amp; SLA Load Testing</div>
            <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">k6 &amp; Locust stress tests with SLA p95/p99 latency gates.</div>
          </div>
          <button class="btn-quick" style="margin-bottom: 0; padding: 4px 10px; font-size: 11px; font-weight: 700; color: var(--accent); border-color: var(--accent);" onclick="launchEnterpriseFeature('loadTesting')">🚀 Launch</button>
        </div>

        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: var(--success);">🧠 Enterprise Air-Gapped RAG &amp; Vector Pipeline</div>
            <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">Document chunker, hybrid search, and pgvector/Qdrant scaffolder.</div>
          </div>
          <button class="btn-quick" style="margin-bottom: 0; padding: 4px 10px; font-size: 11px; font-weight: 700; color: var(--accent); border-color: var(--accent);" onclick="launchEnterpriseFeature('ragScaffolder')">🚀 Launch</button>
        </div>

        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: var(--accent);">📊 dbt Data Quality &amp; Schema Drift Gates</div>
            <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">Great Expectations assertions &amp; anomaly detection.</div>
          </div>
          <span style="font-size: 10px; background: var(--card-alt); border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; opacity: 0.8;">Phase 3</span>
        </div>

        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: var(--accent);">🛡️ SOC2 / HIPAA Audit Logger &amp; SIEM Forwarders</div>
            <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">Structured JSON audit logs for Splunk, Datadog &amp; Sentinel.</div>
          </div>
          <span style="font-size: 10px; background: var(--card-alt); border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; opacity: 0.8;">Phase 4</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Multi-Project Switcher & Toolbar -->
  <div style="background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
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
      <span><strong>Artifacts:</strong> ${state.schemaMappings.length} models, ${(state.dataMarts || []).length} marts, ${state.apiConnectors.length} APIs</span>
    </div>
  </div>

  <!-- Git & Bitbucket / GitHub Remote & Cloud Hub -->
  <div style="background: var(--card-alt); border: 1px solid var(--border); border-radius: 8px; padding: 8px 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 12px;">
    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
      <span style="font-weight: 700; color: var(--accent); display: flex; align-items: center; gap: 4px;">🌿</span>
      <select id="gitBranchSelect" onchange="switchGitBranch(this.value)" style="padding: 4px 8px; font-size: 11px; font-weight: 700; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--fg); min-width: 120px; cursor: pointer;" title="Active Git Branch (Click to switch)">
        <option value="main">main</option>
      </select>
      <button class="btn-quick" style="margin-bottom: 0; padding: 3px 8px; font-size: 10px;" onclick="promptNewBranch()" title="Create new branch">➕ New Branch</button>
      <span style="opacity: 0.6;">|</span>
      <span style="font-family: monospace; font-size: 11px; opacity: 0.9; cursor: pointer; border-bottom: 1px dashed var(--accent);" id="gitRemoteBadge" onclick="toggleGitSetupDrawer()" title="Click to configure Git / Bitbucket / GitHub remote">checking git remote...</span>
      <span style="opacity: 0.6;">|</span>
      <span id="gitDirtyBadge" style="padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: var(--card-bg); cursor: pointer;" onclick="toggleCommitDrawer()" title="Click to open Smart Commit & Push Studio">checking...</span>
    </div>
    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
      <button class="btn-quick" id="btnGitSetup" style="margin-bottom: 0;" onclick="toggleGitSetupDrawer()">⚙️ Git Setup</button>
      <button class="btn-quick" style="margin-bottom: 0;" onclick="gitFetch()">🔄 Sync &amp; Fetch</button>
      <button class="btn-quick" style="margin-bottom: 0; color: var(--success); border-color: var(--success); font-weight: 700;" onclick="toggleCommitDrawer()">📦 1-Click Commit &amp; Push</button>
      <button class="btn-quick" style="margin-bottom: 0;" onclick="createPullRequest()">🚀 Create PR</button>
      <button class="btn-quick" id="btnCloudHub" style="margin-bottom: 0;" onclick="toggleCloudHubDrawer()">☁️ Cloud Hub &amp; Connect</button>
    </div>
  </div>

  <!-- Smart AI Commit & Push Studio Drawer -->
  <div id="gitCommitDrawer" style="display: none; background: var(--card-bg); border: 1px solid var(--success); border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.35);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-weight: 700; color: var(--success); font-size: 13px;">📦 1-Click Smart Commit &amp; Push Studio</span>
        <span style="font-size: 10px; background: rgba(78, 201, 176, 0.15); color: var(--accent); padding: 2px 6px; border-radius: 10px; font-weight: 700;">CONVENTIONAL COMMITS</span>
      </div>
      <button class="btn-quick" style="margin-bottom: 0;" onclick="toggleCommitDrawer()">✕ Close</button>
    </div>

    <!-- Changed Files Summary Banner -->
    <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-size: 11px; font-weight: 700; opacity: 0.85;">Staged &amp; Modified Deliverables:</span>
        <span id="commitFilesCountBadge" style="font-size: 10px; font-weight: 700; color: var(--accent);">0 files</span>
      </div>
      <div id="commitChangedFilesList" style="max-height: 80px; overflow-y: auto; font-family: monospace; font-size: 11px; display: flex; flex-direction: column; gap: 3px;">
        <span style="opacity: 0.6;">No changes detected</span>
      </div>
    </div>

    <!-- Commit Title Input -->
    <div style="margin-bottom: 10px;">
      <label style="font-size: 11px; font-weight: 700; display: block; margin-bottom: 4px;">Commit Title (Conventional format: &lt;type&gt;(&lt;scope&gt;): &lt;summary&gt;)</label>
      <input type="text" id="commitTitleInput" placeholder="e.g. feat(fde): add dimensional mart builder and live introspector" style="font-family: monospace; font-size: 12px; font-weight: 600; width: 100%; margin-bottom: 0;">
    </div>

    <!-- Commit Description Input -->
    <div style="margin-bottom: 10px;">
      <label style="font-size: 11px; font-weight: 700; display: block; margin-bottom: 4px;">Detailed Summary / Description (Bullet points)</label>
      <textarea id="commitDescInput" rows="3" placeholder="- Staged and committed client pilot deliverables&#10;- Configured API connectors and staging transformations" style="width: 100%; margin-bottom: 0;"></textarea>
    </div>

    <!-- AI & Auto-Draft Controls -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; padding: 6px 0; border-top: 1px dashed var(--border); border-bottom: 1px dashed var(--border);">
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn-quick" onclick="draftWithAi()" style="color: var(--accent); border-color: var(--accent); font-weight: 700; margin-bottom: 0;">🤖 Draft with AI</button>
        <button class="btn-quick" onclick="draftHeuristic()" style="margin-bottom: 0;">⚡ Quick Auto-Draft</button>
        <span style="font-size: 11px; opacity: 0.75;">Target Branch: <strong id="commitTargetBranchBadge" style="color: var(--accent);">main</strong></span>
      </div>
      <div style="display: flex; gap: 12px; align-items: center;">
        <label style="font-size: 11px; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
          <input type="checkbox" id="chkCommitPushRemote" checked style="width: auto; margin: 0;">
          <span>Push to origin/<span id="commitTargetBranchBadge2">main</span></span>
        </label>
        <label style="font-size: 11px; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
          <input type="checkbox" id="chkCommitInTerminal" checked style="width: auto; margin: 0;">
          <span>Run in terminal</span>
        </label>
      </div>
    </div>

    <!-- Execution Bar -->
    <div style="display: flex; gap: 8px; align-items: center;">
      <button class="btn" style="background: var(--success); color: #fff; font-weight: 700;" onclick="executeCommitAndPush()">🚀 Commit &amp; Push Deliverables</button>
      <button class="btn-secondary btn" onclick="toggleCommitDrawer()">✕ Cancel</button>
    </div>
  </div>

  <!-- Git & Bitbucket / GitHub Setup & Auth Hub Drawer -->
  <div id="gitSetupDrawer" style="display: none; background: var(--card-bg); border: 1px solid var(--accent); border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.35);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div style="font-weight: 700; color: var(--accent); font-size: 13px;">
        🔗 Git &amp; Bitbucket / GitHub / GitLab Remote &amp; Auth Hub
      </div>
      <button class="btn-quick" style="margin-bottom: 0;" onclick="toggleGitSetupDrawer()">✕ Close</button>
    </div>

    <!-- Direct Settings Links Portals -->
    <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 14px;">
      <div style="font-size: 11px; font-weight: 700; opacity: 0.85; margin-bottom: 6px;">1-Click Direct Access to Cloud Git Settings &amp; Token Portals:</div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        <div style="background: var(--card-bg); padding: 8px; border-radius: 4px; border: 1px solid var(--border);">
          <div style="font-size: 11px; font-weight: 700; margin-bottom: 4px;">Atlassian Bitbucket</div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <button class="btn-quick" style="margin-bottom: 0; text-align: left;" onclick="openExternalUrl('https://bitbucket.org/account/settings/app-passwords/new')">🔑 Get App Password ↗</button>
            <button class="btn-quick" style="margin-bottom: 0; text-align: left;" onclick="openExternalUrl('https://bitbucket.org/account/settings/ssh-keys/')">🗝️ Add SSH Key ↗</button>
          </div>
        </div>

        <div style="background: var(--card-bg); padding: 8px; border-radius: 4px; border: 1px solid var(--border);">
          <div style="font-size: 11px; font-weight: 700; margin-bottom: 4px;">GitHub</div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <button class="btn-quick" style="margin-bottom: 0; text-align: left;" onclick="openExternalUrl('https://github.com/settings/tokens/new?scopes=repo,workflow&description=Evolve+AI+(VS+Code)')">🔑 Get GitHub PAT (repo scope) ↗</button>
            <button class="btn-quick" style="margin-bottom: 0; text-align: left;" onclick="openExternalUrl('https://github.com/settings/keys')">🗝️ Add SSH Key ↗</button>
          </div>
        </div>

        <div style="background: var(--card-bg); padding: 8px; border-radius: 4px; border: 1px solid var(--border);">
          <div style="font-size: 11px; font-weight: 700; margin-bottom: 4px;">GitLab</div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <button class="btn-quick" style="margin-bottom: 0; text-align: left;" onclick="openExternalUrl('https://gitlab.com/-/user_settings/personal_access_tokens')">🔑 Get Access Token ↗</button>
            <button class="btn-quick" style="margin-bottom: 0; text-align: left;" onclick="openExternalUrl('https://gitlab.com/-/user_settings/ssh_keys')">🗝️ Add SSH Key ↗</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 2 Auth Modes: HTTPS + PAT vs SSH Key -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
      <!-- Mode 1: HTTPS + PAT -->
      <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--accent); margin-bottom: 8px;">🔑 Method 1: HTTPS with Token / App Password</div>
        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 8px;">Fastest setup for Bitbucket or GitHub. No SSH configuration needed.</div>
        
        <div style="margin-bottom: 8px;">
          <label style="font-size: 10px; font-weight: 700;">Remote Repository HTTPS URL</label>
          <input type="text" id="httpsRepoUrl" placeholder="https://bitbucket.org/workspace/repo.git or https://github.com/org/repo.git" style="font-family: monospace; font-size: 11px;">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
          <div>
            <label style="font-size: 10px; font-weight: 700;">Username / Account</label>
            <input type="text" id="httpsUsername" placeholder="e.g. john_doe" style="font-size: 11px;">
          </div>
          <div>
            <label style="font-size: 10px; font-weight: 700;">Token / App Password</label>
            <input type="password" id="httpsToken" placeholder="••••••••••••" style="font-size: 11px;">
          </div>
        </div>
        <button class="btn" style="width: 100%; font-size: 11px; margin-bottom: 0;" onclick="saveHttpsGitRemote()">🔗 Configure HTTPS Remote &amp; Verify</button>
      </div>

      <!-- Mode 2: SSH Key Auth -->
      <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--accent); margin-bottom: 8px;">🗝️ Method 2: SSH Key Authentication</div>
        <div style="font-size: 11px; opacity: 0.8; margin-bottom: 8px;">Enterprise air-gapped authentication via cryptographic SSH keys.</div>

        <div style="margin-bottom: 8px;">
          <label style="font-size: 10px; font-weight: 700;">Remote Repository SSH URL</label>
          <input type="text" id="sshRepoUrl" placeholder="git@bitbucket.org:workspace/repo.git or git@github.com:org/repo.git" style="font-family: monospace; font-size: 11px;">
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 11px;">
          <span>SSH Key Status:</span>
          <span id="sshKeyStatusBadge" style="font-weight: 700; color: var(--accent);">detecting...</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
          <button class="btn-quick" style="margin-bottom: 0;" onclick="copySshKey()">📋 Copy Public Key</button>
          <button class="btn-quick" style="margin-bottom: 0;" onclick="generateSshKey()">⚡ Generate ed25519</button>
        </div>
        <button class="btn" style="width: 100%; font-size: 11px; margin-bottom: 0;" onclick="saveSshGitRemote()">🔗 Set SSH Remote &amp; Test</button>
      </div>
    </div>

    <!-- Diagnostics & Terminal Stream -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <span style="font-size: 11px; font-weight: bold;">Quick Diagnostics:</span>
        <button class="btn-quick" style="margin-bottom: 0;" onclick="diagnoseGit('bitbucket')">🔍 Test Bitbucket SSH</button>
        <button class="btn-quick" style="margin-bottom: 0;" onclick="diagnoseGit('github')">🔍 Test GitHub SSH</button>
        <button class="btn-quick" style="margin-bottom: 0;" onclick="openGitTerminal()">💻 Open Live Terminal</button>
        <button class="btn-quick" style="margin-bottom: 0;" onclick="initGitRepo()">🚀 Initialize Git (git init)</button>
      </div>
      <div>
        <label style="font-size: 11px; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
          <input type="checkbox" id="chkRunInTerminal" checked style="width: auto; margin: 0;">
          <span>Run operations in visible VS Code Terminal</span>
        </label>
      </div>
    </div>

    <div id="gitDiagnosticBanner" style="display: none; margin-top: 10px; background: var(--bg); padding: 10px; border-radius: 4px; border: 1px solid var(--border); font-family: monospace; font-size: 11px; white-space: pre-wrap;"></div>
  </div>

  <!-- Multi-Cloud Connection & Auth Hub Drawer -->
  <div id="cloudHubDrawer" style="display: none; background: var(--card-bg); border: 1px solid var(--accent); border-radius: 8px; padding: 14px 18px; margin-bottom: 16px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div style="font-weight: 700; color: var(--accent); font-size: 13px;">
        ☁️ Multi-Cloud Connection &amp; Authentication Hub
      </div>
      <button class="btn-quick" style="margin-bottom: 0;" onclick="toggleCloudHubDrawer()">✕ Close</button>
    </div>

    <!-- 4 Cloud Provider Status Cards -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px;">
      <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px;">
        <div style="font-size: 11px; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>Google Cloud (GCP)</span>
          <span id="cloudGcpBadge" style="color: var(--warn); font-size: 10px;">checking...</span>
        </div>
        <div style="font-size: 10px; opacity: 0.8; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="cloudGcpAccount">Account: detecting...</div>
        <button class="btn-quick" id="btnConnectGcp" style="width: 100%; margin-bottom: 0; font-size: 10px;" onclick="connectCloud('gcp', 'login')">🔑 Connect GCP</button>
      </div>

      <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px;">
        <div style="font-size: 11px; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>Amazon AWS</span>
          <span id="cloudAwsBadge" style="color: var(--warn); font-size: 10px;">checking...</span>
        </div>
        <div style="font-size: 10px; opacity: 0.8; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="cloudAwsAccount">Account: detecting...</div>
        <button class="btn-quick" id="btnConnectAws" style="width: 100%; margin-bottom: 0; font-size: 10px;" onclick="connectCloud('aws', 'login')">🔑 Connect AWS</button>
      </div>

      <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px;">
        <div style="font-size: 11px; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>Microsoft Azure</span>
          <span id="cloudAzureBadge" style="color: var(--warn); font-size: 10px;">checking...</span>
        </div>
        <div style="font-size: 10px; opacity: 0.8; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="cloudAzureAccount">Account: detecting...</div>
        <button class="btn-quick" id="btnConnectAzure" style="width: 100%; margin-bottom: 0; font-size: 10px;" onclick="connectCloud('azure', 'login')">🔑 Connect Azure</button>
      </div>

      <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px;">
        <div style="font-size: 11px; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between;">
          <span>Docker Engine</span>
          <span id="cloudDockerBadge" style="color: var(--warn); font-size: 10px;">checking...</span>
        </div>
        <div style="font-size: 10px; opacity: 0.8; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="cloudDockerAccount">Daemon: detecting...</div>
        <button class="btn-quick" id="btnConnectDocker" style="width: 100%; margin-bottom: 0; font-size: 10px;" onclick="connectCloud('docker', 'login')">🐳 Check Docker</button>
      </div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 6px; border-top: 1px solid var(--border);">
      <span style="font-size: 11px; opacity: 0.8;">💡 Connecting runs official CLI login with browser SSO OAuth in your VS Code terminal.</span>
      <button class="btn" style="margin-bottom: 0;" onclick="testCloudConnection()">🔄 Refresh Cloud Status</button>
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
          • Cross-model dimensional joins &amp; marts
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
          • Multi-cloud parameter matrix<br>
          • Deterministic Pre-Flight Audit<br>
          • Scaffold Terraform / K8s / Docker<br>
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
      <button class="nav-btn ${state.activePhase === 1 ? 'active' : ''}" onclick="setPhase(1)">📊 1. Schema &amp; Marts</button>
      <button class="nav-btn ${state.activePhase === 2 ? 'active' : ''}" onclick="setPhase(2)">🔌 2. Client API Studio</button>
      <button class="nav-btn ${state.activePhase === 3 ? 'active' : ''}" onclick="setPhase(3)">⚡ 3. Pilot Deployment</button>
      <button class="nav-btn ${state.activePhase === 4 ? 'active' : ''}" onclick="setPhase(4)">📑 4. Runbook Factory</button>
    </div>

    <div>
      <!-- PHASE 1: SCHEMA MAPPER & MARTS BUILDER -->
      <div class="content-card" id="phase1" style="display: ${state.activePhase === 1 ? 'block' : 'none'};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
          <div>
            <h3>📊 Semantic Schema Mapper &amp; Dimensional Mart Builder</h3>
            <p class="desc">Ingest foreign client datasets into clean staging models, or connect directly to live databases (PostgreSQL, Snowflake, BigQuery) to introspect table schemas.</p>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn-quick" style="background: var(--accent); color: #fff;" onclick="toggleDbConnectModal()">🔌 Connect Live DB / Warehouse</button>
            <button class="btn-quick" onclick="pickSchemaFile()">📁 Browse CSV / Schema</button>
            <button class="btn-quick" onclick="loadSampleSchema('orders')">⚡ Orders</button>
            <button class="btn-quick" onclick="loadSampleSchema('users')">⚡ Users</button>
            <button class="btn-quick" onclick="loadSampleSchema('payments')">⚡ Payments</button>
          </div>
        </div>

        <!-- Inline Live Database Connector Drawer -->
        <div id="dbConnectBox" style="display: none; background: var(--card-alt); border: 1px solid var(--accent); border-radius: 8px; padding: 16px; margin-bottom: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="font-weight: 700; color: var(--accent); font-size: 13px;">
              🔌 Connect Live Database / Warehouse <span style="font-size: 11px; opacity: 0.8; font-weight: normal; color: var(--fg);">(Credentials Encrypted at Rest via OS Vault)</span>
            </div>
            <button class="btn-quick" style="margin-bottom: 0;" onclick="toggleDbConnectModal()">✕ Close</button>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 12px; margin-bottom: 10px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Database Engine / Dialect</label>
              <select id="dbDialect" onchange="handleDialectChange()">
                <option value="postgres" selected>PostgreSQL / Supabase / Redshift</option>
                <option value="snowflake">Snowflake Data Cloud</option>
                <option value="bigquery">Google BigQuery</option>
                <option value="mysql">MySQL / MariaDB / Aurora</option>
                <option value="sqlserver">Microsoft SQL Server / Azure SQL</option>
                <option value="sqlite">SQLite (Local .db File)</option>
              </select>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <label style="font-size: 11px; font-weight: bold;">Connection URI / Host String (Masked)</label>
                <a href="#" style="font-size: 10px; color: var(--accent); text-decoration: none;" onclick="toggleUriVisibility(event)">👁️ Show/Hide</a>
              </div>
              <input type="password" id="dbConnUri" placeholder="postgresql://username:password@localhost:5432/pilot_db" style="font-family: monospace;">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Database / Project ID</label>
              <input type="text" id="dbDatabaseName" placeholder="pilot_db or gcp-project-id" value="${state.activeDbConnection?.database || ''}">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Schema / Dataset ID</label>
              <input type="text" id="dbSchemaName" placeholder="public, raw, or dataset_name" value="${state.activeDbConnection?.schema || 'public'}">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Credential Vault Policy</label>
              <select id="dbSavePolicy">
                <option value="session" selected>Session Only (In-Memory)</option>
                <option value="vault">Save to OS Vault (vscode.SecretStorage)</option>
              </select>
            </div>
          </div>

          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button class="btn" onclick="introspectDatabase()">🔍 Connect &amp; Fetch Tables</button>
            <button class="btn btn-secondary" onclick="testDbConnection()">🔌 Test Connection</button>
            <button class="btn btn-secondary" onclick="detectWorkspaceDb()">⚡ Auto-Detect from .env / dbt</button>
            <button class="btn-quick" style="margin-bottom: 0; color: var(--error); border-color: var(--error);" onclick="wipeDbSecrets()">🗑️ Wipe Stored Credentials</button>
          </div>

          <!-- Discovered Tables Selector -->
          <div id="dbTablesContainer" style="display: none; margin-top: 14px; background: var(--bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="font-size: 12px; font-weight: 700; color: var(--success);" id="dbConnectionStatusBadge">
                ✓ Database Connected: Select a Table to Load
              </div>
              <input type="text" id="dbTableFilterInput" placeholder="🔍 Filter tables..." oninput="filterDiscoveredTables()" style="width: 180px; margin-bottom: 0; font-size: 11px; padding: 4px 8px;">
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
              <select id="dbTableSelect" style="flex: 1; margin-bottom: 0;" onchange="applySelectedDbTable()">
                <option value="">-- Choose an introspected table --</option>
              </select>
              <button class="btn" style="white-space: nowrap; margin-bottom: 0;" onclick="applySelectedDbTable()">📥 Load Schema into Mapper</button>
            </div>
          </div>
        </div>

        <!-- Mapped Schemas & Marts in Current Engagement -->
        ${state.schemaMappings.length > 0 || (state.dataMarts || []).length > 0 ? `
        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 700; margin-bottom: 8px; color: var(--success);">
            Active Staging Models (${state.schemaMappings.length}) &amp; Marts (${(state.dataMarts || []).length}):
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${state.schemaMappings.map(m => `
              <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px;">
                <div>
                  <span style="color: var(--accent); font-weight: 700;">[Staging]</span> <strong>${m.targetModelName}</strong> <span style="opacity: 0.75;">(from <code>${m.sourceName}</code> • ${m.columns.length} cols • ${m.dialect})</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="openDoc('models/staging/${m.targetModelName}.sql')">📄 Open</button>
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px; color: var(--error); border-color: var(--error);" onclick="deleteSchemaMapping('${m.sourceName}')">🗑️ Remove</button>
                </div>
              </div>
            `).join('')}
            ${(state.dataMarts || []).map(dm => `
              <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border); font-size: 12px;">
                <div>
                  <span style="color: var(--success); font-weight: 700;">[Mart / Fact]</span> <strong>${dm.martName}</strong> <span style="opacity: 0.75;">(base: <code>${dm.baseModel}</code> • ${dm.joins.length} joins • ${dm.dimensions.length} dims)</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="openDoc('models/marts/${dm.martName}.sql')">📄 Open</button>
                  <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px; color: var(--error); border-color: var(--error);" onclick="deleteDataMart('${dm.martName}')">🗑️ Remove</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Section Mode Tabs -->
        <div class="code-tabs" style="margin-bottom: 16px;">
          <div class="code-tab active" id="tabPhase1Staging" onclick="switchPhase1Mode('staging')">1. Staging Schema Mapper</div>
          <div class="code-tab" id="tabPhase1Mart" onclick="switchPhase1Mode('mart')">2. 🔀 Cross-Model / Mart Join Builder</div>
        </div>

        <!-- SUB-PANEL A: STAGING MAPPER -->
        <div id="subpanelStaging">
          <!-- AI Staging Schema Copilot Bar -->
          <div style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="background: linear-gradient(135deg, #6366f1, #a855f7); color: white; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 11px;">✨ AI Copilot</span>
                <span>Auto-clean schemas, normalize data types, and detect sensitive PII for any loaded table.</span>
              </div>
              <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                <button class="btn-primary" style="margin-bottom: 0; padding: 4px 12px; font-size: 11px; background: linear-gradient(135deg, #6366f1, #8b5cf6);" onclick="triggerAiStagingClean(false)">✨ AI Auto-Clean &amp; Standardize</button>
                <button class="btn-quick" style="margin-bottom: 0; padding: 4px 10px; font-size: 11px;" onclick="triggerAiStagingClean(true)">🔒 AI PII Masking</button>
                <button class="btn-quick" style="margin-bottom: 0; padding: 4px 10px; font-size: 11px;" onclick="toggleAiPromptBox('staging')">🪄 Custom Prompt</button>
              </div>
            </div>
            <!-- Collapsible AI Prompt Drawer -->
            <div id="aiStagingPromptBox" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(99, 102, 241, 0.25);">
              <div style="display: flex; gap: 8px;">
                <input type="text" id="aiStagingCustomPrompt" style="flex: 1; font-size: 12px;" placeholder="e.g. 'Prefix timestamp columns with event_, convert revenue to AUD cents, and mask email addresses'..." />
                <button class="btn-primary" style="padding: 4px 12px; font-size: 11px; margin-bottom: 0;" onclick="triggerAiStagingCleanWithPrompt()">Apply AI Instruction</button>
              </div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <label style="font-size: 11px; font-weight: bold;">Source Columns (Raw Client Schema)</label>
                <span id="srcFileBadge" style="font-size: 10px; opacity: 0.85; font-family: monospace; color: var(--success);"></span>
              </div>
              <textarea id="srcCols" style="height: 120px;" placeholder="Paste raw columns here or click 'Browse CSV / Schema File'...&#10;e.g.&#10;CUST_NBR_ID:string&#10;TXN_AMT:float&#10;CREATED_TS:timestamp&#10;IS_ACTIVE_FLG:string"></textarea>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <label style="font-size: 11px; font-weight: bold;">Target Model Columns (Platform Standard)</label>
                <span style="font-size: 10px; opacity: 0.8;">Standardized schema</span>
              </div>
              <textarea id="tgtCols" style="height: 120px;" placeholder="Target columns will be auto-generated by AI or editable directly...&#10;e.g.&#10;customer_id:string&#10;transaction_amount:numeric&#10;created_at:timestamp&#10;is_active:boolean"></textarea>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 14px; margin-bottom: 16px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Source Table / Dataset Name</label>
              <input type="text" id="srcNameInput" value="client_orders_raw" placeholder="e.g. client_orders_raw">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Target Model Name (dbt / View)</label>
              <input type="text" id="modelNameInput" value="stg_orders" oninput="handleModelNameInput(this.value)" placeholder="e.g. stg_orders">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Target File Output Path (Customizable)</label>
              <input type="text" id="modelOutputPathInput" value="models/staging/stg_orders.sql" placeholder="e.g. models/staging/stg_orders.sql">
            </div>
          </div>

          <div id="schemaErrorAlert" style="display: none; background: var(--error-bg); border: 1px solid var(--error); color: var(--error); padding: 10px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 14px;"></div>

          <div style="display: flex; gap: 10px; align-items: center;">
            <button class="btn" onclick="generateSchemaMapping()">🚀 Generate dbt Staging Model</button>
            <span style="font-size: 11px; opacity: 0.75;">Scaffolds custom staging model SQL into configured output path</span>
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
            <pre id="schemaCodePreview" class="code-preview" style="max-height: 240px;"></pre>
            
            <h4 style="margin: 18px 0 10px 0;">Column Semantic Mapping Breakdown</h4>
            <div id="schemaTableContainer"></div>
          </div>
        </div>

        <!-- SUB-PANEL B: CROSS-MODEL / MART JOIN BUILDER -->
        <div id="subpanelMart" style="display: none;">
          <!-- AI Mart Copilot & Recipe Discovery Bar -->
          <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="background: linear-gradient(135deg, #10b981, #6366f1); color: white; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 11px;">✨ AI Mart Copilot</span>
                <span>Discover foreign key joins, dimensional metrics, and smart recipes tailored to your tables.</span>
              </div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <button class="btn-primary" style="margin-bottom: 0; padding: 4px 12px; font-size: 11px; background: linear-gradient(135deg, #10b981, #059669);" onclick="triggerAiDiscoverMartRecipes()">✨ AI Discover Mart Recipes</button>
                <button class="btn-quick" style="margin-bottom: 0; padding: 4px 10px; font-size: 11px;" onclick="toggleAiPromptBox('mart')">💬 AI Prompt Generator</button>
                <button class="btn-quick" style="margin-bottom: 0; font-size: 11px; padding: 4px 10px;" onclick="refreshMartModelOptions()">🔄 Refresh Tables</button>
              </div>
            </div>

            <!-- AI Discovered Dynamic Recipes Tray -->
            <div id="aiMartRecipesContainer" style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
              <!-- Dynamic chips will be inserted here when AI runs -->
            </div>

            <!-- Collapsible Natural Language Prompt Box -->
            <div id="aiMartPromptBox" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(16, 185, 129, 0.3);">
              <div style="display: flex; gap: 8px;">
                <input type="text" id="aiMartCustomPrompt" style="flex: 1; font-size: 12px;" placeholder="e.g. 'Build a daily retention fact mart tracking deletions and active users by country' or 'Calculate revenue by customer'..." />
                <button class="btn-primary" style="padding: 4px 12px; font-size: 11px; background: #10b981; margin-bottom: 0;" onclick="triggerAiGenerateMartFromPrompt()">Generate Mart with AI</button>
              </div>
            </div>
          </div>

          <!-- Models & Column Inspector Grid -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <label style="font-size: 11px; font-weight: bold; color: var(--accent);">Primary / Base Model</label>
              <select id="martBaseModel" onchange="handleMartModelChange()">
                <option value="">-- Choose Base Model --</option>
              </select>
              <div style="font-size: 10px; opacity: 0.8; margin-top: 4px;">Available Columns (Click to add as Dimension / Metric):</div>
              <div id="martBaseColsTray" class="mart-col-tray">
                <span style="font-size: 10px; opacity: 0.6;">Select a model above to inspect columns</span>
              </div>
            </div>

            <div style="background: var(--card-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
              <label style="font-size: 11px; font-weight: bold; color: var(--accent);">Joined Model</label>
              <select id="martJoinModel" onchange="handleMartModelChange()">
                <option value="">-- Choose Joined Model --</option>
              </select>
              <div style="font-size: 10px; opacity: 0.8; margin-top: 4px;">Available Columns (Click to add as Dimension / Metric):</div>
              <div id="martJoinColsTray" class="mart-col-tray">
                <span style="font-size: 10px; opacity: 0.6;">Select a model above to inspect columns</span>
              </div>
            </div>
          </div>

          <!-- Primary Join Condition Matrix -->
          <div style="display: grid; grid-template-columns: 160px 1fr; gap: 14px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Join Type</label>
              <select id="martJoinType">
                <option value="LEFT">LEFT JOIN</option>
                <option value="INNER">INNER JOIN</option>
                <option value="FULL">FULL OUTER JOIN</option>
                <option value="RIGHT">RIGHT JOIN</option>
                <option value="CROSS">CROSS JOIN</option>
              </select>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <label style="font-size: 11px; font-weight: bold;">Join Condition (ON clause)</label>
                <span id="martJoinSuggestionText" style="font-size: 11px; color: var(--success); font-weight: 600;"></span>
              </div>
              <input type="text" id="martOnCondition" value="orders.customer_id = users.user_id" placeholder="e.g. orders.customer_id = users.user_id">
            </div>
          </div>

          <!-- Secondary Join Expandable Container -->
          <div id="secondaryJoinRow" style="display: none; background: var(--bg); padding: 10px 14px; border-radius: 6px; border: 1px dashed var(--border); margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="font-size: 11px; color: var(--accent);">Secondary Join Table (Optional 3rd Model):</strong>
              <button class="btn-quick" style="margin-bottom: 0; padding: 2px 6px; font-size: 10px;" onclick="toggleSecondaryJoin()">✕ Remove Secondary Join</button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 140px 1.5fr; gap: 10px;">
              <div>
                <label style="font-size: 10px; font-weight: bold;">Secondary Join Model</label>
                <select id="martJoin2Model" style="margin-bottom: 0;" onchange="handleSecondaryJoinChange()">
                  <option value="">-- Choose 3rd Model --</option>
                </select>
              </div>
              <div>
                <label style="font-size: 10px; font-weight: bold;">Join Type</label>
                <select id="martJoin2Type" style="margin-bottom: 0;">
                  <option value="LEFT">LEFT JOIN</option>
                  <option value="INNER">INNER JOIN</option>
                  <option value="FULL">FULL OUTER JOIN</option>
                </select>
              </div>
              <div>
                <label style="font-size: 10px; font-weight: bold;">Join Condition</label>
                <input type="text" id="martJoin2On" placeholder="e.g. payments.order_id = orders.order_id" style="margin-bottom: 0;">
              </div>
            </div>
          </div>

          <div style="margin-bottom: 12px;">
            <button class="btn-quick" id="btnToggleSecondaryJoin" style="margin-bottom: 0; font-size: 11px;" onclick="toggleSecondaryJoin()">➕ Add Secondary Join Table (e.g. Payments, Items)</button>
          </div>

          <!-- Dimensions & Metrics Inputs -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <label style="font-size: 11px; font-weight: bold;">Dimension Columns (Group By)</label>
                <button class="btn-quick" style="margin-bottom: 0; padding: 1px 6px; font-size: 10px;" onclick="clearDimensions()">Clear</button>
              </div>
              <textarea id="martDimensions" style="height: 75px;" placeholder="e.g. orders.customer_id, orders.created_at, users.email">orders.customer_id, orders.created_at, users.email</textarea>
            </div>
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <label style="font-size: 11px; font-weight: bold;">Metrics &amp; Aggregations (name:expression)</label>
                <button class="btn-quick" style="margin-bottom: 0; padding: 1px 6px; font-size: 10px;" onclick="clearMetrics()">Clear</button>
              </div>
              <textarea id="martMetrics" style="height: 75px;" placeholder="e.g. total_orders:count(distinct orders.order_id), total_revenue:sum(orders.transaction_amount)">total_orders:count(distinct orders.order_id), total_revenue:sum(orders.transaction_amount)</textarea>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1.3fr; gap: 14px; margin-bottom: 16px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Target Mart Name (Fact / Dim Model)</label>
              <input type="text" id="martNameInput" value="fct_customer_orders" oninput="handleMartNameInput(this.value)" placeholder="e.g. fct_customer_orders">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Target File Output Path (Customizable)</label>
              <input type="text" id="martOutputPathInput" value="models/marts/fct_customer_orders.sql" placeholder="e.g. models/marts/fct_customer_orders.sql">
            </div>
          </div>

          <div style="display: flex; gap: 10px; align-items: center;">
            <button class="btn" onclick="generateDataMart()">🚀 Generate dbt Mart &amp; schema.yml</button>
            <span style="font-size: 11px; opacity: 0.75;">Scaffolds custom mart SQL &amp; schema.yml into configured path</span>
          </div>

          <div id="martResultBox" style="margin-top: 20px; display: none;">
            <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 12px 16px; border-radius: 6px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="color: var(--success); font-weight: 700; font-size: 13px;">✓ Dimensional Mart &amp; schema.yml Generated</div>
                <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;" id="martSavedBadge">Location: <code>models/marts/fct_customer_orders.sql</code></div>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn-quick" style="margin-bottom: 0;" onclick="openDoc(currentWrittenMartPath || 'models/marts/fct_customer_orders.sql')">📄 Open Mart</button>
                <button class="btn-quick" style="margin-bottom: 0;" onclick="copyMartCode()">📋 Copy SQL</button>
              </div>
            </div>
            <pre id="martCodePreview" class="code-preview" style="max-height: 240px;"></pre>
          </div>
        </div>
      </div>

      <!-- PHASE 2: API CONNECTORS & CURL/OPENAPI STUDIO -->
      <div class="content-card" id="phase2" style="display: ${state.activePhase === 2 ? 'block' : 'none'};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
          <div>
            <h3>🔌 Resilient Client API &amp; Webhook Studio</h3>
            <p class="desc">Scaffold fault-tolerant client SDKs with exponential backoff, rate-limiting, and auth handling. Import directly from cURL or OpenAPI.</p>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn-quick" onclick="loadSampleApi()">⚡ Load Sample Billing API</button>
            <button class="btn-quick" onclick="toggleCurlModal()">🪄 Import from cURL</button>
            <button class="btn-quick" onclick="toggleOpenApiModal()">📋 Import OpenAPI / Swagger</button>
          </div>
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
                  <strong>${c.connectorName}</strong> <span style="opacity: 0.75;">(<code>${c.baseUrl}</code> • Auth: ${c.authType} • ${c.targetLanguage} • ${c.endpoints.length} endpoints)</span>
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

        <!-- Inline cURL Importer Box -->
        <div id="curlImportBox" style="display: none; background: var(--card-alt); border: 1px solid var(--accent); border-radius: 6px; padding: 14px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: var(--accent); font-size: 12px;">🪄 Paste cURL Command:</strong>
            <button class="btn-quick" style="margin-bottom: 0;" onclick="toggleCurlModal()">✕ Close</button>
          </div>
          <textarea id="curlInput" style="height: 80px;" placeholder="curl -X POST https://api.client-vpc.internal/v1/payments -H 'Authorization: Bearer sec_key' -H 'Content-Type: application/json' -d '{&quot;amount&quot;: 100}'"></textarea>
          <button class="btn" style="padding: 4px 12px; font-size: 12px;" onclick="parseAndApplyCurl()">Parse &amp; Apply</button>
        </div>

        <!-- Inline OpenAPI Importer Box -->
        <div id="openApiImportBox" style="display: none; background: var(--card-alt); border: 1px solid var(--accent); border-radius: 6px; padding: 14px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: var(--accent); font-size: 12px;">📋 Paste OpenAPI / Swagger JSON:</strong>
            <button class="btn-quick" style="margin-bottom: 0;" onclick="toggleOpenApiModal()">✕ Close</button>
          </div>
          <textarea id="openApiInput" style="height: 100px;" placeholder="{&quot;openapi&quot;: &quot;3.0.0&quot;, &quot;info&quot;: {&quot;title&quot;: &quot;BillingApi&quot;}, &quot;paths&quot;: {...}}"></textarea>
          <button class="btn" style="padding: 4px 12px; font-size: 12px;" onclick="parseAndApplyOpenApi()">Parse &amp; Apply</button>
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
          <option value="basic">HTTP Basic Authentication</option>
          <option value="none">None / Public</option>
        </select>

        <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
          <button class="btn" onclick="generateApiConnector('typescript')">Scaffold TypeScript SDK</button>
          <button class="btn btn-secondary" onclick="generateApiConnector('python')">Scaffold Python SDK</button>
          <button class="btn btn-secondary" onclick="testApiEndpoint()">🔌 Test API Ping</button>
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

        <!-- ENTERPRISE EXPANSION: Automated Performance & SLA Load Testing -->
        <div style="background: var(--bg); border: 1px solid rgba(78, 201, 176, 0.4); border-radius: 8px; padding: 16px 18px; margin-top: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 16px;">⚡</span>
              <div>
                <strong style="font-size: 13px; color: var(--accent);">Automated Performance &amp; SLA Load Testing</strong>
                <div style="font-size: 11px; opacity: 0.85;">Generate high-concurrency k6 &amp; Locust performance suites with strict SLA latency pass/fail gates.</div>
              </div>
            </div>
            <span style="font-size: 10px; background: rgba(78, 201, 176, 0.15); color: var(--accent); border: 1px solid rgba(78, 201, 176, 0.4); padding: 2px 8px; border-radius: 10px; font-weight: 700;">💎 ENTERPRISE</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Target Endpoint URL</label>
              <input type="text" id="loadTestUrl" value="http://localhost:8080/api/v1/invoices" placeholder="https://api.client.internal/v1/resource">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Load Profile (Virtual Users)</label>
              <select id="loadTestProfile">
                <option value="smoke">Smoke Test (10 VUs · 1 min)</option>
                <option value="standard" selected>Standard Pilot (250 VUs · 3 min)</option>
                <option value="stress">Stress Test (2,500 VUs · 7 min)</option>
                <option value="spike">Spike Test (5,000 VUs burst)</option>
              </select>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">SLA Gate (p95 / p99 Latency)</label>
              <select id="loadTestSla">
                <option value="strict" selected>Strict (p95 &lt; 120ms, p99 &lt; 250ms, 0% err)</option>
                <option value="standard">Standard (p95 &lt; 200ms, p99 &lt; 400ms, &lt;1% err)</option>
                <option value="relaxed">Relaxed (p95 &lt; 500ms, p99 &lt; 1000ms, &lt;3% err)</option>
              </select>
            </div>
          </div>

          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button class="btn" style="background: var(--accent); color: var(--bg); font-weight: 700;" onclick="generateLoadTest('k6')">⚡ Generate k6 Load Test</button>
            <button class="btn btn-secondary" onclick="generateLoadTest('locust')">⚡ Generate Locust Test</button>
            <button class="btn-quick" style="margin-bottom: 0; color: var(--success); border-color: var(--success); font-weight: 700;" onclick="runLoadTestTerminal()">▶️ Run in Terminal</button>
          </div>

          <!-- Generated Load Test Result Box -->
          <div id="loadTestResultBox" style="margin-top: 14px; display: none;">
            <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 10px 14px; border-radius: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="color: var(--success); font-weight: 700; font-size: 12px;">✓ Load Test Suite Generated in tests/load/</div>
                <div style="font-size: 11px; opacity: 0.9;" id="loadTestPathBadge">Location: <code>tests/load/k6_clientbillingapi.js</code></div>
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="openDoc(currentWrittenLoadTestPath || 'tests/load/k6_clientbillingapi.js')">📄 Open</button>
                <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="copyLoadTestCode()">📋 Copy</button>
              </div>
            </div>

            <div class="code-tabs">
              <div class="code-tab active" id="tabK6" onclick="switchLoadTestTab('k6')">⚡ k6 (JavaScript)</div>
              <div class="code-tab" id="tabLocust" onclick="switchLoadTestTab('locust')">🐍 Locust (Python)</div>
              <div class="code-tab" id="tabRunnerSh" onclick="switchLoadTestTab('sh')">📜 Shell Runner</div>
            </div>
            <pre class="code-preview" id="loadTestCodePreview" style="max-height: 220px;"></pre>
          </div>
        </div>

        <!-- ENTERPRISE EXPANSION: Air-Gapped RAG & Vector Pipeline Studio -->
        <div id="ragStudioCard" style="background: var(--bg); border: 1px solid rgba(78, 201, 176, 0.4); border-radius: 8px; padding: 16px 18px; margin-top: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="display: align-items: center; gap: 8px; display: flex;">
              <span style="font-size: 16px;">🧠</span>
              <div>
                <strong style="font-size: 13px; color: var(--accent);">Enterprise Air-Gapped RAG &amp; Vector Pipeline Studio</strong>
                <div style="font-size: 11px; opacity: 0.85;">Scaffold 100% offline, private RAG stacks with chunking, pgvector / Qdrant indexing, and prompt guardrails.</div>
              </div>
            </div>
            <span style="font-size: 10px; background: rgba(78, 201, 176, 0.15); color: var(--accent); border: 1px solid rgba(78, 201, 176, 0.4); padding: 2px 8px; border-radius: 10px; font-weight: 700;">💎 ENTERPRISE</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Vector Database Engine</label>
              <select id="ragVectorDb">
                <option value="pgvector" selected>PostgreSQL + pgvector (HNSW Index)</option>
                <option value="qdrant">Qdrant Vector Engine</option>
              </select>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Local Embedding Model</label>
              <select id="ragEmbedModel">
                <option value="nomic-embed-text:768" selected>Ollama: nomic-embed-text (768d)</option>
                <option value="bge-large-en-v1.5:1024">Ollama: bge-large-en-v1.5 (1024d)</option>
                <option value="all-minilm:384">Ollama: all-minilm-l6-v2 (384d)</option>
                <option value="tei-bge:1024">HuggingFace TEI: bge-large (1024d)</option>
              </select>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Target Language</label>
              <select id="ragLanguage">
                <option value="python" selected>Python (Production FastAPI / LangChain)</option>
                <option value="typescript">TypeScript (Node.js / Express)</option>
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 14px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Chunk Size (Characters)</label>
              <input type="number" id="ragChunkSize" value="512" style="margin-bottom: 0;">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Chunk Overlap</label>
              <input type="number" id="ragChunkOverlap" value="64" style="margin-bottom: 0;">
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Similarity Threshold</label>
              <input type="text" id="ragThreshold" value="0.75" placeholder="0.75" style="margin-bottom: 0;">
            </div>
          </div>

          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <button class="btn" style="background: var(--accent); color: var(--bg); font-weight: 700;" onclick="scaffoldRagPipeline()">🧠 Scaffold Air-Gapped RAG Stack</button>
            <button class="btn-quick" style="margin-bottom: 0; color: var(--success); border-color: var(--success); font-weight: 700;" onclick="runRagTestsTerminal()">▶️ Run RAG Tests in Terminal</button>
          </div>

          <!-- Generated RAG Pipeline Result Box -->
          <div id="ragResultBox" style="margin-top: 14px; display: none;">
            <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 10px 14px; border-radius: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="color: var(--success); font-weight: 700; font-size: 12px;">✓ 100% Air-Gapped RAG Pipeline Generated in src/rag/</div>
                <div style="font-size: 11px; opacity: 0.9;" id="ragPathBadge">Location: <code>src/rag/rag_pipeline.py</code></div>
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="openDoc(currentWrittenRagPipelinePath || 'src/rag/rag_pipeline.py')">📄 Open</button>
                <button class="btn-quick" style="margin-bottom: 0; padding: 2px 8px; font-size: 11px;" onclick="copyRagCode()">📋 Copy</button>
              </div>
            </div>

            <div class="code-tabs">
              <div class="code-tab active" id="tabRagPipeline" onclick="switchRagTab('pipeline')">🚀 RAG Pipeline</div>
              <div class="code-tab" id="tabRagChunker" onclick="switchRagTab('chunker')">✂️ Chunker</div>
              <div class="code-tab" id="tabRagStore" onclick="switchRagTab('store')">🗄️ Vector Store</div>
              <div class="code-tab" id="tabRagEmbed" onclick="switchRagTab('embed')">🔢 Embeddings</div>
              <div class="code-tab" id="tabRagDocker" onclick="switchRagTab('docker')">🐳 Docker Compose</div>
            </div>
            <pre class="code-preview" id="ragCodePreview" style="max-height: 240px;"></pre>
          </div>
        </div>
      </div>

      <!-- PHASE 3: PILOT DEPLOYMENT & MULTI-CLOUD MATRIX -->
      <div class="content-card" id="phase3" style="display: ${state.activePhase === 3 ? 'block' : 'none'};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
          <div>
            <h3>⚡ Pilot Deployment &amp; Pre-Flight Delivery</h3>
            <p class="desc">Audit workspace health, discover active cloud VPCs/subnets via API, customize multi-cloud compute &amp; secrets parameters, and scaffold Terraform, Kubernetes, or Docker IaC.</p>
          </div>
          <button class="btn" style="background: var(--accent); white-space: nowrap;" onclick="discoverCloud()">⚡ Discover &amp; Auto-Fill from Cloud API</button>
        </div>

        <!-- Discovered Cloud Feedback Banner -->
        <div id="cloudDiscoveryBanner" style="display: ${state.deployment?.discoveredCloudResources?.authenticated ? 'block' : 'none'}; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="color: var(--success);">✓ Connected to Cloud:</strong>
              <span id="cloudAccountText">${state.deployment?.discoveredCloudResources?.activeAccount || state.deployment?.discoveredCloudResources?.provider || 'Active Cloud Session'}</span>
              ${state.deployment?.discoveredCloudResources?.activeProject ? ` (<code>${state.deployment.discoveredCloudResources.activeProject}</code>)` : ''}
            </div>
            <span class="tag" style="background: var(--accent); color: #fff; font-size: 10px;">${(state.deployment?.discoveredCloudResources?.provider || state.targetVpc || 'gcp').toUpperCase()}</span>
          </div>
          <div style="margin-top: 6px; font-size: 11px; opacity: 0.85;" id="cloudDiscoverySummary">
            Discovered ${state.deployment?.discoveredCloudResources?.vpcs?.length || 0} VPCs, ${state.deployment?.discoveredCloudResources?.subnets?.length || 0} Subnets, and ${state.deployment?.discoveredCloudResources?.clusters?.length || 0} Clusters.
          </div>
        </div>

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

        <!-- Multi-Cloud Deployment Parameters Matrix -->
        <h4>⚙️ Multi-Cloud Deployment Parameter Matrix</h4>
        <div style="background: var(--card-alt); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 18px;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">CPU Allocation (Presets or Custom)</label>
              <input type="text" id="deployCpu" list="cpuList" value="${state.deployment?.cpu || '1'}" placeholder="e.g. 1, 2, 4, 8.0, 16.0">
              <datalist id="cpuList">
                <option value="0.5">0.5 vCPU</option>
                <option value="1">1.0 vCPU (Standard)</option>
                <option value="2">2.0 vCPU (High Compute)</option>
                <option value="4">4.0 vCPU (Heavy Batch)</option>
                <option value="8">8.0 vCPU (Extreme)</option>
                <option value="16">16.0 vCPU (Max Compute)</option>
              </datalist>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Memory Allocation (Presets or Custom)</label>
              <input type="text" id="deployMemory" list="memList" value="${state.deployment?.memory || '1Gi'}" placeholder="e.g. 1Gi, 2Gi, 4Gi, 16Gi, 32Gi">
              <datalist id="memList">
                <option value="512Mi">512 MiB</option>
                <option value="1Gi">1 GiB (Standard)</option>
                <option value="2Gi">2 GiB</option>
                <option value="4Gi">4 GiB</option>
                <option value="8Gi">8 GiB (High Memory)</option>
                <option value="16Gi">16 GiB</option>
                <option value="32Gi">32 GiB</option>
              </datalist>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Hardware Accelerator / GPU</label>
              <select id="deployGpu">
                <option value="none" ${!state.deployment?.gpu || state.deployment.gpu === 'none' ? 'selected' : ''}>None (Standard CPU)</option>
                <option value="nvidia-tesla-t4" ${state.deployment?.gpu === 'nvidia-tesla-t4' ? 'selected' : ''}>NVIDIA T4 (Inference)</option>
                <option value="nvidia-l4" ${state.deployment?.gpu === 'nvidia-l4' ? 'selected' : ''}>NVIDIA L4 (Modern AI)</option>
                <option value="nvidia-a100-80gb" ${state.deployment?.gpu === 'nvidia-a100-80gb' ? 'selected' : ''}>NVIDIA A100 80GB (Training / LLM)</option>
                <option value="tpu-v5e" ${state.deployment?.gpu === 'tpu-v5e' ? 'selected' : ''}>Google Cloud TPU v5e</option>
              </select>
            </div>
          </div>

          <!-- Network & VPC Customization -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Client VPC / Network ID</label>
              <input type="text" id="deployVpcId" list="vpcDatalist" value="${state.deployment?.vpcId || ''}" placeholder="e.g. client-vpc or vpc-0a1b2c">
              <datalist id="vpcDatalist">
                ${(state.deployment?.discoveredCloudResources?.vpcs || []).map(v => `<option value="${v}">${v}</option>`).join('')}
              </datalist>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Subnet ID / Name</label>
              <input type="text" id="deploySubnetId" list="subnetDatalist" value="${state.deployment?.subnetId || ''}" placeholder="e.g. pilot-subnet or subnet-0a1b2c">
              <datalist id="subnetDatalist">
                ${(state.deployment?.discoveredCloudResources?.subnets || []).map(s => `<option value="${s}">${s}</option>`).join('')}
              </datalist>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Security Groups / Firewall Tags</label>
              <input type="text" id="deploySecurityGroups" value="${state.deployment?.securityGroups || ''}" placeholder="e.g. allow-internal-pilot, sg-0123456789">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;">
            <div>
              <label style="font-size: 11px; font-weight: bold;">Network Ingress Security</label>
              <select id="deployIngress">
                <option value="all" ${state.deployment?.ingress === 'all' ? 'selected' : ''}>Public HTTPS (Direct)</option>
                <option value="internal" ${!state.deployment?.ingress || state.deployment?.ingress === 'internal' ? 'selected' : ''}>Internal VPC Only (Air-Gapped)</option>
                <option value="internal-load-balanced" ${state.deployment?.ingress === 'internal-load-balanced' ? 'selected' : ''}>VPC + Cloud Load Balancer</option>
              </select>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Autoscaling Bounds (Min - Max)</label>
              <div style="display: flex; gap: 8px;">
                <input type="text" id="deployMinInst" value="${state.deployment?.minInstances ?? 0}" placeholder="Min (0)" style="margin-bottom: 0;">
                <input type="text" id="deployMaxInst" value="${state.deployment?.maxInstances ?? 10}" placeholder="Max (10)" style="margin-bottom: 0;">
              </div>
            </div>
            <div>
              <label style="font-size: 11px; font-weight: bold;">Secrets &amp; Env Provider</label>
              <select id="deploySecrets">
                <option value="gcp-secret-manager" ${!state.deployment?.secretsProvider || state.deployment?.secretsProvider === 'gcp-secret-manager' ? 'selected' : ''}>Google Cloud Secret Manager</option>
                <option value="aws-secrets-manager" ${state.deployment?.secretsProvider === 'aws-secrets-manager' ? 'selected' : ''}>AWS Secrets Manager</option>
                <option value="azure-key-vault" ${state.deployment?.secretsProvider === 'azure-key-vault' ? 'selected' : ''}>Azure Key Vault</option>
                <option value="env-file" ${state.deployment?.secretsProvider === 'env-file' ? 'selected' : ''}>.env.production File</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 1-Click Multi-Cloud Scaffolder Buttons -->
        <h4>📦 1-Click Infrastructure Scaffolding (Terraform / K8s / Docker / Firebase)</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
          <div>
            <label style="font-size: 11px; font-weight: bold;">Target Cloud Project ID / Identifier</label>
            <input type="text" id="gcpProjId" value="${state.deployment?.discoveredCloudResources?.activeProject || 'acme-pilot-2026'}">
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold;">Frontend Public Build Directory</label>
            <input type="text" id="pubBuildDir" value="dist">
          </div>
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
          <button class="btn" onclick="scaffoldDeployment()">🚀 Scaffold Firebase &amp; Deploy Scripts</button>
          <button class="btn btn-secondary" onclick="generateTerraformIaC()">📄 Generate Terraform (main.tf)</button>
          <button class="btn btn-secondary" onclick="generateKubernetesIaC()">📄 Generate Kubernetes (k8s.yaml)</button>
          <button class="btn btn-secondary" onclick="generateDockerComposeIaC()">📄 Generate Docker Compose</button>
        </div>
        
        <div id="scaffoldResultBox" style="margin-top: 16px; display: none;">
          <div style="background: var(--success-bg); border: 1px solid var(--success); padding: 12px; border-radius: 6px; font-size: 12px;">
            <strong>✓ Successfully Scaffolded Infrastructure &amp; Deployment:</strong>
            <ul style="margin: 6px 0 0 0; padding-left: 18px;">
              <li><code>firebase.json</code> &amp; <code>.firebaserc</code></li>
              <li><code>scripts/deploy.sh</code> &amp; <code>scripts/deploy.ps1</code></li>
              <li><code>.github/workflows/deploy.yml</code></li>
            </ul>
          </div>
        </div>

        <div id="iacResultBox" style="margin-top: 16px; display: none;">
          <div style="background: var(--card-bg); border: 1px solid var(--accent); border-radius: 6px; padding: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="color: var(--accent); font-size: 12px;" id="iacFileNameLabel">📄 Generated IaC File</strong>
              <button class="btn-quick" style="margin-bottom: 0;" onclick="openActiveIacFile()">Open in Editor</button>
            </div>
            <pre id="iacCodePreview" class="code-preview" style="max-height: 240px;"></pre>
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
    let currentMartSql = '';
    let currentWrittenMartPath = '';
    let currentWrittenIacFile = '';
    let activeSchemaTab = 'dbt';
    let currentArchDoc = ${safeJson(initialArchDoc)};
    let currentDeployDoc = ${safeJson(initialDeployDoc)};
    let currentDataDictDoc = ${safeJson(initialDataDictDoc)};
    let currentEnvDoc = ${safeJson(initialEnvDoc)};
    let currentCompleteDoc = ${safeJson(initialCompleteDoc)};
    let activeDocTab = 'arch';
    let initialState = ${safeJson(state)};
    let currentIntrospectedTables = ${safeJson(this._contextManager.getLastIntrospectedTables ? this._contextManager.getLastIntrospectedTables() : [])};

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

    function deleteDataMart(martName) {
      vscode.postMessage({ command: 'requestDeleteDataMart', martName: martName });
    }

    function deleteApiConnector(connName) {
      vscode.postMessage({ command: 'requestDeleteApiConnector', connectorName: connName });
    }

    function updateClientName(val) {
      vscode.postMessage({ command: 'updateClientName', clientName: val });
      showToast('Client Name updated');
    }

    function setPhase(p) {
      for (let i = 1; i <= 4; i++) {
        const el = document.getElementById('phase' + i);
        if (el) el.style.display = i === p ? 'block' : 'none';
      }
      const navBtns = document.querySelectorAll('.nav-btn');
      navBtns.forEach((btn, idx) => {
        if (btn) {
          if (idx + 1 === p) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      const stepCards = document.querySelectorAll('.step-card');
      stepCards.forEach((card, idx) => {
        if (card) {
          if (idx + 1 === p) card.classList.add('active');
          else card.classList.remove('active');
        }
      });
      vscode.postMessage({ command: 'setActivePhase', phase: p });
    }

    function switchPhase1Mode(mode) {
      const subStaging = document.getElementById('subpanelStaging');
      const subMart = document.getElementById('subpanelMart');
      const tabStaging = document.getElementById('tabPhase1Staging');
      const tabMart = document.getElementById('tabPhase1Mart');

      if (mode === 'mart') {
        if (subStaging) subStaging.style.display = 'none';
        if (subMart) subMart.style.display = 'block';
        if (tabStaging) tabStaging.className = 'code-tab';
        if (tabMart) tabMart.className = 'code-tab active';
        refreshMartModelOptions();
      } else {
        if (subStaging) subStaging.style.display = 'block';
        if (subMart) subMart.style.display = 'none';
        if (tabStaging) tabStaging.className = 'code-tab active';
        if (tabMart) tabMart.className = 'code-tab';
      }
    }

    function getAvailableMartModels() {
      const models = [];
      const seen = new Set();

      // 1. Mapped staging models from state
      if (initialState && initialState.schemaMappings) {
        initialState.schemaMappings.forEach(m => {
          if (!seen.has(m.targetModelName)) {
            seen.add(m.targetModelName);
            models.push({
              id: m.targetModelName,
              name: '[Staging] ' + m.targetModelName,
              alias: m.targetModelName.replace(/^stg_/, ''),
              columns: m.columns.map(c => ({ name: c.targetColumn, type: c.targetType }))
            });
          }
        });
      }

      // 2. Introspected tables from live database
      if (currentIntrospectedTables && currentIntrospectedTables.length > 0) {
        currentIntrospectedTables.forEach(t => {
          const modelId = t.tableName;
          if (!seen.has(modelId)) {
            seen.add(modelId);
            const alias = t.tableName.replace(/^client_|_raw$/g, '');
            models.push({
              id: modelId,
              name: (t.schema ? '[' + t.schema + '] ' : '[Live DB] ') + t.tableName,
              alias: alias,
              columns: t.columns || []
            });
          }
        });
      }

      // 3. Fallback defaults if workspace has no tables yet
      if (models.length === 0) {
        models.push({
          id: 'stg_orders',
          name: 'stg_orders (Sample Orders)',
          alias: 'orders',
          columns: [
            { name: 'order_id', type: 'string' },
            { name: 'customer_id', type: 'string' },
            { name: 'transaction_amount', type: 'numeric' },
            { name: 'order_status', type: 'string' },
            { name: 'created_at', type: 'timestamp' }
          ]
        });
        models.push({
          id: 'stg_users',
          name: 'stg_users (Sample Users)',
          alias: 'users',
          columns: [
            { name: 'user_id', type: 'string' },
            { name: 'email', type: 'string' },
            { name: 'country_code', type: 'string' },
            { name: 'registered_at', type: 'timestamp' }
          ]
        });
        models.push({
          id: 'stg_payments',
          name: 'stg_payments (Sample Payments)',
          alias: 'payments',
          columns: [
            { name: 'payment_id', type: 'string' },
            { name: 'order_id', type: 'string' },
            { name: 'amount', type: 'numeric' },
            { name: 'currency', type: 'string' }
          ]
        });
      }

      return models;
    }

    function refreshMartModelOptions() {
      const models = getAvailableMartModels();
      const baseSel = document.getElementById('martBaseModel');
      const joinSel = document.getElementById('martJoinModel');
      const join2Sel = document.getElementById('martJoin2Model');

      if (!baseSel || !joinSel) return;

      const currentBase = baseSel.value;
      const currentJoin = joinSel.value;
      const currentJoin2 = join2Sel ? join2Sel.value : '';

      const baseOpts = models.map(m => '<option value="' + m.id + '">' + m.name + ' (' + m.columns.length + ' cols)</option>').join('');
      baseSel.innerHTML = baseOpts;
      joinSel.innerHTML = baseOpts;
      if (join2Sel) {
        join2Sel.innerHTML = '<option value="">-- Choose 3rd Model --</option>' + baseOpts;
      }

      if (currentBase && models.some(m => m.id === currentBase)) {
        baseSel.value = currentBase;
      } else if (models.length > 0) {
        baseSel.value = models[0].id;
      }

      if (currentJoin && models.some(m => m.id === currentJoin)) {
        joinSel.value = currentJoin;
      } else if (models.length > 1) {
        joinSel.value = models[1].id;
      } else if (models.length > 0) {
        joinSel.value = models[0].id;
      }

      if (currentJoin2 && models.some(m => m.id === currentJoin2) && join2Sel) {
        join2Sel.value = currentJoin2;
      }

      handleMartModelChange();
    }

    function handleMartModelChange() {
      const models = getAvailableMartModels();
      const baseId = document.getElementById('martBaseModel').value;
      const joinId = document.getElementById('martJoinModel').value;

      const baseModel = models.find(m => m.id === baseId);
      const joinModel = models.find(m => m.id === joinId);

      const baseTray = document.getElementById('martBaseColsTray');
      const joinTray = document.getElementById('martJoinColsTray');
      const suggestionEl = document.getElementById('martJoinSuggestionText');

      if (baseModel && baseTray) {
        baseTray.innerHTML = baseModel.columns.map(c => {
          const isNum = /int|float|numeric|double|decimal|number|amount|price|cost|qty/i.test(c.type || '') || /amount|amt|price|cost|qty|total|balance/i.test(c.name);
          return '<span class="mart-chip" title="Click to add ' + baseModel.alias + '.' + c.name + '">' +
            '<span>' + c.name + '</span>' +
            '<button class="btn-quick" style="margin:0; padding:0 3px; font-size:9px;" onclick="addMartDimension(\\\'' + baseModel.alias + '.' + c.name + '\\\')">+Dim</button>' +
            (isNum ? '<button class="btn-quick" style="margin:0; padding:0 3px; font-size:9px; color:var(--success);" onclick="addMartMetric(\\\'sum\\\', \\\'' + baseModel.alias + '.' + c.name + '\\\')">+Sum</button>' : '') +
            '<button class="btn-quick" style="margin:0; padding:0 3px; font-size:9px; color:var(--accent);" onclick="addMartMetric(\\\'count\\\', \\\'' + baseModel.alias + '.' + c.name + '\\\')">+Cnt</button>' +
          '</span>';
        }).join('');
      }

      if (joinModel && joinTray) {
        joinTray.innerHTML = joinModel.columns.map(c => {
          const isNum = /int|float|numeric|double|decimal|number|amount|price|cost|qty/i.test(c.type || '') || /amount|amt|price|cost|qty|total|balance/i.test(c.name);
          return '<span class="mart-chip" title="Click to add ' + joinModel.alias + '.' + c.name + '">' +
            '<span>' + c.name + '</span>' +
            '<button class="btn-quick" style="margin:0; padding:0 3px; font-size:9px;" onclick="addMartDimension(\\\'' + joinModel.alias + '.' + c.name + '\\\')">+Dim</button>' +
            (isNum ? '<button class="btn-quick" style="margin:0; padding:0 3px; font-size:9px; color:var(--success);" onclick="addMartMetric(\\\'sum\\\', \\\'' + joinModel.alias + '.' + c.name + '\\\')">+Sum</button>' : '') +
            '<button class="btn-quick" style="margin:0; padding:0 3px; font-size:9px; color:var(--accent);" onclick="addMartMetric(\\\'count\\\', \\\'' + joinModel.alias + '.' + c.name + '\\\')">+Cnt</button>' +
          '</span>';
        }).join('');
      }

      // Auto-suggest join keys
      if (baseModel && joinModel && baseModel.id !== joinModel.id) {
        const baseColNames = baseModel.columns.map(c => c.name);
        const joinColNames = joinModel.columns.map(c => c.name);
        
        let suggestedKey = '';
        // Exact column name match (e.g. user_id in both)
        for (const b of baseColNames) {
          if (b.toLowerCase().endsWith('_id') || b.toLowerCase().endsWith('_key')) {
            for (const j of joinColNames) {
              if (b.toLowerCase() === j.toLowerCase()) {
                suggestedKey = baseModel.alias + '.' + b + ' = ' + joinModel.alias + '.' + j;
                break;
              }
            }
          }
          if (suggestedKey) break;
        }

        // Prefix match (orders.customer_id = users.id)
        if (!suggestedKey) {
          const singularJoin = joinModel.alias.replace(/s$/, '');
          for (const b of baseColNames) {
            if (b.toLowerCase() === singularJoin + '_id' || b.toLowerCase() === joinModel.alias + '_id') {
              const jMatch = joinColNames.find(j => j.toLowerCase() === 'id' || j.toLowerCase() === singularJoin + '_id');
              if (jMatch) {
                suggestedKey = baseModel.alias + '.' + b + ' = ' + joinModel.alias + '.' + jMatch;
                break;
              }
            }
          }
        }

        if (suggestedKey) {
          const onInput = document.getElementById('martOnCondition');
          if (onInput) onInput.value = suggestedKey;
          if (suggestionEl) suggestionEl.innerText = '✓ Auto-matched: ' + suggestedKey;
        } else {
          if (suggestionEl) suggestionEl.innerText = '';
        }
      }
    }

    function addMartDimension(dim) {
      const el = document.getElementById('martDimensions');
      if (!el) return;
      const current = el.value.trim();
      const dims = current ? current.split(',').map(d => d.trim()).filter(Boolean) : [];
      if (!dims.includes(dim)) {
        dims.push(dim);
        el.value = dims.join(', ');
        showToast('✓ Added dimension: ' + dim);
      }
    }

    function addMartMetric(agg, col) {
      const el = document.getElementById('martMetrics');
      if (!el) return;
      const colClean = col.split('.').pop() || col;
      let metricName = agg + '_' + colClean;
      let expr = '';
      if (agg === 'sum') {
        metricName = 'total_' + colClean;
        expr = 'sum(' + col + ')';
      } else if (agg === 'count') {
        metricName = colClean + '_count';
        expr = 'count(distinct ' + col + ')';
      } else if (agg === 'avg') {
        metricName = 'avg_' + colClean;
        expr = 'avg(' + col + ')';
      }

      const current = el.value.trim();
      const metrics = current ? current.split(',').map(m => m.trim()).filter(Boolean) : [];
      metrics.push(metricName + ':' + expr);
      el.value = metrics.join(', ');
      showToast('✓ Added metric: ' + metricName);
    }

    function clearDimensions() {
      const el = document.getElementById('martDimensions');
      if (el) el.value = '';
    }

    function clearMetrics() {
      const el = document.getElementById('martMetrics');
      if (el) el.value = '';
    }

    function toggleSecondaryJoin() {
      const row = document.getElementById('secondaryJoinRow');
      const btn = document.getElementById('btnToggleSecondaryJoin');
      if (!row) return;
      const isHidden = row.style.display === 'none' || row.style.display === '';
      row.style.display = isHidden ? 'block' : 'none';
      if (btn) btn.style.display = isHidden ? 'none' : 'inline-block';
    }

    function handleSecondaryJoinChange() {
      const models = getAvailableMartModels();
      const baseId = document.getElementById('martBaseModel').value;
      const join2Id = document.getElementById('martJoin2Model').value;
      const baseModel = models.find(m => m.id === baseId);
      const join2Model = models.find(m => m.id === join2Id);
      if (!baseModel || !join2Model) return;

      const baseColNames = baseModel.columns.map(c => c.name);
      const join2ColNames = join2Model.columns.map(c => c.name);
      const singularJoin2 = join2Model.alias.replace(/s$/, '');

      let keyMatch = '';
      for (const b of baseColNames) {
        if (b.toLowerCase() === singularJoin2 + '_id' || b.toLowerCase() === join2Model.alias + '_id') {
          const jMatch = join2ColNames.find(j => j.toLowerCase() === 'id' || j.toLowerCase() === singularJoin2 + '_id');
          if (jMatch) {
            keyMatch = join2Model.alias + '.' + jMatch + ' = ' + baseModel.alias + '.' + b;
            break;
          }
        }
      }
      if (!keyMatch) {
        keyMatch = join2Model.alias + '.id = ' + baseModel.alias + '.id';
      }
      const onEl = document.getElementById('martJoin2On');
      if (onEl) onEl.value = keyMatch;
    }

    function handleModelNameInput(val) {
      const pathInput = document.getElementById('modelOutputPathInput');
      if (pathInput) {
        const clean = (val || 'stg_model').trim();
        pathInput.value = 'models/staging/' + clean + '.sql';
      }
    }

    function handleMartNameInput(val) {
      const pathInput = document.getElementById('martOutputPathInput');
      if (pathInput) {
        const clean = (val || 'fct_mart').trim();
        pathInput.value = 'models/marts/' + clean + '.sql';
      }
    }

    let currentAiMartRecipes = [];

    function triggerAiStagingClean(enablePii) {
      const srcEl = document.getElementById('srcCols');
      const nameEl = document.getElementById('srcNameInput');
      const src = srcEl ? srcEl.value.trim() : '';
      const name = nameEl ? nameEl.value.trim() : 'data';

      if (!src) {
        showToast('⚠️ Please load or paste source columns first!');
        return;
      }

      showToast('✨ AI is analyzing schema and normalizing data types...');
      vscode.postMessage({
        command: 'aiAnalyzeStagingSchema',
        rawCols: src,
        tableName: name,
        enablePiiMasking: !!enablePii
      });
    }

    function toggleAiPromptBox(kind) {
      const el = document.getElementById(kind === 'staging' ? 'aiStagingPromptBox' : 'aiMartPromptBox');
      if (el) {
        el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
        if (el.style.display === 'block') {
          const input = el.querySelector('input');
          if (input) input.focus();
        }
      }
    }

    function triggerAiStagingCleanWithPrompt() {
      const srcEl = document.getElementById('srcCols');
      const nameEl = document.getElementById('srcNameInput');
      const promptEl = document.getElementById('aiStagingCustomPrompt');
      const src = srcEl ? srcEl.value.trim() : '';
      const name = nameEl ? nameEl.value.trim() : 'data';
      const prompt = promptEl ? promptEl.value.trim() : '';

      if (!src) {
        showToast('⚠️ Please load source columns first!');
        return;
      }

      showToast('✨ AI is applying custom schema transformation prompt...');
      vscode.postMessage({
        command: 'aiAnalyzeStagingSchema',
        rawCols: src,
        tableName: name,
        customInstruction: prompt
      });
    }

    function triggerAiDiscoverMartRecipes() {
      const baseEl = document.getElementById('martBaseModel');
      let base = baseEl ? baseEl.value : '';

      if (!base) {
        const available = getAvailableMartModels();
        if (available.length > 0) {
          base = available[0].id;
          if (baseEl) baseEl.value = base;
        }
      }

      if (!base) {
        showToast('⚠️ Please connect to database and load tables first.');
        return;
      }

      showToast('✨ AI inspecting table relationships and discovering recipes for ' + base + '...');
      vscode.postMessage({
        command: 'aiDiscoverMartRecipes',
        baseModel: base
      });
    }

    function triggerAiGenerateMartFromPrompt() {
      const promptEl = document.getElementById('aiMartCustomPrompt');
      const prompt = promptEl ? promptEl.value.trim() : '';
      if (!prompt) {
        showToast('⚠️ Please enter a prompt for the AI Mart Generator!');
        return;
      }

      showToast('✨ AI designing dimensional model from prompt...');
      vscode.postMessage({
        command: 'aiGenerateMartFromPrompt',
        prompt: prompt
      });
    }

    function renderAiMartRecipes(recipes) {
      const container = document.getElementById('aiMartRecipesContainer');
      if (!container) return;
      if (!recipes || recipes.length === 0) {
        container.innerHTML = '<div style="font-size: 11px; opacity: 0.75; font-style: italic;">No AI recipes discovered. Select a Base Model and click Discover.</div>';
        return;
      }
      container.innerHTML = '<div style="font-size: 11px; font-weight: 700; color: var(--success); margin-bottom: 4px;">✨ Suggested AI Data Marts (1-Click Apply):</div>' +
        recipes.map(function(r) {
          return '<div style="display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border);">' +
            '<div>' +
              '<div style="font-weight: 700; font-size: 12px; color: var(--accent);">' + r.title + ' <span style="font-size: 10px; background: rgba(99, 102, 241, 0.15); color: var(--accent); padding: 1px 6px; border-radius: 4px;">' + r.badge + '</span></div>' +
              '<div style="font-size: 11px; opacity: 0.85; margin-top: 2px;">' + r.description + '</div>' +
              '<div style="font-size: 10px; opacity: 0.7; font-family: monospace; margin-top: 2px;">Join: ' + r.joinCondition + ' | Dims: ' + r.dimensions.join(', ') + '</div>' +
            '</div>' +
            '<div>' +
              '<button class="btn-primary" style="margin-bottom: 0; padding: 3px 10px; font-size: 11px;" onclick="applyAiMartRecipe(\\\'' + r.id + '\\\')">⚡ Apply Recipe</button>' +
            '</div>' +
          '</div>';
        }).join('');
    }

    function applyAiMartRecipe(recipeId) {
      const r = currentAiMartRecipes.find(function(item) { return item.id === recipeId; });
      if (r) applyAiMartRecipeDirect(r);
    }

    function applyAiMartRecipeDirect(r) {
      const baseEl = document.getElementById('martBaseModel');
      const joinEl = document.getElementById('martJoinModel');
      const joinTypeEl = document.getElementById('martJoinType');
      const onEl = document.getElementById('martOnCondition');
      const dimsEl = document.getElementById('martDimensions');
      const metricsEl = document.getElementById('martMetrics');
      const nameEl = document.getElementById('martNameInput');
      const pathEl = document.getElementById('martOutputPathInput');

      if (baseEl && r.baseModel) baseEl.value = r.baseModel;
      if (joinEl && r.joinModel) joinEl.value = r.joinModel;
      if (joinTypeEl && r.joinType) joinTypeEl.value = r.joinType;
      if (onEl && r.joinCondition) onEl.value = r.joinCondition;
      if (dimsEl && r.dimensions) dimsEl.value = r.dimensions.join(', ');
      if (metricsEl && r.metrics) metricsEl.value = r.metrics.map(function(m) { return m.name + ':' + m.expression; }).join(', ');
      if (nameEl && r.martName) {
        nameEl.value = r.martName;
        handleMartNameInput(r.martName);
      }
      if (pathEl && r.outputPath) pathEl.value = r.outputPath;

      showToast('✓ Applied AI Mart Recipe: ' + r.title);
    }

    function applyMartPreset(kind) {
      if (kind === 'customer_revenue') {
        document.getElementById('martDimensions').value = 'orders.customer_id, users.email, orders.order_status';
        document.getElementById('martMetrics').value = 'total_orders:count(distinct orders.order_id), total_revenue:sum(orders.transaction_amount), avg_order_value:avg(orders.transaction_amount)';
        document.getElementById('martNameInput').value = 'fct_customer_orders';
        handleMartNameInput('fct_customer_orders');
        showToast('✓ Loaded Customer Revenue Mart Template (Fact Table for Customer Revenue KPIs)');
      } else if (kind === 'daily_orders') {
        document.getElementById('martDimensions').value = 'orders.created_at, users.country_code';
        document.getElementById('martMetrics').value = 'daily_orders:count(distinct orders.order_id), daily_revenue:sum(orders.transaction_amount)';
        document.getElementById('martNameInput').value = 'fct_daily_orders';
        handleMartNameInput('fct_daily_orders');
        showToast('✓ Loaded Daily Orders Fact Template (Periodic Snapshot of Daily Performance)');
      } else if (kind === 'user_retention') {
        document.getElementById('martDimensions').value = 'users.user_id, users.email, users.registered_at';
        document.getElementById('martMetrics').value = 'lifetime_spend:sum(orders.transaction_amount), last_order_date:max(orders.created_at)';
        document.getElementById('martNameInput').value = 'dim_user_retention';
        handleMartNameInput('dim_user_retention');
        showToast('✓ Loaded User Retention Dim Template (Dimensional Model for User Cohorts)');
      }
    }

    function testApiEndpoint() {
      const url = document.getElementById('connBaseUrl').value.trim();
      if (!url) {
        showToast('⚠️ Please enter a Base URL first!');
        return;
      }
      showToast('⏳ Sending ping request to ' + url + '...');
      vscode.postMessage({ command: 'testApiEndpoint', url: url });
    }

    window.setPhase = setPhase;
    window.switchPhase1Mode = switchPhase1Mode;
    window.handleModelNameInput = handleModelNameInput;
    window.handleMartNameInput = handleMartNameInput;
    window.triggerAiStagingClean = triggerAiStagingClean;
    window.toggleAiPromptBox = toggleAiPromptBox;
    window.triggerAiStagingCleanWithPrompt = triggerAiStagingCleanWithPrompt;
    window.triggerAiDiscoverMartRecipes = triggerAiDiscoverMartRecipes;
    window.triggerAiGenerateMartFromPrompt = triggerAiGenerateMartFromPrompt;
    window.applyAiMartRecipe = applyAiMartRecipe;

    function generateDataMart() {
      const base = document.getElementById('martBaseModel').value;
      const join = document.getElementById('martJoinModel').value;
      const joinType = document.getElementById('martJoinType').value;
      const onCond = document.getElementById('martOnCondition').value.trim();
      const dimsStr = document.getElementById('martDimensions').value.trim();
      const metricsStr = document.getElementById('martMetrics').value.trim();
      const martName = document.getElementById('martNameInput').value.trim() || 'fct_customer_orders';
      const outputPath = document.getElementById('martOutputPathInput') ? document.getElementById('martOutputPathInput').value.trim() : ('models/marts/' + martName + '.sql');

      if (!base || !join || !onCond) {
        showToast('⚠️ Please specify Base Model, Join Model, and Join Condition!');
        return;
      }

      const joins = [
        { joinType: joinType, joinModel: join, onCondition: onCond }
      ];

      const join2Row = document.getElementById('secondaryJoinRow');
      if (join2Row && join2Row.style.display !== 'none') {
        const join2Model = document.getElementById('martJoin2Model').value;
        const join2Type = document.getElementById('martJoin2Type').value;
        const join2On = document.getElementById('martJoin2On').value.trim();
        if (join2Model && join2On) {
          joins.push({ joinType: join2Type, joinModel: join2Model, onCondition: join2On });
        }
      }

      const dimensions = dimsStr ? dimsStr.split(',').map(d => d.trim()).filter(Boolean) : [];
      const metrics = [];
      if (metricsStr) {
        metricsStr.split(',').forEach(m => {
          const parts = m.split(':');
          if (parts.length >= 2) {
            metrics.push({ name: parts[0].trim(), expression: parts.slice(1).join(':').trim() });
          } else if (parts[0]) {
            metrics.push({ name: parts[0].trim(), expression: 'count(*)' });
          }
        });
      }

      vscode.postMessage({
        command: 'generateDataMart',
        martName: martName,
        baseModel: base,
        joins: joins,
        dimensions: dimensions,
        metrics: metrics,
        dialect: 'dbt',
        outputPath: outputPath,
        writeToFile: true
      });
      showToast('🚀 Compiling dimensional mart & schema.yml to ' + outputPath + '...');
    }

    function copyMartCode() {
      if (currentMartSql) {
        navigator.clipboard.writeText(currentMartSql);
        showToast('✓ Mart SQL copied to clipboard!');
      }
    }

    function toggleCurlModal() {
      const box = document.getElementById('curlImportBox');
      if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }

    function parseAndApplyCurl() {
      const curl = document.getElementById('curlInput').value.trim();
      if (!curl) {
        showToast('⚠️ Please paste a cURL command!');
        return;
      }
      vscode.postMessage({ command: 'parseCurl', curlString: curl });
    }

    function toggleOpenApiModal() {
      const box = document.getElementById('openApiImportBox');
      if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }

    function parseAndApplyOpenApi() {
      const spec = document.getElementById('openApiInput').value.trim();
      if (!spec) {
        showToast('⚠️ Please paste an OpenAPI JSON specification!');
        return;
      }
      vscode.postMessage({ command: 'parseOpenApi', openApiString: spec });
    }

    function switchGitBranch(branch) {
      if (!branch) return;
      showToast('🔄 Switching to branch ' + branch + '...');
      vscode.postMessage({ command: 'switchGitBranch', branch: branch });
    }

    function promptNewBranch() {
      const name = prompt('Enter new branch name (e.g. feat/client-ingest):');
      if (name && name.trim()) {
        showToast('🌿 Creating branch ' + name.trim() + '...');
        vscode.postMessage({ command: 'createGitBranch', branchName: name.trim() });
      }
    }

    function toggleEnterpriseLicenseDrawer() {
      const drawer = document.getElementById('enterpriseLicenseDrawer');
      const gitDrawer = document.getElementById('gitSetupDrawer');
      const commitDrawer = document.getElementById('gitCommitDrawer');
      if (gitDrawer) gitDrawer.style.display = 'none';
      if (commitDrawer) commitDrawer.style.display = 'none';
      if (drawer) {
        const isHidden = drawer.style.display === 'none' || drawer.style.display === '' || window.getComputedStyle(drawer).display === 'none';
        drawer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          vscode.postMessage({ command: 'getEnterpriseLicenseState' });
        }
      }
    }

    function activateEnterpriseLicense() {
      const keyInput = document.getElementById('enterpriseLicenseInput');
      const key = (keyInput ? keyInput.value : '').trim();
      if (!key) {
        showToast('⚠️ Please enter an Enterprise License Key!');
        return;
      }
      showToast('🔏 Validating cryptographic license token...');
      vscode.postMessage({ command: 'activateEnterpriseLicense', key: key });
    }

    function deactivateEnterpriseLicense() {
      vscode.postMessage({ command: 'deactivateEnterpriseLicense' });
    }

    function generateTrialLicense() {
      showToast('⚡ Generating 30-Day Enterprise Platinum Key...');
      vscode.postMessage({ command: 'generateDemoEnterpriseKey' });
    }

    function toggleGitSetupDrawer() {
      const drawer = document.getElementById('gitSetupDrawer');
      const commitDrawer = document.getElementById('gitCommitDrawer');
      if (commitDrawer) commitDrawer.style.display = 'none';
      if (drawer) {
        const isHidden = drawer.style.display === 'none' || drawer.style.display === '' || window.getComputedStyle(drawer).display === 'none';
        drawer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          vscode.postMessage({ command: 'getGitAndCloudStatus' });
        }
      }
    }

    function toggleCommitDrawer() {
      const drawer = document.getElementById('gitCommitDrawer');
      const setupDrawer = document.getElementById('gitSetupDrawer');
      if (setupDrawer) setupDrawer.style.display = 'none';
      if (drawer) {
        const isHidden = drawer.style.display === 'none' || drawer.style.display === '' || window.getComputedStyle(drawer).display === 'none';
        drawer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          vscode.postMessage({ command: 'getGitAndCloudStatus' });
          vscode.postMessage({ command: 'requestCommitDraft' });
        }
      }
    }

    function saveHttpsGitRemote() {
      const repoUrl = (document.getElementById('httpsRepoUrl').value || '').trim();
      const username = (document.getElementById('httpsUsername').value || '').trim();
      const token = (document.getElementById('httpsToken').value || '').trim();
      if (!repoUrl) {
        showToast('⚠️ Please enter a remote repository HTTPS URL!');
        return;
      }
      showToast('🔗 Configuring HTTPS remote & testing authentication...');
      vscode.postMessage({ command: 'configureHttpsAuth', repoUrl: repoUrl, username: username, token: token });
    }

    function saveSshGitRemote() {
      const repoUrl = (document.getElementById('sshRepoUrl').value || '').trim();
      if (!repoUrl) {
        showToast('⚠️ Please enter a remote repository SSH URL!');
        return;
      }
      showToast('🔗 Configuring SSH remote origin...');
      vscode.postMessage({ command: 'setGitRemote', remoteUrl: repoUrl });
    }

    function copySshKey() {
      vscode.postMessage({ command: 'copySshPublicKey' });
      showToast('📋 Copying Public SSH Key to clipboard...');
    }

    function generateSshKey() {
      vscode.postMessage({ command: 'copySshPublicKey' });
    }

    function initGitRepo() {
      showToast('🚀 Initializing Git repository...');
      vscode.postMessage({ command: 'initializeGitRepo' });
    }

    function draftWithAi() {
      showToast('🤖 Drafting Conventional Commit with AI...');
      vscode.postMessage({ command: 'requestCommitDraft' });
    }

    function draftHeuristic() {
      showToast('⚡ Generating instant auto-draft...');
      vscode.postMessage({ command: 'requestCommitDraft' });
    }

    function executeCommitAndPush() {
      const title = (document.getElementById('commitTitleInput').value || '').trim();
      const desc = (document.getElementById('commitDescInput').value || '').trim();
      const pushRemote = document.getElementById('chkCommitPushRemote') ? document.getElementById('chkCommitPushRemote').checked : true;
      const runInTerm = document.getElementById('chkCommitInTerminal') ? document.getElementById('chkCommitInTerminal').checked : true;

      if (!title) {
        showToast('⚠️ Please enter a commit title!');
        return;
      }

      showToast('📦 Committing ' + (pushRemote ? '& pushing' : '') + ' deliverables...');
      vscode.postMessage({
        command: 'gitCommitAndPush',
        title: title,
        description: desc,
        pushToRemote: pushRemote,
        runInTerminal: runInTerm
      });
      toggleCommitDrawer();
    }

    function openExternalUrl(url) {
      if (url) vscode.postMessage({ command: 'openExternalUrl', url: url });
    }

    function diagnoseGit(target) {
      vscode.postMessage({ command: 'diagnoseGitConnection', target: target });
      showToast('🔍 Testing ' + target.toUpperCase() + ' SSH connection...');
    }

    function openGitTerminal() {
      vscode.postMessage({ command: 'openGitTerminal' });
    }

    function gitFetch() {
      const runInTerm = document.getElementById('chkRunInTerminal') ? document.getElementById('chkRunInTerminal').checked : true;
      showToast('🔄 Fetching from remote...');
      vscode.postMessage({ command: 'gitFetch', runInTerminal: runInTerm });
    }

    function createPullRequest() {
      vscode.postMessage({ command: 'createPullRequest' });
    }

    function testCloudConnection() {
      showToast('☁️ Testing Cloud VPC Connection...');
      vscode.postMessage({ command: 'testCloudConnection' });
    }

    function toggleCloudHubDrawer() {
      const drawer = document.getElementById('cloudHubDrawer');
      if (drawer) {
        const isHidden = drawer.style.display === 'none' || drawer.style.display === '' || window.getComputedStyle(drawer).display === 'none';
        drawer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          testCloudConnection();
        }
      }
    }

    function connectCloud(provider, action) {
      vscode.postMessage({ command: 'connectCloudAccount', provider: provider, action: action || 'login' });
      showToast('🚀 Initiating ' + provider.toUpperCase() + ' ' + (action || 'login') + ' in terminal...');
    }

    window.switchGitBranch = switchGitBranch;
    window.promptNewBranch = promptNewBranch;
    window.toggleGitSetupDrawer = toggleGitSetupDrawer;
    window.toggleCommitDrawer = toggleCommitDrawer;
    window.saveHttpsGitRemote = saveHttpsGitRemote;
    window.saveSshGitRemote = saveSshGitRemote;
    window.copySshKey = copySshKey;
    window.generateSshKey = generateSshKey;
    window.initGitRepo = initGitRepo;
    window.draftWithAi = draftWithAi;
    window.draftHeuristic = draftHeuristic;
    window.executeCommitAndPush = executeCommitAndPush;
    window.openExternalUrl = openExternalUrl;
    window.toggleCloudHubDrawer = toggleCloudHubDrawer;
    window.connectCloud = connectCloud;
    window.diagnoseGit = diagnoseGit;
    window.openGitTerminal = openGitTerminal;
    window.gitFetch = gitFetch;
    window.createPullRequest = createPullRequest;
    window.testCloudConnection = testCloudConnection;
    window.testCloudConnection = testCloudConnection;
    window.toggleDbConnectModal = toggleDbConnectModal;
    window.toggleRoadmap = toggleRoadmap;

    function openActiveIacFile() {
      if (currentWrittenIacFile) {
        openDoc(currentWrittenIacFile);
      }
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

    function toggleDbConnectModal() {
      const box = document.getElementById('dbConnectBox');
      if (box) {
        const isHidden = box.style.display === 'none' || box.style.display === '' || window.getComputedStyle(box).display === 'none';
        box.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }

    function toggleUriVisibility(e) {
      if (e) e.preventDefault();
      const input = document.getElementById('dbConnUri');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    }

    function handleDialectChange() {
      const dialect = document.getElementById('dbDialect').value;
      const uriInput = document.getElementById('dbConnUri');
      if (dialect === 'postgres') {
        uriInput.placeholder = 'postgresql://username:password@localhost:5432/pilot_db';
      } else if (dialect === 'snowflake') {
        uriInput.placeholder = 'https://xy12345.snowflakecomputing.com (or SNOWSQL account)';
      } else if (dialect === 'bigquery') {
        uriInput.placeholder = 'BigQuery GCP Project / ADC Active Credentials';
      } else if (dialect === 'mysql') {
        uriInput.placeholder = 'mysql://user:pass@localhost:3306/pilot_db';
      } else if (dialect === 'sqlite') {
        uriInput.placeholder = '/path/to/local/app.db';
      }
    }

    function introspectDatabase() {
      const dialect = document.getElementById('dbDialect').value;
      const uri = document.getElementById('dbConnUri').value.trim();
      const db = document.getElementById('dbDatabaseName').value.trim();
      const schema = document.getElementById('dbSchemaName').value.trim();
      const savePolicy = document.getElementById('dbSavePolicy').value;

      vscode.postMessage({
        command: 'introspectDatabase',
        saveSecret: savePolicy === 'vault',
        options: {
          dialect: dialect,
          connectionUri: uri || undefined,
          database: db || undefined,
          schema: schema || undefined,
        }
      });
      showToast('⚡ Connecting to database and introspecting schemas...');
    }

    function testDbConnection() {
      const dialect = document.getElementById('dbDialect').value;
      const uri = document.getElementById('dbConnUri').value.trim();
      const db = document.getElementById('dbDatabaseName').value.trim();
      const schema = document.getElementById('dbSchemaName').value.trim();

      vscode.postMessage({
        command: 'testDbConnection',
        dialect: dialect,
        connectionUri: uri || undefined,
        database: db || undefined,
        schema: schema || undefined,
      });
      showToast('⏳ Testing database handshake and network reachability...');
    }

    function detectWorkspaceDb() {
      vscode.postMessage({ command: 'detectWorkspaceDbConfig' });
      showToast('🔍 Scanning workspace for .env and dbt database credentials...');
    }

    function wipeDbSecrets() {
      vscode.postMessage({ command: 'wipeDbSecrets' });
    }

    function filterDiscoveredTables() {
      const filterInput = document.getElementById('dbTableFilterInput');
      const filter = (filterInput ? filterInput.value : '').toLowerCase().trim();
      const select = document.getElementById('dbTableSelect');
      if (!select || !currentIntrospectedTables) return;

      const filtered = currentIntrospectedTables.filter(t => 
        t.tableName.toLowerCase().includes(filter) || (t.schema && t.schema.toLowerCase().includes(filter))
      );

      select.innerHTML = '<option value="">-- Choose an introspected table (' + filtered.length + ' match' + (filtered.length === 1 ? '' : 'es') + ') --</option>' +
        filtered.map(t => '<option value="' + t.tableName + '">' + (t.schema ? t.schema + '.' : '') + t.tableName + ' (' + t.columns.length + ' cols)</option>').join('');

      if (filtered.length === 1) {
        select.value = filtered[0].tableName;
      }
    }

    function applySelectedDbTable() {
      const select = document.getElementById('dbTableSelect');
      let tblName = select ? select.value : '';

      // If user clicks button before picking, default to the first available table
      if (!tblName) {
        if (currentIntrospectedTables && currentIntrospectedTables.length > 0) {
          tblName = currentIntrospectedTables[0].tableName;
          if (select) select.value = tblName;
        } else {
          showToast('⚠️ Please connect to database and fetch tables first.');
          return;
        }
      }

      const tbl = currentIntrospectedTables.find(t => t.tableName === tblName || (t.schema ? t.schema + '.' + t.tableName : '') === tblName);
      if (tbl) {
        const srcColsEl = document.getElementById('srcCols');
        const srcNameEl = document.getElementById('srcNameInput');
        const modelNameEl = document.getElementById('modelNameInput');
        const tgtColsEl = document.getElementById('tgtCols');

        if (srcColsEl) srcColsEl.value = tbl.columnsFormatted;
        if (srcNameEl) srcNameEl.value = tbl.tableName;
        const cleanName = tbl.tableName.replace(/^client_|_raw$/g, '');
        if (modelNameEl) {
          modelNameEl.value = 'stg_' + cleanName;
          handleModelNameInput('stg_' + cleanName);
        }

        const badge = document.getElementById('srcFileBadge');
        if (badge) badge.innerText = '🔌 [Live DB] ' + (tbl.schema ? tbl.schema + '.' : '') + tbl.tableName;

        if (tgtColsEl && (!tgtColsEl.value.trim() || tgtColsEl.value.includes('customer_id:string'))) {
          tgtColsEl.value = tbl.columns.map(function(c) { return c.name.toLowerCase() + ':' + c.type; }).join('\\n');
        }

        showToast('✓ Loaded ' + tbl.columns.length + ' columns from ' + tbl.tableName + ' into Schema Mapper!');

        if (srcColsEl) {
          srcColsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        showToast('⚠️ Could not find table schema: ' + tblName);
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
        handleModelNameInput('stg_users');
      } else if (kind === 'payments') {
        document.getElementById('srcCols').value = "PMT_ID:string\\nORD_REF:string\\nPMT_AMT:float\\nCURR_CD:string\\nSTAT_VAL:string\\nTXN_TS:timestamp";
        document.getElementById('tgtCols').value = "payment_id:string\\norder_id:string\\namount:numeric\\ncurrency:string\\nstatus:string\\ncreated_at:timestamp";
        document.getElementById('srcNameInput').value = "client_payments_raw";
        document.getElementById('modelNameInput').value = "stg_payments";
        handleModelNameInput('stg_payments');
      } else {
        document.getElementById('srcCols').value = "CUST_NBR_ID:string\\nTXN_AMT:float\\nCREATED_TS:timestamp\\nIS_ACTIVE_FLG:string\\nRAW_GEO_CODE:string";
        document.getElementById('tgtCols').value = "customer_id:string\\ntransaction_amount:numeric\\ncreated_at:timestamp\\nis_active:boolean";
        document.getElementById('srcNameInput').value = "client_orders_raw";
        document.getElementById('modelNameInput').value = "stg_orders";
        handleModelNameInput('stg_orders');
      }
      const errEl = document.getElementById('schemaErrorAlert');
      if (errEl) errEl.style.display = 'none';
      showToast('Sample schema loaded');
    }

    function loadTargetPreset(preset) {
      if (preset === 'orders') {
        document.getElementById('tgtCols').value = "customer_id:string\\ntransaction_amount:numeric\\ncreated_at:timestamp\\nis_active:boolean";
        document.getElementById('modelNameInput').value = "stg_orders";
        handleModelNameInput('stg_orders');
      } else if (preset === 'users') {
        document.getElementById('tgtCols').value = "user_id:string\\nemail:string\\nregistered_at:timestamp\\nrole:string\\nis_active:boolean";
        document.getElementById('modelNameInput').value = "stg_users";
        handleModelNameInput('stg_users');
      } else if (preset === 'payments') {
        document.getElementById('tgtCols').value = "payment_id:string\\namount:numeric\\ncurrency:string\\nstatus:string\\ncreated_at:timestamp";
        document.getElementById('modelNameInput').value = "stg_payments";
        handleModelNameInput('stg_payments');
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
      const outputPath = document.getElementById('modelOutputPathInput') ? document.getElementById('modelOutputPathInput').value.trim() : ('models/staging/' + modelName + '.sql');

      vscode.postMessage({
        command: 'generateSchemaMapping',
        sourceCols: src,
        targetCols: tgt,
        sourceName: srcName,
        modelName: modelName,
        outputPath: outputPath,
        writeToFile: true
      });
      showToast('🚀 Compiling staging model to ' + outputPath + '...');
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

    let currentK6LoadTest = '';
    let currentLocustLoadTest = '';
    let currentRunnerSh = '';
    let currentWrittenLoadTestPath = '';
    let activeLoadTestTab = 'k6';

    function generateLoadTest(framework) {
      const url = (document.getElementById('loadTestUrl') ? document.getElementById('loadTestUrl').value : '').trim() || 'http://localhost:8080/api/v1/invoices';
      const profile = document.getElementById('loadTestProfile') ? document.getElementById('loadTestProfile').value : 'standard';
      const slaChoice = document.getElementById('loadTestSla') ? document.getElementById('loadTestSla').value : 'strict';
      const connName = (document.getElementById('connName') ? document.getElementById('connName').value : 'ClientBillingApi').trim() || 'ClientBillingApi';

      let p95 = 120;
      let p99 = 250;
      let errRate = 0.5;
      if (slaChoice === 'standard') {
        p95 = 200; p99 = 400; errRate = 1.0;
      } else if (slaChoice === 'relaxed') {
        p95 = 500; p99 = 1000; errRate = 3.0;
      }

      showToast('⚡ Generating ' + framework.toUpperCase() + ' load test suite...');
      vscode.postMessage({
        command: 'generateLoadTestSuite',
        serviceName: connName,
        targetUrl: url,
        rampPreset: profile,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        maxErrorRatePercent: errRate,
        writeToFile: true
      });
    }

    function switchLoadTestTab(tab) {
      activeLoadTestTab = tab;
      const tabK6 = document.getElementById('tabK6');
      const tabLocust = document.getElementById('tabLocust');
      const tabRunnerSh = document.getElementById('tabRunnerSh');
      if (tabK6) tabK6.className = 'code-tab ' + (tab === 'k6' ? 'active' : '');
      if (tabLocust) tabLocust.className = 'code-tab ' + (tab === 'locust' ? 'active' : '');
      if (tabRunnerSh) tabRunnerSh.className = 'code-tab ' + (tab === 'sh' ? 'active' : '');

      const previewEl = document.getElementById('loadTestCodePreview');
      if (previewEl) {
        if (tab === 'k6') previewEl.innerText = currentK6LoadTest;
        else if (tab === 'locust') previewEl.innerText = currentLocustLoadTest;
        else if (tab === 'sh') previewEl.innerText = currentRunnerSh;
      }
    }

    function copyLoadTestCode() {
      const text = activeLoadTestTab === 'k6' ? currentK6LoadTest : (activeLoadTestTab === 'locust' ? currentLocustLoadTest : currentRunnerSh);
      navigator.clipboard.writeText(text);
      showToast('✓ Load test code copied to clipboard!');
    }

    function runLoadTestTerminal() {
      showToast('🚀 Running load test in dedicated terminal...');
      vscode.postMessage({ command: 'runLoadTestInTerminal' });
    }

    let currentRagPipeline = '';
    let currentRagChunker = '';
    let currentRagStore = '';
    let currentRagEmbeddings = '';
    let currentRagDocker = '';
    let currentWrittenRagPipelinePath = '';
    let activeRagTab = 'pipeline';

    function scaffoldRagPipeline() {
      const db = document.getElementById('ragVectorDb').value;
      const embedModelRaw = document.getElementById('ragEmbedModel').value.split(':');
      const embedModel = embedModelRaw[0];
      const embedDims = parseInt(embedModelRaw[1], 10) || 768;
      const lang = document.getElementById('ragLanguage').value;
      const chunkSize = parseInt(document.getElementById('ragChunkSize').value, 10) || 512;
      const overlap = parseInt(document.getElementById('ragChunkOverlap').value, 10) || 64;
      const threshold = parseFloat(document.getElementById('ragThreshold').value) || 0.75;
      const connName = (document.getElementById('connName') ? document.getElementById('connName').value : 'ClientIntelApi').trim() || 'ClientIntelApi';

      showToast('🧠 Scaffolding 100% Air-Gapped RAG & Vector Pipeline (' + db.toUpperCase() + ')...');
      vscode.postMessage({
        command: 'scaffoldRagPipeline',
        serviceName: connName,
        language: lang,
        vectorStore: db,
        embeddingProvider: embedModel.includes('tei') ? 'tei_huggingface' : 'ollama_local',
        embeddingModel: embedModel.replace('tei-', ''),
        embeddingDimensions: embedDims,
        chunkSize: chunkSize,
        chunkOverlap: overlap,
        similarityThreshold: threshold,
        writeToFile: true
      });
    }

    function switchRagTab(tab) {
      activeRagTab = tab;
      const tabPipe = document.getElementById('tabRagPipeline');
      const tabChunk = document.getElementById('tabRagChunker');
      const tabStore = document.getElementById('tabRagStore');
      const tabEmbed = document.getElementById('tabRagEmbed');
      const tabDock = document.getElementById('tabRagDocker');

      if (tabPipe) tabPipe.className = 'code-tab ' + (tab === 'pipeline' ? 'active' : '');
      if (tabChunk) tabChunk.className = 'code-tab ' + (tab === 'chunker' ? 'active' : '');
      if (tabStore) tabStore.className = 'code-tab ' + (tab === 'store' ? 'active' : '');
      if (tabEmbed) tabEmbed.className = 'code-tab ' + (tab === 'embed' ? 'active' : '');
      if (tabDock) tabDock.className = 'code-tab ' + (tab === 'docker' ? 'active' : '');

      const previewEl = document.getElementById('ragCodePreview');
      if (previewEl) {
        if (tab === 'pipeline') previewEl.innerText = currentRagPipeline;
        else if (tab === 'chunker') previewEl.innerText = currentRagChunker;
        else if (tab === 'store') previewEl.innerText = currentRagStore;
        else if (tab === 'embed') previewEl.innerText = currentRagEmbeddings;
        else if (tab === 'docker') previewEl.innerText = currentRagDocker;
      }
    }

    function copyRagCode() {
      let text = currentRagPipeline;
      if (activeRagTab === 'chunker') text = currentRagChunker;
      else if (activeRagTab === 'store') text = currentRagStore;
      else if (activeRagTab === 'embed') text = currentRagEmbeddings;
      else if (activeRagTab === 'docker') text = currentRagDocker;
      navigator.clipboard.writeText(text);
      showToast('✓ RAG code copied to clipboard!');
    }

    function runRagTestsTerminal() {
      const lang = document.getElementById('ragLanguage') ? document.getElementById('ragLanguage').value : 'python';
      showToast('🚀 Running RAG pipeline unit tests in terminal...');
      vscode.postMessage({ command: 'runRagTestsInTerminal', language: lang });
    }

    function launchEnterpriseFeature(feat) {
      if (feat === 'loadTesting') {
        setPhase(2);
        setTimeout(function() {
          const el = document.getElementById('loadTestUrl');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      } else if (feat === 'ragScaffolder') {
        setPhase(2);
        setTimeout(function() {
          const el = document.getElementById('ragStudioCard');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
      }
    }

    window.launchEnterpriseFeature = launchEnterpriseFeature;
    window.generateLoadTest = generateLoadTest;
    window.switchLoadTestTab = switchLoadTestTab;
    window.copyLoadTestCode = copyLoadTestCode;
    window.runLoadTestTerminal = runLoadTestTerminal;
    window.scaffoldRagPipeline = scaffoldRagPipeline;
    window.switchRagTab = switchRagTab;
    window.copyRagCode = copyRagCode;
    window.runRagTestsTerminal = runRagTestsTerminal;
    window.toggleEnterpriseLicenseDrawer = toggleEnterpriseLicenseDrawer;
    window.activateEnterpriseLicense = activateEnterpriseLicense;
    window.deactivateEnterpriseLicense = deactivateEnterpriseLicense;
    window.generateTrialLicense = generateTrialLicense;

    function discoverCloud() {
      const projId = document.getElementById('gcpProjId') ? document.getElementById('gcpProjId').value : '';
      vscode.postMessage({
        command: 'discoverCloudResources',
        projectId: projId
      });
      showToast('⚡ Querying cloud API for VPCs and subnets...');
    }

    function generateTerraformIaC() {
      const projId = document.getElementById('gcpProjId').value;
      const cpu = document.getElementById('deployCpu').value;
      const mem = document.getElementById('deployMemory').value;
      const gpu = document.getElementById('deployGpu').value;
      const vpc = document.getElementById('deployVpcId').value;
      const sub = document.getElementById('deploySubnetId').value;
      const sg = document.getElementById('deploySecurityGroups').value;
      const ingress = document.getElementById('deployIngress').value;
      const minInst = document.getElementById('deployMinInst').value;
      const maxInst = document.getElementById('deployMaxInst').value;
      const secrets = document.getElementById('deploySecrets').value;

      vscode.postMessage({
        command: 'generateTerraformIaC',
        projectId: projId,
        cpu: cpu,
        memory: mem,
        gpu: gpu,
        vpcId: vpc,
        subnetId: sub,
        securityGroups: sg,
        ingress: ingress,
        minInstances: minInst,
        maxInstances: maxInst,
        secretsProvider: secrets
      });
    }

    function generateKubernetesIaC() {
      const projId = document.getElementById('gcpProjId').value;
      const cpu = document.getElementById('deployCpu').value;
      const mem = document.getElementById('deployMemory').value;
      const gpu = document.getElementById('deployGpu').value;
      const sub = document.getElementById('deploySubnetId').value;
      const minInst = document.getElementById('deployMinInst').value;

      vscode.postMessage({
        command: 'generateKubernetesIaC',
        projectId: projId,
        cpu: cpu,
        memory: mem,
        gpu: gpu,
        subnetId: sub,
        minInstances: minInst
      });
    }

    function generateDockerComposeIaC() {
      const projId = document.getElementById('gcpProjId').value;
      const cpu = document.getElementById('deployCpu').value;
      const mem = document.getElementById('deployMemory').value;
      const gpu = document.getElementById('deployGpu').value;
      const vpc = document.getElementById('deployVpcId').value;

      vscode.postMessage({
        command: 'generateDockerComposeIaC',
        projectId: projId,
        cpu: cpu,
        memory: mem,
        gpu: gpu,
        vpcId: vpc
      });
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

    // Initialize document preview, Git/Cloud status, and Enterprise License on load
    switchDocTab('arch');
    vscode.postMessage({ command: 'getGitAndCloudStatus' });
    vscode.postMessage({ command: 'getEnterpriseLicenseState' });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'gitAndCloudStatus') {
        const branchSelect = document.getElementById('gitBranchSelect');
        if (branchSelect && msg.gitBranches && msg.gitBranches.length) {
          const current = msg.gitBranch || 'main';
          branchSelect.innerHTML = msg.gitBranches.map(function(b) {
            return '<option value="' + b + '" ' + (b === current ? 'selected' : '') + '>' + b + '</option>';
          }).join('');
        }

        const targetB1 = document.getElementById('commitTargetBranchBadge');
        if (targetB1) targetB1.innerText = msg.gitBranch || 'main';
        const targetB2 = document.getElementById('commitTargetBranchBadge2');
        if (targetB2) targetB2.innerText = msg.gitBranch || 'main';
        
        const remoteEl = document.getElementById('gitRemoteBadge');
        if (remoteEl) {
          const rem = msg.gitRemote || msg.remote || 'No remote origin';
          remoteEl.innerText = rem.length > 35 ? rem.slice(0, 32) + '...' : rem;
          remoteEl.title = rem;
        }

        const httpsInput = document.getElementById('httpsRepoUrl');
        if (httpsInput && msg.gitRemote && !msg.gitRemote.startsWith('No ')) {
          if (!httpsInput.value) httpsInput.value = msg.gitRemote;
        }
        const sshInput = document.getElementById('sshRepoUrl');
        if (sshInput && msg.gitRemote && !msg.gitRemote.startsWith('No ')) {
          if (!sshInput.value) sshInput.value = msg.gitRemote;
        }

        const sshBadge = document.getElementById('sshKeyStatusBadge');
        if (sshBadge && msg.sshKeyInfo) {
          if (msg.sshKeyInfo.exists) {
            sshBadge.innerText = '✓ Key Found (' + msg.sshKeyInfo.keyPath + ')';
            sshBadge.style.color = 'var(--success)';
          } else {
            sshBadge.innerText = '○ No Key Found';
            sshBadge.style.color = 'var(--warn)';
          }
        }
        
        const dirtyEl = document.getElementById('gitDirtyBadge');
        if (dirtyEl) {
          dirtyEl.innerText = msg.isDirty ? '● Modified (' + (msg.uncommittedCount || 1) + ' files)' : '✓ Clean';
          dirtyEl.style.color = msg.isDirty ? 'var(--warn)' : 'var(--success)';
        }

        const filesCount = document.getElementById('commitFilesCountBadge');
        if (filesCount) filesCount.innerText = (msg.uncommittedCount || 0) + ' files';

        const filesList = document.getElementById('commitChangedFilesList');
        if (filesList && msg.changedFiles) {
          if (msg.changedFiles.length > 0) {
            filesList.innerHTML = msg.changedFiles.map(function(f) {
              const color = f.status === 'A' || f.status === '??' ? 'var(--success)' : (f.status === 'D' ? 'var(--error)' : 'var(--warn)');
              return '<div style="display:flex; gap:6px; align-items:center;"><span style="font-weight:bold; color:' + color + '; width:16px;">' + f.status + '</span><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + f.path + '</span></div>';
            }).join('');
          } else {
            filesList.innerHTML = '<span style="opacity:0.6;">✓ No uncommitted changes (working tree clean)</span>';
          }
        }
      } else if (msg.type === 'commitDraftResult') {
        const titleInput = document.getElementById('commitTitleInput');
        if (titleInput && msg.title) titleInput.value = msg.title;
        const descInput = document.getElementById('commitDescInput');
        if (descInput && msg.description) descInput.value = msg.description;
        showToast('✓ Commit message & description drafted!');
      } else if (msg.type === 'gitAuthResult') {
        showToast(msg.message || (msg.success ? '✓ Git Remote authenticated!' : '⚠️ Remote verification notice'));
        vscode.postMessage({ command: 'getGitAndCloudStatus' });
      } else if (msg.type === 'gitDiagnosticResult') {
        const banner = document.getElementById('gitDiagnosticBanner');
        if (banner) {
          banner.style.display = 'block';
          banner.innerHTML = '<span style="color:' + (msg.success ? 'var(--success)' : 'var(--warn)') + '; font-weight:bold;">[' + msg.target.toUpperCase() + ' SSH TEST ' + (msg.success ? '✓ SUCCESS' : '⚠️ RESPONSE') + ']</span><br><br>' + msg.rawOutput;
        }
        showToast(msg.success ? '✓ ' + msg.target.toUpperCase() + ' SSH Connected!' : '⚠️ ' + msg.target.toUpperCase() + ' check completed.');
      } else if (msg.type === 'gitRemoteUpdated') {
        vscode.postMessage({ command: 'getGitAndCloudStatus' });
        showToast('✓ Remote Origin set to ' + msg.remoteUrl);
      } else if (msg.type === 'gitResult') {
        if (msg.success) {
          showToast(msg.message || '✓ Git operation completed successfully!');
          vscode.postMessage({ command: 'getGitAndCloudStatus' });
        } else {
          showToast('⚠️ ' + (msg.error || 'Git operation encountered an issue'));
        }
      } else if (msg.type === 'cloudDetailedStatus') {
        // 1. GCP
        const gcp = msg.gcp;
        const gcpBadge = document.getElementById('cloudGcpBadge');
        const gcpAcc = document.getElementById('cloudGcpAccount');
        const gcpBtn = document.getElementById('btnConnectGcp');
        if (gcp) {
          if (gcp.ok) {
            if (gcpBadge) { gcpBadge.innerText = '✓ Connected'; gcpBadge.style.color = 'var(--success)'; }
            if (gcpAcc) gcpAcc.innerText = (gcp.account || 'Active') + (gcp.project ? ' (' + gcp.project + ')' : '');
            if (gcpBtn) { gcpBtn.innerText = '🔄 Switch / Re-login'; gcpBtn.setAttribute('onclick', "connectCloud('gcp', 'login')"); }
          } else if (gcp.installed) {
            if (gcpBadge) { gcpBadge.innerText = '○ Not Logged In'; gcpBadge.style.color = 'var(--warn)'; }
            if (gcpAcc) gcpAcc.innerText = 'gcloud installed (Click Connect to login)';
            if (gcpBtn) { gcpBtn.innerText = '🔑 Connect GCP'; gcpBtn.setAttribute('onclick', "connectCloud('gcp', 'login')"); }
          } else {
            if (gcpBadge) { gcpBadge.innerText = '⚠️ CLI Missing'; gcpBadge.style.color = 'var(--error)'; }
            if (gcpAcc) gcpAcc.innerText = 'gcloud CLI not found on system';
            if (gcpBtn) { gcpBtn.innerText = '⬇️ Install gcloud (winget)'; gcpBtn.setAttribute('onclick', "connectCloud('gcp', 'install')"); }
          }
        }

        // 2. AWS
        const aws = msg.aws;
        const awsBadge = document.getElementById('cloudAwsBadge');
        const awsAcc = document.getElementById('cloudAwsAccount');
        const awsBtn = document.getElementById('btnConnectAws');
        if (aws) {
          if (aws.ok) {
            if (awsBadge) { awsBadge.innerText = '✓ Connected'; awsBadge.style.color = 'var(--success)'; }
            if (awsAcc) awsAcc.innerText = (aws.account || 'Active');
            if (awsBtn) { awsBtn.innerText = '🔄 Re-configure AWS'; awsBtn.setAttribute('onclick', "connectCloud('aws', 'login')"); }
          } else if (aws.installed) {
            if (awsBadge) { awsBadge.innerText = '○ Not Configured'; awsBadge.style.color = 'var(--warn)'; }
            if (awsAcc) awsAcc.innerText = 'AWS CLI installed (Click to configure)';
            if (awsBtn) { awsBtn.innerText = '🔑 Configure AWS'; awsBtn.setAttribute('onclick', "connectCloud('aws', 'login')"); }
          } else {
            if (awsBadge) { awsBadge.innerText = '⚠️ CLI Missing'; awsBadge.style.color = 'var(--error)'; }
            if (awsAcc) awsAcc.innerText = 'AWS CLI not found on system';
            if (awsBtn) { awsBtn.innerText = '⬇️ Install AWS CLI (winget)'; awsBtn.setAttribute('onclick', "connectCloud('aws', 'install')"); }
          }
        }

        // 3. Azure
        const az = msg.azure;
        const azBadge = document.getElementById('cloudAzureBadge');
        const azAcc = document.getElementById('cloudAzureAccount');
        const azBtn = document.getElementById('btnConnectAzure');
        if (az) {
          if (az.ok) {
            if (azBadge) { azBadge.innerText = '✓ Connected'; azBadge.style.color = 'var(--success)'; }
            if (azAcc) azAcc.innerText = (az.account || 'Active');
            if (azBtn) { azBtn.innerText = '🔄 Switch Azure Account'; azBtn.setAttribute('onclick', "connectCloud('azure', 'login')"); }
          } else if (az.installed) {
            if (azBadge) { azBadge.innerText = '○ Not Logged In'; azBadge.style.color = 'var(--warn)'; }
            if (azAcc) azAcc.innerText = 'Azure CLI installed (Click to login)';
            if (azBtn) { azBtn.innerText = '🔑 Connect Azure (az login)'; azBtn.setAttribute('onclick', "connectCloud('azure', 'login')"); }
          } else {
            if (azBadge) { azBadge.innerText = '⚠️ CLI Missing'; azBadge.style.color = 'var(--error)'; }
            if (azAcc) azAcc.innerText = 'Azure CLI (az) not found on system';
            if (azBtn) { azBtn.innerText = '⬇️ 1-Click Install Azure CLI'; azBtn.setAttribute('onclick', "connectCloud('azure', 'install')"); }
          }
        }

        // 4. Docker
        const doc = msg.docker;
        const docBadge = document.getElementById('cloudDockerBadge');
        const docAcc = document.getElementById('cloudDockerAccount');
        const docBtn = document.getElementById('btnConnectDocker');
        if (doc) {
          if (doc.ok) {
            if (docBadge) { docBadge.innerText = '✓ Running'; docBadge.style.color = 'var(--success)'; }
            if (docAcc) docAcc.innerText = 'Engine ' + (doc.version || 'Active') + ' running';
            if (docBtn) { docBtn.innerText = '🐳 Check Docker Status'; docBtn.setAttribute('onclick', "connectCloud('docker', 'login')"); }
          } else if (doc.installed) {
            if (docBadge) { docBadge.innerText = '⚠️ Daemon Stopped'; docBadge.style.color = 'var(--warn)'; }
            if (docAcc) docAcc.innerText = 'Docker CLI present, app is closed';
            if (docBtn) { docBtn.innerText = '🐳 Launch Docker Desktop'; docBtn.setAttribute('onclick', "connectCloud('docker', 'startDocker')"); }
          } else {
            if (docBadge) { docBadge.innerText = '⚠️ Not Installed'; docBadge.style.color = 'var(--error)'; }
            if (docAcc) docAcc.innerText = 'Docker Desktop not installed';
            if (docBtn) { docBtn.innerText = '⬇️ Install Docker Desktop'; docBtn.setAttribute('onclick', "connectCloud('docker', 'install')"); }
          }
        }
        showToast('✓ Cloud provider diagnostics updated!');
      } else if (msg.type === 'cloudStatusResult') {
        if (msg.connected) {
          showToast('✓ Cloud Connection Verified: ' + msg.provider);
        } else {
          showToast('ℹ️ ' + msg.message);
        }
      } else if (msg.type === 'cloudResourcesDiscovered') {
        const disc = msg.resources;
        const banner = document.getElementById('cloudDiscoveryBanner');
        if (banner) banner.style.display = 'block';

        const accText = document.getElementById('cloudAccountText');
        if (accText) accText.innerText = (disc.activeAccount || disc.provider || 'Active Cloud') + (disc.activeProject ? ' (' + disc.activeProject + ')' : '');

        const sumText = document.getElementById('cloudDiscoverySummary');
        if (sumText) {
          sumText.innerText = disc.rawMessage || ('Discovered ' + (disc.vpcs ? disc.vpcs.length : 0) + ' VPCs, ' + (disc.subnets ? disc.subnets.length : 0) + ' Subnets.');
        }

        if (disc.vpcs && disc.vpcs.length > 0) {
          const vpcData = document.getElementById('vpcDatalist');
          if (vpcData) {
            vpcData.innerHTML = disc.vpcs.map(v => '<option value="' + v + '">' + v + '</option>').join('');
          }
          const vpcInput = document.getElementById('deployVpcId');
          if (vpcInput && !vpcInput.value) {
            vpcInput.value = disc.vpcs[0];
          }
        }

        if (disc.subnets && disc.subnets.length > 0) {
          const subData = document.getElementById('subnetDatalist');
          if (subData) {
            subData.innerHTML = disc.subnets.map(s => '<option value="' + s + '">' + s + '</option>').join('');
          }
          const subInput = document.getElementById('deploySubnetId');
          if (subInput && !subInput.value) {
            subInput.value = disc.subnets[0];
          }
        }

        if (disc.activeProject) {
          const projInput = document.getElementById('gcpProjId');
          if (projInput) projInput.value = disc.activeProject;
        }

        showToast(disc.authenticated ? '✓ Discovered cloud resources successfully!' : '⚠️ ' + (disc.authHelpPrompt || 'Could not authenticate cloud CLI'));
      } else if (msg.type === 'dbIntrospectResult') {
        const res = msg.result;
        if (res.success && res.tables && res.tables.length > 0) {
          currentIntrospectedTables = res.tables;
          const container = document.getElementById('dbTablesContainer');
          if (container) container.style.display = 'block';

          const select = document.getElementById('dbTableSelect');
          if (select) {
            select.innerHTML = '<option value="">-- Choose an introspected table (' + res.tables.length + ' found) --</option>' +
              res.tables.map(t => '<option value="' + t.tableName + '">' + (t.schema ? t.schema + '.' : '') + t.tableName + ' (' + t.columns.length + ' columns)</option>').join('');
            if (res.tables.length > 0) {
              select.value = res.tables[0].tableName;
            }
          }

          const badge = document.getElementById('dbConnectionStatusBadge');
          if (badge) {
            badge.innerText = '✓ Connected to ' + res.dialect.toUpperCase() + ': ' + res.tables.length + ' tables discovered';
          }
          refreshMartModelOptions();
          showToast('✓ Discovered ' + res.tables.length + ' tables from database!');
        } else {
          showToast('⚠️ ' + (res.error || res.message || 'No tables discovered from database.'));
        }
      } else if (msg.type === 'dbConfigDetected') {
        const d = msg.detected;
        if (d.found) {
          if (d.dialect) {
            document.getElementById('dbDialect').value = d.dialect;
            handleDialectChange();
          }
          if (d.connectionUri) document.getElementById('dbConnUri').value = d.connectionUri;
          if (d.database) document.getElementById('dbDatabaseName').value = d.database;
          if (d.schema) document.getElementById('dbSchemaName').value = d.schema;
          showToast('✓ Auto-populated ' + (d.dialect ? d.dialect.toUpperCase() : 'DB') + ' connection from ' + d.sourceFile);
        } else {
          showToast('⚠️ No database connection settings found in workspace .env or config files.');
        }
      } else if (msg.type === 'dbTestResult') {
        const res = msg.result;
        if (res.success) {
          showToast('✓ ' + res.message);
        } else {
          showToast('⚠️ ' + (res.error || res.message || 'Database connection test failed.'));
        }
      } else if (msg.type === 'dbSecretsWiped') {
        document.getElementById('dbConnUri').value = '';
        showToast('✓ Stored credentials purged from OS vault.');
      } else if (msg.type === 'curlParsed') {
        const p = msg.parsed;
        if (p.baseUrl) document.getElementById('connBaseUrl').value = p.baseUrl;
        if (p.authType) document.getElementById('connAuthType').value = p.authType;
        if (p.name) document.getElementById('connName').value = p.name;
        toggleCurlModal();
        showToast('✓ cURL command parsed and loaded into Studio!');
      } else if (msg.type === 'openApiParsed') {
        const p = msg.parsed;
        if (p.baseUrl) document.getElementById('connBaseUrl').value = p.baseUrl;
        if (p.authType) document.getElementById('connAuthType').value = p.authType;
        if (p.name) document.getElementById('connName').value = p.name;
        toggleOpenApiModal();
        showToast('✓ OpenAPI spec parsed (' + (p.endpoints ? p.endpoints.length : 0) + ' endpoints loaded)!');
      } else if (msg.type === 'dataMartResult') {
        const box = document.getElementById('martResultBox');
        if (box) box.style.display = 'block';
        currentMartSql = msg.sql || (msg.result ? msg.result.dbtSql : '');
        currentWrittenMartPath = msg.writtenFile || ('models/marts/' + (msg.martName || 'mart') + '.sql');
        const prevEl = document.getElementById('martCodePreview');
        if (prevEl) prevEl.innerText = currentMartSql;
        const badgeEl = document.getElementById('martSavedBadge');
        if (badgeEl && currentWrittenMartPath) {
          badgeEl.innerHTML = 'Location: <code>' + currentWrittenMartPath + '</code>';
        }
        showToast('✓ Generated ' + (msg.martName || 'dimensional mart') + ' & schema.yml!');
      } else if (msg.type === 'apiTestResult') {
        if (msg.success) {
          showToast('✓ Endpoint ' + msg.url + ' reachable: HTTP ' + msg.status + ' (' + msg.latencyMs + 'ms)');
        } else {
          showToast('⚠️ Endpoint test: ' + (msg.error || 'Connection failed') + ' (' + msg.latencyMs + 'ms)');
        }
      } else if (msg.type === 'iacGenerated') {
        const box = document.getElementById('iacResultBox');
        if (box) box.style.display = 'block';
        currentWrittenIacFile = msg.writtenFile;
        const lbl = document.getElementById('iacFileNameLabel');
        if (lbl) lbl.innerText = '📄 Generated: ' + msg.writtenFile;
        const prev = document.getElementById('iacCodePreview');
        if (prev) prev.innerText = msg.code;
        showToast('✓ Infrastructure IaC Scaffolded: ' + msg.writtenFile);
      } else if (msg.type === 'schemaFileLoaded') {
        document.getElementById('srcCols').value = msg.colsString;
        document.getElementById('srcNameInput').value = msg.sourceName;
        document.getElementById('modelNameInput').value = msg.modelName;
        const badge = document.getElementById('srcFileBadge');
        if (badge) badge.innerText = '📁 ' + msg.fileName;
        const errEl = document.getElementById('schemaErrorAlert');
        if (errEl) errEl.style.display = 'none';
        showToast('✓ Loaded ' + msg.fileName);
      } else if (msg.type === 'aiStagingAnalysisResult') {
        const res = msg.result;
        if (res) {
          const tgtEl = document.getElementById('tgtCols');
          const nameEl = document.getElementById('modelNameInput');
          const pathEl = document.getElementById('modelOutputPathInput');
          if (tgtEl) tgtEl.value = res.targetColumnsText;
          if (nameEl) nameEl.value = res.targetModelName;
          if (pathEl) pathEl.value = res.targetOutputPath;
          showToast(res.summary);
        }
      } else if (msg.type === 'aiMartRecipesResult') {
        currentAiMartRecipes = msg.recipes || [];
        renderAiMartRecipes(currentAiMartRecipes);
      } else if (msg.type === 'aiMartFromResult') {
        if (msg.recipe) {
          applyAiMartRecipeDirect(msg.recipe);
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
      } else if (msg.type === 'enterpriseLicenseState' || msg.type === 'enterpriseLicenseResult') {
        const state = msg.state;
        if (state) {
          const headerTier = document.getElementById('headerLicenseTier');
          const planBadge = document.getElementById('drawerLicensePlanBadge');
          const orgEl = document.getElementById('drawerLicenseOrg');
          const statusEl = document.getElementById('drawerLicenseStatus');
          const daysEl = document.getElementById('drawerLicenseDays');

          if (state.isLicensed) {
            const planTitle = state.plan === 'enterprise_platinum' ? '💎 Enterprise Platinum' : (state.plan === 'enterprise_standard' ? '💎 Enterprise Standard' : '💎 Pro');
            if (headerTier) {
              headerTier.innerText = planTitle + ' (' + (state.organization || 'Licensed') + ')';
            }
            if (planBadge) {
              planBadge.innerText = planTitle;
              planBadge.style.background = 'rgba(78, 201, 176, 0.2)';
            }
            if (orgEl) orgEl.innerText = state.organization || 'Licensed Partner';
            if (statusEl) { statusEl.innerText = '✓ Active'; statusEl.style.color = 'var(--success)'; }
            if (daysEl) daysEl.innerText = (state.daysRemaining || 30) + ' days remaining';
          } else {
            if (headerTier) headerTier.innerText = 'Community (Free)';
            if (planBadge) {
              planBadge.innerText = '🟢 Community Edition (Free)';
              planBadge.style.background = 'rgba(78, 201, 176, 0.15)';
            }
            if (orgEl) orgEl.innerText = 'Community User';
            if (statusEl) { statusEl.innerText = 'Free Core'; statusEl.style.color = 'var(--fg)'; }
            if (daysEl) daysEl.innerText = 'Unlimited (Free Core)';
          }
        }
        if (msg.message) showToast(msg.message);
      } else if (msg.type === 'loadTestSuiteGenerated') {
        const suite = msg.suite;
        if (suite) {
          currentK6LoadTest = suite.k6Script;
          currentLocustLoadTest = suite.locustScript;
          currentRunnerSh = suite.shellRunner;
          currentWrittenLoadTestPath = suite.k6FilePath;

          const resultBox = document.getElementById('loadTestResultBox');
          if (resultBox) resultBox.style.display = 'block';
          const pathBadge = document.getElementById('loadTestPathBadge');
          if (pathBadge) pathBadge.innerHTML = 'Location: <code>' + suite.k6FilePath + '</code>';

          switchLoadTestTab(activeLoadTestTab);
          showToast('✓ Generated k6 & Locust Load Test Suite!');
        }
      } else if (msg.type === 'ragPipelineScaffolded') {
        const files = msg.files;
        if (files) {
          currentRagPipeline = files.retrieverPipelineCode;
          currentRagChunker = files.chunkerCode;
          currentRagStore = files.vectorStoreCode;
          currentRagEmbeddings = files.embeddingsCode;
          currentRagDocker = files.dockerComposeYaml;
          currentWrittenRagPipelinePath = files.retrieverPipelinePath;

          const resultBox = document.getElementById('ragResultBox');
          if (resultBox) resultBox.style.display = 'block';
          const pathBadge = document.getElementById('ragPathBadge');
          if (pathBadge) pathBadge.innerHTML = 'Location: <code>' + files.retrieverPipelinePath + '</code>';

          switchRagTab(activeRagTab);
          showToast('✓ 100% Air-Gapped RAG Pipeline Generated in src/rag/!');
        }
      } else if (msg.type === 'enterpriseGatingNotice') {
        toggleEnterpriseLicenseDrawer();
        showToast('💎 ' + msg.title + ' is an Enterprise capability. Click Activate or Start 30-Day Trial!');
      }
    });

    // Initialize Mart model options on load
    try {
      refreshMartModelOptions();
    } catch (e) {
      console.warn('Initial refreshMartModelOptions defer:', e);
    }
  </script>
</body>
</html>`;
  }
}
