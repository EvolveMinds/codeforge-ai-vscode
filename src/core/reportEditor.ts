/**
 * core/reportEditor.ts — direct manipulation of a rendered report.
 *
 * WHY IN THE IFRAME
 * -----------------
 * Moving a card, deleting a chart or fixing a typo should not cost a model call,
 * and should not risk the model quietly rewriting the four sections you didn't
 * mention. Those are DOM operations.
 *
 * Doing them as string surgery on the HTML file would mean hand-parsing HTML in
 * the extension. Instead the preview injects this script INTO the report inside
 * the iframe, where a real DOM already exists. It handles hover toolbars,
 * reordering, deletion, duplication and inline text editing locally, then
 * serialises the document and posts it up to the panel, which writes it to disk.
 *
 * The rendered HTML is therefore the source of truth after any manual edit —
 * `blocksFromHtml()` recovers the outline from the stamped `data-block-id`
 * attributes rather than trying to keep a parallel model in sync.
 *
 * Everything this script adds is marked so `stripEditorArtifacts()` can remove
 * it again: the saved file is a clean report, never one carrying editor chrome.
 */

export const EDITOR_SCRIPT_ID = 'evolve-editor-script';
export const EDITOR_STYLE_ID  = 'evolve-editor-style';

/** Chart types offered in the per-block quick-change menu. */
export const CHART_SWAP_TYPES = ['bar', 'horizontal bar', 'line', 'area', 'scatter', 'pie'];

/** Styling for the editor chrome. Scoped so it cannot leak into the report look. */
export function reportEditorStyle(): string {
  return `
[data-block-id] { position: relative; }
[data-block-id].evolve-hover { outline: 2px solid rgba(var(--acc-rgb), .45); outline-offset: 3px; border-radius: var(--radius); }
[data-block-id].evolve-drop-before { box-shadow: 0 -3px 0 0 var(--acc); }
[data-block-id].evolve-drop-after  { box-shadow: 0  3px 0 0 var(--acc); }
.evolve-editor-ui { font-family: system-ui, sans-serif; }
.evolve-bar {
  position: absolute; top: -14px; right: 10px; z-index: 40;
  display: flex; gap: 2px; padding: 3px;
  background: var(--surface); border: 1px solid var(--border-strong);
  border-radius: 8px; box-shadow: 0 3px 12px rgba(0,0,0,.16);
}
.evolve-bar button {
  all: unset; cursor: pointer; font-size: 12px; line-height: 1;
  padding: 5px 7px; border-radius: 5px; color: var(--text-dim); min-width: 14px; text-align: center;
}
.evolve-bar button:hover { background: rgba(var(--acc-rgb), .13); color: var(--acc); }
.evolve-bar button.danger:hover { background: rgba(240,104,126,.16); color: var(--bad); }
.evolve-bar .grip { cursor: grab; }
.evolve-add {
  display: flex; align-items: center; justify-content: center; height: 22px; margin: -8px 0;
  opacity: 0; transition: opacity .12s; cursor: pointer;
}
.evolve-add:hover { opacity: 1; }
.evolve-add::before { content: ""; flex: 1; height: 1px; background: var(--acc); opacity: .35; }
.evolve-add::after { content: ""; flex: 1; height: 1px; background: var(--acc); opacity: .35; }
.evolve-add span {
  font-size: 11px; padding: 1px 9px; margin: 0 8px; border-radius: 999px;
  background: var(--acc); color: #fff; white-space: nowrap;
}
[contenteditable="true"] { outline: 1px dashed rgba(var(--acc-rgb), .6); outline-offset: 2px; border-radius: 3px; }
[contenteditable="true"]:focus { outline: 2px solid var(--acc); }
.evolve-menu {
  position: absolute; z-index: 60; min-width: 160px; padding: 4px;
  background: var(--surface); border: 1px solid var(--border-strong);
  border-radius: 8px; box-shadow: 0 6px 22px rgba(0,0,0,.22);
}
.evolve-menu button {
  all: unset; display: block; width: 100%; box-sizing: border-box;
  padding: 6px 10px; border-radius: 5px; font-size: 12.5px; color: var(--text); cursor: pointer;
}
.evolve-menu button:hover { background: rgba(var(--acc-rgb), .12); }
@media print { .evolve-editor-ui, .evolve-add { display: none !important; } }
`.trim();
}

/**
 * The editor itself. Injected only when the preview is in edit mode; never
 * present in a saved report.
 *
 * Communicates with the hosting panel by posting to `parent`:
 *   { source: 'evolve-report-editor', type: 'save',      html }
 *   { source: 'evolve-report-editor', type: 'refine',    blockId, blockType, hint? }
 *   { source: 'evolve-report-editor', type: 'addBlock',  afterId }
 *   { source: 'evolve-report-editor', type: 'dirty' }
 */
