# Evolve AI — VS Code Extension

> **For Claude Code:** Read this file first, then read `docs/ARCHITECTURE.md` for full structural
> detail, and `docs/PLUGIN_GUIDE.md` when building a new plugin. Between the three files you have
> everything you need to understand the codebase and contribute without asking clarifying questions.

---

## What this project is

Evolve AI is a VS Code extension that brings AI code assistance into the editor. It supports
Ollama (local/offline), Anthropic Claude, and OpenAI-compatible providers. Its defining feature is
a **plugin architecture** that lets stack-specific modules inject deep domain knowledge into every
AI interaction — automatically, based on what files are in the workspace.

The Databricks plugin (`src/plugins/databricks.ts`) is the first and reference implementation.
All future plugins follow its exact pattern.

---

## Repository layout

```
evolve-ai-vscode/
├── CLAUDE.md                    ← you are here
├── docs/
│   ├── ARCHITECTURE.md          ← full structural design, data flows, interfaces
│   ├── PLUGIN_GUIDE.md         ← how to build a new plugin (with full template)
│   ├── GIT_CONNECT.md          ← Git/Bitbucket Connect Wizard user guide (v2.0.0)
│   ├── CICD.md                 ← CI/CD plugin + Setup Wizard user guide (v2.4.0 — pre-push gating hook)
│   ├── DATA_ANALYSIS.md        ← Data Analysis & Reporting plugin user guide (v2.11.0 — report design system, customisation, refine loop)
│   └── CODE_CONVERSION.md      ← Code Converter user guide (v2.12.0 — languages, fidelity, review, verification)
├── package.json                 ← VS Code manifest: commands, config, keybindings, menus
├── tsconfig.json
├── media/
│   └── sidebar-icon.svg
└── src/
    ├── extension.ts             ← entry point (54 lines — thin wiring only)
    ├── core/
    │   ├── reportDesign.ts      ← report design system: stylesheet, archetypes, ReportSpec/Theme, Python preamble
│   ├── reportBlocks.ts      ← report as an authored outline: typed blocks, block→prompt, data prep (real pandas), templates
│   ├── reportEditor.ts      ← in-iframe direct manipulation (move/delete/duplicate/inline edit) + block extraction/splicing
    │   ├── codeConvert.ts       ← conversion engine: language catalogue (idioms/pitfalls/checkers), output contract, prompts, result parser, fidelity report, file slicing
    │   ├── modelCapability.ts   ← model context windows / output caps / coding tier + fit assessment (used to size any large-prompt job)
    │   ├── jsonc.ts             ← stripJsonComments — shared by the pipeline + report-theme config files
    │   ├── interfaces.ts        ← IAIService, IContextService, IWorkspaceService
    │   ├── services.ts          ← IServices interface + ServiceContainer (DI root)
    │   ├── plugin.ts            ← IPlugin interface + PluginRegistry
    │   ├── aiService.ts         ← AI provider abstraction (Ollama/Anthropic/OpenAI/offline)
    │   ├── contextService.ts    ← project context assembly + plugin hooks
    │   ├── workspaceService.ts  ← file ops, transforms, diff preview
    │   ├── eventBus.ts          ← typed pub/sub event system
    │   ├── processUtil.ts       ← shared spawn-with-timeout helpers (used by both wizards)
    │   ├── hardwareInspector.ts ← RAM/GPU/disk/Ollama detection for Gemma 4 wizard
    │   ├── setupOrchestrator.ts ← one-click Gemma 4 install pipeline (Ollama + model)
    │   ├── gitConnectInspector.ts    ← detects git/identity/repo/remote/auth for Git wizard
    │   ├── gitConnectOrchestrator.ts ← step-by-step Git/Bitbucket connect (PAT/SSH/built-in/gh)
    │   ├── cicdSetupOrchestrator.ts  ← stack detection + starter-pipeline generation for CI/CD wizard
    │   ├── gitPushUtil.ts            ← pushBranch / getDefaultBranch / parseOwnerRepo (Stage & Commit v2.2)
    │   ├── prCreator.ts              ← createPR (GitHub + Bitbucket API + browser fallback)
    │   └── hookInstaller.ts          ← Pre-push hook install/uninstall (v2.4) — Husky-aware, conflict-safe
    ├── ui/
    │   ├── reportPreviewPanel.ts ← live report preview + plain-language refine loop (undoable)
    │   ├── codeConvertPanel.ts   ← Code Converter entry panel (source · target · fidelity · dependencies)
    │   ├── conversionReviewPanel.ts ← side-by-side original/converted review + fidelity report + refine loop
    │   ├── chatPanel.ts         ← chat brain (sidebar WebviewView + shared state)
    │   ├── chatEditorPanel.ts   ← right-side editor-tab chat (Claude-style WebviewPanel)
    │   ├── statusBar.ts         ← status bar item (provider + active plugins)
    │   └── inlineActions.ts     ← CodeLens + lightbulb CodeAction providers
    ├── commands/
    │   ├── coreCommands.ts      ← all core commands as a class
    │   ├── gitConnectCommands.ts ← Git/Bitbucket Connect Wizard commands (4 cmds)
    │   └── cicdSetupCommands.ts  ← CI/CD Setup Wizard commands (2 cmds)
    ├── test/
    │   ├── runTest.ts           ← VS Code test runner entry point
    │   ├── mocks.ts             ← Mock implementations of IAIService, IContextService, etc.
    │   └── suite/
    │       ├── index.ts         ← Mocha bootstrap (discovers *.test.js)
    │       └── contextService.test.ts ← Context budget + prompt tests
    └── plugins/
        ├── index.ts             ← ONLY file to edit when adding a plugin
        ├── codeConvert.ts       ← Code Converter orchestration (pick sources, batch, review, verify, save)
        └── databricks.ts        ← reference plugin implementation (860 lines)
```

