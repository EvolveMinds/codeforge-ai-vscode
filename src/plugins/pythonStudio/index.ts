/**
 * plugins/pythonStudio/index.ts — Python AI Studio & Neural Debugger Plugin
 *
 * Provides comprehensive Python engineering support for Forward-Deployed Engineers:
 *  - Greenfield & Brownfield project topology and framework detection
 *  - Isolated Python Sandbox execution with active Cloud Hub credential injection
 *  - Git Pre-Commit Hygiene & Model Weights leak protection
 *  - Multi-stage hardened Dockerfile scaffolding for cloud delivery
 *  - Offline deterministic checks and on-demand AI guidance
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import type {
  IPlugin,
  PluginContextHook,
  PluginCodeLensAction,
  PluginStatusItem,
  PluginCommand,
} from '../../core/plugin';
import type { IServices } from '../../core/services';
import { PythonDetector, type PythonProjectTopology } from './pythonDetector';
import { PythonRuntime } from './pythonRuntime';
import { GitIntegrationHook } from './gitIntegrationHook';
import { CloudDeployHook } from './cloudDeployHook';
import { DeterministicAnalyzer } from './deterministicAnalyzer';
import { TensorShapeEngine } from './tensorShapeEngine';
import { DataFrameSniffer } from './dataFrameSniffer';
import { PythonEnvironmentManager } from './pythonEnvironmentManager';

export class PythonStudioPlugin implements IPlugin {
  readonly id = 'pythonStudio';
  readonly displayName = 'Python AI Studio & Neural Debugger';
  readonly icon = '🐍';
  readonly description = 'Python 3.12 1-click auto-install, package auto-sync, airtight wheelhouse, PyTorch tensor shape tracing & neural debugger.';

  private _cachedTopology?: PythonProjectTopology;

  async detect(ws: vscode.WorkspaceFolder | undefined): Promise<boolean> {
    return PythonDetector.hasPythonFootprint(ws);
  }

  async activate(services: IServices, context: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
    const disposables: vscode.Disposable[] = [];
    const ws = vscode.workspace.workspaceFolders?.[0];

    // Initial background topology inspection
    if (ws) {
      PythonDetector.analyzeWorkspace(ws).then(top => {
        this._cachedTopology = top;
      }).catch(() => {});
    }

    console.log('[Evolve AI] Python AI Studio Plugin activated successfully.');
    return disposables;
  }

  async deactivate(): Promise<void> {
    this._cachedTopology = undefined;
  }

  // ── Context Hook ────────────────────────────────────────────────────────────

  contextHooks: PluginContextHook[] = [
    {
      key: 'pythonStudioTopology',
      collect: async (ws: vscode.WorkspaceFolder | undefined) => {
        return PythonDetector.analyzeWorkspace(ws);
      },
      format: (data: unknown) => {
        const top = data as PythonProjectTopology;
        if (!top) return '';
        const fwList: string[] = [];
        if (top.frameworks.hasPyTorch)     fwList.push('PyTorch');
        if (top.frameworks.hasJax)         fwList.push('JAX');
        if (top.frameworks.hasHuggingFace) fwList.push('HuggingFace');
        if (top.frameworks.hasLangChain)   fwList.push('LangChain');
        if (top.frameworks.hasPolars)      fwList.push('Polars');
        if (top.frameworks.hasPandas)      fwList.push('Pandas');
        if (top.frameworks.hasFastAPI)     fwList.push('FastAPI');
        if (top.frameworks.hasPySpark)     fwList.push('PySpark');

        return `\n=== PYTHON STUDIO ENVIRONMENT ===\n` +
          `Topology: ${top.topology.toUpperCase()}\n` +
          `Package Manager: ${top.packageManager}\n` +
          `Active Venv: ${top.activeVenvPath || 'None detected'}\n` +
          `Frameworks: ${fwList.join(', ') || 'Standard Python'}\n` +
          `Python Files: ${top.pythonFilesCount}\n` +
          `Sub-Projects: ${top.subProjects.join(', ') || 'Root'}\n`;
      },
    },
  ];

  // ── System Prompt Section ───────────────────────────────────────────────────

  systemPromptSection(): string {
    return `
=== PYTHON AI STUDIO & NEURAL DEBUGGING DIRECTIVES ===
You are an expert Python AI Systems Architect and Forward-Deployed Engineer.
When assisting with Python:
1. CODE-FIRST & MODERN SYNTAX:
   - Always use modern Python 3.12+ idioms, PEP 695 type parameters, and Pydantic v2 schemas where applicable.
   - For async functions, ensure strict error handling and cancellation support.
2. AI / ML INTEGRITY:
   - When generating or reviewing PyTorch/JAX code, explicitly annotate tensor shapes: \`# [Batch, SeqLen, HiddenDim]\`.
   - Protect against silent NaN/inf propagation in loss functions, softmax, and normalization layers.
   - For Pandas/Polars, favor vectorized operations or lazy evaluation (\`.lazy().collect()\`); warn against iterrows() and unindexed Cartesian joins.
3. GIT & CLOUD HYGIENE:
   - Remind users never to commit raw model weights (>50MB) or unignored \`.venv/\` to Git.
   - Recommend isolated containerization using multi-stage builds and non-root execution.
`;
  }

  // ── CodeLens Actions ────────────────────────────────────────────────────────

  codeLensActions: PluginCodeLensAction[] = [
    {
      title: '▶ Run in Python Sandbox',
      command: 'evolve.pythonStudio.runInSandbox',
      linePattern: /(if __name__ == ['"]__main__['"]:|^def main\(\):|^app = FastAPI)/,
      languages: ['python'],
      tooltip: 'Execute file in isolated terminal with active Cloud Hub credentials',
    },
    {
      title: '🔍 Trace Tensor Shapes & NaN Checks',
      command: 'evolve.pythonStudio.inspectTensorShapes',
      linePattern: /(class\s+[a-zA-Z0-9_]+\s*\((?:nn\.)?Module\)|def\s+forward\s*\(|self\.[a-zA-Z0-9_]+\s*=\s*(?:nn\.)?Linear|import\s+torch)/,
      languages: ['python'],
      tooltip: 'Infer layer dimension compatibility and audit for NaN/Inf instability hazards',
    },
    {
      title: '⚡ Profile DataFrame Memory & Perf',
      command: 'evolve.pythonStudio.sniffDataframe',
      linePattern: /(import\s+pandas|import\s+polars|pd\.merge|pd\.read_|pl\.read_|\.iterrows\(\))/,
      languages: ['python'],
      tooltip: 'Detect Cartesian join hazards, SettingWithCopy warnings, and iterrows bottlenecks',
    },
    {
      title: '✓ Verify Syntax (Offline / Zero-AI)',
      command: 'evolve.pythonStudio.verifySyntaxOffline',
      linePattern: /(^def\s+[a-zA-Z0-9_]+|^class\s+[a-zA-Z0-9_]+)/,
      languages: ['python'],
      tooltip: 'Run instant 100% offline bracket, indentation, and anti-pattern static checks',
    },
    {
      title: '🛡️ Scan Pre-Commit Leaks & Hygiene',
      command: 'evolve.pythonStudio.scanGitLeaks',
      linePattern: /(import torch|from transformers|import pandas|torch\.load|safetensors)/,
      languages: ['python'],
      tooltip: 'Audit repository for model weight leaks (>50MB) and unignored venvs',
    },
    {
      title: '🐳 Scaffold Cloud Dockerfile',
      command: 'evolve.pythonStudio.scaffoldDockerfile',
      linePattern: /(FastAPI\(|Flask\(__name__\)|uvicorn\.run)/,
      languages: ['python'],
      tooltip: 'Generate hardened multi-stage container configuration for Cloud Run / ECS',
    },
  ];

  // ── Status Item ─────────────────────────────────────────────────────────────

  statusItem: PluginStatusItem = {
    text: async () => {
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) return '🐍 Python Studio';
      const venvPath = path.join(ws.uri.fsPath, '.venv');
      const hasVenv = fs.existsSync(venvPath);
      return hasVenv ? '🐍 Python (.venv)' : '🐍 Python (No venv)';
    },
  };

  // ── Commands ────────────────────────────────────────────────────────────────

  commands: PluginCommand[] = [
    {
      id: 'evolve.pythonStudio.runInSandbox',
      title: 'Python Studio: Run in Sandbox Terminal',
      handler: async (services: IServices) => {
        const editor = vscode.window.activeTextEditor;
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        if (!editor || !editor.document.fileName.endsWith('.py')) {
          vscode.window.showWarningMessage('Evolve AI: Please open a Python file to run in the sandbox.');
          return;
        }
        await editor.document.save();
        PythonRuntime.runScriptInTerminal(ws, editor.document.fileName);
      },
    },
    {
      id: 'evolve.pythonStudio.provisionVenv',
      title: 'Python Studio: 1-Click Provision Virtual Environment (uv)',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        PythonRuntime.provisionVenvCommand(ws);
      },
    },
    {
      id: 'evolve.pythonStudio.scanGitLeaks',
      title: 'Python Studio: Audit Git Pre-Commit Hygiene & Weight Leaks',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const status = GitIntegrationHook.scanWorkspaceHygiene(ws);

        if (status.violations.length === 0) {
          vscode.window.showInformationMessage('✓ Python Git Hygiene: Clean! No model weight leaks, unignored venvs, or exposed credentials found.');
          return;
        }

        const msgList = status.violations.map(v => `• [${v.severity.toUpperCase()}] ${v.message} (${v.filePath})`).join('\n');
        const fixChoice = await vscode.window.showWarningMessage(
          `Evolve AI: Found ${status.violations.length} pre-commit warnings:\n${msgList}`,
          'Fix .gitignore Automatically',
          'Dismiss'
        );

        if (fixChoice === 'Fix .gitignore Automatically') {
          const applied = GitIntegrationHook.ensurePythonGitignore(ws);
          if (applied) {
            vscode.window.showInformationMessage('✓ Successfully updated .gitignore with Python AI rules.');
          } else {
            vscode.window.showInformationMessage('.gitignore is already up to date.');
          }
        }
      },
    },
    {
      id: 'evolve.pythonStudio.scaffoldDockerfile',
      title: 'Python Studio: Scaffold Production Multi-Stage Dockerfile',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) {
          vscode.window.showErrorMessage('Evolve AI: Open a workspace folder first.');
          return;
        }

        const dockerfilePath = path.join(ws, 'Dockerfile');
        if (fs.existsSync(dockerfilePath)) {
          const overwrite = await vscode.window.showWarningMessage('Dockerfile already exists. Overwrite with hardened Python template?', 'Overwrite', 'Cancel');
          if (overwrite !== 'Overwrite') return;
        }

        const serviceName = path.basename(ws) || 'python-service';
        const content = CloudDeployHook.generateHardenedDockerfile(serviceName);
        fs.writeFileSync(dockerfilePath, content, 'utf8');

        const doc = await vscode.workspace.openTextDocument(dockerfilePath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage('✓ Scaffolding complete: Created hardened multi-stage Dockerfile for Python.');
      },
    },
    {
      id: 'evolve.pythonStudio.inspectTopology',
      title: 'Python Studio: Show Greenfield / Brownfield Inspection Report',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0];
        const top = await PythonDetector.analyzeWorkspace(ws);
        const fw = Object.entries(top.frameworks).filter(([_, v]) => v).map(([k]) => k.replace('has', '')).join(', ') || 'Standard';

        vscode.window.showInformationMessage(
          `Python Studio Topology:\n` +
          `• Mode: ${top.topology.toUpperCase()}\n` +
          `• Package Manager: ${top.packageManager}\n` +
          `• Python Files: ${top.pythonFilesCount}\n` +
          `• Sub-projects: ${top.subProjects.length}\n` +
          `• Stacks: ${fw}`
        );
      },
    },
    {
      id: 'evolve.pythonStudio.verifySyntaxOffline',
      title: 'Python Studio: Verify Syntax & Anti-Patterns (Offline / Zero-AI)',
      handler: async (services: IServices) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.py')) {
          vscode.window.showWarningMessage('Evolve AI: Please open a Python file to check.');
          return;
        }
        const summary = DeterministicAnalyzer.analyzeCode(editor.document.getText());
        if (summary.syntaxValid && summary.warningCount === 0) {
          vscode.window.showInformationMessage('✓ Python Studio: Syntax valid! Clean indentation, balanced brackets, and zero anti-patterns detected.');
          return;
        }
        const issues = summary.diagnostics.slice(0, 5).map(d => `• L${d.line}: [${d.code}] ${d.message}`).join('\n');
        vscode.window.showWarningMessage(
          `Python Studio: Found ${summary.errorCount} error(s), ${summary.warningCount} warning(s):\n${issues}`
        );
      },
    },
    {
      id: 'evolve.pythonStudio.inspectTensorShapes',
      title: 'Python Studio: Inspect PyTorch/JAX Tensor Shapes & NaN Checks',
      handler: async (services: IServices) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.py')) {
          vscode.window.showWarningMessage('Evolve AI: Please open a Python file to inspect tensor shapes.');
          return;
        }
        const report = TensorShapeEngine.analyzeTensorCode(editor.document.getText());
        if (report.anomalies.length === 0 && report.layers.length > 0) {
          const flow = report.shapeFlowSummary.join(' ➔ ');
          vscode.window.showInformationMessage(`✓ Tensor Flow Verified:\n${flow}\nZero numerical instability hazards detected.`);
          return;
        }
        if (report.anomalies.length > 0) {
          const anomList = report.anomalies.map(a => `• L${a.line}: [${a.code}] ${a.message}`).join('\n');
          vscode.window.showWarningMessage(`Tensor Dimension / Numerical Hazards:\n${anomList}`);
          return;
        }
        vscode.window.showInformationMessage('No PyTorch/JAX neural layers found in active file.');
      },
    },
    {
      id: 'evolve.pythonStudio.sniffDataframe',
      title: 'Python Studio: Profile Pandas/Polars DataFrame Pipeline',
      handler: async (services: IServices) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.py')) {
          vscode.window.showWarningMessage('Evolve AI: Please open a Python file to profile DataFrame code.');
          return;
        }
        const report = DataFrameSniffer.sniffDataCode(editor.document.getText());
        if (report.anomalies.length === 0) {
          vscode.window.showInformationMessage('✓ DataFrame Pipeline Clean: Zero Cartesian join risks or slow iterrows loops detected.');
          return;
        }
        const anomList = report.anomalies.map(a => `• L${a.line}: [${a.code}] ${a.message}`).join('\n');
        vscode.window.showWarningMessage(`DataFrame Optimization Warnings:\n${anomList}`);
      },
    },
    {
      id: 'evolve.pythonStudio.openWorkspace',
      title: 'Python Studio: Open Interactive AI & Neural Debugger Workspace',
      handler: async (services: IServices) => {
        const { PythonStudioPanel } = await import('../../ui/pythonStudioPanel');
        PythonStudioPanel.show(services);
      },
    },
    {
      id: 'evolve.pythonStudio.autoInstallPython',
      title: 'Python Studio: 1-Click Auto Install Python (3.12)',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const status = PythonEnvironmentManager.detectSystemPython(ws);

        if (status.isInstalled) {
          vscode.window.showInformationMessage(`✓ Python already detected on system: ${status.version} (${status.binaryPath})`);
          return;
        }

        const plan = PythonEnvironmentManager.getAutoInstallCommand('3.12');
        const term = PythonRuntime.getOrCreateSandboxTerminal(ws);
        term.show();
        term.sendText(`Write-Host "🚀 Evolve AI: Initiating 1-Click Python 3.12 Setup..." -ForegroundColor Cyan`);
        term.sendText(`Write-Host "Action: ${plan.explanation}" -ForegroundColor Yellow`);
        term.sendText(plan.command);

        // Notify user
        vscode.window.showInformationMessage(`Initiated Python 3.12 installation via ${plan.tool}. Paths will be auto-configured.`);
      },
    },
    {
      id: 'evolve.pythonStudio.installMissingPackages',
      title: 'Python Studio: 1-Click Auto Install Missing Packages',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const report = PythonEnvironmentManager.inspectDependencies(ws);

        if (report.missingCount === 0) {
          vscode.window.showInformationMessage('✓ All required Python packages are already installed and verified!');
          return;
        }

        const missing = report.packages.filter(p => !p.installed).map(p => p.name);
        const term = PythonRuntime.getOrCreateSandboxTerminal(ws);
        term.show();
        term.sendText(`Write-Host "📦 Installing missing dependencies: ${missing.join(', ')}..." -ForegroundColor Cyan`);
        term.sendText(`if (Get-Command uv -ErrorAction SilentlyContinue) { uv pip install ${missing.join(' ')} } else { python -m pip install ${missing.join(' ')} }`);
        vscode.window.showInformationMessage(`Installing ${missing.length} missing package(s) in sandbox terminal.`);
      },
    },
    {
      id: 'evolve.pythonStudio.generateAirtightBundle',
      title: 'Python Studio: Generate Airtight / Air-Gapped Offline Bundle',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) {
          vscode.window.showErrorMessage('Please open a workspace folder first.');
          return;
        }
        const bundle = PythonEnvironmentManager.generateAirtightBundle(ws);
        const readmeUri = vscode.Uri.file(path.join(bundle.bundleDir, 'AIR_GAPPED_README.md'));
        const doc = await vscode.workspace.openTextDocument(readmeUri);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`✓ Created Airtight offline bundle in airtight_bundle/ with fetch scripts and manifest.`);
      },
    },
    {
      id: 'evolve.pythonStudio.installAirtightWheelhouse',
      title: 'Python Studio: Install from Local Airtight Wheelhouse Folder',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const candidateDir = path.join(ws, 'airtight_bundle', 'wheels');
        const fallbackDir = path.join(ws, 'wheels');
        const wheelsDir = fs.existsSync(candidateDir) ? candidateDir : fs.existsSync(fallbackDir) ? fallbackDir : '';

        const term = PythonRuntime.getOrCreateSandboxTerminal(ws);
        term.show();
        term.sendText(`Write-Host "🔒 Installing from Local Wheelhouse in Airtight / Air-Gapped Mode..." -ForegroundColor Cyan`);
        const targetPath = wheelsDir || '.\\wheels';
        term.sendText(`python -m pip install --no-index --find-links="${targetPath}" -r requirements.txt`);
        vscode.window.showInformationMessage(`Executing offline installation using local wheelhouse.`);
      },
    },
    {
      id: 'evolve.pythonStudio.runSetupSelfTest',
      title: 'Python Studio: Run Setup Verification & Self-Test',
      handler: async (services: IServices) => {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Python Studio: Running Setup Verification & Smoke Test...',
            cancellable: false,
          },
          async () => {
            const res = PythonEnvironmentManager.runSetupSelfTest(ws);
            if (res.passed) {
              vscode.window.showInformationMessage(
                `✓ Python Setup Certified Production-Ready!\n` +
                `• Python: ${res.pythonVersion} (${res.interpreterPath})\n` +
                `• Verified Imports: ${res.testedImports.filter(i => i.ok).length}/${res.testedImports.length} functional\n` +
                `• Smoke Test Latency: ${res.durationMs}ms`
              );
            } else {
              const failed = res.testedImports.filter(i => !i.ok).map(i => `• ${i.name}: ${i.error}`).join('\n');
              vscode.window.showWarningMessage(
                `⚠️ Python Setup Warning: Some components failed verification:\n${failed}`
              );
            }
          }
        );
      },
    },
  ];
}

export * from './pythonCodeTools';