export function reportEditorScript(chartTypes: string[] = CHART_SWAP_TYPES): string {
  return `
(function () {
  var CHART_TYPES = ${JSON.stringify(chartTypes)};
  var EDITOR_IDS = ['${EDITOR_SCRIPT_ID}', '${EDITOR_STYLE_ID}'];

  function post(msg) {
    msg.source = 'evolve-report-editor';
    try { parent.postMessage(msg, '*'); } catch (e) {}
  }

  // ── Serialise a clean copy: editor chrome must never reach the file ──────
  function serialise() {
    var clone = document.documentElement.cloneNode(true);
    var i;
    var junk = clone.querySelectorAll('.evolve-editor-ui, .evolve-add, .evolve-menu');
    for (i = junk.length - 1; i >= 0; i--) junk[i].parentNode.removeChild(junk[i]);
    for (i = 0; i < EDITOR_IDS.length; i++) {
      var n = clone.querySelector('#' + EDITOR_IDS[i]);
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
    var edits = clone.querySelectorAll('[contenteditable]');
    for (i = 0; i < edits.length; i++) edits[i].removeAttribute('contenteditable');
    var marked = clone.querySelectorAll('.evolve-hover, .evolve-drop-before, .evolve-drop-after');
    for (i = 0; i < marked.length; i++) {
      marked[i].classList.remove('evolve-hover', 'evolve-drop-before', 'evolve-drop-after');
      if (!marked[i].getAttribute('class')) marked[i].removeAttribute('class');
    }
    var drags = clone.querySelectorAll('[draggable]');
    for (i = 0; i < drags.length; i++) drags[i].removeAttribute('draggable');
    return '<!DOCTYPE html>' + clone.outerHTML;
  }

  var saveTimer = null;
  function save(immediate) {
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) { post({ type: 'save', html: serialise() }); return; }
    post({ type: 'dirty' });
    saveTimer = setTimeout(function () { post({ type: 'save', html: serialise() }); }, 600);
  }

  function blocks() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-block-id]'));
  }
  function closeMenus() {
    var m = document.querySelectorAll('.evolve-menu');
    for (var i = 0; i < m.length; i++) m[i].parentNode.removeChild(m[i]);
  }

  // ── Per-block toolbar ────────────────────────────────────────────────────
  function button(label, title, cls, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    if (cls) b.className = cls;
    b.onmousedown = function (e) { e.preventDefault(); e.stopPropagation(); };
    b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); closeMenus(); fn(); };
    return b;
  }

  function chartMenu(el, anchor) {
    closeMenus();
    var menu = document.createElement('div');
    menu.className = 'evolve-menu evolve-editor-ui';
    for (var i = 0; i < CHART_TYPES.length; i++) {
      (function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Change to ' + t + ' chart';
        b.onclick = function (e) {
          e.stopPropagation();
          closeMenus();
          post({ type: 'refine', blockId: el.getAttribute('data-block-id'),
                 blockType: el.getAttribute('data-block-type') || '',
                 hint: 'Redraw this chart as a ' + t + ' chart, keeping the same data and caption.' });
        };
        menu.appendChild(b);
      })(CHART_TYPES[i]);
    }
    el.appendChild(menu);
    menu.style.top = (anchor.offsetTop + 22) + 'px';
    menu.style.right = '10px';
  }

  function toolbar(el) {
    if (el.querySelector(':scope > .evolve-bar')) return;
    var bar = document.createElement('div');
    bar.className = 'evolve-bar evolve-editor-ui';

    var grip = button('⠿', 'Drag to reorder', 'grip', function () {});
    grip.draggable = true;
    grip.addEventListener('dragstart', function (e) {
      dragging = el;
      try { e.dataTransfer.setData('text/plain', el.getAttribute('data-block-id')); } catch (x) {}
      e.dataTransfer.effectAllowed = 'move';
    });
    grip.addEventListener('dragend', function () { dragging = null; clearDropMarks(); save(true); });
    bar.appendChild(grip);

    bar.appendChild(button('↑', 'Move up', '', function () {
      var prev = el.previousElementSibling;
      while (prev && !prev.hasAttribute('data-block-id')) prev = prev.previousElementSibling;
      if (prev) { el.parentNode.insertBefore(el, prev); save(true); }
    }));
    bar.appendChild(button('↓', 'Move down', '', function () {
      var next = el.nextElementSibling;
      while (next && !next.hasAttribute('data-block-id')) next = next.nextElementSibling;
      if (next) { el.parentNode.insertBefore(next, el); save(true); }
    }));
    bar.appendChild(button('⧉', 'Duplicate', '', function () {
      var copy = el.cloneNode(true);
      var ui = copy.querySelectorAll('.evolve-editor-ui');
      for (var i = ui.length - 1; i >= 0; i--) ui[i].parentNode.removeChild(ui[i]);
      copy.setAttribute('data-block-id', 'b' + Date.now().toString(36) + Math.floor(performance.now() % 1000).toString(36));
      el.parentNode.insertBefore(copy, el.nextSibling);
      decorate();
      save(true);
    }));

    if ((el.getAttribute('data-block-type') || '') === 'chart' || el.querySelector('figure.chart')) {
      bar.appendChild(button('◧', 'Change chart type', '', function () { chartMenu(el, bar); }));
    }

    bar.appendChild(button('✎', 'Refine just this block with AI', '', function () {
      post({ type: 'refine', blockId: el.getAttribute('data-block-id'),
             blockType: el.getAttribute('data-block-type') || '' });
    }));
    bar.appendChild(button('✕', 'Delete this block', 'danger', function () {
      el.parentNode.removeChild(el);
      save(true);
    }));

    el.appendChild(bar);
  }

  // ── Drag & drop reordering ───────────────────────────────────────────────
  var dragging = null;
  function clearDropMarks() {
    var b = blocks();
    for (var i = 0; i < b.length; i++) b[i].classList.remove('evolve-drop-before', 'evolve-drop-after');
  }
  document.addEventListener('dragover', function (e) {
    if (!dragging) return;
    e.preventDefault();
    var target = e.target && e.target.closest ? e.target.closest('[data-block-id]') : null;
    clearDropMarks();
    if (!target || target === dragging) return;
    var r = target.getBoundingClientRect();
    target.classList.add(e.clientY < r.top + r.height / 2 ? 'evolve-drop-before' : 'evolve-drop-after');
  });
  document.addEventListener('drop', function (e) {
    if (!dragging) return;
    e.preventDefault();
    var target = e.target && e.target.closest ? e.target.closest('[data-block-id]') : null;
    if (target && target !== dragging) {
      var r = target.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) target.parentNode.insertBefore(dragging, target);
      else target.parentNode.insertBefore(dragging, target.nextSibling);
    }
    clearDropMarks();
    dragging = null;
    save(true);
  });

  // ── Inline text editing ──────────────────────────────────────────────────
  var EDITABLE = 'h1, h2, h3, p, li, figcaption, .kpi-label, .kpi-value, .kpi-note, .chart-title, .callout-title, td, th';
  function makeEditable(root) {
    var nodes = root.querySelectorAll(EDITABLE);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.closest('.evolve-editor-ui') || n.getAttribute('data-evolve-bound')) continue;
      n.setAttribute('data-evolve-bound', '1');
      n.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        this.setAttribute('contenteditable', 'true');
        this.focus();
      });
      n.addEventListener('blur', function () {
        if (this.getAttribute('contenteditable') === 'true') {
          this.removeAttribute('contenteditable');
          save(true);
        }
      });
      n.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { this.removeAttribute('contenteditable'); this.blur(); }
        if (e.key === 'Enter' && !e.shiftKey && this.tagName !== 'P' && this.tagName !== 'LI') {
          e.preventDefault(); this.blur();
        }
      });
    }
  }

  // ── "Add a block here" affordances ───────────────────────────────────────
  function addSlots() {
    var existing = document.querySelectorAll('.evolve-add');
    for (var i = existing.length - 1; i >= 0; i--) existing[i].parentNode.removeChild(existing[i]);
    var b = blocks();
    for (var j = 0; j < b.length; j++) {
      (function (el) {
        var slot = document.createElement('div');
        slot.className = 'evolve-add evolve-editor-ui';
        var s = document.createElement('span');
        s.textContent = '+ add block';
        slot.appendChild(s);
        slot.onclick = function () { post({ type: 'addBlock', afterId: el.getAttribute('data-block-id') }); };
        el.parentNode.insertBefore(slot, el.nextSibling);
      })(b[j]);
    }
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  function decorate() {
    var b = blocks();
    for (var i = 0; i < b.length; i++) {
      (function (el) {
        if (el.getAttribute('data-evolve-wired')) { toolbar(el); return; }
        el.setAttribute('data-evolve-wired', '1');
        el.addEventListener('mouseenter', function () { el.classList.add('evolve-hover'); toolbar(el); });
        el.addEventListener('mouseleave', function () {
          el.classList.remove('evolve-hover');
          var bar = el.querySelector(':scope > .evolve-bar');
          if (bar && !el.querySelector('.evolve-menu')) bar.parentNode.removeChild(bar);
        });
      })(b[i]);
    }
    makeEditable(document.body);
    addSlots();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.evolve-menu')) closeMenus();
  });

  window.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'evolve-request-html') post({ type: 'save', html: serialise() });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorate);
  else decorate();
})();
`.trim();
}

