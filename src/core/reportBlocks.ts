/**
 * core/reportBlocks.ts — the report as an authored outline, not a set of knobs.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ReportSpec.sections` lets the user say "include a breakdown". It does not let
 * them say *which* measure, split by *which* dimension, as *which* chart. The
 * model picks, and the user consumes whatever it picked.
 *
 * A block is one addressable piece of a report with its own configuration. The
 * user composes an outline of blocks — with real column pickers, because the
 * sniffed `DataProfile` already knows the column names and their inferred types
 * — and anything left on `auto` is still the model's call. Authoring and
 * generation stop being either/or.
 *
 * Blocks serve three jobs:
 *   1. Generation  — `blocksToPrompt()` turns the outline into per-block
 *                    instructions, so the model fills in the parts the user
 *                    did not pin down.
 *   2. Addressing  — every rendered card carries `data-block-id`, so the preview
 *                    can move/delete/duplicate/refine one block in isolation.
 *   3. Reuse       — a template is just a block list plus data prep, so the same
 *                    report shape can be re-run against next month's data.
 *
 * Data preparation lives here too. "Exclude test accounts" should be a filter
 * that runs deterministically, not a sentence in a prompt the model may ignore.
 */

import * as path from 'path';
import * as fs   from 'fs';
import { stripJsonComments } from './jsonc';
import type { ReportSpec, ReportTheme } from './reportDesign';

// ── Block model ─────────────────────────────────────────────────────────────

export type BlockType =
  | 'kpi' | 'chart' | 'table' | 'text'
  | 'insights' | 'recommendations' | 'quality' | 'correlations'
  | 'summary' | 'methodology' | 'divider';

export type ChartKind =
  | 'auto' | 'bar' | 'barh' | 'line' | 'area' | 'scatter' | 'pie' | 'histogram' | 'box';

export type Agg = 'auto' | 'sum' | 'mean' | 'median' | 'count' | 'min' | 'max' | 'nunique';

export type TimeGrain = 'auto' | 'day' | 'week' | 'month' | 'quarter' | 'year';

interface BlockBase {
  id: string;
  type: BlockType;
  /** Heading shown on the card. Empty → the model writes one. */
  title?: string;
  /** Free-text steer for this block alone. */
  note?: string;
}

export interface ChartBlock extends BlockBase {
  type: 'chart';
  chart: ChartKind;
  /** Column to measure. '' = the model chooses. 'count' = row count. */
  measure: string;
  /** Column to split by. '' = the model chooses (or none, for a histogram). */
  dimension: string;
  agg: Agg;
  /** Keep only the N largest groups, bundling the rest as "Other". 0 = all. */
  topN: number;
  sort: 'desc' | 'asc' | 'none';
  /** Resample grain when `dimension` is a date column. */
  grain: TimeGrain;
}

export interface KpiMetric {
  label: string;      // '' → derived from column + agg
  column: string;     // '' → the model chooses; 'count' → row count
  agg: Agg;
}

export interface KpiBlock extends BlockBase {
  type: 'kpi';
  /** Empty → the model picks the headline numbers itself. */
  metrics: KpiMetric[];
}

export interface TableBlock extends BlockBase {
  type: 'table';
  /** Empty → all columns. */
  columns: string[];
  sortBy: string;
  sortDir: 'asc' | 'desc';
  maxRows: number;
}

export interface TextBlock extends BlockBase {
  type: 'text';
  /** The user's own prose, reproduced verbatim — never rewritten by the model. */
  body: string;
}

export interface ListBlock extends BlockBase {
  type: 'insights' | 'recommendations';
  count: number;      // 0 = model's choice
}

export interface PlainBlock extends BlockBase {
  type: 'quality' | 'correlations' | 'summary' | 'methodology' | 'divider';
}

export type ReportBlock = ChartBlock | KpiBlock | TableBlock | TextBlock | ListBlock | PlainBlock;

// ── Block catalogue (drives the "add block" menu) ───────────────────────────

export interface BlockKind {
  type: BlockType;
  label: string;
  icon: string;
  description: string;
  /** Whether the block has data-bound configuration worth showing pickers for. */
  configurable: boolean;
}

