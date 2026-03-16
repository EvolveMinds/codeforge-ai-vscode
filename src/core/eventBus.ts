/**
 * core/eventBus.ts — Typed event bus
 *
 * Allows plugins and core modules to communicate without direct imports.
 * Every event is typed. No stringly-typed pub/sub.
 */

import * as vscode from 'vscode';

// ── Event catalogue ───────────────────────────────────────────────────────────
// Add new events here as the system grows. Plugins can emit and subscribe.

export interface AIForgeEvents {
  /** AI provider changed by user */
  'provider.changed':     { provider: string; model: string };

  /** Plugin activated */
  'plugin.activated':     { pluginId: string; displayName: string };

  /** Plugin deactivated */
  'plugin.deactivated':   { pluginId: string };

  /** AI request started */
  'ai.request.start':     { instruction: string; mode: string };

  /** AI request completed */
  'ai.request.done':      { instruction: string; tokensUsed?: number };

  /** AI request failed */
  'ai.request.error':     { instruction: string; error: string };

  /** File edited by AI */
  'file.edited':          { filePath: string; linesChanged: number };

  /** Files created by AI */
  'files.created':        { filePaths: string[] };

  /** User changed active file */
  'editor.fileChanged':   { filePath: string; language: string };

  /** Workspace plugin context refreshed */
  'context.refreshed':    { activePlugins: string[] };

  /** Plugin wants to show a notification */
  'ui.notify':            { message: string; level: 'info' | 'warning' | 'error' };

  /** Plugin wants to update the status bar */
  'ui.status.update':     Record<string, never>;
}

export type EventName = keyof AIForgeEvents;
export type EventPayload<E extends EventName> = AIForgeEvents[E];

// ── EventBus implementation ───────────────────────────────────────────────────

type Handler<E extends EventName> = (payload: EventPayload<E>) => void | Promise<void>;

export class EventBus {
  private _emitters = new Map<EventName, vscode.EventEmitter<unknown>>();

  private _emitter<E extends EventName>(event: E): vscode.EventEmitter<EventPayload<E>> {
    if (!this._emitters.has(event)) {
      this._emitters.set(event, new vscode.EventEmitter<unknown>());
    }
    return this._emitters.get(event) as vscode.EventEmitter<EventPayload<E>>;
  }

  /** Subscribe to an event. Returns a Disposable. */
  on<E extends EventName>(
    event: E,
    handler: Handler<E>
  ): vscode.Disposable {
    return this._emitter(event).event(handler as (p: EventPayload<E>) => void);
  }

  /** Emit an event with payload. */
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    this._emitter(event).fire(payload);
  }

  /** Dispose all emitters. */
  dispose(): void {
    for (const emitter of this._emitters.values()) {
      emitter.dispose();
    }
    this._emitters.clear();
  }
}
