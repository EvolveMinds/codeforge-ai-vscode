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
import { ChatEditorPanel }         from './ui/chatEditorPanel';
import { StatusBarService }        from './ui/statusBar';
import { registerInlineProviders } from './ui/inlineActions';
import { CoreCommands }            from './commands/coreCommands';
import { AnalysisController }      from './analysis/controller';
import { LineageStore }            from './ui/lineageStore';
import { registerLineageProviders } from './ui/lineageProviders';
import { LineagePanel }            from './ui/lineagePanel';

export async function activate(vsCtx: vscode.ExtensionContext): Promise<void> {
  // 1. Service container — EventBus, PluginRegistry, AIService, etc. all wired here
  const svc = new ServiceContainer(vsCtx);
  vsCtx.subscriptions.push({ dispose: () => svc.dispose() });

  // 2. Register stack plugins (edit plugins/index.ts to add new ones)
  registerPlugins(svc.plugins);

  // 3. UI
  const chatProvider = new ChatPanelProvider(svc);
  vsCtx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelProvider.viewId, chatProvider),
    // Claude-style editor-tab chat — opens to the right of the active file
    vscode.commands.registerCommand('aiForge.openChatTab', () => {
      ChatEditorPanel.show(vsCtx, chatProvider);
    }),
  );
  const statusBar = new StatusBarService(svc);
  const lens = registerInlineProviders(vsCtx, svc.plugins);

  // 3a. [DE-1] Lineage: store + CodeLens/Hover/Completion/Diagnostics + status badge
  const lineageStore = new LineageStore(svc);
  vsCtx.subscriptions.push({ dispose: () => lineageStore.dispose() });
  registerLineageProviders(vsCtx, lineageStore);
  statusBar.attachLineageStore(lineageStore);

  // 4. Commands
  new CoreCommands(svc).register();

  // 4b. [DE-1] Lineage commands
  vsCtx.subscriptions.push(
    vscode.commands.registerCommand('aiForge.lineage.showPanel', (focusFqn?: string) => {
      LineagePanel.show(svc, lineageStore, typeof focusFqn === 'string' ? focusFqn : undefined);
    }),
    vscode.commands.registerCommand('aiForge.lineage.refresh', async () => {
      const active = vscode.window.activeTextEditor;
      if (!active) { vscode.window.showInformationMessage('No active file to refresh lineage for.'); return; }
      lineageStore.invalidateAll();
      await lineageStore.refresh(active.document.uri);
      vscode.window.setStatusBarMessage('Evolve AI: lineage refreshed', 2000);
    }),
  );

  // 4c. [DE-1] First-use onboarding toast — show once per workspace when lineage resolves
  showLineageOnboardingOnce(vsCtx, lineageStore);

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

  // Post-update reload nudge: if the settings schema for this version isn't
  // fully registered, proactively ask the user to reload (prevents "not a
  // registered configuration" crashes mid-setup).
  await checkReloadRequiredAfterUpdate(vsCtx);

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

  // Non-blocking toast — version-agnostic tagline so it doesn't go stale
  vscode.window.showInformationMessage(
    `Evolve AI updated to ${currentVersion}. See what's new in this release.`,
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

// ── [DE-1] Lineage first-use onboarding ──────────────────────────────────────
// Show a single toast the first time lineage resolves in a workspace, so users
// discover the feature without reading release notes. Offers a one-click jump
// to the Lineage panel. Dismissible forever via 'Don't show again'.

function showLineageOnboardingOnce(vsCtx: vscode.ExtensionContext, store: LineageStore): void {
  const ONBOARD_KEY = 'aiForge.lineage.onboarded';
  if (vsCtx.workspaceState.get<boolean>(ONBOARD_KEY, false)) return;

  const sub = store.onDidChange(async snap => {
    if (snap.schemas.length === 0) return;
    sub.dispose();
    await vsCtx.workspaceState.update(ONBOARD_KEY, true);
    const total = snap.schemas.reduce((a, s) => a + s.columns.length, 0);
    const pick = await vscode.window.showInformationMessage(
      `Evolve AI found ${snap.schemas.length} upstream ${snap.schemas.length === 1 ? 'table' : 'tables'} (${total} columns). AI answers will now use real column names.`,
      'Show me', 'Settings', 'Dismiss',
    );
    if (pick === 'Show me') {
      vscode.commands.executeCommand('aiForge.lineage.showPanel');
    } else if (pick === 'Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.lineage');
    }

    // If any resolved column has a pii-ish tag AND a cloud provider is active,
    // ask once whether to include those columns in prompts.
    await maybeRequestPiiConsent(vsCtx, snap);
  });
  vsCtx.subscriptions.push(sub);
}

