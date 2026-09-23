/**
 * core/modelFlows.ts — how each kind of model actually works, drawn correctly.
 *
 * These exist because the popular explainers are wrong in ways a client will
 * catch. The diagram that prompted this work drew Mixture-of-Experts routing as
 * a single decision at the model's front door (it happens inside every MoE
 * layer, and replaces only the feed-forward block); drew BERT's bidirectional
 * attention as two separate "left context" and "right context" branches (it is
 * jointly bidirectional in all layers); invented a "feature correlation" stage
 * in Segment Anything (there are three components, and the real headline is
 * that the image embedding is computed once and reused across prompts); and
 * mixed build-time steps like quantisation into the runtime path for small
 * models, whose inference path is identical to any other model's.
 *
 * Three rules keep these honest, and they are the reason this is a data file
 * rather than prose scattered through a webview:
 *
 *   1. RUNTIME AND BUILD-TIME ARE SEPARATE. `runtime` is what happens per
 *      request. Anything done once, ahead of time, goes in `buildTime` and is
 *      drawn as its own lane. Collapsing them is the specific error that makes
 *      the "small model" diagram misleading.
 *
 *   2. PROVENANCE IS DECLARED. A flow either follows a specific published
 *      architecture — and cites it — or it is illustrative of a family and says
 *      so. Presenting a sketch as a paper's architecture is the same failure as
 *      presenting a guess as a measurement.
 *
 *   3. NO INVENTED NUMBERS. `costNote` describes where time and tokens go in
 *      words. A latency figure nobody measured does not belong on a diagram
 *      that ends up in a client document.
 *
 * Diagram source targets offline/flowchartRenderer.ts, so these draw on an
 * air-gapped machine with no network and no bundled Mermaid.
 */

import type { ModelJob } from './modelAdvisor';

export type FlowProvenance =
  /** Follows a specific published architecture. */
  | { kind: 'paper'; cite: string; url: string }
  /** Illustrative of how this class of model generally works. */
  | { kind: 'family'; note: string };

export interface ModelFlow {
  job: ModelJob;
  title: string;
  /** What happens per request, as `flowchart` source. */
  runtime: string;
  /** Steps performed once, ahead of time. Drawn as a separate lane. */
  buildTime?: string;
  provenance: FlowProvenance;
  /** Where the time and the tokens actually go. Words, not invented numbers. */
  costNote: string;
  /** The misconception this drawing exists to correct, when there is one. */
  corrects?: string;
}

