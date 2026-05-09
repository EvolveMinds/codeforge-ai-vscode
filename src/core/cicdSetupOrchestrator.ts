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

export interface StackProfile {
  language:       Language;
  packageMgr:     PackageMgr;
  testFramework:  TestFramework;
  /** Detected git host based on origin URL — used to pre-recommend a CI platform. */
  gitHost:        'github' | 'gitlab' | 'bitbucket' | 'other' | null;
  /** Existing CI files in the workspace (so we can warn about overwrite). */
  existing:       Array<{ platform: CIPlatform; file: string }>;
  workspace:      string | null;
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
   */
  async inspect(workspacePath: string | undefined): Promise<StackProfile> {
    const ws = workspacePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    if (!ws) {
      return {
        language: 'unknown', packageMgr: 'unknown', testFramework: 'unknown',
        gitHost: null, existing: [], workspace: null,
      };
    }

    const [language, packageMgr, testFramework, gitHost] = await Promise.all([
      this._detectLanguage(ws),
      this._detectPackageMgr(ws),
      this._detectTestFramework(ws),
      this._detectGitHost(ws),
    ]);

    return {
      language,
      packageMgr,
      testFramework,
      gitHost,
      existing: this._detectExistingCI(ws),
      workspace: ws,
    };
  }

  /** One-line summary for the wizard's intro screen. */
  summary(p: StackProfile): string {
    const parts: string[] = [];
    parts.push(p.language === 'unknown' ? 'language: unknown' : `language: ${p.language}`);
    if (p.packageMgr !== 'unknown')    parts.push(`pkg: ${p.packageMgr}`);
    if (p.testFramework !== 'unknown') parts.push(`tests: ${p.testFramework}`);
    if (p.gitHost)                     parts.push(`host: ${p.gitHost}`);
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
  /** Compute the output path for the chosen platform. */
  outputPathFor(platform: CIPlatform): string {
    switch (platform) {
      case 'github-actions':       return '.github/workflows/ci.yml';
      case 'gitlab-ci':            return '.gitlab-ci.yml';
      case 'jenkins':              return 'Jenkinsfile';
      case 'circleci':             return '.circleci/config.yml';
      case 'azure-pipelines':      return 'azure-pipelines.yml';
      case 'bitbucket-pipelines':  return 'bitbucket-pipelines.yml';
    }
  }

  planSteps(profile: StackProfile, choice: CICDChoice): CICDPlan {
    return {
      outputPath: this.outputPathFor(choice.platform),
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

    return `Generate a starter ${choice.platform} pipeline file for this project.

Stack:
${stack || '(unknown — keep the pipeline language-agnostic)'}

Template: ${this._templateLabel(choice.template)}
${deploySection ? `Deploy target: ${choice.deployTo}\n${deploySection}` : 'No deployment step needed.'}

Required quality bar:
- All third-party action / image references pinned to a commit SHA where possible. Use placeholder SHAs with comments \`# pin-me\` if you don't know the real one.
- Workflow-level \`permissions: { contents: read }\` on GitHub Actions.
- timeout-minutes on every job (15 by default).
- Cache dependencies keyed by lockfile hash.
- Concurrency control at workflow level: cancel in-progress on PR, queue on main.
- Use OIDC for cloud auth if a deploy step is present.
- Move secret references out of \`run:\` and into \`env:\`.

Output requirements:
- Output path: \`${outputPath}\`
- Format: \`## ${outputPath}\` followed by a fenced YAML / Groovy block.
- Add a TOP-OF-FILE comment block summarising what the pipeline does and what the user must configure (secrets, branch protection, etc).

Do NOT add features the template doesn't require. Be surgical.`;
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
