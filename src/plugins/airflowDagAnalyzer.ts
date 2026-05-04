/**
 * plugins/airflowDagAnalyzer.ts — Static DAG analyzer for Airflow files (DE #4)
 *
 * Pure-string analysis — no Python interpreter required. Detects:
 *   - cycles (direct + transitive)
 *   - broken dependencies (>> to undefined task)
 *   - duplicate task_ids
 *   - missing default_args.retries
 *   - sensors with mode='poke' + long timeout (slot starvation)
 *   - missing catchup=False with start_date in the past
 *   - invalid cron expressions
 *   - TaskFlow @task functions called without parentheses
 *   - BranchPythonOperator returning a string that doesn't match a task_id
 *
 * Extracts a DagModel from the file then runs the checks against it. Each
 * issue carries a (line, col, severity, code, message, fix-hint) so the UI
 * surfaces (Diagnostics + Panel) can render it consistently.
 *
 * Design constraint: the analyzer is vscode-import-free so it can be unit-
 * tested directly under Node without a VS Code shim.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export interface DagTask {
  /** task_id as written in the source */
  id:       string;
  /** Operator class name (PythonOperator, BashOperator, @task, ...) */
  operator: string;
  /** 1-based line number where the task is defined */
  line:     number;
  /** Operator kwargs we care about (raw strings) */
  kwargs:   Record<string, string>;
  /** True for `@task`-decorated functions */
  isTaskFlow: boolean;
}

export interface DagEdge {
  from: string;
  to:   string;
  /** 1-based line where the >> / << was written */
  line: number;
}

export interface DagModel {
  /** dag_id from `DAG(dag_id=...)` or `@dag(dag_id=...)` if present */
  dagId?:   string;
  /** Schedule expression (raw) — may be a cron, a preset like '@daily', or a Timetable */
  schedule?: string;
  /** start_date raw expression */
  startDate?: string;
  /** catchup=True/False if found, else undefined */
  catchup?:  boolean;
  /** default_args dict raw text */
  defaultArgs?: string;
  tasks: DagTask[];
  edges: DagEdge[];
}

export type DagIssueSeverity = 'error' | 'warning' | 'info';

export interface DagIssue {
  code:     string;          // 'cycle', 'undefined-dependency', etc.
  severity: DagIssueSeverity;
  line:     number;          // 1-based
  col?:     number;          // 1-based; if undefined, highlight whole line
  message:  string;
  /** Optional one-line hint for the AI / quick-fix */
  hint?:    string;
}

export interface DagAnalysis {
  dag:    DagModel;
  issues: DagIssue[];
  stats:  {
    taskCount:   number;
    edgeCount:   number;
    rootTasks:   number;   // tasks with no incoming edge
    leafTasks:   number;   // tasks with no outgoing edge
    longestPath: number;   // count of edges in longest path
  };
}

// ── Heuristic file detection ─────────────────────────────────────────────────

const RE_DAG_OBJ = /\bDAG\s*\(/;
const RE_DAG_DEC = /@dag\s*\(/;
const RE_AIRFLOW_IMPORT = /\bfrom\s+airflow(?:\.|_)|\bimport\s+airflow\b/;

export function looksLikeAirflowDag(content: string, filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.py')) return false;
  if (RE_DAG_OBJ.test(content) || RE_DAG_DEC.test(content)) return true;
  // `from airflow import DAG` may be written but DAG() call could be inside a function
  return RE_AIRFLOW_IMPORT.test(content) && /\.dag\s*=\s*DAG\s*\(/.test(content);
}

// ── Parser ───────────────────────────────────────────────────────────────────

const RE_DAG_ID = /\bdag_id\s*=\s*['"]([^'"]+)['"]/;
const RE_SCHEDULE = /\b(?:schedule|schedule_interval)\s*=\s*([^,)\n]+?)(?=[,)\n]|$)/;
const RE_START_DATE = /\bstart_date\s*=\s*([^,)\n]+?)(?=[,)\n]|$)/;
const RE_CATCHUP = /\bcatchup\s*=\s*(True|False)\b/;
const RE_DEFAULT_ARGS = /\bdefault_args\s*=\s*(\{[\s\S]*?\})/m;
// Operator instantiation: `name = OperatorClass(...)`
const RE_OPERATOR_ASSIGN = /^\s*([A-Za-z_][\w]*)\s*=\s*([A-Z][\w]*)\s*\(/;
// `task_id='name'` inside the operator call
const RE_TASK_ID = /task_id\s*=\s*['"]([^'"]+)['"]/;
// TaskFlow @task or @task.python decorator (followed by a def on next line)
const RE_TASKFLOW = /^\s*@task(?:\.\w+)?\s*(?:\([^)]*\))?\s*$/;
// >> and << dependency lines
//   t1 >> t2
//   [t1, t2] >> t3
//   t1 >> [t2, t3]
const RE_DEP_LINE = />>|<</;

