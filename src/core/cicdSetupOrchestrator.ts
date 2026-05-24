/**
 * core/cicdSetupOrchestrator.ts — First-time CI/CD setup wizard
 *
 * Sibling to setupOrchestrator.ts (Gemma 4) and gitConnectOrchestrator.ts.
 * Detects the workspace's stack (language, package manager, test framework,
 * git host) and generates a starter pipeline file tailored to that stack.
 *
 * Two parts:
 *   - CICDStackInspector — read-only detection of language / framework / host
 *   - CICDSetupOrchestrator — plan + execute the steps to write the file
 *
 * The wizard never modifies live infrastructure or pushes to remotes.
 * It writes one local file (or several), the user reviews + commits.
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import type { IServices } from './services';
import { runForStdout } from './processUtil';

// ── Detection types ──────────────────────────────────────────────────────────

export type Language     = 'python' | 'node' | 'go' | 'rust' | 'java' | 'dotnet' | 'unknown';
export type PackageMgr   = 'npm' | 'yarn' | 'pnpm' | 'pip' | 'poetry' | 'pipenv' | 'cargo' | 'go-modules' | 'maven' | 'gradle' | 'dotnet' | 'unknown';
export type TestFramework = 'pytest' | 'unittest' | 'jest' | 'vitest' | 'mocha' | 'go-test' | 'cargo-test' | 'junit' | 'xunit' | 'unknown';
export type CIPlatform   = 'github-actions' | 'gitlab-ci' | 'jenkins' | 'circleci' | 'azure-pipelines' | 'bitbucket-pipelines';

export interface Subproject {
  /** Relative path from workspace root (e.g. "apps/web", "services/api"). Empty string for repo root. */
  relPath:    string;
  /** Absolute path on disk. */
  absPath:    string;
  /** Manifest file that anchored this subproject (e.g. "package.json", "pyproject.toml"). */
  manifest:   string;
  /** Quick label for the QuickPick (typically the directory name; "(repo root)" for root). */
  label:      string;
  /** Detected language for this subproject — for the QuickPick detail line. */
  language:   Language;
}

export interface StackProfile {
  language:       Language;
  packageMgr:     PackageMgr;
  testFramework:  TestFramework;
  /** Detected git host based on origin URL — used to pre-recommend a CI platform. */
  gitHost:        'github' | 'gitlab' | 'bitbucket' | 'other' | null;
  /** Existing CI files in the workspace (so we can warn about overwrite). */
  existing:       Array<{ platform: CIPlatform; file: string }>;
  workspace:      string | null;
  /** All sub-projects detected in the workspace (depth 2). Always includes the
   *  root if it has a recognisable manifest. Empty if none found anywhere. */
  subprojects:    Subproject[];
  /** Path the rest of the profile was computed against — relative to workspace root.
   *  Empty string means "the workspace root itself was inspected". */
  scopedTo:       string;
}

export type DeployTarget =
  | 'none'
  | 'npm'
  | 'pypi'
  | 'docker-registry'
  | 'aws-ecs'
  | 'aws-lambda'
  | 'gcp-cloud-run'
  | 'azure-app-service'
  | 'k8s';

export type TemplateChoice =
  | 'test-only'
  | 'test-and-deploy'
  | 'test-build-deploy';

export interface CICDChoice {
  platform:   CIPlatform;
  template:   TemplateChoice;
  deployTo:   DeployTarget;
  /** True if user agreed to overwrite an existing CI file. */
  overwrite:  boolean;
  /** Subproject the pipeline targets (empty string = repo root). Set by the wizard
   *  when multiple subprojects exist; otherwise empty. */
  subproject?: string;
  /** Slug derived from subproject — used to disambiguate output filenames when
   *  multiple subprojects each get their own pipeline (e.g. "ci-web.yml"). */
  subprojectSlug?: string;
}

export interface CICDPlan {
  /** Path the file should be written to (relative to workspace root). */
  outputPath:    string;
  profile:       StackProfile;
  choice:        CICDChoice;
}

export interface CICDExecuteResult {
  ok:        boolean;
  error?:    string;
  filePath?: string;
}

// ── Inspector ────────────────────────────────────────────────────────────────

