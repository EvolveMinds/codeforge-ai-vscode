/**
 * ui/dataAnalysisPanel.ts — Data Analysis entry panel
 *
 * A single lazy-created webview that is the friendly front door to the Data
 * Analysis & Reporting plugin. It solves the "how do I feed my data?" problem:
 * instead of silently guessing the data is in the workspace, it presents every
 * way to provide data, up front:
 *   - Browse for a file…            (native dialog — data can be anywhere)
 *   - Drag & drop a file onto the panel
 *   - Pick a data file already in the workspace (filtered to real data files)
 *   - Connect a database or cloud source
 *   - Run a data pipeline
 * …plus the four deliverables (Insights / Report / Notebook / Profile) and an
 * optional focus/instruction.
 *
 * The panel is presentation only. It posts typed messages; the plugin
 * (DataAnalysisPlugin) owns the handler and routes them to the real flows.
 */

import * as vscode from 'vscode';

export interface WorkspaceDataFile {
  /** Absolute path */
  path: string;
  /** Workspace-relative label */
  rel: string;
}

/** Messages the panel posts to its host handler. */
export type PanelMessage =
  | { type: 'browse' }
  | { type: 'useWorkspaceFile'; path: string }
  | { type: 'connectSource' }
  | { type: 'runPipeline' }
  | { type: 'droppedFile'; path: string }
  | { type: 'dropFallback' }
  | { type: 'setDeliverable'; deliverable: string }
  | { type: 'setFocus'; focus: string }
  | { type: 'analyze' };

export class DataAnalysisPanel {
  private static _instance: DataAnalysisPanel | null = null;

  /** Open (or reveal) the panel. `onMessage` handles user actions. */
  static show(
    workspaceFiles: WorkspaceDataFile[],
    onMessage: (msg: PanelMessage) => void | Promise<void>,
  ): DataAnalysisPanel {
    if (!this._instance) this._instance = new DataAnalysisPanel();
    this._instance._onMessage = onMessage;
    this._instance._files = workspaceFiles;
    this._instance._reveal();
    return this._instance;
  }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _files: WorkspaceDataFile[] = [];
  private _onMessage: (msg: PanelMessage) => void | Promise<void> = () => {};

  private constructor() {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.dataAnalysis',
      'Evolve AI: Data Analysis',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this._panel.webview.onDidReceiveMessage((msg: PanelMessage) => this._onMessage(msg));
    this._panel.onDidDispose(() => {
      this._disposed = true;
      DataAnalysisPanel._instance = null;
    });
  }

