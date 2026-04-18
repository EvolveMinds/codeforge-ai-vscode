/**
 * ui/chatPanel.ts — Plugin-aware sidebar chat
 *
 * Fixes applied vs v2:
 *  FIX 5  — Active AI stream can be cancelled. A "Stop" button appears
 *            during streaming. Clicking it calls abort.abort().
 *  FIX 12 — Chat history is persisted to workspaceState. Survives panel
 *            reload, window reload, and VS Code restarts.
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import type { IServices } from '../core/services';
import type { AIRequest, Message } from '../core/aiService';

const HISTORY_KEY     = 'aiForge.chatHistory';
const MAX_HISTORY     = 40; // messages to keep in state
const HISTORY_UI_SHOW = 20; // messages shown in panel on load
const MSG_WINDOW_BUDGET = 48_000; // [FIX-10] Max chars for conversation history sent to AI

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'aiForge.chatPanel';
  private _view?: vscode.WebviewView;
  private _history: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }> = [];
  private _activeAbort: AbortController | null = null;   // FIX 5
  private _lastActiveFileUri: string | undefined;        // [FIX-5] Track file for apply safety

  // [FIX-18] Status debouncing and caching
  private _statusTimer: ReturnType<typeof setTimeout> | null = null;
  private _statusCache: { data: Record<string, unknown>; ts: number } | null = null;
  private static readonly STATUS_CACHE_TTL = 5_000;

  constructor(private readonly _svc: IServices) {
    // Restore persisted history (FIX 12)
    const saved = _svc.vsCtx.workspaceState.get<typeof this._history>(HISTORY_KEY, []);
    this._history = saved.slice(-MAX_HISTORY);

    // Allow CoreCommands to push messages into the panel
    _svc.vsCtx.subscriptions.push(
      vscode.commands.registerCommand('aiForge._sendToChat',
        (instruction: string, mode: string) => this.send(instruction, mode as 'chat' | 'edit' | 'new')
      )
    );

    // Refresh header when plugins / provider change
    // [FIX-18] Invalidate cache on provider change, debounce all status updates
    // [FIX-19] Store disposables to prevent listener accumulation on panel re-creation
    _svc.vsCtx.subscriptions.push(
      _svc.events.on('plugin.activated',   () => this._scheduleStatus()),
      _svc.events.on('plugin.deactivated', () => this._scheduleStatus()),
      _svc.events.on('provider.changed',   () => { this._statusCache = null; this._scheduleStatus(); }),
      _svc.events.on('ui.whatsNew.show',   ({ version }) => this._post({ type: 'whatsNew', version })),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this._view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html    = this._html();

    view.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'send':           await this.send(msg.text, msg.mode, msg.images);    break;
          case 'cancel':         this._activeAbort?.abort();             break;  // FIX 5
          case 'apply':          await this._apply(msg.content, msg.expectedUri); break;
          case 'applyNew':       await this._applyNew(msg.content);      break;
          case 'clear':          await this._clearHistory();             break;
          case 'getStatus':      await this._postStatus();               break;
          case 'getHistory':     this._sendHistory();                    break;
          case 'switchProvider': await vscode.commands.executeCommand('aiForge.switchProvider'); break;
          case 'toggleThinking': await vscode.workspace.getConfiguration('aiForge').update('gemma4ThinkingMode', msg.enabled, vscode.ConfigurationTarget.Global); break;
          case 'viewWhatsNew': {
            const v1 = this._svc.vsCtx.extension.packageJSON.version as string;
            await this._svc.vsCtx.globalState.update(`aiForge.whatsNewPending.${v1}`, false);
            await vscode.commands.executeCommand('aiForge.whatsNew');
            break;
          }
          case 'dismissWhatsNew': {
            const version = this._svc.vsCtx.extension.packageJSON.version as string;
            await this._svc.vsCtx.globalState.update(`aiForge.whatsNewDismissed.${version}`, true);
            await this._svc.vsCtx.globalState.update(`aiForge.whatsNewPending.${version}`, false);
            break;
          }
          case 'action':         await this._handleAction(msg);           break;
          default: console.warn('[Evolve AI] Unknown webview message type:', msg.type); break;
        }
      } catch (e) {
        console.error('[Evolve AI] Webview message handler error:', e);
        this._post({ type: 'notice', text: `Error: ${String(e)}. Try reloading the window (Ctrl+Shift+P > "Developer: Reload Window").` });
      }
    }, undefined, this._svc.vsCtx.subscriptions);

    this._postStatus();
    this._sendHistory();
  }

  show(): void { this._view?.show(true); }

  // ── Send ──────────────────────────────────────────────────────────────────────

  async send(instruction: string, mode: 'chat' | 'edit' | 'new' = 'chat', images?: string[]): Promise<void> {
    this.show();

    // [FIX-5] Track the active file at request time for safe apply
    this._lastActiveFileUri = vscode.window.activeTextEditor?.document.uri.toString();

    // [FIX-20] Wrap entire send flow in try/catch so context.build() failures
    // don't leave the panel in a broken state
    let ctx, system, user;
    try {
      ctx    = await this._svc.context.build();
      system = this._svc.context.buildSystemPrompt(ctx);
      user   = this._svc.context.buildUserPrompt(ctx, instruction);
    } catch (e) {
      this._post({ type: 'aiChunk', text: `\n\n⚠ Context build failed: ${String(e)}` });
      this._post({ type: 'aiDone', content: '', mode, expectedUri: undefined });
      return;
    }

    const ctxTag = [
      ctx.activeFile?.relPath,
      ctx.selection        ? 'selection'            : null,
      ctx.errors.length    ? `${ctx.errors.length} error(s)` : null,
      ctx.gitDiff          ? 'git diff'             : null,
      ...[...ctx.pluginData.keys()],
    ].filter(Boolean).join(' · ');

    this._post({ type: 'userMsg', text: instruction, context: ctxTag });
    const userMsg: { role: 'user' | 'assistant'; content: string; images?: string[] } = { role: 'user', content: user };
    if (images?.length) { userMsg.images = images; }
    this._history.push(userMsg);
    this._post({ type: 'aiStart' });

    // FIX 5 — create abort controller, send stop signal to panel
    const abort = new AbortController();
    this._activeAbort = abort;
    this._post({ type: 'streamStart' });

    let full = '';
    try {
      const req: AIRequest = {
        // [FIX-10] Token-aware message windowing instead of blind slice(-10)
        messages:    this._windowMessages(MSG_WINDOW_BUDGET),
        system,
        instruction,
        mode,
        signal:      abort.signal,     // FIX 5
      };
      for await (const chunk of this._svc.ai.stream(req)) {
        full += chunk;
        this._post({ type: 'aiChunk', text: chunk });
      }
    } catch (e) {
      this._post({ type: 'aiChunk', text: `\n\n⚠ ${String(e)}` });
    }

    this._activeAbort = null;
    this._history.push({ role: 'assistant', content: full });

    // FIX 12 — persist history after every exchange
    await this._saveHistory();

    // [FIX-5] Include the expected file URI so the webview can pass it back on apply
    this._post({ type: 'aiDone', content: full, mode, expectedUri: this._lastActiveFileUri });
  }

  // [FIX-10] Walk history backwards, accumulating messages until budget is exceeded
  private _windowMessages(budget: number): Message[] {
    const msgs = [...this._history];
    let total = 0;
    const result: Message[] = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const len = msgs[i].content.length;
      if (total + len > budget && result.length > 0) break;
      result.unshift(msgs[i]);
      total += len;
    }
    return result;
  }

  // ── History ───────────────────────────────────────────────────────────────────

  private async _saveHistory(): Promise<void> {
    const trimmed = this._history.slice(-MAX_HISTORY);
    this._history = trimmed;
    await this._svc.vsCtx.workspaceState.update(HISTORY_KEY, trimmed);
  }

  private async _clearHistory(): Promise<void> {
    this._history = [];
    await this._svc.vsCtx.workspaceState.update(HISTORY_KEY, []);
    this._statusCache = null;  // Invalidate so onboarding guide re-evaluates
    this._post({ type: 'historyClear' });
  }

  private _sendHistory(): void {
    // Send last N messages to populate the panel on load
    const recent = this._history.slice(-HISTORY_UI_SHOW);
    this._post({ type: 'historyLoad', messages: recent });
  }

  // ── Apply ─────────────────────────────────────────────────────────────────────

  // [FIX-5] Verify the active file matches what was in context before applying
  private async _apply(content: string, expectedUri?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { this._post({ type: 'notice', text: '✗ No active editor' }); return; }

    if (expectedUri && editor.document.uri.toString() !== expectedUri) {
      const basename = path.basename(editor.document.uri.fsPath);
      const ans = await vscode.window.showWarningMessage(
        `Active file changed since AI response. Apply to "${basename}" anyway?`,
        'Apply', 'Cancel'
      );
      if (ans !== 'Apply') return;
    }

    try {
      await this._svc.workspace.applyToActiveFile(content.replace(/^```[\w]*\n?|```\s*$/gm, '').trim());
      this._post({ type: 'notice', text: '✓ Applied to current file' });
    } catch (e) {
      this._post({ type: 'notice', text: `✗ ${String(e)}` });
    }
  }

  private async _applyNew(content: string): Promise<void> {
    const ws    = vscode.workspace.getWorkspaceFolder(
      vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.file('.')
    )?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    const files = this._svc.workspace.parseMultiFileOutput(content, ws);
    if (files.length === 0) { this._post({ type: 'notice', text: '⚠ Could not parse files from response' }); return; }
    await this._svc.workspace.applyGeneratedFiles(files);
    this._post({ type: 'notice', text: `✓ Created/updated ${files.length} file(s)` });
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  // [FIX-18] Debounced status update — avoids redundant network calls
  private _scheduleStatus(): void {
    if (this._statusTimer) clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      this._statusTimer = null;
      this._postStatus();
    }, 300);
  }

  private async _handleAction(msg: Record<string, string>): Promise<void> {
    switch (msg.action) {
      case 'openUrl':
        if (msg.url) {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
      case 'openSettings':
        if (msg.query) {
          await vscode.commands.executeCommand('workbench.action.openSettings', msg.query);
        }
        break;
      case 'pullModel': {
        const cfg = vscode.workspace.getConfiguration('aiForge');
        const model = cfg.get<string>('ollamaModel', 'qwen2.5-coder:7b');
        const term = vscode.window.createTerminal('Evolve AI: Install Model');
        term.show();
        term.sendText(`ollama pull ${model}`);
        this._post({ type: 'notice', text: `Installing model "${model}"... Once complete, try your request again.` });
        break;
      }
      case 'switchProvider':
        await vscode.commands.executeCommand('aiForge.switchProvider');
        break;
      default:
        console.warn('[Evolve AI] Unknown action:', msg.action);
    }
  }

  private async _postStatus(): Promise<void> {
    // [FIX-18] Return cached status if recent
    const now = Date.now();
    if (this._statusCache && (now - this._statusCache.ts) < ChatPanelProvider.STATUS_CACHE_TTL) {
      this._post(this._statusCache.data);
      return;
    }

    const cfg      = vscode.workspace.getConfiguration('aiForge');
    const host     = cfg.get<string>('ollamaHost', 'http://localhost:11434');
    const running  = await this._svc.ai.isOllamaRunning(host);
    const models   = running ? await this._svc.ai.getOllamaModels(host) : [];
    const provider = await this._svc.ai.detectProvider();
    const active   = this._svc.plugins.active;
    const statusMsg: Record<string, unknown> = {
      type: 'status',
      provider,
      ollamaRunning: running,
      ollamaModels:  models,
      currentModel:  provider === 'gemma4'
        ? cfg.get<string>('gemma4Model', 'gemma4:e4b')
        : cfg.get<string>('ollamaModel', ''),
      activePlugins: active.map(p => ({ id: p.id, name: p.displayName, icon: p.icon })),
      os: process.platform,
    };
    this._statusCache = { data: statusMsg, ts: now };
    this._post(statusMsg);

    // Replay "What's New" banner if there's a pending upgrade notification.
    // The pending flag is set by activate() and cleared on dismiss/view.
    const version = this._svc.vsCtx.extension.packageJSON.version as string;
    const pending = this._svc.vsCtx.globalState.get<boolean>(`aiForge.whatsNewPending.${version}`, false);
    if (pending) {
      this._post({ type: 'whatsNew', version });
    }
  }

  private _post(msg: Record<string, unknown>): void {
    this._view?.webview.postMessage(msg);
  }

  // ── HTML ──────────────────────────────────────────────────────────────────────
  // [FIX-9] Extracted into a readable, maintainable template
  // [FIX-16] Streaming render batched via requestAnimationFrame

  private _html(): string {
    // [SEC-3] Generate a nonce for CSP — prevents inline script injection
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root {
  --bg: var(--vscode-sideBar-background);
  --bg2: var(--vscode-editor-background);
  --border: var(--vscode-panel-border);
  --text: var(--vscode-foreground);
  --muted: var(--vscode-descriptionForeground);
  --accent: var(--vscode-button-background);
  --green: var(--vscode-testing-iconPassed);
  --yellow: var(--vscode-editorWarning-foreground);
  --mono: var(--vscode-editor-font-family);
  --font: var(--vscode-font-family);
  --fsz: var(--vscode-font-size);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: var(--fsz); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

/* Header */
#header { padding: 6px 10px; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 11px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex-shrink: 0; transition: background 0.3s; }
.dot.green { background: var(--green); }
.dot.yellow { background: var(--yellow); }
#providerLabel { font-weight: 600; }
#modelLabel { color: var(--muted); }
#pluginBadges { display: flex; gap: 4px; margin-left: 4px; }
.badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; padding: 1px 5px; font-size: 10px; }
.hbtn { background: none; border: 1px solid var(--border); color: var(--muted); padding: 2px 7px; border-radius: 3px; cursor: pointer; font-size: 10px; transition: color 0.15s; }
.hbtn:hover { color: var(--text); }
#rightBtns { margin-left: auto; display: flex; gap: 4px; }

