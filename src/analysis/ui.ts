/**
 * analysis/ui.ts — Status bar, consent popup, diff preview, and applier
 *
 * The AnalysisService only produces Reports. This module decides how
 * results get surfaced to the user, asks for consent, and applies fixes.
 */

import * as vscode from 'vscode';
import type { AnalysisService } from './analysisService';
import type { ConsentStore } from './consentStore';
import type { Report, Issue, ConsentMode, ConsentScope, FixResult } from './types';

export class AnalysisUI {
  private readonly _item: vscode.StatusBarItem;
  private _currentReport: Report | null = null;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly svc: AnalysisService,
    private readonly consent: ConsentStore,
  ) {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this._item.command = 'aiForge.analysis.runNow';
    ctx.subscriptions.push(this._item);
    this._item.text = '$(circle-outline) Analysis';
    this._item.tooltip = 'Evolve AI: Code Analysis — click to run';
    this._item.show();
  }

  async render(report: Report): Promise<void> {
    this._currentReport = report;
    this._updateStatusBar(report);

    const cfg = vscode.workspace.getConfiguration('aiForge.codeAnalysis');
    const surface = cfg.get<'statusBar' | 'popup' | 'both'>('ui.surface', 'statusBar');
    const threshold = cfg.get<number>('ui.popupThreshold', 10);

    if (surface === 'statusBar') return;
    if (report.issues.length < threshold && !report.fix) return;
    if (surface === 'popup' || surface === 'both') {
      await this._offerReview(report);
    }
  }

  /** User clicked status bar or invoked the command directly. */
  async promptForDocument(doc: vscode.TextDocument): Promise<void> {
    const report = await this.svc.analyze(doc);
    this._currentReport = report;
    this._updateStatusBar(report);

    if (report.skipped) {
      vscode.window.showInformationMessage(`Evolve AI: skipped (${report.skipped})`);
      return;
    }
    if (report.issues.length === 0 && !report.fix) {
      vscode.window.showInformationMessage('Evolve AI: file is clean ✓');
      return;
    }
    await this._offerReview(report);
  }

  private _updateStatusBar(report: Report): void {
    if (report.skipped) {
      this._item.text = '$(circle-slash) Analysis';
      this._item.tooltip = `Evolve AI: ${report.skipped}`;
      return;
    }
    const errors   = report.issues.filter(i => i.severity === 'error').length;
    const warnings = report.issues.filter(i => i.severity === 'warning').length;
    const fixable  = report.issues.filter(i => i.fixable).length + (report.fix ? 1 : 0);

    if (errors === 0 && warnings === 0 && !report.fix) {
      this._item.text = '$(check) Clean';
    } else if (errors > 0) {
      this._item.text = `$(error) ${errors} err`;
    } else if (fixable > 0) {
      this._item.text = `$(wand) ${fixable} fixable`;
    } else {
      this._item.text = `$(warning) ${warnings} warn`;
    }
    this._item.tooltip = buildTooltip(report);
  }

  private async _offerReview(report: Report): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('aiForge.codeAnalysis');
    const autoApply = cfg.get<Record<string, boolean>>('consent.autoApply', {
      whitespace: true, quotes: true, semicolons: true, importOrder: true,
      unusedVars: false, anyTypes: false,
    });

    const { safe, risky } = this.svc.partition(report, autoApply);

    const decision = this.consent.get(
      report.file,
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(report.file))?.uri.fsPath ?? null,
    );

    // Silent mode — apply safe fixes + stop
    if (decision?.mode === 'silent' && report.fix) {
      await this._applyFix(report.fix);
      return;
    }
    if (decision?.mode === 'off') return;

    // autoSafe — apply safe fixes; prompt if risky remain
    if (decision?.mode === 'autoSafe') {
      if (report.fix) await this._applyFix(report.fix);
      if (risky.length === 0) return;
    }

    const total = report.issues.length + (report.fix ? 1 : 0);
    const actions: string[] = [];
    if (report.fix)         actions.push('Review Diff');
    if (safe.length > 0)    actions.push('Apply Safe Only');
    actions.push('Configure', 'Skip');

    const choice = await vscode.window.showInformationMessage(
      `Evolve AI: ${total} code-quality issue${total === 1 ? '' : 's'} in ${pathTail(report.file)}`,
      ...actions,
    );

    if (choice === 'Review Diff' && report.fix) {
      const applied = await this._reviewDiff(report.fix);
      if (applied) this.svc.invalidate(report.file);
    } else if (choice === 'Apply Safe Only' && report.fix) {
      await this._applyFix(report.fix);
      this.svc.invalidate(report.file);
    } else if (choice === 'Configure') {
      await this._configureConsent(report.file);
    }
  }

  private async _reviewDiff(fix: FixResult): Promise<boolean> {
    const originalUri = vscode.Uri.parse(`evolve-ai-original:${encodeURIComponent(fix.file)}`);
    const proposedUri = vscode.Uri.parse(`evolve-ai-proposed:${encodeURIComponent(fix.file)}`);
    diffContentProvider.set(originalUri, fix.originalContent);
    diffContentProvider.set(proposedUri, fix.fixedContent);

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      `Evolve AI: ${pathTail(fix.file)} — proposed fixes`,
    );

    const choice = await vscode.window.showInformationMessage(
      'Apply proposed changes?',
      { modal: false },
      'Apply',
      'Cancel',
    );
    if (choice === 'Apply') {
      await this._applyFix(fix);
      return true;
    }
    return false;
  }

  private async _applyFix(fix: FixResult): Promise<void> {
    const uri = vscode.Uri.file(fix.file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length),
    );
    edit.replace(uri, fullRange, fix.fixedContent);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      await doc.save();
      vscode.window.setStatusBarMessage(`Evolve AI: applied ${fix.tool} fixes ✓`, 3000);
    }
  }

  private async _configureConsent(file: string): Promise<void> {
    const pick = await vscode.window.showQuickPick([
      { label: 'Review diff each time',       mode: 'prompt'   as ConsentMode, scope: 'workspace' as ConsentScope },
      { label: 'Auto-apply safe, prompt risky', mode: 'autoSafe' as ConsentMode, scope: 'workspace' as ConsentScope },
      { label: 'Silent — apply all safe fixes', mode: 'silent'   as ConsentMode, scope: 'workspace' as ConsentScope },
      { label: 'Disable for this workspace',   mode: 'off'      as ConsentMode, scope: 'workspace' as ConsentScope },
    ], { placeHolder: 'How should Evolve AI handle cleanup for this workspace?' });
    if (!pick) return;

    const wsKey = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath ?? null;
    await this.consent.set({ mode: pick.mode, scope: pick.scope }, { filePath: file, workspaceKey: wsKey });
    vscode.window.showInformationMessage(`Evolve AI: consent set to "${pick.label}"`);
  }
}

function buildTooltip(report: Report): string {
  const lines = ['Evolve AI — Code Analysis'];
  lines.push(`File: ${pathTail(report.file)}`);
  lines.push(`Ran in: ${report.durationMs} ms`);
  if (report.issues.length) {
    const byTool = new Map<string, number>();
    for (const i of report.issues) byTool.set(i.tool, (byTool.get(i.tool) ?? 0) + 1);
    for (const [tool, count] of byTool) lines.push(`${tool}: ${count}`);
  } else {
    lines.push('No issues.');
  }
  if (report.fix) lines.push(`Formatter: ${report.fix.tool} (would reformat)`);
  lines.push('');
  lines.push('Click to review & apply fixes');
  return lines.join('\n');
}

function pathTail(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

// ── Content provider for diff view ────────────────────────────────────────────

class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _store = new Map<string, string>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  set(uri: vscode.Uri, content: string): void {
    this._store.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this._store.get(uri.toString()) ?? '';
  }
}

export const diffContentProvider = new DiffContentProvider();
