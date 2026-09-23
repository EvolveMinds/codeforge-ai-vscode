/**
 * core/modelAdvisor.ts — which model is right for this job?
 *
 * `modelCapability.ts` answers "will this job FIT in this model?" — a question
 * about size. This module answers the one before it: "is this the right KIND of
 * model at all?" A 70B chat model with a huge context window is still the wrong
 * tool for generating embeddings, and no amount of context makes it right.
 *
 * The taxonomy deliberately separates two things that popular explainers mix:
 *
 *   - the JOB: what you want done (generate, understand, represent, act)
 *   - the ATTRIBUTES: size, architecture, modality, openness
 *
 * Mixture-of-Experts and masked-language-modelling are attributes, not jobs —
 * a model can be an MoE encoder that produces embeddings. Sorting them onto one
 * axis is what makes a model picker impossible to use, so they stay separate
 * here: `ModelJob` is the question, `ModelAttributes` are the filters.
 *
 * Two rules this module will not bend:
 *
 *   1. DETECTION BEATS THE TABLE. Anything the running server tells us wins
 *      over anything we guessed from a model's name, and the difference is
 *      reported to the user via `source`. Ollama's `/api/show` states a model's
 *      capabilities outright; a name is only ever circumstantial evidence.
 *
 *   2. PARSIMONY. When several models can do a job, the smallest and cheapest
 *      one wins. This is the same rule the FDE capability ladder applies to
 *      architecture, and it is the whole point: the biggest model is not the
 *      best model, it is just the most expensive one that also works.
 */

import {
  describeModel, parseParamSizeB, providerLabel,
  type ModelCapability,
} from './modelCapability';
import type { OllamaModelInfo } from './interfaces';

// ── Jobs ──────────────────────────────────────────────────────────────────────

/**
 * What the user actually wants done. Not "what kind of model is this" — the
 * same model often does several of these, and that is exactly why the job is
 * the right axis to pick on.
 */
export type ModelJob =
  | 'chat'
  | 'reasoning'
  | 'code-agentic'
  | 'code-fim'
  | 'embedding'
  | 'reranking'
  | 'vision'
  | 'ocr'
  | 'classification'
  | 'timeseries';

/** How well a model does a job. */
export type JobFitness = 'native' | 'capable' | 'poor' | 'unsupported';

/**
 * Where a claim came from. Same vocabulary as `ModelCapability.source` on
 * purpose — a third scale would just be another thing to keep in sync.
 */
export type CapabilitySource = 'detected' | 'known' | 'assumed';

export interface JobInfo {
  job: ModelJob;
  label: string;
  /**
   * Whether Evolve AI actually does this job. `false` entries are documented
   * so we can answer "that is a real category, and it is not what we do"
   * rather than pretending the category does not exist.
   */
  inScope: boolean;
  whatItDoes: string;
  whenToUse: string;
  /** The mistake people actually make with this job. */
  commonMistake: string;
}

/**
 * The corrected taxonomy, as data.
 *
 * It lives here — not as prose in a webview template — because the advisor UI,
 * the documentation and the architecture diagrams all need to agree, and three
 * copies of a taxonomy is three chances to disagree.
 */