/* Tabs */
#tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.tab { flex: 1; padding: 7px 4px; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--accent); }

/* Messages */
#msgs { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.msg { border-radius: 6px; padding: 10px 12px; line-height: 1.55; word-break: break-word; animation: fadeIn 0.15s ease-out; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.msg.user { background: var(--vscode-inputOption-activeBackground); align-self: flex-end; max-width: 92%; }
.msg.ai { background: var(--bg2); border: 1px solid var(--border); }
.msg.notice { background: none; border: 1px dashed var(--border); color: var(--muted); font-size: 11px; text-align: center; }
.ctx { font-size: 10px; color: var(--muted); margin-top: 4px; }

/* Welcome state */
.welcome { text-align: center; padding: 20px 16px; color: var(--muted); }
.welcome h3 { color: var(--text); margin-bottom: 8px; font-size: 13px; }
.welcome p { font-size: 11px; line-height: 1.6; margin: 3px 0; }
.welcome kbd { background: var(--bg2); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px; font-size: 10px; font-family: var(--mono); }

/* Onboarding guide */
.onboarding { padding: 12px 16px; color: var(--text); font-size: 11px; line-height: 1.7; }
.onboarding h3 { color: var(--text); margin-bottom: 10px; font-size: 14px; font-weight: 600; }
.onboarding h4 { color: var(--text); margin: 12px 0 4px; font-size: 12px; font-weight: 600; }
.onboarding p { margin: 4px 0; }
.onboarding ol { margin: 4px 0 8px 18px; padding: 0; }
.onboarding li { margin: 3px 0; }
.onboarding a { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; cursor: pointer; }
.onboarding a:hover { text-decoration: underline; }
.onboarding code { background: var(--bg2); border-radius: 3px; padding: 1px 5px; font-family: var(--mono); font-size: 10px; }
.setup-option { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin: 8px 0; }
.setup-table { width: 100%; border-collapse: collapse; margin: 6px 0; }
.setup-table td { padding: 4px 8px 4px 0; font-size: 11px; vertical-align: middle; }
.setup-table tr:not(:last-child) td { border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.setup-table tr:not(:first-child) td { padding-top: 6px; }

/* Thinking indicator */
.thinking { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; padding: 8px 12px; }
.thinking-dots span { display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: var(--muted); animation: dotPulse 1.2s infinite ease-in-out; }
.thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotPulse { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }

/* Toast */
.toast { position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%); background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 5px 14px; border-radius: 4px; font-size: 11px; z-index: 100; animation: toastIn 0.2s ease-out, toastOut 0.3s 1.5s ease-in forwards; pointer-events: none; }
@keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(8px); } }
@keyframes toastOut { to { opacity: 0; } }

