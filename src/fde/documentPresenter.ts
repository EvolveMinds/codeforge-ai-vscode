/**
 * src/fde/documentPresenter.ts
 *
 * Turns a generated engagement document into something you can actually hand to
 * a client: a self-contained, printable HTML page.
 *
 * The markdown the generators emit is correct but it is a *working* artifact —
 * a client opening a .md file sees `**bold**`, raw `> [!WARNING]` blocks and an
 * unrendered mermaid fence. That is fine for the repo and wrong for a CIO.
 *
 * Two rules this module exists to enforce:
 *
 *  1. Honesty survives the prettier rendering. A DEMO banner becomes a loud red
 *     panel rather than disappearing into a stylesheet, and "NOT YET MEASURED"
 *     becomes a visible amber chip rather than being quietly dropped because it
 *     looked untidy. Making a document presentable must never make it dishonest.
 *
 *  2. Nothing is fetched at runtime. These are emailed, opened from disk and
 *     read on locked-down client laptops, so fonts, styles and layout are all
 *     inline. Mermaid is rendered as a labelled code panel rather than pulling
 *     2.8MB of JS from a CDN that an air-gapped machine cannot reach.
 */

import { StudioMode, NOT_MEASURED } from './provenance';

export interface PresentOptions {
  /** Document title shown in the header and the browser tab. */
  title: string;
  /** Client or engagement name, shown under the title. */
  client?: string;
  /** DEMO renders the "not a deliverable" panel. */
  mode?: StudioMode;
  /** Optional subtitle, e.g. "Prepared for Client IT". */
  subtitle?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline formatting: code, bold, italics, links, and the NOT-MEASURED chip. */
function inline(text: string): string {
  let out = esc(text);

  // The honesty marker becomes a visible chip. It must survive prettification —
  // a reader has to be able to tell a missing measurement from a real one at a
  // glance, which is the entire point of printing it.
  out = out.replace(
    /⚠️\s*NOT YET MEASURED/g,
    '<span class="chip chip-unmeasured">NOT YET MEASURED</span>'
  );
  out = out.replace(
    /⚠️\s*DEMO DATA[^`<]*/g,
    '<span class="chip chip-demo">DEMO DATA — NOT A REAL MEASUREMENT</span>'
  );

  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/**
 * Markdown → HTML body.
 *
 * Deliberately a small hand-rolled parser rather than a dependency: these pages
 * ship to air-gapped machines and the input is our own generator's output, not
 * arbitrary user markdown, so the subset it needs is known and narrow.
 */
function body(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];

  let i = 0;
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  while (i < lines.length) {
    const line = lines[i];

    // GitHub callouts: > [!WARNING] / [!CAUTION] / [!NOTE]
    const callout = line.match(/^>\s*\[!(WARNING|CAUTION|NOTE|IMPORTANT|TIP)\]\s*$/i);
    if (callout) {
      closeList();
      const kind = callout[1].toUpperCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && /^>/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const cls = (kind === 'WARNING' || kind === 'CAUTION') ? 'callout-danger' : 'callout-note';
      const inner = buf
        .filter(l => l.trim().length > 0)
        .map(l => {
          const h = l.match(/^#{1,6}\s+(.*)$/);
          return h ? `<div class="callout-title">${inline(h[1])}</div>` : `<p>${inline(l)}</p>`;
        })
        .join('');
      out.push(`<div class="callout ${cls}">${inner}</div>`);
      continue;
    }

    // Fenced code / mermaid
    const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      closeList();
      const lang = (fence[1] || '').toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      // Mermaid gets a labelled panel. Rendering it properly would mean shipping
      // the mermaid runtime, which breaks the air-gapped promise for one diagram.
      if (lang === 'mermaid') {
        out.push(
          `<figure class="diagram"><figcaption>Architecture diagram — Mermaid source</figcaption>` +
          `<pre><code>${esc(buf.join('\n'))}</code></pre></figure>`
        );
      } else {
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      }
      continue;
    }

    // Tables
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      closeList();
      const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const headers = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
        headers.map(h => `<th>${inline(h)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = Math.min(h[1].length + 1, 6);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++; continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr/>'); i++; continue; }

    // Plain blockquote
    if (/^>\s?/.test(line)) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${buf.filter(Boolean).map(l => `<p>${inline(l)}</p>`).join('')}</blockquote>`);
      continue;
    }

    // Lists (including task list checkboxes)
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      let item = li[1];
      const task = item.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const done = task[1].toLowerCase() === 'x';
        item = `<span class="task ${done ? 'task-done' : ''}">${done ? '✓' : '○'}</span> ${task[2]}`;
        out.push(`<li class="task-item">${inline(item).replace(/&lt;span/g, '<span').replace(/&lt;\/span&gt;/g, '</span>').replace(/span&gt;/g, 'span>')}</li>`);
      } else {
        out.push(`<li>${inline(item)}</li>`);
      }
      i++; continue;
    }

    if (line.trim() === '') { closeList(); i++; continue; }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return out.join('\n');
}

/** The DEMO panel. Loud on purpose: it is the last thing between a sample artifact and a client. */
function demoPanel(mode: StudioMode): string {
  if (mode !== 'DEMO') return '';
  return `<div class="demo-banner">
    <div class="demo-banner-title">⚠️ Demonstration artifact — not a client deliverable</div>
    <p>This document was produced while the Delivery Studio was in <strong>DEMO mode</strong>. Figures and findings come from built-in sample data and describe no real system. Do not share it with a client or present it as evidence of testing.</p>
  </div>`;
}

const STYLES = `
  :root {
    --ink: #1a1d23; --muted: #5b6472; --line: #e3e7ed; --bg: #ffffff;
    --soft: #f6f8fa; --accent: #0f766e; --accent-soft: #e6f4f1;
    --danger: #b42318; --danger-soft: #fef3f2; --warn-soft: #fffaeb; --warn-ink: #b54708;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--soft); color: var(--ink);
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .page { max-width: 920px; margin: 32px auto 64px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 1px 3px rgba(16,24,40,.06); overflow: hidden; }
  .masthead { padding: 34px 44px 26px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg,#fbfdfc,#fff); }
  .eyebrow { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  .masthead h1 { margin: 8px 0 4px; font-size: 27px; line-height: 1.25; letter-spacing: -.02em; }
  .masthead .sub { color: var(--muted); font-size: 14px; }
  .content { padding: 10px 44px 44px; }
  h2 { font-size: 20px; margin: 34px 0 10px; padding-bottom: 7px; border-bottom: 2px solid var(--accent-soft); letter-spacing: -.01em; }
  h3 { font-size: 16px; margin: 24px 0 8px; color: #27303f; }
  h4,h5,h6 { font-size: 14px; margin: 18px 0 6px; color: #27303f; }
  p { margin: 10px 0; }
  ul { margin: 10px 0; padding-left: 22px; }
  li { margin: 5px 0; }
  li.task-item { list-style: none; margin-left: -18px; }
  .task { display: inline-block; width: 16px; color: var(--muted); }
  .task-done { color: var(--accent); font-weight: 700; }
  a { color: var(--accent); }
  code { background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #0f1419; color: #e6edf3; padding: 15px 17px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
  pre code { background: none; border: 0; color: inherit; padding: 0; font-size: 12.5px; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 26px 0; }
  blockquote { margin: 14px 0; padding: 2px 16px; border-left: 3px solid var(--line); color: var(--muted); }
  blockquote p { margin: 6px 0; }
  .table-wrap { overflow-x: auto; margin: 14px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; background: var(--soft); border-bottom: 2px solid var(--line); padding: 9px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  td { border-bottom: 1px solid var(--line); padding: 9px 12px; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .callout { margin: 16px 0; padding: 14px 18px; border-radius: 8px; border: 1px solid; }
  .callout p { margin: 5px 0; font-size: 14px; }
  .callout-title { font-weight: 700; margin-bottom: 4px; }
  .callout-danger { background: var(--danger-soft); border-color: #fda29b; color: #7a271a; }
  .callout-note { background: var(--accent-soft); border-color: #99d5cd; color: #134e48; }
  .demo-banner { margin: 0; padding: 18px 44px; background: var(--danger); color: #fff; }
  .demo-banner-title { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
  .demo-banner p { margin: 6px 0 0; font-size: 13.5px; opacity: .95; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; letter-spacing: .02em; vertical-align: baseline; }
  .chip-unmeasured { background: var(--warn-soft); color: var(--warn-ink); border: 1px solid #fedf89; }
  .chip-demo { background: var(--danger-soft); color: #7a271a; border: 1px solid #fda29b; }
  .diagram { margin: 16px 0; }
  .diagram figcaption { font-size: 12px; color: var(--muted); margin-bottom: 6px; font-style: italic; }
  .footer { padding: 20px 44px 28px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12.5px; background: var(--soft); }

  @media print {
    body { background: #fff; }
    .page { margin: 0; border: 0; box-shadow: none; max-width: none; }
    .masthead, .content, .footer, .demo-banner { padding-left: 0; padding-right: 0; }
    pre { white-space: pre-wrap; word-wrap: break-word; }
    h2, h3 { break-after: avoid; }
    table, figure, .callout { break-inside: avoid; }
  }
  @media (max-width: 640px) {
    .page { margin: 0; border-radius: 0; border-left: 0; border-right: 0; }
    .masthead, .content, .footer, .demo-banner { padding-left: 18px; padding-right: 18px; }
  }
`;

/** Wraps generated markdown in a self-contained, printable client-facing page. */
export function presentDocument(markdown: string, opts: PresentOptions): string {
  const mode: StudioMode = opts.mode || 'DEMO';

  // The markdown carries its own banner for .md readers; the HTML renders a
  // styled panel instead, so strip the textual one to avoid showing it twice.
  //
  // Done line-by-line rather than with one regex: the banner's last line is
  // followed immediately by `# Title` with no blank line between, so a
  // lookahead for a blank line never fires and the banner survives into the
  // body — which showed a DEMO panel on documents generated in LIVE mode.
  const lines = markdown.split(/\r?\n/);
  let cut = 0;
  if (/^>\s*\[!(WARNING|CAUTION|NOTE|IMPORTANT|TIP)\]/i.test(lines[0] || '')) {
    cut = 1;
    while (cut < lines.length && /^>/.test(lines[cut])) cut++;
  }
  const stripped = lines.slice(cut).join('\n').replace(/^\s+/, '');

  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(opts.title)}${opts.client ? ' — ' + esc(opts.client) : ''}</title>
<style>${STYLES}</style>
</head>
<body>
<article class="page">
  ${demoPanel(mode)}
  <header class="masthead">
    <div class="eyebrow">${mode === 'DEMO' ? 'Demonstration artifact' : 'Client deliverable'}</div>
    <h1>${esc(opts.title)}</h1>
    <div class="sub">${opts.client ? esc(opts.client) : ''}${opts.subtitle ? ' · ' + esc(opts.subtitle) : ''}</div>
  </header>
  <main class="content">
${body(stripped)}
  </main>
  <footer class="footer">
    Generated by Evolve AI Delivery Studio · ${generated}${mode === 'LIVE' ? '' : ' · DEMO MODE'}<br/>
    Values shown as &ldquo;${NOT_MEASURED.replace('⚠️ ', '')}&rdquo; have not been produced by a real run.
  </footer>
</article>
</body>
</html>`;
}
