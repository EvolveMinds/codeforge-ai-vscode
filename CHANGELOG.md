# Changelog

All notable changes to Evolve AI are documented here.

## [2.5.2] — 2026-06-18

### Fixed

- **Premature "Request timed out after 60 seconds" on local models.** The HTTP streaming engine used a fixed 60s socket timeout that was never re-armed, so local models (e.g. `qwen2.5-coder:7b` on CPU) that take longer than a minute to load on the first request timed out even though they were working — and a long-but-actively-streaming response could be cut off mid-answer.
  - The timeout is now an **idle** timeout: it resets on every streamed chunk, so it only fires when the socket goes genuinely silent (no connection, no first byte, or a mid-stream stall), never while tokens are still flowing.
  - **Provider-aware defaults**: 300s for local runtimes (Ollama / Gemma 4 / Hugging Face, which can cold-start for minutes) and 120s for cloud APIs (Anthropic / OpenAI / Gemini).
  - New setting **`aiForge.requestTimeoutMs`** (default `0` = auto) to override.
  - The timeout message now distinguishes a local cold-start from cloud latency and points at the new setting.

## [2.5.1] — 2026-06-10

### Fixed

- **Marketplace README badges showed "retired".** shields.io deprecated its `visual-studio-marketplace/*` badge family, so the version and installs badges rendered a literal "retired" label on the Marketplace listing. Switched to `vsmarketplacebadges.dev` (the maintained replacement) for version / installs / rating, and made the license a static MIT badge so it no longer hits shields.io's rate-limited GitHub token pool ("Unable to select next GitHub token from pool"). No functional change.

## [2.5.0] — 2026-06-01

### Added — Google Gemini as a first-class AI provider

Gemini now has its own entry in the provider switcher alongside Claude, OpenAI, Ollama, Gemma 4 and Hugging Face — its own API key, model picker, and status-bar/header branding. Previously Gemini was only reachable by repurposing the OpenAI provider with a custom base URL.

**How to use it:**

1. Get an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Click **Switch** in the chat header → **Google Gemini** → paste your key → pick a model.
3. The key is stored in VS Code's encrypted `SecretStorage` (`aiForge.geminiKey`), never in `settings.json`.

**Models offered:** `gemini-2.5-pro`, `gemini-2.5-flash` (default), `gemini-2.0-flash`, `gemini-2.0-flash-lite`, plus a custom-ID option.

**Implementation notes:**

- Talks to Gemini's **official OpenAI-compatible endpoint** (`https://generativelanguage.googleapis.com/v1beta/openai`), so the SSE streaming parser, mid-stream cancellation (`AbortSignal`), and HTTP error handling are reused verbatim from the OpenAI path.
- Gemini is classified as a **cloud provider**: PII-tagged lineage columns are redacted before being sent (same guard as Anthropic / OpenAI / Hugging Face), and the cloud-consent dialog is shown on first switch.

**Settings added:**

- `aiForge.geminiModel` (default `gemini-2.5-flash`)
- `aiForge.geminiBaseUrl` (default the compat endpoint above — change only for a proxy)

**SecretStorage key added:** `aiForge.geminiKey`.

## [2.4.0] — 2026-05-24

### Added — Pre-push gating for CI/CD pipeline anti-patterns

The CI/CD plugin (v2.1.0) catches anti-patterns in your editor. v2.4.0 catches them at **push time** with a per-repo opt-in git hook, so supply-chain risks (unpinned actions) and credential-leak risks (long-lived AWS/GCP/Azure keys) never reach origin.

**How it works:**

1. Run `Evolve AI: Install CI/CD Pre-Push Hook`. The wizard:
   - Detects whether `.git/hooks/pre-push` already exists. If it's not ours, offers **Append our check** / **Replace** / **Cancel** — never silently clobbers other hooks.
   - Detects Husky (`.husky/` directory). If found, writes to `.husky/pre-push` instead so Husky doesn't overwrite our hook on next `husky install`.
   - Asks for the mode: **Block** (default), **Warn**, or **Off**.