/* Code */
pre { background: var(--vscode-textBlockQuote-background); border: 1px solid var(--border); border-radius: 4px; padding: 8px; overflow-x: auto; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; margin: 6px 0; }
code { font-family: var(--mono); font-size: 12px; background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 2px; }

/* Actions */
.actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.hbtn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
#imagePreview { display: flex; gap: 6px; padding: 6px 8px; flex-wrap: wrap; }
#imagePreview .img-thumb { position: relative; display: inline-block; }
#imagePreview .img-thumb img { max-height: 60px; max-width: 100px; border-radius: 4px; border: 1px solid var(--border); }
#imagePreview .img-thumb .remove-img { position: absolute; top: -4px; right: -4px; background: var(--vscode-errorForeground, #f44); color: #fff; border: none; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; cursor: pointer; line-height: 16px; text-align: center; padding: 0; }
.drop-highlight { outline: 2px dashed var(--vscode-textLink-foreground, #3794ff); outline-offset: -2px; }
.thinking-block { background: var(--bg2); border-left: 3px solid var(--vscode-textLink-foreground, #3794ff); border-radius: 4px; padding: 8px 12px; margin-bottom: 10px; font-size: 11px; color: var(--vscode-descriptionForeground, #888); line-height: 1.5; }
.thinking-block summary { cursor: pointer; font-weight: 600; font-size: 11px; color: var(--vscode-textLink-foreground, #3794ff); user-select: none; }
.thinking-block summary:hover { text-decoration: underline; }
.thinking-block .thinking-content { margin-top: 6px; white-space: pre-wrap; }
#whatsNewBanner { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: linear-gradient(90deg, var(--vscode-textLink-foreground, #3794ff) 0%, var(--vscode-textLink-activeForeground, #4ca0ff) 100%); color: #fff; font-size: 11px; border-bottom: 1px solid var(--border); }
#whatsNewText { flex: 1; font-weight: 500; }
.banner-btn { background: rgba(255,255,255,0.2); color: #fff; border: 1px solid rgba(255,255,255,0.3); border-radius: 3px; padding: 2px 8px; cursor: pointer; font-size: 11px; font-weight: 500; }
.banner-btn:hover { background: rgba(255,255,255,0.3); }
.banner-close { background: transparent; color: #fff; border: none; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; opacity: 0.7; }
.banner-close:hover { opacity: 1; }
.gemma4-tip { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; margin-top: 10px; font-size: 11px; line-height: 1.6; color: var(--text); }
.gemma4-tip code { background: var(--bg1); border-radius: 3px; padding: 1px 5px; font-family: var(--mono); font-size: 10px; }
.gemma4-tip a { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: none; cursor: pointer; font-size: 11px; }
.gemma4-tip a:hover { text-decoration: underline; }
.btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.15s, transform 0.1s; }
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn:active { transform: scale(0.97); }
.btn.primary { background: var(--accent); color: var(--vscode-button-foreground); }
.btn.primary:hover { filter: brightness(1.1); }

/* Streaming cursor */
.streaming::after { content: '\\25CB'; animation: blink .7s infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* Input */
#inputArea { border-top: 1px solid var(--border); padding: 8px; flex-shrink: 0; }
#row { display: flex; gap: 6px; align-items: flex-end; }
#input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 7px 10px; font-family: var(--font); font-size: var(--fsz); resize: none; min-height: 36px; max-height: 140px; overflow-y: auto; transition: border-color 0.15s; }
#input:focus { outline: none; border-color: var(--accent); }
#sendBtn { background: var(--accent); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 7px 14px; cursor: pointer; font-size: 13px; flex-shrink: 0; transition: opacity 0.15s; }
#sendBtn:hover { filter: brightness(1.1); }
#sendBtn:disabled { opacity: .4; cursor: not-allowed; }
#stopBtn { display: none; background: var(--vscode-errorForeground); color: #fff; border: none; border-radius: 4px; padding: 7px 12px; cursor: pointer; font-size: 12px; flex-shrink: 0; }
.hint { font-size: 10px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>

<div id="header">
  <div class="dot" id="dot"></div>
  <span id="providerLabel">...</span>
  <span id="modelLabel"></span>
  <div id="pluginBadges"></div>
  <div id="rightBtns">
    <button class="hbtn" id="thinkBtn" title="Toggle Gemma 4 thinking mode — shows chain-of-thought reasoning" style="display:none;">Think</button>
    <button class="hbtn" id="switchBtn" title="Switch AI provider">Switch</button>
    <button class="hbtn" id="clearBtn" title="Clear conversation history">Clear</button>
  </div>
</div>

<div id="whatsNewBanner" style="display:none;">
  <span id="whatsNewText">What's new in this version</span>
  <button class="banner-btn" id="viewWhatsNewBtn">View</button>
  <button class="banner-close" id="dismissBannerBtn" aria-label="Dismiss" title="Dismiss">&times;</button>
</div>

<div id="tabs">
  <button class="tab active" id="tabChat" title="Ask questions about your code">Chat</button>
  <button class="tab"        id="tabEdit" title="Describe changes to apply to the active file">Edit</button>
  <button class="tab"        id="tabNew"  title="Generate new files from a description">Create</button>
</div>

<div id="msgs">
  <div class="welcome">
    <h3>Evolve AI</h3>
    <p><strong>Chat</strong> &mdash; ask questions about your code</p>
    <p><strong>Edit</strong> &mdash; describe changes to the active file</p>
    <p><strong>Create</strong> &mdash; generate new files from scratch</p>
    <p style="margin-top:8px">Right-click code for inline actions</p>
    <p><kbd>Ctrl+Shift+A</kbd> to open &middot; <kbd>Ctrl+Alt+E</kbd> to explain selection</p>
  </div>
</div>

<div id="inputArea">
  <div id="imagePreview" style="display:none;"></div>
  <div id="row">
    <textarea id="input" rows="1" placeholder="Ask Evolve AI..."></textarea>
    <button id="stopBtn">Stop</button>
    <button id="sendBtn">&#9654;</button>
  </div>
  <div class="hint" id="hint">Chat: ask anything &middot; Shift+Enter for newline</div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let mode = 'chat', streaming = false, lastContent = '', lastExpectedUri = null, aiEl = null;
let renderPending = false;
let currentProvider = 'offline';
let gemma4TipShown = false;
let pendingImages = [];

function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('active', ['chat', 'edit', 'new'][i] === m)
  );
  const hints = {
    chat: 'Chat: ask anything \\u00B7 Shift+Enter for newline',
    edit: 'Edit: describe the change to apply \\u00B7 Shift+Enter for newline',
    new:  'Create: describe what to generate \\u00B7 Shift+Enter for newline'
  };
  const placeholders = {
    chat: 'Ask about your code...',
    edit: 'Describe the change to make...',
    new:  'Describe what to create...'
  };
  document.getElementById('hint').textContent = hints[m];
  document.getElementById('input').placeholder = placeholders[m];
}

function resize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }
function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }

function showOnboardingGuide(statusData) {
  // Don't duplicate
  let guide = document.getElementById('onboardingGuide');
  if (guide) guide.remove();

  const msgs = document.getElementById('msgs');
  guide = document.createElement('div');
  guide.id = 'onboardingGuide';
  guide.className = 'onboarding';

  const os = statusData.os || 'unknown';
  const ollamaRunning = statusData.ollamaRunning;
  const provider = statusData.provider;

  // Detect specific scenario
  let title, body;

  if ((provider === 'ollama' || provider === 'gemma4') && !ollamaRunning) {
    // Ollama/Gemma 4 is selected but not running
    const provName = provider === 'gemma4' ? 'Gemma 4' : 'Ollama';
    title = 'Ollama is not running';
    body = '<p>Evolve AI is configured to use <strong>' + provName + '</strong> but cannot connect to Ollama.</p>';
    if (os === 'win32') {
      body += '<p><strong>To fix:</strong></p>'
        + '<ol>'
        + '<li>Make sure Ollama is installed. If not: <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://ollama.com/download/windows\\'});return false;">Download Ollama for Windows</a></li>'
        + '<li>Launch the Ollama app from your Start menu</li>'
        + '<li>If localhost doesn\\u2019t work, try setting <code>aiForge.ollamaHost</code> to <code>http://127.0.0.1:11434</code> in <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openSettings\\',query:\\'aiForge.ollamaHost\\'});return false;">Settings</a></li>'
        + '</ol>';
    } else if (os === 'darwin') {
      body += '<p><strong>To fix:</strong></p>'
        + '<ol>'
        + '<li>Make sure Ollama is installed. If not: <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://ollama.com/download/mac\\'});return false;">Download Ollama for Mac</a></li>'
        + '<li>Launch Ollama from your Applications folder or run <code>ollama serve</code> in terminal</li>'
        + '</ol>';
    } else {
      body += '<p><strong>To fix:</strong></p>'
        + '<ol>'
        + '<li>Install Ollama: <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://ollama.com/download/linux\\'});return false;">Download Ollama for Linux</a> or run: <code>curl -fsSL https://ollama.ai/install.sh | sh</code></li>'
        + '<li>Start the server: <code>ollama serve</code></li>'
        + '</ol>';
    }
  } else {
    // Fully offline — no provider configured
    title = 'Welcome to Evolve AI!';
    body = '<p>No AI provider is connected. Choose how you want to use Evolve AI:</p>';

    // Option 1: Gemma 4 (free, local, multimodal)
    body += '<div class="setup-option">'
      + '<h4>Option 1: Gemma 4 (Free, Local, Multimodal) \\u2014 Recommended</h4>'
      + '<p>Google\\u2019s latest open-weight AI model. Runs entirely on your machine \\u2014 '
      + 'no API key, no cost, no data ever leaves your computer. Apache 2.0 licensed.</p>'
      + '<ul style="margin:6px 0;padding-left:18px;font-size:12px;">'
      + '<li><strong>Code-focused</strong> \\u2014 trained on 140+ programming languages</li>'
      + '<li><strong>Multimodal</strong> \\u2014 understands text, images, and audio</li>'
      + '<li><strong>128K\\u2013256K context</strong> \\u2014 handles large files and full repositories</li>'
      + '<li><strong>4 sizes</strong> \\u2014 from lightweight (8GB RAM) to maximum quality (32GB+)</li>'
      + '</ul>'
      + '<p><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'switchProvider\\',provider:\\'gemma4\\'});return false;">'
      + '<strong>\\u2728 Set up Gemma 4</strong> (guided wizard, ~2 minutes)</a></p>'
      + '</div>';

    // Option 2: Ollama (free, local)
    body += '<div class="setup-option">'
      + '<h4>Option 2: Ollama (Free, Private, Local)</h4>'
      + '<p>Run AI completely on your machine — no API key, no cost, no data leaves your computer.</p>';

    if (os === 'win32') {
      body += '<p><strong>Step 1:</strong> <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://ollama.com/download/windows\\'});return false;">Download Ollama for Windows</a></p>';
    } else if (os === 'darwin') {
      body += '<p><strong>Step 1:</strong> <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://ollama.com/download/mac\\'});return false;">Download Ollama for Mac</a></p>';
    } else {
      body += '<p><strong>Step 1:</strong> <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://ollama.com/download/linux\\'});return false;">Download Ollama for Linux</a></p>';
    }

    body += '<p><strong>Step 2:</strong> <a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'pullModel\\'});return false;">Install the AI Model (one click)</a></p>'
      + '<p>This will open a terminal and run <code>ollama pull qwen2.5-coder:7b</code> for you.</p>'
      + '</div>';

    // Option 3: Cloud providers
    body += '<div class="setup-option">'
      + '<h4>Option 3: Cloud AI Providers</h4>'
      + '<p>Use a cloud AI for the best quality responses. Requires an API key.</p>'
      + '<table class="setup-table">'
      + '<tr><td><strong>Anthropic Claude</strong></td><td><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://console.anthropic.com/\\'});return false;">Get API Key</a></td><td><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'switchProvider\\',provider:\\'anthropic\\'});return false;">Connect</a></td></tr>'
      + '<tr><td><strong>OpenAI</strong></td><td><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://platform.openai.com/api-keys\\'});return false;">Get API Key</a></td><td><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'switchProvider\\',provider:\\'openai\\'});return false;">Connect</a></td></tr>'
      + '<tr><td><strong>HuggingFace</strong></td><td><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openUrl\\',url:\\'https://huggingface.co/settings/tokens\\'});return false;">Get Token</a></td><td><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'switchProvider\\',provider:\\'huggingface\\'});return false;">Connect</a></td></tr>'
      + '</table>'
      + '</div>';

    // Option 4: LM Studio / llama.cpp
    body += '<div class="setup-option">'
      + '<h4>Option 4: LM Studio / llama.cpp / Jan</h4>'
      + '<p>Already running a local LLM server? Point Evolve AI to it:</p>'
      + '<p><a href="#" onclick="vscode.postMessage({type:\\'action\\',action:\\'openSettings\\',query:\\'aiForge.ollamaHost\\'});return false;">Set your server URL in Settings</a> (e.g., <code>http://localhost:1234/v1</code>)</p>'
      + '</div>';
  }

  guide.innerHTML = '<h3>' + title + '</h3>' + body;
  // Insert after the welcome message
  const welcome = msgs.querySelector('.welcome');
  if (welcome) {
    welcome.style.display = 'none';
    msgs.insertBefore(guide, welcome.nextSibling);
  } else {
    msgs.prepend(guide);
  }
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseThinking(s) {
  // Gemma 4 thinking markers: <|channel>thought\\n...content...<channel|>
  // Also handle partial markers during streaming
  const parts = [];
  let rest = s;
  const thinkStart = /<\\|channel>thought\\n/g;
  const thinkEnd = /<channel\\|>/g;
  let match;
  while ((match = thinkStart.exec(rest)) !== null) {
    const before = rest.slice(0, match.index);
    if (before.trim()) parts.push({ type: 'text', content: before });
    thinkEnd.lastIndex = thinkStart.lastIndex;
    const endMatch = thinkEnd.exec(rest);
    if (endMatch) {
      const thought = rest.slice(thinkStart.lastIndex, endMatch.index);
      parts.push({ type: 'thinking', content: thought });
      rest = rest.slice(endMatch.index + endMatch[0].length);
      thinkStart.lastIndex = 0;
    } else {
      // Partial thinking block (still streaming) — show as open thinking
      const thought = rest.slice(thinkStart.lastIndex);
      parts.push({ type: 'thinking_partial', content: thought });
      rest = '';
      break;
    }
  }
  if (rest.trim()) parts.push({ type: 'text', content: rest });
  return parts;
}