export const BLOCK_KINDS: BlockKind[] = [
  { type: 'kpi',    label: 'KPI tiles',   icon: '▣', configurable: true,
    description: 'Headline numbers. Pick the metrics or let the model choose.' },
  { type: 'chart',  label: 'Chart',       icon: '▤', configurable: true,
    description: 'One chart — measure, dimension, aggregation and type.' },
  { type: 'table',  label: 'Table',       icon: '▦', configurable: true,
    description: 'Sortable, filterable rows. Choose columns and ordering.' },
  { type: 'summary', label: 'Summary',    icon: '¶', configurable: false,
    description: 'A short plain-language summary of what the data shows.' },
  { type: 'insights', label: 'Key insights', icon: '◆', configurable: true,
    description: 'Specific, numeric findings as bullets.' },
  { type: 'recommendations', label: 'Recommendations', icon: '➜', configurable: true,
    description: 'Concrete actions tied to the findings.' },
  { type: 'quality', label: 'Data quality', icon: '⚠', configurable: false,
    description: 'Nulls, duplicates, type drift, impossible values.' },
  { type: 'correlations', label: 'Relationships', icon: '⇄', configurable: false,
    description: 'Correlations between numeric columns.' },
  { type: 'text',   label: 'My own text', icon: '✎', configurable: true,
    description: 'Your commentary, reproduced exactly as written.' },
  { type: 'methodology', label: 'Methodology', icon: '⚙', configurable: false,
    description: 'How the numbers were computed, and the caveats.' },
  { type: 'divider', label: 'Divider',    icon: '—', configurable: false,
    description: 'A visual break between parts of the report.' },
];

let _idCounter = 0;
/** Short, stable-enough block id. Stamped into the HTML as `data-block-id`. */
export function newBlockId(): string {
  _idCounter = (_idCounter + 1) % 100000;
  return `b${Date.now().toString(36)}${_idCounter.toString(36)}`;
}

/** A new block of the given type with sensible defaults. */
export function makeBlock(type: BlockType): ReportBlock {
  const id = newBlockId();
  switch (type) {
    case 'chart':
      return { id, type, chart: 'auto', measure: '', dimension: '', agg: 'auto', topN: 10, sort: 'desc', grain: 'auto' };
    case 'kpi':
      return { id, type, metrics: [] };
    case 'table':
      return { id, type, columns: [], sortBy: '', sortDir: 'desc', maxRows: 100 };
    case 'text':
      return { id, type, body: '' };
    case 'insights':
    case 'recommendations':
      return { id, type, count: 0 };
    default:
      return { id, type } as PlainBlock;
  }
}

// ── Section ids → blocks (back-compat with the 2.11 archetypes) ─────────────

/**
 * The archetypes in reportDesign.ts describe a report as a list of section ids.
 * A block outline is a superset, so an archetype becomes the user's starting
 * outline, which they then edit.
 */
export function blocksFromSections(sections: string[]): ReportBlock[] {
  const out: ReportBlock[] = [];
  for (const s of sections) {
    switch (s) {
      case 'kpis':        out.push(makeBlock('kpi')); break;
      case 'summary':     out.push(makeBlock('summary')); break;
      case 'insights':    out.push(makeBlock('insights')); break;
      case 'recommendations': out.push(makeBlock('recommendations')); break;
      case 'quality':     out.push(makeBlock('quality')); break;
      case 'correlations': out.push(makeBlock('correlations')); break;
      case 'methodology': out.push(makeBlock('methodology')); break;
      case 'table':       out.push(makeBlock('table')); break;
      case 'trends': {
        const b = makeBlock('chart') as ChartBlock;
        b.chart = 'line'; b.grain = 'auto'; b.title = 'Trend over time';
        out.push(b); break;
      }
      case 'breakdowns': {
        const b = makeBlock('chart') as ChartBlock;
        b.chart = 'bar'; b.topN = 10; b.sort = 'desc'; b.title = 'Breakdown by category';
        out.push(b); break;
      }
      case 'distributions': {
        const b = makeBlock('chart') as ChartBlock;
        b.chart = 'histogram'; b.title = 'Distribution';
        out.push(b); break;
      }
      default: break;
    }
  }
  return out;
}

// ── Data preparation ────────────────────────────────────────────────────────

export type FilterOp =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'notContains' | 'in' | 'notIn'
  | 'isNull' | 'notNull' | 'between';

export interface DataFilter {
  column: string;
  op: FilterOp;
  value: string;
  /** Second bound for `between`. */
  value2?: string;
}

export interface DerivedColumn {
  name: string;
  /** A pandas-eval expression over existing columns, e.g. `revenue / orders`. */
  expression: string;
}