2. On every `git push`, the hook computes the pipeline-file diff (using `git diff --name-only @{push}..HEAD` semantics), pipes the file list to `scripts/check-pipelines.js`, and either allows or blocks the push based on findings.
3. Bypass any specific push with `git push --no-verify` (standard git mechanism — we don't override it).

**Rule split (hard-block vs warn):**

| Rule | Severity | Reason |
|---|---|---|
| Unpinned `uses: owner/name@v4` references (anything but a 40-char SHA) | **Block** | Supply-chain attack vector — a hijacked tag silently runs new code on every CI run. |
| Long-lived cloud creds in secrets (`AWS_ACCESS_KEY_ID`, `GCP_SA_KEY`, `AZURE_CLIENT_SECRET`, etc.) | **Block** | Credential-leak risk — these rotate manually and live in repo secrets indefinitely. Use OIDC. |
| Missing top-level `permissions:` block (GitHub Actions) | **Warn** | Implicit write permissions on `GITHUB_TOKEN`. |
| Job without `timeout-minutes` | **Warn** | Runaway runs can sit idle for 6h burning runner minutes. |
| No `concurrency:` block | **Warn** | Duplicate runs race / waste runner minutes. |

The warn tier exists deliberately — gating on every nit trains users to reach for `--no-verify`, which is worse than no hook at all.

**Files added:**

- `scripts/check-pipelines.js` — self-contained Node script (no extension imports). Survives extension uninstall: hook prints a one-line "extension is gone, remove me" notice and exits 0 (never blocks if extension is missing).
- `src/core/hookInstaller.ts` — `installHook()`, `uninstallHook()`, `detectHookState()` returning `'none' | 'ours' | 'theirs' | 'husky'`. Respects `core.hooksPath` config for teams using shared hook directories.

**Three new commands:**

| Command | Purpose |
|---|---|
| `aiForge.cicd.installHook` | Install / update the pre-push hook for the current repo. Handles conflicts, Husky detection, mode selection. |
| `aiForge.cicd.uninstallHook` | Remove the hook (or strip our appended block if we shared the file with another hook). Refuses to touch hooks we didn't write. |
| `aiForge.cicd.checkPipelinesNow` | Dry-run the checker against the current workspace's pipeline files. Useful to verify install + see what the hook would say without pushing. |

**One new setting:**

| Key | Default | Purpose |
|---|---|---|
| `aiForge.cicd.hookMode` | `block` | `block` (refuse pushes with hard issues), `warn` (surface but allow), or `off` (skip all checks — disables hook without uninstalling it). |

**Cross-platform:** Hook is POSIX shell. Works on Git for Windows (MINGW64 sh), macOS, and Linux. No PowerShell or .bat hook.

**What's NOT in v2.4.0 (deferred):**

- **No pre-commit hook** — only pre-push for now. Pre-commit would catch issues earlier but doubles install surface; most users push immediately after commit.
- **No auto-install on workspace open** — always explicit opt-in. Hooks are too intrusive to install silently.
- **No per-rule severity override** — single global mode (block/warn/off). Per-rule control adds complexity without clear demand yet.
- **No detection of `pre-commit` framework** (the Python one) or **lefthook** — could add later.

## [2.3.0] — 2026-05-24

### Added — Monorepo support for the CI/CD Setup Wizard

The CI/CD Setup Wizard used to assume the entire workspace was a single project rooted at the workspace folder. v2.3.0 detects sub-projects (Next.js + Python backend, `apps/web` + `apps/api`, `services/*` layouts, etc.) and lets you pick which one a pipeline targets.

**How it works:**

1. **Subproject detection** — `CICDStackInspector.detectSubprojects()` scans up to **2 levels deep** for known manifest files (`package.json`, `pyproject.toml`, `setup.py`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `*.csproj`). Skips `node_modules`, `.git`, `.venv`, `dist`, `target`, `build`, `vendor`, etc. Hard-capped at **200 directory visits / 30 entries per directory** so monorepos with thousands of folders don't hang the wizard.
2. **Subproject QuickPick** — when ≥2 subprojects are found, the wizard inserts a new step between the intro and the platform pick: *"Multiple subprojects detected (N). Which one is this pipeline for?"* Each entry shows the manifest filename + detected language.
3. **Re-inspection scoped to the chosen subproject** — language, package manager, and test framework are recomputed against the subproject's files (not the repo root). The wizard's intro summary now includes `scope: <subproject>` when applicable.
4. **Output filename disambiguation** — pipeline files **stay at the repo root** (CI providers don't look in subdirectories), but the filename is disambiguated by a slug derived from the subproject's directory name:
   - `apps/web` → `.github/workflows/ci-web.yml`
   - `services/api` → `.github/workflows/ci-api.yml`
5. **Platform-specific warnings** — Bitbucket Pipelines and CircleCI only read **one** config file at a canonical path. The wizard surfaces a modal warning when picking those platforms for a subproject, explaining the trade-off (single-pipeline-per-repo limit; jobs scoped via `working_directory` / `cd ...`). GitLab gets a warning that `CI_CONFIG_PATH` must be set if writing to a non-default path.
6. **AI prompt instructs working-directory idiom per platform** — when targeting a subproject, the prompt tells the AI to:
   - GitHub Actions: set `defaults: { run: { working-directory: <subproject> } }` + `paths:` trigger filter
   - GitLab CI: `cd $CI_WORK_DIR` + `rules: changes:`
   - Jenkins: wrap stages in `dir('<subproject>') { ... }`
   - CircleCI: `working_directory: ~/project/<subproject>` on every job
   - Azure: `workingDirectory:` on every script step + `paths:` filter
   - Bitbucket: prefix each step's script with `cd <subproject> && ...`
7. **Cache keys reference the subproject lockfile**, not the root.

**Files edited:**

- `src/core/cicdSetupOrchestrator.ts` — new `Subproject` interface, `detectSubprojects()`, `slugifySubproject()`, scoped `inspect(ws, subprojectRel)`. `outputPathFor()` now takes a slug; `pipelinePathWarning()` surfaces single-pipeline-per-repo platform constraints. `buildPrompt()` injects monorepo working-directory instructions.
- `src/commands/cicdSetupCommands.ts` — new `_pickSubproject()` QuickPick. `start()` re-inspects scoped to the chosen subproject. `_collectChoices()` threads subproject + slug into the resulting `CICDChoice` and surfaces the platform warning.

**Why this matters:** ~half of new repos in 2025+ are monorepo-shaped (Turborepo, Nx, pnpm workspaces, uv workspaces, Go workspaces). Without subproject scoping, the wizard would write a pipeline that ran tests against the wrong directory's manifest and dependencies — a real footgun. This was item #4 on the deferred-work inventory.

## [2.2.0] — 2026-05-24

### Added — Stage & Commit closes the loop: now Stage → Commit → Push → PR (Level E)

The CI/CD Setup Wizard's `Stage & Commit CI/CD Setup` command used to stop after the commit. v2.2.0 finishes the loop: it pushes the branch and opens a pull request, all in one flow.

**New behaviour after a successful commit:**

1. **Push the branch** to `origin`. First-time push adds `-u` automatically so upstream tracking is set. Never force-pushes — if the remote has diverged, surfaces a clean toast with a `git pull --rebase` hint.
2. **Detect the host** (GitHub / Bitbucket / GitLab / other) and **default branch** (`refs/remotes/origin/HEAD` → `git remote show origin` fallback → `main`).
3. **Offer Draft vs Standard PR.**
4. **Create the PR** via API where possible:
   - **GitHub** — uses `vscode.authentication.getSession('github', ['repo'])`. Same session the Git Connect Wizard establishes; no extra config needed.
   - **Bitbucket** — uses `aiForge.bitbucketPAT` (stored by the Git Connect Wizard as `username:app_password`).
   - **GitLab / other / any API failure** — opens the platform's `compare` URL pre-filled with title + body so the user just clicks "Create PR" in the browser.
5. **Surface the PR URL** in a toast with `Open in browser` and `Copy link` actions. Stashes the URL in workspace state keyed by branch.

**Files added:**

- `src/core/gitPushUtil.ts` — `pushBranch()` (no force, auto-`-u` on first push), `getDefaultBranch()`, `getCurrentBranch()`, `getOriginUrl()`, `parseOwnerRepo()`.
- `src/core/prCreator.ts` — `createPR()` (GitHub + Bitbucket API paths), `compareUrl()` (browser fallback for GitHub / Bitbucket / GitLab).

**Files edited:**

- `src/commands/cicdSetupCommands.ts` — extended `stageAndCommit()` with `_pushAndOpenPR()`, `_openPRForBranch()`, `_showPRSuccess()`, `_showPushFailure()`.
- `package.json` — new setting `aiForge.cicd.openPRAfterCommit` (boolean, default `true`).

**New setting:**

| Key | Default | Purpose |
|---|---|---|
| `aiForge.cicd.openPRAfterCommit` | `true` | After Stage & Commit succeeds, offer to push + open PR. Set to false to stop at the commit. |

**Scope decisions (kept narrow for v2.2):**

- **CI/CD-only.** Only `stageAndCommit` invokes the new push + PR flow. v2.3 may generalise this into a shared `commitWizard` service that any plugin can opt into.
- **No force pushing**, ever. If push fails with `non-fast-forward`, we surface the error and let the user resolve manually.
- **No "Push current branch + open PR" standalone command** — wizard-only for now to keep the surface small.
- **Default branch is detected**, not hardcoded — works with repos using `master`, `trunk`, `develop`, etc.

## [2.1.1] — 2026-05-24

### Distribution — Open VSX

- Republished v2.1.0 to **Open VSX Registry** under publisher `evolvecode-ai`. Same feature set as 2.1.0 — version bumped only because each marketplace tracks publisher metadata inside the `.vsix`, so a republish under a different namespace requires a fresh version. VS Code Marketplace remains on 2.1.0 (no functional changes); Open VSX users (VSCodium, Cursor, Theia, Gitpod, code-server) can now `Install Extension` directly. No code changes.

## [2.1.0] — 2026-05-09

### Added — DevOps authoring bundle

**1. CI/CD plugin (`src/plugins/cicd.ts`).** Auto-detects every common pipeline file: GitHub Actions (`.github/workflows/*.yml`), GitLab CI (`.gitlab-ci.yml`), Jenkins (`Jenkinsfile`), CircleCI (`.circleci/config.yml`), Azure Pipelines, Bitbucket Pipelines. Once active, the plugin:

- **Context hook (`cicd.pipelines`)**: parses each file and exposes a structured summary — jobs, secrets referenced, runners, matrix presence, concurrency presence, action references with unpinned-SHA detection. Pipeline-aware AI prompts.
- **System-prompt section (~3 KB)**: consolidated CI/CD best practices — pin actions to commit SHA, OIDC over long-lived secrets, fail-fast / matrix-strategy / cache-by-lockfile-hash, concurrency control, least-privilege `permissions:`, secret-leak prevention. Platform-specific subsections for GitHub Actions, GitLab, Jenkins.
- **CodeLens**: *Explain job* (above each job declaration), *Add cache step* (after checkout), *Convert to matrix* (above runs-on lines).
- **Lightbulb (CodeActions)**: *Replace long-lived secrets with OIDC*, *Pin actions to commit SHA*, *Add concurrency control*.
- **Transforms**: *Lint pipeline (find anti-patterns)*, *Add OIDC auth (replace long-lived secrets)*.
- **Templates**: GitHub Actions Python test+deploy with PyPI Trusted Publisher, Node + npm publish with provenance, GitLab CI Docker build+push, Jenkinsfile declarative starter.
- **Commands**: `aiForge.cicd.explainJob`, `aiForge.cicd.optimizePipeline`, `aiForge.cicd.fixFailingRun` (paste log → AI diagnoses against active pipeline file), `aiForge.cicd.addCache`, `aiForge.cicd.convertMatrix`, `aiForge.cicd.useOIDC`, `aiForge.cicd.pinActions`, `aiForge.cicd.addConcurrency`.
- **Status item**: `$(github-action) github-actions · 3 pipelines` in the chat header when active.

**2. CI/CD Setup Wizard (`src/core/cicdSetupOrchestrator.ts` + `src/commands/cicdSetupCommands.ts`).** Mirrors the Git Connect Wizard pattern. `Evolve AI: CI/CD Setup Wizard` walks the user through a first-time pipeline setup:

- **Inspector** detects: language (`package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `pom.xml` / `*.csproj`), package manager (npm/yarn/pnpm/pip/poetry/cargo/maven/gradle), test framework (jest/vitest/pytest/go-test/cargo-test/junit/xunit), git host (parsed from `origin` URL — recommends the matching CI platform).
- **Wizard UX**: pick platform (recommended one is starred) → pick template (test-only / + deploy / + container build + deploy) → pick deploy target (npm / PyPI / Docker registry / AWS ECS / AWS Lambda / GCP Cloud Run / Azure App Service / k8s / none).
- **Generation**: builds an AI prompt that includes the detected stack and a hard quality bar (pinned actions, OIDC, cache by lockfile hash, concurrency control, timeouts). The output file is written to the right path (`.github/workflows/ci.yml`, `.gitlab-ci.yml`, etc.) and opened for review with a checklist of follow-ups.
- **Stage & Commit follow-up** (`aiForge.cicd.setup.stageAndCommit`): the wizard's success toast now offers a **Stage & Commit** button that closes the loop. Stages exactly the file the wizard wrote (never `git add -A`), forces a feature-branch dialog if the user is on `main` / `master` / `develop` / `production` / `release` / `trunk`, asks the AI to draft a Conventional Commits message from the staged diff, shows it in an editable InputBox, and commits when the user confirms. Cancelling the InputBox unstages the file so no half-finished state is left behind. Push and PR creation are deliberately deferred to v2.2 once the in-the-wild UX is validated.
- **Safety**: refuses to run in untrusted workspaces, asks before overwriting an existing pipeline file.

**3. Marketplace + discoverability**. Description and keywords expanded with `ci/cd`, `cicd`, `continuous integration`, `github actions`, `gitlab ci`, `jenkins`, `circleci`, `azure pipelines`, `bitbucket pipelines`, `devops`, `pipeline`, `oidc`, `workflow` so devops users searching for these terms find Evolve AI.

### Fixed
- **`insecure-url` security-rule false positives**. The pattern was flagging `http://` literals inside markdown code spans (`` `http://` ``) in release-notes strings, `'http://'` / `"http://"` quoted prefixes used by URL classifiers (`url.startsWith('http://')`), and prose like `"http:// or https://"` in setting descriptions / error messages. Two-part fix: tightened the pattern to require a hostname character (`[\w.-]`) immediately after `://` so `http:// ` (with trailing whitespace, i.e. prose) no longer matches; extended the rule's `exclude` regex to skip backtick code spans and quoted-prefix string literals. Real `fetch("http://attacker.com")` matches still flagged, loopback still skipped. Full-codebase + `package.json` rescan: zero false positives.

## [2.0.2] — 2026-05-09

### Fixed
- **AI ignored the user's question and recited security findings / errors instead.** Reported on Ollama Qwen 7B: asking *"can you read my repo and understand the application?"* returned a list of XSS warnings and HTTP-URL findings from the active file. Root cause: `buildUserPrompt` placed `## Instruction` at the *end* of the prompt, after the active file, errors, git status, security scan, and every plugin's context block. Small local models latch onto the first large block they see — usually the security scan — and treat it as the question.
  - **Fix:** `## Instruction` is now the **first** block in every user prompt, with a `## Reminder` block repeating it at the bottom for long-context models that anchor on recency. Both anchoring strategies are now satisfied simultaneously.
  - **System prompt strengthened** with a `HOW TO READ THE PROMPT` section that explicitly tells the model: the user's question is in the Instruction block; other blocks are background context; for meta questions describe the project at a high level rather than reciting plugin findings.

### Changed
- **Context chip rewritten in plain English.** Previously showed raw hook keys like `15 error(s) · databricks · security.findings · git.status · git.connection · git.recentCommits · aws · aws-live` below every user message — looked alarming on casual questions and gave no signal about what the AI actually received. Now reads `Context sent: 📄 src/foo.ts · 3 diagnostics · 2 plugin signals · 18% of context budget` so users see exactly what went to the model and how much of the budget was used.

## [2.0.1] — 2026-05-09

### Fixed
- **"What's New" sometimes showed AI-hallucinated content (e.g. a generic AWS Toolkit cheat-sheet) instead of the actual release notes.** Root cause: `aiForge.whatsNew` focused the chat panel and then posted release notes through `_postInfoToChat`, which (a) raced the webview's message-listener wire-up so the payload was occasionally dropped, and (b) stole focus to the chat input — meaning any in-flight keystrokes could submit a stray AI prompt that got rendered in the same panel. Fix: release notes (and the Gemma 4 info screen) now open as a read-only Markdown preview tab via `markdown.showPreview`. Zero webview, zero AI involvement, identical rendering on every platform. Falls back to a plain Markdown editor tab on forks that don't ship the markdown preview command.

## [2.0.0] — 2026-05-08

### Added — Git/Bitbucket Connect Wizard
- **One-click wizard** that takes a user from "fresh folder" or "disconnected repo" to a verified remote, mirroring the Gemma 4 setup wizard pattern. Run **Evolve AI: Connect Git Remote (Wizard)** from the command palette, or click the `· not connected` hint in the status bar.
- **Detects** git installation + version, global identity (`user.name` / `user.email`), repo state (init? branch? has commits?), remote configuration (origin URL, host, protocol), SSH keys in `~/.ssh`, GitHub CLI presence + auth state, an existing VS Code GitHub session, the user's current `credential.helper`, and previously-stored PATs.
- **Walks** the user through whichever steps are missing: installs git via official installer / `xcode-select` / package manager, sets identity, runs `git init` / `git clone` / `git remote add origin`, configures auth, optionally **creates a new repo on GitHub or Bitbucket via API**, optionally `git push -u origin HEAD`, and finally verifies with `git ls-remote origin`.
- **Four auth methods**, picked from a quick pick filtered to what makes sense for the host:
  - **VS Code GitHub auth** (`vscode.authentication.getSession('github', …)`) — recommended for github.com; no token to paste, refresh handled for you.
  - **Personal Access Token / Bitbucket App Password** — validates against `GET /user` (GitHub) or `GET /2.0/user` (Bitbucket) before storing in `vscode.SecretStorage`.
  - **SSH** — generates an ed25519 keypair via `ssh-keygen` (no shell quoting issues on Windows), copies `.pub` to clipboard, opens the platform's "Add SSH key" page, then tests with `ssh -T`.
  - **GitHub CLI** — runs `gh auth login` in a managed terminal; only offered if `gh --version` works.
- **Four new commands**: `aiForge.gitConnect.start`, `aiForge.gitConnect.status`, `aiForge.gitConnect.disconnect`, `aiForge.gitConnect.testConnection`.
- **Four new settings** under `aiForge.gitConnect.*`: `preferredAuth`, `autoVerify`, `pushOnConnect`, `statusHint`.
- **Two new SecretStorage keys**: `aiForge.githubPAT`, `aiForge.bitbucketPAT`. Tokens never touch `settings.json`.
- **First-run nudge**: when a repo with no remote opens, a single non-blocking toast offers to run the wizard. Dismissed forever via "Don't show again".
- **Status bar hint**: the Git plugin's status item appends `· not connected` when no `origin` is configured (toggle via `aiForge.gitConnect.statusHint`).
- **AI context hook**: a new `git.connection` plugin context hook tells the AI whether the workspace is connected to a remote and which platform it's on.
- See [docs/GIT_CONNECT.md](docs/GIT_CONNECT.md) for the full guide, troubleshooting, and what gets stored where.

### Security & privacy
- Wizard **refuses to run** in untrusted workspaces.
- An existing `credential.helper` is **never overwritten** — when one is present, we use SecretStorage + a URL-embedded token (with explicit consent) instead.
- SSH private keys are **never read**; we only ever generate them at the user's request and copy the `.pub` to the clipboard.
- All API calls have a 10s timeout and degrade to a single error toast — no nested errors, no silent hangs.

### Refactor
- Extracted spawn-with-timeout helpers into a new `src/core/processUtil.ts`. `hardwareInspector.ts` and `setupOrchestrator.ts` now share `runCommand`, `runForStdout`, `waitForCommand`, and `versionLessThan` helpers with the new wizard, killing three near-duplicate copies of the pattern.

### Marketplace
- Description and keywords expanded with "github setup", "bitbucket connect", "git wizard", "ssh key", "personal access token", "git remote" so users searching for git-onboarding tooling find Evolve AI.

## [1.9.0] — 2026-05-04

### Added — DE #4: Airflow DAG Simulator
- **Static analysis for Airflow DAG files** — no Python interpreter required. Detects cycles, broken `>>` edges, duplicate `task_id`s, missing `default_args.retries`, sensors with `mode='poke'` + long timeouts (slot starvation), missing `catchup=False` with past `start_date`, invalid cron expressions, `@task` functions referenced without `()` in dependency chains, and missing `default_args` entirely.
- **Inline diagnostics** — yellow/red squiggles on the offending lines, identified by source `aiForge.airflow` so they can be selectively dismissed without affecting Pylance / Ruff.
- **CodeLens at line 0** of every DAG file: `$(circuit-board) Airflow DAG: 7 tasks · 2 warnings — open simulator`. Click opens the simulator panel.
- **Simulator panel** (`Ctrl+Alt+D` / `⌘⌥D`): stats (tasks, edges, root/leaf, longest path), ASCII task graph, issue list grouped by severity with click-to-jump, and a **Fix all with AI** button that pipes the issue list + DAG into the chat panel for an AI rewrite.
- **Three commands**: `Airflow: DAG Simulator`, `Airflow: Re-run DAG Simulator`, `Airflow: Fix DAG Issues with AI`.
- **Three settings** (under `aiForge.airflow.simulator.*`): `enabled`, `runOnSave`, `severity`.
- See `docs/AIRFLOW_SIMULATOR.md` for the full guide.

### Changed
- **Marketplace description and keywords overhauled** — now leads with the data-engineering features (lineage, query cost, dbt impact, Airflow simulator) so DEs searching for "dbt lineage", "bigquery cost", "airflow lint" etc. can find the extension.

## [1.8.0] — 2026-05-04

### Added — DE #3: dbt Manifest Integration
- **Downstream impact analysis for dbt models.** Open any model and Evolve AI now shows what depends on it — direct + transitive downstream models, exposures with owners + types + URLs, and total tests in the impacted graph.
- **Impact CodeLens** at the top of every model: `$(symbol-class) Impact: 4 downstream · 1 exposure · 12 tests`.
- **Impact panel** (`Ctrl+Alt+I` / `⌘⌥I`): direct + transitive descendants with materialization, exposures with owners, total tests, plus upstream parents and sources.
- **Refactor with AI (impact-aware)** button: pipes the downstream impact summary into the chat panel so AI rewrites stay aware of what they could break.
- **Two new commands**: `dbt: List Exposures` (quick-pick across every exposure with owner + type + upstream count), `dbt: Refresh Manifest Cache`.
- **Two settings**: `aiForge.dbt.impactCodeLensEnabled`, `aiForge.dbt.impactDepth`.

### Changed
- **Extracted `target/manifest.json` reader** from `dbtLineage.ts` into a shared `src/plugins/dbtManifest.ts` module. Both v1.5.0's lineage-aware context (column schemas) and this release's impact analysis now share one mtime-cached parse.

### Docs
- New `docs/DBT_MANIFEST.md` — user-facing guide.

## [1.7.2] — 2026-05-02

### Fixed
- **Editor title-bar icon was rendering in muted gray on dark themes**, making it almost invisible against the VS Code background. The single `title-icon.svg` used `fill="currentColor"`, which inherited the *muted* toolbar foreground rather than the active foreground. Replaced with two theme-specific files — `media/title-icon-dark.svg` (light gray `#E8E8E8` for dark themes) and `media/title-icon-light.svg` (near-black `#1F1F1F` for light themes) — wired through both the `editor/title` menu contribution and the `WebviewPanel.iconPath`. Now reads cleanly on every built-in VS Code theme, matching the contrast level of the Claude Code / Copilot icons in the same toolbar.

## [1.7.1] — 2026-05-02

### Fixed
- **Editor title-bar icon was invisible on macOS** (and frequently hidden inside the `…` overflow on crowded title bars). Two fixes: (1) the menu contribution no longer pins itself to `navigation@99`, which had been pushing the icon into the overflow whenever other extensions claimed earlier slots; it now joins the regular `navigation` group with default ordering. (2) The icon used the existing thin-stroke `sidebar-icon.svg`, which read fine at 32 px in the activity bar but disappeared at 16 px in the editor title bar. A new dedicated `media/title-icon.svg` (bolder, filled, 16×16-optimised) ships for both the title-bar button and the editor tab itself.
- **Removed the `resourceScheme == file` guard** on the title-bar button so the icon also appears for remote files (SSH, WSL, Codespaces) and other non-`file://` schemes where users still want the chat.

## [1.6.0] — 2026-05-02

### Added
- **Claude-style editor-tab chat.** A new icon appears in the top-right title bar of every file editor. Clicking it opens the chat as a regular tab to the right of your code (`ViewColumn.Beside`), mirroring how Claude Code and Copilot Chat appear. Single-instance — clicking the icon again reveals the existing tab. The tab and the sidebar share state in real time, so you can keep one open without losing the conversation in the other.
- **Mode pill above the input.** Replaces the old `Chat / Edit / Create` tab strip with a single Claude-style pill that opens a popover listing all three modes with descriptions and a checkmark on the active one. Frees vertical space and matches mainstream AI-chat UX.
- **In-chat model picker.** A second pill shows the current model and opens a popover with same-provider alternatives — installed Ollama models (live), Gemma 4 variants (e2b/e4b/26b/31b), Anthropic models (Opus 4.7 / Opus 4.6 / Sonnet 4.6 / Haiku 4.5), OpenAI (gpt-4o / gpt-4o-mini / o1-mini / o3-mini), and Hugging Face presets. The user's currently configured value always appears first so a custom model never disappears.
- **"More providers…" escape hatch** at the bottom of the model popover triggers the existing `aiForge.switchProvider` quick-pick for cross-provider changes (handles API-key prompts via SecretStorage as before).
- **`aiForge.openChatTab` command** — also reachable from the command palette and bindable to a custom keyboard shortcut.

### Changed
- `ChatPanelProvider` is now multi-surface. Both the sidebar `WebviewView` and the editor-tab `WebviewPanel` attach to the same provider via the new `attachSurface(...)` API, so the two views never drift out of sync.
- `status` payload sent to the webview now includes `availableModels` (array, same-provider) so the model pill can render without an extra round-trip.

### Fixed
- **Status payload model name was wrong for cloud providers.** Previously `currentModel` always read from `aiForge.ollamaModel` regardless of the active provider, so the chat header showed the Ollama model name even when Anthropic or OpenAI was active. Now resolves the correct setting per provider (`anthropicModel` / `openaiModel` / `huggingfaceModel` / `gemma4Model` / `ollamaModel`).

## [1.7.0] — 2026-05-03

### Added — DE #2: Query Cost / Perf Preview for Databricks + BigQuery
- **`$(zap) Preview cost` CodeLens** above every detected SQL statement (standalone `.sql` files plus `spark.sql("...")` blocks in PySpark). Click runs a dry-run / EXPLAIN against the connected engine: bytes scanned, estimated USD cost, rows, tables, warnings, and a plan excerpt. **No actual execution.**
- **DatabricksQueryAnalyzer** — runs `EXPLAIN COST` on a SQL warehouse with fallback to plain `EXPLAIN` on older runtimes. Parses `Statistics(sizeInBytes=…, rowCount=…)` blocks. Sticky warehouse choice via `aiForge.queryAnalysis.databricksWarehouseId`.
- **BigQueryQueryAnalyzer** — `jobs.insert` with `dryRun: true`. Free on BigQuery's side. Pulls `totalBytesProcessed` and `referencedTables`.
- **Heuristic warnings** (engine-agnostic): `SELECT *`, missing partition filter on date-y columns, `CROSS JOIN`, wide date range (>180d via `DATE_SUB`). Engine warnings stack on top: `large-scan` when scan exceeds 50 GB.
- **QueryAnalysisPanel** — refresh button + **Optimise with AI** button that pipes the analysis into the chat panel so the AI's rewrite is grounded in real cost data.
- **Settings**: `aiForge.queryAnalysis.enabled`, `databricksUsdPerTb`, `bigqueryUsdPerTb`, `databricksWarehouseId`. Keybinding `Ctrl+Alt+Q` / `⌘⌥Q`.
- See `docs/QUERY_ANALYSIS.md`.

## [1.5.0] — 2026-05-02

### Added — DE #1: Lineage-Aware Context for dbt + Databricks
- **AI prompts now include real upstream column schemas.** Open a dbt model or PySpark notebook and Evolve AI walks the file for upstream references — `{{ ref() }}` / `{{ source() }}`, `spark.table()`, `spark.sql(...)` — then looks up real schemas from `target/manifest.json` (with `schema.yml` fallback) or Unity Catalog. **No more hallucinated column names.**
- **Five UI surfaces** over the same data: CodeLens (column count + stale warnings), Hover (table + column details), Completion (real columns after `table.`), Diagnostics (broken-ref squiggle + Levenshtein "did you mean…?" suggestions), and a **Lineage Explorer panel** (`Ctrl+Alt+L` / `⌘⌥L`).
- **Chat panel pre-send check** — when a user instruction references a column that doesn't exist in the resolved schemas, Evolve AI flags it pre-send with fuzzy suggestions.
- **Privacy**: columns tagged `pii` / `pci` / `sensitive` are **redacted** before prompts reach cloud providers (Anthropic / OpenAI / HF). Local providers (Ollama / Gemma 4) always get the full schema.
- **New contribution point**: `IPlugin.lineageHooks: PluginLineageHook[]` — `extract(file)` → refs, `resolve(refs)` → schemas. Two implementations ship: dbt and Databricks Connected.
- **Settings**: `aiForge.lineage.enabled`, `includePii`, `maxUpstreamTables`, `providerOrder`.
- See `docs/LINEAGE.md`.

## [1.4.3] — 2026-04-19

### Fixed
- **Keyboard shortcuts now render correctly on macOS.** The chat panel's welcome message, Gemma 4 first-use tip, and `Evolve AI: Gemma 4 Info & Tips` output previously displayed `Ctrl+Shift+A` etc. regardless of platform. They now show `Cmd+Shift+A` on macOS (detected via `process.platform === 'darwin'`). The underlying keybindings themselves were already cross-platform — only the displayed labels were Windows/Linux-only.
- **Gemma 4 Info shortcuts table expanded** — now shows both Windows/Linux and macOS columns side-by-side instead of only the Windows/Linux form.
- **Chat panel welcome block** uses a platform-aware `MOD` constant (`Cmd` on macOS, `Ctrl` elsewhere) injected at HTML-template time.

### Improved
- **"What's New" toast text is no longer version-specific.** Previously read *"Evolve AI updated to X.Y.Z — now with Gemma 4 support!"* which went stale after the initial Gemma 4 release. Now reads *"Evolve AI updated to X.Y.Z. See what's new in this release."* — neutral and accurate for every future release.

## [1.4.2] — 2026-04-19

### Fixed
- **What's New and Gemma 4 Info commands no longer show plugin-context preamble.** Previously these commands sent their pre-written markdown through the AI pipeline, which prepended Git Status, Recent Commits, and Security Scan sections (from plugin context hooks) and then round-tripped everything through the configured AI provider. The AI's response echoed both the context and the original content, polluting the chat display. These informational commands now render directly in the chat panel as static markdown — zero AI calls, zero context injection, zero plugin-data leakage.

### Added
- New internal command `aiForge._postInfoToChat` + `ChatPanelProvider._sendInfo()` — a static-info rendering path for pre-written markdown that bypasses the AI and context pipeline. Used by `whatsNew` and `gemma4Info`. Not exposed to users; intended for future informational commands.

### Security
- **`aiForge.ollamaHost` schema hardened** — added `"pattern": "^https?://"` to package.json so the VS Code settings UI validates the scheme before writing. Complements the existing runtime `readHostSetting` + `warnIfRemoteHost` defences (from 1.4.1) by rejecting `file://`, `javascript:`, `ftp://`, and typos at the settings editor.

## [1.4.1] — 2026-04-19

### Fixed
- **Gemma 4 setup crashed with "aiForge.gemma4Model is not a registered configuration"** on fresh installs/upgrades. Caused by a known VS Code race (issues [#115992](https://github.com/microsoft/vscode/issues/115992), [#90249](https://github.com/microsoft/vscode/issues/90249)) where the Configuration Registry hadn't ingested the extension's new settings schema before the wizard tried to write them.

### Added
- **Proactive "Reload required" notification** — on every activation, the extension probes whether its own settings schema is loaded. If not (auto-update race), a non-blocking toast appears asking the user to reload, **before** they can hit any broken path. Tracked per-version in globalState so users aren't nagged.
- **`src/core/configSafe.ts`** — `safeUpdateConfig` and `persistOrPromptReload` helpers that detect the registry race at write time, fall back to Workspace target, and surface a one-click **Reload Window** prompt.
- **Smarter wizard error handling** — the wizard's `_handleSetupResult` now recognises the registry error specifically and offers **Reload Window** / **Retry Now** / **Dismiss** actions instead of just a generic error toast.
- **Troubleshooting entries** in README.md and GETTING_STARTED.md explaining the fix for users on v1.4.0.

### Security
- **Ollama minimum version bumped from 0.3.10 → 0.12.4.** Closes the window of known Ollama CVEs: [CVE-2024-37032](https://nvd.nist.gov/vuln/detail/CVE-2024-37032) (RCE via malicious model files, fixed in 0.7.0), [CVE-2025-51471](https://www.wiz.io/vulnerability-database/cve/cve-2025-51471) (cross-domain token exposure), and [CVE-2025-63389](https://github.com/advisories/GHSA-f6mr-38g8-39rg) (missing auth on model-management ops, fixed in 0.12.4). The smart-setup wizard now prompts for an Ollama upgrade when a vulnerable version is detected.
- **Workspace Trust: limited support.** Added `capabilities.untrustedWorkspaces: "limited"` to package.json. In untrusted workspaces, Evolve AI now **ignores workspace-level overrides** of provider host URLs (`aiForge.ollamaHost`, `aiForge.openaiBaseUrl`, `aiForge.huggingfaceBaseUrl`). This prevents a malicious `.vscode/settings.json` in a cloned repo from silently redirecting chat traffic (and any pasted API keys) to an attacker-controlled server. User-level (Global) settings still apply — the extension stays functional.
- **Remote-host warning for provider URLs.** When the user's configured Ollama/OpenAI/HuggingFace host is not loopback or a private RFC1918 address, a one-time warning toast appears before the first request of the session: *"\`aiForge.ollamaHost\` is set to \`<host>\`, which is not a local address. All chat content (code, git diffs, errors) will be sent to this server."* with Open Settings / I Understand actions. Helps users notice if they've accidentally pointed the extension at a public URL.
- **Image upload validation** (chat panel vision input). Paste / drag-and-drop now enforces a 10 MB size cap and MIME whitelist (PNG, JPEG, WEBP, GIF). Prevents memory pressure from arbitrary large files and rejects non-image binaries.

### For users stuck on v1.4.0
Run `Ctrl+Shift+P` → "Developer: Reload Window", then re-run **Switch AI Provider → Gemma 4**. Setup will complete normally. v1.4.1+ handles this automatically with a proactive reload prompt.

## [1.4.0] — 2026-04-19

### Added — Smart hardware detection + one-click Gemma 4 setup

The Gemma 4 wizard now does the work for the user. Pick **Gemma 4** in Switch Provider
and you get a single button that handles everything.

- **Hardware inspection** with explicit one-time consent — detects RAM, CPU, GPU
  (NVIDIA via `nvidia-smi`, AMD via `rocm-smi`, Apple Silicon via `system_profiler`),
  free disk space on the Ollama models directory, installed Ollama version, and
  any Gemma 4 variants already pulled. All checks parallel, all with 3s timeouts,
  all degrade gracefully on failure. **No data leaves your machine.**
- **Smart variant recommendation** — instead of showing 4 generic options, the
  wizard picks exactly the right variant for the user's hardware and explains why.
  GPU detected? Recommends 31B. 32GB RAM, no GPU? 26B MoE. 16GB? E4B. 8GB? E2B.
- **One-click install pipeline** — when the user clicks "Install Everything",
  the orchestrator runs:
  1. Install Ollama (if not present) — opens platform-specific installer
  2. Upgrade Ollama (if older than 0.3.10) — explicit consent, then auto-upgrade
  3. Pull the chosen Gemma 4 variant — live progress in MB/total via Ollama's
     `/api/pull` NDJSON stream (e.g. `Downloading gemma4:e4b — 1.5GB / 9.6GB (16%)`)
  4. Configure Evolve AI to use Gemma 4
  Each step shows up in a single VS Code progress notification, fully cancellable.
- **"System cannot run Gemma 4" handling** — if RAM or disk is too low for any
  variant, the wizard shows a modal with specific reasons and three actionable
  alternatives: switch to a cloud provider, use offline mode, or free up resources.
  Users are never left at a dead end.
- **Consent layers** — separate prompts for hardware detection (one-time),
  Ollama install (per-setup), Ollama upgrade (per-setup). Each explains what
  will happen and why. Settings: `aiForge.allowHardwareDetection` (default true),
  `aiForge.allowAutoInstall` (default false).
- **Manual fallback** — declining hardware detection drops back to the original
  variant picker. Existing users who prefer manual control lose nothing.

### New code modules
- `src/core/hardwareInspector.ts` — `HardwareInspector` class: `inspect()`, `recommend()`, `summary()`
- `src/core/setupOrchestrator.ts` — `SetupOrchestrator` class: `planSteps()`, `execute()` with progress

## [1.3.0] — 2026-04-18

### Added — Deterministic code cleanup (Tier 1)

- **Automatic lint + format on save** for JavaScript, TypeScript, JSX/TSX, Python, Go, and Rust. Zero configuration required.
- **Bundled tools:**
  - **Biome** — single-binary replacement for ESLint + Prettier when no project config is present
  - **Ruff** — single-binary replacement for flake8 + isort + Black for Python
- **Project-config-aware fallback:**
  - **ESLint + Prettier** — if the project has its own config (`.eslintrc`, `.prettierrc`), Evolve AI uses the project's `node_modules` install so rules and plugins apply
  - **gofmt, rustfmt** — used from the installed Go / Rust toolchain
- **Risk-tiered auto-fix:**
  - Safe fixes (whitespace, quotes, semicolons, import order) can be auto-applied
  - Risky fixes (unused vars, any-types) always prompt for review
  - Consent persists per workspace — asked once, remembered
- **New status bar entry** — `✓ Clean` / `⚠ 3 fixable` / `✗ 12 errors`. Click to review and apply.
- **Diff preview** before applying formatter changes so nothing is applied blind.
- **Content-hash cache** — unchanged files skip re-analysis instantly.
- **New commands:**
  - `Evolve AI: Analyze & Clean Current File` — manual trigger
  - `Evolve AI: Apply All Safe Fixes`
  - `Evolve AI: Toggle Auto Code Analysis`
  - `Evolve AI: Reset Code-Analysis Consent`
- **New configuration tree** under `aiForge.codeAnalysis.*`:
  - `enabled`, `trigger` (onOpen / onSave / onFocus / manual), `debounceMs`
  - `scope.maxFileSizeKb`, `scope.exclude`
  - `ui.surface` (statusBar / popup / both), `ui.popupThreshold`
  - `consent.autoApply` (per-category safe/risky tuning)

### Distribution note
Binaries (Biome + Ruff) are bundled per-platform; the marketplace serves the correct `.vsix` for each user's OS/arch. Install size is ~40 MB per platform.

## [1.2.1] — 2026-04-18

### Added
- **"What's New" notification system** — On extension upgrade, users see:
  - A non-blocking toast notification with **See What's New / Remind me later / Dismiss** options
  - A dismissible banner at the top of the chat panel
  - New **Evolve AI: What's New** command palette entry for anytime access
- Release notes are rendered directly in the chat panel with rich markdown formatting
- Version-aware: fresh installs skip the toast, upgrades fire once per version
- Per-version dismiss tracking means each release is only announced once

### Fixed
- Documentation: corrected core command count (16 → 17) to include the new command

## [1.2.0] — 2026-04-16

### Added

#### Gemma 4 — First-class provider with guided setup
- **Gemma 4 provider** — Google's latest open-weight multimodal model (Apache 2.0). Runs locally via Ollama with zero cloud dependency. 4 variants: E2B (2.3B), E4B (4.5B), 26B MoE, 31B Dense.
- **Guided setup wizard** — Select Gemma 4 in Switch Provider → checks Ollama → picks variant with hardware recommendations → downloads model → auto-configures. One-click setup.
- **`aiForge.gemma4Info` command** — Shows current variant status, comparison table, tips, and keyboard shortcuts directly in chat.
- **Post-setup welcome** — After Gemma 4 setup, chat shows what it can do with tips for best results.
- **First-use tip** — Dismissible tip after first Gemma 4 response with privacy note and example prompts.

#### Gemma 4 advanced features
- **Thinking mode** — Toggle chain-of-thought reasoning via the "Think" button in chat header. Shows internal reasoning in collapsible blocks before the answer. Better results for complex tasks. New setting: `aiForge.gemma4ThinkingMode`.
- **Vision / image input** — Paste images from clipboard (Ctrl+V) or drag-and-drop into chat. Gemma 4 analyses screenshots, UI mockups, error screenshots, diagrams. Image preview with thumbnails before sending.
- **Structured output** — In edit mode, Gemma 4 returns structured JSON with file content instead of markdown. More reliable code extraction and fewer parsing failures.
- **Dynamic context budget** — Auto-scales context from 24K chars to 80K (E2B/E4B) or 120K (26B/31B) to leverage Gemma 4's 128K-256K context windows. More related files, fuller git diffs, richer plugin data.

#### Marketplace & distribution
- **Comparison table** in README — vs GitHub Copilot, Continue.dev, Cody
- **"Get Started in 60 Seconds"** — 3-command quick start at top of README
- **Marketplace badges** — Version, installs, rating, license
- **CONTRIBUTING.md** — Full contributor guide with wanted plugin list
- **Launch post drafts** — Ready-to-post texts for Hacker News, Reddit (r/LocalLLaMA, r/vscode, r/devops, r/dataengineering), and Product Hunt

### Improved
- **Status bar** — Shows `$(sparkle) Evolve AI: Gemma 4 (E4B)` with enhanced tooltip (variant, params, context window, capabilities)
- **Onboarding guide** — Gemma 4 is now Option 1 in the "Welcome to Evolve AI" guide with feature highlights
- **Offline guide** — Lists Gemma 4 as the first recommended setup option
- **Marketplace metadata** — Optimised keywords (5 max), gallery banner, homepage/bugs URLs, extension kind, badges
- **README** — "Why Evolve AI?" hero section, Gemma 4 FAQ entry, updated model recommendations

## [1.0.7] — 2026-03-19

### Fixed
- **Command palette branding** — All commands now show under "Evolve AI:" consistently. Fixed 66 plugin commands that previously displayed a duplicate "Evolve AI: Evolve AI:" prefix due to the category and title both containing the brand name.

## [1.0.6] — 2026-03-19

### Improved
- **Auto model detection for Ollama** — If the configured model isn't installed but other models are available, the extension now automatically uses the first installed model instead of blocking with a dialog. The setting is updated so subsequent requests use the same model. A prompt is only shown when no models are installed at all.

## [1.1.0] — 2026-03-16

### Added

#### Cloud platform API clients
- **Databricks API Client** — REST client with PAT authentication: clusters, jobs, runs, workspace/notebooks, Unity Catalog (catalogs/schemas/tables), SQL warehouses, DBFS, secrets, DLT pipelines (28 API methods)
- **AWS API Client** — Full AWS Signature V4 authentication: STS, Lambda, Glue, S3, CloudFormation, Step Functions, CloudWatch Logs, DynamoDB, EventBridge, SNS/SQS (42 API methods)
- **Google Cloud API Client** — JWT/OAuth2 service account authentication: Cloud Functions v2, Cloud Run, BigQuery, Cloud Storage, Pub/Sub, Firestore, Cloud Logging, Dataflow, Cloud Scheduler (27 API methods)
- **Azure API Client** — OAuth2 client credentials flow: Functions, Logic Apps, Cosmos DB, Storage, DevOps Pipelines, App Service, Key Vault, Monitor/Logs, SQL Database (35 API methods)

#### Databricks Connected plugin (15 commands)
- Connect/disconnect to Databricks workspace with PAT authentication
- List and inspect clusters with AI-powered optimisation suggestions
- List, run, and monitor jobs; analyse failed job runs with AI diagnostics
- Browse and import workspace notebooks; deploy local files as notebooks
- Explore Unity Catalog (catalogs, schemas, tables) with AI data model analysis
- Execute SQL on SQL warehouses; AI-powered query suggestions
- Manage and troubleshoot Delta Live Tables pipelines
- Live context injection: cluster status, recent failures, catalog info in every AI prompt

#### AWS Connected plugin (20 commands)
- Connect/disconnect with IAM credentials (Access Key + Secret + Region)
- Environment variable auto-detection (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
- Lambda: list, inspect, invoke, view CloudWatch logs, debug errors with AI
- Glue: list jobs, inspect details, trigger runs, analyse failures, browse Data Catalog
- S3: browse buckets and objects, download to editor, deploy files
- CloudFormation: list stacks, inspect resources/events/templates with AI architecture analysis
- Step Functions: list state machines, design new workflows with AI-generated ASL
- DynamoDB: explore tables, inspect schemas, sample data, AI access pattern analysis

#### Google Cloud Connected plugin (18 commands)
- Connect with service account JSON key file + project ID
- Cloud Functions: list, inspect, invoke, view logs, debug errors with AI
- Cloud Run: list services, inspect config/scaling/traffic with AI optimisation
- BigQuery: browse datasets/tables, execute SQL, analyse failed jobs with AI
- Cloud Storage: browse buckets/objects, download to editor, deploy files
- Pub/Sub: list topics/subscriptions, publish messages
- Firestore: browse collections/documents with AI data model analysis

#### Azure Connected plugin (20 commands)
- Connect with service principal credentials (Tenant ID, Client ID, Client Secret, Subscription ID)
- Azure Functions: list apps, inspect, invoke, view logs, debug errors with AI
- Logic Apps: list workflows, analyse failed runs with AI diagnostics
- Cosmos DB: browse accounts/databases/containers, execute SQL queries
- Storage: browse accounts/containers/blobs, download to editor, deploy files
- DevOps Pipelines: list pipelines, analyse failed runs with AI
- App Service: list web apps, restart with confirmation
- Monitoring: query Log Analytics with KQL, list active alerts with AI remediation suggestions

#### AWS base plugin (8 commands)
- Offline/context-only AWS assistance: explain stacks, optimise Lambda, generate IAM policies
- SAM/CDK best practices, error handling patterns, CloudWatch logging
- Auto-detects samconfig.toml, cdk.json, serverless.yml, template.yaml, AWS SDK imports

#### Google Cloud base plugin (8 commands)
- Offline/context-only GCP assistance: explain services, optimise functions, BigQuery optimisation
- Cloud Build, Firestore rules, Cloud Logging best practices
- Auto-detects app.yaml, cloudbuild.yaml, firebase.json, GCP SDK imports

#### Azure base plugin (8 commands)
- Offline/context-only Azure assistance: explain resources, optimise functions, pipeline generation
- ARM/Bicep, Managed Identity, retry policy best practices
- Auto-detects host.json, azure-pipelines.yml, main.bicep, Azure SDK imports

#### Documentation
- Comprehensive marketplace README with cloud plugin setup guides
- Per-provider command reference tables
- Troubleshooting guide and FAQ section
- IAM/credential setup instructions for all four cloud platforms

### Fixed
- **Windows IPv6 issue** — Ollama connection now falls back to `127.0.0.1` when `localhost` resolves to IPv6 `::1`

## [1.0.0] — 2026-03-13

### Added

#### Core system
- AI chat sidebar with streaming responses and full project context
- Multi-provider support: Ollama (local/offline), Anthropic Claude, OpenAI-compatible endpoints, HuggingFace Inference API, and built-in offline mode
- Context assembly engine with configurable character budget (default 24,000 chars) shared across active file, related files, diagnostics, git diff, and plugin data
- Plugin architecture: `IPlugin` interface, `PluginRegistry`, automatic detection/activation/deactivation per workspace
- Typed event bus for decoupled communication between services, plugins, and UI
- Dependency injection root (`ServiceContainer`) — all services accessed through `IServices` interfaces
- Secure API key storage via VS Code `SecretStorage` (never in plaintext settings)
- Code Lens provider showing Explain | Tests | Refactor above every function
- Lightbulb Code Action provider ("Fix with AI" on any diagnostic)
- Status bar item showing active provider and active plugin count
- 15 core commands covering chat, code generation, refactoring, documentation, testing, git, and folder transforms
- Undoable file edits via `WorkspaceEdit` batch API; diff preview before applying changes

#### Databricks plugin (10 commands)
- Explain Spark jobs, optimise queries, convert SQL to DataFrame API
- Convert writes to Delta Lake, wrap transformations as Delta Live Tables
- Add MLflow tracking, fix `.collect()` OOM risk, replace Python UDFs with built-ins
- Add Unity Catalog 3-part names, generate Databricks Jobs YAML

#### dbt plugin (6 commands)
- Explain models, add data quality tests, convert to incremental materialisation
- Generate YAML documentation, optimise model SQL, generate source YAML

#### Apache Airflow plugin (6 commands)
- Explain DAGs, convert classic operators to TaskFlow API
- Add sensor tasks, add retry policies, generate new DAGs, add monitoring/alerting

#### pytest plugin (6 commands)
- Generate parametrized tests, extract fixtures, add `@pytest.mark.parametrize`
- Convert `unittest.TestCase` to pytest style, add coverage configuration, explain tests

#### FastAPI plugin (6 commands)
- Explain endpoints, add Pydantic request validation, add response models
- Generate CRUD routers, add JWT/OAuth2 authentication, generate TestClient tests

#### Django plugin (6 commands)
- Explain models, generate DRF serializers, generate Admin registrations
- Generate class-based views, generate URL patterns, generate model and view tests

#### Terraform plugin (6 commands)
- Explain resources, extract hardcoded values to variables, add tags to all resources
- Generate reusable modules, add outputs, audit for security best practices

#### Kubernetes plugin (6 commands)
- Explain manifests, add liveness/readiness probes, add CPU/memory resource limits
- Add security contexts, generate manifests from descriptions, add network policies

#### Docker plugin (6 commands)
- Explain Dockerfiles, optimise layer count and image size, add HEALTHCHECK
- Security audit, generate docker-compose.yml, generate Dockerfile from description

#### Jupyter plugin (5 commands)
- Explain notebooks, add markdown documentation cells, clean outputs
- Convert Python scripts to notebooks, generate notebooks from descriptions

#### PyTorch plugin (6 commands)
- Explain `nn.Module` architectures, generate training loops, add checkpoint save/load
- Optimise training with gradient accumulation, add mixed precision (torch.amp), generate Dataset classes

#### Security plugin (3 commands — always active)
- Scan current file for secrets, SQL injection, hardcoded credentials, insecure patterns
- Scan entire workspace, fix individual security findings

#### Git plugin (4 commands — always active)
- Git blame with AI explanation, generate changelog from git history
- Smart conventional commit message generation, generate PR description templates

#### Test suite
- Unit tests for EventBus, AIService, PluginRegistry, WorkspaceService, ContextService
- Plugin-specific tests for all 13 plugins
- Integration tests: plugin lifecycle, command execution, provider switching