function md(s) {
  // Parse thinking blocks first
  const parts = parseThinking(s);
  if (parts.length > 1 || (parts.length === 1 && parts[0].type !== 'text')) {
    return parts.map(p => {
      if (p.type === 'thinking') {
        return '<details class="thinking-block"><summary>Thinking...</summary><div class="thinking-content">' + mdInner(esc(p.content)) + '</div></details>';
      } else if (p.type === 'thinking_partial') {
        return '<details class="thinking-block" open><summary>Thinking...</summary><div class="thinking-content">' + mdInner(esc(p.content)) + '</div></details>';
      }
      return mdInner(p.content);
    }).join('');
  }
  return mdInner(s);
}

function mdInner(s) {
  const blocks = [];
  s = s.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
    blocks.push('<pre>' + code + '</pre>');
    return '%%BLK' + (blocks.length - 1) + '%%';
  });
  s = s.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  s = s.replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>');
  s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  s = s.replace(/^[-*] (.+)$/gm, '\\u2022 $1');
  s = s.replace(/\\n/g, '<br>');
  blocks.forEach((b, i) => { s = s.replace('%%BLK' + i + '%%', b); });
  return s;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function clearWelcome() {
  const w = document.querySelector('.welcome');
  if (w) w.remove();
}

function addMsg(cls, html, id) {
  clearWelcome();
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  el.innerHTML = html;
  if (id) el.id = id;
  document.getElementById('msgs').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth' });
  return el;
}