---

## The one rule before writing any code

**Read `docs/ARCHITECTURE.md` before touching `core/`.
Read `docs/PLUGIN_GUIDE.md` before touching `plugins/`.**

The architecture has deliberate constraints — service interfaces, the DI root, typed events — that
exist to keep plugins decoupled from internals. Violating them creates tight coupling that's hard
to undo.

---

## Current state

### What is complete and working

| Area | File | Status |
|---|---|---|
| Entry point | `extension.ts` | ✅ Complete |
| Service interfaces | `core/interfaces.ts` | ✅ Complete |
| DI container | `core/services.ts` | ✅ Complete |
| Plugin system | `core/plugin.ts` | ✅ Complete |
| AI service | `core/aiService.ts` | ✅ Complete |
| Context assembly | `core/contextService.ts` | ✅ Complete |
| Workspace ops | `core/workspaceService.ts` | ✅ Complete |
| Event bus | `core/eventBus.ts` | ✅ Complete |
| Hardware inspector | `core/hardwareInspector.ts` | ✅ Complete |
| Setup orchestrator | `core/setupOrchestrator.ts` | ✅ Complete |
| Process util (shared) | `core/processUtil.ts` | ✅ Complete |
| Git Connect inspector | `core/gitConnectInspector.ts` | ✅ Complete |
| Git Connect orchestrator | `core/gitConnectOrchestrator.ts` | ✅ Complete |
| Git Connect commands | `commands/gitConnectCommands.ts` | ✅ Complete |
| CI/CD plugin | `plugins/cicd.ts` | ✅ Complete |
| CI/CD setup orchestrator | `core/cicdSetupOrchestrator.ts` | ✅ Complete |
| CI/CD setup commands | `commands/cicdSetupCommands.ts` | ✅ Complete |
| Git push util (Stage & Commit) | `core/gitPushUtil.ts` | ✅ Complete (v2.2.0) |
| PR creator (Stage & Commit) | `core/prCreator.ts` | ✅ Complete (v2.2.0) |
| Pre-push hook installer | `core/hookInstaller.ts` | ✅ Complete (v2.4.0) |
| Pre-push checker (self-contained Node) | `scripts/check-pipelines.js` | ✅ Complete (v2.4.0) |
| Chat panel (sidebar) | `ui/chatPanel.ts` | ✅ Complete |
| Chat editor tab (Claude-style) | `ui/chatEditorPanel.ts` | ✅ Complete |
| Status bar | `ui/statusBar.ts` | ✅ Complete |
| Inline actions | `ui/inlineActions.ts` | ✅ Complete |
| Core commands | `commands/coreCommands.ts` | ✅ Complete |
| Databricks plugin | `plugins/databricks.ts` | ✅ Complete |
| dbt plugin | `plugins/dbt.ts` | ✅ Complete |
| Airflow plugin | `plugins/airflow.ts` | ✅ Complete |
| pytest plugin | `plugins/pytest.ts` | ✅ Complete |
| FastAPI plugin | `plugins/fastapi.ts` | ✅ Complete |
| Django plugin | `plugins/django.ts` | ✅ Complete |
| Terraform plugin | `plugins/terraform.ts` | ✅ Complete |
| Kubernetes plugin | `plugins/kubernetes.ts` | ✅ Complete |
| Docker plugin | `plugins/docker.ts` | ✅ Complete |
| Jupyter plugin | `plugins/jupyter.ts` | ✅ Complete |
| PyTorch plugin | `plugins/pytorch.ts` | ✅ Complete |
| Security plugin | `plugins/security.ts` | ✅ Complete |
| Git plugin | `plugins/git.ts` | ✅ Complete |
| CI/CD plugin | `plugins/cicd.ts` | ✅ Complete |
| Data Analysis & Reporting plugin | `plugins/dataAnalysis.ts` | ✅ Complete — CSV/TSV/JSON/Excel/Parquet → HTML report / notebook / profiling. Size-adaptive (AI-direct for small data, generated script for large). Dependency-free sniffer. |
| Code Converter plugin | `plugins/codeConvert.ts` | ✅ Complete — convert code between 26 languages. Nothing written until reviewed. |
| Report design system | `core/reportDesign.ts` | ✅ Complete (v2.11.0) — owns report CSS/JS/palette, archetypes, ReportSpec + theme file, Python preamble |
| Report preview + refine loop | `ui/reportPreviewPanel.ts` | ✅ Complete (v2.13.0) — direct-manipulation host, Design tab, block-scoped refine, export |
| Report block model | `core/reportBlocks.ts` | ✅ Complete (v2.13.0) — typed blocks with real column bindings, deterministic data prep, reusable templates |
| In-report editor | `core/reportEditor.ts` | ✅ Complete (v2.13.0) — runs inside the preview iframe; edits never reach disk as chrome |
| Code Converter plugin | `plugins/codeConvert.ts` | ✅ Complete (v2.12.0) — selection/file/folder → another language. Batched so cross-file refs survive, reviewed before anything is written |
| Conversion engine | `core/codeConvert.ts` | ✅ Complete (v2.12.0) — 26-language catalogue (idioms, pitfalls, naming, manifests, syntax checkers), output contract, prompt + repair + refine builders, tolerant result parser, fidelity report |
| Converter entry panel | `ui/codeConvertPanel.ts` | ✅ Complete (v2.12.0) |
| Conversion review panel | `ui/conversionReviewPanel.ts` | ✅ Complete (v2.12.0) |
| Plugin loader | `plugins/index.ts` | ✅ All plugins wired |

