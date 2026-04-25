/**
 * ui/lineageStore.ts — Per-file lineage cache shared by UI providers (DE #1)
 *
 * CodeLens, Hover, Completion, and Diagnostics all need the same resolved
 * schemas for the active file. This store:
 *   - holds the latest snapshot per file URI
 *   - coordinates one resolution pass per file-save (no N-way races)
 *   - emits a change event so providers can refresh
 *
 * It reuses the ContextService's lineage resolution path by calling build()
 * with a tiny budget — we only want the lineage array, not the full context.
 */

import * as vscode from 'vscode';
import type { IServices }       from '../core/services';
import type { LineageSchema }   from '../core/plugin';
import { ContextService }       from '../core/contextService';

export interface LineageSnapshot {
  uri:       vscode.Uri;
  schemas:   LineageSchema[];
  resolvedAt: number;
  /** true when the file was analysed but no refs were found */
  empty:     boolean;
}

export class LineageStore {
  private _byUri = new Map<string, LineageSnapshot>();
  private _pending = new Map<string, Promise<LineageSnapshot>>();
  private readonly _emitter = new vscode.EventEmitter<LineageSnapshot>();
  readonly onDidChange = this._emitter.event;

  constructor(private readonly _svc: IServices) {
    // Refresh on save / editor switch / plugin changes.
    // Each listener first checks whether any plugin contributes lineage hooks;
    // in a non-DE workspace we skip the (cheap but non-zero) context build.
    _svc.vsCtx.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(doc => { if (this._hasHooks()) void this.refresh(doc.uri); }),
      vscode.window.onDidChangeActiveTextEditor(ed => { if (ed && this._hasHooks()) void this.refresh(ed.document.uri); }),
      _svc.events.on('plugin.activated',   () => this.invalidateAll()),
      _svc.events.on('plugin.deactivated', () => this.invalidateAll()),
      _svc.events.on('provider.changed',   () => this.invalidateAll()),
    );
    // Initial refresh for the currently active editor
    const active = vscode.window.activeTextEditor;
    if (active && this._hasHooks()) void this.refresh(active.document.uri);
  }

  private _hasHooks(): boolean {
    return this._svc.plugins.lineageHooks.length > 0;
  }

  get(uri: vscode.Uri): LineageSnapshot | undefined {
    return this._byUri.get(uri.toString());
  }

  /** Trigger refresh if not already pending. Safe to call repeatedly. */
  async refresh(uri: vscode.Uri): Promise<LineageSnapshot> {
    const key = uri.toString();
    const inflight = this._pending.get(key);
    if (inflight) return inflight;

    const p = this._resolveFor(uri).finally(() => this._pending.delete(key));
    this._pending.set(key, p);
    return p;
  }

  invalidateAll(): void {
    this._byUri.clear();
    if (this._svc.context instanceof ContextService) {
      this._svc.context.invalidateLineageCache();
    }
    const active = vscode.window.activeTextEditor;
    if (active && this._hasHooks()) void this.refresh(active.document.uri);
  }

  private async _resolveFor(uri: vscode.Uri): Promise<LineageSnapshot> {
    try {
      // Build a lightweight context scoped to this file.
      // We don't need git diff, errors, or related files — just lineage.
      const ctx = await this._svc.context.build({
        includeErrors:  false,
        includeGitDiff: false,
        includeRelated: false,
      });
      const snap: LineageSnapshot = {
        uri,
        schemas: ctx.lineage ?? [],
        resolvedAt: Date.now(),
        empty: (ctx.lineage?.length ?? 0) === 0,
      };
      this._byUri.set(uri.toString(), snap);
      this._emitter.fire(snap);
      return snap;
    } catch (e) {
      console.warn('[Evolve AI] Lineage refresh failed:', e);
      const empty: LineageSnapshot = { uri, schemas: [], resolvedAt: Date.now(), empty: true };
      this._byUri.set(uri.toString(), empty);
      return empty;
    }
  }

  dispose(): void {
    this._emitter.dispose();
    this._byUri.clear();
    this._pending.clear();
  }
}
