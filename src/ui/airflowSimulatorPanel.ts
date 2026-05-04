/**
 * ui/airflowSimulatorPanel.ts — DAG Simulator panel (DE #4)
 *
 * Shows for the active DAG file:
 *   - Stats (tasks, edges, root/leaf counts, longest path)
 *   - ASCII task graph rendered from edges (zero-dep — no graphviz)
 *   - Issue list grouped by severity, with line jump-to
 *   - "Fix all with AI" button → injects issues into the chat panel
 */

import * as vscode from 'vscode';
import {
  renderAnalysisForPrompt,
  type DagAnalysis,
  type DagModel,
  type DagIssue,
} from '../plugins/airflowDagAnalyzer';
import type { AirflowSimulatorController } from './airflowSimulatorProvider';

export class AirflowSimulatorPanel {
  private static _instance: AirflowSimulatorPanel | null = null;

  static showForActive(controller: AirflowSimulatorController): void {
    if (!this._instance) this._instance = new AirflowSimulatorPanel(controller);
    this._instance._reveal();
  }

  static showForUri(controller: AirflowSimulatorController, uri: vscode.Uri): void {
    if (!this._instance) this._instance = new AirflowSimulatorPanel(controller);
    this._instance._currentUri = uri;
    this._instance._reveal();
  }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _currentUri: vscode.Uri | undefined;

