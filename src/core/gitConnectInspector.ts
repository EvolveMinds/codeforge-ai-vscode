/**
 * core/gitConnectInspector.ts — Detection for the Git/Bitbucket connection wizard
 *
 * Mirrors core/hardwareInspector.ts in shape: a single inspect() returning a
 * structured profile, plus summary() / recommendNextStep(). All probes run in
 * parallel with timeouts; failures degrade gracefully and never throw.
 *
 * Detects:
 *  - git installation + version
 *  - global identity (user.name / user.email)
 *  - workspace repo state (init? branch? has commits?)
 *  - remote configuration (origin URL, host, protocol)
 *  - SSH keys, GitHub CLI, VS Code GitHub session, stored PATs
 *  - existing credential.helper (so we don't overwrite the user's setup)
 *
 * Privacy: nothing leaves the machine. Only reads local state.
 * Workspace trust: callers must check this themselves — the inspector still
 * reports what it can see, but the orchestrator refuses to act on untrusted
 * workspaces (matches the configSafe.readHostSetting policy).
 */

import * as vscode from 'vscode';
import * as os     from 'os';
import * as path   from 'path';
import * as fs     from 'fs';
import { runForStdout, runCommand, versionLessThan } from './processUtil';

export type GitHost = 'github' | 'bitbucket' | 'gitlab' | 'other';
export type GitProtocol = 'https' | 'ssh';

export interface GitInstallInfo {
  installed:   boolean;
  version:     string | null;
  needsUpdate: boolean;
}

export interface GitIdentityInfo {
  name:       string | null;
  email:      string | null;
  configured: boolean;
}

export interface GitRepoInfo {
  isRepo:     boolean;
  root:       string | null;
  branch:     string | null;
  hasCommits: boolean;
}

export interface GitRemoteInfo {
  configured: boolean;
  url:        string | null;
  host:       GitHost | null;
  protocol:   GitProtocol | null;
}

export interface GitAuthInfo {
  /** Discovered SSH public key files in ~/.ssh */
  sshKeys:             string[];
  /** `gh --version` works */
  ghCliInstalled:      boolean;
  /** `gh auth status` says authenticated */
  ghCliAuthed:         boolean;
  /** vscode.authentication has a usable GitHub session */
  vscodeGithubSession: boolean;
  /** Existing global credential.helper (e.g. 'manager', 'osxkeychain', 'store') */
  credentialHelper:    string | null;
  /** Whether SecretStorage already holds a PAT for each platform */
  storedPATs:          { github: boolean; bitbucket: boolean };
}

export interface GitConnectProfile {
  git:       GitInstallInfo;
  identity:  GitIdentityInfo;
  repo:      GitRepoInfo;
  remote:    GitRemoteInfo;
  auth:      GitAuthInfo;
  workspace: string | null;
  platform:  NodeJS.Platform;
  trusted:   boolean;
  detectedAt: number;
}

export type NextStep =
  | { kind: 'untrusted';        reason: string }
  | { kind: 'install-git';      reason: string }
  | { kind: 'set-identity';     reason: string }
  | { kind: 'init-repo';        reason: string }
  | { kind: 'configure-auth';   reason: string }
  | { kind: 'add-remote';       reason: string }
  | { kind: 'verify';           reason: string }
  | { kind: 'ready';            reason: string };

const SHELL_TIMEOUT_MS  = 3_000;
// Git 2.30+ covers fundamental security fixes (CVE-2022-24765 directory traversal,
// CVE-2023-22490 partial-clone exfiltration). Older versions still work for basic
// flows, but we surface a needsUpdate hint.
const MIN_GIT_VERSION   = '2.30.0';

const GH_CLI_TIMEOUT_MS = 4_000;

const SECRET_GITHUB_PAT    = 'aiForge.githubPAT';
const SECRET_BITBUCKET_PAT = 'aiForge.bitbucketPAT';

export class GitConnectInspector {
  constructor(private readonly _secrets: vscode.SecretStorage) {}

  /** Public accessor for SecretStorage so commands can read/write tokens. */
  get secrets(): vscode.SecretStorage {
    return this._secrets;
  }

  /** Run every probe in parallel. Never throws. */
  async inspect(workspacePath: string | undefined): Promise<GitConnectProfile> {
    const platform  = process.platform;
    const ws        = workspacePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    const trusted   = vscode.workspace.isTrusted;

    const [git, identity, repo, remote, auth] = await Promise.all([
      this._detectGit(),
      this._detectIdentity(),
      this._detectRepo(ws),
      this._detectRemote(ws),
      this._detectAuth(),
    ]);

    return {
      git,
      identity,
      repo,
      remote,
      auth,
      workspace:  ws,
      platform,
      trusted,
      detectedAt: Date.now(),
    };
  }

