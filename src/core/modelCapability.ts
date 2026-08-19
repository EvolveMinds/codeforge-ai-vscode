/**
 * core/modelCapability.ts — what a given model can actually handle
 *
 * Every feature that sends a large prompt has the same latent bug: the model's
 * context window is smaller than the request, and nothing says so. Ollama in
 * particular truncates from the FRONT and answers anyway, so the user gets a
 * confident reply based on half the input. For code conversion that is the
 * worst possible failure — a port of the parts the model happened to see.
 *
 * This module makes the limit visible before the request goes out:
 *
 *   - the real context window, queried from Ollama (`/api/show`) where possible
 *     and otherwise looked up in the table below
 *   - a coding-strength tier, so we can tell someone their 3B general chat
 *     model will struggle with a job a coder model would manage
 *   - a fit verdict with plain-English advice, in three flavours: it fits,
 *     it needs splitting, or it cannot be done by this model at all
 * Detection beats the table: `source: 'detected'` values come from the running
 * server and are always preferred. The table only fills the gaps.
 */

import * as vscode from 'vscode';

export type ModelTier = 'strong' | 'good' | 'basic' | 'weak';

export interface ModelCapability {
  /** Model id as the provider knows it. */
  id: string;
  /** Total context window in tokens (input + output). */
  contextTokens: number;
  /** Most tokens the model/API will generate in one response. */
  maxOutputTokens: number;
  /** How well it handles a demanding structured coding task. */
  tier: ModelTier;
  /** Where these numbers came from — shown to the user so guesses are labelled. */
  source: 'detected' | 'known' | 'assumed';
  /** Human note about this model's suitability. */
  note?: string;
}

interface KnownModel {
  /** Matched case-insensitively against the model id, as a substring. */
  match: RegExp;
  contextTokens: number;
  maxOutputTokens: number;
  tier: ModelTier;
  note?: string;
}

/**
 * Ordered most-specific first — the first match wins, so `qwen2.5-coder:32b`
 * is matched before the generic `qwen` entry.
 */
