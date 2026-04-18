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
│   └── PLUGIN_GUIDE.md         ← how to build a new plugin (with full template)
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
    │   └── eventBus.ts          ← typed pub/sub event system
    ├── ui/
    │   ├── chatPanel.ts         ← sidebar webview chat panel
    │   ├── statusBar.ts         ← status bar item (provider + active plugins)
    │   └── inlineActions.ts     ← CodeLens + lightbulb CodeAction providers
    ├── commands/
    │   └── coreCommands.ts      ← all 15 core commands as a class
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
| Chat panel | `ui/chatPanel.ts` | ✅ Complete |
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
| Plugin loader | `plugins/index.ts` | ✅ All 13 plugins wired |

### What is next to build

All 13 planned plugins are complete. The extension is ready for packaging and release.

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
  ├─ provider detection (ollama / anthropic / openai / offline)
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

## Commands currently registered (27 total)

### Core (17)
| Command ID | Keybinding | Description |
|---|---|---|
| `aiForge.openChat` | Ctrl+Shift+A | Open sidebar chat |
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

### Databricks plugin (10)
`aiForge.databricks.explainJob` · `aiForge.databricks.optimiseQuery` ·
`aiForge.databricks.convertToDataFrame` · `aiForge.databricks.convertToDelta` ·
`aiForge.databricks.addDltDecorator` · `aiForge.databricks.addMlflowTracking` ·
`aiForge.databricks.fixCollect` · `aiForge.databricks.replaceUdf` ·
`aiForge.databricks.addUnityRef` · `aiForge.databricks.generateJobYaml`

---

## Settings (`aiForge.*`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `provider` | string | `auto` | `auto` / `ollama` / `gemma4` / `anthropic` / `openai` / `huggingface` / `offline` |
| `ollamaHost` | string | `http://localhost:11434` | Ollama / LM Studio / llama.cpp server URL |
| `ollamaModel` | string | `qwen2.5-coder:7b` | Ollama model |
| `gemma4Model` | string | `gemma4:e4b` | Gemma 4 variant: `gemma4:e2b` / `gemma4:e4b` / `gemma4:26b` / `gemma4:31b` |
| `gemma4ThinkingMode` | boolean | `false` | Enable chain-of-thought reasoning (better results, slower) |
| `openaiBaseUrl` | string | `https://api.openai.com/v1` | Also works for Groq, Mistral, Together AI, LiteLLM |
| `openaiModel` | string | `gpt-4o` | OpenAI model name |
| `anthropicModel` | string | `claude-sonnet-4-6` | Anthropic model name |
| `huggingfaceModel` | string | `Qwen/Qwen2.5-Coder-32B-Instruct` | Hugging Face model ID |
| `huggingfaceBaseUrl` | string | `https://api-inference.huggingface.co` | HF Inference API base URL |
| `codeLensEnabled` | boolean | `true` | Show CodeLens hints above functions |
| `includeErrorsInContext` | boolean | `true` | Include diagnostics in every AI call |
| `includeGitDiffInContext` | boolean | `false` | Include git diff in every AI call |
| `maxContextFiles` | number | `5` | Max related files to include |
| `contextBudgetChars` | number | `24000` | Total character cap across all context parts |
| `autoRunFix` | boolean | `false` | Auto-fix errors after running a script |
| `disabledPlugins` | array | `[]` | Plugin IDs to disable (`["databricks"]`) |

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