### What is next to build

All planned plugins are complete (17 auto-detecting plugins). The extension is ready for packaging and release.

Future plugin ideas (community contributions welcome):
- `plugins/nextjs.ts` — detect `next.config.*`. App Router, Server Components, API routes.
- `plugins/rust.ts` — detect `Cargo.toml`. Ownership, lifetimes, async patterns.
- `plugins/go.ts` — detect `go.mod`. Goroutines, interfaces, error handling.
- `plugins/graphql.ts` — detect `*.graphql` / `*.gql`. Schema, resolvers, queries.

---

## Key architectural decisions (do not reverse without reading ARCHITECTURE.md)

1. **`IServices` uses interfaces, not concrete classes.** `IServices.ai` is typed as `IAIService`,
   not `AIService`. This means any service can be mocked in tests and plugins cannot accidentally
   depend on implementation details.

2. **Plugins never import from `core/` except `IServices`, `IPlugin`, and contribution types.**
   Everything a plugin needs arrives via `IServices`. If a plugin needs something that isn't in
   `IServices`, the right fix is to add it to `IServices` — not to add a direct import.

3. **`extension.ts` is wiring only.** All logic lives elsewhere. If you find yourself adding
   logic to `extension.ts`, it belongs in a service, command, or plugin instead.

4. **`plugins/index.ts` is the only file that changes when adding a plugin.** Import the class,
   call `registry.register(new MyPlugin())`. The registry handles detection, activation,
   deactivation, command registration, and event emission automatically.

5. **Context budget is enforced in `contextService.ts`.** The `contextBudgetChars` setting
   (default 24,000) caps the total characters sent to the AI. Active file gets priority;
   related files share the remainder. Do not bypass this in plugin context hooks.

6. **API keys live in `SecretStorage`, not settings.** `services.ai.storeSecret(key, value)`
   and `services.ai.getSecret(key)` are the only way to handle credentials. Never read from
   `vscode.workspace.getConfiguration()` for anything sensitive.

7. **`applyToActiveFile` is undoable; `applyToFolder` writes via WorkspaceEdit batch.**
   Both go through VS Code's undo stack. Never use `fs.writeFileSync` on files the user
   can see — only use it for intermediate scratch files.

8. **The chat is multi-surface.** `ChatPanelProvider` owns history, in-flight streams,
   and status. Both the sidebar (`WebviewView`) and the editor tab (`WebviewPanel` via
   `ChatEditorPanel`) attach to the same provider through `attachSurface(...)`. Posts are
   broadcast to every attached surface so the two views stay in sync. Never store
   chat state directly on a surface — always go through the provider.

---

## How a request flows through the system

