/**
 * ui/conversionReviewPanel.ts — side-by-side conversion review
 *
 * The step that makes converted code trustworthy. A conversion is not finished
 * when the model stops typing; it is finished when a human has seen the
 * original next to the result and knows which parts were approximated.
 *
 * The panel shows, per file, the source on the left and the conversion on the
 * right, plus a Report tab carrying the fidelity notes, the dependency mapping,
 * and the manual steps. From the dock you can refine it in plain language
 * ("return errors instead of panicking"), run the target language's syntax
 * check, undo a round, and save.
 *
 * Nothing here writes to disk. The panel posts typed messages; CodeConvertPlugin
 * owns the AI round-trips, the version stack, and every file write.
 *
 * The syntax highlighting below is deliberately local to this file: it is
 * presentation, not conversion knowledge, and it is a small tokeniser rather
 * than a dependency so the extension stays dependency-free.
 */

import * as vscode from 'vscode';
import type { ConversionReport } from '../core/codeConvert';

export interface ReviewFile {
  relPath: string;
  content: string;
  /** Fence/language tag, used to pick the highlighting keyword set. */
  lang: string;
  /** Source file this came from, when attributable. */
  fromRelPath?: string;
  /** Original source text, for the left-hand pane. */
  sourceContent?: string;
  /** Source language tag for highlighting the left pane. */
  sourceLang?: string;
  /** Result of the last syntax check, when one has run. */
  check?: { ok: boolean; detail: string };
  /** True once this file has been written to disk. */
  saved?: boolean;
}

export interface ReviewData {
  sourceLabel: string;
  targetLabel: string;
  /** Where files will be written, shown so nobody is surprised. */
  outputRoot: string;
  files: ReviewFile[];
  report: ConversionReport;
  canUndo: boolean;
  /** Plain-language description of the last thing that happened. */
  status?: string;
}

export type ReviewMessage =
  | { type: 'refine';   text: string }
  | { type: 'undo' }
  | { type: 'cancel' }
  | { type: 'saveAll' }
  | { type: 'saveOne';  relPath: string }
  | { type: 'copy';     relPath: string }
  | { type: 'verify' }
  | { type: 'openSource' }
  | { type: 'discard' }
  | { type: 'ready' };

/** One-click refinements — the things people actually ask for after a conversion. */
const SUGGESTIONS = [
  'Add error handling everywhere the source had it',
  'Make it more idiomatic for this language',
  'Remove the third-party dependencies — standard library only',
  'Add doc comments on every public function',
  'Split this into smaller files by responsibility',
  'Add unit tests for the edge cases',
  'Use async/concurrent execution where the source was blocking',
  'Address every action item in the report',
];

export class ConversionReviewPanel {
  private static _instance: ConversionReviewPanel | null = null;

  static show(onMessage: (msg: ReviewMessage) => void | Promise<void>): ConversionReviewPanel {
    if (!this._instance) this._instance = new ConversionReviewPanel();
    const inst = this._instance;
    inst._onMessage = onMessage;
    inst._panel.reveal(vscode.ViewColumn.Active, false);
    return inst;
  }

  static get current(): ConversionReviewPanel | null { return this._instance; }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _onMessage: (msg: ReviewMessage) => void | Promise<void> = () => {};
  private _pending: ReviewData | null = null;

  private constructor() {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.conversionReview',
      'Evolve AI: Conversion Review',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this._panel.webview.html = this._html();
    this._panel.webview.onDidReceiveMessage((m: ReviewMessage) => {
      // The webview asks for data once its script is live — avoids a race where
      // the first update() lands before any listener exists.
      if (m.type === 'ready') {
        if (this._pending) this._panel.webview.postMessage({ type: 'data', data: this._pending });
        return;
      }
      this._onMessage(m);
    });
    this._panel.onDidDispose(() => {
      this._disposed = true;
      if (ConversionReviewPanel._instance === this) ConversionReviewPanel._instance = null;
    });
  }

  dispose(): void { if (!this._disposed) this._panel.dispose(); }

