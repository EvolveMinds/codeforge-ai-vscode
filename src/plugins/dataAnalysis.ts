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
import { GcpClient }        from '../core/gcpClient';
import { AzureClient }      from '../core/azureClient';
import { AwsClient }        from '../core/awsClient';
import { DatabricksClient } from '../core/databricksClient';

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
    const truncated = head.length < stat.size;
    return sniffText(head, filePath, { ext, totalBytes: stat.size, truncated, sampleN });
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Sniff a schema + row sample from an in-memory text head (shared by local files
 * and fetched cloud objects). `ext` decides CSV/TSV vs JSON parsing.
 */
function sniffText(
  head: string,
  virtualPath: string,
  opts: { ext?: string; totalBytes?: number; truncated?: boolean; sampleN?: number } = {},
): DataProfile {
  const ext = (opts.ext ?? path.extname(virtualPath).toLowerCase()) || '.csv';
  const sampleN = opts.sampleN ?? 25;
  const totalBytes = opts.totalBytes ?? Buffer.byteLength(head);
  const base: DataProfile = {
    filePath: virtualPath, ext, binary: false, sizeBytes: totalBytes,
    approxRows: null, delimiter: ',', columns: [], sampleRows: [], inferred: {},
  };
  const lines = head.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return base;

  if (ext === '.json') {
    try {
      const parsed = JSON.parse(opts.truncated ? closeJsonArray(head) : head);
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : null);
      if (arr && arr.length && typeof arr[0] === 'object') {
        const cols = Object.keys(arr[0]);
        const rows = arr.slice(0, sampleN).map((o: Record<string, unknown>) => cols.map(c => String(o[c] ?? '')));
        const inferred: Record<string, string> = {};
        for (let c = 0; c < cols.length; c++) inferred[cols[c]] = inferType(rows.map((r: string[]) => r[c]));
        return { ...base, columns: cols, sampleRows: rows, inferred, approxRows: arr.length };
      }
    } catch { /* not tabular JSON */ }
    return base;
  }

  const delim = ext === '.tsv' ? '\t' : detectDelimiter(lines[0]);
  const columns = splitCsvLine(lines[0], delim);
  const sampleRows = lines.slice(1, 1 + sampleN).map(l => splitCsvLine(l, delim));
  const inferred: Record<string, string> = {};
  for (let c = 0; c < columns.length; c++) {
    inferred[columns[c]] = inferType(sampleRows.map(r => r[c] ?? ''));
  }
  const avgLen = lines.slice(0, 50).reduce((s, l) => s + l.length + 1, 0) / Math.min(lines.length, 50);
  const approxRows = avgLen > 0 ? Math.max(0, Math.round(totalBytes / avgLen) - 1) : null;
  return { ...base, delimiter: delim, columns, sampleRows, inferred, approxRows };
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

// ── Remote sources (databases + cloud) ───────────────────────────────────────
//
// Everything downstream (profileToMarkdown, _buildRequest, _writeOutput) consumes
// a DataProfile, so a remote source only has to produce one. These fetchers reuse
// the extension's EXISTING exported core clients (GcpClient / AzureClient /
// AwsClient / DatabricksClient), each built from the SAME SecretStorage
// credentials the connected plugins use — no cross-plugin coupling, no new deps,
// no new credential storage. Cloud clients cap result size (~1000 rows), which is
// exactly the sample the AI needs; for a full report over the whole table, the
// generated-script path (buildSqlScriptRequest) reads everything locally.

/** A source that isn't a local file — used to name outputs and label the report. */
interface RemoteResult {
  label:      string;       // human label, e.g. "bigquery: SELECT ..."
  outStem:    string;       // filename stem for written outputs
  profile:    DataProfile;  // schema + sample rows in the common shape
}

/** Turn a columns + rows result set into the common DataProfile shape. */
function rowsToProfile(virtualPath: string, columns: string[], rows: string[][], totalRows: number | null): DataProfile {
  const inferred: Record<string, string> = {};
  for (let c = 0; c < columns.length; c++) {
    inferred[columns[c]] = inferType(rows.map(r => r[c] ?? ''));
  }
  return {
    filePath: virtualPath, ext: '.query', binary: false,
    sizeBytes: 0, approxRows: totalRows, delimiter: ',',
    columns, sampleRows: rows.slice(0, 25), inferred,
  };
}

