# Model Advisor — detailed build plan

> Companion to `docs/MODEL_ADVISOR.md` (the design). This file is the **implementation
> plan**: exact files, signatures, call sites, tests and acceptance criteria, in the order
> they should be written.
>
> Status: **all phases built** on `fix/model-size-matching`. Phase 0 (size-matching fix),
> 1 (foundation), 2 (advisor UI), 2.5 (flowchart renderer), 3 (flows + FDE), 4 (unify).
> 145 core tests passing; desktop 7; FDE 76; `verify:honest` 61/0.
>
> Ground rule for every phase: **the build compiles clean and all existing tests pass at
> the end of every numbered step**, not just at the end of a phase. Nothing below deletes
> or rewrites a working code path; the duplicated advisory path is retired only in Phase 4,
> after its replacement has shipped and been used.

---

## 0. Conventions this plan follows

Taken from the existing codebase, not invented here:

| Convention | Source of truth |
|---|---|
| Pure, dependency-free modules returning data or SVG strings | `src/offline/advancedVisuals.ts:1-15` |
| Mocha TDD (`suite`/`test`), pure-function unit tests | `src/test/suite/modelCapability.test.ts` |
| SVG tests pin well-formedness + **escaping of untrusted strings**, not pixels | `src/test/suite/offline/advancedVisuals.test.ts:1-30` |
| Optional `IServices` members so test mocks keep compiling | `src/core/services.ts:46-48` |
| Per-session model override, never a global write | `src/plugins/codeConvert.ts:134` + `AIRequest.providerOverride` |
| Provenance on every claim | `src/core/modelCapability.ts` `source:` field; `src/fde/provenance.ts` |
| Docs updated in the same release as the code | `CLAUDE.md` house rule |

**Definition of done, applied to every phase:**

1. `npm run compile` → exit 0
2. `npm test` → no new failures; the six `modelCapability.test.ts` tests pass **unmodified**
3. `npm run verify:honest` → still passes
4. Docs in that phase's row of §6 updated
5. `CHANGELOG.md` entry in house style

---

## Phase 1 — Foundation (v2.26.0)

No UI. Pure logic + detection. This is the phase that makes everything else cheap.

### 1.1 New file — `src/core/modelAdvisor.ts`

Pure module, no `vscode` import except types where unavoidable, so it unit-tests headlessly.

```ts
export type ModelJob =
  | 'chat' | 'reasoning' | 'code-agentic' | 'code-fim'
  | 'embedding' | 'reranking' | 'vision' | 'ocr'
  | 'classification' | 'timeseries';

export type JobFitness = 'native' | 'capable' | 'poor' | 'unsupported';

/** Reuses modelCapability's vocabulary deliberately — do not invent a third scale. */
export type CapabilitySource = 'detected' | 'known' | 'assumed';

export interface ModelAttributes {
  deployability: 'edge' | 'single-gpu' | 'multi-node' | 'api';
  architecture?: 'dense' | 'moe';
  attention?: 'encoder-only' | 'decoder-only' | 'enc-dec';
  modalities: Array<'text' | 'image' | 'audio'>;
  reasoning?: boolean;
  openWeight?: boolean;
  parameterSize?: string;      // as reported by Ollama, e.g. "7.6B"
  family?: string;             // as reported by Ollama, e.g. "qwen2"
}

export interface ModelProfile {
  id: string;
  provider: string;
  jobs: Partial<Record<ModelJob, JobFitness>>;
  attributes: ModelAttributes;
  source: CapabilitySource;
  capability: ModelCapability;   // from modelCapability.ts — composed, not duplicated
}

export interface JobAlternative {
  id: string;
  provider: string;
  why: string;
  installed: boolean;
  /** Set when the user can act on it directly, e.g. "ollama pull qwen2.5-coder:7b". */
  pullCommand?: string;
}

export interface JobRecommendation {
  job: ModelJob;
  verdict: 'ideal' | 'workable' | 'wrong-tool' | 'unsupported';
  headline: string;
  rationale: string;
  alternatives: JobAlternative[];
  source: CapabilitySource;
}

export function profileModel(
  id: string,
  provider: string,
  detected?: OllamaModelInfo,
): ModelProfile;

export function recommendForJob(
  job: ModelJob,
  candidates: ModelProfile[],
  constraints?: { offlineOnly?: boolean; maxDeployability?: ModelAttributes['deployability'] },
): JobRecommendation;

/** Maps free-text task + the ladder's inputModality onto a job. */
export function inferJobFromTask(
  text: string,
  modality?: 'structured_data' | 'unstructured_text' | 'multimodal' | 'api_stream',
): { job: ModelJob; confidence: 'high' | 'low'; note?: string };

/** The corrected taxonomy, as data — drives docs, UI copy and diagrams alike. */
export const JOB_CATALOG: ReadonlyArray<{
  job: ModelJob;
  label: string;
  inScope: boolean;
  whatItDoes: string;
  whenToUse: string;
  commonMistake: string;   // e.g. "using a chat model for FIM autocomplete"
}>;
```

