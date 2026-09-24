# Model Advisor — choosing the right *kind* of model, not just the biggest one

> Status: **built and committed** in v2.26.0 — all four phases plus the flowchart renderer.
> Implementation plan and verification log: `docs/MODEL_ADVISOR_BUILD_PLAN.md`.
> Scope: give users and FDEs a defensible answer to "which model should I use for this job?",
> unify the two divergent model-advisory implementations we already ship, extend the
> FDE capability ladder to cover model *type* — not only architecture tier — and draw the
> whole thing as **renderable, animatable architecture flows** usable in a client showcase.
>
> Non-goal: shipping inference for new modalities. This is a **selection and advisory**
> layer. We do not become an image-generation or speech product.

---

## 0. Origin and what we validated

This work started from a widely shared infographic, "8 Different Specialized AI Models"
(LLM · LCM · LAM · MoE · VLM · SLM · MLM · SAM). The instinct behind it is exactly right
and matches something we already believe — **the biggest model is not always the best
model**. That is the same idea as the FDE *Rule of Parsimony* ("always deliver at the
lowest capability level that solves the problem").

But the list itself does not survive checking, and we should not ship it as-is.

### 0.1 What is wrong with the source list

We verified each claim against primary sources. Findings, with confidence:

| # | Claim | Verdict | Detail |
|---|---|---|---|
| 1 | **LLM** — text in, text out | ✅ Sound | The one unambiguous entry. |
| 2 | **LCM** — "Latent Consistency Model", fast image gen | ❌ **Factually wrong** | See 0.2. |
| 3 | **LAM** — "Large Action Model" | ⚠️ Marketing coinage | Coined by Rabbit Inc. for the r1, not from the literature. The *capability* is real; the category name is not. Mainstream terms: tool use / function calling, computer-use agents. |
| 4 | **MoE** — Mixture of Experts | ❌ Category error | An *internal architecture*, orthogonal to every other entry. A model can be an LLM **and** a VLM **and** MoE simultaneously. |
| 5 | **VLM** — vision + language | ✅ Sound | Though frontier models are now natively multimodal rather than bolt-on. |
| 6 | **SLM** — Small Language Model | ⚠️ Real term, fake precision | No agreed threshold (sources range 100M–20B). Better defined by *deployability* than parameter count. |
| 7 | **MLM** — Masked Language Model | ⚠️ Objective, not a type | MLM is a *pretraining objective*. The model type is **encoder-only**. Still current and important (ModernBERT, embedding models). |
| 8 | **SAM** — Segment Anything | ❌ Category error | A Meta *product name*, not a category — like listing "ChatGPT" instead of "LLM". Generic category: promptable / open-vocabulary segmentation. Also two generations stale (SAM 3, Nov 2025). |

**Only 3 of 8 are clean, well-established model categories.**

### 0.2 The LCM error, confirmed against primary sources

This is the clearest defect and worth stating precisely, because it is the kind of thing
a client will catch.

The infographic's LCM panel shows: *sentence segmentation → SONAR embedding → diffusion /
advanced patterning / hidden process → quantization → output*.

- That diagram is **Meta's Large Concept Model** — [arXiv:2412.08821](https://arxiv.org/abs/2412.08821),
  "Large Concept Models: Language Modeling in a Sentence Representation Space". Verified:
  it operates on sentence-level SONAR embeddings (200 languages, text and speech) and
  explicitly explores MSE regression, diffusion-based generation, and quantized-SONAR
  variants. Exactly the diagram.
- The caption beneath it describes **Latent Consistency Models** —
  [arXiv:2310.04378](https://arxiv.org/abs/2310.04378), "Synthesizing High-Resolution Images
  with Few-Step Inference". Verified: image synthesis via few-step latent ODE solving.
  **No sentence segmentation. No SONAR. No language modeling at all.**

Two unrelated papers, fused into one panel. Neither, incidentally, belongs in a list of
"model types a user picks between": Latent Consistency is a *distillation technique*, and
Large Concept Model is a *research architecture* with essentially no production deployment.

### 0.2b The pipeline diagrams — audited node by node

The infographic's value is not really its labels, it is the eight little **pipelines**.
Those are what a client actually learns from, so they were audited individually against
primary sources. Verdicts:

| Panel | Diagram verdict | What is wrong |
|---|---|---|
| **LLM** | ✅ Correct | `input → tokenization → embedding → transformer → output`. Textbook. Could add the decode loop (generation is autoregressive — the diagram looks single-pass). |
| **LCM** | ❌ Wrong model | Diagram is Meta's Large Concept Model; caption is Latent Consistency Models. Internally the *diagram* is roughly faithful to arXiv:2412.08821 (segmentation → SONAR → {diffusion, quantized} variants) — but those are **alternative research variants, not sequential stages**, which the diagram draws as a pipeline. |
| **LAM** | ⚠️ Invented | "perception system → intent recognition → task breakdown → action planning → memory system → neuro-symbolic integration → quantization → feedback integration" is not any published architecture. **"Quantization" here is meaningless** — it is a deployment/compression step, not a reasoning stage. Real shape: `prompt → LLM → structured tool call → execute → observe → loop`. |
| **MoE** | ❌ Structurally wrong | Draws routing as **once, at the model's front door**. Verified: routing happens **per MoE layer**, independently, interleaved with attention layers. Also omits that experts replace the **FFN block only** — attention is shared. Top-k selection and weighted combination are right, but they happen N times, not once. |
| **VLM** | ⚠️ Mostly right | `image → vision encoder → projection → LLM` is correct (LLaVA-family). But there is **no separate "text encoder"** — text goes straight to the LLM's own embeddings. "Multimodal processor" is an invented box. |
| **SLM** | ⚠️ Category confusion | An SLM's *inference path is identical to an LLM's*. "Model quantization", "memory optimization" and "edge deployment" are **deployment steps, not inference stages** — the diagram mixes build-time and run-time into one flow. |
| **MLM** | ⚠️ Two real errors | (a) Shows `text → token masking → embedding layer`; masking is applied to **tokens before embedding** — that ordering is right, but (b) it draws **"left context" and "right context" as separate branches** feeding bidirectional attention. Verified against BERT: attention is **jointly bidirectional in all layers**, not two pathways that merge. Also this is a *training* diagram; at inference you use the encoder for embeddings/classification. |
| **SAM** | ⚠️ One invented node | `prompt encoder + image encoder → image embedding → mask decoder` is correct. But **"feature correlation" does not exist** in SAM. Verified: three components only. The diagram also misses the real headline — the image embedding is computed **once and reused across many prompts**, which is the entire reason SAM is interactive. It also omits the IoU/mask-quality head. |

**Net: 1 of 8 diagrams is clean (LLM). 1 is the wrong model entirely (LCM). 6 need
correction.** Three of them (LAM, SLM, MoE) are not just imprecise — they would teach a
client something false about how the thing works.

This is the strongest argument for drawing our own rather than reproducing these.

### 0.3 The deeper structural flaw

The list puts five different axes on one line: capability (LLM, VLM), size (SLM),
architecture (MoE), training objective (MLM), and product name (SAM).

That is why it cannot be used as a picker. **A user choosing a model needs to answer
"what is the job?" first, then filter by size, architecture, modality, context and
licence.** MoE and MLM are filters. SAM is a product. That reframing is the design
principle for everything below.

### 0.4 What the list misses — and this matters more to us than the errors

For a developer-tooling and data-engineering product, the omissions are more costly than
the mistakes:

- **Embedding models** — the single biggest gap. Nothing in the list covers text → vector,
  which underpins RAG, semantic code search and every retrieval pipeline. *We already ship
  these* (`src/enterprise/rag/ragPipelineScaffolder.ts` defaults to `nomic-embed-text`).
- **Reranker models** — cross-encoders that rescore top-k. The standard pattern is
  embed → retrieve → rerank; without rerankers we document half of RAG.
- **Reasoning models / thinking modes** — a major 2025–26 capability axis. *We already
  expose this* as `aiForge.gemma4ThinkingMode`.
- **Code models with fill-in-the-middle (FIM)** — architecturally distinct from chat
  completion, and what inline autocomplete actually requires. Directly relevant to
  `ui/inlineActions.ts`.
- **OCR / document understanding**, **ASR**, **time-series forecasting**,
  **guardrail/classifier models** — all more relevant to our users than SAM or LCM.

---

## 1. Where we are today

We already do model advisory. We do it **twice**, in two incompatible ways, and neither
knows about model *type*.

### 1.1 Two divergent implementations

Both live in `core/modelCapability.ts` (441 lines) and share nothing but the file:

| | Code Converter path | Data Analysis path |
|---|---|---|
| Entry point | `describeModel` → `assessFit` → `suggestBiggerModels` | `assessModelForDataAnalysis` |
| Output shape | `ModelCapability` + `FitAssessment` | `DataAnalysisModelVerdict` |
| Tiers | `strong \| good \| basic \| weak` | same names, **different meanings** |
| Provenance | `source: 'detected' \| 'known' \| 'assumed'` ✅ | none — verdicts are unlabelled |
| Sizing | real token maths against context window | none |
| How the choice is applied | per-request `providerOverride` / `modelOverride`, session-scoped ✅ | bounces through global `aiForge.switchProvider` ⚠️ |
| Consumers | `plugins/codeConvert.ts`, `ui/codeConvertPanel.ts` | `plugins/dataAnalysis.ts`, `ui/dataAnalysisPanel.ts` |

Two things here are genuinely good and should become the standard:

1. **`source: 'detected' | 'known' | 'assumed'`** — every number is labelled with where it
   came from. This is the same discipline as `src/fde/provenance.ts`.
2. **The converter's `_choice` pattern** (`plugins/codeConvert.ts:134`) — an in-memory
   `{provider, model}` applied via `AIRequest.providerOverride`/`modelOverride`,
   deliberately *not* a setting, so a model picked for one big job does not silently
   become the default for everything. CLAUDE.md already states this as intentional.

One thing is a defect: **Data Analysis mutates global config to change a per-task model**,
and its `suggestedLocalModel` field is rendered as prose but never actioned — there is no
one-click "use this model".

### 1.2 The FDE ladder already asks the right questions — and ignores the answer

`DESKTOP_CHANNELS.FDE.EVALUATE_RULE_VS_MODEL` (`src/desktop/main/ipcHandlers.ts:4312`) is
already a task → architecture recommender. It takes:

```ts
taskDescription, latencyBudgetMs, requiresStrictArithmetic,
inputModality, zeroToleranceForHallucination, architectureOverride
```

…and returns a ladder level (1–5, plus hybrids `1+3`, `1+4`, `1+5`) with latency, cost and
hallucination SLAs, a rationale, guardrails and a Mermaid diagram.

**`inputModality` is collected from the UI, passed into the handler, and never read.**

- UI control: `selRuleModality` (`src/desktop/renderer/index.html:3439`), four options —
  `structured_data`, `unstructured_text`, `multimodal`, `api_stream`
- Passed at `src/desktop/renderer/renderer.ts:16734`
- Handler signature declares it at `ipcHandlers.ts:4316`; **no branch reads it**

That is the seam. The ladder answers *"how much machinery does this need?"*; it has a
parameter for *"what kind of input is it?"* and throws it away. Model type is the missing
half of the same question.

### 1.3 Model type can be detected, not guessed

Verified live against the local Ollama instance during this investigation:

```
GET /api/tags   → capabilities: ["completion","tools","insert"]
POST /api/show  → capabilities, details.family, details.parameter_size
```

`getOllamaModelInfo()` (`core/aiService.ts:336`) already calls `/api/show` and parses
`model_info.*.context_length` — **and discards `capabilities`.** Ollama reports `vision`
for VLMs, `embedding` for embedding models, `tools` for function-calling models, `insert`
for FIM-capable models, `thinking` for reasoning models.

This matters enormously: it means model *type* follows the codebase's existing principle
that **detection beats the table**. We do not have to guess VLM-ness from a model name.

### 1.4 What already exists, scattered

- **Vision**: `Message.images?: string[]` is plumbed, Ollama-only (`aiService.ts:309,424`).
  Never surfaced, never advertised, no advice attached.
- **Embeddings**: real and configurable, but only inside the enterprise RAG scaffolder —
  no shared catalogue, core has no embedding concept.
- **Reasoning**: `gemma4ThinkingMode` boolean, one provider.
- **FDE Cockpit** (`ui/fdeCockpitPanel.ts`, 10,248 lines): **no model advisory at all**.
  The only AI-model notion is a free-text box defaulting to `gemma4:latest` (`:2173`).
  This is the clean insertion point.

### 1.5 Documentation is stale

CLAUDE.md claims 60 commands and 17 plugins. Actual: **264 commands, 69 settings**.
`src/desktop/` (42k lines) and `src/enterprise/` do not appear in its repository layout at
all. Any doc work here must fix that too, or we compound the drift.

---

## 2. The taxonomy we should ship

Replace the 8-item flat list with **jobs on one axis, attributes as filters on another**.

### 2.1 Axis 1 — what is the job?

Only the rows marked ● are in scope for us. The rest are documented for completeness so an
FDE can say "that is a real category, and it is not what this product does."

| Job | In scope | Why |
|---|---|---|
| ● **Text generation / chat** | Yes | Core. Every provider we have. |
| ● **Reasoning** | Yes | Already half-exposed via `gemma4ThinkingMode`. Generalise. |
| ● **Code — agentic/chat** | Yes | Converter, fix, refactor, tests. |
| ● **Code — FIM autocomplete** | Yes | Distinct capability; `inlineActions.ts` needs it. |
| ● **Embedding** | Yes | RAG, semantic search. Already shipped in enterprise RAG. |
| ● **Reranking** | Yes | Completes the RAG story we already half-tell. |
| ● **Vision-language** | Yes | `images` already plumbed; needs surfacing + advice. |
| ● **Document / OCR** | Yes | Data Analysis ingests files; PDFs are the obvious next step. |
| ● **Classifier / guardrail** | Yes | Maps to ladder Level 2 (semantic router) and enterprise PII work. |
| ● **Time-series forecasting** | Advisory only | Highly relevant to data engineering; we advise, we do not run it. |
| ○ Image / video generation | No | Not our product. Documented as out of scope. |
| ○ Speech (ASR / TTS) | No | Advisory mention only. |
| ○ Segmentation | No | Named correctly (not "SAM") if a user asks. |
| ○ World models | No | Research; not a category a developer picks from yet. |

### 2.2 Axis 2 — attributes (filters, not categories)

This is where MoE, SLM and MLM actually belong:

| Attribute | Values | Why the user cares |
|---|---|---|
| **Deployability** | edge · single-GPU · multi-node · API-only | *This is what "SLM" really means.* |
| **Architecture** | dense · **MoE** | VRAM tracks total params; speed tracks active params. |
| **Attention** | encoder-only (**MLM**-trained) · decoder-only · enc-dec | Understanding vs generation. |
| **Modality** | text · image · audio · any-to-any | |
| **Context window** | 8K → 1M+ | Already modelled by `ModelCapability.contextTokens`. |
| **Openness** | open-weight · API-only, plus licence terms | Air-gapped clients need this. |
| **Reasoning effort** | off · low · high | |

### 2.3 The one-line framing for docs and UI

> Pick by **the job** — generate, understand, represent, act, forecast. Then filter by
> size, architecture, modality, context and licence. MoE and MLM are filters, not jobs.
> SAM is a product, not a job.

### 2.4 Axis 3 — Industry & Nature of Work Profiler

Clients and Forward Deployed Engineers (FDEs) don't start from an abstract model job—they start
from **their industry vertical** and **the specific nature of the problem** they must solve.
To prevent clients from defaulting to a 70B general LLM for tasks that require strict determinism
or specialized encoders, Evolve AI provides an interactive **Industry & Workload Profiler**
backed by the `WORKLOAD_ARCHETYPES` matrix in `src/core/modelAdvisor.ts`.

#### Supported Industry Verticals

| Industry Vertical | Icon | Focus & Regulatory Boundaries |
|---|:---:|---|
| **Banking & Financial Services** (`finance`) | 💰 | Strict statutory arithmetic, SOX ledgers, sub-5ms low latency, real-time fraud triage. |
| **Healthcare & Life Sciences** (`healthcare`) | 🏥 | HIPAA privacy rules, clinical SOP retrieval, air-gapped on-premise vector stores, zero-hallucination diagnostics. |
| **Legal & Compliance** (`legal`) | ⚖️ | Multi-clause contract risk analysis, statutory indemnity ceilings, citation verification. |
| **Defence & Air-Gapped** (`defence`) | 🛡️ | Zero external network telemetry, local open-weight SLMs (7B–14B), sub-15ms edge sensor event triage. |
| **Retail & Supply Chain** (`retail`) | 📦 | ERP inventory tool-calling with database rollback, invoice/bill-of-lading OCR, deterministic demand forecasting. |
| **Software Engineering & DevOps** (`software`) | 💻 | Syntax-aware code refactoring, sub-50ms FIM inline autocomplete, multi-step bug reasoning. |
| **General Enterprise** (`general`) | 🌐 | Cross-functional drafting, semantic knowledge base search, summary generation. |

#### Workload Archetypes Matrix (`WORKLOAD_ARCHETYPES`)

| Workload Archetype | Industry | Primary Job | Recommended Tier | Engineering Guidance & Parsimony Guarantee |
|---|---|---|---|---|
| **Balance Reconciliation & Ledgers** (`fin_recon`) | Finance | `classification` | **Level 1: Pure Rule Engine & SQL** (<5ms, 0% Drift) | **Strict Arithmetic Guarantee**: Never use probabilistic token sampling for monetary calculations. Runs via compiled SQL or TypeScript boundary rules (0% hallucination guarantee). |
| **Transaction Fraud Triage** (`fin_fraud_triage`) | Finance | `classification` | **Level 2: Fast Semantic Router / Encoder** (<25ms) | High-throughput event triage via a lightweight embedding classifier or small encoder in a single forward pass, saving GPU cost. |
| **SOX & Regulatory Policy Q&A** (`fin_compliance_sop`) | Finance | `embedding` | **Level 3: Grounded Air-Gapped Policy RAG** | Air-gapped semantic search across statutory compliance manuals with 128-token chunking and mandatory citation receipts. |
| **Clinical Protocol & HIPAA SOP Guidance** (`health_clinical_sop`) | Healthcare | `embedding` | **Level 3: Air-Gapped Grounded Policy RAG** | Strict fact-retrieval from internal clinical guidelines. Air-gapped on-premise vector store with citation verification. |
| **Patient Intake & Symptom Triage** (`health_patient_triage`) | Healthcare | `classification` | **Level 2: Semantic Router with Mandatory HITL Queue** | Fast symptom classification with low confidence threshold fallback to human clinical review queue. |
| **Diagnostic Report & Lab Form OCR** (`health_lab_ocr`) | Healthcare | `ocr` | **Document Layout & Structured OCR Model** | Extracts clinical lab values and tabular metrics preserving table column headers and reading order. |
| **Contract Risk Analysis** (`legal_contract_risk`) | Legal | `reasoning` | **Reasoning Model (Extended Thinking)** | Multi-step reasoning across interrelated contractual clauses, indemnity covenants, and statutory liability limits. |
| **Statutory Ceiling & Rule Gate** (`legal_statutory_gate`) | Legal | `classification` | **Hybrid Level 1+3: Deterministic Rule-Gated RAG** | Deterministic rule check on statutory caps and jurisdictional boundaries before semantic retrieval. |
| **Classified Field Intel Search** (`def_airgap_intel`) | Defence | `embedding` | **Air-Gapped Local SLM (7B-14B) + Local Vector Store** | 100% offline local embeddings (e.g. `nomic-embed-text`) and local SLM with zero external network telemetry. |
| **Sensor Telemetry & Stream Triage** (`def_sensor_triage`) | Defence | `classification` | **Level 2: Lightweight Classifier** (<15ms) | Sub-15ms edge classification to prioritize critical telemetry alerts and sensor state changes. |
| **ERP Inventory Rebalancing** (`retail_inventory_mcp`) | Retail | `code-agentic` | **Level 4: MCP Tool Agent with Database Rollback** | Structured tool execution via Model Context Protocol (MCP) to check stock levels and draft purchase orders with transactional boundary checks. |
| **Supplier Invoice & BOL Intake** (`retail_invoice_ocr`) | Retail | `ocr` | **Document & OCR Extraction** | Preserves line-item tables, tax breakdowns, and vendor metadata from scanned PDFs and receipts. |
| **Seasonal Demand & SKU Forecasting** (`retail_demand_forecast`) | Retail | `timeseries` | **Deterministic Holt-Winters Forecaster (No LLM)** | Holt-Winters with prediction intervals, changepoint detection, and autocorrelation seasonality. Deterministic and offline. |
| **Full-File Code Refactoring** (`sw_refactor_agent`) | Software | `code-agentic` | **Specialized Coder Model** (e.g. Qwen2.5-Coder 7B/14B) | Dedicated coding model trained on syntax trees. Consistently outperforms general chat models of equal size. |
| **Inline Code Autocomplete** (`sw_autocomplete_fim`) | Software | `code-fim` | **FIM-Trained Model with insert capability** (1.5B–7B) | Sub-50ms latency completion trained on prefix/suffix fill-in-the-middle. Ollama reports this as `insert`. |
| **Complex Bug Diagnostics** (`sw_bug_diagnostics`) | Software | `reasoning` | **Reasoning Model with Extended Thinking** | Spends inference-time compute exploring call stacks and race conditions before producing a diagnosis. |
| **General Drafting & Summaries** (`gen_chat_drafting`) | General | `chat` | **General Chat Model (Small to Medium)** | Standard conversational model for drafting and synthesising unstructured text. |
| **Knowledge Base Search** (`gen_kb_search`) | General | `embedding` | **Bi-Encoder Embedding Model** | Vector representation for fast similarity search across large document corpuses. |

---

## 3. Design

### 3.1 Principles

1. **Do not break what works.** `describeModel`/`assessFit` keep their signatures. The
   converter's behaviour is unchanged. New capability is additive.
2. **Detection beats the table** — the codebase's existing rule. Extend
   `getOllamaModelInfo()` to return `capabilities`; fall back to the table only for gaps.
3. **Honesty is non-negotiable.** v2.25.0 was an entire release spent removing invented
   metrics. The advisor **must not fabricate benchmark scores or rankings.** Every claim
   carries provenance, and `npm run verify:honest` must keep passing.
4. **Advice, never silent substitution.** We recommend; the user decides. Nothing
   auto-switches models behind their back.
5. **Session-scoped overrides, not global mutation.** Generalise the converter's `_choice`
   pattern. A model chosen for one task never becomes the global default.
6. **Parsimony.** The advisor's default bias is the *smallest/cheapest* model that clears
   the bar — consistent with the FDE ladder, and the actual lesson of the original post.

### 3.2 New module — `src/core/modelAdvisor.ts`

A pure, dependency-free module (so it unit-tests like `modelCapability.test.ts`):

```ts
export type ModelJob =
  | 'chat' | 'reasoning' | 'code-agentic' | 'code-fim'
  | 'embedding' | 'reranking' | 'vision' | 'ocr'
  | 'classification' | 'timeseries';

/** Where a capability claim came from. Mirrors fde/provenance.ts discipline. */
export type CapabilitySource = 'detected' | 'known' | 'assumed';

export interface ModelProfile {
  id: string;
  provider: ProviderName;
  jobs: Partial<Record<ModelJob, 'native' | 'capable' | 'poor' | 'unsupported'>>;
  attributes: {
    deployability: 'edge' | 'single-gpu' | 'multi-node' | 'api';
    architecture?: 'dense' | 'moe';
    attention?: 'encoder-only' | 'decoder-only' | 'enc-dec';
    modalities: Array<'text' | 'image' | 'audio'>;
    reasoning?: boolean;
    openWeight?: boolean;
  };
  /** Per-claim provenance. Never present a guess as a measurement. */
  source: CapabilitySource;
  capability: ModelCapability;   // reuse, do not duplicate
}

export interface JobRecommendation {
  job: ModelJob;
  verdict: 'ideal' | 'workable' | 'wrong-tool' | 'unsupported';
  headline: string;
  rationale: string;
  /** Actionable, unlike dataAnalysis's display-only suggestedLocalModel. */
  alternatives: Array<{ id: string; provider: ProviderName; why: string; installed: boolean }>;
  source: CapabilitySource;
}

export function profileModel(id, provider, detected?): ModelProfile;
export function recommendForJob(job, available: ModelProfile[], constraints?): JobRecommendation;
export function inferJobFromTask(text: string, modality?: string): { job: ModelJob; confidence: 'high'|'low' };
```

`assessModelForDataAnalysis` becomes a thin wrapper over `recommendForJob('code-agentic'|'chat', …)`
so its six existing tests keep passing unchanged. We delete nothing in this release.

### 3.3 Detection — extend, don't replace

`IAIService.getOllamaModelInfo` is already optional, so widening its return type is
backwards-compatible:

```ts
getOllamaModelInfo?(model, host?): Promise<{
  contextTokens?: number;
  capabilities?: string[];        // NEW — vision, embedding, tools, insert, thinking
  family?: string;                // NEW
  parameterSize?: string;         // NEW
} | null>;
```

Map Ollama capabilities → jobs: `vision`→vision, `embedding`→embedding,
`insert`→code-fim, `tools`→tool use, `thinking`→reasoning. Anything detected is
`source: 'detected'`; the static table stays as `'known'`; unknown models are `'assumed'`
and *say so in the UI*.

### 3.4 Where it surfaces

Four surfaces, in dependency order. Each is independently shippable.

**(a) Model Advisor panel — `aiForge.model.advisor`** *(new)*
A small "what are you trying to do?" picker → job → recommendation with provenance badges,
using the existing `codeConvertPanel` layout idiom. Lists what is installed, what it is
good at, and what to pull if there is a gap. Includes a plain-English **"model types
explained"** section — the corrected taxonomy, which is the educational payload of the
original post, done right.

**(b) FDE ladder — close the `inputModality` gap**
Make the handler *read* `inputModality` and return a `modelGuidance` block alongside the
existing level recommendation:

| modality | implies | typical job |
|---|---|---|
| `structured_data` | rules/SQL beat models | often Level 1 — *no LLM at all* |
| `unstructured_text` | embeddings + rerank + grounded generation | embedding, reranking, chat |
| `multimodal` | vision or OCR required | vision, ocr |
| `api_stream` | classification / routing | classification |

This is purely additive — every existing field in the response is untouched — and it makes
a parameter we already collect finally mean something. It also reinforces the Rule of
Parsimony: for `structured_data` the honest answer is frequently "don't use a model."

**(c) FDE Cockpit — a Model Fit card**
The Cockpit has no model advisory today. Add one card reading from the shared service, so
an FDE can tell a client *why* a given model was chosen, with provenance, in a document
that will not embarrass anyone under scrutiny.

**(d) Chat + Data Analysis — unify**
Chat's model pill gains a job-aware hint. Data Analysis's `switchModel` stops mutating
global config and adopts the session-scoped override; its dead `suggestedLocalModel`
becomes a real one-click action.

### 3.5 Visual flows — the showcase layer

This is the second half of the ask: *show* the user the architecture, help them design
with it, and let an FDE put it in front of a customer.

#### 3.5.1 What we already have (and the gap that blocks this)

Three relevant facts, all verified:

1. **The product already animates architecture diagrams.** `startFlowAnimation()`
   (`renderer.ts:5211`) walks a diagram step by step with a travelling photon along each
   arrow, `▶ Animate Flow` / `⏹ Stop Flow`. This is exactly the "visual flow for a
   customer showcase" capability — already built, already proven.
2. **The decision gate already has the right UI shell** — a four-tab preview,
   `gatePreviewMode: 'visual' | 'mermaid' | 'tradeoff' | 'code'` (`renderer.ts:16184`).
   Model flows should slot into this pattern, not invent a new one.
3. **But there is a hard blocker.** The offline Mermaid renderer
   (`parseSequenceDiagram`, `renderer.ts:2540`) is hand-written and supports
   **`sequenceDiagram` only** — it explicitly rejects anything else:
   *"Preview supports `sequenceDiagram` only."* Meanwhile the codebase generates
   **29 `flowchart` diagrams (9 in `ipcHandlers.ts`, 20 in `renderer.ts`)** (ladder levels, gate templates, topology). **None of
   them render as pictures.** They are copy-to-clipboard text.

That renderer exists for a good reason, documented in the source: the Studio ships to
banking and defence laptops and advertises air-gapped operation, so a CDN fetch is not an
option, and bundling ~2.8MB of mermaid.js into a 360KB renderer was judged
disproportionate. That reasoning still holds — **so the answer is to extend the offline
renderer to flowcharts, not to bundle mermaid.**

This is a real gap in the product today, independent of model types. Fixing it lights up
every ladder diagram we already generate.

#### 3.5.2 What we draw

For each **job** in the taxonomy (§2.1), a corrected, honest pipeline — our own, not the
infographic's. Each carries:

- the **runtime path** (what happens per request) drawn as the flow;
- **build-time / deployment steps** shown separately, never mixed into the runtime path —
  this is the specific error the SLM and LAM panels make;
- loops drawn as loops (autoregressive decode, agent observe-act, retrieve-rerank);
- a one-line "what this costs you" annotation (latency, where tokens are spent);
- a **provenance note** where a shape is illustrative rather than a specific model's
  published architecture.

Concretely, the corrections we ship as diagrams:

| Flow | Correction we encode |
|---|---|
| Text generation | Show the **decode loop**, not a single pass |
| MoE | Routing **inside each layer**, interleaved; experts replace the **FFN only** |
| VLM | No phantom "text encoder"; vision encoder → **projection** → shared LLM context |
| Encoder-only (not "MLM") | **Joint** bidirectional attention, not left/right branches; training vs inference shown separately |
| Embedding + reranking | The two-stage pattern the original list omits entirely |
| Tool use (not "LAM") | `prompt → tool call → execute → observe → loop`, with the HITL gate |
| Segmentation (not "SAM") | Image embedding computed **once**, reused per prompt; no "feature correlation" |
| Small / edge | Deployment steps as a **separate lane** from the inference path |

#### 3.5.3 How it renders

Extend the existing offline renderer with a `flowchart TD/LR` subset parser —
nodes (`["label"]`, `{"decision"}`, `(("round"))`), edges (`-->`, `-.->`, `-- label -->`),
and subgraphs for the build-time lane. Reuse the existing SVG emitter and the existing
photon animation. Zero new dependencies; the air-gap promise is preserved.

Surfaces, in the order they pay off:

- **Model Advisor panel** — the flow for the recommended job, side by side with the
  recommendation. This is the "help them design" half.
- **FDE Cockpit / ladder** — model flow beside the existing level diagram, so a client
  sees *both* "how much machinery" and "what kind of model".
- **Client documents** — flows exported into the generated HTML deliverables in
  `docs/client/`, self-contained, opening on an air-gapped client laptop. This is the
  "showcase to the customer" half.
- **Bonus, essentially free:** the same parser makes the 29 existing `flowchart`
  diagrams render for the first time.

#### 3.5.4 Honesty constraints on the visuals

A diagram asserts things, so §3.1's rule applies to pictures too:

- Never present an illustrative shape as a specific vendor's published architecture.
- Label diagrams of *families* ("typical VLM") distinctly from diagrams of *papers*
  ("SAM, arXiv:2304.02643").
- No latency or cost number on a diagram unless it is measured or clearly marked as an
  order-of-magnitude illustration — `renderMeasured()` discipline extends to captions.
- Cite the paper where a flow follows one.

### 3.6 Wiring

Add to `IServices` as **optional** (`services.ts:46-48` precedent, so existing test mocks
keep compiling):

```ts
/** Present in production; plugins and tests may use mocks that omit it. */
readonly modelAdvisor?: ModelAdvisor;
```

Constructed in `ServiceContainer` before `this.plugins.setServices(this, vsCtx)`
(`services.ts:85`).

---

## 4. Phasing

Each phase compiles clean, ships alone, and breaks nothing.

| Phase | Version | Deliverable | Risk |
|---|---|---|---|
| **1 — Foundation** | 2.26.0 | `core/modelAdvisor.ts` + taxonomy + unit tests. Extend `getOllamaModelInfo` with capabilities. `assessModelForDataAnalysis` rewired as a wrapper; its tests untouched. **No UI.** | Very low — additive, pure functions |
| **2 — Advisor UI** | 2.27.0 | `aiForge.model.advisor` panel + corrected "model types explained". Chat pill hint. | Low — new surface |
| **2.5 — Flowchart renderer** | 2.27.0 | Extend the offline Mermaid renderer to a `flowchart` subset; reuse the existing SVG emitter + photon animation. **Independently valuable**: makes the 29 existing `flowchart` diagrams render for the first time. | Low–medium — self-contained, pure parser, unit-testable |
| **3 — Visual flows + FDE integration** | 2.28.0 | The 10 corrected job flows as data; `inputModality` finally read; `modelGuidance` in the ladder response; Cockpit Model Fit card + flow; export into client HTML deliverables. | Medium — touches desktop IPC; contract is additive |
| **4 — Unify + retire drift** | 2.29.0 | Data Analysis onto session overrides; one-click model switch; deprecate the duplicated advisory path. | Medium — behaviour change in a shipped panel |

Phase 2.5 is deliberately separable: it is a parser with no product opinion in it, it
pays for itself by fixing diagrams we already ship broken, and it de-risks Phase 3 by
landing the rendering before the content depends on it.

### Test strategy

- Unit tests for `modelAdvisor` in the existing Mocha TDD style (`modelCapability.test.ts`
  is the template).
- The flowchart parser is a pure function over a string — test it the same way, including
  the existing `sequenceDiagram` inputs to prove no regression in what already renders.
- The six existing `assessModelForDataAnalysis` tests are the **regression contract** for
  Phase 1 — they must pass untouched.
- Desktop IPC: extend `src/test/suite/desktop/desktopCore.test.ts`, which already asserts
  the `EVALUATE_RULE_VS_MODEL` handler is registered.
- `npm run compile` (currently exit 0) and `npm run verify:honest` gate every phase.

---

## 5. Documentation plan

Docs must be corrected **in the same release** as the code, per house rule.

| Doc | Change |
|---|---|
| `docs/MODEL_ADVISOR.md` | This file — the reference. |
| `CLAUDE.md` | Add `core/modelAdvisor.ts`. **Also fix the stale scale**: 264 commands not 60, 69 settings, and add the missing `src/desktop/` and `src/enterprise/` trees. |
| `docs/ARCHITECTURE.md` | Advisor in the service layer + the request-flow diagram. |
| `docs/DATA_ANALYSIS.md` | Replace the global-switch description with session overrides. |
| `docs/CODE_CONVERSION.md` | Note the shared advisor; converter behaviour unchanged. |
| `docs/FDE_PLAYBOOK.md` | Model type as a first-class ladder input; modality → job table; how to run the flows in a client showcase. |
| `docs/WORKFLOW_TOPOLOGY.md` | Note that `flowchart` now renders offline, not just `sequenceDiagram`. |
| `docs/OFFLINE_SUITE.md` | The renderer extension keeps the air-gap guarantee — no new deps. |
| `docs/LOCAL_VS_PAID_MANAGEMENT.md` | Which advisor features are Community vs Enterprise. |
| `README.md` / `CHANGELOG.md` | Per-phase entries, house style. |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| **Advisory drifts into invented authority** — the exact failure v2.25.0 fixed | Provenance on every claim; no benchmark numbers we did not measure; `verify:honest` in the gate |
| Model landscape moves fast; the table rots | Detection-first; the table is a labelled fallback (`'known'`/`'assumed'`), never presented as current truth |
| Scope creep into running new modalities | Axis-1 table above explicitly marks out-of-scope jobs as advisory-only |
| Touching a 33k-line desktop renderer | Phase 3 changes are additive to an existing IPC contract; the handler already has the parameter |
| **Our own diagrams become wrong too** — the exact failure we are criticising | Cite the paper where a flow follows one; label family-level diagrams as illustrative; keep flows as *data*, reviewable in one file, not scattered through UI code |
| Bundling mermaid.js would break the air-gap promise | Explicitly rejected. Phase 2.5 extends the hand-written renderer; zero new dependencies |
| Two advisory paths become three | Phase 1 makes the new module the single source; Phase 4 retires the duplicate |

---

## 7. What we are deliberately not doing

- Not shipping the 8-item list. It is wrong in two places and structurally incoherent.
- Not adding image generation, TTS or segmentation inference.
- Not auto-switching models on the user's behalf.
- Not publishing benchmark leaderboards. We state what a model *is* and what it is *for*,
  with provenance — not what it scores.
- **Not reproducing the infographic's diagrams.** Six of eight are wrong in ways a client
  could catch; three would teach something false. We draw our own, corrected and cited.
- Not bundling mermaid.js. The offline renderer gets extended instead.
