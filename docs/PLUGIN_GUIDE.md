# AI Forge — Plugin Guide

How to build a new stack plugin from scratch. The guide has three parts:
1. Checklist — the steps in order
2. Annotated template — copy this, replace the placeholders
3. Contribution point reference — every option with examples from Databricks

---

## Part 1 — Checklist

- [ ] Create `src/plugins/<yourplugin>.ts` from the template below
- [ ] Fill in `id`, `displayName`, `icon`
- [ ] Implement `detect()` — return `true` only when this stack is present
- [ ] Implement `activate()` — store ws path, detect environment variant
- [ ] Write `contextHooks` — collect and format stack-specific data
- [ ] Write `systemPromptSection()` — deep domain knowledge as a markdown string
- [ ] Add `codeLensActions` — buttons above matching lines
- [ ] Add `codeActions` — lightbulb quickfix/refactor items
- [ ] Add `transforms` — "Apply to Folder" operations using the AI
- [ ] Add `templates` — "Generate from Description" prompts
- [ ] Add `commands` — named actions for the command palette
- [ ] Add `statusItem` — text for the status bar
- [ ] In `src/plugins/index.ts`: `import` and `registry.register(new YourPlugin())`
- [ ] In `package.json` `contributes.commands`: add an entry for each command in `commands`
- [ ] Verify with the check script (see end of this file)

---

## Part 2 — Full annotated template

Copy this entire block, replace every `YOUR_*` placeholder.
Delete sections you don't need — all contribution points are optional.

