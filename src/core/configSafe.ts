/**
 * core/configSafe.ts — Defensive wrappers around WorkspaceConfiguration.update()
 *
 * Works around a known VS Code race (issues #115992, #90249): when an extension
 * is installed or upgraded into a running VS Code window, the Extension Host
 * activates our code before the main window's ConfigurationRegistry ingests the
 * new `package.json` schema. Reads via `cfg.get(key, default)` succeed silently
 * (they return the supplied default), but the first `update(..., Global)` throws
 * `ERROR_UNKNOWN_KEY` with message "is not a registered configuration."
 *
 * Two helpers:
 *  - `safeUpdateConfig()`  — try preferred target, fall back to Workspace on
 *    ERROR_UNKNOWN_KEY. Returns structured result. Silent — use from
 *    non-interactive paths (e.g. mid-stream auto-recovery).
 *  - `persistOrPromptReload()` — user-facing wrapper. If both targets fail with
 *    ERROR_UNKNOWN_KEY, prompts the user to reload the window.
 */

import * as vscode from 'vscode';

export type UpdateResult =
  | { ok: true;  target: vscode.ConfigurationTarget }
  | { ok: false; reason: 'not-registered' | 'scope' | 'other'; error: unknown };

/**
 * Safe wrapper around WorkspaceConfiguration.update() that survives the
 * VS Code "is not a registered configuration" race on extension upgrade.
 *
 * Strategy:
 *   1. Try the requested target (default: Global).
 *   2. On ERROR_UNKNOWN_KEY, retry at Workspace scope if a workspace is open.
 *   3. Return structured result — caller decides how to surface failure.
 */
export async function safeUpdateConfig(
  section:   string,
  key:       string,
  value:     unknown,
  preferred: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<UpdateResult> {
  const cfg = vscode.workspace.getConfiguration(section);

  try {
    await cfg.update(key, value, preferred);
    return { ok: true, target: preferred };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    // ERROR_UNKNOWN_KEY — registry hasn't ingested our manifest yet
    if (msg.includes('is not a registered configuration')) {
      const hasWorkspace = (vscode.workspace.workspaceFolders ?? []).length > 0;
      if (preferred !== vscode.ConfigurationTarget.Workspace && hasWorkspace) {
        try {
          await cfg.update(key, value, vscode.ConfigurationTarget.Workspace);
          return { ok: true, target: vscode.ConfigurationTarget.Workspace };
        } catch { /* fall through */ }
      }
      return { ok: false, reason: 'not-registered', error: e };
    }

    // ERROR_INVALID_USER_TARGET / WORKSPACE_TARGET — scope mismatch
    if (msg.includes('does not support')) {
      return { ok: false, reason: 'scope', error: e };
    }

    return { ok: false, reason: 'other', error: e };
  }
}

/**
 * Try to persist; if the registry-race bites us, prompt the user to reload.
 * Returns true if the value was written somewhere (Global or Workspace).
 * Use from user-facing flows where a reload prompt is appropriate.
 */
export async function persistOrPromptReload(
  section: string,
  key:     string,
  value:   unknown,
  label:   string = `${section}.${key}`
): Promise<boolean> {
  const result = await safeUpdateConfig(section, key, value);
  if (result.ok) return true;

  if (result.reason === 'not-registered') {
    const pick = await vscode.window.showWarningMessage(
      `Evolve AI couldn't save the ${label} setting — VS Code hasn't finished ` +
      `loading the extension's settings schema. Reload the window to finish setup.`,
      'Reload Window', 'Dismiss'
    );
    if (pick === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
    return false;
  }

  // Any other error: log and fail silently
  console.error(`[Evolve AI] Failed to persist ${label}:`, result.error);
  return false;
}

// ── Secure host-setting reads ────────────────────────────────────────────────
// Settings like aiForge.ollamaHost / openaiBaseUrl / huggingfaceBaseUrl redirect
// all chat traffic (including code, git diffs, API tokens) to the configured
// URL. Two risks:
//   1. A malicious workspace-level .vscode/settings.json override can redirect
//      traffic to an attacker-controlled server. Fix: ignore workspace overrides
//      when vscode.workspace.isTrusted is false.
//   2. The user sets a non-loopback URL by mistake and doesn't realise their
//      code is leaving their machine. Fix: one-time warning for non-loopback.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PRIVATE_IP_RE  = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/;

/** True if the URL's hostname is loopback or a private RFC1918 range. */
export function isLocalHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (LOOPBACK_HOSTS.has(u.hostname)) return true;
    if (PRIVATE_IP_RE.test(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Read a URL setting safely. In untrusted workspaces, workspace-level overrides
 * are ignored (user-global value or default is used instead). This prevents a
 * malicious workspace from redirecting all chat traffic to an attacker server.
 */
export function readHostSetting(section: string, key: string, fallback: string): string {
  const cfg = vscode.workspace.getConfiguration(section);
  if (!vscode.workspace.isTrusted) {
    // Untrusted workspace → only accept Global or Default values, never
    // workspace or workspaceFolder overrides.
    const inspected = cfg.inspect<string>(key);
    return inspected?.globalValue ?? inspected?.defaultValue ?? fallback;
  }
  return cfg.get<string>(key, fallback);
}

// Track which hosts we've already warned about so we don't nag per read.
const _warnedHosts = new Set<string>();

/**
 * Warn the user once per session if a host setting points somewhere that isn't
 * loopback/private. Non-blocking — returns immediately; the toast fires async.
 * Call this when the user is about to make a request so the warning is actionable.
 */
export function warnIfRemoteHost(settingKey: string, value: string): void {
  if (_warnedHosts.has(value))   return;
  if (!value)                    return;
  if (isLocalHost(value))        return;
  _warnedHosts.add(value);

  vscode.window.showWarningMessage(
    `Evolve AI: \`${settingKey}\` is set to \`${value}\`, which is not a local address. ` +
    `All chat content (code, git diffs, errors) will be sent to this server. ` +
    `If this is not what you intended, change it in Settings.`,
    'Open Settings', 'I Understand'
  ).then(choice => {
    if (choice === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', settingKey);
    }
  });
}
