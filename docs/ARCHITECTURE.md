# AI Forge — Architecture

## Overview

AI Forge is a VS Code extension with a plugin architecture. The core system provides AI-powered
code assistance (chat, edit, generate, explain, git). Stack plugins extend the core with deep
domain knowledge about specific frameworks and tools, injected automatically based on what's
in the workspace.

The design principle is **open for extension, closed for modification.** Adding a new stack
plugin requires zero changes to core code — only a new file in `plugins/` and one line in
`plugins/index.ts`.

---

## Layer diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                             │
│                                                                     │
│  extension.ts  ─────────────────────────────────────────────────┐  │
│  (54 lines, wiring only)                                        │  │
│                                                                  │  │
│  ┌────────────────────┐  ┌────────────────────────────────────┐ │  │
│  │  UI Layer          │  │  Core Layer                        │ │  │
│  │                    │  │                                    │ │  │
│  │  chatPanel.ts      │  │  services.ts  (DI root)           │ │  │
│  │  statusBar.ts      │  │  ┌──────────────────────────────┐ │ │  │
│  │  inlineActions.ts  │  │  │ aiService.ts                 │ │ │  │
│  │                    │  │  │ contextService.ts             │ │ │  │
│  └────────────────────┘  │  │ workspaceService.ts           │ │ │  │
│                          │  │ plugin.ts (registry)         │ │ │  │
│  ┌────────────────────┐  │  │ eventBus.ts                  │ │ │  │
│  │  Commands Layer    │  │  └──────────────────────────────┘ │ │  │
│  │                    │  └────────────────────────────────────┘ │  │
│  │  coreCommands.ts   │                                        │  │
│  └────────────────────┘  ┌────────────────────────────────────┐ │  │
│                          │  Plugin Layer                      │ │  │
│                          │                                    │ │  │
│                          │  plugins/index.ts  (loader)       │ │  │
│                          │  plugins/databricks.ts  ✅        │ │  │
│                          │  plugins/dbt.ts         🔜        │ │  │
│                          │  plugins/airflow.ts     🔜        │ │  │
│                          │  plugins/fastapi.ts     🔜        │ │  │
│                          │  plugins/terraform.ts   🔜        │ │  │
│                          └────────────────────────────────────┘ │  │
└─────────────────────────────────────────────────────────────────────┘
         │ HTTP / node:http / node:https
         ▼
  ┌──────────────────────────────────────┐
  │  AI Providers                        │
  │  Ollama (localhost:11434)            │
  │  Anthropic API                       │
  │  OpenAI-compatible API               │
  │  Offline fallback (static responses) │
  └──────────────────────────────────────┘
```

---

## Module responsibilities

### `extension.ts` — entry point
The only role of `extension.ts` is wiring: create the `ServiceContainer`, register plugins,
mount UI providers, register commands, run the first plugin detection pass, and set up
workspace-change listeners. No logic lives here.

```typescript
export async function activate(vsCtx: vscode.ExtensionContext): Promise<void> {
  const svc = new ServiceContainer(vsCtx);         // 1. DI root
  registerPlugins(svc.plugins);                     // 2. Register plugins
  // mount ChatPanel, StatusBar, InlineProviders    // 3. UI
  new CoreCommands(svc).register();                 // 4. Commands
  await refresh();                                  // 5. Plugin detection
  // workspace change listeners                     // 6. Reactivity
}
```

---

### `core/interfaces.ts` — service contracts

Three interfaces define what services expose to the outside world. `IServices` references
these interfaces — never the concrete classes.

```typescript
interface IAIService {
  detectProvider(): Promise<ProviderName>;
  isOllamaRunning(host?: string): Promise<boolean>;
  getOllamaModels(host?: string): Promise<string[]>;
  stream(request: AIRequest): AsyncGenerator<string>;
  send(request: AIRequest): Promise<string>;
  addInterceptor(interceptor: RequestInterceptor): vscode.Disposable;
  storeSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | undefined>;
}

interface IContextService {
  build(options?: BuildContextOptions): Promise<ProjectContext>;
  buildSystemPrompt(ctx: ProjectContext): string;
  buildUserPrompt(ctx: ProjectContext, instruction: string): string;
}