  /** Update the selected-source line shown in the panel after a file is chosen. */
  setSelected(label: string | null): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'selected', label });
  }

  /** Show a transient status/notice line in the panel. */
  setStatus(text: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'status', text });
  }

  reveal(): void { this._reveal(); }

  private _reveal(): void {
    if (this._disposed) return;
    this._panel.webview.html = this._html();
    this._panel.reveal();
  }

  private _html(): string {
    const files = this._files.slice(0, 100);
    const fileRows = files.length
      ? files.map(f =>
          `<button class="wsfile" data-path="${escAttr(f.path)}" title="${escAttr(f.path)}">` +
          `<span class="ico">📄</span><span class="rel">${escHtml(f.rel)}</span></button>`
        ).join('')
      : `<div class="muted">No data files found in the open workspace. Use <strong>Browse</strong> above, or drag a file onto this panel.</div>`;

    const nonce = 'a1b2c3d4e5';
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
      :root { color-scheme: light dark; }
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px 24px; max-width: 720px; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 18px; }
      h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); margin: 20px 0 8px; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; }
      .card { flex: 1 1 200px; text-align: left; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
        border: 1px solid var(--vscode-widget-border, transparent); border-radius: 8px; padding: 12px 14px; cursor: pointer; }
      .card:hover { background: var(--vscode-list-hoverBackground); }
      .card .t { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
      .card .d { font-size: 11px; color: var(--vscode-descriptionForeground); }
      #drop { border: 1.5px dashed var(--vscode-widget-border, #8888); border-radius: 8px; padding: 22px; text-align: center;
        color: var(--vscode-descriptionForeground); font-size: 13px; margin-top: 10px; }
      #drop.over { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
      .wsfiles { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
      .wsfile { display: flex; align-items: center; gap: 8px; text-align: left; background: transparent; color: var(--vscode-foreground);
        border: none; border-radius: 4px; padding: 6px 8px; cursor: pointer; font-size: 12px; }
      .wsfile:hover { background: var(--vscode-list-hoverBackground); }
      .wsfile.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
      .wsfile .rel { font-family: var(--vscode-editor-font-family); }
      .muted { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 8px 2px; }
      #selected { margin: 14px 0 4px; font-size: 13px; }
      #selected .pill { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; font-family: var(--vscode-editor-font-family); }
      .deliv { display: flex; gap: 8px; flex-wrap: wrap; }
      .deliv button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
        border: 1px solid transparent; border-radius: 999px; padding: 6px 14px; font-size: 12px; cursor: pointer; }
      .deliv button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      #focus { width: 100%; box-sizing: border-box; margin-top: 10px; padding: 8px 10px; font-size: 13px; border-radius: 6px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
      #go { margin-top: 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none;
        padding: 9px 20px; font-size: 13px; font-weight: 600; border-radius: 6px; cursor: pointer; }
      #go:disabled { opacity: .5; cursor: default; }
      #status { margin-top: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); min-height: 16px; }
    </style></head><body>
      <h1>📊 Data Analysis</h1>
      <p class="sub">Point Evolve AI at your data — a file anywhere on your machine, a file in this project, or a database / cloud source — then pick what to build.</p>

      <h2>1 · Choose your data</h2>
      <div class="row">
        <button class="card" id="browse"><div class="t">📁 Browse for a file…</div><div class="d">CSV, Excel, JSON, Parquet — from anywhere on your computer</div></button>
        <button class="card" id="connect"><div class="t">🗄️ Database or cloud source</div><div class="d">BigQuery, Databricks, Cosmos, DynamoDB, S3/GCS/Blob, SQL</div></button>
        <button class="card" id="pipeline"><div class="t">▶️ Run a data pipeline</div><div class="d">A saved multi-step analysis (evolve-data-pipeline.json)</div></button>
      </div>
      <div id="drop">…or drag &amp; drop a data file here</div>

      <h2>Or use a file from this workspace</h2>
      <div class="wsfiles" id="wsfiles">${fileRows}</div>

      <div id="selected"></div>

      <h2>2 · What to build</h2>
      <div class="deliv" id="deliv">
        <button data-d="insights" class="on">💬 Insights in chat</button>
        <button data-d="report">📈 HTML report</button>
        <button data-d="notebook">📓 Notebook / script</button>
        <button data-d="profile">📋 Profiling summary</button>
      </div>
      <input id="focus" type="text" placeholder="Optional: what should the analysis focus on? e.g. 'revenue trends by region'" />

      <button id="go" disabled>Analyse →</button>
      <div id="status"></div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let deliverable = 'insights';
        let hasSource = false;

        function post(m){ vscode.postMessage(m); }
        function refreshGo(){ document.getElementById('go').disabled = !hasSource; }

        document.getElementById('browse').onclick   = () => post({ type:'browse' });
        document.getElementById('connect').onclick  = () => post({ type:'connectSource' });
        document.getElementById('pipeline').onclick = () => post({ type:'runPipeline' });

        document.querySelectorAll('#wsfiles .wsfile').forEach(b => b.onclick = () => {
          document.querySelectorAll('#wsfiles .wsfile').forEach(x => x.classList.remove('sel'));
          b.classList.add('sel');
          post({ type:'useWorkspaceFile', path: b.getAttribute('data-path') });
        });

        document.querySelectorAll('#deliv button').forEach(b => b.onclick = () => {
          document.querySelectorAll('#deliv button').forEach(x => x.classList.remove('on'));
          b.classList.add('on');
          deliverable = b.getAttribute('data-d');
          post({ type:'setDeliverable', deliverable });
        });

        document.getElementById('focus').addEventListener('input', e => post({ type:'setFocus', focus: e.target.value }));
        document.getElementById('go').onclick = () => post({ type:'analyze' });

        // Drag & drop
        const drop = document.getElementById('drop');
        ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => {
          const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          // Some VS Code builds expose a real filesystem path on dropped files;
          // many don't (webview sandbox). If we don't get a usable path, fall
          // back to Browse rather than silently doing nothing.
          const p = f && f.path;
          if (p) post({ type:'droppedFile', path: p });
          else post({ type:'dropFallback' });
        });

        // Host → panel updates
        window.addEventListener('message', e => {
          const m = e.data;
          if (m.type === 'selected') {
            const el = document.getElementById('selected');
            el.textContent = '';
            if (m.label) {
              el.appendChild(document.createTextNode('Selected: '));
              const pill = document.createElement('span');
              pill.className = 'pill';
              pill.textContent = m.label;       // safe: no innerHTML, filename can't inject markup
              el.appendChild(pill);
              hasSource = true;
            } else { hasSource = false; }
            refreshGo();
          } else if (m.type === 'status') {
            document.getElementById('status').textContent = m.text || '';
          }
        });
      </script>
    </body></html>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]!));
}
function escAttr(s: string): string { return escHtml(s).replace(/`/g, '&#96;'); }
