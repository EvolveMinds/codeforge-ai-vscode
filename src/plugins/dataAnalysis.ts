/**
 * plugins/dataAnalysis.ts — Data Analysis & Reporting plugin for Evolve AI
 *
 * "Give me your data and I'll analyse it and build a report" — a PowerBI-style
 * flow adapted to a coding assistant. The plugin never becomes a BI engine:
 * it reads a schema + sample from the user's data file and asks the active AI
 * provider to produce one of three deliverables:
 *   - a self-contained HTML report (KPI tiles, charts, narrative insights)
 *   - a reproducible analysis script/notebook (pandas + plotly, .py / .ipynb)
 *   - a data profiling summary (types, nulls, distributions, correlations)
 *
 * Size-adaptive execution:
 *   - small file  → the AI reads the sample and writes the finished report
 *   - large file  → the AI generates a script that reads the FULL file locally
 *                   and writes the report; the user's full dataset never leaves
 *                   the machine.
 *
 * Dependency-free: the plugin sniffs CSV/TSV/JSON headers + a row sample with a
 * tiny hand-rolled parser (no npm parser added). Excel/Parquet are binary, so
 * for those the plugin asks the AI to generate the loader code instead of
 * sniffing. The heavy lifting (parsing the full dataset) always happens in the
 * generated Python, which the user runs.
 *
 * Contributes:
 *  - detect       : workspace contains .csv/.tsv/.json/.xlsx/.parquet
 *  - commands     : analyze, profile, report, notebook
 *  - codeLensActions: "Analyze this data" above the header row of a .csv/.tsv
 *  - systemPromptSection: data-analysis / reporting domain knowledge
 *  - statusItem   : shows how many data files were detected
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import type {
  IPlugin,
  PluginCommand,
  PluginCodeLensAction,
  PluginStatusItem,
} from '../core/plugin';
import type { IServices } from '../core/services';
import type { AIRequest } from '../core/aiService';

// ── Detection ───────────────────────────────────────────────────────────────

const DATA_EXTENSIONS = ['.csv', '.tsv', '.parquet', '.xlsx', '.xls'];
// .json is data-ish but very common as config; only count it when it looks tabular.
const MAX_SCAN = 200;

/** Recursively collect data files (bounded), skipping heavy/irrelevant dirs. */
function findDataFiles(wsPath: string, limit = MAX_SCAN): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', 'out', 'dist', 'bin', '.vscode-test', '__pycache__', 'venv', '.venv']);
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 5) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (DATA_EXTENSIONS.includes(ext)) out.push(path.join(dir, e.name));
      }
    }
  };
  walk(wsPath, 0);
  return out;
}

// ── Dependency-free tabular sniffer ─────────────────────────────────────────

interface DataProfile {
  filePath:    string;
  ext:         string;
  binary:      boolean;              // xlsx/parquet — cannot sniff, AI generates loader
  sizeBytes:   number;
  approxRows:  number | null;        // estimated total rows (from bytes/avg-line), null if binary
  delimiter:   string;               // ',' or '\t'
  columns:     string[];
  sampleRows:  string[][];           // first N data rows, cells as strings
  inferred:    Record<string, string>; // column → inferred type
}

/** Split a CSV line respecting simple double-quote quoting. Good enough for a sample. */
function splitCsvLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      cells.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

function inferType(values: string[]): string {
  const nonEmpty = values.filter(v => v !== '' && v != null);
  if (nonEmpty.length === 0) return 'empty';
  const isInt   = nonEmpty.every(v => /^-?\d+$/.test(v));
  if (isInt) return 'integer';
  const isFloat = nonEmpty.every(v => /^-?\d*\.?\d+([eE][-+]?\d+)?$/.test(v));
  if (isFloat) return 'number';
  const isBool  = nonEmpty.every(v => /^(true|false|yes|no|0|1)$/i.test(v));
  if (isBool) return 'boolean';
  const isDate  = nonEmpty.every(v => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T].*)?$/.test(v) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(v));
  if (isDate) return 'date';
  return 'string';
}