/**
 * Derived columns become `df.eval(<expression>)` in a script the user then runs,
 * and templates are JSON files that get committed, shared and downloaded. So an
 * expression is untrusted input, not something the local user necessarily typed.
 *
 * Restrict it to arithmetic over column names: identifiers, numbers, operators,
 * parentheses, comparisons and quoted strings. That covers everything a derived
 * column legitimately needs (`revenue / orders`, `qty * price > 100`) while
 * excluding attribute access, calls, and dunder tricks — the routes by which a
 * pandas eval expression turns into arbitrary code execution.
 */
export function isSafeExpression(expr: string): boolean {
  const e = expr.trim();
  if (!e || e.length > 200) return false;
  // A derived column is one expression. A line break only ever means someone is
  // trying to smuggle in a second statement.
  if (/[\r\n]/.test(e)) return false;
  if (!/^[A-Za-z0-9_\s+\-*/%().,<>=!&|'"`]+$/.test(e)) return false;
  if (/__|\bimport\b|\bexec\b|\beval\b|\bopen\b|\bsubprocess\b|\bos\b|\bsys\b/.test(e)) return false;
  // No attribute access or calls: `x.y` and `f(...)` are both routes out.
  if (/[A-Za-z0-9_\s)]\s*\(/.test(e)) return false;
  if (/\.[A-Za-z_]/.test(e)) return false;
  return true;
}

export interface DataPrep {
  filters: DataFilter[];
  /** Columns dropped before analysis (PII, noise, free-text blobs). */
  excludeColumns: string[];
  derived: DerivedColumn[];
  /** Drop exact duplicate rows. */
  dedupe: boolean;
  /** Hard row cap after filtering. 0 = no cap. */
  limit: number;
}

export const EMPTY_PREP: DataPrep = {
  filters: [], excludeColumns: [], derived: [], dedupe: false, limit: 0,
};

export function isPrepEmpty(p: DataPrep | undefined): boolean {
  if (!p) return true;
  return !p.filters.length && !p.excludeColumns.length && !p.derived.length && !p.dedupe && !p.limit;
}

const OP_LABEL: Record<FilterOp, string> = {
  eq: 'is', ne: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤',
  contains: 'contains', notContains: 'does not contain',
  in: 'is one of', notIn: 'is not one of',
  isNull: 'is empty', notNull: 'is not empty', between: 'between',
};

export function describeFilter(f: DataFilter): string {
  if (f.op === 'isNull' || f.op === 'notNull') return `${f.column} ${OP_LABEL[f.op]}`;
  if (f.op === 'between') return `${f.column} between ${f.value} and ${f.value2 ?? ''}`;
  return `${f.column} ${OP_LABEL[f.op]} ${f.value}`;
}

export function describePrep(p: DataPrep): string[] {
  const out: string[] = [];
  for (const f of p.filters) out.push(`Filter: ${describeFilter(f)}`);
  if (p.excludeColumns.length) out.push(`Excluded columns: ${p.excludeColumns.join(', ')}`);
  for (const d of p.derived) out.push(`Derived column \`${d.name}\` = ${d.expression}`);
  if (p.dedupe) out.push('Exact duplicate rows removed');
  if (p.limit) out.push(`Limited to the first ${p.limit.toLocaleString()} rows after filtering`);
  return out;
}

/** Python literal for a filter value, typed by what it looks like. */
function pyLit(v: string): string {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true' ? 'True' : 'False';
  return JSON.stringify(t);
}

function pyCol(c: string): string { return `df[${JSON.stringify(c)}]`; }

/**
 * Real pandas for the prep step, generated here rather than asked for.
 * A filter the user set must actually run — not depend on a model remembering
 * a sentence in a prompt. Every step is guarded so a bad column name degrades
 * to a printed note instead of aborting the report.
 */
export function dataPrepPython(prep: DataPrep): string {
  if (isPrepEmpty(prep)) return '';
  const lines: string[] = [
    '',
    '# ── Data preparation (configured by the user, applied before analysis) ───',
    '# Prep runs immediately after the load, which is BEFORE the script coerces',
    '# its stringy-numeric columns — so a raw "$1,284,900" is still text here.',
    '# Every numeric comparison therefore cleans the value itself; without this,',
    '# a perfectly reasonable filter silently matches nothing.',
    'def _evolve_numeric(_s):',
    '    return pd.to_numeric(_s.astype(str).str.replace(r"[^0-9eE+.-]", "", regex=True), errors="coerce")',
    '',
    '_prep_notes = []',
    '_rows_before = len(df)',
  ];

  for (const d of prep.derived) {
    const safeName = d.name.replace(/[^\w .-]/g, '');
    if (!isSafeExpression(d.expression)) {
      // Refuse rather than emit it: a template from elsewhere must not be able
      // to run arbitrary code just because someone opened and ran it.
      lines.push(`print("note: derived column ${safeName} skipped — its expression is not a plain arithmetic expression")`);
      continue;
    }
    // Same problem as the filters: the operands are very often still strings at
    // this point. Try the expression as-is, then retry against a numerically
    // coerced copy before giving up.
    lines.push(
      'try:',
      `    df[${JSON.stringify(d.name)}] = df.eval(${JSON.stringify(d.expression)})`,
      `    _prep_notes.append("derived column ${safeName}")`,
      'except Exception:',
      '    try:',
      '        _tmp = df.copy()',
      '        for _c in _tmp.columns:',
      // Not `dtype == object`: pandas 3 gives text columns a dedicated `str`
      // dtype, so an object check silently skips every string column there.
      '            if not pd.api.types.is_numeric_dtype(_tmp[_c]):',
      '                _conv = _evolve_numeric(_tmp[_c])',
      '                if _conv.notna().any():',
      '                    _tmp[_c] = _conv',
      `        df[${JSON.stringify(d.name)}] = _tmp.eval(${JSON.stringify(d.expression)})`,
      `        _prep_notes.append("derived column ${safeName}")`,
      '    except Exception as _e:',
      `        print("note: could not compute derived column ${safeName}:", _e)`,
    );
  }

  for (const f of prep.filters) {
    const col = JSON.stringify(f.column);
    let cond: string;
    switch (f.op) {
      case 'eq':  cond = `${pyCol(f.column)} == ${pyLit(f.value)}`; break;
      case 'ne':  cond = `${pyCol(f.column)} != ${pyLit(f.value)}`; break;
      case 'gt':  cond = `_evolve_numeric(${pyCol(f.column)}) > ${pyLit(f.value)}`; break;
      case 'gte': cond = `_evolve_numeric(${pyCol(f.column)}) >= ${pyLit(f.value)}`; break;
      case 'lt':  cond = `_evolve_numeric(${pyCol(f.column)}) < ${pyLit(f.value)}`; break;
      case 'lte': cond = `_evolve_numeric(${pyCol(f.column)}) <= ${pyLit(f.value)}`; break;
      case 'contains':    cond = `${pyCol(f.column)}.astype(str).str.contains(${pyLit(f.value)}, case=False, na=False)`; break;
      case 'notContains': cond = `~${pyCol(f.column)}.astype(str).str.contains(${pyLit(f.value)}, case=False, na=False)`; break;
      case 'in':    cond = `${pyCol(f.column)}.isin(${JSON.stringify(f.value.split(',').map(s => s.trim()))})`; break;
      case 'notIn': cond = `~${pyCol(f.column)}.isin(${JSON.stringify(f.value.split(',').map(s => s.trim()))})`; break;
      case 'isNull':  cond = `${pyCol(f.column)}.isna()`; break;
      case 'notNull': cond = `${pyCol(f.column)}.notna()`; break;
      case 'between': cond =
        `_evolve_numeric(${pyCol(f.column)}).between(${pyLit(f.value)}, ${pyLit(f.value2 ?? f.value)})`; break;
    }
    lines.push(
      'try:',
      `    if ${col} in df.columns:`,
      `        df = df[${cond}]`,
      `        _prep_notes.append(${JSON.stringify(describeFilter(f))})`,
      '    else:',
      `        print("note: filter skipped, no column", ${col})`,
      'except Exception as _e:',
      `    print("note: filter on", ${col}, "failed:", _e)`,
    );
  }

  if (prep.excludeColumns.length) {
    lines.push(
      'try:',
      `    df = df.drop(columns=[c for c in ${JSON.stringify(prep.excludeColumns)} if c in df.columns])`,
      'except Exception as _e:',
      '    print("note: could not drop columns:", _e)',
    );
  }
  if (prep.dedupe) {
    lines.push('try:', '    df = df.drop_duplicates()', '    _prep_notes.append("removed duplicate rows")',
               'except Exception as _e:', '    print("note: dedupe failed:", _e)');
  }
  if (prep.limit > 0) {
    lines.push(`df = df.head(${prep.limit})`);
  }

  lines.push(
    'print("prep: " + format(_rows_before, ",") + " rows -> " + format(len(df), ",") + " rows")',
    'if len(df) == 0:',
    // Continuing produces a traceback deep inside the analysis (idxmax of an
    // empty series, etc.). A clear stop naming the filters is far more useful
    // than an empty report or a stack trace.
    '    print("")',
    '    print("STOPPED: data preparation removed every row, so there is nothing to report.")',
    '    print("Active filters:")',
    // JSON.stringify, not hand-rolled quote swapping: these strings can contain
    // a user-authored expression, and a trailing backslash would otherwise
    // escape the closing quote and break out of the literal.
    ...describePrep(prep).map(d => `    print(${JSON.stringify(`  - ${d}`)})`),
    '    print("Loosen or remove a filter and run this script again.")',
    '    raise SystemExit(0)',
    '',
  );
  return lines.join('\n');
}

/**
 * Splice the prep step into a generated script, immediately after the frame is
 * loaded. Position matters: before the load there is no `df`, and after the
 * analysis the filters would change nothing.
 *
 * The load statement is found rather than assumed, and its indentation is
 * matched — a `pd.read_csv` inside a `try:` block is common, and inserting
 * top-level code under it would be a syntax error. If no load can be found the
 * prep is not injected at all and the script says so, because silently
 * dropping a filter the user set would make the report quietly wrong.
 */
export function injectDataPrep(script: string, prep: DataPrep): string {
  if (isPrepEmpty(prep)) return script;
  if (script.includes('# ── Data preparation (configured by the user')) return script;

  const lines = script.split('\n');
  const loadRe = /^([ \t]*)(?:\w+\s*=\s*)?pd\.read_\w+\s*\(/;

  // Take the LAST load: scripts sometimes probe a file before the real read.
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (loadRe.test(lines[i])) start = i;

  if (start === -1) {
    return script.replace(
      /^/,
      '# WARNING: Evolve AI could not find where this script loads its DataFrame, so the\n' +
      '# data-preparation steps you configured were NOT applied:\n' +
      describePrep(prep).map(d => `#   - ${d}\n`).join('') +
      '# Apply them by hand, or regenerate the report.\n\n',
    );
  }

  // Walk to the end of the (possibly multi-line) call by balancing parens.
  let depth = 0, end = start;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth <= 0) { end = i; break; }
    end = i;
  }

  const indent = (loadRe.exec(lines[start]) ?? [, ''])[1] ?? '';
  const block = dataPrepPython(prep)
    .split('\n')
    .map(l => (l.trim() ? indent + l : l))
    .join('\n');

  lines.splice(end + 1, 0, block);
  return lines.join('\n');
}

/** The prep summary the report should disclose, so filtered numbers aren't misread. */
export function dataPrepPromptFragment(prep: DataPrep): string {
  if (isPrepEmpty(prep)) return '';
  return [
    '## Data preparation already applied',
    'The rows you were given have ALREADY been through these steps — do not re-apply them, and do not',
    'describe the full dataset as if these were not in effect:',
    ...describePrep(prep).map(d => `- ${d}`),
    'State the active filters plainly in the methodology or the report subtitle, so nobody reads a filtered',
    'figure as a total.',
  ].join('\n');
}

// ── Blocks → prompt ─────────────────────────────────────────────────────────

function aggWord(a: Agg): string {
  return a === 'auto' ? 'an aggregation you judge appropriate'
    : a === 'nunique' ? 'the distinct count' : `the ${a}`;
}

function chartWord(c: ChartKind): string {
  const m: Record<ChartKind, string> = {
    auto: 'the chart type best suited to the data',
    bar: 'a vertical bar chart', barh: 'a horizontal bar chart',
    line: 'a line chart', area: 'an area chart', scatter: 'a scatter plot',
    pie: 'a pie chart', histogram: 'a histogram', box: 'a box plot',
  };
  return m[c];
}

function describeChartBlock(b: ChartBlock): string {
  const bits: string[] = [];
  const measure = b.measure === 'count' ? 'the row count'
    : b.measure ? `${aggWord(b.agg)} of \`${b.measure}\`` : 'the most informative measure';
  const dim = b.dimension ? ` broken down by \`${b.dimension}\`` : '';
  bits.push(`Plot ${measure}${dim} as ${chartWord(b.chart)}.`);
  if (b.dimension && b.grain !== 'auto') bits.push(`Resample the time axis to ${b.grain}.`);
  if (b.topN > 0 && b.dimension) bits.push(`Show only the top ${b.topN} groups and bundle the remainder as "Other".`);
  if (b.sort !== 'none' && b.dimension) bits.push(`Order bars ${b.sort === 'desc' ? 'descending' : 'ascending'} by value (unless the dimension has a natural order).`);
  return bits.join(' ');
}

function describeKpiBlock(b: KpiBlock): string {
  if (!b.metrics.length) return 'A KPI tile row. Choose the 3–6 numbers that matter most for this data.';
  const items = b.metrics.map(m => {
    const label = m.label ? `labelled "${m.label}"` : 'with a short label you write';
    const col = m.column === 'count' ? 'the row count' : `${aggWord(m.agg)} of \`${m.column}\``;
    return `${col}, ${label}`;
  });
  return `A KPI tile row with exactly these tiles, in this order:\n${items.map(i => `   - ${i}`).join('\n')}`;
}

function describeTableBlock(b: TableBlock): string {
  const cols = b.columns.length ? `Columns, in this order: ${b.columns.map(c => `\`${c}\``).join(', ')}.` : 'Include the most relevant columns.';
  const sort = b.sortBy ? ` Sort by \`${b.sortBy}\` ${b.sortDir === 'desc' ? 'descending' : 'ascending'}.` : '';
  return `A sortable data table (${b.maxRows} rows maximum). ${cols}${sort}`;
}

