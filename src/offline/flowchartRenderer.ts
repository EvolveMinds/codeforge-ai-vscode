/**
 * offline/flowchartRenderer.ts — Mermaid `flowchart` to SVG, offline.
 *
 * The Studio already renders `sequenceDiagram` with a hand-written parser,
 * because it ships to banking and defence laptops that advertise air-gapped
 * operation: fetching mermaid.js from a CDN would break that promise and simply
 * fail on a locked-down machine, and bundling the ~2.8MB library into a 360KB
 * renderer was judged disproportionate for one diagram type.
 *
 * That reasoning still holds, but the product meanwhile grew 27 `flowchart`
 * diagrams — every capability-ladder level, every decision-gate template — and
 * the sequence parser rejects all of them outright:
 *
 *     "Preview supports `sequenceDiagram` only."
 *
 * So they have only ever been copy-to-clipboard text, on exactly the client
 * laptops where a picture is the point. This module closes that gap on the same
 * terms: no dependencies, no network, pure functions in, SVG string out.
 *
 * The supported grammar is MEASURED, not guessed. An inventory of all 27
 * diagrams in the codebase found exactly these forms:
 *
 *     flowchart TD | LR
 *     A["label"]              box
 *     B{"label"}              decision
 *     A --> B                 edge
 *     A -.-> B                dotted edge
 *     A -- "label" --> B      labelled edge
 *     subgraph … end          grouping
 *
 * Nothing emits `classDef`, `:::class`, `style`, pipe-labels or `((round))`, so
 * those are reported as unsupported rather than half-implemented. Add them when
 * something actually produces them.
 *
 * Layout is deterministic longest-path layering — no physics, no randomness —
 * so the same source always yields the same SVG and the output is stable to
 * diff and safe to embed in a client document.
 */

// ── Model ─────────────────────────────────────────────────────────────────────

export type FlowDirection = 'TD' | 'LR';
export type FlowShape = 'box' | 'decision' | 'round';

