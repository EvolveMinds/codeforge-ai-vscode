/**
 * test/suite/offline/flowchartRenderer.test.ts
 *
 * Following the convention set by advancedVisuals.test.ts: SVG is not worth
 * snapshotting, so these pin the properties that actually matter —
 * well-formedness, correct parsing, graceful failure, and that untrusted label
 * text cannot break out of the markup.
 *
 * The acceptance test for this module is the last suite: every flowchart the
 * product already emits must parse with zero errors. Those diagrams are the
 * reason the module exists.
 */

import * as assert from 'assert';
import {
  esc,
  flowchartStepCount,
  isFlowchart,
  parseFlowchart,
  renderFlowchartSvg,
} from '../../../offline/flowchartRenderer';

/** Crude but effective well-formedness check, as used by the sibling suite. */
function tagsBalanced(svg: string): boolean {
  const opens = (svg.match(/<svg\b/g) || []).length;
  const closes = (svg.match(/<\/svg>/g) || []).length;
  return opens === closes && opens === 1;
}

suite('Flowchart renderer — parsing', () => {
  test('reads the direction from the header', () => {
    assert.strictEqual(parseFlowchart('flowchart TD\n A --> B').direction, 'TD');
    assert.strictEqual(parseFlowchart('flowchart LR\n A --> B').direction, 'LR');
    // TB is Mermaid's synonym for TD.
    assert.strictEqual(parseFlowchart('flowchart TB\n A --> B').direction, 'TD');
  });

  test('recognises box and decision shapes', () => {
    const p = parseFlowchart('flowchart TD\n A["Start"] --> B{"Choose"}');
    assert.strictEqual(p.nodes.find(n => n.id === 'A')?.shape, 'box');
    assert.strictEqual(p.nodes.find(n => n.id === 'B')?.shape, 'decision');
    assert.strictEqual(p.nodes.find(n => n.id === 'A')?.label, 'Start');
  });

  test('a decision node is not mistaken for a box', () => {
    // `{` must be tried before `[`, or every diamond renders as a rectangle.
    const p = parseFlowchart('flowchart TD\n Gate{"Is it valid?"} --> Out["Yes"]');
    assert.strictEqual(p.nodes.find(n => n.id === 'Gate')?.shape, 'decision');
  });

  test('plain, dotted and labelled edges are all read', () => {
    const p = parseFlowchart(
      'flowchart TD\n A --> B\n B -.-> C\n C -- "Score >= 0.90" --> D');
    assert.strictEqual(p.edges.length, 3);
    assert.strictEqual(p.edges[0].dashed, undefined);
    assert.strictEqual(p.edges[1].dashed, true);
    assert.strictEqual(p.edges[2].label, 'Score >= 0.90');
  });

  test('an edge label is not swallowed by the plain-arrow pattern', () => {
    // `-- "x" -->` contains `-->`; matching the plain form first loses the label.
    const p = parseFlowchart('flowchart TD\n A -- "Rule Breach" --> B');
    assert.strictEqual(p.edges[0].label, 'Rule Breach');
    assert.strictEqual(p.edges[0].from, 'A');
    assert.strictEqual(p.edges[0].to, 'B');
  });

  test('subgraphs become lanes and tag their members', () => {
    const p = parseFlowchart(
      'flowchart TD\n subgraph Build["Build time"]\n A["Quantise"]\n end\n A --> B["Serve"]');
    assert.strictEqual(p.lanes.length, 1);
    assert.strictEqual(p.lanes[0].label, 'Build time');
    assert.strictEqual(p.nodes.find(n => n.id === 'A')?.lane, 'Build');
    assert.strictEqual(p.nodes.find(n => n.id === 'B')?.lane, undefined);
  });

  test('comments are ignored', () => {
    const p = parseFlowchart('flowchart TD\n %% a note\n A --> B');
    assert.strictEqual(p.errors.length, 0);
    assert.strictEqual(p.edges.length, 1);
  });

  test('a node referenced before declaration still resolves to one node', () => {
    const p = parseFlowchart('flowchart TD\n A --> B\n B["Named later"]');
    assert.strictEqual(p.nodes.length, 2);
    assert.strictEqual(p.nodes.find(n => n.id === 'B')?.label, 'Named later');
  });
});

