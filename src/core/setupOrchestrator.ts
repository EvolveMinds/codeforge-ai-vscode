/**
 * core/setupOrchestrator.ts — One-click Gemma 4 setup
 *
 * Plans and executes the install/upgrade/download steps needed to get the user
 * from "no Gemma 4" to "ready to chat" with a single click.
 *
 * Steps run sequentially with progress reporting via vscode.window.withProgress.
 * Each step is independently cancellable via AbortSignal.
 *
 * The orchestrator never modifies the user's system without explicit consent —
 * caller is expected to confirm before calling execute().
 */

import * as vscode from 'vscode';
import * as http   from 'http';
import { spawn }   from 'child_process';
import type { HardwareProfile } from './hardwareInspector';

export interface SetupStep {
  id:       string;
  label:    string;
  /** True if this step should run; false if already satisfied */
  needed:   boolean;
  run:      (progress: StepProgress, signal: AbortSignal) => Promise<void>;
}

export interface StepProgress {
  /** Update the message shown to the user */
  message:  (text: string) => void;
}

export interface SetupPlan {
  steps:        SetupStep[];
  variant:      string;
  totalSteps:   number;
}

export class SetupOrchestrator {
  /** Plan the setup steps based on detected hardware and chosen variant. */
  planSteps(hw: HardwareProfile, variant: string, ollamaHost: string): SetupPlan {
    const steps: SetupStep[] = [];

    // Step 1: install Ollama if missing
    if (!hw.ollama.installed) {
      steps.push({
        id:     'install-ollama',
        label:  'Install Ollama',
        needed: true,
        run:    (p, sig) => this._installOllama(hw.platform, p, sig),
      });
    } else if (hw.ollama.needsUpdate) {
      // Step 1b: upgrade Ollama if outdated
      steps.push({
        id:     'upgrade-ollama',
        label:  `Upgrade Ollama (current: ${hw.ollama.version})`,
        needed: true,
        run:    (p, sig) => this._installOllama(hw.platform, p, sig), // installer handles upgrade
      });
    }

    // Step 2: pull the model if not installed
    const alreadyHave = hw.gemma4.variants.some(v => v === variant || v.startsWith(variant + ':'));
    if (!alreadyHave) {
      steps.push({
        id:     'pull-model',
        label:  `Download ${variant}`,
        needed: true,
        run:    (p, sig) => this._pullModel(ollamaHost, variant, p, sig),
      });
    }

    // Step 3: configure provider
    steps.push({
      id:     'configure',
      label:  'Configure Evolve AI to use Gemma 4',
      needed: true,
      run:    async () => {
        const cfg = vscode.workspace.getConfiguration('aiForge');
        await cfg.update('provider',    'gemma4', vscode.ConfigurationTarget.Global);
        await cfg.update('gemma4Model', variant,  vscode.ConfigurationTarget.Global);
      },
    });

    return { steps, variant, totalSteps: steps.length };
  }

  /** Execute the planned steps with a single VS Code progress notification. */
  async execute(plan: SetupPlan): Promise<{ ok: boolean; error?: string }> {
    return vscode.window.withProgress(
      {
        location:    vscode.ProgressLocation.Notification,
        title:       'Setting up Gemma 4',
        cancellable: true,
      },
      async (progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());

        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i];
          if (!step.needed) continue;

          progress.report({ message: `Step ${i + 1}/${plan.totalSteps}: ${step.label}` });
          const stepProgress: StepProgress = {
            message: (text) => progress.report({ message: `Step ${i + 1}/${plan.totalSteps}: ${text}` }),
          };

          try {
            await step.run(stepProgress, abort.signal);
            if (abort.signal.aborted) {
              return { ok: false, error: 'Setup cancelled' };
            }
          } catch (e) {
            return { ok: false, error: `${step.label} failed: ${String(e)}` };
          }
        }

        return { ok: true };
      }
    );
  }

  // ── Step implementations ───────────────────────────────────────────────────

  private async _installOllama(platform: NodeJS.Platform, progress: StepProgress, signal: AbortSignal): Promise<void> {
    progress.message('Opening Ollama installer...');

    if (platform === 'win32') {
      // Open the official installer URL — Windows handles the download automatically
      await vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download/OllamaSetup.exe'));
      progress.message('Installer downloading in browser \u2014 run it when done, then leave this window open');
    } else if (platform === 'darwin') {
      await vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download/Ollama-darwin.zip'));
      progress.message('Installer downloading in browser \u2014 extract & install, then leave this window open');
    } else {
      // Linux: open a managed terminal with the install command
      const term = vscode.window.createTerminal('Evolve AI: Install Ollama');
      term.show();
      term.sendText('curl -fsSL https://ollama.ai/install.sh | sh');
      progress.message('Installer running in terminal \u2014 wait for it to complete');
    }

    // Wait for user to complete install (poll for ollama availability)
    progress.message('Waiting for Ollama installation to complete (up to 5 minutes)...');
    const installed = await this._waitForOllama(signal, 300_000); // 5 min max
    if (!installed) {
      throw new Error('Ollama installation did not complete within 5 minutes. Install Ollama manually from ollama.com, then re-run "Evolve AI: Switch AI Provider" \u2192 Gemma 4.');
    }
    progress.message('Ollama installed successfully');
  }

  /** Poll for `ollama --version` to succeed, up to timeoutMs. */
  private _waitForOllama(signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (signal.aborted)              return resolve(false);
        if (Date.now() - start > timeoutMs) return resolve(false);
        const proc = spawn('ollama', ['--version'], { shell: false, windowsHide: true });
        let ok = false;
        proc.on('close', (code: number | null) => {
          ok = code === 0;
          if (ok) return resolve(true);
          setTimeout(check, 3_000);
        });
        proc.on('error', () => setTimeout(check, 3_000));
      };
      check();
    });
  }

  private async _pullModel(ollamaHost: string, model: string, progress: StepProgress, signal: AbortSignal): Promise<void> {
    progress.message(`Connecting to Ollama at ${ollamaHost}...`);
    const url = new URL(ollamaHost + '/api/pull');
    const body = JSON.stringify({ model, stream: true });

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname,
        port:     url.port || 11434,
        path:     url.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        if ((res.statusCode ?? 0) >= 400) {
          let err = '';
          res.on('data', d => { err += d; });
          res.on('end', () => reject(new Error(`Ollama pull failed (${res.statusCode}): ${err.slice(0, 200)}`)));
          return;
        }

        let buf = '';
        let lastReportedPercent = -1;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (signal.aborted) { res.destroy(); return; }
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.status === 'success') continue;
              if (evt.total && evt.completed) {
                const percent = Math.floor((evt.completed / evt.total) * 100);
                if (percent !== lastReportedPercent) {
                  lastReportedPercent = percent;
                  const completedGb = (evt.completed / (1024 ** 3)).toFixed(1);
                  const totalGb     = (evt.total     / (1024 ** 3)).toFixed(1);
                  progress.message(`Downloading ${model} \u2014 ${completedGb}GB / ${totalGb}GB (${percent}%)`);
                }
              } else if (evt.status) {
                progress.message(`${model}: ${evt.status}`);
              }
            } catch { /* skip malformed lines */ }
          }
        });
        res.on('end', () => resolve());
        res.on('error', reject);
      });

      req.on('error', err => {
        if (err.message.includes('ECONNREFUSED')) {
          reject(new Error('Cannot connect to Ollama. Make sure it is running (try: ollama serve)'));
        } else {
          reject(err);
        }
      });

      signal.addEventListener('abort', () => { req.destroy(); reject(new Error('Cancelled')); });

      req.write(body);
      req.end();
    });
  }
}