```
User types in chat / runs command
         │
         ▼
CoreCommands / ChatPanelProvider
         │  builds context
         ▼
ContextService.build()
  ├─ active file content (priority-1 budget slice)
  ├─ related files (remaining budget, capped)
  ├─ diagnostics / errors
  ├─ git diff (if enabled)
  └─ PluginRegistry.contextHooks  ← each active plugin adds its data here
         │
         ▼
ContextService.buildSystemPrompt()
  ├─ base system prompt
  └─ PluginRegistry.systemPromptSections  ← each active plugin appends domain knowledge
         │
         ▼
AIService.stream(request)
  ├─ RequestInterceptors (plugins can modify request before send)
  ├─ provider detection (ollama / gemma4 / glm / colibri / anthropic / openai / gemini / zai / huggingface / offline)
  └─ HTTP streaming with back-pressure
         │
         ▼
ChatPanel / progress notification receives streamed chunks
         │
         ▼
WorkspaceService.applyToActiveFile() / applyGeneratedFiles()
  └─ WorkspaceEdit (undoable) or diff preview → user confirms
```

---

## How plugins integrate

A plugin is detected and activated once per workspace. After activation, its contributions
are merged into the core system transparently:

- `contextHooks` → called on every `ContextService.build()` call, data injected into prompt
- `systemPromptSection()` → appended to system prompt on every AI call
- `codeLensActions` → merged into CodeLens provider, shown above matching lines
- `codeActions` → merged into lightbulb provider, shown in ⚡ menu
- `transforms` → appear in the "Apply Transform to Folder" quick pick
- `templates` → appear in "Generate from Description" quick pick
- `commands` → registered as VS Code commands, must also be in `package.json`
- `statusItem` → text shown in the status bar item

---

## Commands currently registered (60 total)

### Core (18)
| Command ID | Keybinding | Description |
|---|---|---|
| `aiForge.openChat` | Ctrl+Shift+A | Open sidebar chat |
| `aiForge.openChatTab` | — | Open chat as a right-side editor tab (Claude-style). Also bound to the editor title-bar icon. |
| `aiForge.generateFromDesc` | Ctrl+Alt+G | Generate code from description |
| `aiForge.fixErrors` | Ctrl+Alt+F | Fix current file errors |
| `aiForge.explainSelection` | Ctrl+Alt+E | Explain selected code |
| `aiForge.gitCommitMessage` | Ctrl+Alt+M | Generate commit message |
| `aiForge.refactorSelection` | — | Refactor selection |
| `aiForge.addDocstrings` | — | Add documentation comments |
| `aiForge.addTests` | — | Generate tests for file |
| `aiForge.applyToFolder` | — | Apply transform to folder |
| `aiForge.gitExplainDiff` | — | Explain current changes |
| `aiForge.gitPRDescription` | — | Generate PR description |
| `aiForge.buildFramework` | — | Build framework from description |
| `aiForge.runAndFix` | — | Run file and auto-fix errors |
| `aiForge.switchProvider` | — | Switch AI provider |
| `aiForge.setupOllama` | — | Open Ollama setup page |
| `aiForge.gemma4Info` | — | Show Gemma 4 info, tips & variant comparison |
| `aiForge.whatsNew` | — | Show release notes for the current version |

### Git Connect Wizard (4)
| Command ID | Keybinding | Description |
|---|---|---|
| `aiForge.gitConnect.start` | — | Run the Git/Bitbucket connect wizard end-to-end |
| `aiForge.gitConnect.status` | — | One-line summary of connection state + jump to wizard |
| `aiForge.gitConnect.disconnect` | — | Clear stored PATs and the VS Code GitHub session |
| `aiForge.gitConnect.testConnection` | — | Re-run `git ls-remote origin` to verify the remote |

### CI/CD Wizard + plugin (15)
| Command ID | Description |
|---|---|
| `aiForge.cicd.setup.start` | First-time CI/CD setup wizard — picks platform, template, deploy target |
| `aiForge.cicd.setup.status` | One-line summary of detected stack + existing pipelines |
| `aiForge.cicd.setup.stageAndCommit` | Stage the wizard-written file, AI-draft a Conventional Commits message, commit, **push, and open a PR** (v2.2.0). GitHub uses `vscode.authentication`; Bitbucket uses stored PAT; GitLab/other → browser fallback. Refuses on protected branches without a feature-branch dialog first. Set `aiForge.cicd.openPRAfterCommit: false` to stop at commit. |
| `aiForge.cicd.explainJob` | Explain the CI job at the cursor (CodeLens) |
| `aiForge.cicd.optimizePipeline` | Refactor active pipeline file for speed + reliability |
| `aiForge.cicd.fixFailingRun` | Paste a failing CI run log → AI diagnoses against the active pipeline file |
| `aiForge.cicd.addCache` | Insert dependency cache step after checkout (CodeLens) |
| `aiForge.cicd.convertMatrix` | Convert active job to a matrix strategy (CodeLens) |
| `aiForge.cicd.useOIDC` | Replace long-lived secrets with OIDC (lightbulb) |
| `aiForge.cicd.pinActions` | Pin all `uses:` references to commit SHA (lightbulb) |
| `aiForge.cicd.addConcurrency` | Add a concurrency block at workflow level (lightbulb) |
| `aiForge.cicd.installHook` | Install pre-push hook for current repo (v2.4.0). Conflict-aware, Husky-aware, mode-configurable |
| `aiForge.cicd.uninstallHook` | Remove the pre-push hook (or strip our appended block). Refuses to touch hooks we didn't write |
| `aiForge.cicd.checkPipelinesNow` | Dry-run the pipeline checker against the current workspace's pipeline files. Output channel shows findings |