function addImage(base64) {
  pendingImages.push(base64);
  const preview = document.getElementById('imagePreview');
  preview.style.display = 'flex';
  const thumb = document.createElement('span');
  thumb.className = 'img-thumb';
  const idx = pendingImages.length - 1;
  thumb.innerHTML = '<img src="data:image/png;base64,' + base64 + '"><button class="remove-img" data-idx="' + idx + '">&times;</button>';
  thumb.querySelector('.remove-img').addEventListener('click', function() {
    pendingImages[this.dataset.idx] = null;
    this.parentElement.remove();
    if (!pendingImages.some(Boolean)) {
      preview.style.display = 'none';
      pendingImages = [];
    }
  });
  preview.appendChild(thumb);
}

function fileToBase64(file) {
  return new Promise(function(resolve) {
    const reader = new FileReader();
    reader.onload = function() {
      const result = reader.result;
      resolve(result.split(',')[1]); // strip data:...;base64, prefix
    };
    reader.readAsDataURL(file);
  });
}

function send() {
  if (streaming) return;
  const inp = document.getElementById('input');
  const t = inp.value.trim();
  if (!t && !pendingImages.some(Boolean)) return;
  inp.value = ''; inp.style.height = 'auto';
  document.getElementById('sendBtn').disabled = true;
  const images = pendingImages.filter(Boolean);
  pendingImages = [];
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('imagePreview').innerHTML = '';
  const msg = { type: 'send', text: t || 'Describe this image.', mode: mode };
  if (images.length) { msg.images = images; }
  vscode.postMessage(msg);
}

