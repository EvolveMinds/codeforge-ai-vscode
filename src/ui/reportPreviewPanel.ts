/**
 * ui/reportPreviewPanel.ts — live preview + refinement loop for HTML reports.
 *
 * The old flow ended the moment the file hit disk: the report opened in a
 * browser and the only way to change anything was to regenerate from scratch,
 * losing whatever was already good. This panel closes that loop.
 *
 * It renders the finished report in an iframe next to a refine box, so the user
 * can say "drop the raw table, add a monthly trend, use our brand blue" and
 * watch the report update in place. Every round is snapshotted, so Undo always
 * gets the previous version back.
 *
 * Presentation only: the panel posts typed messages and the plugin owns the AI
 * round-trip, the file writes, and the version stack.
 */

import * as vscode from 'vscode';
import * as path   from 'path';

export type PreviewMessage =
  | { type: 'refine';       text: string }
  | { type: 'undo' }
  | { type: 'cancel' }
  | { type: 'openExternal' }
  | { type: 'reveal' }
  | { type: 'openSource' }
  | { type: 'regenerate' };

/** Quick refinements offered as one-click chips. */
const SUGGESTIONS = [
  'Make it more concise — executive summary only',
  'Add a data-quality section',
  'Add a sortable table of the underlying rows',
  'Explain each chart in plain language',
  'Group the analysis by the main category column',
  'Add recommendations tied to the findings',
  'Use dark theme',
];

export class ReportPreviewPanel {
  private static _instance: ReportPreviewPanel | null = null;

  /**
   * Open (or reveal) the preview for `reportPath`. The webview can only load
   * local files under its `localResourceRoots`, which are fixed at creation —
   * so a report in a different folder needs a fresh panel.
   */
  static show(
    reportPath: string,
    onMessage: (msg: PreviewMessage) => void | Promise<void>,
  ): ReportPreviewPanel {
    const dir = path.dirname(reportPath);
    if (this._instance && this._instance._rootDir !== dir) {
      this._instance.dispose();
    }
    if (!this._instance) this._instance = new ReportPreviewPanel(dir);
    const inst = this._instance;
    inst._onMessage = onMessage;
    inst._reportPath = reportPath;
    inst._render();
    inst._panel.reveal(vscode.ViewColumn.Beside, /*preserveFocus*/ false);
    return inst;
  }

  static get current(): ReportPreviewPanel | null { return this._instance; }

  private readonly _panel: vscode.WebviewPanel;
  private readonly _rootDir: string;
  private _reportPath = '';
  private _version = 0;
  private _disposed = false;
  private _onMessage: (msg: PreviewMessage) => void | Promise<void> = () => {};

  private constructor(rootDir: string) {
    this._rootDir = rootDir;
    const roots = [vscode.Uri.file(rootDir), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri)];
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

  setCanUndo(can: boolean): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'canUndo', can });
  }

  /** Append a line to the refinement history shown under the input. */
  addHistory(entry: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'history', entry });
  }

  private _iframeSrc(): string {
    const uri = this._panel.webview.asWebviewUri(vscode.Uri.file(this._reportPath));
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
    background: var(--vscode-editor-background); opacity: .82; font-size: 13px; gap: 10px;
  }
  #veil.on { display: flex; }
  .spin {
    width: 13px; height: 13px; border: 2px solid var(--vscode-descriptionForeground);
    border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  #dock {
    flex: 0 0 auto; border-top: 1px solid var(--vscode-widget-border, #8883);
    padding: 10px 14px 12px; background: var(--vscode-sideBar-background, transparent);
    max-height: 46%; overflow: auto;
  }
  .row { display: flex; gap: 8px; align-items: center; }
  #refine {
    flex: 1 1 auto; padding: 8px 11px; font: inherit; font-size: 13px; border-radius: 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
  }
  #refine:focus { outline: 1px solid var(--vscode-focusBorder); }
  button {
    font: inherit; font-size: 12px; border-radius: 6px; cursor: pointer; white-space: nowrap;
    border: 1px solid transparent; padding: 8px 14px;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  }
  button:hover:not(:disabled) { filter: brightness(1.12); }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .chip {
    padding: 4px 10px; font-size: 11.5px; border-radius: 999px;
    border: 1px solid var(--vscode-widget-border, #8884); background: transparent;
    color: var(--vscode-descriptionForeground);
  }
  .chip:hover { color: var(--vscode-foreground); border-color: var(--vscode-focusBorder); }
  .bar { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .bar .sep { flex: 1 1 auto; }
  .link {
    background: none; border: none; padding: 4px 2px; font-size: 11.5px;
    color: var(--vscode-textLink-foreground); text-decoration: none;
  }
  .link:hover { text-decoration: underline; }
  #status { margin-top: 8px; font-size: 11.5px; color: var(--vscode-descriptionForeground); min-height: 15px; }
  #history { margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  #history div { padding: 1px 0; }
  #history div::before { content: "↳ "; opacity: .6; }
</style></head><body>
  <div id="frame-wrap">
    <iframe id="frame" src="${escAttr(this._iframeSrc())}" sandbox="allow-scripts allow-same-origin allow-modals allow-popups"></iframe>
    <div id="veil"><span class="spin"></span><span id="veilmsg"></span><span id="elapsed"></span></div>
  </div>

  <div id="dock">
    <div class="row">
      <input id="refine" type="text" placeholder="Refine this report — e.g. &quot;drop the raw table, add revenue by month, use a dark theme&quot;" />
      <button id="apply" class="primary" disabled>Apply</button>
      <button id="cancel" style="display:none;">■ Stop</button>
    </div>
    <div class="chips">${chips}</div>
    <div class="bar">
      <button id="undo" disabled>↶ Undo last change</button>
      <span class="sep"></span>
      <button class="link" id="open">Open in browser</button>
      <button class="link" id="source">View HTML source</button>
      <button class="link" id="reveal">Show in folder</button>
      <button class="link" id="regen">Regenerate from data…</button>
    </div>
    <div id="status"></div>
    <div id="history"></div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const post = m => vscode.postMessage(m);

  const input = $('refine');
  const apply = $('apply');

  function syncApply() { apply.disabled = input.value.trim().length === 0; }
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
  apply.onclick = send;
  $('cancel').onclick = () => post({ type: 'cancel' });
  $('undo').onclick   = () => post({ type: 'undo' });
  $('open').onclick   = () => post({ type: 'openExternal' });
  $('source').onclick = () => post({ type: 'openSource' });
  $('reveal').onclick = () => post({ type: 'reveal' });
  $('regen').onclick  = () => post({ type: 'regenerate' });

  document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    input.value = c.getAttribute('data-t');
    syncApply();
    input.focus();
  });

  function busy(on, msg) {
    $('veil').classList.toggle('on', on);
    $('veilmsg').textContent = msg || '';
    if (!on) $('elapsed').textContent = '';
    apply.style.display = on ? 'none' : '';
    $('cancel').style.display = on ? '' : 'none';
    input.disabled = on;
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'reload') {
      $('frame').src = m.src;
    } else if (m.type === 'busy') {
      busy(!!m.message, m.message);
    } else if (m.type === 'elapsed') {
      $('elapsed').textContent = m.secs > 0 ? '(' + m.secs + 's)' : '';
    } else if (m.type === 'status') {
      $('status').textContent = m.text || '';
    } else if (m.type === 'canUndo') {
      $('undo').disabled = !m.can;
    } else if (m.type === 'history') {
      const d = document.createElement('div');
      d.textContent = m.entry;
      $('history').appendChild(d);
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