interface IWorkspaceService {
  applyToActiveFile(newContent: string): Promise<void>;
  writeFile(filePath: string, content: string, openAfter?: boolean): Promise<vscode.Uri>;
  parseMultiFileOutput(aiOutput: string, baseDir: string): GeneratedFile[];
  applyGeneratedFiles(files: GeneratedFile[]): Promise<void>;
  applyToFolder(folderPath: string): Promise<void>;
  getRuntimeCommand(filePath: string, lang: string): string | null;
  showDiff(original: string, proposed: string, title: string): Promise<'apply' | 'cancel'>;
}
```

Why interfaces instead of concrete classes: plugins can be tested against mock implementations,
and the compiler enforces the contract on every concrete class. A plugin that accidentally uses
an internal method will fail to compile.

---

### `core/services.ts` — dependency injection root

`ServiceContainer` is created once in `extension.ts` and passed everywhere as `IServices`.
All services are constructed here and wired together.

```typescript
interface IServices {
  readonly ai:        IAIService;
  readonly context:   IContextService;
  readonly workspace: IWorkspaceService;
  readonly plugins:   PluginRegistry;
  readonly events:    EventBus;
  readonly vsCtx:     vscode.ExtensionContext;
}

class ServiceContainer implements IServices {
  constructor(readonly vsCtx: vscode.ExtensionContext) {
    this.events    = new EventBus();
    this.plugins   = new PluginRegistry(this.events);       // bus injected here
    this.ai        = new AIService(this.events, vsCtx.secrets);
    this.context   = new ContextService(this.plugins);
    this.workspace = new WorkspaceService(this.plugins, this.ai, this.context, vsCtx, this.events);
  }
}
```

Dependency order: `EventBus` → `PluginRegistry` → `AIService` → `ContextService` → `WorkspaceService`.
No circular dependencies.

---

### `core/plugin.ts` — plugin contracts and registry

#### IPlugin interface — 9 contribution points

```typescript
interface IPlugin {
  // Identity (required)
  readonly id:          string;   // unique slug, e.g. 'databricks'
  readonly displayName: string;   // shown in UI, e.g. 'Databricks'
  readonly icon:        string;   // emoji or codicon, e.g. '⚡'

  // Lifecycle (required)
  detect(ws: WorkspaceFolder | undefined): Promise<boolean>;
  activate(services: IServices, context: ExtensionContext): Promise<Disposable[]>;
  deactivate?(): Promise<void>;

  // Contribution points (all optional)
  contextHooks?:        PluginContextHook[];      // inject data into every AI prompt
  systemPromptSection?(): string;                  // append domain knowledge to system prompt
  codeLensActions?:     PluginCodeLensAction[];   // buttons above code lines
  codeActions?:         PluginCodeAction[];        // lightbulb quickfix/refactor items
  transforms?:          PluginTransform[];         // items in "Apply to Folder" picker
  templates?:           PluginTemplate[];          // items in "Generate from Description" picker
  statusItem?:          PluginStatusItem;          // text in status bar
  commands?:            PluginCommand[];           // VS Code commands
}
```

#### PluginContextHook

Called on every `ContextService.build()`. The plugin collects data from the workspace and
returns it; the context service calls `format()` to render it as markdown for the prompt.

```typescript
interface PluginContextHook {
  key: string;                                              // identifies this plugin's data slot
  collect(ws: WorkspaceFolder | undefined): Promise<unknown>; // gather data (async, parallel)
  format(data: unknown): string;                            // render to markdown for the prompt
}
```

All hooks run in parallel with `Promise.all`. An error in one hook never blocks others.

#### PluginTransform

Items in the "Apply Transform to Folder" quick pick. The `apply` function receives the full
file content and must return the complete updated content.

```typescript
interface PluginTransform {
  label:       string;
  description: string;
  extensions:  string[];   // file extensions this applies to, e.g. ['.py']
  apply(
    content:  string,
    filePath: string,
    language: string,
    services: IServices    // properly typed — no 'as never' casts
  ): Promise<string>;
}
```

#### PluginCodeAction (lightbulb)

```typescript
interface PluginCodeAction {
  title:              string;
  command:            string;
  kind:               'quickfix' | 'refactor';
  diagnosticPattern?: RegExp;    // only show when a matching diagnostic is present
  requiresSelection?: boolean;   // only show when code is selected
  languages:          string[];  // empty = all languages
}
```

#### PluginRegistry lifecycle

```
registerPlugins() called at startup
         │
         ▼ for each registered plugin:
PluginRegistry.refresh(ws, services, vsCtx)
         │
         ├─ check aiForge.disabledPlugins setting
         │
         ├─ Promise.race([plugin.detect(ws), timeout(3000ms)])
         │         ├─ timeout → log warning, treat as inactive
         │         └─ error  → log warning, treat as inactive
         │
         ├─ shouldBeActive && !isActive → _activate()
         │         ├─ plugin.activate(services, vsCtx)
         │         ├─ register plugin.commands as VS Code commands
         │         └─ bus.emit('plugin.activated', ...)
         │
         └─ !shouldBeActive && isActive → _deactivate()
                   ├─ plugin.deactivate?.()
                   ├─ dispose all Disposables
                   └─ bus.emit('plugin.deactivated', ...)
