# Gemma 4 Master Build Plan — Evolve AI VS Code Extension

> **Status: HISTORICAL REFERENCE** — This document is the pre-implementation spec
> for the Gemma 4 integration that shipped in v1.2.0 through v1.4.0. The smart
> hardware detection and one-click install pipeline (described as future work
> here) shipped in **v1.4.0** (April 2026). For current architecture and module
> responsibilities, read [`ARCHITECTURE.md`](ARCHITECTURE.md). For the up-to-date
> changelog, see [`CHANGELOG.md`](../CHANGELOG.md).

> Complete low-level implementation plan covering everything discussed.
> Every section below is work to be built and shipped.

---

## Phase 1: Core Provider Integration

**Goal:** Make Gemma 4 a first-class provider that users can select, set up, and use.

### 1.1 Type System & Configuration

**`package.json`**
- Add `"gemma4"` to `aiForge.provider` enum (after `"ollama"`)
- Add enum description: `"Gemma 4 — Google's open multimodal model, runs locally via Ollama. Free, private, Apache 2.0. Guided setup included"`
- Add new setting `aiForge.gemma4Model`:
  ```json
  {
    "type": "string",
    "default": "gemma4:e4b",
    "enum": ["gemma4:e2b", "gemma4:e4b", "gemma4:26b", "gemma4:31b"],
    "enumDescriptions": [
      "E2B — 2.3B active params, ~7.2GB, fast (text+image+audio)",
      "E4B — 4.5B active params, ~9.6GB, balanced (text+image+audio, recommended)",
      "26B MoE — 25.2B total (3.8B active), ~18GB, high quality (text+image, 32GB+ RAM)",
      "31B Dense — 30.7B params, ~20GB, highest quality (text+image, 32GB+ RAM, GPU)"
    ]
  }
  ```

**`src/core/aiService.ts`**
- Extend `ProviderName` type: add `'gemma4'`
- Add `isGemma4Available()` public method — filters `getOllamaModels()` for tags starting with `gemma4`, returns `{ installed: boolean; variants: string[] }`
- Add `_streamGemma4()` private method:
  - Reads `cfg.get('gemma4Model', 'gemma4:e4b')` (NOT `ollamaModel`)
  - Checks model is installed via `_getOllamaModels()`
  - If not found but other gemma4 variants installed → auto-fallback + update setting
  - If no gemma4 models → show download dialog (Download Now / Choose Different Variant / Open Settings)
  - Delegates to existing `_streamOllamaWithModel()` for actual HTTP streaming
- Update `stream()` routing: add `else if (provider === 'gemma4') { yield* this._streamGemma4(req, cfg); }`
- Update `detectProvider()`: in `auto` mode, if Ollama running + `gemma4Model` explicitly configured + matching model installed → return `'gemma4'`
- Update `_offline()` guide: list Gemma 4 as Option 1 (before generic Ollama)

**`src/core/interfaces.ts`**
- Add `isGemma4Available(): Promise<{ installed: boolean; variants: string[] }>` to `IAIService`

**`src/test/mocks.ts`**
- Add `isGemma4Available()` to `MockAIService` returning `{ installed: false, variants: [] }`

### 1.2 Setup Wizard

**`src/commands/coreCommands.ts` — switchProvider method**

Add Gemma 4 to the provider QuickPick list (after Ollama, before Offline):
```
$(sparkle) Gemma 4 [✓ if installed]
  Ready — gemma4:e4b installed  |  Google's latest open model — free, local, multimodal. Guided setup
```

Add `gemma4` branch with 4-step wizard:

**Step 1 — Check Ollama:**
- If not running → Warning: "Gemma 4 runs locally through Ollama. Ollama is not currently running."
- Options: "Install Ollama" (opens download page) / "I Already Installed It (Retry)" / "Cancel"
- On retry: re-ping Ollama, show error if still not found

**Step 2 — Pick variant with hardware guidance:**
- Show info message with RAM recommendations (8GB → E2B/E4B, 32GB → 26B/31B)
- QuickPick with 4 items, each showing params, download size, RAM needed, modalities
- Mark installed variants with ✓
- E4B listed first as "(Recommended)"

**Step 3 — Pull model if not installed:**
- "gemma4:e4b is not yet downloaded. Download it now?"
- "Download Now" → opens terminal with `ollama pull gemma4:e4b`
- Show info message: "Once terminal shows success, setup is complete"