export const MODEL_FLOWS: readonly ModelFlow[] = [
  {
    job: 'chat',
    title: 'Text generation',
    // The decode loop is the point. Drawn as a straight line, generation looks
    // like a single pass, which is why people are surprised that output length
    // drives latency and cost.
    runtime:
      'flowchart TD\n' +
      '  In["📥 Prompt"] --> Tok["Tokenise"]\n' +
      '  Tok --> Emb["Embed"]\n' +
      '  Emb --> Dec["Transformer decoder"]\n' +
      '  Dec --> Next{"Next token"}\n' +
      '  Next -- "not finished" --> Dec\n' +
      '  Next -- "stop token" --> Out["✅ Response"]',
    provenance: { kind: 'family', note: 'Decoder-only transformers in general.' },
    costNote:
      'One pass through the model per token generated, so a long answer costs ' +
      'proportionally more time than a long question.',
    corrects: 'Generation is a loop, not a single pass — the diagram that shows it as one line hides where the cost is.',
  },

  {
    job: 'reasoning',
    title: 'Reasoning (extended thinking)',
    runtime:
      'flowchart TD\n' +
      '  In["📥 Problem"] --> Think["Reasoning tokens"]\n' +
      '  Think --> More{"Enough?"}\n' +
      '  More -- "keep working" --> Think\n' +
      '  More -- "settled" --> Ans["Compose answer"]\n' +
      '  Ans --> Out["✅ Response"]',
    provenance: { kind: 'family', note: 'Models that spend inference-time compute before answering.' },
    costNote:
      'The thinking tokens are generated and paid for even though most are never ' +
      'shown, so this trades latency and cost for accuracy on hard problems.',
    corrects: 'Reasoning is not a bigger model — it is the same model allowed to spend longer.',
  },

  {
    job: 'code-fim',
    title: 'Fill-in-the-middle completion',
    // FIM is a distinct trained capability, not a prompt trick — which is why
    // Ollama reports it separately as "insert".
    runtime:
      'flowchart TD\n' +
      '  Pre["📄 Code before cursor"] --> Asm["Assemble prefix / suffix"]\n' +
      '  Suf["📄 Code after cursor"] --> Asm\n' +
      '  Asm --> Model["Model trained on FIM"]\n' +
      '  Model --> Out["✅ Middle section"]',
    provenance: { kind: 'family', note: 'Code models trained with a fill-in-the-middle objective.' },
    costNote: 'Short inputs and short outputs, run on every keystroke pause — latency matters more than size.',
    corrects: 'A chat model cannot do this well. It needs what comes AFTER the cursor, which chat training never teaches.',
  },

  {
    job: 'embedding',
    title: 'Embeddings',
    runtime:
      'flowchart TD\n' +
      '  In["📥 Text"] --> Tok["Tokenise"]\n' +
      '  Tok --> Enc["Encoder (bidirectional)"]\n' +
      '  Enc --> Pool["Pool to one vector"]\n' +
      '  Pool --> Out["✅ Vector"]',
    buildTime:
      'flowchart TD\n' +
      '  subgraph Index["Done once, ahead of time"]\n' +
      '  Docs["📚 Your documents"] --> Chunk["Split into chunks"]\n' +
      '  Chunk --> EmbAll["Embed every chunk"]\n' +
      '  EmbAll --> Store["🗄️ Vector store"]\n' +
      '  end',
    provenance: { kind: 'family', note: 'Encoder-only embedding models such as the BERT lineage.' },
    costNote:
      'Cheap per call and highly parallel. The real cost is indexing the corpus once, ' +
      'not querying it.',
    corrects: 'An embedding model produces a vector, not text. It is a different kind of model, not a smaller chat model.',
  },

  {
    job: 'reranking',
    title: 'Retrieval: embed, then rerank',
    // The two-stage pattern the source infographic omitted entirely, despite it
    // being most of how retrieval actually works.
    runtime:
      'flowchart TD\n' +
      '  Q["📥 Query"] --> QE["Embed query"]\n' +
      '  QE --> Search["Nearest neighbours in vector store"]\n' +
      '  Search --> Cand["~50 candidates (fast, approximate)"]\n' +
      '  Cand --> RR["Reranker reads query + document together"]\n' +
      '  RR --> Top["✅ Top few, ordered by relevance"]',
    provenance: { kind: 'family', note: 'Bi-encoder retrieval followed by a cross-encoder reranker.' },
    costNote:
      'The embedding search is cheap over millions of chunks; the reranker is expensive ' +
      'per pair, which is why it only ever sees the shortlist.',
    corrects:
      'Embeddings alone are the first half. The reranker is what turns "roughly related" into "actually answers the question".',
  },

  {
    job: 'vision',
    title: 'Vision-language',
    // No phantom "text encoder": in the LLaVA family the text goes straight to
    // the language model's own embeddings.
    runtime:
      'flowchart TD\n' +
      '  Img["🖼️ Image"] --> VE["Vision encoder"]\n' +
      '  VE --> Proj["Projection into the LLM embedding space"]\n' +
      '  Proj --> Ctx["Shared context"]\n' +
      '  Txt["📝 Text prompt"] --> Ctx\n' +
      '  Ctx --> LLM["Language model"]\n' +
      '  LLM --> Out["✅ Response"]',
    provenance: {
      kind: 'paper',
      cite: 'Visual Instruction Tuning (LLaVA), Liu et al.',
      url: 'https://arxiv.org/abs/2304.08485',
    },
    costNote:
      'An image becomes many tokens before the language model sees it, so pictures ' +
      'consume context far faster than text does.',
    corrects:
      'There is no separate "text encoder" and no "multimodal processor" — the projection layer is the whole trick.',
  },

  {
    job: 'ocr',
    title: 'Document understanding',
    runtime:
      'flowchart TD\n' +
      '  Doc["📄 Page image"] --> Layout["Detect layout: text, tables, figures"]\n' +
      '  Layout --> Read["Read text in reading order"]\n' +
      '  Read --> Struct["Rebuild structure"]\n' +
      '  Struct --> Out["✅ Structured text"]',
    provenance: { kind: 'family', note: 'Document-understanding models generally.' },
    costNote: 'Cost scales with pages, and with resolution on dense scans.',
    corrects: 'A general vision model describes a table. A document model preserves its structure.',
  },

  {
    job: 'classification',
    title: 'Classification and routing',
    runtime:
      'flowchart TD\n' +
      '  In["📥 Input"] --> Enc["Encoder"]\n' +
      '  Enc --> Head["Classification head"]\n' +
      '  Head --> Score{"Confidence"}\n' +
      '  Score -- "above threshold" --> Out["✅ Label"]\n' +
      '  Score -- "below threshold" --> HITL["👤 Human review"]',
    provenance: { kind: 'family', note: 'Encoder-only classifiers; the same shape as ladder Level 2.' },
    costNote: 'One forward pass, no generation — orders of magnitude cheaper than asking a chat model for a label.',
    corrects: 'Paying a generative model to emit one word is the expensive way to do this.',
  },
];

/**
 * Attribute flows, drawn separately because they are NOT jobs.
 *
 * This is the distinction the source infographic collapsed: Mixture-of-Experts
 * and masked-language-modelling describe how a model is built, not what it does
 * for you. A model can be an MoE encoder that produces embeddings. Keeping them
 * on their own axis is the whole reason the taxonomy is usable, so they are a
 * separate export rather than entries in MODEL_FLOWS.
 */
