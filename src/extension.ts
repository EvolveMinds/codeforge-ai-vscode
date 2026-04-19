/**
 * extension.ts — Evolve AI entry point
 *
 * Fixes applied vs v2:
 *  MULTI-ROOT — refresh() now runs plugin detection for EVERY workspace folder,
 *               not just [0]. Plugins activate per-folder.
 *  FILE-OPEN  — onDidOpenTextDocument triggers a detection refresh so that
 *               opening a .databrickscfg in an existing workspace immediately
 *               activates the Databricks plugin without a reload.
 */

import * as vscode                 from 'vscode';
import { ServiceContainer }        from './core/services';
import { ContextService }         from './core/contextService';
import { registerPlugins }         from './plugins/index';
import { ChatPanelProvider }       from './ui/chatPanel';
import { StatusBarService }        from './ui/statusBar';
import { registerInlineProviders } from './ui/inlineActions';
import { CoreCommands }            from './commands/coreCommands';
import { AnalysisController }      from './analysis/controller';

export async function activate(vsCtx: vscode.ExtensionContext): Promise<void> {
  // 1. Service container — EventBus, PluginRegistry, AIService, etc. all wired here
  const svc = new ServiceContainer(vsCtx);
  vsCtx.subscriptions.push({ dispose: () => svc.dispose() });

  // 2. Register stack plugins (edit plugins/index.ts to add new ones)
  registerPlugins(svc.plugins);

  // 3. UI
  vsCtx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelProvider.viewId, new ChatPanelProvider(svc))
  );
  new StatusBarService(svc);
  const lens = registerInlineProviders(vsCtx, svc.plugins);

  // 4. Commands
  new CoreCommands(svc).register();

  // 4a. Code analysis (lint/format) — triggers + commands + status bar
  new AnalysisController(svc);

  // 5. Plugin detection — run for EVERY workspace folder (multi-root support)
  // [FIX-26] First matching folder wins — once a plugin activates, subsequent
  // folders skip detection for that plugin (prevents overwrite of _wsPath)
  const refreshAll = async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      await svc.plugins.refresh(undefined, svc, vsCtx);
    } else {
      // Deactivate plugins that no longer match any folder
      // (refresh with undefined triggers deactivation for non-matching plugins)
      // Then detect across folders — refresh() already skips activation for already-active plugins
      for (const folder of folders) {
        await svc.plugins.refresh(folder, svc, vsCtx);
      }
    }
  };

  await refreshAll();

  vsCtx.subscriptions.push(
    // Re-detect on workspace changes (add/remove folders)
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll),

    // Re-detect when a file is opened — catches .databrickscfg, dbt_project.yml, etc.
    // Throttled: only re-runs if no other detection ran in the last 2 seconds
    vscode.workspace.onDidOpenTextDocument(() => {
      scheduleRefresh(refreshAll);
    }),

    // Refresh CodeLens on file change / save
    vscode.window.onDidChangeActiveTextEditor(() => {
      lens.refresh();
      const f = vscode.window.activeTextEditor?.document;
      if (f) svc.events.emit('editor.fileChanged', { filePath: f.uri.fsPath, language: f.languageId });
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      lens.refresh();
      // [FIX-11] Invalidate plugin hook cache on file save so stale data isn't reused
      if (svc.context instanceof ContextService) {
        (svc.context as ContextService).invalidateHookCache();
      }
    }),

    // Propagate plugin change to context.refreshed event
    svc.plugins.onDidChange(() =>
      svc.events.emit('context.refreshed', { activePlugins: svc.plugins.active.map(p => p.id) })
    )
  );

  // Upgrade detection: show "What's New" toast on version change
  await checkForUpgrade(vsCtx, svc);

  // Diagnostic: test Ollama connectivity
  const testUrl = vscode.workspace.getConfiguration('aiForge').get<string>('ollamaHost', 'http://localhost:11434');
  console.log('[Evolve AI] Testing Ollama at:', testUrl);
  try {
    const provider = await svc.ai.detectProvider();
    const running = await svc.ai.isOllamaRunning();
    console.log(`[Evolve AI] detectProvider=${provider}, isOllamaRunning=${running}`);
  } catch (e) { console.error('[Evolve AI] Ollama check error:', e); }
  console.log('[Evolve AI] Ready.');
}

export function deactivate(): void {}

// ── Throttle helper for file-open detection ───────────────────────────────────
let _refreshTimer: NodeJS.Timeout | null = null;

function scheduleRefresh(fn: () => Promise<void>): void {
  if (_refreshTimer) return;   // already scheduled — skip
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    fn().catch(console.error);
  }, 2000);
}

// ── Upgrade detection ─────────────────────────────────────────────────────────
// On first activation after a version change, show a non-blocking toast
// and emit `ui.whatsNew.show` so the chat panel can render a banner.
// Fresh installs (no prior version) skip the toast to avoid spamming new users.
async function checkForUpgrade(vsCtx: vscode.ExtensionContext, svc: ServiceContainer): Promise<void> {
  const currentVersion = vsCtx.extension.packageJSON.version as string;
  const prevVersion = vsCtx.globalState.get<string>('aiForge.installedVersion');
  await vsCtx.globalState.update('aiForge.installedVersion', currentVersion);

  // Skip fresh installs — no upgrade to announce
  if (!prevVersion || prevVersion === currentVersion) return;

  const dismissKey = `aiForge.whatsNewDismissed.${currentVersion}`;
  if (vsCtx.globalState.get<boolean>(dismissKey, false)) return;

  // Mark a pending notification so the chat panel shows the banner next time it opens,
  // even if it wasn't open when this ran.
  const pendingKey = `aiForge.whatsNewPending.${currentVersion}`;
  await vsCtx.globalState.update(pendingKey, true);

  // Tell chat panel to show the banner (fires whether or not the user interacts with the toast)
  svc.events.emit('ui.whatsNew.show', { version: currentVersion });

  // Non-blocking toast
  vscode.window.showInformationMessage(
    `Evolve AI updated to ${currentVersion} — now with Gemma 4 support!`,
    "See What's New", 'Remind me later', 'Dismiss'
  ).then(choice => {
    if (choice === "See What's New") {
      vscode.commands.executeCommand('aiForge.whatsNew');
      vsCtx.globalState.update(dismissKey, true);
      vsCtx.globalState.update(pendingKey, false);
    } else if (choice === 'Dismiss') {
      vsCtx.globalState.update(dismissKey, true);
      vsCtx.globalState.update(pendingKey, false);
    }
    // 'Remind me later' or no choice → don't set dismissKey; toast fires again on next activation
  });
}
