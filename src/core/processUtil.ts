/**
 * core/processUtil.ts — Shared spawn-with-timeout helpers
 *
 * Used by hardwareInspector, setupOrchestrator, and gitConnectInspector /
 * gitConnectOrchestrator. Centralises the "spawn with timeout, never throw,
 * return stdout-or-null" pattern so each wizard doesn't reinvent it.
 *
 * Two helpers:
 *  - runCommand(cmd, args, opts) — one-shot. Returns { code, stdout, stderr } or null on timeout/error.
 *  - waitForCommand(cmd, args, signal, opts) — poll until the command exits 0
 *    or the timeout / abort fires. Used to detect "user finished installing X".
 *
 * Defaults to `shell: false` with an args array — avoids platform shell-quoting
 * pitfalls (PowerShell vs bash) and command-injection holes. Callers probing a
 * Windows .cmd shim (gcloud, az) must opt in with `shell: true`, because Node
 * cannot execute a batch file otherwise.
 */

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';

/**
 * Node's spawn fails with ENOENT when `cwd` does not exist, and the error is
 * indistinguishable from "the command is not installed". A workspace folder
 * that has been moved or deleted would therefore make every CLI probe report
 * the tool as missing. Fall back to the process cwd instead of guessing.
 */
function usableCwd(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  try {
    if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) return cwd;
  } catch { /* fall through */ }
  return undefined;
}

export interface RunResult {
  code:   number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Hard kill after this many ms. Default 3000. */
  timeoutMs?: number;
  /** Working directory for the spawn. */
  cwd?:       string;
  /** Extra environment vars merged into process.env. */
  env?:       NodeJS.ProcessEnv;
  /** Optional input to write to stdin (then end). */
  stdin?:     string;
  /**
   * Run through a shell. Required on Windows for CLIs that ship a .cmd/.bat
   * shim rather than a real .exe (gcloud, az, npm). Node refuses to execute a
   * batch file with shell:false — it returns EINVAL, which reads like "not
   * installed" — so detection of those tools must opt in.
   *
   * Only ever set this for a fixed command with caller-controlled arguments;
   * a shell reintroduces quoting and injection concerns that shell:false avoids.
   */
  shell?:     boolean;
}

/**
 * Run a command once with a timeout. Returns the result or null on spawn error.
 * Never throws. Stdout / stderr are captured as utf-8 strings.
 */
export function runCommand(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult | null> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  return new Promise(resolve => {
    let settled = false;
    const done = (val: RunResult | null) => { if (!settled) { settled = true; resolve(val); } };
    try {
      const proc = spawn(cmd, args, {
        shell:       opts.shell === true,
        windowsHide: true,
        cwd:         usableCwd(opts.cwd),
        env:         opts.env ? { ...process.env, ...opts.env } : process.env,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } done(null); }, timeoutMs);
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
      proc.on('error', () => { clearTimeout(timer); done(null); });
      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        done({ code, stdout, stderr });
      });
      if (opts.stdin !== undefined) {
        try {
          proc.stdin?.write(opts.stdin);
          proc.stdin?.end();
        } catch { /* ignore — best effort */ }
      }
    } catch {
      done(null);
    }
  });
}

/**
 * Convenience: run a command and return only stdout if exit code 0; else null.
 * Matches the older _runCommand() shape used by hardwareInspector.
 */
export async function runForStdout(cmd: string, args: string[], opts: RunOptions = {}): Promise<string | null> {
  const r = await runCommand(cmd, args, opts);
  if (!r) return null;
  return r.code === 0 ? r.stdout : null;
}

/**
 * Poll `cmd args` every `intervalMs` until exit code 0, OR signal aborts,
 * OR `totalTimeoutMs` elapses. Used to wait for the user to complete an
 * out-of-band install (e.g. "user just downloaded Ollama").
 *
 * Returns true on success, false on timeout/abort.
 */
export function waitForCommand(
  cmd: string,
  args: string[],
  signal: AbortSignal,
  totalTimeoutMs: number,
  intervalMs = 3000
): Promise<boolean> {
  const start = Date.now();
  return new Promise(resolve => {
    const tick = async () => {
      if (signal.aborted)                    return resolve(false);
      if (Date.now() - start > totalTimeoutMs) return resolve(false);
      const r = await runCommand(cmd, args, { timeoutMs: Math.min(intervalMs, 5000) });
      if (r && r.code === 0) return resolve(true);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/** Compare semver strings. Returns true if a < b. Tolerant of missing parts. */
export function versionLessThan(a: string, b: string): boolean {
  const aParts = a.split('.').map(s => Number(s.replace(/[^\d].*$/, '')) || 0);
  const bParts = b.split('.').map(s => Number(s.replace(/[^\d].*$/, '')) || 0);
  for (let i = 0; i < 3; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}

/**
 * Re-reads PATH from the Windows registry and merges anything new into
 * process.env.PATH.
 *
 * A running process keeps the environment it was launched with, so a CLI
 * installed after the app started (aws, gcloud, az, docker) is invisible to it
 * until the app is restarted — "installed, but Evolve still says missing".
 * Refreshing before a probe or a terminal command removes that restart.
 *
 * Machine and User PATH are read separately because that is how Windows stores
 * them; an installer typically writes to one, not the combined value.
 * No-ops off Windows, where no such split exists. Never throws.
 */
export function refreshPathFromRegistry(): void {
  if (process.platform !== 'win32') return;

  try {
    // -NoProfile keeps this fast and avoids user profile side effects.
    const read = (scope: 'Machine' | 'User') => {
      const r = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
         `[Environment]::GetEnvironmentVariable('Path','${scope}')`],
        { encoding: 'utf8', timeout: 5000, windowsHide: true },
      );
      return (r.status === 0 && r.stdout) ? r.stdout.trim() : '';
    };

    const fromRegistry = `${read('Machine')};${read('User')}`;
    if (!fromRegistry.replace(/;/g, '')) return;   // both reads failed

    const current = process.env.PATH || '';
    const seen = new Set(
      current.split(';').map(s => s.trim().toLowerCase()).filter(Boolean),
    );

    const additions = fromRegistry
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !seen.has(s.toLowerCase()));

    if (additions.length) {
      process.env.PATH = current ? `${current};${additions.join(';')}` : additions.join(';');
    }
  } catch { /* a stale PATH is better than a crash */ }
}