```

`refresh()` is called: at startup, when workspace folders change, and when the active text
editor changes (to catch file-open-triggered detection).

---

### `core/aiService.ts` — AI provider abstraction

#### Provider detection

```
provider setting = 'auto'  →  check Ollama port → running: 'ollama', else: 'offline'
provider setting = 'ollama'     →  use Ollama regardless
provider setting = 'anthropic'  →  use Anthropic
provider setting = 'openai'     →  use OpenAI-compatible
provider setting = 'offline'    →  static fallback responses
```

#### Streaming pipeline

```
AIService.stream(AIRequest)
  │
  ├─ run RequestInterceptors in order (plugins modify request here)
  ├─ emit 'ai.request.start'
  ├─ detectProvider()
  ├─ call provider-specific _stream* method
  │     └─ _httpStream(url, body, parseChunk, extraHeaders)
  │           ├─ node:http or node:https (no fetch, no axios — zero dependencies)
  │           ├─ 60-second timeout
  │           ├─ line-by-line streaming with back-pressure (waiter pattern)
  │           └─ error responses surfaced as ⚠ messages in stream
  ├─ emit 'ai.request.done'
  └─ on error: emit 'ai.request.error', yield error message
```

No npm runtime dependencies. All HTTP is done with Node built-ins so the extension has no
`node_modules` to bundle at runtime.

#### Credentials

API keys are stored and retrieved via `vscode.ExtensionContext.secrets` (SecretStorage).
They never touch `settings.json`. Use `services.ai.storeSecret(key, value)` and
`services.ai.getSecret(key)` — never `vscode.workspace.getConfiguration()` for credentials.

---

### `core/contextService.ts` — context assembly

Called before every AI request. Assembles a `ProjectContext` object from multiple sources,
then renders it into system and user prompts.

#### BuildContextOptions

```typescript
interface BuildContextOptions {
  includeErrors?:  boolean;   // default: aiForge.includeErrorsInContext setting
  includeGitDiff?: boolean;   // default: aiForge.includeGitDiffInContext setting
  includeRelated?: boolean;   // default: true
}
```

#### ProjectContext shape

```typescript
interface ProjectContext {
  activeFile:  FileContext | null;   // currently open file
  selection:   string | null;        // selected text (if any)
  relatedFiles: FileContext[];        // imported/nearby files
  errors:      ErrorContext[];        // diagnostics from VS Code
  gitDiff:     string | null;        // staged diff
  pluginData:  Map<string, unknown>; // keyed by PluginContextHook.key
}
```

#### Character budget allocation

Total budget is `aiForge.contextBudgetChars` (default 24,000 characters).

```
activeFile   → up to 60% of budget (priority 1)
relatedFiles → up to 25% of budget, split across maxContextFiles files
pluginData   → up to 10% of budget
errors/diff  → remaining budget
```

If the active file exceeds its slice, it is truncated with a notice. Related files are
dropped before the active file is ever reduced.

#### Related file detection

Files are considered "related" if:
1. They are imported by the active file (resolved from `import`/`require`/`from` statements)
2. They are in the same directory as the active file

Alias paths (`@/`, `~/`) are not yet resolved — only relative `./` imports are followed.
Maximum `aiForge.maxContextFiles` files are included (default 3).

#### System prompt assembly

```
base system prompt
  + plugin.systemPromptSection() for each active plugin
  ──────────────────────────────────────────────────────
= full system prompt sent to AI
```

#### User prompt assembly

```
### Active file: {relPath} ({language})
{file content, budget-trimmed}

### Related: {relPath}
{content}
...

### Errors:
{error list}

### Git diff:
{diff}

### {plugin.key}:
{plugin.format(data)}
...

### Instruction:
{user instruction}
```

---

### `core/workspaceService.ts` — file operations

All file writes the user can see go through VS Code's `WorkspaceEdit` API — this puts them
on the undo stack so Ctrl+Z works.

#### applyToActiveFile
Replaces the entire active file content via `WorkspaceEdit`. Undoable.

#### applyGeneratedFiles
Shows a confirmation modal listing all files to be created/updated, then applies all changes
in a single `WorkspaceEdit` batch. Undoable as one operation.

#### applyToFolder
Walks a directory, shows a transform picker (core transforms + plugin transforms), applies
the chosen transform to each matching file. Uses `WorkspaceEdit` for all writes.

#### parseMultiFileOutput
Three regex patterns tried in order, with a fallback:
1. `## filename.ext\n\`\`\`lang\n...\n\`\`\``
2. `// filename.ext` or `# filename.ext` as standalone comment
3. `=== filename.ext ===`
4. Fallback: whole output treated as single file named `generated.py`

