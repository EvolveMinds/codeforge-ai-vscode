/**
 * ui/dbtImpactPanel.ts — Impact analysis panel for dbt models (DE #3)
 *
 * For the active model:
 *   - Direct & transitive downstream models (with materialization + path)
 *   - Exposures consuming the model (direct + transitive, with owners)
 *   - Total tests across the impacted graph
 *   - Sources & upstream models (for full context)
 *   - "Refactor with impact context" button → injects the impact summary into
 *     the chat panel for AI-assisted breaking-change analysis
 *
 * Single lazy-created panel, refreshes when the active editor changes.
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import type { IServices } from '../core/services';
import {
  loadManifest,
  findDbtProjectRoot,
  getModelByFile,
  getDownstream,
  getUpstream,
  type DownstreamReport,
  type UpstreamReport,
  type ManifestNode,
} from '../plugins/dbtManifest';

export interface ImpactPayload {
  modelName:   string;
  modelId:     string;
  filePath:    string;
  description?: string;
  materialization?: string;
  downstream:  DownstreamReport;
  upstream?:   UpstreamReport;
  /** Hours since manifest was generated */
  staleHours?: number;
}

export class DbtImpactPanel {
  private static _instance: DbtImpactPanel | null = null;

  static showForActive(svc: IServices): void {
    if (!this._instance) this._instance = new DbtImpactPanel(svc);
    this._instance._refreshFromActive();
  }

  static showForModel(svc: IServices, payload: ImpactPayload): void {
    if (!this._instance) this._instance = new DbtImpactPanel(svc);
    this._instance._render(payload);
    this._instance._panel.reveal(vscode.ViewColumn.Beside);
  }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _current: ImpactPayload | null = null;

  private constructor(private readonly _svc: IServices) {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.dbtImpact',
      'Evolve AI: dbt Impact',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    const editorSub = vscode.window.onDidChangeActiveTextEditor(() => this._refreshFromActive());

    this._panel.webview.onDidReceiveMessage(async msg => {
      if (msg?.type === 'refresh') {
        this._refreshFromActive(true);
      } else if (msg?.type === 'refactorWithImpact' && this._current) {
        await vscode.commands.executeCommand('aiForge.dbt.refactorWithImpact', this._current.modelId);
      } else if (msg?.type === 'openModel' && msg.path) {
        const uri = vscode.Uri.file(msg.path);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
      }
    });

    this._panel.onDidDispose(() => {
      this._disposed = true;
      editorSub.dispose();
      DbtImpactPanel._instance = null;
    });

    this._refreshFromActive();
  }

  private _refreshFromActive(forceManifestReload = false): void {
    if (this._disposed) return;
    const active = vscode.window.activeTextEditor;
    if (!active) { this._render(null); return; }

    const filePath = active.document.uri.fsPath;
    const ws = vscode.workspace.getWorkspaceFolder(active.document.uri);
    if (!ws) { this._render(null); return; }
    const projectRoot = findDbtProjectRoot(path.dirname(filePath), ws.uri.fsPath);
    if (!projectRoot) { this._render(null); return; }

    if (forceManifestReload) {
      // Touching the cache happens via re-loading; the mtime check will
      // re-parse if the file changed since last load. Force an unconditional
      // re-read by clearing the cached entry.
      const { invalidateManifestCache } = require('../plugins/dbtManifest');
      invalidateManifestCache(projectRoot);
    }

    const manifest = loadManifest(projectRoot);
    if (!manifest) {
      this._render({
        modelName: '(no manifest)',
        modelId: '',
        filePath,
        downstream: { directModels: [], transitiveModels: [], exposures: [], totalTests: 0, truncated: false },
      });
      return;
    }
    const match = getModelByFile(projectRoot, filePath);
    if (!match) {
      this._render(null);
      return;
    }
    const cfg = vscode.workspace.getConfiguration('aiForge');
    const depth = cfg.get<number>('dbt.impactDepth', 5);
    const downstream = getDownstream(projectRoot, match.node.name, depth) ?? {
      directModels: [], transitiveModels: [], exposures: [], totalTests: 0, truncated: false,
    };
    const upstream = getUpstream(projectRoot, match.node.name, depth);
    const staleMs = manifest.parsed.metadata?.generated_at
      ? Date.now() - Date.parse(manifest.parsed.metadata.generated_at)
      : undefined;
    const staleHours = staleMs !== undefined && staleMs >= 0 ? staleMs / (1000 * 60 * 60) : undefined;

    this._render({
      modelName: match.node.name,
      modelId:   match.id,
      filePath,
      description: match.node.description,
      materialization: match.node.config?.materialized,
      downstream,
      upstream,
      staleHours,
    });
  }