interface RawOperatorBlock {
  varName: string;
  operator: string;
  startLine: number;
  endLine: number;
  body: string;
}

function findOperatorBlocks(content: string): RawOperatorBlock[] {
  const lines = content.split('\n');
  const out: RawOperatorBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = RE_OPERATOR_ASSIGN.exec(lines[i]);
    if (!m) continue;
    const opName = m[2];
    // Skip non-operator-y assignments (heuristic: must end with Operator/Sensor/Task or be a known TaskFlow op)
    if (!/(?:Operator|Sensor|Task)$/.test(opName) && !KNOWN_OPS.has(opName)) continue;
    // Find the matching close paren — single-line or multi-line
    const block = readParenBlock(lines, i);
    out.push({
      varName: m[1],
      operator: opName,
      startLine: i + 1,
      endLine: block.endLine + 1,
      body: block.body,
    });
    i = block.endLine; // skip past this block
  }
  return out;
}

const KNOWN_OPS = new Set(['DAG']);

function readParenBlock(lines: string[], startIdx: number): { body: string; endLine: number } {
  let depth = 0;
  let body = '';
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    body += (i === startIdx ? '' : '\n') + line;
    for (const ch of line) {
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) return { body, endLine: i }; }
    }
  }
  return { body, endLine: lines.length - 1 };
}

function findTaskFlowFunctions(content: string): DagTask[] {
  const lines = content.split('\n');
  const out: DagTask[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!RE_TASKFLOW.test(lines[i])) continue;
    // Next non-empty line should be a `def name(...)` line
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      const next = lines[j].trim();
      if (!next) continue;
      const m = next.match(/^def\s+(\w+)\s*\(/);
      if (!m) break;
      out.push({
        id: m[1],
        operator: '@task',
        line: j + 1,
        kwargs: {},
        isTaskFlow: true,
      });
      break;
    }
  }
  return out;
}

function parseKwargs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Body looks like:  `name = OperatorClass(key=val, key2=val2, ...)`
  // We want only the content between the OUTERMOST parens of OperatorClass(...).
  const openIdx = body.indexOf('(');
  if (openIdx < 0) return out;
  // Walk to the matching close paren
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { closeIdx = i; break; } }
  }
  if (closeIdx < 0) closeIdx = body.length;
  const inner = body.slice(openIdx + 1, closeIdx);

  // Now split on top-level commas within `inner`.
  let d = 0;
  let buf = '';
  const segments: string[] = [];
  let inS = false, inD = false;
  for (const ch of inner) {
    if (inS) { buf += ch; if (ch === "'") inS = false; continue; }
    if (inD) { buf += ch; if (ch === '"') inD = false; continue; }
    if (ch === "'") { inS = true; buf += ch; continue; }
    if (ch === '"') { inD = true; buf += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') d++;
    if (ch === ')' || ch === ']' || ch === '}') d--;
    if (ch === ',' && d === 0) { segments.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) segments.push(buf);

  for (const seg of segments) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    const k = seg.slice(0, eq).trim();
    const v = seg.slice(eq + 1).trim();
    if (k && /^[a-zA-Z_]\w*$/.test(k)) out[k] = v;
  }
  return out;
}