**Step 4 — Configure settings:**
- Save `gemma4Model` to global config
- If model already installed: show "Gemma 4 (gemma4:e4b) is ready!"
- Offer "Show Tips" or "Open Chat"

Update `provider.changed` event emission:
- When provider is `'gemma4'`, emit `gemma4Model` setting value instead of `ollamaModel`

### 1.3 UI Integration

**`src/ui/statusBar.ts`**
- Add `gemma4: '$(sparkle)'` to icon map
- Update running check: `(provider === 'ollama' || provider === 'gemma4')`
- Read `gemma4Model` when provider is `'gemma4'`
- Format label: `$(sparkle) Evolve AI: Gemma 4 (E4B)`
- Enhanced tooltip showing: variant, params, context window, capabilities, license, installed variants

**`src/ui/chatPanel.ts`**
- `_postStatus()`: send `gemma4Model` as `currentModel` when provider is `'gemma4'`
- Readiness check: `(data.provider === 'ollama' || data.provider === 'gemma4') ? data.ollamaRunning : ...`
- Provider label: show `GEMMA 4` instead of raw string
- Onboarding guide: show "Gemma 4" as Option 1 (recommended) with setup wizard link
- Update option numbering (Gemma 4 → Ollama → Cloud → LM Studio)
- Handle `gemma4` in the "not running" onboarding scenario

---

## Phase 2: Help, Guidance & User Education

**Goal:** Make sure users understand what Gemma 4 is, which variant to pick, and how to get the best results.

### 2.1 `aiForge.gemma4Info` Command

**`package.json`**
- Register command: `aiForge.gemma4Info` with title "Evolve AI: Gemma 4 Info"

**`src/commands/coreCommands.ts`**
- New method `gemma4Info()` that posts rich markdown to the chat panel:
  - Current variant & status (running/not running)
  - Variant comparison table (params, context, RAM, best for)
  - Tips for best results (be specific, use Edit mode, keyboard shortcuts)
  - How to switch variants

**`src/extension.ts`**
- Register the command: `vscode.commands.registerCommand('aiForge.gemma4Info', ...)`

### 2.2 Post-Setup Welcome Message

**`src/commands/coreCommands.ts`**
- After successful Gemma 4 setup, post a welcome message to chat explaining:
  - What Gemma 4 can do (code gen, explanation, tests, 128K context)
  - Tips for best results
  - Keyboard shortcuts
  - How to switch variants
- Track via `workspaceState` key `aiForge.gemma4WelcomeShown` — show once per workspace

### 2.3 First-Use Tip

**`src/ui/chatPanel.ts`**
- After Gemma 4 streams its first response in a workspace, show a dismissible tip:
  - Privacy note: "Running locally — code stays on your machine"
  - Example prompts
  - Keyboard shortcuts
- Track via flag so it shows only once per session
- CSS styling: `.gemma4-tip` class with subtle background, dismiss link

### 2.4 Enhanced Onboarding Welcome

**`src/ui/chatPanel.ts`**
- Expand the Gemma 4 option in the "Welcome to Evolve AI" onboarding:
  - Explain what it is: "Google's latest open-weight AI model"
  - Key features: code-focused (140+ languages), multimodal, 128K-256K context, 4 variants
  - "Set up Gemma 4 (guided wizard, ~2 minutes)" link

---

## Phase 3: Gemma 4 Advanced Features

**Goal:** Leverage unique Gemma 4 capabilities that other providers don't offer.

### 3.1 Dynamic Context Budget (Low effort)

**`src/core/contextService.ts`**
- Check current provider and model in `build()` method
- When provider is `gemma4`, auto-scale `contextBudgetChars`:
  - E2B/E4B (128K context window): 80,000 chars
  - 26B/31B (256K context window): 120,000 chars
- Keep existing `contextBudgetChars` setting as manual override
- More context = more related files + full git diffs + richer plugin data

### 3.2 Thinking / Reasoning Mode (Low effort)

**How it works:** Gemma 4 has built-in chain-of-thought. Add `"think": true` to Ollama request.
Model outputs reasoning inside `<|channel>thought\n...<channel|>` markers.

