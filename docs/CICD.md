# CI/CD plugin + Setup Wizard

> **Status:** Released in v2.1.0. Mirrors the Gemma 4 Setup Wizard and the Git Connect Wizard pattern — a focused plugin plus a one-click wizard that takes the user from "no pipeline" to a stack-tailored starter file with the quality bar built in.

---

## What it does

Evolve AI now treats **CI/CD authoring** as a first-class concern, the same way it already treats dbt models, Airflow DAGs, and Spark jobs.

Two surfaces:

1. **The CI/CD plugin** auto-activates when it sees an existing pipeline file. Once active, it contributes platform-aware best practices into every AI prompt and adds CodeLens / lightbulb / transform actions tailored to that platform.
2. **The CI/CD Setup Wizard** generates a starter pipeline tailored to your stack the first time. It detects your language / package manager / test framework / git host, asks four short questions, and writes a working file to the right path with the security and reliability bar already met.

---

## Supported platforms

| Platform | Detected via | Output path |
|---|---|---|
| GitHub Actions       | `.github/workflows/*.yml`         | `.github/workflows/ci.yml` |
| GitLab CI/CD         | `.gitlab-ci.yml`                  | `.gitlab-ci.yml` |
| Jenkins              | `Jenkinsfile`, `Jenkinsfile.*`    | `Jenkinsfile` |
| CircleCI             | `.circleci/config.yml`            | `.circleci/config.yml` |
| Azure Pipelines      | `azure-pipelines.yml`             | `azure-pipelines.yml` |
| Bitbucket Pipelines  | `bitbucket-pipelines.yml`         | `bitbucket-pipelines.yml` |

Multi-platform repos are supported — the plugin lists every detected platform in the chat header (`$(github-action) 2 platforms · 4 pipelines`).

---

## The plugin

When any pipeline file is in your workspace, the CI/CD plugin contributes:

### Context hook (`cicd.pipelines`)

Parses each pipeline file and exposes a structured summary into AI prompts:
- **Jobs** detected per file (parses `jobs:` blocks for YAML, `stage('Name') { … }` for Jenkinsfiles)
- **Secrets referenced** (`${{ secrets.NAME }}` for GitHub Actions, `$VAR` patterns for GitLab/Jenkins env)
- **Runners** (`runs-on:`, `vmImage:`, `executor:`)
- **Matrix strategy presence** (`matrix:` / `strategy:`)
- **Concurrency-controlled** (`concurrency:` block at workflow level)
- **Action references** (`uses: owner/name@ref`) with **unpinned-SHA detection** — anything not a 40-hex SHA is a supply-chain risk
- **OIDC indicator** — does any pipeline have `permissions: id-token: write`?

The summary surfaces in the user prompt, so when you ask *"why is my deploy job slow?"* the AI sees the actual jobs and their structure.

### System prompt section (~3 KB)

Always-on platform-aware best-practice knowledge:
- Pin third-party actions / images by commit SHA, not floating tags. `uses: actions/checkout@v4` is mutable; `@a1b2c3...` is supply-chain-safe.
- Use OIDC over long-lived credentials. GitHub Actions → AWS / GCP / Azure / HashiCorp Vault all support OIDC.
- Fail fast (`set -e`, `failFast: true`); cache by lockfile hash; concurrency control on deploys; least-privilege `permissions:`; never echo secrets.
- Platform-specific subsections for GitHub Actions, GitLab, Jenkins.

### CodeLens

| Lens | Where it shows | What it does |
|---|---|---|
| `$(github-action) Explain job` | Above each `  jobname:` declaration | AI explains the job and suggests improvements |
| `$(zap) Add cache step` | After `- uses: actions/checkout` | Adds a dependency cache step keyed by lockfile hash |
| `$(symbol-array) Convert to matrix` | Above `runs-on:` lines | Converts the job to a matrix strategy across versions/OSes |

### Lightbulb (CodeActions)

Right-click a YAML pipeline file or hit `Ctrl+.`:
- `$(shield) CI/CD: Replace long-lived secrets with OIDC`
- `$(lock) CI/CD: Pin actions to commit SHA`
- `$(pulse) CI/CD: Add concurrency control`

### Transforms (Apply Transform to Folder)

- **Lint pipeline (find anti-patterns)** — AI scans for security/reliability issues and rewrites surgically.
- **Add OIDC auth (replace long-lived secrets)** — Converts AWS / GCP / Azure auth to OIDC, leaves a TODO with the IAM trust-policy snippet.

