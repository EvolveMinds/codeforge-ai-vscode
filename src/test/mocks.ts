/**
 * test/mocks.ts — Lightweight mocks for IServices and its dependencies
 *
 * These mocks implement the same interfaces as the real services so tests
 * can run without VS Code APIs or network access.
 */

import type { IAIService }       from '../core/interfaces';
import type { IContextService }  from '../core/interfaces';
import type { IWorkspaceService } from '../core/interfaces';
import type { ProviderName, AIRequest, RequestInterceptor } from '../core/aiService';
import type { ProjectContext, BuildContextOptions }         from '../core/contextService';
import type { GeneratedFile }    from '../core/workspaceService';
import type { EventName, EventPayload } from '../core/eventBus';

// ── Mock AI Service ──────────────────────────────────────────────────────────

export class MockAIService implements IAIService {
  /** Canned response returned by send() and stream() */
  public response = 'mock AI response';
  public lastRequest: AIRequest | null = null;

  async detectProvider(): Promise<ProviderName> { return 'offline'; }
  async isOllamaRunning(): Promise<boolean> { return false; }
  async getOllamaModels(): Promise<string[]> { return []; }

  async *stream(request: AIRequest): AsyncGenerator<string> {
    this.lastRequest = request;
    yield this.response;
  }

  async send(request: AIRequest): Promise<string> {
    this.lastRequest = request;
    return this.response;
  }

  addInterceptor(_interceptor: RequestInterceptor): { dispose(): void } {
    return { dispose() {} };
  }

  async storeSecret(_key: string, _value: string): Promise<void> {}
  async getSecret(_key: string): Promise<string | undefined> { return undefined; }
}

// ── Mock Context Service ─────────────────────────────────────────────────────

export function emptyContext(): ProjectContext {
  return {
    activeFile:    null,
    selection:     null,
    errors:        [],
    gitDiff:       null,
    gitBranch:     null,
    relatedFiles:  [],
    workspaceName: 'test-workspace',
    language:      'typescript',
    pluginData:    new Map(),
    contextBudget: { total: 24_000, used: 0 },
  };
}

export class MockContextService implements IContextService {
  public context: ProjectContext = emptyContext();

  async build(_options?: BuildContextOptions): Promise<ProjectContext> {
    return this.context;
  }

  buildSystemPrompt(_ctx: ProjectContext): string {
    return 'You are a test assistant.';
  }

  buildUserPrompt(_ctx: ProjectContext, instruction: string): string {
    return instruction;
  }
}

// ── Mock Workspace Service ───────────────────────────────────────────────────

// ── Mock Event Bus ────────────────────────────────────────────────────────────

type AnyHandler = (payload: unknown) => void;

export class MockEventBus {
  private _listeners = new Map<string, AnyHandler[]>();
  public emitted: Array<{ event: string; payload: unknown }> = [];

  on<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): { dispose(): void } {
    const list = this._listeners.get(event) ?? [];
    list.push(handler as AnyHandler);
    this._listeners.set(event, list);
    return {
      dispose: () => {
        const current = this._listeners.get(event) ?? [];
        this._listeners.set(event, current.filter(h => h !== (handler as AnyHandler)));
      },
    };
  }

  emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    this.emitted.push({ event, payload });
    const list = this._listeners.get(event) ?? [];
    for (const h of list) h(payload);
  }

  dispose(): void {
    this._listeners.clear();
  }
}

// ── Mock Workspace Service ───────────────────────────────────────────────────

export class MockWorkspaceService implements IWorkspaceService {
  public appliedContent: string | null = null;
  public writtenFiles: Array<{ path: string; content: string }> = [];

  async applyToActiveFile(newContent: string): Promise<void> {
    this.appliedContent = newContent;
  }

  async writeFile(filePath: string, content: string): Promise<any> {
    this.writtenFiles.push({ path: filePath, content });
    return { fsPath: filePath } as any;
  }

  parseMultiFileOutput(aiOutput: string, _baseDir: string): GeneratedFile[] {
    return [{ path: 'generated.txt', content: aiOutput }];
  }

  async applyGeneratedFiles(_files: GeneratedFile[]): Promise<void> {}
  async applyToFolder(_folderPath: string): Promise<void> {}
  getRuntimeCommand(_filePath: string, _lang: string): string | null { return null; }
  async showDiff(_original: string, _proposed: string, _title: string): Promise<'apply' | 'cancel'> {
    return 'apply';
  }
}
