/**
 * test/suite/modelFlows.test.ts
 *
 * These diagrams exist to correct specific errors in the popular explainers, so
 * the tests assert the corrections rather than the shapes. If someone later
 * "tidies" the MoE flow back into a single front-door router, or merges the
 * build-time lane into the runtime path, these should fail — that is the whole
 * point of the file.
 *
 * Every diagram is also parsed with the real renderer, because a flow that does
 * not draw is not a flow.
 */

import * as assert from 'assert';
import {
  ATTRIBUTE_FLOWS, MODEL_FLOWS,
  attributeFlow, citeFlow, flowForJob,
} from '../../core/modelFlows';
import { parseFlowchart, renderFlowchartSvg } from '../../offline/flowchartRenderer';

suite('Model flows — every diagram actually draws', () => {
  const all = [
    ...MODEL_FLOWS.flatMap(f => [
      { name: `${f.title} runtime`, src: f.runtime },
      ...(f.buildTime ? [{ name: `${f.title} build-time`, src: f.buildTime }] : []),
    ]),
    ...ATTRIBUTE_FLOWS.flatMap(f => [
      { name: `${f.title} runtime`, src: f.runtime },
      ...(f.buildTime ? [{ name: `${f.title} build-time`, src: f.buildTime }] : []),
    ]),
  ];

  for (const { name, src } of all) {
    test(`"${name}" parses with no errors and renders`, () => {
      const p = parseFlowchart(src);
      assert.deepStrictEqual(p.errors, [], `errors: ${p.errors.join('; ')}`);
      assert.ok(p.nodes.length >= 2, 'a flow needs at least two nodes');
      const r = renderFlowchartSvg(src, { title: name });
      assert.ok(r.svg.startsWith('<svg') && r.svg.endsWith('</svg>'));
    });
  }
});

suite('Model flows — the corrections they exist to make', () => {
  test('MoE routes inside every layer, not once at the entrance', () => {
    const moe = attributeFlow('moe');
    assert.ok(moe);
    const p = parseFlowchart(moe!.runtime);
    // The loop back into the layer is the correction. Without an edge that
    // returns, this is the wrong diagram again.
    const loops = p.edges.filter(e => {
      const fromRank = p.nodes.findIndex(n => n.id === e.from);
      const toRank = p.nodes.findIndex(n => n.id === e.to);
      return toRank < fromRank;
    });
    assert.ok(loops.length > 0, 'expected an edge returning to an earlier stage');
    assert.ok(/more layers/i.test(moe!.runtime), 'the per-layer repetition must be visible');
  });

  test('MoE shows attention as shared, so experts are clearly the FFN only', () => {
    assert.ok(/shared/i.test(attributeFlow('moe')!.runtime));
  });

  test('MoE explains the memory-versus-speed trade honestly', () => {
    const note = attributeFlow('moe')!.costNote;
    assert.ok(/total/i.test(note) && /active/i.test(note), note);
  });

  test('encoder-only shows joint bidirectional attention, not two context branches', () => {
    const enc = attributeFlow('encoder-only');
    assert.ok(/every token sees every other/i.test(enc!.runtime), enc!.runtime);
    // The specific error being corrected: separate left/right pathways.
    assert.ok(!/left context/i.test(enc!.runtime));
    assert.ok(!/right context/i.test(enc!.runtime));
  });

  test('masking is shown as training only, never as an inference stage', () => {
    const enc = attributeFlow('encoder-only')!;
    assert.ok(enc.buildTime, 'masking belongs in the build-time lane');
    assert.ok(/mask/i.test(enc.buildTime!), 'the mask step should be in the training lane');
    assert.ok(!/mask/i.test(enc.runtime), 'there is no masking at inference');
  });

  test('small models share the ordinary inference path', () => {
    const small = attributeFlow('small')!;
    assert.ok(/same decode loop/i.test(small.runtime), small.runtime);
    // Quantisation is something done to a model, not a stage it runs through.
    assert.ok(!/quantis|quantiz/i.test(small.runtime), 'quantisation is not an inference stage');
    assert.ok(/quantis|quantiz/i.test(small.buildTime ?? ''), 'and it belongs in the build lane');
  });

  test('text generation shows the decode loop', () => {
    const chat = flowForJob('chat')!;
    assert.ok(/not finished/i.test(chat.runtime), 'the loop must be visible');
    assert.ok(/per token/i.test(chat.costNote), chat.costNote);
  });

  test('vision has no phantom text encoder', () => {
    const v = flowForJob('vision')!;
    assert.ok(/projection/i.test(v.runtime), 'the projection is the actual mechanism');
    assert.ok(!/text encoder/i.test(v.runtime), 'text goes straight to the LLM embeddings');
    assert.ok(!/multimodal processor/i.test(v.runtime), 'that box does not exist');
  });

  test('retrieval shows both stages, which the source list omitted entirely', () => {
    const r = flowForJob('reranking')!;
    assert.ok(/embed/i.test(r.runtime) && /rerank/i.test(r.runtime));
  });

  test('fill-in-the-middle uses what comes after the cursor', () => {
    const fim = flowForJob('code-fim')!;
    assert.ok(/after cursor/i.test(fim.runtime), fim.runtime);
    assert.ok(/AFTER/i.test(fim.corrects ?? ''), 'the correction should name why chat models fail at it');
  });
});