  private _render(payload: ImpactPayload | null): void {
    if (this._disposed) return;
    this._current = payload;
    this._panel.webview.html = this._html(payload);
  }

  private _html(p: ImpactPayload | null): string {
    const body = !p ? this._emptyHtml() : this._impactHtml(p);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
      h1 { font-size: 14px; margin: 0 0 4px; }
      h2 { font-size: 13px; margin: 16px 0 6px; }
      .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 12px; }
      .stale { color: var(--vscode-editorWarning-foreground); }
      .summary { display: grid; grid-template-columns: repeat(2, max-content); gap: 4px 16px; font-size: 12px; margin-bottom: 12px; }
      .summary .k { color: var(--vscode-descriptionForeground); }
      ul { padding-left: 18px; margin: 4px 0; }
      li { font-size: 12px; line-height: 1.6; }
      a { color: var(--vscode-textLink-foreground); cursor: pointer; }
      a:hover { text-decoration: underline; }
      .badge { display: inline-block; padding: 1px 6px; margin-left: 4px; font-size: 10px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
      .depth-1 { padding-left: 0; }
      .depth-2 { padding-left: 18px; }
      .depth-3 { padding-left: 36px; }
      .depth-4 { padding-left: 54px; }
      .empty { color: var(--vscode-descriptionForeground); padding: 24px 12px; text-align: center; }
      .actions { margin-top: 16px; }
      button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; font-size: 12px; border-radius: 2px; cursor: pointer; margin-right: 6px; }
      button:hover { background: var(--vscode-button-hoverBackground); }
      .exposure { padding: 6px 10px; border-left: 3px solid var(--vscode-textLink-foreground); margin: 4px 0; font-size: 12px; background: var(--vscode-textBlockQuote-background); }
    </style></head><body>${body}<script>
      const vscodeApi = acquireVsCodeApi();
      function openModel(p) { vscodeApi.postMessage({ type: 'openModel', path: p }); }
    </script></body></html>`;
  }

  private _emptyHtml(): string {
    return `<div class="empty">
      <div style="font-size: 24px; opacity: 0.4;">&empty;</div>
      <h2>No dbt model in active editor</h2>
      <p>Open a file under <code>models/</code> in a dbt project that has a compiled <code>target/manifest.json</code>.</p>
      <p style="margin-top: 12px;">Run <code>dbt compile</code> if the manifest is missing.</p>
    </div>`;
  }

  private _impactHtml(p: ImpactPayload): string {
    if (!p.modelId) {
      return `<div class="empty">
        <h2>${escapeHtml(p.modelName)}</h2>
        <p>Manifest not found at <code>target/manifest.json</code>. Run <code>dbt compile</code> to enable impact analysis.</p>
      </div>`;
    }

    const stale = (p.staleHours ?? 0) > 24;
    const summary: Array<[string, string]> = [
      ['Direct downstream', String(p.downstream.directModels.length)],
      ['Transitive downstream', String(p.downstream.transitiveModels.length)],
      ['Exposures consuming', String(p.downstream.exposures.length)],
      ['Tests in graph', String(p.downstream.totalTests)],
    ];
    if (p.materialization) summary.push(['Materialization', p.materialization]);
    if (p.staleHours !== undefined) summary.push(['Manifest age', `${Math.round(p.staleHours)}h`]);

    const transitive = p.downstream.transitiveModels.slice().sort((a, b) => a.depth - b.depth);
    const downstreamHtml = transitive.length === 0
      ? `<p class="meta">Nothing depends on this model yet.</p>`
      : `<ul>${transitive.map(m => `
          <li class="depth-${Math.min(m.depth, 4)}">
            <a onclick="openModel(${JSON.stringify(absoluteFilePath(m.node, p.filePath))})">${escapeHtml(m.node.name)}</a>
            ${m.node.config?.materialized ? `<span class="badge">${escapeHtml(m.node.config.materialized)}</span>` : ''}
            ${m.depth > 1 ? `<span class="meta">(${m.depth} hops)</span>` : ''}
          </li>`).join('')}${p.downstream.truncated ? '<li class="meta">...truncated at depth limit</li>' : ''}</ul>`;

    const exposuresHtml = p.downstream.exposures.length === 0
      ? ''
      : `<h2>Exposures (${p.downstream.exposures.length})</h2>
         ${p.downstream.exposures.map(e => `
           <div class="exposure">
             <strong>${escapeHtml(e.exposure.name)}</strong>
             ${e.exposure.type ? `<span class="badge">${escapeHtml(e.exposure.type)}</span>` : ''}
             ${e.via === 'transitive' ? `<span class="badge">transitive</span>` : ''}
             ${e.exposure.owner?.name ? `<div class="meta">owner: ${escapeHtml(e.exposure.owner.name)}${e.exposure.owner.email ? ` &lt;${escapeHtml(e.exposure.owner.email)}&gt;` : ''}</div>` : ''}
             ${e.exposure.description ? `<div>${escapeHtml(e.exposure.description)}</div>` : ''}
             ${e.exposure.url ? `<div class="meta">${escapeHtml(e.exposure.url)}</div>` : ''}
           </div>
         `).join('')}`;

    const upstreamHtml = !p.upstream
      ? ''
      : `<h2>Upstream (${p.upstream.directParents.length} direct parent${p.upstream.directParents.length === 1 ? '' : 's'}, ${p.upstream.sources.length} source${p.upstream.sources.length === 1 ? '' : 's'})</h2>
         ${p.upstream.directParents.length > 0 ? `<ul>${p.upstream.directParents.map(m => `<li>${escapeHtml(m.node.name)}</li>`).join('')}</ul>` : ''}
         ${p.upstream.sources.length > 0 ? `<p class="meta">Sources: ${p.upstream.sources.map(s => escapeHtml(`${s.node.source_name}.${s.node.name}`)).join(', ')}</p>` : ''}`;

    return `
      <h1>${escapeHtml(p.modelName)}</h1>
      <div class="meta ${stale ? 'stale' : ''}">${escapeHtml(p.modelId)}${stale ? ' · manifest is stale (run dbt compile)' : ''}</div>
      ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
      <div class="summary">${summary.map(([k, v]) => `<div class="k">${escapeHtml(k)}</div><div>${escapeHtml(v)}</div>`).join('')}</div>
      <h2>Downstream impact</h2>
      ${downstreamHtml}
      ${exposuresHtml}
      ${upstreamHtml}
      <div class="actions">
        <button onclick="vscodeApi.postMessage({type:'refresh'})">Refresh</button>
        <button onclick="vscodeApi.postMessage({type:'refactorWithImpact'})">Refactor with AI (impact-aware)</button>
      </div>
    `;
  }
}

/**
 * Resolve a model's manifest-recorded file path to an absolute path on disk.
 * Manifest stores paths relative to the dbt project root; we need absolute
 * for vscode.Uri.file() in the openModel handler.
 */
function absoluteFilePath(node: ManifestNode, anchorPath: string): string {
  if (!node.original_file_path) return '';
  // Walk from anchor (the active model's path) up until we find the
  // dbt_project.yml — that's the project root.
  const fs = require('fs');
  let dir = path.dirname(anchorPath);
  for (let i = 0; i < 15; i++) {
    if (fs.existsSync(path.join(dir, 'dbt_project.yml'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(dir, node.original_file_path);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!));
}