### Databricks plugin (10)
`aiForge.databricks.explainJob` · `aiForge.databricks.optimiseQuery` ·
`aiForge.databricks.convertToDataFrame` · `aiForge.databricks.convertToDelta` ·
`aiForge.databricks.addDltDecorator` · `aiForge.databricks.addMlflowTracking` ·
`aiForge.databricks.fixCollect` · `aiForge.databricks.replaceUdf` ·
`aiForge.databricks.addUnityRef` · `aiForge.databricks.generateJobYaml`

### Data Analysis & Reporting plugin (10)
| Command ID | Description |
|---|---|
| `aiForge.data.analyze` | Pick a data file → choose deliverable (insights / report / notebook / profile). Also on the Explorer right-click for data files. |
| `aiForge.data.insights` | Gemini-style narrative insights streamed into the chat panel, with follow-ups |
| `aiForge.data.report` | Generate a self-contained HTML report (KPI tiles, charts, insights) |
| `aiForge.data.notebook` | Generate a reproducible pandas/plotly notebook or `.py` script |
| `aiForge.data.profile` | Profiling summary — types, nulls, distributions, correlations, data-quality flags |
| `aiForge.data.analyzeSource` | Analyze from a database or cloud source: BigQuery / Databricks SQL / Cosmos / Log Analytics / DynamoDB / S3-GCS-Blob objects, or a generated `pandas.read_sql` script for any SQL DB. Reuses the connected-plugin clients + SecretStorage credentials; no new deps, no stored DB passwords. |
| `aiForge.data.refineReport` | Reopen a generated report in the preview panel and change it in plain language. Applies the edit to the existing document rather than regenerating; every round is undoable |
| `aiForge.data.createReportTheme` | Scaffold `evolve-report-theme.json` — brand colours, palette, logo, footer and default report shape, applied to every report |
| `aiForge.data.createPipeline` | Scaffold a declarative `evolve-data-pipeline.json` (steps = source + analysis) with commented examples for every source type |
| `aiForge.data.runPipeline` | Run a data pipeline JSON — each step's deliverable written to the pipeline's output folder; JSONC (`//` comments) tolerated; continues past failures and summarises |

### Code Converter (7)
| Command ID | Description |
|---|---|
| `aiForge.convert.start` | Open the Code Converter panel — pick source (active file / selection / files / folder), target language, fidelity and dependency policy. This is what the chat's **Code Convertor** mode launches. |
| `aiForge.convert.file` | Convert the active file (or an Explorer-selected file) — target and fidelity via quick pick |
| `aiForge.convert.selection` | Convert the current selection. Also on the lightbulb (⚡) menu whenever text is selected |
| `aiForge.convert.folder` | Convert a folder / small project. Files go in one request so cross-file references stay consistent; chunked only when the char budget forces it. Explorer right-click on a folder |
| `aiForge.convert.model` | Choose the AI model used **for conversion only** — leaves the global provider/model alone. Lists installed Ollama models with their real context window (from `/api/show`) and coding tier |
| `aiForge.convert.review` | Reopen the review for the conversion in progress |
| `aiForge.convert.verify` | Run the target language's own parser over the converted files, when its toolchain is on PATH. Failures can be fed straight back for a repair round |

### Conversion engine (v2.12.0)

Conversion knowledge is **not** delegated to the model. `core/codeConvert.ts` owns the language
catalogue (per language: extension, naming convention, manifest, test framework, single-file syntax
checker, and the idioms + pitfalls that separate native code from transliterated code), the output
contract, every prompt (convert / repair / refine), and the parser that turns a model response into
files + a fidelity report. If conversion quality needs to change, change it there — extra prose in a
prompt won't survive.

The flow the plugin enforces is the product:

1. **Nothing is written until the review is accepted.** Converted files live in memory beside the
   original; a rejected conversion leaves no litter.
2. **Batches convert together**, so shared types and cross-file calls stay consistent
   (`convert.maxCharsPerBatch` chunks only when the context budget demands it).
3. **It checks its own work** where the target toolchain exists, and feeds failures back as a repair
   round. `SyntaxCheck.verifies` distinguishes `'syntax'` (a failure is always real) from
   `'compile'` (a failure may just be a missing local dependency) so the message doesn't mislead.
   Tools that fail on *unformatted but valid* code are deliberately excluded — see the Rust entry.
