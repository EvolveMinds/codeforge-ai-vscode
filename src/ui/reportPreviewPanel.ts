/**
 * ui/reportPreviewPanel.ts — the report authoring surface.
 *
 * The old flow ended the moment the file hit disk: the report opened in a
 * browser and the only way to change anything was to regenerate from scratch.
 * This panel closes that loop, and then goes further than prompting.
 *
 * Three ways to change a report, in increasing cost:
 *   - Direct manipulation — hover a card to move, duplicate, delete or edit its
 *     text in place. Runs inside the iframe (see core/reportEditor.ts), costs
 *     nothing, applies instantly.
 *   - Design controls — accent, appearance, density, palette. Re-injects the
 *     stylesheet; no model involved.
 *   - Refine — plain language, either scoped to one block or across the whole
 *     document. The only path that calls the AI.
 *
 * Every round is snapshotted so Undo always steps back one change, whichever
 * kind it was.
 *
 * Presentation only: the panel posts typed messages and the plugin owns the AI
 * round-trip, file writes and the version stack.
 */

import * as vscode from 'vscode';
import * as path   from 'path';

export type PreviewMessage =
  | { type: 'refine';       text: string }
  | { type: 'refineBlock';  blockId: string; blockType: string; text: string }
  | { type: 'saveHtml';     html: string }
  | { type: 'addBlock';     afterId: string }
  | { type: 'pickBlockRefine'; blockId: string; blockType: string }
  | { type: 'design';       key: string; value: string }
  | { type: 'undo' }
  | { type: 'cancel' }
  | { type: 'openExternal' }
  | { type: 'reveal' }
  | { type: 'openSource' }
  | { type: 'exportPdf' }
  | { type: 'saveTemplate' }
  | { type: 'regenerate' }
  | { type: 'toggleEdit';   on: boolean };

/** Quick refinements offered as one-click chips. */
const SUGGESTIONS = [
  'Make it more concise',
  'Add a data-quality section',
  'Explain each chart in plain language',
  'Add recommendations tied to the findings',
  'Turn the key numbers into KPI tiles',
];

export interface PreviewDesign {
  accent: string;
  mode: 'auto' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
}

export class ReportPreviewPanel {
  private static _instance: ReportPreviewPanel | null = null;

  /**
   * Open (or reveal) the preview for `reportPath`. The webview can only load
   * local files under its `localResourceRoots`, which are fixed at creation —
   * so a report in a different folder needs a fresh panel.
   */
  /**
   * `previewPath` is an editable copy of the report, kept outside the user's
   * folder. The iframe loads that, never the real file: edit-mode chrome (hover
   * toolbars, contenteditable) must never be present in the report the user
   * emails or commits, and pointing the iframe at the real file would mean
   * writing that chrome to disk.
   */
  static show(
    reportPath: string,
    previewPath: string,
    onMessage: (msg: PreviewMessage) => void | Promise<void>,
    design?: PreviewDesign,
  ): ReportPreviewPanel {
    const dir = path.dirname(reportPath);
    if (this._instance && this._instance._rootDir !== dir) {
      this._instance.dispose();
    }
    if (!this._instance) this._instance = new ReportPreviewPanel(dir, path.dirname(previewPath));
    const inst = this._instance;
    inst._onMessage = onMessage;
    inst._reportPath = reportPath;
    inst._previewPath = previewPath;
    if (design) inst._design = design;
    inst._render();
    inst._panel.reveal(vscode.ViewColumn.Beside, /*preserveFocus*/ false);
    return inst;
  }

  static get current(): ReportPreviewPanel | null { return this._instance; }

  private readonly _panel: vscode.WebviewPanel;
  private readonly _rootDir: string;
  private _reportPath = '';
  private _previewPath = '';
  private _version = 0;
  private _disposed = false;
  private _design: PreviewDesign = { accent: '#4f6df5', mode: 'auto', density: 'comfortable' };
  private _onMessage: (msg: PreviewMessage) => void | Promise<void> = () => {};