async function maybeRequestPiiConsent(
  vsCtx: vscode.ExtensionContext,
  snap: { schemas: Array<{ columns: Array<{ tags?: string[] }> }> },
): Promise<void> {
  const PII_ASKED = 'aiForge.lineage.piiPromptAsked';
  if (vsCtx.workspaceState.get<boolean>(PII_ASKED, false)) return;

  const hasPii = snap.schemas.some(s => s.columns.some(c =>
    c.tags?.some(t => ['pii', 'pci', 'sensitive'].includes(t.toLowerCase())),
  ));
  if (!hasPii) return;

  const cfg = vscode.workspace.getConfiguration('aiForge');
  const provider = cfg.get<string>('provider', 'auto');
  const isCloud = provider === 'anthropic' || provider === 'openai' || provider === 'huggingface';
  if (!isCloud) return;

  await vsCtx.workspaceState.update(PII_ASKED, true);
  const pick = await vscode.window.showWarningMessage(
    'Evolve AI: some upstream columns are tagged PII / sensitive. By default these are redacted before being sent to cloud AI providers. Include them?',
    'Keep redacted (default)', 'Include PII', 'Learn more',
  );
  if (pick === 'Include PII') {
    await cfg.update('lineage.includePii', true, vscode.ConfigurationTarget.Workspace);
  } else if (pick === 'Learn more') {
    vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.lineage.includePii');
  }
}

// ── Post-update reload nudge ─────────────────────────────────────────────────
// When VS Code auto-updates an extension in a running window, the Extension
// Host activates the new code BUT the ConfigurationRegistry may not yet have
// ingested the new package.json schema. Any write to a freshly-added setting
// will throw "is not a registered configuration" (issues #115992, #90249).
//
// We detect this deterministically: if the extension's current package.json
// declares a setting but cfg.inspect() returns undefined for its defaultValue,
// the schema hasn't loaded. Show a non-blocking prompt asking the user to
// reload the window — this fixes the race before they hit any broken path.
async function checkReloadRequiredAfterUpdate(vsCtx: vscode.ExtensionContext): Promise<void> {
  try {
    const cfg = vscode.workspace.getConfiguration('aiForge');
    // Probe a setting added in 1.4.0. If the schema isn't registered, inspect()
    // returns undefined for defaultValue even though package.json declares it.
    const inspection = cfg.inspect<string>('gemma4Model');
    if (inspection?.defaultValue !== undefined) return;   // schema loaded — no-op

    // Only nudge once per version per window to avoid nagging
    const currentVersion = vsCtx.extension.packageJSON.version as string;
    const nudgedKey = `aiForge.reloadNudged.${currentVersion}`;
    if (vsCtx.globalState.get<boolean>(nudgedKey, false)) return;
    await vsCtx.globalState.update(nudgedKey, true);

    const pick = await vscode.window.showWarningMessage(
      `Evolve AI was just installed or updated. Reload VS Code to finish loading the ` +
      `extension's settings \u2014 otherwise Gemma 4 setup and some provider switches will fail.`,
      'Reload Window', 'Remind me later'
    );
    if (pick === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else if (pick === 'Remind me later') {
      // Clear the flag so we nudge again next activation
      await vsCtx.globalState.update(nudgedKey, false);
    }
  } catch (e) {
    console.warn('[Evolve AI] reload-nudge probe failed:', e);
  }
}