const KNOWN_MODELS: KnownModel[] = [
  // ── Cloud: Anthropic ─────────────────────────────────────────────────────
  { match: /claude-(opus|sonnet)-[5-9]/i,      contextTokens: 200_000, maxOutputTokens: 64_000, tier: 'strong' },
  { match: /claude-haiku/i,                    contextTokens: 200_000, maxOutputTokens: 32_000, tier: 'good' },
  { match: /claude-3-5-sonnet|claude-sonnet-4/i, contextTokens: 200_000, maxOutputTokens: 8_192, tier: 'strong' },
  { match: /^claude/i,                         contextTokens: 200_000, maxOutputTokens: 8_192, tier: 'strong' },

  // ── Cloud: OpenAI + compatible ───────────────────────────────────────────
  { match: /^o[1-9]|^gpt-5/i,                  contextTokens: 200_000, maxOutputTokens: 65_536, tier: 'strong' },
  { match: /gpt-4\.1/i,                        contextTokens: 1_000_000, maxOutputTokens: 32_768, tier: 'strong' },
  { match: /gpt-4o/i,                          contextTokens: 128_000, maxOutputTokens: 16_384, tier: 'strong' },
  { match: /gpt-4/i,                           contextTokens: 128_000, maxOutputTokens: 8_192,  tier: 'strong' },
  { match: /gpt-3\.5/i,                        contextTokens: 16_385,  maxOutputTokens: 4_096,  tier: 'basic' },

  // ── Cloud: Google ────────────────────────────────────────────────────────
  { match: /gemini-.*-pro/i,                   contextTokens: 1_000_000, maxOutputTokens: 65_536, tier: 'strong' },
  { match: /gemini-.*-flash/i,                 contextTokens: 1_000_000, maxOutputTokens: 65_536, tier: 'good' },
  { match: /^gemini/i,                         contextTokens: 1_000_000, maxOutputTokens: 8_192,  tier: 'good' },

  // ── Cloud: Z.ai / Mistral / others ───────────────────────────────────────
  { match: /glm-4\.6|glm-5/i,                  contextTokens: 200_000, maxOutputTokens: 32_000, tier: 'strong' },
  { match: /glm-4\.5-air/i,                    contextTokens: 128_000, maxOutputTokens: 16_000, tier: 'good' },
  { match: /glm-4\.5/i,                        contextTokens: 128_000, maxOutputTokens: 16_000, tier: 'strong' },
  { match: /glm-4-flash/i,                     contextTokens: 128_000, maxOutputTokens: 8_192,  tier: 'basic' },
  { match: /kimi/i,                            contextTokens: 200_000, maxOutputTokens: 16_000, tier: 'strong' },
  { match: /mistral-large|codestral/i,         contextTokens: 128_000, maxOutputTokens: 16_000, tier: 'good' },
  { match: /llama-?3\.[123]-70b|llama-?3\.3/i, contextTokens: 128_000, maxOutputTokens: 8_192,  tier: 'good' },

  // ── Local via Ollama: coding-tuned ───────────────────────────────────────
  // Context here is the model's TRAINED window. Ollama still serves a smaller
  // num_ctx unless asked — which is exactly why we set it explicitly.
  { match: /qwen.*coder.*:?(32|72)b/i,         contextTokens: 32_768, maxOutputTokens: 16_384, tier: 'strong',
    note: 'Strong local choice for conversion — handles multi-file work.' },
  { match: /qwen.*coder.*:?14b/i,              contextTokens: 32_768, maxOutputTokens: 8_192,  tier: 'good',
    note: 'Good balance for local conversion.' },
  { match: /qwen.*coder/i,                     contextTokens: 32_768, maxOutputTokens: 8_192,  tier: 'good',
    note: 'Fine for single files; large batches are better on a 14B+ model.' },
  { match: /deepseek-coder-v2|deepseek.*coder.*:?(16|33)b/i, contextTokens: 65_536, maxOutputTokens: 8_192, tier: 'strong',
    note: 'Strong local coder with a large window.' },
  { match: /deepseek.*coder/i,                 contextTokens: 16_384, maxOutputTokens: 4_096,  tier: 'good' },
  { match: /codellama.*:?(34|70)b/i,           contextTokens: 16_384, maxOutputTokens: 8_192,  tier: 'good' },
  { match: /codellama|codegeex|starcoder|codestral/i, contextTokens: 16_384, maxOutputTokens: 4_096, tier: 'good' },
  { match: /devstral|codegemma/i,              contextTokens: 32_768, maxOutputTokens: 8_192,  tier: 'good' },

  // ── Local via Ollama: general ────────────────────────────────────────────
  // Parameter count is checked BEFORE model-family names, because size
  // dominates capability: `llama3.2:1b` is a 1B model first and a llama3
  // second. The separator and the `\b` matter — without them this would also
  // match the "2b" inside `qwen2.5-coder:32b` and mislabel a 32B model.
  { match: /[:\-](?:[1-3](?:\.\d+)?)b\b/i,     contextTokens: 8_192,  maxOutputTokens: 2_048,  tier: 'weak',
    note: 'Too small for reliable conversion — expect truncated files and missing reports.' },
  { match: /qwen.*:?(32|72)b/i,                contextTokens: 32_768, maxOutputTokens: 8_192,  tier: 'good' },
  { match: /llama-?3\.?[123]?.*:?70b/i,        contextTokens: 8_192,  maxOutputTokens: 4_096,  tier: 'good' },
  { match: /gemma4:(26|31)b/i,                 contextTokens: 128_000, maxOutputTokens: 8_192, tier: 'good' },
  { match: /gemma4:e4b/i,                      contextTokens: 32_768, maxOutputTokens: 8_192,  tier: 'basic',
    note: 'General-purpose. A coder model converts more reliably.' },
  { match: /gemma4:e2b/i,                      contextTokens: 32_768, maxOutputTokens: 4_096,  tier: 'weak',
    note: 'Small general model — expect truncated files and missing reports.' },
  { match: /gemma|phi|mistral:7b|llama3/i,     contextTokens: 8_192,  maxOutputTokens: 4_096,  tier: 'basic',
    note: 'General-purpose. A coder model converts more reliably.' },
];

/** Conservative default when we know nothing about a model at all. */
const UNKNOWN: Omit<ModelCapability, 'id' | 'source'> = {
  contextTokens: 8_192,
  maxOutputTokens: 4_096,
  tier: 'basic',
  note: 'Unrecognised model — limits assumed conservatively. If it has a bigger window, raise the batch size.',
};

/**
 * Describe a model. `detected` carries anything the running server told us
 * (Ollama's `/api/show` reports the real trained context length) and always
 * wins over the table.
 */