export class CICDStackInspector {
  /**
   * Inspect the workspace and return a stack profile. Never throws.
   * All probes run in parallel with timeouts.
   *
   * @param workspacePath  Repo root (defaults to first workspace folder).
   * @param subprojectRel  Optional relative path within workspace to scope
   *                       language / packageMgr / testFramework detection to.
   *                       Useful for monorepos. Defaults to '' (root).
   */
  async inspect(workspacePath: string | undefined, subprojectRel = ''): Promise<StackProfile> {
    const ws = workspacePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    if (!ws) {
      return {
        language: 'unknown', packageMgr: 'unknown', testFramework: 'unknown',
        gitHost: null, existing: [], workspace: null,
        subprojects: [], scopedTo: '',
      };
    }

    // Detection is scoped to either repo root or the chosen subproject.
    // gitHost + existingCI + subprojects always come from the workspace root,
    // since those concepts only make sense at the repo level.
    const scopeAbs = subprojectRel ? path.join(ws, subprojectRel) : ws;

    const [language, packageMgr, testFramework, gitHost, subprojects] = await Promise.all([
      this._detectLanguage(scopeAbs),
      this._detectPackageMgr(scopeAbs),
      this._detectTestFramework(scopeAbs),
      this._detectGitHost(ws),
      this.detectSubprojects(ws),
    ]);

    return {
      language,
      packageMgr,
      testFramework,
      gitHost,
      existing: this._detectExistingCI(ws),
      workspace: ws,
      subprojects,
      scopedTo: subprojectRel,
    };
  }

  /**
   * Walk the workspace up to 2 levels deep looking for known package manifests,
   * skipping common bloat directories. Returns one Subproject per directory
   * containing a recognisable manifest.
   *
   * Always includes the repo root if it has a manifest of its own.
   * Returns an empty list if nothing matches anywhere — the wizard falls back
   * to treating the root as the only possible target.
   *
   * Scan budget: hard-capped at 200 directory visits, with a 30-entry-per-dir
   * cap. Monorepo with thousands of subdirs won't hang the wizard.
   */
  async detectSubprojects(ws: string): Promise<Subproject[]> {
    const found: Subproject[] = [];
    const seen = new Set<string>();
    let visits = 0;
    const SKIP_DIRS = new Set([
      'node_modules', '.git', '.venv', 'venv', 'env', '__pycache__',
      'target', 'build', 'dist', 'out', 'bin', 'obj', '.next', '.nuxt',
      '.gradle', '.idea', '.vscode', '.terraform', 'vendor',
    ]);
    const MANIFESTS: Array<{ name: string; lang: Language; alsoCheck?: RegExp }> = [
      { name: 'package.json',   lang: 'node' },
      { name: 'pyproject.toml', lang: 'python' },
      { name: 'setup.py',       lang: 'python' },
      { name: 'requirements.txt', lang: 'python' },
      { name: 'go.mod',         lang: 'go' },
      { name: 'Cargo.toml',     lang: 'rust' },
      { name: 'pom.xml',        lang: 'java' },
      { name: 'build.gradle',   lang: 'java' },
      { name: 'build.gradle.kts', lang: 'java' },
    ];

    const visit = (absDir: string, relDir: string, depth: number): void => {
      if (visits++ > 200) return;
      if (seen.has(absDir)) return;
      seen.add(absDir);

      let entries: string[] = [];
      try { entries = fs.readdirSync(absDir).slice(0, 30); } catch { return; }

      // First pass: check for any manifest files in this directory.
      let matchedManifest: { name: string; lang: Language } | null = null;
      for (const m of MANIFESTS) {
        if (entries.includes(m.name)) { matchedManifest = m; break; }
      }
      // Also detect .csproj at this level (filename varies, just match the extension).
      if (!matchedManifest && entries.some(e => /\.csproj$/i.test(e))) {
        matchedManifest = { name: entries.find(e => /\.csproj$/i.test(e))!, lang: 'dotnet' };
      }

      if (matchedManifest) {
        const label = relDir === '' ? '(repo root)' : relDir;
        found.push({
          relPath:  relDir,
          absPath:  absDir,
          manifest: matchedManifest.name,
          label,
          language: matchedManifest.lang,
        });
      }

      // Recurse one more level if we haven't hit depth.
      if (depth >= 2) return;
      for (const e of entries) {
        if (SKIP_DIRS.has(e)) continue;
        if (e.startsWith('.')) continue;
        const childAbs = path.join(absDir, e);
        let isDir = false;
        try { isDir = fs.statSync(childAbs).isDirectory(); } catch { continue; }
        if (!isDir) continue;
        visit(childAbs, relDir === '' ? e : `${relDir}/${e}`, depth + 1);
      }
    };

    visit(ws, '', 0);
    return found;
  }