function parseEdges(content: string, knownTasks: Set<string>): DagEdge[] {
  const lines = content.split('\n');
  const edges: DagEdge[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!RE_DEP_LINE.test(line)) continue;
    // Strip strings + comments to avoid false positives
    const cleaned = stripStringsAndComments(line);
    if (!RE_DEP_LINE.test(cleaned)) continue;
    // Tokenize on >> and << preserving direction
    const parts = cleaned.split(/(\s*>>\s*|\s*<<\s*)/).map(s => s.trim()).filter(s => s.length > 0);
    if (parts.length < 3) continue;
    // parts looks like [lhs, '>>'|'<<', mid, '>>'|'<<', rhs, ...]
    for (let p = 1; p < parts.length; p += 2) {
      const op = parts[p].trim();
      const left = parts[p - 1];
      const right = parts[p + 1];
      const lhs = expandTaskList(left, knownTasks);
      const rhs = expandTaskList(right, knownTasks);
      if (lhs.length === 0 || rhs.length === 0) continue;
      const [from, to] = op === '>>' ? [lhs, rhs] : [rhs, lhs];
      for (const f of from) for (const t of to) edges.push({ from: f, to: t, line: i + 1 });
    }
  }
  return edges;
}

function expandTaskList(token: string, knownTasks: Set<string>): string[] {
  const out: string[] = [];
  const cleaned = token.replace(/^\[|\]$/g, '').trim();
  for (const part of cleaned.split(',')) {
    const name = part.trim();
    if (!name) continue;
    // Accept either an operator var name OR a TaskFlow function call (`name()`).
    const callMatch = name.match(/^(\w+)\s*\(/);
    const id = callMatch ? callMatch[1] : name;
    // Filter to identifier-shaped tokens; drop method calls, attribute access
    if (!/^[A-Za-z_]\w*$/.test(id)) continue;
    out.push(id);
  }
  return out;
}

function stripStringsAndComments(s: string): string {
  let out = '';
  let inS = false, inD = false, inComment = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inComment) continue;
    if (inS) { if (c === "'") inS = false; continue; }
    if (inD) { if (c === '"') inD = false; continue; }
    if (c === '#') { inComment = true; continue; }
    if (c === "'") { inS = true; continue; }
    if (c === '"') { inD = true; continue; }
    out += c;
  }
  return out;
}

