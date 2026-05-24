/**
 * commands/cicdSetupCommands.ts — First-time CI/CD setup wizard commands
 *
 * Mirrors gitConnectCommands.ts. Drives the user through a series of QuickPicks
 * to choose platform / template / deploy-target, then asks the AI to generate a
 * starter pipeline tailored to their stack.
 *
 * Commands registered:
 *   - aiForge.cicd.setup.start  → main wizard
 *   - aiForge.cicd.setup.status → one-line summary of detected stack + existing CI
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import type { IServices } from '../core/services';
import {
  CICDStackInspector,
  CICDSetupOrchestrator,
  StackProfile,
  CICDChoice,
  CIPlatform,
  TemplateChoice,
  DeployTarget,
} from '../core/cicdSetupOrchestrator';
import type { AIRequest } from '../core/aiService';
import { runCommand, runForStdout } from '../core/processUtil';
import {
  pushBranch,
  getDefaultBranch,
  getCurrentBranch,
  getOriginUrl,
  parseOwnerRepo,
} from '../core/gitPushUtil';
import { createPR, compareUrl, PRHost } from '../core/prCreator';
import { installHook, uninstallHook, detectHookState } from '../core/hookInstaller';
import { spawn } from 'child_process';

// [v2.1.0] Workspace-state key recording the path of the most recent file the
// wizard wrote, so `Stage & Commit CI/CD Setup` knows exactly which file to
// stage. We store one path (last write wins) — the wizard only ever writes one
// file per run, so this is sufficient.
const WROTE_KEY = 'aiForge.cicd.lastWrittenPath';
// Branches the wizard refuses to commit to without first creating a feature branch.
const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'production', 'release']);

const PLATFORM_LABELS: Record<CIPlatform, { label: string; detail: string }> = {
  'github-actions':       { label: '$(github-action) GitHub Actions',      detail: '.github/workflows/ci.yml — works on github.com and GHES' },
  'gitlab-ci':            { label: '$(repo) GitLab CI/CD',                  detail: '.gitlab-ci.yml — works on gitlab.com and self-hosted' },
  'jenkins':              { label: '$(server-process) Jenkins',             detail: 'Jenkinsfile (declarative) — works on Jenkins 2.x+' },
  'circleci':             { label: '$(circle-large-filled) CircleCI',       detail: '.circleci/config.yml — works on cloud and on-prem CircleCI' },
  'azure-pipelines':      { label: '$(azure) Azure Pipelines',              detail: 'azure-pipelines.yml — Azure DevOps' },
  'bitbucket-pipelines':  { label: '$(repo) Bitbucket Pipelines',           detail: 'bitbucket-pipelines.yml — Bitbucket Cloud' },
};

export class CICDSetupCommands {
  private readonly _inspector    = new CICDStackInspector();
  private readonly _orchestrator = new CICDSetupOrchestrator();

  constructor(private readonly _svc: IServices) {}

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

    r('aiForge.cicd.setup.start',          () => this.start());
    r('aiForge.cicd.setup.status',         () => this.status());
    r('aiForge.cicd.setup.stageAndCommit', () => this.stageAndCommit());
    // v2.4.0 — pre-push hook commands
    r('aiForge.cicd.installHook',          () => this.installPrePushHook());
    r('aiForge.cicd.uninstallHook',        () => this.uninstallPrePushHook());
    r('aiForge.cicd.checkPipelinesNow',    () => this.checkPipelinesNow());
  }

  // ── Main wizard ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showWarningMessage('Open a folder first — the CI/CD wizard runs on the active workspace.'); return; }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('CI/CD setup wizard refuses to run in untrusted workspaces. Trust the workspace and try again.');
      return;
    }

    // First pass: discover subprojects (always at workspace root).
    let profile = await this._inspector.inspect(ws);
    let summary = this._inspector.summary(profile);

    const intro = `Detected stack: ${summary}\n\nThe wizard will:\n1. Ask which CI/CD platform to use\n2. Ask what kind of pipeline (test-only / + deploy)\n3. Use AI to generate a starter file tailored to your stack\n4. Write it to your repo (you review + commit)\n\nTokens are not requested. The wizard never modifies live infrastructure.`;
    const proceed = await vscode.window.showInformationMessage(intro, { modal: true }, 'Start wizard', 'Cancel');
    if (proceed !== 'Start wizard') return;

    // v2.3.0 — monorepo support: if multiple subprojects detected, ask which
    // one the pipeline targets, then re-inspect scoped to that path.
    let subprojectRel = '';
    let subprojectSlug = '';
    if (profile.subprojects.length > 1) {
      const picked = await this._pickSubproject(profile);
      if (picked === undefined) return;   // user cancelled
      subprojectRel = picked;
      subprojectSlug = this._inspector.slugifySubproject(picked);
      // Re-inspect scoped to the chosen subproject so language / pkgMgr /
      // testFramework reflect that subproject's files, not the root.
      profile = await this._inspector.inspect(ws, subprojectRel);
      summary = this._inspector.summary(profile);
    }

    const choice = await this._collectChoices(profile, subprojectRel, subprojectSlug);
    if (!choice) return;

    const plan = this._orchestrator.planSteps(profile, choice);

    // Generate via AI, with progress.
    const generated = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'CI/CD wizard: generating pipeline…', cancellable: true },
      async (_progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const prompt = this._orchestrator.buildPrompt(plan);
        const req: AIRequest = {
          messages: [{ role: 'user', content: prompt }],
          system:  `You are a CI/CD expert producing a complete pipeline file. Output exactly one fenced block with the file content. Use the project's stack signals to make sensible choices. Do not add features beyond the requested template.`,
          instruction: 'Generate CI/CD starter pipeline',
          mode: 'new',
          signal: abort.signal,
        };
        try {
          return await this._svc.ai.send(req);
        } catch (e) {
          throw new Error(`AI generation failed: ${(e as Error).message}`);
        }
      },
    );
    if (!generated) return;

    // Strip the leading "## path/to/file" header and the fenced block delimiters.
    const fileContent = this._extractContent(generated);
    if (!fileContent) {
      vscode.window.showErrorMessage('CI/CD wizard: AI did not produce a pipeline file. Try again or pick a simpler template.');
      return;
    }

    const result = await this._orchestrator.execute(plan, fileContent);
    if (!result.ok) {
      vscode.window.showErrorMessage(`CI/CD wizard: ${result.error}`);
      return;
    }

    // Record the relative path so `Stage & Commit` can stage exactly this file later.
    await this._svc.vsCtx.workspaceState.update(WROTE_KEY, plan.outputPath);

    // Open the new file for review.
    if (result.filePath) {
      const doc = await vscode.workspace.openTextDocument(result.filePath);
      await vscode.window.showTextDocument(doc, { preview: false });
    }

    const followup = await vscode.window.showInformationMessage(
      `CI/CD pipeline written to ${plan.outputPath}. Review it before committing.`,
      'Stage & Commit',
      'Review checklist',
    );
    if (followup === 'Stage & Commit') {
      await this.stageAndCommit();
    } else if (followup === 'Review checklist') {
      vscode.window.showInformationMessage(
        [
          '1. Replace any `# pin-me` placeholders with real action SHAs.',
          '2. Configure required secrets in your CI provider.',
          '3. Branch-protect main (require this workflow to pass).',
          '4. Run a test PR to verify everything works.',
        ].join('\n'),
        { modal: true },
        'OK',
      );
    }
  }

  async status(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showInformationMessage('No workspace folder open.'); return; }
    const profile = await this._inspector.inspect(ws);
    const summary = this._inspector.summary(profile);
    const action = profile.existing.length > 0 ? 'Run wizard anyway' : 'Run wizard';
    const pick = await vscode.window.showInformationMessage(
      `CI/CD: ${summary}`,
      action, 'Open Settings', 'Close',
    );
    if (pick === action)              await vscode.commands.executeCommand('aiForge.cicd.setup.start');
    if (pick === 'Open Settings')     await vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.cicd');
  }

  /**
   * Stage the wizard-written pipeline file and offer an AI-drafted commit
   * message. Level C of the loop-completion design (see docs/CICD.md):
   *   - Stages exactly the file the wizard wrote (no `git add -A`).
   *   - On a protected branch (`main`, `master`, `develop`, etc.) FORCES a
   *     feature-branch dialog; refuses to stage on the protected branch.
   *   - AI drafts a Conventional Commits message based on the pipeline's
   *     diff; user reviews in an InputBox before commit.
   *   - Does NOT push and does NOT open a PR. Those land in v2.2 once the
   *     UX has been verified in the wild.
   */
  async stageAndCommit(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws)                              { vscode.window.showWarningMessage('Open a folder first.'); return; }
    if (!vscode.workspace.isTrusted)      { vscode.window.showWarningMessage('Stage & Commit refuses to run in untrusted workspaces.'); return; }

    const writtenPath = this._svc.vsCtx.workspaceState.get<string>(WROTE_KEY);
    if (!writtenPath) {
      vscode.window.showInformationMessage('No CI/CD wizard output to stage. Run the wizard first.', 'Run wizard')
        .then(p => { if (p === 'Run wizard') vscode.commands.executeCommand('aiForge.cicd.setup.start'); });
      return;
    }

    // Sanity: confirm the file actually exists on disk.
    const fullPath = path.isAbsolute(writtenPath) ? writtenPath : path.join(ws, writtenPath);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
    } catch {
      vscode.window.showWarningMessage(`The wizard's output file ${writtenPath} no longer exists. Re-run the wizard.`);
      return;
    }

    // Verify git is installed and we're inside a repo.
    const inside = await runForStdout('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ws, timeoutMs: 3000 });
    if (!inside || inside.trim() !== 'true') {
      vscode.window.showWarningMessage('Not inside a git repository. Run the Git Connect Wizard first.');
      return;
    }

    // Branch protection.
    const branchOut = await runForStdout('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ws, timeoutMs: 3000 });
    const branch = branchOut?.trim() || 'unknown';
    if (PROTECTED_BRANCHES.has(branch)) {
      const suggested = `feat/setup-cicd`;
      const ans = await vscode.window.showWarningMessage(
        `You're on protected branch \`${branch}\`. Stage & Commit refuses to commit straight to it. Create a feature branch \`${suggested}\` and switch to it?`,
        { modal: true },
        'Create branch',
        'Cancel',
      );
      if (ans !== 'Create branch') return;
      const r = await runCommand('git', ['checkout', '-b', suggested], { cwd: ws, timeoutMs: 5000 });
      if (!r || r.code !== 0) {
        vscode.window.showErrorMessage(`Could not create branch ${suggested}: ${(r?.stderr || '').slice(0, 200) || 'unknown error'}`);
        return;
      }
      vscode.window.showInformationMessage(`Switched to branch \`${suggested}\`.`);
    }

    // Stage exactly the wizard's output.
    const relPath = path.relative(ws, fullPath).replace(/\\/g, '/');
    const addResult = await runCommand('git', ['add', '--', relPath], { cwd: ws, timeoutMs: 5000 });
    if (!addResult || addResult.code !== 0) {
      vscode.window.showErrorMessage(`git add failed: ${(addResult?.stderr || '').slice(0, 200) || 'unknown error'}`);
      return;
    }

    // Get the staged diff for the AI to draft a commit message from.
    const diff = await runForStdout('git', ['diff', '--cached', '--', relPath], { cwd: ws, timeoutMs: 5000 });
    if (!diff || diff.trim().length === 0) {
      vscode.window.showInformationMessage('No staged changes to commit (file matches HEAD).');
      return;
    }

    // AI-draft the commit message. Falls back to a sensible default if the AI fails.
    const draftMessage = await this._draftCommitMessage(relPath, diff);

    // Editable InputBox so the user can tweak before committing.
    const finalMessage = await vscode.window.showInputBox({
      prompt: `Commit message for \`${relPath}\` (Conventional Commits format)`,
      value: draftMessage,
      ignoreFocusOut: true,
      validateInput: v => (v && v.trim().length > 4) ? null : 'Commit message is required.',
    });
    if (!finalMessage) {
      // User cancelled — UNSTAGE so we don't leave them with a half-finished state.
      await runCommand('git', ['reset', 'HEAD', '--', relPath], { cwd: ws, timeoutMs: 5000 });
      vscode.window.showInformationMessage(`Cancelled. Unstaged \`${relPath}\`.`);
      return;
    }

    // Commit.
    const commitResult = await runCommand('git', ['commit', '-m', finalMessage.trim()], { cwd: ws, timeoutMs: 10_000 });
    if (!commitResult || commitResult.code !== 0) {
      const err = (commitResult?.stderr || commitResult?.stdout || '').slice(0, 300) || 'unknown error';
      vscode.window.showErrorMessage(`git commit failed: ${err}`);
      return;
    }

    // Clear the wizard-written path now that it's committed; future
    // `Stage & Commit` invocations should not reuse this state.
    await this._svc.vsCtx.workspaceState.update(WROTE_KEY, undefined);

    // Resolve the branch name we actually committed on. `branch` was captured
    // before any feature-branch checkout, so re-read it now.
    const committedOn = (await getCurrentBranch(ws)) || branch;

    // v2.2.0 — Level E: continue to push + PR.
    const cfg = vscode.workspace.getConfiguration('aiForge.cicd');
    const offerPushPR = cfg.get<boolean>('openPRAfterCommit', true);

    if (!offerPushPR) {
      vscode.window.showInformationMessage(
        `Committed \`${relPath}\` to \`${committedOn}\`. (Auto-push + PR disabled in settings.)`,
      );
      return;
    }

    await this._pushAndOpenPR(ws, committedOn, relPath, finalMessage.trim());
  }

  /**
   * v2.2.0 — push the just-committed branch and, on success, offer to open a PR.
   * Called only from stageAndCommit() after a successful commit. Stays graceful
   * on every failure mode: push errors show a single toast with a recovery hint;
   * PR API failures fall back to the browser compare URL.
   */
  private async _pushAndOpenPR(ws: string, branch: string, relPath: string, commitSubject: string): Promise<void> {
    // 1. Confirm with the user before pushing — Stage & Commit was Level C, so
    //    users may still expect to push manually.
    const pushAns = await vscode.window.showInformationMessage(
      `Committed \`${relPath}\` to \`${branch}\`. Push to origin and open a pull request?`,
      'Push & open PR',
      'Push only',
      'Skip',
    );
    if (pushAns === 'Skip' || !pushAns) return;

    // 2. Push, with progress.
    const push = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Pushing \`${branch}\` to origin…`, cancellable: false },
      () => pushBranch(ws, branch),
    );

    if (!push.ok) {
      this._showPushFailure(push.message, push.reason);
      return;
    }

    const upstreamNote = push.setUpstream ? ' (set upstream)' : '';
    if (pushAns === 'Push only') {
      vscode.window.showInformationMessage(`Pushed \`${branch}\` to origin${upstreamNote}.`);
      return;
    }

    // 3. Open PR — detect host, look up owner/repo, compare against default branch.
    await this._openPRForBranch(ws, branch, relPath, commitSubject);
  }

  private _showPushFailure(message: string, reason: string | undefined): void {
    let hint = '';
    if (reason === 'rejected-non-ff') {
      hint = ' Pull with rebase first: `git pull --rebase origin <branch>`.';
    } else if (reason === 'auth-failed') {
      hint = ' Run the Git Connect Wizard to set up credentials.';
    } else if (reason === 'network') {
      hint = ' Check your network connection.';
    }
    vscode.window.showErrorMessage(`Push failed: ${message}.${hint}`);
  }

  private async _openPRForBranch(ws: string, branch: string, relPath: string, commitSubject: string): Promise<void> {
    const inspector = this._svc.gitConnectInspector;
    const remoteUrl = await getOriginUrl(ws);
    if (!remoteUrl) {
      vscode.window.showWarningMessage('No `origin` remote — cannot open a PR.');
      return;
    }
    const ownerRepo = parseOwnerRepo(remoteUrl);
    if (!ownerRepo) {
      vscode.window.showWarningMessage(`Could not parse owner/repo from origin URL: ${remoteUrl}`);
      return;
    }
    const host: PRHost = inspector ? (inspector.classifyHost(remoteUrl) as PRHost) : 'other';
    const base = await getDefaultBranch(ws);
    if (branch === base) {
      vscode.window.showInformationMessage(`Already on default branch \`${base}\` — no PR needed.`);
      return;
    }

    // Optional: draft PR?
    const draftPick = await vscode.window.showQuickPick(
      [
        { label: '$(git-pull-request) Standard PR',       value: false, detail: 'Ready for review' },
        { label: '$(git-pull-request-draft) Draft PR',    value: true,  detail: 'Sits while CI runs / WIP' },
      ],
      { placeHolder: 'PR mode?' },
    );
    if (!draftPick) return;
    const draft = draftPick.value;

    const title = commitSubject.slice(0, 120);
    const body  = [
      commitSubject,
      '',
      `Adds \`${relPath}\` via the Evolve AI CI/CD Setup Wizard.`,
      '',
      '<details><summary>Review checklist</summary>',
      '',
      '- [ ] Replace any `# pin-me` placeholders with real action SHAs.',
      '- [ ] Configure required secrets in the CI provider.',
      '- [ ] Branch-protect default branch (require this workflow to pass).',
      '- [ ] Run a test PR to verify everything works end-to-end.',
      '',
      '</details>',
    ].join('\n');

    // 4. Try the API path first; fall back to browser on failure.
    if (host === 'github' || host === 'bitbucket') {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Opening PR on ${host}…`, cancellable: false },
        () => createPR({
          host, owner: ownerRepo.owner, repo: ownerRepo.repo,
          base, head: branch, title, body, draft,
          secrets: inspector?.secrets ?? this._svc.vsCtx.secrets,
        }),
      );
      if (result.ok && result.url) {
        await this._showPRSuccess(result.url, branch);
        return;
      }
      // API failed — offer browser fallback (unless user has no remote auth).
      const url = compareUrl({ host, owner: ownerRepo.owner, repo: ownerRepo.repo, base, head: branch, title, body });
      const ans = await vscode.window.showWarningMessage(
        `PR API failed: ${result.error}. Open the compare page in browser instead?`,
        'Open in browser',
        'Cancel',
      );
      if (ans === 'Open in browser') {
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
      return;
    }

    // GitLab / other → browser only.
    const url = compareUrl({ host, owner: ownerRepo.owner, repo: ownerRepo.repo, base, head: branch, title, body });
    const ans = await vscode.window.showInformationMessage(
      `PR API not supported for ${host} — open compare page in browser?`,
      'Open in browser',
      'Cancel',
    );
    if (ans === 'Open in browser') {
      vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  private async _showPRSuccess(url: string, branch: string): Promise<void> {
    // Remember the PR URL keyed by branch so re-runs can show "PR already open".
    const stateKey = `aiForge.cicd.prUrl.${branch}`;
    await this._svc.vsCtx.workspaceState.update(stateKey, url);
    const ans = await vscode.window.showInformationMessage(
      `PR opened: ${url}`,
      'Open in browser',
      'Copy link',
    );
    if (ans === 'Open in browser') vscode.env.openExternal(vscode.Uri.parse(url));
    if (ans === 'Copy link')       vscode.env.clipboard.writeText(url);
  }

  /**
   * Ask the AI for a Conventional Commits message for a single staged file.
   * Returns a sensible default if the AI is unavailable or returns nonsense.
   */
  private async _draftCommitMessage(relPath: string, diff: string): Promise<string> {
    const truncated = diff.length > 6000 ? diff.slice(0, 6000) + '\n...(truncated)' : diff;
    const req: AIRequest = {
      messages: [{
        role: 'user',
        content: `Write a single-line Conventional Commits message for adding this CI/CD pipeline file.

File: ${relPath}
Format: \`<type>(<scope>): <description>\`. Type should be \`feat\` (new feature) or \`ci\` (CI-only change). Subject line under 72 chars, imperative mood, no trailing period.

Diff:
${truncated}

Return ONLY the commit message line. No explanation, no fences, no body.`,
      }],
      system: 'You are an expert developer writing Conventional Commits messages. Return only the single-line subject.',
      instruction: 'Draft commit message for CI/CD setup',
      mode: 'generate',
    };
    try {
      const drafted = (await this._svc.ai.send(req))
        .replace(/^```[\w]*\n?|```\s*$/gm, '')
        .split('\n')[0]    // first line only
        .trim();
      if (drafted && drafted.length > 4 && drafted.length < 200) return drafted;
    } catch { /* fall through to default */ }
    return `ci: add ${path.basename(relPath)} workflow`;
  }

  // ── Choice gathering ─────────────────────────────────────────────────────

  /**
   * v2.3.0 — present the detected subprojects as a QuickPick. Returns the
   * chosen subproject's relative path ('' for repo root), or undefined if the
   * user cancelled.
   */
  private async _pickSubproject(profile: StackProfile): Promise<string | undefined> {
    const items = profile.subprojects.map(s => ({
      label:  s.label,
      detail: s.relPath === ''
        ? `repo root · ${s.manifest} · ${s.language}`
        : `${s.relPath}/ · ${s.manifest} · ${s.language}`,
      value: s.relPath,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Multiple subprojects detected (${profile.subprojects.length}). Which one is this pipeline for?`,
    });
    return pick?.value;
  }

  private async _collectChoices(profile: StackProfile, subprojectRel = '', subprojectSlug = ''): Promise<CICDChoice | null> {
    // 1. Pick platform — recommend the one matching the user's git host.
    const recommended = this._inspector.recommendPlatform(profile);
    const platformItems = (Object.keys(PLATFORM_LABELS) as CIPlatform[]).map(p => ({
      ...PLATFORM_LABELS[p],
      label: p === recommended ? `${PLATFORM_LABELS[p].label}   $(star-full) recommended` : PLATFORM_LABELS[p].label,
      value: p,
    }));
    const platformPick = await vscode.window.showQuickPick(platformItems, {
      placeHolder: profile.gitHost
        ? `Pick a CI/CD platform (your repo is on ${profile.gitHost})`
        : 'Pick a CI/CD platform',
    });
    if (!platformPick) return null;
    const platform = platformPick.value;

    // 1b. (v2.3.0) Surface platform-specific monorepo warning if applicable.
    if (subprojectSlug) {
      const warn = this._orchestrator.pipelinePathWarning(platform, subprojectSlug);
      if (warn) {
        const proceed = await vscode.window.showWarningMessage(warn, { modal: true }, 'Continue anyway', 'Cancel');
        if (proceed !== 'Continue anyway') return null;
      }
    }

    // 2. Check for existing file at the target path → confirm overwrite.
    const targetPath = this._orchestrator.outputPathFor(platform, subprojectSlug);
    const existing   = profile.existing.find(e => e.file === targetPath);
    let overwrite = false;
    if (existing) {
      const ans = await vscode.window.showWarningMessage(
        `${targetPath} already exists. Overwrite it?`,
        { modal: true },
        'Overwrite', 'Cancel',
      );
      if (ans !== 'Overwrite') return null;
      overwrite = true;
    }

    // 3. Pick template.
    const templatePick = await vscode.window.showQuickPick(
      [
        { label: '$(beaker) Test only',                          value: 'test-only' as const,         detail: 'Lint + tests on PR / push. Safest starter.' },
        { label: '$(rocket) Test + deploy',                      value: 'test-and-deploy' as const,   detail: 'Tests on every push, deploy on tag.' },
        { label: '$(package) Test + container build + deploy',  value: 'test-build-deploy' as const, detail: 'Tests, then build a container image and deploy.' },
      ],
      { placeHolder: 'What kind of pipeline?' },
    );
    if (!templatePick) return null;
    const template = templatePick.value as TemplateChoice;

    // 4. Pick deploy target (only if user picked a deploying template).
    let deployTo: DeployTarget = 'none';
    if (template !== 'test-only') {
      const items: Array<{ label: string; value: DeployTarget; detail: string }> = [];
      const lang = profile.language;
      if (lang === 'node')   items.push({ label: '$(package) npm registry',          value: 'npm',                 detail: 'OIDC trusted-publisher. Tag-triggered.' });
      if (lang === 'python') items.push({ label: '$(package) PyPI',                  value: 'pypi',                detail: 'PyPI Trusted Publisher. Tag-triggered.' });
      items.push(
        { label: '$(package) Docker registry (ghcr / Docker Hub)', value: 'docker-registry',   detail: 'Build + push image with OIDC where supported.' },
        { label: '$(cloud) AWS ECS service update',                value: 'aws-ecs',           detail: 'Updates task definition and forces redeploy.' },
        { label: '$(cloud) AWS Lambda',                            value: 'aws-lambda',        detail: 'Uploads new function code via S3.' },
        { label: '$(cloud) GCP Cloud Run',                         value: 'gcp-cloud-run',     detail: 'Workload identity federation (OIDC).' },
        { label: '$(cloud) Azure App Service',                     value: 'azure-app-service', detail: 'Federated credentials.' },
        { label: '$(circuit-board) Kubernetes (kubectl apply)',    value: 'k8s',               detail: 'Push to registry, kubectl apply against kubeconfig.' },
        { label: '$(circle-slash) None (skip deploy step)',        value: 'none',              detail: 'Generate test-and-build only, decide deploy later.' },
      );
      const deployPick = await vscode.window.showQuickPick(items, { placeHolder: 'Where do you want to deploy?' });
      if (!deployPick) return null;
      deployTo = deployPick.value;
    }

    return { platform, template, deployTo, overwrite, subproject: subprojectRel, subprojectSlug };
  }

  /**
   * Extract pipeline content from the AI response. Expected format is either:
   *   ## path/to/file.yml
   *   ```yaml
   *   <content>
   *   ```
   * or just a fenced block. We strip the surrounding markers and return the
   * raw file body. Returns null if no usable content could be extracted.
   */
  private _extractContent(aiOutput: string): string | null {
    // Prefer a fenced block — most reliable signal.
    const fence = /```(?:yaml|yml|groovy|jenkinsfile)?\s*\n([\s\S]*?)\n```/i.exec(aiOutput);
    if (fence && fence[1]) return fence[1].trim();
    // Fallback: strip the "## path/to/file" header line and any leading/trailing fences.
    const cleaned = aiOutput
      .replace(/^##\s+\S+\s*$/m, '')
      .replace(/^```[\w]*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  // ── Pre-push hook commands (v2.4.0) ──────────────────────────────────────

  /**
   * Install the pre-push hook. Walks the user through:
   *   1. Workspace trust check + workspace folder selection.
   *   2. Hook conflict handling (existing-non-evolve / Husky-detected paths).
   *   3. Mode selection (block / warn / off) — pre-fills from setting.
   *   4. Writes scripts/check-pipelines.js path resolved from extension dir.
   *
   * Idempotent: re-running just updates mode / path. Always opt-in (we do
   * NOT install on workspace open).
   */
  async installPrePushHook(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showWarningMessage('Open a folder first.'); return; }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('Install Hook refuses to run in untrusted workspaces.');
      return;
    }

    // Resolve the absolute path of scripts/check-pipelines.js inside the
    // extension's install dir. Falls back to extensionPath/scripts/... if
    // extensionUri is not file-scheme.
    const scriptPath = path.join(this._svc.vsCtx.extensionPath, 'scripts', 'check-pipelines.js');
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(scriptPath));
    } catch {
      vscode.window.showErrorMessage(`Cannot find pipeline checker at ${scriptPath}. Reinstall the extension.`);
      return;
    }

    // Detect current state to drive the conflict flow.
    const state = detectHookState(ws);
    let conflictAction: 'replace' | 'append' | undefined;

    if (state.kind === 'theirs') {
      const pick = await vscode.window.showWarningMessage(
        `An existing pre-push hook is present at ${state.path}. Pick how to handle it:`,
        { modal: true },
        'Append our check',
        'Replace it',
        'Cancel',
      );
      if (pick === 'Append our check') conflictAction = 'append';
      else if (pick === 'Replace it')  conflictAction = 'replace';
      else return;
    }

    if (state.kind === 'husky') {
      const proceed = await vscode.window.showInformationMessage(
        `Husky detected. Install will write the check into ${state.huskyPath} so Husky doesn't overwrite it.`,
        { modal: true },
        'Continue',
        'Cancel',
      );
      if (proceed !== 'Continue') return;
    }

    // Pick mode — pre-fill from setting.
    const cfgMode = vscode.workspace.getConfiguration('aiForge.cicd').get<string>('hookMode', 'block');
    const modePick = await vscode.window.showQuickPick(
      [
        { label: '$(shield) Block  — refuse pushes with hard issues (Recommended)', value: 'block' as const, picked: cfgMode === 'block' },
        { label: '$(warning) Warn  — surface issues but allow push',                  value: 'warn'  as const, picked: cfgMode === 'warn'  },
        { label: '$(circle-slash) Off — skip all checks (effectively disabled)',     value: 'off'   as const, picked: cfgMode === 'off'   },
      ],
      { placeHolder: 'Pick the hook mode (can be changed later via aiForge.cicd.hookMode setting)' },
    );
    if (!modePick) return;

    const result = installHook({ repoRoot: ws, scriptPath, mode: modePick.value, conflictAction });
    if (!result.ok) {
      vscode.window.showErrorMessage(`Install failed: ${result.message}`);
      return;
    }
    // Persist the chosen mode to settings so the user's preference survives reinstall.
    try {
      await vscode.workspace.getConfiguration('aiForge.cicd').update('hookMode', modePick.value, vscode.ConfigurationTarget.Workspace);
    } catch { /* setting may already match; ignore */ }

    const followup = await vscode.window.showInformationMessage(
      result.message + '\n\nBypass any specific push with: git push --no-verify',
      'Test it now',
      'Open hook file',
      'OK',
    );
    if (followup === 'Test it now')   await this.checkPipelinesNow();
    if (followup === 'Open hook file' && result.path) {
      const doc = await vscode.workspace.openTextDocument(result.path);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }

  async uninstallPrePushHook(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showWarningMessage('Open a folder first.'); return; }
    if (!vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('Uninstall Hook refuses to run in untrusted workspaces.');
      return;
    }
    const result = uninstallHook(ws);
    if (result.ok) vscode.window.showInformationMessage(result.message);
    else           vscode.window.showWarningMessage(result.message);
  }

  /**
   * Run the same checker the hook runs, but against the current workspace's
   * pipeline files. Surfaces findings in the Output channel and shows a
   * one-line toast with the count. Useful for verifying installs and for
   * the "check before committing" workflow.
   */
  async checkPipelinesNow(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { vscode.window.showWarningMessage('Open a folder first.'); return; }
    const scriptPath = path.join(this._svc.vsCtx.extensionPath, 'scripts', 'check-pipelines.js');

    // Find all pipeline files in the workspace via VS Code's glob.
    const patterns = [
      '.github/workflows/*.yml',
      '.github/workflows/*.yaml',
      '.gitlab-ci.yml',
      '.gitlab-ci*.yml',
      'Jenkinsfile',
      'Jenkinsfile.*',
      '.circleci/config.yml',
      '.circleci/config.yaml',
      'azure-pipelines.yml',
      'azure-pipelines*.yml',
      'bitbucket-pipelines.yml',
      'bitbucket-pipelines.yaml',
    ];
    const uris: vscode.Uri[] = [];
    for (const p of patterns) {
      const found = await vscode.workspace.findFiles(p, '**/node_modules/**', 100);
      uris.push(...found);
    }
    if (uris.length === 0) {
      vscode.window.showInformationMessage('No pipeline files found in this workspace.');
      return;
    }

    const relFiles = uris.map(u => path.relative(ws, u.fsPath));
    const out = vscode.window.createOutputChannel('Evolve AI — Pipeline Check');
    out.clear();
    out.show(true);
    out.appendLine(`Checking ${relFiles.length} pipeline file(s)…`);

    const mode = vscode.workspace.getConfiguration('aiForge.cicd').get<string>('hookMode', 'block');

    const result = await this._runChecker(scriptPath, relFiles, mode, ws);
    if (result.stdout) out.append(result.stdout);
    if (result.stderr) out.append(result.stderr);
    if (result.code === 0) {
      vscode.window.showInformationMessage(`Pipeline check: no blocking issues. (See Output for details.)`);
    } else {
      vscode.window.showWarningMessage(`Pipeline check: blocking issues detected. (See Output for details.)`);
    }
  }

  private _runChecker(scriptPath: string, relFiles: string[], mode: string, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise(resolve => {
      const proc = spawn('node', [scriptPath, `--mode=${mode}`], { cwd, shell: false, windowsHide: true });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', d => { stdout += d.toString('utf8'); });
      proc.stderr?.on('data', d => { stderr += d.toString('utf8'); });
      proc.on('error', e => resolve({ code: null, stdout, stderr: stderr + e.message }));
      proc.on('close', code => resolve({ code, stdout, stderr }));
      // NUL-separated file list to stdin.
      try {
        proc.stdin?.write(relFiles.join('\0'));
        proc.stdin?.end();
      } catch { /* ignore */ }
    });
  }
}

// Suppress unused-import warning on `path` if the file shrinks later.
void path;