  /**
   * Derive a short kebab-case slug from a subproject path — used to disambiguate
   * pipeline filenames when multiple subprojects each get their own pipeline.
   *   "apps/web"     → "web"
   *   "services/api" → "api"
   *   ""             → "" (root — no slug needed)
   */
  slugifySubproject(relPath: string): string {
    if (!relPath) return '';
    const base = relPath.split('/').pop() || relPath;
    return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /** One-line summary for the wizard's intro screen. */
  summary(p: StackProfile): string {
    const parts: string[] = [];
    if (p.scopedTo)                    parts.push(`scope: ${p.scopedTo}`);
    parts.push(p.language === 'unknown' ? 'language: unknown' : `language: ${p.language}`);
    if (p.packageMgr !== 'unknown')    parts.push(`pkg: ${p.packageMgr}`);
    if (p.testFramework !== 'unknown') parts.push(`tests: ${p.testFramework}`);
    if (p.gitHost)                     parts.push(`host: ${p.gitHost}`);
    if (p.subprojects.length > 1)      parts.push(`${p.subprojects.length} subprojects`);
    if (p.existing.length > 0)         parts.push(`existing CI: ${p.existing.map(e => e.platform).join(', ')}`);
    return parts.join(' · ');
  }

  /** Recommended CI platform based on the git host. */
  recommendPlatform(p: StackProfile): CIPlatform {
    if (p.gitHost === 'github')    return 'github-actions';
    if (p.gitHost === 'gitlab')    return 'gitlab-ci';
    if (p.gitHost === 'bitbucket') return 'bitbucket-pipelines';
    return 'github-actions';   // safest default
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async _detectLanguage(ws: string): Promise<Language> {
    if (this._exists(ws, 'package.json'))    return 'node';
    if (this._exists(ws, 'pyproject.toml') || this._exists(ws, 'requirements.txt') || this._exists(ws, 'setup.py')) return 'python';
    if (this._exists(ws, 'go.mod'))          return 'go';
    if (this._exists(ws, 'Cargo.toml'))      return 'rust';
    if (this._exists(ws, 'pom.xml') || this._exists(ws, 'build.gradle') || this._exists(ws, 'build.gradle.kts')) return 'java';
    if (this._exists(ws, 'Directory.Build.props') || this._anyByExt(ws, '.csproj') || this._anyByExt(ws, '.sln')) return 'dotnet';
    return 'unknown';
  }

  private async _detectPackageMgr(ws: string): Promise<PackageMgr> {
    if (this._exists(ws, 'pnpm-lock.yaml'))     return 'pnpm';
    if (this._exists(ws, 'yarn.lock'))          return 'yarn';
    if (this._exists(ws, 'package-lock.json'))  return 'npm';
    if (this._exists(ws, 'package.json'))       return 'npm';
    if (this._exists(ws, 'poetry.lock'))        return 'poetry';
    if (this._exists(ws, 'Pipfile'))            return 'pipenv';
    if (this._exists(ws, 'requirements.txt'))   return 'pip';
    if (this._exists(ws, 'pyproject.toml'))     return 'poetry';
    if (this._exists(ws, 'Cargo.lock') || this._exists(ws, 'Cargo.toml')) return 'cargo';
    if (this._exists(ws, 'go.mod'))             return 'go-modules';
    if (this._exists(ws, 'pom.xml'))            return 'maven';
    if (this._exists(ws, 'build.gradle') || this._exists(ws, 'build.gradle.kts')) return 'gradle';
    if (this._anyByExt(ws, '.csproj'))          return 'dotnet';
    return 'unknown';
  }

  private async _detectTestFramework(ws: string): Promise<TestFramework> {
    // Python
    if (this._exists(ws, 'pytest.ini') || this._exists(ws, 'tests') || this._exists(ws, 'test')) {
      // Bias towards pytest if pyproject.toml mentions pytest, else unittest.
      const py = path.join(ws, 'pyproject.toml');
      if (fs.existsSync(py)) {
        try {
          const content = fs.readFileSync(py, 'utf8');
          if (/pytest/i.test(content)) return 'pytest';
        } catch { /* skip */ }
      }
      if (this._exists(ws, 'pytest.ini')) return 'pytest';
    }
    // Node
    const pkg = path.join(ws, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
        const deps = { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) };
        if (deps.vitest) return 'vitest';
        if (deps.jest)   return 'jest';
        if (deps.mocha)  return 'mocha';
      } catch { /* skip */ }
    }
    if (this._exists(ws, 'go.mod'))     return 'go-test';
    if (this._exists(ws, 'Cargo.toml')) return 'cargo-test';
    if (this._exists(ws, 'pom.xml') || this._exists(ws, 'build.gradle')) return 'junit';
    if (this._anyByExt(ws, '.csproj'))  return 'xunit';
    return 'unknown';
  }

