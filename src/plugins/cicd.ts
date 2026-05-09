/**
 * plugins/cicd.ts — CI/CD pipeline plugin for Evolve AI
 *
 * Activates when the workspace contains any common CI/CD configuration:
 *   - .github/workflows/*.yml | .yaml      (GitHub Actions)
 *   - .gitlab-ci.yml                       (GitLab CI/CD)
 *   - Jenkinsfile, Jenkinsfile.*           (Jenkins)
 *   - .circleci/config.yml | .yaml         (CircleCI)
 *   - azure-pipelines.yml | .yaml          (Azure Pipelines)
 *   - bitbucket-pipelines.yml | .yaml      (Bitbucket Pipelines)
 *
 * Contributes:
 *  - contextHooks       : pipeline summary (platform, jobs, secrets referenced, runners, matrix)
 *  - systemPromptSection: full CI/CD best-practice domain knowledge per platform
 *  - codeLensActions    : Explain job, Add cache, Convert to matrix, Add concurrency
 *  - codeActions        : Replace long-lived secrets with OIDC, Pin actions to commit SHA
 *  - transforms         : Lint pipeline (find anti-patterns), Add OIDC auth, Add cache
 *  - templates          : GitHub Actions Python/Node test+deploy, GitLab CI Docker build, Jenkinsfile starter
 *  - commands           : explainJob, optimizePipeline, fixFailingRun, securityAudit
 *  - statusItem         : platform name + pipeline file count
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import type {
  IPlugin,
  PluginContextHook,
  PluginCodeLensAction,
  PluginCodeAction,
  PluginTransform,
  PluginTemplate,
  PluginStatusItem,
  PluginCommand,
} from '../core/plugin';
import type { IServices } from '../core/services';
import type { AIRequest } from '../core/aiService';

// ── Detection ─────────────────────────────────────────────────────────────────

export type CICDPlatform =
  | 'github-actions'
  | 'gitlab-ci'
  | 'jenkins'
  | 'circleci'
  | 'azure-pipelines'
  | 'bitbucket-pipelines';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build', '.venv', 'venv',
  '.terraform', 'vendor', '.next', 'out', 'target',
]);

interface PlatformProbe {
  platform:    CICDPlatform;
  /** Returns the absolute paths of files that match this platform. */
  find:        (wsPath: string) => string[];
}

const PROBES: PlatformProbe[] = [
  {
    platform: 'github-actions',
    find: (ws) => {
      const dir = path.join(ws, '.github', 'workflows');
      if (!fs.existsSync(dir)) return [];
      try {
        return fs.readdirSync(dir)
          .filter(f => /\.ya?ml$/i.test(f))
          .map(f => path.join(dir, f));
      } catch { return []; }
    },
  },
  {
    platform: 'gitlab-ci',
    find: (ws) => {
      const f = path.join(ws, '.gitlab-ci.yml');
      return fs.existsSync(f) ? [f] : [];
    },
  },
  {
    platform: 'jenkins',
    find: (ws) => {
      const matches: string[] = [];
      try {
        for (const entry of fs.readdirSync(ws)) {
          if (/^Jenkinsfile($|\.)/.test(entry)) matches.push(path.join(ws, entry));
        }
      } catch { /* skip */ }
      return matches;
    },
  },
  {
    platform: 'circleci',
    find: (ws) => {
      const dir = path.join(ws, '.circleci');
      if (!fs.existsSync(dir)) return [];
      const candidates = ['config.yml', 'config.yaml'];
      return candidates
        .map(c => path.join(dir, c))
        .filter(p => fs.existsSync(p));
    },
  },
  {
    platform: 'azure-pipelines',
    find: (ws) => {
      const candidates = ['azure-pipelines.yml', 'azure-pipelines.yaml'];
      return candidates
        .map(c => path.join(ws, c))
        .filter(p => fs.existsSync(p));
    },
  },
  {
    platform: 'bitbucket-pipelines',
    find: (ws) => {
      const candidates = ['bitbucket-pipelines.yml', 'bitbucket-pipelines.yaml'];
      return candidates
        .map(c => path.join(ws, c))
        .filter(p => fs.existsSync(p));
    },
  },
];

/** Detect which CI/CD platforms have config files in the workspace. */
export function detectPlatforms(wsPath: string): Array<{ platform: CICDPlatform; files: string[] }> {
  const results: Array<{ platform: CICDPlatform; files: string[] }> = [];
  for (const probe of PROBES) {
    const files = probe.find(wsPath);
    if (files.length > 0) results.push({ platform: probe.platform, files });
  }
  return results;
}