  /** One-line human-readable summary. */
  summary(p: GitConnectProfile): string {
    const parts: string[] = [];
    parts.push(p.git.installed ? `git ${p.git.version ?? '?'}` : 'git: not installed');
    parts.push(p.identity.configured ? `${p.identity.name} <${p.identity.email}>` : 'identity: not set');
    if (p.repo.isRepo) {
      parts.push(`repo: ${p.repo.branch ?? '(no branch)'}`);
      if (!p.repo.hasCommits) parts.push('no commits');
    } else {
      parts.push('not a repo');
    }
    if (p.remote.configured) {
      parts.push(`remote: ${p.remote.host ?? 'other'} (${p.remote.protocol ?? '?'})`);
    } else if (p.repo.isRepo) {
      parts.push('no remote');
    }
    return parts.join(' · ');
  }

  /**
   * Pick the right starting step for the wizard. Strict ordering — each prereq
   * must be satisfied before moving on. Returns 'ready' if everything looks good.
   */
  recommendNextStep(p: GitConnectProfile): NextStep {
    if (!p.trusted) {
      return {
        kind:   'untrusted',
        reason: 'This workspace is not trusted. Trust the workspace in the toolbar before connecting Git.',
      };
    }
    if (!p.git.installed) {
      return { kind: 'install-git', reason: 'Git is not installed on this machine.' };
    }
    if (!p.identity.configured) {
      return { kind: 'set-identity', reason: 'Git user.name and user.email are not set.' };
    }
    if (!p.repo.isRepo) {
      return { kind: 'init-repo', reason: 'This workspace is not yet a git repository.' };
    }
    if (!p.remote.configured) {
      return { kind: 'add-remote', reason: 'No `origin` remote is configured for this repo.' };
    }
    if (!this._authConfiguredFor(p)) {
      return {
        kind:   'configure-auth',
        reason: `Remote is set to ${p.remote.host ?? 'a host'} but no matching auth is configured.`,
      };
    }
    return { kind: 'verify', reason: 'Looks good — verify the connection works.' };
  }

  // ── Detection internals ────────────────────────────────────────────────────

  private async _detectGit(): Promise<GitInstallInfo> {
    const out = await runForStdout('git', ['--version'], { timeoutMs: SHELL_TIMEOUT_MS });
    if (!out) return { installed: false, version: null, needsUpdate: false };
    const match = out.match(/(\d+\.\d+\.\d+)/);
    if (!match) return { installed: true, version: null, needsUpdate: false };
    const version = match[1];
    return {
      installed:   true,
      version,
      needsUpdate: versionLessThan(version, MIN_GIT_VERSION),
    };
  }

  private async _detectIdentity(): Promise<GitIdentityInfo> {
    const [nameOut, emailOut] = await Promise.all([
      runForStdout('git', ['config', '--global', 'user.name'],  { timeoutMs: SHELL_TIMEOUT_MS }),
      runForStdout('git', ['config', '--global', 'user.email'], { timeoutMs: SHELL_TIMEOUT_MS }),
    ]);
    const name  = nameOut  ? nameOut.trim()  : null;
    const email = emailOut ? emailOut.trim() : null;
    return {
      name,
      email,
      configured: !!(name && email),
    };
  }

  private async _detectRepo(ws: string | null): Promise<GitRepoInfo> {
    if (!ws) return { isRepo: false, root: null, branch: null, hasCommits: false };

    const inside = await runForStdout('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ws, timeoutMs: SHELL_TIMEOUT_MS });
    if (!inside || inside.trim() !== 'true') {
      return { isRepo: false, root: null, branch: null, hasCommits: false };
    }

    const [rootOut, branchOut, headOut] = await Promise.all([
      runForStdout('git', ['rev-parse', '--show-toplevel'],  { cwd: ws, timeoutMs: SHELL_TIMEOUT_MS }),
      runForStdout('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ws, timeoutMs: SHELL_TIMEOUT_MS }),
      runForStdout('git', ['rev-parse', '--verify', 'HEAD'], { cwd: ws, timeoutMs: SHELL_TIMEOUT_MS }),
    ]);

    return {
      isRepo:     true,
      root:       rootOut  ? rootOut.trim()  : ws,
      branch:     branchOut ? branchOut.trim() : null,
      hasCommits: !!(headOut && headOut.trim().length > 0),
    };
  }

  private async _detectRemote(ws: string | null): Promise<GitRemoteInfo> {
    if (!ws) return { configured: false, url: null, host: null, protocol: null };

    const out = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws, timeoutMs: SHELL_TIMEOUT_MS });
    const url = out ? out.trim() : '';
    if (!url) return { configured: false, url: null, host: null, protocol: null };

    return {
      configured: true,
      url,
      host:       this.classifyHost(url),
      protocol:   this.classifyProtocol(url),
    };
  }