**Key design point — `JOB_CATALOG` is data, not prose in a template.** It is consumed by
the advisor UI, the docs generator and the diagram layer, so the corrected taxonomy exists
in exactly one place.

**Parsimony bias, explicit in `recommendForJob`:** when several candidates are `native`,
prefer the smallest/cheapest. Ties break toward local over cloud, then toward smaller
`parameterSize`. This is the FDE Rule of Parsimony expressed in code, and it is the actual
lesson of the source infographic.

### 1.2 Extend Ollama detection

`src/core/interfaces.ts` — widen the **existing optional** method's return type
(backwards-compatible; no caller breaks):

```ts
export interface OllamaModelInfo {
  contextTokens?: number;
  capabilities?: string[];   // NEW: completion|tools|insert|vision|embedding|thinking
  family?: string;           // NEW
  parameterSize?: string;    // NEW
}

getOllamaModelInfo?(model: string, host?: string): Promise<OllamaModelInfo | null>;
```

`src/core/aiService.ts:336-361` — the `/api/show` response is already parsed; currently
only `model_info.*.context_length` is read and the rest discarded. Also read
`json.capabilities`, `json.details.family`, `json.details.parameter_size`.

**Watch this when implementing:** the current body does
`const info = JSON.parse(data)?.model_info; if (!info) { resolve(null); return; }`
(`aiService.ts:352-353`) — it bails out before reading anything else. `capabilities` and
`details` are **siblings of `model_info`, not children**, so that early return must be
relaxed or capabilities will be silently dropped for any model whose response lacks
`model_info`. Return a partial object rather than `null` when at least one field is
present.

**Verified live against the local Ollama during design:**

```
POST /api/show {"model":"qwen2.5-coder:7b"}
  → capabilities: ["completion","tools","insert"]
  → details.family: "qwen2"
  → details.parameter_size: "7.6B"
```

Capability → job mapping: `vision`→`vision`, `embedding`→`embedding`, `insert`→`code-fim`,
`tools`→tool use, `thinking`→`reasoning`. Anything from this path is `source: 'detected'`;
the static table stays `'known'`; unknown models are `'assumed'` **and the UI says so**.

### 1.3 Rewire `assessModelForDataAnalysis` as a wrapper — **not done, deliberately**

> **Outcome:** the bug fix in §1.3a shipped; the wrapper rewrite did not, and should not
> without a reason beyond tidiness.
>
> The point of the wrapper was to end the duplication between the two advisory paths. That
> is already achieved differently: `modelAdvisor.ts` is now the single place new advisory
> logic goes, and `assessModelForDataAnalysis` is a stable, tested function with two callers
> and a freshly corrected size matcher. Rewriting its internals would risk the six
> regression tests and the `qwen3:32b` fix for no user-visible change. Left as-is; revisit
> only if a third caller wants behaviour the old shape cannot express.

