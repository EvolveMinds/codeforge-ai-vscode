/**
 * ui/pythonStudioPanel.ts — Python AI Studio & Neural Debugger Interactive Workspace
 *
 * Provides a dedicated, dual-track ("Code-First, AI Optional") cockpit for Python engineering:
 *  - 3-Mode Selector: [Pure Manual (Zero-AI)] | [On-Demand AI] | [Continuous AI]
 *  - Deterministic Diagnostics: Bracket & Indentation checks, Tensor Shape Flow, DataFrame Anti-Patterns
 *  - Side-by-Side Editable Diff Review: AI proposals never overwrite files directly; engineers
 *    can hand-edit proposed code before accepting.
 *  - 1-Click PyTest Contract Generator for regression prevention.
 *  - Direct hooks to Git Pre-Commit Hygiene, Sandbox Terminal, and Cloud Dockerfile Scaffolding.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DeterministicAnalyzer } from '../plugins/pythonStudio/deterministicAnalyzer';
import { TensorShapeEngine } from '../plugins/pythonStudio/tensorShapeEngine';
import { DataFrameSniffer } from '../plugins/pythonStudio/dataFrameSniffer';
import { GitIntegrationHook } from '../plugins/pythonStudio/gitIntegrationHook';
import { AiAdvisor, type AiAdvisorMode, type AiPatchProposal } from '../plugins/pythonStudio/aiAdvisor';
import { CloudDeployHook } from '../plugins/pythonStudio/cloudDeployHook';
import { PythonRuntime } from '../plugins/pythonStudio/pythonRuntime';
import { PythonEnvironmentManager } from '../plugins/pythonStudio/pythonEnvironmentManager';
import { PythonCodeTools } from '../plugins/pythonStudio/pythonCodeTools';
import { ProjectOrientationSynthesizer } from '../fde/codebaseGraph';
import type { IServices } from '../core/services';

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class PythonStudioPanel {
  private static _instance: PythonStudioPanel | null = null;

  static show(services?: IServices): PythonStudioPanel {
    if (!this._instance) {
      this._instance = new PythonStudioPanel(services);
    }
    this._instance._panel.reveal(vscode.ViewColumn.Beside);
    this._instance._refreshCurrentDocument();
    return this._instance;
  }

  static get current(): PythonStudioPanel | null {
    return this._instance;
  }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _mode: AiAdvisorMode = 'manual';
  private _currentFilePath = '';
  private _currentCode = '';
  private _lastProposal: AiPatchProposal | null = null;
  private _lastPytestContract = '';

  private constructor(private readonly _services?: IServices) {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.pythonStudio',
      '🐍 Python AI Studio & Neural Debugger',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this._panel.onDidDispose(() => {
      this._disposed = true;
      if (PythonStudioPanel._instance === this) {
        PythonStudioPanel._instance = null;
      }
    });

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      await this._handleMessage(msg);
    });

    // Listen to active editor changes to keep workspace synced
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'python' && !this._disposed) {
        this._refreshCurrentDocument();
      }
    });

    this._render();
  }

  dispose(): void {
    if (!this._disposed) {
      this._panel.dispose();
    }
  }

  private _refreshCurrentDocument(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName.endsWith('.py')) {
      this._currentFilePath = editor.document.fileName;
      this._currentCode = editor.document.getText();
    } else {
      // Keep previous code or placeholder
      if (!this._currentCode) {
        this._currentFilePath = 'No active Python file';
        this._currentCode = '# Open a Python file to trace tensor shapes, check syntax, or inspect DataFrames.\n';
      }
    }
    this._postState();
  }

  private async _handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'getInitialState': {
        this._refreshCurrentDocument();
        break;
      }

      case 'setMode': {
        this._mode = msg.mode as AiAdvisorMode;
        vscode.window.showInformationMessage(
          `Python AI Studio Mode: ${this._mode === 'manual' ? 'Pure Manual (100% Offline / Zero-AI)' : this._mode === 'on-demand' ? 'On-Demand AI Assistance' : 'Continuous AI Linting'}`
        );
        this._postState();
        break;
      }

      case 'runOfflineScan': {
        const code = msg.code || this._currentCode;
        const result = DeterministicAnalyzer.analyzeCode(code);
        this._panel.webview.postMessage({
          type: 'scanResults',
          category: 'syntax',
          result,
        });
        break;
      }

      case 'runTensorScan': {
        const code = msg.code || this._currentCode;
        const report = TensorShapeEngine.analyzeTensorCode(code);
        this._panel.webview.postMessage({
          type: 'scanResults',
          category: 'tensor',
          result: report,
        });
        break;
      }

      case 'runDataFrameSniff': {
        const code = msg.code || this._currentCode;
        const report = DataFrameSniffer.sniffDataCode(code);
        this._panel.webview.postMessage({
          type: 'scanResults',
          category: 'dataframe',
          result: report,
        });
        break;
      }

      case 'runGitCheck': {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const hygiene = GitIntegrationHook.scanWorkspaceHygiene(ws);
        this._panel.webview.postMessage({
          type: 'scanResults',
          category: 'git',
          result: hygiene,
        });
        break;
      }

      case 'askAiAdvisor': {
        const code = msg.code || this._currentCode;
        const userPrompt = msg.prompt || 'Optimize and fix code defects.';
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: this._mode === 'manual'
              ? 'Python Studio: Running Offline Heuristic Analysis...'
              : 'Python Studio: Querying AI Advisor for patch proposal...',
            cancellable: false,
          },
          async () => {
            const proposal = await AiAdvisor.proposePatch(
              {
                sourceCode: code,
                filePath: this._currentFilePath,
                userPrompt,
              },
              this._services,
              this._mode
            );
            this._lastProposal = proposal;
            this._lastPytestContract = proposal.testContract || '';
            this._panel.webview.postMessage({
              type: 'patchProposal',
              proposal,
            });
          }
        );
        break;
      }

      case 'generatePytest': {
        const code = msg.code || this._currentCode;
        const contract = AiAdvisor.generatePytestContract(code, { fileName: path.basename(this._currentFilePath) });
        this._lastPytestContract = contract;
        this._panel.webview.postMessage({
          type: 'pytestContract',
          contract,
        });
        break;
      }

      case 'formatCode': {
        const code = msg.code || this._currentCode;
        const result = PythonCodeTools.formatCode(code);
        this._panel.webview.postMessage({
          type: 'codeFormatted',
          formatted: result.formatted,
          changedLines: result.changedLines,
        });
        vscode.window.showInformationMessage(`✓ Python AI Studio: Formatted code (${result.changedLines} lines normalized to Black/Ruff PEP 8).`);
        break;
      }

      case 'organizeImports': {
        const code = msg.code || this._currentCode;
        const result = PythonCodeTools.organizeImports(code);
        this._panel.webview.postMessage({
          type: 'importsOrganized',
          organized: result.organized,
          importCount: result.importCount,
          stdlibCount: result.stdlibCount,
          thirdPartyCount: result.thirdPartyCount,
          localCount: result.localCount,
        });
        vscode.window.showInformationMessage(`✓ Python AI Studio: Organized ${result.importCount} imports (stdlib: ${result.stdlibCount}, third-party: ${result.thirdPartyCount}, local: ${result.localCount}).`);
        break;
      }

      case 'autoFixTraceback': {
        const code = msg.code || this._currentCode;
        const traceback = msg.traceback || '';
        const patchedCode = PythonCodeTools.synthesizeTracebackFix(code, traceback);
        const diag = PythonCodeTools.parseTraceback(traceback);
        const { diffUnified, diffHunks } = AiAdvisor.generateDiff(code, patchedCode, path.basename(this._currentFilePath));
        const proposal: AiPatchProposal = {
          originalCode: code,
          proposedCode: patchedCode,
          diffUnified,
          diffHunks,
          confidence: 0.98,
          mode: this._mode,
          heuristicsOnly: true,
          explanation: {
            rootCause: diag.hasError ? `${diag.errorType}: ${diag.errorMessage}` : 'Runtime exception detected during execution.',
            architecturalImpact: `Exception at line ${diag.line || 1} halts execution pipeline.`,
            remediation: 'Synthesized defensive guard and numerical stability patch.',
          },
          testContract: AiAdvisor.generatePytestContract(patchedCode, { fileName: path.basename(this._currentFilePath) }),
        };
        this._lastProposal = proposal;
        this._panel.webview.postMessage({
          type: 'patchProposal',
          proposal,
        });
        vscode.window.showInformationMessage(`✓ Python AI Studio: Synthesized traceback fix for ${diag.errorType || 'RuntimeError'}.`);
        break;
      }

      case 'applyPatch': {
        const newCode = msg.code;
        if (!newCode) return;

        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.fileName === this._currentFilePath) {
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
          );
          await editor.edit((editBuilder) => {
            editBuilder.replace(fullRange, newCode);
          });
          this._currentCode = newCode;
          vscode.window.showInformationMessage('✓ Python AI Studio: Patch applied cleanly to active editor!');
        } else {
          // Open document if not active
          try {
            const doc = await vscode.workspace.openTextDocument(this._currentFilePath);
            const ed = await vscode.window.showTextDocument(doc);
            const fullRange = new vscode.Range(
              doc.positionAt(0),
              doc.positionAt(doc.getText().length)
            );
            await ed.edit((editBuilder) => {
              editBuilder.replace(fullRange, newCode);
            });
            this._currentCode = newCode;
            vscode.window.showInformationMessage('✓ Python AI Studio: Patch applied cleanly to document!');
          } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to apply patch: ${e?.message || e}`);
          }
        }
        this._lastProposal = null;
        this._postState();
        break;
      }

      case 'saveTestFile': {
        const testCode = msg.testCode || this._lastPytestContract;
        if (!testCode) {
          vscode.window.showWarningMessage('No PyTest code generated yet.');
          return;
        }

        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) {
          vscode.window.showErrorMessage('No workspace open to save test file.');
          return;
        }

        const testsDir = path.join(ws, 'tests');
        if (!fs.existsSync(testsDir)) {
          fs.mkdirSync(testsDir, { recursive: true });
        }

        const base = path.basename(this._currentFilePath, '.py') || 'solution';
        const targetFile = path.join(testsDir, `test_${base}.py`);
        fs.writeFileSync(targetFile, testCode, 'utf8');

        const doc = await vscode.workspace.openTextDocument(targetFile);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`✓ Saved PyTest contract to tests/test_${base}.py`);
        break;
      }

      case 'runSandbox': {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        PythonRuntime.runScriptInTerminal(ws, this._currentFilePath);
        break;
      }

      case 'scaffoldDocker': {
        vscode.commands.executeCommand('evolve.pythonStudio.scaffoldDockerfile');
        break;
      }

      case 'autoInstallPython': {
        vscode.commands.executeCommand('evolve.pythonStudio.autoInstallPython');
        break;
      }

      case 'installMissingPackages': {
        vscode.commands.executeCommand('evolve.pythonStudio.installMissingPackages');
        break;
      }

      case 'generateAirtightBundle': {
        vscode.commands.executeCommand('evolve.pythonStudio.generateAirtightBundle');
        break;
      }

      case 'installAirtightWheelhouse': {
        vscode.commands.executeCommand('evolve.pythonStudio.installAirtightWheelhouse');
        break;
      }

      case 'runSetupSelfTest': {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Running Python Setup Self-Test & Verification...',
            cancellable: false,
          },
          async () => {
            const testRes = PythonEnvironmentManager.runSetupSelfTest(ws);
            this._panel.webview.postMessage({
              type: 'selfTestResult',
              result: testRes,
            });
            if (testRes.passed) {
              vscode.window.showInformationMessage(`✓ Python Setup Verified: ${testRes.outputLog}`);
            } else {
              vscode.window.showWarningMessage(`⚠️ Python Setup Warning: ${testRes.outputLog}`);
            }
          }
        );
        break;
      }

      case 'refresh': {
        this._refreshCurrentDocument();
        break;
      }

      case 'getProjectOrientation': {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        try {
          const orientation = ProjectOrientationSynthesizer.synthesize(ws);
          this._panel.webview.postMessage({
            type: 'projectOrientationResult',
            orientation,
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to synthesize project orientation: ${err?.message || err}`);
        }
        break;
      }

      case 'runRunbookCommand': {
        const cmd = msg.command;
        if (cmd) {
          const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Evolve AI Runbook');
          terminal.show();
          terminal.sendText(cmd);
          vscode.window.showInformationMessage(`▶ Executed: ${cmd}`);
        }
        break;
      }

      case 'openRunbookFile': {
        const filePath = msg.path;
        if (filePath) {
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
          const target = path.isAbsolute(filePath) ? filePath : path.join(ws, filePath);
          if (fs.existsSync(target)) {
            vscode.workspace.openTextDocument(target).then(doc => vscode.window.showTextDocument(doc));
          } else {
            vscode.window.showWarningMessage(`File not found: ${filePath}`);
          }
        }
        break;
      }
    }
  }

  private _postState(): void {
    if (this._disposed) return;
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const envStatus = PythonEnvironmentManager.detectSystemPython(ws);
    const depHealth = PythonEnvironmentManager.inspectDependencies(ws);
    let orientation: any = null;
    try {
      orientation = ProjectOrientationSynthesizer.synthesize(ws);
    } catch {}

    this._panel.webview.postMessage({
      type: 'state',
      mode: this._mode,
      filePath: this._currentFilePath,
      fileName: path.basename(this._currentFilePath),
      code: this._currentCode,
      proposal: this._lastProposal,
      pytestContract: this._lastPytestContract,
      envStatus,
      depHealth,
      orientation,
    });
  }

  private _render(): void {
    if (this._disposed) return;
    this._panel.webview.html = this._html();
  }

  private _html(): string {
    const nonce = 'py' + Math.random().toString(36).substring(2, 10);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Python AI Studio & Neural Debugger</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --card-alt: var(--vscode-sideBar-background, #2a2d2e);
      --border: var(--vscode-widget-border, #3c3c3c);
      --accent: #4ec9b0;
      --dim: var(--vscode-descriptionForeground, #9d9d9d);
      --success: #4ec9b0;
      --warn: #cca700;
      --error: #f14c4c;
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      color: var(--fg);
      background: var(--bg);
      padding: 16px 20px 40px;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 14px;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge-icon {
      font-size: 20px;
    }
    .main-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--accent);
    }
    .file-pill {
      font-size: 11px;
      background: rgba(78, 201, 176, 0.15);
      color: var(--accent);
      padding: 3px 8px;
      border-radius: 12px;
      border: 1px solid rgba(78, 201, 176, 0.3);
      max-width: 320px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* 3-Mode Selector */
    .mode-group {
      display: flex;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .mode-btn {
      background: transparent;
      border: none;
      color: var(--dim);
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .mode-btn:hover {
      color: var(--fg);
    }
    .mode-btn.active {
      background: var(--accent);
      color: #1e1e1e;
    }

    /* Health Check Cards */
    .pills-bar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    .health-pill {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .health-pill:hover {
      border-color: var(--accent);
    }
    .pill-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--dim);
    }
    .pill-val {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Action Bar */
    .action-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
      padding: 10px 12px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    .btn {
      background: var(--card-alt);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 11px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .btn:hover {
      background: var(--border);
      border-color: var(--dim);
    }
    .btn-primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border-color: transparent;
      font-weight: 600;
    }
    .btn-primary:hover {
      opacity: 0.9;
    }
    .btn-success {
      background: #238636;
      color: #ffffff;
      border-color: transparent;
      font-weight: 600;
    }
    .btn-success:hover {
      background: #2ea043;
    }
    .btn-danger {
      background: rgba(241, 76, 76, 0.15);
      color: var(--error);
      border-color: rgba(241, 76, 76, 0.3);
    }
    .btn-danger:hover {
      background: rgba(241, 76, 76, 0.25);
    }

    /* Diagnostics Banner */
    .diag-card {
      background: var(--card-bg);
      border-left: 4px solid var(--accent);
      border: 1px solid var(--border);
      border-left-width: 4px;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 14px;
      display: none;
    }
    .diag-title {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .diag-bullet {
      margin-bottom: 6px;
      font-size: 12px;
      line-height: 1.4;
    }
    .diag-bullet strong {
      color: var(--accent);
    }

    /* Side-by-Side Review Workspace */
    .review-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .pane-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      height: 400px;
    }
    .pane-header {
      padding: 8px 12px;
      background: var(--card-alt);
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--dim);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .code-editor {
      flex: 1;
      width: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--fg);
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 12px;
      padding: 10px;
      border: none;
      resize: none;
      outline: none;
      line-height: 1.4;
      white-space: pre;
    }
    .code-preview {
      flex: 1;
      padding: 10px;
      background: var(--bg);
      color: var(--fg);
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 12px;
      overflow: auto;
      white-space: pre;
      line-height: 1.4;
    }

    /* Review Action Bar */
    .review-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 16px;
    }
    .diff-stats {
      font-size: 12px;
      color: var(--dim);
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .stat-add { color: var(--success); font-weight: 600; }
    .stat-del { color: var(--error); font-weight: 600; }
    .confidence-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: rgba(78, 201, 176, 0.15);
      color: var(--accent);
      border: 1px solid rgba(78, 201, 176, 0.3);
    }

    /* PyTest Contract Drawer */
    .pytest-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
    }
    .pytest-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-weight: 600;
      color: var(--accent);
    }
    .pytest-code {
      max-height: 180px;
      overflow: auto;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11px;
      white-space: pre;
    }

    /* Log Box */
    .log-box {
      font-family: 'Consolas', monospace;
      font-size: 11px;
      background: #111;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px 12px;
      max-height: 120px;
      overflow-y: auto;
      color: #9cdcfe;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="title-group">
      <span class="badge-icon">🐍</span>
      <div>
        <div class="main-title">Python AI Studio & Neural Debugger</div>
        <div style="font-size: 11px; color: var(--dim);">Dual-Track Engineering • 100% Offline Capable • Editable Review</div>
      </div>
      <span class="file-pill" id="filePill">Loading file...</span>
    </div>

    <!-- Mode Selector -->
    <div class="mode-group">
      <button class="mode-btn active" id="btnModeManual" onclick="setMode('manual')" title="100% Offline deterministic checks, zero AI calls">⚡ Pure Manual</button>
      <button class="mode-btn" id="btnModeOnDemand" onclick="setMode('on-demand')" title="Click-to-ask AI diagnostics and proposed patches">🤖 On-Demand AI</button>
      <button class="mode-btn" id="btnModeContinuous" onclick="setMode('continuous')" title="Continuous background hint suggestions">🔄 Continuous</button>
    </div>
  </div>

  <!-- Python Runtime & Environment Doctor Bar -->
  <div style="background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
      <span style="font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dim);">Environment Doctor:</span>
      <span class="confidence-badge" id="pillEnvPython">🐍 Python: Probing...</span>
      <span class="confidence-badge" id="pillEnvDeps">📦 Packages: Probing...</span>
      <span class="confidence-badge" id="pillEnvNet">🌐 Network: Probing...</span>
    </div>
    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
      <button class="btn btn-danger" id="btnAutoInstallPy" style="display: none;" onclick="autoInstallPython()">⚡ 1-Click Install Python</button>
      <button class="btn btn-warning" id="btnAutoInstallDeps" style="display: none;" onclick="installMissingPackages()">📦 Install Missing Packages</button>
      <button class="btn" onclick="generateAirtightBundle()" title="Generate offline wheelhouse download script & manifest">🔒 Air-Gapped Bundle</button>
      <button class="btn" onclick="installAirtightWheelhouse()" title="Install from local ./wheels directory without internet">📥 Offline Wheelhouse</button>
      <button class="btn btn-primary" onclick="runSetupSelfTest()" title="Run automated verification self-test & math smoke test">🧪 Test Setup &amp; Certify</button>
    </div>
  </div>

  <!-- Self-Test Certification Card (Hidden until tested) -->
  <div class="diag-card" id="selfTestCard" style="border-left-color: #4ec9b0; margin-bottom: 14px; display: none;">
    <div class="diag-title">
      <span>🧪 Python Setup Certification Report</span>
      <span class="confidence-badge" id="selfTestBadge" style="background: rgba(78,201,176,0.2);">Passed</span>
    </div>
    <div class="diag-bullet"><strong>🐍 Runtime:</strong> <span id="selfTestRuntime">-</span></div>
    <div class="diag-bullet"><strong>📦 Verified Modules:</strong> <span id="selfTestModules">-</span></div>
    <div class="diag-bullet"><strong>⏱️ Execution Latency:</strong> <span id="selfTestLatency">-</span></div>
    <div style="margin-top: 6px; font-size: 11px; opacity: 0.85;" id="selfTestDetails"></div>
  </div>

  <!-- 4 Health Pills -->
  <div class="pills-bar">
    <div class="health-pill" onclick="runOfflineScan()">
      <span class="pill-label">Syntax & AST</span>
      <span class="pill-val" id="pillSyntax">✓ Ready</span>
    </div>
    <div class="health-pill" onclick="runTensorScan()">
      <span class="pill-label">Tensor Topology</span>
      <span class="pill-val" id="pillTensor">🧠 Inspect</span>
    </div>
    <div class="health-pill" onclick="runDataFrameSniff()">
      <span class="pill-label">DataFrame Perf</span>
      <span class="pill-val" id="pillDataFrame">🐼 Sniff</span>
    </div>
    <div class="health-pill" onclick="runGitCheck()">
      <span class="pill-label">Git Pre-Commit</span>
      <span class="pill-val" id="pillGit">🛡️ Check</span>
    </div>
  </div>

  <!-- Action Bar -->
  <div class="action-bar">
    <button class="btn btn-primary" onclick="toggleOrientationDrawer()" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border-color: rgba(56, 189, 248, 0.45); font-weight: 700;">🧭 Project Orientation &amp; Runbook</button>
    <button class="btn" onclick="runOfflineScan()">⚡ Verify Syntax (Zero-AI)</button>
    <button class="btn" onclick="formatCode()">🧹 Format Code (Black/Ruff)</button>
    <button class="btn" onclick="organizeImports()">📦 Organize Imports (isort)</button>
    <button class="btn" onclick="runTensorScan()">🧠 Trace Tensor Shapes</button>
    <button class="btn" onclick="runDataFrameSniff()">🐼 Sniff DataFrames</button>
    <button class="btn" onclick="runGitCheck()">🛡️ Audit Git Leaks</button>
    <button class="btn" onclick="generatePytest()">🧪 Generate PyTest Spec</button>
    <button class="btn btn-primary" onclick="askAiAdvisor()">🤖 Propose Fix / Patch</button>
    <button class="btn" onclick="autoFixTracebackPrompt()">✨ Auto-Fix Traceback</button>
    <button class="btn" onclick="runSandbox()">▶ Run in Sandbox</button>
    <button class="btn" onclick="scaffoldDocker()">🐳 Scaffold Dockerfile</button>
    <button class="btn" onclick="refreshDocument()">🔄 Sync Editor</button>
  </div>

  <!-- Project Orientation & Runbook Drawer -->
  <div id="orientationDrawer" style="display: none; background: var(--card-bg); border: 1.5px solid rgba(56, 189, 248, 0.45); border-radius: 8px; padding: 14px; margin-bottom: 16px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-weight: 700; color: #38bdf8; font-size: 13.5px;">🧭 Project Orientation &amp; 1-Click Runbook</span>
        <span id="drawerDomainBadge" class="confidence-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">Loading...</span>
      </div>
      <button class="btn" onclick="toggleOrientationDrawer()" style="padding: 2px 8px; font-size: 11px;">✕ Close</button>
    </div>
    <div id="drawerSummaryText" style="font-size: 12px; color: var(--dim); margin-bottom: 12px; line-height: 1.4;"></div>
    <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; color: var(--fg);">⚡ 1-Click Runbook Commands:</div>
    <div id="drawerRunbookList" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;"></div>
    <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; color: var(--fg);">📂 Discovered Key Entrypoints &amp; Files:</div>
    <div id="drawerKeyFilesList" style="display: flex; flex-wrap: wrap; gap: 6px;"></div>
  </div>

  <!-- 3-Bullet Diagnostics Card -->
  <div class="diag-card" id="diagCard">
    <div class="diag-title">
      <span id="diagHeader">📋 Diagnostic Summary</span>
      <span class="confidence-badge" id="diagConfidence">95% Confidence</span>
    </div>
    <div class="diag-bullet"><strong>🔴 Root Cause:</strong> <span id="diagRootCause">-</span></div>
    <div class="diag-bullet"><strong>⚠️ Architectural Impact:</strong> <span id="diagImpact">-</span></div>
    <div class="diag-bullet"><strong>💡 Remediation:</strong> <span id="diagRemediation">-</span></div>
  </div>

  <!-- Side-by-Side Editable Review Workspace -->
  <div class="review-container">
    <!-- Left: Original Editor Source -->
    <div class="pane-box">
      <div class="pane-header">
        <span>Original Source (Active Editor)</span>
        <span style="font-size: 10px; color: var(--dim);" id="origLineCount">- lines</span>
      </div>
      <div class="code-preview" id="origCodeView"># Loading source code...</div>
    </div>

    <!-- Right: Proposed Patch (Editable) -->
    <div class="pane-box">
      <div class="pane-header">
        <span style="color: var(--accent);">Proposed Patch (Editable Before Accept)</span>
        <span style="font-size: 10px; color: var(--dim);" id="proposedLineCount">- lines</span>
      </div>
      <textarea class="code-editor" id="proposedCodeText" spellcheck="false" placeholder="# Click 'Propose Fix' or edit proposed Python code directly here..."></textarea>
    </div>
  </div>

  <!-- Review Action Footer -->
  <div class="review-actions">
    <div class="diff-stats">
      <span id="diffStatus">Zero pending patches</span>
      <span class="stat-add" id="statAdd"></span>
      <span class="stat-del" id="statDel"></span>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" onclick="recheckProposedCode()">⚡ Re-run Offline AST Check</button>
      <button class="btn btn-danger" onclick="discardPatch()">✕ Discard</button>
      <button class="btn btn-success" id="btnAccept" onclick="applyPatch()">✓ Accept & Apply to Editor</button>
    </div>
  </div>

  <!-- PyTest Verification Suite Box -->
  <div class="pytest-box" id="pytestBox" style="display: none;">
    <div class="pytest-header">
      <span>🧪 PyTest Verification Spec</span>
      <button class="btn btn-primary" onclick="saveTestFile()">💾 Save as test_*.py</button>
    </div>
    <div class="pytest-code" id="pytestCodeView"># No test spec generated yet.</div>
  </div>

  <!-- Studio Log -->
  <div class="log-box" id="logBox">
    [Python AI Studio] Initialized. 100% offline deterministic verification active.
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentMode = 'manual';
    let activeFilePath = '';
    let originalCode = '';

    function log(msg) {
      const b = document.getElementById('logBox');
      b.innerHTML += '<br>' + msg;
      b.scrollTop = b.scrollHeight;
    }

    function setMode(mode) {
      currentMode = mode;
      document.getElementById('btnModeManual').classList.toggle('active', mode === 'manual');
      document.getElementById('btnModeOnDemand').classList.toggle('active', mode === 'on-demand');
      document.getElementById('btnModeContinuous').classList.toggle('active', mode === 'continuous');
      vscode.postMessage({ type: 'setMode', mode });
      log('[Mode] Switched to ' + mode.toUpperCase());
    }

    function runOfflineScan() {
      vscode.postMessage({ type: 'runOfflineScan', code: originalCode });
      log('[AST Scan] Running zero-AI syntax and bracket verification...');
    }

    function formatCode() {
      vscode.postMessage({ type: 'formatCode', code: originalCode });
      log('[Formatter] Normalizing Python code (Black / Ruff PEP 8 rules)...');
    }

    function organizeImports() {
      vscode.postMessage({ type: 'organizeImports', code: originalCode });
      log('[Imports] Organizing imports into stdlib, third-party, and local blocks...');
    }

    function autoFixTracebackPrompt() {
      const tb = prompt('Paste Python traceback / error output to auto-diagnose & repair:');
      if (tb) {
        vscode.postMessage({ type: 'autoFixTraceback', code: originalCode, traceback: tb });
        log('[Traceback Auto-Fix] Synthesizing diagnostic patch for exception...');
      }
    }

    function runTensorScan() {
      vscode.postMessage({ type: 'runTensorScan', code: originalCode });
      log('[Tensor Scan] Inferring layer dimensions and checking NaN instability...');
    }

    function runDataFrameSniff() {
      vscode.postMessage({ type: 'runDataFrameSniff', code: originalCode });
      log('[DataFrame Sniff] Checking for iterrows bottlenecks and SettingWithCopy...');
    }

    function runGitCheck() {
      vscode.postMessage({ type: 'runGitCheck' });
      log('[Git Check] Auditing for weight leaks (>50MB) and .venv commits...');
    }

    function askAiAdvisor() {
      vscode.postMessage({ type: 'askAiAdvisor', code: originalCode });
      log('[AI Advisor] Generating remediation patch and 3-bullet explanation...');
    }

    function generatePytest() {
      vscode.postMessage({ type: 'generatePytest', code: originalCode });
      log('[PyTest] Generating contract test suite...');
    }

    function applyPatch() {
      const code = document.getElementById('proposedCodeText').value;
      if (!code) return;
      vscode.postMessage({ type: 'applyPatch', code });
      log('[Patch] Applied to active editor.');
    }

    function discardPatch() {
      document.getElementById('proposedCodeText').value = '';
      document.getElementById('diagCard').style.display = 'none';
      document.getElementById('diffStatus').innerText = 'Zero pending patches';
      document.getElementById('statAdd').innerText = '';
      document.getElementById('statDel').innerText = '';
      log('[Patch] Discarded proposal.');
    }

    function recheckProposedCode() {
      const code = document.getElementById('proposedCodeText').value;
      if (!code) return;
      vscode.postMessage({ type: 'runOfflineScan', code });
      log('[AST Scan] Verifying modified proposal offline...');
    }

    function saveTestFile() {
      const testCode = document.getElementById('pytestCodeView').innerText;
      vscode.postMessage({ type: 'saveTestFile', testCode });
    }

    function runSandbox() {
      vscode.postMessage({ type: 'runSandbox' });
    }

    function scaffoldDocker() {
      vscode.postMessage({ type: 'scaffoldDocker' });
    }

    function refreshDocument() {
      vscode.postMessage({ type: 'refresh' });
    }

    function autoInstallPython() {
      vscode.postMessage({ type: 'autoInstallPython' });
      log('[Environment] Initiating 1-Click Python 3.12 installation...');
    }

    function installMissingPackages() {
      vscode.postMessage({ type: 'installMissingPackages' });
      log('[Packages] Initiating 1-Click install for missing Python dependencies...');
    }

    function generateAirtightBundle() {
      vscode.postMessage({ type: 'generateAirtightBundle' });
      log('[Airtight] Generating offline package bundle and fetch script...');
    }

    function installAirtightWheelhouse() {
      vscode.postMessage({ type: 'installAirtightWheelhouse' });
      log('[Airtight] Installing from local wheelhouse in air-gapped mode...');
    }

    function runSetupSelfTest() {
      vscode.postMessage({ type: 'runSetupSelfTest' });
      log('[Self-Test] Running end-to-end Python environment & smoke test...');
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'state': {
          activeFilePath = msg.filePath;
          originalCode = msg.code;
          document.getElementById('filePill').innerText = msg.fileName || 'script.py';
          document.getElementById('origCodeView').innerText = msg.code || '';
          document.getElementById('origLineCount').innerText = (msg.code ? msg.code.split('\\n').length : 0) + ' lines';

          if (msg.envStatus) {
            const pyPill = document.getElementById('pillEnvPython');
            const netPill = document.getElementById('pillEnvNet');
            const btnPy = document.getElementById('btnAutoInstallPy');

            if (msg.envStatus.isInstalled) {
              pyPill.innerText = '🐍 Python: ' + (msg.envStatus.version || 'Ready');
              pyPill.style.color = 'var(--success)';
              btnPy.style.display = 'none';
            } else {
              pyPill.innerText = '⚠️ Python: Missing on Machine';
              pyPill.style.color = 'var(--error)';
              btnPy.style.display = 'inline-flex';
            }

            if (msg.envStatus.hasInternet) {
              netPill.innerText = '🌐 Online';
              netPill.style.color = 'var(--accent)';
            } else {
              netPill.innerText = '🔒 Air-Gapped (Zero Internet)';
              netPill.style.color = 'var(--warn)';
            }
          }

          if (msg.depHealth) {
            const depPill = document.getElementById('pillEnvDeps');
            const btnDeps = document.getElementById('btnAutoInstallDeps');

            if (msg.depHealth.allReady) {
              depPill.innerText = '📦 ' + msg.depHealth.installedCount + ' Packages Ready';
              depPill.style.color = 'var(--success)';
              btnDeps.style.display = 'none';
            } else {
              depPill.innerText = '⚠️ ' + msg.depHealth.missingCount + ' Missing Packages';
              depPill.style.color = 'var(--warn)';
              btnDeps.style.display = 'inline-flex';
            }
          }

          if (msg.proposal) {
            renderProposal(msg.proposal);
          }
          if (msg.pytestContract) {
            renderPytest(msg.pytestContract);
          }
          if (msg.orientation) {
            renderOrientationDrawer(msg.orientation);
          }
          break;
        }

        case 'projectOrientationResult': {
          renderOrientationDrawer(msg.orientation);
          break;
        }

        case 'selfTestResult': {
          const card = document.getElementById('selfTestCard');
          const res = msg.result;
          card.style.display = 'block';
          document.getElementById('selfTestBadge').innerText = res.passed ? '✓ PASSED' : '⚠️ WARNING';
          document.getElementById('selfTestBadge').style.color = res.passed ? 'var(--success)' : 'var(--error)';
          document.getElementById('selfTestRuntime').innerText = res.pythonVersion + ' (' + res.interpreterPath + ')';
          const okCount = res.testedImports.filter(i => i.ok).length;
          document.getElementById('selfTestModules').innerText = okCount + '/' + res.testedImports.length + ' Functional';
          document.getElementById('selfTestLatency').innerText = res.durationMs + 'ms';
          document.getElementById('selfTestDetails').innerText = res.outputLog;
          log('🧪 [Self-Test Result] ' + res.outputLog);
          break;
        }

        case 'scanResults': {
          handleScanResults(msg.category, msg.result);
          break;
        }

        case 'patchProposal': {
          renderProposal(msg.proposal);
          break;
        }

        case 'pytestContract': {
          renderPytest(msg.contract);
          break;
        }

        case 'codeFormatted': {
          document.getElementById('proposedCodeText').value = msg.formatted;
          document.getElementById('proposedLineCount').innerText = msg.formatted.split('\n').length + ' lines';
          document.getElementById('diffStatus').innerText = 'Formatted code ready to review:';
          log('🧹 [Formatter] Code normalized (4-space indent, quotes, operator spacing). Click "Accept & Apply to Editor".');
          break;
        }

        case 'importsOrganized': {
          document.getElementById('proposedCodeText').value = msg.organized;
          document.getElementById('proposedLineCount').innerText = msg.organized.split('\n').length + ' lines';
          document.getElementById('diffStatus').innerText = 'Organized imports (' + msg.importCount + ' total):';
          log('📦 [isort] Partitioned imports into stdlib (' + msg.stdlibCount + '), third-party (' + msg.thirdPartyCount + '), and local (' + msg.localCount + '). Click "Accept & Apply to Editor".');
          break;
        }
      }
    });

    function handleScanResults(category, res) {
      if (category === 'syntax') {
        const pill = document.getElementById('pillSyntax');
        if (res.syntaxValid && res.warningCount === 0) {
          pill.innerText = '✓ Valid';
          pill.style.color = 'var(--success)';
          log('✓ [Syntax] Perfectly valid. Indentation and brackets balanced.');
        } else {
          pill.innerText = '⚠️ ' + res.errorCount + ' err, ' + res.warningCount + ' warn';
          pill.style.color = res.errorCount > 0 ? 'var(--error)' : 'var(--warn)';
          const errs = res.diagnostics.map(d => '• L' + d.line + ': ' + d.message).join('<br>');
          log('⚠️ [Syntax Issues]<br>' + errs);
        }
      } else if (category === 'tensor') {
        const pill = document.getElementById('pillTensor');
        if (res.anomalies.length === 0) {
          pill.innerText = '✓ Clean (' + res.layers.length + ' layers)';
          pill.style.color = 'var(--success)';
          log('✓ [Tensor Topology] Flow verified: ' + res.shapeFlowSummary.join(' ➔ '));
        } else {
          pill.innerText = '⚠️ ' + res.anomalies.length + ' hazards';
          pill.style.color = 'var(--error)';
          const hazards = res.anomalies.map(a => '• L' + a.line + ': [' + a.code + '] ' + a.message).join('<br>');
          log('⚠️ [Tensor Hazards]<br>' + hazards);
        }
      } else if (category === 'dataframe') {
        const pill = document.getElementById('pillDataFrame');
        if (res.anomalies.length === 0) {
          pill.innerText = '✓ Clean';
          pill.style.color = 'var(--success)';
          log('✓ [DataFrame] Zero Cartesian merge risks or slow iterrows loops detected.');
        } else {
          pill.innerText = '⚠️ ' + res.anomalies.length + ' warnings';
          pill.style.color = 'var(--warn)';
          const warns = res.anomalies.map(w => '• L' + w.line + ': [' + w.code + '] ' + w.message).join('<br>');
          log('⚠️ [DataFrame Bottlenecks]<br>' + warns);
        }
      } else if (category === 'git') {
        const pill = document.getElementById('pillGit');
        if (res.violations.length === 0) {
          pill.innerText = '✓ Clean';
          pill.style.color = 'var(--success)';
          log('✓ [Git Hygiene] No unignored .venv or large weight files (>50MB).');
        } else {
          pill.innerText = '⚠️ ' + res.violations.length + ' leaks';
          pill.style.color = 'var(--error)';
          const leaks = res.violations.map(v => '• [' + v.severity.toUpperCase() + '] ' + v.message).join('<br>');
          log('⚠️ [Git Violations]<br>' + leaks);
        }
      }
    }

    function renderProposal(proposal) {
      if (!proposal) return;
      document.getElementById('proposedCodeText').value = proposal.proposedCode;
      document.getElementById('proposedLineCount').innerText = proposal.proposedCode.split('\\n').length + ' lines';

      // Show 3-bullet diagnostics card
      const card = document.getElementById('diagCard');
      card.style.display = 'block';
      document.getElementById('diagRootCause').innerText = proposal.explanation.rootCause;
      document.getElementById('diagImpact').innerText = proposal.explanation.architecturalImpact;
      document.getElementById('diagRemediation').innerText = proposal.explanation.remediation;
      document.getElementById('diagConfidence').innerText = Math.round(proposal.confidence * 100) + '% Confidence';

      // Diff stats
      const adds = proposal.diffHunks.filter(h => h.type === 'add').length;
      const dels = proposal.diffHunks.filter(h => h.type === 'del').length;
      document.getElementById('diffStatus').innerText = 'Patch proposal ready:';
      document.getElementById('statAdd').innerText = '+' + adds + ' lines';
      document.getElementById('statDel').innerText = '-' + dels + ' lines';

      if (proposal.testContract) {
        renderPytest(proposal.testContract);
      }

      log('✓ [Patch Ready] Review proposed code in the right-hand editor before applying.');
    }

    function renderPytest(contract) {
      if (!contract) return;
      document.getElementById('pytestBox').style.display = 'block';
      document.getElementById('pytestCodeView').innerText = contract;
      log('✓ [PyTest Contract] Generated verification suite.');
    }

    let currentOrientation = null;
    function toggleOrientationDrawer() {
      const drawer = document.getElementById('orientationDrawer');
      if (!drawer) return;
      const isVisible = drawer.style.display !== 'none';
      drawer.style.display = isVisible ? 'none' : 'block';
      if (!isVisible && !currentOrientation) {
        vscode.postMessage({ type: 'getProjectOrientation' });
      }
    }

    function renderOrientationDrawer(orientation) {
      if (!orientation) return;
      currentOrientation = orientation;
      const badge = document.getElementById('drawerDomainBadge');
      if (badge) badge.innerText = (orientation.domainName || 'App') + ' · ' + (orientation.framework || 'Python');
      const sum = document.getElementById('drawerSummaryText');
      if (sum) sum.innerText = orientation.codebaseExplanation?.executiveSummary || orientation.projectDescription || '';

      const runList = document.getElementById('drawerRunbookList');
      if (runList) {
        const cmds = orientation.runbook || [];
        runList.innerHTML = cmds.map(function(c) {
          const safeCmd = (c.command || '').replace(/'/g, "\\'");
          return '<div style="display: flex; align-items: center; justify-content: space-between; background: var(--card-alt); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px;">' +
            '<div style="min-width: 0; flex: 1;">' +
              '<span style="font-weight: 600; font-size: 11px; color: var(--fg);">' + (c.label || '') + '</span>' +
              '<span style="color: var(--dim); font-size: 10.5px; margin-left: 6px;">' + (c.explanation || '') + '</span>' +
              '<div style="font-family: monospace; font-size: 11px; color: #38bdf8; margin-top: 2px;"><code>' + (c.command || '') + '</code></div>' +
            '</div>' +
            '<button class="btn btn-primary" onclick="runRunbookCommand(\'' + safeCmd + '\')" style="padding: 4px 10px; font-size: 10.5px; flex-shrink: 0; margin-left: 10px;">▶ Run in Terminal</button>' +
          '</div>';
        }).join('');
      }

      const filesList = document.getElementById('drawerKeyFilesList');
      if (filesList) {
        const files = orientation.keyFiles || [];
        filesList.innerHTML = files.map(function(f) {
          const safePath = (f.path || '').replace(/'/g, "\\'");
          const safeDesc = (f.description || '').replace(/"/g, '&quot;');
          return '<button class="btn" onclick="openRunbookFile(\'' + safePath + '\')" title="' + safeDesc + '" style="font-size: 11px;">' +
            '📄 ' + (f.path || '') +
          '</button>';
        }).join('');
      }
    }

    function runRunbookCommand(cmd) {
      vscode.postMessage({ type: 'runRunbookCommand', command: cmd });
    }

    function openRunbookFile(p) {
      vscode.postMessage({ type: 'openRunbookFile', path: p });
    }

    // Initial load request
    vscode.postMessage({ type: 'getInitialState' });
  </script>
</body>
</html>`;
  }
}
