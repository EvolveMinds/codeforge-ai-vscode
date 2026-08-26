/**
 * ui/dataProfilerPanel.ts — Offline Data Profiler & Quality Audit Webview Panel
 *
 * 100% self-contained HTML/CSS/SVG without external network assets.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import { DataProfiler, DatasetProfile, ColumnProfile } from '../offline/dataProfiler';
import * as path from 'path';
import * as fs from 'fs';

export class DataProfilerPanel {
  private static _instance: DataProfilerPanel | null = null;

  static show(svc: IServices, profile: DatasetProfile): void {
    if (!this._instance) {
      this._instance = new DataProfilerPanel(svc);
    }
    this._instance._reveal(profile);
  }

  static async profileActiveFile(svc: IServices): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active file to profile. Open a CSV, TSV, or JSON file.');
      return;
    }
    const doc = editor.document;
    const content = doc.getText();
    const fileName = path.basename(doc.uri.fsPath);
    let size = 0;
    try {
      size = fs.statSync(doc.uri.fsPath).size;
    } catch {
      size = Buffer.byteLength(content, 'utf8');
    }

    const profile = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Profiling ${fileName} (offline)…` },
      async () => DataProfiler.profileText(content, fileName, size),
    );

    DataProfilerPanel.show(svc, profile);
  }

  private readonly _panel: vscode.WebviewPanel;
  private _currentProfile: DatasetProfile | null = null;

  private constructor(private readonly _svc: IServices) {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.dataProfiler',
      'Evolve AI: Data Profiler',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this._panel.onDidDispose(() => {
      DataProfilerPanel._instance = null;
    });

    this._panel.webview.onDidReceiveMessage(async msg => {
      if (!this._currentProfile) return;
      if (msg?.type === 'exportDbt') {
        const yaml = DataProfiler.exportDbtTestsYaml(this._currentProfile);
        const doc = await vscode.workspace.openTextDocument({ content: yaml, language: 'yaml' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      } else if (msg?.type === 'exportGE') {
        const json = DataProfiler.exportGreatExpectationsSuite(this._currentProfile);
        const doc = await vscode.workspace.openTextDocument({ content: json, language: 'json' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      } else if (msg?.type === 'exportMd') {
        const md = DataProfiler.exportMarkdown(this._currentProfile);
        const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      }
    });
  }

  private _reveal(profile: DatasetProfile): void {
    this._currentProfile = profile;
    this._panel.title = `Profile: ${profile.fileName}`;
    this._panel.reveal(vscode.ViewColumn.Beside);
    this._render();
  }

  private _render(): void {
    if (!this._currentProfile) return;
    this._panel.webview.html = this._getHtml(this._currentProfile);
  }

  private _getHtml(p: DatasetProfile): string {
    const sizeKB = (p.fileSizeBytes / 1024).toFixed(2);
    const anomaliesHtml = p.anomaliesSummary.map(a => {
      const isWarn = a.severity === 'warning';
      const bg = isWarn ? 'var(--vscode-inputValidation-warningBackground, #3b2e00)' : 'var(--vscode-inputValidation-infoBackground, #0e3048)';
      const border = isWarn ? 'var(--vscode-inputValidation-warningBorder, #cca700)' : 'var(--vscode-inputValidation-infoBorder, #007acc)';
      const icon = isWarn ? '⚠️' : 'ℹ️';
      return `<div style="background:${bg}; border-left:3px solid ${border}; padding:6px 10px; margin-bottom:6px; border-radius:3px; font-size:12px;">
        <strong>${icon} ${this._esc(a.column)}:</strong> ${this._esc(a.issue)}
      </div>`;
    }).join('');

    const columnsHtml = p.columns.map(col => {
      const typeBadgeClass = `badge-${col.inferredType}`;
      const nullColor = col.nullPercentage > 0 ? (col.nullPercentage > 20 ? 'var(--vscode-errorForeground, #f48771)' : 'var(--vscode-charts-yellow, #cca700)') : 'var(--vscode-charts-green, #89d185)';
      
      let metricDetails = '';
      if (col.inferredType === 'integer' || col.inferredType === 'float') {
        metricDetails = `
          <div class="col-metric"><strong>Min:</strong> ${col.min ?? '—'}</div>
          <div class="col-metric"><strong>Max:</strong> ${col.max ?? '—'}</div>
          <div class="col-metric"><strong>Mean:</strong> ${col.mean ?? '—'}</div>
          <div class="col-metric"><strong>Median:</strong> ${col.median ?? '—'}</div>
          <div class="col-metric"><strong>Zeros:</strong> ${col.zeroCount ?? 0}</div>
        `;
      } else if (col.inferredType === 'datetime' || col.inferredType === 'date') {
        metricDetails = `
          <div class="col-metric"><strong>Earliest:</strong> ${(col.minDate || '').slice(0, 10)}</div>
          <div class="col-metric"><strong>Latest:</strong> ${(col.maxDate || '').slice(0, 10)}</div>
          <div class="col-metric"><strong>Span:</strong> ${col.durationDays ?? '—'} days</div>
        `;
      } else if (col.topValues && col.topValues.length > 0) {
        const top3 = col.topValues.slice(0, 3).map(v => `${this._esc(v.value)} (${v.count})`).join(', ');
        metricDetails = `<div class="col-metric"><strong>Top values:</strong> ${top3}</div>`;
      }

      const samples = col.sampleValues.map(v => `<span class="sample-pill">${this._esc(String(v))}</span>`).join('');

      return `
        <div class="column-card">
          <div class="column-card-header">
            <div class="column-title">
              <span class="column-name">${this._esc(col.name)}</span>
              <span class="badge ${typeBadgeClass}">${col.inferredType}</span>
              ${col.isPrimaryKeyCandidate ? '<span class="badge badge-pk">PK Candidate</span>' : ''}
            </div>
            <div class="column-stats-pill">
              <span>Nulls: <strong style="color:${nullColor}">${col.nullCount} (${col.nullPercentage}%)</strong></span>
              <span>Unique: <strong>${col.distinctCount.toLocaleString()}</strong> (${(col.uniquenessRatio * 100).toFixed(1)}%)</span>
            </div>
          </div>
          <div class="column-metrics-grid">
            ${metricDetails}
          </div>
          <div class="sample-container">
            <span style="font-size:11px; opacity:0.7; margin-right:4px;">Samples:</span>
            ${samples || '<span style="font-size:11px; opacity:0.5;">None</span>'}
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 20px;
    margin: 0;
    box-sizing: border-box;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .title-group h2 { margin: 0 0 4px 0; font-size: 18px; }
  .title-group .meta { font-size: 12px; opacity: 0.8; }
  .btn-group { display: flex; gap: 8px; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 12px;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
  }
  .summary-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }
  .summary-card {
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 4px;
    padding: 10px 14px;
  }
  .summary-card .label { font-size: 11px; opacity: 0.7; text-transform: uppercase; }
  .summary-card .value { font-size: 20px; font-weight: bold; margin-top: 4px; }
  .column-card {
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 4px;
    padding: 12px 14px;
    margin-bottom: 10px;
  }
  .column-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .column-name { font-weight: 600; font-size: 14px; margin-right: 8px; }
  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge-integer, .badge-float { background: #005f73; color: #fff; }
  .badge-string { background: #2b9348; color: #fff; }
  .badge-datetime, .badge-date { background: #9d0208; color: #fff; }
  .badge-boolean { background: #e09f3e; color: #fff; }
  .badge-json { background: #7209b7; color: #fff; }
  .badge-pk { background: #0077b6; color: #fff; }
  .column-stats-pill { font-size: 12px; display: flex; gap: 14px; opacity: 0.9; }
  .column-metrics-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 12px;
    margin: 8px 0;
    padding: 6px 0;
    border-top: 1px dashed var(--vscode-widget-border, #333);
    border-bottom: 1px dashed var(--vscode-widget-border, #333);
  }
  .sample-container { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .sample-pill {
    background: var(--vscode-badge-background, #444);
    color: var(--vscode-badge-foreground, #fff);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <div style="display: flex; align-items: center; gap: 8px;">
        <h2 style="margin: 0; font-size: 19px; font-weight: 700;">📊 ${this._esc(p.fileName)}</h2>
        <span style="background: rgba(78, 201, 176, 0.15); color: #4ec9b0; border: 1px solid rgba(78, 201, 176, 0.4); padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">PROFILER</span>
      </div>
      <div class="meta" style="margin-top: 4px;">Built by <a href="https://www.evolveminds.com.au/" style="color: var(--vscode-textLink-foreground, #4ec9b0); text-decoration: underline; font-weight: 600;">Evolve Mind Solutions Pty Ltd</a> &bull; 100% Offline Profile generated at ${this._esc(new Date(p.generatedAt).toLocaleTimeString())}</div>
    </div>
    <div class="btn-group">
      <button onclick="post('exportDbt')">Export dbt Tests</button>
      <button class="secondary" onclick="post('exportGE')">Export Great Expectations</button>
      <button class="secondary" onclick="post('exportMd')">Export Markdown</button>
    </div>
  </div>

  <div class="summary-cards">
    <div class="summary-card">
      <div class="label">Total Rows</div>
      <div class="value">${p.totalRows.toLocaleString()}</div>
    </div>
    <div class="summary-card">
      <div class="label">Columns</div>
      <div class="value">${p.totalColumns}</div>
    </div>
    <div class="summary-card">
      <div class="label">File Size</div>
      <div class="value">${sizeKB} KB</div>
    </div>
    <div class="summary-card">
      <div class="label">Quality Alerts</div>
      <div class="value" style="color:${p.anomaliesSummary.length > 0 ? 'var(--vscode-charts-yellow, #cca700)' : 'var(--vscode-charts-green, #89d185)'}">${p.anomaliesSummary.length}</div>
    </div>
  </div>

  ${anomaliesHtml ? `<div style="margin-bottom:16px;">${anomaliesHtml}</div>` : ''}

  <h3 style="font-size:14px; margin: 16px 0 10px 0;">Columns (${p.columns.length})</h3>
  <div class="column-list">
    ${columnsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function post(type) { vscode.postMessage({ type }); }
  </script>
</body>
</html>`;
  }

  private _esc(s: string): string {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
