# Changelog

All notable changes to Evolve AI are documented here.

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
