/**
 * core/reportDesign.ts — the design system behind every Evolve AI HTML report.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reports used to be whatever the model felt like emitting: no typography scale,
 * no palette, no dark mode, no print styles. Asking an LLM to "make it look nice"
 * in prose produces a different — and usually plain — result every run.
 *
 * So the design is not left to the model. This module owns it:
 *
 *   - `reportStylesheet(theme)`  → the real CSS, written here, not generated.
 *   - `reportScript(theme)`      → sortable tables, filter, theme toggle, print.
 *   - `pythonPreamble(...)`      → the same CSS/JS/palette as Python constants +
 *                                  helpers, injected into generated analysis
 *                                  scripts so the script path looks identical.
 *   - `injectReportAssets(...)`  → stamps the stylesheet + script into finished
 *                                  HTML, so styling holds even if the model
 *                                  ignored instructions.
 *
 * The model's job shrinks to what it is actually good at: choosing the right
 * sections, computing the right numbers, and writing the narrative — emitting
 * semantic HTML against a documented class contract.
 *
 * Everything is driven by a `ReportTheme` (brand colours, logo, footer) loaded
 * from an optional `evolve-report-theme.json` in the workspace, and a per-run
 * `ReportSpec` (archetype, audience, sections, chart budget).
 */

import * as path from 'path';
import * as fs   from 'fs';
import { stripJsonComments } from './jsonc';

// ── Theme ───────────────────────────────────────────────────────────────────

export const THEME_FILENAME = 'evolve-report-theme.json';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type Audience  = 'exec' | 'analyst' | 'engineer' | 'mixed';
export type Tone      = 'concise' | 'balanced' | 'detailed';

export interface ReportTheme {
  /** Shown in the report header next to the title. Empty = no brand line. */
  brandName: string;
  /** Primary accent — drives links, KPI accents, the first chart series. */
  accent: string;
  /** Categorical series colours, exposed to the report as --c1 … --cN. */
  palette: string[];
  /** `auto` follows the reader's OS; `light`/`dark` pin the report. */
  mode: ThemeMode;
  fontStack: string;
  monoStack: string;
  /** Optional `data:image/…` logo. Never a URL — reports must stay offline. */
  logoDataUri: string;
  /** Footer line, e.g. "Confidential — Acme Analytics". */
  footer: string;
  /** Defaults applied when the user doesn't customise a run. */
  defaultArchetype: string;
  defaultAudience: Audience;
  defaultSections: string[];
  maxCharts: number;
  density: 'comfortable' | 'compact';
}

export const DEFAULT_PALETTE = [
  '#4f6df5', '#e8873a', '#12a594', '#d6455d',
  '#8b5cf6', '#3aa0e8', '#5aa84f', '#c2528f',
];

export const DEFAULT_THEME: ReportTheme = {
  brandName: '',
  accent: '#4f6df5',
  palette: DEFAULT_PALETTE,
  mode: 'auto',
  fontStack: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  monoStack: `'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`,
  logoDataUri: '',
  footer: '',
  defaultArchetype: 'executive',
  defaultAudience: 'mixed',
  defaultSections: [],          // empty → the archetype decides
  maxCharts: 6,
  density: 'comfortable',
};

/**
 * Load `evolve-report-theme.json` from the workspace root, falling back to
 * defaults for anything missing or malformed. A broken theme file must never
 * block a report — it degrades to the built-in look.
 */