```typescript
/**
 * plugins/YOUR_PLUGIN_ID.ts — YOUR_DISPLAY_NAME stack plugin for AI Forge
 *
 * Activates when: [describe what triggers detection]
 * Contributes:
 *  - contextHooks       : [what data is collected]
 *  - systemPromptSection: [what domain knowledge is injected]
 *  - codeLensActions    : [buttons above which lines]
 *  - codeActions        : [lightbulb items for which situations]
 *  - transforms         : [folder-level operations]
 *  - templates          : [generation templates]
 *  - commands           : [palette commands]
 *  - statusItem         : [status bar text]
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
//
// Detection must be synchronous or very fast async (no network calls).
// The registry wraps detect() in a 3-second timeout automatically.
// Return true only when you're confident — false positives activate the plugin
// unnecessarily.

/** Files/dirs whose presence confirms this stack */
const YOUR_MARKERS = [
  'your_config_file.yml',   // replace with real marker
  '.your_tool_dir',
];

function findMarker(wsPath: string): string | null {
  for (const marker of YOUR_MARKERS) {
    if (fs.existsSync(path.join(wsPath, marker))) return marker;
  }
  return null;
}

/** Check requirements.txt / pyproject.toml / package.json for the stack */
function hasStackDependency(wsPath: string): boolean {
  // Python: requirements.txt
  const req = path.join(wsPath, 'requirements.txt');
  if (fs.existsSync(req) && /your-package-name/i.test(fs.readFileSync(req, 'utf8'))) {
    return true;
  }
  // Node: package.json
  const pkg = path.join(wsPath, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const p = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      if (p.dependencies?.['your-npm-package'] || p.devDependencies?.['your-npm-package']) {
        return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

/** Walk directory for files matching a pattern (use sparingly in detect) */
function hasMatchingFiles(wsPath: string, pattern: RegExp, maxFiles = 5): boolean {
  const SKIP = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build']);
  function walk(dir: string, count = 0): number {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) count = walk(full, count);
        else if (pattern.test(e.name)) count++;
        if (count >= maxFiles) return count;
      }
    } catch { /* skip */ }
    return count;
  }
  return walk(wsPath) > 0;
}

// ── Context data shape ────────────────────────────────────────────────────────

interface YourContext {
  envType:      string;
  configFiles:  string[];
  hasFeatureA:  boolean;
  hasFeatureB:  boolean;
  // add whatever is useful to inject into the AI prompt
}

// ── The plugin class ──────────────────────────────────────────────────────────

export class YourPlugin implements IPlugin {
  // ── Identity ───────────────────────────────────────────────────────────────

  readonly id          = 'YOUR_PLUGIN_ID';       // e.g. 'dbt', 'fastapi', 'terraform'
  readonly displayName = 'YOUR_DISPLAY_NAME';    // e.g. 'dbt', 'FastAPI', 'Terraform'
  readonly icon        = 'YOUR_ICON';            // emoji or '$(codicon-name)'

  // ── State set during activation ───────────────────────────────────────────

  private _wsPath  = '';
  private _envType = 'YOUR_DISPLAY_NAME';

  // ── detect ─────────────────────────────────────────────────────────────────
  //
  // Called by the registry on startup and workspace changes.
  // Wrapped in Promise.race with 3-second timeout — never make network calls here.
  // Only return true when confident.

  async detect(ws: vscode.WorkspaceFolder | undefined): Promise<boolean> {
    if (!ws) return false;
    const wsPath = ws.uri.fsPath;

    // Check 1: marker file/directory (fastest)
    if (findMarker(wsPath)) return true;

    // Check 2: dependency file scan (fast string match)
    if (hasStackDependency(wsPath)) return true;

    // Check 3: file extension scan (slower, use sparingly)
    // if (hasMatchingFiles(wsPath, /\.your_ext$/, 5)) return true;

    return false;
  }

  // ── activate ───────────────────────────────────────────────────────────────
  //
  // Called once when detect() returns true.
  // Set up any plugin state here. Return Disposables for cleanup.
  // Receives IServices — use services.events.on() to subscribe to events.

  async activate(
    services: IServices,
    _vsCtx: vscode.ExtensionContext
  ): Promise<vscode.Disposable[]> {
    const ws     = vscode.workspace.workspaceFolders?.[0];
    this._wsPath = ws?.uri.fsPath ?? '';

    // Detect which variant of the stack this is
    this._envType = this._detectVariant(this._wsPath);

    // Optional: subscribe to events
    const disposables: vscode.Disposable[] = [
      services.events.on('editor.fileChanged', ({ language }) => {
        // e.g. refresh something when user opens a specific file type
      }),
    ];

    console.log(`[AI Forge] ${this.displayName} plugin activated: ${this._envType}`);
    return disposables;
  }

  // ── deactivate (optional) ──────────────────────────────────────────────────

  async deactivate(): Promise<void> {
    // Clean up any plugin-managed state
    this._wsPath  = '';
    this._envType = this.displayName;
  }

  // ── contextHooks ───────────────────────────────────────────────────────────
  //
  // Data collected here is injected into every AI prompt via the user message.
  // Keep collect() fast — it runs on every AI call.
  // format() should produce clean markdown that fits in ~500 chars.

  readonly contextHooks: PluginContextHook[] = [
    {
      key: 'YOUR_PLUGIN_ID',   // must match plugin id for clarity

      async collect(ws): Promise<YourContext> {
        const wsPath = ws?.uri.fsPath ?? '';

        // Collect relevant files (keep it cheap — no heavy parsing)
        const configFiles: string[] = [];
        for (const name of ['your_config.yml', 'your_config.yaml']) {
          if (fs.existsSync(path.join(wsPath, name))) configFiles.push(name);
        }

        // Scan source files for feature usage
        let sourceContent = '';
        try {
          // Read a few files to detect feature flags
          const pyFiles: string[] = []; // use globFiles from databricks.ts if needed
          sourceContent = pyFiles.slice(0, 10)
            .map(f => { try { return fs.readFileSync(f, 'utf8').slice(0, 1000); } catch { return ''; }})
            .join('\n');
        } catch { /* ignore */ }

        return {
          envType:     detectVariant(wsPath),
          configFiles,
          hasFeatureA: /feature_a_pattern/.test(sourceContent),
          hasFeatureB: /feature_b_pattern/.test(sourceContent),
        };
      },

      format(data: unknown): string {
        const d = data as YourContext;
        const lines = [`## ${d.envType} Context`];

        if (d.configFiles.length > 0) {
          lines.push(`Config files: ${d.configFiles.join(', ')}`);
        }

        const features: string[] = [];
        if (d.hasFeatureA) features.push('Feature A');
        if (d.hasFeatureB) features.push('Feature B');
        if (features.length > 0) {
          lines.push(`Detected features: ${features.join(', ')}`);
        }

        return lines.join('\n');
      },
    },
  ];

  // ── systemPromptSection ────────────────────────────────────────────────────
  //
  // Appended to the base system prompt on every AI call when this plugin is active.
  // Write this as a condensed expert cheat sheet.
  // Aim for 50–150 lines — enough to prevent the AI making common mistakes,
  // not so long it bloats every prompt.

  systemPromptSection(): string {
    return `
## YOUR_DISPLAY_NAME Expert Knowledge

You are an expert in YOUR_DISPLAY_NAME. Apply these rules in every response:

### Core principles
- [Principle 1 — the most important anti-pattern to avoid]
- [Principle 2 — the most important best practice]
- [Principle 3]

### Pattern A
- [Specific guidance]
- [Code example if small]

### Pattern B
- [Specific guidance]

### Common mistakes to avoid
- [Anti-pattern 1] — [why it's wrong] — [correct approach]
- [Anti-pattern 2] — [why it's wrong] — [correct approach]
`.trim();
  }

  // ── codeLensActions ────────────────────────────────────────────────────────
  //
  // Appear as clickable links above lines matching linePattern.
  // command must be in this plugin's commands[] array AND in package.json.

  readonly codeLensActions: PluginCodeLensAction[] = [
    {
      title:       `${this.icon} Explain`,   // shown as link above the line
      command:     'aiForge.YOUR_PLUGIN_ID.explain',
      linePattern: /pattern_that_matches_relevant_lines/,
      languages:   ['python'],   // empty array = all languages
      tooltip:     'Explain what this does',
    },
    {
      title:       `${this.icon} Generate test`,
      command:     'aiForge.YOUR_PLUGIN_ID.generateTest',
      linePattern: /def\s+\w+|function\s+\w+/,
      languages:   ['python', 'typescript'],
      tooltip:     'Generate a test for this function',
    },
  ];

  // ── codeActions ────────────────────────────────────────────────────────────
  //
  // Appear in the lightbulb (⚡) menu.
  // QuickFix: shown when there's a matching diagnostic.
  // Refactor: shown on selection.

  readonly codeActions: PluginCodeAction[] = [
    {
      title:             `${this.icon} Fix common anti-pattern`,
      command:           'aiForge.YOUR_PLUGIN_ID.fixAntiPattern',
      kind:              'quickfix',
      requiresSelection: false,
      languages:         ['python'],
    },
    {
      title:             `${this.icon} Refactor to best practice`,
      command:           'aiForge.YOUR_PLUGIN_ID.refactor',
      kind:              'refactor',
      requiresSelection: true,
      languages:         ['python', 'typescript'],
    },
  ];

  // ── transforms ─────────────────────────────────────────────────────────────
  //
  // Appear in the "Apply Transform to Folder" quick pick.
  // apply() receives the full file content and must return the complete updated file.
  // Use services.ai.send() to call the AI. Strip markdown fences from the result.

  readonly transforms: PluginTransform[] = [
    {
      label:       'Add YOUR_DISPLAY_NAME best practices',
      description: 'Apply standard patterns and fix common issues',
      extensions:  ['.py'],   // only applied to these file types
      async apply(content, filePath, _lang, services): Promise<string> {
        const req: AIRequest = {
          messages: [{
            role: 'user',
            content: `Apply YOUR_DISPLAY_NAME best practices to this file.
[Specific instructions — be explicit about what to change and what to preserve]
Return ONLY the complete updated file with no explanation.

File: ${filePath}
\`\`\`
${content}
\`\`\``,
          }],
          system: 'You are a YOUR_DISPLAY_NAME expert. Return only the complete updated file.',
          instruction: 'Apply YOUR_DISPLAY_NAME best practices',
          mode: 'edit',
        };
        return (await services.ai.send(req))
          .replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
      },
    },
  ];

  // ── templates ──────────────────────────────────────────────────────────────
  //
  // Appear in the "Generate from Description" quick pick.
  // prompt() returns a string that is sent as the user message to the AI.
  // The AI is expected to return one or more files in the ## filename.ext format.

  readonly templates: PluginTemplate[] = [
    {
      label:       'New YOUR_DISPLAY_NAME [component type]',
      description: 'Scaffold a [component] with best-practice structure',
      prompt: (wsPath) =>
        `Create a production-quality YOUR_DISPLAY_NAME [component].
Include:
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]
Generate as ## filename.ext then the complete content.
Workspace: ${wsPath}`,
    },
    {
      label:       'YOUR_DISPLAY_NAME [other component]',
      description: '[description]',
      prompt: (wsPath) =>
        `Create a [component] with:
- [Requirement 1]
- [Requirement 2]
Generate as ## filename.ext then the complete content.
Workspace: ${wsPath}`,
    },
  ];

  // ── commands ───────────────────────────────────────────────────────────────
  //
  // Each command here must also be in package.json contributes.commands.
  // Naming convention: aiForge.YOUR_PLUGIN_ID.commandName
  // handler receives IServices and any arguments passed by VS Code.

  readonly commands: PluginCommand[] = [
    {
      id:    'aiForge.YOUR_PLUGIN_ID.explain',
      title: 'YOUR_DISPLAY_NAME: Explain',
      async handler(services, uri, range): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const code = range
          ? editor.document.getText(range as vscode.Range)
          : editor.document.getText(editor.selection) || editor.document.getText();

        // Send to chat panel for a conversational explanation
        await vscode.commands.executeCommand(
          'aiForge._sendToChat',
          `Explain this YOUR_DISPLAY_NAME code:\n\n\`\`\`\n${code}\n\`\`\``,
          'chat'
        );
      },
    },
    {
      id:    'aiForge.YOUR_PLUGIN_ID.generateTest',
      title: 'YOUR_DISPLAY_NAME: Generate Test',
      async handler(services): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('Open a file first'); return; }

        // Use progress + AI for an edit/generate operation
        await vscode.window.withProgress(
          {
            location:  vscode.ProgressLocation.Notification,
            title:     'YOUR_DISPLAY_NAME: Generating test…',
            cancellable: false,
          },
          async () => {
            const ctx = await services.context.build();
            const sys = services.context.buildSystemPrompt(ctx);
            const req: AIRequest = {
              messages: [{
                role: 'user',
                content: `Generate a comprehensive test for:\n\`\`\`\n${editor.document.getText()}\n\`\`\`\nReturn only the test file.`,
              }],
              system: sys,
              instruction: 'Generate test',
              mode: 'new',
            };
            const output = (await services.ai.send(req))
              .replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
            const ws    = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
            const files = services.workspace.parseMultiFileOutput(output, ws);
            await services.workspace.applyGeneratedFiles(files);
          }
        );
      },
    },
    {
      id:    'aiForge.YOUR_PLUGIN_ID.fixAntiPattern',
      title: 'YOUR_DISPLAY_NAME: Fix Anti-Pattern',
      async handler(services): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('Open a file first'); return; }
        // Send to chat in 'edit' mode — user gets Apply/Cancel buttons
        await vscode.commands.executeCommand(
          'aiForge._sendToChat',
          `Fix the YOUR_DISPLAY_NAME anti-patterns in this file:\n\n\`\`\`\n${editor.document.getText()}\n\`\`\``,
          'edit'
        );
      },
    },
    {
      id:    'aiForge.YOUR_PLUGIN_ID.refactor',
      title: 'YOUR_DISPLAY_NAME: Refactor',
      async handler(services): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const code = editor.document.getText(editor.selection) || editor.document.getText();
        await vscode.commands.executeCommand(
          'aiForge._sendToChat',
          `Refactor this to follow YOUR_DISPLAY_NAME best practices:\n\n\`\`\`\n${code}\n\`\`\``,
          'edit'
        );
      },
    },
  ];

  // ── statusItem ─────────────────────────────────────────────────────────────

  readonly statusItem: PluginStatusItem = {
    text: async () => `${this.icon} ${this._envType}`,
  };

  // ── Private helpers ────────────────────────────────────────────────────────

  private _detectVariant(wsPath: string): string {
    // Return a human-readable variant name based on what's in the workspace
    // e.g. 'dbt Core', 'dbt Cloud', 'FastAPI with SQLAlchemy'
    return this.displayName;
  }
}