export const JOB_CATALOG: readonly JobInfo[] = [
  {
    job: 'chat', label: 'Text generation & chat', inScope: true,
    whatItDoes: 'Generates prose, answers questions, follows instructions.',
    whenToUse: 'Explanations, summaries, drafting, general assistance.',
    commonMistake: 'Reaching for the largest model when a small one answers just as well, and faster.',
  },
  {
    job: 'reasoning', label: 'Reasoning', inScope: true,
    whatItDoes: 'Spends extra inference-time compute working a problem through before answering.',
    whenToUse: 'Multi-step logic, planning, debugging a subtle failure.',
    commonMistake: 'Leaving it on for everything — it is slower and rarely helps simple lookups.',
  },
  {
    job: 'code-agentic', label: 'Code generation & editing', inScope: true,
    whatItDoes: 'Writes, refactors and converts whole files from an instruction.',
    whenToUse: 'Conversion, refactoring, test generation, fixing errors.',
    commonMistake: 'Using a general chat model; a coder model of the same size is consistently better.',
  },
  {
    job: 'code-fim', label: 'Inline completion (fill-in-the-middle)', inScope: true,
    whatItDoes: 'Completes code given what comes BEFORE and AFTER the cursor.',
    whenToUse: 'As-you-type autocomplete.',
    commonMistake: 'Assuming any code model can do it. FIM is a distinct trained capability — Ollama reports it as "insert".',
  },
  {
    job: 'embedding', label: 'Embeddings', inScope: true,
    whatItDoes: 'Turns text into a vector so similar meanings sit close together.',
    whenToUse: 'Semantic search, RAG retrieval, clustering, deduplication.',
    commonMistake: 'Trying to use a chat model. Embedding models are a different kind of model, not a smaller one.',
  },
  {
    job: 'reranking', label: 'Reranking', inScope: true,
    whatItDoes: 'Rescores retrieved candidates by reading query and document together.',
    whenToUse: 'The second stage of retrieval, after embeddings narrow the field.',
    commonMistake: 'Skipping it. Embed-then-rerank beats embeddings alone at the same retrieval budget.',
  },
  {
    job: 'vision', label: 'Vision & image understanding', inScope: true,
    whatItDoes: 'Reads images alongside text — screenshots, charts, diagrams.',
    whenToUse: 'Explaining a screenshot, reading a chart, describing a diagram.',
    commonMistake: 'Sending images to a text-only model, which silently ignores them.',
  },
  {
    job: 'ocr', label: 'Document & OCR', inScope: true,
    whatItDoes: 'Extracts structured text, tables and layout from documents.',
    whenToUse: 'Scanned PDFs, invoices, forms.',
    commonMistake: 'Expecting a general vision model to keep table structure intact.',
  },
  {
    job: 'classification', label: 'Classification & routing', inScope: true,
    whatItDoes: 'Assigns a label fast and cheaply — intent, sentiment, category.',
    whenToUse: 'Triage, routing, guardrails, tagging at volume.',
    commonMistake: 'Paying for a generative model to emit one word. A small encoder is faster and cheaper.',
  },
  {
    job: 'timeseries', label: 'Forecasting', inScope: true,
    whatItDoes: 'Projects a numeric series forward with an uncertainty band.',
    whenToUse: 'Trends, seasonality, capacity planning.',
    // Evolve AI ships a real statistical forecaster (offline/timeIntelligence.ts:
    // Holt-Winters with prediction intervals, changepoints, autocorrelation
    // seasonality). Recommending an LLM here would be worse AND slower.
    commonMistake: 'Asking a language model to forecast. It will produce confident numbers with no basis — use a statistical forecaster.',
  },
];

const JOB_BY_ID = new Map<ModelJob, JobInfo>(JOB_CATALOG.map(j => [j.job, j]));

export function jobInfo(job: ModelJob): JobInfo | undefined {
  return JOB_BY_ID.get(job);
}

// ── Attributes ────────────────────────────────────────────────────────────────

export interface ModelAttributes {
  /** How much machine it needs. This is what "small model" actually means. */
  deployability: 'edge' | 'single-gpu' | 'multi-node' | 'api';
  /** MoE changes the memory/speed trade-off: VRAM tracks total, speed tracks active. */
  architecture?: 'dense' | 'moe';
  /** Encoder-only models (BERT lineage) understand; decoder-only models generate. */
  attention?: 'encoder-only' | 'decoder-only';
  modalities: Array<'text' | 'image' | 'audio'>;
  reasoning?: boolean;
  openWeight?: boolean;
  /** Parameter count in billions, when the model states one. */
  parametersB?: number | null;
  /** Architecture family as the server reports it, e.g. "qwen2". */
  family?: string;
}

