/**
 * commands/fdeCommands.ts — Forward Deployed Engineer (FDE) & Delivery Suite Commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { IServices } from '../core/services';
import { FdeCockpitPanel } from '../ui/fdeCockpitPanel';
import { PreflightAuditor } from '../deployment/preflightAuditor';
import { FirebaseConfigGenerator } from '../deployment/firebaseConfigGen';
import { DeployScriptScaffolder } from '../deployment/deployScriptScaffolder';
import { RunbookGenerator } from '../fde/runbookGenerator';
import { FdeContextManager } from '../fde/fdeContext';

export class FdeCommands {
  constructor(private readonly _svc: IServices) {}

  register(): void {
    const r = (id: string, fn: (...a: unknown[]) => unknown) =>
      this._svc.vsCtx.subscriptions.push(
        vscode.commands.registerCommand(id, async (...args: unknown[]) => {
          try {
            await fn(...args);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[Evolve AI] Command ${id} failed:`, e);
            vscode.window.showErrorMessage(`Evolve AI: ${msg}`);
          }
        })
      );

    r('aiForge.fde.openCockpit', () => this.openCockpit());
    r('aiForge.fde.preflightAudit', () => this.runPreflightAudit());
    r('aiForge.fde.scaffoldDeploy', () => this.scaffoldDeployment());
    r('aiForge.fde.generateRunbook', () => this.generateRunbooks());
  }

  openCockpit(): void {
    FdeCockpitPanel.createOrShow(this._svc.vsCtx, this._svc);
  }

  async runPreflightAudit(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showWarningMessage('Open a workspace folder first to run Pre-Flight Audit.');
      return;
    }

    const report = PreflightAuditor.scanWorkspace(ws);
    if (report.pass) {
      vscode.window.showInformationMessage(`✓ Pre-Flight Health Audit Passed (Score: ${report.score}/100) — Workspace clean & ready for deployment.`);
    } else {
      const errorCount = report.findings.filter(f => f.severity === 'error').length;
      const cleanable = report.temporaryFiles.length;
      
      const choice = await vscode.window.showWarningMessage(
        `Pre-Flight Audit: ${errorCount} errors, ${report.findings.length} total findings (Score: ${report.score}/100).`,
        cleanable > 0 ? `Clean ${cleanable} Temp Files` : 'View Details'
      );

      if (choice === `Clean ${cleanable} Temp Files`) {
        const res = PreflightAuditor.cleanTemporaryFiles(report.temporaryFiles);
        vscode.window.showInformationMessage(`Cleaned ${res.cleaned} temporary/backup files.`);
      } else if (choice === 'View Details') {
        this.openCockpit();
      }
    }
  }

  async scaffoldDeployment(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showWarningMessage('Open a workspace folder first.');
      return;
    }

    const projId = await vscode.window.showInputBox({
      prompt: 'Enter Google Cloud / Firebase Project ID',
      placeHolder: 'e.g. acme-pilot-2026',
      value: 'client-pilot-project',
    });
    if (!projId) return;

    // 1. Generate Firebase configs
    const fbJson = FirebaseConfigGenerator.generateFirebaseJson({ projectId: projId });
    const fbRc = FirebaseConfigGenerator.generateFirebaseRc({ projectId: projId });
    fs.writeFileSync(path.join(ws, 'firebase.json'), fbJson, 'utf8');
    fs.writeFileSync(path.join(ws, '.firebaserc'), fbRc, 'utf8');

    // 2. Generate scripts/
    const scriptsDir = path.join(ws, 'scripts');
    if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

    const bashScript = DeployScriptScaffolder.generateBashDeployScript({ projectName: projId, projectId: projId, includeCloudRunBackend: true });
    const psScript = DeployScriptScaffolder.generatePowerShellDeployScript({ projectName: projId, projectId: projId, includeCloudRunBackend: true });
    const prepScript = DeployScriptScaffolder.generatePrepareDeploymentScript();

    fs.writeFileSync(path.join(scriptsDir, 'deploy.sh'), bashScript, { encoding: 'utf8', mode: 0o755 });
    fs.writeFileSync(path.join(scriptsDir, 'deploy.ps1'), psScript, 'utf8');
    fs.writeFileSync(path.join(scriptsDir, 'prepare-deployment.js'), prepScript, 'utf8');

    vscode.window.showInformationMessage('✓ Successfully scaffolded Firebase Hosting configuration and cross-platform deploy scripts in scripts/!');
  }

  async generateRunbooks(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) return;

    const ctxManager = new FdeContextManager(this._svc.vsCtx);
    const state = ctxManager.getState();

    const docsDir = path.join(ws, 'docs');
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

    const archDoc = RunbookGenerator.generateArchitectureDoc(state);
    const deployRunbook = RunbookGenerator.generateDeploymentRunbook(state);
    const dataDict = RunbookGenerator.generateDataDictionary(state);

    fs.writeFileSync(path.join(docsDir, 'ARCHITECTURE.md'), archDoc, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'DEPLOYMENT_RUNBOOK.md'), deployRunbook, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'DATA_DICTIONARY.md'), dataDict, 'utf8');

    vscode.window.showInformationMessage('✓ Generated ARCHITECTURE.md, DEPLOYMENT_RUNBOOK.md, and DATA_DICTIONARY.md in docs/');
  }
}