  private async _detectGitHost(ws: string): Promise<StackProfile['gitHost']> {
    const url = await runForStdout('git', ['remote', 'get-url', 'origin'], { cwd: ws, timeoutMs: 3000 });
    if (!url) return null;
    const lower = url.toLowerCase();
    if (lower.includes('github.com'))    return 'github';
    if (lower.includes('gitlab.com'))    return 'gitlab';
    if (lower.includes('bitbucket.org')) return 'bitbucket';
    return 'other';
  }

  private _detectExistingCI(ws: string): Array<{ platform: CIPlatform; file: string }> {
    const found: Array<{ platform: CIPlatform; file: string }> = [];
    const ghaDir = path.join(ws, '.github', 'workflows');
    if (fs.existsSync(ghaDir)) {
      try {
        for (const f of fs.readdirSync(ghaDir)) {
          if (/\.ya?ml$/i.test(f)) found.push({ platform: 'github-actions', file: path.join('.github/workflows', f) });
        }
      } catch { /* skip */ }
    }
    const checks: Array<[string, CIPlatform]> = [
      ['.gitlab-ci.yml',           'gitlab-ci'],
      ['Jenkinsfile',              'jenkins'],
      ['.circleci/config.yml',     'circleci'],
      ['.circleci/config.yaml',    'circleci'],
      ['azure-pipelines.yml',      'azure-pipelines'],
      ['azure-pipelines.yaml',     'azure-pipelines'],
      ['bitbucket-pipelines.yml',  'bitbucket-pipelines'],
      ['bitbucket-pipelines.yaml', 'bitbucket-pipelines'],
    ];
    for (const [rel, platform] of checks) {
      if (fs.existsSync(path.join(ws, rel))) found.push({ platform, file: rel });
    }
    return found;
  }

  private _exists(ws: string, rel: string): boolean {
    try { return fs.existsSync(path.join(ws, rel)); } catch { return false; }
  }

