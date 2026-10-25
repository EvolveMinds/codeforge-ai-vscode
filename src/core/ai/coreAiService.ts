/**
 * src/core/ai/coreAiService.ts
 *
 * Platform-Agnostic Core AI Engine for Evolve AI.
 * Free of VS Code dependencies — runnable inside Electron Desktop main process,
 * VS Code Extension, Headless CLI, and automated benchmark harnesses.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export type CoreProviderName = 'auto' | 'ollama' | 'gemma4' | 'glm' | 'colibri' | 'anthropic' | 'openai' | 'gemini' | 'zai' | 'huggingface' | 'offline';

export interface CoreMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
}

export interface CoreAIRequest {
  messages: CoreMessage[];
  system?: string;
  instruction?: string;
  mode?: string;
  signal?: AbortSignal;
  providerOverride?: CoreProviderName;
  modelOverride?: string;
  maxOutputTokens?: number;
  contextTokens?: number;
  temperature?: number;
}

export interface ISecretVault {
  getSecret(key: string): Promise<string | null | undefined> | string | null | undefined;
  storeSecret(key: string, value: string): Promise<void> | void;
  deleteSecret?(key: string): Promise<boolean> | boolean;
}

export interface IConfigProvider {
  get<T>(key: string, defaultValue?: T): T;
  set?<T>(key: string, value: T): Promise<void>;
}

export class MemoryVault implements ISecretVault {
  private _secrets = new Map<string, string>();
  getSecret(key: string): string | undefined {
    return this._secrets.get(key) || process.env[key] || process.env[key.toUpperCase().replace(/\./g, '_')];
  }
  storeSecret(key: string, value: string): void {
    this._secrets.set(key, value);
  }
}

export class MemoryConfigProvider implements IConfigProvider {
  private _cfg = new Map<string, any>();
  get<T>(key: string, defaultValue?: T): T {
    return this._cfg.has(key) ? this._cfg.get(key) : (defaultValue as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this._cfg.set(key, value);
  }
}

export class CoreAIService {
  constructor(
    private readonly _vault: ISecretVault = new MemoryVault(),
    private readonly _config: IConfigProvider = new MemoryConfigProvider()
  ) {}

  public async isOllamaRunning(host = 'http://127.0.0.1:11434'): Promise<boolean> {
    try {
      const parsed = new URL(host);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      return await new Promise<boolean>((resolve) => {
        const req = client.request({
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: '/api/tags',
          method: 'GET',
          timeout: 1500
        }, (res) => {
          resolve((res.statusCode || 500) < 400);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });
    } catch {
      return false;
    }
  }

  public async getOllamaModels(host = 'http://127.0.0.1:11434'): Promise<string[]> {
    try {
      const parsed = new URL(host);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      return await new Promise<string[]>((resolve) => {
        const req = client.request({
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: '/api/tags',
          method: 'GET',
          timeout: 2500
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const names = Array.isArray(json.models) ? json.models.map((m: any) => m.name) : [];
              resolve(names);
            } catch {
              resolve([]);
            }
          });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
        req.end();
      });
    } catch {
      return [];
    }
  }

  public async complete(req: CoreAIRequest): Promise<string> {
    let full = '';
    for await (const chunk of this.stream(req)) {
      full += chunk;
    }
    return full;
  }

  public async* stream(req: CoreAIRequest): AsyncGenerator<string> {
    const provider = req.providerOverride || this._config.get<CoreProviderName>('ai.provider', 'auto');
    const resolvedProvider = await this._resolveProvider(provider);

    switch (resolvedProvider) {
      case 'ollama':
      case 'gemma4':
      case 'glm':
        yield* this._streamOllama(req);
        break;
      case 'anthropic':
        yield* this._streamAnthropic(req);
        break;
      case 'openai':
        yield* this._streamOpenAI(req);
        break;
      case 'gemini':
        yield* this._streamGemini(req);
        break;
      case 'offline':
      default:
        yield* this._streamOffline(req);
        break;
    }
  }

  private async _resolveProvider(pref: CoreProviderName): Promise<CoreProviderName> {
    if (pref !== 'auto') return pref;
    if (await this.isOllamaRunning()) return 'ollama';
    const anthropicKey = await this._vault.getSecret('aiForge.anthropicKey');
    if (anthropicKey) return 'anthropic';
    const openaiKey = await this._vault.getSecret('aiForge.openaiKey');
    if (openaiKey) return 'openai';
    const geminiKey = await this._vault.getSecret('aiForge.geminiKey');
    if (geminiKey) return 'gemini';
    return 'offline';
  }

  private async* _streamOllama(req: CoreAIRequest): AsyncGenerator<string> {
    const host = this._config.get<string>('ai.ollamaHost', 'http://127.0.0.1:11434');
    const model = req.modelOverride || this._config.get<string>('ai.ollamaModel', 'qwen2.5-coder:7b');
    const numCtx = req.contextTokens || this._config.get<number>('ai.contextTokens', 4096);

    const promptMessages = [...req.messages];
    if (req.system) {
      promptMessages.unshift({ role: 'system', content: req.system });
    }
    if (req.instruction) {
      promptMessages.push({ role: 'user', content: req.instruction });
    }

    const payload = JSON.stringify({
      model,
      messages: promptMessages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        num_ctx: numCtx,
        temperature: req.temperature ?? 0.2
      }
    });

    const parsed = new URL(`${host}/api/chat`);
    yield* this._httpStreamNdJson(parsed, payload, req.signal, (obj) => obj.message?.content);
  }

  private async* _streamAnthropic(req: CoreAIRequest): AsyncGenerator<string> {
    const key = await this._vault.getSecret('aiForge.anthropicKey');
    if (!key) {
      yield* this._streamOffline(req);
      return;
    }

    const model = req.modelOverride || this._config.get<string>('ai.anthropicModel', 'claude-3-7-sonnet-20250219');
    const messages = req.messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role,
      content: m.content
    }));

    if (req.instruction) {
      messages.push({ role: 'user', content: req.instruction });
    }

    const payload = JSON.stringify({
      model,
      max_tokens: req.maxOutputTokens || 4096,
      system: req.system || '',
      messages,
      stream: true
    });

    const parsed = new URL('https://api.anthropic.com/v1/messages');
    const headers = {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    };

    yield* this._httpStreamSse(parsed, payload, headers, req.signal, (event) => {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        return event.delta.text;
      }
      return null;
    });
  }

  private async* _streamOpenAI(req: CoreAIRequest): AsyncGenerator<string> {
    const key = await this._vault.getSecret('aiForge.openaiKey');
    if (!key) {
      yield* this._streamOffline(req);
      return;
    }

    const model = req.modelOverride || this._config.get<string>('ai.openaiModel', 'gpt-4o');
    const messages: any[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });
    if (req.instruction) messages.push({ role: 'user', content: req.instruction });

    const payload = JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: req.maxOutputTokens || 4096
    });

    const parsed = new URL('https://api.openai.com/v1/chat/completions');
    const headers = {
      'authorization': `Bearer ${key}`,
      'content-type': 'application/json'
    };

    yield* this._httpStreamSse(parsed, payload, headers, req.signal, (event) => {
      return event.choices?.[0]?.delta?.content || null;
    });
  }

  private async* _streamGemini(req: CoreAIRequest): AsyncGenerator<string> {
    const key = await this._vault.getSecret('aiForge.geminiKey');
    if (!key) {
      yield* this._streamOffline(req);
      return;
    }

    const model = req.modelOverride || this._config.get<string>('ai.geminiModel', 'gemini-2.0-flash');
    const contents: any[] = [];
    for (const m of req.messages) {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    }
    if (req.instruction) {
      contents.push({ role: 'user', parts: [{ text: req.instruction }] });
    }

    const payload = JSON.stringify({ contents });
    const parsed = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${key}&alt=sse`);
    const headers = { 'content-type': 'application/json' };

    yield* this._httpStreamSse(parsed, payload, headers, req.signal, (event) => {
      return event.candidates?.[0]?.content?.parts?.[0]?.text || null;
    });
  }

  private async* _streamOffline(req: CoreAIRequest): AsyncGenerator<string> {
    yield `[Evolve AI Offline Rule Engine] Task acknowledged: "${req.instruction || req.messages[req.messages.length - 1]?.content || 'Execution'}".\nOperating in 100% deterministic offline air-gapped mode.`;
  }

  // ── HTTP Stream Utilities ────────────────────────────────────────────────

  private async* _httpStreamNdJson(
    url: URL,
    body: string,
    signal?: AbortSignal,
    extractor?: (item: any) => string | null | undefined
  ): AsyncGenerator<string> {
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const streamQueue: string[] = [];
    let isDone = false;
    let streamErr: Error | null = null;
    let wakeResolver: (() => void) | null = null;

    const wake = () => {
      if (wakeResolver) {
        const r = wakeResolver;
        wakeResolver = null;
        r();
      }
    };

    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      if ((res.statusCode || 500) >= 400) {
        streamErr = new Error(`HTTP Error ${res.statusCode}: ${res.statusMessage}`);
        isDone = true;
        wake();
        return;
      }

      let lineBuf = '';
      res.on('data', chunk => {
        lineBuf += chunk.toString('utf8');
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const text = extractor ? extractor(parsed) : parsed.response;
            if (text) {
              streamQueue.push(text);
              wake();
            }
          } catch {}
        }
      });

      res.on('end', () => {
        isDone = true;
        wake();
      });

      res.on('error', (err) => {
        streamErr = err;
        isDone = true;
        wake();
      });
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy(new Error('Request aborted by user'));
      });
    }

    req.on('error', (err) => {
      streamErr = err;
      isDone = true;
      wake();
    });

    req.write(body);
    req.end();

    while (!isDone || streamQueue.length > 0) {
      if (streamQueue.length > 0) {
        yield streamQueue.shift()!;
      } else if (!isDone) {
        await new Promise<void>(resolve => { wakeResolver = resolve; });
      }
    }

    if (streamErr) throw streamErr;
  }

  private async* _httpStreamSse(
    url: URL,
    body: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    extractor?: (item: any) => string | null | undefined
  ): AsyncGenerator<string> {
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const streamQueue: string[] = [];
    let isDone = false;
    let streamErr: Error | null = null;
    let wakeResolver: (() => void) | null = null;

    const wake = () => {
      if (wakeResolver) {
        const r = wakeResolver;
        wakeResolver = null;
        r();
      }
    };

    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        ...headers,
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      if ((res.statusCode || 500) >= 400) {
        streamErr = new Error(`HTTP Error ${res.statusCode}: ${res.statusMessage}`);
        isDone = true;
        wake();
        return;
      }

      let sseBuf = '';
      res.on('data', chunk => {
        sseBuf += chunk.toString('utf8');
        const lines = sseBuf.split('\n');
        sseBuf = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6).trim();
            if (jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const text = extractor ? extractor(parsed) : null;
              if (text) {
                streamQueue.push(text);
                wake();
              }
            } catch {}
          }
        }
      });

      res.on('end', () => {
        isDone = true;
        wake();
      });

      res.on('error', (err) => {
        streamErr = err;
        isDone = true;
        wake();
      });
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy(new Error('Request aborted by user'));
      });
    }

    req.on('error', (err) => {
      streamErr = err;
      isDone = true;
      wake();
    });

    req.write(body);
    req.end();

    while (!isDone || streamQueue.length > 0) {
      if (streamQueue.length > 0) {
        yield streamQueue.shift()!;
      } else if (!isDone) {
        await new Promise<void>(resolve => { wakeResolver = resolve; });
      }
    }

    if (streamErr) throw streamErr;
  }
}