export function loadReportTheme(wsPath: string | undefined): ReportTheme {
  if (!wsPath) return { ...DEFAULT_THEME };
  const file = path.join(wsPath, THEME_FILENAME);
  if (!fs.existsSync(file)) return { ...DEFAULT_THEME };
  try {
    const raw = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as Record<string, unknown>;
    const str = (k: string, d: string): string => typeof raw[k] === 'string' ? raw[k] as string : d;
    const num = (k: string, d: number): number => typeof raw[k] === 'number' ? raw[k] as number : d;
    const palette = Array.isArray(raw.palette) && raw.palette.length
      ? (raw.palette as unknown[]).filter(c => typeof c === 'string' && isHex(c as string)) as string[]
      : DEFAULT_THEME.palette;
    const mode = ['auto', 'light', 'dark'].includes(String(raw.theme ?? raw.mode))
      ? String(raw.theme ?? raw.mode) as ThemeMode
      : DEFAULT_THEME.mode;
    const accent = isHex(str('accent', '')) ? str('accent', '') : DEFAULT_THEME.accent;
    const sections = Array.isArray(raw.defaultSections)
      ? (raw.defaultSections as unknown[]).filter(s => typeof s === 'string') as string[]
      : DEFAULT_THEME.defaultSections;
    return {
      brandName:  str('brandName', DEFAULT_THEME.brandName),
      accent,
      palette:    palette.length ? palette : DEFAULT_PALETTE,
      mode,
      fontStack:  str('font', DEFAULT_THEME.fontStack),
      monoStack:  str('monoFont', DEFAULT_THEME.monoStack),
      logoDataUri: str('logo', '').startsWith('data:') ? str('logo', '') : '',
      footer:     str('footer', DEFAULT_THEME.footer),
      defaultArchetype: str('defaultArchetype', DEFAULT_THEME.defaultArchetype),
      defaultAudience: (['exec', 'analyst', 'engineer', 'mixed'].includes(str('defaultAudience', ''))
        ? str('defaultAudience', '') : DEFAULT_THEME.defaultAudience) as Audience,
      defaultSections: sections,
      maxCharts:  Math.max(1, Math.min(20, num('maxCharts', DEFAULT_THEME.maxCharts))),
      density:    str('density', '') === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

function isHex(c: string): boolean { return /^#[0-9a-fA-F]{3,8}$/.test(c); }

/** "#4f6df5" → "79, 109, 245" so the CSS can build rgba() tints without color-mix. */
export function hexToRgbTriple(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return '79, 109, 245';
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// ── Report spec (per-run customisation) ─────────────────────────────────────

export interface ReportSpec {
  archetype: string;
  audience:  Audience;
  tone:      Tone;
  /** Section ids, in the order they should appear. */
  sections:  string[];
  maxCharts: number;
  /** Overrides `theme.mode` for this run. */
  mode:      ThemeMode;
  /** Overrides `theme.accent` for this run. */
  accent:    string;
  /** Report title. Empty → derived from the dataset name. */
  title:     string;
  /** Free-text steer, same field the old single input box collected. */
  focus:     string;
  /** Extra rules accumulated from refinement rounds — kept for regeneration. */
  notes:     string[];
}

export interface ReportSection {
  id: string;
  label: string;
  /** What the model must actually produce for this section. */
  guidance: string;
}

export const REPORT_SECTIONS: ReportSection[] = [
  { id: 'summary',    label: 'Executive summary',
    guidance: 'A 2–4 sentence plain-language summary of what the data shows and why it matters. No hedging, no restating the schema.' },
  { id: 'kpis',       label: 'KPI tiles',
    guidance: 'A `.kpi-grid` of 3–6 headline numbers with short labels. Include a `.kpi-note` giving each number context (period, denominator, or comparison) where the data supports it.' },
  { id: 'trends',     label: 'Trends over time',
    guidance: 'Time-series of the most meaningful measures. Call out direction and magnitude of change in the caption. Only if the data has a usable date/time column.' },
  { id: 'breakdowns', label: 'Breakdowns by category',
    guidance: 'Ranked bar charts and/or tables of the key measure split by the most informative categorical dimensions. Show the top 10 and group the tail as "Other".' },
  { id: 'distributions', label: 'Distributions',
    guidance: 'Histograms or box plots for the important numeric columns, with a note on skew, spread, and outliers.' },
  { id: 'correlations', label: 'Relationships',
    guidance: 'Correlations between numeric columns (numeric-only). Report only the strongest few, state the coefficient, and never imply causation.' },
  { id: 'quality',    label: 'Data quality',
    guidance: 'Null counts, duplicates, type inconsistencies, impossible values, and suspicious constants — as a `.callout.warn` list or a compact table. Say plainly when the data is clean.' },
  { id: 'table',      label: 'Data table',
    guidance: 'A `.table-wrap > table.data` of the most relevant rows (cap at ~100). Add `data-sortable` to the table so the reader can sort it.' },
  { id: 'insights',   label: 'Key insights',
    guidance: 'A `ul.insights` of 3–6 specific, numeric findings. Each bullet leads with the finding, not the method.' },
  { id: 'recommendations', label: 'Recommendations',
    guidance: '2–4 concrete actions the reader could take, each tied to a specific finding above.' },
  { id: 'methodology', label: 'Methodology & caveats',
    guidance: 'How the numbers were computed, what was excluded, and the limits of the data. Brief and honest.' },
];

const SECTION_IDS = new Set(REPORT_SECTIONS.map(s => s.id));

export interface ReportArchetype {
  id: string;
  label: string;
  description: string;
  sections: string[];
  tone: Tone;
  maxCharts: number;
  /** Archetype-specific framing added to the prompt. */
  guidance: string;
}

export const REPORT_ARCHETYPES: ReportArchetype[] = [
  {
    id: 'executive',
    label: 'Executive summary',
    description: 'Headline numbers, a few high-signal charts, insights and actions',
    sections: ['summary', 'kpis', 'trends', 'breakdowns', 'insights', 'recommendations'],
    tone: 'concise',
    maxCharts: 4,
    guidance:
      'Write for a decision-maker who will spend 90 seconds on this. Lead with the answer. Every chart must ' +
      'earn its place — prefer four excellent charts over ten mediocre ones. No methodology digressions, ' +
      'no raw data dumps, no column-by-column walkthrough.',
  },
  {
    id: 'deepdive',
    label: 'Deep-dive analysis',
    description: 'Full exploratory analysis — distributions, relationships, breakdowns, table',
    sections: ['summary', 'kpis', 'distributions', 'trends', 'breakdowns', 'correlations', 'quality', 'table', 'insights', 'methodology'],
    tone: 'detailed',
    maxCharts: 10,
    guidance:
      'Write for an analyst who wants to understand the dataset thoroughly. Be systematic: cover every ' +
      'meaningful column, but group related columns rather than producing one section per column. ' +
      'State coefficients, counts and percentages precisely.',
  },
  {
    id: 'quality',
    label: 'Data quality audit',
    description: 'Nulls, duplicates, type problems, outliers and impossible values',
    sections: ['summary', 'kpis', 'quality', 'distributions', 'table', 'recommendations', 'methodology'],
    tone: 'detailed',
    maxCharts: 4,
    guidance:
      'The subject of this report is the data itself, not the business it describes. KPI tiles should be ' +
      'quality metrics (completeness %, duplicate rate, columns with type drift, rows failing a sanity ' +
      'check). Rank issues by how much they would distort downstream analysis, and say which are safe to ' +
      'ignore. Recommendations are remediation steps.',
  },
  {
    id: 'timeseries',
    label: 'Trend & time-series',
    description: 'Movement over time — growth, seasonality, period-over-period change',
    sections: ['summary', 'kpis', 'trends', 'breakdowns', 'insights', 'recommendations', 'methodology'],
    tone: 'balanced',
    maxCharts: 6,
    guidance:
      'Centre the report on the time dimension. Resample to a sensible grain (daily/weekly/monthly) based ' +
      'on the span of the data. Quantify period-over-period change, identify the largest movements and ' +
      'when they happened, and note seasonality only if the data spans enough cycles to support the claim. ' +
      'Do NOT forecast — you have no model, and inventing a projection would be fabrication.',
  },
  {
    id: 'comparison',
    label: 'Segment comparison',
    description: 'How groups differ — ranked segments, gaps, over/under-performers',
    sections: ['summary', 'kpis', 'breakdowns', 'distributions', 'table', 'insights', 'recommendations'],
    tone: 'balanced',
    maxCharts: 6,
    guidance:
      'Pick the most informative categorical dimension(s) and compare segments against each other and ' +
      'against the overall average. Always show the segment size alongside its metric so the reader can ' +
      'discount small-n segments — and say so explicitly when a standout segment is small.',
  },
];

export function archetypeById(id: string): ReportArchetype {
  return REPORT_ARCHETYPES.find(a => a.id === id) ?? REPORT_ARCHETYPES[0];
}

/** Build a spec from the theme's defaults — the "just give me a report" path. */
export function defaultSpec(theme: ReportTheme, focus?: string): ReportSpec {
  const arch = archetypeById(theme.defaultArchetype);
  const sections = theme.defaultSections.filter(s => SECTION_IDS.has(s));
  return {
    archetype: arch.id,
    audience:  theme.defaultAudience,
    tone:      arch.tone,
    sections:  sections.length ? sections : arch.sections,
    maxCharts: Math.min(theme.maxCharts, arch.maxCharts),
    mode:      theme.mode,
    accent:    theme.accent,
    title:     '',
    focus:     focus ?? '',
    notes:     [],
  };
}

/** Apply a spec's per-run overrides on top of the workspace theme. */
export function themeForSpec(theme: ReportTheme, spec: ReportSpec): ReportTheme {
  const accent = isHex(spec.accent) ? spec.accent : theme.accent;
  // Keep the accent as series 1 so charts and chrome agree.
  const palette = [accent, ...theme.palette.filter(c => c.toLowerCase() !== accent.toLowerCase())].slice(0, 8);
  return { ...theme, accent, palette, mode: spec.mode };
}

const AUDIENCE_GUIDANCE: Record<Audience, string> = {
  exec:     'Audience: executives. Plain business language, no jargon, no code, no column names in prose — describe what a column measures instead of naming it.',
  analyst:  'Audience: data analysts. Precise statistics are welcome: counts, percentages, coefficients, quartiles. Name columns exactly as they appear.',
  engineer: 'Audience: data engineers. Emphasise schema, types, cardinality, null behaviour, and anything that would break a downstream pipeline.',
  mixed:    'Audience: mixed business and technical readers. Lead each section with a plain-language takeaway, then support it with the precise figures.',
};

const TONE_GUIDANCE: Record<Tone, string> = {
  concise:  'Tone: tight. Short paragraphs, no filler, no restating the obvious. Aim for a report that reads in under two minutes.',
  balanced: 'Tone: balanced. Explain each finding in two or three sentences — enough context to act on, not a lecture.',
  detailed: 'Tone: thorough. Explain what each analysis shows, why it was chosen, and what it does not tell us.',
};

// ── The stylesheet ──────────────────────────────────────────────────────────

/**
 * The canonical report stylesheet. Generated from the theme so brand colours
 * actually take effect, rather than being described to a model and hoped for.
 */
export function reportStylesheet(theme: ReportTheme): string {
  const rgb = hexToRgbTriple(theme.accent);
  const series = theme.palette.map((c, i) => `  --c${i + 1}: ${c};`).join('\n');
  const compact = theme.density === 'compact';
  return `
/* Evolve AI report design system */
:root {
  --acc: ${theme.accent};
  --acc-rgb: ${rgb};
${series}
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #fbfbfd;
  --text: #16181d;
  --text-dim: #5c6270;
  --text-faint: #8b90a0;
  --border: #e3e5ea;
  --border-strong: #cfd3db;
  --good: #1a7f52;
  --warn: #b06a00;
  --bad: #c2334a;
  --shadow: 0 1px 2px rgba(16,18,24,.05), 0 4px 16px rgba(16,18,24,.05);
  --radius: 12px;
  --gap: ${compact ? '14px' : '20px'};
  --pad: ${compact ? '16px' : '22px'};
  --maxw: 1180px;
  color-scheme: light;
}
:root[data-theme="dark"], :root[data-theme="dark"] * { color-scheme: dark; }
:root[data-theme="dark"] {
  --bg: #0f1116;
  --surface: #171a21;
  --surface-2: #1c2029;
  --text: #e8eaf0;
  --text-dim: #a3a9b8;
  --text-faint: #767d8e;
  --border: #262b35;
  --border-strong: #333a47;
  --good: #4bbd85;
  --warn: #e0a137;
  --bad: #f0687e;
  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 4px 20px rgba(0,0,0,.28);
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ${theme.fontStack};
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.report { max-width: var(--maxw); margin: 0 auto; padding: 32px 24px 64px; }

/* ── Header ─────────────────────────────────────────────────────────── */
.report-header {
  display: flex; align-items: flex-start; gap: 18px; flex-wrap: wrap;
  padding-bottom: 20px; margin-bottom: 26px;
  border-bottom: 1px solid var(--border);
}
.report-header .brand { display: flex; align-items: center; gap: 10px; }
.report-header img.logo { height: 34px; width: auto; display: block; }
.report-header .brand-name {
  font-size: 12px; font-weight: 650; letter-spacing: .10em; text-transform: uppercase;
  color: var(--acc);
}
.report-header .titles { flex: 1 1 340px; min-width: 0; }
.report-title { font-size: 27px; line-height: 1.22; font-weight: 700; letter-spacing: -.018em; margin: 0 0 6px; }
.report-subtitle { margin: 0; color: var(--text-dim); font-size: 14px; }
.report-meta {
  display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;
  font-size: 11.5px; color: var(--text-faint);
}
.report-meta span {
  background: var(--surface); border: 1px solid var(--border);
  padding: 3px 9px; border-radius: 999px; white-space: nowrap;
}

/* ── Layout ─────────────────────────────────────────────────────────── */
.grid { display: grid; gap: var(--gap); grid-template-columns: 1fr; }
.grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: var(--pad);
  box-shadow: var(--shadow); margin-bottom: var(--gap);
}
.card > h2 {
  font-size: 12px; font-weight: 650; letter-spacing: .085em; text-transform: uppercase;
  color: var(--text-dim); margin: 0 0 4px;
}
.card > h2 + .card-sub { margin: 0 0 16px; color: var(--text-faint); font-size: 13px; }
.card > h3 { font-size: 16px; font-weight: 650; margin: 20px 0 8px; letter-spacing: -.01em; }
.card > *:last-child { margin-bottom: 0; }
p { margin: 0 0 12px; }
a { color: var(--acc); text-decoration: none; }
a:hover { text-decoration: underline; }
strong { font-weight: 650; }
code, .mono { font-family: ${theme.monoStack}; font-size: .9em; }
code {
  background: rgba(var(--acc-rgb), .09); color: var(--text);
  padding: 1px 5px; border-radius: 4px;
}

/* ── KPI tiles ──────────────────────────────────────────────────────── */
.kpi-grid {
  display: grid; gap: var(--gap); margin-bottom: var(--gap);
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}
.kpi {
  position: relative; overflow: hidden;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 18px 18px 16px; box-shadow: var(--shadow);
}
.kpi::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 3px;
  background: var(--acc); opacity: .85;
}
.kpi:nth-child(8n+2)::before { background: var(--c2, var(--acc)); }
.kpi:nth-child(8n+3)::before { background: var(--c3, var(--acc)); }
.kpi:nth-child(8n+4)::before { background: var(--c4, var(--acc)); }
.kpi:nth-child(8n+5)::before { background: var(--c5, var(--acc)); }
.kpi:nth-child(8n+6)::before { background: var(--c6, var(--acc)); }
.kpi-label {
  font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--text-dim); margin-bottom: 8px;
}
.kpi-value {
  font-size: 30px; line-height: 1.1; font-weight: 700; letter-spacing: -.028em;
  font-variant-numeric: tabular-nums;
}
.kpi-value .unit { font-size: .5em; font-weight: 600; color: var(--text-dim); margin-left: 3px; letter-spacing: 0; }
.kpi-delta { display: inline-block; margin-top: 8px; font-size: 12.5px; font-weight: 600; }
.kpi-delta.up { color: var(--good); }
.kpi-delta.down { color: var(--bad); }
.kpi-delta.flat { color: var(--text-faint); }
.kpi-note { margin-top: 6px; font-size: 12px; color: var(--text-faint); line-height: 1.45; }

/* ── Charts ─────────────────────────────────────────────────────────── */
figure.chart { margin: 0 0 var(--gap); }
figure.chart:last-child { margin-bottom: 0; }
figure.chart svg, figure.chart img {
  display: block; width: 100%; height: auto; max-width: 100%;
  border-radius: 8px; background: var(--surface);
}
figure.chart img { border: 1px solid var(--border); }
figure.chart figcaption {
  margin-top: 10px; font-size: 12.5px; color: var(--text-dim); line-height: 1.5;
}
figure.chart figcaption strong { color: var(--text); }
.chart-title { font-size: 15px; font-weight: 650; margin: 0 0 10px; letter-spacing: -.01em; }
/* Inline-SVG chart primitives — the model styles marks with these. */
.axis line, .axis path { stroke: var(--border-strong); stroke-width: 1; fill: none; }
.axis text, .tick text { fill: var(--text-faint); font-size: 11px; }
.gridline { stroke: var(--border); stroke-width: 1; stroke-dasharray: 2 3; }
.series-1 { fill: var(--c1, var(--acc)); }
.series-2 { fill: var(--c2, var(--acc)); }
.series-3 { fill: var(--c3, var(--acc)); }
.series-4 { fill: var(--c4, var(--acc)); }
.series-5 { fill: var(--c5, var(--acc)); }
.series-6 { fill: var(--c6, var(--acc)); }
.line-1 { stroke: var(--c1, var(--acc)); fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.line-2 { stroke: var(--c2, var(--acc)); fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.line-3 { stroke: var(--c3, var(--acc)); fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--text-dim); }
.legend .key { display: inline-flex; align-items: center; gap: 6px; }
.legend .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

/* ── Tables ─────────────────────────────────────────────────────────── */
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
table.data { border-collapse: collapse; width: 100%; font-size: 13px; }
table.data th, table.data td {
  padding: 9px 14px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap;
}
table.data thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--surface-2); color: var(--text-dim);
  font-size: 11px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase;
  border-bottom: 1px solid var(--border-strong);
}
table.data tbody tr:last-child td { border-bottom: none; }
table.data tbody tr:hover { background: rgba(var(--acc-rgb), .05); }
table.data td.num, table.data th.num { text-align: right; font-variant-numeric: tabular-nums; }
table.data td.mono { font-family: ${theme.monoStack}; font-size: 12px; }
table.data[data-sortable] thead th { cursor: pointer; user-select: none; }
table.data[data-sortable] thead th::after {
  content: "↕"; opacity: .3; margin-left: 6px; font-size: 10px;
}
table.data[data-sortable] thead th.sort-asc::after  { content: "↑"; opacity: .9; color: var(--acc); }
table.data[data-sortable] thead th.sort-desc::after { content: "↓"; opacity: .9; color: var(--acc); }
.table-tools { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.table-tools input {
  flex: 1 1 220px; max-width: 320px; padding: 7px 11px; font: inherit; font-size: 13px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border-strong); border-radius: 7px;
}
.table-tools input:focus { outline: 2px solid rgba(var(--acc-rgb), .4); outline-offset: 1px; border-color: var(--acc); }
.table-count { font-size: 12px; color: var(--text-faint); }

/* ── Insights, callouts, badges ─────────────────────────────────────── */
ul.insights { list-style: none; margin: 0; padding: 0; }
ul.insights li {
  position: relative; padding: 0 0 0 26px; margin-bottom: 13px; line-height: 1.6;
}
ul.insights li:last-child { margin-bottom: 0; }
ul.insights li::before {
  content: ""; position: absolute; left: 6px; top: .62em;
  width: 7px; height: 7px; border-radius: 50%; background: var(--acc);
}
ol.actions { margin: 0; padding-left: 22px; }
ol.actions li { margin-bottom: 11px; line-height: 1.6; }
ol.actions li::marker { color: var(--acc); font-weight: 700; }
.callout {
  border-left: 3px solid var(--acc); border-radius: 0 8px 8px 0;
  background: rgba(var(--acc-rgb), .07);
  padding: 13px 16px; margin: 0 0 var(--gap); font-size: 14px;
}
.callout:last-child { margin-bottom: 0; }
.callout > *:last-child { margin-bottom: 0; }
.callout .callout-title { font-weight: 650; margin-bottom: 5px; }
.callout.warn { border-color: var(--warn); background: rgba(224,161,55,.11); }
.callout.bad  { border-color: var(--bad);  background: rgba(240,104,126,.11); }
.callout.good { border-color: var(--good); background: rgba(75,189,133,.11); }
.badge {
  display: inline-block; font-size: 11px; font-weight: 650; letter-spacing: .04em;
  padding: 2px 8px; border-radius: 999px; text-transform: uppercase;
  background: rgba(var(--acc-rgb), .13); color: var(--acc);
}
.badge.warn { background: rgba(224,161,55,.16); color: var(--warn); }
.badge.bad  { background: rgba(240,104,126,.16); color: var(--bad); }
.badge.good { background: rgba(75,189,133,.16); color: var(--good); }
.muted { color: var(--text-faint); }

/* ── Footer + toolbar ───────────────────────────────────────────────── */
.report-footer {
  margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--border);
  font-size: 12px; color: var(--text-faint);
  display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap;
}
.report-toolbar { position: fixed; top: 14px; right: 16px; display: flex; gap: 6px; z-index: 50; }
.report-toolbar button {
  font: inherit; font-size: 12px; line-height: 1;
  padding: 7px 11px; border-radius: 8px; cursor: pointer;
  background: var(--surface); color: var(--text-dim);
  border: 1px solid var(--border); box-shadow: var(--shadow);
}
.report-toolbar button:hover { color: var(--text); border-color: var(--border-strong); }

/* ── Responsive ─────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .grid.cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .report { padding: 20px 14px 44px; }
  .grid.cols-2, .grid.cols-3 { grid-template-columns: 1fr; }
  .report-title { font-size: 22px; }
  .kpi-value { font-size: 25px; }
  .report-toolbar { position: static; margin-bottom: 14px; }
}

/* ── Print / Save-as-PDF ────────────────────────────────────────────── */
@media print {
  :root { --bg: #fff; --surface: #fff; --shadow: none; }
  body { background: #fff; font-size: 11pt; }
  .report { max-width: none; padding: 0; }
  .report-toolbar, .table-tools { display: none !important; }
  .card, .kpi, figure.chart, .callout { break-inside: avoid; page-break-inside: avoid; }
  .card { border-color: #d6d8de; }
  table.data thead th { position: static; }
  a { color: inherit; text-decoration: none; }
}
`.trim();
}

// ── The runtime script ──────────────────────────────────────────────────────

/**
 * Behaviour every report gets for free: theme toggle (respecting a pinned
 * mode), sortable/filterable tables, and a print button. Deliberately
 * dependency-free and backslash-free so it embeds cleanly in a Python
 * raw string as well as in HTML.
 */
export function reportScript(theme: ReportTheme): string {
  const forced = theme.mode === 'auto' ? '' : theme.mode;
  return `
(function () {
  var FORCED = ${JSON.stringify(forced)};
  var root = document.documentElement;

  // ── Theme ────────────────────────────────────────────────────────────
  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function stored() {
    try { return window.localStorage.getItem('evolve-report-theme'); } catch (e) { return null; }
  }
  function apply(mode) {
    root.setAttribute('data-theme', mode);
    var b = document.getElementById('evolve-theme-toggle');
    if (b) {
      b.textContent = mode === 'dark' ? 'Light' : 'Dark';
      b.setAttribute('aria-label', 'Switch to ' + (mode === 'dark' ? 'light' : 'dark') + ' theme');
    }
  }
  var initial = FORCED || stored() || (systemDark() ? 'dark' : 'light');
  apply(initial);
  if (!FORCED && window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function (e) { if (!stored()) apply(e.matches ? 'dark' : 'light'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  // ── Toolbar ──────────────────────────────────────────────────────────
  function toolbar() {
    if (document.querySelector('.report-toolbar')) return;
    var bar = document.createElement('div');
    bar.className = 'report-toolbar no-print';
    if (!FORCED) {
      var t = document.createElement('button');
      t.id = 'evolve-theme-toggle';
      t.type = 'button';
      t.textContent = root.getAttribute('data-theme') === 'dark' ? 'Light' : 'Dark';
      t.onclick = function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { window.localStorage.setItem('evolve-report-theme', next); } catch (e) {}
        apply(next);
      };
      bar.appendChild(t);
    }
    var p = document.createElement('button');
    p.type = 'button';
    p.textContent = 'Print';
    p.onclick = function () { window.print(); };
    bar.appendChild(p);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // ── Sortable tables ──────────────────────────────────────────────────
  function numeric(text) {
    var cleaned = text.replace(/[^0-9eE+.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    var n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  function sortable(table) {
    var heads = table.querySelectorAll('thead th');
    for (var i = 0; i < heads.length; i++) {
      (function (th, idx) {
        th.addEventListener('click', function () {
          var body = table.tBodies[0];
          if (!body) return;
          var asc = !th.classList.contains('sort-asc');
          for (var k = 0; k < heads.length; k++) heads[k].classList.remove('sort-asc', 'sort-desc');
          th.classList.add(asc ? 'sort-asc' : 'sort-desc');
          var rows = Array.prototype.slice.call(body.rows);
          rows.sort(function (a, b) {
            var ca = a.cells[idx] ? a.cells[idx].textContent.trim() : '';
            var cb = b.cells[idx] ? b.cells[idx].textContent.trim() : '';
            var na = numeric(ca), nb = numeric(cb);
            var cmp;
            if (na !== null && nb !== null) cmp = na - nb;
            else cmp = ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' });
            return asc ? cmp : -cmp;
          });
          for (var r = 0; r < rows.length; r++) body.appendChild(rows[r]);
        });
      })(heads[i], i);
    }
  }

  // ── Filter box for large tables ──────────────────────────────────────
  function filterable(table) {
    var body = table.tBodies[0];
    if (!body || body.rows.length < 12) return;
    var wrap = table.closest('.table-wrap') || table;
    var tools = document.createElement('div');
    tools.className = 'table-tools no-print';
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Filter rows…';
    var count = document.createElement('span');
    count.className = 'table-count';
    var total = body.rows.length;
    count.textContent = total + ' rows';
    tools.appendChild(input);
    tools.appendChild(count);
    wrap.parentNode.insertBefore(tools, wrap);
    input.addEventListener('input', function () {
      var q = input.value.toLowerCase();
      var shown = 0;
      for (var i = 0; i < body.rows.length; i++) {
        var row = body.rows[i];
        var hit = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.style.display = hit ? '' : 'none';
        if (hit) shown++;
      }
      count.textContent = q ? shown + ' of ' + total + ' rows' : total + ' rows';
    });
  }

  function init() {
    toolbar();
    var tables = document.querySelectorAll('table.data');
    for (var i = 0; i < tables.length; i++) {
      if (tables[i].hasAttribute('data-sortable')) sortable(tables[i]);
      filterable(tables[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`.trim();
}

// ── Prompt blocks ───────────────────────────────────────────────────────────

const MARKUP_CONTRACT = `
Use this exact class contract — the stylesheet is supplied for you, so classes not listed here have no styling:

  <div class="report">                        page wrapper (required, wraps everything)
    <header class="report-header">
      <div class="brand">…</div>              omit if there is no brand
      <div class="titles">
        <h1 class="report-title">…</h1>
        <p class="report-subtitle">…</p>
        <div class="report-meta"><span>…</span><span>…</span></div>   source, row count, generated-on
      </div>
    </header>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">…</div>
        <div class="kpi-value">1,284<span class="unit">orders</span></div>
        <div class="kpi-delta up">+12.4% vs prior period</div>     .up / .down / .flat — only with real comparison data
        <div class="kpi-note">…</div>
      </div>
    </div>
    <section class="card">
      <h2>SECTION NAME</h2>
      <p class="card-sub">one-line framing</p>
      <div class="grid cols-2">…</div>                             cols-2 / cols-3 for side-by-side charts
      <figure class="chart">
        <div class="chart-title">…</div>
        <svg viewBox="0 0 640 300" role="img" aria-label="…">…</svg>
        <figcaption><strong>What it shows.</strong> Why it matters.</figcaption>
      </figure>
      <div class="table-wrap"><table class="data" data-sortable><thead>…</thead><tbody>…</tbody></table></div>
      <ul class="insights"><li>…</li></ul>
      <ol class="actions"><li>…</li></ol>
      <div class="callout warn"><div class="callout-title">…</div>…</div>   .warn / .bad / .good / plain
    </section>
    <footer class="report-footer"><span>…</span><span>…</span></footer>
  </div>

Also available: <span class="badge good">…</span>, class="num" on numeric <td>/<th> (right-aligns, tabular figures),
class="mono" for identifiers, class="muted" for de-emphasised text.
`.trim();

const CHART_RULES = `
Charts — hand-written inline <svg>, no libraries, no external requests:
- Give every chart a viewBox (e.g. "0 0 640 300") and no width/height attributes; the stylesheet makes it responsive.
- Colour marks with the supplied classes: class="series-1".."series-6" for filled marks (bars, points, areas),
  class="line-1".."line-3" for strokes. Never hard-code a hex colour — the classes follow the reader's theme.
- Axes: wrap ticks in <g class="axis">; horizontal gridlines use <line class="gridline">. Label both axes.
- Leave room for labels: at least 44px on the left and 28px at the bottom inside the viewBox.
- Prefer bar charts for categories, line charts for time, scatter for two numerics. Do not use pie charts
  for more than three slices, and never use 3D or decorative effects.
- Sort categorical bars by value descending unless the category has a natural order.
- Every chart needs a <figcaption> that states the takeaway, not a restatement of the axis labels.
- If a chart would need data you were not given, leave it out and say so — never draw invented values.
`.trim();

const NUMBER_RULES = `
Numbers:
- Format for humans: thousands separators, at most 1–2 decimals, currency and percent symbols where they apply.
- Every figure must be computable from the data you were given. If the sample is partial, say "in the sample"
  rather than implying it covers the whole dataset.
- Never invent a comparison period, target, or benchmark that is not in the data.
`.trim();

/** The design + content brief appended to every direct-HTML report request. */
export function buildReportPromptBlock(spec: ReportSpec, theme: ReportTheme): string {
  const arch = archetypeById(spec.archetype);
  const sections = spec.sections
    .map(id => REPORT_SECTIONS.find(s => s.id === id))
    .filter((s): s is ReportSection => !!s);

  const sectionList = sections.map((s, i) => `${i + 1}. **${s.label}** — ${s.guidance}`).join('\n');

  const parts = [
    '## Report brief',
    `Format: ${arch.label} — ${arch.description}.`,
    arch.guidance,
    AUDIENCE_GUIDANCE[spec.audience],
    TONE_GUIDANCE[spec.tone],
    `Chart budget: at most ${spec.maxCharts} charts in the whole report. Spend them on the highest-signal views.`,
    spec.title ? `Report title: "${spec.title}".` : '',
    '',
    '### Sections, in this order',
    sectionList,
    'Skip any section the data genuinely cannot support (e.g. trends with no date column) and say why in one line rather than padding it.',
    '',
    '### Output format',
    'Output ONE complete HTML document inside a single ```html fenced block. Requirements:',
    '- Include <!DOCTYPE html>, <html lang="en">, <head> with <meta charset="utf-8"> and',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">, a <title>, and <body>.',
    '- Do NOT write any <style> block and do NOT use style="" attributes. A complete stylesheet is injected',
    '  into the document for you; inline styles will clash with it and with dark mode.',
    '- Do NOT write any <script>. Table sorting, filtering, the theme toggle and printing are injected too.',
    '- No external resources of any kind — no CDN links, no web fonts, no remote images. The file must render',
    '  correctly with no network access.',
    '',
    '### Markup contract',
    MARKUP_CONTRACT,
    '',
    CHART_RULES,
    '',
    NUMBER_RULES,
  ];

  if (theme.brandName) {
    parts.push('', `Brand: put "${theme.brandName}" in the header's <div class="brand"><span class="brand-name">…</span></div>.`);
  }
  if (theme.footer) {
    parts.push(`Footer: the left cell of <footer class="report-footer"> must read "${theme.footer}".`);
  }
  if (spec.notes.length) {
    parts.push('', '### Additional requirements from the user', ...spec.notes.map(n => `- ${n}`));
  }
  if (spec.focus) {
    parts.push('', `### The user's focus for this report`, spec.focus);
  }

  return parts.filter(p => p !== '').join('\n');
}

/** The equivalent brief for the generated-Python path. */
export function buildScriptPromptBlock(spec: ReportSpec, theme: ReportTheme): string {
  const arch = archetypeById(spec.archetype);
  const sections = spec.sections
    .map(id => REPORT_SECTIONS.find(s => s.id === id))
    .filter((s): s is ReportSection => !!s)
    .map((s, i) => `${i + 1}. **${s.label}** — ${s.guidance}`)
    .join('\n');

  const parts = [
    '## Report brief (the script builds this report)',
    `Format: ${arch.label} — ${arch.description}.`,
    arch.guidance,
    AUDIENCE_GUIDANCE[spec.audience],
    TONE_GUIDANCE[spec.tone],
    `Chart budget: at most ${spec.maxCharts} figures.`,
    '',
    '### Sections, in this order',
    sections,
    'Guard each section so a column it needs being absent skips that section instead of crashing the script.',
    '',
    '### Styling — use the injected helpers, do NOT write your own CSS',
    'A preamble is prepended to your script automatically. Assume these already exist at module level and',
    'do NOT define, redefine, or import them:',
    '```',
    'EVOLVE_STYLE                       # str: the full report stylesheet',
    'EVOLVE_SCRIPT                      # str: the report runtime JS',
    'EVOLVE_PALETTE                     # list[str]: categorical series colours',
    'EVOLVE_ACCENT                      # str: the brand accent hex',
    'evolve_style_mpl(plt)              # apply the report look to matplotlib; call once after importing pyplot',
    'evolve_fig(fig, caption="", title="")   # -> HTML <figure class="chart"> with the figure embedded as base64 PNG',
    'evolve_kpi(label, value, note="", delta="", direction="")  # -> HTML for one <div class="kpi">',
    'evolve_kpis(list_of_kpi_html)      # -> wraps them in <div class="kpi-grid">',
    'evolve_card(title, inner_html, subtitle="")   # -> <section class="card">',
    'evolve_table(df, max_rows=100, sortable=True) # -> <div class="table-wrap"><table class="data">',
    'evolve_list(items)                 # -> <ul class="insights">',
    'evolve_actions(items)              # -> <ol class="actions">',
    'evolve_callout(text, kind="", title="")       # kind: "", "warn", "bad", "good"',
    'evolve_num(x, decimals=1)          # human number formatting with thousands separators',
    'evolve_html_shell(title, subtitle, body_html, meta=None, footer="")  # -> the complete HTML document',
    '```',
    'Build the report by concatenating helper output into `body_html`, then write',
    '`evolve_html_shell(title, subtitle, body_html, meta=[...])` to the output file. Call `evolve_style_mpl(plt)`',
    'immediately after `import matplotlib.pyplot as plt`, and colour multi-series charts from EVOLVE_PALETTE.',
    'Do not emit any other CSS, <style> block, or <script>.',
    '',
    '### Narrative',
    'The script cannot ask an AI for prose at run time, so derive the narrative from the computed values:',
    'build insight strings with f-strings from the real aggregates (largest category, biggest change, worst',
    'null rate, strongest correlation) rather than writing generic filler text. Aim for 3–6 data-derived',
    'insight bullets.',
  ];

  if (theme.brandName) parts.push('', `Brand name for the header: "${theme.brandName}".`);
  if (theme.footer)    parts.push(`Footer text: "${theme.footer}".`);
  if (spec.notes.length) parts.push('', '### Additional requirements from the user', ...spec.notes.map(n => `- ${n}`));
  if (spec.focus)      parts.push('', `### The user's focus for this report`, spec.focus);

  return parts.join('\n');
}

// ── Python preamble injected into generated scripts ─────────────────────────

/**
 * Python constants + helpers prepended to every generated report script, so the
 * script path produces the same design as the direct path. Pure Python with no
 * module-level imports, so it is safe to place above the script's own
 * dependency-bootstrap block.
 */
export function pythonPreamble(theme: ReportTheme): string {
  const css   = reportStylesheet(theme);
  const js    = reportScript(theme);
  const pal   = JSON.stringify(theme.palette);
  const forced = theme.mode === 'auto' ? '' : theme.mode;
  const logo  = theme.logoDataUri
    ? `'<img class="logo" src="' + EVOLVE_LOGO + '" alt="">'`
    : `''`;

  return `# ── Evolve AI report design system (injected — do not edit) ──────────────────
EVOLVE_STYLE = r"""${css}"""

EVOLVE_SCRIPT = r"""${js}"""

EVOLVE_PALETTE = ${pal}
EVOLVE_ACCENT = ${JSON.stringify(theme.accent)}
EVOLVE_BRAND = ${JSON.stringify(theme.brandName)}
EVOLVE_LOGO = ${JSON.stringify(theme.logoDataUri)}
EVOLVE_FOOTER = ${JSON.stringify(theme.footer)}
EVOLVE_FORCED_THEME = ${JSON.stringify(forced)}


def evolve_esc(s):
    """HTML-escape a value for safe interpolation."""
    s = "" if s is None else str(s)
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def evolve_num(x, decimals=1):
    """Human-readable number: thousands separators, trimmed decimals.

    Real data has holes, so NaN and infinity must render as a dash rather than
    raise — a null in one cell must never take a whole table or KPI down.
    """
    if x is None:
        return "&mdash;"
    try:
        f = float(x)
    except (TypeError, ValueError):
        return evolve_esc(x)
    if f != f:                       # NaN
        return "&mdash;"
    if f in (float("inf"), float("-inf")):
        return "&infin;" if f > 0 else "-&infin;"
    if f == int(f) and abs(f) < 1e15:
        return format(int(f), ",")
    return format(round(f, decimals), ",." + str(decimals) + "f")


def evolve_style_mpl(plt):
    """Apply the report look to matplotlib. Call once, after importing pyplot.

    Charts are saved with a transparent background and mid-tone greys for the
    axes, so the same PNG stays readable whether the reader views the report in
    light or dark mode.
    """
    settings = {
        "figure.figsize": (7.6, 3.9),
        "figure.dpi": 130,
        "savefig.dpi": 130,
        "figure.facecolor": "none",
        "axes.facecolor": "none",
        "savefig.facecolor": "none",
        "savefig.transparent": True,
        "axes.edgecolor": "#8b90a066",
        "axes.linewidth": 0.8,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.labelcolor": "#7b8190",
        "axes.labelsize": 10,
        "axes.titlesize": 12,
        "axes.titleweight": "600",
        "axes.titlecolor": "#6b7280",
        "axes.titlepad": 12,
        "axes.grid": True,
        "axes.grid.axis": "y",
        "grid.color": "#8b90a040",
        "grid.linewidth": 0.8,
        "grid.linestyle": "-",
        "xtick.color": "#7b8190",
        "ytick.color": "#7b8190",
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "xtick.direction": "out",
        "ytick.direction": "out",
        "legend.frameon": False,
        "legend.fontsize": 9,
        "lines.linewidth": 2.0,
        "lines.solid_capstyle": "round",
        "patch.linewidth": 0,
        "font.size": 10,
    }
    # Set keys one at a time: an rcParam a given matplotlib version rejects must
    # not take the whole stylesheet down with it.
    for _k in settings:
        try:
            plt.rcParams[_k] = settings[_k]
        except Exception:
            pass
    try:
        from cycler import cycler
        plt.rcParams["axes.prop_cycle"] = cycler(color=EVOLVE_PALETTE)
    except Exception as _e:
        print("note: could not apply the report chart palette:", _e)


def evolve_fig(fig, caption="", title=""):
    """Embed a matplotlib figure as a self-contained <figure class="chart">."""
    import io, base64
    buf = io.BytesIO()
    try:
        fig.savefig(buf, format="png", bbox_inches="tight", transparent=True)
    except Exception as _e:
        print("note: could not render a chart:", _e)
        return ""
    finally:
        try:
            import matplotlib.pyplot as _plt
            _plt.close(fig)
        except Exception:
            pass
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    src = "data:image/png;base64," + b64
    head = '<div class="chart-title">' + evolve_esc(title) + "</div>" if title else ""
    cap = '<figcaption>' + caption + "</figcaption>" if caption else ""
    return '<figure class="chart">' + head + '<img alt="' + evolve_esc(title or caption) + '" src="' + src + '">' + cap + "</figure>"


def evolve_kpi(label, value, note="", delta="", direction=""):
    """One KPI tile. direction: "up" | "down" | "flat" | ""."""
    html = '<div class="kpi"><div class="kpi-label">' + evolve_esc(label) + "</div>"
    html += '<div class="kpi-value">' + str(value) + "</div>"
    if delta:
        cls = direction if direction in ("up", "down", "flat") else "flat"
        html += '<div class="kpi-delta ' + cls + '">' + evolve_esc(delta) + "</div>"
    if note:
        html += '<div class="kpi-note">' + evolve_esc(note) + "</div>"
    return html + "</div>"


def evolve_kpis(tiles):
    tiles = [t for t in tiles if t]
    if not tiles:
        return ""
    return '<div class="kpi-grid">' + "".join(tiles) + "</div>"


def evolve_card(title, inner_html, subtitle=""):
    if not inner_html:
        return ""
    sub = '<p class="card-sub">' + evolve_esc(subtitle) + "</p>" if subtitle else ""
    return '<section class="card"><h2>' + evolve_esc(title) + "</h2>" + sub + inner_html + "</section>"


def evolve_table(df, max_rows=100, sortable=True):
    """Render a DataFrame as a styled, sortable table (numeric columns right-aligned)."""
    try:
        head = df.head(max_rows)
        cols = list(head.columns)
        try:
            import pandas as _pd
            numeric = {c: bool(_pd.api.types.is_numeric_dtype(head[c])) for c in cols}
        except Exception:
            numeric = {c: False for c in cols}
        sort_attr = " data-sortable" if sortable else ""
        out = ['<div class="table-wrap"><table class="data"' + sort_attr + "><thead><tr>"]
        for c in cols:
            out.append('<th class="num">' if numeric.get(c) else "<th>")
            out.append(evolve_esc(c) + "</th>")
        out.append("</tr></thead><tbody>")
        try:
            import pandas as _pd2
            isna = _pd2.isna
        except Exception:
            isna = lambda v: v is None
        for _, row in head.iterrows():
            out.append("<tr>")
            for c in cols:
                v = row[c]
                blank = False
                try:
                    blank = bool(isna(v))
                except Exception:
                    blank = False
                if blank:
                    # A missing value is information — show it, don't print "nan".
                    out.append('<td class="muted">&mdash;</td>')
                elif numeric.get(c):
                    out.append('<td class="num">' + evolve_num(v) + "</td>")
                else:
                    out.append("<td>" + evolve_esc(v) + "</td>")
            out.append("</tr>")
        out.append("</tbody></table></div>")
        extra = ""
        if len(df) > max_rows:
            extra = '<p class="muted">Showing ' + format(max_rows, ",") + " of " + format(len(df), ",") + " rows.</p>"
        return "".join(out) + extra
    except Exception as _e:
        print("note: could not render a table:", _e)
        return ""


def evolve_list(items):
    items = [i for i in items if i]
    if not items:
        return ""
    return '<ul class="insights">' + "".join("<li>" + i + "</li>" for i in items) + "</ul>"


def evolve_actions(items):
    items = [i for i in items if i]
    if not items:
        return ""
    return '<ol class="actions">' + "".join("<li>" + i + "</li>" for i in items) + "</ol>"


def evolve_callout(text, kind="", title=""):
    cls = "callout " + kind if kind else "callout"
    head = '<div class="callout-title">' + evolve_esc(title) + "</div>" if title else ""
    return '<div class="' + cls + '">' + head + text + "</div>"


def evolve_html_shell(title, subtitle, body_html, meta=None, footer=""):
    """Wrap report body HTML in the full styled document."""
    import datetime
    meta_html = ""
    if meta:
        meta_html = '<div class="report-meta">' + "".join(
            "<span>" + evolve_esc(m) + "</span>" for m in meta if m) + "</div>"
    brand = ""
    if EVOLVE_BRAND or EVOLVE_LOGO:
        logo = ${logo}
        name = '<span class="brand-name">' + evolve_esc(EVOLVE_BRAND) + "</span>" if EVOLVE_BRAND else ""
        brand = '<div class="brand">' + logo + name + "</div>"
    generated = datetime.datetime.now().strftime("%d %b %Y, %H:%M")
    foot_left = evolve_esc(footer or EVOLVE_FOOTER)
    theme_attr = ' data-theme="' + EVOLVE_FORCED_THEME + '"' if EVOLVE_FORCED_THEME else ""
    doc = (
        "<!DOCTYPE html>"
        '<html lang="en"' + theme_attr + "><head>"
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>" + evolve_esc(title) + "</title>"
        "<style>" + EVOLVE_STYLE + "</style>"
        "</head><body>"
        '<div class="report">'
        '<header class="report-header">' + brand +
        '<div class="titles"><h1 class="report-title">' + evolve_esc(title) + "</h1>"
        '<p class="report-subtitle">' + evolve_esc(subtitle) + "</p>" + meta_html + "</div></header>"
        + body_html +
        '<footer class="report-footer"><span>' + foot_left + "</span>"
        "<span>Generated " + generated + " by Evolve AI</span></footer>"
        "</div>"
        "<script>" + EVOLVE_SCRIPT + "</scr" + "ipt>"
        "</body></html>"
    )
    return doc
# ── end injected preamble ────────────────────────────────────────────────────
`;
}

/**
 * Prepend the preamble to a generated script. If the model defined any of the
 * injected names itself (against instructions), the injected definitions win by
 * being re-appended after the model's — the last definition is the live one.
 */
export function injectPythonPreamble(script: string, theme: ReportTheme): string {
  const preamble = pythonPreamble(theme);
  if (script.includes('# ── Evolve AI report design system (injected')) return script;

  const redefines = /^(EVOLVE_STYLE|EVOLVE_SCRIPT|EVOLVE_PALETTE)\s*=/m.test(script)
    || /^def evolve_html_shell\(/m.test(script);

  // Keep a shebang / encoding cookie at the very top if the script has one.
  const m = script.match(/^((?:#![^\n]*\n)?(?:#[^\n]*coding[^\n]*\n)?)/);
  const head = m ? m[1] : '';
  const rest = script.slice(head.length);

  const body = `${head}${preamble}\n${rest}`;
  // The model redefined our helpers — re-append ours so they take effect, and
  // note it, since the script's own copies may be styled differently.
  return redefines ? `${body}\n\n# Re-applying the injected report design (the script redefined it).\n${preamble}` : body;
}

// ── HTML post-processing ────────────────────────────────────────────────────

const STYLE_MARK  = '<!--evolve-report-style-->';
const SCRIPT_MARK = '<!--evolve-report-script-->';

/**
 * Stamp the canonical stylesheet + runtime into a finished HTML report.
 * Idempotent: re-running replaces the previously injected block, so a refined
 * report never accumulates duplicates.
 */
export function injectReportAssets(html: string, theme: ReportTheme): string {
  let out = stripInjected(html);

  const styleBlock  = `${STYLE_MARK}\n<style>\n${reportStylesheet(theme)}\n</style>\n${STYLE_MARK}`;
  const scriptBlock = `${SCRIPT_MARK}\n<script>\n${reportScript(theme)}\n</script>\n${SCRIPT_MARK}`;

  // Normalise the pinned theme rather than only adding one: switching a report
  // back to "follow the reader's system" has to clear an earlier light/dark pin,
  // and a pin is an attribute, so no amount of new CSS would override it.
  out = out.replace(/<html([^>]*)>/i, (_full, attrs: string) => {
    const cleaned = attrs.replace(/\s*data-theme\s*=\s*(['"])[^'"]*\1/gi, '');
    return theme.mode === 'auto' ? `<html${cleaned}>` : `<html${cleaned} data-theme="${theme.mode}">`;
  });

  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  } else if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>\n${styleBlock}`);
  } else {
    out = `${styleBlock}\n${out}`;
  }

  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${scriptBlock}\n</body>`);
  } else {
    out = `${out}\n${scriptBlock}`;
  }
  return out;
}

/**
 * Remove any stylesheet/runtime this module previously put in the document,
 * so re-injecting replaces rather than stacks.
 *
 * Matching on the marker comments alone is not enough: a report built by a
 * generated Python script embeds the same stylesheet via `EVOLVE_STYLE`, which
 * carries no markers. Those are recognised by content signature instead —
 * otherwise re-theming such a report would leave two full stylesheets in it.
 */
function stripInjected(html: string): string {
  const style  = new RegExp(`${STYLE_MARK}[\\s\\S]*?${STYLE_MARK}`, 'g');
  const script = new RegExp(`${SCRIPT_MARK}[\\s\\S]*?${SCRIPT_MARK}`, 'g');
  return html
    .replace(style, '')
    .replace(script, '')
    .replace(/<style\b[^>]*>(?:(?!<\/style>)[\s\S])*?Evolve AI report design system(?:(?!<\/style>)[\s\S])*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?evolve-theme-toggle(?:(?!<\/script>)[\s\S])*?<\/script>/gi, '');
}

// ── Refinement support ──────────────────────────────────────────────────────

/**
 * Base64 images and the injected stylesheet make a finished report far too
 * large to send back to a model for editing. Swap them for short placeholders
 * before the round-trip and restore them afterwards, so a refinement costs
 * roughly the same context as the original generation.
 */
export interface StashedHtml {
  html: string;
  images: string[];
}

export function stashHeavyParts(html: string): StashedHtml {
  const images: string[] = [];
  // Injected assets are re-added deterministically after the edit — never send them.
  let out = stripInjected(html);
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<!--EVOLVE_STYLE_PLACEHOLDER-->');
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<!--EVOLVE_SCRIPT_PLACEHOLDER-->');
  out = out.replace(/(src\s*=\s*)(["'])(data:[^"']{200,})\2/gi, (_full, pre: string, q: string, uri: string) => {
    const i = images.push(uri) - 1;
    return `${pre}${q}EVOLVE_IMG_${i}${q}`;
  });
  return { html: out, images };
}

export function restoreHeavyParts(html: string, stashed: StashedHtml): string {
  let out = html;
  for (let i = 0; i < stashed.images.length; i++) {
    // The model may keep, drop, or reorder images; only restore what survived.
    out = out.split(`EVOLVE_IMG_${i}`).join(stashed.images[i]);
  }
  out = out.replace(/<!--EVOLVE_STYLE_PLACEHOLDER-->/g, '').replace(/<!--EVOLVE_SCRIPT_PLACEHOLDER-->/g, '');
  return out;
}

/** Any `EVOLVE_IMG_n` the model invented for a chart it did not have data for. */
export function hasDanglingImagePlaceholders(html: string): boolean {
  return /EVOLVE_IMG_\d+/.test(html);
}

/** The instruction sent when the user refines an existing report. */
export function buildRefinePrompt(currentHtml: string, instruction: string, theme: ReportTheme): string {
  return [
    'Below is the current HTML of a report. Apply the requested change and return the COMPLETE updated document.',
    '',
    `### Requested change`,
    instruction,
    '',
    '### Rules',
    '- Change only what the request implies. Preserve every other section, number, chart and wording exactly.',
    '- Keep the existing class contract (.report, .card, .kpi-grid, .kpi, figure.chart, table.data, ul.insights,',
    '  ol.actions, .callout, .report-header, .report-footer). Do not introduce new CSS or inline style="" attributes —',
    '  the stylesheet is injected separately and inline styles will break dark mode and printing.',
    '- Do not write a <style> or <script> block; leave the placeholder comments where they are.',
    `- Images appear as src="EVOLVE_IMG_0", src="EVOLVE_IMG_1" … These are real charts with their data stripped out`,
    '  to save space. Keep the exact placeholder text for any chart you are keeping, and simply delete the whole',
    '  <figure> for any chart you are removing. NEVER invent a new EVOLVE_IMG_n — if the change needs a chart that',
    '  does not exist yet, draw it as inline <svg> using the series-1..6 / line-1..3 classes instead.',
    '- Never invent numbers. If the request asks for a figure the document does not contain, add a short',
    '  <div class="callout warn"> explaining what extra data is needed instead of guessing.',
    theme.brandName ? `- Keep the brand name "${theme.brandName}" in the header.` : '',
    '',
    'Output the full updated HTML in one ```html fenced block, and nothing else.',
    '',
    '---',
    '### Current report',
    '```html',
    currentHtml,
    '```',
  ].filter(l => l !== '').join('\n');
}

// ── Theme file scaffold ─────────────────────────────────────────────────────

export const THEME_TEMPLATE = `{
  // evolve-report-theme.json — branding + defaults for every Evolve AI HTML report.
  // Delete any key to fall back to the built-in default. Comments are allowed.

  // Shown in the report header. Leave empty for no brand line.
  "brandName": "",

  // Primary accent — links, KPI accents, the first chart series.
  "accent": "#4f6df5",

  // Categorical series colours (charts cycle through these).
  "palette": ["#4f6df5", "#e8873a", "#12a594", "#d6455d", "#8b5cf6", "#3aa0e8", "#5aa84f", "#c2528f"],

  // "auto" follows the reader's OS setting; "light" or "dark" pins the report.
  "theme": "auto",

  // Font stacks. Reports are offline-only, so name fonts the reader is likely to have.
  "font": "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  "monoFont": "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",

  // Optional logo as a data: URI (no URLs — reports must render with no network).
  // Generate one with: base64 your-logo.png   then prefix "data:image/png;base64,"
  "logo": "",

  // Left-hand footer line, e.g. "Confidential — Acme Analytics".
  "footer": "",

  // Default shape of a report when the user doesn't customise the run.
  // Archetypes: executive | deepdive | quality | timeseries | comparison
  "defaultArchetype": "executive",

  // Audience: exec | analyst | engineer | mixed
  "defaultAudience": "mixed",

  // Override the archetype's section list. Leave [] to use the archetype's own.
  // Sections: summary, kpis, trends, breakdowns, distributions, correlations,
  //           quality, table, insights, recommendations, methodology
  "defaultSections": [],

  // Hard cap on charts per report.
  "maxCharts": 6,

  // "comfortable" or "compact" spacing.
  "density": "comfortable"
}
`;