function cancel() { vscode.postMessage({ type: 'cancel' }); }

function clearHistory() {
  vscode.postMessage({ type: 'clear' });
}

window.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'whatsNew': {
      const banner = document.getElementById('whatsNewBanner');
      const text = document.getElementById('whatsNewText');
      if (banner && text) {
        text.textContent = "What's new in v" + data.version + " \\u2014 click to see highlights";
        banner.style.display = 'flex';
      }
      break;
    }
    case 'status': {
      currentProvider = data.provider;
      const d = document.getElementById('dot');
      // Green when any provider is configured and working
      const isReady = (data.provider === 'ollama' || data.provider === 'gemma4') ? data.ollamaRunning
        : (data.provider !== 'offline' && data.provider !== 'auto');
      d.className = 'dot ' + (isReady ? 'green' : 'yellow');
      d.title = isReady ? 'Provider connected' : 'No AI provider active';
      const providerLabel = data.provider === 'gemma4' ? 'GEMMA 4' : data.provider.toUpperCase();
      document.getElementById('providerLabel').textContent = providerLabel;
      // Show thinking toggle only for Gemma 4
      const thinkBtn = document.getElementById('thinkBtn');
      thinkBtn.style.display = data.provider === 'gemma4' ? '' : 'none';
      document.getElementById('modelLabel').textContent = data.currentModel ? ' \\u00B7 ' + data.currentModel : '';
      const pb = document.getElementById('pluginBadges');
      pb.innerHTML = (data.activePlugins || []).map(p =>
        '<span class="badge" title="' + esc(p.name) + '">' + esc(p.icon) + '</span>'
      ).join('');

      // Show onboarding guide when offline or Ollama not running
      if (!isReady) {
        showOnboardingGuide(data);
      } else {
        // Remove onboarding if provider becomes ready
        const existing = document.getElementById('onboardingGuide');
        if (existing) existing.remove();
      }
      break;
    }
    case 'historyLoad': {
      const msgs = document.getElementById('msgs');
      if (data.messages && data.messages.length > 0) {
        msgs.innerHTML = '';
        data.messages.forEach(m => {
          if (m.role === 'user') {
            // Show only the instruction line, not the full context-enriched prompt
            const lines = m.content.split('\\n');
            const short = lines[lines.length - 1] || lines[0] || m.content;
            addMsg('user', esc(short));
          } else {
            addMsg('ai', md(esc(m.content)));
          }
        });
        addMsg('notice', 'Previous conversation restored');
      }
      break;
    }
    case 'historyClear': {
      const msgsEl = document.getElementById('msgs');
      msgsEl.innerHTML = '';
      // Restore welcome message
      const w = document.createElement('div');
      w.className = 'welcome';
      w.innerHTML = '<h3>Evolve AI</h3>'
        + '<p><strong>Chat</strong> &mdash; ask questions about your code</p>'
        + '<p><strong>Edit</strong> &mdash; describe changes to the active file</p>'
        + '<p><strong>Create</strong> &mdash; generate new files from scratch</p>'
        + '<p style="margin-top:8px">Right-click code for inline actions</p>'
        + '<p><kbd>Ctrl+Shift+A</kbd> to open &middot; <kbd>Ctrl+Alt+E</kbd> to explain selection</p>';
      msgsEl.appendChild(w);
      // Re-check status to show onboarding guide if offline
      vscode.postMessage({ type: 'getStatus' });
      break;
    }
    case 'userMsg':
      addMsg('user', esc(data.text) + (data.context ? '<div class="ctx">' + esc(data.context) + '</div>' : ''));
      break;
    case 'streamStart': {
      streaming = true;
      document.getElementById('stopBtn').style.display = 'block';
      document.getElementById('sendBtn').style.display = 'none';
      // Show thinking indicator before first chunk arrives
      const thinking = document.createElement('div');
      thinking.className = 'thinking';
      thinking.id = 'thinkingIndicator';
      thinking.innerHTML = 'Thinking <div class="thinking-dots"><span></span><span></span><span></span></div>';
      document.getElementById('msgs').appendChild(thinking);
      thinking.scrollIntoView({ behavior: 'smooth' });
      lastContent = '';
      aiEl = null;
      break;
    }
    case 'aiChunk':
      // Remove thinking indicator on first chunk
      if (!aiEl) {
        const ti = document.getElementById('thinkingIndicator');
        if (ti) ti.remove();
        aiEl = addMsg('ai streaming', '');
      }
      if (aiEl) {
        lastContent += data.text;
        if (!renderPending) {
          renderPending = true;
          requestAnimationFrame(() => {
            if (aiEl) {
              aiEl.innerHTML = md(esc(lastContent));
              aiEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
            renderPending = false;
          });
        }
      }
      break;
    case 'aiDone': {
      streaming = false;
      lastExpectedUri = data.expectedUri || null;
      // Clean up thinking indicator if no chunks arrived
      const ti2 = document.getElementById('thinkingIndicator');
      if (ti2) ti2.remove();
      document.getElementById('stopBtn').style.display = 'none';
      document.getElementById('sendBtn').style.display = 'block';
      document.getElementById('sendBtn').disabled = false;
      document.getElementById('input').focus();
      if (aiEl) {
        aiEl.classList.remove('streaming');
        aiEl.innerHTML = md(esc(lastContent));
        const acts = document.createElement('div');
        acts.className = 'actions';
        if (data.mode === 'edit') {
          const applyBtn = document.createElement('button');
          applyBtn.className = 'btn primary'; applyBtn.textContent = 'Apply to file';
          applyBtn.addEventListener('click', apply);
          const copyBtn = document.createElement('button');
          copyBtn.className = 'btn'; copyBtn.textContent = 'Copy';
          copyBtn.addEventListener('click', copy);
          acts.appendChild(applyBtn); acts.appendChild(copyBtn);
        } else if (data.mode === 'new') {
          const createBtn = document.createElement('button');
          createBtn.className = 'btn primary'; createBtn.textContent = 'Create files';
          createBtn.addEventListener('click', applyNew);
          const copyBtn = document.createElement('button');
          copyBtn.className = 'btn'; copyBtn.textContent = 'Copy';
          copyBtn.addEventListener('click', copy);
          acts.appendChild(createBtn); acts.appendChild(copyBtn);
        } else {
          const copyBtn = document.createElement('button');
          copyBtn.className = 'btn'; copyBtn.textContent = 'Copy';
          copyBtn.addEventListener('click', copy);
          acts.appendChild(copyBtn);
        }
        aiEl.appendChild(acts);

        // First-use tip for Gemma 4 — shown once per session
        if (currentProvider === 'gemma4' && !gemma4TipShown) {
          gemma4TipShown = true;
          const tip = document.createElement('div');
          tip.className = 'gemma4-tip';
          tip.innerHTML = '<strong>\\u2728 Running Gemma 4 locally</strong> \\u2014 your code stays on your machine. '
            + 'Try <em>"Explain this code"</em>, <em>"Write tests"</em>, or <em>"Refactor to use async/await"</em>. '
            + 'Use <code>Ctrl+Alt+E</code> to explain selected code, <code>Ctrl+Alt+F</code> to fix errors. '
            + '<a href="#" onclick="this.parentElement.remove();return false;" style="margin-left:6px;">Dismiss</a>';
          aiEl.appendChild(tip);
        }

        aiEl = null;
      }
      break;
    }
    case 'notice':
      addMsg('notice', esc(data.text));
      break;
  }
});

