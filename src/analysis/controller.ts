/**
 * analysis/controller.ts — Event wiring + command registration
 *
 * Owns the triggers (onOpen/onSave/onFocus), debounces them, drives the
 * AnalysisUI, and registers user-facing commands.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import type { AnalysisService } from './analysisService';
import type { ConsentStore } from './consentStore';
import { AnalysisUI, diffContentProvider } from './ui';

type AnalysisServices = IServices & { analysis: AnalysisService; consent: ConsentStore };

export class AnalysisController {
  private readonly _ui: AnalysisUI;
  private readonly svc: AnalysisServices;
  private _debounceTimer: NodeJS.Timeout | null = null;
  private _pendingDoc: vscode.TextDocument | null = null;

  constructor(svc: IServices) {
    if (!svc.analysis || !svc.consent) {
      throw new Error('AnalysisController requires analysis + consent services');
    }
    this.svc = svc as AnalysisServices;
    this._ui = new AnalysisUI(this.svc.vsCtx, this.svc.analysis, this.svc.consent);

    this._registerTriggers();
    this._registerCommands();
    this._registerContentProvider();
  }

  private _registerTriggers(): void {
    const sub = this.svc.vsCtx.subscriptions;

    sub.push(vscode.workspace.onDidOpenTextDocument(doc => this._maybeAnalyze(doc, 'onOpen')));
    sub.push(vscode.workspace.onDidSaveTextDocument(doc => this._maybeAnalyze(doc, 'onSave')));
    sub.push(vscode.window.onDidChangeActiveTextEditor(e => {
      if (e?.document) this._maybeAnalyze(e.document, 'onFocus');
    }));
    sub.push(vscode.workspace.onDidChangeTextDocument(e => this.svc.analysis.invalidate(e.document.uri.fsPath)));
  }

  private _registerCommands(): void {
    const sub = this.svc.vsCtx.subscriptions;

    sub.push(vscode.commands.registerCommand('aiForge.analysis.runNow', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) { vscode.window.showInformationMessage('Evolve AI: no active file'); return; }
      await this._ui.promptForDocument(doc);
    }));

    sub.push(vscode.commands.registerCommand('aiForge.analysis.applyAll', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) return;
      const report = await this.svc.analysis.analyze(doc);
      if (report.fix) {
        const uri = doc.uri;
        const edit = new vscode.WorkspaceEdit();
        const range = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(uri, range, report.fix.fixedContent);
        await vscode.workspace.applyEdit(edit);
        await doc.save();
        vscode.window.showInformationMessage(`Evolve AI: applied ${report.fix.tool} fixes`);
      } else {
        vscode.window.showInformationMessage('Evolve AI: nothing to fix ✓');
      }
    }));

    sub.push(vscode.commands.registerCommand('aiForge.analysis.toggle', async () => {
      const cfg = vscode.workspace.getConfiguration('aiForge.codeAnalysis');
      const current = cfg.get<boolean>('enabled', true);
      await cfg.update('enabled', !current, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`Evolve AI: code analysis ${!current ? 'enabled' : 'disabled'} for workspace`);
    }));

    sub.push(vscode.commands.registerCommand('aiForge.analysis.resetConsent', async () => {
      await this.svc.consent.reset();
      vscode.window.showInformationMessage('Evolve AI: consent reset');
    }));
  }

  private _registerContentProvider(): void {
    this.svc.vsCtx.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('evolve-ai-original', diffContentProvider),
      vscode.workspace.registerTextDocumentContentProvider('evolve-ai-proposed', diffContentProvider),
    );
  }

  private _maybeAnalyze(doc: vscode.TextDocument, trigger: 'onOpen' | 'onSave' | 'onFocus'): void {
    const cfg = vscode.workspace.getConfiguration('aiForge.codeAnalysis');
    if (!cfg.get<boolean>('enabled', true)) return;

    const configured = cfg.get<'onOpen' | 'onSave' | 'onFocus' | 'manual'>('trigger', 'onSave');
    if (configured === 'manual') return;
    if (configured !== trigger && !(configured === 'onOpen' && trigger === 'onFocus')) return;

    this._pendingDoc = doc;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    const ms = cfg.get<number>('debounceMs', 500);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      const d = this._pendingDoc;
      this._pendingDoc = null;
      if (d) this.svc.analysis.analyze(d).then(r => this._ui.render(r)).catch(e =>
        console.error('[Evolve AI] Analysis failed:', e)
      );
    }, ms);
  }
}