#### showDiff
Opens VS Code's native diff view between the original and proposed content. Returns
`'apply'` or `'cancel'` based on user action.

---

### `core/eventBus.ts` — typed event bus

All inter-module communication goes through `EventBus`. No module imports another to call
its methods directly — it emits an event and any interested module handles it.

```typescript
// Subscribing
services.events.on('plugin.activated', ({ pluginId, displayName }) => { ... });

// Emitting
services.events.emit('provider.changed', { provider: 'ollama', model: 'qwen2.5-coder:7b' });
```

Events are typed — the compiler knows the payload shape for each event name.
`EventBus.dispose()` is called when the extension deactivates, cleaning up all emitters.

Full event catalogue: see `CLAUDE.md` → Events section.

---

### `ui/chatPanel.ts` — sidebar chat

A `WebviewViewProvider` that renders a self-contained HTML/CSS/JS chat UI in the VS Code
sidebar. Communicates with the extension host via `postMessage`.

Message types (webview → extension): `send`, `apply`, `applyNew`, `clear`, `getStatus`,
`switchProvider`.

Message types (extension → webview): `status`, `userMsg`, `aiStart`, `aiChunk`, `aiDone`,
`notice`.

The panel streams AI responses chunk-by-chunk using the `aiChunk` message type — each chunk
is appended to the current AI message element in real time.

Chat history is held in `_history: Array<{role, content}>`. Only the last 10 messages are
sent to the AI on each turn (sliding window). History is in-memory only — cleared on reload.

The internal command `aiForge._sendToChat(instruction, mode)` lets `CoreCommands` push
instructions into the panel without coupling to the panel's implementation.

---

### `ui/inlineActions.ts` — CodeLens and lightbulb

**`AIForgeCodeLensProvider`** shows buttons above function/class definitions. Core lenses
(Explain, Tests, Refactor) appear for all supported languages. Plugin lenses are added by
checking `_plugins.codeLensActions` against each line's content via `linePattern` regex.

**`AIForgeCodeActionProvider`** shows the lightbulb menu on diagnostics and selections.
Core actions: QuickFix for each diagnostic, Explain/Refactor/Tests on selection.
Plugin actions are read from `_plugins.codeActions`.

Both providers call `_onChange.fire()` when `plugins.onDidChange` fires — the editor
refreshes lenses/actions whenever a plugin activates or deactivates.

Supported languages for core lenses: Python, JavaScript, TypeScript, JSX, TSX, Java, Go,
Rust, C++, C, C#, Ruby, PHP, Shell, SQL.

---

### `ui/statusBar.ts` — status bar item

Shows: `$(icon) AI Forge[: modelName][ · pluginIcons]`

Updates when: `provider.changed`, `plugin.activated`, `plugin.deactivated`, `ui.status.update`
events fire, and on a 30-second timer (Ollama can start/stop independently).

Clicking the status bar item runs `aiForge.switchProvider`.

---

### `commands/coreCommands.ts` — all core commands

All 15 core commands are methods on the `CoreCommands` class, which receives `IServices`.
No command implementation imports from `core/` directly — everything goes through `services`.

The internal `_editCommand(instruction, mode)` method is the shared implementation for all
"edit the current file" commands (fixErrors, addDocstrings, refactorSelection, etc.).

CodeLens command handlers (`codelensExplain`, `codelensTests`, `codelensRefactor`) extract
a function block using `extractBlock()` which reads up to 60 lines from the click point,
stopping at the first blank line or unindented line after the function start.

---

## Data flows

### Chat message flow

```
User types + presses Enter
    │
    ▼  webview postMessage {type:'send', text, mode}
ChatPanelProvider.send(instruction, mode)
    │
    ├─ ContextService.build()              ← assembles all context
    ├─ buildSystemPrompt(ctx)              ← base + all plugin sections
    ├─ buildUserPrompt(ctx, instruction)   ← file + errors + plugins + instruction
    ├─ postMessage {type:'userMsg'}        ← show user bubble
    ├─ postMessage {type:'aiStart'}        ← show streaming indicator
    │
    ├─ AIService.stream(request)
    │       └─ for await chunk
    │             └─ postMessage {type:'aiChunk', text:chunk}   ← stream to UI
    │
    ├─ postMessage {type:'aiDone', content, mode}   ← show Apply/Copy buttons
    └─ push to _history
```