// Helper at module level (not class method) so contextHook.collect() can call it
function detectVariant(wsPath: string): string {
  return 'YOUR_DISPLAY_NAME';
}
```

---

## Part 3 — Contribution point reference

### contextHooks — best practices

**Do:**
- Read config files once and cache if called frequently
- Use `slice(0, N)` when reading file content — don't read megabytes
- Run detection in `collect()`, not `detect()` — `detect()` is just a gate
- Keep `format()` output under 1,000 characters

**Don't:**
- Make HTTP requests in `collect()` — it runs on every AI call
- Parse YAML/JSON with heavy libraries — use string search instead
- Access VS Code APIs in `collect()` — it receives only the workspace folder

**Example from Databricks:**
```typescript
// collect() scans Python files for feature flags using fast string matching
const allPy = globFiles(wsPath, [/\.py$/], 60)
  .map(f => fs.readFileSync(f, 'utf8').slice(0, 3000))
  .join('\n');

return {
  hasMLflow:    /mlflow/i.test(allPy),
  hasUnity:     /unity.catalog|three.part.name/i.test(allPy),
  hasDelta:     /DeltaTable|MERGE INTO/i.test(allPy),
};
```

---

### systemPromptSection — what to include

A good system prompt section has four parts:

1. **Identity statement** — one sentence: "You are an expert in X"
2. **Core principles** — the 5–10 most important rules, each actionable
3. **Common anti-patterns** — things the AI gets wrong by default for this stack
4. **Code patterns** — specific idioms (small enough to fit inline)

Keep it under 2,000 characters. The AI reads this on every call — padding it reduces quality.

**Example structure (dbt):**
```
## dbt Expert Knowledge