/** Per-block instructions, in outline order. `target` picks the rendering path. */
export function blocksToPrompt(blocks: ReportBlock[], target: 'html' | 'script' = 'html'): string {
  if (!blocks.length) return '';
  const howToEmit = target === 'html'
    ? ['Each numbered item is one `<section class="card">` (except the divider). Stamp each card with the given',
       'id: `<section class="card" data-block-id="…" data-block-type="…">` — the editor uses these attributes to',
       'address individual blocks, and a card without them cannot be moved or refined on its own.']
    : ['Build each numbered item with `evolve_card(title, inner_html, block_id="…", block_type="…")`, appending to',
       '`body_html` in this order. The block_id arguments are what make individual cards addressable afterwards.'];

  const lines: string[] = [
    '### Report outline — build exactly these blocks, in this order',
    ...howToEmit,
    'Do not add, merge, reorder or drop blocks. Where a block leaves something unspecified, choose well; where',
    'it specifies something, follow it exactly.',
    '',
  ];

  blocks.forEach((b, i) => {
    const n = i + 1;
    const attrs = `data-block-id="${b.id}" data-block-type="${b.type}"`;
    const title = b.title ? ` Heading: "${b.title}".` : '';
    let body: string;
    switch (b.type) {
      case 'chart':   body = describeChartBlock(b); break;
      case 'kpi':     body = describeKpiBlock(b); break;
      case 'table':   body = describeTableBlock(b); break;
      case 'text':
        body = 'Reproduce the following text EXACTLY as written, as the card body. Do not reword, ' +
               'summarise, extend or fact-check it — it is the author\'s own commentary:\n' +
               `   """${b.body}"""`;
        break;
      case 'insights':
        body = `A \`<ul class="insights">\` of ${b.count > 0 ? `exactly ${b.count}` : '3–6'} specific, numeric findings.`;
        break;
      case 'recommendations':
        body = `An \`<ol class="actions">\` of ${b.count > 0 ? `exactly ${b.count}` : '2–4'} concrete actions, each tied to a finding above.`;
        break;
      case 'quality':
        body = 'Data-quality findings: nulls, duplicates, type inconsistencies, impossible values. Say plainly if the data is clean.';
        break;
      case 'correlations':
        body = 'The strongest relationships between numeric columns. State coefficients. Never imply causation.';
        break;
      case 'summary':
        body = 'A 2–4 sentence plain-language summary of what the data shows and why it matters.';
        break;
      case 'methodology':
        body = 'How the numbers were computed, what was excluded, and the limits of the data. Brief and honest.';
        break;
      case 'divider':
        body = 'A visual break: emit `<hr class="block-divider" ' + attrs + '>` and nothing else.';
        break;
    }
    lines.push(`${n}. **${b.type}** (${attrs})${title}\n   ${body}${b.note ? `\n   Additional steer: ${b.note}` : ''}`);
  });

  lines.push(
    '',
    'If a block genuinely cannot be built from this data (a trend with no date column, a measure that is not',
    'numeric), still emit the card with its id and put a short `<div class="callout warn">` inside saying what',
    'is missing. A silently dropped block looks like a bug to the person who asked for it.',
  );
  return lines.join('\n');
}