export interface ModelProfile {
  id: string;
  provider: string;
  jobs: Partial<Record<ModelJob, JobFitness>>;
  attributes: ModelAttributes;
  /** Weakest provenance across this profile's claims. */
  source: CapabilitySource;
  /** Size/context facts, composed rather than duplicated. */
  capability: ModelCapability;
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Ollama's capability strings, mapped to the jobs they prove.
 *
 * These are facts from the running server, so they produce `native` and mark
 * the profile `detected`. `completion` is deliberately absent: every generative
 * model reports it, so it distinguishes nothing.
 */
const CAPABILITY_JOBS: Record<string, ModelJob[]> = {
  vision:    ['vision'],
  embedding: ['embedding'],
  insert:    ['code-fim'],
  thinking:  ['reasoning'],
};

/** Name fragments that suggest a job when the server is silent. Weak evidence. */
const NAME_HINTS: Array<{ re: RegExp; jobs: Partial<Record<ModelJob, JobFitness>> }> = [
  { re: /embed|bge-|gte-|e5-|nomic|minilm/i,
    jobs: { embedding: 'native', chat: 'unsupported', 'code-agentic': 'unsupported', reasoning: 'unsupported' } },
  { re: /rerank|cross-encoder/i,
    jobs: { reranking: 'native', chat: 'unsupported', 'code-agentic': 'unsupported' } },
  { re: /llava|vision|-vl\b|bakllava|moondream|minicpm-v/i,
    jobs: { vision: 'native' } },
  { re: /\bocr\b|docling|got-ocr/i,
    jobs: { ocr: 'native', vision: 'capable' } },
  { re: /coder|codegeex|starcoder|codestral|codellama|devstral|codegemma/i,
    jobs: { 'code-agentic': 'native', 'code-fim': 'capable' } },
  { re: /bert|deberta|roberta/i,
    jobs: { classification: 'native', embedding: 'capable', chat: 'unsupported', 'code-agentic': 'unsupported' } },
  { re: /guard|shield|safety/i,
    jobs: { classification: 'native', chat: 'poor' } },
];

/** Cloud providers whose models we reach over an API. */
const CLOUD_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'zai', 'huggingface']);

/**
 * Describe what a model is for.
 *
 * `detected` is whatever the running server reported and always wins. Without
 * it we fall back to the model's name, which is a guess and is labelled as one.
 */
export function profileModel(
  id: string,
  provider: string,
  detected?: OllamaModelInfo | null,
): ModelProfile {
  const m = (id || '').toLowerCase();
  const p = (provider || '').toLowerCase();
  const isCloud = CLOUD_PROVIDERS.has(p);

  const jobs: Partial<Record<ModelJob, JobFitness>> = {};
  let source: CapabilitySource = 'assumed';

  // 1. Name hints first — weak evidence, overwritten by anything detected.
  for (const hint of NAME_HINTS) {
    if (hint.re.test(m)) Object.assign(jobs, hint.jobs);
  }

  // 2. Baseline for a generative model. Only applied where the name has not
  //    already said this is a specialist (an embedding model is not a chatbot).
  const isSpecialist = jobs.chat === 'unsupported';
  if (!isSpecialist) {
    const paramsB = parseParamSizeB(m);
    const cap = describeModel(id, detected ?? undefined);
    const strong = cap.tier === 'strong' || cap.tier === 'good';
    jobs.chat ??= strong ? 'native' : 'capable';
    jobs['code-agentic'] ??= strong ? 'capable' : 'poor';
    jobs.classification ??= 'capable';
    // A very small general model is a poor bet for demanding work.
    if (paramsB !== null && paramsB < 4) {
      jobs['code-agentic'] = 'poor';
      jobs.reasoning ??= 'poor';
    }
  }

  // 3. Detected capabilities override everything above.
  if (detected?.capabilities?.length) {
    source = 'detected';
    for (const c of detected.capabilities) {
      for (const job of CAPABILITY_JOBS[c.toLowerCase()] ?? []) jobs[job] = 'native';
    }
    // An embedding model is not a text generator, whatever its name suggests.
    if (detected.capabilities.includes('embedding')) {
      jobs.chat = 'unsupported';
      jobs['code-agentic'] = 'unsupported';
      jobs.reasoning = 'unsupported';
    }
  } else if (detected?.contextTokens) {
    source = 'detected';
  }

  // No model we ship runs a time-series foundation model, and a language model
  // asked to forecast fabricates numbers. Always unsupported — see JOB_CATALOG.
  jobs.timeseries = 'unsupported';

  const capability = describeModel(id, detected ?? undefined);
  if (source !== 'detected') {
    source = capability.source === 'detected' ? 'detected'
           : capability.source === 'known'    ? 'known'
           : 'assumed';
  }

  const parametersB = parseParamSizeB(detected?.parameterSize ?? m);
  const modalities: ModelAttributes['modalities'] = ['text'];
  if (jobs.vision === 'native' || jobs.ocr === 'native') modalities.push('image');

  return {
    id, provider,
    jobs,
    attributes: {
      deployability: isCloud ? 'api' : deployabilityFor(parametersB),
      architecture: /mixtral|\d+x\d+b|moe/i.test(m) ? 'moe' : undefined,
      attention: jobs.embedding === 'native' || /bert|deberta|roberta/i.test(m)
        ? 'encoder-only' : 'decoder-only',
      modalities,
      reasoning: jobs.reasoning === 'native' || undefined,
      openWeight: !isCloud || undefined,
      parametersB,
      family: detected?.family,
    },
    source,
    capability,
  };
}

