/**
 * plugins/dataAnalysis.ts — Data Analysis & Reporting plugin for Evolve AI
 *
 * "Give me your data and I'll analyse it and build a report" — a PowerBI-style
 * flow adapted to a coding assistant. The plugin never becomes a BI engine:
 * it reads a schema + sample from the user's data file and asks the active AI
 * provider to produce one of three deliverables:
 *   - a self-contained HTML report (KPI tiles, charts, narrative insights)
 *   - a reproducible analysis script/notebook (pandas + matplotlib, .py)
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
import { DataAnalysisPanel } from '../ui/dataAnalysisPanel';
import type {
  WorkspaceDataFile, ReportOptionsCatalog, PanelReportOptions, PanelPrep,
} from '../ui/dataAnalysisPanel';
import { ReportPreviewPanel } from '../ui/reportPreviewPanel';
import { stripJsonComments } from '../core/jsonc';
import {
  loadReportTheme, themeForSpec, defaultSpec, archetypeById,
  REPORT_ARCHETYPES, REPORT_SECTIONS, THEME_FILENAME, THEME_TEMPLATE,
  buildReportPromptBlock, buildScriptPromptBlock,
  injectReportAssets, injectPythonPreamble,
  stashHeavyParts, restoreHeavyParts, hasDanglingImagePlaceholders, buildRefinePrompt,
} from '../core/reportDesign';
import type { ReportSpec, ReportTheme, Audience, ThemeMode } from '../core/reportDesign';
import {
  blocksFromSections, blocksToPrompt, blocksToScriptPrompt, blocksFromHtml,
  makeBlock, describeBlocks, BLOCK_KINDS,
  dataPrepPython, dataPrepPromptFragment, isPrepEmpty, describePrep, EMPTY_PREP,
  saveTemplate, listTemplates, loadTemplate, TEMPLATES_DIR,
} from '../core/reportBlocks';
import { injectDataPrep } from '../core/reportBlocks';
import type { ReportBlock, DataPrep, ReportTemplate, BlockType } from '../core/reportBlocks';
import { extractBlock, buildBlockRefinePrompt } from '../core/reportEditor';
import { assessModelForDataAnalysis, defaultModelFor } from '../core/modelCapability';

// ── Detection ───────────────────────────────────────────────────────────────

const DATA_EXTENSIONS = ['.csv', '.tsv', '.parquet', '.xlsx', '.xls'];
// .json is data-ish but very common as config; only count it when it looks tabular.
const MAX_SCAN = 200;

// Directories that never contain user data (config/build/deps).
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', 'build', 'build-steps', 'bin', '.vscode',
  '.vscode-test', '__pycache__', 'venv', '.venv', 'coverage', 'target', '.next', '.nuxt',
]);
// JSON filenames that are almost always config/metadata, not tabular data.
const CONFIG_JSON = new Set([
  'package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json', 'settings.json',
  'launch.json', 'tasks.json', '.eslintrc.json', 'composer.json', 'manifest.json',
  'angular.json', 'nx.json', 'lerna.json', 'renovate.json', 'now.json', 'vercel.json',
  'babel.config.json', 'components.json', 'evolve-data-pipeline.json',
]);

/** True if a path points at a data file we can analyse (incl. .json). */
function isDataPath(p: string | undefined): boolean {
  if (!p) return false;
  return DATA_EXTENSIONS.concat('.json').includes(path.extname(p).toLowerCase());
}

/** Recursively collect data files (bounded), skipping heavy/irrelevant dirs. */
function findDataFiles(wsPath: string, limit = MAX_SCAN): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 5) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
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
  if (opts.truncated && lines.length > 2) lines.pop();

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

/**
 * Heuristic: can the AI analyse the sample directly, or must it generate a
 * script that reads the full file? The direct path sends only a schema + ~25-row
 * sample, so file size barely matters — what matters is whether numbers computed
 * from a sample would mislead. We allow direct for genuinely small datasets
 * (where the sample ≈ the whole file) and always script larger ones so report
 * aggregates stay accurate.
 */
function isSmallEnoughForDirect(p: DataProfile): boolean {
  if (p.binary) return false;                        // can't sample binary here
  if (p.approxRows == null) return false;
  // ~2000 rows or ~1MB: the sample is representative enough for a direct look,
  // and small enough that sample-based aggregates aren't wildly off. Larger →
  // accurate full-data script (the panel explains this to the user).
  return p.approxRows <= 2000 && p.sizeBytes <= 1024 * 1024;
}

// Rules that make generated Python actually run on a fresh machine against
// messy real-world data. Appended to every script-generation task.
const SCRIPT_RULES = [
  'The script MUST run as-is on a clean machine with only Python installed. Follow ALL of these:',
  '1. Dependencies: at the very top, auto-install any needed packages before importing them, e.g.:',
  '   `import subprocess, sys`',
  '   `for pkg in ["pandas", "matplotlib"]:`',
  '   `    try: __import__(pkg)`',
  '   `    except ImportError: subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", pkg])`',
  '   Use pandas + matplotlib for charts (matplotlib is far more commonly installed than plotly — do NOT use plotly). Read Excel/Parquet only if the source needs it (openpyxl / pyarrow), installing them the same way.',
  '2. Correlations: NEVER call df.corr() on the whole frame. Use `df.corr(numeric_only=True)` and skip it if there are <2 numeric columns.',
  '3. Coerce stringy-numeric columns before math: values like "50+", "1,000+", "$4.99", "10M" are common. Strip non-numeric characters and use `pd.to_numeric(series, errors="coerce")`; only aggregate columns that successfully convert.',
  '4. Wrap every risky step (a chart, a stat, a parse) in try/except so one bad column never aborts the whole report — print a short note and continue.',
  '5. Never assume a column exists — check `if col in df.columns` first.',
  '6. For charts, embed matplotlib figures into the HTML as base64-encoded <img> tags (savefig to a BytesIO, base64) so the HTML report is fully self-contained with no external files. When the injected `evolve_fig(fig, caption, title)` helper is available, call it instead of hand-rolling this.',
  '7. Print a clear final line with the absolute path of any file written.',
  '8. F-STRING SAFETY (critical): in Python < 3.12, an f-string expression `{...}` MUST NOT contain ANY backslash (no \\d, \\n, \\s, regex, paths, or quotes with escapes inside `{...}`). ' +
    'Calculate all aggregations, regex replacements, and cleanups in a separate variable on its own line FIRST (e.g. `total_installs = evolve_num(df[\'Installs\'].str.replace(r\'[^\\d]\', \'\', regex=True).astype(int).sum())`), ' +
    'then reference only the plain variable `{total_installs}` inside the f-string.',
  '9. Write files with an explicit encoding: `open(path, "w", encoding="utf-8")`. Use `matplotlib.use("Agg")` before importing pyplot so it works headless.',
].join('\n');

const REPORT_SYSTEM =
  'You are a senior data analyst and BI report builder. You produce clear, accurate, decision-ready ' +
  'analysis. When asked for an HTML report, you output a single self-contained HTML document ' +
  '(inline CSS, inline JS, no external network calls) with: a header, KPI/summary tiles, appropriate ' +
  'charts, data tables where useful, and a short written "Key insights" narrative grounded ONLY in the ' +
  'provided data. Never invent numbers you were not given. ' +
  'When you generate a Python SCRIPT, it must be robust and self-contained — auto-install its own ' +
  'dependencies (pandas + matplotlib, never plotly), use df.corr(numeric_only=True), coerce ' +
  'stringy-numeric columns with pd.to_numeric(errors="coerce"), guard every risky step in try/except, ' +
  'and read the real file path. The script must run as-is on a clean machine.';

// ── Plugin ──────────────────────────────────────────────────────────────────

export class DataAnalysisPlugin implements IPlugin {
  readonly id          = 'dataAnalysis';
  readonly displayName = 'Data Analysis & Reporting';
  readonly icon        = '$(graph)';

  private _wsPath   = '';
  private _fileCount = 0;
  /**
   * Data preparation for the run being configured. Filters and derived columns
   * are applied for real — deterministically in the generated script, and to
   * the sampled rows on the direct path — rather than described to the model.
   */
  private _prep: DataPrep = { ...EMPTY_PREP };
  /** Spacing, live-adjustable from the preview's Design tab. */
  private _density: 'comfortable' | 'compact' = 'comfortable';
  /** Extension storage, where the editable preview copy lives. */
  private _storageDir = '';

  async detect(ws: vscode.WorkspaceFolder | undefined): Promise<boolean> {
    // Record how many data files we can see, so the status bar + domain-knowledge
    // injection stay relevant to actual data projects.
    this._wsPath = ws?.uri.fsPath ?? '';
    const activeIsData = isDataPath(vscode.window.activeTextEditor?.document.uri.fsPath);
    this._fileCount = (this._wsPath ? findDataFiles(this._wsPath, 20).length : 0) + (activeIsData ? 1 : 0);

    // Activate whenever a folder is open OR the user is looking at a data file.
    // The plugin's commands (Analyze, Insights, Report, …) are manual actions and
    // should always be reachable — never dead-end on the "plugin not active"
    // popup just because no CSV happens to sit in the workspace root. The
    // status bar and prompt-injection remain conditional on _fileCount below.
    return !!ws || activeIsData;
  }

  async activate(_services: IServices, vsCtx: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
    // The editable preview copy lives here rather than beside the user's data,
    // so edit-mode chrome never lands in their workspace.
    this._storageDir = vsCtx.globalStorageUri.fsPath;
    this._density = this._theme().density;
    console.log(`[Evolve AI] Data Analysis plugin activated: ${this._fileCount} data file(s) detected`);
    return [];
  }

