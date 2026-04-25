/**
 * ui/statusBar.ts — Status bar service
 *
 * Shows: AI provider + model + active plugins
 * Updates on: provider change, plugin activation/deactivation, timer
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import type { LineageStore } from './lineageStore';

export class StatusBarService {
  private readonly _item: vscode.StatusBarItem;
  private readonly _lineageItem: vscode.StatusBarItem;
  private _timer: NodeJS.Timeout;
  private _lineageStore: LineageStore | undefined;

  constructor(private readonly _svc: IServices) {
    this._item         = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._item.command = 'aiForge.switchProvider';
    _svc.vsCtx.subscriptions.push(this._item);

    // [DE-1] Separate lineage badge — clickable, opens the Lineage panel
    this._lineageItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this._lineageItem.command = 'aiForge.lineage.showPanel';
    _svc.vsCtx.subscriptions.push(this._lineageItem);

    // Refresh on events
    _svc.events.on('provider.changed',   () => this.refresh());
    _svc.events.on('plugin.activated',   () => this.refresh());
    _svc.events.on('plugin.deactivated', () => this.refresh());
    _svc.events.on('ui.status.update',   () => this.refresh());

    // Periodic refresh (Ollama may start/stop)
    this._timer = setInterval(() => this.refresh(), 30_000);
    _svc.vsCtx.subscriptions.push({ dispose: () => clearInterval(this._timer) });

    this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const cfg      = vscode.workspace.getConfiguration('aiForge');
      const provider = await this._svc.ai.detectProvider();
      // [FIX-21] Pass configured host so non-default Ollama servers are detected
      const host     = cfg.get<string>('ollamaHost', 'http://localhost:11434');
      const running  = (provider === 'ollama' || provider === 'gemma4')
        ? await this._svc.ai.isOllamaRunning(host) : false;
      const model    = provider === 'gemma4'
        ? cfg.get<string>('gemma4Model', 'gemma4:e4b')
        : cfg.get<string>('ollamaModel', '');
      const active   = this._svc.plugins.active;

      const icon = {
        ollama:       '$(server)',
        gemma4:       '$(sparkle)',
        anthropic:    '$(cloud)',
        openai:       '$(globe)',
        huggingface:  '$(hubot)',
        offline:      '$(circuit-board)',
        auto:         '$(circuit-board)',
      }[provider] ?? '$(circuit-board)';

      const pluginTag  = active.length > 0
        ? ` · ${active.map(p => p.icon).join(' ')}`
        : '';

      let label: string;
      if (provider === 'gemma4') {
        const variant = (model.split(':')[1] || 'e4b').toUpperCase();
        label = `${icon} Evolve AI: Gemma 4 (${variant})${pluginTag}`;
      } else {
        const modelShort = model ? model.split(':')[0] : '';
        label = `${icon} Evolve AI${modelShort ? ': ' + modelShort : ''}${pluginTag}`;
      }

      this._item.text    = label;
      this._item.tooltip = this._buildTooltip(provider, model, running, active);
      this._item.show();
      this._refreshLineageBadge();
    } catch (e) {
      // [FIX-22] Log errors instead of silently swallowing them
      console.error('[Evolve AI] Status bar refresh failed:', e);
    }
  }

  /** [DE-1] Inject the LineageStore after construction and subscribe to updates */
  attachLineageStore(store: LineageStore): void {
    this._lineageStore = store;
    store.onDidChange(() => this._refreshLineageBadge());
    this._refreshLineageBadge();
  }

  private _refreshLineageBadge(): void {
    const active = vscode.window.activeTextEditor;
    if (!active || !this._lineageStore) { this._lineageItem.hide(); return; }
    const snap = this._lineageStore.get(active.document.uri);
    if (!snap || snap.schemas.length === 0) { this._lineageItem.hide(); return; }
    const stale = snap.schemas.some(s => (s.meta?.staleHours ?? 0) > 24);
    const icon = stale ? '$(warning)' : '$(link)';
    const count = snap.schemas.length;
    this._lineageItem.text = `${icon} ${count} upstream`;
    this._lineageItem.tooltip = this._buildLineageTooltip(snap.schemas, stale);
    this._lineageItem.show();
  }

  private _buildLineageTooltip(
    schemas: { displayName: string; source: string; columns: unknown[]; meta?: { staleHours?: number } }[],
    stale: boolean,
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(`**Upstream table schemas**\n\n`);
    for (const s of schemas) {
      const age = s.meta?.staleHours;
      const ageStr = typeof age === 'number' ? ` · ${Math.round(age)}h old` : '';
      md.appendMarkdown(`- \`${s.displayName}\` — ${s.columns.length} columns _${s.source.replace('_', ' ')}${ageStr}_\n`);
    }
    if (stale) md.appendMarkdown(`\n⚠ Some schemas are older than 24 hours. Run \`dbt compile\` to refresh.\n`);
    md.appendMarkdown(`\n_Click to open the Lineage panel._`);
    return md;
  }

  private _buildTooltip(
    provider: string,
    model: string,
    ollamaRunning: boolean,
    active: { displayName: string; id: string }[]
  ): string {
    const lines: string[] = ['Evolve AI'];

    if (provider === 'gemma4') {
      const variant = (model.split(':')[1] || 'e4b').toUpperCase();
      const params = { E2B: '2.3B', E4B: '4.5B', '26B': '25.2B MoE', '31B': '30.7B' }[variant] || variant;
      const ctx    = (variant === '26B' || variant === '31B') ? '256K' : '128K';
      const caps   = (variant === '26B' || variant === '31B') ? 'text, image' : 'text, image, audio';
      lines.push(`Provider: Gemma 4${ollamaRunning ? ' \u2714' : ''} (local, private)`);
      lines.push(`Model: ${variant} (${params} params)`);
      lines.push(`Context: ${ctx} tokens`);
      lines.push(`Capabilities: ${caps}`);
      lines.push(`License: Apache 2.0`);
    } else {
      lines.push(`Provider: ${provider}${ollamaRunning ? ' \u2714' : ''}`);
      if (model) lines.push(`Model: ${model}`);
    }

    lines.push(active.length > 0 ? `Active plugins: ${active.map(p => p.displayName).join(', ')}` : 'No plugins active');
    lines.push('');
    lines.push('Click to switch provider');
    return lines.join('\n');
  }
}