export function describeModel(
  modelId: string,
  detected?: { contextTokens?: number },
): ModelCapability {
  const known = KNOWN_MODELS.find(k => k.match.test(modelId));
  const base: ModelCapability = known
    ? { id: modelId, contextTokens: known.contextTokens, maxOutputTokens: known.maxOutputTokens,
        tier: known.tier, source: 'known', note: known.note }
    : { id: modelId, ...UNKNOWN, source: 'assumed' };

  if (detected?.contextTokens && detected.contextTokens > 0) {
    base.contextTokens = detected.contextTokens;
    base.source = 'detected';
    // A detected window smaller than the table's output cap would make the cap
    // nonsense — keep output under a quarter of the window, always.
    base.maxOutputTokens = Math.min(base.maxOutputTokens, Math.floor(detected.contextTokens * 0.5));
  }
  return base;
}

// ── Token estimation ─────────────────────────────────────────────────────────

/**
 * Code tokenises more densely than prose — roughly 3.2 characters per token
 * across the tokenisers in common use, versus ~4 for English. Underestimating
 * is the dangerous direction (it lets an oversized request through), so this
 * deliberately errs low on chars-per-token.
 */
const CHARS_PER_TOKEN = 3.2;

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export type FitVerdict = 'comfortable' | 'tight' | 'split' | 'impossible';

export interface FitAssessment {
  verdict: FitVerdict;
  /** Tokens the prompt is expected to consume. */
  promptTokens: number;
  /** Tokens the response is expected to need. */
  outputTokens: number;
  /** Usable window after reserving room for the response. */
  usableTokens: number;
  /** How many requests this job needs at this model's size. */
  slices: number;
  /** One-line plain-English summary. */
  headline: string;
  /** What the user can do about it. */
  advice: string;
}

/**
 * Can this model do this job, and if not, what should the user do?
 *
 * The reserve is the crux: a context window is shared between the prompt and
 * the response, and a conversion's response is roughly the size of its input.
 * Fitting the prompt alone into the window is not enough — that is precisely
 * how you get a reply that stops mid-file.
 */