  // ── Domain knowledge injected into the system prompt when active ──────────
  // Only inject when the project actually has data files, so non-data projects
  // (where the plugin stays active purely to keep the Analyse action available)
  // don't get their prompts polluted.
  systemPromptSection(): string {
    if (this._fileCount === 0) return '';
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
        if (instruction === undefined) return;
        const spec = await this._specForRun(instruction || undefined);
        if (spec === 'cancelled') return;
        await this._run(services, file, 'report', instruction || undefined, undefined, spec);
      },
    },
    {
      id: 'aiForge.data.refineReport',
      title: 'Data: Refine HTML Report',
      handler: async (services, ...args) => this._refineExisting(services, args),
    },
    {
      id: 'aiForge.data.createReportTheme',
      title: 'Data: Create Report Theme (branding)',
      handler: async () => this._createTheme(),
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
    {
      id: 'aiForge.data.runTemplate',
      title: 'Data: Run Report Template',
      handler: async (services) => this._runTemplate(services),
    },
    {
      id: 'aiForge.data.manageTemplates',
      title: 'Data: Manage Report Templates',
      handler: async () => {
        const ws = vscode.workspace.workspaceFolders?.[0];
        const templates = listTemplates(ws?.uri.fsPath);
        if (!templates.length) {
          vscode.window.showInformationMessage(
            `No report templates yet — build a report and use "Save as template" in the preview.`);
          return;
        }
        const pick = await vscode.window.showQuickPick(
          templates.map(t => ({ label: t.tpl.name, description: t.tpl.description, file: t.file })),
          { placeHolder: 'Open a template to edit it by hand' });
        if (!pick) return;
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(pick.file)));
      },
    },
    {
      id: 'aiForge.data.createPipeline',
      title: 'Data: Create Data Pipeline',
      handler: async (services) => this._createPipeline(services),
    },
    {
      id: 'aiForge.data.runPipeline',
      title: 'Data: Run Data Pipeline',
      handler: async (services, ...args) => this._runPipeline(services, args),
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
      try { profile = this._applyPrepToProfile(sniffDataFile(filePath)); }
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

  // ── The main "analyze" entry ──────────────────────────────────────────────
  // If a file is already known (Explorer right-click / CodeLens on an open data
  // file), go straight to the fast quick-pick. Otherwise open the friendly panel
  // that lets the user browse for a file anywhere, pick a workspace file, drag &
  // drop, or connect a database/cloud source.
  private async _analyze(services: IServices, args: unknown[]): Promise<void> {
    const known = this._uriFromArgs(args);
    if (known) { await this._directAnalyze(services, known); return; }
    await this._openPanel(services);
  }

  /** Fast path when the data file is already known. */
  private async _directAnalyze(services: IServices, file: string): Promise<void> {
    const kindPick = await vscode.window.showQuickPick(
      [
        { label: '$(comment-discussion) Insights in chat', description: 'Narrative analysis inline — ask follow-ups (Gemini-style)', detail: 'insights' },
        { label: '$(graph) HTML report', description: 'PowerBI-style: KPI tiles, charts, insights', detail: 'report' },
        { label: '$(notebook) Analysis notebook/script', description: 'Reproducible pandas + matplotlib (.py) — auto-installs deps', detail: 'notebook' },
        { label: '$(list-flat) Profiling summary', description: 'Types, nulls, distributions, correlations', detail: 'profile' },
      ],
      { placeHolder: `What would you like Evolve AI to produce from ${path.basename(file)}?` }
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
    if (kindPick.detail === 'insights') { await this._insightsInChat(file, instruction || undefined); return; }
    let spec: ReportSpec | undefined;
    if (kindPick.detail === 'report') {
      const chosen = await this._specForRun(instruction || undefined);
      if (chosen === 'cancelled') return;
      spec = chosen;
    }
    await this._run(services, file, kindPick.detail as Deliverable, instruction || undefined, undefined, spec);
  }

  // ── The friendly entry panel ──────────────────────────────────────────────
  private async _openPanel(services: IServices): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const wsFiles: WorkspaceDataFile[] = [];
    if (ws) {
      const seen = new Set<string>();
      for (const f of [...findDataFiles(ws.uri.fsPath), ...findJsonFiles(ws.uri.fsPath)]) {
        if (seen.has(f)) continue; seen.add(f);
        wsFiles.push({ path: f, rel: path.relative(ws.uri.fsPath, f) });
      }
    }

    // Per-open selection state. The report spec starts from the workspace theme
    // so a project with evolve-report-theme.json opens on its own defaults.
    const theme = this._theme();
    let selectedFile: string | undefined;
    let deliverable: Deliverable | 'insights' = 'insights';
    let focus = '';
    let spec: ReportSpec = defaultSpec(theme);

    const catalog: ReportOptionsCatalog = {
      archetypes: REPORT_ARCHETYPES.map(a => ({ id: a.id, label: a.label, description: a.description, sections: a.sections })),
      sections:   REPORT_SECTIONS.map(s => ({ id: s.id, label: s.label })),
      audiences:  [
        { id: 'mixed',    label: 'Mixed business + technical' },
        { id: 'exec',     label: 'Executives' },
        { id: 'analyst',  label: 'Data analysts' },
        { id: 'engineer', label: 'Data engineers' },
      ],
      blockKinds: BLOCK_KINDS.map(k => ({ type: k.type, label: k.label, icon: k.icon })),
      defaults: {
        archetype: spec.archetype, audience: spec.audience, sections: spec.sections,
        mode: spec.mode, accent: spec.accent, title: spec.title,
      },
    };

    const provider = await services.ai.detectProvider();
    const cfg = vscode.workspace.getConfiguration('aiForge');
    const model = defaultModelFor(provider, cfg);
    let ramGB: number | undefined;
    try {
      const hw = await services.inspector.inspect();
      ramGB = hw.ramGb;
    } catch { /* ignore */ }
    const modelVerdict = assessModelForDataAnalysis(provider, model, ramGB);

    const panel = DataAnalysisPanel.show(wsFiles, catalog, modelVerdict, async (msg) => {
      switch (msg.type) {
        case 'browse':
          await this._openBrowse(panel, (f) => { selectedFile = f; });
          break;
        case 'droppedFile':
        case 'useWorkspaceFile': {
          const p = (msg as { path: string }).path;
          if (p && isDataPath(p)) {
            selectedFile = p;
            panel.setSelected(path.basename(p));
            this._pushSchema(panel, p);
          } else {
            panel.setStatus('That file type isn\'t supported — pick a CSV, Excel, JSON, or Parquet file.');
          }
          break;
        }
        case 'dropFallback':
          // The webview couldn't read a filesystem path from the dropped file
          // (VS Code sandbox). Fall back to the native picker so drop still works.
          panel.setStatus('Opening file picker…');
          await this._openBrowse(panel, (f) => { selectedFile = f; });
          break;
        case 'setDeliverable': deliverable = (msg as { deliverable: Deliverable | 'insights' }).deliverable; break;
        case 'setFocus':       focus = (msg as { focus: string }).focus; break;
        case 'setReportOptions': {
          const o = (msg as { options: PanelReportOptions }).options;
          const arch = archetypeById(o.archetype);
          spec = {
            ...spec,
            archetype: arch.id,
            tone:      arch.tone,
            audience:  o.audience as Audience,
            sections:  o.sections.length ? o.sections : arch.sections,
            maxCharts: Math.min(this._theme().maxCharts, arch.maxCharts),
            mode:      o.mode as ThemeMode,
            accent:    o.accent,
            title:     o.title,
          };
          break;
        }
        case 'setBuilder': {
          // The authored outline supersedes the section chips; prep is applied
          // for real before analysis, so it is kept on the plugin, not the spec.
          const m = msg as { outline: unknown[]; prep: PanelPrep };
          spec = { ...spec, blocks: m.outline ?? [] };
          this._prep = {
            filters: (m.prep?.filters ?? []) as DataPrep['filters'],
            derived: m.prep?.derived ?? [],
            excludeColumns: m.prep?.excludeColumns ?? [],
            dedupe: !!m.prep?.dedupe,
            limit: m.prep?.limit ?? 0,
          };
          break;
        }
        case 'useTemplate': {
          const tpl = await this._pickTemplate();
          if (!tpl) break;
          spec = { ...tpl.spec, focus: focus || tpl.spec.focus };
          this._prep = { ...EMPTY_PREP, ...tpl.prep };
          if (tpl.theme?.density) this._density = tpl.theme.density;
          panel.loadBuilder(spec.blocks ?? [], this._prep);
          panel.setStatus(`Loaded template "${tpl.name}" — ${describeBlocks((spec.blocks ?? []) as ReportBlock[])}.`);
          break;
        }
        case 'editTheme':      await this._createTheme(); break;
        case 'switchModel': {
          await vscode.commands.executeCommand('aiForge.switchProvider');
          const newProvider = await services.ai.detectProvider();
          const newCfg = vscode.workspace.getConfiguration('aiForge');
          const newModel = defaultModelFor(newProvider, newCfg);
          const newVerdict = assessModelForDataAnalysis(newProvider, newModel, ramGB);
          panel.setModelVerdict(newVerdict);
          break;
        }
        case 'connectSource':  await this._analyzeSource(services); break;
        case 'runPipeline':    await this._runPipeline(services, []); break;
        case 'analyze': {
          if (!selectedFile) { panel.setStatus('Choose a data file first.'); return; }
          await this._runFromPanel(services, panel, selectedFile, deliverable, focus || undefined,
            deliverable === 'report' ? { ...spec, focus } : undefined);
          break;
        }
        case 'cancelAnalyze':
          this._panelAbort?.abort();
          break;
      }
    });
  }

  private _panelAbort: AbortController | null = null;

  /**
   * Panel-driven analysis with honest, live feedback. Unlike the interactive
   * quick-pick path (_run), this reports progress INTO the panel, explains when
   * a large file forces the accurate-script route, and offers a one-click run.
   */
  private async _runFromPanel(
    services: IServices,
    panel: DataAnalysisPanel,
    filePath: string,
    kind: Deliverable | 'insights',
    focus: string | undefined,
    spec?: ReportSpec,
  ): Promise<void> {
    const name = path.basename(filePath);

    // Insights → stream to chat (its own surface), quick to kick off.
    if (kind === 'insights') {
      panel.setBusy(`Sending ${name} to chat for insights…`);
      await this._insightsInChat(filePath, focus);
      panel.setBusy(null);
      panel.setStatus(`Insights for ${name} are in the chat panel →`);
      return;
    }

    let profile: DataProfile;
    try { profile = this._applyPrepToProfile(sniffDataFile(filePath)); }
    catch (e) { panel.setBusy(null); panel.setStatus(`✗ Could not read ${name}: ${String(e)}`); return; }

    const small = isSmallEnoughForDirect(profile);
    // report/profile can go direct on a small file; notebook always scripts;
    // a large report/profile becomes an accurate full-data script.
    const useScript = kind === 'notebook' || !small;

    // Tell the user up front what they'll get — no silent .py surprise.
    if (useScript && kind !== 'notebook') {
      const rows = profile.approxRows != null ? `~${profile.approxRows.toLocaleString()} rows` : 'a large file';
      panel.setBusy(
        `${name} is ${rows}. To keep the numbers accurate, Evolve AI is generating a Python script that ` +
        `reads the full file and writes the ${kind === 'report' ? 'HTML report' : 'profile'} — then runs it for you…`,
      );
    } else {
      panel.setBusy(`Building ${kind === 'report' ? 'HTML report' : kind} for ${name}…`);
    }

    // Faster-provider hint for slow local generations.
    const provider = await services.ai.detectProvider();
    if (provider === 'ollama' || provider === 'gemma4' || provider === 'glm') {
      panel.setHint('Tip: local models are thorough but slower on CPU. Switch to a cloud provider (Switch in the chat header) for faster generation — the analysis itself still runs locally in the generated script.');
    } else {
      panel.setHint('');
    }

    // Cloud-consent for a direct send of a sample.
    if (!useScript) {
      const isCloud = ['anthropic', 'openai', 'gemini', 'zai', 'huggingface'].includes(provider);
      if (isCloud) {
        const ok = await vscode.window.showWarningMessage(
          `A sample of "${name}" will be sent to the ${provider} cloud API. For sensitive data, cancel and use a local provider instead.`,
          { modal: true }, 'Send Sample');
        if (ok !== 'Send Sample') { panel.setBusy(null); panel.setStatus('Cancelled.'); return; }
      }
    }

    // Generate with live ticking + cancel.
    this._panelAbort = new AbortController();
    const started = Date.now();
    const tick = setInterval(() => {
      const secs = Math.round((Date.now() - started) / 1000);
      panel.setElapsed(secs);
    }, 1000);

    const runSpec = spec ?? defaultSpec(this._theme(), focus);
    let output = '';
    try {
      const req = this._buildRequest(profile, kind as Deliverable, focus, useScript, undefined, runSpec);
      for await (const chunk of services.ai.stream({ ...req, signal: this._panelAbort.signal })) {
        if (this._panelAbort.signal.aborted) break;
        output += chunk;
      }
    } finally {
      clearInterval(tick);
    }

    if (this._panelAbort.signal.aborted) { panel.setBusy(null); panel.setStatus('Cancelled.'); this._panelAbort = null; return; }
    this._panelAbort = null;
    if (!output.trim()) { panel.setBusy(null); panel.setStatus('✗ The model returned nothing — try again.'); return; }

    // Write output next to the data file.
    const dir  = path.dirname(filePath);
    const stem = path.basename(filePath, path.extname(filePath));
    const { body, lang } = extractCodeBlock(output);
    const finished = this._finishOutput(body, lang, kind as Deliverable, runSpec);
    let outName: string;
    if (useScript) outName = lang === 'html' ? `${stem}-report.html` : `${stem}-analysis.py`;
    else if (kind === 'report') outName = `${stem}-report.html`;
    else outName = `${stem}-profile.md`;
    const outPath = path.join(dir, outName);
    await services.workspace.writeFile(outPath, finished, /*openAfter*/ outName.endsWith('.md'));

    panel.setBusy(null);
    panel.setElapsed(0);

    if (outName.endsWith('.html')) {
      panel.setStatus(`✓ Report written: ${outName} — opening the preview, where you can refine it.`);
      this._openPreview(services, outPath, filePath, kind as Deliverable, runSpec);
    } else if (outName.endsWith('.py')) {
      // The accurate-report route: offer to RUN it now so the user gets the HTML.
      panel.setStatus(`✓ Script written: ${outName}. Run it to produce the report from your full data.`);
      const run = await vscode.window.showInformationMessage(
        `Evolve AI: ${kind === 'report' ? 'report' : 'analysis'} script ready — ${outName}. Run it now to build the ${kind === 'report' ? 'HTML report' : 'output'} from your full dataset? (the script auto-installs pandas + matplotlib on first run)`,
        'Run Now', 'Show File');
      if (run === 'Run Now') {
        const term = vscode.window.createTerminal('Evolve AI: Data Analysis');
        term.show();
        term.sendText(`python "${outPath}"`);
        panel.setStatus(`▶ Running ${outName} — the report opens when it finishes.`);
      } else if (run === 'Show File') {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(outPath)));
      }
    } else {
      panel.setStatus(`✓ Profile written: ${outName}`);
    }
  }

  /**
   * Sniff the chosen file and push its columns to the builder, so the pickers
   * offer real column names and types rather than asking the user to type them.
   * A file we cannot read just leaves the pickers empty — never blocks the run.
   */
  private _pushSchema(panel: DataAnalysisPanel, filePath: string): void {
    try {
      const p = sniffDataFile(filePath);
      panel.setSchema(p.columns.map(c => ({ name: c, type: p.inferred[c] ?? 'string' })));
    } catch {
      panel.setSchema([]);
    }
  }

  /** Quick-pick over the saved templates. */
  private async _pickTemplate(): Promise<ReportTemplate | null> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const templates = listTemplates(ws?.uri.fsPath);
    if (!templates.length) {
      vscode.window.showInformationMessage(
        'No report templates saved yet. Build a report, arrange it, then use "Save as template" in the preview.');
      return null;
    }
    const pick = await vscode.window.showQuickPick(
      templates.map(t => ({ label: t.tpl.name, description: t.tpl.description, file: t.file })),
      { placeHolder: 'Start from which template?' });
    if (!pick) return null;
    return loadTemplate(pick.file);
  }

  /** Native file picker shared by the panel's Browse button and drop-fallback. */
  private async _openBrowse(panel: DataAnalysisPanel, onPick: (file: string) => void): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false, openLabel: 'Use this file',
      filters: { Data: ['csv', 'tsv', 'json', 'xlsx', 'xls', 'parquet'] },
    });
    if (picked?.[0]) { onPick(picked[0].fsPath); panel.setSelected(path.basename(picked[0].fsPath)); }
    else panel.setStatus('');
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
    let spec: ReportSpec | undefined;
    if (kindPick.detail === 'report') {
      const chosen = await this._specForRun(instruction || undefined);
      if (chosen === 'cancelled') return;
      spec = chosen;
    }
    await this._run(services, ws.uri.fsPath, kindPick.detail as Deliverable, instruction || undefined, remote, spec);
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
        `for ${engine}. Auto-install the required driver + sqlalchemy the same way as the other packages.\n` +
        `2. Runs this query into a pandas DataFrame via pandas.read_sql:\n\`\`\`sql\n${query}\n\`\`\`\n` +
        `3. Performs a full analysis and writes a single self-contained HTML report (KPI tiles, matplotlib charts ` +
        `embedded as base64 <img> tags, tables, and a "Key insights" section) to "db-report.html" in the current directory.\n` +
        (instruction ? `Focus: ${instruction}\n` : '') +
        `\n${SCRIPT_RULES}\n\n` +
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
      term.sendText('# The script auto-installs pandas/matplotlib/sqlalchemy + the driver on first run.');
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
    spec?: ReportSpec,
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
            profile = this._applyPrepToProfile(sniffDataFile(filePath));
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
              { modal: true }, 'Send Sample', 'Generate Script Instead'
            );
            if (!ok) return;
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
        const runSpec = spec ?? defaultSpec(this._theme(), instruction);
        const req = this._buildRequest(profile, kind, instruction, useScript, remote, runSpec);

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
        await this._writeOutput(services, outAnchor, kind, useScript, output, runSpec);
      }
    );
  }

  private _buildRequest(
    p: DataProfile,
    kind: Deliverable,
    instruction: string | undefined,
    useScript: boolean,
    remote?: RemoteResult,
    spec?: ReportSpec,
  ): AIRequest {
    const dataMd = profileToMarkdown(p);
    const focus  = instruction ? `\n\nUser's focus: ${instruction}` : '';
    const abspath = p.filePath.replace(/\\/g, '/');

    // The design brief. `report` and `notebook` both end in an HTML report, so
    // both get one; `profile` produces Markdown/stdout and needs no styling.
    const wantsDesign = kind === 'report' || kind === 'notebook';
    const base  = this._theme();
    const rspec = spec ?? defaultSpec(base, instruction);
    const theme = themeForSpec(base, rspec);

    // An authored outline supersedes the archetype's section list: the user
    // picked the measures and dimensions, so the model must not re-decide them.
    const blocks = (rspec.blocks ?? []) as ReportBlock[];
    const outline = blocks.length
      ? (useScript ? blocksToScriptPrompt(blocks) : blocksToPrompt(blocks))
      : '';

    const design = !wantsDesign ? ''
      : '\n\n' + (useScript
          ? buildScriptPromptBlock(rspec, theme, outline)
          : buildReportPromptBlock(rspec, theme, outline));

    // Filters and derived columns are applied for real (deterministically in
    // the script, on the sample for the direct path) — the model is only told
    // so it discloses them and doesn't describe filtered figures as totals.
    const prepNote = isPrepEmpty(this._prep) ? '' : `\n\n${dataPrepPromptFragment(this._prep)}`;

    // For a remote source, the sample below is the data — a script can't re-read
    // a query as a file. A remote notebook should reconstruct the fetch itself.
    if (remote) {
      const notebookHint = kind === 'notebook'
        ? `Generate a reproducible Python script that reconnects to the source (${remote.label}) using the ` +
          `appropriate client library and credentials from the environment, re-runs the query/fetch, then does ` +
          `a full exploratory analysis and writes an HTML report. Do NOT hard-code credentials.\n\n${SCRIPT_RULES}\n\nOutput one fenced \`\`\`python block only.`
        : kind === 'report'
        ? `Produce a single self-contained HTML report for this dataset (source: ${remote.label}). Ground every ` +
          `number strictly in the provided rows. Output ONLY the HTML inside one fenced \`\`\`html block.`
        : `Produce a concise Markdown profiling summary for this dataset (source: ${remote.label}): per-column ` +
          `type, null counts, numeric stats, distinct/top values, correlations, and data-quality issues. Base ` +
          `everything strictly on the provided rows.`;
      return {
        messages: [{ role: 'user', content: `${notebookHint}${focus}${design}${prepNote}\n\n---\nDataset (from ${remote.label}):\n${dataMd}` }],
        system: REPORT_SYSTEM,
        instruction: `data ${kind} (remote)`,
        mode: 'new',
      };
    }

    let task: string;
    if (kind === 'profile') {
      task = useScript
        ? `Generate a self-contained Python script that profiles this dataset: dtypes, non-null counts, ` +
          `descriptive stats, cardinality, top values for categoricals, correlations for NUMERIC columns only, and flags ` +
          `likely data-quality issues. It must read the real file at "${abspath}" and print a clear report.\n\n${SCRIPT_RULES}\n\n` +
          `Output the script as a fenced \`\`\`python block only.`
        : `Produce a concise data profiling summary in Markdown for this dataset: per-column type, null counts, ` +
          `min/max/mean for numerics, distinct counts and top values for categoricals, notable correlations, ` +
          `and any data-quality issues you can see. Base everything strictly on the provided sample.`;
    } else if (kind === 'report') {
      task = useScript
        ? `Generate a self-contained Python script that reads the FULL dataset at "${abspath}", computes the ` +
          `metrics the report brief below calls for, and writes one self-contained HTML report file next to it ` +
          `(same folder, named "${path.basename(p.filePath, p.ext)}-report.html").\n\n${SCRIPT_RULES}\n\n` +
          `Output the script as a fenced \`\`\`python block only.`
        : `Produce a single self-contained HTML report document for this dataset, following the report brief ` +
          `below exactly. Ground every number strictly in the provided sample. Output ONLY the HTML inside a ` +
          `single fenced \`\`\`html block.`;
    } else { // notebook
      task =
        `Generate a reproducible analysis script for this dataset as a clean runnable .py file. It must read the ` +
        `real file at "${abspath}", do a full exploratory analysis (shape, dtypes, missingness, distributions, ` +
        `correlations for numeric columns), and end by writing the HTML report described in the brief below ` +
        `next to the data.\n\n${SCRIPT_RULES}\n\n` +
        `Output the script as a single fenced \`\`\`python block only.`;
    }

    return {
      messages: [{ role: 'user', content: `${task}${focus}${design}${prepNote}\n\n---\nDataset:\n${dataMd}` }],
      system: REPORT_SYSTEM,
      instruction: `data ${kind}`,
      mode: 'new',
    };
  }

  // ── Theme + spec ──────────────────────────────────────────────────────────

  /** Workspace report theme (evolve-report-theme.json), re-read on each use so
   *  edits to the file take effect without reloading the window. */
  private _theme(): ReportTheme {
    return loadReportTheme(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  }

  /**
   * Post-process a generated deliverable so the design holds regardless of what
   * the model emitted: stamp the stylesheet + runtime into HTML, or prepend the
   * Python helper preamble to a report-producing script.
   */
  /**
   * Apply the configured filters to a sniffed sample, so the direct (small-data)
   * path honours the same preparation the script path does. Without this a
   * filter set in the panel would silently do nothing for small files.
   */
  private _applyPrepToProfile(p: DataProfile): DataProfile {
    if (isPrepEmpty(this._prep) || p.binary || !p.columns.length) return p;
    const idx = new Map(p.columns.map((c, i) => [c, i]));
    let rows = p.sampleRows;

    for (const f of this._prep.filters) {
      const i = idx.get(f.column);
      if (i === undefined) continue;
      const num = (s: string): number => parseFloat(String(s).replace(/[^0-9eE+.-]/g, ''));
      const target = f.value.trim().toLowerCase();
      const list = f.value.split(',').map(s => s.trim().toLowerCase());
      rows = rows.filter(r => {
        const raw = (r[i] ?? '').trim();
        const v = raw.toLowerCase();
        switch (f.op) {
          case 'eq':  return v === target;
          case 'ne':  return v !== target;
          case 'gt':  return num(raw) >  num(f.value);
          case 'gte': return num(raw) >= num(f.value);
          case 'lt':  return num(raw) <  num(f.value);
          case 'lte': return num(raw) <= num(f.value);
          case 'contains':    return v.includes(target);
          case 'notContains': return !v.includes(target);
          case 'in':    return list.includes(v);
          case 'notIn': return !list.includes(v);
          case 'isNull':  return raw === '';
          case 'notNull': return raw !== '';
          case 'between': return num(raw) >= num(f.value) && num(raw) <= num(f.value2 ?? f.value);
          default: return true;
        }
      });
    }

    let columns = p.columns;
    let inferred = p.inferred;
    if (this._prep.excludeColumns.length) {
      const drop = new Set(this._prep.excludeColumns);
      const keep = p.columns.map((c, i) => ({ c, i })).filter(({ c }) => !drop.has(c));
      columns = keep.map(k => k.c);
      rows = rows.map(r => keep.map(k => r[k.i] ?? ''));
      inferred = Object.fromEntries(columns.map(c => [c, p.inferred[c] ?? 'string']));
    }
    if (this._prep.dedupe) {
      const seen = new Set<string>();
      rows = rows.filter(r => { const k = r.join(''); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    if (this._prep.limit > 0) rows = rows.slice(0, this._prep.limit);

    // approxRows was estimated from the whole file; after filtering the sample
    // it is no longer meaningful, so scale it by the survival rate rather than
    // reporting a total the filtered report does not describe.
    const ratio = p.sampleRows.length ? rows.length / p.sampleRows.length : 1;
    const approxRows = p.approxRows != null ? Math.round(p.approxRows * ratio) : null;
    return { ...p, columns, inferred, sampleRows: rows, approxRows };
  }

  private _finishOutput(body: string, lang: string, kind: Deliverable, spec: ReportSpec): string {
    const theme = themeForSpec(this._theme(), spec);
    if (lang === 'html' || (!lang && /^\s*<(?:!doctype|html)/i.test(body))) {
      return injectReportAssets(body, theme);
    }
    if (lang === 'python' && (kind === 'report' || kind === 'notebook')) {
      return injectDataPrep(injectPythonPreamble(body, theme), this._prep);
    }
    return body;
  }

  // ══ Report preview + refinement loop ═══════════════════════════════════════
  //
  // Generating a report used to be a one-shot: the file hit disk and the only
  // way to change anything was to start over. The preview keeps the report open
  // beside a refine box, applies each change to the document that already
  // exists, and snapshots every round so Undo always works.

  private _preview: {
    reportPath: string;
    dataPath?: string;
    kind: Deliverable;
    spec: ReportSpec;
    history: string[];         // previous file contents, newest last
    abort: AbortController | null;
  } | null = null;

  private _openPreview(
    services: IServices,
    reportPath: string,
    dataPath: string | undefined,
    kind: Deliverable,
    spec: ReportSpec,
  ): void {
    // Re-opening the same report keeps its undo history — closing the preview
    // and coming back should not silently throw away the ability to step back.
    const history = this._preview?.reportPath === reportPath ? this._preview.history : [];
    this._preview = { reportPath, dataPath, kind, spec, history, abort: null };

    const previewPath = this._writePreviewCopy(reportPath);
    const panel = ReportPreviewPanel.show(reportPath, previewPath, async (msg) => {
      const st = this._preview;
      if (!st) return;
      switch (msg.type) {
        case 'refine':
          await this._refine(services, panel, msg.text);
          break;
        case 'saveHtml':
          await this._saveEditedHtml(services, panel, msg.html);
          break;
        case 'refineBlock':
          await this._refineBlock(services, panel, msg.blockId, msg.blockType, msg.text);
          break;
        case 'design':
          await this._applyDesign(services, panel, msg.key, msg.value);
          break;
        case 'addBlock':
          await this._addBlockAfter(services, panel, msg.afterId);
          break;
        case 'exportPdf':
          await this._exportPdf(panel);
          break;
        case 'saveTemplate':
          await this._saveTemplateFromReport(panel);
          break;
        case 'cancel':
          st.abort?.abort();
          break;
        case 'undo': {
          const prev = st.history.pop();
          if (!prev) { panel.setStatus('Nothing to undo.'); return; }
          await services.workspace.writeFile(st.reportPath, prev, /*openAfter*/ false);
          panel.setCanUndo(st.history.length > 0);
          panel.reload();
          panel.setStatus('Reverted to the previous version.');
          break;
        }
        case 'openExternal':
          await vscode.env.openExternal(vscode.Uri.file(st.reportPath));
          break;
        case 'reveal':
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(st.reportPath));
          break;
        case 'openSource':
          await vscode.window.showTextDocument(
            await vscode.workspace.openTextDocument(vscode.Uri.file(st.reportPath)), { preview: true });
          break;
        case 'regenerate': {
          if (!st.dataPath) {
            panel.setStatus('This report was opened on its own — use "Analyze Data & Report" to rebuild it from a dataset.');
            return;
          }
          const next = await this._pickSpec(this._theme(), st.spec.focus, st.spec);
          if (!next) return;
          panel.setStatus('Regenerating from the dataset…');
          await this._run(services, st.dataPath, st.kind, next.focus || undefined, undefined, next);
          break;
        }
      }
    });
    panel.setCanUndo(history.length > 0);
    panel.setDesign({
      accent: spec.accent || this._theme().accent,
      mode: spec.mode,
      density: this._theme().density,
    });
    panel.setStatus('Hover a section to move, duplicate or delete it · double-click any text to edit it · or describe a change below.');
  }

  /**
   * Write the editable copy the iframe actually loads. Edit-mode chrome (hover
   * toolbars, contenteditable) must never reach the report on disk, so the
   * preview is a separate file in extension storage rather than the real one.
   */
  private _writePreviewCopy(reportPath: string): string {
    const dir = path.join(this._storageDir, 'preview');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* falls back below */ }
    const out = path.join(dir, `preview-${slug(path.basename(reportPath, '.html'))}.html`);
    try {
      const html = fs.readFileSync(reportPath, 'utf8');
      const spec = this._preview?.spec ?? defaultSpec(this._theme());
      fs.writeFileSync(out, injectReportAssets(html, themeForSpec(this._theme(), spec), { editable: true }), 'utf8');
      return out;
    } catch {
      // Storage unavailable — fall back to previewing the real file read-only.
      return reportPath;
    }
  }

  /** Refresh the preview copy from disk and reload the iframe. */
  private _refreshPreview(panel: ReportPreviewPanel): void {
    const st = this._preview;
    if (!st) return;
    this._writePreviewCopy(st.reportPath);
    panel.reload();
  }

  /**
   * The user moved, deleted, duplicated or retyped something in the preview.
   * The edited DOM is the truth now, so it is written straight through — no
   * model call — and the outline is recovered from the stamped block ids.
   */
  private async _saveEditedHtml(services: IServices, panel: ReportPreviewPanel, html: string): Promise<void> {
    const st = this._preview;
    if (!st) return;
    if (!html || !/<\/html>/i.test(html)) { panel.setStatus('✗ Ignored an incomplete edit.'); return; }

    let current = '';
    try { current = fs.readFileSync(st.reportPath, 'utf8'); } catch { /* first write */ }

    const clean = injectReportAssets(html, themeForSpec(this._theme(), st.spec));
    if (clean === current) { panel.setStatus(''); return; }

    st.history.push(current);
    st.spec = { ...st.spec, blocks: blocksFromHtml(clean, (st.spec.blocks ?? []) as ReportBlock[]) };
    await services.workspace.writeFile(st.reportPath, clean, /*openAfter*/ false);
    // The iframe already shows the change — rewriting its copy would reset
    // scroll position and cancel an in-progress inline edit.
    this._writePreviewCopy(st.reportPath);
    panel.setCanUndo(true);
    panel.setStatus('✓ Saved.');
  }

  /** Re-inject the stylesheet with new design values. No AI call. */
  private async _applyDesign(services: IServices, panel: ReportPreviewPanel, key: string, value: string): Promise<void> {
    const st = this._preview;
    if (!st) return;
    let current: string;
    try { current = fs.readFileSync(st.reportPath, 'utf8'); }
    catch (e) { panel.setStatus(`✗ Could not read the report: ${String(e)}`); return; }

    if (key === 'accent' && /^#[0-9a-fA-F]{3,8}$/.test(value)) st.spec = { ...st.spec, accent: value };
    else if (key === 'mode' && ['auto', 'light', 'dark'].includes(value)) st.spec = { ...st.spec, mode: value as ThemeMode };
    else if (key === 'density' && ['comfortable', 'compact'].includes(value)) this._density = value as 'comfortable' | 'compact';
    else return;

    st.history.push(current);
    const theme = { ...themeForSpec(this._theme(), st.spec), density: this._density };
    await services.workspace.writeFile(st.reportPath, injectReportAssets(current, theme), /*openAfter*/ false);
    this._refreshPreview(panel);
    panel.setCanUndo(true);
    panel.setStatus(`✓ ${key} → ${value} — applied instantly, no model call.`);
  }

  /**
   * Refine ONE card. Sending a single block instead of the document is cheaper,
   * faster, and structurally prevents the model from rewriting sections the
   * user did not ask about.
   */
  private async _refineBlock(
    services: IServices, panel: ReportPreviewPanel,
    blockId: string, blockType: string, instruction: string,
  ): Promise<void> {
    const st = this._preview;
    if (!st) return;

    let current: string;
    try { current = fs.readFileSync(st.reportPath, 'utf8'); }
    catch (e) { panel.setStatus(`✗ Could not read the report: ${String(e)}`); return; }

    const found = extractBlock(current, blockId);
    if (!found) {
      panel.setStatus('✗ Could not locate that block — refining the whole report instead.');
      await this._refine(services, panel, instruction);
      return;
    }

    // The block may hold a base64 chart; stash it exactly as the whole-document
    // path does so one card never costs megabytes of context.
    const stashed = stashHeavyParts(found.block);

    st.abort = new AbortController();
    const started = Date.now();
    const tick = setInterval(() => panel.setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    panel.setBusy(`Refining the ${blockType || 'selected'} block…`);

    let output = '';
    try {
      for await (const chunk of services.ai.stream({
        messages: [{ role: 'user', content: buildBlockRefinePrompt(stashed.html, instruction, blockType) }],
        system: REPORT_SYSTEM,
        instruction: 'refine report block',
        mode: 'edit',
        signal: st.abort.signal,
      })) {
        if (st.abort.signal.aborted) break;
        output += chunk;
      }
    } catch (e) {
      clearInterval(tick); panel.setBusy(null); st.abort = null;
      panel.setStatus(`✗ ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    clearInterval(tick);
    panel.setBusy(null);
    panel.setElapsed(0);

    if (st.abort.signal.aborted) { st.abort = null; panel.setStatus('Cancelled — the block is unchanged.'); return; }
    st.abort = null;

    const { body } = extractCodeBlock(output);
    // Must still be one element carrying the id, or splicing it back would
    // corrupt the document.
    if (!body.trim() || !body.includes(`data-block-id="${blockId}"`)) {
      panel.setStatus('✗ The model did not return a usable block — nothing changed.');
      return;
    }

    let replacement = restoreHeavyParts(body, stashed);
    if (hasDanglingImagePlaceholders(replacement)) {
      replacement = replacement
        .replace(/<figure class="chart">(?:(?!<\/figure>)[\s\S])*?EVOLVE_IMG_\d+[\s\S]*?<\/figure>/g, '')
        .replace(/EVOLVE_IMG_\d+/g, '');
    }

    const next = injectReportAssets(found.replace(replacement), themeForSpec(this._theme(), st.spec));
    st.history.push(current);
    await services.workspace.writeFile(st.reportPath, next, /*openAfter*/ false);
    this._refreshPreview(panel);
    panel.setCanUndo(true);
    panel.addHistory(`[${blockType || 'block'}] ${instruction}`);
    panel.setStatus('✓ Block updated. The rest of the report is untouched.');
  }

  /** Insert a new block after the given one, then generate just that block. */
  private async _addBlockAfter(services: IServices, panel: ReportPreviewPanel, afterId: string): Promise<void> {
    const st = this._preview;
    if (!st) return;

    const pick = await vscode.window.showQuickPick(
      BLOCK_KINDS.map(k => ({ label: `${k.icon}  ${k.label}`, detail: k.description, id: k.type })),
      { placeHolder: 'What kind of block should go here?' },
    );
    if (!pick) return;

    let instruction = '';
    if (pick.id !== 'divider') {
      const asked = await vscode.window.showInputBox({
        prompt: `What should this ${pick.label.replace(/^\S+\s+/, '')} block show?`,
        placeHolder: pick.id === 'chart' ? 'e.g. "revenue by month as a line chart"'
          : pick.id === 'text' ? 'The exact text to insert'
          : 'Leave blank to let the model decide',
        ignoreFocusOut: true,
      });
      if (asked === undefined) return;
      instruction = asked;
    }

    const block = makeBlock(pick.id as BlockType);
    if (block.type === 'text') block.body = instruction;
    else if (instruction) block.note = instruction;

    // Give the model an empty, correctly-stamped card and let the block-refine
    // path fill it — one code path for "create" and "change" instead of two.
    let current: string;
    try { current = fs.readFileSync(st.reportPath, 'utf8'); }
    catch (e) { panel.setStatus(`✗ Could not read the report: ${String(e)}`); return; }

    const anchor = extractBlock(current, afterId);
    if (!anchor) { panel.setStatus('✗ Could not find where to insert the block.'); return; }

    const placeholder =
      `<section class="card" data-block-id="${block.id}" data-block-type="${block.type}">` +
      `<h2>${escapeHtml(pick.label.replace(/^\S+\s+/, ''))}</h2></section>`;
    const withPlaceholder = anchor.replace(`${anchor.block}\n${placeholder}`);
    await services.workspace.writeFile(
      st.reportPath, injectReportAssets(withPlaceholder, themeForSpec(this._theme(), st.spec)), false);
    st.spec = { ...st.spec, blocks: [...((st.spec.blocks ?? []) as ReportBlock[]), block] };

    if (block.type === 'divider') {
      this._refreshPreview(panel);
      panel.setStatus('✓ Divider added.');
      return;
    }
    await this._refineBlock(
      services, panel, block.id, block.type,
      instruction || `Fill in this empty ${block.type} block using the data already shown in this report.`,
    );
  }

  /** Apply one refinement round to the report currently in the preview. */
  private async _refine(services: IServices, panel: ReportPreviewPanel, instruction: string): Promise<void> {
    const st = this._preview;
    if (!st) return;

    let current: string;
    try { current = fs.readFileSync(st.reportPath, 'utf8'); }
    catch (e) { panel.setStatus(`✗ Could not read the report: ${String(e)}`); return; }

    // Styling is ours, not the model's — the stylesheet is injected, so asking
    // an LLM to "use dark theme" would only make it write CSS we then discard.
    // Handle those directives here, instantly and exactly.
    const style = parseStyleDirective(instruction);
    if (style.applied) {
      st.spec = { ...st.spec, ...style.spec };
      st.history.push(current);
      const restyled = injectReportAssets(current, themeForSpec(this._theme(), st.spec));
      await services.workspace.writeFile(st.reportPath, restyled, /*openAfter*/ false);
      panel.setCanUndo(true);
      panel.reload();
      panel.addHistory(instruction);
      if (!style.remainder) {
        panel.setStatus(`✓ ${style.summary} — applied instantly (no model call needed).`);
        return;
      }
      panel.setStatus(`✓ ${style.summary}. Now applying the rest…`);
      current = restyled;
      instruction = style.remainder;
    }

    // Base64 charts and the injected stylesheet would dwarf the actual document,
    // so they are swapped for placeholders and restored after the round-trip.
    const stashed = stashHeavyParts(current);
    if (stashed.html.length > 180_000) {
      panel.setStatus(
        '✗ This report is too large to refine in one pass. Use "Regenerate from data…" with different options instead.');
      return;
    }

    st.abort = new AbortController();
    const started = Date.now();
    const tick = setInterval(() => panel.setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    panel.setBusy('Applying your change…');

    let output = '';
    try {
      const theme = themeForSpec(this._theme(), st.spec);
      for await (const chunk of services.ai.stream({
        messages: [{ role: 'user', content: buildRefinePrompt(stashed.html, instruction, theme) }],
        system: REPORT_SYSTEM,
        instruction: 'refine data report',
        mode: 'edit',
        signal: st.abort.signal,
      })) {
        if (st.abort.signal.aborted) break;
        output += chunk;
      }
    } catch (e) {
      clearInterval(tick);
      panel.setBusy(null);
      panel.setStatus(`✗ ${e instanceof Error ? e.message : String(e)}`);
      st.abort = null;
      return;
    }
    clearInterval(tick);
    panel.setBusy(null);
    panel.setElapsed(0);

    if (st.abort.signal.aborted) { st.abort = null; panel.setStatus('Cancelled — the report is unchanged.'); return; }
    st.abort = null;

    const { body } = extractCodeBlock(output);
    // A truncated or off-format response must never overwrite a good report.
    if (!body.trim() || !/<\/html>/i.test(body) || !/class=["']report["']/.test(body)) {
      panel.setStatus('✗ The model returned an incomplete document — the report is unchanged. Try a narrower change.');
      return;
    }

    let next = restoreHeavyParts(body, stashed);
    if (hasDanglingImagePlaceholders(next)) {
      // The model invented a chart placeholder it had no image for; drop those
      // figures rather than shipping a broken <img>.
      next = next.replace(/<figure class="chart">(?:(?!<\/figure>)[\s\S])*?EVOLVE_IMG_\d+[\s\S]*?<\/figure>/g, '');
      next = next.replace(/EVOLVE_IMG_\d+/g, '');
    }
    next = injectReportAssets(next, themeForSpec(this._theme(), st.spec));

    st.history.push(current);
    st.spec = { ...st.spec, notes: [...st.spec.notes, instruction] };
    await services.workspace.writeFile(st.reportPath, next, /*openAfter*/ false);
    panel.setCanUndo(true);
    panel.reload();
    panel.addHistory(instruction);
    panel.setStatus('✓ Applied. Keep refining, or Undo to step back.');
  }

  /**
   * Export to PDF. The stylesheet already carries print rules that keep cards
   * off page breaks, so the browser's own print-to-PDF produces the right
   * result — bundling a headless browser to do the same job would add ~150MB
   * to the extension for no gain in fidelity.
   */
  private async _exportPdf(panel: ReportPreviewPanel): Promise<void> {
    const st = this._preview;
    if (!st) return;
    const choice = await vscode.window.showInformationMessage(
      'Evolve AI opens the report in your browser — use its Print dialog and choose "Save as PDF". ' +
      'The report has print styles built in: toolbars are hidden and cards never split across pages.',
      { modal: true }, 'Open & Print', 'Cancel',
    );
    if (choice !== 'Open & Print') return;
    await vscode.env.openExternal(vscode.Uri.file(st.reportPath));
    panel.setStatus('Opened in your browser — press Ctrl+P and choose "Save as PDF".');
  }

  /** Capture the report's current shape as a reusable template. */
  private async _saveTemplateFromReport(panel: ReportPreviewPanel): Promise<void> {
    const st = this._preview;
    if (!st) return;
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { panel.setStatus('✗ Open a folder first — templates are saved into the workspace.'); return; }

    const name = await vscode.window.showInputBox({
      prompt: 'Name this report template',
      placeHolder: 'e.g. "Monthly sales review"',
      value: st.spec.title || path.basename(st.reportPath, '.html').replace(/-report$/, ''),
      ignoreFocusOut: true,
      validateInput: v => v.trim() ? undefined : 'Give the template a name',
    });
    if (!name) return;

    // Read the outline back out of the HTML: after manual reordering and
    // deletion, the document is the truth, not the in-memory spec.
    let blocks = (st.spec.blocks ?? []) as ReportBlock[];
    try {
      blocks = blocksFromHtml(fs.readFileSync(st.reportPath, 'utf8'), blocks);
    } catch { /* keep the in-memory outline */ }

    const tpl: ReportTemplate = {
      version: 1,
      name: name.trim(),
      description: `${describeBlocks(blocks)} · ${st.spec.audience} audience`,
      spec: { ...st.spec, blocks, title: st.spec.title },
      prep: this._prep,
      theme: { accent: st.spec.accent, mode: st.spec.mode, density: this._density },
      createdFrom: path.basename(st.reportPath),
      createdAt: new Date().toISOString().slice(0, 10),
    };

    try {
      const file = saveTemplate(ws.uri.fsPath, tpl);
      panel.setStatus(`✓ Saved as ${path.relative(ws.uri.fsPath, file)}`);
      const open = await vscode.window.showInformationMessage(
        `Template "${tpl.name}" saved (${describeBlocks(blocks)}). Run it against any dataset with "Data: Run Report Template".`,
        'Run It Now', 'Open Template');
      if (open === 'Run It Now') await vscode.commands.executeCommand('aiForge.data.runTemplate');
      else if (open === 'Open Template') {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
      }
    } catch (e) {
      panel.setStatus(`✗ Could not save the template: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Pick a saved template and a dataset, then rebuild that exact report shape. */
  private async _runTemplate(services: IServices): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const templates = listTemplates(ws?.uri.fsPath);
    if (!templates.length) {
      const go = await vscode.window.showInformationMessage(
        `No report templates yet. Build a report, arrange it how you want, then use "Save as template" in the preview — ` +
        `it writes to ${TEMPLATES_DIR}/ and can be re-run against any dataset.`,
        'Build a Report');
      if (go === 'Build a Report') await vscode.commands.executeCommand('aiForge.data.report');
      return;
    }

    const pick = await vscode.window.showQuickPick(
      templates.map(t => ({
        label: `$(file-symlink-file) ${t.tpl.name}`,
        description: t.tpl.description,
        detail: t.tpl.createdFrom ? `from ${t.tpl.createdFrom}${t.tpl.createdAt ? ` · ${t.tpl.createdAt}` : ''}` : undefined,
        file: t.file,
      })),
      { placeHolder: 'Which report template?' },
    );
    if (!pick) return;

    const tpl = loadTemplate(pick.file);
    if (!tpl) { vscode.window.showErrorMessage(`Evolve AI: could not read ${path.basename(pick.file)}.`); return; }

    const file = await this._pickDataFile(services);
    if (!file) return;

    // A template carries its own prep; adopt it for this run so the same
    // filters apply to the new data.
    this._prep = { ...EMPTY_PREP, ...tpl.prep };
    if (tpl.theme?.density) this._density = tpl.theme.density;
    await this._run(services, file, 'report', tpl.spec.focus || undefined, undefined, tpl.spec);
  }

  /** Open an existing HTML report in the preview so it can be refined. */
  private async _refineExisting(services: IServices, args: unknown[]): Promise<void> {
    let target = this._preview?.reportPath;

    const fromArgs = args.find(a => a instanceof vscode.Uri) as vscode.Uri | undefined;
    if (fromArgs?.fsPath.endsWith('.html')) target = fromArgs.fsPath;

    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!target && active?.endsWith('.html')) target = active;

    if (!target) {
      const ws = vscode.workspace.workspaceFolders?.[0];
      const found = ws ? findReportFiles(ws.uri.fsPath) : [];
      if (found.length) {
        const pick = await vscode.window.showQuickPick(
          found.map(f => ({ label: `$(graph) ${path.relative(ws!.uri.fsPath, f)}`, detail: f })),
          { placeHolder: 'Which report would you like to refine?' });
        target = pick?.detail;
      } else {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false, openLabel: 'Refine', filters: { 'HTML report': ['html', 'htm'] } });
        target = picked?.[0]?.fsPath;
      }
    }
    if (!target) return;

    // Reuse the live state when it is the same file, so the spec and the undo
    // history from this session survive the round trip.
    const live = this._preview?.reportPath === target ? this._preview : undefined;
    this._openPreview(
      services, target,
      live?.dataPath ?? guessDataSibling(target),
      live?.kind ?? 'report',
      live?.spec ?? defaultSpec(this._theme()),
    );
  }

  // ── Report customisation ──────────────────────────────────────────────────

  /**
   * Collect a ReportSpec through quick picks. Returns undefined if the user
   * backs out. `previous` pre-selects the last run's choices when regenerating.
   */
  private async _pickSpec(theme: ReportTheme, focus?: string, previous?: ReportSpec): Promise<ReportSpec | undefined> {
    const base = previous ?? defaultSpec(theme, focus);

    const archPick = await vscode.window.showQuickPick(
      REPORT_ARCHETYPES.map(a => ({
        label: `${a.id === base.archetype ? '$(check)' : '$(file)'} ${a.label}`,
        description: a.id === base.archetype ? '(current)' : '',
        detail: a.description,
        id: a.id,
      })),
      { placeHolder: 'What kind of report?', ignoreFocusOut: true },
    );
    if (!archPick) return undefined;
    const arch = archetypeById(archPick.id);

    const sectionPick = await vscode.window.showQuickPick(
      REPORT_SECTIONS.map(s => ({
        label: s.label,
        detail: s.guidance.length > 110 ? `${s.guidance.slice(0, 110)}…` : s.guidance,
        picked: arch.sections.includes(s.id),
        id: s.id,
      })),
      { placeHolder: 'Sections to include (space to toggle, Enter to confirm)', canPickMany: true, ignoreFocusOut: true },
    );
    if (!sectionPick) return undefined;

    const audiencePick = await vscode.window.showQuickPick(
      [
        { label: 'Mixed audience', detail: 'Plain-language takeaway first, precise figures after', id: 'mixed' },
        { label: 'Executives',     detail: 'Business language only — no jargon, no column names', id: 'exec' },
        { label: 'Analysts',       detail: 'Precise statistics, exact column names, coefficients', id: 'analyst' },
        { label: 'Data engineers', detail: 'Schema, types, cardinality, null behaviour, pipeline risks', id: 'engineer' },
      ],
      { placeHolder: 'Who is this report for?', ignoreFocusOut: true },
    );
    if (!audiencePick) return undefined;

    const lookPick = await vscode.window.showQuickPick(
      [
        { label: 'Match the reader\'s system theme', detail: 'Light or dark automatically, with a toggle in the report', id: 'auto' },
        { label: 'Always light', detail: 'Best for printing and PDF export', id: 'light' },
        { label: 'Always dark',  detail: 'Pinned dark, regardless of the reader\'s settings', id: 'dark' },
      ],
      { placeHolder: 'Appearance', ignoreFocusOut: true },
    );
    if (!lookPick) return undefined;

    const accent = await vscode.window.showInputBox({
      prompt: 'Accent colour (hex) — drives links, KPI accents and the first chart series',
      value: base.accent,
      ignoreFocusOut: true,
      validateInput: v => !v || /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? undefined : 'Enter a hex colour like #4f6df5',
    });
    if (accent === undefined) return undefined;

    const title = await vscode.window.showInputBox({
      prompt: 'Report title (optional)', value: base.title, ignoreFocusOut: true,
      placeHolder: 'Leave blank to name it after the dataset',
    });
    if (title === undefined) return undefined;

    const sections = sectionPick.map(s => s.id);
    return {
      archetype: arch.id,
      audience:  audiencePick.id as Audience,
      tone:      arch.tone,
      sections:  sections.length ? sections : arch.sections,
      maxCharts: Math.min(theme.maxCharts, arch.maxCharts),
      mode:      lookPick.id as ThemeMode,
      accent:    accent.trim() || theme.accent,
      title:     title.trim(),
      focus:     focus ?? base.focus,
      notes:     [],
      // The quick-pick path chooses sections, not a hand-built outline. Blocks
      // are derived from those sections so both paths generate the same way.
      blocks:    blocksFromSections(sections.length ? sections : arch.sections),
    };
  }

  /** Ask whether to use defaults or customise, then build the spec. */
  private async _specForRun(focus?: string): Promise<ReportSpec | 'cancelled'> {
    const theme = this._theme();
    const arch = archetypeById(theme.defaultArchetype);
    const choice = await vscode.window.showQuickPick(
      [
        { label: `$(zap) Standard report`, detail: `${arch.label} — ${arch.description}`, id: 'quick' },
        { label: '$(settings-gear) Customise…', detail: 'Choose the format, sections, audience, appearance and title', id: 'custom' },
      ],
      { placeHolder: 'Report options', ignoreFocusOut: true },
    );
    if (!choice) return 'cancelled';
    if (choice.id === 'quick') return defaultSpec(theme, focus);
    const spec = await this._pickSpec(theme, focus);
    return spec ?? 'cancelled';
  }

  /** Scaffold evolve-report-theme.json so brand styling applies to every report. */
  private async _createTheme(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showWarningMessage('Open a folder first — the theme file lives in your workspace.'); return; }
    const outPath = path.join(ws.uri.fsPath, THEME_FILENAME);
    if (fs.existsSync(outPath)) {
      const over = await vscode.window.showWarningMessage(
        `${THEME_FILENAME} already exists.`, 'Open Existing', 'Overwrite');
      if (over !== 'Overwrite') {
        if (over === 'Open Existing') {
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(outPath)));
        }
        return;
      }
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.file(outPath), new TextEncoder().encode(THEME_TEMPLATE));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(outPath)));
    vscode.window.showInformationMessage(
      `Created ${THEME_FILENAME}. Set your brand colours here and every report picks them up — no need to ask for them each time.`);
  }

  /** Write the AI output to a sensibly-named file next to the source data, then open it. */
  private async _writeOutput(services: IServices, dataPath: string, kind: Deliverable, useScript: boolean, raw: string, spec?: ReportSpec): Promise<void> {
    const dir  = path.dirname(dataPath);
    const stem = path.basename(dataPath, path.extname(dataPath));

    const { body, lang } = extractCodeBlock(raw);
    const runSpec = spec ?? defaultSpec(this._theme());
    const finished = this._finishOutput(body, lang, kind, runSpec);

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
    // An HTML report opens in the preview panel, not the editor — nobody reads
    // a report as raw markup, and the preview is where refinement happens.
    await services.workspace.writeFile(outPath, finished, /*openAfter*/ !outName.endsWith('.html'));

    if (outName.endsWith('.html')) {
      this._openPreview(services, outPath, dataPath, kind, runSpec);
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

  // ══ Declarative data pipelines ═════════════════════════════════════════════
  // A pipeline is a JSON file listing steps; each step = a source + an analysis.
  // Run them all with one command. This is the backend-free version of an "agent
  // workflow": a reproducible, versioned, multi-source analysis run — no hosted
  // orchestration, no scheduling, nothing running when the editor is closed.

  private async _createPipeline(services: IServices): Promise<void> {
    void services;
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showWarningMessage('Open a folder first — the pipeline file is written into your workspace.'); return; }
    const outPath = path.join(ws.uri.fsPath, 'evolve-data-pipeline.json');
    if (fs.existsSync(outPath)) {
      const over = await vscode.window.showWarningMessage(
        'evolve-data-pipeline.json already exists. Overwrite with a fresh template?', 'Overwrite', 'Open Existing', 'Cancel');
      if (over === 'Cancel' || !over) return;
      if (over === 'Open Existing') {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(outPath)));
        return;
      }
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.file(outPath), new TextEncoder().encode(PIPELINE_TEMPLATE));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(outPath)));
    vscode.window.showInformationMessage(
      'Created evolve-data-pipeline.json. Edit the steps, then run "Evolve AI: Run Data Pipeline".');
  }

  private async _runPipeline(services: IServices, args: unknown[]): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    // Resolve the pipeline file: from args (Explorer/palette), active editor, or a picker.
    let pipePath = this._uriFromArgs(args) && this._uriFromArgs(args)!.endsWith('.json') ? this._uriFromArgs(args) : undefined;
    if (!pipePath) {
      const active = vscode.window.activeTextEditor?.document.uri.fsPath;
      if (active && path.basename(active).includes('pipeline') && active.endsWith('.json')) pipePath = active;
    }
    if (!pipePath && ws) {
      const candidate = path.join(ws.uri.fsPath, 'evolve-data-pipeline.json');
      if (fs.existsSync(candidate)) pipePath = candidate;
    }
    if (!pipePath) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Run', filters: { 'Pipeline JSON': ['json'] } });
      pipePath = picked?.[0]?.fsPath;
    }
    if (!pipePath) return;

    let pipeline: Pipeline;
    try {
      pipeline = JSON.parse(stripJsonComments(fs.readFileSync(pipePath, 'utf8')));
    } catch (e) {
      vscode.window.showErrorMessage(`Evolve AI: could not parse pipeline JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const steps = Array.isArray(pipeline.steps) ? pipeline.steps : [];
    if (!steps.length) { vscode.window.showWarningMessage('Pipeline has no steps.'); return; }

    // Output folder: pipeline.output (relative to the pipeline file) or alongside it.
    const baseDir = path.dirname(pipePath);
    const outDir = pipeline.output ? path.resolve(baseDir, pipeline.output) : baseDir;

    const results: string[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Evolve AI: running pipeline (${steps.length} steps)…`, cancellable: true },
      async (progress, token) => {
        for (let i = 0; i < steps.length; i++) {
          if (token.isCancellationRequested) { results.push('⏹ cancelled'); break; }
          const step = steps[i];
          const label = step.name || `step ${i + 1}`;
          progress.report({ message: `${i + 1}/${steps.length}: ${label}` });
          try {
            const written = await this._runStep(services, step, outDir, baseDir);
            results.push(`✓ ${label} → ${written.map(w => path.basename(w)).join(', ') || '(chat)'}`);
          } catch (e) {
            // Continue past a failed step; summarise at the end.
            results.push(`✗ ${label} — ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    );

    const summary = results.join('\n');
    const ok = results.filter(r => r.startsWith('✓')).length;
    const action = await vscode.window.showInformationMessage(
      `Evolve AI pipeline finished — ${ok}/${steps.length} step(s) succeeded.`, 'Show Details', 'Open Output Folder');
    if (action === 'Show Details') {
      const doc = await vscode.workspace.openTextDocument({ content: `# Pipeline run\n\n${summary}\n`, language: 'markdown' });
      await vscode.window.showTextDocument(doc, { preview: true });
    } else if (action === 'Open Output Folder') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outDir));
    }
  }

  /** Execute one pipeline step headlessly (no per-step dialogs). Returns written file paths. */
  private async _runStep(services: IServices, step: PipelineStep, outDir: string, baseDir: string): Promise<string[]> {
    const kind = (step.analysis || 'report') as Deliverable | 'insights';
    const source = step.source || {};

    // 1) Resolve the data into a profile (+ optional remote label for output naming).
    let profile: DataProfile;
    let remote: RemoteResult | undefined;
    let stem: string;

    if (source.type === 'file') {
      if (!source.path) throw new Error('file source requires "path"');
      const filePath = path.resolve(baseDir, source.path);
      if (!fs.existsSync(filePath)) throw new Error(`file not found: ${source.path}`);
      profile = this._applyPrepToProfile(sniffDataFile(filePath));
      stem = path.basename(filePath, path.extname(filePath));
    } else {
      remote = await this._fetchRemoteHeadless(services, source);
      profile = remote.profile;
      stem = remote.outStem;
    }

    // 2) Insights → stream to chat (no file written).
    if (kind === 'insights') {
      await this._insightsInChat(remote ? outDir : path.resolve(baseDir, source.path!), step.focus, remote);
      return [];
    }

    // 3) Build the request and generate.
    const useScript = remote ? (kind === 'notebook') : (kind === 'notebook' || !isSmallEnoughForDirect(profile));
    const spec = this._specFromStep(step);
    const req = this._buildRequest(profile, kind as Deliverable, step.focus, useScript, remote, spec);
    const output = await services.ai.send(req);
    if (!output.trim()) throw new Error('empty AI response');

    // 4) Write the deliverable into the pipeline output folder (headless — no prompts).
    return [await this._writeStepOutput(services, outDir, stem, kind as Deliverable, useScript, output, spec)];
  }

  /** A pipeline step's `report` block layered over the workspace theme defaults. */
  private _specFromStep(step: PipelineStep): ReportSpec {
    const theme = this._theme();
    const base = defaultSpec(theme, step.focus);
    const r = step.report;
    if (!r) return base;
    const arch = r.archetype ? archetypeById(r.archetype) : archetypeById(base.archetype);
    const sections = (r.sections ?? []).filter(s => REPORT_SECTIONS.some(x => x.id === s));
    return {
      ...base,
      archetype: arch.id,
      tone:      arch.tone,
      audience:  r.audience ?? base.audience,
      sections:  sections.length ? sections : arch.sections,
      maxCharts: r.maxCharts ?? Math.min(theme.maxCharts, arch.maxCharts),
      mode:      r.theme ?? base.mode,
      accent:    r.accent ?? base.accent,
      title:     r.title ?? base.title,
    };
  }

  /** Headless output writer for pipeline steps — same naming as _writeOutput, no dialogs. */
  private async _writeStepOutput(services: IServices, outDir: string, stem: string, kind: Deliverable, useScript: boolean, raw: string, spec?: ReportSpec): Promise<string> {
    const { body, lang } = extractCodeBlock(raw);
    const finished = this._finishOutput(body, lang, kind, spec ?? defaultSpec(this._theme()));
    let outName: string;
    if (useScript || kind === 'notebook') outName = lang === 'html' ? `${stem}-report.html` : `${stem}-analysis.py`;
    else if (kind === 'report') outName = `${stem}-report.html`;
    else outName = `${stem}-profile.md`;
    const outPath = path.join(outDir, outName);
    await services.workspace.writeFile(outPath, finished, /*openAfter*/ false);
    return outPath;
  }

  /** Fetch a remote source from declarative config (no interactive prompts). */
  private async _fetchRemoteHeadless(services: IServices, s: PipelineSource): Promise<RemoteResult> {
    const need = (v: string | undefined, name: string): string => {
      if (!v) throw new Error(`${s.type} source requires "${name}"`);
      return v;
    };
    switch (s.type) {
      case 'bigquery': {
        const client = await GcpClient.fromSecrets(services.ai);
        if (!client) throw new Error('Google Cloud not connected');
        const res = await client.runQuery(need(s.query, 'query'));
        const columns = (res.schema?.fields ?? []).map(f => f.name);
        const rows = (res.rows ?? []).map(r => (r.f ?? []).map(c => cell(c.v)));
        return { label: 'BigQuery', outStem: s.name ? slug(s.name) : 'bigquery', profile: rowsToProfile('bigquery://query', columns, rows, res.totalRows ? parseInt(res.totalRows, 10) : rows.length) };
      }
      case 'databricks': {
        const client = await DatabricksClient.fromSecrets(services.ai);
        if (!client) throw new Error('Databricks not connected');
        const res = await client.executeStatement(need(s.warehouseId, 'warehouseId'), need(s.query, 'query'));
        if (res.status?.error) throw new Error(res.status.error.message);
        const columns = (res.manifest?.schema.columns ?? []).map(c => c.name);
        const rows = (res.result?.data_array ?? []).map(r => r.map(cell));
        return { label: 'Databricks SQL', outStem: s.name ? slug(s.name) : 'databricks', profile: rowsToProfile('databricks://query', columns, rows, res.manifest?.total_row_count ?? rows.length) };
      }
      case 'cosmos': {
        const client = await AzureClient.fromSecrets(services.ai);
        if (!client) throw new Error('Azure not connected');
        const res = await client.queryCosmosDocuments(need(s.endpoint, 'endpoint'), need(s.key, 'key'), need(s.database, 'database'), need(s.container, 'container'), s.query || 'SELECT * FROM c');
        const { columns, rows } = objectsToRows(res.Documents as Array<Record<string, unknown>>);
        return { label: 'Cosmos DB', outStem: s.name ? slug(s.name) : 'cosmos', profile: rowsToProfile('cosmos://query', columns, rows, res._count ?? rows.length) };
      }
      case 'loganalytics': {
        const client = await AzureClient.fromSecrets(services.ai);
        if (!client) throw new Error('Azure not connected');
        const res = await client.queryLogs(need(s.workspaceId, 'workspaceId'), need(s.query, 'query'));
        const t = res.tables?.[0];
        const columns = (t?.columns ?? []).map(c => c.name);
        const rows = (t?.rows ?? []).map(r => r.map(cell));
        return { label: 'Log Analytics', outStem: s.name ? slug(s.name) : 'loganalytics', profile: rowsToProfile('loganalytics://query', columns, rows, rows.length) };
      }
      case 'dynamodb': {
        const client = await AwsClient.fromSecrets(services.ai);
        if (!client) throw new Error('AWS not connected');
        const items = await client.scanTable(need(s.table, 'table'), s.limit ?? 1000);
        const { columns, rows } = objectsToRows(items as Array<Record<string, unknown>>);
        return { label: `DynamoDB: ${s.table}`, outStem: s.name ? slug(s.name) : `dynamodb-${slug(s.table!)}`, profile: rowsToProfile('dynamodb://scan', columns, rows, rows.length) };
      }
      case 's3': case 'gcs': case 'blob': {
        let text: string;
        if (s.type === 's3') { const c = await AwsClient.fromSecrets(services.ai); if (!c) throw new Error('AWS not connected'); text = await c.getObject(need(s.bucket, 'bucket'), need(s.object, 'object')); }
        else if (s.type === 'gcs') { const c = await GcpClient.fromSecrets(services.ai); if (!c) throw new Error('Google Cloud not connected'); text = await c.getObject(need(s.bucket, 'bucket'), need(s.object, 'object')); }
        else { const c = await AzureClient.fromSecrets(services.ai); if (!c) throw new Error('Azure not connected'); text = await c.downloadBlob(need(s.account, 'account'), need(s.container, 'container'), need(s.object, 'object')); }
        const objKey = need(s.object, 'object');
        return { label: `${s.type.toUpperCase()}: ${objKey}`, outStem: s.name ? slug(s.name) : (path.basename(objKey, path.extname(objKey)) || 'object'), profile: sniffText(text, objKey) };
      }
      default:
        throw new Error(`unknown source type "${(s as { type?: string }).type}" (use file/bigquery/databricks/cosmos/loganalytics/dynamodb/s3/gcs/blob)`);
    }
  }
}

