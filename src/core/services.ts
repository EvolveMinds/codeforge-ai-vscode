/**
 * core/services.ts — Service container (dependency injection root)
 *
 * FIXES APPLIED:
 *  [FIX-10] IServices now uses IAIService, IContextService, IWorkspaceService
 *           interfaces — plugins can mock any service in tests
 *  [FIX-1]  EventBus passed to PluginRegistry so plugin.activated / deactivated
 *           events are actually emitted (status bar + chat panel now update)
 *  [FIX-4]  SecretStorage passed to AIService — API keys never touch settings.json
 */

import * as vscode          from 'vscode';
import { AIService }        from './aiService';
import { ContextService }   from './contextService';
import { WorkspaceService } from './workspaceService';
import { PluginRegistry }   from './plugin';
import { EventBus }         from './eventBus';
import type { IAIService }        from './interfaces';
import type { IContextService }   from './interfaces';
import type { IWorkspaceService } from './interfaces';

// ── Public contract ───────────────────────────────────────────────────────────

export interface IServices {
  readonly ai:        IAIService;
  readonly context:   IContextService;
  readonly workspace: IWorkspaceService;
  readonly plugins:   PluginRegistry;
  readonly events:    EventBus;
  readonly vsCtx:     vscode.ExtensionContext;
}

// ── Container ─────────────────────────────────────────────────────────────────

// [FIX-14] Fields typed as interfaces, not concrete classes
export class ServiceContainer implements IServices {
  readonly events:    EventBus;
  readonly plugins:   PluginRegistry;
  readonly ai:        IAIService;
  readonly context:   IContextService;
  readonly workspace: IWorkspaceService;

  constructor(readonly vsCtx: vscode.ExtensionContext) {
    this.events    = new EventBus();
    this.plugins   = new PluginRegistry(this.events);
    this.ai        = new AIService(this.events, vsCtx.secrets);
    this.context   = new ContextService(this.plugins);
    this.workspace = new WorkspaceService(this.plugins, this.ai, this.context, vsCtx, this.events);
  }

  dispose(): void {
    this.events.dispose();
    this.plugins.disposeAll();
  }
}