4. **Refinement is incremental and undoable** — only the affected files are re-emitted.
5. **The job is sized against the model before it runs.** `core/modelCapability.ts` resolves the real
   context window (queried from Ollama, table lookup otherwise), estimates prompt + response tokens,
   and returns a verdict: comfortable / tight / split(n) / impossible. Reserving room for the
   *response* is the crux — a prompt that fits alone still produces a reply that stops mid-file.
6. **Oversized work is split, not truncated.** Many files → batches; one file too big for any pass →
   sliced at top-level declarations, each part told what earlier parts declared, then stitched back
   into one file with a report warning naming the rejoined files.

### Per-request model overrides (v2.12.0)

`AIRequest` gained `providerOverride`, `modelOverride`, `maxOutputTokens` and `contextTokens`, honoured
by every provider path in `aiService.ts`. Three reasons they exist, all of which bit the converter:

- **`modelOverride`** — conversion wants a bigger model than chat. Overrides never write to user
  settings (the Ollama auto-fallback deliberately skips its `update()` when an override is in play).
- **`maxOutputTokens`** — every provider was hard-coded to 4096, fine for chat and far too small for
  emitting whole files. Callers now size it to the job.
- **`contextTokens`** — sets Ollama's `num_ctx`. Without it Ollama serves the model's default window
  (often 4096) and **truncates the prompt from the front silently**. Any feature building large
  prompts must set this.

`IAIService.getOllamaModelInfo()` reads the model's real trained context length from `/api/show`.
Prefer it over the capability table — detection beats guessing, and the table only fills the gap.

Every conversion produces a `ConversionReport`: what mapped 1:1, what was approximated, what needs a
human, the dependency mapping, and the setup commands. It is rendered into the review panel and
written as `CONVERSION-REPORT.md` next to the saved code. A conversion you cannot audit is not one
you can ship — so a missing report is itself reported as a warning rather than silently filled in.

### Report design system (v2.11.0)

HTML report styling is **not** delegated to the model. `core/reportDesign.ts` owns the stylesheet,
the chart styling, and the report runtime (theme toggle, sortable/filterable tables, print styles);
the model is asked only for semantic HTML against a documented class contract and is told not to
write CSS. `injectReportAssets()` stamps the stylesheet + script into the finished HTML, and
`injectPythonPreamble()` puts the same design into generated analysis scripts as `EVOLVE_*`
constants and `evolve_*` helpers. If you change the report look, change it there — adding design
prose to a prompt will not survive.

Per-run shape lives in a `ReportSpec` (archetype, audience, sections, chart budget, mode, accent),
layered over a workspace `ReportTheme` from `evolve-report-theme.json`. Refinement rounds go
through `ReportPreviewPanel`; heavy parts (base64 charts, the injected stylesheet) are stashed
before the model sees the document and restored after, and pure styling requests are handled
locally without an AI call at all.

### Report authoring (v2.13.0)

`ReportSpec.blocks` supersedes `sections` when non-empty: the user has composed the report block by
block, so `blocksToPrompt()` drives generation instead of the archetype's section list. Blocks are
typed and data-bound (`ChartBlock` carries measure/dimension/agg/chart/topN/sort), and the builder
populates its pickers from the sniffed `DataProfile` — that is the whole reason column pickers are
possible without a schema service.

**After generation, the rendered HTML is the source of truth.** `core/reportEditor.ts` is injected
into the preview iframe (never the file on disk — the preview is a separate copy in
`globalStorageUri`), handles move/delete/duplicate/inline-edit in a real DOM, and posts the
serialised document back. `blocksFromHtml()` then recovers the outline from the stamped
`data-block-id` attributes rather than maintaining a parallel model that would drift. Keep it that
way: any feature that needs to know the outline should read the HTML, not trust `spec.blocks`.

Three cost tiers, and they must stay distinct — collapsing them back into "everything is a prompt"
is what this release exists to undo:

| Change | Mechanism | Cost |
|---|---|---|
| move / delete / duplicate / retype | DOM op in the iframe | free, instant |
| accent / appearance / density | re-inject the stylesheet | free, instant |
| refine one block | `extractBlock` → single card to the model → splice back | one small call |
| refine the document | whole-document round-trip | one large call |

Data preparation (`DataPrep`) is **executed, not described**: `dataPrepPython()` emits real pandas
spliced in after the load by `injectDataPrep()`, and `_applyPrepToProfile()` mirrors it on the
sampled rows for the direct path. Two constraints are load-bearing — prep runs *before* the script
coerces stringy-numeric columns (so every numeric comparison cleans its own value), and derived
expressions are gated by `isSafeExpression()` because templates are shareable files and
`df.eval` on untrusted input is arbitrary code execution.