suite('Model flows — provenance', () => {
  test('every flow declares where its shape came from', () => {
    for (const f of [...MODEL_FLOWS, ...ATTRIBUTE_FLOWS]) {
      assert.ok(f.provenance, `${f.title} needs provenance`);
      if (f.provenance.kind === 'paper') {
        assert.ok(f.provenance.cite.length > 10, `${f.title} needs a real citation`);
        assert.match(f.provenance.url, /^https:\/\/arxiv\.org\//, `${f.title} should cite a paper URL`);
      } else {
        assert.ok(f.provenance.note.length > 10, `${f.title} needs a note on what it illustrates`);
      }
    }
  });

  test('a family-level sketch is never presented as a specific architecture', () => {
    const family = MODEL_FLOWS.find(f => f.provenance.kind === 'family')!;
    assert.ok(/^Illustrative:/.test(citeFlow(family.provenance)));
  });

  test('a paper-backed flow cites the paper', () => {
    const paper = MODEL_FLOWS.find(f => f.provenance.kind === 'paper')!;
    const cited = citeFlow(paper.provenance);
    assert.ok(/^Follows /.test(cited));
    assert.ok(cited.includes('arxiv.org'));
  });

  test('no flow states a latency or cost number nobody measured', () => {
    // The honesty rule applies to diagrams too: costNote explains where time
    // goes in words. A figure here would end up in a client document as fact.
    for (const f of [...MODEL_FLOWS, ...ATTRIBUTE_FLOWS]) {
      assert.ok(!/\d+\s*(ms|seconds?|tokens\/s|\$)/i.test(f.costNote),
        `${f.title} costNote states an unmeasured figure: ${f.costNote}`);
    }
  });
});

suite('Model flows — lookup', () => {
  test('flowForJob finds a flow and misses cleanly', () => {
    assert.ok(flowForJob('embedding'));
    assert.strictEqual(flowForJob('timeseries'), undefined,
      'forecasting has no model flow — it is answered by the statistical engine');
  });

  test('attributeFlow finds each attribute', () => {
    for (const id of ['moe', 'encoder-only', 'small'] as const) {
      assert.ok(attributeFlow(id), `${id} should exist`);
    }
  });

  test('attributes are kept out of the job list', () => {
    // The whole taxonomy rests on this separation: MoE and "small" are filters,
    // not things a user picks to do.
    const jobIds = MODEL_FLOWS.map(f => String(f.job));
    for (const attr of ['moe', 'encoder-only', 'small']) {
      assert.ok(!jobIds.includes(attr), `${attr} must not appear as a job`);
    }
  });
});
