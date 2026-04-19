/**
 * core/aiService.ts — AI provider abstraction
 *
 * FIXES APPLIED:
 *  [FIX-4]  API keys stored in vscode.SecretStorage — never in settings.json
 *  [FIX-5]  AI requests are cancellable via AbortSignal in AIRequest
 *           Users can cancel mid-stream; withProgress cancel button works
 *  [FIX-10] Implements IAIService interface — concrete class hidden behind contract
 */

import * as vscode from 'vscode';
import * as http   from 'http';
import * as https  from 'https';
import { safeUpdateConfig, readHostSetting, warnIfRemoteHost } from './configSafe';
import type { EventBus }   from './eventBus';
import type { IAIService } from './interfaces';

export type ProviderName = 'auto' | 'ollama' | 'gemma4' | 'anthropic' | 'openai' | 'huggingface' | 'offline';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Base64-encoded images for vision-capable models (Gemma 4 via Ollama) */
  images?: string[];
}

export interface AIRequest {
  messages:     Message[];
  system:       string;
  instruction:  string;
  mode:         string;
  /** [FIX-5] Optional: caller provides signal to cancel mid-stream */
  signal?:      AbortSignal;
}

export interface RequestInterceptor {
  intercept(req: AIRequest): AIRequest;
}

// Secret storage keys
const SECRET_ANTHROPIC    = 'aiForge.anthropicKey';
const SECRET_OPENAI       = 'aiForge.openaiKey';
const SECRET_HUGGINGFACE  = 'aiForge.huggingfaceKey';

// ── AIService ─────────────────────────────────────────────────────────────────

export class AIService implements IAIService {
  private _interceptors: RequestInterceptor[] = [];
  // [SEC-5] Concurrent request guard — prevents accidental cost spikes
  private _activeStreams = 0;
  private static readonly MAX_CONCURRENT_STREAMS = 3;

  constructor(
    private readonly _bus:     EventBus,
    private readonly _secrets: vscode.SecretStorage   // [FIX-4]
  ) {}

  // ── [FIX-4] Secret storage ───────────────────────────────────────────────────

  async storeSecret(key: string, value: string): Promise<void> {
    await this._secrets.store(key, value);
  }

  async getSecret(key: string): Promise<string | undefined> {
    return this._secrets.get(key);
  }

  // ── Interceptors ────────────────────────────────────────────────────────────

  addInterceptor(interceptor: RequestInterceptor): vscode.Disposable {
    this._interceptors.push(interceptor);
    return { dispose: () => {
      this._interceptors = this._interceptors.filter(i => i !== interceptor);
    }};
  }

  // ── Provider detection ───────────────────────────────────────────────────────

  async detectProvider(): Promise<ProviderName> {
    const cfg  = this._cfg();
    const pref = cfg.get<ProviderName>('provider', 'auto');
    if (pref !== 'auto') return pref;
    if (await this.isOllamaRunning()) {
      // Prefer Gemma 4 in auto mode if explicitly configured and installed
      const gemma4Explicit = cfg.inspect<string>('gemma4Model')?.globalValue;
      if (gemma4Explicit) {
        const { installed } = await this.isGemma4Available();
        if (installed) return 'gemma4';
      }
      return 'ollama';
    }
    return 'offline';
  }

  // [FIX-23] On Windows, 'localhost' may resolve to IPv6 ::1 while Ollama listens on IPv4.
  // This helper resolves the working host URL once, caching the result.
  private _resolvedOllamaHost: string | null = null;

  private async _resolveOllamaHost(host: string): Promise<string> {
    const url = new URL(host);
    if (url.hostname !== 'localhost') return host;
    if (this._resolvedOllamaHost) return this._resolvedOllamaHost;

    // Try localhost first, then 127.0.0.1
    for (const candidate of [host, host.replace('localhost', '127.0.0.1')]) {
      if (await this._pingUrl(candidate)) {
        this._resolvedOllamaHost = candidate;
        return candidate;
      }
    }
    this._resolvedOllamaHost = null;
    return host;
  }