The original plan follows, for the record.

### 1.3 Rewire `assessModelForDataAnalysis` as a wrapper

`src/core/modelCapability.ts:313` keeps its exact signature and return type. Its body
delegates to `recommendForJob`, mapping the new verdict onto the old
`DataAnalysisModelVerdict` shape.

**The six existing tests in `src/test/suite/modelCapability.test.ts` must keep passing
unmodified.** They pin the *intended* behaviour (cloud → optimal, 14B coder → optimal, 3B →
underpowered) and all six remain correct.

#### 1.3a First, fix the live bug this rewrite exposes

Probing the real branch order revealed that `assessModelForDataAnalysis` **misclassifies
current models today**. The "underpowered" branch tests
`/0\.5b|1b|1\.5b|2b|3b|mini|tiny|phi-?3/i` against the bare model string, with no separator
and no word boundary, so the digits match *inside* larger sizes:

| Model | Today's verdict | Correct |
|---|---|---|
| `qwen3:32b` | ⚠️ **"Underpowered for Data Science"**, `isOptimal:false` | capable 32B |
| `llama3.2:13b` | ⚠️ Underpowered | capable 13B |
| `llava:13b` | ⚠️ Underpowered | a **vision** model; no branch understands it |
| `nomic-embed-text` | "use qwen2.5-coder for data science" | an **embedding** model; the advice is nonsense |

`"32b"` contains `"2b"`; `"13b"` contains `"1b"`. A user running `qwen3:32b` — a current,
perfectly capable model — is told it is too small.

**This exact bug class was already found and fixed on the converter path.** `KNOWN_MODELS`
(`modelCapability.ts:104`) uses `[:\-](?:[1-3](?:\.\d+)?)b\b` with a comment stating the
separator and `\b` are load-bearing *"without them this would also match the 2b inside
qwen2.5-coder:32b and mislabel a 32B model."* The data-analysis path never received the
fix — which is precisely the cost of having two divergent implementations, and the
strongest practical argument for Phase 1.

So: **fix the size matching first, as its own commit, with its own tests** (`qwen3:32b`,
`llama3.2:13b`, `codestral:22b` must not be "underpowered"), *then* rewire to
`recommendForJob`. Two separate commits, so the bug fix is reviewable independently of the
refactor and bisects cleanly.

Correcting these changes user-visible verdicts for previously-misclassified models. That is
a **fix, not a regression** — call it out explicitly in `CHANGELOG.md`.

### 1.4 Tests — `src/test/suite/modelAdvisor.test.ts`

- `profileModel` prefers detected capabilities over the table; sets `source` correctly
- an embedding-only model is `unsupported` for `chat`, `native` for `embedding`
- a 3B general model is `poor` for `code-agentic`
- `recommendForJob` picks the **smallest** sufficient model when several are `native`
- `inferJobFromTask('reconcile invoice totals', 'structured_data')` → low confidence +
  a note that rules may beat a model entirely
- unknown model → `assumed`, and the recommendation text says the limits are assumed
- `JOB_CATALOG` covers every `ModelJob` member (guards against drift)

**Acceptance:** compile clean; new tests pass; the six existing ones pass unmodified; no UI
change visible to users.

---

## Phase 2 — Advisor UI (v2.27.0)

### 2.1 `src/ui/modelAdvisorPanel.ts`

Modelled on `src/ui/codeConvertPanel.ts` (585 lines) — same webview idiom, CSP, message
union, `setX()` push methods.

Content: a job picker ("what are you trying to do?"), the recommendation with a
**provenance badge** (`detected` / `known` / `assumed`), installed-model list with what
each is good at, actionable alternatives, and a **"model types explained"** section
rendered from `JOB_CATALOG` — the corrected taxonomy, which is the educational payload of
the original post done properly.

### 2.2 Command + manifest

