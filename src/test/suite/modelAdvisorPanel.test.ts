/**
 * test/suite/modelAdvisorPanel.test.ts
 *
 * The panel itself needs a VS Code host, so what is testable here is the thing
 * most worth testing: the generated HTML. A webview renders whatever string we
 * hand it, so an unescaped model name is a script injection, and a model name
 * is not something we control — it comes from whatever the user pulled.
 *
 * These tests follow the convention already set by the advancedVisuals suite:
 * assert well-formedness and escaping, not pixels.
 */

import * as assert from 'assert';
import { JOB_CATALOG } from '../../core/modelAdvisor';

/**
 * The panel's escaping helpers, mirrored here.
 *
 * `modelAdvisorPanel.ts` imports `vscode` at module scope, so it cannot be
 * loaded in a bare mocha run. These are byte-identical to the originals; the
 * test below pins that they behave as the panel needs them to.
 */
function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
function escAttr(s: string): string { return escHtml(s).replace(/`/g, '&#96;'); }

suite('Model Advisor Panel — escaping', () => {
  test('a model name cannot close a tag and inject script', () => {
    const hostile = '</script><script>alert(1)</script>';
    const out = escHtml(hostile);
    assert.ok(!out.includes('<script'), out);
    assert.ok(!out.includes('</script'), out);
    assert.ok(out.includes('&lt;'), out);
  });

  test('a model name cannot break out of an attribute', () => {
    const hostile = '" onmouseover="alert(1)';
    const out = escAttr(hostile);
    assert.ok(!out.includes('"'), out);
    assert.ok(out.includes('&quot;'), out);
  });

  test('backticks are neutralised in attributes', () => {
    // Backticks matter: some older parsers treat them as attribute delimiters.
    assert.ok(!escAttr('a`b').includes('`'));
  });

  test('ampersands are escaped first, so entities are not double-formed', () => {
    assert.strictEqual(escHtml('&lt;'), '&amp;lt;');
  });

  test('ordinary model names survive unchanged', () => {
    for (const name of ['qwen2.5-coder:7b', 'nomic-embed-text', 'mixtral:8x7b', 'llama3.2:1b']) {
      assert.strictEqual(escHtml(name), name, `${name} should not be mangled`);
    }
  });
});

suite('Model Advisor Panel — job catalogue contract', () => {
  test('every in-scope job supplies the four fields the panel renders', () => {
    const inScope = JOB_CATALOG.filter(j => j.inScope);
    assert.ok(inScope.length > 0, 'the panel would be empty');
    for (const j of inScope) {
      assert.ok(j.label, `${j.job} needs a label for the picker button`);
      assert.ok(j.whatItDoes, `${j.job} needs whatItDoes for the detail pane`);
      assert.ok(j.whenToUse, `${j.job} needs whenToUse for the detail pane`);
      assert.ok(j.commonMistake, `${j.job} needs commonMistake for the reference section`);
    }
  });

  test('job ids are safe to use as HTML attribute values', () => {
    // They are written into data-job="…" and matched by a CSS selector, so a
    // quote or space in one would break the picker silently.
    for (const j of JOB_CATALOG) {
      assert.match(j.job, /^[a-z][a-z0-9-]*$/, `${j.job} is not attribute-safe`);
      assert.strictEqual(escAttr(j.job), j.job);
    }
  });

  test('labels stay short enough to read as buttons', () => {
    for (const j of JOB_CATALOG.filter(x => x.inScope)) {
      assert.ok(j.label.length <= 42, `"${j.label}" is too long for a picker chip`);
    }
  });
});
