/**
 * ui/codeConvertPanel.ts — Code Converter entry panel
 *
 * The front door for the "Code Convertor" mode. It answers, up front, the three
 * questions a conversion needs answered before it can be any good:
 *
 *   1. What are we converting?   active file · selection · pick files · a folder
 *   2. Into what?                a searchable target-language grid
 *   3. How?                      how literal, how free with dependencies,
 *                                tests, comments, extra requirements
 *
 * …and then it tells the truth about what happens next: nothing is written to
 * disk from this panel. Conversion produces a review, and the review is where
 * files get saved.
 *
 * Presentation only. The panel posts typed messages; CodeConvertPlugin owns the
 * file picking, the AI round-trip, and everything that touches disk.
 */

import * as vscode from 'vscode';

/** A language offered as a conversion target. Mirrors core/codeConvert LanguageSpec. */
export interface TargetChoice {
  id: string;
  label: string;
  group: string;
  ext: string;
}

/** A choice rendered as a radio card (fidelity / dependency policy). */
export interface OptionChoice {
  id: string;
  label: string;
  description: string;
}

export interface ConvertCatalog {
  targets:      TargetChoice[];
  fidelity:     OptionChoice[];
  dependencies: OptionChoice[];
  defaults: {
    target:       string;
    fidelity:     string;
    dependencies: string;
    includeTests: boolean;
    keepComments: boolean;
    emitManifest: boolean;
  };
}

/** The option state the panel reports back on every change. */
export interface PanelConvertOptions {
  target:       string;
  fidelity:     string;
  dependencies: string;
  includeTests: boolean;
  keepComments: boolean;
  emitManifest: boolean;
  framework:    string;
  notes:        string;
}

/** A source file currently queued for conversion. */
export interface QueuedSource {
  relPath: string;
  langLabel: string;
  lines: number;
  /** Present when this entry is a selection rather than a whole file. */
  isSelection?: boolean;
}

/** What the host tells the panel about the chosen model and whether the job fits it. */
export interface ModelStatus {
  /** e.g. "qwen2.5-coder:7b" */
  label: string;
  /** e.g. "Ollama · 32k context · Good at code (detected)" */
  detail: string;
  /** 'comfortable' | 'tight' | 'split' | 'impossible' | '' when nothing queued */
  verdict: string;
  /** One-line summary of the fit. */
  headline: string;
  /** What to do about it, when there is something to do. */
  advice: string;
  /** Concrete alternatives, shown when the job doesn't fit comfortably. */
  suggestions: string[];
}

export type ConvertPanelMessage =
  | { type: 'useActiveFile' }
  | { type: 'useSelection' }
  | { type: 'browseFiles' }
  | { type: 'browseFolder' }
  | { type: 'removeSource'; relPath: string }
  | { type: 'clearSources' }
  | { type: 'setOptions'; options: PanelConvertOptions }
  | { type: 'pickModel' }
  | { type: 'convert' }
  | { type: 'cancel' };

export class CodeConvertPanel {
  private static _instance: CodeConvertPanel | null = null;

  static show(
    catalog: ConvertCatalog,
    onMessage: (msg: ConvertPanelMessage) => void | Promise<void>,
  ): CodeConvertPanel {
    if (!this._instance) this._instance = new CodeConvertPanel();
    const inst = this._instance;
    inst._onMessage = onMessage;
    inst._catalog = catalog;
    inst._render();
    inst._panel.reveal();
    return inst;
  }

  static get current(): CodeConvertPanel | null { return this._instance; }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _catalog: ConvertCatalog = {
    targets: [], fidelity: [], dependencies: [],
    defaults: { target: '', fidelity: '', dependencies: '', includeTests: false, keepComments: true, emitManifest: true },
  };
  private _onMessage: (msg: ConvertPanelMessage) => void | Promise<void> = () => {};

  private constructor() {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.codeConvert',
      'Evolve AI: Code Converter',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this._panel.webview.onDidReceiveMessage((m: ConvertPanelMessage) => this._onMessage(m));
    this._panel.onDidDispose(() => {
      this._disposed = true;
      if (CodeConvertPanel._instance === this) CodeConvertPanel._instance = null;
    });
  }

  dispose(): void { if (!this._disposed) this._panel.dispose(); }

