/**
 * core/interfaces.ts — Stable contracts for every core service
 *
 * IServices uses THESE, not concrete classes.
 * Plugins and commands are coded against these — never against AIService,
 * ContextService, or WorkspaceService directly.
 *
 * This means:
 *  - Any service can be swapped in tests by providing a mock implementation
 *  - Plugins cannot accidentally depend on internal implementation details
 *  - The compiler enforces the contract on every concrete class
 */

import * as vscode from 'vscode';
import type { ProviderName, AIRequest, RequestInterceptor } from './aiService';
import type { ProjectContext, BuildContextOptions }         from './contextService';
import type { GeneratedFile }                               from './workspaceService';

// ── AI service ────────────────────────────────────────────────────────────────

/**
 * What the running Ollama server reports about a model.
 *
 * Every field is optional because the server is the authority and may say
 * nothing: an absent field means "not reported", never "not supported". That
 * distinction matters — it is the difference between a detected fact and a
 * guess, and callers label them differently to the user.
 */
export interface OllamaModelInfo {
  /** Trained context length, from `model_info["<arch>.context_length"]`. */
  contextTokens?: number;
  /**
   * Ollama's own capability list, e.g. `["completion","tools","insert"]`.
   * Known values include completion, tools, insert (fill-in-the-middle),
   * vision, embedding and thinking.
   */
  capabilities?: string[];
  /** Architecture family, e.g. "qwen2". */
  family?: string;
  /** Parameter count as reported, e.g. "7.6B". */
  parameterSize?: string;
}

export interface IAIService {
  /** Detect which provider is currently configured */
  detectProvider(): Promise<ProviderName>;
  /** Check if Ollama is running on the configured host */
  isOllamaRunning(host?: string): Promise<boolean>;
  /** List models installed in Ollama */
  getOllamaModels(host?: string): Promise<string[]>;
  /**
   * Ask Ollama what a model can handle. Null when the server or model can't
   * tell us. Callers building large prompts use this to size the request
   * instead of guessing, and `capabilities` lets us report what a model is
   * *for* — vision, embedding, tool use — as detected fact rather than a guess
   * from its name.
   */
  getOllamaModelInfo?(model: string, host?: string): Promise<OllamaModelInfo | null>;
  /** Stream a response, chunk by chunk */
  stream(request: AIRequest): AsyncGenerator<string>;
  /** Collect the full response as a string */
  send(request: AIRequest): Promise<string>;
  /** Register a plugin interceptor. Returns a disposable. */
  addInterceptor(interceptor: RequestInterceptor): vscode.Disposable;
  /** Check if any Gemma 4 model variant is installed in Ollama */
  isGemma4Available(): Promise<{ installed: boolean; variants: string[] }>;
  /** Check if any local GLM/CodeGeeX model is installed in Ollama */
  isGlmAvailable(): Promise<{ installed: boolean; variants: string[] }>;
  /** Store a credential in SecretStorage */
  storeSecret(key: string, value: string): Promise<void>;
  /** Retrieve a credential from SecretStorage */
  getSecret(key: string): Promise<string | undefined>;
}

// ── Context service ───────────────────────────────────────────────────────────

export interface IContextService {
  /** Assemble the full project context */
  build(options?: BuildContextOptions): Promise<ProjectContext>;
  /** Build the system prompt (base + plugin sections) */
  buildSystemPrompt(ctx: ProjectContext): string;
  /** Build the user prompt (file + errors + git + plugin data + instruction) */
  buildUserPrompt(ctx: ProjectContext, instruction: string): string;
}

// ── Workspace service ─────────────────────────────────────────────────────────

export interface IWorkspaceService {
  /** Replace active file content via WorkspaceEdit (undoable) */
  applyToActiveFile(newContent: string): Promise<void>;
  /** Write a file and optionally open it */
  writeFile(filePath: string, content: string, openAfter?: boolean): Promise<vscode.Uri>;
  /** Parse AI output that contains multiple files */
  parseMultiFileOutput(aiOutput: string, baseDir: string): GeneratedFile[];
  /** Write and open a set of generated files (with confirmation modal) */
  applyGeneratedFiles(files: GeneratedFile[]): Promise<void>;
  /** Show transform picker and apply to a folder */
  applyToFolder(folderPath: string): Promise<void>;
  /** Return the shell command to run a file of a given language */
  getRuntimeCommand(filePath: string, lang: string): string | null;
  /** Show a diff between original and proposed content, return user decision */
  showDiff(original: string, proposed: string, title: string): Promise<'apply' | 'cancel'>;
}
