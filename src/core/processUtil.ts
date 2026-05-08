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
 * Always uses `shell: false` and an args array — avoids platform shell-quoting
 * pitfalls (PowerShell vs bash) and command-injection holes.
 */

import { spawn } from 'child_process';

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
        shell:       false,
        windowsHide: true,
        cwd:         opts.cwd,
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
