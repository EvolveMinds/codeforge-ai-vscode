/**
 * core/prCreator.ts — Create a pull request on GitHub or Bitbucket
 *
 * Three paths:
 *   1. GitHub API   — uses vscode.authentication.getSession('github', ['repo'])
 *                     so we never ship our own client_id. If no session is
 *                     available, falls through to (3).
 *   2. Bitbucket API — uses `aiForge.bitbucketPAT` (stored as 'username:app_password').
 *                      If no PAT, falls through to (3).
 *   3. Browser fallback — open the platform's "compare" URL pre-filled with
 *                         title + body. Works for github, bitbucket, gitlab.
 *
 * Returns the created PR's URL on success. Never throws — error paths return
 * `{ ok: false, ... }` and the caller decides whether to fall back to browser.
 *
 * Note: this module never asks the user to enter a token — the Git Connect
 * Wizard is the canonical place for token capture. We only consume what's
 * already there.
 */

import * as vscode from 'vscode';

export type PRHost = 'github' | 'bitbucket' | 'gitlab' | 'other';

export interface CreatePROptions {
  host:        PRHost;
  owner:       string;
  repo:        string;
  base:        string;   // target branch (e.g. 'main')
  head:        string;   // source branch (e.g. 'feat/setup-cicd')
  title:       string;
  body:        string;
  draft?:      boolean;
  /** Used by the Bitbucket path to look up `aiForge.bitbucketPAT`. */
  secrets:     vscode.SecretStorage;
}

export interface CreatePRResult {
  ok:        boolean;
  /** PR URL on success; never present on failure. */
  url?:      string;
  /** Short human-readable reason on failure. */
  error?:    string;
  /** True if the API path attempted but returned a non-2xx; useful for the
   *  caller to decide whether the browser fallback is appropriate. */
  apiFailed?: boolean;
}

/**
 * Try to create a PR via the platform's API. On any failure, returns
 * `{ ok: false, apiFailed: true, error: ... }` so the caller can choose to
 * open the browser fallback URL instead.
 */
export async function createPR(opts: CreatePROptions): Promise<CreatePRResult> {
  if (opts.host === 'github')    return _createGitHubPR(opts);
  if (opts.host === 'bitbucket') return _createBitbucketPR(opts);
  // gitlab + other → no API path here; let the caller open the compare URL.
  return { ok: false, error: `${opts.host} PR creation via API not supported; use browser fallback.` };
}

/**
 * Build a browser "compare" URL pre-filled with title + body. The user lands
 * on the platform's PR page with the diff already loaded and just clicks
 * "Create PR" to confirm.
 */
export function compareUrl(opts: { host: PRHost; owner: string; repo: string; base: string; head: string; title: string; body: string }): string {
  const { host, owner, repo, base, head, title, body } = opts;
  const t = encodeURIComponent(title);
  const b = encodeURIComponent(body);
  switch (host) {
    case 'github':
      // expand=1 opens the form view immediately.
      return `https://github.com/${owner}/${repo}/compare/${base}...${head}?expand=1&title=${t}&body=${b}`;
    case 'bitbucket':
      // Bitbucket's create-PR URL accepts source / dest as query params.
      return `https://bitbucket.org/${owner}/${repo}/pull-requests/new?source=${head}&dest=${base}&title=${t}`;
    case 'gitlab':
      // GitLab calls them merge requests.
      return `https://gitlab.com/${owner}/${repo}/-/merge_requests/new?merge_request[source_branch]=${head}&merge_request[target_branch]=${base}&merge_request[title]=${t}`;
    default:
      return `https://${host}/${owner}/${repo}`;
  }
}

// ── GitHub ─────────────────────────────────────────────────────────────────

async function _createGitHubPR(opts: CreatePROptions): Promise<CreatePRResult> {
  // Reuse the existing VS Code GitHub session — same auth path the Git Connect Wizard sets up.
  let session: vscode.AuthenticationSession | undefined;
  try {
    session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
  } catch { /* fall through */ }

  if (!session?.accessToken) {
    return { ok: false, error: 'No GitHub session in VS Code — run the Git Connect Wizard first or use browser fallback.' };
  }

  const payload: Record<string, unknown> = {
    title: opts.title,
    body:  opts.body,
    head:  opts.head,
    base:  opts.base,
  };
  if (opts.draft) payload.draft = true;

  const url = `https://api.github.com/repos/${opts.owner}/${opts.repo}/pulls`;
  try {
    const res = await _fetchJson(url, {
      method:  'POST',
      headers: {
        Accept:          'application/vnd.github+json',
        Authorization:   `Bearer ${session.accessToken}`,
        'User-Agent':    'Evolve-AI-VSCode',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    }, 30_000);

    if (res.status >= 200 && res.status < 300 && res.json && typeof res.json.html_url === 'string') {
      return { ok: true, url: res.json.html_url };
    }
    const msg = (res.json && (res.json.message || res.json.errors?.[0]?.message)) || `HTTP ${res.status}`;
    return { ok: false, error: msg, apiFailed: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message, apiFailed: true };
  }
}

// ── Bitbucket ──────────────────────────────────────────────────────────────

async function _createBitbucketPR(opts: CreatePROptions): Promise<CreatePRResult> {
  const stored = await opts.secrets.get('aiForge.bitbucketPAT');
  if (!stored || !stored.includes(':')) {
    return { ok: false, error: 'No Bitbucket App Password stored — run the Git Connect Wizard first or use browser fallback.' };
  }
  const basic = Buffer.from(stored, 'utf8').toString('base64');

  const url = `https://api.bitbucket.org/2.0/repositories/${opts.owner}/${opts.repo}/pullrequests`;
  const payload = {
    title:       opts.title,
    description: opts.body,
    source:      { branch: { name: opts.head } },
    destination: { branch: { name: opts.base } },
  };

  try {
    const res = await _fetchJson(url, {
      method:  'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept:        'application/json',
        'Content-Type':'application/json',
        'User-Agent':  'Evolve-AI-VSCode',
      },
      body: JSON.stringify(payload),
    }, 30_000);

    if (res.status >= 200 && res.status < 300 && res.json?.links?.html?.href) {
      return { ok: true, url: res.json.links.html.href };
    }
    const msg = res.json?.error?.message || `HTTP ${res.status}`;
    return { ok: false, error: msg, apiFailed: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message, apiFailed: true };
  }
}

// ── Minimal fetch wrapper (Node 18+ ships fetch globally) ─────────────────

interface JsonResult { status: number; json: any }

async function _fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<JsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // VS Code 1.85 runs on Electron with a fetch polyfill / Node 18 fetch.
    const res = await fetch(url, { ...init, signal: controller.signal });
    let json: any = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}
