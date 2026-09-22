#!/usr/bin/env node
/**
 * scripts/verify-honest-mode.js
 *
 * Exercises the audit fixes against the compiled build, without Electron.
 *
 * It asserts the property that matters: a document may under-claim, but it must
 * never state a number nobody measured. Run `npm run compile` first.
 *
 *   node scripts/verify-honest-mode.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const OUT = path.join(__dirname, '..', 'out');
if (!fs.existsSync(OUT)) {
  console.error('out/ not found — run `npm run compile` first.');
  process.exit(1);
}

const { RunbookGenerator } = require(path.join(OUT, 'fde', 'runbookGenerator.js'));
const { ApiConnectorGenerator } = require(path.join(OUT, 'fde', 'apiConnectorGen.js'));
const prov = require(path.join(OUT, 'fde', 'provenance.js'));

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

const base = {
  clientName: 'Acme Pilot',
  schemaMappings: [], apiConnectors: [], dataMarts: [], discoveredEnvVars: []
};

/* ------------------------------------------------------------------ */
section('1. An empty engagement states no measurements');

const emptyDoc = RunbookGenerator.generateArchitectureDoc({ ...base, studioMode: 'LIVE' });
check('no fabricated accuracy (98%)', !/98(\.0)?%/.test(emptyDoc));
check('no fabricated case count (49/50)', !/49\s*\/\s*50/.test(emptyDoc));
check('no fabricated latency (18ms/95ms)', !/\b18ms\s*\/\s*95ms\b/.test(emptyDoc));
check('no "100.0% Grounded" literal', !/100\.0% Grounded/.test(emptyDoc));
check('no Ed25519 signature claim', !/Ed25519/i.test(emptyDoc));
check('no invented "1 vCPU, 1Gi" default', !/\(1 vCPU, 1Gi/.test(emptyDoc));
check('renders NOT YET MEASURED', /NOT YET MEASURED/.test(emptyDoc));
check('warns that no benchmark ran', /No golden benchmark has been executed/.test(emptyDoc));

/* ------------------------------------------------------------------ */
section('2. A real engagement states its real numbers');

const real = {
  ...base,
  studioMode: 'LIVE',
  discovery: {
    rawClientAsk: 'Reconcile daily settlement files',
    riskAnalysis: 'Manual keying errors at volume',
    reframedProblem: 'Deterministic match engine with HITL exceptions',
    outOfScope: ['No autonomous ledger writes'],
    controllersThreeNumbers: { volume: 8000, handleTimeMins: 12, hourlyWage: 40 }
  },
  aiSolution: {
    ladderTitle: 'Level 3: Grounded Policy RAG',
    ragArchitectureName: '02 Multimodal RAG',
    ruleVsModelVerdict: 'hybrid',
    ruleVsModelRationale: 'arithmetic stays deterministic'
  },
  evals: {
    benchmarkExecuted: true,
    accuracyScorePct: 91.2, passedCases: 41, totalCases: 45,
    latencyP50Ms: 63, latencyP95Ms: 210,
    groundednessScorePct: 88.4,
    groundednessMethod: 'lexical_token_containment_v1',
    groundednessAuditSignature: 'sha256:abc123'
  },
  deploymentConfig: {
    cpu: '8', memory: '32Gi', vpcId: 'vpc-prod-1',
    ingress: 'internal', secretsProvider: 'GCP Secret Manager'
  }
};

const realDoc = RunbookGenerator.generateArchitectureDoc(real);
check('shows measured accuracy 91.2%', /91\.2%/.test(realDoc));
check('shows real case count 41 / 45', /41 \/ 45/.test(realDoc));
check('shows configured 8 vCPU', /8 vCPU/.test(realDoc));
check('shows configured VPC', /vpc-prod-1/.test(realDoc));
check('shows the chosen RAG pattern', /Multimodal RAG/.test(realDoc));
// The phrase is emphasised in the document ("**not** a digital signature"),
// so allow markdown emphasis between the words.
check('describes digest, not signature', /not\*{0,2}\s*a digital signature/i.test(realDoc));
check('names the groundedness method', /lexical_token_containment_v1/.test(realDoc));

/* ------------------------------------------------------------------ */
section('3. Simulated results cannot masquerade as measured');

const simulated = {
  ...base, studioMode: 'LIVE',
  // Numbers present, but the run never happened.
  evals: { benchmarkExecuted: false, accuracyScorePct: 98, passedCases: 49, totalCases: 50 }
};
const simDoc = RunbookGenerator.generateArchitectureDoc(simulated);
check('suppresses 98% when benchmarkExecuted is false', !/98%/.test(simDoc));
check('renders NOT YET MEASURED instead', /NOT YET MEASURED/.test(simDoc));

/* ------------------------------------------------------------------ */
section('4. DEMO mode watermarks every document');

for (const [label, fn] of [
  ['architecture', 'generateArchitectureDoc'],
  ['deployment runbook', 'generateDeploymentRunbook'],
  ['executive demo script', 'generateExecutiveDemoScript'],
  ['client handoff bundle', 'generateCompleteHandoffPackage']
]) {
  const d = RunbookGenerator[fn]({ ...real, studioMode: 'DEMO' });
  check(`${label} carries the DEMO banner`, /NOT A CLIENT DELIVERABLE/.test(d));
}
const liveDoc = RunbookGenerator.generateCompleteHandoffPackage({ ...real, studioMode: 'LIVE' });
check('LIVE mode drops the DEMO banner', !/NOT A CLIENT DELIVERABLE/.test(liveDoc));
check('handoff bundle leads with the banner', /^>\s*\[!WARNING\]/.test(
  RunbookGenerator.generateCompleteHandoffPackage({ ...real, studioMode: 'DEMO' }).trimStart()
));

/* ------------------------------------------------------------------ */
section('5. The demo script refuses to read out unmeasured results');

const unmeasuredScript = RunbookGenerator.generateExecutiveDemoScript({ ...base, studioMode: 'LIVE' });
check('does not speak a fabricated accuracy', !/98(\.0)?% accuracy/.test(unmeasuredScript));
check('tells the FDE not to deliver the slide', /DO NOT DELIVER|Do not deliver/i.test(unmeasuredScript));
check('does not quote invented ROI ($61.3k)', !/61\.3k/.test(unmeasuredScript));

const measuredScript = RunbookGenerator.generateExecutiveDemoScript(real);
check('speaks the measured accuracy when real', /91\.2% accuracy/.test(measuredScript));

/* ------------------------------------------------------------------ */
section('6. SDK scaffolding works and honours its inputs');

let threwOnOldShape = false;
try {
  ApiConnectorGenerator.generateTypeScriptSdk({ serviceName: 'X', baseUrl: 'https://a/v1', endpoints: [] });
} catch { threwOnOldShape = true; }
check('the old call shape did throw (regression guard)', threwOnOldShape);

const sdk = ApiConnectorGenerator.generateTypeScriptSdk({
  connectorName: 'BillingApi', baseUrl: 'https://api.example.com/v1',
  authType: 'apiKey', targetLanguage: 'typescript',
  endpoints: [{ name: 'getInvoice', method: 'GET', path: '/invoices/{id}' }],
  maxRetries: 7, timeoutMs: 42000, rateLimitPerSec: 5
});
check('generates a non-trivial SDK', sdk.length > 1000, `got ${sdk.length} chars`);
check('honours the selected auth scheme', /x-api-key/i.test(sdk));
check('honours maxRetries', /\b7\b/.test(sdk));
check('honours timeoutMs', /42000/.test(sdk));

const bearer = ApiConnectorGenerator.generateTypeScriptSdk({
  connectorName: 'B', baseUrl: 'https://a/v1', authType: 'bearer',
  targetLanguage: 'typescript', endpoints: [{ name: 'g', method: 'GET', path: '/x' }]
});
check('a different auth scheme produces different code', /Bearer/i.test(bearer) && !/x-api-key/i.test(bearer));

/* ------------------------------------------------------------------ */
section('7. Provenance helpers refuse to invent values');

check('renderMeasured(unmeasured) is a placeholder',
  prov.renderMeasured(prov.unmeasured()) === prov.NOT_MEASURED);
check('renderMeasured(measured) shows the value',
  prov.renderMeasured(prov.measured(91.2), { unit: '%' }) === '91.2%');
check('a demo preset is flagged in its own output',
  prov.renderMeasured(prov.demoPreset(100), { unit: '%' }).includes('DEMO DATA'));
check('unmeasured is not presentable', prov.isPresentable(prov.unmeasured()) === false);
check('measured is presentable', prov.isPresentable(prov.measured(1)) === true);
check('a demo preset is not presentable as fact', prov.isPresentable(prov.demoPreset(1)) === false);
check('no integrity stamp claims to be a signature',
  prov.sha256Stamp('abc').cryptographicallySigned === false);

/* ------------------------------------------------------------------ */
section('8. Phase state merges without clobbering other phases');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fde-verify-'));
const evolveDir = path.join(dir, '.evolve');
fs.mkdirSync(evolveDir);
const stateFile = path.join(evolveDir, 'fde_state.json');
fs.writeFileSync(stateFile, JSON.stringify({ clientName: 'X', aiSolution: { ladderLevel: 3 } }));

// Mirrors the SAVE_PHASE_STATE handler's merge semantics.
const allowed = new Set(['aiSolution', 'evals', 'deploymentConfig']);
const savePhase = (key, data, merge) => {
  if (!allowed.has(key)) return { success: false };
  const cur = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const mergeObjects = merge !== false && !Array.isArray(data) && typeof data === 'object' && data !== null;
  cur[key] = mergeObjects ? { ...(cur[key] || {}), ...data } : data;
  fs.writeFileSync(stateFile, JSON.stringify(cur, null, 2));
  return { success: true };
};

savePhase('aiSolution', { ragArchitecture: 'multimodal' });
savePhase('evals', { benchmarkExecuted: true, accuracyScorePct: 91.2 });
const merged = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
check('3C write preserves 3A ladderLevel', merged.aiSolution.ladderLevel === 3);
check('3C write lands', merged.aiSolution.ragArchitecture === 'multimodal');
check('Phase 4 block lands alongside', merged.evals.accuracyScorePct === 91.2);
check('an unknown key is rejected', savePhase('bogusKey', { x: 1 }).success === false);
fs.rmSync(dir, { recursive: true, force: true });

/* ------------------------------------------------------------------ */
section('9. Client-facing HTML is presentable and self-contained');

const { presentDocument } = require(path.join(OUT, 'fde', 'documentPresenter.js'));
const md = RunbookGenerator.generateArchitectureDoc({ ...real, studioMode: 'DEMO' });
const html = presentDocument(md, { title: 'System Architecture', client: 'Acme Pilot', mode: 'DEMO' });
const htmlBody = html.split('<main class="content">')[1].split('</main>')[0];

check('no unrendered **bold**', !/\*\*[^*<]+\*\*/.test(htmlBody));
check('no raw heading hashes', !/^#{1,6}\s/m.test(htmlBody));
check('no raw code fences', !htmlBody.includes('```'));
check('no raw callout syntax', !/\[!(WARNING|CAUTION|NOTE)\]/.test(htmlBody));
check('tables become real <table>', /<table>/.test(htmlBody));
check('mermaid becomes a labelled figure', /class="diagram"/.test(htmlBody));
check('unmeasured values become visible chips', /chip-unmeasured/.test(htmlBody));
// Match the rendered panel, not the stylesheet rule — `.demo-banner` is defined
// in every page's inline CSS whether or not the panel is emitted.
const hasDemoPanel = (h) => /<div class="demo-banner">/.test(h);
check('DEMO renders the red banner panel', hasDemoPanel(html));
check('LIVE drops the banner panel',
  !hasDemoPanel(presentDocument(md, { title: 'T', mode: 'LIVE' })));
check('LIVE body does not retain the markdown banner',
  !/NOT A CLIENT DELIVERABLE/.test(
    presentDocument(RunbookGenerator.generateArchitectureDoc({ ...base, studioMode: 'LIVE' }),
      { title: 'T', mode: 'LIVE' }).split('<main class="content">')[1]
  ));
check('carries print stylesheet', /@media print/.test(html));
check('fetches nothing at runtime (air-gap safe)',
  !/(src|href)\s*=\s*["']https?:/i.test(html));

// The presentation pass must not quietly drop the honesty markers.
const emptyHtml = presentDocument(
  RunbookGenerator.generateArchitectureDoc({ ...base, studioMode: 'LIVE' }),
  { title: 'T', mode: 'LIVE' }
);
check('prettified empty doc still shows unmeasured markers', /chip-unmeasured/.test(emptyHtml));
check('prettified empty doc still states no benchmark ran',
  /No golden benchmark has been executed/.test(emptyHtml));

/* ------------------------------------------------------------------ */
section('10. Document defects stay fixed');

check('no literal \\n leaking into prose', !/FIREBASE\s*\\n/.test(md));
const zeroRoi = RunbookGenerator.generateArchitectureDoc({
  ...base, studioMode: 'LIVE',
  discovery: { controllersThreeNumbers: { volume: 0, handleTimeMins: 0, hourlyWage: 0 } }
});
check('an all-zero ROI table is suppressed', !/\$0\/hr/.test(zeroRoi));
check('and replaced with an honest note', /no economic case can be stated/.test(zeroRoi));

/* ------------------------------------------------------------------ */
console.log(`\n${'='.repeat(52)}`);
console.log(`${pass} passed, ${fail} failed`);
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