/** Rough hardware bracket from parameter count. Null size means we cannot say. */
function deployabilityFor(parametersB: number | null): ModelAttributes['deployability'] {
  if (parametersB === null) return 'single-gpu';
  if (parametersB <= 4)  return 'edge';
  if (parametersB <= 34) return 'single-gpu';
  return 'multi-node';
}

/** How well does this model do this job? Unlisted means we have no reason to think it does. */
export function fitnessFor(profile: ModelProfile, job: ModelJob): JobFitness {
  return profile.jobs[job] ?? 'unsupported';
}

// ── Recommendation ────────────────────────────────────────────────────────────

export interface JobAlternative {
  id: string;
  provider: string;
  why: string;
  installed: boolean;
  /** Present when the user can act on it directly. */
  pullCommand?: string;
}

export interface JobRecommendation {
  job: ModelJob;
  verdict: 'ideal' | 'workable' | 'wrong-tool' | 'unsupported';
  headline: string;
  rationale: string;
  /** The model we suggest, when a better one than the current is available. */
  pick?: ModelProfile;
  alternatives: JobAlternative[];
  source: CapabilitySource;
}

/**
 * Models worth suggesting per job when nothing installed can do it. Kept short
 * and honest: these are pointers to well-known open models, not benchmark
 * claims, and no scores are asserted.
 */
const SUGGESTIONS: Partial<Record<ModelJob, Array<{ id: string; why: string }>>> = {
  embedding: [
    { id: 'nomic-embed-text',  why: 'small, fast, made for retrieval' },
    { id: 'mxbai-embed-large', why: 'larger embeddings when recall matters more than speed' },
  ],
  'code-agentic': [
    { id: 'qwen2.5-coder:7b',  why: 'strong local coder that fits modest hardware' },
    { id: 'qwen2.5-coder:14b', why: 'better on multi-file work if you have the memory' },
  ],
  'code-fim': [
    { id: 'qwen2.5-coder:7b',  why: 'trained for fill-in-the-middle completion' },
  ],
  vision: [
    { id: 'llava:7b',    why: 'general image understanding, runs locally' },
    { id: 'moondream',   why: 'very small vision model for constrained machines' },
  ],
  chat: [
    { id: 'qwen2.5:7b',  why: 'solid general-purpose local chat model' },
  ],
};

const FITNESS_RANK: Record<JobFitness, number> = {
  native: 3, capable: 2, poor: 1, unsupported: 0,
};

/**
 * Pick the best model for a job from what is available.
 *
 * Ties are broken by PARSIMONY: among models that do the job equally well, the
 * smallest wins, and a local model beats a cloud one. Recommending the largest
 * capable model would be easier and wrong — it costs more and answers slower
 * for no benefit.
 */