/** Identify the platform for a given pipeline file path (used by CodeLens / CodeActions). */
export function platformForFile(filePath: string): CICDPlatform | null {
  const norm = filePath.replace(/\\/g, '/');
  if (/\.github\/workflows\/[^/]+\.ya?ml$/i.test(norm))    return 'github-actions';
  if (/\.gitlab-ci\.yml$/i.test(norm))                     return 'gitlab-ci';
  if (/Jenkinsfile($|\.)/.test(path.basename(filePath)))    return 'jenkins';
  if (/\.circleci\/config\.ya?ml$/i.test(norm))            return 'circleci';
  if (/azure-pipelines\.ya?ml$/i.test(norm))               return 'azure-pipelines';
  if (/bitbucket-pipelines\.ya?ml$/i.test(norm))           return 'bitbucket-pipelines';
  return null;
}

// ── Lightweight YAML parsing (regex-based — full parser would be overkill) ────

interface PipelineSummary {
  platform:        CICDPlatform;
  file:            string;
  jobs:            string[];
  secretsReferenced: string[];
  runners:         string[];
  hasMatrix:       boolean;
  hasConcurrency:  boolean;
  /** Action references like 'actions/checkout@v4' or 'actions/setup-python@abc123'. */
  actionRefs:      string[];
  /** Action references that are NOT pinned to a commit SHA (security risk). */
  unpinnedActions: string[];
}