  /** Replace the queued-source list shown in step 1. */
  setSources(sources: QueuedSource[], detectedLang: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'sources', sources, detectedLang });
  }

  setStatus(text: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'status', text });
  }

  setBusy(message: string | null): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'busy', message });
  }

  setElapsed(secs: number): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'elapsed', secs });
  }

  setHint(text: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'hint', text });
  }

  /** Update the chosen model and whether the queued job actually fits it. */
  setModel(status: ModelStatus): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'model', status });
  }

  private _render(): void {
    if (this._disposed) return;
    this._panel.webview.html = this._html();
  }

  private _html(): string {
    const c = this._catalog;
    const d = c.defaults;

    // Targets grouped, in catalogue order — the order encodes "what people
    // actually convert to", so it must not be re-sorted alphabetically.
    const groups: Array<{ name: string; items: TargetChoice[] }> = [];
    for (const t of c.targets) {
      let g = groups.find(x => x.name === t.group);
      if (!g) { g = { name: t.group, items: [] }; groups.push(g); }
      g.items.push(t);
    }
    const targetHtml = groups.map(g =>
      `<div class="tgroup" data-group="${escAttr(g.name)}">` +
      `<div class="glabel">${escHtml(g.name)}</div>` +
      `<div class="tgrid">` +
      g.items.map(t =>
        `<button class="lang${t.id === d.target ? ' on' : ''}" data-t="${escAttr(t.id)}" ` +
        `data-search="${escAttr((t.label + ' ' + t.id + ' ' + t.ext).toLowerCase())}" ` +
        `title="${escAttr(t.label + ' (' + t.ext + ')')}">` +
        `<span class="lname">${escHtml(t.label)}</span><span class="lext">${escHtml(t.ext)}</span></button>`
      ).join('') +
      `</div></div>`
    ).join('');

    const radioCards = (name: string, items: OptionChoice[], selected: string) =>
      items.map(i =>
        `<button class="ocard${i.id === selected ? ' on' : ''}" data-r="${escAttr(name)}" data-v="${escAttr(i.id)}">` +
        `<span class="ot">${escHtml(i.label)}</span><span class="od">${escHtml(i.description)}</span></button>`
      ).join('');

    const nonce = 'cv7k2m9x4q';
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px 24px 40px; max-width: 760px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 20px; line-height: 1.5; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground);
       margin: 22px 0 8px; display: flex; align-items: baseline; gap: 8px; }
  h2 .note { text-transform: none; letter-spacing: 0; font-size: 11px; opacity: .85; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .card { flex: 1 1 210px; text-align: left; background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 8px; padding: 11px 13px; cursor: pointer; font: inherit; }
  .card:hover { background: var(--vscode-list-hoverBackground); }
  .card .t { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
  .card .d { font-size: 11px; color: var(--vscode-descriptionForeground); }

  #srcbox { margin-top: 12px; border: 1px solid var(--vscode-widget-border, #8883); border-radius: 8px;
    padding: 4px; min-height: 40px; max-height: 210px; overflow: auto; }
  .srow { display: flex; align-items: center; gap: 8px; padding: 5px 8px; font-size: 12px; border-radius: 5px; }
  .srow:hover { background: var(--vscode-list-hoverBackground); }
  .srow .p { font-family: var(--vscode-editor-font-family); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .srow .m { color: var(--vscode-descriptionForeground); font-size: 11px; flex: 0 0 auto; }
  .srow .x { background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer;
    font-size: 14px; line-height: 1; padding: 0 4px; flex: 0 0 auto; }
  .srow .x:hover { color: var(--vscode-errorForeground); }
  .empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 10px 9px; }
  #srcmeta { display: flex; align-items: center; gap: 10px; margin-top: 7px; font-size: 11.5px;
    color: var(--vscode-descriptionForeground); min-height: 18px; }
  .link { background: none; border: none; padding: 0; font-size: 11.5px; cursor: pointer;
    color: var(--vscode-textLink-foreground); }
  .link:hover { text-decoration: underline; }

  #search { width: 100%; box-sizing: border-box; margin: 2px 0 10px; padding: 7px 10px; font: inherit; font-size: 12.5px;
    border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); }
  .glabel { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em;
    color: var(--vscode-descriptionForeground); margin: 10px 0 5px; opacity: .8; }
  .tgrid { display: flex; gap: 6px; flex-wrap: wrap; }
  .lang { display: inline-flex; align-items: baseline; gap: 6px; padding: 6px 11px; font: inherit; font-size: 12.5px;
    border-radius: 6px; cursor: pointer; background: transparent; color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, #8884); }
  .lang:hover { border-color: var(--vscode-focusBorder); }
  .lang.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; font-weight: 600; }
  .lang .lext { font-size: 10.5px; opacity: .65; font-family: var(--vscode-editor-font-family); }
  .lang.on .lext { opacity: .8; }
  .tgroup.hide, .lang.hide { display: none; }

  .ocards { display: flex; gap: 8px; flex-wrap: wrap; }
  .ocard { flex: 1 1 210px; display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 10px 12px;
    font: inherit; border-radius: 7px; cursor: pointer; background: transparent; color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, #8884); }
  .ocard:hover { border-color: var(--vscode-focusBorder); }
  .ocard.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground); }
  .ocard .ot { font-size: 12.5px; font-weight: 600; }
  .ocard .od { font-size: 11px; opacity: .8; line-height: 1.45; }

  /* Model + fit */
  #modelbox { border: 1px solid var(--vscode-widget-border, #8883); border-radius: 8px; padding: 11px 13px; }
  .mrow { display: flex; align-items: center; gap: 12px; }
  .mtext { flex: 1 1 auto; min-width: 0; }
  .mname { font-size: 13px; font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .mdetail { font-size: 11.5px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .mbtn { flex: 0 0 auto; font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 6px; cursor: pointer;
    border: 1px solid transparent; background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground); }
  .mbtn:hover { filter: brightness(1.13); }
  .fit { margin-top: 10px; font-size: 12px; display: none; padding: 6px 10px; border-radius: 5px; }
  .fit.comfortable { display: block; background: rgba(60,160,90,.13); color: #3ca05a; }
  .fit.tight       { display: block; background: rgba(210,150,40,.14); color: #d2963c; }
  .fit.split       { display: block; background: rgba(210,150,40,.14); color: #d2963c; }
  .fit.impossible  { display: block; background: rgba(200,70,70,.14); color: #c84646; }
  .fitadvice { margin-top: 6px; font-size: 11.5px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
  .fitsuggest { margin: 6px 0 0; padding-left: 18px; font-size: 11.5px;
    color: var(--vscode-descriptionForeground); line-height: 1.7; }
  .fitsuggest li { font-family: var(--vscode-editor-font-family); }

  .toggles { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; font-size: 12.5px; }
  .toggles label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .txt { width: 100%; box-sizing: border-box; margin-top: 10px; padding: 8px 10px; font: inherit; font-size: 12.5px;
    border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); }
  textarea.txt { min-height: 58px; resize: vertical; font-family: var(--vscode-font-family); }

  #actions { margin-top: 22px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  #go { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none;
    padding: 9px 22px; font: inherit; font-size: 13px; font-weight: 600; border-radius: 6px; cursor: pointer; }
  #go:disabled { opacity: .45; cursor: default; }
  #cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    border: none; padding: 9px 18px; font: inherit; font-size: 13px; border-radius: 6px; cursor: pointer; }
  #busy { display: none; align-items: center; gap: 8px; font-size: 12.5px; }
  .spin { width: 12px; height: 12px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent;
    border-radius: 50%; display: inline-block; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #hint { margin-top: 12px; font-size: 11.5px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
  #status { margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); min-height: 17px; }
  .safety { margin-top: 14px; font-size: 11.5px; color: var(--vscode-descriptionForeground);
    border-left: 2px solid var(--vscode-widget-border, #8884); padding: 2px 0 2px 10px; line-height: 1.55; }
</style></head><body>
  <h1>&#8646; Code Converter</h1>
  <p class="sub">Convert code into another language &mdash; a selection, a file, or a whole folder. You get the converted
  code side by side with the original, plus a report of what was translated exactly, what was approximated, and what
  still needs a human.</p>

  <h2>1 &middot; What to convert</h2>
  <div class="row">
    <button class="card" id="useActive"><div class="t">&#128196; The active file</div><div class="d">Whatever is open in the editor right now</div></button>
    <button class="card" id="useSel"><div class="t">&#9998; The selected code</div><div class="d">Just the lines you have highlighted</div></button>
    <button class="card" id="browseFiles"><div class="t">&#128193; Choose files&hellip;</div><div class="d">One or many &mdash; converted together, so cross-file references survive</div></button>
    <button class="card" id="browseFolder"><div class="t">&#128194; Choose a folder&hellip;</div><div class="d">Port a module or a whole small project, structure preserved</div></button>
  </div>
  <div id="srcbox"><div class="empty">Nothing queued yet &mdash; pick a source above.</div></div>
  <div id="srcmeta"><span id="detected"></span><button class="link" id="clearSrc" style="display:none;">Clear all</button></div>

  <h2>2 &middot; Convert to <span class="note" id="targetNote"></span></h2>
  <input id="search" type="text" placeholder="Filter languages&hellip;" />
  <div id="targets">${targetHtml}</div>
  <input id="framework" class="txt" type="text" placeholder="Optional &mdash; target framework or runtime, e.g. &quot;FastAPI&quot;, &quot;.NET 8&quot;, &quot;Spring Boot&quot;, &quot;React&quot;" />

  <h2>3 &middot; How faithful</h2>
  <div class="ocards" id="fidelity">${radioCards('fidelity', c.fidelity, d.fidelity)}</div>

  <h2>4 &middot; Dependencies</h2>
  <div class="ocards" id="dependencies">${radioCards('dependencies', c.dependencies, d.dependencies)}</div>

  <h2>5 &middot; AI model</h2>
  <div id="modelbox">
    <div class="mrow">
      <div class="mtext">
        <div class="mname" id="mname">&hellip;</div>
        <div class="mdetail" id="mdetail"></div>
      </div>
      <button class="mbtn" id="pickModel">Change model&hellip;</button>
    </div>
    <div id="fit" class="fit"></div>
    <div id="fitadvice" class="fitadvice"></div>
    <ul id="fitsuggest" class="fitsuggest"></ul>
  </div>

  <div class="toggles">
    <label><input type="checkbox" id="tests"${d.includeTests ? ' checked' : ''}/> Also generate tests</label>
    <label><input type="checkbox" id="comments"${d.keepComments ? ' checked' : ''}/> Carry comments across</label>
    <label><input type="checkbox" id="manifest"${d.emitManifest ? ' checked' : ''}/> Emit dependency manifest</label>
  </div>
  <textarea id="notes" class="txt" placeholder="Anything else the conversion must respect &mdash; e.g. &quot;keep the CLI flags identical&quot;, &quot;must run on Java 11&quot;, &quot;no external HTTP client&quot;"></textarea>

  <div id="actions">
    <button id="go" disabled>Convert &rarr;</button>
    <button id="cancel" style="display:none;">&#9632; Stop</button>
    <div id="busy"><span class="spin"></span><span id="busymsg"></span><span id="elapsed"></span></div>
  </div>
  <div id="status"></div>
  <div id="hint"></div>
  <div class="safety">Nothing is written to disk here. The conversion opens in a review where you see it beside the
  original, refine it in plain language, and choose what to save.</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const post = m => vscode.postMessage(m);

  let opts = {
    target: ${JSON.stringify(d.target)},
    fidelity: ${JSON.stringify(d.fidelity)},
    dependencies: ${JSON.stringify(d.dependencies)},
    includeTests: ${d.includeTests ? 'true' : 'false'},
    keepComments: ${d.keepComments ? 'true' : 'false'},
    emitManifest: ${d.emitManifest ? 'true' : 'false'},
    framework: '',
    notes: ''
  };
  let hasSource = false;

  function pushOptions() { post({ type: 'setOptions', options: opts }); refreshGo(); }
  function refreshGo() { $('go').disabled = !(hasSource && opts.target); }

  $('useActive').onclick    = () => post({ type: 'useActiveFile' });
  $('useSel').onclick       = () => post({ type: 'useSelection' });
  $('browseFiles').onclick  = () => post({ type: 'browseFiles' });
  $('browseFolder').onclick = () => post({ type: 'browseFolder' });
  $('clearSrc').onclick     = () => post({ type: 'clearSources' });
  $('pickModel').onclick    = () => post({ type: 'pickModel' });
  $('go').onclick           = () => post({ type: 'convert' });
  $('cancel').onclick       = () => post({ type: 'cancel' });

  // ── Target grid ────────────────────────────────────────────────────────────
  function selectTarget(id, label) {
    opts.target = id;
    document.querySelectorAll('.lang').forEach(b => b.classList.toggle('on', b.getAttribute('data-t') === id));
    $('targetNote').textContent = label ? '\\u2192 ' + label : '';
    pushOptions();
  }
  document.querySelectorAll('.lang').forEach(b => b.onclick = () => {
    selectTarget(b.getAttribute('data-t'), b.querySelector('.lname').textContent);
  });
  const initial = document.querySelector('.lang.on');
  if (initial) $('targetNote').textContent = '\\u2192 ' + initial.querySelector('.lname').textContent;

  $('search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.lang').forEach(b => {
      b.classList.toggle('hide', q.length > 0 && b.getAttribute('data-search').indexOf(q) === -1);
    });
    document.querySelectorAll('.tgroup').forEach(g => {
      g.classList.toggle('hide', g.querySelectorAll('.lang:not(.hide)').length === 0);
    });
  });
  $('search').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const first = document.querySelector('.lang:not(.hide)');
    if (first) { selectTarget(first.getAttribute('data-t'), first.querySelector('.lname').textContent); }
  });

  // ── Radio cards ────────────────────────────────────────────────────────────
  document.querySelectorAll('.ocard').forEach(b => b.onclick = () => {
    const group = b.getAttribute('data-r');
    document.querySelectorAll('.ocard[data-r="' + group + '"]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    opts[group] = b.getAttribute('data-v');
    pushOptions();
  });

  $('tests').onchange     = e => { opts.includeTests = e.target.checked; pushOptions(); };
  $('comments').onchange  = e => { opts.keepComments = e.target.checked; pushOptions(); };
  $('manifest').onchange  = e => { opts.emitManifest = e.target.checked; pushOptions(); };
  $('framework').addEventListener('input', e => { opts.framework = e.target.value; pushOptions(); });
  $('notes').addEventListener('input',     e => { opts.notes = e.target.value; pushOptions(); });

  function setBusyState(on) {
    $('go').style.display = on ? 'none' : '';
    $('cancel').style.display = on ? '' : 'none';
    $('busy').style.display = on ? 'flex' : 'none';
  }

  // ── Host → panel ───────────────────────────────────────────────────────────
  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'sources') {
      const box = $('srcbox');
      box.textContent = '';
      hasSource = m.sources.length > 0;
      if (!hasSource) {
        const d = document.createElement('div');
        d.className = 'empty';
        d.textContent = 'Nothing queued yet \\u2014 pick a source above.';
        box.appendChild(d);
      } else {
        m.sources.forEach(s => {
          const row = document.createElement('div');
          row.className = 'srow';
          const p = document.createElement('span');
          p.className = 'p';
          p.textContent = s.relPath + (s.isSelection ? '  (selection)' : '');
          const meta = document.createElement('span');
          meta.className = 'm';
          meta.textContent = s.langLabel + ' \\u00B7 ' + s.lines + ' lines';
          const x = document.createElement('button');
          x.className = 'x'; x.textContent = '\\u00D7'; x.title = 'Remove';
          x.onclick = () => post({ type: 'removeSource', relPath: s.relPath });
          row.appendChild(p); row.appendChild(meta); row.appendChild(x);
          box.appendChild(row);
        });
      }
      $('detected').textContent = m.detectedLang || '';
      $('clearSrc').style.display = hasSource ? '' : 'none';
      refreshGo();
    } else if (m.type === 'status') {
      $('status').textContent = m.text || '';
    } else if (m.type === 'hint') {
      $('hint').textContent = m.text || '';
    } else if (m.type === 'busy') {
      if (m.message) { $('busymsg').textContent = m.message; $('elapsed').textContent = ''; setBusyState(true); }
      else setBusyState(false);
    } else if (m.type === 'elapsed') {
      $('elapsed').textContent = m.secs > 0 ? '(' + m.secs + 's)' : '';
    } else if (m.type === 'model') {
      const s = m.status;
      $('mname').textContent = s.label;
      $('mdetail').textContent = s.detail;
      const fit = $('fit');
      fit.className = 'fit ' + (s.verdict || '');
      fit.textContent = s.headline || '';
      $('fitadvice').textContent = s.advice || '';
      const ul = $('fitsuggest');
      ul.textContent = '';
      (s.suggestions || []).forEach(t => {
        const li = document.createElement('li');
        li.textContent = t;
        ul.appendChild(li);
      });
    }
  });

  pushOptions();
</script>
</body></html>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
function escAttr(s: string): string { return escHtml(s).replace(/`/g, '&#96;'); }
