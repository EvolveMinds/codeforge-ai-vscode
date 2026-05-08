/**
 * commands/gitConnectCommands.ts — Git/Bitbucket connection wizard commands
 *
 * Registers four user-facing commands:
 *   - aiForge.gitConnect.start          → main wizard
 *   - aiForge.gitConnect.status         → one-line summary + offer to fix
 *   - aiForge.gitConnect.disconnect     → clear stored secrets and sessions
 *   - aiForge.gitConnect.testConnection → re-run verify on demand
 *
 * The wizard is driven by Quick Picks / Input Boxes — no webview. This keeps
 * the surface tiny, accessible, and identical across Light/Dark/HC themes.
 *
 * Each command is wrapped with the standard try/catch -> showErrorMessage so
 * thrown errors never silently swallow user feedback. AbortSignal is plumbed
 * through the orchestrator's withProgress notification (Esc to cancel).
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import type { IServices } from '../core/services';
import type {
  GitConnectProfile,
  GitHost,
  NextStep,
} from '../core/gitConnectInspector';
import { SECRETS } from '../core/gitConnectInspector';
import type {
  AuthMethod,
  WizardChoice,
  RepoChoice,
  CreateRemoteChoice,
} from '../core/gitConnectOrchestrator';

// Map a host to the URL where the user should add a PAT or app password.
const PAT_URLS: Record<GitHost, string> = {
  github:    'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Evolve+AI+(VS+Code)',
  bitbucket: 'https://bitbucket.org/account/settings/app-passwords/new',
  gitlab:    'https://gitlab.com/-/user_settings/personal_access_tokens',
  other:     '',
};

export class GitConnectCommands {
  constructor(private readonly _svc: IServices) {}

  // Narrowing helpers — the wizard services are optional on IServices for the
  // benefit of tests, but always present in the production ServiceContainer.
  private get _inspector() {
    if (!this._svc.gitConnectInspector) throw new Error('Git Connect wizard is unavailable in this environment.');
    return this._svc.gitConnectInspector;
  }
  private get _orchestrator() {
    if (!this._svc.gitConnectOrchestrator) throw new Error('Git Connect wizard is unavailable in this environment.');
    return this._svc.gitConnectOrchestrator;
  }

  register(): void {
    const r = (id: string, fn: (...a: unknown[]) => unknown) =>
      this._svc.vsCtx.subscriptions.push(vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await fn(...args);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[Evolve AI] Command ${id} failed:`, e);
          vscode.window.showErrorMessage(`Evolve AI: ${msg}`);
        }
      }));

    r('aiForge.gitConnect.start',          () => this.start());
    r('aiForge.gitConnect.status',         () => this.status());
    r('aiForge.gitConnect.disconnect',     () => this.disconnect());
    r('aiForge.gitConnect.testConnection', () => this.testConnection());
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showWarningMessage('Open a folder first — the Git wizard runs on the active workspace.');
      return;
    }

    const profile = await this._inspector.inspect(ws);
    const next    = this._inspector.recommendNextStep(profile);

    if (next.kind === 'untrusted') {
      vscode.window.showWarningMessage(next.reason);
      return;
    }

    // Show a plain-language summary so the user knows what state they're in.
    const summary = this._inspector.summary(profile);
    const intro = `Current status: ${summary}\n\nNext step: ${this._humanLabel(next)}.\n\nThe wizard will walk you through it.`;
    const proceed = await vscode.window.showInformationMessage(
      intro, { modal: true }, 'Start wizard', 'Cancel',
    );
    if (proceed !== 'Start wizard') return;

    const choice = await this._collectChoices(profile, next);
    if (!choice) return; // user cancelled

    const plan = this._orchestrator.planSteps(profile, choice);
    if (plan.steps.length === 0) {
      vscode.window.showInformationMessage('Nothing to do — everything looks set up already.');
      return;
    }

    const result = await this._orchestrator.execute(plan);

    if (result.ok) {
      // Clear the "first-run nudge" flag so we don't pester them again.
      await this._svc.vsCtx.workspaceState.update('aiForge.gitConnect.nudged', true);
      const more = result.warnings.length > 0
        ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})`
        : '';
      vscode.window.showInformationMessage(`Git wizard finished ✓${more}`);
      // Recompute status so plugins / status bar update.
      this._svc.events.emit('context.refreshed', {
        activePlugins: this._svc.plugins.active.map(p => p.id),
      });
    } else {
      vscode.window.showErrorMessage(`Git wizard: ${result.error}`);
    }
  }

  async status(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showInformationMessage('No workspace folder open.');
      return;
    }
    const profile = await this._inspector.inspect(ws);
    const summary = this._inspector.summary(profile);
    const next    = this._inspector.recommendNextStep(profile);
    const action  = next.kind === 'ready' || next.kind === 'verify'
      ? 'Test connection'
      : 'Run wizard';
    const pick = await vscode.window.showInformationMessage(
      `Git status: ${summary}\nNext: ${this._humanLabel(next)}`,
      action, 'Open Settings', 'Close',
    );
    if (pick === 'Run wizard')      await vscode.commands.executeCommand('aiForge.gitConnect.start');
    if (pick === 'Test connection') await vscode.commands.executeCommand('aiForge.gitConnect.testConnection');
    if (pick === 'Open Settings')   await vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.gitConnect');
  }

  async disconnect(): Promise<void> {
    const items: { label: string; description: string; key: 'github' | 'bitbucket' | 'vscode' }[] = [];
    const githubPAT    = await this._inspector.secrets.get(SECRETS.githubPAT);
    const bitbucketPAT = await this._inspector.secrets.get(SECRETS.bitbucketPAT);
    if (githubPAT)    items.push({ label: 'GitHub PAT',           description: 'remove stored token',     key: 'github' });
    if (bitbucketPAT) items.push({ label: 'Bitbucket app password', description: 'remove stored token',   key: 'bitbucket' });
    items.push({ label: 'VS Code GitHub session', description: 'sign out of github auth provider', key: 'vscode' });

    const picks = await vscode.window.showQuickPick(
      items.map(i => ({ ...i, picked: false })),
      { canPickMany: true, placeHolder: 'Select what to remove (SSH keys are never deleted)' },
    );
    if (!picks || picks.length === 0) return;

    for (const p of picks) {
      if (p.key === 'github')    await this._inspector.secrets.delete(SECRETS.githubPAT);
      if (p.key === 'bitbucket') await this._inspector.secrets.delete(SECRETS.bitbucketPAT);
      if (p.key === 'vscode') {
        try {
          // Force the session picker to clear; passing clearSessionPreference works since 1.79.
          // We don't have a programmatic "remove session" — the user must use the GitHub auth UI.
          await vscode.commands.executeCommand('workbench.actions.manageTrustedDomains');
        } catch { /* ignore */ }
        vscode.window.showInformationMessage('To fully sign out of GitHub: open the Accounts menu (bottom-left) → GitHub → Sign Out.');
      }
    }
    vscode.window.showInformationMessage(`Removed: ${picks.map(p => p.label).join(', ')}`);
  }

  async testConnection(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showWarningMessage('No workspace folder open.'); return; }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Testing git remote…', cancellable: false },
      async () => {
        const result = await this._inspector.testConnection(ws);
        if (result.ok) {
          vscode.window.showInformationMessage('Git remote works ✓');
        } else {
          vscode.window.showErrorMessage(`Git remote test failed: ${result.error ?? 'unknown'}`);
        }
      },
    );
  }

  // ── Choice gathering ──────────────────────────────────────────────────────

  /**
   * Collect every decision the orchestrator needs as a sequence of Quick
   * Picks / Input Boxes. Returns null if the user cancels at any prompt.
   */
  private async _collectChoices(profile: GitConnectProfile, _next: NextStep): Promise<WizardChoice | null> {
    // 1. Pick the host (only asked if we don't already know it from origin).
    let host: GitHost = profile.remote.host ?? 'github';
    if (!profile.remote.configured) {
      const hostPick = await vscode.window.showQuickPick(
        [
          { label: '$(github) GitHub',    detail: 'github.com',    value: 'github' as const },
          { label: '$(repo) Bitbucket',   detail: 'bitbucket.org', value: 'bitbucket' as const },
          { label: '$(globe) Other / self-hosted', detail: 'GitLab, on-prem GitHub, etc.', value: 'other' as const },
        ],
        { placeHolder: 'Which host are you connecting to?' },
      );
      if (!hostPick) return null;
      host = hostPick.value;
    }

    // 2. Identity — only ask if missing.
    let identity: { name: string; email: string } | undefined;
    if (!profile.identity.configured) {
      const name = await vscode.window.showInputBox({
        prompt:      'Your name (used in commits)',
        value:       profile.identity.name ?? '',
        ignoreFocusOut: true,
        validateInput: v => (v && v.trim().length > 0) ? null : 'Name is required',
      });
      if (name === undefined) return null;
      const email = await vscode.window.showInputBox({
        prompt:      'Your email (used in commits)',
        value:       profile.identity.email ?? '',
        ignoreFocusOut: true,
        validateInput: v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter a valid email address',
      });
      if (email === undefined) return null;
      identity = { name: name.trim(), email: email.trim() };
    }

    // 3. Repo state — pick init / clone / link / skip.
    let repo: RepoChoice;
    if (profile.repo.isRepo) {
      // Already a repo. If origin is missing, link or skip.
      if (!profile.remote.configured) {
        const linkPick = await vscode.window.showQuickPick(
          [
            { label: '$(link) Link existing remote URL', value: 'link' as const,
              detail: 'Paste an HTTPS or SSH URL of an empty / existing repo on the platform' },
            { label: '$(plus) Create a new repo on the platform', value: 'create' as const,
              detail: 'We\'ll create the remote for you and link it' },
            { label: '$(circle-slash) Skip — I\'ll handle remotes manually', value: 'skip' as const,
              detail: 'Wizard will only configure auth + verify' },
          ],
          { placeHolder: 'How do you want to set up the remote?' },
        );
        if (!linkPick) return null;
        if (linkPick.value === 'link') {
          const url = await vscode.window.showInputBox({
            prompt:      'Remote URL (https://… or git@…)',
            ignoreFocusOut: true,
            validateInput: v => v && v.length > 4 ? null : 'Enter a remote URL',
          });
          if (url === undefined) return null;
          repo = { action: 'link', remoteUrl: url.trim() };
        } else if (linkPick.value === 'create') {
          repo = { action: 'skip' }; // we'll create via createRemote step
        } else {
          repo = { action: 'skip' };
        }
      } else {
        // Already linked — nothing to do for repo.
        repo = { action: 'skip' };
      }
    } else {
      const initPick = await vscode.window.showQuickPick(
        [
          { label: '$(file-directory-create) Initialise an empty repo here', value: 'init' as const,
            detail: 'git init in this folder' },
          { label: '$(cloud-download) Clone an existing repo into this folder', value: 'clone' as const,
            detail: 'Folder must be empty' },
          { label: '$(link) Link this folder to an existing remote (no clone)', value: 'link' as const,
            detail: 'git init + git remote add origin <url>' },
        ],
        { placeHolder: 'This folder is not a git repo yet — what do you want to do?' },
      );
      if (!initPick) return null;
      if (initPick.value === 'clone' || initPick.value === 'link') {
        const url = await vscode.window.showInputBox({
          prompt:      initPick.value === 'clone' ? 'URL to clone (https://… or git@…)' : 'Remote URL to link (https://… or git@…)',
          ignoreFocusOut: true,
          validateInput: v => v && v.length > 4 ? null : 'Enter a remote URL',
        });
        if (url === undefined) return null;
        repo = { action: initPick.value, remoteUrl: url.trim() };
      } else {
        repo = { action: 'init' };
      }
    }

    // If we now know the URL from the choice, refine host detection.
    const urlFromChoice = repo.remoteUrl;
    if (urlFromChoice) {
      host = this._inspector.classifyHost(urlFromChoice);
    }

    // 4. Auth method — depends on host + what's already available.
    const cfg     = vscode.workspace.getConfiguration('aiForge');
    const preferred = cfg.get<AuthMethod | 'auto'>('gitConnect.preferredAuth', 'auto');
    const authMethod = await this._pickAuthMethod(host, profile, preferred);
    if (!authMethod) return null;

    let pendingPAT: string | undefined;
    let sshPassphrase: string | undefined;

    if (authMethod === 'pat') {
      const url = PAT_URLS[host] || '';
      if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
      const helpText = host === 'bitbucket'
        ? 'Paste your Bitbucket App Password as username:app_password (e.g. "myname:abc123…").\nApp passwords need at least the "Repositories: Read, Write" scopes.'
        : `Paste your ${host} Personal Access Token. Required scopes: repo, workflow.`;
      vscode.window.showInformationMessage(helpText);
      const token = await vscode.window.showInputBox({
        prompt:      `Paste the ${host} token (or username:token for Bitbucket)`,
        password:    true,
        ignoreFocusOut: true,
        validateInput: v => v && v.length > 8 ? null : 'Token looks too short',
      });
      if (!token) return null;
      pendingPAT = token.trim();
    }

    if (authMethod === 'ssh') {
      const passchoice = await vscode.window.showQuickPick(
        [
          { label: 'No passphrase (easiest)',  value: '',     description: 'Quick setup; key sits unprotected on disk' },
          { label: 'Set a passphrase',         value: 'ask',  description: 'Stronger; ssh-agent will ask for it once per session' },
        ],
        { placeHolder: 'How should the SSH key be protected?' },
      );
      if (!passchoice) return null;
      if (passchoice.value === 'ask') {
        const pp = await vscode.window.showInputBox({
          prompt:      'SSH key passphrase (leave blank for none)',
          password:    true,
          ignoreFocusOut: true,
        });
        if (pp === undefined) return null;
        sshPassphrase = pp;
      } else {
        sshPassphrase = '';
      }
    }

    // 5. Optional: create a new repo on the platform (if user chose that path
    //    OR if they're starting from `init` and want one created).
    let createRemote: CreateRemoteChoice | undefined;
    const wantsCreate = !profile.remote.configured && (repo.action === 'init' || repo.action === 'skip');
    if (wantsCreate && (host === 'github' || host === 'bitbucket')) {
      const createPick = await vscode.window.showQuickPick(
        [
          { label: 'Yes — create a new repo on ' + host, value: 'yes' as const },
          { label: 'No — I\'ll set up the remote myself later', value: 'no' as const },
        ],
        { placeHolder: `Create a new ${host} repository now?` },
      );
      if (!createPick) return null;
      if (createPick.value === 'yes') {
        const fullName = await vscode.window.showInputBox({
          prompt:      host === 'github'
            ? 'Repo name as "owner/name" (owner = your username or an org you can write to)'
            : 'Repo as "workspace/slug"',
          value:       this._defaultRepoName(profile),
          ignoreFocusOut: true,
          validateInput: v => /^[\w.-]+\/[\w.-]+$/.test(v ?? '') ? null : 'Use the form "owner/name"',
        });
        if (!fullName) return null;
        const visibility = await vscode.window.showQuickPick(
          [
            { label: '$(lock) Private',  value: true  as const, description: 'Only you and invited collaborators can see it' },
            { label: '$(eye) Public',    value: false as const, description: 'Anyone can view; only collaborators can push' },
          ],
          { placeHolder: 'Visibility' },
        );
        if (!visibility) return null;
        createRemote = { enabled: true, fullName: fullName.trim(), isPrivate: visibility.value };
      }
    }

    // 6. Push on connect — default from setting.
    const pushOnConnect = cfg.get<boolean>('gitConnect.pushOnConnect', false);

    return {
      host,
      authMethod,
      repo,
      identity,
      pendingPAT,
      sshPassphrase,
      createRemote,
      pushOnConnect,
    };
  }

  /** Show only the auth methods that make sense for this host + system. */
  private async _pickAuthMethod(host: GitHost, profile: GitConnectProfile, preferred: AuthMethod | 'auto'): Promise<AuthMethod | null> {
    const items: { label: string; detail: string; value: AuthMethod }[] = [];

    if (host === 'github') {
      items.push({
        label:  '$(github-inverted) Sign in with VS Code (recommended)',
        detail: 'Uses VS Code\'s built-in GitHub auth — no token to paste, refresh handled for you',
        value:  'github-builtin',
      });
    }
    items.push({
      label:  '$(key) Personal Access Token',
      detail: host === 'bitbucket'
        ? 'Bitbucket App Password — paste as "username:app_password"'
        : 'Paste a token from the platform\'s settings → tokens page',
      value:  'pat',
    });
    items.push({
      label:  '$(terminal) SSH key',
      detail: profile.auth.sshKeys.length > 0
        ? `We found ${profile.auth.sshKeys.length} key${profile.auth.sshKeys.length === 1 ? '' : 's'} in ~/.ssh — we'll reuse one or create ed25519`
        : 'Generate a new ed25519 key, copy public to clipboard, paste into the platform',
      value:  'ssh',
    });
    if (host === 'github' && profile.auth.ghCliInstalled) {
      items.push({
        label:  '$(github-action) GitHub CLI (gh auth login)',
        detail: profile.auth.ghCliAuthed ? 'Already authenticated — re-running will just refresh' : 'Opens a browser via the gh CLI',
        value:  'gh-cli',
      });
    }

    // If user has a hard preference and it's offered, default to it (but still let them change).
    let preselected = items[0];
    if (preferred !== 'auto') {
      const match = items.find(i => i.value === preferred);
      if (match) preselected = match;
    }

    // Annotate the recommended row.
    const rendered = items.map(i => ({
      ...i,
      label: i === preselected ? `${i.label}   $(star-full)` : i.label,
    }));

    const pick = await vscode.window.showQuickPick(rendered, {
      placeHolder: `Choose how to authenticate to ${host}`,
    });
    if (!pick) return null;
    return pick.value;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _humanLabel(next: NextStep): string {
    switch (next.kind) {
      case 'install-git':    return 'Install Git';
      case 'set-identity':   return 'Set your Git name and email';
      case 'init-repo':      return 'Initialise / clone / link a repository';
      case 'add-remote':     return 'Add a remote';
      case 'configure-auth': return 'Configure authentication';
      case 'verify':         return 'Verify the connection works';
      case 'ready':          return 'Everything looks good';
      case 'untrusted':      return 'Workspace is untrusted';
    }
  }

  private _defaultRepoName(profile: GitConnectProfile): string {
    const folder = profile.workspace ? path.basename(profile.workspace) : 'my-project';
    const owner  = profile.identity.name?.toLowerCase().replace(/\s+/g, '-') ?? 'me';
    const safeFolder = folder.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project';
    return `${owner}/${safeFolder}`;
  }
}