  private _anyByExt(ws: string, ext: string): boolean {
    try {
      for (const e of fs.readdirSync(ws)) {
        if (e.toLowerCase().endsWith(ext.toLowerCase())) return true;
      }
    } catch { /* skip */ }
    return false;
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class CICDSetupOrchestrator {
  /**
   * Compute the output path for the chosen platform. The pipeline ALWAYS lives
   * at the repo root (CI providers don't look in subdirectories), but when
   * targeting a subproject we disambiguate the filename so multiple subprojects
   * can each have their own pipeline.
   *
   *   subprojectSlug=''      → .github/workflows/ci.yml
   *   subprojectSlug='web'   → .github/workflows/ci-web.yml
   *   subprojectSlug='api'   → .github/workflows/ci-api.yml
   *
   * GitLab / Bitbucket / Azure / Jenkins only support ONE pipeline file at
   * their canonical path — for those, the slug is appended as a stem instead
   * (e.g. `.gitlab-ci-web.yml`) but the user is warned that they'll need to
   * point their CI provider at the non-default path.
   */
  outputPathFor(platform: CIPlatform, subprojectSlug = ''): string {
    const stem = subprojectSlug ? `-${subprojectSlug}` : '';
    switch (platform) {
      case 'github-actions':       return `.github/workflows/ci${stem}.yml`;
      case 'gitlab-ci':            return subprojectSlug ? `.gitlab-ci${stem}.yml` : '.gitlab-ci.yml';
      case 'jenkins':              return subprojectSlug ? `Jenkinsfile.${subprojectSlug}` : 'Jenkinsfile';
      case 'circleci':             return '.circleci/config.yml';   // CircleCI uses one config; comment in-file scopes by workspace
      case 'azure-pipelines':      return subprojectSlug ? `azure-pipelines-${subprojectSlug}.yml` : 'azure-pipelines.yml';
      case 'bitbucket-pipelines':  return 'bitbucket-pipelines.yml'; // Bitbucket forces canonical path
    }
  }

  /**
   * For platforms that can only have ONE pipeline at the canonical path
   * (Bitbucket, CircleCI), return a warning string the wizard should surface
   * to the user when they're scoping to a subproject. Empty string = no warning.
   */
  pipelinePathWarning(platform: CIPlatform, subprojectSlug: string): string {
    if (!subprojectSlug) return '';
    if (platform === 'bitbucket-pipelines') {
      return `Bitbucket Pipelines only reads ${this.outputPathFor(platform)} at the repo root. The generated pipeline will scope jobs to \`${subprojectSlug}\` via working-directory, but you can only have ONE Bitbucket pipeline per repo — overwriting any existing one.`;
    }
    if (platform === 'circleci') {
      return `CircleCI only reads .circleci/config.yml at the repo root. The wizard will generate config that scopes jobs to \`${subprojectSlug}\` via working_directory, but if you already have a CircleCI config for another subproject, you'll need to merge the jobs by hand.`;
    }
    if (platform === 'gitlab-ci') {
      return `GitLab only reads .gitlab-ci.yml at the repo root by default. The wizard is writing ${this.outputPathFor(platform, subprojectSlug)} — you'll need to either rename it or set CI_CONFIG_PATH in your GitLab project settings to point at this file.`;
    }
    return '';
  }

  planSteps(profile: StackProfile, choice: CICDChoice): CICDPlan {
    return {
      outputPath: this.outputPathFor(choice.platform, choice.subprojectSlug ?? ''),
      profile,
      choice,
    };
  }

  /**
   * Build the AI prompt that produces a starter pipeline tailored to the user's stack.
   * Returned string is fed to services.ai.send() by the caller.
   */
  buildPrompt(plan: CICDPlan): string {
    const { profile, choice, outputPath } = plan;
    const stackParts: string[] = [];
    if (profile.language    !== 'unknown') stackParts.push(`Language: ${profile.language}`);
    if (profile.packageMgr  !== 'unknown') stackParts.push(`Package manager: ${profile.packageMgr}`);
    if (profile.testFramework !== 'unknown') stackParts.push(`Test framework: ${profile.testFramework}`);
    const stack = stackParts.join('\n');

    const deploySection = this._deployInstructions(choice.deployTo, profile.language);

    // Monorepo block — only included when targeting a subproject. Tells the AI
    // to use working-directory / defaults: run / paths filters appropriately
    // so the pipeline only runs when files in that subproject change.
    const sub = choice.subproject;
    const monorepoSection = sub ? this._monorepoInstructions(choice.platform, sub) : '';

    return `Generate a starter ${choice.platform} pipeline file for this project.

Stack:
${stack || '(unknown — keep the pipeline language-agnostic)'}
${monorepoSection ? `\n${monorepoSection}\n` : ''}
Template: ${this._templateLabel(choice.template)}
${deploySection ? `Deploy target: ${choice.deployTo}\n${deploySection}` : 'No deployment step needed.'}

Required quality bar:
- All third-party action / image references pinned to a commit SHA where possible. Use placeholder SHAs with comments \`# pin-me\` if you don't know the real one.
- Workflow-level \`permissions: { contents: read }\` on GitHub Actions.
- timeout-minutes on every job (15 by default).
- Cache dependencies keyed by lockfile hash${sub ? ` (lockfile lives in \`${sub}\`)` : ''}.
- Concurrency control at workflow level: cancel in-progress on PR, queue on main.
- Use OIDC for cloud auth if a deploy step is present.
- Move secret references out of \`run:\` and into \`env:\`.

Output requirements:
- Output path: \`${outputPath}\`
- Format: \`## ${outputPath}\` followed by a fenced YAML / Groovy block.
- Add a TOP-OF-FILE comment block summarising what the pipeline does and what the user must configure (secrets, branch protection, etc).

Do NOT add features the template doesn't require. Be surgical.`;
  }

  private _monorepoInstructions(platform: CIPlatform, sub: string): string {
    const lines: string[] = [
      `MONOREPO MODE — this pipeline targets the subproject at \`${sub}\` (NOT the repo root).`,
      `- All run steps must operate inside \`${sub}\` — use the appropriate "set the working directory" idiom for ${platform}.`,
    ];
    switch (platform) {
      case 'github-actions':
        lines.push(`- Set \`defaults: { run: { working-directory: ${sub} } }\` at workflow level.`);
        lines.push(`- Add \`paths\` filter on triggers so the workflow only runs when files in \`${sub}/**\` (and shared files) change.`);
        lines.push(`- Reference the lockfile as \`${sub}/<lockfile>\` in cache keys, not the root.`);
        break;
      case 'gitlab-ci':
        lines.push(`- Set \`default: { variables: { CI_WORK_DIR: "${sub}" } }\` and \`cd $CI_WORK_DIR\` in every script.`);
        lines.push(`- Use \`rules: changes:\` matching \`${sub}/**/*\` so the pipeline skips when only other paths change.`);
        break;
      case 'jenkins':
        lines.push(`- Wrap every \`stage { steps { ... } }\` in \`dir('${sub}') { ... }\`.`);
        break;
      case 'circleci':
        lines.push(`- Set \`working_directory: ~/project/${sub}\` on every job.`);
        break;
      case 'azure-pipelines':
        lines.push(`- Set \`workingDirectory: ${sub}\` on every script step.`);
        lines.push(`- Use \`paths: include: [${sub}/*]\` in trigger blocks.`);
        break;
      case 'bitbucket-pipelines':
        lines.push(`- Prefix each step's script with \`cd ${sub} && ...\` since Bitbucket has no native working-dir setting.`);
        break;
    }
    return lines.join('\n');
  }

  /** Write the generated content to disk. Overwrite is gated by choice.overwrite. */
  async execute(plan: CICDPlan, content: string): Promise<CICDExecuteResult> {
    const ws = plan.profile.workspace;
    if (!ws) return { ok: false, error: 'No workspace folder is open.' };

    const fullPath = path.join(ws, plan.outputPath);
    if (fs.existsSync(fullPath) && !plan.choice.overwrite) {
      return { ok: false, error: `${plan.outputPath} already exists. Re-run the wizard and confirm overwrite.` };
    }

    try {
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content, 'utf8');
    } catch (e) {
      return { ok: false, error: `Could not write ${plan.outputPath}: ${(e as Error).message}` };
    }

    return { ok: true, filePath: fullPath };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _templateLabel(t: TemplateChoice): string {
    switch (t) {
      case 'test-only':         return 'test-only — checkout, install deps, run lint + tests, no deploy';
      case 'test-and-deploy':   return 'test + deploy — test job, then deploy job gated on tag push (main only)';
      case 'test-build-deploy': return 'test + container build + deploy — test, build container image, push to registry, deploy';
    }
  }

  private _deployInstructions(target: DeployTarget, lang: Language): string {
    switch (target) {
      case 'none':              return '';
      case 'npm':               return '- Trigger: tag push (\\\`refs/tags/v*\\\`). Use OIDC + \\\`npm publish --provenance --access public\\\`.';
      case 'pypi':              return '- Trigger: tag push. Use PyPI Trusted Publisher (OIDC) — no API token needed.';
      case 'docker-registry':   return `- Build a Docker image, tag with both \`$GITHUB_SHA\` and \`latest\` (or main-branch only), push to ghcr.io / docker hub. Use OIDC where supported.`;
      case 'aws-ecs':           return '- Use \\\`aws-actions/configure-aws-credentials@<SHA>\\\` with role-to-assume (OIDC). Use \\\`aws ecs update-service\\\` with new task definition.';
      case 'aws-lambda':        return '- Use OIDC. Build the function package, upload to S3, call \\\`aws lambda update-function-code\\\`.';
      case 'gcp-cloud-run':     return '- Use \\\`google-github-actions/auth@<SHA>\\\` with workload_identity_provider. Then \\\`gcloud run deploy\\\`.';
      case 'azure-app-service': return '- Use \\\`azure/login@<SHA>\\\` with federated credentials. Then \\\`azure/webapps-deploy@<SHA>\\\`.';
      case 'k8s':               return `- Build container, push to registry, then \`kubectl apply -f k8s/\` against a kubeconfig set via secret. Pin to a digest.${lang === 'unknown' ? '' : ` Image base appropriate for ${lang}.`}`;
    }
  }
}

// ── Export for service container ─────────────────────────────────────────────

export interface CICDSetupServices {
  inspector:    CICDStackInspector;
  orchestrator: CICDSetupOrchestrator;
}

export function createCICDSetupServices(): CICDSetupServices {
  return {
    inspector:    new CICDStackInspector(),
    orchestrator: new CICDSetupOrchestrator(),
  };
}

// Re-exports so commands can import without reaching deep
export type { IServices };
