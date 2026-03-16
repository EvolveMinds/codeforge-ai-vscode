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

export interface IAIService {
  /** Detect which provider is currently configured */
  detectProvider(): Promise<ProviderName>;
  /** Check if Ollama is running on the configured host */
  isOllamaRunning(host?: string): Promise<boolean>;
  /** List models installed in Ollama */
  getOllamaModels(host?: string): Promise<string[]>;
  /** Stream a response, chunk by chunk */
  stream(request: AIRequest): AsyncGenerator<string>;
  /** Collect the full response as a string */
  send(request: AIRequest): Promise<string>;
  /** Register a plugin interceptor. Returns a disposable. */
  addInterceptor(interceptor: RequestInterceptor): vscode.Disposable;
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
