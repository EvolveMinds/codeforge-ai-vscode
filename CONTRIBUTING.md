# Contributing to Evolve AI

Thanks for your interest in contributing to Evolve AI! This guide will help you get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/EvolveMinds/codeforge-ai-vscode.git
cd codeforge-ai-vscode

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (recompile on save)
npm run watch
```

**Launch the extension:**
1. Open the repo in VS Code
2. Press `F5` to launch the Extension Development Host
3. The extension is active in the new window — test your changes there

## Architecture Overview

Before diving in, read these docs:

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — full structural design, data flows, module responsibilities
- **[docs/PLUGIN_GUIDE.md](docs/PLUGIN_GUIDE.md)** — how to build a new plugin (with complete template)

### Key Principles

1. **`IServices` uses interfaces, not concrete classes.** This enables testing and decoupling.
2. **Plugins never import from `core/`** except `IServices`, `IPlugin`, and contribution types.
3. **`extension.ts` is wiring only.** All logic lives in services, commands, or plugins.
4. **`plugins/index.ts` is the only file that changes when adding a plugin.**

## How to Contribute

### Adding a New Plugin (Best First Contribution)

This is the easiest and most impactful way to contribute. Each plugin adds deep domain knowledge for a specific tech stack.

1. Read `docs/PLUGIN_GUIDE.md` for the complete template
2. Create `src/plugins/<name>.ts` implementing `IPlugin`
3. Add one line to `src/plugins/index.ts` to register it
4. Add commands to `package.json` under `contributes.commands`

**Wanted plugins:**
- Next.js, Remix, Nuxt.js
- Rust (Cargo), Go (go.mod)
- GraphQL
- React Native / Expo
- Spring Boot (Java/Kotlin)
- Ruby on Rails
- Flutter / Dart
- Svelte / SvelteKit

### Bug Fixes

1. Check [open issues](https://github.com/EvolveMinds/codeforge-ai-vscode/issues)
2. Comment on the issue to claim it
3. Fork, fix, and submit a PR

### Feature Requests

Open an issue describing the feature and why it would be useful. Include examples if possible.

## Code Style

- TypeScript with `strict: true` — no implicit any, no unchecked array access
- Target: ES2020, module: CommonJS (VS Code extension requirement)
- Keep `extension.ts` thin — logic goes in services or commands
- API keys go in `SecretStorage`, never in settings
- File edits go through VS Code's WorkspaceEdit (undoable)

## Testing

```bash
# Compile first
npm run compile

# Run tests (requires VS Code Test Runner)
npm test
```

Tests live in `src/test/suite/`. Mock implementations are in `src/test/mocks.ts`.

## Pull Request Guidelines

1. **One PR per feature/fix** — keep PRs focused
2. **Compile before submitting** — `npm run compile` must pass with zero errors
3. **Test your changes** — launch with F5 and verify the feature works
4. **Update docs** — if your change adds settings, commands, or changes behavior, update README.md and CLAUDE.md
5. **Screenshots/GIFs** — if your PR changes UI, include a screenshot or GIF in the PR description

## Project Structure

```
src/
  extension.ts             <- entry point (thin wiring only)
  core/
    interfaces.ts          <- IAIService, IContextService, IWorkspaceService
    services.ts            <- IServices + ServiceContainer (DI root)
    plugin.ts              <- IPlugin + PluginRegistry
    aiService.ts           <- AI provider abstraction
    contextService.ts      <- project context assembly
    workspaceService.ts    <- file ops, transforms, diff preview
    eventBus.ts            <- typed pub/sub event system
    hardwareInspector.ts   <- system detection (RAM/GPU/disk/Ollama) for Gemma 4 wizard
    setupOrchestrator.ts   <- one-click Gemma 4 install pipeline
  ui/
    chatPanel.ts           <- sidebar webview chat panel
    statusBar.ts           <- status bar item
    inlineActions.ts       <- CodeLens + CodeAction providers
  commands/
    coreCommands.ts        <- all core commands
  plugins/
    index.ts               <- plugin registration (only file to edit)
    databricks.ts          <- reference plugin implementation
    ...                    <- 12 more plugins
```

## Understanding the Gemma 4 Smart Setup

Two modules power the one-click Gemma 4 experience:

### `src/core/hardwareInspector.ts`
Runs all detection checks in parallel with 3-second timeouts. Failures degrade
gracefully (no nvidia-smi? returns `gpu: null`, never throws).

**Public API:**
- `inspect(): Promise<HardwareProfile>` — gather RAM, CPU, GPU, disk, Ollama version, installed Gemma 4 variants
- `recommend(hw): Recommendation` — score variants against hardware, return either `{kind:'ok', variant, reason, warnings}` or `{kind:'unsupported', reasons, suggestions}`
- `summary(hw): string` — human-readable one-liner like `"32GB RAM · NVIDIA RTX 4090 (24GB VRAM) · 215GB free disk"`

**Privacy:** Opt-in via `aiForge.allowHardwareDetection` setting + one-time consent
modal stored in `globalState`. No data leaves the machine.

### `src/core/setupOrchestrator.ts`
Plans and executes the install pipeline with a single VS Code progress notification.
Each step is independent and idempotent — already-satisfied steps are skipped.

**Public API:**
- `planSteps(hw, variant, ollamaHost): SetupPlan` — determine which steps are needed
- `execute(plan): Promise<{ok, error?}>` — run sequentially with progress + cancellation

**Steps:**
1. Install Ollama (platform-specific installer)
2. Upgrade Ollama (if version < 0.3.10)
3. Pull Gemma 4 model — parses Ollama's `/api/pull` NDJSON for live MB/total progress
4. Update settings (`aiForge.provider`, `aiForge.gemma4Model`)

**Adding a new install step:** Append to the `planSteps()` switch block. Each step
is a `{id, label, needed, run}` tuple. Use `progress.message()` to update the
notification, and respect `signal.aborted` for cancellation.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
