/**
 * ui/workbenchPanel.ts — Interactive Cron & Regex Workbench Panel
 *
 * 100% self-contained offline Webview. Zero external dependencies.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import { CronRegexWorkbench, CronEvaluation, RegexEvaluation } from '../offline/cronRegexWorkbench';

export class WorkbenchPanel {
  private static _instance: WorkbenchPanel | null = null;

  static show(svc: IServices, initialTab: 'cron' | 'regex' = 'cron'): void {
    if (!this._instance) {
      this._instance = new WorkbenchPanel(svc);
    }
    this._instance._reveal(initialTab);
  }

  private readonly _panel: vscode.WebviewPanel;
  private _activeTab: 'cron' | 'regex' = 'cron';
  private _cronInput = '*/15 4 * * 1-5';
  private _regexPattern = '(\\d{4})-(\\d{2})-(\\d{2})';
  private _regexFlags = 'gi';
  private _regexTestText = 'Event logged at 2026-08-25 and completed at 2026-08-26.';

  private constructor(private readonly _svc: IServices) {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.workbench',
      'Evolve AI: Offline Dev Workbench',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this._panel.onDidDispose(() => {
      WorkbenchPanel._instance = null;
    });

    this._panel.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'evalCron') {
        this._cronInput = msg.value;
        this._activeTab = 'cron';
        this._render();
      } else if (msg?.type === 'evalRegex') {
        this._regexPattern = msg.pattern;
        this._regexFlags = msg.flags;
        this._regexTestText = msg.text;
        this._activeTab = 'regex';
        this._render();
      } else if (msg?.type === 'setTab') {
        this._activeTab = msg.tab;
        this._render();
      }
    });
  }

  private _reveal(tab: 'cron' | 'regex'): void {
    this._activeTab = tab;
    this._panel.reveal(vscode.ViewColumn.Beside);
    this._render();
  }

  private _render(): void {
    const cronEval = CronRegexWorkbench.evaluateCron(this._cronInput);
    const regexEval = CronRegexWorkbench.evaluateRegex(this._regexPattern, this._regexFlags, this._regexTestText);
    this._panel.webview.html = this._getHtml(cronEval, regexEval);
  }

  private _getHtml(cron: CronEvaluation, regex: RegexEvaluation): string {
    const cronNextHtml = cron.nextRuns.map(r => `<li style="padding:3px 0; font-family:monospace;">${this._esc(r)}</li>`).join('');
    const cronPrevHtml = cron.previousRuns.map(r => `<li style="padding:3px 0; font-family:monospace;">${this._esc(r)}</li>`).join('');

    const regexMatchesHtml = regex.matches.map((m, idx) => {
      const groups = m.groups.length > 0
        ? `<div style="font-size:11px; opacity:0.8; margin-top:3px;">Groups: ${m.groups.map((g, gi) => `<code>$${gi + 1}: ${this._esc(g)}</code>`).join(' &bull; ')}</div>`
        : '';
      return `
        <div style="background:var(--vscode-editorWidget-background, #252526); border:1px solid var(--vscode-widget-border, #333); border-radius:4px; padding:8px 12px; margin-bottom:6px;">
          <div style="font-weight:600; font-size:13px;">Match #${idx + 1}: <code style="color:var(--vscode-charts-green, #89d185); font-size:13px;">"${this._esc(m.match)}"</code> (Index: ${m.index})</div>
          ${groups}
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
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
    margin-bottom: 16px;
  }
  .tab {
    padding: 8px 16px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
  }
  .tab.active {
    border-bottom: 2px solid var(--vscode-button-background);
    color: var(--vscode-button-background);
  }
  input, textarea {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    padding: 8px 10px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    box-sizing: border-box;
  }
  input:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
  }
  label { font-size: 12px; font-weight: 600; margin-bottom: 4px; display: block; opacity: 0.9; }
  .form-group { margin-bottom: 14px; }
  .card {
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 4px;
    padding: 12px 16px;
    margin-bottom: 14px;
  }
  .alert-box {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border-left: 3px solid var(--vscode-inputValidation-errorBorder, #be1100);
    padding: 8px 12px;
    border-radius: 3px;
    font-size: 12px;
    margin-bottom: 12px;
  }
</style>
</head>
<body>
  <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--vscode-widget-border, #333); padding-bottom:10px; margin-bottom:14px;">
    <div>
      <div style="display:flex; align-items:center; gap:8px;">
        <h2 style="margin:0; font-size:18px; font-weight:700;">🛠️ Offline Dev Workbench</h2>
        <span style="background:rgba(78,201,176,0.15); color:#4ec9b0; border:1px solid rgba(78,201,176,0.4); padding:2px 8px; border-radius:12px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">STUDIO</span>
      </div>
      <div style="font-size:11.5px; opacity:0.8; margin-top:3px;">Built by <a href="https://www.evolveminds.com.au/" style="color:var(--vscode-textLink-foreground, #4ec9b0); text-decoration:underline; font-weight:600;">Evolve Mind Solutions Pty Ltd</a> &bull; 100% Air-Gapped Cron Parser &amp; Regex Engine</div>
    </div>
  </div>

  <div class="tabs">
    <div class="tab ${this._activeTab === 'cron' ? 'active' : ''}" onclick="setTab('cron')">⏱️ Cron Schedule Visualizer</div>
    <div class="tab ${this._activeTab === 'regex' ? 'active' : ''}" onclick="setTab('regex')">🔍 Regex Tester</div>
  </div>

  <!-- CRON TAB -->
  <div id="cronSection" style="display:${this._activeTab === 'cron' ? 'block' : 'none'};">
    <div class="form-group">
      <label>Cron Expression or Airflow Preset</label>
      <input type="text" id="cronInput" value="${this._esc(this._cronInput)}" oninput="onCronChange(this.value)" placeholder="e.g. */15 4 * * 1-5 or @daily" />
      <div style="font-size:11px; opacity:0.7; margin-top:4px;">Supports standard 5/6-field crons, steps (*/N), ranges (1-5), named days (MON-FRI), and Airflow presets (@daily, @hourly).</div>
    </div>

    ${cron.error ? `<div class="alert-box"><strong>Error:</strong> ${this._esc(cron.error)}</div>` : ''}

    ${cron.isValid ? `
      <div class="card">
        <div style="font-size:11px; opacity:0.7; text-transform:uppercase;">Natural Language Description</div>
        <div style="font-size:15px; font-weight:600; color:var(--vscode-charts-green, #89d185); margin-top:4px;">
          ${this._esc(cron.humanDescription)}
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:14px;">
        <div class="card">
          <div style="font-size:12px; font-weight:600; margin-bottom:8px;">Upcoming Execution Runs (UTC)</div>
          <ul style="margin:0; padding-left:18px; font-size:12px;">${cronNextHtml}</ul>
        </div>
        <div class="card">
          <div style="font-size:12px; font-weight:600; margin-bottom:8px;">Previous Execution Runs (UTC)</div>
          <ul style="margin:0; padding-left:18px; font-size:12px;">${cronPrevHtml}</ul>
        </div>
      </div>
    ` : ''}
  </div>

  <!-- REGEX TAB -->
  <div id="regexSection" style="display:${this._activeTab === 'regex' ? 'block' : 'none'};">
    <div style="display:grid; grid-template-columns: 3fr 1fr; gap:10px;" class="form-group">
      <div>
        <label>Regular Expression Pattern</label>
        <input type="text" id="regexPattern" value="${this._esc(this._regexPattern)}" oninput="onRegexChange()" placeholder="e.g. (\\d{4})-(\\d{2})-(\\d{2})" />
      </div>
      <div>
        <label>Flags</label>
        <input type="text" id="regexFlags" value="${this._esc(this._regexFlags)}" oninput="onRegexChange()" placeholder="gims" />
      </div>
    </div>

    <div class="form-group">
      <label>Test Text</label>
      <textarea id="regexText" rows="4" oninput="onRegexChange()">${this._esc(this._regexTestText)}</textarea>
    </div>

    ${regex.error ? `<div class="alert-box"><strong>Syntax Error:</strong> ${this._esc(regex.error)}</div>` : ''}

    <div class="card" style="margin-bottom:12px;">
      <div style="font-size:13px;">
        Matches Found: <strong style="color:var(--vscode-charts-green, #89d185);">${regex.totalMatches}</strong>
      </div>
    </div>

    <div>
      ${regexMatchesHtml || '<div style="font-size:12px; opacity:0.6;">No matches found for current pattern.</div>'}
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function setTab(tab) { vscode.postMessage({ type: 'setTab', tab }); }
    function onCronChange(value) { vscode.postMessage({ type: 'evalCron', value }); }
    function onRegexChange() {
      const pattern = document.getElementById('regexPattern').value;
      const flags = document.getElementById('regexFlags').value;
      const text = document.getElementById('regexText').value;
      vscode.postMessage({ type: 'evalRegex', pattern, flags, text });
    }
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
