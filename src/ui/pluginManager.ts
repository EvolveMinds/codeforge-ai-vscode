/**
 * ui/pluginManager.ts — Plugin & Delivery Studio Manager
 *
 * Provides top-menu and command-driven UI to inspect, enable, and disable
 * hot-pluggable plugins dynamically. When plugins are enabled or disabled,
 * their associated UI elements (studios, popover cards, CodeLens, status bar)
 * show up or go off instantly without requiring VS Code restart.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';

export class PluginManager {
  /**
   * Opens the interactive Plugin Management QuickPick from the top menus
   * (editor/title menu, command palette, webview toolbar buttons).
   */
  public static async openQuickPick(services: IServices): Promise<void> {
    const registry = services.plugins;
    const all = registry.getAll();
    const disabledIds = registry.getDisabledPluginIds();

    interface PluginQuickPickItem extends vscode.QuickPickItem {
      pluginId?: string;
      action?: 'enableAll' | 'disableAll' | 'refresh';
    }

    const items: PluginQuickPickItem[] = [];

    // Header Actions
    items.push({
      label: '$(check-all) Enable All Plugins',
      description: 'Activate full studio suite (Python, Data, Cloud, Connectors)',
      action: 'enableAll',
    });
    items.push({
      label: '$(circle-slash) Minimal Core Mode',
      description: 'Disable optional plugins; keep lightweight core (Git + Security)',
      action: 'disableAll',
    });
    items.push({
      label: '$(sync) Refresh Plugin Detection',
      description: 'Re-scan workspace for project topologies and frameworks',
      action: 'refresh',
    });

    items.push({
      label: 'PLUGINS & STUDIOS (CLICK TO TOGGLE)',
      kind: vscode.QuickPickItemKind.Separator,
    });

    // Sort: Python Studio and Data Analysis at top, then alphabetical
    const sorted = [...all].sort((a, b) => {
      if (a.id === 'pythonStudio') return -1;
      if (b.id === 'pythonStudio') return 1;
      if (a.id === 'dataAnalysis') return -1;
      if (b.id === 'dataAnalysis') return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    for (const plugin of sorted) {
      const isEnabled = !disabledIds.includes(plugin.id);
      const isActive = registry.isPluginActive(plugin.id);

      const statusTag = !isEnabled
        ? '$(circle-slash) DISABLED (Hidden)'
        : isActive
        ? '$(pass-filled) ACTIVE (In Use)'
        : '$(circle-outline) ENABLED (Standby)';

      items.push({
        label: `${plugin.icon} ${plugin.displayName}`,
        description: statusTag,
        detail: plugin.description || `ID: ${plugin.id} · Dynamic studio & context provider`,
        pluginId: plugin.id,
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: '🧩 Evolve AI: Plugin & Delivery Studio Manager',
      placeHolder: 'Click any plugin to Toggle (Enable / Disable) or select an action',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) return;

    if (picked.action === 'enableAll') {
      await registry.enableAllPlugins();
      vscode.window.showInformationMessage('✓ All Evolve AI plugins enabled. Studios and menus updated.');
      return;
    }

    if (picked.action === 'disableAll') {
      await registry.disableAllPlugins(['git', 'security']);
      vscode.window.showInformationMessage('✓ Switched to Minimal Core Mode. Optional plugins disabled and hidden.');
      return;
    }

    if (picked.action === 'refresh') {
      const ws = vscode.workspace.workspaceFolders?.[0];
      await registry.refresh(ws, services, services.vsCtx);
      vscode.window.showInformationMessage('✓ Refreshed plugin detection.');
      return;
    }

    if (picked.pluginId) {
      const id = picked.pluginId;
      const nowEnabled = await registry.togglePlugin(id);
      const plugin = registry.getPlugin(id);
      const name = plugin?.displayName || id;
      if (nowEnabled) {
        vscode.window.showInformationMessage(`✓ Enabled ${name}. Associated studios and menus are now visible.`);
      } else {
        vscode.window.showInformationMessage(`✓ Disabled ${name}. Associated studios and menus have been hidden.`);
      }
    }
  }
}
