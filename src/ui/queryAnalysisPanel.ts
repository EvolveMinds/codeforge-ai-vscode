/**
 * ui/queryAnalysisPanel.ts — Query cost preview panel (DE #2)
 *
 * Single lazy-created webview that shows the most recently-analysed query:
 *   - Engine, bytes scanned, estimated cost, rows
 *   - Tables read
 *   - Heuristic and engine-specific warnings
 *   - The first 8 KB of the EXPLAIN plan (Databricks)
 *   - "Refresh" (re-run analyzer, force) and "Optimise with AI" buttons
 *
 * The panel is opened by `aiForge.queryAnalysis.runForStatement` and
 * `aiForge.queryAnalysis.previewActive`.
 */

import * as vscode from 'vscode';
import type { IServices }      from '../core/services';
import type { QueryAnalysis }  from '../core/plugin';
import { QueryAnalysisStore }  from './queryAnalysisStore';

export class QueryAnalysisPanel {
  private static _instance: QueryAnalysisPanel | null = null;

  static show(svc: IServices, store: QueryAnalysisStore, analysis: QueryAnalysis | null): void {
    if (!this._instance) this._instance = new QueryAnalysisPanel(svc, store);
    this._instance._reveal(analysis);
  }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _current: QueryAnalysis | null = null;

  private constructor(
    private readonly _svc: IServices,
    private readonly _store: QueryAnalysisStore,
  ) {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.queryAnalysis',
      'Evolve AI: Query Cost Preview',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const subRefresh = _store.onDidChange(({ analysis }) => {
      if (this._current && this._current.sqlHash === analysis.sqlHash) {
        this._current = analysis;
        this._render();
      }
    });

    this._panel.webview.onDidReceiveMessage(async msg => {
      if (msg?.type === 'refresh' && this._current) {
        const active = vscode.window.activeTextEditor;
        if (!active) return;
        const file = {
          path: active.document.uri.fsPath,
          relPath: vscode.workspace.asRelativePath(active.document.uri),
          content: active.document.getText(),
          language: active.document.languageId,
        };
        const fresh = await _store.analyse(this._current.sql, file, true);
        this._current = fresh;
        this._render();
      } else if (msg?.type === 'optimise' && this._current) {
        await vscode.commands.executeCommand('aiForge.queryAnalysis.optimiseWithAi', this._current.sqlHash);
      }
    });

    this._panel.onDidDispose(() => {
      this._disposed = true;
      subRefresh.dispose();
      QueryAnalysisPanel._instance = null;
    });
  }

  private _reveal(analysis: QueryAnalysis | null): void {
    if (this._disposed) return;
    this._current = analysis;
    this._panel.reveal(vscode.ViewColumn.Beside);
    this._render();
  }

  private _render(): void {
    if (this._disposed) return;
    this._panel.webview.html = this._html(this._current);
  }

  private _html(a: QueryAnalysis | null): string {
    const body = !a ? this._emptyHtml() : a.error ? this._errorHtml(a) : this._analysisHtml(a);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
      h1 { font-size: 14px; margin: 0 0 4px; }
      h2 { font-size: 13px; margin: 16px 0 6px; }
      .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 12px; }
      .stats { display: grid; grid-template-columns: repeat(2, max-content); gap: 4px 16px; font-size: 12px; margin-bottom: 12px; }
      .stats .k { color: var(--vscode-descriptionForeground); }
      .stats .v { font-family: var(--vscode-editor-font-family); }
      .warn { padding: 6px 10px; border-left: 3px solid var(--vscode-editorWarning-foreground); margin: 4px 0; font-size: 12px; background: var(--vscode-editorWarning-background); }
      .info { padding: 6px 10px; border-left: 3px solid var(--vscode-editorInfo-foreground); margin: 4px 0; font-size: 12px; background: var(--vscode-editorInfo-background); }
      .err  { padding: 8px 12px; border: 1px solid var(--vscode-editorError-foreground); border-radius: 3px; font-size: 12px; color: var(--vscode-editorError-foreground); }
      pre.plan { background: var(--vscode-textBlockQuote-background); padding: 8px 12px; max-height: 360px; overflow: auto; font-size: 11px; }
      .actions { margin-top: 16px; }
      button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; font-size: 12px; border-radius: 2px; cursor: pointer; margin-right: 6px; }
      button:hover { background: var(--vscode-button-hoverBackground); }
      .empty { color: var(--vscode-descriptionForeground); padding: 24px 12px; text-align: center; }
      code.fqn { font-family: var(--vscode-editor-font-family); font-size: 11px; }
    </style></head><body>${body}<script>const vscodeApi = acquireVsCodeApi();</script></body></html>`;
  }

  private _emptyHtml(): string {
    return `<div class="empty">
      <div style="font-size: 24px; opacity: 0.4;">$</div>
      <h2>No query analysed yet</h2>
      <p>Click the <code>$(zap) Preview cost</code> CodeLens above any SQL statement, or run<br>
        <strong>Evolve AI: Preview Query Cost</strong> from the command palette.</p>
    </div>`;
  }

  private _errorHtml(a: QueryAnalysis): string {
    return `
      <h1>Query cost preview <span class="meta">(${escapeHtml(a.engine)})</span></h1>
      <div class="err">${escapeHtml(a.error ?? '')}</div>
      <div class="actions">
        <button onclick="vscodeApi.postMessage({type:'refresh'})">Retry</button>
      </div>`;
  }

  private _analysisHtml(a: QueryAnalysis): string {
    const stats: Array<[string, string]> = [];
    if (a.bytesScanned !== undefined)     stats.push(['Bytes scanned', formatBytes(a.bytesScanned)]);
    if (a.estimatedCostUsd !== undefined) stats.push(['Estimated cost', formatUsd(a.estimatedCostUsd)]);
    if (a.rowsProcessed !== undefined)    stats.push(['Rows', a.rowsProcessed.toLocaleString()]);
    stats.push(['Analyser took', `${a.elapsedMs} ms`]);

    const tables = (a.tablesRead ?? []).map(t => `<code class="fqn">${escapeHtml(t.fqn)}</code>`).join(', ');
    const warns = a.warnings.map(w => `<div class="${w.severity === 'info' ? 'info' : 'warn'}"><strong>${escapeHtml(w.code)}:</strong> ${escapeHtml(w.message)}</div>`).join('');
    const plan = a.plan ? `<h2>Plan (excerpt)</h2><pre class="plan">${escapeHtml(a.plan)}</pre>` : '';

    return `
      <h1>Query cost preview <span class="meta">(${escapeHtml(a.engine)})</span></h1>
      <div class="stats">${stats.map(([k, v]) => `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`).join('')}</div>
      ${tables ? `<h2>Tables</h2><div>${tables}</div>` : ''}
      ${warns ? `<h2>Warnings</h2>${warns}` : ''}
      ${plan}
      <div class="actions">
        <button onclick="vscodeApi.postMessage({type:'refresh'})">Refresh</button>
        <button onclick="vscodeApi.postMessage({type:'optimise'})">Optimise with AI</button>
      </div>
    `;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!));
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  const u = ['KB','MB','GB','TB','PB']; let v = n / 1024; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}
function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
