/**
 * analysis/consentStore.ts — Persistent consent for auto-fix decisions
 *
 * Consent is keyed by workspace (workspace folder fsPath) and global.
 * File-scope consent is session-only (not persisted) to keep the API simple.
 */

import * as vscode from 'vscode';
import type { ConsentDecision, ConsentMode, ConsentScope } from './types';

const WS_KEY = 'aiForge.analysis.consent.workspace';
const GLOBAL_KEY = 'aiForge.analysis.consent.global';

export class ConsentStore {
  private readonly _fileScope = new Map<string, ConsentDecision>();

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  get(filePath: string, workspaceKey: string | null): ConsentDecision | null {
    const file = this._fileScope.get(filePath);
    if (file) return file;

    if (workspaceKey) {
      const ws = this._readWorkspaceMap()[workspaceKey];
      if (ws) return ws;
    }

    const g = this.ctx.globalState.get<ConsentDecision | undefined>(GLOBAL_KEY);
    return g ?? null;
  }

  async set(
    decision: { mode: ConsentMode; scope: ConsentScope },
    ctx: { filePath: string; workspaceKey: string | null }
  ): Promise<void> {
    const record: ConsentDecision = { ...decision, rememberedAt: Date.now() };

    if (decision.scope === 'file') {
      this._fileScope.set(ctx.filePath, record);
      return;
    }

    if (decision.scope === 'workspace' && ctx.workspaceKey) {
      const map = this._readWorkspaceMap();
      map[ctx.workspaceKey] = record;
      await this.ctx.workspaceState.update(WS_KEY, map);
      return;
    }

    if (decision.scope === 'global') {
      await this.ctx.globalState.update(GLOBAL_KEY, record);
    }
  }

  async reset(): Promise<void> {
    this._fileScope.clear();
    await this.ctx.workspaceState.update(WS_KEY, undefined);
    await this.ctx.globalState.update(GLOBAL_KEY, undefined);
  }

  private _readWorkspaceMap(): Record<string, ConsentDecision> {
    return this.ctx.workspaceState.get<Record<string, ConsentDecision>>(WS_KEY, {});
  }
}