/** The same outline, for the generated-Python path. */
export function blocksToScriptPrompt(blocks: ReportBlock[]): string {
  return blocksToPrompt(blocks, 'script');
}

// ── Templates ───────────────────────────────────────────────────────────────

export const TEMPLATES_DIR = 'evolve-report-templates';

export interface ReportTemplate {
  version: 1;
  name: string;
  description: string;
  /** Everything about the report's shape, minus the data it was built from. */
  spec: ReportSpec;
  prep: DataPrep;
  /** Brand overrides captured at save time; omitted keys fall back to the workspace theme. */
  theme?: Partial<ReportTheme>;
  createdFrom?: string;
  createdAt?: string;
}

export function templatePath(wsPath: string, name: string): string {
  return path.join(wsPath, TEMPLATES_DIR, `${slugify(name)}.json`);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'report-template';
}

export function saveTemplate(wsPath: string, tpl: ReportTemplate): string {
  const dir = path.join(wsPath, TEMPLATES_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = templatePath(wsPath, tpl.name);
  fs.writeFileSync(file, JSON.stringify(tpl, null, 2), 'utf8');
  return file;
}

export function listTemplates(wsPath: string | undefined): Array<{ file: string; tpl: ReportTemplate }> {
  if (!wsPath) return [];
  const dir = path.join(wsPath, TEMPLATES_DIR);
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ file: string; tpl: ReportTemplate }> = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    const tpl = loadTemplate(file);
    if (tpl) out.push({ file, tpl });
  }
  return out;
}