type Deliverable = 'report' | 'notebook' | 'profile';

// ── Pipeline schema ──────────────────────────────────────────────────────────

interface PipelineSource {
  type: 'file' | 'bigquery' | 'databricks' | 'cosmos' | 'loganalytics' | 'dynamodb' | 's3' | 'gcs' | 'blob';
  name?: string;
  // file
  path?: string;
  // sql-ish
  query?: string;
  warehouseId?: string;   // databricks
  workspaceId?: string;   // loganalytics
  // cosmos
  endpoint?: string; key?: string; database?: string; container?: string;
  // dynamodb
  table?: string; limit?: number;
  // object storage
  bucket?: string; object?: string; account?: string;
}

interface PipelineStep {
  name?: string;
  source: PipelineSource;
  analysis?: 'insights' | 'report' | 'notebook' | 'profile';
  focus?: string;
  /** Optional per-step report shape; anything omitted falls back to the theme. */
  report?: {
    archetype?: string;
    audience?:  Audience;
    sections?:  string[];
    maxCharts?: number;
    theme?:     ThemeMode;
    accent?:    string;
    title?:     string;
  };
}

interface Pipeline {
  output?: string;        // folder (relative to the pipeline file) for deliverables
  steps: PipelineStep[];
}

/** Escape a label before it goes into generated HTML. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

/** Filesystem-safe slug for output filenames. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'step';
}

/**
 * Recognise styling instructions in a refinement request. The stylesheet is
 * injected by the extension, not written by the model, so "use dark theme" or
 * "make the accent green" is a deterministic local change — sending it to an
 * AI would only produce CSS that then gets discarded.
 *
 * Returns the spec overrides to apply plus whatever text is left for the model.
 */