export function recommendForJob(
  job: ModelJob,
  candidates: ModelProfile[],
  options?: { current?: string },
): JobRecommendation {
  const info = JOB_BY_ID.get(job);
  const usable = candidates
    .filter(c => FITNESS_RANK[fitnessFor(c, job)] >= FITNESS_RANK.capable)
    .sort((a, b) => {
      const byFit = FITNESS_RANK[fitnessFor(b, job)] - FITNESS_RANK[fitnessFor(a, job)];
      if (byFit !== 0) return byFit;
      // Parsimony: prefer local, then the smaller model.
      const aCloud = a.attributes.deployability === 'api' ? 1 : 0;
      const bCloud = b.attributes.deployability === 'api' ? 1 : 0;
      if (aCloud !== bCloud) return aCloud - bCloud;
      return (a.attributes.parametersB ?? 1e9) - (b.attributes.parametersB ?? 1e9);
    });

  const current = options?.current
    ? candidates.find(c => c.id === options.current)
    : undefined;
  const pick = usable[0];
  const alternatives = buildAlternatives(job, candidates, pick);

  // Weakest provenance among the models the verdict actually rests on.
  const source = weakestSource([current, pick].filter((x): x is ModelProfile => !!x));

  if (!info?.inScope) {
    return {
      job, verdict: 'unsupported', alternatives: [], source,
      headline: `${info?.label ?? job} is not something Evolve AI does`,
      rationale: 'Documented so the category is not mistaken for missing — but nothing here performs it.',
    };
  }

  // The forecasting case: the honest answer is "do not use a model".
  if (job === 'timeseries') {
    return {
      job, verdict: 'wrong-tool', alternatives: [], source,
      headline: 'Use the built-in statistical forecaster, not a language model',
      rationale:
        'Evolve AI forecasts with Holt-Winters and reports a prediction interval, detects changepoints ' +
        'and infers seasonality from the data. That is deterministic, runs offline and shows its uncertainty. ' +
        'A language model asked for a forecast produces confident numbers with nothing behind them.',
    };
  }

  if (current) {
    const fit = fitnessFor(current, job);
    if (fit === 'native' || fit === 'capable') {
      const better = pick && pick.id !== current.id &&
        FITNESS_RANK[fitnessFor(pick, job)] > FITNESS_RANK[fit] ? pick : undefined;
      return {
        job,
        verdict: fit === 'native' ? 'ideal' : 'workable',
        headline: fit === 'native'
          ? `${current.id} is a good fit for ${info.label.toLowerCase()}`
          : `${current.id} can do this, but it is not what it is best at`,
        rationale: fit === 'native'
          ? info.whatItDoes
          : `${info.commonMistake}`,
        pick: better,
        alternatives: better ? alternatives : [],
        source,
      };
    }
    return {
      job,
      verdict: fit === 'unsupported' ? 'unsupported' : 'wrong-tool',
      headline: fit === 'unsupported'
        ? `${current.id} cannot do ${info.label.toLowerCase()}`
        : `${current.id} is the wrong tool for ${info.label.toLowerCase()}`,
      rationale: info.commonMistake,
      pick,
      alternatives,
      source,
    };
  }

  if (pick) {
    return {
      job, verdict: 'ideal', pick, alternatives: [], source,
      headline: `${pick.id} — ${providerLabel(pick.provider)}`,
      rationale: info.whatItDoes,
    };
  }

  return {
    job, verdict: 'unsupported', alternatives, source,
    headline: `Nothing installed can do ${info.label.toLowerCase()}`,
    rationale: info.whenToUse,
  };
}

function buildAlternatives(
  job: ModelJob,
  candidates: ModelProfile[],
  pick?: ModelProfile,
): JobAlternative[] {
  const out: JobAlternative[] = [];
  if (pick) {
    out.push({
      id: pick.id, provider: pick.provider, installed: true,
      why: `already available — ${describeFitness(fitnessFor(pick, job))} at this job`,
    });
  }
  const have = new Set(candidates.map(c => c.id.toLowerCase()));
  for (const s of SUGGESTIONS[job] ?? []) {
    if (have.has(s.id.toLowerCase())) continue;
    out.push({
      id: s.id, provider: 'ollama', installed: false,
      why: s.why, pullCommand: `ollama pull ${s.id}`,
    });
    if (out.length >= 3) break;
  }
  return out;
}

function describeFitness(f: JobFitness): string {
  return { native: 'purpose-built', capable: 'usable', poor: 'weak', unsupported: 'unable' }[f];
}

/** The weakest provenance wins — a verdict is only as sound as its shakiest input. */
function weakestSource(profiles: ModelProfile[]): CapabilitySource {
  if (!profiles.length) return 'assumed';
  const rank: Record<CapabilitySource, number> = { assumed: 0, known: 1, detected: 2 };
  return profiles.reduce<CapabilitySource>(
    (worst, p) => (rank[p.source] < rank[worst] ? p.source : worst), 'detected');
}

// ── Session-scoped model choices ──────────────────────────────────────────────

/** A model chosen for one job. Session-scoped: never written to settings. */
export interface JobModelChoice {
  provider: string;
  model: string;
}