You are an expert in dbt (data build tool).

### Core principles
- Always use ref() for model dependencies, never hardcode schema.table
- Use source() for raw data references, never select from raw tables directly
- Materialisation: table for gold layer, view for transformations, incremental for large fact tables
- Jinja is for logic only — never use it to generate column names

### Testing
- Every model needs at minimum: not_null + unique tests on the primary key
- Use relationships tests for FK integrity; accepted_values for controlled vocabularies
- dbt test names follow the convention: {model}_{column}_{test}

### Common mistakes
- Hardcoding schema names → breaks across environments → use ref() / source()
- Using {{ run_started_at }} in incremental models → use is_incremental() macro instead
- Selecting * in models → always list columns explicitly for documentation and lineage
```

---

### codeLensActions — linePattern tips

The `linePattern` regex is matched against each line of the document. Keep it specific enough
to avoid false positives but broad enough to catch all relevant lines.

```typescript
// dbt models — function definitions in Python models
linePattern: /^def\s+model\s*\(/

// FastAPI routes
linePattern: /@app\.(get|post|put|delete|patch)\s*\(/

// Terraform resources
linePattern: /^resource\s+"[^"]+"\s+"[^"]+"\s*\{/

// Airflow tasks
linePattern: /@task|PythonOperator|BashOperator|\.set_downstream/

// Kubernetes manifests
linePattern: /^kind:\s+(Deployment|Service|Ingress|StatefulSet)/
```

---

### transforms — writing good prompts

The transform prompt is the most important part. Be explicit:

1. State exactly what to change
2. State exactly what NOT to change (preserve logic, variable names, etc.)
3. End with: "Return ONLY the complete updated file with no explanation."

**Pattern:**
```typescript
async apply(content, filePath, _lang, services): Promise<string> {
  const req: AIRequest = {
    messages: [{
      role: 'user',
      content: `[Specific transformation instruction].
Preserve all existing logic, variable names, and comments.
Do not add features that aren't already present.
Return ONLY the complete updated file with no explanation.

File: ${filePath}
\`\`\`
${content}
\`\`\``,
    }],
    system: 'You are a [STACK] expert. Return only the complete updated file.',
    instruction: '[short description for logging]',
    mode: 'edit',
  };
  return (await services.ai.send(req))
    .replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
}
```

---

### templates — writing good prompts

Template prompts generate new files. Include:
1. The output format instruction: `Generate as ## filename.ext then the complete content`
2. Specific requirements — be exhaustive, the AI will skip things that aren't listed
3. Quality signals: "production-quality", "comprehensive", "with error handling"

For multi-file output: `Generate each file as ## relative/path/filename.ext`

---

### commands — choosing the right pattern

Three patterns depending on what the command does:

**1. Conversational / explanation → send to chat**
```typescript
await vscode.commands.executeCommand('aiForge._sendToChat', message, 'chat');
```
Use when: user needs to read, ask follow-up questions, or the result isn't code.

**2. Edit existing file → send to chat in edit mode**
```typescript
await vscode.commands.executeCommand('aiForge._sendToChat', message, 'edit');
```
User sees Apply/Cancel buttons in the chat panel. Good for risky or large edits.

**3. Generate new files → parse + applyGeneratedFiles**
```typescript
const output = await services.ai.send(req);
const files  = services.workspace.parseMultiFileOutput(output, wsPath);
await services.workspace.applyGeneratedFiles(files);
```
Use when: creating new files, scaffolding, generating tests.

**4. Quick in-place edit with diff preview**
```typescript
const original = editor.document.getText();
const updated  = (await services.ai.send(req)).replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
const decision = await services.workspace.showDiff(original, updated, 'Preview: My Transform');
if (decision === 'apply') await services.workspace.applyToActiveFile(updated);
```
Use when: the edit is mechanical and you want to show the diff before applying.

---

## package.json — adding commands for a plugin

For every entry in `plugin.commands`, add to `package.json`:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "aiForge.YOUR_PLUGIN_ID.commandName",
        "title": "YOUR_DISPLAY_NAME: Command Title",
        "category": "AI Forge"
      }
    ]
  }
}
```

The `category` field must be `"AI Forge"` — this groups all commands together in the
command palette under "AI Forge: ...".

Commands that are only triggered by CodeLens (not intended for direct palette use) can
be omitted from `package.json`, but then users cannot assign keybindings to them.

---

## Verification checklist

Run this after building your plugin to catch structural problems:

```bash
python3 << 'EOF'
import re, json