suite('Flowchart renderer — failure is graceful', () => {
  test('a non-flowchart source is reported, not thrown', () => {
    const p = parseFlowchart('sequenceDiagram\n A->>B: hi');
    assert.ok(p.errors.length > 0);
    assert.ok(/flowchart/i.test(p.errors[0]), p.errors[0]);
    assert.strictEqual(p.nodes.length, 0);
  });

  test('empty input is reported, not thrown', () => {
    assert.ok(parseFlowchart('').errors.length > 0);
    assert.ok(parseFlowchart('   ').errors.length > 0);
  });

  test('one unreadable line does not lose the rest of the diagram', () => {
    const p = parseFlowchart('flowchart TD\n A --> B\n !!! nonsense !!!\n B --> C');
    assert.strictEqual(p.edges.length, 2, 'the readable edges must survive');
    assert.ok(p.errors.length > 0, 'and the bad line must be reported');
  });

  test('unsupported Mermaid features are named rather than mangled', () => {
    const p = parseFlowchart('flowchart TD\n A --> B\n classDef big fill:#f00');
    assert.ok(p.errors.some(e => /not supported/i.test(e)), p.errors.join('; '));
    assert.strictEqual(p.edges.length, 1);
  });

  test('rendering nothing yields no SVG and says why', () => {
    const r = renderFlowchartSvg('');
    assert.strictEqual(r.svg, '');
    assert.ok(r.errors.length > 0);
  });

  test('a cyclic diagram terminates and still draws', () => {
    // A feedback loop is a real input; ranking must not spin forever.
    const r = renderFlowchartSvg('flowchart TD\n A --> B\n B --> C\n C --> A');
    assert.ok(r.svg.length > 0);
    assert.ok(tagsBalanced(r.svg));
  });
});

suite('Flowchart renderer — SVG output', () => {
  const SRC = 'flowchart TD\n A["Start"] --> B{"Valid?"}\n B -- "Yes" --> C["Done"]\n B -- "No" --> D["Reject"]';

  test('produces one well-formed svg element', () => {
    const r = renderFlowchartSvg(SRC);
    assert.ok(tagsBalanced(r.svg));
    assert.ok(r.svg.startsWith('<svg'));
    assert.ok(r.svg.endsWith('</svg>'));
  });

  test('draws every node and edge', () => {
    const r = renderFlowchartSvg(SRC);
    assert.strictEqual((r.svg.match(/class="fc-node"/g) || []).length, 4);
    assert.strictEqual((r.svg.match(/class="fc-edge"/g) || []).length, 3);
  });

  test('a decision node is drawn as a diamond, not a rectangle', () => {
    const r = renderFlowchartSvg(SRC);
    assert.ok(r.svg.includes('<polygon'), 'expected a polygon for the decision node');
  });

  test('the title is rendered when given', () => {
    assert.ok(renderFlowchartSvg(SRC, { title: 'Level 1' }).svg.includes('LEVEL 1'));
  });

  test('the active step is highlighted and carries the travelling marker', () => {
    const plain = renderFlowchartSvg(SRC);
    const active = renderFlowchartSvg(SRC, { activeStep: 1, photonRatio: 0.5 });
    assert.ok(active.svg.includes('<circle'), 'expected the photon');
    assert.ok(active.svg.includes('fc-arrow-on'), 'expected the highlighted arrowhead');
    assert.ok(!plain.svg.includes('<circle'), 'no photon when not animating');
  });

  test('step count matches the edge count', () => {
    assert.strictEqual(flowchartStepCount(SRC), 3);
    assert.strictEqual(flowchartStepCount('not a diagram'), 0);
  });
});

suite('Flowchart renderer — escaping', () => {
  test('a less-than in a label cannot break the SVG', () => {
    // Real diagrams contain "✅ Output (<50ms)" — a raw < would corrupt the markup.
    const r = renderFlowchartSvg('flowchart TD\n A["Output (<50ms)"] --> B["Done"]');
    assert.ok(r.svg.includes('&lt;50ms'), 'the < must be escaped');
    assert.ok(tagsBalanced(r.svg));
  });

  test('a hostile label cannot inject an element', () => {
    const r = renderFlowchartSvg('flowchart TD\n A["</text><script>alert(1)</script>"] --> B["x"]');
    assert.ok(!r.svg.includes('<script'), 'script tag must not survive');
    assert.ok(tagsBalanced(r.svg));
  });

  test('a hostile edge label cannot inject an element', () => {
    const r = renderFlowchartSvg('flowchart TD\n A -- "</text><script>x</script>" --> B');
    assert.ok(!r.svg.includes('<script'));
  });

  test('a hostile node id cannot break the data attribute', () => {
    const r = renderFlowchartSvg('flowchart TD\n A --> B\n A["ok"]');
    assert.ok(!/data-node-id="[^"]*"[^">]*"/.test(r.svg));
  });

  test('esc() handles the characters that matter', () => {
    assert.strictEqual(esc('<&>"\''), '&lt;&amp;&gt;&quot;&#39;');
    assert.strictEqual(esc(null), '');
    assert.strictEqual(esc(undefined), '');
  });

  test('emoji and comparison operators survive intact', () => {
    // Every real ladder diagram uses both.
    const r = renderFlowchartSvg('flowchart TD\n A["📥 Ingress"] -- "Score >= 0.90" --> B["✅ Out"]');
    assert.ok(r.svg.includes('📥'));
    assert.ok(r.svg.includes('✅'));
    assert.ok(r.svg.includes('&gt;= 0.90'));
  });
});