- `aiForge.model.advisor` — "Evolve AI: Which Model Should I Use?"
- Register in `src/commands/coreCommands.ts` (class-based group, per `extension.ts:82`)
- Add to `package.json` → `contributes.commands`

### 2.3 Chat model pill hint

`src/ui/chatPanel.ts:765-782` (pill markup) and `resolveModelView` (`:1693`). Add a
one-line job-aware hint. **Read-only** — no behaviour change to `_pickModel` in this phase.

**Acceptance:** panel opens, recommends, never writes settings, never auto-switches.

---

## Phase 2.5 — Offline flowchart renderer (v2.27.0)

Independently valuable and deliberately separable: a pure parser with no product opinion,
which fixes diagrams the product **already ships broken**.

### 2.5.1 The problem, verified

`parseSequenceDiagram()` (`src/desktop/renderer/renderer.ts:2540`) is a hand-written
offline Mermaid renderer supporting **`sequenceDiagram` only** — it rejects anything else:
*"Preview supports `sequenceDiagram` only."*

The codebase generates **29 `flowchart` diagrams (9 in `ipcHandlers.ts`, 20 in `renderer.ts`)** (ladder levels at
`ipcHandlers.ts:4367,4416,4463,4503,4533,4559,4587,4615,4642`; gate templates at
`renderer.ts:15829+`; topology at `renderer.ts:13350`). **None render as pictures.** They
are copy-to-clipboard text — including on the air-gapped client laptops where a showcase
matters most.

The renderer is hand-written for a documented reason (`renderer.ts:2511-2519`): the Studio
ships to banking and defence laptops advertising air-gapped operation, so a CDN fetch is
out, and bundling ~2.8MB of mermaid.js into a 360KB renderer was judged disproportionate.
**That reasoning still holds — extend the renderer, do not bundle mermaid.**

### 2.5.2 New file — `src/offline/flowchartRenderer.ts`

Placed in `src/offline/` deliberately, not in the Electron renderer. Per that module's own
header, these are *"pure and dependency-free, so it can be consumed from the Electron
renderer, a VS Code webview, or a headless report build."* That is precisely what this
needs: the same diagram must render in the Cockpit, the Advisor panel **and** the exported
client HTML.

```ts
export interface FlowNode {
  id: string; label: string;
  shape: 'box' | 'round' | 'diamond' | 'stadium';
  lane?: string;              // subgraph — used for the build-time lane
}
export interface FlowEdge {
  from: string; to: string;
  label?: string; dashed?: boolean;
}
export interface ParsedFlowchart {
  direction: 'TD' | 'LR';
  nodes: FlowNode[]; edges: FlowEdge[];
  lanes: Array<{ id: string; label: string }>;
  errors: string[];
}

export function parseFlowchart(src: string): ParsedFlowchart;

export interface FlowRenderOptions {
  title?: string;
  /** Step index to highlight — drives the existing photon animation. */
  activeStep?: number;
  photonRatio?: number;
}
export function renderFlowchartSvg(
  src: string, options?: FlowRenderOptions,
): { svg: string; errors: string[] };
```

Supported subset — **measured from the 27 diagrams actually in the repo**, not guessed.
An inventory of every flowchart literal found exactly seven syntax features:

| Feature | Form | Notes |
|---|---|---|
| Header | `flowchart TD` / `flowchart LR` | both appear |
| Box node | `A["label"]` | the common case |
| Decision node | `B{"label"}` | |
| Plain edge | `A --> B` | |
| Dotted edge | `A -.-> B` | |
| Labelled edge | `A -- "label" --> B` | **always quoted** in practice |
| Grouping | `subgraph` … `end` | |

**Not present, so not in scope:** `classDef`, `:::class`, `style`, pipe-labels
(`-->|x|`), and `(("circle"))` nodes. Parse them to a graceful `errors` entry rather than
supporting them speculatively — add support only when something emits them.