### Templates (Generate from Description)

- GitHub Actions: Python test + deploy (PyPI Trusted Publisher)
- GitHub Actions: Node + npm publish (with provenance)
- GitLab CI: Docker build + push to GitLab Container Registry
- Jenkinsfile: declarative test pipeline

### Commands

| Command | Description |
|---|---|
| `aiForge.cicd.explainJob`        | Explain the CI job at the cursor. Used by CodeLens. |
| `aiForge.cicd.optimizePipeline`  | Refactor the active pipeline file for speed and reliability — adds missing caches, timeouts, fail-fast, etc. Shows a diff before applying. |
| `aiForge.cicd.fixFailingRun`     | Paste the tail of a failing CI run log. The AI diagnoses against your active pipeline file and proposes a specific fix. |
| `aiForge.cicd.addCache`          | Add a dependency cache step after the checkout step. |
| `aiForge.cicd.convertMatrix`     | Convert the current job to a matrix strategy across language versions / OSes. |
| `aiForge.cicd.useOIDC`           | Replace long-lived AWS/GCP/Azure secrets with OIDC (federated credentials). Adds a TODO with the cloud-side IAM trust policy. |
| `aiForge.cicd.pinActions`        | Mass-replace floating action tags (`@v4`, `@main`) with `# pin-me` SHA placeholders. |
| `aiForge.cicd.addConcurrency`    | Add a workflow-level concurrency block: cancel in-progress on PR, queue on main. |
| `aiForge.cicd.setup.stageAndCommit` | Stage the wizard-written file, commit, push, and open a PR. Forces a feature-branch dialog on protected branches. AI drafts a Conventional Commits message; you review before commit. After commit, offers `Push & open PR` (creates PR via GitHub / Bitbucket API or falls back to opening the platform's compare URL). Set `aiForge.cicd.openPRAfterCommit: false` to stop after the commit. |

### Status item

`$(github-action) github-actions · 3 pipelines` (or `$(github-action) 2 platforms · 4 pipelines` for multi-platform repos) appears in the chat header when the plugin is active.

---

## The Setup Wizard

Run **Evolve AI: CI/CD Setup Wizard** from the command palette (or `aiForge.cicd.setup.start`).

### What it inspects (read-only)

| Probe | What it checks |
|---|---|
| Language | `package.json` → node, `pyproject.toml` / `requirements.txt` / `setup.py` → python, `go.mod` → go, `Cargo.toml` → rust, `pom.xml` / `build.gradle` → java, `*.csproj` → dotnet |
| Package manager | `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` / `poetry.lock` / `Pipfile` / `Cargo.lock` / etc. |
| Test framework | Reads `pyproject.toml` for pytest, `package.json` deps for jest/vitest/mocha, infers go-test / cargo-test / junit / xunit |
| Git host | `git remote get-url origin` — recommends the matching CI platform |
| Existing CI | All six recognised pipeline locations |

All probes have timeouts and never throw. Workspace must be trusted.

### Wizard flow

1. **Intro screen** — shows detected stack and what the wizard will do. Click **Start wizard** or **Cancel**.
2. **Pick subproject** *(monorepos only — added in v2.3.0)* — if the wizard finds multiple subprojects (depth-2 scan for `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `*.csproj`), it asks which one this pipeline targets. Each entry shows the manifest filename and detected language. The wizard then re-inspects stack signals (language / package manager / test framework) scoped to that subproject, and the eventual pipeline filename is suffixed with the subproject name (e.g. `.github/workflows/ci-web.yml`, `.github/workflows/ci-api.yml`). Skipped entirely when only one subproject (or none) exists.
3. **Pick CI platform** — quick-pick lists all six platforms; the one matching your git host is starred as recommended.
4. **Platform warning** *(monorepos + Bitbucket / CircleCI / GitLab only)* — Bitbucket Pipelines and CircleCI only read one config file at their canonical path, so the wizard surfaces a modal explaining the trade-off (only one pipeline per repo; jobs are scoped via `working_directory` / `cd ...` instead of separate files). GitLab gets a similar note about needing to set `CI_CONFIG_PATH` if the file isn't at the default path.
5. **Confirm overwrite** — only fires if a file already exists at the target path. Modal warning, default cancel.
6. **Pick template**:
   - **Test only** — lint + tests on PR / push. Safest starter, no deploy step.
   - **Test + deploy** — adds a deploy job triggered on tag push.
   - **Test + container build + deploy** — adds a Docker build step before deploy.
7. **Pick deploy target** *(only if template includes deploy)*:
   - npm registry (OIDC trusted-publisher)
   - PyPI (Trusted Publisher — no token needed)
   - Docker registry (ghcr / Docker Hub)
   - AWS ECS service update (OIDC)
   - AWS Lambda (OIDC)
   - GCP Cloud Run (workload identity federation)
   - Azure App Service (federated credentials)
   - Kubernetes (kubectl apply)
   - None (skip the deploy step entirely)
8. **AI generates** — under a cancellable progress notification, builds a prompt that includes your detected stack and a hard quality bar:
   - Pin third-party actions / images to commit SHA (uses `# pin-me` placeholders)
   - Workflow-level `permissions: { contents: read }`
   - `timeout-minutes: 15` on each job
   - Cache dependencies keyed by lockfile hash (lockfile path is scoped to the chosen subproject in monorepo mode)
   - Concurrency control: cancel in-progress on PR, queue on main
   - OIDC for cloud auth where the platform supports it
   - Secrets in `env:` blocks, not `run:` strings
   - *In monorepo mode:* platform-specific working-directory idiom (GitHub Actions `defaults: { run: { working-directory: ... } }`, GitLab `cd $CI_WORK_DIR`, Jenkins `dir('...') { ... }`, etc.) and trigger-path filters so the pipeline only runs when files in the targeted subproject change.
9. **Writes the file** to the right path (`.github/workflows/ci.yml` for repo-root projects; `.github/workflows/ci-<subproject>.yml` for monorepo subprojects), opens it for review, and surfaces a checklist of follow-ups.

### Stage & Commit (closing the loop)

After the wizard writes the file, the success toast offers a **Stage & Commit** button. Clicking it runs `aiForge.cicd.setup.stageAndCommit`, which:

1. Verifies you're inside a git repo and the workspace is trusted (refuses to act otherwise).
2. **Branch protection**: if you're on a protected branch (`main`, `master`, `develop`, `production`, `release`, `trunk`) it shows a modal: *"You're on protected branch `main`. Create a feature branch `feat/setup-cicd` and switch to it?"* — only **Create branch** or **Cancel**, no override. This prevents accidental commits to a branch your team's protection rules would reject.
3. Runs `git add -- <wizard-file>` — exactly the file the wizard wrote, never `git add -A`. Bystander changes (a modified `.env`, in-flight feature work) are left untouched.
4. Reads the staged diff and asks the AI to draft a one-line **Conventional Commits** message (e.g. `ci: add GitHub Actions workflow for Python tests + PyPI publish`).
5. Shows the drafted message in an editable InputBox. Edit, accept, or cancel.
6. On accept: `git commit -m <message>`.
7. On cancel: **unstages** the file via `git reset HEAD --` so you don't end up with half-staged state.

After the commit (added in v2.2.0):

8. **Push & PR.** A follow-up toast asks: *"Committed `…`. Push to origin and open a pull request?"* with `Push & open PR`, `Push only`, and `Skip`.
9. On `Push & open PR`:
   - **Pushes the branch** to `origin`. First push automatically uses `-u` so upstream tracking is set. Never force-pushes; if the remote has diverged, surfaces a clean toast with a `git pull --rebase` hint instead.
   - **Detects host + default branch** (`refs/remotes/origin/HEAD` first, then `git remote show origin`, falling back to `main`).
   - Asks **Draft vs Standard PR**.
   - **Creates the PR via API:** GitHub uses the existing `vscode.authentication` session; Bitbucket uses `aiForge.bitbucketPAT` (stored by the Git Connect Wizard). GitLab / other / any API failure → opens the platform's `compare` page pre-filled with title + body so you click "Create PR" once.
   - **Returns the PR URL** in a toast with `Open in browser` and `Copy link`.

To disable the automatic push + PR step and stop at the commit, set:

```jsonc
"aiForge.cicd.openPRAfterCommit": false
```

What Stage & Commit deliberately still does **not** do:

- **No force push.** If the push is rejected non-fast-forward, you resolve it manually — that's a sign someone else has pushed to the same branch.
- **No multi-file batching.** Only the single file the wizard wrote.
- **No standalone "push current branch + PR" command** — Stage & Commit must follow a wizard run. We may generalise this in v2.3+ if it proves useful.

### Follow-up checklist

After the wizard finishes (whether you used Stage & Commit or did it manually):

- [ ] Replace any `# pin-me` placeholders with real action SHAs. Quick one-liner: `gh api repos/actions/checkout/git/ref/tags/v4 | jq -r .object.sha`.
- [ ] Configure required secrets in your CI provider (the wizard surfaces which secret names the file references).
- [ ] Branch-protect main: require this workflow to pass before merge.
- [ ] Run a test PR to verify the workflow runs end-to-end.

---

## Privacy & security

| Concern | What we do |
|---|---|
| Tokens | Wizard does NOT request CI tokens. The AI generates files locally; the user pushes through their existing git auth. |
| Workspace trust | Wizard refuses to run in untrusted workspaces (matches the policy in `configSafe.readHostSetting`). |
| Existing files | Never overwritten without explicit modal confirmation. |
| Live infrastructure | The wizard never makes API calls to GitHub / GitLab / Bitbucket / cloud providers. It only writes a local file. |
| Secrets | The plugin's transforms / commands never read your repo's secret values — they reference them by name (`${{ secrets.AWS_ROLE }}`). |

---

## Troubleshooting

### Wizard says "language: unknown"

The inspector looks for the standard manifest files. If your project uses an unusual layout (a polyglot monorepo, a Bazel workspace, etc.), you'll get a generic language-agnostic pipeline. Add language-specific steps after generation.

### Generated pipeline has `# pin-me` placeholders

The AI cannot fetch live action SHAs offline. Replace each placeholder with the real SHA before merging:

```bash
gh api repos/actions/checkout/git/ref/tags/v4 | jq -r .object.sha
```

### `Fix Failing Run` returns generic advice

Paste *more* of the log — at least the error itself plus 20-30 lines around it. The AI diagnoses better with the actual stderr / exit code than just "build failed".

### The plugin doesn't activate for my pipeline file

Confirm the file is at one of the recognised paths:
- `.github/workflows/*.yml` (case-sensitive `.github`)
- `.gitlab-ci.yml`
- `Jenkinsfile` (capital J, no extension; `Jenkinsfile.deploy` also matches)
- `.circleci/config.yml`
- `azure-pipelines.yml`
- `bitbucket-pipelines.yml`

Custom paths (e.g. `ci/build.yml`) aren't auto-detected. The plugin's commands still work if you invoke them from the command palette with the file open.

### Wizard generated a file but didn't open it

Some Cursor / VSCodium forks don't fire `vscode.workspace.openTextDocument` synchronously. Check the path the wizard's success toast names; the file is on disk regardless of whether the editor opened.

### Pipeline file is correct but my CI provider rejects it

The plugin generates **valid** YAML / Groovy, but your provider may have account-specific constraints (organisation policies, runner availability, branch-protection rules). Check the provider's UI for the actual error after the first run. Use `Fix Failing Run` to feed that error back to the AI.

---

## Architecture (for contributors)

The wizard mirrors the Gemma 4 / Git Connect setup pattern intentionally — see [ARCHITECTURE.md](ARCHITECTURE.md) for the broader picture.

| File | Role |
|---|---|
| `src/plugins/cicd.ts`                  | The auto-detecting plugin. ~900 lines. Contributes contextHook / systemPromptSection / CodeLens / CodeActions / transforms / templates / commands / statusItem. |
| `src/core/cicdSetupOrchestrator.ts`    | Stack detection (`CICDStackInspector`) + plan/execute (`CICDSetupOrchestrator`). |
| `src/commands/cicdSetupCommands.ts`    | The user-facing wizard command (`aiForge.cicd.setup.start` + `aiForge.cicd.setup.status`). Uses VS Code QuickPicks / InputBoxes — no webview. |
| `src/plugins/index.ts`                 | One-line plugin registration: `registry.register(new CICDPlugin())`. |
| `src/extension.ts`                     | One-line wizard registration: `new CICDSetupCommands(svc).register()`. |

Re-uses the shared `processUtil.runForStdout` / `versionLessThan` helpers from `src/core/processUtil.ts` (also used by the Gemma 4 and Git Connect wizards).

The wizard's services are not added to `IServices` — they're instantiated inside the command class because they have no shared state. If a future plugin needs to programmatically generate pipelines, we'll lift them into `IServices` then.