  private constructor(rootDir: string, previewDir: string) {
    this._rootDir = rootDir;
    const roots = [
      vscode.Uri.file(rootDir),
      vscode.Uri.file(previewDir),
      ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri),
    ];
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.reportPreview',
      'Evolve AI: Report Preview',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots },
    );
    this._panel.webview.onDidReceiveMessage((m: PreviewMessage) => this._onMessage(m));
    this._panel.onDidDispose(() => {
      this._disposed = true;
      if (ReportPreviewPanel._instance === this) ReportPreviewPanel._instance = null;
    });
  }

  get reportPath(): string { return this._reportPath; }

  dispose(): void { if (!this._disposed) this._panel.dispose(); }

  /** Re-point the iframe at the file on disk after it has been rewritten. */
  reload(): void {
    if (this._disposed) return;
    this._version++;
    this._panel.webview.postMessage({ type: 'reload', src: this._iframeSrc() });
  }

  setBusy(message: string | null): void {
    this._post({ type: 'busy', message });
  }

  setElapsed(secs: number): void { this._post({ type: 'elapsed', secs }); }
  setStatus(text: string): void { this._post({ type: 'status', text }); }
  setCanUndo(can: boolean): void { this._post({ type: 'canUndo', can }); }
  addHistory(entry: string): void { this._post({ type: 'history', entry }); }

  /** Reflect the live design values back into the controls. */
  setDesign(d: PreviewDesign): void {
    this._design = d;
    this._post({ type: 'design', design: d });
  }

  /** Ask the iframe for its current HTML (used before export / save-as-template). */
  requestHtml(): void { this._post({ type: 'requestHtml' }); }

  private _post(msg: Record<string, unknown>): void {
    if (this._disposed) return;
    this._panel.webview.postMessage(msg);
  }

  private _iframeSrc(): string {
    const uri = this._panel.webview.asWebviewUri(vscode.Uri.file(this._previewPath || this._reportPath));
    return `${uri.toString()}?v=${this._version}`;
  }

  private _render(): void {
    if (this._disposed) return;
    this._panel.title = `Preview: ${path.basename(this._reportPath)}`;
    this._panel.webview.html = this._html();
  }

  private _html(): string {
    const nonce = 'r7p2v9k4m1';
    const cs = this._panel.webview.cspSource;
    const chips = SUGGESTIONS
      .map(s => `<button class="chip" data-t="${escAttr(s)}">${escHtml(s)}</button>`)
      .join('');
    const d = this._design;

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${cs}; img-src ${cs} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column;
    font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  #frame-wrap { flex: 1 1 auto; position: relative; min-height: 0; }
  iframe { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
  #veil {
    position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    background: var(--vscode-editor-background); opacity: .85; font-size: 13px; gap: 10px;
  }
  #veil.on { display: flex; }
  .spin {
    width: 13px; height: 13px; border: 2px solid var(--vscode-descriptionForeground);
    border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  #dock {
    flex: 0 0 auto; border-top: 1px solid var(--vscode-widget-border, #8883);
    padding: 9px 14px 11px; background: var(--vscode-sideBar-background, transparent);
    max-height: 52%; overflow: auto;
  }
  .tabs { display: flex; gap: 3px; margin-bottom: 9px; }
  .tabs button {
    background: none; border: none; border-bottom: 2px solid transparent;
    padding: 5px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); cursor: pointer;
  }
  .tabs button.on { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .pane { display: none; }
  .pane.on { display: block; }

  .row { display: flex; gap: 8px; align-items: center; }
  #refine, #blockRefine {
    flex: 1 1 auto; padding: 8px 11px; font: inherit; font-size: 13px; border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
  }
  #refine:focus, #blockRefine:focus { outline: 1px solid var(--vscode-focusBorder); }
  button.act {
    font: inherit; font-size: 12px; border-radius: 6px; cursor: pointer; white-space: nowrap;
    border: 1px solid transparent; padding: 8px 14px;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  }
  button.act:hover:not(:disabled) { filter: brightness(1.12); }
  button.act:disabled { opacity: .45; cursor: default; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .chip {
    padding: 4px 10px; font-size: 11.5px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--vscode-widget-border, #8884); background: transparent;
    color: var(--vscode-descriptionForeground);
  }
  .chip:hover { color: var(--vscode-foreground); border-color: var(--vscode-focusBorder); }
  .bar { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .bar .sep { flex: 1 1 auto; }
  .link {
    background: none; border: none; padding: 4px 2px; font-size: 11.5px; cursor: pointer;
    color: var(--vscode-textLink-foreground);
  }
  .link:hover { text-decoration: underline; }
  #status { margin-top: 8px; font-size: 11.5px; color: var(--vscode-descriptionForeground); min-height: 15px; }
  #history { margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); max-height: 70px; overflow: auto; }
  #history div { padding: 1px 0; }
  #history div::before { content: "↳ "; opacity: .6; }

  /* Design pane */
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px 18px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); }
  .field select, .field input[type=text] {
    padding: 6px 8px; font: inherit; font-size: 12.5px; border-radius: 5px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #8884));
  }
  .swatches { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .sw { width: 20px; height: 20px; border-radius: 5px; cursor: pointer; border: 2px solid transparent; }
  .sw.on { border-color: var(--vscode-foreground); }
  input[type=color] { width: 34px; height: 24px; padding: 0; border: none; background: none; cursor: pointer; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 9px; line-height: 1.5; }
  .editing-note { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; }
  #blockTarget { font-size: 11.5px; color: var(--vscode-foreground); margin-bottom: 7px; }
  #blockTarget b { color: var(--vscode-textLink-foreground); }
</style></head><body>
  <div id="frame-wrap">
    <iframe id="frame" src="${escAttr(this._iframeSrc())}" sandbox="allow-scripts allow-same-origin allow-modals allow-popups"></iframe>
    <div id="veil"><span class="spin"></span><span id="veilmsg"></span><span id="elapsed"></span></div>
  </div>

  <div id="dock">
    <div class="tabs">
      <button data-p="refine" class="on">Refine</button>
      <button data-p="design">Design</button>
      <button data-p="block" id="blockTab" style="display:none;">Selected block</button>
    </div>

    <div class="pane on" id="pane-refine">
      <div class="row">
        <input id="refine" type="text" placeholder="Change the whole report — e.g. &quot;drop the raw table, add revenue by month&quot;" />
        <button id="apply" class="act primary" disabled>Apply</button>
        <button id="cancel" class="act" style="display:none;">■ Stop</button>
      </div>
      <div class="chips">${chips}</div>
      <div class="editing-note">
        Hover any section in the report to move, duplicate, delete or refine it on its own.
        Double-click any text to edit it directly — those changes are instant and cost nothing.
      </div>
    </div>

    <div class="pane" id="pane-design">
      <div class="grid">
        <div class="field">
          <label for="mode">Appearance</label>
          <select id="mode">
            <option value="auto">Follow the reader's system</option>
            <option value="light">Always light</option>
            <option value="dark">Always dark</option>
          </select>
        </div>
        <div class="field">
          <label for="density">Density</label>
          <select id="density">
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </div>
        <div class="field">
          <label>Accent colour</label>
          <div class="swatches" id="swatches">
            <span class="sw" data-c="#4f6df5" style="background:#4f6df5"></span>
            <span class="sw" data-c="#1f7a5a" style="background:#1f7a5a"></span>
            <span class="sw" data-c="#b5453a" style="background:#b5453a"></span>
            <span class="sw" data-c="#7c4dbe" style="background:#7c4dbe"></span>
            <span class="sw" data-c="#0f6fa8" style="background:#0f6fa8"></span>
            <span class="sw" data-c="#a8620f" style="background:#a8620f"></span>
            <input type="color" id="accent" value="${escAttr(d.accent)}" title="Custom accent" />
          </div>
        </div>
      </div>
      <div class="hint">Design changes re-render the report instantly — no AI call, nothing regenerated.</div>
    </div>

    <div class="pane" id="pane-block">
      <div id="blockTarget"></div>
      <div class="row">
        <input id="blockRefine" type="text" placeholder="Change just this block — e.g. &quot;show the top 5 only, as a horizontal bar chart&quot;" />
        <button id="applyBlock" class="act primary" disabled>Apply to block</button>
      </div>
      <div class="editing-note">Only this section is sent to the model, so the rest of the report cannot change.</div>
    </div>

    <div class="bar">
      <button id="undo" class="act" disabled>↶ Undo</button>
      <span class="sep"></span>
      <button class="link" id="tpl">Save as template</button>
      <button class="link" id="pdf">Export PDF</button>
      <button class="link" id="open">Open in browser</button>
      <button class="link" id="source">HTML source</button>
      <button class="link" id="reveal">Show in folder</button>
      <button class="link" id="regen">Regenerate…</button>
    </div>
    <div id="status"></div>
    <div id="history"></div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const post = m => vscode.postMessage(m);

  // ── Tabs ────────────────────────────────────────────────────────────────
  function showPane(p) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.getAttribute('data-p') === p));
    document.querySelectorAll('.pane').forEach(x => x.classList.remove('on'));
    $('pane-' + p).classList.add('on');
  }
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showPane(b.getAttribute('data-p')));

  // ── Whole-report refine ─────────────────────────────────────────────────
  const input = $('refine'), apply = $('apply');
  const syncApply = () => apply.disabled = input.value.trim().length === 0;
  input.addEventListener('input', syncApply);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) { e.preventDefault(); send(); }
  });
  function send() {
    const text = input.value.trim();
    if (!text) return;
    post({ type: 'refine', text });
    input.value = ''; syncApply();
  }
  apply.onclick = send;
  $('cancel').onclick = () => post({ type: 'cancel' });

  document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    input.value = c.getAttribute('data-t'); syncApply(); input.focus();
  });

  // ── Block-scoped refine ─────────────────────────────────────────────────
  let selBlock = null;
  const bInput = $('blockRefine'), bApply = $('applyBlock');
  const syncBlock = () => bApply.disabled = !selBlock || bInput.value.trim().length === 0;
  bInput.addEventListener('input', syncBlock);
  bInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !bApply.disabled) { e.preventDefault(); sendBlock(); }
  });
  function sendBlock() {
    if (!selBlock || !bInput.value.trim()) return;
    post({ type: 'refineBlock', blockId: selBlock.id, blockType: selBlock.type, text: bInput.value.trim() });
    bInput.value = ''; syncBlock();
  }
  bApply.onclick = sendBlock;

  function selectBlock(id, type) {
    selBlock = { id, type };
    $('blockTab').style.display = '';
    $('blockTarget').textContent = '';
    const t = document.createElement('span');
    t.textContent = 'Editing the ';
    const b = document.createElement('b');
    b.textContent = type || 'selected';
    t.appendChild(b);
    $('blockTarget').appendChild(t);
    $('blockTarget').appendChild(document.createTextNode(' block. '));
    showPane('block');
    syncBlock();
    bInput.focus();
  }

  // ── Design controls ─────────────────────────────────────────────────────
  $('mode').onchange    = e => post({ type: 'design', key: 'mode', value: e.target.value });
  $('density').onchange = e => post({ type: 'design', key: 'density', value: e.target.value });
  $('accent').oninput   = e => { markSwatch(e.target.value); post({ type: 'design', key: 'accent', value: e.target.value }); };
  document.querySelectorAll('.sw').forEach(s => s.onclick = () => {
    const c = s.getAttribute('data-c');
    $('accent').value = c; markSwatch(c);
    post({ type: 'design', key: 'accent', value: c });
  });
  function markSwatch(c) {
    document.querySelectorAll('.sw').forEach(s =>
      s.classList.toggle('on', (s.getAttribute('data-c') || '').toLowerCase() === (c || '').toLowerCase()));
  }
  markSwatch('${escAttr(d.accent)}');
  $('mode').value = '${escAttr(d.mode)}';
  $('density').value = '${escAttr(d.density)}';

  // ── Toolbar ─────────────────────────────────────────────────────────────
  $('undo').onclick   = () => post({ type: 'undo' });
  $('open').onclick   = () => post({ type: 'openExternal' });
  $('source').onclick = () => post({ type: 'openSource' });
  $('reveal').onclick = () => post({ type: 'reveal' });
  $('regen').onclick  = () => post({ type: 'regenerate' });
  $('pdf').onclick    = () => post({ type: 'exportPdf' });
  $('tpl').onclick    = () => post({ type: 'saveTemplate' });

  function busy(on, msg) {
    $('veil').classList.toggle('on', on);
    $('veilmsg').textContent = msg || '';
    if (!on) $('elapsed').textContent = '';
    apply.style.display = on ? 'none' : '';
    $('cancel').style.display = on ? '' : 'none';
    input.disabled = on; bInput.disabled = on;
  }

  // ── Messages from the report iframe (core/reportEditor.ts) ──────────────
  window.addEventListener('message', e => {
    const m = e.data || {};

    if (m.source === 'evolve-report-editor') {
      if (m.type === 'save')          post({ type: 'saveHtml', html: m.html });
      else if (m.type === 'dirty')    $('status').textContent = 'Saving…';
      else if (m.type === 'addBlock') post({ type: 'addBlock', afterId: m.afterId });
      else if (m.type === 'refine') {
        selectBlock(m.blockId, m.blockType);
        if (m.hint) { bInput.value = m.hint; syncBlock(); sendBlock(); }
      }
      return;
    }

    if (m.type === 'reload')        $('frame').src = m.src;
    else if (m.type === 'busy')     busy(!!m.message, m.message);
    else if (m.type === 'elapsed')  $('elapsed').textContent = m.secs > 0 ? '(' + m.secs + 's)' : '';
    else if (m.type === 'status')   $('status').textContent = m.text || '';
    else if (m.type === 'canUndo')  $('undo').disabled = !m.can;
    else if (m.type === 'design') {
      $('mode').value = m.design.mode; $('density').value = m.design.density;
      $('accent').value = m.design.accent; markSwatch(m.design.accent);
    } else if (m.type === 'requestHtml') {
      const f = $('frame');
      if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'evolve-request-html' }, '*');
    } else if (m.type === 'history') {
      const div = document.createElement('div');
      div.textContent = m.entry;
      $('history').appendChild(div);
      $('history').scrollTop = $('history').scrollHeight;
    }
  });
</script>
</body></html>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
function escAttr(s: string): string { return escHtml(s).replace(/`/g, '&#96;'); }