/** Normalise a value (possibly object/null) to a display string for sampling. */
function cell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Flatten an array of row-objects into columns + string rows (union of keys). */
function objectsToRows(objs: Array<Record<string, unknown>>): { columns: string[]; rows: string[][] } {
  const colSet = new Set<string>();
  for (const o of objs.slice(0, 100)) for (const k of Object.keys(o)) colSet.add(k);
  const columns = [...colSet];
  const rows = objs.map(o => columns.map(c => cell(o[c])));
  return { columns, rows };
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
    {
      id: 'aiForge.data.insights',
      title: 'Data: Insights in Chat',
      handler: async (services) => {
        const file = await this._pickDataFile(services);
        if (!file) return;
        const focus = await vscode.window.showInputBox({
          prompt: 'Ask about your data (optional)',
          placeHolder: 'e.g. "what is declining and why?", or leave blank for key insights',
          ignoreFocusOut: true,
        });
        await this._insightsInChat(file, focus || undefined);
      },
    },
    {
      id: 'aiForge.data.analyzeSource',
      title: 'Data: Analyze from Database or Cloud Source',
      handler: async (services) => this._analyzeSource(services),
    },
  ];

  // ── Gemini-style: stream narrative insights into the chat panel ───────────
  // Builds a data-grounded prompt and hands it to the shared chat, so the user
  // reads insights inline AND can ask follow-up questions in the same thread.
  private async _insightsInChat(filePath: string, focus: string | undefined, remote?: RemoteResult): Promise<void> {
    let profile: DataProfile;
    if (remote) {
      profile = remote.profile;
    } else {
      try { profile = sniffDataFile(filePath); }
      catch (e) { vscode.window.showErrorMessage(`Evolve AI: could not read ${path.basename(filePath)}: ${String(e)}`); return; }
    }
    const src = remote ? remote.label : path.basename(filePath);
    const ask = focus
      ? `Answer this about the dataset below, grounded strictly in the data: "${focus}"`
      : `Analyse the dataset below and give the key insights — the most important patterns, trends, ` +
        `outliers, and anything surprising. Be specific with numbers. Call out data-quality issues. ` +
        `End with 2–3 concrete recommendations.`;
    const message =
      `${ask}\n\nAfter your analysis, I may ask you to turn this into an HTML report or a chart — ` +
      `offer that as a next step.\n\n---\nDataset (source: ${src}):\n${profileToMarkdown(profile)}`;
    // Route through the shared chat panel — streams inline + supports follow-ups.
    await vscode.commands.executeCommand('aiForge._sendToChat', message, 'chat');
  }

  // ── The main "analyze" entry: pick file, ask what they want, choose deliverable ──
  private async _analyze(services: IServices, args: unknown[]): Promise<void> {
    // If invoked from a CodeLens on an open data file, args may carry a uri.
    let file = this._uriFromArgs(args) ?? (await this._pickDataFile(services));
    if (!file) return;

    const kindPick = await vscode.window.showQuickPick(
      [
        { label: '$(comment-discussion) Insights in chat', description: 'Narrative analysis inline — ask follow-ups (Gemini-style)', detail: 'insights' },
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
        prompt: kindPick.detail === 'insights' ? 'Ask about your data (optional)' : 'What should the analysis focus on? (optional)',
        placeHolder: 'e.g. "revenue trends and top customers", or leave blank for an overview',
        ignoreFocusOut: true,
      });
    }

    if (kindPick.detail === 'insights') {
      await this._insightsInChat(file, instruction || undefined);
      return;
    }
    await this._run(services, file, kindPick.detail as Deliverable, instruction || undefined);
  }

  // ── Analyze from a database or cloud source ───────────────────────────────
  private async _analyzeSource(services: IServices): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showWarningMessage('Open a folder first — the report is written into your workspace.'); return; }

    const sourcePick = await vscode.window.showQuickPick(
      [
        { label: '$(database) BigQuery (SQL)',        detail: 'bigquery',   description: 'Run SQL on Google BigQuery' },
        { label: '$(database) Databricks SQL',        detail: 'databricks', description: 'Run SQL on a Databricks SQL warehouse' },
        { label: '$(database) Azure Cosmos DB',       detail: 'cosmos',     description: 'Query a Cosmos DB container' },
        { label: '$(database) Azure Log Analytics',   detail: 'loganalytics', description: 'Run a KQL query' },
        { label: '$(database) AWS DynamoDB',          detail: 'dynamodb',   description: 'Scan a DynamoDB table' },
        { label: '$(cloud) Cloud object (S3 / GCS / Azure Blob)', detail: 'object', description: 'Fetch a CSV/JSON object and analyse it' },
        { label: '$(code) Other SQL database (Postgres / MySQL / SQLite / Snowflake …)', detail: 'sqlscript', description: 'Generate a pandas script you run with your own connection' },
      ],
      { placeHolder: 'Which data source?' }
    );
    if (!sourcePick) return;
    const source = sourcePick.detail;

    // Generic SQL DBs → generated script (Layer B). No live connection here.
    if (source === 'sqlscript') { await this._sqlScriptFlow(services, ws.uri.fsPath); return; }

    // Ask what to produce.
    const kindPick = await vscode.window.showQuickPick(
      [
        { label: '$(comment-discussion) Insights in chat', detail: 'insights' },
        { label: '$(graph) HTML report', detail: 'report' },
        { label: '$(list-flat) Profiling summary', detail: 'profile' },
        { label: '$(notebook) Reproducible notebook/script', detail: 'notebook' },
      ],
      { placeHolder: 'What would you like to produce?' }
    );
    if (!kindPick) return;

    let remote: RemoteResult | null;
    try {
      remote = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Evolve AI: fetching data…', cancellable: false },
        () => this._fetchRemote(services, source),
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Evolve AI: could not fetch from ${source}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!remote) return; // user cancelled an input, or not connected

    const instruction = kindPick.detail === 'profile' ? undefined : await vscode.window.showInputBox({
      prompt: kindPick.detail === 'insights' ? 'Ask about your data (optional)' : 'What should the analysis focus on? (optional)',
      ignoreFocusOut: true,
    });
    if (kindPick.detail === 'insights') {
      await this._insightsInChat(ws.uri.fsPath, instruction || undefined, remote);
      return;
    }
    await this._run(services, ws.uri.fsPath, kindPick.detail as Deliverable, instruction || undefined, remote);
  }

  /** Fetch a sample from the chosen cloud source, returning a RemoteResult (or null if not connected / cancelled). */
  private async _fetchRemote(services: IServices, source: string): Promise<RemoteResult | null> {
    const notConnected = (name: string, cmd: string): null => {
      vscode.window.showWarningMessage(
        `${name} is not connected. Run "${cmd}" to configure credentials, then try again.`,
      );
      return null;
    };

    if (source === 'bigquery') {
      const client = await GcpClient.fromSecrets(services.ai);
      if (!client) return notConnected('Google Cloud', 'Evolve AI: Configure GCP Credentials');
      const sql = await vscode.window.showInputBox({ prompt: 'BigQuery SQL', placeHolder: 'SELECT * FROM `project.dataset.table` LIMIT 1000', ignoreFocusOut: true });
      if (!sql) return null;
      const res = await client.runQuery(sql);
      const columns = (res.schema?.fields ?? []).map(f => f.name);
      const rows = (res.rows ?? []).map(r => (r.f ?? []).map(cellObj => cell(cellObj.v)));
      const total = res.totalRows ? parseInt(res.totalRows, 10) : rows.length;
      return { label: 'BigQuery', outStem: 'bigquery-query', profile: rowsToProfile('bigquery://query', columns, rows, total) };
    }

    if (source === 'databricks') {
      const client = await DatabricksClient.fromSecrets(services.ai);
      if (!client) return notConnected('Databricks', 'Evolve AI: Configure Databricks Credentials');
      const warehouses = await client.listWarehouses();
      if (!warehouses.length) { vscode.window.showWarningMessage('No Databricks SQL warehouses found.'); return null; }
      const whPick = await vscode.window.showQuickPick(
        warehouses.map(w => ({ label: w.name, detail: w.id })), { placeHolder: 'Select a SQL warehouse' });
      if (!whPick) return null;
      const sql = await vscode.window.showInputBox({ prompt: 'Databricks SQL', placeHolder: 'SELECT * FROM catalog.schema.table LIMIT 1000', ignoreFocusOut: true });
      if (!sql) return null;
      const res = await client.executeStatement(whPick.detail!, sql);
      if (res.status?.error) throw new Error(res.status.error.message);
      const columns = (res.manifest?.schema.columns ?? []).map(c => c.name);
      const rows = (res.result?.data_array ?? []).map(r => r.map(cell));
      return { label: 'Databricks SQL', outStem: 'databricks-query', profile: rowsToProfile('databricks://query', columns, rows, res.manifest?.total_row_count ?? rows.length) };
    }

    if (source === 'cosmos') {
      const client = await AzureClient.fromSecrets(services.ai);
      if (!client) return notConnected('Azure', 'Evolve AI: Configure Azure Credentials');
      const endpoint  = await vscode.window.showInputBox({ prompt: 'Cosmos DB endpoint', placeHolder: 'https://<account>.documents.azure.com', ignoreFocusOut: true });
      if (!endpoint) return null;
      const key       = await vscode.window.showInputBox({ prompt: 'Cosmos DB primary key', password: true, ignoreFocusOut: true });
      if (!key) return null;
      const database  = await vscode.window.showInputBox({ prompt: 'Database id', ignoreFocusOut: true });
      if (!database) return null;
      const container = await vscode.window.showInputBox({ prompt: 'Container id', ignoreFocusOut: true });
      if (!container) return null;
      const query     = await vscode.window.showInputBox({ prompt: 'Cosmos SQL query', value: 'SELECT * FROM c', ignoreFocusOut: true });
      if (!query) return null;
      const res = await client.queryCosmosDocuments(endpoint, key, database, container, query);
      const { columns, rows } = objectsToRows(res.Documents as Array<Record<string, unknown>>);
      return { label: 'Cosmos DB', outStem: 'cosmos-query', profile: rowsToProfile('cosmos://query', columns, rows, res._count ?? rows.length) };
    }

    if (source === 'loganalytics') {
      const client = await AzureClient.fromSecrets(services.ai);
      if (!client) return notConnected('Azure', 'Evolve AI: Configure Azure Credentials');
      const workspaceId = await vscode.window.showInputBox({ prompt: 'Log Analytics workspace ID', ignoreFocusOut: true });
      if (!workspaceId) return null;
      const kql = await vscode.window.showInputBox({ prompt: 'KQL query', placeHolder: 'AppRequests | take 1000', ignoreFocusOut: true });
      if (!kql) return null;
      const res = await client.queryLogs(workspaceId, kql);
      const table = res.tables?.[0];
      const columns = (table?.columns ?? []).map(c => c.name);
      const rows = (table?.rows ?? []).map(r => r.map(cell));
      return { label: 'Log Analytics', outStem: 'loganalytics-query', profile: rowsToProfile('loganalytics://query', columns, rows, rows.length) };
    }

    if (source === 'dynamodb') {
      const client = await AwsClient.fromSecrets(services.ai);
      if (!client) return notConnected('AWS', 'Evolve AI: Configure AWS Credentials');
      const tables = await client.listDynamoTables();
      if (!tables.length) { vscode.window.showWarningMessage('No DynamoDB tables found.'); return null; }
      const tPick = await vscode.window.showQuickPick(tables, { placeHolder: 'Select a DynamoDB table' });
      if (!tPick) return null;
      const items = await client.scanTable(tPick, 1000);
      const { columns, rows } = objectsToRows(items as Array<Record<string, unknown>>);
      return { label: `DynamoDB: ${tPick}`, outStem: `dynamodb-${tPick}`, profile: rowsToProfile('dynamodb://scan', columns, rows, rows.length) };
    }

    if (source === 'object') {
      return this._fetchObject(services);
    }

    return null;
  }

  /** Fetch a cloud object (S3/GCS/Blob) and run it through the local CSV/JSON sniffer. */
  private async _fetchObject(services: IServices): Promise<RemoteResult | null> {
    const store = await vscode.window.showQuickPick(
      [
        { label: 'Amazon S3', detail: 's3' },
        { label: 'Google Cloud Storage', detail: 'gcs' },
        { label: 'Azure Blob Storage', detail: 'blob' },
      ], { placeHolder: 'Which object store?' });
    if (!store) return null;

    const bucket = await vscode.window.showInputBox({ prompt: store.detail === 'blob' ? 'Container name' : 'Bucket name', ignoreFocusOut: true });
    if (!bucket) return null;
    const objectKey = await vscode.window.showInputBox({ prompt: 'Object key / path (CSV or JSON)', placeHolder: 'data/sales.csv', ignoreFocusOut: true });
    if (!objectKey) return null;

    let text: string;
    if (store.detail === 's3') {
      const c = await AwsClient.fromSecrets(services.ai);
      if (!c) { vscode.window.showWarningMessage('AWS is not connected.'); return null; }
      text = await c.getObject(bucket, objectKey);
    } else if (store.detail === 'gcs') {
      const c = await GcpClient.fromSecrets(services.ai);
      if (!c) { vscode.window.showWarningMessage('Google Cloud is not connected.'); return null; }
      text = await c.getObject(bucket, objectKey);
    } else {
      const c = await AzureClient.fromSecrets(services.ai);
      if (!c) { vscode.window.showWarningMessage('Azure is not connected.'); return null; }
      const account = await vscode.window.showInputBox({ prompt: 'Storage account name', ignoreFocusOut: true });
      if (!account) return null;
      text = await c.downloadBlob(account, bucket, objectKey);
    }

    const profile = sniffText(text, objectKey);
    const stem = path.basename(objectKey, path.extname(objectKey)) || 'object';
    return { label: `${store.label}: ${objectKey}`, outStem: stem, profile };
  }

  /** Layer B: generate a pandas.read_sql analysis script for a generic SQL database. */
  private async _sqlScriptFlow(services: IServices, wsDir: string): Promise<void> {
    const engine = await vscode.window.showQuickPick(
      ['PostgreSQL', 'MySQL / MariaDB', 'SQLite', 'Snowflake', 'SQL Server', 'Other (SQLAlchemy URL)'],
      { placeHolder: 'Which database engine?' });
    if (!engine) return;
    const query = await vscode.window.showInputBox({ prompt: 'SQL query to analyse', placeHolder: 'SELECT * FROM sales', ignoreFocusOut: true });
    if (!query) return;
    const instruction = await vscode.window.showInputBox({ prompt: 'What should the report focus on? (optional)', ignoreFocusOut: true });

    const req: AIRequest = {
      messages: [{ role: 'user', content:
        `Generate a self-contained, runnable Python script that:\n` +
        `1. Connects to a ${engine} database using SQLAlchemy. Read the connection string from an environment ` +
        `variable named DB_URL (do NOT hard-code credentials); include a comment showing the expected URL format ` +
        `for ${engine} and the pip install line for the required driver.\n` +
        `2. Runs this query into a pandas DataFrame via pandas.read_sql:\n\`\`\`sql\n${query}\n\`\`\`\n` +
        `3. Performs a full analysis and writes a single self-contained HTML report (KPI tiles, charts with ` +
        `plotly, tables, and a "Key insights" section) to "db-report.html" in the current directory.\n` +
        (instruction ? `Focus: ${instruction}\n` : '') +
        `Output ONLY the script in one fenced \`\`\`python block.` }],
      system: REPORT_SYSTEM,
      instruction: 'data sql script',
      mode: 'new',
    };

    const output = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Evolve AI: generating database analysis script…' },
      () => services.ai.send(req),
    );
    const { body } = extractCodeBlock(output);
    const outPath = path.join(wsDir, 'db-analysis.py');
    await services.workspace.writeFile(outPath, body, true);
    const run = await vscode.window.showInformationMessage(
      'Evolve AI: database analysis script written to db-analysis.py. Set DB_URL in your environment and run it to produce the report from your full table.',
      'Show How', 'Dismiss');
    if (run === 'Show How') {
      const term = vscode.window.createTerminal('Evolve AI: Data Analysis');
      term.show();
      term.sendText('# 1) pip install the driver shown at the top of db-analysis.py + sqlalchemy pandas plotly');
      term.sendText('# 2) set DB_URL to your connection string, e.g.:');
      term.sendText('#    export DB_URL="postgresql+psycopg2://user:pass@host:5432/dbname"   (mac/linux)');
      term.sendText('#    $env:DB_URL = "postgresql+psycopg2://user:pass@host:5432/dbname"   (PowerShell)');
      term.sendText('# 3) python db-analysis.py');
    }
  }

  // ── Core: sniff → build prompt → call AI → write output next to the data ──
  // For a local file, `filePath` is the data path. For a remote source, pass a
  // pre-built `remote` and `filePath` is the folder to write outputs into.
  private async _run(
    services: IServices,
    filePath: string,
    kind: Deliverable,
    instruction: string | undefined,
    remote?: RemoteResult,
  ): Promise<void> {
    const displayName = remote ? remote.label : path.basename(filePath);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Evolve AI: analysing ${displayName}…`, cancellable: true },
      async (progress, token) => {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());

        progress.report({ message: 'Reading data schema…' });
        let profile: DataProfile;
        if (remote) {
          profile = remote.profile;
        } else {
          try {
            profile = sniffDataFile(filePath);
          } catch (e) {
            vscode.window.showErrorMessage(`Evolve AI: could not read ${path.basename(filePath)}: ${String(e)}`);
            return;
          }
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

        // Remote sources already hold the fetched rows in `profile`; the AI works
        // from that sample directly (a generated script can't re-read a query the
        // way it re-reads a local file). Local files may fall back to a script for
        // large data. `notebook` always generates a script.
        const useScript = remote
          ? kind === 'notebook'
          : (kind === 'notebook' || !isSmallEnoughForDirect(profile));
        const req = this._buildRequest(profile, kind, instruction, useScript, remote);

        progress.report({ message: useScript ? 'Generating analysis script…' : 'Building report…' });
        let output = '';
        for await (const chunk of services.ai.stream({ ...req, signal: abort.signal })) {
          if (token.isCancellationRequested) return;
          output += chunk;
        }
        if (token.isCancellationRequested || !output.trim()) return;

        // Where to write: next to the local file, or into the workspace for a
        // remote source (synthetic path → dirname = workspace, stem = outStem).
        const outAnchor = remote
          ? path.join(filePath, `${remote.outStem}.data`)
          : filePath;
        await this._writeOutput(services, outAnchor, kind, useScript, output);
      }
    );
  }

  private _buildRequest(p: DataProfile, kind: Deliverable, instruction: string | undefined, useScript: boolean, remote?: RemoteResult): AIRequest {
    const dataMd = profileToMarkdown(p);
    const focus  = instruction ? `\n\nUser's focus: ${instruction}` : '';
    const abspath = p.filePath.replace(/\\/g, '/');

    // For a remote source, the sample below is the data — a script can't re-read
    // a query as a file. A remote notebook should reconstruct the fetch itself.
    if (remote) {
      const notebookHint = kind === 'notebook'
        ? `Generate a reproducible Python script that reconnects to the source (${remote.label}) using the ` +
          `appropriate client library and credentials from the environment, re-runs the query/fetch, then does ` +
          `a full exploratory analysis and writes an HTML report. Do NOT hard-code credentials. Output one fenced code block only.`
        : kind === 'report'
        ? `Produce a single self-contained HTML report for this dataset (source: ${remote.label}) — KPI tiles, ` +
          `appropriate charts, tables, and a short "Key insights" narrative. Ground every number strictly in the ` +
          `provided rows. Output ONLY the HTML inside one fenced \`\`\`html block.`
        : `Produce a concise Markdown profiling summary for this dataset (source: ${remote.label}): per-column ` +
          `type, null counts, numeric stats, distinct/top values, correlations, and data-quality issues. Base ` +
          `everything strictly on the provided rows.`;
      return {
        messages: [{ role: 'user', content: `${notebookHint}${focus}\n\n---\nDataset (from ${remote.label}):\n${dataMd}` }],
        system: REPORT_SYSTEM,
        instruction: `data ${kind} (remote)`,
        mode: 'new',
      };
    }

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