  private _pingUrl(baseUrl: string): Promise<boolean> {
    const url = new URL(baseUrl);
    // [SEC-4] Only allow http/https schemes
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.resolve(false);
    return new Promise(resolve => {
      // Use an explicit connection timeout via setTimeout
      let settled = false;
      const done = (val: boolean) => { if (!settled) { settled = true; resolve(val); } };
      const timer = setTimeout(() => { req.destroy(); done(false); }, 4000);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url.href, (res) => {
        clearTimeout(timer);
        res.resume(); // drain the response
        done(true);
      });
      req.on('error', () => { clearTimeout(timer); done(false); });
    });
  }

  async isOllamaRunning(host?: string): Promise<boolean> {
    const h = host ?? readHostSetting('aiForge', 'ollamaHost', 'http://localhost:11434');
    const resolved = await this._resolveOllamaHost(h);
    const result = await this._pingUrl(resolved);
    console.log(`[Evolve AI] isOllamaRunning: host=${h}, resolved=${resolved}, result=${result}`);
    return result;
  }

  async getOllamaModels(host?: string): Promise<string[]> {
    const h   = host ?? readHostSetting('aiForge', 'ollamaHost', 'http://localhost:11434');
    const resolved = await this._resolveOllamaHost(h);
    return new Promise(resolve => {
      const req = http.request(
        resolved + '/api/tags',
        { method: 'GET', timeout: 3000 },
        res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve((JSON.parse(data).models || []).map((m: { name: string }) => m.name)); }
            catch { resolve([]); }
          });
        }
      );
      req.on('error', () => resolve([]));
      req.end();
    });
  }

  async isGemma4Available(): Promise<{ installed: boolean; variants: string[] }> {
    const models = await this.getOllamaModels();
    const variants = models.filter(m => m.startsWith('gemma4'));
    return { installed: variants.length > 0, variants };
  }

  // ── Core streaming ───────────────────────────────────────────────────────────

  async* stream(request: AIRequest): AsyncGenerator<string> {
    // [SEC-5] Reject if too many concurrent streams
    if (this._activeStreams >= AIService.MAX_CONCURRENT_STREAMS) {
      yield '⚠ Evolve AI: Too many concurrent requests. Please wait for the current request to finish.';
      return;
    }
    this._activeStreams++;

    let req = request;
    for (const i of this._interceptors) req = i.intercept(req);

    this._bus.emit('ai.request.start', { instruction: req.instruction, mode: req.mode });

    try {
      const provider = await this.detectProvider();
      const cfg      = this._cfg();

      if (provider === 'ollama')         { yield* this._streamOllama(req, cfg);       }
      else if (provider === 'gemma4')     { yield* this._streamGemma4(req, cfg);     }
      else if (provider === 'anthropic')  { yield* this._streamAnthropic(req, cfg);  }
      else if (provider === 'openai')     { yield* this._streamOpenAI(req, cfg);     }
      else if (provider === 'huggingface'){ yield* this._streamHuggingFace(req, cfg);}
      else                                { yield* this._offline(req);                }

      this._bus.emit('ai.request.done', { instruction: req.instruction });
    } catch (e) {
      const msg = String(e);
      this._bus.emit('ai.request.error', { instruction: req.instruction, error: msg });
      yield `\n\n⚠ Evolve AI error: ${msg}`;
    } finally {
      this._activeStreams--;
    }
  }

  async send(request: AIRequest): Promise<string> {
    let result = '';
    for await (const chunk of this.stream(request)) result += chunk;
    return result;
  }

  // ── Providers ────────────────────────────────────────────────────────────────

  private async* _streamOllama(req: AIRequest, cfg: vscode.WorkspaceConfiguration): AsyncGenerator<string> {
    const host  = readHostSetting('aiForge', 'ollamaHost', 'http://localhost:11434');
    warnIfRemoteHost('aiForge.ollamaHost', host);
    const resolved = await this._resolveOllamaHost(host);
    const model = cfg.get<string>('ollamaModel', 'qwen2.5-coder:7b');

    // Pre-check: verify the model exists before streaming
    const available = await this._getOllamaModels(resolved);
    if (available !== null && !available.some(m => m === model || m.startsWith(model + ':'))) {
      if (available.length > 0) {
        // Auto-fallback: pick the first installed model and update the setting
        const fallback = available[0];
        await vscode.workspace.getConfiguration('aiForge').update('ollamaModel', fallback, vscode.ConfigurationTarget.Global);
        yield `ℹ️ Model **${model}** not found — automatically switched to **${fallback}**.\n\n`;
        yield* this._streamOllamaWithModel(req, resolved, fallback);
        return;
      }

      // No models installed at all — offer to pull the configured one
      const pick = await vscode.window.showWarningMessage(
        `No Ollama models installed. Install "${model}"?`,
        'Install Model Now', 'Open Settings'
      );

      if (pick === 'Install Model Now') {
        const term = vscode.window.createTerminal('Evolve AI: Ollama Pull');
        term.show();
        term.sendText(`ollama pull ${model}`);
        yield `⏳ Installing model **${model}**...\n\n`;
        yield `A terminal has been opened to download the model. Once it finishes, try your request again.\n`;
        return;
      } else if (pick === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.ollamaModel');
        yield `⚠ Update the **aiForge.ollamaModel** setting to a model you have installed, then try again.\n`;
        return;
      }

      yield `⚠ No Ollama models installed. Run \`ollama pull <model>\` to get started.\n`;
      return;
    }

    yield* this._streamOllamaWithModel(req, resolved, model);
  }

  private async* _streamOllamaWithModel(req: AIRequest, resolvedHost: string, model: string): AsyncGenerator<string> {
    const url   = new URL(resolvedHost + '/api/chat');
    // Preserve images in messages for vision-capable models
    const msgs = [{ role: 'system' as const, content: req.system }, ...req.messages].map(m => {
      const entry: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.images?.length) { entry.images = m.images; }
      return entry;
    });
    const body  = JSON.stringify({
      model, stream: true,
      messages: msgs,
      options: { temperature: 0.2, num_predict: 4096 },
    });
    yield* this._httpStream(url, body,
      c => { try { return JSON.parse(c).message?.content || ''; } catch { return ''; } },
      {}, req.signal
    );
  }

  private async* _streamGemma4(req: AIRequest, cfg: vscode.WorkspaceConfiguration): AsyncGenerator<string> {
    const host     = readHostSetting('aiForge', 'ollamaHost', 'http://localhost:11434');
    warnIfRemoteHost('aiForge.ollamaHost', host);
    const resolved = await this._resolveOllamaHost(host);
    const model    = cfg.get<string>('gemma4Model', 'gemma4:e4b');

    // Pre-check: verify the Gemma 4 variant is installed
    const available = await this._getOllamaModels(resolved);
    if (available !== null && !available.some(m => m === model || m.startsWith(model + ':'))) {
      // Check if any gemma4 variant is installed
      const anyGemma4 = available.filter(m => m.startsWith('gemma4'));
      if (anyGemma4.length > 0) {
        const fallback = anyGemma4[0];
        // Mid-stream: never interrupt with a reload prompt. If the registry
        // race bites us, safeUpdateConfig silently returns ok:false and we
        // proceed with the in-memory fallback.
        await safeUpdateConfig('aiForge', 'gemma4Model', fallback);
        yield `\u2139\uFE0F Model **${model}** not found \u2014 switched to **${fallback}**.\n\n`;
        yield* this._streamOllamaWithModel(req, resolved, fallback);
        return;
      }

      // No Gemma 4 model installed at all
      const pick = await vscode.window.showWarningMessage(
        `Gemma 4 model "${model}" is not downloaded yet. Install it now?`,
        'Download Now', 'Choose Different Variant', 'Open Settings'
      );

      if (pick === 'Download Now') {
        const term = vscode.window.createTerminal('Evolve AI: Gemma 4 Setup');
        term.show();
        term.sendText(`ollama pull ${model}`);
        yield `\u23F3 Downloading **${model}**...\n\n`;
        yield `A terminal has been opened to download Gemma 4. Once it finishes, try your request again.\n`;
        return;
      } else if (pick === 'Choose Different Variant') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.gemma4Model');
        yield `\u2699\uFE0F Select a Gemma 4 variant in Settings, then try again.\n`;
        return;
      } else if (pick === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'aiForge.gemma4Model');
        yield `\u2699\uFE0F Update the **aiForge.gemma4Model** setting, then try again.\n`;
        return;
      }

      yield `\u26A0 Gemma 4 model not installed. Run \`ollama pull ${model}\` to get started.\n`;
      return;
    }

    // Build Gemma 4 request with optional thinking mode + vision support
    const thinking = cfg.get<boolean>('gemma4ThinkingMode', false);
    const url   = new URL(resolved + '/api/chat');
    const msgs = [{ role: 'system' as const, content: req.system }, ...req.messages].map(m => {
      const entry: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.images?.length) { entry.images = m.images; }
      return entry;
    });
    const payload: Record<string, unknown> = {
      model, stream: true,
      messages: msgs,
      options: { temperature: 0.2, num_predict: 8192 },
    };
    // Only set think: true — never set think: false (Ollama bug: breaks format param)
    if (thinking) { payload.think = true; }
    // Structured output for edit mode — ask for JSON with file content
    if (req.mode === 'edit' && !thinking) {
      payload.format = {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The complete new file content with the requested changes applied' },
          explanation: { type: 'string', description: 'Brief explanation of what was changed' },
        },
        required: ['content'],
      };
    }
    const body = JSON.stringify(payload);
    yield* this._httpStream(url, body,
      c => { try { return JSON.parse(c).message?.content || ''; } catch { return ''; } },
      {}, req.signal
    );
  }

  /** Fetch list of installed Ollama model names, or null on failure */
  private async _getOllamaModels(resolvedHost: string): Promise<string[] | null> {
    try {
      const url = new URL(resolvedHost + '/api/tags');
      const lib = url.protocol === 'https:' ? https : http;
      return await new Promise<string[] | null>((resolve) => {
        const req = lib.get(url, res => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              const models = (parsed.models || []).map((m: { name: string }) => m.name);
              resolve(models);
            } catch { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
      });
    } catch { return null; }
  }

  private async* _streamAnthropic(req: AIRequest, cfg: vscode.WorkspaceConfiguration): AsyncGenerator<string> {
    // [FIX-4] Read from SecretStorage only — never fall back to settings.json
    const key = await this._secrets.get(SECRET_ANTHROPIC) ?? '';
    if (!key) {
      yield `⚠ **No Anthropic API key configured**\n\n`;
      yield `To use Claude:\n`;
      yield `1. Get an API key at https://console.anthropic.com/\n`;
      yield `2. Click **Switch** in the header above, select **Anthropic**, and paste your key\n\n`;
      yield `Your key is stored securely in VS Code's encrypted storage — never in plaintext.\n`;
      return;
    }
    const url  = new URL('https://api.anthropic.com/v1/messages');
    const body = JSON.stringify({
      model: cfg.get<string>('anthropicModel', 'claude-sonnet-4-6'), max_tokens: 4096, stream: true,
      system:   req.system,
      messages: req.messages.filter(m => m.role !== 'system'),
    });
    yield* this._httpStream(url, body,
      c => {
        if (!c.startsWith('data:')) return '';
        try { return JSON.parse(c.slice(5).trim()).delta?.text || ''; } catch { return ''; }
      },
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      req.signal
    );
  }

  private async* _streamOpenAI(req: AIRequest, cfg: vscode.WorkspaceConfiguration): AsyncGenerator<string> {
    // [FIX-4] Read from SecretStorage only — never fall back to settings.json
    const key     = await this._secrets.get(SECRET_OPENAI) ?? '';
    const baseUrl = readHostSetting('aiForge', 'openaiBaseUrl', 'https://api.openai.com/v1');
    const model   = cfg.get<string>('openaiModel', 'gpt-4o');
    if (!key) {
      yield `⚠ **No OpenAI API key configured**\n\n`;
      yield `To use OpenAI (or compatible providers like Groq, Mistral, Together AI):\n`;
      yield `1. Get an API key at https://platform.openai.com/api-keys\n`;
      yield `2. Click **Switch** in the header above, select **OpenAI**, and paste your key\n`;
      yield `3. For non-OpenAI providers, also set \`aiForge.openaiBaseUrl\` in Settings\n\n`;
      yield `Your key is stored securely in VS Code's encrypted storage — never in plaintext.\n`;
      return;
    }
    const url  = new URL(baseUrl + '/chat/completions');
    const body = JSON.stringify({
      model, stream: true, temperature: 0.2, max_tokens: 4096,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    });
    yield* this._httpStream(url, body,
      c => {
        if (!c.startsWith('data:') || c.includes('[DONE]')) return '';
        try { return JSON.parse(c.slice(5).trim()).choices?.[0]?.delta?.content || ''; } catch { return ''; }
      },
      { Authorization: `Bearer ${key}` },
      req.signal
    );
  }

  private async* _streamHuggingFace(req: AIRequest, cfg: vscode.WorkspaceConfiguration): AsyncGenerator<string> {
    const key   = await this._secrets.get(SECRET_HUGGINGFACE) ?? '';
    const model = cfg.get<string>('huggingfaceModel', 'Qwen/Qwen2.5-Coder-32B-Instruct');
    const base  = readHostSetting('aiForge', 'huggingfaceBaseUrl', 'https://api-inference.huggingface.co');
    if (!key) {
      yield `⚠ **No Hugging Face token configured**\n\n`;
      yield `To use HuggingFace Inference API:\n`;
      yield `1. Get a token at https://huggingface.co/settings/tokens\n`;
      yield `2. Click **Switch** in the header above, select **HuggingFace**, and paste your token\n\n`;
      yield `Current model: \`${model}\`. Change it in Settings if needed.\n`;
      yield `Your token is stored securely in VS Code's encrypted storage — never in plaintext.\n`;
      return;
    }
    const url  = new URL(`${base}/models/${model}/v1/chat/completions`);
    const body = JSON.stringify({
      model, stream: true, temperature: 0.2, max_tokens: 4096,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    });
    yield* this._httpStream(url, body,
      c => {
        if (!c.startsWith('data:') || c.includes('[DONE]')) return '';
        try { return JSON.parse(c.slice(5).trim()).choices?.[0]?.delta?.content || ''; } catch { return ''; }
      },
      { Authorization: `Bearer ${key}` },
      req.signal
    );
  }

  private async* _offline(req: AIRequest): AsyncGenerator<string> {
    const os = process.platform;
    const ollamaUrl = os === 'win32'  ? 'https://ollama.com/download/windows'
                    : os === 'darwin' ? 'https://ollama.com/download/mac'
                    :                   'https://ollama.com/download/linux';
    const installCmd = os === 'linux' ? '\n\nOr install via terminal:\n```\ncurl -fsSL https://ollama.ai/install.sh | sh\n```' : '';

    const low = req.instruction.toLowerCase();
    const taskHint = low.includes('explain') || low.includes('what') ? 'explain code'
                   : low.includes('test') ? 'generate tests'
                   : low.includes('fix')  ? 'fix errors'
                   : low.includes('refactor') ? 'refactor code'
                   : 'assist with this request';

    yield `⚠ **No AI provider connected** — Evolve AI needs an AI model to ${taskHint}.\n\n`;
    yield `### Quick Setup Options\n\n`;
    yield `**1. Gemma 4 (Free, Private, Local, Multimodal)**\n`;
    yield `Google's latest open model — text, image & audio. Runs locally via Ollama.\n`;
    yield `- Click **Switch** in the header and select **Gemma 4** for guided setup\n`;
    yield `- Or manually: Download Ollama from ${ollamaUrl}, then run: \`ollama pull gemma4:e4b\`\n\n`;
    yield `**2. Ollama (Free, Private, Local)**\n`;
    yield `Your code never leaves your machine.\n`;
    yield `- Download Ollama: ${ollamaUrl}${installCmd}\n`;
    yield `- Then run: \`ollama pull qwen2.5-coder:7b\`\n`;
    yield `- Evolve AI will detect it automatically\n\n`;
    yield `**3. Cloud AI (API key required)**\n`;
    yield `- **Anthropic Claude**: https://console.anthropic.com/\n`;
    yield `- **OpenAI**: https://platform.openai.com/api-keys\n`;
    yield `- **HuggingFace**: https://huggingface.co/settings/tokens\n\n`;
    yield `Click **Switch** in the header to configure any provider.\n`;

    if (os === 'win32') {
      yield `\n💡 **Windows tip:** If Ollama is installed but not detected, change \`aiForge.ollamaHost\` to \`http://127.0.0.1:11434\` in Settings.\n`;
    }
  }

  // ── HTTP streaming engine ────────────────────────────────────────────────────

  private async* _httpStream(
    url: URL,
    body: string,
    parseChunk: (raw: string) => string,
    extraHeaders: Record<string, string | number> = {},
    signal?: AbortSignal   // [FIX-5]
  ): AsyncGenerator<string> {
    // [FIX-5] Check for pre-cancelled request
    if (signal?.aborted) { yield '⚠ Request cancelled'; return; }

    const lib     = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...extraHeaders },
    };

    let done = false;
    const pending: string[]               = [];
    let   waiter:  ((v: void) => void) | null = null;
    const wake = () => { waiter?.(); };

    const req = lib.request(options, res => {
      if ((res.statusCode ?? 0) >= 400) {
        let err = '';
        res.on('data', d => err += d);
        res.on('end',  () => {
          const code = res.statusCode ?? 0;
          const host = url.hostname;
          let msg = '';

          if (code === 401 || code === 403) {
            msg = `⚠ **Authentication failed** (${code})\n\n`
              + `Your API key may be invalid or expired.\n`
              + `Run **Evolve AI: Switch AI Provider** to re-enter your credentials.\n`;
          } else if (code === 404) {
            const errLow = err.toLowerCase();
            if (errLow.includes('model') || errLow.includes('not found')) {
              msg = `⚠ **Model not found** (404)\n\n`
                + `The configured model does not exist on the server.\n`
                + `${err.slice(0, 200)}\n\n`
                + `Check your model name in Settings or click **Switch** to reconfigure.\n`;
            } else {
              msg = `⚠ **API endpoint not found** (404): ${err.slice(0, 200)}\n\n`
                + `Check that the server URL is correct in Settings.\n`;
            }
          } else if (code === 429) {
            msg = `⚠ **Rate limit exceeded** (429)\n\n`
              + `You've sent too many requests. Wait a moment and try again.\n`
              + `Consider using Ollama (free, no rate limits) for heavy usage.\n`;
          } else if (code === 500 || code === 502 || code === 503) {
            msg = `⚠ **Server error** (${code})\n\n`
              + `The AI provider is experiencing issues. Try again in a few moments.\n`
              + `If using Ollama, make sure the model finished loading.\n`;
          } else {
            msg = `⚠ **API error** (${code}): ${err.slice(0, 200)}\n`;
          }

          pending.push(msg);
          done = true;
          wake();
        });
        return;
      }
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (d: string) => {
        // [FIX-5] Stop processing if cancelled
        if (signal?.aborted) { res.destroy(); done = true; wake(); return; }
        buf += d;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const t = parseChunk(line);
          if (t) { pending.push(t); wake(); }
        }
      });
      res.on('end',   () => { if (buf.trim()) { const t = parseChunk(buf); if (t) pending.push(t); } done = true; wake(); });
      res.on('error', (e: Error) => { pending.push(`⚠ Stream error: ${e.message}`); done = true; wake(); });
    });

    req.on('error', (e: Error) => {
      const host = url.hostname;
      let msg = '';
      if (e.message.includes('ECONNREFUSED')) {
        if (host === 'localhost' || host === '127.0.0.1') {
          msg = `⚠ **Cannot connect to local server** at ${url.origin}\n\n`
            + `Make sure Ollama is running. `
            + (process.platform === 'win32'
              ? `Launch it from the Start menu, or try changing \`aiForge.ollamaHost\` to \`http://127.0.0.1:11434\`.\n`
              : `Run \`ollama serve\` in your terminal.\n`);
        } else {
          msg = `⚠ **Connection refused** by ${host}\n\nCheck the server URL and that the service is running.\n`;
        }
      } else if (e.message.includes('ENOTFOUND')) {
        msg = `⚠ **Server not found**: ${host}\n\nCheck your internet connection and the server URL in Settings.\n`;
      } else if (e.message.includes('ETIMEDOUT') || e.message.includes('ENETUNREACH')) {
        msg = `⚠ **Network unreachable** — cannot reach ${host}\n\nCheck your internet connection. For local AI, use Ollama (no internet required).\n`;
      } else {
        msg = `⚠ **Connection error**: ${e.message}\n`;
      }
      pending.push(msg);
      done = true;
      wake();
    });
    req.setTimeout(60000, () => {
      req.destroy();
      pending.push(`⚠ **Request timed out** after 60 seconds\n\n`
        + `The AI provider took too long to respond. This can happen with:\n`
        + `- Large models loading for the first time\n`
        + `- Slow network connections\n`
        + `- Overloaded servers\n\n`
        + `Try again, or use a smaller/faster model.\n`);
      done = true;
      wake();
    });

    // [FIX-5] Abort handler
    signal?.addEventListener('abort', () => { req.destroy(); pending.push(''); done = true; wake(); });

    req.write(body);
    req.end();

    while (!done || pending.length > 0) {
      if (pending.length === 0) await new Promise<void>(r => { waiter = r; });
      waiter = null;
      while (pending.length > 0) {
        const chunk = pending.shift()!;
        if (chunk) yield chunk;
      }
    }
  }

  private _cfg() { return vscode.workspace.getConfiguration('aiForge'); }
}

// Export constant keys so switchProvider command can use them
export { SECRET_ANTHROPIC, SECRET_OPENAI, SECRET_HUGGINGFACE };
