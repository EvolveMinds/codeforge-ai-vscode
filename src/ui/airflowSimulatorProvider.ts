/**
 * ui/airflowSimulatorProvider.ts — Diagnostics + CodeLens for Airflow DAGs (DE #4)
 *
 *   - Diagnostics: every issue from analyzeDag() becomes a yellow/red squiggle
 *     on the offending line.
 *   - CodeLens at line 0: "$(circuit-board) DAG: 7 tasks · 2 warnings · open simulator"
 *     Click → opens the simulator panel.
 *
 * The diagnostic collection is ID'd `aiForge.airflow` so users can selectively
 * dismiss just our diagnostics without affecting Pylance / Ruff.
 */

import * as vscode from 'vscode';
import {
  analyzeDag,
  looksLikeAirflowDag,
  renderAnalysisOneLine,
  type DagAnalysis,
  type DagIssue,
} from '../plugins/airflowDagAnalyzer';

const SEVERITY_MAP: Record<DagIssue['severity'], vscode.DiagnosticSeverity> = {
  error:   vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info:    vscode.DiagnosticSeverity.Information,
};

export class AirflowSimulatorController {
  private readonly _diags: vscode.DiagnosticCollection;
  /** Per-doc cache of the last analysis — used by CodeLens + panel */
  private readonly _byUri = new Map<string, DagAnalysis>();
  private readonly _emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeAnalysis = this._emitter.event;

  constructor(vsCtx: vscode.ExtensionContext) {
    this._diags = vscode.languages.createDiagnosticCollection('aiForge.airflow');
    vsCtx.subscriptions.push(this._diags);

    // Refresh on save / open / change-active
    vsCtx.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(doc => this.refresh(doc)),
      vscode.workspace.onDidOpenTextDocument(doc => this.refresh(doc)),
      vscode.workspace.onDidCloseTextDocument(doc => {
        this._diags.delete(doc.uri);
        this._byUri.delete(doc.uri.toString());
      }),
      vscode.window.onDidChangeActiveTextEditor(ed => { if (ed) this.refresh(ed.document); }),
    );

    // Also refresh on edit when runOnSave is false (live mode)
    vsCtx.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(ev => {
        const cfg = vscode.workspace.getConfiguration('aiForge');
        if (cfg.get<boolean>('airflow.simulator.runOnSave', true)) return;
        this.refresh(ev.document);
      }),
    );

    // Initial pass for the active editor
    const active = vscode.window.activeTextEditor;
    if (active) this.refresh(active.document);
  }

  get(uri: vscode.Uri): DagAnalysis | undefined {
    return this._byUri.get(uri.toString());
  }

  refresh(doc: vscode.TextDocument): void {
    const cfg = vscode.workspace.getConfiguration('aiForge');
    if (!cfg.get<boolean>('airflow.simulator.enabled', true)) {
      this._diags.delete(doc.uri);
      this._byUri.delete(doc.uri.toString());
      return;
    }
    const filePath = doc.uri.fsPath;
    const content = doc.getText();
    if (!looksLikeAirflowDag(content, filePath)) {
      this._diags.delete(doc.uri);
      this._byUri.delete(doc.uri.toString());
      return;
    }
    let analysis: DagAnalysis;
    try { analysis = analyzeDag(content); }
    catch (e) { console.warn('[Evolve AI] DAG analysis failed:', e); return; }

    this._byUri.set(doc.uri.toString(), analysis);
    const minSeverity = cfg.get<string>('airflow.simulator.severity', 'warning');
    const filtered = analysis.issues.filter(i => severityAtLeast(i.severity, minSeverity));
    const diagnostics = filtered.map(i => issueToDiagnostic(doc, i));
    this._diags.set(doc.uri, diagnostics);
    this._emitter.fire(doc.uri);
  }
}

function severityAtLeast(have: DagIssue['severity'], min: string): boolean {
  const order = { info: 0, warning: 1, error: 2 } as const;
  return order[have] >= (order[min as keyof typeof order] ?? 1);
}

function issueToDiagnostic(doc: vscode.TextDocument, issue: DagIssue): vscode.Diagnostic {
  const line = Math.max(0, Math.min(issue.line - 1, doc.lineCount - 1));
  const lineText = doc.lineAt(line).text;
  const startCol = issue.col ? Math.max(0, issue.col - 1) : 0;
  const endCol = lineText.length;
  const range = new vscode.Range(line, startCol, line, endCol);
  const diag = new vscode.Diagnostic(range, issue.message, SEVERITY_MAP[issue.severity]);
  diag.source = 'aiForge.airflow';
  diag.code   = issue.code;
  return diag;
}

// ── CodeLens ────────────────────────────────────────────────────────────────

export class AirflowSimulatorCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly _controller: AirflowSimulatorController) {
    _controller.onDidChangeAnalysis(() => this._onDidChange.fire());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const analysis = this._controller.get(doc.uri);
    if (!analysis) return [];
    const summary = renderAnalysisOneLine(analysis);
    const range = new vscode.Range(0, 0, 0, 0);
    const errors = analysis.issues.filter(i => i.severity === 'error').length;
    const icon = errors > 0 ? '$(error)' : (analysis.issues.length > 0 ? '$(warning)' : '$(circuit-board)');
    return [new vscode.CodeLens(range, {
      title: `${icon} Airflow DAG: ${summary} — open simulator`,
      command: 'aiForge.airflow.simulate',
      arguments: [doc.uri],
      tooltip: 'Open the DAG simulator panel for static analysis + AI fix.',
    })];
  }
}

const SELECTORS: vscode.DocumentSelector = [
  { language: 'python' },
  { pattern: '**/*.py' },
];

export function registerAirflowSimulator(vsCtx: vscode.ExtensionContext): AirflowSimulatorController {
  const controller = new AirflowSimulatorController(vsCtx);
  const codeLens = new AirflowSimulatorCodeLensProvider(controller);
  vsCtx.subscriptions.push(
    vscode.languages.registerCodeLensProvider(SELECTORS, codeLens),
  );
  return controller;
}
