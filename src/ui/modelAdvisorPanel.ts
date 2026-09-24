/**
 * ui/modelAdvisorPanel.ts — "which model should I use?"
 *
 * Answers the question a model picker never does. A provider dropdown lists
 * what you *could* select; it says nothing about whether the thing you picked
 * is the right kind of model for what you are about to do. Someone asking a
 * coder model for embeddings gets nonsense, and nothing in the product tells
 * them why.
 *
 * So the panel is organised around the JOB rather than the model: pick what you
 * are trying to do, and it reports whether your current model is the right tool
 * — with the smallest sufficient alternative, because the biggest model is not
 * the best model, just the most expensive one that also works.
 *
 * Two presentation rules carry real weight here:
 *
 *   1. Every verdict shows where it came from. A capability the running server
 *      reported and a guess from a model's name look different on screen, and
 *      the guess says so. Presenting a guess as fact is the failure this
 *      product spent a release removing from client documents.
 *
 *   2. Nothing is switched behind the user's back. The panel recommends; acting
 *      on it is a click, and that click is scoped to the job, never written
 *      over the global default.
 *
 * Presentation only. The panel posts typed messages; the command handler owns
 * detection, the model list and anything that touches settings.
 */

import * as vscode from 'vscode';
import {
  INDUSTRY_LIST, WORKLOAD_ARCHETYPES,
  type CapabilitySource, type JobFitness, type ModelJob,
} from '../core/modelAdvisor';

/** One job, as offered in the picker. */
export interface JobChoice {
  job: ModelJob;
  label: string;
  whatItDoes: string;
  whenToUse: string;
  commonMistake: string;
  /**
   * How this kind of model works, as rendered SVG.
   *
   * Passed in already drawn rather than as diagram source: the host has the
   * renderer, and a webview that cannot reach the filesystem should not be
   * asked to parse anything. Absent when no flow is defined for the job.
   */
  flowSvg?: string;
  /** Build-time steps, drawn separately so they are never read as runtime. */
  buildSvg?: string;
  /** Where this shape came from — a paper, or an illustration of a family. */
  flowCite?: string;
  /** Where the time and tokens go. Words, never an unmeasured figure. */
  costNote?: string;
}

/** A model the user actually has, as shown in the inventory. */
export interface ModelRow {
  id: string;
  provider: string;
  providerLabel: string;
  /** How well it does the currently-selected job. */
  fitness: JobFitness;
  /** e.g. "32k context · 7.6B · qwen2" */
  detail: string;
  source: CapabilitySource;
  /** Jobs this model is purpose-built for, for the "good at" chips. */
  nativeJobs: string[];
  isCurrent: boolean;
}

/** Something the user could switch to or install. */
export interface AlternativeRow {
  id: string;
  provider: string;
  why: string;
  installed: boolean;
  pullCommand?: string;
}

/** The verdict for the selected job. */
export interface AdvisorVerdict {
  job: ModelJob;
  jobLabel: string;
  verdict: 'ideal' | 'workable' | 'wrong-tool' | 'unsupported';
  headline: string;
  rationale: string;
  source: CapabilitySource;
  /** Model we suggest instead, when there is a better one. */
  pickId?: string;
  alternatives: AlternativeRow[];
}

export type AdvisorPanelMessage =
  | { type: 'selectJob'; job: ModelJob }
  | { type: 'useModel'; id: string; provider: string }
  | { type: 'copyPull'; command: string }
  | { type: 'refresh' }
  | { type: 'describeTask'; text: string };

export class ModelAdvisorPanel {
  private static _instance: ModelAdvisorPanel | null = null;

  static show(
    jobs: JobChoice[],
    onMessage: (msg: AdvisorPanelMessage) => void | Promise<void>,
  ): ModelAdvisorPanel {
    if (!this._instance) this._instance = new ModelAdvisorPanel();
    const inst = this._instance;
    inst._onMessage = onMessage;
    inst._jobs = jobs;
    inst._render();
    inst._panel.reveal();
    return inst;
  }

  static get current(): ModelAdvisorPanel | null { return this._instance; }

