/**
 * ui/lineagePanel.ts — "Lineage Explorer" webview (DE #1)
 *
 * Shows every resolved upstream schema for the active file, with column details,
 * tests, tags, and staleness warnings. Opened from the status bar, the command
 * palette, or from CodeLens lenses.
 *
 * Design: single lazy-created panel, refreshed whenever the active editor
 * changes or the store emits.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import type { LineageSchema } from '../core/plugin';
import { LineageStore } from './lineageStore';

export class LineagePanel {
  private static _instance: LineagePanel | null = null;

  static show(svc: IServices, store: LineageStore, focusFqn?: string): void {
    if (!this._instance) this._instance = new LineagePanel(svc, store);
    this._instance._reveal(focusFqn);
  }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;

  private constructor(
    private readonly _svc: IServices,
    private readonly _store: LineageStore,
  ) {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.lineagePanel',
      'Evolve AI: Lineage',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const refreshSub = _store.onDidChange(() => this._render());
    const editorSub  = vscode.window.onDidChangeActiveTextEditor(() => this._render());

    this._panel.webview.onDidReceiveMessage(async msg => {
      if (msg?.type === 'refresh') {
        const active = vscode.window.activeTextEditor;
        if (active) await _store.refresh(active.document.uri);
      } else if (msg?.type === 'openSettings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.lineage');
      }
    });

    this._panel.onDidDispose(() => {
      this._disposed = true;
      refreshSub.dispose();
      editorSub.dispose();
      LineagePanel._instance = null;
    });

    this._render();
  }

  private _reveal(focusFqn?: string): void {
    if (this._disposed) return;
    this._panel.reveal(vscode.ViewColumn.Beside);
    if (focusFqn) {
      this._panel.webview.postMessage({ type: 'focus', fqn: focusFqn });
    }
  }

  private _render(): void {
    if (this._disposed) return;
    const active = vscode.window.activeTextEditor;
    const snap = active ? this._store.get(active.document.uri) : undefined;
    const fileLabel = active
      ? vscode.workspace.asRelativePath(active.document.uri)
      : '(no active file)';
    const schemas = snap?.schemas ?? [];
    this._panel.webview.html = this._html(fileLabel, schemas);
  }

  private _html(file: string, schemas: LineageSchema[]): string {
    const body = schemas.length === 0
      ? this._emptyState(file)
      : schemas.map(s => this._schemaHtml(s)).join('\n');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
      h1 { font-size: 14px; margin: 0 0 4px; }
      .file { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 16px; }
      .schema { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 12px 14px; margin-bottom: 12px; }
      .schema h2 { font-size: 13px; margin: 0 0 4px; display: flex; justify-content: space-between; }
      .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 8px; }
      .stale { color: var(--vscode-editorWarning-foreground); }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th { text-align: left; color: var(--vscode-descriptionForeground); font-weight: 500; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
      td { padding: 4px 8px 4px 0; vertical-align: top; }
      td.name { color: var(--vscode-symbolIcon-fieldForeground); font-family: var(--vscode-editor-font-family); }
      td.type { color: var(--vscode-symbolIcon-classForeground); font-family: var(--vscode-editor-font-family); }
      td.desc { color: var(--vscode-descriptionForeground); }
      .tag { display: inline-block; padding: 1px 6px; margin-right: 4px; font-size: 10px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
      .test { color: var(--vscode-testing-iconPassed); font-size: 10px; margin-right: 4px; }
      .empty { color: var(--vscode-descriptionForeground); padding: 24px 12px; text-align: center; }
      .empty h2 { font-size: 13px; margin: 8px 0; color: var(--vscode-foreground); }
      .actions { margin-top: 16px; }
      button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; font-size: 12px; border-radius: 2px; cursor: pointer; margin-right: 6px; }
      button:hover { background: var(--vscode-button-hoverBackground); }
    </style></head><body>
      <h1>Upstream table schemas</h1>
      <div class="file">${escapeHtml(file)}</div>
      ${body}
      <div class="actions">
        <button onclick="vscodeApi.postMessage({type:'refresh'})">Refresh</button>
        <button onclick="vscodeApi.postMessage({type:'openSettings'})">Settings</button>
      </div>
      <script>
        const vscodeApi = acquireVsCodeApi();
        window.addEventListener('message', ev => {
          if (ev.data?.type === 'focus') {
            const el = document.getElementById('s-' + ev.data.fqn.toLowerCase());
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }
        });
      </script>
    </body></html>`;
  }

  private _emptyState(file: string): string {
    return `<div class="empty">
      <div style="font-size: 24px; opacity: 0.4;">∅</div>
      <h2>No upstream schemas resolved</h2>
      <p>Evolve AI couldn't find dbt refs, sources, or Spark tables in <code>${escapeHtml(file)}</code>.</p>
      <p style="margin-top: 12px;">Try:</p>
      <ul style="display: inline-block; text-align: left; margin: 4px auto;">
        <li>Opening a dbt model file (contains <code>{{ ref('...') }}</code>)</li>
        <li>Opening a PySpark notebook using <code>spark.table("catalog.schema.name")</code></li>
        <li>Running <code>dbt compile</code> to generate <code>target/manifest.json</code></li>
        <li>Connecting to Databricks via "Databricks: Connect"</li>
      </ul>
    </div>`;
  }

  private _schemaHtml(s: LineageSchema): string {
    const age = s.meta?.staleHours;
    const stale = typeof age === 'number' && age > 24;
    const metaParts: string[] = [s.source.replace('_', ' ')];
    if (typeof age === 'number') metaParts.push(`${Math.round(age)}h old`);
    if (s.meta?.note) metaParts.push(s.meta.note);

    const rows = s.columns.map(c => `
      <tr>
        <td class="name">${escapeHtml(c.name)}</td>
        <td class="type">${escapeHtml(c.type)}</td>
        <td>
          ${(c.testsPass ?? []).map(t => `<span class="test">✓ ${escapeHtml(t)}</span>`).join('')}
          ${(c.tags ?? []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        </td>
        <td class="desc">${escapeHtml(c.description ?? '')}</td>
      </tr>
    `).join('');

    return `<div class="schema" id="s-${escapeHtml(s.fqn.toLowerCase())}">
      <h2>
        <span>${escapeHtml(s.displayName)}</span>
        <span class="meta${stale ? ' stale' : ''}">${escapeHtml(metaParts.join(' · '))}</span>
      </h2>
      <table>
        <thead><tr><th>Column</th><th>Type</th><th>Tests / Tags</th><th>Description</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!));
}