Labels contain emoji, `>=`, `<`, `/` and parentheses (e.g. `"✅ Verified Output (<80ms)"`,
`"Score >= 0.90"`), so **escaping is load-bearing** — a raw `<` in a label breaks the SVG.
This is the property the `advancedVisuals` suite already pins.

Layout: longest-path layering (rank by depth), centred within rank, orthogonal edges with
simple collision offsets. Deterministic — no physics, no randomness, so output is stable
and snapshot-friendly.

Reuse from `advancedVisuals.ts`: `esc()`, `PALETTE`, and the `#090d16`/`#1e293b`/slate
surface tokens, so diagrams sit beside existing charts without a reskin.

### 2.5.2a ⚠️ Blocker: the desktop renderer cannot import a module

**Found while pressure-testing this plan. It invalidates the naive version of 2.5.3.**

`src/desktop/renderer/renderer.ts` has **zero real imports** (every `import` line in it is
inside a generated code *string*). It compiles to CommonJS and is loaded as a plain
`<script src="renderer.js">` (`index.html:8799`) into a renderer created with
`contextIsolation: true`, `nodeIntegration: false` (`main.ts:105-107`).

The compiled output already begins `Object.defineProperty(exports, "__esModule", …)` and
survives only because nothing ever calls `require()`. **Adding a real import to
`renderer.ts` emits a `require()` and throws at runtime** — the window would come up blank.
`copy-desktop-assets.js` copies static files only; there is no bundler in the build.

Three options, in preference order:

1. **Duplicate-free via a build step** — add a tiny esbuild/rollup bundle for
   `renderer.ts` in `npm run compile`. Cleanest long-term, but it changes the desktop build
   and touches `RELEASE_RUNBOOK.md`; not something to slip into this feature.
2. **✅ Recommended: shared source, two consumers, no import.** Keep
   `src/offline/flowchartRenderer.ts` as the canonical module for the **VS Code webview
   and the HTML export** (which *can* import it). For the desktop renderer, have
   `copy-desktop-assets.js` also emit the compiled module as a global-scope script
   (`out/desktop/renderer/flowchart.js`) included by a second `<script>` tag before
   `renderer.js`. One source file, one compile, no bundler, no `require()`.
3. **Reject: copy the code into `renderer.ts`.** Two implementations of the same parser is
   exactly the divergence Phase 1 exists to end.

**Option 2, verified by experiment — and the obvious version of it does not work.**

Writing `globalThis.EvolveFlowchart = {…}` at the bottom of the module is *not* enough.
`tsc --module commonjs` still emits `exports.parseFlowchart = …` at top level, and a
classic script has no `exports`, so the file throws before reaching the assignment:

```
RESULT: THREW -> exports is not defined
```

The fix that does work is a **three-line CommonJS shim applied by
`copy-desktop-assets.js`** when it emits the renderer copy:

```js
// scripts/copy-desktop-assets.js — emit out/desktop/renderer/flowchart.js
const body = fs.readFileSync('out/offline/flowchartRenderer.js', 'utf8');
fs.writeFileSync(dest,
  '(function(){var exports={};var module={exports:exports};\n' +
  body +
  '\nglobalThis.EvolveFlowchart=exports;})();'
);
```

Verified in a browser-like sandbox with no `exports`/`module`/`require` in scope:

```
loaded OK -> [ 'parseFlowchart', 'renderFlowchartSvg' ]
smoke: <svg>y</svg>
```

So the module itself needs **no** special global-export code — it stays a normal,
testable module, and the shim is applied at copy time. `index.html` gains one
`<script src="flowchart.js"></script>` **before** `renderer.js`; renderer code calls
`globalThis.EvolveFlowchart.renderFlowchartSvg(...)`.

Add a build assertion that the emitted file contains no `require(` — a future top-level
import would silently reintroduce the blocker, and the failure mode is a blank window.

**Estimate impact:** Phase 2.5 grows by the asset-emit step and a build check. Still low
risk, but it is no longer "just a parser" — budget for the plumbing.

### 2.5.3 Wire into the existing preview