  private readonly _panel: vscode.WebviewPanel;
  private _disposed = false;
  private _jobs: JobChoice[] = [];
  private _onMessage: (msg: AdvisorPanelMessage) => void | Promise<void> = () => {};

  private constructor() {
    this._panel = vscode.window.createWebviewPanel(
      'aiForge.modelAdvisor',
      'Evolve AI: Which Model Should I Use?',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this._panel.webview.onDidReceiveMessage((m: AdvisorPanelMessage) => this._onMessage(m));
    this._panel.onDidDispose(() => {
      this._disposed = true;
      if (ModelAdvisorPanel._instance === this) ModelAdvisorPanel._instance = null;
    });
  }

  dispose(): void { if (!this._disposed) this._panel.dispose(); }

  setVerdict(v: AdvisorVerdict): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'verdict', verdict: v });
  }

  setModels(models: ModelRow[]): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'models', models });
  }

  setStatus(text: string): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'status', text });
  }

  setBusy(message: string | null): void {
    if (this._disposed) return;
    this._panel.webview.postMessage({ type: 'busy', message });
  }

  private _render(): void {
    if (this._disposed) return;
    this._panel.webview.html = this._html();
  }

  private _html(): string {
    const industryOptions = INDUSTRY_LIST.map(ind =>
      `<option value="${escAttr(ind.id)}">${escHtml(ind.icon + ' ' + ind.label)}</option>`
    ).join('');

    const archetypesJson = JSON.stringify(WORKLOAD_ARCHETYPES.map(a => ({
      id: a.id,
      label: a.label,
      industry: a.industry,
      job: a.job,
      recommendedTier: a.recommendedTier,
      guidance: a.guidance,
      description: a.description,
      recommendedRagArchitecture: a.recommendedRagArchitecture,
      ragArchitectureLabel: a.ragArchitectureLabel,
    }))).replace(/</g, '\\u003c');

    const jobCards = this._jobs.map((j, i) =>
      `<button class="job${i === 0 ? ' on' : ''}" data-job="${escAttr(j.job)}" ` +
      `title="${escAttr(j.whatItDoes)}"><span class="jl">${escHtml(j.label)}</span></button>`
    ).join('');

    // The SVG is generated by our own renderer from our own diagram sources —
    // no user input reaches it — so it is embedded as markup rather than
    // escaped. Every string that DID come from outside is escaped as usual.
    const jobDetails = this._jobs.map(j =>
      `<div class="jdetail" data-for="${escAttr(j.job)}" hidden>` +
      `<p class="jdoes">${escHtml(j.whatItDoes)}</p>` +
      `<p class="jwhen"><b>Use it for</b> ${escHtml(j.whenToUse)}</p>` +
      `<p class="jmiss"><b>Common mistake</b> ${escHtml(j.commonMistake)}</p>` +
      (j.flowSvg
        ? `<div class="flow"><div class="flowh">How it works</div>` +
          `<div class="flowsvg">${j.flowSvg}</div>` +
          (j.buildSvg
            ? `<div class="flowh alt">Done once, ahead of time — not part of each request</div>` +
              `<div class="flowsvg">${j.buildSvg}</div>`
            : '') +
          (j.costNote ? `<p class="flowcost">${escHtml(j.costNote)}</p>` : '') +
          (j.flowCite ? `<p class="flowcite">${escHtml(j.flowCite)}</p>` : '') +
          `</div>`
        : '') +
      `</div>`
    ).join('');

    const nonce = 'ma8f3r1v6z';
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --card-bg: var(--vscode-editorWidget-background, #252526);
    --card-alt: var(--vscode-sideBar-background, #2a2d2e);
    --border: var(--vscode-widget-border, #3c3c3c);
    --accent: var(--vscode-textLink-foreground, #4ec9b0);
    --dim: var(--vscode-descriptionForeground, #9d9d9d);
    --success: #4ec9b0;
    --warn: #cca700;
    --error: #f14c4c;
  }
  body {
    font-family: var(--vscode-font-family);
    color: var(--fg); background: var(--bg);
    margin: 0; padding: 18px 20px 40px; font-size: 13px; line-height: 1.5;
  }
  h1 { font-size: 17px; margin: 0 0 4px; font-weight: 600; }
  .sub { color: var(--dim); margin: 0 0 18px; font-size: 12px; }
  .step { margin-bottom: 18px; }
  .steph { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
           color: var(--dim); margin-bottom: 7px; font-weight: 600; }

  /* Industry & Workload Profiler */
  .profile-box {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 12px;
  }
  .profile-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 600px) {
    .profile-grid { grid-template-columns: 1fr; }
  }
  .profile-field label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--dim);
    margin-bottom: 5px;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  .profile-select {
    width: 100%;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 6px 9px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .profile-select:focus {
    border-color: var(--accent);
  }
  .guidance-banner {
    margin-top: 11px;
    padding: 9px 12px;
    background: var(--card-alt);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 5px;
    font-size: 11.5px;
  }
  .gb-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 4px;
    font-size: 12px;
  }
  .gb-text {
    color: var(--fg);
    margin: 0;
    line-height: 1.45;
  }
  .gb-rag-row {
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px dashed var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11.5px;
  }
  .gb-rag-badge {
    background: #6366f1;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: .03em;
  }
  .gb-rag-label {
    color: var(--fg);
    font-weight: 500;
  }

  /* Job picker */
  .jobs { display: flex; flex-wrap: wrap; gap: 6px; }
  .job { background: var(--card-bg); color: var(--fg); border: 1px solid var(--border);
         border-radius: 6px; padding: 7px 11px; cursor: pointer; font-size: 12px;
         font-family: inherit; }
  .job:hover { border-color: var(--accent); }
  .job.on { border-color: var(--accent); background: var(--card-alt);
            box-shadow: inset 0 0 0 1px var(--accent); }
  .jl { font-weight: 500; }

  .jdetail { background: var(--card-bg); border: 1px solid var(--border);
             border-radius: 6px; padding: 10px 13px; margin-top: 9px; }
  .jdetail p { margin: 0 0 5px; font-size: 12px; }
  .jdetail p:last-child { margin-bottom: 0; }
  .jdoes { color: var(--fg); }
  .jwhen, .jmiss { color: var(--dim); }
  .jmiss b, .jwhen b { color: var(--fg); font-weight: 600; }

  .flow { margin-top: 11px; border-top: 1px solid var(--border); padding-top: 10px; }
  .flowh { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em;
           color: var(--dim); font-weight: 600; margin-bottom: 6px; }
  .flowh.alt { margin-top: 12px; color: var(--warn); }
  .flowsvg { overflow-x: auto; }
  .flowsvg svg { max-width: 100%; height: auto; border: 1px solid var(--border); border-radius: 5px; }
  .flowcost { color: var(--dim); font-size: 11.5px; margin: 8px 0 0; }
  .flowcite { color: var(--dim); font-size: 10.5px; margin: 5px 0 0; font-style: italic; opacity: .8; }

  /* Verdict */
  .verdict { border: 1px solid var(--border); border-left-width: 3px;
             border-radius: 6px; padding: 12px 15px; background: var(--card-bg); }
  .verdict.ideal       { border-left-color: var(--success); }
  .verdict.workable    { border-left-color: var(--accent); }
  .verdict.wrong-tool  { border-left-color: var(--warn); }
  .verdict.unsupported { border-left-color: var(--error); }
  .vhead { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 6px; }
  .vtitle { font-weight: 600; font-size: 13.5px; }
  .vwhy { color: var(--dim); font-size: 12px; margin: 0; }

  .badge { font-size: 10px; padding: 2px 7px; border-radius: 10px;
           border: 1px solid var(--border); color: var(--dim); white-space: nowrap; }
  .badge.detected { border-color: var(--success); color: var(--success); }
  .badge.known    { border-color: var(--accent);  color: var(--accent); }
  .badge.assumed  { border-color: var(--warn);    color: var(--warn); }

  /* Alternatives */
  .alts { margin-top: 11px; display: flex; flex-direction: column; gap: 6px; }
  .alt { display: flex; align-items: center; gap: 10px; background: var(--card-alt);
         border: 1px solid var(--border); border-radius: 5px; padding: 8px 11px; }
  .aid { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; font-weight: 600; }
  .awhy { color: var(--dim); font-size: 11.5px; flex: 1; }
  .abtn { background: var(--accent); color: #0b0b0b; border: 0; border-radius: 4px;
          padding: 4px 10px; cursor: pointer; font-size: 11px; font-weight: 600;
          font-family: inherit; white-space: nowrap; }
  .abtn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }

  /* Inventory */
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-weight: 600; color: var(--dim); font-size: 11px;
       text-transform: uppercase; letter-spacing: .05em;
       padding: 0 8px 6px 0; border-bottom: 1px solid var(--border); }
  td { padding: 7px 8px 7px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .mid { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; }
  .cur { color: var(--accent); font-size: 10px; margin-left: 6px; }
  .fit { font-size: 11px; font-weight: 600; white-space: nowrap; }
  .fit.native      { color: var(--success); }
  .fit.capable     { color: var(--accent); }
  .fit.poor        { color: var(--warn); }
  .fit.unsupported { color: var(--dim); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
  .chip { font-size: 10px; padding: 1px 6px; border-radius: 8px;
          background: var(--card-alt); border: 1px solid var(--border); color: var(--dim); }
  .mdetail { color: var(--dim); font-size: 11px; }

  /* Reference */
  details.ref { margin-top: 20px; border-top: 1px solid var(--border); padding-top: 14px; }
  details.ref summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--accent); }
  .refbody { margin-top: 11px; display: flex; flex-direction: column; gap: 9px; }
  .refitem { background: var(--card-bg); border: 1px solid var(--border);
             border-radius: 5px; padding: 9px 12px; }
  .rl { font-weight: 600; font-size: 12px; margin-bottom: 3px; }
  .rd { color: var(--dim); font-size: 11.5px; margin: 0 0 3px; }
  .rm { color: var(--warn); font-size: 11.5px; margin: 0; }
  .note { color: var(--dim); font-size: 11.5px; margin: 12px 0 0;
          padding: 9px 12px; background: var(--card-bg);
          border: 1px solid var(--border); border-radius: 5px; }

  .status { margin-top: 14px; color: var(--dim); font-size: 11.5px; min-height: 16px; }
  .busy { color: var(--accent); }
</style></head><body>

<h1>Which model should I use?</h1>
<p class="sub">Pick the job first. The right model depends on what you are doing —
not on which one is biggest.</p>

<div class="step">
  <div class="steph">1 · Guided Selection: Choose by Industry &amp; Workload</div>
  <div class="profile-box">
    <div class="profile-grid">
      <div class="profile-field">
        <label for="selIndustry">🏢 Industry Vertical</label>
        <select id="selIndustry" class="profile-select">
          <option value="">All Industries (Browse by Job)</option>
          ${industryOptions}
        </select>
      </div>
      <div class="profile-field">
        <label for="selWorkload">💼 Nature of Work</label>
        <select id="selWorkload" class="profile-select" disabled>
          <option value="">Select an industry first...</option>
        </select>
      </div>
    </div>
    <div id="guidanceBanner" class="guidance-banner" hidden>
      <div class="gb-head"><span>💡</span> <span id="gbTier"></span></div>
      <p id="gbText" class="gb-text"></p>
      <div id="gbRagRow" class="gb-rag-row" hidden>
        <span class="gb-rag-badge">🏛️ Canonical RAG Pattern</span>
        <span id="gbRagLabel" class="gb-rag-label"></span>
      </div>
    </div>
  </div>

  <div class="steph" style="margin-top: 14px;">Or browse specific model jobs directly</div>
  <div class="jobs" id="jobs">${jobCards}</div>
  <div id="jdetails">${jobDetails}</div>
</div>

<div class="step">
  <div class="steph">2 · Verdict</div>
  <div class="verdict" id="verdict">
    <div class="vhead"><span class="vtitle" id="vtitle">Checking your models…</span></div>
    <p class="vwhy" id="vwhy"></p>
    <div class="alts" id="alts"></div>
  </div>
</div>

<div class="step">
  <div class="steph">3 · Models available to you</div>
  <table>
    <thead><tr><th style="width:34%">Model</th><th style="width:14%">For this job</th><th>Details</th></tr></thead>
    <tbody id="models"><tr><td colspan="3" class="mdetail">Looking…</td></tr></tbody>
  </table>
</div>

<details class="ref">
  <summary>Model types, explained</summary>
  <div class="refbody" id="refbody"></div>
  <p class="note"><b>Size, architecture and training objective are filters, not jobs.</b>
  Mixture-of-Experts describes how a model is built internally — a model can be an MoE
  <i>and</i> a vision model <i>and</i> small enough for a laptop. "Small language model"
  describes what it takes to run, not what it does. Pick by the job first, then filter.</p>
</details>

<div class="status" id="status"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const ARCHETYPES = ${archetypesJson};
const selIndustry = $('selIndustry');
const selWorkload = $('selWorkload');
const guidanceBanner = $('guidanceBanner');
const gbTier = $('gbTier');
const gbText = $('gbText');
const gbRagRow = $('gbRagRow');
const gbRagLabel = $('gbRagLabel');

if (selIndustry) {
  selIndustry.addEventListener('change', () => {
    const ind = selIndustry.value;
    selWorkload.innerHTML = '';
    if (!ind) {
      selWorkload.disabled = true;
      selWorkload.innerHTML = '<option value="">Select an industry first...</option>';
      guidanceBanner.hidden = true;
      if (gbRagRow) gbRagRow.hidden = true;
      return;
    }
    const matching = ARCHETYPES.filter(a => a.industry === ind);
    selWorkload.disabled = false;
    selWorkload.innerHTML = '<option value="">Choose nature of work...</option>' +
      matching.map(a => '<option value="' + esc(a.id) + '">' + esc(a.label) + '</option>').join('');
    guidanceBanner.hidden = true;
    if (gbRagRow) gbRagRow.hidden = true;
  });
}

if (selWorkload) {
  selWorkload.addEventListener('change', () => {
    const id = selWorkload.value;
    if (!id) {
      guidanceBanner.hidden = true;
      if (gbRagRow) gbRagRow.hidden = true;
      return;
    }
    const arch = ARCHETYPES.find(a => a.id === id);
    if (!arch) return;

    gbTier.textContent = arch.recommendedTier;
    gbText.textContent = arch.guidance;
    if (arch.recommendedRagArchitecture && arch.ragArchitectureLabel) {
      gbRagLabel.textContent = arch.ragArchitectureLabel;
      gbRagRow.hidden = false;
    } else {
      gbRagRow.hidden = true;
    }
    guidanceBanner.hidden = false;

    selectJob(arch.job);
  });
}

let jobs = [];

function post(m) { vscode.postMessage(m); }

function selectJob(job) {
  document.querySelectorAll('.job').forEach(b =>
    b.classList.toggle('on', b.getAttribute('data-job') === job));
  document.querySelectorAll('.jdetail').forEach(d =>
    d.hidden = d.getAttribute('data-for') !== job);
  post({ type: 'selectJob', job });
}

document.getElementById('jobs').addEventListener('click', e => {
  const b = e.target.closest('.job');
  if (b) selectJob(b.getAttribute('data-job'));
});

const FIT_LABEL = {
  native: 'Purpose-built', capable: 'Usable',
  poor: 'Weak', unsupported: 'Cannot'
};
const SOURCE_TITLE = {
  detected: 'Reported by the running server — a measured fact',
  known: 'From our table of known models — accurate but not verified on your machine',
  assumed: 'A guess from the model name — we could not verify this'
};
const SOURCE_LABEL = { detected: 'detected', known: 'known', assumed: 'assumed' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderVerdict(v) {
  const box = $('verdict');
  box.className = 'verdict ' + v.verdict;
  $('vtitle').textContent = v.headline;

  // Provenance travels with the claim, always.
  let head = $('vtitle').parentElement;
  head.querySelectorAll('.badge').forEach(b => b.remove());
  const badge = document.createElement('span');
  badge.className = 'badge ' + v.source;
  badge.textContent = SOURCE_LABEL[v.source] || v.source;
  badge.title = SOURCE_TITLE[v.source] || '';
  head.appendChild(badge);

  $('vwhy').textContent = v.rationale;

  const alts = $('alts');
  alts.innerHTML = '';
  for (const a of (v.alternatives || [])) {
    const row = document.createElement('div');
    row.className = 'alt';
    const id = document.createElement('span');
    id.className = 'aid'; id.textContent = a.id;
    const why = document.createElement('span');
    why.className = 'awhy'; why.textContent = a.why;
    row.appendChild(id); row.appendChild(why);

    const btn = document.createElement('button');
    if (a.installed) {
      btn.className = 'abtn';
      btn.textContent = 'Use for this job';
      btn.onclick = () => post({ type: 'useModel', id: a.id, provider: a.provider });
    } else {
      btn.className = 'abtn ghost';
      btn.textContent = 'Copy install command';
      btn.onclick = () => post({ type: 'copyPull', command: a.pullCommand || ('ollama pull ' + a.id) });
    }
    row.appendChild(btn);
    alts.appendChild(row);
  }
}

function renderModels(models) {
  const tb = $('models');
  tb.innerHTML = '';
  if (!models.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3" class="mdetail">No models found. Is Ollama running, or a cloud provider configured?</td>';
    tb.appendChild(tr);
    return;
  }
  for (const m of models) {
    const tr = document.createElement('tr');

    const c1 = document.createElement('td');
    const nm = document.createElement('span');
    nm.className = 'mid'; nm.textContent = m.id;
    c1.appendChild(nm);
    if (m.isCurrent) {
      const cur = document.createElement('span');
      cur.className = 'cur'; cur.textContent = '● current';
      c1.appendChild(cur);
    }
    const prov = document.createElement('div');
    prov.className = 'mdetail'; prov.textContent = m.providerLabel;
    c1.appendChild(prov);

    const c2 = document.createElement('td');
    const fit = document.createElement('span');
    fit.className = 'fit ' + m.fitness;
    fit.textContent = FIT_LABEL[m.fitness] || m.fitness;
    c2.appendChild(fit);

    const c3 = document.createElement('td');
    const d = document.createElement('div');
    d.className = 'mdetail'; d.textContent = m.detail;
    c3.appendChild(d);
    if (m.nativeJobs && m.nativeJobs.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const j of m.nativeJobs) {
        const ch = document.createElement('span');
        ch.className = 'chip'; ch.textContent = j;
        chips.appendChild(ch);
      }
      c3.appendChild(chips);
    }

    tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3);
    tb.appendChild(tr);
  }
}