/**
 * Which model each job should use, for this session only.
 *
 * Lives in core rather than in a command or a panel because several features
 * need to agree on it: the advisor sets it, the Data Analysis studio offers it
 * in its own picker, and anything building an `AIRequest` reads it. A command
 * class would have been the wrong home — plugins would have had to import from
 * `commands/`, which nothing else does and which inverts the dependency.
 *
 * Deliberately not persisted. `aiForge.switchProvider` writes the provider and
 * model to global settings, which is right for "change my default" and wrong
 * for "use something better for this one job" — that choice used to leak into
 * chat and code conversion and stay there. A model picked for one big job
 * should be gone by tomorrow.
 */
const JOB_CHOICES = new Map<ModelJob, JobModelChoice>();

export function choiceForJob(job: ModelJob): JobModelChoice | undefined {
  return JOB_CHOICES.get(job);
}

export function setChoiceForJob(job: ModelJob, choice: JobModelChoice): void {
  JOB_CHOICES.set(job, choice);
}

export function clearChoiceForJob(job: ModelJob): void {
  JOB_CHOICES.delete(job);
}

export function clearAllChoices(): void { JOB_CHOICES.clear(); }

/**
 * The session choice for a job as per-request overrides, ready to spread into
 * an `AIRequest`. Empty when nothing is chosen, so the global default applies.
 */
export function overridesForJob(job: ModelJob): { providerOverride?: string; modelOverride?: string } {
  const c = JOB_CHOICES.get(job);
  return c ? { providerOverride: c.provider, modelOverride: c.model } : {};
}

// ── Task → job ────────────────────────────────────────────────────────────────

/** The ladder's input-modality options, which constrain what job makes sense. */
export type InputModality = 'structured_data' | 'unstructured_text' | 'multimodal' | 'api_stream';

export interface JobInference {
  job: ModelJob;
  confidence: 'high' | 'low';
  /** Present when the honest answer is something other than "pick a model". */
  note?: string;
}

const TASK_PATTERNS: Array<{ re: RegExp; job: ModelJob }> = [
  { re: /embed|vector|semantic search|similarity|retriev/i, job: 'embedding' },
  { re: /rerank|re-rank|relevance scor/i,                   job: 'reranking' },
  { re: /autocomplete|inline completion|fill.?in.?the.?middle|as you type/i, job: 'code-fim' },
  { re: /convert|refactor|generate code|unit test|port .* to/i, job: 'code-agentic' },
  { re: /screenshot|image|chart|diagram|photo|visual/i,     job: 'vision' },
  { re: /ocr|scanned|pdf|invoice|receipt|form extract/i,    job: 'ocr' },
  { re: /classif|route|triage|intent|sentiment|categor|tag/i, job: 'classification' },
  { re: /forecast|predict .* next|trend|seasonal|time series/i, job: 'timeseries' },
  { re: /reason|plan|multi-?step|prove|derive|debug/i,      job: 'reasoning' },
];

/**
 * Work out what job a described task needs.
 *
 * The `structured_data` case is the one that matters most and is the least
 * obvious: when the input is rows and columns and the task is arithmetic, the
 * right answer is usually a rule or a SQL query, not a model at all. Saying so
 * is more useful than naming a model.
 */
export function inferJobFromTask(text: string, modality?: InputModality): JobInference {
  const t = text || '';

  if (modality === 'structured_data' && /sum|total|reconcil|balance|ledger|tax|invoice|arithmetic|calculat/i.test(t)) {
    return {
      job: 'classification', confidence: 'low',
      note: 'This looks like deterministic arithmetic over structured data. A rule or SQL query is exact, ' +
            'instant and auditable; a model is none of those. Consider whether it needs one at all.',
    };
  }

  for (const p of TASK_PATTERNS) {
    if (p.re.test(t)) {
      if (p.job === 'timeseries') {
        return { job: 'timeseries', confidence: 'high',
          note: 'Use the built-in statistical forecaster rather than a language model.' };
      }
      return { job: p.job, confidence: 'high' };
    }
  }

  switch (modality) {
    case 'multimodal':      return { job: 'vision', confidence: 'high' };
    case 'unstructured_text': return { job: 'chat', confidence: 'low',
      note: 'Unstructured text usually means retrieval — embeddings and reranking — before generation.' };
    case 'api_stream':      return { job: 'classification', confidence: 'low',
      note: 'Streaming events are usually routed or labelled, which a small classifier does faster and cheaper.' };
    default:                return { job: 'chat', confidence: 'low' };
  }
}