export function assessFit(
  cap: ModelCapability,
  promptTokens: number,
  outputTokens: number,
): FitAssessment {
  // Leave 5% headroom for the chat template, system prompt and tokeniser drift.
  const window = Math.floor(cap.contextTokens * 0.95);
  const needed = promptTokens + outputTokens;
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`;

  // The whole job in one pass: prompt and response share the window.
  if (needed <= window && outputTokens <= cap.maxOutputTokens) {
    const headroom = (window - needed) / window;
    return {
      promptTokens, outputTokens, usableTokens: window - outputTokens,
      verdict: headroom > 0.35 ? 'comfortable' : 'tight',
      slices: 1,
      headline: headroom > 0.35
        ? `Fits comfortably (~${fmt(needed)} of ${fmt(cap.contextTokens)} tokens)`
        : `Fits, but only just (~${fmt(needed)} of ${fmt(cap.contextTokens)} tokens)`,
      advice: headroom > 0.35
        ? ''
        : 'Close to the limit. If the result comes back truncated, convert fewer files at a time or use a larger model.',
    };
  }

  // It has to be split. The reserve is then PER PASS, not for the whole job —
  // reserving the entire job's output from a single window is what makes a
  // perfectly splittable job look impossible.
  //
  // Converted code runs a little longer than its source, so half the window is
  // set aside for the response, bounded by the model's own output cap.
  const reservePerPass = Math.max(1, Math.min(cap.maxOutputTokens, Math.floor(window * 0.5)));
  const usablePerPass  = window - reservePerPass;
  const base = { promptTokens, outputTokens, usableTokens: usablePerPass };

  // Genuinely unusable: no meaningful room for input once the response is
  // accounted for. Only a very small window gets here.
  if (usablePerPass < 500) {
    return {
      ...base, verdict: 'impossible', slices: 0,
      headline: `${cap.id} cannot do this job (${fmt(cap.contextTokens)}-token window)`,
      advice: 'Once room is reserved for the response there is no usable space left for input. ' +
        'Choose a model with a larger context window — see the suggestions below.',
    };
  }

  // Two independent ceilings decide the pass count: how much input fits per
  // pass, and how much output the model will emit per response.
  const byInput  = Math.ceil(promptTokens / usablePerPass);
  const byOutput = Math.ceil(outputTokens / Math.max(1, cap.maxOutputTokens));
  const slices   = Math.max(1, byInput, byOutput);
  const limiter  = byOutput > byInput ? 'response length' : 'context window';

  return {
    ...base, verdict: 'split', slices,
    headline: `Too big for one pass (~${fmt(needed)} tokens needed, ${fmt(cap.contextTokens)} available)`,
    advice: `It will be split into ${slices} passes, each converted with the context of what came before ` +
      `(limited by ${limiter}). That works, but a single pass is more coherent — if you have a model with a ` +
      `larger window, it is the better answer.`,
  };
}

/**
 * Models worth suggesting when the chosen one is too small, ordered by how
 * easy they are to reach. Kept short and honest: no point recommending a 72B
 * model to someone whose machine is already struggling.
 */
export function suggestBiggerModels(
  provider: string,
  installedLocal: string[],
  needTokens: number,
): string[] {
  const out: string[] = [];

  // First and best: something already installed that is actually big enough.
  const viable = installedLocal
    .map(m => ({ m, cap: describeModel(m) }))
    .filter(x => x.cap.contextTokens * 0.95 >= needTokens)
    .sort((a, b) => rankTier(b.cap.tier) - rankTier(a.cap.tier));
  for (const v of viable.slice(0, 3)) {
    out.push(`${v.m} — already installed, ${Math.round(v.cap.contextTokens / 1000)}k context, ${v.cap.tier} at code`);
  }

  const isLocal = ['ollama', 'gemma4', 'glm', 'colibri'].includes(provider);
  if (isLocal) {
    if (!installedLocal.some(m => /qwen.*coder.*:?(14|32)b/i.test(m))) {
      out.push('ollama pull qwen2.5-coder:14b — 32k context, strong at conversion (~9GB)');
    }
    if (!installedLocal.some(m => /deepseek-coder-v2/i.test(m))) {
      out.push('ollama pull deepseek-coder-v2 — 64k context, good for large batches (~9GB)');
    }
    out.push('Or switch to a cloud provider for this one job — 128k–1M context');
  } else {
    out.push('Claude (200k), GPT-4.1 (1M) or Gemini (1M) handle jobs this size in one pass');
  }
  return out;
}

function rankTier(t: ModelTier): number {
  return { strong: 3, good: 2, basic: 1, weak: 0 }[t];
}

/** Short label for a tier, for the UI. */
export function tierLabel(t: ModelTier): string {
  return { strong: 'Strong at code', good: 'Good at code', basic: 'Basic', weak: 'Weak — expect problems' }[t];
}

export interface DataAnalysisModelVerdict {
  modelId: string;
  provider: string;
  isOptimal: boolean;
  tier: ModelTier;
  badge: string;
  verdict: 'optimal' | 'good' | 'suboptimal' | 'weak';
  summary: string;
  recommendation?: string;
  suggestedLocalModel?: string;
}

/**
 * Assess how well a given model and provider are suited for Data Analysis & Reporting tasks
 * (Python/Pandas data cleaning, aggregations, chart generation, and narrative reporting).
 */
export function assessModelForDataAnalysis(
  provider: string,
  modelId: string,
  ramGB?: number,
): DataAnalysisModelVerdict {
  const p = (provider || '').toLowerCase();
  const m = (modelId || '').toLowerCase();

  // 1. Cloud Providers
  if (['anthropic', 'openai', 'gemini', 'zai', 'huggingface'].includes(p)) {
    if (m.includes('haiku') || m.includes('flash') || m.includes('gpt-3.5') || m.includes('glm-4-flash')) {
      return {
        modelId,
        provider,
        isOptimal: true,
        tier: 'good',
        badge: '⚡ Fast Cloud Model',
        verdict: 'good',
        summary: 'Fast and responsive cloud model. Handles standard data analysis, Pandas scripts, and chart generation well.',
      };
    }
    return {
      modelId,
      provider,
      isOptimal: true,
      tier: 'strong',
      badge: '☁️ Optimal Cloud Model',
      verdict: 'optimal',
      summary: 'High-capability cloud model. Excellent at complex multi-column aggregations, math, and accurate insights.',
    };
  }

  // 2. Local Models via Ollama / Gemma4 / GLM / Colibri
  // Specialized Strong Coders (14B/32B/72B)
  if (/qwen.*coder.*(14|32|72)b|deepseek.*coder.*(16|33|236)b/i.test(m)) {
    return {
      modelId,
      provider,
      isOptimal: true,
      tier: 'strong',
      badge: '✓ Optimal Local Coder',
      verdict: 'optimal',
      summary: 'Strong local code model. Generates robust, bug-free Pandas scripts and high-quality charts.',
    };
  }

  // Good Coder models (7B)
  if (/qwen.*coder|deepseek.*coder|codegeex|codestral|codellama/i.test(m)) {
    return {
      modelId,
      provider,
      isOptimal: true,
      tier: 'good',
      badge: '✓ Recommended Local Coder',
      verdict: 'good',
      summary: 'Good local code model. Reliable for single-dataset exploratory analysis and standard chart generation.',
      recommendation: ramGB && ramGB >= 16 ? 'For large or complex multi-table datasets, consider upgrading to qwen2.5-coder:14b.' : undefined,
    };
  }

  // General 7B+ Models (Gemma2, Llama 3.1 8B, etc.)
  if (/gemma-?2?:(9|27)b|llama-?3\.[123]?:(8|70)b|mistral-small/i.test(m) || /(7|8|9|14|27|70)b/i.test(m)) {
    return {
      modelId,
      provider,
      isOptimal: true,
      tier: 'good',
      badge: '⚡ Good General Model',
      verdict: 'good',
      summary: 'Good for narrative summaries. For specialized Pandas code and complex charts, qwen2.5-coder is recommended.',
      recommendation: 'Best Practice: qwen2.5-coder:7b or qwen2.5-coder:14b produces the cleanest Python data science code.',
      suggestedLocalModel: 'qwen2.5-coder:7b',
    };
  }

  // Underpowered / Small Models (< 7B or non-coding 1B/3B)
  if (/0\.5b|1b|1\.5b|2b|3b|mini|tiny|phi-?3/i.test(m) || /llama-?3\.2:[13]b/i.test(m)) {
    const suggested = ramGB && ramGB >= 16 ? 'qwen2.5-coder:14b' : 'qwen2.5-coder:7b';
    return {
      modelId,
      provider,
      isOptimal: false,
      tier: 'weak',
      badge: '⚠️ Underpowered for Data Science',
      verdict: 'suboptimal',
      summary: `Active model "${modelId}" is a lightweight model. Small models frequently hallucinate column names or produce syntax errors in Pandas scripts.`,
      recommendation: `Recommended Best Practice: Switch to ${suggested} (via Ollama) or a cloud provider for accurate Python scripts and reports.`,
      suggestedLocalModel: suggested,
    };
  }

  // Fallback
  return {
    modelId,
    provider,
    isOptimal: true,
    tier: 'basic',
    badge: 'ℹ️ Local Model',
    verdict: 'good',
    summary: `Active model: ${modelId}.`,
    recommendation: 'Recommended: For data science & reporting tasks, qwen2.5-coder (7b or 14b) is the best-performing local model.',
    suggestedLocalModel: 'qwen2.5-coder:7b',
  };
}

/** The model a provider uses by default, from settings. */
export function defaultModelFor(p: string, cfg: vscode.WorkspaceConfiguration): string {
  switch (p) {
    case 'ollama':      return cfg.get<string>('ollamaModel', 'qwen2.5-coder:7b');
    case 'gemma4':      return cfg.get<string>('gemma4Model', 'gemma4:e4b');
    case 'glm':         return cfg.get<string>('glmModel', 'codegeex4-all-9b');
    case 'colibri':     return cfg.get<string>('colibriModel', 'glm-5.2');
    case 'anthropic':   return cfg.get<string>('anthropicModel', 'claude-sonnet-4-6');
    case 'openai':      return cfg.get<string>('openaiModel', 'gpt-4o');
    case 'gemini':      return cfg.get<string>('geminiModel', 'gemini-2.5-flash');
    case 'zai':         return cfg.get<string>('zaiModel', 'glm-4.6');
    case 'huggingface': return cfg.get<string>('huggingfaceModel', 'Qwen/Qwen2.5-Coder-32B-Instruct');
    default:            return 'offline';
  }
}

export function providerLabel(p: string): string {
  return ({
    ollama: 'Ollama (local)', gemma4: 'Gemma 4 (local)', glm: 'GLM (local)',
    colibri: 'Colibri (local)', anthropic: 'Anthropic Claude', openai: 'OpenAI',
    gemini: 'Google Gemini', zai: 'GLM (Z.ai)', huggingface: 'Hugging Face',
    offline: 'Offline (no LLM)', auto: 'Auto',
  } as Record<string, string>)[p] ?? p;
}