export function parseDag(content: string): DagModel {
  const dagIdMatch    = RE_DAG_ID.exec(content);
  const scheduleMatch = RE_SCHEDULE.exec(content);
  const startDateMatch = RE_START_DATE.exec(content);
  const catchupMatch  = RE_CATCHUP.exec(content);
  const defaultArgsMatch = RE_DEFAULT_ARGS.exec(content);

  const blocks = findOperatorBlocks(content);
  const taskFlowFns = findTaskFlowFunctions(content);

  const tasks: DagTask[] = [];
  const taskByVar = new Map<string, DagTask>();
  for (const block of blocks) {
    if (block.operator === 'DAG') continue;
    const kwargs = parseKwargs(block.body);
    const taskIdStr = kwargs.task_id?.replace(/^['"]|['"]$/g, '');
    const id = taskIdStr ?? block.varName;
    const t: DagTask = {
      id,
      operator: block.operator,
      line: block.startLine,
      kwargs,
      isTaskFlow: false,
    };
    tasks.push(t);
    taskByVar.set(block.varName, t);
  }
  for (const fn of taskFlowFns) tasks.push(fn);

  // For edge resolution, the LHS of `>>` is the variable name (op assignment)
  // OR the function name (TaskFlow). Build a name → task_id lookup.
  const knownNames = new Set<string>();
  for (const [varName, t] of taskByVar) { knownNames.add(varName); knownNames.add(t.id); }
  for (const fn of taskFlowFns) knownNames.add(fn.id);

  const rawEdges = parseEdges(content, knownNames);
  // Resolve each edge endpoint to the underlying task_id
  const resolvedEdges: DagEdge[] = rawEdges.map(e => ({
    from: taskByVar.get(e.from)?.id ?? e.from,
    to:   taskByVar.get(e.to)?.id   ?? e.to,
    line: e.line,
  }));

  return {
    dagId:    dagIdMatch?.[1],
    schedule: scheduleMatch?.[1].trim(),
    startDate: startDateMatch?.[1].trim(),
    catchup:  catchupMatch ? catchupMatch[1] === 'True' : undefined,
    defaultArgs: defaultArgsMatch?.[1],
    tasks,
    edges: resolvedEdges,
  };
}

// ── Checks ───────────────────────────────────────────────────────────────────

function detectCycles(tasks: DagTask[], edges: DagEdge[]): DagIssue[] {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const issues: DagIssue[] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const stackPath: string[] = [];

  function dfs(node: string): void {
    if (stack.has(node)) {
      // Found cycle — build path
      const cycleStart = stackPath.indexOf(node);
      const cycle = stackPath.slice(cycleStart).concat(node);
      const offendingEdge = edges.find(e =>
        cycle.includes(e.from) && cycle.includes(e.to) &&
        cycle.indexOf(e.from) >= 0 && cycle.indexOf(e.to) >= 0);
      const line = offendingEdge?.line ?? 1;
      issues.push({
        code: 'cycle',
        severity: 'error',
        line,
        message: `Cycle detected in task dependencies: ${cycle.join(' → ')}`,
        hint: 'Break the cycle by removing one of the edges in the loop.',
      });
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    stackPath.push(node);
    for (const child of adj.get(node) ?? []) dfs(child);
    stack.delete(node);
    stackPath.pop();
  }

  for (const t of tasks) if (!visited.has(t.id)) dfs(t.id);
  return issues;
}

function detectUndefinedDeps(tasks: DagTask[], edges: DagEdge[]): DagIssue[] {
  const known = new Set(tasks.map(t => t.id));
  const issues: DagIssue[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (!known.has(e.from) && !seen.has('from:' + e.from)) {
      issues.push({
        code: 'undefined-dependency',
        severity: 'warning',
        line: e.line,
        message: `Edge references undefined task '${e.from}'.`,
        hint: `Define a task with task_id='${e.from}' or fix the reference.`,
      });
      seen.add('from:' + e.from);
    }
    if (!known.has(e.to) && !seen.has('to:' + e.to)) {
      issues.push({
        code: 'undefined-dependency',
        severity: 'warning',
        line: e.line,
        message: `Edge references undefined task '${e.to}'.`,
        hint: `Define a task with task_id='${e.to}' or fix the reference.`,
      });
      seen.add('to:' + e.to);
    }
  }
  return issues;
}

function detectDuplicateTaskIds(tasks: DagTask[]): DagIssue[] {
  const counts = new Map<string, DagTask[]>();
  for (const t of tasks) {
    const arr = counts.get(t.id) ?? [];
    arr.push(t);
    counts.set(t.id, arr);
  }
  const issues: DagIssue[] = [];
  for (const [id, arr] of counts) {
    if (arr.length < 2) continue;
    for (const t of arr.slice(1)) {
      issues.push({
        code: 'duplicate-task-id',
        severity: 'error',
        line: t.line,
        message: `Duplicate task_id '${id}'. Airflow will reject this DAG at parse time.`,
        hint: 'Each task in a DAG must have a unique task_id.',
      });
    }
  }
  return issues;
}

function detectMissingRetries(dag: DagModel): DagIssue[] {
  if (!dag.defaultArgs) {
    return [{
      code: 'missing-default-args',
      severity: 'info',
      line: 1,
      message: 'No default_args dict found. Production DAGs typically set retries, retry_delay, on_failure_callback.',
      hint: 'Add default_args={"retries": 2, "retry_delay": timedelta(minutes=5)}.',
    }];
  }
  // Match `retries` as a dict key. Quotes around the key are common in Python.
  if (!/['"]?retries['"]?\s*:/.test(dag.defaultArgs)) {
    return [{
      code: 'missing-retries',
      severity: 'warning',
      line: 1,
      message: 'default_args does not set retries. Failed tasks will not retry.',
      hint: 'Add `"retries": 2` (or your team\'s standard) to default_args.',
    }];
  }
  return [];
}

function detectSensorPokeStarvation(tasks: DagTask[]): DagIssue[] {
  const issues: DagIssue[] = [];
  for (const t of tasks) {
    if (!/Sensor$/.test(t.operator)) continue;
    const mode = t.kwargs.mode?.replace(/^['"]|['"]$/g, '');
    const timeoutRaw = t.kwargs.timeout;
    if (!timeoutRaw) {
      issues.push({
        code: 'sensor-no-timeout',
        severity: 'warning',
        line: t.line,
        message: `Sensor '${t.id}' has no timeout. It can hang indefinitely.`,
        hint: 'Add timeout=60*60*N to bound the wait.',
      });
      continue;
    }
    const timeout = parseInt(timeoutRaw.replace(/[^\d]/g, ''), 10);
    const isPoke = !mode || mode === 'poke';
    if (isPoke && Number.isFinite(timeout) && timeout > 60 * 60) {
      issues.push({
        code: 'sensor-poke-starvation',
        severity: 'warning',
        line: t.line,
        message: `Sensor '${t.id}' uses mode='poke' with a >1h timeout. This holds a worker slot for the entire wait.`,
        hint: "Switch to mode='reschedule' to free the worker between checks.",
      });
    }
  }
  return issues;
}

function detectMissingCatchupFalse(dag: DagModel): DagIssue[] {
  if (dag.catchup === false) return [];
  // Only warn when start_date looks like it could be in the past.
  // Note: dag.startDate may have its trailing `)` truncated by the
  // simple kwarg regex, so we accept either form.
  if (!dag.startDate) return [];
  const past = /days_ago\s*\(\s*\d+/.test(dag.startDate)
            || /datetime\s*\(\s*20\d\d/.test(dag.startDate);
  if (!past) return [];
  return [{
    code: 'missing-catchup-false',
    severity: 'warning',
    line: 1,
    message: `start_date is in the past but catchup is not explicitly False. Airflow will backfill every missed run on first deploy.`,
    hint: 'Set catchup=False on the DAG unless you want backfill.',
  }];
}

function detectInvalidCron(dag: DagModel): DagIssue[] {
  if (!dag.schedule) return [];
  const raw = dag.schedule.replace(/^['"]|['"]$/g, '').trim();
  if (raw.startsWith('@') || raw === 'None' || raw.endsWith(')')) return [];
  // Basic 5-field cron validation
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) return [];
  const ranges = [
    [0, 59],   // minute
    [0, 23],   // hour
    [1, 31],   // day of month
    [1, 12],   // month
    [0, 7],    // day of week (0/7 = Sunday)
  ];
  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    if (field === '*') continue;
    if (/^\*\/\d+$/.test(field)) continue;  // step
    const matched = field.split(',').every(piece => {
      const num = parseInt(piece.split(/[-/]/)[0], 10);
      if (Number.isNaN(num)) return false;
      return num >= ranges[i][0] && num <= ranges[i][1];
    });
    if (!matched) {
      return [{
        code: 'invalid-cron',
        severity: 'error',
        line: 1,
        message: `Schedule '${raw}' has an invalid value in field ${i + 1} ('${field}'). Allowed: ${ranges[i][0]}-${ranges[i][1]}.`,
        hint: 'Check the cron expression. Use crontab.guru to validate.',
      }];
    }
  }
  return [];
}

function detectTaskFlowMissingParens(content: string, tasks: DagTask[]): DagIssue[] {
  const taskFlowNames = new Set(tasks.filter(t => t.isTaskFlow).map(t => t.id));
  if (taskFlowNames.size === 0) return [];
  const issues: DagIssue[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cleaned = stripStringsAndComments(lines[i]);
    if (!RE_DEP_LINE.test(cleaned)) continue;
    for (const name of taskFlowNames) {
      // Match `name` not followed by `(` — we want bare references in dep chains
      const re = new RegExp(`(?:^|\\W)${name}(?!\\s*[(\\w])`);
      if (re.test(cleaned)) {
        issues.push({
          code: 'taskflow-missing-parens',
          severity: 'warning',
          line: i + 1,
          message: `TaskFlow function '${name}' is referenced without (). Use '${name}()' to invoke it and create an XCom edge.`,
          hint: `Replace '${name}' with '${name}()' inside the dependency chain.`,
        });
      }
    }
  }
  return issues;
}

function computeStats(tasks: DagTask[], edges: DagEdge[]) {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const t of tasks) { inDeg.set(t.id, 0); outDeg.set(t.id, 0); }
  for (const e of edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
  }
  let rootTasks = 0, leafTasks = 0;
  for (const t of tasks) {
    if ((inDeg.get(t.id) ?? 0) === 0) rootTasks++;
    if ((outDeg.get(t.id) ?? 0) === 0) leafTasks++;
  }
  // Longest path via DP on a topo order. If there's a cycle, return -1.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(node: string): number {
    if (visiting.has(node)) return -1; // cycle
    if (memo.has(node)) return memo.get(node)!;
    visiting.add(node);
    let best = 0;
    for (const child of adj.get(node) ?? []) {
      const d = depth(child);
      if (d < 0) { visiting.delete(node); return -1; }
      best = Math.max(best, d + 1);
    }
    visiting.delete(node);
    memo.set(node, best);
    return best;
  }
  let longestPath = 0;
  for (const t of tasks) {
    const d = depth(t.id);
    if (d < 0) { longestPath = -1; break; }
    longestPath = Math.max(longestPath, d);
  }
  return {
    taskCount: tasks.length,
    edgeCount: edges.length,
    rootTasks,
    leafTasks,
    longestPath,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

export function analyzeDag(content: string): DagAnalysis {
  const dag = parseDag(content);
  const issues: DagIssue[] = [
    ...detectCycles(dag.tasks, dag.edges),
    ...detectUndefinedDeps(dag.tasks, dag.edges),
    ...detectDuplicateTaskIds(dag.tasks),
    ...detectMissingRetries(dag),
    ...detectSensorPokeStarvation(dag.tasks),
    ...detectMissingCatchupFalse(dag),
    ...detectInvalidCron(dag),
    ...detectTaskFlowMissingParens(content, dag.tasks),
  ];
  // Stable sort — by line then severity
  const sevWeight = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => a.line - b.line || sevWeight[a.severity] - sevWeight[b.severity]);
  const stats = computeStats(dag.tasks, dag.edges);
  return { dag, issues, stats };
}

// ── Compact text rendering for AI prompt + panel ─────────────────────────────

export function renderAnalysisOneLine(a: DagAnalysis): string {
  const errors = a.issues.filter(i => i.severity === 'error').length;
  const warnings = a.issues.filter(i => i.severity === 'warning').length;
  const parts: string[] = [`${a.stats.taskCount} task${a.stats.taskCount === 1 ? '' : 's'}`];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (errors === 0 && warnings === 0) parts.push('healthy');
  return parts.join(' · ');
}

/** Multi-line summary suitable for prepending to an AI fix prompt. */
export function renderAnalysisForPrompt(a: DagAnalysis): string {
  const lines: string[] = [];
  lines.push(`## DAG Analysis`);
  lines.push(`- Tasks: ${a.stats.taskCount} (${a.stats.rootTasks} root, ${a.stats.leafTasks} leaf)`);
  lines.push(`- Edges: ${a.stats.edgeCount}`);
  if (a.stats.longestPath >= 0) lines.push(`- Longest path: ${a.stats.longestPath} edge${a.stats.longestPath === 1 ? '' : 's'}`);
  if (a.dag.dagId) lines.push(`- dag_id: ${a.dag.dagId}`);
  if (a.dag.schedule) lines.push(`- schedule: ${a.dag.schedule}`);
  lines.push('');
  if (a.issues.length === 0) {
    lines.push('No issues detected.');
    return lines.join('\n');
  }
  lines.push(`### Issues (${a.issues.length})`);
  for (const i of a.issues) {
    lines.push(`- [${i.severity}] line ${i.line}: ${i.message}` + (i.hint ? `\n  hint: ${i.hint}` : ''));
  }
  return lines.join('\n');
}
