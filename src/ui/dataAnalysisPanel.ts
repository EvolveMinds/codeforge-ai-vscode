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

/** Report shape chosen in the panel's "Report options" section. */
export interface PanelReportOptions {
  archetype: string;
  audience:  string;
  sections:  string[];
  mode:      string;
  accent:    string;
  title:     string;
}

/**
 * The catalogues the options form is built from. Passed in rather than
 * hard-coded here so `core/reportDesign.ts` stays the single source of truth
 * for archetypes and sections.
 */
export interface ReportOptionsCatalog {
  archetypes: Array<{ id: string; label: string; description: string; sections: string[] }>;
  sections:   Array<{ id: string; label: string }>;
  audiences:  Array<{ id: string; label: string }>;
  defaults:   PanelReportOptions;
  /** Block kinds for the outline builder's "add block" menu. */
  blockKinds: BlockKindOption[];
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
  | { type: 'setReportOptions'; options: PanelReportOptions }
  /** The authored block outline + data-prep steps, pushed on every change. */
  | { type: 'setBuilder'; outline: unknown[]; prep: PanelPrep }
  | { type: 'useTemplate' }
  | { type: 'editTheme' }
  | { type: 'analyze' }
  | { type: 'cancelAnalyze' };

/** Data-prep steps as collected by the panel. */
export interface PanelPrep {
  filters: Array<{ column: string; op: string; value: string; value2?: string }>;
  derived: Array<{ name: string; expression: string }>;
  excludeColumns: string[];
  dedupe: boolean;
  limit: number;
}

/** A column offered in the builder's pickers, from the sniffed schema. */
export interface SchemaColumn {
  name: string;
  /** integer | number | date | boolean | string | empty */
  type: string;
}

/** The block kinds offered in the "add block" menu, from core/reportBlocks.ts. */
export interface BlockKindOption {
  type: string;
  label: string;
  icon: string;
}

export class DataAnalysisPanel {
  private static _instance: DataAnalysisPanel | null = null;

  /** Open (or reveal) the panel. `onMessage` handles user actions. */
  static show(
    workspaceFiles: WorkspaceDataFile[],
    catalog: ReportOptionsCatalog,
    onMessage: (msg: PanelMessage) => void | Promise<void>,
  ): DataAnalysisPanel {
    if (!this._instance) this._instance = new DataAnalysisPanel();
    this._instance._onMessage = onMessage;
    this._instance._files = workspaceFiles;
    this._instance._catalog = catalog;
    this._instance._reveal();
    return this._instance;
  }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _files: WorkspaceDataFile[] = [];
  private _catalog: ReportOptionsCatalog = {
    archetypes: [], sections: [], audiences: [], blockKinds: [],
    defaults: { archetype: '', audience: '', sections: [], mode: 'auto', accent: '#4f6df5', title: '' },
  };
  private _onMessage: (msg: PanelMessage) => void | Promise<void> = () => {};