/** Read a schema + row sample from a data file without any external parser. */
function sniffDataFile(filePath: string, sampleN = 25): DataProfile {
  const ext  = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const base: DataProfile = {
    filePath, ext, binary: false, sizeBytes: stat.size,
    approxRows: null, delimiter: ',', columns: [], sampleRows: [], inferred: {},
  };

  if (ext === '.xlsx' || ext === '.xls' || ext === '.parquet') {
    // Binary — cannot read here; the AI will generate loader code (pandas.read_excel / read_parquet).
    return { ...base, binary: true };
  }

  // Read only the head of the file for the sample (avoid loading huge files).
  const fd = fs.openSync(filePath, 'r');
  try {
    const bufSize = Math.min(stat.size, 256 * 1024); // up to 256KB head
    const buf = Buffer.alloc(bufSize);
    fs.readSync(fd, buf, 0, bufSize, 0);
    const head = buf.toString('utf8');
    const lines = head.split(/\r?\n/).filter(l => l.length > 0);
    if (lines.length === 0) return base;

    if (ext === '.json') {
      // Tabular JSON = array of flat objects. Sniff keys from the first object(s).
      try {
        const parsed = JSON.parse(head.length < stat.size ? closeJsonArray(head) : head);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : null);
        if (arr && arr.length && typeof arr[0] === 'object') {
          const cols = Object.keys(arr[0]);
          const rows = arr.slice(0, sampleN).map((o: Record<string, unknown>) => cols.map(c => String(o[c] ?? '')));
          const inferred: Record<string, string> = {};
          for (let c = 0; c < cols.length; c++) inferred[cols[c]] = inferType(rows.map((r: string[]) => r[c]));
          return { ...base, columns: cols, sampleRows: rows, inferred, approxRows: arr.length };
        }
      } catch { /* not tabular JSON — fall through, treat as non-tabular */ }
      return base;
    }

    // CSV / TSV
    const delim = ext === '.tsv' ? '\t' : detectDelimiter(lines[0]);
    const columns = splitCsvLine(lines[0], delim);
    const sampleRows = lines.slice(1, 1 + sampleN).map(l => splitCsvLine(l, delim));
    const inferred: Record<string, string> = {};
    for (let c = 0; c < columns.length; c++) {
      inferred[columns[c]] = inferType(sampleRows.map(r => r[c] ?? ''));
    }
    // Estimate total rows from average sampled line length.
    const avgLen = lines.slice(0, 50).reduce((s, l) => s + l.length + 1, 0) / Math.min(lines.length, 50);
    const approxRows = avgLen > 0 ? Math.max(0, Math.round(stat.size / avgLen) - 1) : null;
    return { ...base, delimiter: delim, columns, sampleRows, inferred, approxRows };
  } finally {
    fs.closeSync(fd);
  }
}

/** If we only read a slice of a big JSON array, close it so JSON.parse succeeds on the head. */
function closeJsonArray(head: string): string {
  const lastComplete = head.lastIndexOf('}');
  if (lastComplete === -1) return head;
  return head.slice(0, lastComplete + 1) + ']';
}

