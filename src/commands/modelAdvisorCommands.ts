/**
 * commands/modelAdvisorCommands.ts — host side of the Model Advisor
 *
 * Owns everything the panel must not: enumerating what models the user actually
 * has, asking the running server what each one can do, and turning a chosen
 * recommendation into a per-job override.
 *
 * The one behaviour worth defending: accepting a recommendation does NOT write
 * to settings. `aiForge.switchProvider` changes the global provider and model,
 * which is right when someone wants a new default and wrong when they want a
 * better model for one job — that distinction is exactly what the converter's
 * session-scoped `_choice` gets right and what the Data Analysis panel gets
 * wrong today. This is the converter's pattern, generalised: the choice lives
 * in memory, is offered to whichever feature asks, and is gone on reload.
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import type { ProviderName } from '../core/aiService';
import {
  SECRET_ANTHROPIC, SECRET_OPENAI, SECRET_GEMINI, SECRET_ZAI, SECRET_HUGGINGFACE,
} from '../core/aiService';
import {
  JOB_CATALOG, choiceForJob, fitnessFor, jobInfo, profileModel, recommendForJob,
  setChoiceForJob,
  type ModelJob, type ModelProfile,
} from '../core/modelAdvisor';
import { defaultModelFor, providerLabel } from '../core/modelCapability';
import { citeFlow, flowForJob } from '../core/modelFlows';
import { renderFlowchartSvg } from '../offline/flowchartRenderer';
import {
  ModelAdvisorPanel,
  type AdvisorPanelMessage, type AdvisorVerdict, type JobChoice, type ModelRow,
} from '../ui/modelAdvisorPanel';

export class ModelAdvisorCommands {
  constructor(private readonly _svc: IServices) {}

  register(): void {
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

    r('aiForge.model.advisor', () => this.open());
  }

  async open(): Promise<void> {
    // Diagrams are drawn here, in the host, and handed to the panel as SVG.
    // The renderer is a plain module; the webview has no filesystem access and
    // no business parsing anything.
    const jobs: JobChoice[] = JOB_CATALOG
      .filter(j => j.inScope)
      .map(j => {
        const flow = flowForJob(j.job);
        const base: JobChoice = {
          job: j.job, label: j.label, whatItDoes: j.whatItDoes,
          whenToUse: j.whenToUse, commonMistake: j.commonMistake,
        };
        if (!flow) return base;
        const runtime = renderFlowchartSvg(flow.runtime, { title: flow.title });
        const build = flow.buildTime
          ? renderFlowchartSvg(flow.buildTime, { title: 'Ahead of time' })
          : null;
        return {
          ...base,
          flowSvg: runtime.svg || undefined,
          buildSvg: build?.svg || undefined,
          flowCite: citeFlow(flow.provenance),
          costNote: flow.costNote,
        };
      });

    let selected: ModelJob = jobs[0]?.job ?? 'chat';
    let profiles: ModelProfile[] = [];

    const panel = ModelAdvisorPanel.show(jobs, async (msg: AdvisorPanelMessage) => {
      switch (msg.type) {
        case 'selectJob':
          selected = msg.job;
          this._push(panel, profiles, selected);
          break;

        case 'useModel': {
          setChoiceForJob(selected, { provider: msg.provider, model: msg.id });
          const label = jobInfo(selected)?.label.toLowerCase() ?? selected;
          panel.setStatus(
            `${msg.id} will be used for ${label} in this session. ` +
            `Your default provider and model are unchanged.`);
          this._push(panel, profiles, selected);
          break;
        }

        case 'copyPull':
          await vscode.env.clipboard.writeText(msg.command);
          panel.setStatus(`Copied: ${msg.command} — run it in a terminal, then Refresh.`);
          break;

        case 'refresh':
          profiles = await this._loadProfiles(panel);
          this._push(panel, profiles, selected);
          break;

        case 'describeTask':
          break;
      }
    });

    profiles = await this._loadProfiles(panel);
    this._push(panel, profiles, selected);
  }

  /**
   * Build a profile for every model the user can actually reach.
   *
   * Ollama models are asked what they can do; the answer is a detected fact.
   * Cloud models are described from the table, because there is no equivalent
   * endpoint — and the difference shows up as the `source` badge rather than
   * being smoothed over.
   */
  private async _loadProfiles(panel: ModelAdvisorPanel): Promise<ModelProfile[]> {
    panel.setBusy('Checking what your models can do…');
    const out: ModelProfile[] = [];

    try {
      const installed = await this._svc.ai.getOllamaModels();
      for (const id of installed) {
        let detected = null;
        if (this._svc.ai.getOllamaModelInfo) {
          try { detected = await this._svc.ai.getOllamaModelInfo(id); }
          catch { /* the table still describes it; source says 'known' */ }
        }
        out.push(profileModel(id, 'ollama', detected));
      }
    } catch { /* Ollama not running — cloud models may still be configured */ }

    // The configured cloud model for each provider that has a key. Only
    // providers the user can actually reach are listed — offering a model
    // behind a key they have not set would be advice they cannot take.
    const cfg = vscode.workspace.getConfiguration('aiForge');
    const cloud: Array<[ProviderName, string]> = [
      ['anthropic',   SECRET_ANTHROPIC],
      ['openai',      SECRET_OPENAI],
      ['gemini',      SECRET_GEMINI],
      ['zai',         SECRET_ZAI],
      ['huggingface', SECRET_HUGGINGFACE],
    ];
    for (const [p, secretKey] of cloud) {
      const key = await this._svc.ai.getSecret(secretKey);
      if (!key) continue;
      const model = defaultModelFor(p, cfg);
      if (model) out.push(profileModel(model, p, null));
    }

    panel.setBusy(null);
    if (!out.length) {
      panel.setStatus('No models found. Start Ollama, or add a cloud API key with "Evolve AI: Switch AI Provider".');
    }
    return out;
  }

  /** Recompute the verdict and inventory for the selected job and send both. */
  private _push(panel: ModelAdvisorPanel, profiles: ModelProfile[], job: ModelJob): void {
    const current = this._currentModelFor(job);
    const rec = recommendForJob(job, profiles, { current });
    const info = jobInfo(job);

    const verdict: AdvisorVerdict = {
      job,
      jobLabel: info?.label ?? job,
      verdict: rec.verdict,
      headline: rec.headline,
      rationale: rec.rationale,
      source: rec.source,
      pickId: rec.pick?.id,
      alternatives: rec.alternatives.map(a => ({
        id: a.id, provider: a.provider, why: a.why,
        installed: a.installed, pullCommand: a.pullCommand,
      })),
    };
    panel.setVerdict(verdict);

    const rows: ModelRow[] = profiles
      .map(p => ({
        id: p.id,
        provider: p.provider,
        providerLabel: providerLabel(p.provider),
        fitness: fitnessFor(p, job),
        detail: describeModelRow(p),
        source: p.source,
        nativeJobs: JOB_CATALOG
          .filter(j => j.inScope && p.jobs[j.job] === 'native')
          .map(j => j.label),
        isCurrent: p.id === current,
      }))
      // Best fit first, so the useful rows are at the top.
      .sort((a, b) => rank(b.fitness) - rank(a.fitness) || a.id.localeCompare(b.id));

    panel.setModels(rows);
  }

  /**
   * The model this job would use right now — a session choice if one was made,
   * otherwise the global default.
   */
  private _currentModelFor(job: ModelJob): string | undefined {
    const chosen = choiceForJob(job);
    if (chosen) return chosen.model;
    const cfg = vscode.workspace.getConfiguration('aiForge');
    const provider = cfg.get<string>('provider', 'auto');
    if (provider === 'auto' || provider === 'offline') return undefined;
    return defaultModelFor(provider, cfg) || undefined;
  }
}

function rank(f: string): number {
  return ({ native: 3, capable: 2, poor: 1, unsupported: 0 } as Record<string, number>)[f] ?? 0;
}

/** One line of facts about a model, each of which we can actually stand behind. */
function describeModelRow(p: ModelProfile): string {
  const bits: string[] = [];
  const ctx = p.capability.contextTokens;
  bits.push(ctx >= 1000 ? `${Math.round(ctx / 1000)}k context` : `${ctx} context`);
  if (p.attributes.parametersB !== null && p.attributes.parametersB !== undefined) {
    bits.push(`${p.attributes.parametersB}B`);
  }
  if (p.attributes.architecture === 'moe') bits.push('MoE');
  if (p.attributes.family) bits.push(p.attributes.family);
  return bits.join(' · ');
}
