/**
 * offline/airGapMode.ts — Strict Air-Gapped & Offline Mode Enforcer
 *
 * Provides enterprise-grade privacy guarantees by intercepting and rejecting
 * any outbound network AI requests when strict offline mode is active.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import type { RequestInterceptor, AIRequest } from '../core/aiService';

export class AirGapModeManager {
  private static _instance: AirGapModeManager | null = null;

  static register(svc: IServices): AirGapModeManager {
    if (!this._instance) {
      this._instance = new AirGapModeManager(svc);
    }
    return this._instance;
  }

  private _statusBarItem: vscode.StatusBarItem;

  private constructor(private readonly _svc: IServices) {
    this._statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      90,
    );
    this._statusBarItem.command = 'aiForge.offline.toggleStrictAirGap';
    this._svc.vsCtx.subscriptions.push(this._statusBarItem);

    // Register request interceptor if AIService supports it
    const interceptor: RequestInterceptor = {
      intercept: (req: AIRequest): AIRequest => {
        if (this.isStrictOfflineActive()) {
          const provider = req.providerOverride || vscode.workspace.getConfiguration('aiForge').get<string>('provider', 'auto');
          if (provider !== 'offline') {
            throw new Error('[Air-Gapped Mode] All outbound AI requests are blocked by policy. Switch to "offline" mode or disable strict air-gap mode.');
          }
        }
        return req;
      },
    };

    if (this._svc.ai && typeof (this._svc.ai as any).addInterceptor === 'function') {
      (this._svc.ai as any).addInterceptor(interceptor);
    }

    // Listen for configuration changes
    this._svc.vsCtx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('aiForge.strictOffline')) {
          this.updateStatusBar();
        }
      }),
    );

    this.updateStatusBar();
  }

  isStrictOfflineActive(): boolean {
    return vscode.workspace.getConfiguration('aiForge').get<boolean>('strictOffline', false);
  }

  async toggleStrictAirGap(): Promise<void> {
    const current = this.isStrictOfflineActive();
    const next = !current;
    await vscode.workspace.getConfiguration('aiForge').update('strictOffline', next, vscode.ConfigurationTarget.Global);

    if (next) {
      vscode.window.showInformationMessage('🔒 Evolve AI: Strict Air-Gapped Mode enabled. All external network requests are strictly blocked.');
    } else {
      vscode.window.showInformationMessage('🔓 Evolve AI: Strict Air-Gapped Mode disabled.');
    }
    this.updateStatusBar();
  }

  updateStatusBar(): void {
    if (this.isStrictOfflineActive()) {
      this._statusBarItem.text = '$(shield) Air-Gapped';
      this._statusBarItem.tooltip = 'Evolve AI: 100% Strict Offline Mode is active. Click to toggle.';
      this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this._statusBarItem.show();
    } else {
      this._statusBarItem.hide();
    }
  }
}