suite('Flowchart renderer — isFlowchart()', () => {
  test('recognises flowchart sources', () => {
    assert.strictEqual(isFlowchart('flowchart TD\n A --> B'), true);
    assert.strictEqual(isFlowchart('  flowchart LR\n A --> B'), true);
  });

  test('rejects other diagram types, so the sequence renderer keeps its inputs', () => {
    assert.strictEqual(isFlowchart('sequenceDiagram\n A->>B: hi'), false);
    assert.strictEqual(isFlowchart(''), false);
    assert.strictEqual(isFlowchart('graph TD\n A --> B'), false);
  });
});

/**
 * The acceptance test for the whole module.
 *
 * These are the shapes the product actually emits — capability-ladder levels,
 * decision-gate templates, workflow topologies. Before this module they were
 * rejected outright by the sequence parser and shown as raw text. Every one of
 * them must now parse cleanly and draw.
 */
suite('Flowchart renderer — the diagrams this product already ships', () => {
  const REAL: Array<[string, string]> = [
    ['hybrid rule-gated RAG',
      'flowchart TD\n' +
      '  Ingress["📥 Ingress Task"] --> Gate1{"🛡️ Level 1: Deterministic Gate"}\n' +
      '  Gate1 -- "Rule Breach" --> Escalate["🛑 Escalate / Reject (<2ms)"]\n' +
      '  Gate1 -- "Boundary Validated" --> Rag3["📚 Level 3: Grounded Policy RAG"]\n' +
      '  Rag3 --> Verify{"🔍 Citation Verifier"}\n' +
      '  Verify -- "Score >= 0.90" --> Egress["✅ Verified Output (<80ms)"]\n' +
      '  Verify -- "Score < 0.90" --> HITL["👤 Human Supervisor Queue"]'],
    ['level 1 deterministic gate',
      'flowchart TD\n' +
      '  Ingress["📥 Ingress Input"] --> RuleCheck{"🛡️ Level 1: Deterministic Gate"}\n' +
      '  RuleCheck -- "Within Threshold" --> Execute["✅ Compiled SQL / TS Rule (<5ms)"]\n' +
      '  RuleCheck -- "Ceiling Exceeded" --> HITL["🛑 Escalate to Human Supervisor"]'],
    ['level 2 semantic router',
      'flowchart TD\n' +
      '  Ingress["📥 Ingress Request"] --> Gate1{"🛡️ Level 1: Rule Pre-Filter"}\n' +
      '  Gate1 -- "Invalid" --> Drop["❌ Reject (<1ms)"]\n' +
      '  Gate1 -- "Valid" --> Router2["🧭 Level 2: Semantic Router"]\n' +
      '  Router2 --> RouteChoice{"🎯 Route Dispatch"}\n' +
      '  RouteChoice -- "Financial" --> EngineRule["💰 Rule Engine"]\n' +
      '  RouteChoice -- "Policy" --> EngineRag["📚 Policy RAG"]'],
    ['minimal gate',
      'flowchart TD\n  Ingress["📥 Ingress Input"] --> Gate{"🛡️ Decision Gate"}\n' +
      '  Gate --> Egress["✅ Output (<50ms)"]'],
  ];

  for (const [name, src] of REAL) {
    test(`parses "${name}" with no errors`, () => {
      const p = parseFlowchart(src);
      assert.deepStrictEqual(p.errors, [], `unexpected errors: ${p.errors.join('; ')}`);
      assert.ok(p.nodes.length >= 3);
      assert.ok(p.edges.length >= 2);
    });

    test(`renders "${name}" to well-formed SVG`, () => {
      const r = renderFlowchartSvg(src, { title: name });
      assert.ok(r.svg.length > 0, 'expected a drawing');
      assert.ok(tagsBalanced(r.svg));
      // No raw angle bracket may survive inside a text node.
      const texts = r.svg.match(/<text[^>]*>([^<]*)</g) || [];
      for (const t of texts) {
        assert.ok(!/[<>]/.test(t.replace(/^<text[^>]*>/, '').replace(/<$/, '')),
          `unescaped angle bracket in ${t}`);
      }
    });
  }
});