/**
 * Remove anything the editor added, in case a document is ever written while
 * editor chrome is present. The in-iframe serialiser already strips its own
 * artifacts; this is the belt-and-braces pass on the extension side, because a
 * report file containing editor toolbars would be visibly broken when emailed.
 */
export function stripEditorArtifacts(html: string): string {
  return html
    .replace(new RegExp(`<script[^>]*id=["']${EDITOR_SCRIPT_ID}["'][\\s\\S]*?<\\/script>`, 'gi'), '')
    .replace(new RegExp(`<style[^>]*id=["']${EDITOR_STYLE_ID}["'][\\s\\S]*?<\\/style>`, 'gi'), '')
    .replace(/<div class="evolve-(?:bar|add|menu)[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/\s*contenteditable=["'][^"']*["']/gi, '')
    .replace(/\s*data-evolve-(?:wired|bound)=["'][^"']*["']/gi, '')
    .replace(/\s*draggable=["']true["']/gi, '')
    .replace(/\s*class="evolve-(?:hover|drop-before|drop-after)"/gi, '')
    .replace(/\s(evolve-hover|evolve-drop-before|evolve-drop-after)(?=["\s])/gi, '');
}

/** A block-scoped refine: send one card, not the whole document. */
export function buildBlockRefinePrompt(blockHtml: string, instruction: string, blockType: string): string {
  return [
    `Below is ONE \`<section class="card">\` from a larger HTML report. Rewrite just this card.`,
    '',
    '### Requested change',
    instruction,
    '',
    '### Rules',
    `- Return ONLY this one card's HTML — no surrounding document, no <html>, <head> or <body>.`,
    '- Keep the opening tag\'s `data-block-id` and `data-block-type` attributes exactly as they are.',
    '- Do not write <style>, <script> or inline style="" attributes. The report stylesheet is injected',
    '  separately; use the existing classes (.kpi-grid, .kpi, figure.chart, table.data, ul.insights,',
    '  ol.actions, .callout, .grid.cols-2, .num, .muted, .badge).',
    '- Charts are inline <svg> using the series-1..6 and line-1..3 classes. If this card holds an',
    '  <img src="EVOLVE_IMG_n">, that is a real chart with its data stripped out — keep the placeholder',
    '  text exactly if you keep the chart, or delete the whole <figure> if you remove it. Never invent a',
    '  new EVOLVE_IMG_n.',
    '- Never invent numbers. Every figure must already be present in this card, unless the change is purely',
    '  a rewording or restructuring of what is here.',
    blockType ? `- This is a "${blockType}" block; keep it that kind of block.` : '',
    '',
    'Output the single updated card in one ```html fenced block, and nothing else.',
    '',
    '---',
    '### Current card',
    '```html',
    blockHtml,
    '```',
  ].filter(l => l !== '').join('\n');
}

/**
 * Extract one card from a document by block id, and give back a function that
 * splices a replacement into the same position. String-based rather than
 * DOM-based because the extension host has no DOM — but the boundaries are
 * unambiguous: we emitted the attribute, and cards do not nest.
 */
export function extractBlock(html: string, blockId: string): { block: string; replace: (next: string) => string } | null {
  const idAttr = `data-block-id="${blockId}"`;
  const at = html.indexOf(idAttr);
  if (at === -1) return null;

  // Walk back to the opening '<' of the tag carrying the attribute.
  const open = html.lastIndexOf('<', at);
  if (open === -1) return null;
  const tagMatch = /^<([a-zA-Z][\w-]*)/.exec(html.slice(open));
  if (!tagMatch) return null;
  const tag = tagMatch[1].toLowerCase();

  // Void elements (a divider is an <hr>) have no closing tag.
  const tagEnd = html.indexOf('>', at);
  if (tagEnd === -1) return null;
  if (tag === 'hr' || tag === 'br' || tag === 'img') {
    const block = html.slice(open, tagEnd + 1);
    return { block, replace: next => html.slice(0, open) + next + html.slice(tagEnd + 1) };
  }

  // Balance nested same-name tags to find the matching close.
  const openRe  = new RegExp(`<${tag}\\b`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let cursor = tagEnd + 1;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen  = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) {
        const block = html.slice(open, cursor);
        const end = cursor;
        return { block, replace: next => html.slice(0, open) + next + html.slice(end) };
      }
    }
  }
  return null;
}