### Edit command flow

```
User: Ctrl+Shift+F (Fix Errors)
    │
    ▼
CoreCommands.fixErrors()
    ├─ ContextService.build({ includeErrors: true })
    ├─ buildSystemPrompt + buildUserPrompt
    ├─ AIService.send(request)         ← collects full response (no streaming)
    ├─ showInformationMessage('Apply / Cancel')
    └─ WorkspaceService.applyToActiveFile(output)   ← WorkspaceEdit, undoable
```

### Plugin activation flow

```
extension.ts: await refresh()
    │
    ▼
PluginRegistry.refresh(ws, services, vsCtx)
    │
    └─ for each registered plugin:
           Promise.race([detect(ws), timeout(3s)])
               │
               ├─ true  → _activate()
               │           ├─ plugin.activate(services, vsCtx)
               │           ├─ register plugin.commands
               │           └─ bus.emit('plugin.activated')
               │
               └─ false / timeout / error → skip (or _deactivate if was active)
```

### Context assembly flow

```
ContextService.build(options)
    │
    ├─ read active editor file
    ├─ find related files (import scan + same-dir)
    ├─ read VS Code diagnostics
    ├─ run git diff (if enabled)
    │
    ├─ PluginRegistry.contextHooks → Promise.all(hooks.map(h => h.collect(ws)))
    │       ← parallel, errors isolated per hook
    │
    ├─ apply character budget:
    │       activeFile  → 60% of budget
    │       related     → 25% / maxContextFiles
    │       pluginData  → 10%
    │       errors/diff → remainder
    │
    └─ return ProjectContext
```

---

## Plugin detection reference

How to reliably detect common stacks in `detect()`:

```typescript
// File/directory markers (fast, synchronous via fs.existsSync)
fs.existsSync(path.join(wsPath, 'dbt_project.yml'))       // dbt
fs.existsSync(path.join(wsPath, 'airflow.cfg'))            // Airflow
fs.existsSync(path.join(wsPath, 'terraform.tfvars'))       // Terraform
fs.existsSync(path.join(wsPath, 'Dockerfile'))             // Docker
fs.existsSync(path.join(wsPath, 'cdk.json'))               // AWS CDK
fs.existsSync(path.join(wsPath, 'sfdx-project.json'))      // Salesforce

// requirements.txt / pyproject.toml scan (read once, string match)
content.includes('fastapi')
content.includes('django')
content.includes('torch')
content.includes('pytest')

// package.json scan
pkg.dependencies?.react || pkg.devDependencies?.react
pkg.dependencies?.['@nestjs/core']

// File extension presence
globFiles(wsPath, [/\.tf$/], 5).length > 0   // Terraform HCL files
globFiles(wsPath, [/\.cls$/], 5).length > 0  // Salesforce Apex
```

All `detect()` calls are wrapped in `Promise.race([detect(ws), timeout(3000)])` by the
registry. Keep `detect()` under 1 second for normal cases — never make network calls.

---

## Adding a new event

1. Add the event to `AIForgeEvents` in `core/eventBus.ts`:
   ```typescript
   'my.event': { myField: string };
   ```
2. Emit it: `services.events.emit('my.event', { myField: 'value' })`
3. Subscribe: `services.events.on('my.event', ({ myField }) => { ... })`

The compiler will enforce the payload type at all emit and subscribe sites.

---

## Adding a new core command

1. Add a method to `CoreCommands` in `commands/coreCommands.ts`
2. Register it in `CoreCommands.register()`:
   ```typescript
   r('aiForge.myCommand', () => this.myCommand());
   ```
3. Add to `package.json` `contributes.commands`:
   ```json
   { "command": "aiForge.myCommand", "title": "AI Forge: My Command", "category": "AI Forge" }
   ```
4. Optionally add a keybinding to `contributes.keybindings`

---

## Testing strategy

Unit tests for services use mock `IServices`:

```typescript
const mockAI: IAIService = {
  send: async () => 'mock response',
  stream: async function* () { yield 'chunk'; },
  detectProvider: async () => 'offline',
  // ... other methods
};

const mockServices: IServices = {
  ai: mockAI,
  context: mockContext,
  workspace: mockWorkspace,
  plugins: new PluginRegistry(new EventBus()),
  events: new EventBus(),
  vsCtx: {} as vscode.ExtensionContext,
};
```

Because `IServices` uses interfaces (not concrete classes), any method can be replaced with
a Jest mock function. Plugin transforms are testable in isolation:

```typescript
const result = await myPlugin.transforms[0].apply(content, filePath, 'python', mockServices);
expect(result).toContain('expected pattern');
```