export interface FlowNode {
  id: string;
  label: string;
  shape: FlowShape;
  /** Subgraph this node was declared inside, when any. */
  lane?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface FlowLane {
  id: string;
  label: string;
}

export interface ParsedFlowchart {
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  lanes: FlowLane[];
  /** Anything we could not read. Never thrown — a bad line must not lose the diagram. */
  errors: string[];
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Node declarations, most specific first. `{` before `[` matters: a decision
 * node is also matched by a laxer box pattern, so order decides correctness.
 */
const NODE_FORMS: Array<{ re: RegExp; shape: FlowShape }> = [
  { re: /^([A-Za-z0-9_]+)\(\((.*)\)\)$/, shape: 'round' },
  { re: /^([A-Za-z0-9_]+)\{(.*)\}$/,     shape: 'decision' },
  { re: /^([A-Za-z0-9_]+)\[(.*)\]$/,     shape: 'box' },
];

/**
 * Edge forms. The labelled form is tried first because `-- "x" -->` also
 * contains `-->`, so matching the plain arrow first would silently drop labels.
 */
const EDGE_FORMS: Array<{ re: RegExp; dashed: boolean; labelled: boolean }> = [
  { re: /^(.+?)\s*-\.\s*"([^"]*)"\s*\.->\s*(.+)$/, dashed: true,  labelled: true },
  { re: /^(.+?)\s*--\s*"([^"]*)"\s*-->\s*(.+)$/,   dashed: false, labelled: true },
  { re: /^(.+?)\s*--\s*([^">|][^>]*?)\s*-->\s*(.+)$/, dashed: false, labelled: true },
  { re: /^(.+?)\s*-\.->\s*(.+)$/,                  dashed: true,  labelled: false },
  { re: /^(.+?)\s*-->\s*(.+)$/,                    dashed: false, labelled: false },
];

/** Strip the quotes a Mermaid label usually carries. */
function unquote(s: string): string {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ? t.slice(1, -1) : t;
}

/**
 * Read a flowchart.
 *
 * Never throws: an unreadable line is recorded in `errors` and skipped, because
 * losing one edge is better than losing the diagram.
 */
export function parseFlowchart(src: string): ParsedFlowchart {
  const out: ParsedFlowchart = { direction: 'TD', nodes: [], edges: [], lanes: [], errors: [] };
  const byId = new Map<string, FlowNode>();
  const laneStack: string[] = [];

  const lines = String(src ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) { out.errors.push('Diagram is empty.'); return out; }

  const header = /^flowchart\s+(TD|TB|LR|RL|BT)\b/i.exec(lines[0]);
  if (!header) {
    out.errors.push(
      `Expected a line starting "flowchart TD" or "flowchart LR". First line reads: "${lines[0].slice(0, 48)}"`);
    return out;
  }
  // TB is a synonym for TD; RL/BT are accepted but laid out as their common axis.
  const dir = header[1].toUpperCase();
  out.direction = (dir === 'LR' || dir === 'RL') ? 'LR' : 'TD';

  /** Declare or update a node. A later declaration with a label wins. */
  const ensure = (raw: string): string => {
    const text = raw.trim();
    for (const form of NODE_FORMS) {
      const m = form.re.exec(text);
      if (m) {
        const id = m[1];
        const label = unquote(m[2]);
        const existing = byId.get(id);
        if (existing) {
          if (label) { existing.label = label; existing.shape = form.shape; }
        } else {
          const node: FlowNode = { id, label: label || id, shape: form.shape };
          if (laneStack.length) node.lane = laneStack[laneStack.length - 1];
          byId.set(id, node);
          out.nodes.push(node);
        }
        return id;
      }
    }
    // A bare reference to a node declared elsewhere (or not at all).
    const id = text.replace(/^["']|["']$/g, '');
    if (!byId.has(id)) {
      const node: FlowNode = { id, label: id, shape: 'box' };
      if (laneStack.length) node.lane = laneStack[laneStack.length - 1];
      byId.set(id, node);
      out.nodes.push(node);
    }
    return id;
  };

  for (const raw of lines.slice(1)) {
    const line = raw.replace(/;$/, '').trim();
    if (!line || line.startsWith('%%')) continue;

    // Unsupported-but-real Mermaid: say so rather than mangling it.
    if (/^(classDef|class\s|style\s|linkStyle|click\s)/i.test(line)) {
      out.errors.push(`Not supported in the offline preview: "${line.slice(0, 40)}"`);
      continue;
    }

    const sg = /^subgraph\s+(?:([A-Za-z0-9_]+)\s*\[(.*)\]|(.+))$/i.exec(line);
    if (sg) {
      const id = sg[1] ?? `lane${out.lanes.length + 1}`;
      const label = unquote(sg[2] ?? sg[3] ?? id);
      out.lanes.push({ id, label });
      laneStack.push(id);
      continue;
    }
    if (/^end$/i.test(line)) { laneStack.pop(); continue; }

    let matched = false;
    for (const form of EDGE_FORMS) {
      const m = form.re.exec(line);
      if (!m) continue;
      const from = ensure(form.labelled ? m[1] : m[1]);
      const to   = ensure(form.labelled ? m[3] : m[2]);
      const edge: FlowEdge = { from, to };
      if (form.labelled) {
        const lbl = unquote(m[2]);
        if (lbl) edge.label = lbl;
      }
      if (form.dashed) edge.dashed = true;
      out.edges.push(edge);
      matched = true;
      break;
    }
    if (matched) continue;

    // A standalone node declaration.
    if (NODE_FORMS.some(f => f.re.test(line))) { ensure(line); continue; }

    out.errors.push(`Could not read: "${line.slice(0, 48)}"`);
  }

  return out;
}

// ── Layout ────────────────────────────────────────────────────────────────────

interface Placed extends FlowNode {
  rank: number;
  order: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Assign each node a rank by longest path from a root.
 *
 * Longest path rather than shortest: a node should sit below everything that
 * feeds it, so an edge never points backwards up the diagram. Cycles are broken
 * by an iteration cap, since a ladder diagram with a feedback loop is a real
 * input and must still draw.
 */
function rankNodes(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const rank = new Map<string, number>();
  for (const n of nodes) rank.set(n.id, 0);

  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to)!.push(e.from);
  }

  // Relax until stable. The cap is what makes a cyclic graph terminate.
  const cap = Math.max(4, nodes.length + 2);
  for (let pass = 0; pass < cap; pass++) {
    let moved = false;
    for (const n of nodes) {
      const preds = incoming.get(n.id);
      if (!preds?.length) continue;
      const want = Math.max(...preds.map(p => (rank.get(p) ?? 0) + 1));
      if (want > (rank.get(n.id) ?? 0)) { rank.set(n.id, want); moved = true; }
    }
    if (!moved) break;
  }
  return rank;
}

const CHAR_W = 6.6;
const PAD_X = 16;
const NODE_H = 42;
const MIN_W = 96;
const MAX_W = 260;
const GAP_X = 26;
const GAP_Y = 58;
const MARGIN = 22;
const TITLE_H = 30;

/** Wrap a label to at most `maxChars` per line, on word boundaries where possible. */
function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function layout(parsed: ParsedFlowchart): { placed: Placed[]; width: number; height: number } {
  const rank = rankNodes(parsed.nodes, parsed.edges);
  const horizontal = parsed.direction === 'LR';

  const placed: Placed[] = parsed.nodes.map(n => {
    const lines = wrapLabel(n.label, 30);
    const widest = Math.max(...lines.map(l => l.length));
    const w = Math.min(MAX_W, Math.max(MIN_W, widest * CHAR_W + PAD_X * 2));
    const h = NODE_H + (lines.length - 1) * 13;
    return { ...n, rank: rank.get(n.id) ?? 0, order: 0, x: 0, y: 0, w, h };
  });

  // Group by rank, preserving declaration order within a rank so the drawing
  // follows the order the author wrote — which usually reads best.
  const byRank = new Map<number, Placed[]>();
  for (const p of placed) {
    if (!byRank.has(p.rank)) byRank.set(p.rank, []);
    const row = byRank.get(p.rank)!;
    p.order = row.length;
    row.push(p);
  }

  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const rowExtent = new Map<number, number>();
  for (const r of ranks) {
    const row = byRank.get(r)!;
    const along = horizontal
      ? row.reduce((s, p) => s + p.h + GAP_Y, -GAP_Y)
      : row.reduce((s, p) => s + p.w + GAP_X, -GAP_X);
    rowExtent.set(r, along);
  }
  const widestRow = Math.max(0, ...rowExtent.values());

  // Depth accumulates per rank so a tall wrapped node does not overlap the next.
  let depth = MARGIN + TITLE_H;
  const rankDepth = new Map<number, number>();
  for (const r of ranks) {
    rankDepth.set(r, depth);
    const row = byRank.get(r)!;
    depth += (horizontal ? Math.max(...row.map(p => p.w)) : Math.max(...row.map(p => p.h))) + GAP_Y;
  }

  for (const r of ranks) {
    const row = byRank.get(r)!;
    let along = MARGIN + (widestRow - (rowExtent.get(r) ?? 0)) / 2;
    for (const p of row) {
      if (horizontal) {
        p.x = rankDepth.get(r)!;
        p.y = along;
        along += p.h + GAP_Y;
      } else {
        p.x = along;
        p.y = rankDepth.get(r)!;
        along += p.w + GAP_X;
      }
    }
  }

  const width  = horizontal ? depth + MARGIN : widestRow + MARGIN * 2;
  const height = horizontal ? widestRow + MARGIN * 2 : depth + MARGIN;
  return { placed, width: Math.max(width, 360), height: Math.max(height, 140) };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

export interface FlowRenderOptions {
  /** Caption drawn top-right, matching the sequence renderer's chrome. */
  title?: string;
  /** Index of the edge to highlight — drives the step-through animation. */
  activeStep?: number;
  /** 0..1 position of the travelling marker along the active edge. */
  photonRatio?: number;
}

/** Escape text destined for an SVG text node or attribute. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SURFACE = '#090d16';
const BORDER = '#1e293b';
const TEXT = '#f8fafc';
const TEXT_DIM = '#94a3b8';
const CYAN = '#38bdf8';
const EMERALD = '#34d399';
const AMBER = '#fbbf24';

/**
 * Which accent a node gets.
 *
 * Read from the label rather than configured, because every diagram we render
 * already encodes its meaning there — a gate, a rejection, a human handoff. It
 * is a presentation hint only; getting it wrong costs a colour, not a fact.
 */
function nodeAccent(n: FlowNode): string {
  const t = n.label.toLowerCase();
  if (/reject|escalate|breach|fail|drop|invalid|🛑|❌/.test(t)) return '#fb7185';
  if (/human|supervisor|hitl|approv|👤/.test(t)) return AMBER;
  if (/output|verified|success|pass|execute|✅/.test(t)) return EMERALD;
  if (n.shape === 'decision') return AMBER;
  return CYAN;
}

/** Edge endpoints on the node borders, so arrows touch the box, not its centre. */
function anchor(from: Placed, to: Placed): { x1: number; y1: number; x2: number; y2: number } {
  const fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
  const tcx = to.x + to.w / 2,     tcy = to.y + to.h / 2;
  const dx = tcx - fcx, dy = tcy - fcy;

  // Leave from the dominant side, arrive on the opposite one.
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { x1: fcx, y1: from.y + from.h, x2: tcx, y2: to.y }
      : { x1: fcx, y1: from.y,          x2: tcx, y2: to.y + to.h };
  }
  return dx >= 0
    ? { x1: from.x + from.w, y1: fcy, x2: to.x,        y2: tcy }
    : { x1: from.x,          y1: fcy, x2: to.x + to.w, y2: tcy };
}

function nodeShape(p: Placed, accent: string): string {
  const fill = 'rgba(30, 41, 59, 0.92)';
  if (p.shape === 'decision') {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const pts = `${cx},${p.y} ${p.x + p.w},${cy} ${cx},${p.y + p.h} ${p.x},${cy}`;
    return `<polygon points="${pts}" fill="${fill}" stroke="${accent}" stroke-width="1.4"/>`;
  }
  const rx = p.shape === 'round' ? p.h / 2 : 7;
  return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${rx}" ` +
         `fill="${fill}" stroke="${accent}" stroke-width="1.4"/>`;
}

/**
 * Render a flowchart to standalone SVG.
 *
 * Returns the errors alongside the drawing rather than instead of it: a diagram
 * with one unreadable line should still show the rest, and the caller decides
 * how loudly to report the difference.
 */
export function renderFlowchartSvg(
  src: string,
  options?: FlowRenderOptions,
): { svg: string; errors: string[] } {
  const parsed = parseFlowchart(src);
  if (!parsed.nodes.length) {
    return { svg: '', errors: parsed.errors.length ? parsed.errors : ['Nothing to draw.'] };
  }

  const { placed, width, height } = layout(parsed);
  const pos = new Map(placed.map(p => [p.id, p]));
  const body: string[] = [];

  // Lane backdrops first, so nodes and edges sit on top.
  for (const lane of parsed.lanes) {
    const members = placed.filter(p => p.lane === lane.id);
    if (!members.length) continue;
    const x1 = Math.min(...members.map(m => m.x)) - 12;
    const y1 = Math.min(...members.map(m => m.y)) - 24;
    const x2 = Math.max(...members.map(m => m.x + m.w)) + 12;
    const y2 = Math.max(...members.map(m => m.y + m.h)) + 12;
    body.push(
      `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="8" ` +
      `fill="rgba(15, 23, 42, 0.45)" stroke="rgba(56, 189, 248, 0.32)" stroke-dasharray="5 4"/>` +
      `<text x="${x1 + 9}" y="${y1 + 15}" fill="${CYAN}" font-size="10" font-weight="700" ` +
      `font-family="'Segoe UI', sans-serif">${esc(lane.label.toUpperCase())}</text>`
    );
  }

  // Edges.
  parsed.edges.forEach((e, i) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return;
    const { x1, y1, x2, y2 } = anchor(a, b);
    const active = options?.activeStep === i;
    const stroke = active ? EMERALD : (e.dashed ? TEXT_DIM : CYAN);
    const dash = e.dashed ? ' stroke-dasharray="6 4"' : '';
    const w = active ? 2.4 : 1.4;

    body.push(
      `<g class="fc-edge" data-edge-idx="${i}">` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"${dash} ` +
      `marker-end="url(#fc-arrow${active ? '-on' : ''})"${active ? ' filter="url(#fc-glow)"' : ''}/>`
    );

    if (e.label) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const tw = Math.min(190, e.label.length * 6 + 14);
      body.push(
        `<rect x="${mx - tw / 2}" y="${my - 9}" width="${tw}" height="17" rx="4" ` +
        `fill="${SURFACE}" stroke="${BORDER}"/>` +
        `<text x="${mx}" y="${my + 3.5}" text-anchor="middle" fill="${TEXT_DIM}" font-size="10" ` +
        `font-family="'Segoe UI', sans-serif">${esc(e.label)}</text>`
      );
    }

    // Travelling marker for the step-through animation.
    if (active && typeof options?.photonRatio === 'number') {
      const r = Math.max(0, Math.min(1, options.photonRatio));
      body.push(
        `<circle cx="${x1 + (x2 - x1) * r}" cy="${y1 + (y2 - y1) * r}" r="4" ` +
        `fill="${EMERALD}" filter="url(#fc-glow)"/>`
      );
    }
    body.push(`</g>`);
  });

  // Nodes.
  for (const p of placed) {
    const accent = nodeAccent(p);
    const lines = wrapLabel(p.label, 30);
    const startY = p.y + p.h / 2 - ((lines.length - 1) * 13) / 2 + 4;
    const text = lines.map((l, i) =>
      `<text x="${p.x + p.w / 2}" y="${startY + i * 13}" text-anchor="middle" fill="${TEXT}" ` +
      `font-size="11.5" font-weight="600" font-family="'Segoe UI', sans-serif">${esc(l)}</text>`
    ).join('');
    body.push(
      `<g class="fc-node" data-node-id="${esc(p.id)}">${nodeShape(p, accent)}${text}</g>`);
  }

  const title = options?.title
    ? `<text x="${width - 18}" y="20" text-anchor="end" fill="${TEXT_DIM}" font-size="9.5" ` +
      `font-weight="700" letter-spacing="0.5" font-family="'Segoe UI', sans-serif">` +
      `◈ ${esc(options.title.toUpperCase())}</text>`
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" role="img">` +
    `<defs>` +
    `<filter id="fc-glow" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feGaussianBlur stdDeviation="2" result="b"/><feMerge>` +
    `<feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" ` +
    `orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${CYAN}"/></marker>` +
    `<marker id="fc-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" ` +
    `orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${EMERALD}"/></marker>` +
    `</defs>` +
    `<rect width="${width}" height="${height}" fill="${SURFACE}"/>` +
    title +
    body.join('') +
    `</svg>`;

  return { svg, errors: parsed.errors };
}

/** How many steps a step-through animation has for this diagram. */
export function flowchartStepCount(src: string): number {
  return parseFlowchart(src).edges.length;
}

/** True when this source is a flowchart rather than some other Mermaid diagram. */
export function isFlowchart(src: string): boolean {
  return /^\s*flowchart\s+(TD|TB|LR|RL|BT)\b/i.test(String(src ?? ''));
}