export function loadTemplate(file: string): ReportTemplate | null {
  try {
    const raw = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as ReportTemplate;
    if (!raw || typeof raw !== 'object' || !raw.spec) return null;
    // Re-key the blocks: a template re-run must not reuse ids from the report it
    // was captured from, or two reports open at once would address each other's.
    const blocks = Array.isArray(raw.spec.blocks)
      ? (raw.spec.blocks as ReportBlock[])
          .filter(b => !!b && typeof b === 'object' && typeof b.type === 'string')
          .map(b => ({ ...b, id: newBlockId() }))
      : [];
    return {
      ...raw,
      version: 1,
      prep: { ...EMPTY_PREP, ...(raw.prep ?? {}) },
      spec: { ...raw.spec, blocks },
    };
  } catch {
    return null;
  }
}

// ── Reading an outline back out of a rendered report ────────────────────────

/**
 * After the user has reordered and deleted cards by hand, the HTML — not the
 * in-memory spec — is the truth. Recover the outline from the stamped
 * attributes so "save as template" captures what is actually on screen.
 */
export function blocksFromHtml(html: string, previous: ReportBlock[]): ReportBlock[] {
  const byId = new Map(previous.map(b => [b.id, b]));
  const out: ReportBlock[] = [];
  const re = /data-block-id="([^"]+)"[^>]*?data-block-type="([^"]+)"|data-block-type="([^"]+)"[^>]*?data-block-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(html)) !== null) {
    const id   = m[1] ?? m[4];
    const type = (m[2] ?? m[3]) as BlockType;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const prev = byId.get(id);
    // Keep the id that is actually in the document. Minting a fresh one here
    // would leave the outline describing blocks that no longer match the HTML
    // it was recovered from — and the HTML is the source of truth.
    out.push(prev ? { ...prev } : ({ ...makeBlock(type), id } as ReportBlock));
  }
  // A report generated before block stamping has no ids — keep the old outline.
  return out.length ? out : previous;
}

/** Human summary of an outline, for quick picks and status lines. */
export function describeBlocks(blocks: ReportBlock[]): string {
  if (!blocks.length) return 'no blocks';
  const counts = new Map<BlockType, number>();
  for (const b of blocks) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  return [...counts.entries()].map(([t, n]) => (n > 1 ? `${n}× ${t}` : t)).join(', ');
}