export interface AttributeFlow {
  id: 'moe' | 'encoder-only' | 'small';
  title: string;
  runtime: string;
  buildTime?: string;
  provenance: FlowProvenance;
  costNote: string;
  corrects: string;
}

export const ATTRIBUTE_FLOWS: readonly AttributeFlow[] = [
  {
    id: 'moe',
    title: 'Mixture of Experts (an architecture, not a job)',
    // Routing happens inside EVERY MoE layer, interleaved with attention, and
    // replaces the feed-forward block only. Drawing it once at the front door
    // is the error that makes people think MoE is a dispatcher.
    runtime:
      'flowchart TD\n' +
      '  Tok["📥 Token"] --> Attn["Attention (shared, all experts)"]\n' +
      '  Attn --> Router{"Router picks top-k"}\n' +
      '  Router --> E1["Expert 1 (FFN)"]\n' +
      '  Router --> E2["Expert 2 (FFN)"]\n' +
      '  E1 --> Comb["Weighted combination"]\n' +
      '  E2 --> Comb\n' +
      '  Comb --> Next{"More layers?"}\n' +
      '  Next -- "yes — route again" --> Attn\n' +
      '  Next -- "no" --> Out["✅ Output"]',
    provenance: { kind: 'family', note: 'Sparse MoE transformers generally.' },
    costNote:
      'Memory tracks TOTAL parameters because every expert must be loaded; speed tracks ' +
      'ACTIVE parameters because only a few run per token. That is the whole trade.',
    corrects:
      'Routing is not one decision at the entrance. It happens inside every MoE layer, and it replaces the feed-forward block only — attention is shared.',
  },
  {
    id: 'encoder-only',
    title: 'Encoder-only models (trained with masking)',
    // Masking is a TRAINING objective. At inference there is no mask, and
    // attention is jointly bidirectional — not two branches that merge.
    runtime:
      'flowchart TD\n' +
      '  In["📥 Text"] --> Tok["Tokenise"]\n' +
      '  Tok --> Emb["Embed"]\n' +
      '  Emb --> Attn["Bidirectional attention — every token sees every other, in all layers"]\n' +
      '  Attn --> Rep["Representations"]\n' +
      '  Rep --> Use["✅ Embedding or label"]',
    buildTime:
      'flowchart TD\n' +
      '  subgraph Train["Pre-training only"]\n' +
      '  Corpus["📚 Corpus"] --> Mask["Mask ~15% of tokens"]\n' +
      '  Mask --> Predict["Predict the masked tokens"]\n' +
      '  Predict --> Weights["Trained weights"]\n' +
      '  end',
    provenance: {
      kind: 'paper',
      cite: 'BERT: Pre-training of Deep Bidirectional Transformers, Devlin et al.',
      url: 'https://arxiv.org/abs/1810.04805',
    },
    costNote: 'One forward pass, no generation loop — which is why these are the cheap option for search and classification.',
    corrects:
      'Masked language modelling is a training objective, not a model type, and attention is jointly bidirectional — not separate "left context" and "right context" paths that merge.',
  },
  {
    id: 'small',
    title: 'Small models (a size, not a job)',
    // An SLM's inference path is identical to any other model's. Quantisation
    // and edge deployment are things you do to it beforehand.
    runtime:
      'flowchart TD\n' +
      '  In["📥 Prompt"] --> Model["The same decode loop as any other model"]\n' +
      '  Model --> Out["✅ Response"]',
    buildTime:
      'flowchart TD\n' +
      '  subgraph Deploy["Done once, before you run it"]\n' +
      '  Base["Trained weights"] --> Quant["Quantise"]\n' +
      '  Quant --> Pack["Package for the target device"]\n' +
      '  Pack --> Ship["📦 On the device"]\n' +
      '  end',
    provenance: { kind: 'family', note: 'Any model small enough to run on modest hardware.' },
    costNote: 'Cheap and fast, with less headroom on hard tasks. The boundary with "large" is not defined by anyone.',
    corrects:
      'Quantisation and edge deployment are build-time steps, not stages of inference. A small model runs exactly like a big one.',
  },
];

const FLOW_BY_JOB = new Map<ModelJob, ModelFlow>(MODEL_FLOWS.map(f => [f.job, f]));

export function flowForJob(job: ModelJob): ModelFlow | undefined {
  return FLOW_BY_JOB.get(job);
}

export function attributeFlow(id: AttributeFlow['id']): AttributeFlow | undefined {
  return ATTRIBUTE_FLOWS.find(f => f.id === id);
}

/** A one-line citation for display under a diagram. Never invents a source. */
export function citeFlow(p: FlowProvenance): string {
  return p.kind === 'paper'
    ? `Follows ${p.cite} — ${p.url}`
    : `Illustrative: ${p.note}`;
}