`renderer.ts` — where `parseSequenceDiagram` is called (`:2693`, `:5212`) and in
`paintDiagram`, dispatch on the first line: `sequenceDiagram` → existing path (untouched),
`flowchart` → new renderer. Extend `startFlowAnimation()` (`:5211`) to walk flowchart edges
the same way it walks sequence messages, reusing the photon.

Slot into the existing four-tab shell `gatePreviewMode: 'visual'|'mermaid'|'tradeoff'|'code'`
(`renderer.ts:16184`) — the `mermaid` tab stops being raw text and becomes a picture.

### 2.5.4 Tests — `src/test/suite/offline/flowchartRenderer.test.ts`

Mirroring `advancedVisuals.test.ts` conventions:

- parses each shape and edge form; unknown syntax → `errors`, never a throw
- **untrusted label strings cannot break out of the markup** (the XSS property that suite
  already pins)
- SVG well-formedness (`<svg>`/`</svg>` balanced)
- empty/garbage input → graceful empty state
- **regression:** feeding the existing `sequenceDiagram` fixtures still routes to the old
  renderer and produces identical output
- **fixture test: every `flowchart TD` literal currently in the codebase parses with zero
  errors** — this is the real acceptance criterion for "we fixed the broken diagrams"

**Acceptance:** the 29 existing flowcharts render as pictures for the first time; no
change to any sequence diagram; zero new dependencies; air-gap guarantee intact.

---

## Phase 3 — Visual flows + FDE integration (v2.28.0)

### 3.1 `src/core/modelFlows.ts` — the corrected diagrams as data

One entry per in-scope job, each emitting `flowchart` source for the Phase 2.5 renderer.

```ts
export interface ModelFlow {
  job: ModelJob;
  title: string;
  /** flowchart source, runtime path only. */
  runtime: string;
  /** Separate lane — build/deploy steps never mixed into the runtime path. */
  buildTime?: string;
  /** Where this shape comes from. Honesty applies to pictures too. */
  provenance:
    | { kind: 'paper'; cite: string; url: string }   // follows a specific published arch
    | { kind: 'family'; note: string };              // illustrative of a family
  costNote: string;   // where latency and tokens actually go
}
export const MODEL_FLOWS: ReadonlyArray<ModelFlow>;
```

The corrections each flow must encode (from the diagram audit in `MODEL_ADVISOR.md` §0.2b):

| Flow | Must show |
|---|---|
| Text generation | the **decode loop** — not a single pass |
| MoE | routing **inside each layer**, interleaved; experts replace the **FFN only** |
| VLM | no phantom "text encoder"; vision encoder → **projection** → shared LLM context |
| Encoder-only | **joint** bidirectional attention, not left/right branches; training vs inference separated |
| Embedding + reranking | the two-stage retrieve→rerank pattern the source list omits entirely |
| Tool use | `prompt → tool call → execute → observe → loop`, with the HITL gate |
| Segmentation | image embedding computed **once**, reused per prompt; no "feature correlation" |
| Small / edge | deployment steps in a **separate lane** from the inference path |

### 3.2 Close the `inputModality` gap

`src/desktop/main/ipcHandlers.ts:4312` — the handler declares `inputModality` at `:4316`,
the UI collects it (`index.html:3439`) and passes it (`renderer.ts:16734`), and **the
handler never reads it.**

Add a `modelGuidance` block to the response. **Purely additive — every existing field is
untouched**, so nothing downstream breaks:

```ts
modelGuidance?: {
  job: ModelJob;
  headline: string;
  rationale: string;
  flowDiagram?: string;      // flowchart source
  provenance: CapabilitySource;
}
```

| modality | implies | typical job |
|---|---|---|
| `structured_data` | rules/SQL beat models | often Level 1 — **no LLM at all** |
| `unstructured_text` | embed + rerank + grounded generation | embedding, reranking, chat |
| `multimodal` | vision or OCR required | vision, ocr |
| `api_stream` | classification / routing | classification |