function parsePipelineSummary(file: string, content: string, platform: CICDPlatform): PipelineSummary {
  const summary: PipelineSummary = {
    platform,
    file,
    jobs:              [],
    secretsReferenced: [],
    runners:           [],
    hasMatrix:         false,
    hasConcurrency:    false,
    actionRefs:        [],
    unpinnedActions:   [],
  };

  // Jobs: GitHub Actions / GitLab / CircleCI / Azure all have a "jobs:" block;
  // Bitbucket uses "pipelines:" with steps; Jenkinsfile is Groovy DSL.
  if (platform === 'jenkins') {
    // Stages in declarative pipelines:  stage('Build') { … }
    const stagePattern = /stage\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = stagePattern.exec(content)) !== null) summary.jobs.push(m[1]);
  } else {
    // YAML-based: indented "  jobname:" lines under a top-level "jobs:" key.
    const jobsBlock = /^jobs:\s*$([\s\S]*?)(?=^\S|\Z)/m.exec(content);
    if (jobsBlock) {
      const jobPattern = /^  ([\w.-]+):\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = jobPattern.exec(jobsBlock[1])) !== null) summary.jobs.push(m[1]);
    }
  }

  // Secrets: ${{ secrets.NAME }} (GitHub Actions), $CI_..., $SECRET_NAME (GitLab/Jenkins env)
  const secretPattern = /\$\{\{\s*secrets\.([\w]+)\s*\}\}/g;
  let sm: RegExpExecArray | null;
  while ((sm = secretPattern.exec(content)) !== null) {
    if (!summary.secretsReferenced.includes(sm[1])) summary.secretsReferenced.push(sm[1]);
  }

  // Runners: GitHub Actions "runs-on:", Azure "vmImage:", CircleCI "executor:"
  const runnerPatterns = [
    /^\s*runs-on:\s*([^\n#]+)/gm,
    /^\s*vmImage:\s*([^\n#]+)/gm,
    /^\s*executor:\s*([^\n#]+)/gm,
  ];
  for (const rp of runnerPatterns) {
    let m: RegExpExecArray | null;
    while ((m = rp.exec(content)) !== null) {
      const r = m[1].replace(/['"]/g, '').trim();
      if (r && !summary.runners.includes(r)) summary.runners.push(r);
    }
  }

  summary.hasMatrix      = /\bmatrix:\s*$/m.test(content) || /\bstrategy:\s*$/m.test(content);
  summary.hasConcurrency = /^\s*concurrency:/m.test(content);

  // Action references (GitHub Actions): uses: owner/name@ref
  if (platform === 'github-actions') {
    const usesPattern = /uses:\s*([^\s@]+)@([^\s#\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = usesPattern.exec(content)) !== null) {
      const ref = `${m[1]}@${m[2]}`;
      if (!summary.actionRefs.includes(ref)) summary.actionRefs.push(ref);
      // SHA pin = 40 hex chars. Anything shorter (v4, main, etc.) is mutable.
      if (!/^[0-9a-f]{40}$/i.test(m[2])) summary.unpinnedActions.push(ref);
    }
  }

  return summary;
}

// ── Context data shape ────────────────────────────────────────────────────────

interface CICDContext {
  platforms:          CICDPlatform[];
  pipelines:          PipelineSummary[];
  totalJobs:          number;
  unpinnedActions:    number;
  hasOIDCSetup:       boolean;
  primaryPlatform:    CICDPlatform | null;
}

// ── The plugin ────────────────────────────────────────────────────────────────

export class CICDPlugin implements IPlugin {
  readonly id          = 'cicd';
  readonly displayName = 'CI/CD';
  readonly icon        = '$(github-action)';

  private _wsPath          = '';
  private _platforms:    CICDPlatform[] = [];
  private _pipelineCount = 0;

  // ── detect ────────────────────────────────────────────────────────────────

  async detect(ws: vscode.WorkspaceFolder | undefined): Promise<boolean> {
    if (!ws) return false;
    return detectPlatforms(ws.uri.fsPath).length > 0;
  }

  // ── activate ──────────────────────────────────────────────────────────────

  async activate(_services: IServices, _vsCtx: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    this._wsPath = ws?.uri.fsPath ?? '';

    if (this._wsPath) {
      const detected = detectPlatforms(this._wsPath);
      this._platforms     = detected.map(d => d.platform);
      this._pipelineCount = detected.reduce((sum, d) => sum + d.files.length, 0);
    }

    console.log(`[Evolve AI] CI/CD plugin activated: ${this._platforms.join(', ')} (${this._pipelineCount} file(s))`);
    return [];
  }

  // ── deactivate ────────────────────────────────────────────────────────────

  async deactivate(): Promise<void> {
    this._wsPath = '';
    this._platforms = [];
    this._pipelineCount = 0;
  }

  // ── contextHooks ──────────────────────────────────────────────────────────

  readonly contextHooks: PluginContextHook[] = [
    {
      key: 'cicd.pipelines',

      async collect(ws): Promise<unknown> {
        const wsPath = ws?.uri.fsPath ?? '';
        if (!wsPath) {
          return {
            platforms: [], pipelines: [], totalJobs: 0,
            unpinnedActions: 0, hasOIDCSetup: false, primaryPlatform: null,
          } as CICDContext;
        }

        const detected = detectPlatforms(wsPath);
        const pipelines: PipelineSummary[] = [];
        for (const { platform, files } of detected) {
          for (const f of files) {
            try {
              const content = fs.readFileSync(f, 'utf8');
              pipelines.push(parsePipelineSummary(path.relative(wsPath, f), content, platform));
            } catch { /* skip unreadable */ }
          }
        }

        const totalJobs       = pipelines.reduce((s, p) => s + p.jobs.length, 0);
        const unpinnedActions = pipelines.reduce((s, p) => s + p.unpinnedActions.length, 0);
        // OIDC indicator: at least one pipeline has `permissions: id-token: write`
        const hasOIDCSetup = pipelines.some(p => {
          const fullPath = path.join(wsPath, p.file);
          try {
            const text = fs.readFileSync(fullPath, 'utf8');
            return /permissions:[\s\S]{0,200}id-token:\s*write/m.test(text);
          } catch { return false; }
        });

        const data: CICDContext = {
          platforms:       detected.map(d => d.platform),
          pipelines,
          totalJobs,
          unpinnedActions,
          hasOIDCSetup,
          primaryPlatform: detected[0]?.platform ?? null,
        };
        return data;
      },

      format(data: unknown): string {
        const d = data as CICDContext;
        if (d.pipelines.length === 0) return '';

        const lines: string[] = ['## CI/CD Pipelines'];
        lines.push(`Platforms detected: ${d.platforms.join(', ')}`);
        lines.push(`Total pipelines: ${d.pipelines.length} · Total jobs: ${d.totalJobs}`);
        if (d.unpinnedActions > 0) {
          lines.push(`⚠ ${d.unpinnedActions} GitHub Action reference(s) not pinned to a commit SHA — supply-chain risk.`);
        }
        if (d.platforms.includes('github-actions') && !d.hasOIDCSetup && d.pipelines.some(p => p.secretsReferenced.length > 0)) {
          lines.push(`💡 Pipelines reference long-lived secrets but no OIDC permissions block found. Consider switching to OIDC for cloud auth.`);
        }
        for (const p of d.pipelines.slice(0, 4)) {
          lines.push(
            `- ${p.file} (${p.platform}): ${p.jobs.length} job(s)` +
            (p.secretsReferenced.length ? ` · secrets: ${p.secretsReferenced.slice(0, 3).join(', ')}` : '') +
            (p.hasMatrix ? ' · matrix' : '') +
            (p.hasConcurrency ? ' · concurrency-controlled' : ''),
          );
        }
        if (d.pipelines.length > 4) lines.push(`...and ${d.pipelines.length - 4} more.`);
        return lines.join('\n');
      },
    },
  ];

  // ── systemPromptSection ───────────────────────────────────────────────────

  systemPromptSection(): string {
    return `
## CI/CD Best Practices (Always-On)

### Universal principles
- **Pin third-party actions / images by commit SHA**, not floating tags. \`uses: actions/checkout@a1b2c3...\` is supply-chain-safe; \`@v4\` or \`@main\` is mutable and can be hijacked.
- **Use OIDC over long-lived credentials** for cloud auth. GitHub Actions → AWS / GCP / Azure / HashiCorp Vault all support OIDC. Long-lived \`AWS_ACCESS_KEY_ID\` in repo secrets is a credential-leak waiting to happen.
- **Fail fast** with explicit \`set -e\` (bash) or \`failFast: true\` (matrix) — silent test failures pass green builds.
- **Cache dependencies** keyed by lockfile hash. \`hashFiles('**/package-lock.json')\` for npm, \`hashFiles('**/poetry.lock')\` for poetry, \`hashFiles('**/Cargo.lock')\` for Rust.
- **Concurrency control** prevents overlapping deploys. GitHub: \`concurrency: { group: \${{ github.workflow }}-\${{ github.ref }}, cancel-in-progress: true }\` for branch builds.
- **Artifact retention**: production artifacts → 90 days, PR builds → 7 days. Storage cost adds up fast.
- **Least-privilege permissions**: GitHub Actions defaults to write-all for the GITHUB_TOKEN — explicitly set \`permissions: { contents: read }\` at the workflow level.
- **Don't echo secrets**: \`echo "$MY_SECRET"\` writes them to logs even if the value is masked. Use \`env:\` instead.
- **Test on the same OS you deploy to**. Linux runners differ subtly from production containers — match base images.

### GitHub Actions specifics
- Trigger discipline: \`on: push: branches: [main]\` for main builds; \`on: pull_request:\` for PR validation; \`on: workflow_dispatch:\` for manual runs.
- Reusable workflows live in \`.github/workflows/reusable-*.yml\` and are called via \`uses: ./.github/workflows/reusable-test.yml\`.
- Use \`needs:\` to gate jobs. Deploy job should \`needs: [test, lint, security-scan]\`.
- For PR security: \`pull_request_target\` runs in the base repo's context with secrets — only use it deliberately.
- Matrix-strategy excludes: \`exclude:\` to skip specific combinations rather than disabling the whole matrix.

### GitLab CI specifics
- Use \`stages:\` to declare execution order; jobs in the same stage run in parallel.
- \`rules:\` are preferred over deprecated \`only/except\`. \`if: '$CI_PIPELINE_SOURCE == "merge_request_event"'\`.
- \`needs:\` enables DAG mode (out-of-stage parallelism). Build → unit tests + lint in parallel → integration → deploy.
- \`extends:\` for job composition; merge with anchors (\`<<: *defaults\`) for shared config.
- Cache scoping: \`cache: { key: \${{ checksum "package-lock.json" }} }\`.

### Jenkins specifics
- **Declarative > scripted** unless you genuinely need Groovy logic. Declarative pipelines are easier to lint and audit.
- \`agent { label 'linux' }\` for executor selection. Don't use \`agent any\` in production — pins random worker.
- \`options { timeout(time: 30, unit: 'MINUTES') }\` to prevent stuck builds.
- \`environment { CREDENTIALS_ID = credentials('aws-prod') }\` injects credentials safely.
- Always use the **withCredentials** block for secrets; never echo them.

### Common anti-patterns to FIX
- \`uses: actions/checkout@main\` → pin to a commit SHA.
- \`run: echo \${{ secrets.TOKEN }}\` → use \`env: TOKEN: \${{ secrets.TOKEN }}\` then reference \`$TOKEN\`.
- \`if: github.ref == 'refs/heads/main'\` on every job → set at workflow-trigger level instead.
- Repeated \`apt-get install\` lines → cache them or use a custom runner image.
- Missing \`fail-fast: false\` in test matrices → one flaky platform fails the whole matrix.
- No \`timeout-minutes:\` on long jobs → stuck workflows consume runner minutes.
- \`continue-on-error: true\` masking real failures.
`.trim();
  }

  // ── codeLensActions ───────────────────────────────────────────────────────

  readonly codeLensActions: PluginCodeLensAction[] = [
    {
      title:       '$(github-action) Explain job',
      command:     'aiForge.cicd.explainJob',
      // Match indented "job-name:" under "jobs:" — heuristic, fires for likely job declarations
      linePattern: /^  [\w.-]+:\s*$/,
      languages:   ['yaml', 'yml'],
      tooltip:     'Explain what this CI job does and what could be improved',
    },
    {
      title:       '$(zap) Add cache step',
      command:     'aiForge.cicd.addCache',
      linePattern: /^\s*-\s*uses:\s*actions\/checkout/i,
      languages:   ['yaml', 'yml'],
      tooltip:     'Add a dependency cache step after checkout',
    },
    {
      title:       '$(symbol-array) Convert to matrix',
      command:     'aiForge.cicd.convertMatrix',
      linePattern: /^\s*runs-on:\s*\S+/,
      languages:   ['yaml', 'yml'],
      tooltip:     'Convert this job to a matrix strategy across versions / OSes',
    },
  ];

  // ── codeActions (lightbulb) ───────────────────────────────────────────────

  readonly codeActions: PluginCodeAction[] = [
    {
      title:     '$(shield) CI/CD: Replace long-lived secrets with OIDC',
      command:   'aiForge.cicd.useOIDC',
      kind:      'refactor',
      requiresSelection: false,
      languages: ['yaml', 'yml'],
    },
    {
      title:     '$(lock) CI/CD: Pin actions to commit SHA',
      command:   'aiForge.cicd.pinActions',
      kind:      'quickfix',
      requiresSelection: false,
      languages: ['yaml', 'yml'],
    },
    {
      title:     '$(pulse) CI/CD: Add concurrency control',
      command:   'aiForge.cicd.addConcurrency',
      kind:      'refactor',
      requiresSelection: false,
      languages: ['yaml', 'yml'],
    },
  ];

  // ── transforms ────────────────────────────────────────────────────────────

  readonly transforms: PluginTransform[] = [
    {
      label:       'Lint pipeline (find anti-patterns)',
      description: 'AI scans the file for security / reliability anti-patterns and rewrites them',
      extensions:  ['.yml', '.yaml'],
      async apply(content, filePath, _lang, services): Promise<string> {
        const platform = platformForFile(filePath) ?? 'github-actions';
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Review and fix this ${platform} pipeline file. Apply these fixes only if the relevant pattern is present:
- Pin action/image references to commit SHA where they're floating tags or branch names
- Replace long-lived cloud credentials with OIDC where the platform supports it
- Add explicit \`permissions: { contents: read }\` if missing at workflow level
- Add \`timeout-minutes:\` to jobs that can run > 5 min
- Add \`fail-fast: false\` to matrices testing multiple platforms
- Add \`concurrency:\` block to deploy/release workflows
- Move secret references out of \`run:\` into \`env:\`
- Cache dependencies keyed by lockfile hash

Do NOT add features the original author didn't intend. Be surgical.

File: ${filePath}
\`\`\`yaml
${content}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
          }],
          system: `You are a CI/CD pipeline expert specialising in ${platform}. Return only the complete updated file.`,
          instruction: `Lint ${platform} pipeline`,
          mode: 'edit',
        };
        return (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
      },
    },
    {
      label:       'Add OIDC auth (replace long-lived secrets)',
      description: 'Replace AWS_ACCESS_KEY_ID / GCP_KEY / AZURE_SP secrets with OIDC',
      extensions:  ['.yml', '.yaml'],
      async apply(content, filePath, _lang, services): Promise<string> {
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Convert this pipeline to use OIDC (OpenID Connect) for cloud auth instead of long-lived secrets.

Required steps:
1. Add \`permissions: { id-token: write, contents: read }\` at workflow or job level
2. Replace AWS_ACCESS_KEY_ID/SECRET → \`aws-actions/configure-aws-credentials@<SHA>\` with role-to-assume
3. Replace GCP service-account-key JSON → \`google-github-actions/auth@<SHA>\` with workload_identity_provider
4. Replace AZURE_CREDENTIALS JSON → \`azure/login@<SHA>\` with client-id + tenant-id (federated credential)
5. Leave a TODO comment with the IAM trust-policy snippet the user must add on the cloud side

File: ${filePath}
\`\`\`yaml
${content}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
          }],
          system: 'You are a cloud security expert. Return only the complete updated YAML file with OIDC.',
          instruction: 'Convert pipeline to OIDC auth',
          mode: 'edit',
        };
        return (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
      },
    },
  ];

  // ── templates ─────────────────────────────────────────────────────────────

  readonly templates: PluginTemplate[] = [
    {
      label:       'GitHub Actions: Python test + deploy',
      description: 'Test matrix, lint, type-check, deploy to PyPI on tag',
      prompt: () => `Generate a complete GitHub Actions workflow at \`.github/workflows/ci.yml\` for a Python project.

Requirements:
- Trigger on push to main and on PRs
- Test matrix: Python 3.10/3.11/3.12 on ubuntu-latest
- Steps: checkout (pinned to SHA), setup-python, cache pip by hashFiles('**/poetry.lock' or '**/requirements.txt'), install deps, run pytest with coverage, run ruff and mypy
- Workflow-level permissions: contents: read
- A separate \`publish\` job that runs only on tag pushes (\`if: startsWith(github.ref, 'refs/tags/v')\`), uses OIDC against PyPI's trusted-publisher feature, needs the test job to pass
- timeout-minutes: 15 on each job
- concurrency block on the test workflow with cancel-in-progress: true on PR builds

Format: provide the file as \`## .github/workflows/ci.yml\` followed by the YAML in a fenced block.`,
    },
    {
      label:       'GitHub Actions: Node + npm publish',
      description: 'Test matrix, build, publish to npm on tag with provenance',
      prompt: () => `Generate \`.github/workflows/ci.yml\` for a Node.js / TypeScript project.

Requirements:
- Test matrix: Node 18/20/22 on ubuntu-latest, fail-fast: false
- Steps: checkout, setup-node with cache: 'npm', npm ci, npm test, npm run lint, npm run build
- Workflow-level permissions: contents: read
- Separate publish job triggered on tag push (\`if: startsWith(github.ref, 'refs/tags/v')\`), needs: [test], permissions: { id-token: write, contents: read }, runs \`npm publish --provenance --access public\`
- All third-party actions pinned to a commit SHA (use placeholder SHAs in comments)
- timeout-minutes: 15

Format: \`## .github/workflows/ci.yml\` followed by the YAML in a fenced block.`,
    },
    {
      label:       'GitLab CI: Docker build + push',
      description: 'Build, test, container build, push to registry',
      prompt: () => `Generate \`.gitlab-ci.yml\` for a project that builds a Docker image and pushes to GitLab Container Registry.

Requirements:
- Stages: lint, test, build, deploy
- Each stage runs in a containerised job (image: ...:latest pinned by digest where practical)
- The build stage uses kaniko (or docker:dind) to build, tags with $CI_COMMIT_SHORT_SHA and 'latest', pushes to $CI_REGISTRY_IMAGE
- Deploy stage uses \`rules:\` to run only on main branch
- Caches between jobs keyed by composer / package-lock hash
- Use \`needs:\` for DAG mode (build can start as soon as lint passes)

Format: \`## .gitlab-ci.yml\` followed by the YAML in a fenced block.`,
    },
    {
      label:       'Jenkinsfile: declarative test pipeline',
      description: 'Multi-stage declarative pipeline with parallel test stages',
      prompt: () => `Generate a \`Jenkinsfile\` (declarative pipeline) for a project running on a Linux agent.

Requirements:
- agent { label 'linux' }
- options: timeout(time: 30, unit: 'MINUTES'), buildDiscarder(logRotator(numToKeepStr: '20'))
- environment block reading credentials via credentials() helper
- Stages: Checkout, Lint, Test (parallel branches: unit + integration), Build, Deploy (when: branch 'main')
- post block: always { junit '**/test-results/*.xml' }, failure { mail / slack notify }

Format: \`## Jenkinsfile\` followed by the Groovy in a fenced block.`,
    },
  ];

  // ── commands ──────────────────────────────────────────────────────────────

  readonly commands: PluginCommand[] = [
    {
      id: 'aiForge.cicd.explainJob',
      title: 'CI/CD: Explain Job',
      async handler(_services: IServices, ..._args: unknown[]): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('Open a CI/CD pipeline file first.'); return; }
        const text = editor.document.getText();
        const cursorLine = editor.selection.active.line + 1;
        const platform   = platformForFile(editor.document.uri.fsPath) ?? 'unknown';
        const instruction = `Explain the CI/CD job at line ${cursorLine} of this ${platform} pipeline.
- What does it do?
- What triggers it?
- Which steps are critical, which are convenience?
- Are there any anti-patterns or improvements you'd suggest?

\`\`\`yaml
${text}
\`\`\``;
        await vscode.commands.executeCommand('aiForge._sendToChat', instruction, 'chat');
      },
    },

    {
      id: 'aiForge.cicd.optimizePipeline',
      title: 'CI/CD: Optimize Pipeline',
      async handler(services: IServices, ..._args: unknown[]): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('Open a CI/CD pipeline file first.'); return; }
        const text = editor.document.getText();
        const platform = platformForFile(editor.document.uri.fsPath) ?? 'github-actions';

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Optimizing ${platform} pipeline…`, cancellable: false },
          async () => {
            const req: AIRequest = {
              messages: [{
                role: 'user',
                content: `Optimize this ${platform} pipeline for speed and reliability:
- Add dependency cache steps where dependencies are reinstalled
- Add timeout-minutes to long-running jobs
- Replace floating action tags with commit SHAs
- Move long-running steps in parallel where possible (DAG mode)
- Trim unnecessary checkouts / setup steps
- Add fail-fast: false on matrices testing multiple platforms
- Move secret references from \`run:\` into \`env:\`

Do NOT change semantics — preserve which steps run on which triggers.

\`\`\`yaml
${text}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
              }],
              system: `You are a ${platform} expert. Return only the complete updated YAML file.`,
              instruction: 'Optimize CI/CD pipeline',
              mode: 'edit',
            };
            const optimized = (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
            const decision  = await services.workspace.showDiff(text, optimized, 'Optimize pipeline');
            if (decision === 'apply') await services.workspace.applyToActiveFile(optimized);
          },
        );
      },
    },

    {
      id: 'aiForge.cicd.fixFailingRun',
      title: 'CI/CD: Fix Failing Run (paste log)',
      async handler(_services: IServices, ..._args: unknown[]): Promise<void> {
        const log = await vscode.window.showInputBox({
          prompt: 'Paste the failing CI run log (or its tail with the error). The AI will diagnose against your pipeline file.',
          ignoreFocusOut: true,
          validateInput: v => v && v.length > 20 ? null : 'Paste at least the error portion of the log.',
        });
        if (!log) return;

        const editor = vscode.window.activeTextEditor;
        const pipelineFile = editor?.document.getText() ?? '';
        const platform     = editor ? platformForFile(editor.document.uri.fsPath) : null;

        // Tail the log so we don't blow context budget.
        const tail = log.length > 6000 ? '...(log truncated)\n' + log.slice(-6000) : log;

        const instruction = `My ${platform ?? 'CI/CD'} pipeline run failed. Diagnose the failure and propose a fix.

What you have:
1. The tail of the failing run log
2. The pipeline file (active editor)

Tasks:
- Identify the root cause (not just the error string — the underlying reason)
- Propose a specific fix (which line, what change)
- If the cause is environmental (missing secret, runner image quirk), say so explicitly
- If multiple plausible causes exist, rank them

Failing log:
\`\`\`
${tail}
\`\`\`

${pipelineFile ? `Pipeline file:\n\`\`\`yaml\n${pipelineFile}\n\`\`\`` : '(No pipeline file open — paste it next time for sharper diagnosis.)'}`;
        await vscode.commands.executeCommand('aiForge._sendToChat', instruction, 'chat');
      },
    },

    {
      id: 'aiForge.cicd.addCache',
      title: 'CI/CD: Add Cache Step',
      async handler(services: IServices, ..._args: unknown[]): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const text = editor.document.getText();
        const platform = platformForFile(editor.document.uri.fsPath) ?? 'github-actions';
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Add appropriate dependency cache steps to this ${platform} pipeline.

Detect language(s) used (Python, Node, Rust, Go, Java, etc.) and add platform-appropriate cache steps:
- npm/yarn/pnpm → cache by hashFiles of lockfile
- pip/poetry → cache pip dir by hashFiles of poetry.lock or requirements.txt
- cargo → cache target/ and ~/.cargo by hashFiles of Cargo.lock
- gradle/maven → cache ~/.gradle/caches or ~/.m2 by hashFiles of build.gradle / pom.xml

Place the cache step immediately after the checkout step.

\`\`\`yaml
${text}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
          }],
          system: `${platform} expert. Return only the complete updated YAML file.`,
          instruction: 'Add cache step',
          mode: 'edit',
        };
        const updated = (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
        await services.workspace.applyToActiveFile(updated);
      },
    },

    {
      id: 'aiForge.cicd.convertMatrix',
      title: 'CI/CD: Convert to Matrix Strategy',
      async handler(services: IServices, ..._args: unknown[]): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const text = editor.document.getText();
        const platform = platformForFile(editor.document.uri.fsPath) ?? 'github-actions';
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Convert the current job in this ${platform} pipeline to a matrix strategy.

If the file is for a typed/interpreted language, default to:
- Python: 3.10/3.11/3.12
- Node: 18/20/22
- Go: 1.21/1.22
- Rust: stable + beta + nightly (optional)

Test against ubuntu-latest only by default. Add \`fail-fast: false\` so one failure doesn't cancel the others.

\`\`\`yaml
${text}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
          }],
          system: `${platform} expert. Return only the complete updated YAML file.`,
          instruction: 'Convert to matrix strategy',
          mode: 'edit',
        };
        const updated = (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
        await services.workspace.applyToActiveFile(updated);
      },
    },

    {
      id: 'aiForge.cicd.useOIDC',
      title: 'CI/CD: Replace Long-Lived Secrets with OIDC',
      async handler(services: IServices, ..._args: unknown[]): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const text = editor.document.getText();
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Convert this GitHub Actions workflow to use OIDC for cloud auth instead of long-lived credentials.

Apply changes:
1. Add \`permissions: { id-token: write, contents: read }\` at workflow level (or job level if more appropriate)
2. AWS: replace AWS_ACCESS_KEY_ID/SECRET with \`aws-actions/configure-aws-credentials@<SHA>\` and \`role-to-assume:\`
3. GCP: replace JSON key with \`google-github-actions/auth@<SHA>\` and \`workload_identity_provider:\`
4. Azure: replace AZURE_CREDENTIALS JSON with \`azure/login@<SHA>\` using client-id/tenant-id

Add a TODO comment showing the IAM trust policy / workload-identity-pool config the user must set up on the cloud side.

\`\`\`yaml
${text}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
          }],
          system: 'GitHub Actions + cloud security expert. Return only the complete updated YAML file.',
          instruction: 'Convert to OIDC auth',
          mode: 'edit',
        };
        const updated  = (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
        const decision = await services.workspace.showDiff(text, updated, 'Convert to OIDC auth');
        if (decision === 'apply') await services.workspace.applyToActiveFile(updated);
      },
    },

    {
      id: 'aiForge.cicd.pinActions',
      title: 'CI/CD: Pin Actions to Commit SHA',
      async handler(services: IServices, ..._args: unknown[]): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const text = editor.document.getText();
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Convert all GitHub Actions \`uses:\` references in this workflow from floating tags / branch names to commit SHAs.

For each \`uses: owner/name@<ref>\`:
- If \`<ref>\` is a 40-char hex SHA: leave it.
- Otherwise, use a placeholder SHA \`# pin-me\` and add a comment with the original tag (e.g. \`# v4.1.1\`) so the user can resolve it via \`gh api repos/owner/name/git/ref/tags/v4.1.1\`.

Don't invent SHAs — leaving \`# pin-me\` placeholders is correct.

\`\`\`yaml
${text}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
          }],
          system: 'GitHub Actions security expert. Return only the complete updated YAML file with pin-me placeholders.',
          instruction: 'Pin actions to commit SHA',
          mode: 'edit',
        };
        const updated = (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
        await services.workspace.applyToActiveFile(updated);
      },
    },

    {
      id: 'aiForge.cicd.addConcurrency',
      title: 'CI/CD: Add Concurrency Control',
      async handler(services: IServices, ..._args: unknown[]): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const text = editor.document.getText();
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Add a concurrency block to this GitHub Actions workflow at workflow level.

Use the form:
\`\`\`yaml
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}
\`\`\`

This cancels in-flight runs when a new PR commit lands but lets main-branch deploys queue safely.

If the file already has a concurrency block, leave it alone.

\`\`\`yaml
${text}
\`\`\`

Return ONLY the complete updated YAML, no explanation, no fences.`,
          }],
          system: 'GitHub Actions expert. Return only the complete updated YAML file.',
          instruction: 'Add concurrency control',
          mode: 'edit',
        };
        const updated = (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
        await services.workspace.applyToActiveFile(updated);
      },
    },
  ];

  // ── statusItem ────────────────────────────────────────────────────────────

  readonly statusItem: PluginStatusItem = {
    text: async (): Promise<string> => {
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) return '$(github-action) CI/CD';

      const detected = detectPlatforms(ws.uri.fsPath);
      if (detected.length === 0) return '$(github-action) CI/CD';

      const total = detected.reduce((sum, d) => sum + d.files.length, 0);
      const platformsLabel = detected.length === 1
        ? detected[0].platform
        : `${detected.length} platforms`;
      return `$(github-action) ${platformsLabel} · ${total} pipeline${total === 1 ? '' : 's'}`;
    },
  };
}
