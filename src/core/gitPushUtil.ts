/**
 * core/gitPushUtil.ts — Branch push + default-branch detection
 *
 * Used by the CI/CD Setup Wizard's Stage & Commit flow (v2.2.0) to push the
 * just-committed branch to origin and, on first push, set upstream.
 *
 * Decisions baked in (see v2.2 plan):
 *  - Never force push. If the remote has diverged, return an error and let
 *    the caller surface a manual `git pull --rebase` toast.
 *  - Always `-u` on first push so the user gets upstream tracking for free.
 *  - Default branch is detected from `refs/remotes/origin/HEAD`; falls back
 *    to `main` if the symref isn't set yet.
 *  - All calls go through processUtil so we inherit the spawn-with-timeout
 *    pattern (never throws, no shell injection).
 */

import { runCommand, runForStdout } from './processUtil';

export type PushFailure =
  | 'no-upstream'        // benign — first push, we add -u and retry
  | 'rejected-non-ff'    // remote has commits we don't — user must pull/rebase
  | 'auth-failed'        // credentials missing or wrong
  | 'network'            // dns / connection failure
  | 'unknown';

export interface PushResult {
  ok:        boolean;
  /** Final stdout/stderr from git, truncated to ~400 chars for toast display. */
  message:   string;
  /** Coarse reason on failure, used by callers to pick a recovery hint. */
  reason?:   PushFailure;
  /** True if we ran `git push -u origin <branch>` (vs plain `git push`). */
  setUpstream?: boolean;
}

/**
 * Push the named branch to `origin`. Sets upstream on first push.
 *
 * The implementation is deliberately conservative:
 *  1. First try `git push origin <branch>` — works if upstream is already set.
 *  2. On "no upstream" stderr, retry with `-u`.
 *  3. On "non-fast-forward" stderr, refuse — do NOT force push. Return a
 *     reason of 'rejected-non-ff' so the caller can prompt the user.
 *  4. On auth / network failures, surface a clean reason for the toast.
 */
export async function pushBranch(cwd: string, branch: string, timeoutMs = 30_000): Promise<PushResult> {
  // First attempt: assume upstream already exists (subsequent pushes hit this path).
  let r = await runCommand('git', ['push', 'origin', branch], { cwd, timeoutMs });
  let setUpstream = false;

  if (r && r.code === 0) {
    return { ok: true, message: trimMsg(r.stdout || r.stderr || 'pushed'), setUpstream: false };
  }

  // Inspect stderr to decide whether to retry with -u.
  const stderr = (r?.stderr || '').toLowerCase();
  if (stderr.includes('has no upstream branch') || stderr.includes('set-upstream')) {
    setUpstream = true;
    r = await runCommand('git', ['push', '-u', 'origin', branch], { cwd, timeoutMs });
    if (r && r.code === 0) {
      return { ok: true, message: trimMsg(r.stdout || r.stderr || 'pushed (set upstream)'), setUpstream: true };
    }
  }

  // Classify the failure for the caller.
  const combined = ((r?.stderr || '') + ' ' + (r?.stdout || '')).toLowerCase();
  let reason: PushFailure = 'unknown';
  if (combined.includes('non-fast-forward') || combined.includes('rejected')) reason = 'rejected-non-ff';
  else if (combined.includes('authentication') || combined.includes('permission denied') || combined.includes('could not read username')) reason = 'auth-failed';
  else if (combined.includes('could not resolve host') || combined.includes('network') || combined.includes('connection refused')) reason = 'network';

  return {
    ok:      false,
    message: trimMsg(r?.stderr || r?.stdout || 'git push failed (no output)'),
    reason,
    setUpstream,
  };
}

/**
 * Detect the remote's default branch. Tries (in order):
 *   1. `git symbolic-ref refs/remotes/origin/HEAD` — works if `git remote set-head`
 *      or a fresh clone set the symref.
 *   2. `git remote show origin` — slower but doesn't require the local symref.
 *   3. Fall back to 'main'.
 */
export async function getDefaultBranch(cwd: string): Promise<string> {
  const symref = await runForStdout('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
    cwd, timeoutMs: 3000,
  });
  if (symref) {
    // Returns "origin/main" — strip the remote prefix.
    const m = symref.trim().match(/^origin\/(.+)$/);
    if (m) return m[1];
  }

  // Fallback: `git remote show origin` includes a "HEAD branch: main" line.
  const show = await runForStdout('git', ['remote', 'show', 'origin'], {
    cwd, timeoutMs: 10_000,
  });
  if (show) {
    const m = show.match(/HEAD branch:\s*(\S+)/);
    if (m && m[1] && m[1] !== '(unknown)') return m[1];
  }

  return 'main';
}

/** Current branch name, or null if HEAD is detached / git not present. */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  const out = await runForStdout('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 3000 });
  if (!out) return null;
  const trimmed = out.trim();
  return trimmed === 'HEAD' ? null : trimmed;
}

/** Parse "owner/repo" from a github/bitbucket/gitlab remote URL. Returns null if unrecognised. */
export function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS forms:  https://github.com/owner/repo(.git)?
  // SSH forms:    git@github.com:owner/repo(.git)?  or  ssh://git@host/owner/repo
  // Bitbucket workspace/slug works the same way.
  const cleaned = remoteUrl.replace(/\.git$/, '').replace(/\/$/, '');
  // SSH "git@host:owner/repo" form.
  const sshMatch = cleaned.match(/^[^@\s]+@[^:]+:([^/]+)\/(.+)$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  // HTTPS / ssh:// form.
  const urlMatch = cleaned.match(/^[a-z]+:\/\/[^/]+\/([^/]+)\/(.+)$/i);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  return null;
}

/** Read `origin` remote URL from the repo, or null if no origin configured. */
export async function getOriginUrl(cwd: string): Promise<string | null> {
  const out = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd, timeoutMs: 3000 });
  return out ? out.trim() : null;
}

function trimMsg(s: string): string {
  return s.trim().split('\n').slice(0, 8).join(' ').slice(0, 400);
}