  /**
   * Push the sniffed schema so the builder's pickers offer real column names
   * instead of asking the user to type them. Called whenever a file is chosen.
   */
  setSchema(columns: SchemaColumn[]): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'schema', columns });
  }

  /** Load a saved template's outline + prep into the builder controls. */
  loadBuilder(outline: unknown[], prep: PanelPrep | unknown): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'loadBuilder', outline, prep });
  }

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

  /** Enter/leave the "generating" state. Pass a message to enter, null to leave. */
  setBusy(message: string | null): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'busy', message });
  }

  /** Update the elapsed-seconds ticker shown while generating. */
  setElapsed(secs: number): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'elapsed', secs });
  }

  /** Show a contextual hint (e.g. faster-provider tip). Empty string clears it. */
  setHint(text: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'hint', text });
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

    const cat = this._catalog;
    const d   = cat.defaults;
    const archOptions = cat.archetypes
      .map(a => `<option value="${escAttr(a.id)}"${a.id === d.archetype ? ' selected' : ''}>${escHtml(a.label)}</option>`)
      .join('');
    const audienceOptions = cat.audiences
      .map(a => `<option value="${escAttr(a.id)}"${a.id === d.audience ? ' selected' : ''}>${escHtml(a.label)}</option>`)
      .join('');
    const sectionChips = cat.sections
      .map(s => `<button data-s="${escAttr(s.id)}"${d.sections.includes(s.id) ? ' class="on"' : ''}>${escHtml(s.label)}</button>`)
      .join('');
    // The client script needs the archetype → default-sections map to reset the
    // chips when the format changes.
    const archData = JSON.stringify(
      cat.archetypes.map(a => ({ id: a.id, sections: a.sections, description: a.description })));
    const blockKindOptions = cat.blockKinds
      .map(k => `<option value="${escAttr(k.type)}">${escHtml(`${k.icon}  ${k.label}`)}</option>`)
      .join('');
    const blockIcons = Object.fromEntries(cat.blockKinds.map(k => [k.type, k.icon]));

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
      #cancel { margin-top: 16px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
        border: none; padding: 9px 20px; font-size: 13px; border-radius: 6px; cursor: pointer; }
      .hint { margin-top: 12px; font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.5; min-height: 0; }
      #busy { margin-top: 14px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
      #busy #busymsg { color: var(--vscode-foreground); }
      .spin { width: 12px; height: 12px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent;
        border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite; flex: 0 0 auto; }
      @keyframes spin { to { transform: rotate(360deg); } }
      #status { margin-top: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); min-height: 16px; }
      /* Report options */
      #reportopts { margin-top: 6px; }
      .optrow { display: flex; align-items: center; gap: 10px; margin-top: 9px; flex-wrap: wrap; }
      .optrow > label { flex: 0 0 92px; font-size: 12px; color: var(--vscode-descriptionForeground); }
      .optrow select, .optrow input[type=text] {
        flex: 1 1 200px; padding: 6px 9px; font: inherit; font-size: 12.5px; border-radius: 6px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, transparent);
      }
      .optrow input[type=color] {
        width: 34px; height: 28px; padding: 0; border-radius: 6px; cursor: pointer;
        background: transparent; border: 1px solid var(--vscode-input-border, #8884);
      }
      .opthint { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 3px 0 0 102px; }
      .secs { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 0 102px; }
      .secs button {
        padding: 4px 10px; font-size: 11.5px; border-radius: 999px; cursor: pointer;
        background: transparent; color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-widget-border, #8884);
      }
      .secs button.on {
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
        border-color: transparent;
      }
      .themelink { background: none; border: none; padding: 0; font-size: 11px; cursor: pointer;
        color: var(--vscode-textLink-foreground); }
      .themelink:hover { text-decoration: underline; }
      /* Block outline builder + data prep */
      details { margin-top: 12px; border-top: 1px solid var(--vscode-widget-border, #8883); padding-top: 9px; }
      details > summary {
        cursor: pointer; font-size: 12px; font-weight: 600; color: var(--vscode-foreground);
        list-style: none; display: flex; align-items: center; gap: 8px;
      }
      details > summary::-webkit-details-marker { display: none; }
      details > summary::before { content: "▸"; color: var(--vscode-descriptionForeground); font-size: 10px; }
      details[open] > summary::before { content: "▾"; }
      .tag {
        font-size: 10.5px; font-weight: 500; padding: 1px 7px; border-radius: 999px;
        background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      }
      .tag:empty { display: none; }
      .blk {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        padding: 7px 9px; margin-top: 6px; border-radius: 7px;
        background: var(--vscode-list-hoverBackground);
        border: 1px solid var(--vscode-widget-border, #8883);
      }
      .blk .ico { font-size: 12px; opacity: .8; width: 14px; text-align: center; }
      .blk .name { font-size: 12px; font-weight: 600; min-width: 74px; }
      .blk select, .blk input {
        padding: 3px 6px; font: inherit; font-size: 11.5px; border-radius: 5px; max-width: 150px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, #8884);
      }
      .blk input[type=number] { width: 62px; }
      .blk .grow { flex: 1 1 auto; }
      .blk .ops { display: flex; gap: 2px; margin-left: auto; }
      .blk .ops button {
        background: none; border: none; cursor: pointer; font-size: 12px; padding: 2px 5px; border-radius: 4px;
        color: var(--vscode-descriptionForeground);
      }
      .blk .ops button:hover { background: var(--vscode-toolbar-hoverBackground, #8882); color: var(--vscode-foreground); }
      .blk .ops button.del:hover { color: var(--vscode-errorForeground, #f14c4c); }
      .addrow { display: flex; align-items: center; gap: 7px; margin-top: 9px; flex-wrap: wrap; }
      .addrow .sep { flex: 1 1 auto; }
      .mini {
        padding: 4px 10px; font-size: 11.5px; border-radius: 6px; cursor: pointer;
        background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
        border: 1px solid transparent;
      }
      .mini:hover { filter: brightness(1.12); }
      .addrow select, .addrow input[type=number] {
        padding: 4px 8px; font: inherit; font-size: 11.5px; border-radius: 6px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, #8884);
      }
      .addrow input[type=number] { width: 74px; }
      .chk { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--vscode-descriptionForeground); }
      .tplrow { margin-top: 12px; }
      .coltype { opacity: .55; font-size: 10px; margin-left: 3px; }
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

      <div id="reportopts" style="display:none;">
        <h2>3 · Report options</h2>
        <div class="optrow">
          <label for="arch">Format</label>
          <select id="arch">${archOptions}</select>
        </div>
        <div class="opthint" id="archhint"></div>
        <div class="optrow"><label>Sections</label></div>
        <div class="secs" id="secs">${sectionChips}</div>
        <div class="optrow">
          <label for="aud">Audience</label>
          <select id="aud">${audienceOptions}</select>
        </div>
        <div class="optrow">
          <label for="mode">Appearance</label>
          <select id="mode">
            <option value="auto">Match the reader's system theme</option>
            <option value="light">Always light (best for print/PDF)</option>
            <option value="dark">Always dark</option>
          </select>
          <input type="color" id="accent" value="${escAttr(d.accent)}" title="Accent colour" />
        </div>
        <div class="opthint">
          Accent drives links, KPI bars and the first chart series.
          <button class="themelink" id="edittheme">Save brand defaults for every report →</button>
        </div>
        <div class="optrow">
          <label for="title">Title</label>
          <input id="title" type="text" placeholder="Leave blank to name it after the dataset" />
        </div>

        <details id="builder">
          <summary>Build the report block by block <span class="tag" id="blockcount"></span></summary>
          <p class="opthint">
            Compose the exact report you want. Anything left on <em>auto</em> is still chosen for you —
            pin only what you care about. This replaces the section chips above.
          </p>
          <div id="outline"></div>
          <div class="addrow">
            <select id="addkind">${blockKindOptions}</select>
            <button class="mini" id="addblock">+ Add block</button>
            <span class="sep"></span>
            <button class="mini" id="clearblocks">Use sections instead</button>
          </div>
        </details>

        <details id="prepbox">
          <summary>Prepare the data first <span class="tag" id="prepcount"></span></summary>
          <p class="opthint">
            Filters run for real before anything is analysed — deterministically in the generated script,
            and on the sample for small files. The report discloses them so a filtered figure is never
            read as a total.
          </p>
          <div id="filters"></div>
          <div class="addrow">
            <button class="mini" id="addfilter">+ Add filter</button>
            <button class="mini" id="addderived">+ Derived column</button>
            <span class="sep"></span>
            <label class="chk"><input type="checkbox" id="dedupe" /> Drop duplicate rows</label>
            <label class="chk">Row limit <input type="number" id="rowlimit" min="0" step="100" placeholder="0" /></label>
          </div>
          <div id="derived"></div>
          <div class="optrow"><label>Exclude columns</label></div>
          <div class="secs" id="excols"><span class="opthint">Choose a data file to list its columns.</span></div>
        </details>

        <div class="optrow tplrow">
          <button class="mini" id="usetpl">↺ Start from a saved template…</button>
        </div>
      </div>

      <div id="hint" class="hint"></div>
      <button id="go" disabled>Analyse →</button>
      <button id="cancel" style="display:none;">■ Cancel</button>
      <div id="busy" style="display:none;">
        <span class="spin"></span>
        <span id="busymsg"></span>
        <span id="elapsed" class="muted"></span>
      </div>
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
          document.getElementById('reportopts').style.display = deliverable === 'report' ? '' : 'none';
          post({ type:'setDeliverable', deliverable });
        });

        // ── Report options ────────────────────────────────────────────────
        const ARCHES = ${archData};
        const archSel = document.getElementById('arch');
        const audSel  = document.getElementById('aud');
        const modeSel = document.getElementById('mode');
        const accentEl = document.getElementById('accent');
        const titleEl = document.getElementById('title');
        const archHint = document.getElementById('archhint');

        function selectedSections() {
          return Array.prototype.slice
            .call(document.querySelectorAll('#secs button.on'))
            .map(b => b.getAttribute('data-s'));
        }
        function pushOptions() {
          post({ type:'setReportOptions', options: {
            archetype: archSel.value,
            audience:  audSel.value,
            sections:  selectedSections(),
            mode:      modeSel.value,
            accent:    accentEl.value,
            title:     titleEl.value.trim(),
          }});
        }
        function describeArch() {
          const a = ARCHES.filter(x => x.id === archSel.value)[0];
          archHint.textContent = a ? a.description : '';
        }
        archSel.onchange = () => {
          // A new format brings its own section list — reset the chips to it.
          const a = ARCHES.filter(x => x.id === archSel.value)[0];
          if (a) {
            document.querySelectorAll('#secs button').forEach(b =>
              b.classList.toggle('on', a.sections.indexOf(b.getAttribute('data-s')) !== -1));
          }
          describeArch();
          pushOptions();
        };
        document.querySelectorAll('#secs button').forEach(b => b.onclick = () => {
          b.classList.toggle('on');
          pushOptions();
        });
        [audSel, modeSel, accentEl].forEach(el => el.onchange = pushOptions);
        titleEl.addEventListener('input', pushOptions);
        document.getElementById('edittheme').onclick = () => post({ type:'editTheme' });
        describeArch();

        // ══ Block outline builder ═══════════════════════════════════════════
        // The panel owns the outline and prep; both travel with the run.
        let outline = [];
        let columns = [];                 // [{name, type}] from the sniffed schema
        let filters = [], derived = [];
        let nextId = 1;

        const NUMERIC = ['integer', 'number'];
        const AGGS = ['auto','sum','mean','median','count','min','max','nunique'];
        const CHARTS = ['auto','bar','barh','line','area','scatter','pie','histogram','box'];
        const ICONS = ${JSON.stringify(blockIcons)};

        const el = (tag, cls, text) => {
          const n = document.createElement(tag);
          if (cls) n.className = cls;
          if (text != null) n.textContent = text;
          return n;
        };
        function select(options, value, onChange, title) {
          const s = document.createElement('select');
          if (title) s.title = title;
          options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = typeof o === 'string' ? o : o.v;
            opt.textContent = typeof o === 'string' ? o : o.t;
            s.appendChild(opt);
          });
          s.value = value;
          s.onchange = () => { onChange(s.value); pushBuilder(); };
          return s;
        }
        const colOpts = (extra) => (extra || []).concat(columns.map(c => ({ v: c.name, t: c.name })));
        const numericColOpts = (extra) =>
          (extra || []).concat(columns.filter(c => NUMERIC.indexOf(c.type) !== -1).map(c => ({ v: c.name, t: c.name })));

        function renderOutline() {
          const host = document.getElementById('outline');
          host.textContent = '';
          if (!outline.length) {
            host.appendChild(el('p', 'opthint', 'No blocks yet — the section chips above decide the report. Add a block to take over.'));
          }
          outline.forEach((b, i) => {
            const row = el('div', 'blk');
            row.appendChild(el('span', 'ico', ICONS[b.type] || '▪'));
            row.appendChild(el('span', 'name', b.type));

            if (b.type === 'chart') {
              row.appendChild(select(
                [{v:'',t:'measure: auto'},{v:'count',t:'row count'}].concat(numericColOpts()),
                b.measure, v => b.measure = v, 'What to measure'));
              row.appendChild(select(
                [{v:'',t:'by: auto'}].concat(colOpts()),
                b.dimension, v => b.dimension = v, 'Split by'));
              row.appendChild(select(AGGS.map(a => ({v:a,t:a})), b.agg, v => b.agg = v, 'Aggregation'));
              row.appendChild(select(CHARTS.map(c => ({v:c,t:c})), b.chart, v => b.chart = v, 'Chart type'));
              const top = document.createElement('input');
              top.type = 'number'; top.min = '0'; top.value = b.topN; top.title = 'Top N groups (0 = all)';
              top.oninput = () => { b.topN = parseInt(top.value || '0', 10) || 0; pushBuilder(); };
              row.appendChild(top);
            } else if (b.type === 'table') {
              row.appendChild(select([{v:'',t:'sort: auto'}].concat(colOpts()), b.sortBy, v => b.sortBy = v, 'Sort by'));
              row.appendChild(select([{v:'desc',t:'desc'},{v:'asc',t:'asc'}], b.sortDir, v => b.sortDir = v));
              const mx = document.createElement('input');
              mx.type = 'number'; mx.min = '1'; mx.value = b.maxRows; mx.title = 'Maximum rows';
              mx.oninput = () => { b.maxRows = parseInt(mx.value || '100', 10) || 100; pushBuilder(); };
              row.appendChild(mx);
            } else if (b.type === 'text') {
              const t = document.createElement('input');
              t.type = 'text'; t.className = 'grow'; t.value = b.body;
              t.placeholder = 'Your own commentary — reproduced exactly, never reworded';
              t.oninput = () => { b.body = t.value; pushBuilder(); };
              row.appendChild(t);
            } else if (b.type === 'insights' || b.type === 'recommendations') {
              const c = document.createElement('input');
              c.type = 'number'; c.min = '0'; c.value = b.count; c.title = 'How many (0 = model decides)';
              c.oninput = () => { b.count = parseInt(c.value || '0', 10) || 0; pushBuilder(); };
              row.appendChild(c);
            } else if (b.type === 'kpi') {
              row.appendChild(el('span', 'opthint', 'headline numbers chosen for you'));
            }

            const ops = el('div', 'ops');
            const mk = (label, title, cls, fn) => {
              const btn = el('button', cls, label);
              btn.title = title;
              btn.onclick = fn;
              return btn;
            };
            ops.appendChild(mk('↑', 'Move up', '', () => {
              if (i > 0) { const t = outline[i-1]; outline[i-1] = outline[i]; outline[i] = t; renderOutline(); pushBuilder(); }
            }));
            ops.appendChild(mk('↓', 'Move down', '', () => {
              if (i < outline.length-1) { const t = outline[i+1]; outline[i+1] = outline[i]; outline[i] = t; renderOutline(); pushBuilder(); }
            }));
            ops.appendChild(mk('✕', 'Remove', 'del', () => {
              outline.splice(i, 1); renderOutline(); pushBuilder();
            }));
            row.appendChild(ops);
            host.appendChild(row);
          });
          document.getElementById('blockcount').textContent = outline.length ? outline.length + ' blocks' : '';
        }

        document.getElementById('addblock').onclick = () => {
          const type = document.getElementById('addkind').value;
          const b = { id: 'p' + (nextId++), type };
          if (type === 'chart') { b.chart='auto'; b.measure=''; b.dimension=''; b.agg='auto'; b.topN=10; b.sort='desc'; b.grain='auto'; }
          else if (type === 'table') { b.columns=[]; b.sortBy=''; b.sortDir='desc'; b.maxRows=100; }
          else if (type === 'text') { b.body=''; }
          else if (type === 'kpi') { b.metrics=[]; }
          else if (type === 'insights' || type === 'recommendations') { b.count=0; }
          outline.push(b);
          renderOutline();
          pushBuilder();
        };
        document.getElementById('clearblocks').onclick = () => {
          outline = []; renderOutline(); pushBuilder();
        };

        // ══ Data preparation ════════════════════════════════════════════════
        const OPS = [
          {v:'eq',t:'is'},{v:'ne',t:'is not'},{v:'gt',t:'>'},{v:'gte',t:'≥'},{v:'lt',t:'<'},{v:'lte',t:'≤'},
          {v:'contains',t:'contains'},{v:'notContains',t:'does not contain'},
          {v:'in',t:'is one of'},{v:'notIn',t:'is not one of'},
          {v:'isNull',t:'is empty'},{v:'notNull',t:'is not empty'},{v:'between',t:'between'},
        ];
        function renderPrep() {
          const fh = document.getElementById('filters');
          fh.textContent = '';
          filters.forEach((f, i) => {
            const row = el('div', 'blk');
            row.appendChild(el('span', 'ico', '⧩'));
            row.appendChild(select(colOpts([{v:'',t:'column…'}]), f.column, v => f.column = v));
            row.appendChild(select(OPS, f.op, v => { f.op = v; renderPrep(); }));
            if (f.op !== 'isNull' && f.op !== 'notNull') {
              const val = document.createElement('input');
              val.type = 'text'; val.value = f.value; val.placeholder = f.op === 'in' || f.op === 'notIn' ? 'a, b, c' : 'value';
              val.oninput = () => { f.value = val.value; pushBuilder(); };
              row.appendChild(val);
              if (f.op === 'between') {
                const v2 = document.createElement('input');
                v2.type = 'text'; v2.value = f.value2 || ''; v2.placeholder = 'and';
                v2.oninput = () => { f.value2 = v2.value; pushBuilder(); };
                row.appendChild(v2);
              }
            }
            const ops = el('div', 'ops');
            const del = el('button', 'del', '✕');
            del.title = 'Remove filter';
            del.onclick = () => { filters.splice(i,1); renderPrep(); pushBuilder(); };
            ops.appendChild(del);
            row.appendChild(ops);
            fh.appendChild(row);
          });

          const dh = document.getElementById('derived');
          dh.textContent = '';
          derived.forEach((d, i) => {
            const row = el('div', 'blk');
            row.appendChild(el('span', 'ico', 'ƒ'));
            const nm = document.createElement('input');
            nm.type = 'text'; nm.value = d.name; nm.placeholder = 'new column';
            nm.oninput = () => { d.name = nm.value; pushBuilder(); };
            row.appendChild(nm);
            row.appendChild(el('span', 'opthint', '='));
            const ex = document.createElement('input');
            ex.type = 'text'; ex.className = 'grow'; ex.value = d.expression;
            ex.placeholder = 'revenue / orders';
            ex.oninput = () => { d.expression = ex.value; pushBuilder(); };
            row.appendChild(ex);
            const ops = el('div', 'ops');
            const del = el('button', 'del', '✕');
            del.title = 'Remove derived column';
            del.onclick = () => { derived.splice(i,1); renderPrep(); pushBuilder(); };
            ops.appendChild(del);
            row.appendChild(ops);
            dh.appendChild(row);
          });

          const n = filters.length + derived.length
            + (document.getElementById('dedupe').checked ? 1 : 0)
            + (parseInt(document.getElementById('rowlimit').value || '0', 10) ? 1 : 0)
            + excluded().length;
          document.getElementById('prepcount').textContent = n ? n + ' steps' : '';
        }
        function excluded() {
          return Array.prototype.slice.call(document.querySelectorAll('#excols button.on'))
            .map(b => b.getAttribute('data-c'));
        }
        document.getElementById('addfilter').onclick = () => {
          filters.push({ column: columns.length ? columns[0].name : '', op: 'eq', value: '' });
          renderPrep(); pushBuilder();
        };
        document.getElementById('addderived').onclick = () => {
          derived.push({ name: '', expression: '' });
          renderPrep(); pushBuilder();
        };
        document.getElementById('dedupe').onchange = () => { renderPrep(); pushBuilder(); };
        document.getElementById('rowlimit').oninput = () => { renderPrep(); pushBuilder(); };
        document.getElementById('usetpl').onclick = () => post({ type:'useTemplate' });

        function renderColumns() {
          const host = document.getElementById('excols');
          host.textContent = '';
          if (!columns.length) {
            host.appendChild(el('span', 'opthint', 'Choose a data file to list its columns.'));
            return;
          }
          columns.forEach(c => {
            const b = document.createElement('button');
            b.setAttribute('data-c', c.name);
            b.appendChild(document.createTextNode(c.name));
            const t = el('span', 'coltype', c.type);
            b.appendChild(t);
            b.onclick = () => { b.classList.toggle('on'); renderPrep(); pushBuilder(); };
            host.appendChild(b);
          });
        }

        function pushBuilder() {
          post({ type:'setBuilder',
            outline: outline,
            prep: {
              filters: filters.filter(f => f.column),
              derived: derived.filter(d => d.name && d.expression),
              excludeColumns: excluded(),
              dedupe: document.getElementById('dedupe').checked,
              limit: parseInt(document.getElementById('rowlimit').value || '0', 10) || 0,
            },
          });
        }
        renderOutline();
        renderPrep();

        document.getElementById('focus').addEventListener('input', e => post({ type:'setFocus', focus: e.target.value }));
        document.getElementById('go').onclick = () => post({ type:'analyze' });
        document.getElementById('cancel').onclick = () => post({ type:'cancelAnalyze' });

        let elapsedSecs = 0;
        function setGenerating(on){
          document.getElementById('go').style.display = on ? 'none' : '';
          document.getElementById('cancel').style.display = on ? '' : 'none';
          document.getElementById('busy').style.display = on ? 'flex' : 'none';
        }

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
          } else if (m.type === 'busy') {
            if (m.message) {
              document.getElementById('busymsg').textContent = m.message;
              document.getElementById('elapsed').textContent = '';
              setGenerating(true);
            } else {
              setGenerating(false);
            }
          } else if (m.type === 'elapsed') {
            elapsedSecs = m.secs || 0;
            document.getElementById('elapsed').textContent = elapsedSecs > 0 ? '(' + elapsedSecs + 's)' : '';
          } else if (m.type === 'hint') {
            document.getElementById('hint').textContent = m.text || '';
          } else if (m.type === 'schema') {
            // Real column names arrived — the builder's pickers stop being blank.
            columns = m.columns || [];
            renderColumns();
            renderOutline();
            renderPrep();
          } else if (m.type === 'loadBuilder') {
            // A template was chosen: adopt its outline and prep.
            outline = m.outline || [];
            filters = (m.prep && m.prep.filters) || [];
            derived = (m.prep && m.prep.derived) || [];
            document.getElementById('dedupe').checked = !!(m.prep && m.prep.dedupe);
            document.getElementById('rowlimit').value = (m.prep && m.prep.limit) || '';
            if (outline.length) document.getElementById('builder').open = true;
            if (filters.length || derived.length) document.getElementById('prepbox').open = true;
            renderColumns();
            renderOutline();
            renderPrep();
            pushBuilder();
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
