/**
 * commands/coreCommands.ts — All core commands
 *
 * FIXES APPLIED:
 *  [FIX-4]  switchProvider stores keys in SecretStorage via svc.ai.storeSecret()
 *  [FIX-5]  _editCommand creates an AbortController and links it to the
 *           Progress cancellation token — user can cancel mid-stream
 *  [FIX-6]  After AI edit, user sees "Apply / Show Diff / Cancel"
 *           showDiff() shows side-by-side before overwriting
 *  [FIX-14] Uses getActiveWorkspaceFolder() for multi-root support
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import type { IServices }                       from '../core/services';
import type { AIRequest }                       from '../core/aiService';
import { SECRET_ANTHROPIC, SECRET_OPENAI, SECRET_GEMINI, SECRET_ZAI, SECRET_HUGGINGFACE } from '../core/aiService';
import { getActiveWorkspaceFolder }             from '../core/contextService';

export class CoreCommands {
  constructor(private readonly _svc: IServices) {}

  register(): void {
    // [FIX-27] Wrap all command handlers with try/catch to prevent unhandled errors
    const r = (id: string, fn: (...a: unknown[]) => unknown) =>
      this._svc.vsCtx.subscriptions.push(vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await fn(...args);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[Evolve AI] Command ${id} failed:`, e);
          vscode.window.showErrorMessage(`Evolve AI: ${msg}`);
        }
      }));

    r('aiForge.openChat',          ()          => this.openChat());
    r('aiForge.explainSelection',  ()          => this.explainSelection());
    r('aiForge.refactorSelection', ()          => this.refactorSelection());
    r('aiForge.fixErrors',         ()          => this.fixErrors());
    r('aiForge.addDocstrings',     ()          => this.addDocstrings());
    r('aiForge.addTests',          ()          => this.addTests());
    r('aiForge.generateFromDesc',  ()          => this.generateFromDesc());
    r('aiForge.buildFramework',    ()          => this.buildFramework());
    r('aiForge.applyToFolder',     (u: unknown)=> this.applyToFolder(u as vscode.Uri | undefined));
    r('aiForge.gitCommitMessage',  ()          => this.gitCommitMessage());
    r('aiForge.gitExplainDiff',    ()          => this.gitExplainDiff());
    r('aiForge.gitPRDescription',  ()          => this.gitPRDescription());
    r('aiForge.runAndFix',         ()          => this.runAndFix());
    r('aiForge.switchProvider',    ()          => this.switchProvider());
    r('aiForge.setupOllama',       ()          => this.setupOllama());
    r('aiForge.gemma4Info',        ()          => this.gemma4Info());
    r('aiForge.whatsNew',          ()          => this.whatsNew());

    // CodeLens handlers
    r('aiForge.codelens.explain',  (u: unknown, rng: unknown) =>
      this.codelensExplain(u as vscode.Uri, rng as vscode.Range));
    r('aiForge.codelens.tests',    (u: unknown, rng: unknown) =>
      this.codelensTests(u as vscode.Uri, rng as vscode.Range));
    r('aiForge.codelens.refactor', (u: unknown, rng: unknown) =>
      this.codelensRefactor(u as vscode.Uri, rng as vscode.Range));
  }

  // ── Chat ─────────────────────────────────────────────────────────────────────

  openChat(): void {
    vscode.commands.executeCommand('aiForge.chatPanel.focus');
  }

  // ── Edit commands ─────────────────────────────────────────────────────────────

  async explainSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const code = editor.document.getText(editor.selection) || editor.document.getText();
    await vscode.commands.executeCommand('aiForge._sendToChat', `Explain this code:\n\n${code}`, 'chat');
  }

  async refactorSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('Open a file first'); return; }
    const sel = editor.document.getText(editor.selection);
    if (!sel) { vscode.window.showWarningMessage('Select code to refactor'); return; }
    await this._editCommand(`Refactor this code for clarity, best practices, and performance:\n\n${sel}`, 'edit');
  }

  async fixErrors(): Promise<void> {
    const ctx = await this._svc.context.build({ includeErrors: true });
    if (!ctx.errors.length) { vscode.window.showInformationMessage('Evolve AI: No errors found ✓'); return; }
    const list = ctx.errors.map(e => `- ${e.file}:${e.line} — ${e.message}`).join('\n');
    await this._editCommand(`Fix all these errors:\n${list}`, 'edit');
  }

  async addDocstrings(): Promise<void> {
    await this._editCommand(
      'Add comprehensive documentation comments to all functions, classes, and public methods.', 'edit'
    );
  }

  async addTests(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('Open a file first'); return; }
    const lang = editor.document.languageId;
    const name = path.basename(editor.document.fileName, path.extname(editor.document.fileName));
    const ext  = ({ python:'py', javascript:'js', typescript:'ts', go:'go', rust:'rs', java:'java' } as Record<string,string>)[lang] ?? 'ts';
    await this._editCommand(`Generate comprehensive unit tests. Name the test file ${name}.test.${ext}`, 'new');
  }

  // ── Generate / Build ──────────────────────────────────────────────────────────

  async generateFromDesc(): Promise<void> {
    const pluginTemplates = this._svc.plugins.templates;
    let instruction: string | undefined;

    if (pluginTemplates.length) {
      type Item = vscode.QuickPickItem & { template?: typeof pluginTemplates[number] };
      const items: Item[] = [
        { label: '$(edit) Describe what to build…', description: 'Free-form description' },
        ...pluginTemplates.map(t => ({ label: `$(extensions) ${t.label}`, description: t.description, template: t })),
      ];
      const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Generate or choose a template' });
      if (!choice) return;
      if (choice.template) {
        const ws    = getActiveWorkspaceFolder(); // [FIX-14]
        instruction = choice.template.prompt(ws?.uri.fsPath ?? '.');
      }
    }

    if (!instruction) {
      instruction = await vscode.window.showInputBox({
        prompt:      'Describe what to build',
        placeHolder: '"FastAPI app with JWT auth" or "React dashboard with recharts"',
        ignoreFocusOut: true,
      });
    }
    if (!instruction) return;
    await this._editCommand(instruction, 'new');
  }

  async buildFramework(): Promise<void> {
    const ws = getActiveWorkspaceFolder(); // [FIX-14]
    if (!ws) { vscode.window.showErrorMessage('Open a folder first'); return; }
    const input = await vscode.window.showInputBox({
      prompt:      'Describe the framework to build',
      placeHolder: '"FastAPI with auth, DB models, migrations, tests"',
      ignoreFocusOut: true,
    });
    if (!input) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Evolve AI: Building framework…', cancellable: false },
      async progress => {
        const ctx = await this._svc.context.build({ includeRelated: false });
        const req: AIRequest = {
          messages: [{ role: 'user', content:
            `Build this project structure with complete working code.\nFor each file use ## relative/path/file.ext\n\n${input}`
          }],
          system:      this._svc.context.buildSystemPrompt(ctx),
          instruction: input,
          mode:        'new',
        };
        progress.report({ message: 'Generating…' });
        const output = await this._svc.ai.send(req);
        progress.report({ message: 'Creating files…' });
        const files  = this._svc.workspace.parseMultiFileOutput(output, ws.uri.fsPath);
        await this._svc.workspace.applyGeneratedFiles(files);
      }
    );
  }

  async applyToFolder(uri?: vscode.Uri): Promise<void> {
    const folderPath = uri?.fsPath ?? getActiveWorkspaceFolder()?.uri.fsPath; // [FIX-14]
    if (!folderPath) { vscode.window.showWarningMessage('Open a folder first'); return; }
    await this._svc.workspace.applyToFolder(folderPath);
  }

  // ── Git ───────────────────────────────────────────────────────────────────────

  async gitCommitMessage(): Promise<void> {
    const ctx = await this._svc.context.build({ includeGitDiff: true, includeErrors: false, includeRelated: false });
    if (!ctx.gitDiff) {
      vscode.window.showInformationMessage('Evolve AI: No staged changes — stage files first.'); return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Evolve AI: Generating commit message…' },
      async () => {
        const req: AIRequest = {
          messages: [{ role: 'user', content:
            `Write a Git commit message (Conventional Commits format) for:\n\n${ctx.gitDiff}\n\nMax 72 chars first line. Bullet points for details if needed.`
          }],
          system: 'You write concise, accurate Git commit messages. Follow Conventional Commits.',
          instruction: 'commit message', mode: 'chat',
        };
        const msg = (await this._svc.ai.send(req)).trim().replace(/^```[\w]*\n?|```\s*$/gm, '').trim();
        await vscode.env.clipboard.writeText(msg);
        const ans = await vscode.window.showInformationMessage(
          `Copied: "${msg.split('\n')[0]}"`, 'Apply to SCM', 'Dismiss'
        );
        if (ans === 'Apply to SCM') {
          const gitExt = vscode.extensions.getExtension('vscode.git');
          if (gitExt) {
            const git  = gitExt.isActive ? gitExt.exports : await gitExt.activate();
            const repo = git.getAPI(1).repositories[0];
            if (repo) repo.inputBox.value = msg;
          }
        }
      }
    );
  }

  async gitExplainDiff(): Promise<void> {
    const ctx = await this._svc.context.build({ includeGitDiff: true, includeErrors: false, includeRelated: false });
    if (!ctx.gitDiff) { vscode.window.showInformationMessage('Evolve AI: No changes to explain.'); return; }
    await vscode.commands.executeCommand('aiForge._sendToChat',
      `Explain what these code changes do and why they matter:\n\n${ctx.gitDiff}`, 'chat'
    );
  }

  async gitPRDescription(): Promise<void> {
    const ctx = await this._svc.context.build({ includeGitDiff: true, includeErrors: false });
    await vscode.commands.executeCommand('aiForge._sendToChat',
      `Write a professional PR description. Include: what changed, why, how to test.\n\n${ctx.gitDiff ?? 'No diff available'}`,
      'chat'
    );
  }

  // ── Run & Fix ─────────────────────────────────────────────────────────────────

  async runAndFix(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const cmd = this._svc.workspace.getRuntimeCommand(editor.document.uri.fsPath, editor.document.languageId);
    if (!cmd) { vscode.window.showWarningMessage('Evolve AI: No runner for this file type'); return; }
    const term = vscode.window.createTerminal('Evolve AI: Run');
    term.show();
    term.sendText(cmd);
    const ans = await vscode.window.showInformationMessage(`Running: ${cmd}`, 'Fix Errors Now', 'Dismiss');
    if (ans === 'Fix Errors Now') await this.fixErrors();
  }

  // ── Provider / Setup ─────────────────────────────────────────────────────────

  async switchProvider(): Promise<void> {
    const cfg     = vscode.workspace.getConfiguration('aiForge');
    const running = await this._svc.ai.isOllamaRunning();
    const [models, gemma4Status, glmStatus] = await Promise.all([
      running ? this._svc.ai.getOllamaModels() : Promise.resolve([]),
      running ? this._svc.ai.isGemma4Available() : Promise.resolve({ installed: false, variants: [] as string[] }),
      running ? this._svc.ai.isGlmAvailable() : Promise.resolve({ installed: false, variants: [] as string[] }),
    ]);

    type ProviderItem = vscode.QuickPickItem & { detail: string };
    const items: ProviderItem[] = [
      // ── Local / offline options (no data leaves your machine)
      { label: `$(server) Ollama${running ? ' ✓' : ' (not running)'}`,
        description: running ? `${models.length} model(s) installed — fully local, free` : 'Local LLM — install from ollama.com',
        detail: 'ollama' },
      { label: `$(sparkle) Gemma 4${gemma4Status.installed ? ' ✓' : ''}`,
        description: gemma4Status.installed
          ? `Ready — ${gemma4Status.variants.join(', ')} installed`
          : 'Google\'s latest open model — free, local, multimodal. Guided setup',
        detail: 'gemma4' },
      { label: `$(code) GLM (local)${glmStatus.installed ? ' ✓' : ''}`,
        description: glmStatus.installed
          ? `Ready — ${glmStatus.variants.join(', ')} installed`
          : 'GLM / CodeGeeX coding model — free, local, runs offline via Ollama',
        detail: 'glm' },
      { label: '$(circuit-board) Offline AI',  description: 'Built-in — instant, no setup, no LLM needed', detail: 'offline' },
      // ── separator
      { label: '── Cloud providers ──', description: '', detail: '', kind: vscode.QuickPickItemKind.Separator } as ProviderItem,
      // ── Cloud options
      { label: '$(cloud) Anthropic Claude',    description: 'Requires API key — claude-sonnet-4-6, opus, haiku',  detail: 'anthropic' },
      { label: '$(globe) OpenAI / Compatible', description: 'Also works with Groq, Mistral, Together AI, LiteLLM',  detail: 'openai' },
      { label: '$(sparkle) Google Gemini',     description: 'Requires API key — gemini-2.5-pro, 2.5-flash, 2.0-flash',  detail: 'gemini' },
      { label: '$(code) GLM (Z.ai)',           description: 'Requires API key — glm-4.6, glm-4.5 flagship cloud models',  detail: 'zai' },
      { label: '$(hubot) Hugging Face',        description: 'Access thousands of open models — Qwen, Llama, Mistral, etc.',  detail: 'huggingface' },
    ];

    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Select AI provider' });
    if (!choice) return;
    const provider = choice.detail!;
    await cfg.update('provider', provider, vscode.ConfigurationTarget.Global);

    if (provider === 'ollama' && running && models.length) {
      const model = await vscode.window.showQuickPick(models, { placeHolder: 'Choose Ollama model' });
      if (model) await cfg.update('ollamaModel', model, vscode.ConfigurationTarget.Global);
    } else if (provider === 'ollama' && running) {
      const model = await vscode.window.showInputBox({ prompt: 'Model name', value: 'qwen2.5-coder:7b' });
      if (model) await cfg.update('ollamaModel', model, vscode.ConfigurationTarget.Global);
    } else if (provider === 'ollama' && !running) {
      // Offer local alternatives
      const action = await vscode.window.showWarningMessage(
        'Ollama not detected. You can install Ollama, or use LM Studio / llama.cpp which are also compatible.',
        'Install Ollama', 'Use Custom URL', 'Cancel'
      );
      if (action === 'Install Ollama') {
        vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
      } else if (action === 'Use Custom URL') {
        const url = await vscode.window.showInputBox({
          prompt: 'Local server URL (Ollama, LM Studio, llama.cpp, Jan)',
          value: cfg.get<string>('ollamaHost', 'http://localhost:11434'),
          placeHolder: 'http://localhost:11434',
        });
        if (url) {
          await cfg.update('ollamaHost', url, vscode.ConfigurationTarget.Global);
          const model = await vscode.window.showInputBox({ prompt: 'Model name', value: 'qwen2.5-coder:7b' });
          if (model) await cfg.update('ollamaModel', model, vscode.ConfigurationTarget.Global);
        }
      }
    } else if (provider === 'gemma4') {
      await this._runGemma4Wizard(cfg);
    } else if (provider === 'glm') {
      // Local GLM coding model via Ollama — pick a model, offer to pull it
      const glmModels = ['codegeex4-all-9b', 'glm4:9b', 'glm4'];
      const current   = cfg.get<string>('glmModel', 'codegeex4-all-9b');
      const modelChoice = await vscode.window.showQuickPick(
        [...glmModels, '$(edit) Enter custom model tag…'],
        { placeHolder: `Choose a local GLM model (current: ${current})` }
      );
      if (!modelChoice) return;
      let model = modelChoice;
      if (modelChoice.includes('custom')) {
        const custom = await vscode.window.showInputBox({ prompt: 'Ollama model tag (e.g. codegeex4-all-9b)', value: current });
        if (!custom) return;
        model = custom;
      }
      await cfg.update('glmModel', model, vscode.ConfigurationTarget.Global);
      // Offer to download now if Ollama is running but the model isn't installed
      if (running && !models.some(m => m === model || m.startsWith(model + ':'))) {
        const pull = await vscode.window.showInformationMessage(
          `GLM model "${model}" isn't downloaded yet. Download it now (~5.5GB)?`,
          'Download Now', 'Later'
        );
        if (pull === 'Download Now') {
          const term = vscode.window.createTerminal('Evolve AI: GLM Setup');
          term.show();
          term.sendText(`ollama pull ${model}`);
        }
      } else if (!running) {
        vscode.window.showWarningMessage(
          'Ollama is not running. Install/start Ollama (ollama.com), then the GLM model will run locally.',
          'Get Ollama'
        ).then(a => { if (a === 'Get Ollama') vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download')); });
      }
    } else if (provider === 'anthropic') {
      // [SEC-6] Inform user that code will be sent to cloud API
      const consent = await vscode.window.showWarningMessage(
        'Evolve AI will send your code and workspace context to the Anthropic API over HTTPS for processing. Continue?',
        { modal: true }, 'I Understand', 'Cancel'
      );
      if (consent !== 'I Understand') return;
      // [FIX-4] Store in SecretStorage, not settings
      const key = await vscode.window.showInputBox({ prompt: 'Anthropic API key', password: true });
      if (key) await this._svc.ai.storeSecret(SECRET_ANTHROPIC, key);
    } else if (provider === 'openai') {
      // [SEC-6] Inform user that code will be sent to cloud API
      const consent = await vscode.window.showWarningMessage(
        'Evolve AI will send your code and workspace context to the OpenAI API over HTTPS for processing. Continue?',
        { modal: true }, 'I Understand', 'Cancel'
      );
      if (consent !== 'I Understand') return;
      // [FIX-4] Store in SecretStorage
      const key = await vscode.window.showInputBox({ prompt: 'OpenAI API key', password: true });
      if (key) await this._svc.ai.storeSecret(SECRET_OPENAI, key);
      // Ask for custom base URL (for non-OpenAI providers like Groq, Together AI)
      const customUrl = await vscode.window.showInputBox({
        prompt: 'Base URL (leave default for OpenAI, or enter Groq/Mistral/Together AI endpoint)',
        value: cfg.get<string>('openaiBaseUrl', 'https://api.openai.com/v1'),
      });
      if (customUrl) await cfg.update('openaiBaseUrl', customUrl, vscode.ConfigurationTarget.Global);
      const model = await vscode.window.showInputBox({
        prompt: 'Model name',
        value: cfg.get<string>('openaiModel', 'gpt-4o'),
      });
      if (model) await cfg.update('openaiModel', model, vscode.ConfigurationTarget.Global);
    } else if (provider === 'gemini') {
      // [SEC-6] Inform user that code will be sent to cloud API
      const consent = await vscode.window.showWarningMessage(
        'Evolve AI will send your code and workspace context to the Google Gemini API over HTTPS for processing. Continue?',
        { modal: true }, 'I Understand', 'Cancel'
      );
      if (consent !== 'I Understand') return;
      // [FIX-4] Store in SecretStorage
      const key = await vscode.window.showInputBox({ prompt: 'Google Gemini API key (from aistudio.google.com/apikey)', password: true });
      if (key) await this._svc.ai.storeSecret(SECRET_GEMINI, key);
      // Let user pick a model
      const geminiModels = [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
      ];
      const modelChoice = await vscode.window.showQuickPick(
        [...geminiModels, '$(edit) Enter custom model ID…'],
        { placeHolder: 'Choose a Gemini model' }
      );
      if (modelChoice?.includes('custom')) {
        const custom = await vscode.window.showInputBox({ prompt: 'Gemini model ID (e.g., gemini-2.5-flash)' });
        if (custom) await cfg.update('geminiModel', custom, vscode.ConfigurationTarget.Global);
      } else if (modelChoice) {
        await cfg.update('geminiModel', modelChoice, vscode.ConfigurationTarget.Global);
      }
    } else if (provider === 'zai') {
      // [SEC-6] Inform user that code will be sent to cloud API
      const consent = await vscode.window.showWarningMessage(
        'Evolve AI will send your code and workspace context to the GLM (Z.ai) API over HTTPS for processing. Continue?',
        { modal: true }, 'I Understand', 'Cancel'
      );
      if (consent !== 'I Understand') return;
      // [FIX-4] Store in SecretStorage
      const key = await vscode.window.showInputBox({ prompt: 'GLM (Z.ai) API key (from z.ai/manage-apikey/apikey-list)', password: true });
      if (key) await this._svc.ai.storeSecret(SECRET_ZAI, key);
      // Let user pick a model
      const zaiModels = ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4-flash'];
      const modelChoice = await vscode.window.showQuickPick(
        [...zaiModels, '$(edit) Enter custom model ID…'],
        { placeHolder: 'Choose a GLM (Z.ai) model' }
      );
      if (modelChoice?.includes('custom')) {
        const custom = await vscode.window.showInputBox({ prompt: 'GLM model ID (e.g., glm-4.6)' });
        if (custom) await cfg.update('zaiModel', custom, vscode.ConfigurationTarget.Global);
      } else if (modelChoice) {
        await cfg.update('zaiModel', modelChoice, vscode.ConfigurationTarget.Global);
      }
    } else if (provider === 'huggingface') {
      // [SEC-6] Inform user that code will be sent to cloud API
      const consent = await vscode.window.showWarningMessage(
        'Evolve AI will send your code and workspace context to the Hugging Face Inference API over HTTPS for processing. Continue?',
        { modal: true }, 'I Understand', 'Cancel'
      );
      if (consent !== 'I Understand') return;
      const key = await vscode.window.showInputBox({ prompt: 'Hugging Face API token (from hf.co/settings/tokens)', password: true });
      if (key) await this._svc.ai.storeSecret(SECRET_HUGGINGFACE, key);
      // Let user pick a model
      const hfModels = [
        'Qwen/Qwen2.5-Coder-32B-Instruct',
        'meta-llama/Llama-3.3-70B-Instruct',
        'mistralai/Mistral-Small-24B-Instruct-2501',
        'bigcode/starcoder2-15b',
        'deepseek-ai/DeepSeek-Coder-V2-Instruct',
      ];
      const modelChoice = await vscode.window.showQuickPick(
        [...hfModels, '$(edit) Enter custom model ID…'],
        { placeHolder: 'Choose a Hugging Face model' }
      );
      if (modelChoice?.includes('custom')) {
        const custom = await vscode.window.showInputBox({ prompt: 'Hugging Face model ID (e.g., org/model-name)' });
        if (custom) await cfg.update('huggingfaceModel', custom, vscode.ConfigurationTarget.Global);
      } else if (modelChoice) {
        await cfg.update('huggingfaceModel', modelChoice, vscode.ConfigurationTarget.Global);
      }
    }

    const modelSettingByProvider: Record<string, string> = {
      gemma4: 'gemma4Model', glm: 'glmModel', ollama: 'ollamaModel',
      anthropic: 'anthropicModel', openai: 'openaiModel',
      gemini: 'geminiModel', zai: 'zaiModel', huggingface: 'huggingfaceModel',
    };
    const modelKey = modelSettingByProvider[provider];
    this._svc.events.emit('provider.changed', {
      provider,
      model: modelKey ? cfg.get(modelKey, '') : '',
    });
  }

  // ── Gemma 4 smart setup wizard ─────────────────────────────────────────────
  // Detects hardware → recommends a variant → runs a one-click install pipeline.
  // Falls back to a simpler manual flow if user declines hardware detection.
  private async _runGemma4Wizard(cfg: vscode.WorkspaceConfiguration): Promise<void> {
    // Step 1: get one-time consent for hardware detection
    const consentKey = 'aiForge.hardwareConsent';
    const allowDetect = cfg.get<boolean>('allowHardwareDetection', true);
    let consented = this._svc.vsCtx.globalState.get<boolean | undefined>(consentKey);

    if (consented === undefined && allowDetect) {
      const choice = await vscode.window.showInformationMessage(
        'Evolve AI can check your system (RAM, GPU, disk space, Ollama version) to recommend the best Gemma 4 variant for your hardware. ' +
        'No data leaves your machine — this is purely to tailor the recommendation.',
        { modal: true },
        'Yes, check my system', 'No, show all options'
      );
      consented = choice === 'Yes, check my system';
      await this._svc.vsCtx.globalState.update(consentKey, consented);
    }

    // No consent or detection disabled — fall back to manual flow
    if (!consented || !allowDetect) {
      await this._gemma4ManualFlow(cfg);
      return;
    }

    // Step 2: detect hardware
    const hw = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Inspecting your system\u2026' },
      () => this._svc.inspector.inspect()
    );

    // Step 3: get recommendation
    const rec = this._svc.inspector.recommend(hw);

    if (rec.kind === 'unsupported') {
      await this._showUnsupportedDialog(cfg, hw, rec.reasons, rec.suggestions);
      return;
    }

    // Step 4: build setup plan and show summary
    const ollamaHost = cfg.get<string>('ollamaHost', 'http://localhost:11434');
    const plan = this._svc.setup.planSteps(hw, rec.variant, ollamaHost);
    const summary = this._svc.inspector.summary(hw);
    const planLines = plan.steps.map((s, i) => `  ${i + 1}. ${s.label}`).join('\n');
    const warningLines = rec.warnings.length
      ? '\n\n\u26A0 Notes:\n' + rec.warnings.map(w => `  \u2022 ${w}`).join('\n')
      : '';

    const detail =
      `Detected: ${summary}\n\n` +
      `Recommended: ${rec.variant}\nWhy: ${rec.reason}\n\n` +
      `Setup plan:\n${planLines}` + warningLines;

    const choice = await vscode.window.showInformationMessage(
      detail,
      { modal: true },
      'Install Everything', 'Choose Different Variant'
    );

    if (choice === 'Choose Different Variant') {
      const altTag = await this._pickVariantManually(hw);
      if (!altTag) return;
      const altPlan = this._svc.setup.planSteps(hw, altTag, ollamaHost);
      if (!await this._confirmInstallIfNeeded(altPlan, cfg)) return;
      const result = await this._svc.setup.execute(altPlan);
      await this._handleSetupResult(result, altTag);
      return;
    }

    if (choice !== 'Install Everything') return;

    // Extra consent for Ollama install/upgrade if allowAutoInstall is off
    if (!await this._confirmInstallIfNeeded(plan, cfg)) return;

    // Execute the plan
    const result = await this._svc.setup.execute(plan);
    await this._handleSetupResult(result, rec.variant);
  }

  /** Ask explicit consent before Ollama install/upgrade unless allowAutoInstall is enabled. */
  private async _confirmInstallIfNeeded(
    plan: { steps: { id: string; label: string }[] },
    cfg: vscode.WorkspaceConfiguration
  ): Promise<boolean> {
    const installStep = plan.steps.find(s => s.id === 'install-ollama' || s.id === 'upgrade-ollama');
    if (!installStep) return true;
    if (cfg.get<boolean>('allowAutoInstall', false)) return true;

    const confirm = await vscode.window.showWarningMessage(
      `This will: ${installStep.label}. Ollama is downloaded from ollama.com (~250MB). Continue?\n\n` +
      `Tip: enable \`aiForge.allowAutoInstall\` in settings to skip this prompt for future setups.`,
      { modal: true },
      'Yes, install Ollama', 'Cancel'
    );
    return confirm === 'Yes, install Ollama';
  }

  /** Manual variant picker (fallback when consent denied or user wants to override). */
  private async _pickVariantManually(hw: import('../core/hardwareInspector').HardwareProfile | null): Promise<string | undefined> {
    type VariantItem = vscode.QuickPickItem & { tag: string };
    const installedVariants = hw?.gemma4.variants ?? [];

    const variantItems: VariantItem[] = [
      { label: '$(zap) E4B (Recommended)',
        description: '4.5B params \u00B7 ~9.6GB \u00B7 128K context \u00B7 text+image+audio',
        detail: '16GB+ RAM, no GPU needed. Best balance of speed and quality.',
        tag: 'gemma4:e4b' },
      { label: '$(rocket) E2B (Lightweight)',
        description: '2.3B params \u00B7 ~7.2GB \u00B7 128K context \u00B7 text+image+audio',
        detail: '8GB+ RAM. Fastest responses, great for quick tasks.',
        tag: 'gemma4:e2b' },
      { label: '$(beaker) 26B MoE (Advanced)',
        description: '25.2B total \u00B7 ~18GB \u00B7 256K context \u00B7 text+image',
        detail: '32GB+ RAM. High quality with efficient inference.',
        tag: 'gemma4:26b' },
      { label: '$(star-full) 31B Dense (Maximum Quality)',
        description: '30.7B params \u00B7 ~20GB \u00B7 256K context \u00B7 text+image',
        detail: '32GB+ RAM + GPU with 20GB+ VRAM. Highest quality.',
        tag: 'gemma4:31b' },
    ];

    for (const item of variantItems) {
      if (installedVariants.some(v => v === item.tag || v.startsWith(item.tag + ':'))) {
        item.label += ' \u2713 installed';
      }
    }

    const choice = await vscode.window.showQuickPick(variantItems, {
      placeHolder: 'Choose a Gemma 4 variant',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    return choice?.tag;
  }

  /** "System cannot run Gemma 4" dialog with actionable alternatives. */
  private async _showUnsupportedDialog(
    cfg: vscode.WorkspaceConfiguration,
    hw: import('../core/hardwareInspector').HardwareProfile,
    reasons: string[],
    suggestions: string[]
  ): Promise<void> {
    const summary = this._svc.inspector.summary(hw);
    const reasonLines = reasons.map(r => `  \u2022 ${r}`).join('\n');
    const suggestionLines = suggestions.map(s => `  \u2022 ${s}`).join('\n');

    const detail =
      `Your system: ${summary}\n\n` +
      `Why Gemma 4 won't work:\n${reasonLines}\n\n` +
      `What you can do instead:\n${suggestionLines}`;

    const choice = await vscode.window.showWarningMessage(
      detail,
      { modal: true },
      'Switch to Cloud Provider', 'Use Offline Mode', 'Cancel'
    );

    if (choice === 'Switch to Cloud Provider') {
      // Re-open Switch Provider — user can pick Anthropic/OpenAI/Gemini/HuggingFace
      await vscode.commands.executeCommand('aiForge.switchProvider');
    } else if (choice === 'Use Offline Mode') {
      await cfg.update('provider', 'offline', vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('Switched to Offline Mode. Pattern-based assistance, no LLM required.');
    }
  }

  /** Manual Gemma 4 flow when hardware consent is denied. */
  private async _gemma4ManualFlow(cfg: vscode.WorkspaceConfiguration): Promise<void> {
    const tag = await this._pickVariantManually(null);
    if (!tag) return;
    const ollamaHost = cfg.get<string>('ollamaHost', 'http://localhost:11434');
    // Build a minimal hardware profile just for orchestrator (treat as install-everything)
    const hw: import('../core/hardwareInspector').HardwareProfile = {
      ramGb: 0, cpu: { model: '', cores: 0, arch: '' }, gpu: null, diskFreeGb: 0,
      ollama: await this._minimalOllamaCheck(),
      gemma4: await this._svc.ai.isGemma4Available().then(g => ({ installed: g.installed, variants: g.variants })),
      platform: process.platform, detectedAt: Date.now(),
    };
    const plan = this._svc.setup.planSteps(hw, tag, ollamaHost);
    if (!await this._confirmInstallIfNeeded(plan, cfg)) return;
    const result = await this._svc.setup.execute(plan);
    await this._handleSetupResult(result, tag);
  }

  private async _minimalOllamaCheck(): Promise<{ installed: boolean; version: string | null; needsUpdate: boolean }> {
    const running = await this._svc.ai.isOllamaRunning();
    return { installed: running, version: null, needsUpdate: false };
  }

  /** Show success toast or error after orchestrator finishes. */
  private async _handleSetupResult(result: { ok: boolean; error?: string }, variant: string): Promise<void> {
    if (result.ok) {
      const action = await vscode.window.showInformationMessage(
        `\u2728 Gemma 4 (${variant}) is ready! All requests now run locally on your machine.`,
        'Show Tips', 'Open Chat'
      );
      if (action === 'Show Tips') {
        await vscode.commands.executeCommand('aiForge.gemma4Info');
      } else if (action === 'Open Chat') {
        await vscode.commands.executeCommand('aiForge.chatPanel.focus');
      }
      return;
    }

    const err = result.error ?? 'Unknown error';

    // Known VS Code race: extension was installed/upgraded into a running window
    // and the configuration registry hasn't caught up. A reload fixes it.
    if (err.includes('is not a registered configuration')) {
      const pick = await vscode.window.showWarningMessage(
        `Gemma 4 setup almost finished, but VS Code hasn't loaded the extension's ` +
        `settings schema yet (this happens on fresh installs/upgrades). ` +
        `Reload the window and run Switch AI Provider \u2192 Gemma 4 again to complete setup.`,
        { modal: false },
        'Reload Window', 'Retry Now', 'Dismiss'
      );
      if (pick === 'Reload Window') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      } else if (pick === 'Retry Now') {
        // One retry — often the registry has caught up by now
        await vscode.commands.executeCommand('aiForge.switchProvider');
      }
      return;
    }

    vscode.window.showErrorMessage(`Gemma 4 setup failed: ${err}`);
  }

  setupOllama(): void {
    vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
  }

  async gemma4Info(): Promise<void> {
    const cfg     = vscode.workspace.getConfiguration('aiForge');
    const model   = cfg.get<string>('gemma4Model', 'gemma4:e4b');
    const variant = (model.split(':')[1] || 'e4b').toUpperCase();
    const provider = await this._svc.ai.detectProvider();
    const isActive = provider === 'gemma4';
    const running  = await this._svc.ai.isOllamaRunning();
    const { installed, variants } = await this._svc.ai.isGemma4Available();

    const contextSize = (variant === '26B' || variant === '31B') ? '256K' : '128K';
    const modalities  = (variant === '26B' || variant === '31B') ? 'text, image' : 'text, image, audio';

    const statusLine = isActive && running && installed
      ? `**Status:** Active and running locally \u2714`
      : !running ? `**Status:** Ollama not running \u2014 start Ollama to use Gemma 4`
      : !installed ? `**Status:** Model not downloaded \u2014 run \`ollama pull ${model}\``
      : `**Status:** Installed but not the active provider \u2014 switch to Gemma 4 in the header`;

    const installedLine = variants.length > 0
      ? `**Installed variants:** ${variants.join(', ')}`
      : `**Installed variants:** None`;

    const info = [
      `## \u2728 Gemma 4 \u2014 Google's Open Multimodal Model\n`,
      `${statusLine}`,
      `**Current variant:** ${variant} (${model})`,
      `**Context window:** ${contextSize} tokens`,
      `**Capabilities:** ${modalities}`,
      `**Privacy:** All processing on your machine \u2014 code never leaves`,
      `**License:** Apache 2.0 (free for commercial use)`,
      `${installedLine}\n`,
      `### Model Variants\n`,
      `| Variant | Params | Download | Context | RAM | Speed | Best for |`,
      `|---------|--------|----------|---------|-----|-------|----------|`,
      `| **E2B** | 2.3B | ~7.2GB | 128K | 8GB+ | ~50 tok/s | Quick tasks, fast feedback |`,
      `| **E4B** | 4.5B | ~9.6GB | 128K | 16GB+ | ~30 tok/s | Everyday coding (recommended) |`,
      `| **26B MoE** | 3.8B active | ~18GB | 256K | 32GB+ | ~15 tok/s | Complex reasoning, large codebases |`,
      `| **31B** | 30.7B | ~20GB | 256K | 32GB+ GPU | ~10 tok/s | Maximum quality, architecture decisions |\n`,
      `### Smart Setup Wizard\n`,
      `Run **Evolve AI: Switch AI Provider** \u2192 select **Gemma 4** to launch the one-click setup:`,
      `- **Hardware inspection** (with consent) detects RAM, GPU, disk, Ollama version`,
      `- **Smart recommendation** picks the right variant for your machine`,
      `- **One-click install** \u2014 handles Ollama install/upgrade + model download + config`,
      `- **Live progress** shows MB/total as the model downloads`,
      `- **Privacy-first** \u2014 all detection is local, no data leaves your machine`,
      `- If your system can't run any variant, alternative options (cloud, offline) are offered\n`,
      `### Tips for Best Results\n`,
      `- **Be specific:** "Add error handling to the fetchUser function" works better than "improve this code"`,
      `- **Use Edit mode** for file changes, **Chat mode** for questions and explanations`,
      `- **Select code first** then ask \u2014 the AI gets better context about what you mean`,
      `- **Large files?** Gemma 4's ${contextSize} context window handles them well`,
      `- **Complex task?** Try the 26B or 31B variant for better reasoning`,
      `- **Toggle the "Think" button** in the chat header for chain-of-thought reasoning on hard problems\n`,
      `### Keyboard Shortcuts\n`,
      `| Action | Windows / Linux | macOS |`,
      `|--------|-----------------|-------|`,
      `| Open AI Chat | \`Ctrl+Shift+A\` | \`Cmd+Shift+A\` |`,
      `| Explain selected code | \`Ctrl+Alt+E\` | \`Cmd+Alt+E\` |`,
      `| Fix errors in current file | \`Ctrl+Alt+F\` | \`Cmd+Alt+F\` |`,
      `| Generate code from description | \`Ctrl+Alt+G\` | \`Cmd+Alt+G\` |`,
      `| Generate git commit message | \`Ctrl+Alt+M\` | \`Cmd+Alt+M\` |`,
      `| Right-click for context menu | mouse | mouse |\n`,
      `To switch variants: run **Evolve AI: Switch AI Provider** \u2192 Gemma 4`,
    ].join('\n');

    // [v2.0.1] Render as a Markdown preview tab (same safe path as whatsNew).
    // Previously posted via `_postInfoToChat`, which had a webview-timing race
    // and a focus-steal AI-hijack risk.
    await this._showMarkdownPreview('gemma4-info.md', info);
  }

  async whatsNew(): Promise<void> {
    const version = this._svc.vsCtx.extension.packageJSON.version as string;
    const notes   = getReleaseNotes(version);

    await this._showMarkdownPreview(`whats-new-${version}.md`, notes);

    // User has explicitly viewed the notes — mark dismissed and clear pending banner
    await this._svc.vsCtx.globalState.update(`aiForge.whatsNewDismissed.${version}`, true);
    await this._svc.vsCtx.globalState.update(`aiForge.whatsNewPending.${version}`, false);
  }

  /**
   * [v2.0.1] Render static markdown content (release notes, Gemma 4 tips) as a
   * Markdown preview tab. NEVER inject through the chat panel — that path has
   * two failure modes:
   *   1. The webview's `message` listener may not be wired up yet when the
   *      post fires; the payload gets silently dropped.
   *   2. Stealing focus to the chat panel risks submitting any in-flight
   *      keystrokes to the AI, which hallucinates generic content
   *      (e.g. AWS extension docs instead of our release notes).
   *
   * A Markdown preview tab is read-only, has zero chance of AI hijack, renders
   * identically on every platform, and supports links / images / lists natively.
   */
  private async _showMarkdownPreview(filename: string, content: string): Promise<void> {
    try {
      const dir = this._svc.vsCtx.globalStorageUri.fsPath;
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, filename);
      await fs.promises.writeFile(file, content, 'utf8');

      const uri = vscode.Uri.file(file);
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch (e) {
      // Fallback: open the markdown as a regular editor tab if the preview
      // command is unavailable (very old VS Code or a fork without the
      // markdown extension). Still safer than chat injection.
      console.warn('[Evolve AI] markdown.showPreview failed, opening as plain markdown:', e);
      try {
        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (e2) {
        console.error('[Evolve AI] Could not open markdown preview:', e2);
        vscode.window.showInformationMessage(
          'Evolve AI: see CHANGELOG.md on the GitHub repo for details.',
          'Open CHANGELOG'
        ).then(p => {
          if (p === 'Open CHANGELOG') {
            vscode.env.openExternal(vscode.Uri.parse(
              'https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md'
            ));
          }
        });
      }
    }
  }

  // ── CodeLens handlers ─────────────────────────────────────────────────────────

  async codelensExplain(uri: vscode.Uri, range: vscode.Range): Promise<void> {
    const doc  = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand(
      'aiForge._sendToChat', `Explain this function:\n\n${extractBlock(doc, range.start.line)}`, 'chat'
    );
  }

  async codelensTests(uri: vscode.Uri, range: vscode.Range): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await this._editCommand(`Generate comprehensive unit tests:\n\n${extractBlock(doc, range.start.line)}`, 'new');
  }

  async codelensRefactor(uri: vscode.Uri, range: vscode.Range): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await this._editCommand(`Refactor for clarity and performance:\n\n${extractBlock(doc, range.start.line)}`, 'edit');
  }

  // ── Shared edit helper ────────────────────────────────────────────────────────

  private async _editCommand(instruction: string, mode: 'edit' | 'new'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor && mode === 'edit') { vscode.window.showWarningMessage('Open a file first'); return; }

    // [FIX-5] Create AbortController to cancel mid-stream
    const abortController = new AbortController();

    await vscode.window.withProgress(
      {
        location:    vscode.ProgressLocation.Notification,
        title:       `Evolve AI: ${mode === 'edit' ? 'Editing' : 'Generating'}…`,
        cancellable: true,  // [FIX-5] Enable cancel button
      },
      async (progress, token) => {
        // [FIX-5] Wire VS Code cancel token → AbortController
        token.onCancellationRequested(() => abortController.abort());

        const ctx    = await this._svc.context.build();
        const system = this._svc.context.buildSystemPrompt(ctx);
        const user   = this._svc.context.buildUserPrompt(ctx, instruction);
        const req: AIRequest = {
          messages:    [{ role: 'user', content: user }],
          system,
          instruction,
          mode,
          signal:      abortController.signal,  // [FIX-5]
        };

        let output = '';
        progress.report({ message: 'Streaming…' });
        for await (const chunk of this._svc.ai.stream(req)) {
          if (token.isCancellationRequested) break;
          output += chunk;
        }

        if (token.isCancellationRequested) {
          vscode.window.showInformationMessage('Evolve AI: Request cancelled.');
          return;
        }

        const cleaned = output.replace(/^```[\w]*\n?|```\s*$/gm, '').trim();

        if (mode === 'edit' && editor) {
          // [FIX-6] Three options: Apply, Show Diff, Cancel
          const ans = await vscode.window.showInformationMessage(
            'Evolve AI: Edit ready.',
            'Apply', 'Show Diff', 'Cancel'
          );
          if (ans === 'Apply') {
            await this._svc.workspace.applyToActiveFile(cleaned);
          } else if (ans === 'Show Diff') {
            // [FIX-6] Show side-by-side diff, then let user decide
            const decision = await this._svc.workspace.showDiff(
              editor.document.getText(), cleaned, instruction.slice(0, 50)
            );
            if (decision === 'apply') await this._svc.workspace.applyToActiveFile(cleaned);
          }
        } else if (mode === 'new') {
          const ws    = getActiveWorkspaceFolder(); // [FIX-14]
          const files = this._svc.workspace.parseMultiFileOutput(cleaned, ws?.uri.fsPath ?? '.');
          await this._svc.workspace.applyGeneratedFiles(files);
        }
      }
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// [FIX-2] Indentation-based block extraction — handles blank lines inside functions
function extractBlock(doc: vscode.TextDocument, startLine: number): string {
  const lines: string[] = [];
  const firstLine = doc.lineAt(startLine).text;
  const baseIndent = firstLine.search(/\S/);

  for (let i = startLine; i < Math.min(startLine + 100, doc.lineCount); i++) {
    const line = doc.lineAt(i).text;
    lines.push(line);

    if (i > startLine) {
      // Blank lines are allowed inside a block
      if (line.trim() === '') continue;
      // A non-blank line at base indent or less ends the block (next function/class)
      const indent = line.search(/\S/);
      if (indent >= 0 && indent <= baseIndent && lines.length > 2) break;
    }
  }
  // Trim trailing blank lines
  while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

// ── Release notes ─────────────────────────────────────────────────────────────
// Add a new entry here for each version. The `whatsNew` command reads from this map.
const RELEASE_NOTES: Record<string, string> = {
  '2.9.0': [
    `## 📊 Evolve AI 2.9.0 — A proper Data Analysis panel\n`,
    `### What's new\n`,
    `Choosing **Analyse** now opens a friendly **Data Analysis panel** instead of a bare file picker. It makes feeding your data obvious:\n`,
    `- **📁 Browse for a file…** — your data can live *anywhere* on your machine, not just the open project.`,
    `- **Drag & drop** a file onto the panel.`,
    `- **Pick a workspace file** — now filtered to real data (no more \`package.json\` / build JSON noise).`,
    `- **🗄️ Database or cloud source** and **▶️ Run a pipeline** buttons — every way to provide data in one place.`,
    `- Deliverable buttons (Insights / Report / Notebook / Profile) + a focus box, then hit **Analyse →**.\n`,
    `### Fixed\n`,
    `The workspace file list used to show config/build JSON (e.g. \`build-steps/progress.json\`). It now skips build/config folders, excludes known config filenames, and only lists \`.json\` that actually looks tabular.\n`,
  ].join('\n'),
  '2.8.0': [
    `## 📊 Evolve AI 2.8.0 — Data pipelines + "Analyse" chat mode\n`,
    `### Declarative data pipelines\n`,
    `Define a repeatable analysis once, run it on demand. A pipeline is a small JSON file listing **steps** — each step is a **source** (a local file, BigQuery / Databricks / Cosmos / Log Analytics / DynamoDB, a cloud object, or a SQL database) and an **analysis** (insights / report / notebook / profile).\n`,
    `- **Create Data Pipeline** scaffolds \`evolve-data-pipeline.json\` with examples for every source type.`,
    `- **Run Data Pipeline** executes each step in sequence and drops the deliverables in your output folder.\n`,
    `It's the backend-free version of an "agent workflow": a reproducible, versioned, multi-source run you own as a file in your repo — no hosted orchestration, no scheduling.\n`,
    `### "Analyse" is now a chat mode\n`,
    `Data analysis is a first-class action in the chat **Mode** dropdown — alongside Chat / Edit / Create. Pick **Analyse** to launch the flow (a file *or* a database/cloud source → insights, report, notebook, profile) right from the chat panel.\n`,
    `### Fixed\n`,
    `- **"Data Analysis plugin is not active" popup** when your data file lives outside the open workspace folder. The plugin now activates when you're looking at a data file, and the Analyse action always opens a file picker rather than dead-ending.`,
    `- Detection re-runs when you switch editor tabs, so opening a data file activates the plugin immediately.\n`,
  ].join('\n'),
  '2.7.0': [
    `## 📊 Evolve AI 2.7.0 — Data Analysis & Reporting (PowerBI-style, in your editor)\n`,
    `### What's new\n`,
    `Give Evolve AI a data file and an instruction — get a report. A new auto-detecting plugin turns tabular data into insights without leaving VS Code.\n`,
    `### How to use it\n`,
    `Right-click a \`.csv\` / \`.tsv\` / \`.json\` / \`.xlsx\` / \`.parquet\` file in the Explorer → **Analyze Data & Report**, or run it from the command palette. Pick what you want:\n`,
    `- **HTML report** — KPI tiles, charts, tables, and an AI "Key insights" narrative. The PowerBI-style deliverable.`,
    `- **Analysis notebook/script** — reproducible pandas + plotly \`.py\` you can run and tweak.`,
    `- **Profiling summary** — types, nulls, distributions, correlations, data-quality flags.\n`,
    `### Your data, your choice\n`,
    `- **Small files** → the AI reads a sample and writes the finished report directly.`,
    `- **Large files** → the AI generates a script that reads the *full* dataset locally and writes the report — nothing leaves your machine.`,
    `- If a sample would go to a cloud provider, you're told first and offered the local/script path instead.\n`,
    `### Where it goes\n`,
    `Output is written next to your data (\`sales.csv\` → \`sales-report.html\`), and Evolve AI offers to open the report or run the script.\n`,
    `### Insights in chat (Gemini-style)\n`,
    `Prefer a conversation? **Data Insights in Chat** streams a narrative analysis into the chat panel — patterns, trends, outliers, recommendations — and you can ask follow-ups right there, then turn it into a report.\n`,
    `### Not just local files — databases & cloud\n`,
    `**Analyze Data from Database or Cloud Source** pulls a sample and runs the same analysis:\n`,
    `- **BigQuery**, **Databricks SQL**, **Cosmos DB**, **Azure Log Analytics**, **DynamoDB** — live query → analysis`,
    `- **S3 / GCS / Azure Blob** — fetch a CSV/JSON object and analyse it`,
    `- **Postgres / MySQL / SQLite / Snowflake / SQL Server** — generates a \`pandas.read_sql\` script you run with your own connection (\`DB_URL\` env var; no passwords stored)\n`,
    `Cloud sources reuse your existing connected-plugin credentials — no new setup.\n`,
    `### Coming later\n`,
    `Emailing reports was intentionally deferred — this release focuses on getting the analysis and reports right first.\n`,
  ].join('\n'),
  '2.6.0': [
    `## 🚀 Evolve AI 2.6.0 — GLM, two ways: local (offline) and Z.ai (cloud)\n`,
    `### What's new\n`,
    `GLM (Zhipu / Z.ai) joins as **two first-class providers** — because "runs on my laptop" and "the flagship model" are genuinely different things.\n`,
    `### 🖥️ GLM (local) — runs offline\n`,
    `A GLM / CodeGeeX **coding model** that runs fully offline via Ollama. No API key, no data leaves your machine.\n`,
    `1. Install [Ollama](https://ollama.com/download)`,
    `2. **Switch** → **GLM (local)** → pick a model → it offers to download it`,
    `3. Default is \`codegeex4-all-9b\` (built on GLM-4-9B, ~5.5GB, 128K context). \`glm4:9b\` and \`glm4\` also available.\n`,
    `### ☁️ GLM (Z.ai) — the flagship, via cloud\n`,
    `The large \`glm-4.6\` / \`glm-4.5\` models via Z.ai's API. These are 355B+ parameter models — too big to run locally, so they run in the cloud.\n`,
    `1. Get a key at [z.ai](https://z.ai/manage-apikey/apikey-list)`,
    `2. **Switch** → **GLM (Z.ai)** → paste your key → pick a model`,
    `3. Key stored in VS Code's encrypted storage (never in settings.json)\n`,
    `### Honest about hardware\n`,
    `GLM-5.x / GLM-4.6 flagships are hundreds of billions of parameters — they can't run offline on a laptop. So the **local** provider ships the 9B-class coding models that actually do, and the **cloud** provider gives you the flagship when you want it. No pretending.\n`,
    `### Settings added\n`,
    `- \`aiForge.glmModel\` (default \`codegeex4-all-9b\`) — local model tag`,
    `- \`aiForge.zaiModel\` (default \`glm-4.6\`) — cloud model name`,
    `- \`aiForge.zaiBaseUrl\` — Z.ai OpenAI-compatible endpoint\n`,
  ].join('\n'),
  '2.5.0': [
    `## 🚀 Evolve AI 2.5.0 — Google Gemini is now a first-class provider\n`,
    `### What's new\n`,
    `Gemini joins Claude, OpenAI, Ollama, Gemma 4 and Hugging Face as a first-class AI provider — its own entry in the provider switcher, its own key, its own model picker.\n`,
    `### How to use it\n`,
    `1. Get an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)`,
    `2. Click **Switch** in the chat header → **Google Gemini**`,
    `3. Paste your key (stored in VS Code's encrypted SecretStorage — never in settings.json) and pick a model\n`,
    `### Models\n`,
    `| Model | Best for |`,
    `|---|---|`,
    `| \`gemini-2.5-pro\` | Maximum quality, complex reasoning |`,
    `| \`gemini-2.5-flash\` | **Default** — fast, strong on code |`,
    `| \`gemini-2.0-flash\` / \`-flash-lite\` | Fastest, cheapest |\n`,
    `### Implementation notes\n`,
    `- Uses Gemini's **official OpenAI-compatible endpoint**, so streaming, cancellation, and error handling all reuse the existing engine.`,
    `- Gemini is treated as a **cloud provider** — PII-tagged lineage columns are redacted before being sent, same as Anthropic/OpenAI/HF.`,
    `- Two new settings: \`aiForge.geminiModel\` and \`aiForge.geminiBaseUrl\` (the base URL only needs changing for a proxy).\n`,
    `---\n`,
    `Already using the OpenAI provider pointed at Gemini's compat URL? You can keep that, but switching to the dedicated **Google Gemini** provider gives you the model picker and the right branding.`,
  ].join('\n'),
  '2.4.0': [
    `## 🚀 Evolve AI 2.4.0 — Pre-push gating for CI/CD anti-patterns\n`,
    `### What's new\n`,
    `The CI/CD plugin (v2.1.0) catches anti-patterns in your editor. v2.4.0 catches them at **push time** with an opt-in git hook, so supply-chain and credential-leak risks never reach origin.\n`,
    `### How to use it\n`,
    `Run \`Evolve AI: Install CI/CD Pre-Push Hook\` from the command palette. The installer:\n`,
    `- **Detects existing hooks** — won't silently clobber another tool's pre-push. Offers Append / Replace / Cancel.`,
    `- **Detects Husky** — writes to \`.husky/pre-push\` instead so Husky doesn't overwrite our hook.`,
    `- **Asks for mode**: Block (default) / Warn / Off.\n`,
    `Bypass any specific push with \`git push --no-verify\` (standard git).\n`,
    `### What gets blocked vs warned\n`,
    `| Rule | Severity | Why |`,
    `|---|---|---|`,
    `| Unpinned \`uses: owner/name@v4\` references (anything but a 40-char SHA) | **Block** | Supply-chain risk — hijacked tags silently re-run new code. |`,
    `| Long-lived cloud creds in secrets (\`AWS_ACCESS_KEY_ID\`, \`GCP_SA_KEY\`, \`AZURE_CLIENT_SECRET\`, etc.) | **Block** | Credential-leak risk. Use OIDC. |`,
    `| Missing top-level \`permissions:\` (GitHub Actions) | **Warn** | Implicit write permissions on \`GITHUB_TOKEN\`. |`,
    `| Job without \`timeout-minutes\` | **Warn** | Runaway runs sit idle for 6h burning runner minutes. |`,
    `| No \`concurrency:\` block | **Warn** | Duplicate runs race or waste runners. |\n`,
    `The warn tier exists deliberately — gating on every nit trains users to reach for \`--no-verify\`, which is worse than no hook.\n`,
    `### Three new commands\n`,
    `- \`Evolve AI: Install CI/CD Pre-Push Hook\` — install / update`,
    `- \`Evolve AI: Uninstall CI/CD Pre-Push Hook\` — remove (refuses to touch hooks we didn't write)`,
    `- \`Evolve AI: Check Pipelines Now (Pre-Push Dry Run)\` — see what the hook would say without pushing\n`,
    `### One new setting\n`,
    `- \`aiForge.cicd.hookMode\` (default \`block\`) — switch between block / warn / off without uninstalling.\n`,
    `### Implementation notes\n`,
    `- **Self-contained.** The checker (\`scripts/check-pipelines.js\`) is pure Node with zero extension imports. Survives extension uninstall — the hook prints a one-line "extension gone, remove me" notice and exits 0 (never blocks).`,
    `- **POSIX shell.** Works on Git for Windows (MINGW64 sh), macOS, and Linux. No \`.bat\` or \`.ps1\`.`,
    `- **Respects \`core.hooksPath\`.** Teams using shared hook collections get the hook written to the right place.`,
    `- **Never blocks on internal error.** Crashes in the hook exit 0 with a stderr note — better than locking the user out of pushing.\n`,
    `### What's NOT in this release (deferred)\n`,
    `- No pre-commit hook (only pre-push). Most users push immediately after commit anyway.`,
    `- No auto-install. Always opt-in per-repo — hooks are too intrusive to install silently.`,
    `- No per-rule severity override. Single global mode for now.\n`,
    `---\n`,
    `Full guide: [docs/CICD.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/CICD.md)`,
  ].join('\n'),
  '2.3.0': [
    `## 🚀 Evolve AI 2.3.0 — Monorepo support for the CI/CD Setup Wizard\n`,
    `### What's new\n`,
    `The CI/CD Setup Wizard used to assume the entire workspace was a single project rooted at the workspace folder. Half the new repos in 2025+ are monorepo-shaped (Turborepo, Nx, pnpm workspaces, uv workspaces, Go workspaces) — without subproject scoping, the wizard would write a pipeline that ran tests against the wrong directory's manifest. v2.3.0 fixes that.\n`,
    `### What changes when you run the wizard\n`,
    `**Single-project repos** — exactly the same flow as v2.2.0. The new step adds zero friction.\n`,
    `**Monorepos** — one extra QuickPick inserted between the intro and the platform pick:\n`,
    `> *Multiple subprojects detected (3). Which one is this pipeline for?*`,
    `> - apps/web — package.json — node`,
    `> - apps/api — pyproject.toml — python`,
    `> - services/worker — Cargo.toml — rust\n`,
    `After picking, the wizard re-inspects language / package manager / test framework scoped to that subproject (not the repo root). Pipeline filename is suffixed with the subproject name:\n`,
    `- \`.github/workflows/ci-web.yml\``,
    `- \`.github/workflows/ci-api.yml\``,
    `- \`.github/workflows/ci-worker.yml\`\n`,
    `### Smart platform handling\n`,
    `Some CI providers only read **one** config file at a canonical path:\n`,
    `- **Bitbucket Pipelines** — wizard surfaces a modal: "Bitbucket only reads bitbucket-pipelines.yml at the repo root. You can have only ONE Bitbucket pipeline per repo — the generated file will scope jobs to your subproject via \`cd <subproject> && ...\` instead."`,
    `- **CircleCI** — same warning: jobs scoped via \`working_directory\` since you can't have two configs.`,
    `- **GitLab** — warns that \`.gitlab-ci-<subproject>.yml\` requires setting \`CI_CONFIG_PATH\` in the GitLab project settings (or rename to default).\n`,
    `### AI prompt now knows about subprojects\n`,
    `When targeting a subproject, the AI prompt instructs the correct working-directory idiom per platform:\n`,
    `- GitHub Actions: \`defaults: { run: { working-directory: <subproject> } }\` + \`paths:\` trigger filter`,
    `- GitLab CI: \`cd $CI_WORK_DIR\` + \`rules: changes:\``,
    `- Jenkins: wraps stages in \`dir('<subproject>') { ... }\``,
    `- CircleCI: \`working_directory: ~/project/<subproject>\` on every job`,
    `- Azure: \`workingDirectory:\` + \`paths: include:\``,
    `- Bitbucket: \`cd <subproject> && ...\` prefix on every script step\n`,
    `Cache keys also reference the subproject's lockfile (not the root).\n`,
    `### Performance & safety\n`,
    `- Subproject detection is depth-2, hard-capped at **200 directory visits / 30 entries per directory**.`,
    `- Skips \`node_modules\`, \`.git\`, \`.venv\`, \`venv\`, \`dist\`, \`build\`, \`target\`, \`vendor\`, etc.`,
    `- Even monorepos with thousands of subdirectories complete detection in well under a second.\n`,
    `### What's still NOT in this release\n`,
    `- **No multi-pipeline batch mode** — wizard targets one subproject per run. Run again for another. (Could add later if requested.)`,
    `- **No detection of workspace-level package managers** (pnpm-workspaces / Turborepo / Nx) for routing — wizard treats each manifest equally. Could be smarter in a future release.`,
    `- **No reuse of shared scripts across subproject pipelines** — each pipeline is standalone. DRY-ing them requires composite actions or includes the user wires up by hand.\n`,
    `---\n`,
    `Full guide: [docs/CICD.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/CICD.md)`,
  ].join('\n'),
  '2.2.0': [
    `## 🚀 Evolve AI 2.2.0 — Stage & Commit closes the loop\n`,
    `### What's new\n`,
    `\`Stage & Commit CI/CD Setup\` used to stop after the commit. As of v2.2.0, it finishes the loop in one flow: **stage → commit → push → PR**.\n`,
    `After a successful commit, you get a single follow-up toast: *"Push to origin and open a pull request?"* with three buttons:\n`,
    `- **Push & open PR** — pushes the branch and creates the PR end-to-end`,
    `- **Push only** — pushes but stops there`,
    `- **Skip** — same behaviour as v2.1.0 (commit only)\n`,
    `### What happens on "Push & open PR"\n`,
    `1. **Push the branch** to \`origin\`. First push automatically uses \`-u\` so upstream tracking is set. Never force-pushes — if the remote diverged, surfaces a clean \`git pull --rebase\` hint instead.`,
    `2. **Detects host + default branch** (\`refs/remotes/origin/HEAD\` first, then \`git remote show origin\`, falling back to \`main\`).`,
    `3. Asks **Draft vs Standard PR**.`,
    `4. **Creates the PR via API where possible**:`,
    `   - GitHub: uses \`vscode.authentication.getSession('github', ['repo'])\` — same path the Git Connect Wizard sets up. No extra config.`,
    `   - Bitbucket: uses \`aiForge.bitbucketPAT\` (stored by the Git Connect Wizard as \`username:app_password\`).`,
    `   - GitLab / other / any API failure: opens the platform's \`compare\` URL pre-filled with title + body. One click in the browser to confirm.`,
    `5. **Surfaces the PR URL** in a toast with \`Open in browser\` and \`Copy link\` buttons.\n`,
    `### Settings\n`,
    `- \`aiForge.cicd.openPRAfterCommit\` (default \`true\`) — set to \`false\` to keep v2.1.0 behaviour (stop after the commit).\n`,
    `### What's deliberately NOT in this release\n`,
    `- **No force push.** Ever. \`non-fast-forward\` rejections surface as a hint, never auto-resolved.`,
    `- **No standalone "push current branch + open PR" command.** Stage & Commit still must follow a wizard run. We may generalise this in v2.3+ if it proves useful.`,
    `- **No multi-file batching.** Still single-file (the one the wizard wrote).\n`,
    `### Files added\n`,
    `- \`src/core/gitPushUtil.ts\` — \`pushBranch()\`, \`getDefaultBranch()\`, \`parseOwnerRepo()\`.`,
    `- \`src/core/prCreator.ts\` — \`createPR()\` (GitHub + Bitbucket API), \`compareUrl()\` (browser fallback for GitHub / Bitbucket / GitLab).\n`,
    `---\n`,
    `Full guide: [docs/CICD.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/CICD.md)`,
  ].join('\n'),
  '2.1.0': [
    `## 🚀 Evolve AI 2.1.0 — DevOps authoring bundle\n`,
    `### What's new\n`,
    `Evolve AI now helps you author CI/CD pipelines as fluently as it helps you author dbt models or Airflow DAGs. Three things shipped together:\n`,
    `**1. CI/CD plugin** — auto-detects every common pipeline file:\n`,
    `- GitHub Actions (\`.github/workflows/*.yml\`)`,
    `- GitLab CI (\`.gitlab-ci.yml\`)`,
    `- Jenkins (\`Jenkinsfile\`)`,
    `- CircleCI (\`.circleci/config.yml\`)`,
    `- Azure Pipelines (\`azure-pipelines.yml\`)`,
    `- Bitbucket Pipelines (\`bitbucket-pipelines.yml\`)\n`,
    `Once detected, the plugin contributes platform-aware best-practice knowledge into every AI prompt: OIDC over long-lived creds, pinning actions to commit SHA, concurrency control, fail-fast matrices, dependency caching by lockfile hash, least-privilege \`permissions:\` blocks, and more. The chat header shows a CI/CD badge with the platform + pipeline count.\n`,
    `**2. CodeLens, CodeActions, transforms, templates** — same shape as the Docker / Terraform / dbt plugins:\n`,
    `- CodeLens: *Explain job* (above each job declaration), *Add cache step* (after checkout), *Convert to matrix* (above runs-on)`,
    `- Lightbulb: *Replace long-lived secrets with OIDC*, *Pin actions to commit SHA*, *Add concurrency control*`,
    `- Transforms: *Lint pipeline (find anti-patterns)*, *Add OIDC auth*`,
    `- Templates: GitHub Actions Python test+deploy, Node + npm publish, GitLab CI Docker build+push, Jenkinsfile starter`,
    `- Commands: \`Optimize Pipeline\`, \`Fix Failing Run\` (paste a CI log → AI diagnoses against the active pipeline file)\n`,
    `**3. CI/CD Setup Wizard** — *Evolve AI: CI/CD Setup Wizard* (mirrors the Git Connect Wizard pattern):\n`,
    `- Inspects your stack: language (\`package.json\` / \`pyproject.toml\` / \`go.mod\` / \`Cargo.toml\`), package manager, test framework, git host (recommends the right CI platform automatically)`,
    `- Asks: which platform · what kind of pipeline (test only / + deploy / + container build) · which deploy target (npm / PyPI / Docker / AWS ECS / Cloud Run / Azure App Service / k8s)`,
    `- Generates a starter file tailored to your stack with the quality bar built in (pinned actions, OIDC, caching, concurrency, timeouts)`,
    `- Writes it to the right path, opens it for your review, surfaces a checklist of follow-ups (replace \`# pin-me\` placeholders, configure secrets, branch-protect main)`,
    `- **Stage & Commit follow-up**: success toast offers a one-click stage + AI-drafted Conventional Commits message + commit. Refuses to commit on \`main\`/\`master\`/\`develop\`/\`production\`/\`release\`/\`trunk\` without first creating a feature branch. Cancelling the message InputBox unstages the file so you never end up with half-finished state. Push and PR creation are deliberately deferred to v2.2.\n`,
    `### Why now\n`,
    `Every team writes pipelines, and every team gets the small details wrong (secret leakage, supply-chain holes via floating tags, runners that sit idle waiting for stuck deploys). Local-AI users especially benefit because the plugin's system prompt section primes models like Qwen 7B and Gemma 4 with the right defaults — Evolve AI does on local AI what GitHub Copilot does only on cloud.\n`,
    `### What's NOT in this release\n`,
    `- No live infrastructure operations (deploy / rollback / log-tail). Coming in v2.2.`,
    `- No pre-commit / pre-push gating hooks. Coming separately.`,
    `- Helm chart authoring stays in the Kubernetes plugin's territory; we may carve it out later.\n`,
    `---\n`,
    `Full guide: [docs/CICD.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/CICD.md)`,
  ].join('\n'),
  '2.0.2': [
    `## 🩹 Evolve AI 2.0.2 — Patch: prompt construction & context transparency\n`,
    `### What was wrong\n`,
    `Some users reported that asking the AI a meta question like *"can you read my repo and understand the application?"* made it ignore the question and instead recite a list of security findings or errors from the active file. Local-model users (especially Qwen 7B and Gemma 4 E2B) were the most affected.\n`,
    `Root cause: the user prompt was assembled with the actual question (\`## Instruction\`) at the **bottom**, after the active file, errors, security scan, and every plugin's context block. Small models attend most strongly to whichever big block they encounter first — usually the security scan — and treat that as the question.\n`,
    `### What changed\n`,
    `- **\`## Instruction\` block now goes FIRST** in every user prompt, with a \`## Reminder\` repeating it at the bottom for long-context models that anchor on recency.`,
    `- **System prompt explicitly tells the model**: "the user's real question is in the Instruction block; other blocks are background context — use them only when the question relates to them; for meta questions, describe the project at a high level instead of reciting findings."`,
    `- **Context chip below your message is now in plain English** — \`Context sent: 📄 src/foo.ts · 3 diagnostics · 2 plugin signals · 18% of context budget\` instead of raw hook keys like \`security.findings · git.connection · aws-live\`. You can see exactly what was sent without guessing.\n`,
    `### What you'll notice\n`,
    `- Asking *"what does this app do?"* now gets a high-level project description.`,
    `- Asking *"what security issues are in this file?"* still surfaces the security findings — that block is still in the context, just no longer hijacking unrelated questions.`,
    `- The chip below your sent message tells you exactly what context the AI received.\n`,
    `### No new features\n`,
    `Pure prompt-quality patch. The v2.0.0 Git Connect Wizard and v2.0.1 Markdown-tab fix are both unchanged.\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
  ].join('\n'),
  '2.0.1': [
    `## 🩹 Evolve AI 2.0.1 — Patch: "What's New" reliability\n`,
    `### What changed\n`,
    `Clicking **"See What's New"** on the upgrade toast now opens a clean Markdown preview tab instead of trying to inject release notes into the chat panel. Two issues are fixed:\n`,
    `1. **Empty-chat / wrong-content bug** — on a small fraction of upgrades the chat webview hadn't finished wiring its message listener when release notes were posted, so the payload was silently dropped. Some users saw a generic AI-hallucinated answer (e.g. AWS extension docs) instead of the 2.0.0 highlights.`,
    `2. **Focus-steal hijack risk** — opening the chat panel for the release notes also stole focus to the chat input. If the user had typed anything in that input, pressing Enter could submit it as an AI prompt with the active file as context.\n`,
    `### What you'll see\n`,
    `- **What's New** (Command Palette → \`Evolve AI: What's New\`) opens a Markdown preview tab — looks the same on every platform, no AI involvement, can be closed safely.`,
    `- **Gemma 4 Info & Tips** uses the same path now.`,
    `- The chat-panel banner still fires; clicking **View** opens the same Markdown tab.\n`,
    `### No new features\n`,
    `This is a pure reliability patch — the v2.0.0 Git/Bitbucket Connect Wizard is unchanged.\n`,
    `---\n`,
    `Full v2.0.0 highlights are still available below.`,
  ].join('\n'),
  '2.0.0': [
    `## 🔗 Evolve AI 2.0.0 — Git/Bitbucket Connect Wizard\n`,
    `### From "fresh folder" to "✓ remote works" in one command\n`,
    `Run **Evolve AI: Connect Git Remote (Wizard)** (or click the \`· not connected\` hint in the status bar). Evolve AI inspects your system, walks you through the missing pieces, and verifies the connection at the end.\n`,
    `### What the wizard handles\n`,
    `- **Installs Git** if missing (Win / mac / linux instructions; polls until \`git --version\` works)`,
    `- **Sets your name and email** (\`git config --global\`) if not already configured`,
    `- **Initialises, clones, or links** a repo to your workspace`,
    `- **Configures auth** — pick the method that fits you:`,
    `  - **VS Code GitHub auth** (recommended for github.com — no token to paste, refresh handled for you)`,
    `  - **Personal Access Token** / **Bitbucket App Password** (validated against the platform's API before storing in \`vscode.SecretStorage\`)`,
    `  - **SSH ed25519 key** (generated, public copied to clipboard, you paste into the platform's "Add SSH key" page; we test the auth)`,
    `  - **GitHub CLI** (\`gh auth login\`) — only offered if \`gh\` is installed`,
    `- **Creates a new repo on GitHub or Bitbucket** via API (optional)`,
    `- **Pushes HEAD to origin** if you opt in (\`aiForge.gitConnect.pushOnConnect\`)`,
    `- **Verifies the connection** with \`git ls-remote origin\` — no surprises later\n`,
    `### Privacy & security\n`,
    `- Tokens **never** touch \`settings.json\` — always \`vscode.SecretStorage\``,
    `- The wizard refuses to run in **untrusted workspaces**`,
    `- An existing \`credential.helper\` is **never overwritten**`,
    `- SSH private keys are **never read** — we only generate them at your request and copy the \`.pub\` to your clipboard\n`,
    `### New commands\n`,
    `- **Evolve AI: Connect Git Remote (Wizard)** — main entry`,
    `- **Evolve AI: Git Connection Status** — one-line summary + jump to wizard`,
    `- **Evolve AI: Disconnect Git Credentials** — clear stored tokens (SSH keys are never deleted)`,
    `- **Evolve AI: Test Git Remote Connection** — re-run \`git ls-remote\` on demand\n`,
    `### New settings (\`aiForge.gitConnect.*\`)\n`,
    `- \`preferredAuth\` — pre-select \`github-builtin\` / \`pat\` / \`ssh\` / \`gh-cli\``,
    `- \`autoVerify\` (default \`true\`) — run verify after the wizard finishes`,
    `- \`pushOnConnect\` (default \`false\`) — \`git push -u origin HEAD\` after creating the remote`,
    `- \`statusHint\` (default \`true\`) — show \`· not connected\` in the status bar + a one-time toast on first activation\n`,
    `### What's NOT included\n`,
    `OAuth device flow was deliberately dropped — VS Code's built-in GitHub auth provider is the safer, simpler path. DevOps-with-AI features (CI/CD generation, IaC review, deployment readiness) are coming in a separate release.\n`,
    `---\n`,
    `Full guide: [docs/GIT_CONNECT.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/GIT_CONNECT.md)`,
  ].join('\n'),
  '1.9.0': [
    `## 🪂 Evolve AI 1.9.0 — Airflow DAG Simulator\n`,
    `### Catch broken DAGs before you push\n`,
    `Open any \`.py\` file containing \`DAG(...)\` or \`@dag(...)\` and Evolve AI now does static analysis on it — no Python interpreter required, no Airflow install needed.\n`,
    `### What it catches\n`,
    `- **Cycles** (direct + transitive) and broken \`>>\` edges`,
    `- **Duplicate \`task_id\`s** (Airflow rejects these at parse time)`,
    `- **Sensor pitfalls**: \`mode='poke'\` with >1h timeout (worker-slot starvation), missing \`timeout\``,
    `- **Schedule mistakes**: invalid cron, missing \`catchup=False\` with past \`start_date\``,
    `- **TaskFlow gotchas**: \`@task\` function referenced without \`()\` in dep chains`,
    `- **Operator config**: missing \`default_args\` / missing \`retries\`\n`,
    `### How you'll see it\n`,
    `- **Inline diagnostics** — yellow/red squiggles on the offending line, source \`aiForge.airflow\``,
    `- **CodeLens at line 0**: \`$(circuit-board) Airflow DAG: 7 tasks · 2 warnings — open simulator\``,
    `- **Simulator panel** (\`Ctrl+Alt+D\` / \`⌘⌥D\`): stats, ASCII task graph, click-to-jump issue list, **Fix all with AI** button\n`,
    `### How "Fix all with AI" works\n`,
    `The analyzer's exact issue list is prepended to your AI prompt — so the rewrite targets the actual problems, not generic "improve this DAG" guidance.\n`,
    `### Settings (under \`aiForge.airflow.simulator.*\`)\n`,
    `- \`enabled\` (default \`true\`)`,
    `- \`runOnSave\` (default \`true\`) — false for live diagnostics`,
    `- \`severity\` (default \`warning\`) — minimum severity to surface\n`,
    `### Marketplace discoverability — major refresh\n`,
    `The Marketplace listing now leads with the data-engineering features. Description and keywords overhauled so DEs searching for "dbt lineage", "bigquery cost", "airflow lint", "data engineering" can find the extension.\n`,
    `---\n`,
    `Full guide: [docs/AIRFLOW_SIMULATOR.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/AIRFLOW_SIMULATOR.md)`,
  ].join('\n'),
  '1.8.0': [
    `## 🌳 Evolve AI 1.8.0 — dbt Manifest Integration\n`,
    `### Know what breaks before you ship it\n`,
    `Open any dbt model and Evolve AI now shows you what depends on it — direct + transitive downstream models, exposures, and tests. No more grepping the repo for \`ref('model_name')\` to figure out blast radius.\n`,
    `### Three new surfaces\n`,
    `- **Impact CodeLens** at the top of every model: \`$(symbol-class) Impact: 4 downstream · 1 exposure · 12 tests\`. Click to open the panel.`,
    `- **Impact panel** (\`Ctrl+Alt+I\` / \`⌘⌥I\`): direct + transitive descendants with materialization, exposures with owners + types + URLs, total tests in the impacted graph, plus upstream parents and sources.`,
    `- **Refactor with AI (impact-aware)** button: pipes the downstream impact summary into the chat panel so the AI rewrites your model with the *blast radius* in mind, not just the SQL in front of it.\n`,
    `### Two new commands\n`,
    `- **\`dbt: List Exposures\`** — quick-pick across every exposure in the project, with owner + type + upstream model count.`,
    `- **\`dbt: Refresh Manifest Cache\`** — for paranoia (the cache auto-invalidates on \`manifest.json\` mtime change).\n`,
    `### Settings (under \`aiForge.dbt.*\`)\n`,
    `- \`impactCodeLensEnabled\` (default \`true\`) — show the impact CodeLens at the top of every model`,
    `- \`impactDepth\` (default \`5\`) — max graph hops when computing transitive impact\n`,
    `### Built on the existing manifest reader\n`,
    `Both v1.5.0's lineage-aware context (column schemas) and this release's impact analysis now share a single mtime-cached \`target/manifest.json\` reader — manifest parses once per save, not once per feature. Same parse, two views.\n`,
    `### Privacy\n`,
    `Everything is local. The manifest is read from disk and parsed in-memory; nothing is uploaded. The "Refactor with AI" button only sends model names + materializations + exposure metadata into the prompt — never the source SQL of downstream models.\n`,
    `---\n`,
    `Full guide: [docs/DBT_MANIFEST.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/DBT_MANIFEST.md)`,
  ].join('\n'),
  '1.7.0': [
    `## ⚡ Evolve AI 1.7.0 — Query cost / perf preview\n`,
    `### See what your query will cost before you run it\n`,
    `Click the new **\`$(zap) Preview cost\`** CodeLens above any SQL statement and Evolve AI runs a dry-run / EXPLAIN against your connected engine — no actual execution, no surprise bill.\n`,
    `Get bytes scanned, estimated cost, row count, tables read, and warnings (\`SELECT *\`, missing partition filter, cross join, large-scan). The plan excerpt sits right below for deeper digging.\n`,
    `### Two engines wired today\n`,
    `- **Databricks** — runs \`EXPLAIN COST\` on a SQL warehouse (falls back to plain \`EXPLAIN\` on older runtimes). Picks a warehouse on first use and remembers it.`,
    `- **BigQuery** — calls \`jobs.insert\` with \`dryRun: true\`. Free on BigQuery's side.`,
    `- *Snowflake coming next* — the contribution point is open for any plugin to implement.\n`,
    `### Optimise with one click\n`,
    `The Query Cost panel has an **Optimise with AI** button that pipes the analysis (engine, bytes, warnings, tables) into the chat panel — so the AI's rewrite is grounded in real cost data, not guesses. Stacks with v1.5.0's lineage-aware context: column types and tests from upstream tables flow in automatically.\n`,
    `### How to use\n`,
    `- **\`Ctrl+Alt+Q\`** / **\`⌘⌥Q\`** — Preview the query at the cursor`,
    `- Right-click selection → *Preview Query Cost (Selection)*`,
    `- CodeLens above each \`spark.sql(...)\` block in PySpark notebooks\n`,
    `### Settings (under \`aiForge.queryAnalysis.*\`)`,
    `- \`enabled\` — master toggle`,
    `- \`databricksUsdPerTb\` / \`bigqueryUsdPerTb\` — override engine pricing for your account`,
    `- \`databricksWarehouseId\` — sticky warehouse choice (clear to be re-prompted)\n`,
    `### Privacy\n`,
    `Both analyzers use **dry-run / EXPLAIN** — your query is never executed. BigQuery dry-run is free; Databricks \`EXPLAIN COST\` consumes a few seconds of warehouse time. Results cache for 5 minutes per SQL hash so repeated lens views don't re-burn warehouse cycles.\n`,
    `---\n`,
    `Full guide: [docs/QUERY_ANALYSIS.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/QUERY_ANALYSIS.md)`,
  ].join('\n'),
  '1.6.0': [
    `## 💬 Evolve AI 1.6.0 — Claude-style chat\n`,
    `### Open chat as an editor tab\n`,
    `Click the **Evolve AI icon** in the top-right of any file's title bar. The chat opens as a regular tab to the right of your code — exactly like Claude Code or Copilot Chat. Click the icon again to reveal the existing tab; close the tab to dismiss.\n`,
    `Sidebar still works (\`Ctrl+Shift+A\`). Both views share the same conversation in real time, so you can keep one open without losing context in the other.\n`,
    `### Mode pill\n`,
    `The old \`Chat / Edit / Create\` tab strip is replaced with a single pill above the input box. Click it to pick a mode with a description for each:\n`,
    `- **Chat** — ask questions, no edits applied automatically.`,
    `- **Edit** — describe a change; you review &amp; apply to the active file (undoable).`,
    `- **Create** — describe what to generate; you review &amp; create new files.\n`,
    `### Model picker — switch models without leaving chat\n`,
    `A second pill shows your current model and opens a popover listing same-provider alternatives:\n`,
    `- **Ollama** — your installed models, fetched live.`,
    `- **Gemma 4** — e2b / e4b / 26b / 31b.`,
    `- **Anthropic** — Opus 4.7, Opus 4.6, Sonnet 4.6, Haiku 4.5.`,
    `- **OpenAI** — gpt-4o, gpt-4o-mini, o1-mini, o3-mini.`,
    `- **Hugging Face** — Qwen Coder 32B, Llama 3.3 70B, Mistral Small 24B.\n`,
    `Your currently configured value always appears first, so a custom model never disappears. The **More providers…** item at the bottom opens the full provider switch flow for cross-provider changes (with API-key prompts handled via SecretStorage as before).\n`,
    `### Fixed\n`,
    `- The status header showed the Ollama model name even when Anthropic or OpenAI was the active provider. Now resolves the correct setting per provider.\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
  ].join('\n'),
  '1.5.0': [
    `## 🔗 Evolve AI 1.5.0 — Lineage-aware context\n`,
    `### The AI now uses your **real** column names\n`,
    `Open a dbt model or a PySpark notebook and Evolve AI walks the file for upstream table references — dbt \`ref()\` / \`source()\`, \`spark.table()\`, \`spark.sql()\` — then looks up their real schemas and feeds them to the AI.\n`,
    `No more hallucinated columns. Ask for a new calculation and the AI writes SQL that actually compiles against your tables.\n`,
    `### What you'll see\n`,
    `- **Inline CodeLens** above every \`ref()\` / \`spark.table()\`: column count, last-built age, stale-manifest warnings.`,
    `- **Hover any table or column** — types, descriptions, passing tests, tags.`,
    `- **Column autocomplete** after typing \`table.\` — real columns, not guesses.`,
    `- **Diagnostics** (yellow squiggle) on broken \`ref()\` calls with "did you mean..." suggestions, so typos are caught before \`dbt run\`.`,
    `- **Status bar badge** — \`$(link) N upstream\` — click to open the Lineage Explorer panel (\`Ctrl+Alt+L\` / \`⌘⌥L\`).\n`,
    `### Providers\n`,
    `- **dbt**: parses \`target/manifest.json\` for the highest fidelity (types, descriptions, tests). Falls back to \`schema.yml\` when no \`dbt compile\` has run.`,
    `- **Databricks / Unity Catalog**: resolves three-part \`catalog.schema.table\` names against the connected workspace's UC API. Requires **Databricks: Connect**.\n`,
    `### Privacy\n`,
    `Columns tagged \`pii\` / \`pci\` / \`sensitive\` are **redacted** before prompts reach cloud providers (Anthropic, OpenAI, HF). Local providers (Ollama, Gemma 4) always get the full schema — data never leaves your machine. Override in settings if your workspace policy allows it.\n`,
    `### Settings (all under \`aiForge.lineage.*\`)`,
    `- \`enabled\` (default \`true\`) — master switch`,
    `- \`includePii\` (default \`false\`) — include PII columns in cloud prompts`,
    `- \`maxUpstreamTables\` (default \`8\`) — cap per request`,
    `- \`providerOrder\` — which provider wins when multiple resolve the same ref\n`,
    `---\n`,
    `Full user guide: [docs/LINEAGE.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/docs/LINEAGE.md)`,
  ].join('\n'),
  '1.4.3': [
    `## \u2328\ufe0f Evolve AI 1.4.3 \u2014 Cross-platform keyboard shortcuts\n`,
    `### Fixed`,
    `- **macOS users**: keyboard shortcuts in the chat panel, Gemma 4 tips, and info messages now show **\u2318 Cmd** instead of \`Ctrl\`.`,
    `- The underlying keybindings always worked on macOS \u2014 only the displayed labels were Windows/Linux-only. Now they adapt to your platform.\n`,
    `### Improved`,
    `- **"What's New" toast** no longer ties its tagline to one specific feature. It now reads *"Evolve AI updated to X.Y.Z. See what's new in this release."* \u2014 accurate for every future update.\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
  ].join('\n'),
  '1.4.2': [
    `## \ud83e\uddf9 Evolve AI 1.4.2 \u2014 Cleaner info display + settings hardening\n`,
    `### Fixed`,
    `- **What's New** and **Gemma 4 Info & Tips** commands now render the exact content you expect \u2014 just the release notes / tips, nothing else.`,
    `- Previously, these commands round-tripped their content through the AI, which prepended Git Status / Recent Commits / Security Scan sections from context plugins. That display contamination is gone.\n`,
    `### Security`,
    `- \`aiForge.ollamaHost\` setting now validates the URL scheme (\`http://\` or \`https://\` only). Typos or weird schemes like \`file://\` are rejected in the Settings editor before they reach the extension.\n`,
    `### No action needed`,
    `This release is a bug fix on top of v1.4.1. All security fixes from v1.4.1 (Ollama CVE min-version, Workspace Trust, remote-host warning, image upload validation) remain in place.\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
  ].join('\n'),
  '1.4.1': [
    `## \ud83d\udd12 Evolve AI 1.4.1 \u2014 Gemma 4 fix + security hardening\n`,
    `### Gemma 4 setup race fixed`,
    `If you hit **"aiForge.gemma4Model is not a registered configuration"** during Gemma 4 setup on v1.4.0, this release fixes it.`,
    ``,
    `The root cause was a VS Code timing issue: when the extension is installed or upgraded into a running window, VS Code's settings registry needed a moment to catch up before the wizard could save its configuration.\n`,
    `### What's better now`,
    `- **Proactive reload prompt** \u2014 when you auto-update the extension, you now get a clear notification asking you to reload before things break, instead of finding out at setup time`,
    `- The Gemma 4 wizard detects the race automatically and offers a one-click **Reload Window** button if it hits the problem`,
    `- Writes fall back to workspace-scope when possible so setup can complete without a reload\n`,
    `### \ud83d\udd12 Security hardening`,
    `- **Ollama minimum version bumped to 0.12.4** \u2014 closes known RCE and auth-bypass CVEs (CVE-2024-37032, CVE-2025-51471, CVE-2025-63389). The wizard prompts for an upgrade if it detects a vulnerable version.`,
    `- **Workspace Trust enforced** \u2014 in untrusted workspaces, malicious \`.vscode/settings.json\` files can no longer redirect your chat (and API keys) to attacker-controlled servers by overriding \`aiForge.ollamaHost\` / \`openaiBaseUrl\` / \`huggingfaceBaseUrl\`.`,
    `- **Remote-host warning** \u2014 if a provider URL isn't a local address, a one-time warning toast explains that your code is leaving your machine.`,
    `- **Image upload validation** \u2014 paste/drag-drop now enforces 10 MB size cap and PNG/JPEG/WEBP/GIF whitelist.\n`,
    `### Still seeing issues?`,
    `Run \`Ctrl+Shift+P\` \u2192 **Developer: Reload Window**, then retry **Switch AI Provider \u2192 Gemma 4**.\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
  ].join('\n'),
  '1.4.0': [
    `## \u2728 What's New in Evolve AI 1.4.0\n`,
    `### Smart hardware detection + one-click Gemma 4 setup`,
    `Pick **Gemma 4** in Switch Provider \u2014 we now do the work for you:\n`,
    `- **Inspects your system** (RAM, GPU, disk, Ollama version) with your consent`,
    `- **Recommends the best variant** for your hardware \u2014 no more guessing`,
    `- **One-click "Install Everything"** runs Ollama install, upgrade, model download, and config in a single progress notification`,
    `- **Live download progress** \u2014 see MB/total as the model pulls (no more opening a terminal)`,
    `- **System-can't-run-it handling** \u2014 if your hardware can't fit any variant, we point you to cloud or offline alternatives instead of leaving you stuck\n`,
    `### Privacy & control`,
    `- **Hardware detection requires explicit consent** \u2014 nothing happens silently`,
    `- **No data leaves your machine** \u2014 detection results stay local`,
    `- **Cancellable** \u2014 every install step can be aborted mid-way`,
    `- **Settings:** \`aiForge.allowHardwareDetection\` (default on), \`aiForge.allowAutoInstall\` (default off, asks before each install)\n`,
    `### Try it`,
    `Run **Evolve AI: Switch AI Provider** \u2192 select **Gemma 4** \u2192 click **Install Everything**.`,
    `That's it. The wizard handles the rest.\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
  ].join('\n'),
  '1.2.1': [
    `## \u2728 What's New in Evolve AI 1.2.1\n`,
    `### You'll always know when we ship something new`,
    `- A **What's New** toast pops up in the bottom-right when you upgrade`,
    `- A **dismissible banner** in the chat panel shows release highlights`,
    `- Run **Evolve AI: What's New** from the command palette anytime\n`,
    `### Everything from 1.2.0 is still here too`,
    `This release builds on Gemma 4 integration \u2014 thinking mode, vision input, structured output, dynamic context budget, and the guided setup wizard.\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
    `Report issues: [GitHub Issues](https://github.com/EvolveMinds/codeforge-ai-vscode/issues)`,
  ].join('\n'),
  '1.2.0': [
    `## \u2728 What's New in Evolve AI 1.2.0\n`,
    `### Gemma 4 \u2014 first-class provider with guided setup`,
    `- **4 variants** supported: E2B (2.3B), E4B (4.5B, recommended), 26B MoE, 31B Dense`,
    `- **One-click setup wizard** \u2014 checks Ollama, picks variant based on your hardware, downloads the model, auto-configures everything`,
    `- **\`Evolve AI: Gemma 4 Info & Tips\`** command \u2014 variant comparison, tips, and shortcuts in chat\n`,
    `### Advanced Gemma 4 capabilities`,
    `- **\ud83e\udde0 Thinking mode** \u2014 toggle chain-of-thought reasoning via the new **Think** button in chat. Better results for complex tasks.`,
    `- **\ud83d\uddbc\ufe0f Vision / image input** \u2014 paste (\`Ctrl+V\`) or drag-drop images into the chat. Gemma 4 analyses screenshots, diagrams, error messages, UI mockups.`,
    `- **\ud83d\udcdd Structured output** \u2014 in edit mode, Gemma 4 returns JSON for more reliable code extraction.`,
    `- **\ud83d\udcd0 Dynamic context budget** \u2014 auto-scales from 24K to 80K\u2013120K chars to leverage Gemma 4's 128K\u2013256K context windows.\n`,
    `### Quick start`,
    `1. Click **Switch** in the chat header`,
    `2. Select **Gemma 4** \u2192 follow the wizard`,
    `3. Or run **Evolve AI: Gemma 4 Info & Tips** anytime\n`,
    `### Other improvements`,
    `- Enhanced status bar tooltip with variant, params, context window, and capabilities`,
    `- Updated onboarding guide with Gemma 4 as the top recommended option`,
    `- Marketplace metadata optimisation for better discoverability\n`,
    `---\n`,
    `Full changelog: [CHANGELOG.md](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md)`,
    `Report issues: [GitHub Issues](https://github.com/EvolveMinds/codeforge-ai-vscode/issues)`,
  ].join('\n'),
};

function getReleaseNotes(version: string): string {
  return RELEASE_NOTES[version] ??
    `## What's New in Evolve AI ${version}\n\nSee the [full changelog](https://github.com/EvolveMinds/codeforge-ai-vscode/blob/main/CHANGELOG.md) for details on this release.`;
}