---

## Settings (`aiForge.*`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `provider` | string | `auto` | `auto` / `ollama` / `gemma4` / `glm` / `colibri` / `anthropic` / `openai` / `gemini` / `zai` / `huggingface` / `offline` |
| `ollamaHost` | string | `http://localhost:11434` | Ollama / LM Studio / llama.cpp server URL |
| `ollamaModel` | string | `qwen2.5-coder:7b` | Ollama model |
| `gemma4Model` | string | `gemma4:e4b` | Gemma 4 variant: `gemma4:e2b` / `gemma4:e4b` / `gemma4:26b` / `gemma4:31b` |
| `gemma4ThinkingMode` | boolean | `false` | Enable chain-of-thought reasoning (better results, slower) |
| `glmModel` | string | `codegeex4-all-9b` | Local GLM/CodeGeeX model tag via Ollama (offline). Also `glm4:9b`, `glm4` |
| `colibriBaseUrl` | string | `http://localhost:8080/v1` | Colibri server URL (OpenAI-compatible). User starts it with `coli serve` — the extension never installs or launches it |
| `colibriModel` | string | `glm-5.2` | Model served by Colibri. Also `kimi-k3`, `inkling`, `olmoe`. GLM-5.2 needs ~372GB disk |
| `allowHardwareDetection` | boolean | `true` | Allow detecting system specs to recommend best Gemma 4 variant. First use asks for consent. |
| `allowAutoInstall` | boolean | `false` | When `true`, skips per-install confirmation. When `false`, the wizard asks before downloading Ollama |
| `openaiBaseUrl` | string | `https://api.openai.com/v1` | Also works for Groq, Mistral, Together AI, LiteLLM |
| `openaiModel` | string | `gpt-4o` | OpenAI model name |
| `anthropicModel` | string | `claude-sonnet-4-6` | Anthropic model name |
| `geminiModel` | string | `gemini-2.5-flash` | Google Gemini model: `gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-2.0-flash` |
| `geminiBaseUrl` | string | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini OpenAI-compatible base URL |
| `zaiModel` | string | `glm-4.6` | GLM (Z.ai) cloud model: `glm-4.6` / `glm-4.5` / `glm-4.5-air` / `glm-4-flash` |
| `zaiBaseUrl` | string | `https://api.z.ai/api/paas/v4` | Z.ai OpenAI-compatible base URL |
| `huggingfaceModel` | string | `Qwen/Qwen2.5-Coder-32B-Instruct` | Hugging Face model ID |
| `huggingfaceBaseUrl` | string | `https://api-inference.huggingface.co` | HF Inference API base URL |
| `codeLensEnabled` | boolean | `true` | Show CodeLens hints above functions |
| `includeErrorsInContext` | boolean | `true` | Include diagnostics in every AI call |
| `includeGitDiffInContext` | boolean | `false` | Include git diff in every AI call |
| `maxContextFiles` | number | `5` | Max related files to include |
| `contextBudgetChars` | number | `24000` | Total character cap across all context parts |
| `requestTimeoutMs` | number | `0` | Idle (no-bytes) timeout per AI request. Resets on every streamed chunk — only fires on a silent/stalled socket, never mid-stream. `0` = auto (300s local Ollama/Gemma/HF, 120s cloud). Positive value overrides both. |
| `autoRunFix` | boolean | `false` | Auto-fix errors after running a script |
| `disabledPlugins` | array | `[]` | Plugin IDs to disable (`["databricks"]`) |
| `gitConnect.preferredAuth` | string | `auto` | `auto` / `github-builtin` / `pat` / `ssh` / `gh-cli` — pre-selected auth method in the wizard |
| `gitConnect.autoVerify` | boolean | `true` | Run `git ls-remote origin` after the wizard finishes |
| `gitConnect.pushOnConnect` | boolean | `false` | After creating remote, run `git push -u origin HEAD` |
| `gitConnect.statusHint` | boolean | `true` | Show `· not connected` in status bar + first-run nudge toast |
| `cicd.openPRAfterCommit` | boolean | `true` | After Stage & Commit, offer to push the branch and open a PR. v2.2.0+. |
| `cicd.hookMode` | string | `block` | Pre-push hook mode: `block` (refuse push on hard issues), `warn` (surface but allow), `off` (skip checks). v2.4.0+. |
| `convert.defaultTarget` | string | `""` | Language pre-selected in the Code Converter. Blank = choose every time. v2.12.0+. |
| `convert.fidelity` | string | `idiomatic` | `idiomatic` / `literal` (diffable against the source) / `modernise` |
| `convert.dependencies` | string | `popular` | `stdlib` (nothing third-party) / `popular` / `mirror` (one-for-one with the source's libraries) |
| `convert.includeTests` | boolean | `false` | Also generate tests in the target's usual framework |
| `convert.keepComments` | boolean | `true` | Carry comments across, rewritten in the target's doc style |
| `convert.emitManifest` | boolean | `true` | Also emit `go.mod` / `package.json` / `requirements.txt` etc. |
| `convert.outputFolder` | string | `converted` | Workspace-relative root for multi-file conversions, under a per-language subfolder (`converted/go`). Single files and selections are written beside the original instead. |
| `convert.maxFiles` | number | `20` | Most files one folder conversion will queue |
| `convert.maxCharsPerBatch` | number | `60000` | Upper bound on characters per request. The converter also derives a budget from the chosen model's real context window and uses whichever is **smaller** — a setting can only shrink requests, never exceed what the model can take. |

The conversion model itself is deliberately **not** a setting — it is a per-session choice
(`aiForge.convert.model` or the panel), so a model picked for one big port doesn't quietly become
the default for everything afterwards.

### SecretStorage keys (never in settings.json)

| Key | Purpose |
|---|---|
| `aiForge.anthropicKey` | Anthropic API key |
| `aiForge.openaiKey` | OpenAI API key |
| `aiForge.geminiKey` | Google Gemini API key |
| `aiForge.zaiKey` | GLM (Z.ai) API key |
| `aiForge.huggingfaceKey` | Hugging Face API key |
| `aiForge.githubPAT` | GitHub Personal Access Token (Git Connect Wizard) |
| `aiForge.bitbucketPAT` | Bitbucket App Password — stored as `username:app_password` |

---

## Events (typed EventBus)

All events are in `core/eventBus.ts`. Subscribe with `services.events.on(event, handler)`.

| Event | Payload | When |
|---|---|---|
| `provider.changed` | `{ provider, model }` | User switches AI provider |
| `plugin.activated` | `{ pluginId, displayName }` | Plugin detect() → true |
| `plugin.deactivated` | `{ pluginId }` | Plugin detect() → false or disabled |
| `ai.request.start` | `{ instruction, mode }` | Before AI call |
| `ai.request.done` | `{ instruction, tokensUsed? }` | After AI call completes |
| `ai.request.error` | `{ instruction, error }` | AI call failed |
| `file.edited` | `{ filePath, linesChanged }` | AI edit applied |
| `files.created` | `{ filePaths }` | AI generated new files |
| `editor.fileChanged` | `{ filePath, language }` | User switched active file |
| `context.refreshed` | `{ activePlugins }` | Plugin detection ran |
| `ui.notify` | `{ message, level }` | Plugin wants to show notification |
| `ui.status.update` | `{}` | Plugin wants to refresh status bar |
| `ui.whatsNew.show` | `{ version }` | Show What's New banner after extension upgrade |

---

## Build & run

```bash
# Install dependencies & fetch host platform binaries
npm install

# Compile TypeScript (zero errors required)
npm run compile

# Watch mode (recompile on save)
npm run watch

# Run tests
npm test
```

---

## Packaging & Marketplace Release Protocol

> **CRITICAL MEMORY / SINGLE SOURCE OF TRUTH**: Full details in `docs/PACKAGING.md`.

1. **Native Binaries Bundled**: Evolve AI bundles platform-specific binaries for **Biome (1.9.4)** and **Ruff (0.7.4)**.
2. **Never Publish Universal `.vsix`**: Never publish the output of bare `vsce package`. We publish **six platform-targeted `.vsix` packages** for every release:
   - `win32-x64`
   - `win32-arm64`
   - `darwin-x64`
   - `darwin-arm64`
   - `linux-x64`
   - `linux-arm64`
3. **Sequential Build**: Packages must be built sequentially so `clean:bin` prevents binary contamination:
   ```bash
   # Build all 6 targets sequentially in one command:
   npm run package:all
   ```
4. **Package Verification**: Each `.vsix` must be **~20–21 MB** and contain only its target binaries.
5. **Publishing**:
   ```bash
   # Publish all 6 targets with Azure DevOps PAT:
   npm run publish:all -- --pat=<YOUR_AZURE_DEVOPS_PAT>
   ```
6. **Git Release Hygiene**:
   - Always merge release branches back into `main`.
   - Always tag releases (`git tag v<version> && git push origin v<version>`).
   - Never release from an unverified branch.

---

## Adding a new plugin — the two steps

1. Create `src/plugins/<name>.ts` implementing `IPlugin`. Use `databricks.ts` as your template.
   Full guide in `docs/PLUGIN_GUIDE.md`.

2. In `src/plugins/index.ts`, add:
   ```typescript
   import { MyPlugin } from './myPlugin';
   registry.register(new MyPlugin());
   ```

3. For any commands the plugin defines, add them to `package.json` under
   `contributes.commands` so they appear in the command palette.

That's all. The registry handles everything else.