export function parseStyleDirective(text: string): {
  applied: boolean;
  spec: Partial<ReportSpec>;
  summary: string;
  remainder: string;
} {
  const spec: Partial<ReportSpec> = {};
  const summary: string[] = [];
  let rest = text;

  const take = (re: RegExp): boolean => {
    const m = rest.match(re);
    if (!m) return false;
    rest = rest.replace(re, ' ');
    return true;
  };

  if (take(/\b(?:use|switch to|make it|in)?\s*\b(?:a\s+)?dark\s*(?:theme|mode|colou?rs?)\b/i)) {
    spec.mode = 'dark'; summary.push('switched to dark');
  } else if (take(/\b(?:use|switch to|make it|in)?\s*\b(?:a\s+)?light\s*(?:theme|mode|colou?rs?)\b/i)) {
    spec.mode = 'light'; summary.push('switched to light');
  } else if (take(/\b(?:follow|match|use)\s+(?:the\s+)?(?:reader'?s?|system|os|auto)\s*(?:theme|mode)?\b/i)) {
    spec.mode = 'auto'; summary.push('following the system theme');
  }

  const hex = rest.match(/#[0-9a-fA-F]{6}\b/);
  if (hex) {
    spec.accent = hex[0];
    rest = rest.replace(hex[0], ' ');
    summary.push(`accent set to ${hex[0]}`);
  }

  const applied = summary.length > 0;
  // What's left only earns a model call if it still says something. Styling
  // vocabulary and filler words don't count — "make the accent #1f7a5a" is
  // fully handled here and must not trigger a pointless round-trip.
  const significant = rest
    .replace(/\b(?:use|make|set|change|switch|to|the|it|its|please|and|a|an|in|with|for)\b/gi, ' ')
    .replace(/\b(?:accent|colou?rs?|theme|mode|dark|light|brand|primary|appearance|style|styling|palette)\b/gi, ' ')
    .replace(/[^\w]+/g, ' ')
    .trim();

  return { applied, spec, summary: summary.join(' and '), remainder: significant.length >= 4 ? rest.trim() : '' };
}

/** HTML reports already generated in the workspace, for the "refine" picker. */
function findReportFiles(wsPath: string, limit = 50): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (/\.html?$/i.test(e.name)) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(wsPath, 0);
  // Reports we generated are named "<stem>-report.html" — surface those first.
  return out.sort((a, b) => Number(/-report\.html?$/i.test(b)) - Number(/-report\.html?$/i.test(a)));
}

/** For "<stem>-report.html", find the dataset it came from so Regenerate works. */
function guessDataSibling(reportPath: string): string | undefined {
  const m = path.basename(reportPath).match(/^(.*)-report\.html?$/i);
  if (!m) return undefined;
  const dir = path.dirname(reportPath);
  for (const ext of DATA_EXTENSIONS.concat('.json')) {
    const candidate = path.join(dir, m[1] + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const PIPELINE_TEMPLATE = `{
  "output": "reports",
  "steps": [
    {
      "name": "Sales overview",
      "source": { "type": "file", "path": "sales.csv" },
      "analysis": "report",
      "focus": "revenue trends by month and region"
    },
    {
      "name": "Quick data check",
      "source": { "type": "file", "path": "sales.csv" },
      "analysis": "profile"
    }

    // ── More source types (delete the ones you don't need) ──
    // ,{ "name": "BigQuery", "source": { "type": "bigquery", "query": "SELECT * FROM \\\`project.dataset.table\\\` LIMIT 1000" }, "analysis": "report" }
    // ,{ "name": "Databricks", "source": { "type": "databricks", "warehouseId": "<warehouse-id>", "query": "SELECT * FROM catalog.schema.table LIMIT 1000" }, "analysis": "insights" }
    // ,{ "name": "Cosmos", "source": { "type": "cosmos", "endpoint": "https://<acct>.documents.azure.com", "key": "<key>", "database": "<db>", "container": "<c>", "query": "SELECT * FROM c" }, "analysis": "profile" }
    // ,{ "name": "Log Analytics", "source": { "type": "loganalytics", "workspaceId": "<ws-id>", "query": "AppRequests | take 1000" }, "analysis": "report" }
    // ,{ "name": "DynamoDB", "source": { "type": "dynamodb", "table": "<table>", "limit": 1000 }, "analysis": "report" }
    // ,{ "name": "S3 object", "source": { "type": "s3", "bucket": "<bucket>", "object": "data/sales.csv" }, "analysis": "report" }
    // ,{ "name": "GCS object", "source": { "type": "gcs", "bucket": "<bucket>", "object": "data/sales.csv" }, "analysis": "report" }
    // ,{ "name": "Azure Blob", "source": { "type": "blob", "account": "<acct>", "container": "<container>", "object": "data/sales.csv" }, "analysis": "report" }
  ]
}
`;

/** Extract the first fenced code block; returns its language + body (or the raw text). */
function extractCodeBlock(raw: string): { body: string; lang: string } {
  const m = raw.match(/```([\w-]*)\n([\s\S]*?)```/);
  if (m) return { lang: (m[1] || '').toLowerCase(), body: m[2].trim() };
  return { lang: '', body: raw.trim() };
}

/** Cheap check: does a JSON file's head look like an array of row-objects? */
function looksTabularJson(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(fs.statSync(filePath).size, 4096));
      fs.readSync(fd, buf, 0, buf.length, 0);
      const head = buf.toString('utf8').trimStart();
      // Tabular data is an array of objects: starts with '[' then soon a '{',
      // or a wrapper object with a "data": [ … ] array.
      if (head.startsWith('[')) return /\[\s*\{/.test(head.slice(0, 200));
      if (head.startsWith('{')) return /"(data|rows|records|items)"\s*:\s*\[/.test(head.slice(0, 500));
      return false;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

function findJsonFiles(wsPath: string, limit = MAX_SCAN): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        const lower = e.name.toLowerCase();
        if (!lower.endsWith('.json') || CONFIG_JSON.has(lower)) continue;
        if (lower.endsWith('.config.json') || lower.endsWith('lock.json') || lower.endsWith('.tsbuildinfo')) continue;
        const full = path.join(dir, e.name);
        // Only include JSON that actually looks like tabular data.
        if (looksTabularJson(full)) out.push(full);
      }
    }
  };
  walk(wsPath, 0);
  return out;
}