The `structured_data` answer reinforcing "don't use a model" is the point, not a bug.

### 3.3 FDE Cockpit — Model Fit card

`src/ui/fdeCockpitPanel.ts` has **no model advisory today**; its only AI-model notion is a
free-text box defaulting to `gemma4:latest` (`:2173`). Add one card, reading from the
shared service, rendering the recommendation + flow, so an FDE can explain *why* a model
was chosen with provenance attached.

### 3.4 Export into client deliverables

Flows into the generated HTML in `docs/client/` via the existing document presenter.
Self-contained, no runtime fetch, opens on an air-gapped client laptop.

**Honesty rules for the visuals** (§3.5.4 of the design):
diagrams of *families* labelled distinctly from diagrams of *papers*; cite the paper where
a flow follows one; no latency or cost number on a diagram unless measured or explicitly
marked illustrative.

**Acceptance:** `inputModality` changes the ladder output; flows render in Cockpit and in
exported HTML; `npm run verify:honest` passes; `desktopCore.test.ts` extended for the new
response field.

---

## Phase 4 — Unify and retire the drift (v2.29.0)

The only phase with a behaviour change to a shipped surface, so it goes last.

### 4.1 Data Analysis onto session-scoped overrides

`src/plugins/dataAnalysis.ts:743-751` currently runs
`vscode.commands.executeCommand('aiForge.switchProvider')` — **mutating the user's global
provider to change a per-task model.**

Replace with the converter's proven pattern: an in-memory `ModelChoice` on the plugin
(`codeConvert.ts:134`) applied via `AIRequest.providerOverride`/`modelOverride`
(`aiService.ts:41-57`). A model chosen for one analysis stops leaking into chat.

### 4.2 Make `suggestedLocalModel` actionable

Today it is rendered as prose and **nothing consumes the field**. Wire it to a one-click
"Use this model" that sets the session override — and, when not installed, offers the
`ollama pull` command.

### 4.3 Retire the duplicated path

With `assessModelForDataAnalysis` a wrapper since Phase 1 and its callers migrated, mark it
`@deprecated`, pointing at `recommendForJob`. **Keep the function and its tests** — the
cost of leaving a thin wrapper is near zero and removing it buys nothing.

**Acceptance:** analysing data no longer changes the global provider; one-click switch
works; converter behaviour bit-for-bit unchanged.

---

## 5. Sequencing, effort and risk

| Phase | Depends on | Touches | Risk | Reversible? |
|---|---|---|---|---|
| 1 Foundation | — | `core/` only, additive | Very low | Yes — new file + wrapper |
| 2 Advisor UI | 1 | new panel + 1 command | Low | Yes — delete the panel |
| 2.5 Flowchart | — (independent) | `offline/` + 2 dispatch sites + **asset-emit shim** | Medium (was low — see 2.5.2a) | Yes — dispatch falls back |
| 3 Flows + FDE | 1, 2.5 | desktop IPC, Cockpit, export | Medium | Mostly — response field is additive |
| 4 Unify | 1, 2 | shipped Data Analysis panel | Medium | Yes, but user-visible |

**Phases 1 and 2.5 are independent and can be built in parallel.** Phase 2.5 is the one to
start with if the goal is a visible win fast — it fixes existing broken diagrams and needs
no agreement about taxonomy.

Risks carried from the design doc, plus build-specific ones:

| Risk | Mitigation |
|---|---|
| Our diagrams become wrong too | Flows are **data in one file**, each with `provenance`; cite the paper or label as family-level |
| Flowchart layout looks bad on real inputs | Fixture test over **every flowchart literal already in the repo** — real inputs, not toys |
| Touching a 33k-line renderer | New code lives in `src/offline/`; renderer change is a 2-site dispatch on the first line |
| **A top-level import in `renderer.ts` blanks the desktop window** | It currently has zero real imports and no bundler. Build assertion: emitted renderer/flowchart assets must contain no `require(` — see 2.5.2a |
| Fixing the size-matching bug changes shipped verdicts | Intended. Separate commit, its own tests, called out in `CHANGELOG.md` as a fix — see 1.3a |
| Model landscape moves | Detection-first; the table is a labelled fallback, never presented as current truth |
| Advisory drifts into invented authority | No benchmark numbers; provenance on every claim; `verify:honest` in the gate |