  private constructor(private readonly _controller: AirflowSimulatorController) {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.airflowSimulator',
      'Evolve AI: Airflow DAG Simulator',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const sub = _controller.onDidChangeAnalysis(uri => {
      if (this._currentUri && uri.toString() === this._currentUri.toString()) {
        this._render();
      }
    });
    const editorSub = vscode.window.onDidChangeActiveTextEditor(ed => {
      if (ed) { this._currentUri = ed.document.uri; this._render(); }
    });

    this._panel.webview.onDidReceiveMessage(async msg => {
      if (msg?.type === 'jump' && typeof msg.line === 'number') {
        if (!this._currentUri) return;
        const doc = await vscode.workspace.openTextDocument(this._currentUri);
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
        const pos = new vscode.Position(Math.max(0, msg.line - 1), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      } else if (msg?.type === 'fixWithAi') {
        await vscode.commands.executeCommand('aiForge.airflow.fixIssues', this._currentUri);
      } else if (msg?.type === 'refresh') {
        const active = vscode.window.activeTextEditor;
        if (active) { this._currentUri = active.document.uri; this._controller.refresh(active.document); }
      }
    });

    this._panel.onDidDispose(() => {
      this._disposed = true;
      sub.dispose();
      editorSub.dispose();
      AirflowSimulatorPanel._instance = null;
    });
  }

  private _reveal(): void {
    if (this._disposed) return;
    if (!this._currentUri) {
      const active = vscode.window.activeTextEditor;
      if (active) this._currentUri = active.document.uri;
    }
    this._panel.reveal(vscode.ViewColumn.Beside);
    this._render();
  }

  private _render(): void {
    if (this._disposed) return;
    const analysis = this._currentUri ? this._controller.get(this._currentUri) : undefined;
    this._panel.webview.html = this._html(analysis);
  }

  private _html(a: DagAnalysis | undefined): string {
    const body = !a ? this._emptyHtml() : this._analysisHtml(a);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
      h1 { font-size: 14px; margin: 0 0 4px; }
      h2 { font-size: 13px; margin: 16px 0 6px; }
      .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 12px; }
      .stats { display: grid; grid-template-columns: repeat(2, max-content); gap: 4px 16px; font-size: 12px; margin-bottom: 12px; }
      .stats .k { color: var(--vscode-descriptionForeground); }
      .issue { padding: 6px 10px; margin: 4px 0; font-size: 12px; cursor: pointer; border-left-width: 3px; border-left-style: solid; }
      .issue:hover { background: var(--vscode-list-hoverBackground); }
      .err  { border-left-color: var(--vscode-editorError-foreground);   background: var(--vscode-editorError-background, transparent); }
      .warn { border-left-color: var(--vscode-editorWarning-foreground); background: var(--vscode-editorWarning-background, transparent); }
      .info { border-left-color: var(--vscode-editorInfo-foreground);    background: var(--vscode-editorInfo-background, transparent); }
      .code { color: var(--vscode-descriptionForeground); font-size: 11px; font-family: var(--vscode-editor-font-family); }
      .hint { color: var(--vscode-descriptionForeground); margin-top: 2px; font-size: 11px; }
      pre.graph { background: var(--vscode-textBlockQuote-background); padding: 8px 12px; max-height: 360px; overflow: auto; font-size: 11px; line-height: 1.4; }
      .actions { margin-top: 16px; }
      button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; font-size: 12px; border-radius: 2px; cursor: pointer; margin-right: 6px; }
      button:hover { background: var(--vscode-button-hoverBackground); }
      .empty { color: var(--vscode-descriptionForeground); padding: 24px 12px; text-align: center; }
    </style></head><body>${body}<script>
      const vscodeApi = acquireVsCodeApi();
      function jump(line) { vscodeApi.postMessage({ type: 'jump', line }); }
    </script></body></html>`;
  }

  private _emptyHtml(): string {
    return `<div class="empty">
      <div style="font-size: 24px; opacity: 0.4;">&empty;</div>
      <h2>No Airflow DAG in active editor</h2>
      <p>Open a Python file containing <code>DAG(...)</code> or <code>@dag(...)</code>.</p>
    </div>`;
  }

  private _analysisHtml(a: DagAnalysis): string {
    const stats: Array<[string, string]> = [
      ['Tasks',         String(a.stats.taskCount)],
      ['Edges',         String(a.stats.edgeCount)],
      ['Root tasks',    String(a.stats.rootTasks)],
      ['Leaf tasks',    String(a.stats.leafTasks)],
      ['Longest path',  a.stats.longestPath < 0 ? '— (cycle detected)' : `${a.stats.longestPath} edge${a.stats.longestPath === 1 ? '' : 's'}`],
    ];
    if (a.dag.dagId) stats.push(['dag_id', a.dag.dagId]);
    if (a.dag.schedule) stats.push(['schedule', a.dag.schedule]);
    if (a.dag.startDate) stats.push(['start_date', a.dag.startDate]);
    if (a.dag.catchup !== undefined) stats.push(['catchup', String(a.dag.catchup)]);

    const errors = a.issues.filter(i => i.severity === 'error');
    const warnings = a.issues.filter(i => i.severity === 'warning');
    const infos = a.issues.filter(i => i.severity === 'info');

    const issueGroup = (label: string, items: DagIssue[], cls: string) => items.length === 0 ? '' : `
      <h2>${escapeHtml(label)} (${items.length})</h2>
      ${items.map(i => `
        <div class="issue ${cls}" onclick="jump(${i.line})">
          <strong>${escapeHtml(i.message)}</strong>
          <div class="code">[${escapeHtml(i.code)}] line ${i.line}</div>
          ${i.hint ? `<div class="hint">${escapeHtml(i.hint)}</div>` : ''}
        </div>
      `).join('')}`;

    const graph = renderAsciiGraph(a.dag);

    return `
      <h1>${a.dag.dagId ? escapeHtml(a.dag.dagId) : 'DAG'}</h1>
      <div class="meta">${escapeHtml(renderHeaderMeta(a))}</div>
      <div class="stats">${stats.map(([k, v]) => `<div class="k">${escapeHtml(k)}</div><div>${escapeHtml(v)}</div>`).join('')}</div>
      ${issueGroup('Errors',   errors,   'err')}
      ${issueGroup('Warnings', warnings, 'warn')}
      ${issueGroup('Info',     infos,    'info')}
      <h2>Task graph</h2>
      <pre class="graph">${escapeHtml(graph)}</pre>
      <div class="actions">
        <button onclick="vscodeApi.postMessage({type:'refresh'})">Refresh</button>
        ${a.issues.length > 0 ? `<button onclick="vscodeApi.postMessage({type:'fixWithAi'})">Fix all with AI</button>` : ''}
      </div>
    `;
  }
}

function renderHeaderMeta(a: DagAnalysis): string {
  if (a.issues.length === 0) return 'No issues detected.';
  const e = a.issues.filter(i => i.severity === 'error').length;
  const w = a.issues.filter(i => i.severity === 'warning').length;
  const i = a.issues.filter(i => i.severity === 'info').length;
  const parts: string[] = [];
  if (e) parts.push(`${e} error${e === 1 ? '' : 's'}`);
  if (w) parts.push(`${w} warning${w === 1 ? '' : 's'}`);
  if (i) parts.push(`${i} info`);
  return parts.join(' · ');
}

/** ASCII left-to-right adjacency rendering. Cheap and clear. */
function renderAsciiGraph(dag: DagModel): string {
  if (dag.tasks.length === 0) return '(no tasks detected)';
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const t of dag.tasks) { adj.set(t.id, []); inDeg.set(t.id, 0); }
  for (const e of dag.edges) {
    adj.get(e.from)?.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const lines: string[] = [];
  // Pick roots (in-degree 0). Sort for stable output.
  const roots = dag.tasks.map(t => t.id).filter(id => (inDeg.get(id) ?? 0) === 0).sort();
  if (roots.length === 0) {
    // All cycles — just list tasks
    for (const t of dag.tasks) lines.push(`• ${t.id}`);
    return lines.join('\n');
  }
  const visited = new Set<string>();
  function walk(node: string, prefix: string, isLast: boolean): void {
    const branch = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
    lines.push(`${prefix}${branch}${node}${visited.has(node) ? ' …' : ''}`);
    if (visited.has(node)) return;
    visited.add(node);
    const children = (adj.get(node) ?? []).slice().sort();
    const nextPrefix = prefix + (prefix === '' ? '' : (isLast ? '   ' : '│  '));
    for (let i = 0; i < children.length; i++) {
      walk(children[i], nextPrefix, i === children.length - 1);
    }
  }
  for (const root of roots) walk(root, '', true);
  // Append any tasks not reachable from roots (would be in a cycle / orphan)
  const unreached = dag.tasks.map(t => t.id).filter(id => !visited.has(id));
  if (unreached.length > 0) {
    lines.push('');
    lines.push('(unreached from any root — may be in a cycle):');
    for (const id of unreached) lines.push(`• ${id}`);
  }
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!));
}

// Helper used by the panel (re-exported for command convenience)
export { renderAnalysisForPrompt };