  private async _detectAuth(): Promise<GitAuthInfo> {
    const home = os.homedir();
    const sshDir = path.join(home, '.ssh');
    let sshKeys: string[] = [];
    try {
      if (fs.existsSync(sshDir)) {
        sshKeys = fs.readdirSync(sshDir).filter(f => f.endsWith('.pub'));
      }
    } catch { /* ignore — permission denied, missing dir, etc. */ }

    const [ghVer, ghStatus, helperOut, githubPAT, bitbucketPAT, vscodeSession] = await Promise.all([
      runForStdout('gh', ['--version'], { timeoutMs: GH_CLI_TIMEOUT_MS }),
      runForStdout('gh', ['auth', 'status', '--hostname', 'github.com'], { timeoutMs: GH_CLI_TIMEOUT_MS }),
      runForStdout('git', ['config', '--global', '--get', 'credential.helper'], { timeoutMs: SHELL_TIMEOUT_MS }),
      this._secrets.get(SECRET_GITHUB_PAT),
      this._secrets.get(SECRET_BITBUCKET_PAT),
      this._probeVscodeGithubSession(),
    ]);

    return {
      sshKeys,
      ghCliInstalled:      !!ghVer,
      ghCliAuthed:         !!(ghStatus && /Logged in to/.test(ghStatus)),
      vscodeGithubSession: vscodeSession,
      credentialHelper:    helperOut ? helperOut.trim() : null,
      storedPATs:          {
        github:    !!githubPAT,
        bitbucket: !!bitbucketPAT,
      },
    };
  }

  /**
   * Non-interactive probe — never prompts the user. Returns true if the user
   * already has a GitHub session in VS Code's built-in auth provider.
   */
  private async _probeVscodeGithubSession(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
      return !!session?.accessToken;
    } catch {
      return false;
    }
  }

  // ── Public helpers (used by orchestrator + commands) ───────────────────────

  /** Classify a remote URL into a known host. */
  classifyHost(url: string): GitHost {
    const lower = url.toLowerCase();
    if (lower.includes('github.com'))    return 'github';
    if (lower.includes('bitbucket.org')) return 'bitbucket';
    if (lower.includes('gitlab.com'))    return 'gitlab';
    return 'other';
  }

  /** Classify a remote URL as HTTPS or SSH. */
  classifyProtocol(url: string): GitProtocol {
    if (url.startsWith('http://') || url.startsWith('https://')) return 'https';
    // Common SSH forms: git@github.com:owner/repo.git, ssh://git@host/path
    return 'ssh';
  }

  /** True if the user already has matching auth for the configured remote. */
  private _authConfiguredFor(p: GitConnectProfile): boolean {
    if (!p.remote.configured || !p.remote.host || !p.remote.protocol) return false;
    if (p.remote.protocol === 'ssh') {
      return p.auth.sshKeys.length > 0;
    }
    // HTTPS — any of: VS Code session (github), gh CLI authed (github), stored PAT, existing credential helper
    if (p.remote.host === 'github') {
      return p.auth.vscodeGithubSession || p.auth.ghCliAuthed || p.auth.storedPATs.github || !!p.auth.credentialHelper;
    }
    if (p.remote.host === 'bitbucket') {
      return p.auth.storedPATs.bitbucket || !!p.auth.credentialHelper;
    }
    // gitlab / other — fall back to credential helper presence
    return !!p.auth.credentialHelper;
  }

  /** Run a quick `git ls-remote origin` in the workspace; returns `{ ok, error }`. */
  async testConnection(ws: string): Promise<{ ok: boolean; error?: string }> {
    const r = await runCommand('git', ['ls-remote', '--heads', 'origin'], {
      cwd: ws, timeoutMs: 10_000,
    });
    if (!r) return { ok: false, error: 'Command timed out (10s) — check network and remote URL.' };
    if (r.code === 0) return { ok: true };
    const err = (r.stderr || r.stdout || '').trim().split('\n').slice(0, 4).join(' ');
    return { ok: false, error: err || `git exited with code ${r.code}` };
  }
}

export const SECRETS = {
  githubPAT:    SECRET_GITHUB_PAT,
  bitbucketPAT: SECRET_BITBUCKET_PAT,
};