**Implementation:**
- `src/ui/chatPanel.ts`: Add "Thinking Mode" toggle button in chat header
- `src/core/aiService.ts`: When thinking enabled, add `think: true` to Ollama request body in `_streamGemma4()`
- `src/ui/chatPanel.ts`: Parse response, separate thinking tokens, show in collapsible block
- CSS: Style thinking blocks with lighter text, different background, collapse/expand
- **Bug workaround**: Never set `think: false` — omit the parameter entirely when disabled

### 3.3 Vision / Image Input (Medium effort)

**How it works:** Ollama accepts `images` array (base64) in chat messages:
```json
{ "role": "user", "content": "What's in this?", "images": ["<base64>"] }
```

**Implementation:**
- `src/core/aiService.ts`: Extend `Message` type to include optional `images?: string[]`
- `src/core/aiService.ts`: Update `_streamOllamaWithModel()` to include images in request body
- `src/ui/chatPanel.ts`: Add drag-and-drop zone in chat input area
- `src/ui/chatPanel.ts`: Add paste handler for clipboard images (Ctrl+V)
- `src/ui/chatPanel.ts`: Show image thumbnail preview before sending
- `src/ui/chatPanel.ts`: Display sent images in message history
- Only enable when provider supports vision (`gemma4` or `ollama` with vision model)

**Use cases:** Analyze error screenshots, review UI mockups, read diagrams, interpret terminal output

### 3.4 Structured Output / JSON Mode (Medium effort)

**How it works:** Ollama supports `format` parameter with JSON schema:
```json
{ "format": { "type": "object", "properties": { "edits": {...} } } }
```

**Implementation:**
- Define JSON schemas for: edit response, create response, explain response
- `src/core/aiService.ts`: Add `format` parameter to `_streamGemma4()` request body for edit/create modes
- Update response parsing to handle JSON instead of markdown code blocks
- Fallback to markdown parsing if JSON mode fails
- Only use for edit/create modes, not chat mode (chat needs freeform text)

### 3.5 Native Function Calling / Tool Use (High effort)

**How it works:** Gemma 4 has native function calling with special tokens. Ollama accepts `tools` array.
Model returns `tool_calls` in response; extension executes tool, sends result back as `"role": "tool"`.

**Implementation:**
- Define tool schemas: `apply_edit`, `create_file`, `read_file`, `search_codebase`, `run_command`
- `src/core/aiService.ts`: Add tools to request body, handle multi-turn tool loop
- New service or module for tool execution and safety checks
- UI for showing tool execution progress and results
- This is essentially building an agentic coding system — significant architecture work

### 3.6 Audio / Voice Input (Not recommended now)

E2B and E4B support 30-second audio input. However:
- Only smallest models support it
- 30-second limit constrains usefulness
- Ollama's audio API is not yet mature
- VS Code's own speech-to-text API is more reliable for voice input

**Recommendation:** Wait for Ollama's audio API to mature. Revisit in 6 months.

---

## Phase 4: Marketplace & Distribution

**Goal:** Get the extension in front of maximum users.

### 4.1 Marketplace Metadata (Code changes)

**`package.json`**
- Keywords: `ai`, `copilot alternative`, `ollama`, `code assistant`, `local llm` (exactly 5)
- Description: mention Gemma 4, "free", "private", "13 plugins"
- Category: replace `Other` with `Testing`
- Add: `homepage`, `bugs` URL, `galleryBanner`, `extensionKind`, `badges` array (4 badges)

### 4.2 README Optimization (Code changes)

- Badges at top (version, installs, license)
- "Why Evolve AI?" hero section (4 bullets: free/private, auto-detecting plugins, any provider, deep context)
- "Get Started in 60 Seconds" (3 bash commands)
- Comparison table vs Copilot, Continue.dev, Cody
- Gemma 4 dedicated section with variant table
- FAQ: "What is Gemma 4?", updated model recommendations
- Contributing section pointing to CONTRIBUTING.md
- Mention "Works in Cursor, VSCodium, and other VS Code forks"

### 4.3 New Files

- `CONTRIBUTING.md` — dev setup, architecture overview, "add a plugin" guide, wanted plugins, PR guidelines
- `docs/LAUNCH_POSTS.md` — 6 ready-to-post texts (HN, r/LocalLLaMA, r/vscode, r/devops, r/dataengineering, Product Hunt)

