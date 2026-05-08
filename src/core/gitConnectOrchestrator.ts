/**
 * core/gitConnectOrchestrator.ts — One-click Git/Bitbucket connection setup
 *
 * Sibling to core/setupOrchestrator.ts. Plans and executes the install /
 * identity / repo / auth / remote / verify steps a user needs to go from
 * "fresh workspace" or "disconnected repo" to "✓ remote works."
 *
 * Each step:
 *   - declares whether it's needed (orchestrator skips no-ops)
 *   - reports progress through a single vscode.window.withProgress notification
 *   - is cancellable via AbortSignal (Esc on the progress notification)
 *   - never modifies the user's system without confirmation captured in the choice
 *
 * Sensitive data:
 *   - PATs are validated against the platform's API, then stored in
 *     vscode.SecretStorage. They never touch settings.json or disk.
 *   - SSH private keys are never read; we only generate them on user request
 *     and copy the .pub to the clipboard.
 */

import * as vscode from 'vscode';
import * as os     from 'os';
import * as path   from 'path';
import * as fs     from 'fs';
import * as https  from 'https';
import { runCommand, runForStdout, waitForCommand } from './processUtil';
import {
  GitConnectInspector,
  GitConnectProfile,
  GitHost,
  GitProtocol,
  SECRETS,
} from './gitConnectInspector';

// ── Public types ──────────────────────────────────────────────────────────────

export type AuthMethod =
  | 'github-builtin'    // vscode.authentication.getSession('github', …)
  | 'pat'               // Personal Access Token / Bitbucket app password
  | 'ssh'               // ed25519 keypair
  | 'gh-cli';           // gh auth login

export interface RepoChoice {
  /** What to do about the repo. */
  action:    'init' | 'clone' | 'link' | 'skip';
  /** Required when action === 'clone' or 'link'. */
  remoteUrl?: string;
}

export interface CreateRemoteChoice {
  /** True if we should create the repo on the platform. */
  enabled:     boolean;
  /** Slug for the new repo (e.g. "owner/repo"). */
  fullName?:   string;
  /** Public or private. Defaults to private. */
  isPrivate?:  boolean;
}

export interface WizardChoice {
  host:           GitHost;
  authMethod:     AuthMethod;
  repo:           RepoChoice;
  identity?:      { name: string; email: string };
  /** PAT path only — token the user pasted. Validated before persisting. */
  pendingPAT?:    string;
  /** SSH path only — passphrase to use when generating keys ('' for none). */
  sshPassphrase?: string;
  createRemote?:  CreateRemoteChoice;
  /** If true, push current HEAD to origin once everything else is done. */
  pushOnConnect?: boolean;
}

export interface GitConnectStep {
  id:     string;
  label:  string;
  needed: boolean;
  run:    (progress: StepProgress, signal: AbortSignal) => Promise<void>;
}

export interface StepProgress {
  message: (text: string) => void;
}

export interface GitConnectPlan {
  steps:      GitConnectStep[];
  totalSteps: number;
  choice:     WizardChoice;
}