function apply() { vscode.postMessage({ type: 'apply', content: lastContent, expectedUri: lastExpectedUri }); }
function applyNew() { vscode.postMessage({ type: 'applyNew', content: lastContent }); }
function copy() {
  navigator.clipboard.writeText(lastContent).then(() => toast('Copied to clipboard'));
}

// Wire up all event listeners (CSP blocks inline onclick handlers)
// [FIX-26] Null-safe event binding to prevent silent webview crashes
function on(id, evt, fn) { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); else console.warn('[Evolve AI] Missing element:', id); }
on('switchBtn', 'click', () => vscode.postMessage({type:'switchProvider'}));
on('clearBtn',  'click', () => clearHistory());
on('thinkBtn',  'click', () => {
  const btn = document.getElementById('thinkBtn');
  const active = btn.classList.toggle('active');
  btn.title = active ? 'Thinking mode ON — click to disable' : 'Toggle Gemma 4 thinking mode';
  vscode.postMessage({ type: 'toggleThinking', enabled: active });
});
on('viewWhatsNewBtn', 'click', () => {
  const banner = document.getElementById('whatsNewBanner');
  if (banner) banner.style.display = 'none';
  vscode.postMessage({ type: 'viewWhatsNew' });
});
on('dismissBannerBtn', 'click', () => {
  const banner = document.getElementById('whatsNewBanner');
  if (banner) banner.style.display = 'none';
  vscode.postMessage({ type: 'dismissWhatsNew' });
});
on('tabChat',   'click', () => setMode('chat'));
on('tabEdit',   'click', () => setMode('edit'));
on('tabNew',    'click', () => setMode('new'));
on('sendBtn',   'click', () => send());
on('stopBtn',   'click', () => cancel());
on('input',     'keydown', (e) => onKey(e));
on('input',     'input', function() { resize(this); });

// Auto-focus input and request initial state
const inputEl = document.getElementById('input');
if (inputEl) inputEl.focus();

// Image paste handler (Ctrl+V with image in clipboard)
if (inputEl) inputEl.addEventListener('paste', function(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      const file = items[i].getAsFile();
      if (file) fileToBase64(file).then(addImage);
    }
  }
});

// Drag-and-drop image handler
const inputArea = document.getElementById('inputArea');
if (inputArea) {
  inputArea.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('drop-highlight'); });
  inputArea.addEventListener('dragleave', function() { this.classList.remove('drop-highlight'); });
  inputArea.addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('drop-highlight');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.indexOf('image') !== -1) {
        fileToBase64(files[i]).then(addImage);
      }
    }
  });
}

vscode.postMessage({ type: 'getStatus' });
vscode.postMessage({ type: 'getHistory' });
</script>
</body></html>`;
  }
}

// [SEC-3] Cryptographically random nonce for webview CSP
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  const bytes = require('crypto').randomBytes(32);
  for (let i = 0; i < 32; i++) nonce += chars[bytes[i] % chars.length];
  return nonce;
}