### 4.4 Launch Actions (Manual, outside code)

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Create visual assets (banner, screenshots, GIF) | Manual |
| 2 | Post on r/LocalLLaMA | Copy from LAUNCH_POSTS.md |
| 3 | Show HN post | Copy from LAUNCH_POSTS.md |
| 4 | Publish to Open VSX (`npx ovsx publish -p <token>`) | 5 min |
| 5 | Product Hunt launch | Prep 6 weeks, screenshots required |
| 6 | Start Discord community | Manual |
| 7 | Dev.to / Medium tutorials | Manual |
| 8 | YouTube demo (2-5 min) | Manual |
| 9 | List on awesome-vscode | Submit PR |
| 10 | JetBrains plugin | Large project — doubles addressable market |

---

## Recommended Build Order

| Order | What | Effort | Impact | Phase |
|-------|------|--------|--------|-------|
| 1 | Core provider integration (type, streaming, detection, routing) | Medium | Critical | Phase 1.1 |
| 2 | Setup wizard (4-step guided flow) | Medium | Critical | Phase 1.2 |
| 3 | UI integration (status bar, chat panel, onboarding) | Medium | Critical | Phase 1.3 |
| 4 | Documentation updates (README, ARCHITECTURE, CLAUDE.md) | Low | High | Phase 1 |
| 5 | Help UX (gemma4Info command, welcome message, first-use tip) | Medium | High | Phase 2 |
| 6 | Marketplace metadata + CONTRIBUTING.md + LAUNCH_POSTS.md | Low | High | Phase 4 |
| 7 | Dynamic context budget | Low | Medium | Phase 3.1 |
| 8 | Thinking mode | Low | Medium | Phase 3.2 |
| 9 | Vision / image input | Medium | High | Phase 3.3 |
| 10 | Structured output | Medium | High | Phase 3.4 |
| 11 | Function calling / tool use | High | Very High | Phase 3.5 |

Items 1-6 are the complete Gemma 4 launch. Items 7-11 are post-launch enhancements.

---

## Gemma 4 Model Reference

| Variant | Params | Ollama Tag | Download | Context | RAM | Modalities |
|---------|--------|-----------|----------|---------|-----|------------|
| E2B | 2.3B effective (5.1B with embeddings) | `gemma4:e2b` | ~7.2GB | 128K | 8GB+ | text+image+audio |
| E4B | 4.5B effective (8B with embeddings) | `gemma4:e4b` | ~9.6GB | 128K | 16GB+ | text+image+audio |
| 26B MoE | 25.2B total (3.8B active per token) | `gemma4:26b` | ~18GB | 256K | 32GB+ | text+image |
| 31B Dense | 30.7B | `gemma4:31b` | ~20GB | 256K | 32GB+ GPU | text+image |

- All support: native function calling, configurable thinking, system prompts
- License: Apache 2.0 (fully permissive commercial use)
- Released: April 2, 2026

---

## Files to Modify (Complete List)

| File | Phase | Changes |
|------|-------|---------|
| `package.json` | 1, 2, 4 | Provider enum, gemma4Model setting, gemma4Info command, keywords, badges, metadata |
| `src/core/aiService.ts` | 1, 3 | ProviderName, isGemma4Available, _streamGemma4, detectProvider, _offline guide, Message type (vision), think param |
| `src/core/interfaces.ts` | 1 | isGemma4Available in IAIService |
| `src/core/contextService.ts` | 3 | Dynamic context budget per provider/model |
| `src/test/mocks.ts` | 1 | isGemma4Available mock |
| `src/commands/coreCommands.ts` | 1, 2 | Setup wizard, gemma4Info, post-setup welcome |
| `src/extension.ts` | 2 | Register gemma4Info command |
| `src/ui/statusBar.ts` | 1 | Gemma 4 icon, display, enhanced tooltip |
| `src/ui/chatPanel.ts` | 1, 2, 3 | Status, onboarding, provider label, first-use tip, thinking mode UI, vision drag-drop |
| `README.md` | 4 | Hero, quick start, comparison, Gemma 4 section, FAQ, badges |
| `docs/ARCHITECTURE.md` | 1 | Provider list, detection logic |
| `CLAUDE.md` | 1 | gemma4Model in settings table |
| `CONTRIBUTING.md` | 4 | New file — contributor guide |
| `docs/LAUNCH_POSTS.md` | 4 | New file — 6 launch post drafts |
