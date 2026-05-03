/**
 * ui/chatEditorPanel.ts — Claude-style right-side editor-tab chat
 *
 * Opens the same chat UI as the sidebar (ChatPanelProvider) but as a regular
 * editor tab in ViewColumn.Beside. Single-instance: clicking the title-bar
 * icon multiple times reveals the existing tab instead of opening duplicates.
 *
 * State (history, in-flight stream, status cache) lives in ChatPanelProvider,
 * so the sidebar and editor-tab views stay in sync when both are open.
 */

import * as vscode from 'vscode';
import type { ChatPanelProvider } from './chatPanel';

export class ChatEditorPanel {
  private static _current: ChatEditorPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _disposables: vscode.Disposable[] = [];

  static show(svcCtx: vscode.ExtensionContext, provider: ChatPanelProvider): void {
    if (ChatEditorPanel._current) {
      ChatEditorPanel._current._panel.reveal(vscode.ViewColumn.Beside, false);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiForge.chatEditor',
      'Evolve AI',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.iconPath = {
      light: vscode.Uri.joinPath(svcCtx.extensionUri, 'media', 'title-icon-light.svg'),
      dark:  vscode.Uri.joinPath(svcCtx.extensionUri, 'media', 'title-icon-dark.svg'),
    };

    ChatEditorPanel._current = new ChatEditorPanel(panel, provider);
  }

  private constructor(panel: vscode.WebviewPanel, provider: ChatPanelProvider) {
    this._panel = panel;

    const surface = {
      webview: panel.webview,
      reveal: () => panel.reveal(vscode.ViewColumn.Beside, false),
    };

    const detach = provider.attachSurface(surface);
    this._disposables.push(detach);

    this._panel.onDidDispose(
      () => this._dispose(),
      null,
      this._disposables,
    );
  }

  private _dispose(): void {
    ChatEditorPanel._current = undefined;
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
  }
}