plugin = open('src/plugins/YOUR_PLUGIN_ID.ts').read()
pkg    = json.load(open('package.json'))

def chk(label, passing, note=''):
    print(('✓' if passing else '✗'), label, f'[{note}]' if note else '')

chk('id defined',          "readonly id" in plugin)
chk('displayName defined', "readonly displayName" in plugin)
chk('icon defined',        "readonly icon" in plugin)
chk('detect() present',    'async detect(' in plugin)
chk('activate() present',  'async activate(' in plugin)
chk('No network calls in detect()', 'fetch(' not in plugin.split('async activate(')[0])

# Every command in plugin.commands is in package.json
cmd_ids  = re.findall(r"id:\s+'(aiForge\.[^']+)'", plugin)
pkg_cmds = [c['command'] for c in pkg['contributes']['commands']]
for cid in cmd_ids:
    chk(f'{cid} in package.json', cid in pkg_cmds)

# Plugin registered in index.ts
index = open('src/plugins/index.ts').read()
chk('Plugin imported in index.ts',   'YourPlugin' in index)
chk('Plugin registered in index.ts', 'new YourPlugin()' in index)

print(f'\nCommand count: {len(cmd_ids)}')
EOF
```

---

## Plugins already built

| Plugin | File | Status |
|---|---|---|
| Databricks | `plugins/databricks.ts` | ✅ Complete |

## Plugins to build next

| Plugin | Detect by | Key contribution |
|---|---|---|
| dbt | `dbt_project.yml` | ref() / source() guidance, model lenses, test generation |
| Airflow | `airflow.cfg` or DAG imports | TaskFlow API, operator patterns, DAG templates |
| pytest | `pytest.ini` / `conftest.py` | parametrize, fixtures, coverage, conftest templates |
| FastAPI | `fastapi` in requirements | Route lenses, Pydantic models, dependency injection |
| Terraform | `*.tf` files | Resource explain, module extract, tagging transforms |
| Kubernetes | `apiVersion:` in YAML | Manifest explain, add limits/probes, Helm templates |
| Django | `manage.py` + `settings.py` | ORM query optimisation, view/serialiser lenses |
| Docker | `Dockerfile` | Multi-stage build transform, security scan, layer hints |
| Security | Always active | Pattern-scan for secrets/injection, no AI calls needed |