  /** Push the current conversion state. Safe to call repeatedly. */
  update(data: ReviewData): void {
    if (this._disposed) return;
    this._pending = data;
    this._panel.title = `Review: ${data.sourceLabel} → ${data.targetLabel}`;
    this._panel.webview.postMessage({ type: 'data', data });
  }

  setBusy(message: string | null): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'busy', message });
  }

  setElapsed(secs: number): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'elapsed', secs });
  }

  setStatus(text: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'status', text });
  }

  addHistory(entry: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'history', entry });
  }

  private _html(): string {
    const nonce = 'rv4n8t2y6b';
    const chips = SUGGESTIONS.map(s => `<button class="chip" data-t="${escAttr(s)}">${escHtml(s)}</button>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; font-family: var(--vscode-font-family);
    color: var(--vscode-foreground); background: var(--vscode-editor-background); overflow: hidden; }

  /* ── Header ─────────────────────────────────────────────────────────── */
  #head { flex: 0 0 auto; padding: 9px 14px 0; border-bottom: 1px solid var(--vscode-widget-border, #8883); }
  #headline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px;
    color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  #headline .arrow { font-weight: 600; color: var(--vscode-foreground); font-size: 13px; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge.high { background: rgba(60,160,90,.18); color: #3ca05a; }
  .badge.medium { background: rgba(210,150,40,.18); color: #d2963c; }
  .badge.low { background: rgba(200,70,70,.18); color: #c84646; }
  .badge.count { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-weight: 500; }
  #outroot { font-family: var(--vscode-editor-font-family); font-size: 11px; opacity: .8; }
  #tabs { display: flex; gap: 2px; overflow-x: auto; }
  .tab { padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
    background: none; border: none; border-bottom: 2px solid transparent; color: var(--vscode-descriptionForeground); }
  .tab:hover { color: var(--vscode-foreground); }
  .tab.on { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .tab .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-left: 6px; vertical-align: middle; }
  .tab .dot.bad { background: #c84646; }
  .tab .dot.good { background: #3ca05a; }
  .tab .dot.saved { background: var(--vscode-descriptionForeground); }

  /* ── Body ───────────────────────────────────────────────────────────── */
  #body { flex: 1 1 auto; min-height: 0; position: relative; }
  #panes { display: flex; height: 100%; }
  .pane { flex: 1 1 50%; min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--vscode-widget-border, #8883); }
  .pane:last-child { border-right: none; }
  .pane.hidden { display: none; }
  .ptitle { flex: 0 0 auto; padding: 5px 12px; font-size: 11px; letter-spacing: .03em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); background: var(--vscode-sideBar-background, transparent);
    border-bottom: 1px solid var(--vscode-widget-border, #8883); display: flex; align-items: center; gap: 8px; }
  .ptitle .f { text-transform: none; letter-spacing: 0; font-family: var(--vscode-editor-font-family); font-size: 11px; opacity: .9; }
  .ptitle .sp { flex: 1 1 auto; }
  .code { flex: 1 1 auto; overflow: auto; margin: 0; padding: 8px 0 24px;
    font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); line-height: 1.5; }
  .ln { display: flex; }
  .ln > .n { flex: 0 0 auto; width: 44px; text-align: right; padding-right: 12px; opacity: .38;
    user-select: none; }
  .ln > .c { flex: 1 1 auto; white-space: pre; padding-right: 16px; }
  .ln:hover { background: var(--vscode-list-hoverBackground); }
  .tk-c { color: #6a9955; font-style: italic; }
  .tk-s { color: #ce9178; }
  .tk-n { color: #b5cea8; }
  .tk-k { color: #569cd6; }
  .tk-t { color: #4ec9b0; }
  body.vscode-light .tk-c { color: #008000; }
  body.vscode-light .tk-s { color: #a31515; }
  body.vscode-light .tk-n { color: #098658; }
  body.vscode-light .tk-k { color: #0000ff; }
  body.vscode-light .tk-t { color: #267f99; }

  /* ── Report view ────────────────────────────────────────────────────── */
  #report { height: 100%; overflow: auto; padding: 18px 24px 40px; display: none; max-width: 900px; }
  #report h3 { font-size: 13px; margin: 22px 0 8px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--vscode-descriptionForeground); }
  #report h3:first-child { margin-top: 0; }
  #report p.sum { font-size: 13px; line-height: 1.6; margin: 0 0 6px; }
  .note { border-left: 3px solid var(--vscode-widget-border, #8884); padding: 6px 0 6px 12px; margin: 10px 0; }
  .note.action { border-left-color: #c84646; }
  .note.warn { border-left-color: #d2963c; }
  .note.info { border-left-color: #4a8fd2; }
  .note .nt { font-size: 12.5px; font-weight: 600; }
  .note .nd { font-size: 12px; line-height: 1.55; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .note .nr { font-size: 11px; font-family: var(--vscode-editor-font-family); opacity: .7; margin-top: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 6px; }
  th, td { text-align: left; padding: 5px 9px; border-bottom: 1px solid var(--vscode-widget-border, #8883); }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  td code { font-family: var(--vscode-editor-font-family); }
  .st { font-size: 11px; padding: 1px 7px; border-radius: 9px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .st.approximated { background: rgba(210,150,40,.2); color: #d2963c; }
  .st.none { background: rgba(200,70,70,.2); color: #c84646; }
  ul.steps { margin: 6px 0; padding-left: 20px; font-size: 12.5px; line-height: 1.7; }
  pre.setup { background: var(--vscode-textCodeBlock-background, #8881); padding: 10px 12px; border-radius: 6px;
    font-family: var(--vscode-editor-font-family); font-size: 12px; overflow-x: auto; }
  .allclear { font-size: 12.5px; color: var(--vscode-descriptionForeground); }

  #veil { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; gap: 10px;
    background: var(--vscode-editor-background); opacity: .85; font-size: 13px; z-index: 5; }
  #veil.on { display: flex; }
  .spin { width: 13px; height: 13px; border: 2px solid var(--vscode-descriptionForeground);
    border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Dock ───────────────────────────────────────────────────────────── */
  #dock { flex: 0 0 auto; border-top: 1px solid var(--vscode-widget-border, #8883); padding: 9px 14px 11px;
    background: var(--vscode-sideBar-background, transparent); max-height: 44%; overflow: auto; }
  .row { display: flex; gap: 8px; align-items: center; }
  #refine { flex: 1 1 auto; padding: 8px 11px; font: inherit; font-size: 13px; border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); }
  #refine:focus { outline: 1px solid var(--vscode-focusBorder); }
  button.b { font: inherit; font-size: 12px; border-radius: 6px; cursor: pointer; white-space: nowrap;
    border: 1px solid transparent; padding: 8px 14px;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.b:hover:not(:disabled) { filter: brightness(1.13); }
  button.b:disabled { opacity: .45; cursor: default; }
  button.b.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .chip { padding: 4px 10px; font: inherit; font-size: 11.5px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--vscode-widget-border, #8884); background: transparent; color: var(--vscode-descriptionForeground); }
  .chip:hover { color: var(--vscode-foreground); border-color: var(--vscode-focusBorder); }
  .bar { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .bar .sep { flex: 1 1 auto; }
  .link { background: none; border: none; padding: 4px 2px; font: inherit; font-size: 11.5px; cursor: pointer;
    color: var(--vscode-textLink-foreground); }
  .link:hover { text-decoration: underline; }
  #status { margin-top: 8px; font-size: 11.5px; color: var(--vscode-descriptionForeground); min-height: 15px; }
  #history { margin-top: 5px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  #history div { padding: 1px 0; }
  #history div::before { content: "\\21B3 "; opacity: .6; }
</style></head><body>

<div id="head">
  <div id="headline">
    <span class="arrow" id="langs">&hellip;</span>
    <span class="badge" id="conf"></span>
    <span class="badge count" id="counts"></span>
    <span id="outroot"></span>
  </div>
  <div id="tabs"></div>
</div>

<div id="body">
  <div id="panes">
    <div class="pane" id="paneL">
      <div class="ptitle"><span>Original</span><span class="f" id="lfile"></span><span class="sp"></span>
        <button class="link" id="openSrc">Open source file</button></div>
      <div class="code" id="lcode"></div>
    </div>
    <div class="pane" id="paneR">
      <div class="ptitle"><span>Converted</span><span class="f" id="rfile"></span><span class="sp"></span>
        <span id="checkstate"></span>
        <button class="link" id="copyOne">Copy</button>
        <button class="link" id="saveOne">Save this file</button></div>
      <div class="code" id="rcode"></div>
    </div>
  </div>
  <div id="report"></div>
  <div id="veil"><span class="spin"></span><span id="veilmsg"></span><span id="elapsed"></span></div>
</div>

<div id="dock">
  <div class="row">
    <input id="refine" type="text" placeholder="Change it in plain language &mdash; e.g. &quot;return errors instead of panicking, and drop the third-party HTTP client&quot;" />
    <button class="b primary" id="apply" disabled>Apply</button>
    <button class="b" id="cancel" style="display:none;">&#9632; Stop</button>
  </div>
  <div class="chips">${chips}</div>
  <div class="bar">
    <button class="b primary" id="saveAll">Save all files&hellip;</button>
    <button class="b" id="verify">Check it parses</button>
    <button class="b" id="undo" disabled>&#8624; Undo last change</button>
    <span class="sep"></span>
    <button class="link" id="split">Converted only</button>
    <button class="link" id="discard">Discard conversion</button>
  </div>
  <div id="status"></div>
  <div id="history"></div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const post = m => vscode.postMessage(m);

let data = null;
let activeTab = 0;      // index into data.files, or -1 for the report
let sideBySide = true;

// ── Syntax highlighting ────────────────────────────────────────────────────
// A small tokeniser: comments, strings, numbers, keywords, type-ish names.
// Not a parser — it only has to make the diff readable, and it must never
// mangle the code, so unmatched text is passed through escaped and untouched.
const KEYWORDS = {
  common: 'if else for while return break continue switch case default do try catch finally throw new delete typeof instanceof class extends implements interface enum struct union public private protected static final const let var func function def fn lambda import from export package module use require include using namespace async await yield match when where with as in is not and or none null nil true false this self super void int float double string bool char long short unsigned signed type var val object trait impl pub mut ref out override abstract virtual sealed record end then elif def do begin rescue ensure unless until raise pass global nonlocal assert del print echo local set foreach param'
};
const KEYSETS = {};
function keySet(lang) {
  if (KEYSETS[lang]) return KEYSETS[lang];
  const s = new Set(KEYWORDS.common.split(/\\s+/));
  KEYSETS[lang] = s;
  return s;
}
function esc(s) {
  return s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
}
// Order matters: block comments and strings must win before word matching.
const TOKEN_RE = /\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*|--[^\\n]*|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|\\b\\d[\\w.]*\\b|\\b[A-Za-z_$][\\w$]*\\b/g;

function highlight(code, lang) {
  const kw = keySet(lang || '');
  let out = '', last = 0, m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(code)) !== null) {
    const t = m[0];
    out += esc(code.slice(last, m.index));
    last = m.index + t.length;
    let cls = '';
    if (t.startsWith('/*') || t.startsWith('//') || t.startsWith('#') || t.startsWith('--')) cls = 'tk-c';
    else if (t[0] === '"' || t[0] === "'" || t[0] === '\`') cls = 'tk-s';
    else if (/^\\d/.test(t)) cls = 'tk-n';
    else if (kw.has(t)) cls = 'tk-k';
    else if (/^[A-Z]/.test(t)) cls = 'tk-t';
    out += cls ? '<span class="' + cls + '">' + esc(t) + '</span>' : esc(t);
  }
  out += esc(code.slice(last));
  return out;
}

function renderCode(el, text, lang) {
  if (text === undefined || text === null) {
    el.innerHTML = '<div class="ln"><span class="n"></span><span class="c" style="opacity:.6">' +
      'No original to compare against &mdash; this file has no single source counterpart.</span></div>';
    return;
  }
  const lines = text.split('\\n');
  // Highlight the whole document once so block comments spanning lines survive,
  // then split the marked-up result back per line.
  const html = highlight(text, lang);
  const marked = html.split('\\n');
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    out += '<div class="ln"><span class="n">' + (i + 1) + '</span><span class="c">' + (marked[i] || '') + '</span></div>';
  }
  el.innerHTML = out;
  el.scrollTop = 0;
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderTabs() {
  const tabs = $('tabs');
  tabs.textContent = '';
  data.files.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (activeTab === i ? ' on' : '');
    b.textContent = f.relPath;
    if (f.check) {
      const dot = document.createElement('span');
      dot.className = 'dot ' + (f.check.ok ? 'good' : 'bad');
      dot.title = f.check.ok ? 'Parses cleanly' : f.check.detail;
      b.appendChild(dot);
    } else if (f.saved) {
      const dot = document.createElement('span');
      dot.className = 'dot saved'; dot.title = 'Saved';
      b.appendChild(dot);
    }
    b.onclick = () => { activeTab = i; render(); };
    tabs.appendChild(b);
  });
  const rb = document.createElement('button');
  rb.className = 'tab' + (activeTab === -1 ? ' on' : '');
  const n = data.report.notes.filter(x => x.severity === 'action').length;
  rb.textContent = 'Report' + (n ? ' (' + n + ')' : '');
  rb.onclick = () => { activeTab = -1; render(); };
  tabs.appendChild(rb);
}

function renderHead() {
  $('langs').textContent = data.sourceLabel + ' \\u2192 ' + data.targetLabel;
  const conf = $('conf');
  conf.textContent = data.report.confidence + ' confidence';
  conf.className = 'badge ' + data.report.confidence;
  const a = data.report.notes.filter(x => x.severity === 'action').length;
  const w = data.report.notes.filter(x => x.severity === 'warn').length;
  $('counts').textContent = data.files.length + ' file' + (data.files.length === 1 ? '' : 's') +
    (a ? ' \\u00B7 ' + a + ' action' + (a === 1 ? '' : 's') : '') +
    (w ? ' \\u00B7 ' + w + ' warning' + (w === 1 ? '' : 's') : '');
  $('outroot').textContent = data.outputRoot ? 'Saves to ' + data.outputRoot : '';
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderReport() {
  const r = $('report');
  r.textContent = '';
  const rep = data.report;

  if (rep.summary) {
    r.appendChild(el('h3', null, 'Summary'));
    r.appendChild(el('p', 'sum', rep.summary));
  }

  const order = ['action', 'warn', 'info'];
  const titles = { action: 'Needs a human', warn: 'Check these', info: 'Decisions made' };
  let any = false;
  order.forEach(sev => {
    const group = rep.notes.filter(n => n.severity === sev);
    if (!group.length) return;
    any = true;
    r.appendChild(el('h3', null, titles[sev]));
    group.forEach(n => {
      const d = el('div', 'note ' + sev);
      d.appendChild(el('div', 'nt', n.title));
      if (n.detail) d.appendChild(el('div', 'nd', n.detail));
      const refs = [n.sourceRef, n.targetRef].filter(Boolean).join('  \\u2192  ');
      if (refs) d.appendChild(el('div', 'nr', refs));
      r.appendChild(d);
    });
  });
  if (!any) {
    r.appendChild(el('h3', null, 'Fidelity notes'));
    r.appendChild(el('div', 'allclear', 'The conversion reported no approximations. Review the code anyway \\u2014 a clean report is a claim, not a proof.'));
  }

  if (rep.dependencies.length) {
    r.appendChild(el('h3', null, 'Dependencies'));
    const t = el('table');
    const hr = el('tr');
    ['Source', 'Target', 'Status', 'Notes'].forEach(h => hr.appendChild(el('th', null, h)));
    t.appendChild(hr);
    rep.dependencies.forEach(d => {
      const tr = el('tr');
      const c1 = el('td'); c1.appendChild(el('code', null, d.source)); tr.appendChild(c1);
      const c2 = el('td'); c2.appendChild(el('code', null, d.target)); tr.appendChild(c2);
      const c3 = el('td'); c3.appendChild(el('span', 'st ' + d.status, d.status)); tr.appendChild(c3);
      tr.appendChild(el('td', null, d.note || ''));
      t.appendChild(tr);
    });
    r.appendChild(t);
  }

  if (rep.manualSteps.length) {
    r.appendChild(el('h3', null, 'Manual steps'));
    const ul = el('ul', 'steps');
    rep.manualSteps.forEach(s => ul.appendChild(el('li', null, s)));
    r.appendChild(ul);
  }

  if (rep.setup.length) {
    r.appendChild(el('h3', null, 'Getting it running'));
    r.appendChild(el('pre', 'setup', rep.setup.join('\\n')));
  }
}

function render() {
  if (!data) return;
  renderHead();
  renderTabs();
  const showReport = activeTab === -1;
  $('panes').style.display = showReport ? 'none' : 'flex';
  $('report').style.display = showReport ? 'block' : 'none';
  $('undo').disabled = !data.canUndo;

  if (showReport) { renderReport(); return; }

  const f = data.files[activeTab] || data.files[0];
  if (!f) return;
  $('lfile').textContent = f.fromRelPath || '';
  $('rfile').textContent = f.relPath + (f.saved ? '  (saved)' : '');
  renderCode($('lcode'), f.sourceContent, f.sourceLang || '');
  renderCode($('rcode'), f.content, f.lang || '');
  $('paneL').classList.toggle('hidden', !sideBySide);
  $('split').textContent = sideBySide ? 'Converted only' : 'Side by side';
  const cs = $('checkstate');
  cs.textContent = f.check ? (f.check.ok ? '\\u2713 parses' : '\\u2717 ' + f.check.detail.split('\\n')[0].slice(0, 70)) : '';
  cs.style.color = f.check ? (f.check.ok ? '#3ca05a' : '#c84646') : '';
}

// ── Dock wiring ────────────────────────────────────────────────────────────
const input = $('refine');
function syncApply() { $('apply').disabled = input.value.trim().length === 0; }
input.addEventListener('input', syncApply);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) { e.preventDefault(); send(); }
});
function send() {
  const text = input.value.trim();
  if (!text) return;
  post({ type: 'refine', text });
  input.value = '';
  syncApply();
}
$('apply').onclick   = send;
$('cancel').onclick  = () => post({ type: 'cancel' });
$('undo').onclick    = () => post({ type: 'undo' });
$('saveAll').onclick = () => post({ type: 'saveAll' });
$('verify').onclick  = () => post({ type: 'verify' });
$('discard').onclick = () => post({ type: 'discard' });
$('openSrc').onclick = () => post({ type: 'openSource' });
$('saveOne').onclick = () => { const f = data && data.files[activeTab]; if (f) post({ type: 'saveOne', relPath: f.relPath }); };
$('copyOne').onclick = () => { const f = data && data.files[activeTab]; if (f) post({ type: 'copy', relPath: f.relPath }); };
$('split').onclick   = () => { sideBySide = !sideBySide; render(); };

document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
  input.value = c.getAttribute('data-t');
  syncApply();
  input.focus();
});

function busy(on, msg) {
  $('veil').classList.toggle('on', on);
  $('veilmsg').textContent = msg || '';
  if (!on) $('elapsed').textContent = '';
  $('apply').style.display = on ? 'none' : '';
  $('cancel').style.display = on ? '' : 'none';
  input.disabled = on;
}

window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'data') {
    const first = data === null;
    data = m.data;
    if (first || activeTab >= data.files.length) activeTab = data.files.length ? 0 : -1;
    render();
    if (m.data.status) $('status').textContent = m.data.status;
  } else if (m.type === 'busy') {
    busy(!!m.message, m.message);
  } else if (m.type === 'elapsed') {
    $('elapsed').textContent = m.secs > 0 ? '(' + m.secs + 's)' : '';
  } else if (m.type === 'status') {
    $('status').textContent = m.text || '';
  } else if (m.type === 'history') {
    const d = document.createElement('div');
    d.textContent = m.entry;
    $('history').appendChild(d);
  }
});

post({ type: 'ready' });
</script>
</body></html>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
function escAttr(s: string): string { return escHtml(s).replace(/`/g, '&#96;'); }