function detectDelimiter(headerLine: string): string {
  const commas = (headerLine.match(/,/g) || []).length;
  const tabs   = (headerLine.match(/\t/g) || []).length;
  const semis  = (headerLine.match(/;/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

// ── Prompt building ─────────────────────────────────────────────────────────

/** Render the sniffed schema + sample as compact markdown for the AI prompt. */
function profileToMarkdown(p: DataProfile): string {
  if (p.binary) {
    return `File: \`${path.basename(p.filePath)}\` (${p.ext}, ${(p.sizeBytes / 1024).toFixed(0)} KB)\n` +
      `This is a BINARY ${p.ext} file — the schema was not read directly. Generate code that loads it ` +
      `(pandas.read_excel / read_parquet) and inspects the schema at runtime.`;
  }
  const rows = p.approxRows != null ? `~${p.approxRows.toLocaleString()} rows (estimated)` : 'unknown rows';
  const schema = p.columns.map(c => `- \`${c}\` (${p.inferred[c] ?? 'string'})`).join('\n');
  const sampleTable = [
    '| ' + p.columns.join(' | ') + ' |',
    '| ' + p.columns.map(() => '---').join(' | ') + ' |',
    ...p.sampleRows.slice(0, 15).map(r => '| ' + p.columns.map((_, i) => (r[i] ?? '').slice(0, 40)).join(' | ') + ' |'),
  ].join('\n');
  return `File: \`${path.basename(p.filePath)}\` · ${(p.sizeBytes / 1024).toFixed(0)} KB · ${rows} · ${p.columns.length} columns\n\n` +
    `Schema:\n${schema}\n\nSample (first ${Math.min(15, p.sampleRows.length)} rows):\n${sampleTable}`;
}

/** Heuristic: can the AI reasonably analyse the sample directly, or must it generate a script? */
function isSmallEnoughForDirect(p: DataProfile): boolean {
  if (p.binary) return false;                        // can't sample binary here
  if (p.approxRows == null) return false;
  return p.approxRows <= 500 && p.sizeBytes <= 200 * 1024;
}

const REPORT_SYSTEM =
  'You are a senior data analyst and BI report builder. You produce clear, accurate, decision-ready ' +
  'analysis. When asked for an HTML report, you output a single self-contained HTML document ' +
  '(inline CSS, inline JS, no external network calls unless explicitly allowed) with: a header, ' +
  'KPI/summary tiles, appropriate charts (inline SVG for simple charts; only use a JS charting ' +
  'approach when the data genuinely needs interactivity, and keep it dependency-light), data tables ' +
  'where useful, and a short written "Key insights" narrative grounded ONLY in the provided data. ' +
  'Never invent numbers you were not given. When generating Python, use pandas + plotly/matplotlib, ' +
  'make the script self-contained and runnable, read the real file path, and write outputs next to it.';

// ── Plugin ──────────────────────────────────────────────────────────────────

export class DataAnalysisPlugin implements IPlugin {
  readonly id          = 'dataAnalysis';
  readonly displayName = 'Data Analysis & Reporting';
  readonly icon        = '$(graph)';

  private _wsPath   = '';
  private _fileCount = 0;

  async detect(ws: vscode.WorkspaceFolder | undefined): Promise<boolean> {
    if (!ws) return false;
    this._wsPath = ws.uri.fsPath;
    const files = findDataFiles(this._wsPath, 20);
    this._fileCount = files.length;
    return files.length > 0;
  }

  async activate(_services: IServices, _vsCtx: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
    console.log(`[Evolve AI] Data Analysis plugin activated: ${this._fileCount} data file(s) detected`);
    return [];
  }

  // ── Domain knowledge injected into the system prompt when active ──────────
  systemPromptSection(): string {
    return [
      '## Data Analysis & Reporting',
      'The workspace contains tabular data files. When the user asks to analyse data or build a report:',
      '- Ground every number in the actual data — never fabricate figures or trends.',
      '- Prefer a clear structure: summary/KPIs first, then breakdowns, then a short insights narrative.',
      '- For HTML reports, emit ONE self-contained file (inline styles/scripts, offline-friendly).',
      '- For reproducible analysis, emit a runnable pandas script/notebook that reads the real file.',
      '- Call out data-quality issues you can see (nulls, outliers, inconsistent types) honestly.',
    ].join('\n');
  }

  // ── Status bar ────────────────────────────────────────────────────────────
  readonly statusItem: PluginStatusItem = {
    text: async () => this._fileCount > 0 ? `$(graph) ${this._fileCount} data file(s)` : '',
  };

  // ── CodeLens: "Analyze this data" above rows of a CSV/TSV ─────────────────
  readonly codeLensActions: PluginCodeLensAction[] = [
    {
      // A line that looks like delimited tabular data (a value, a delimiter, more values)
      linePattern: /^[^\n,;\t]+[,;\t].+$/,
      languages:   ['csv', 'tsv', 'tab-separated-values'],
      title:       '$(graph) Analyze this data',
      command:     'aiForge.data.analyze',
      tooltip:     'Analyse this dataset and generate a report',
    },
  ];

  // ── Commands ──────────────────────────────────────────────────────────────
  readonly commands: PluginCommand[] = [
    {
      id: 'aiForge.data.analyze',
      title: 'Data: Analyze & Report',
      handler: async (services, ...args) => this._analyze(services, args),
    },
    {
      id: 'aiForge.data.profile',
      title: 'Data: Profile Dataset',
      handler: async (services) => {
        const file = await this._pickDataFile(services);
        if (!file) return;
        await this._run(services, file, 'profile', undefined);
      },
    },
    {
      id: 'aiForge.data.report',
      title: 'Data: Generate HTML Report',
      handler: async (services) => {
        const file = await this._pickDataFile(services);
        if (!file) return;
        const instruction = await vscode.window.showInputBox({
          prompt: 'What should the report focus on? (optional)',
          placeHolder: 'e.g. "sales trends by region and month", or leave blank for an overview',
          ignoreFocusOut: true,
        });
        await this._run(services, file, 'report', instruction || undefined);
      },
    },
    {
      id: 'aiForge.data.notebook',
      title: 'Data: Generate Analysis Notebook/Script',
      handler: async (services) => {
        const file = await this._pickDataFile(services);
        if (!file) return;
        const instruction = await vscode.window.showInputBox({
          prompt: 'What analysis should the script perform? (optional)',
          placeHolder: 'e.g. "cohort retention and revenue by plan", or leave blank for a full EDA',
          ignoreFocusOut: true,
        });
        await this._run(services, file, 'notebook', instruction || undefined);
      },
    },
  ];

  // ── The main "analyze" entry: pick file, ask what they want, choose deliverable ──
  private async _analyze(services: IServices, args: unknown[]): Promise<void> {
    // If invoked from a CodeLens on an open data file, args may carry a uri.
    let file = this._uriFromArgs(args) ?? (await this._pickDataFile(services));
    if (!file) return;

    const kindPick = await vscode.window.showQuickPick(
      [
        { label: '$(graph) HTML report', description: 'PowerBI-style: KPI tiles, charts, insights', detail: 'report' },
        { label: '$(notebook) Analysis notebook/script', description: 'Reproducible pandas + plotly (.py / .ipynb)', detail: 'notebook' },
        { label: '$(list-flat) Profiling summary', description: 'Types, nulls, distributions, correlations', detail: 'profile' },
      ],
      { placeHolder: 'What would you like Evolve AI to produce?' }
    );
    if (!kindPick) return;

    let instruction: string | undefined;
    if (kindPick.detail !== 'profile') {
      instruction = await vscode.window.showInputBox({
        prompt: 'What should the analysis focus on? (optional)',
        placeHolder: 'e.g. "revenue trends and top customers", or leave blank for an overview',
        ignoreFocusOut: true,
      });
    }
    await this._run(services, file, kindPick.detail as Deliverable, instruction || undefined);
  }

  // ── Core: sniff → build prompt → call AI → write output next to the data ──
  private async _run(services: IServices, filePath: string, kind: Deliverable, instruction: string | undefined): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Evolve AI: analysing ${path.basename(filePath)}…`, cancellable: true },
      async (progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());

        progress.report({ message: 'Reading data schema…' });
        let profile: DataProfile;
        try {
          profile = sniffDataFile(filePath);
        } catch (e) {
          vscode.window.showErrorMessage(`Evolve AI: could not read ${path.basename(filePath)}: ${String(e)}`);
          return;
        }

        const direct = kind !== 'notebook' && isSmallEnoughForDirect(profile);

        // Privacy note when a data sample would be sent to a cloud provider.
        if (direct) {
          const provider = await services.ai.detectProvider();
          const isCloud = ['anthropic', 'openai', 'gemini', 'zai', 'huggingface'].includes(provider);
          if (isCloud) {
            const ok = await vscode.window.showWarningMessage(
              `A sample of "${path.basename(filePath)}" will be sent to the ${provider} cloud API to build the report. ` +
              `For sensitive data, cancel and use a local provider (Ollama/Gemma 4/GLM), or generate a script instead (nothing leaves your machine).`,
              { modal: true }, 'Send Sample', 'Generate Script Instead', 'Cancel'
            );
            if (ok === 'Cancel' || !ok) return;
            if (ok === 'Generate Script Instead') { kind = 'notebook'; }
          }
        }

        const useScript = kind === 'notebook' || !isSmallEnoughForDirect(profile);
        const req = this._buildRequest(profile, kind, instruction, useScript);

        progress.report({ message: useScript ? 'Generating analysis script…' : 'Building report…' });
        let output = '';
        for await (const chunk of services.ai.stream({ ...req, signal: abort.signal })) {
          if (token.isCancellationRequested) return;
          output += chunk;
        }
        if (token.isCancellationRequested || !output.trim()) return;

        await this._writeOutput(services, filePath, kind, useScript, output);
      }
    );
  }

  private _buildRequest(p: DataProfile, kind: Deliverable, instruction: string | undefined, useScript: boolean): AIRequest {
    const dataMd = profileToMarkdown(p);
    const focus  = instruction ? `\n\nUser's focus: ${instruction}` : '';
    const abspath = p.filePath.replace(/\\/g, '/');

    let task: string;
    if (kind === 'profile') {
      task = useScript
        ? `Generate a self-contained Python script (pandas) that profiles this dataset: dtypes, non-null counts, ` +
          `descriptive stats, cardinality, top values for categoricals, correlations for numerics, and flags ` +
          `likely data-quality issues. It must read the real file at "${abspath}" and print a clear report. ` +
          `Output the script as a fenced \`\`\`python block only.`
        : `Produce a concise data profiling summary in Markdown for this dataset: per-column type, null counts, ` +
          `min/max/mean for numerics, distinct counts and top values for categoricals, notable correlations, ` +
          `and any data-quality issues you can see. Base everything strictly on the provided sample.`;
    } else if (kind === 'report') {
      task = useScript
        ? `Generate a self-contained Python script (pandas + plotly) that reads the FULL dataset at "${abspath}", ` +
          `computes the key metrics, and writes a single self-contained HTML report file next to it ` +
          `(same folder, named "${path.basename(p.filePath, p.ext)}-report.html"). The report must include KPI ` +
          `tiles, appropriate charts, tables, and a short "Key insights" section. Output the script as a fenced ` +
          `\`\`\`python block only.`
        : `Produce a single self-contained HTML report document for this dataset — KPI/summary tiles, ` +
          `appropriate charts (inline SVG for simple ones; a light JS approach only if interactivity is truly ` +
          `needed), data tables where useful, and a short "Key insights" narrative. Ground every number strictly ` +
          `in the provided sample. Output ONLY the HTML inside a single fenced \`\`\`html block.`;
    } else { // notebook
      task =
        `Generate a reproducible analysis notebook for this dataset as Jupyter percent-format ` +
        `(\`# %%\` cell markers) OR a clean .py script — your choice, but make it runnable. It must: read the ` +
        `real file at "${abspath}", do a full exploratory analysis (shape, dtypes, missingness, distributions, ` +
        `correlations), create the most relevant charts with plotly or matplotlib, and end by writing an HTML ` +
        `report next to the data. Use pandas. Output the notebook/script as a single fenced code block only.`;
    }

    return {
      messages: [{ role: 'user', content: `${task}${focus}\n\n---\nDataset:\n${dataMd}` }],
      system: REPORT_SYSTEM,
      instruction: `data ${kind}`,
      mode: 'new',
    };
  }

  /** Write the AI output to a sensibly-named file next to the source data, then open it. */
  private async _writeOutput(services: IServices, dataPath: string, kind: Deliverable, useScript: boolean, raw: string): Promise<void> {
    const dir  = path.dirname(dataPath);
    const stem = path.basename(dataPath, path.extname(dataPath));

    const { body, lang } = extractCodeBlock(raw);

    let outName: string;
    if (useScript || kind === 'notebook') {
      // A script/notebook was generated.
      outName = lang === 'html'
        ? `${stem}-report.html`
        : `${stem}-analysis.py`;
    } else if (kind === 'report') {
      outName = `${stem}-report.html`;
    } else {
      outName = `${stem}-profile.md`;
    }

    const outPath = path.join(dir, outName);
    await services.workspace.writeFile(outPath, body, /*openAfter*/ true);

    // For an HTML report, offer to open it in the browser too.
    if (outName.endsWith('.html')) {
      const open = await vscode.window.showInformationMessage(
        `Evolve AI: report written to ${outName}`, 'Open in Browser', 'Reveal'
      );
      if (open === 'Open in Browser') {
        await vscode.env.openExternal(vscode.Uri.file(outPath));
      } else if (open === 'Reveal') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outPath));
      }
    } else if (outName.endsWith('.py')) {
      const run = await vscode.window.showInformationMessage(
        `Evolve AI: analysis script written to ${outName}. Run it to produce the report from your full dataset.`,
        'Run Now', 'Later'
      );
      if (run === 'Run Now') {
        const term = vscode.window.createTerminal('Evolve AI: Data Analysis');
        term.show();
        term.sendText(`python "${outPath}"`);
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  private async _pickDataFile(services: IServices): Promise<string | undefined> {
    void services;
    const ws = vscode.workspace.workspaceFolders?.[0];
    // Prefer the active editor if it's a data file.
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active && DATA_EXTENSIONS.concat('.json').includes(path.extname(active).toLowerCase())) {
      return active;
    }
    const files = ws ? findDataFiles(ws.uri.fsPath) : [];
    // Also include .json in the picker (they may be tabular).
    const jsonFiles = ws ? findJsonFiles(ws.uri.fsPath) : [];
    const all = [...files, ...jsonFiles];
    if (all.length === 0) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Analyze',
        filters: { Data: ['csv', 'tsv', 'json', 'xlsx', 'xls', 'parquet'] },
      });
      return picked?.[0]?.fsPath;
    }
    const items = all.map(f => ({ label: `$(file) ${path.relative(ws!.uri.fsPath, f)}`, detail: f }));
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Select a data file to analyse' });
    return choice?.detail;
  }

  private _uriFromArgs(args: unknown[]): string | undefined {
    for (const a of args) {
      if (a instanceof vscode.Uri) return a.fsPath;
      if (typeof a === 'string' && /\.(csv|tsv|json|xlsx|xls|parquet)$/i.test(a)) return a;
    }
    // Fall back to active editor when triggered by CodeLens.
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active && DATA_EXTENSIONS.concat('.json').includes(path.extname(active).toLowerCase())) return active;
    return undefined;
  }
}

type Deliverable = 'report' | 'notebook' | 'profile';

/** Extract the first fenced code block; returns its language + body (or the raw text). */
function extractCodeBlock(raw: string): { body: string; lang: string } {
  const m = raw.match(/```([\w-]*)\n([\s\S]*?)```/);
  if (m) return { lang: (m[1] || '').toLowerCase(), body: m[2].trim() };
  return { lang: '', body: raw.trim() };
}

function findJsonFiles(wsPath: string, limit = MAX_SCAN): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', 'out', 'dist', 'bin', '.vscode-test', '__pycache__', 'venv', '.venv']);
  const configish = new Set(['package.json', 'tsconfig.json', 'package-lock.json', 'settings.json', '.eslintrc.json']);
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.name.toLowerCase().endsWith('.json') && !configish.has(e.name.toLowerCase())) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(wsPath, 0);
  return out;
}