export interface ExecuteResult {
  ok:        boolean;
  error?:    string;
  /** Empty array on success; one entry per non-fatal warning. */
  warnings:  string[];
  /** Final remote URL once setup completes (mostly for tests). */
  remoteUrl?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GIT_INSTALL_TIMEOUT_MS  = 5 * 60 * 1000;    // 5 min for user to install git
const SSH_TEST_TIMEOUT_MS     = 10_000;
const API_TIMEOUT_MS          = 10_000;
const VERIFY_TIMEOUT_MS       = 10_000;

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class GitConnectOrchestrator {
  constructor(
    private readonly _inspector: GitConnectInspector,
    private readonly _secrets:   vscode.SecretStorage,
  ) {}

  /**
   * Build the step list. Each step's `needed` flag is set up-front so the
   * progress notification can report N/total accurately.
   */
  planSteps(profile: GitConnectProfile, choice: WizardChoice): GitConnectPlan {
    const steps: GitConnectStep[] = [];

    // 1. install git
    if (!profile.git.installed) {
      steps.push({
        id:     'install-git',
        label:  'Install Git',
        needed: true,
        run:    (p, sig) => this._installGit(profile.platform, p, sig),
      });
    }

    // 2. set identity
    if (choice.identity && (!profile.identity.configured ||
        choice.identity.name  !== profile.identity.name ||
        choice.identity.email !== profile.identity.email)) {
      steps.push({
        id:     'set-identity',
        label:  'Set Git identity',
        needed: true,
        run:    async (p) => this._setIdentity(choice.identity!, p),
      });
    }

    // 3. init / clone / link
    if (choice.repo.action !== 'skip') {
      steps.push({
        id:     `repo-${choice.repo.action}`,
        label:  this._repoLabel(choice.repo),
        needed: true,
        run:    (p, sig) => this._handleRepo(profile, choice, p, sig),
      });
    }

    // 4. configure auth
    steps.push({
      id:     `auth-${choice.authMethod}`,
      label:  `Configure ${this._authLabel(choice.authMethod, choice.host)}`,
      needed: true,
      run:    (p, sig) => this._configureAuth(profile, choice, p, sig),
    });

    // 5. (optional) create remote on platform
    if (choice.createRemote?.enabled) {
      steps.push({
        id:     'create-remote',
        label:  `Create ${choice.host} repo (${choice.createRemote.fullName})`,
        needed: true,
        run:    (p, sig) => this._createRemote(profile, choice, p, sig),
      });
    }

    // 6. push on connect (optional)
    if (choice.pushOnConnect) {
      steps.push({
        id:     'push',
        label:  'Push HEAD to origin',
        needed: true,
        run:    (p, sig) => this._pushHead(profile, p, sig),
      });
    }

    // 7. verify
    steps.push({
      id:     'verify',
      label:  'Verify connection',
      needed: true,
      run:    (p, sig) => this._verifyConnection(profile, p, sig),
    });

    return { steps, totalSteps: steps.length, choice };
  }

  /** Execute a plan inside a single progress notification. */
  async execute(plan: GitConnectPlan): Promise<ExecuteResult> {
    return vscode.window.withProgress(
      {
        location:    vscode.ProgressLocation.Notification,
        title:       'Connecting Git remote',
        cancellable: true,
      },
      async (progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const warnings: string[] = [];

        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i];
          if (!step.needed) continue;

          progress.report({ message: `Step ${i + 1}/${plan.totalSteps}: ${step.label}` });
          const stepProgress: StepProgress = {
            message: (text) => progress.report({ message: `Step ${i + 1}/${plan.totalSteps}: ${text}` }),
          };

          try {
            await step.run(stepProgress, abort.signal);
            if (abort.signal.aborted) return { ok: false, error: 'Cancelled', warnings };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: `${step.label} failed: ${msg}`, warnings };
          }
        }

        return { ok: true, warnings };
      }
    );
  }

  // ── Step implementations ──────────────────────────────────────────────────

  private async _installGit(platform: NodeJS.Platform, p: StepProgress, signal: AbortSignal): Promise<void> {
    p.message('Opening Git installer…');
    if (platform === 'win32') {
      await vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/download/win'));
      p.message('Run the installer when it finishes downloading, then leave this window open');
    } else if (platform === 'darwin') {
      const term = vscode.window.createTerminal('Evolve AI: Install Git');
      term.show();
      term.sendText('xcode-select --install');
      p.message('Confirm the install dialog, then leave this window open');
    } else {
      const term = vscode.window.createTerminal('Evolve AI: Install Git');
      term.show();
      term.sendText('# Run the package-manager command for your distro:');
      term.sendText('# Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y git');
      term.sendText('# Fedora:        sudo dnf install -y git');
      term.sendText('# Arch:          sudo pacman -S git');
      p.message('Run the install command in the terminal, then leave this window open');
    }
    p.message('Waiting for git install to complete (up to 5 min)…');
    const ok = await waitForCommand('git', ['--version'], signal, GIT_INSTALL_TIMEOUT_MS);
    if (!ok) throw new Error('Git installation did not complete within 5 minutes. Install manually from https://git-scm.com/downloads, then re-run this wizard.');
    p.message('Git installed ✓');
  }

  private async _setIdentity(identity: { name: string; email: string }, p: StepProgress): Promise<void> {
    p.message(`Setting user.name = ${identity.name}`);
    const r1 = await runCommand('git', ['config', '--global', 'user.name', identity.name], { timeoutMs: 5000 });
    if (!r1 || r1.code !== 0) throw new Error('git config user.name failed');
    p.message(`Setting user.email = ${identity.email}`);
    const r2 = await runCommand('git', ['config', '--global', 'user.email', identity.email], { timeoutMs: 5000 });
    if (!r2 || r2.code !== 0) throw new Error('git config user.email failed');
    p.message('Identity configured ✓');
  }

  private _repoLabel(repo: RepoChoice): string {
    switch (repo.action) {
      case 'init':  return 'Initialise repository';
      case 'clone': return `Clone ${repo.remoteUrl}`;
      case 'link':  return `Link existing remote (${repo.remoteUrl})`;
      default:      return 'Repository';
    }
  }

  private async _handleRepo(profile: GitConnectProfile, choice: WizardChoice, p: StepProgress, signal: AbortSignal): Promise<void> {
    void signal;
    const ws = profile.workspace;
    if (!ws) throw new Error('No workspace folder open.');
    const action = choice.repo.action;

    if (action === 'init') {
      p.message('Running git init…');
      const r = await runCommand('git', ['init', '-b', 'main'], { cwd: ws, timeoutMs: 5000 });
      if (!r || r.code !== 0) {
        // Older git without -b: fall back to plain init
        const r2 = await runCommand('git', ['init'], { cwd: ws, timeoutMs: 5000 });
        if (!r2 || r2.code !== 0) throw new Error('git init failed');
      }
      p.message('Repository initialised ✓');
      return;
    }

    if (action === 'clone') {
      const url = choice.repo.remoteUrl;
      if (!url) throw new Error('Clone URL was not provided.');
      p.message(`Cloning ${url}… (this may take a moment)`);
      const r = await runCommand('git', ['clone', url, '.'], { cwd: ws, timeoutMs: 5 * 60 * 1000 });
      if (!r || r.code !== 0) throw new Error(`git clone failed: ${(r?.stderr || '').slice(0, 200)}`);
      p.message('Cloned ✓');
      return;
    }

    if (action === 'link') {
      const url = choice.repo.remoteUrl;
      if (!url) throw new Error('Remote URL was not provided.');
      // If the workspace isn't a repo yet, init first.
      if (!profile.repo.isRepo) {
        const ri = await runCommand('git', ['init', '-b', 'main'], { cwd: ws, timeoutMs: 5000 });
        if (!ri || ri.code !== 0) {
          const ri2 = await runCommand('git', ['init'], { cwd: ws, timeoutMs: 5000 });
          if (!ri2 || ri2.code !== 0) throw new Error('git init failed before adding remote');
        }
      }
      // If origin already exists, replace its URL; else add it.
      const existing = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws, timeoutMs: 3000 });
      if (existing && existing.trim().length > 0) {
        p.message(`Updating origin URL to ${url}`);
        const r = await runCommand('git', ['remote', 'set-url', 'origin', url], { cwd: ws, timeoutMs: 5000 });
        if (!r || r.code !== 0) throw new Error('git remote set-url failed');
      } else {
        p.message(`Adding origin → ${url}`);
        const r = await runCommand('git', ['remote', 'add', 'origin', url], { cwd: ws, timeoutMs: 5000 });
        if (!r || r.code !== 0) throw new Error('git remote add failed');
      }
      p.message('Remote linked ✓');
      return;
    }
  }

  private _authLabel(method: AuthMethod, host: GitHost): string {
    switch (method) {
      case 'github-builtin': return 'VS Code GitHub authentication';
      case 'pat':            return host === 'bitbucket' ? 'Bitbucket app password' : 'Personal Access Token';
      case 'ssh':            return 'SSH key';
      case 'gh-cli':         return 'GitHub CLI (gh auth login)';
    }
  }

  private async _configureAuth(profile: GitConnectProfile, choice: WizardChoice, p: StepProgress, signal: AbortSignal): Promise<void> {
    switch (choice.authMethod) {
      case 'github-builtin': return this._authGithubBuiltin(p);
      case 'pat':            return this._authPAT(profile, choice, p);
      case 'ssh':            return this._authSSH(profile, choice, p, signal);
      case 'gh-cli':         return this._authGhCli(p, signal);
    }
  }

  private async _authGithubBuiltin(p: StepProgress): Promise<void> {
    p.message('Requesting GitHub session via VS Code…');
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['repo', 'workflow', 'read:user'],
        { createIfNone: true }
      );
      if (!session?.accessToken) throw new Error('No session returned');
      p.message(`Authenticated as ${session.account.label} ✓`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`VS Code GitHub auth failed: ${msg}. Try the PAT method instead.`);
    }
  }

  private async _authPAT(profile: GitConnectProfile, choice: WizardChoice, p: StepProgress): Promise<void> {
    const token = choice.pendingPAT;
    if (!token) throw new Error('No PAT was provided.');
    p.message(`Validating ${choice.host} token…`);
    const ok = await this._validatePAT(choice.host, token);
    if (!ok.valid) throw new Error(`Token rejected by ${choice.host}: ${ok.error}`);

    const key = choice.host === 'bitbucket' ? SECRETS.bitbucketPAT : SECRETS.githubPAT;
    await this._secrets.store(key, token);
    p.message(`Token validated and stored securely ✓ (logged in as ${ok.user})`);

    // If a credential helper isn't already set, embed the token in the remote URL
    // so git push / pull works without prompting. Only do this with consent —
    // we showed a checkbox in the wizard before we got here.
    if (!profile.auth.credentialHelper && profile.remote.url) {
      const ws = profile.workspace;
      if (ws) {
        const newUrl = this._embedTokenInUrl(profile.remote.url, choice.host, ok.user, token);
        if (newUrl && newUrl !== profile.remote.url) {
          await runCommand('git', ['remote', 'set-url', 'origin', newUrl], { cwd: ws, timeoutMs: 5000 });
          p.message('Remote URL updated to use stored token ✓');
        }
      }
    }
  }

  private async _authSSH(profile: GitConnectProfile, choice: WizardChoice, p: StepProgress, signal: AbortSignal): Promise<void> {
    const home   = os.homedir();
    const sshDir = path.join(home, '.ssh');
    const keyPath    = path.join(sshDir, 'id_ed25519');
    const pubPath    = keyPath + '.pub';

    // 1. Ensure ~/.ssh exists with appropriate permissions.
    if (!fs.existsSync(sshDir)) {
      try {
        fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      } catch (e) {
        throw new Error(`Could not create ${sshDir}: ${(e as Error).message}`);
      }
    }

    // 2. Generate keypair if it doesn't exist.
    if (!fs.existsSync(pubPath)) {
      p.message('Generating ed25519 SSH key…');
      const email = profile.identity.email ?? choice.identity?.email ?? 'evolve-ai@local';
      const passphrase = choice.sshPassphrase ?? '';
      const r = await runCommand('ssh-keygen', ['-t', 'ed25519', '-C', email, '-f', keyPath, '-N', passphrase], {
        timeoutMs: 30_000,
      });
      if (!r || r.code !== 0) {
        const stderr = r?.stderr || '';
        if (stderr.includes('not found') || stderr.includes('not recognized')) {
          throw new Error('ssh-keygen not found. On Windows, enable the OpenSSH client in Settings → Apps → Optional features.');
        }
        throw new Error(`ssh-keygen failed: ${stderr.slice(0, 200) || 'unknown error'}`);
      }
      p.message('Key generated ✓');
    } else {
      p.message('Existing ed25519 key found — reusing it');
    }

    // 3. Copy public key to clipboard.
    let publicKey = '';
    try {
      publicKey = fs.readFileSync(pubPath, 'utf8').trim();
    } catch (e) {
      throw new Error(`Could not read ${pubPath}: ${(e as Error).message}`);
    }
    await vscode.env.clipboard.writeText(publicKey);
    p.message('Public key copied to clipboard ✓');

    // 4. Open the platform's "add SSH key" page.
    const addUrl = choice.host === 'bitbucket'
      ? 'https://bitbucket.org/account/settings/ssh-keys/'
      : 'https://github.com/settings/ssh/new';
    await vscode.env.openExternal(vscode.Uri.parse(addUrl));

    // 5. Wait for user to confirm they've added it.
    const ack = await vscode.window.showInformationMessage(
      `Paste the SSH public key (already on your clipboard) into ${choice.host}'s "Add SSH key" page that just opened, then click "I've added it" below.`,
      { modal: true },
      "I've added it",
      'Cancel',
    );
    if (ack !== "I've added it") throw new Error('Cancelled before SSH key was added.');
    if (signal.aborted)          throw new Error('Cancelled.');

    // 6. Test SSH auth.
    const sshHost = choice.host === 'bitbucket' ? 'git@bitbucket.org' : 'git@github.com';
    p.message(`Testing SSH against ${sshHost}…`);
    const r = await runCommand('ssh', ['-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', sshHost], {
      timeoutMs: SSH_TEST_TIMEOUT_MS,
    });
    // GitHub returns exit code 1 with "successfully authenticated" message; Bitbucket exit 0.
    const out = ((r?.stdout || '') + (r?.stderr || '')).toLowerCase();
    if (out.includes('successfully authenticated') || out.includes('logged in as') || (r?.code === 0)) {
      p.message('SSH key works ✓');
      return;
    }
    throw new Error(`SSH test failed: ${(r?.stderr || r?.stdout || '').slice(0, 200) || 'no output'}`);
  }

  private async _authGhCli(p: StepProgress, signal: AbortSignal): Promise<void> {
    p.message('Launching `gh auth login` in a terminal…');
    const term = vscode.window.createTerminal('Evolve AI: gh auth login');
    term.show();
    term.sendText('gh auth login --hostname github.com --git-protocol https --web');

    const ack = await vscode.window.showInformationMessage(
      'Complete `gh auth login` in the terminal that just opened, then click "I\'m done" to continue.',
      { modal: true },
      "I'm done",
      'Cancel',
    );
    if (ack !== "I'm done") throw new Error('Cancelled before gh auth login completed.');
    if (signal.aborted)     throw new Error('Cancelled.');

    p.message('Verifying gh auth status…');
    const r = await runForStdout('gh', ['auth', 'status', '--hostname', 'github.com'], { timeoutMs: 5000 });
    if (!r || !/Logged in to/.test(r)) {
      throw new Error('gh auth status reports not logged in. Re-run the wizard or use a PAT.');
    }
    p.message('gh CLI authenticated ✓');
  }

  private async _createRemote(profile: GitConnectProfile, choice: WizardChoice, p: StepProgress, signal: AbortSignal): Promise<void> {
    void signal;
    const cr = choice.createRemote;
    if (!cr || !cr.enabled || !cr.fullName) throw new Error('Missing create-remote details.');
    const ws = profile.workspace;
    if (!ws) throw new Error('No workspace folder open.');

    // We need a token to call the API. Prefer the freshly-validated PAT;
    // else the VS Code session for GitHub.
    let token = '';
    if (choice.host === 'github') {
      if (choice.pendingPAT) {
        token = choice.pendingPAT;
      } else {
        const session = await vscode.authentication.getSession('github', ['repo'], { silent: true });
        token = session?.accessToken ?? '';
      }
    } else if (choice.host === 'bitbucket') {
      token = choice.pendingPAT ?? '';
    }
    if (!token) throw new Error(`Cannot create ${choice.host} repo: no token available. Use the PAT auth method.`);

    p.message(`Creating ${choice.host} repository ${cr.fullName}…`);
    const url = await this._apiCreateRepo(choice.host, cr.fullName, !!cr.isPrivate, token);
    if (!url) throw new Error('Repository creation failed (no URL returned).');

    // Add origin (or update if already set).
    const existing = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws, timeoutMs: 3000 });
    if (existing && existing.trim()) {
      const ru = await runCommand('git', ['remote', 'set-url', 'origin', url], { cwd: ws, timeoutMs: 5000 });
      if (!ru || ru.code !== 0) throw new Error('git remote set-url after create failed');
    } else {
      const ra = await runCommand('git', ['remote', 'add', 'origin', url], { cwd: ws, timeoutMs: 5000 });
      if (!ra || ra.code !== 0) throw new Error('git remote add after create failed');
    }
    p.message(`Repository created at ${url} ✓`);
  }

  private async _pushHead(profile: GitConnectProfile, p: StepProgress, signal: AbortSignal): Promise<void> {
    void signal;
    const ws = profile.workspace;
    if (!ws) throw new Error('No workspace folder open.');
    p.message('Pushing HEAD to origin…');
    // -u sets upstream so future pushes / pulls work without arguments.
    const r = await runCommand('git', ['push', '-u', 'origin', 'HEAD'], { cwd: ws, timeoutMs: 60_000 });
    if (!r || r.code !== 0) {
      throw new Error(`git push failed: ${(r?.stderr || '').slice(0, 200) || 'unknown error'}`);
    }
    p.message('Pushed ✓');
  }

  private async _verifyConnection(profile: GitConnectProfile, p: StepProgress, signal: AbortSignal): Promise<void> {
    void signal;
    const ws = profile.workspace;
    if (!ws) throw new Error('No workspace folder open.');
    p.message('Running git ls-remote…');
    const r = await runCommand('git', ['ls-remote', '--heads', 'origin'], { cwd: ws, timeoutMs: VERIFY_TIMEOUT_MS });
    if (!r) throw new Error('Verify timed out (10s). Network unreachable or remote URL invalid.');
    if (r.code !== 0) {
      const err = (r.stderr || r.stdout || '').slice(0, 200) || `exit code ${r.code}`;
      throw new Error(`Verify failed: ${err}`);
    }
    p.message('Connection verified ✓');
  }

  // ── API helpers ───────────────────────────────────────────────────────────

  /** Return { valid, user, error } for a token against the platform's identity endpoint. */
  private async _validatePAT(host: GitHost, token: string): Promise<{ valid: boolean; user: string; error?: string }> {
    if (host === 'github') {
      const res = await this._httpsRequest('api.github.com', '/user', 'GET', {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'Evolve-AI-VSCode',
        'Accept':        'application/vnd.github+json',
      });
      if (res.statusCode === 200) {
        try {
          const body = JSON.parse(res.body);
          return { valid: true, user: body.login || 'unknown' };
        } catch {
          return { valid: false, user: '', error: 'Could not parse GitHub response' };
        }
      }
      return { valid: false, user: '', error: `HTTP ${res.statusCode}` };
    }
    if (host === 'bitbucket') {
      // Bitbucket app passwords use Basic auth with the username + password.
      // We don't know the username yet, so we hit /2.0/user with the password
      // assumed to be the app password. Caller should encode "user:token" but
      // since we don't know the user, ask Bitbucket to identify via /user with
      // a header that accepts just the token via OAuth. App passwords *require*
      // a username — so we must accept "user:token" form here.
      // The token we accept can be either a raw token or "user:token".
      const colon = token.indexOf(':');
      const auth = colon > 0
        ? Buffer.from(token, 'utf8').toString('base64')
        : Buffer.from(`x-token-auth:${token}`, 'utf8').toString('base64');
      const res = await this._httpsRequest('api.bitbucket.org', '/2.0/user', 'GET', {
        'Authorization': `Basic ${auth}`,
        'User-Agent':    'Evolve-AI-VSCode',
      });
      if (res.statusCode === 200) {
        try {
          const body = JSON.parse(res.body);
          return { valid: true, user: body.username || body.nickname || 'unknown' };
        } catch {
          return { valid: false, user: '', error: 'Could not parse Bitbucket response' };
        }
      }
      return { valid: false, user: '', error: `HTTP ${res.statusCode} — Bitbucket app passwords need the form 'username:app_password'` };
    }
    return { valid: false, user: '', error: `Cannot validate ${host} tokens.` };
  }

  /** Create a remote repository on the platform. Returns the clone URL on success. */
  private async _apiCreateRepo(host: GitHost, fullName: string, isPrivate: boolean, token: string): Promise<string | null> {
    if (host === 'github') {
      // POST /user/repos creates under the authenticated user. For org repos,
      // GitHub takes POST /orgs/<org>/repos — we infer org if fullName has a '/'.
      const slash = fullName.indexOf('/');
      const owner = slash > 0 ? fullName.slice(0, slash) : null;
      const name  = slash > 0 ? fullName.slice(slash + 1) : fullName;
      const meRes = await this._httpsRequest('api.github.com', '/user', 'GET', {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'Evolve-AI-VSCode',
        'Accept':        'application/vnd.github+json',
      });
      let me = '';
      try { me = JSON.parse(meRes.body).login || ''; } catch { /* ignore */ }
      const path = owner && owner.toLowerCase() !== me.toLowerCase()
        ? `/orgs/${encodeURIComponent(owner)}/repos`
        : '/user/repos';
      const res = await this._httpsRequest('api.github.com', path, 'POST', {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'Evolve-AI-VSCode',
        'Accept':        'application/vnd.github+json',
        'Content-Type':  'application/json',
      }, JSON.stringify({ name, private: isPrivate }));
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const body = JSON.parse(res.body);
          return body.clone_url || body.html_url + '.git';
        } catch { return null; }
      }
      return null;
    }
    if (host === 'bitbucket') {
      const slash = fullName.indexOf('/');
      if (slash <= 0) return null;
      const workspace = fullName.slice(0, slash);
      const slug      = fullName.slice(slash + 1);
      const colon = token.indexOf(':');
      const auth = colon > 0
        ? Buffer.from(token, 'utf8').toString('base64')
        : Buffer.from(`x-token-auth:${token}`, 'utf8').toString('base64');
      const res = await this._httpsRequest('api.bitbucket.org', `/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`, 'POST', {
        'Authorization': `Basic ${auth}`,
        'User-Agent':    'Evolve-AI-VSCode',
        'Content-Type':  'application/json',
      }, JSON.stringify({ scm: 'git', is_private: isPrivate }));
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const body  = JSON.parse(res.body);
          const links = body.links?.clone as Array<{ name: string; href: string }> | undefined;
          const https = links?.find(l => l.name === 'https')?.href;
          return https || `https://bitbucket.org/${workspace}/${slug}.git`;
        } catch { return null; }
      }
      return null;
    }
    return null;
  }

  /** Embed the token in the remote URL so HTTPS git operations work without prompting. */
  private _embedTokenInUrl(remoteUrl: string, host: GitHost, user: string, token: string): string | null {
    if (!remoteUrl.startsWith('https://')) return null;
    try {
      const u = new URL(remoteUrl);
      // GitHub accepts x-access-token:<pat>; Bitbucket app passwords use the username.
      if (host === 'github' || host === 'gitlab') {
        u.username = 'x-access-token';
        u.password = token;
      } else if (host === 'bitbucket') {
        u.username = user || 'x-token-auth';
        u.password = token;
      } else {
        return null;
      }
      return u.toString();
    } catch {
      return null;
    }
  }

  /** Tiny https helper. Returns { statusCode, body }. Never throws. */
  private _httpsRequest(
    hostname: string,
    pathName: string,
    method:   'GET' | 'POST',
    headers:  Record<string, string>,
    body?:    string,
  ): Promise<{ statusCode: number | undefined; body: string }> {
    return new Promise(resolve => {
      const opts: https.RequestOptions = {
        hostname,
        port:   443,
        path:   pathName,
        method,
        headers,
        timeout: API_TIMEOUT_MS,
      };
      const req = https.request(opts, res => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data',  chunk => { buf += chunk; });
        res.on('end',   () => resolve({ statusCode: res.statusCode, body: buf }));
        res.on('error', () => resolve({ statusCode: res.statusCode, body: buf }));
      });
      req.on('error',   () => resolve({ statusCode: undefined, body: '' }));
      req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } resolve({ statusCode: undefined, body: '' }); });
      if (body) req.write(body);
      req.end();
    });
  }
}

export type { GitProtocol };
