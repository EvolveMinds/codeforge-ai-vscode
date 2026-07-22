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
│   └── DATA_ANALYSIS.md        ← Data Analysis & Reporting plugin user guide (v2.7.0 — files + DB/cloud sourcing, insights-in-chat)
├── package.json                 ← VS Code manifest: commands, config, keybindings, menus
├── tsconfig.json
├── media/
│   └── sidebar-icon.svg
└── src/
    ├── extension.ts             ← entry point (54 lines — thin wiring only)
    ├── core/
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
  ├─ provider detection (ollama / gemma4 / glm / anthropic / openai / gemini / zai / huggingface / offline)
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

## Commands currently registered (50 total)

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

### Data Analysis & Reporting plugin (6)
| Command ID | Description |
|---|---|
| `aiForge.data.analyze` | Pick a data file → choose deliverable (insights / report / notebook / profile). Also on the Explorer right-click for data files. |
| `aiForge.data.insights` | Gemini-style narrative insights streamed into the chat panel, with follow-ups |
| `aiForge.data.report` | Generate a self-contained HTML report (KPI tiles, charts, insights) |
| `aiForge.data.notebook` | Generate a reproducible pandas/plotly notebook or `.py` script |
| `aiForge.data.profile` | Profiling summary — types, nulls, distributions, correlations, data-quality flags |
| `aiForge.data.analyzeSource` | Analyze from a database or cloud source: BigQuery / Databricks SQL / Cosmos / Log Analytics / DynamoDB / S3-GCS-Blob objects, or a generated `pandas.read_sql` script for any SQL DB. Reuses the connected-plugin clients + SecretStorage credentials; no new deps, no stored DB passwords. |

---

## Settings (`aiForge.*`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `provider` | string | `auto` | `auto` / `ollama` / `gemma4` / `glm` / `anthropic` / `openai` / `gemini` / `zai` / `huggingface` / `offline` |
| `ollamaHost` | string | `http://localhost:11434` | Ollama / LM Studio / llama.cpp server URL |
| `ollamaModel` | string | `qwen2.5-coder:7b` | Ollama model |
| `gemma4Model` | string | `gemma4:e4b` | Gemma 4 variant: `gemma4:e2b` / `gemma4:e4b` / `gemma4:26b` / `gemma4:31b` |
| `gemma4ThinkingMode` | boolean | `false` | Enable chain-of-thought reasoning (better results, slower) |
| `glmModel` | string | `codegeex4-all-9b` | Local GLM/CodeGeeX model tag via Ollama (offline). Also `glm4:9b`, `glm4` |
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
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (recompile on save)
npm run watch

# Open in VS Code and press F5 to launch Extension Development Host
# Or: vsce package  to build a .vsix installer
```

TypeScript target is ES2020, module is CommonJS (VS Code extension requirement).
`tsconfig.json` has `strict: true` — no implicit any, no unchecked array access.

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