window.addEventListener('message', ev => {
  const m = ev.data;
  if (m.type === 'verdict') renderVerdict(m.verdict);
  else if (m.type === 'models') renderModels(m.models);
  else if (m.type === 'status') { $('status').className = 'status'; $('status').textContent = m.text; }
  else if (m.type === 'busy') {
    $('status').className = 'status' + (m.message ? ' busy' : '');
    $('status').textContent = m.message || '';
  }
});

// Build the reference section from the job details already in the DOM, so the
// taxonomy has exactly one source and cannot drift between the two views.
(function buildReference() {
  const body = $('refbody');
  document.querySelectorAll('.jdetail').forEach(d => {
    const job = d.getAttribute('data-for');
    const btn = document.querySelector('.job[data-job="' + job + '"]');
    const item = document.createElement('div');
    item.className = 'refitem';
    const l = document.createElement('div');
    l.className = 'rl'; l.textContent = btn ? btn.textContent : job;
    const p1 = document.createElement('p');
    p1.className = 'rd'; p1.textContent = d.querySelector('.jdoes').textContent;
    const p2 = document.createElement('p');
    p2.className = 'rm';
    p2.textContent = '⚠ ' + d.querySelector('.jmiss').textContent.replace(/^Common mistake\\s*/, '');
    item.appendChild(l); item.appendChild(p1); item.appendChild(p2);
    body.appendChild(item);
  });
})();

// Open on the first job so the panel is never empty.
const first = document.querySelector('.job');
if (first) selectJob(first.getAttribute('data-job'));
</script></body></html>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
function escAttr(s: string): string { return escHtml(s).replace(/`/g, '&#96;'); }