---

## 6. Documentation, per phase

| Phase | Docs |
|---|---|
| 1 | `CLAUDE.md` (+`core/modelAdvisor.ts`; **also fix the stale scale — 264 commands not 60, 69 settings, and add the missing `src/desktop/` and `src/enterprise/` trees**), `docs/ARCHITECTURE.md` |
| 2 | `README.md` (new command), `docs/MODEL_ADVISOR.md` → status "shipped, phase 2" |
| 2.5 | `docs/WORKFLOW_TOPOLOGY.md` (flowcharts now render offline), `docs/OFFLINE_SUITE.md` (no new deps — air gap intact) |
| 3 | `docs/FDE_PLAYBOOK.md` (model type as a ladder input; modality→job table; running flows in a showcase), `docs/LOCAL_VS_PAID_MANAGEMENT.md` (Community vs Enterprise split) |
| 4 | `docs/DATA_ANALYSIS.md` (session overrides replace the global switch), `docs/CODE_CONVERSION.md` (shared advisor; converter unchanged) |

`CHANGELOG.md` gets an entry per phase in house style.

---

## 7. Open decisions — needed before Phase 1 starts

These change what gets built, so they are worth settling first:

1. **Time-series — real scope or advisory-only?** Currently planned advisory-only (we name
   the category and say we do not run it). Making it real means a forecasting integration,
   which is a separate product decision.
2. **Phase 4's behaviour change** — is changing Data Analysis's model switching acceptable
   in a shipped panel, or should the global switch stay available as a second button?
3. **Edition split** — is the Model Advisor Community, or is the FDE/client-showcase half
   (Phase 3 export) Enterprise-gated? This affects where the code lives.

4. **The `qwen3:32b` misclassification (§1.3a) is a live bug users hit today.** It can be
   fixed on its own in an hour, independently of this entire plan. Worth shipping as a
   patch release before Phase 1, or fold it into Phase 1?

Everything else in this plan is settled by existing convention and needs no decision.

---

## 8. Validation log — what was actually tested before starting

This plan was pressure-tested rather than reasoned about. What was run, and what it changed:

| Check | Result | Plan change |
|---|---|---|
| Baseline `npx tsc -p ./ --noEmit` | exit 0 | none — clean starting point |
| Widening `getOllamaModelInfo`'s return type against both existing call sites | compiles clean | confirmed 1.2 safe |
| `MockAIService` implements `IAIService` | does not implement the optional method | confirmed no mock breakage |
| Probed the real `assessModelForDataAnalysis` branch order | **`qwen3:32b`, `llama3.2:13b`, `llava:13b` misclassified as "underpowered"** | **added §1.3a — a live bug, fixed as its own commit** |
| Counted flowchart literals | **29** (not the ~20 first stated) | corrected in both docs |
| Inventoried flowchart syntax across 27 extractable diagrams | exactly 7 features; no `classDef`/`:::`/pipe-labels/circles | tightened 2.5.2 to the measured grammar |
| Checked whether `renderer.ts` can import a module | **zero real imports; `contextIsolation:true`, `nodeIntegration:false`, classic `<script>`, no bundler** | **added §2.5.2a — blocker** |
| Tested the obvious global-export fix | **threw `exports is not defined`** | rejected it |
| Tested a CommonJS shim applied at asset-copy time | **loaded OK, smoke test passed** | adopted as the verified approach |

Two of these (the `32b` bug and the renderer import blocker) would have been discovered
mid-build. The second would have shipped a blank desktop window.
