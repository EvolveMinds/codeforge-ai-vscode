import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { LoopEngine } from '../../../fde/loopEngine';
import { FdeStateStore } from '../../../fde/fdeStateStore';
import { WebhookStudio } from '../../../fde/webhookStudio';
import { DeslopScrubber } from '../../../fde/deslopScrubber';
import { StageGateValidator } from '../../../fde/stageGateValidator';

suite('FDE Suite — Autonomous Fleet & Mechanical Quality Loop', () => {
  let tmpDir: string;
  let store: FdeStateStore;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-fde-test-'));
    store = FdeStateStore.getInstance(tmpDir);
  });

  teardown(() => {
    store.dispose();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('FdeStateStore saves and retrieves engagement state across disk', async () => {
    const state = store.getState();
    assert.ok(state.id);
    assert.strictEqual(typeof state.clientName, 'string');

    await store.setState({
      ...state,
      clientName: 'Acme Federal Bank',
      engagementGoal: 'Automate wire verification and regulatory reporting'
    }, 'cli');

    const updated = store.getState();
    assert.strictEqual(updated.clientName, 'Acme Federal Bank');
    assert.strictEqual(updated.engagementGoal, 'Automate wire verification and regulatory reporting');

    const stateFilePath = path.join(tmpDir, '.evolve', 'fde_state.json');
    assert.ok(fs.existsSync(stateFilePath));
    const onDisk = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    assert.strictEqual(onDisk.clientName, 'Acme Federal Bank');
  });

  test('LoopEngine enforces risk-scaled iteration minima and reviewer approval', async () => {
    const engine = new LoopEngine(tmpDir, store);

    // Initial status: no active loop
    const initialStatus = engine.getStatus();
    assert.strictEqual(initialStatus.active, false);

    // Start auto-fix loop (requires min 2 iterations)
    const loop = await engine.startLoop({
      taskTitle: 'Fix Stripe HMAC edge case',
      riskClass: 'auto-fix'
    });
    assert.strictEqual(loop.riskClass, 'auto-fix');
    assert.strictEqual(loop.minIterations, 2);
    assert.strictEqual(loop.currentIteration, 0);

    // Attempting to complete before minimum iterations throws
    await assert.rejects(
      async () => {
        await engine.completeLoop('Premature completion', 'No real proof');
      },
      /mandates at least/
    );

    // Record Iteration 1 with change request
    const iter1 = await engine.recordIteration({
      summary: 'Added basic HMAC check',
      evidenceContent: 'const valid = hmac == signature;',
      reviewerVerdict: {
        verdict: 'changes_requested',
        reviewerId: 'fde-security-reviewer',
        highFindings: 1,
        mediumFindings: 0,
        lowFindings: 0,
        notes: 'Must use crypto.timingSafeEqual'
      }
    });
    assert.strictEqual(iter1.currentIteration, 1);
    assert.ok(iter1.iterations[0].evidenceSha256);

    // Record Iteration 2 with approval
    const iter2 = await engine.recordIteration({
      summary: 'Switched to timingSafeEqual and added replay window',
      evidenceContent: 'crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))',
      reviewerVerdict: {
        verdict: 'approved',
        reviewerId: 'fde-security-reviewer',
        highFindings: 0,
        mediumFindings: 0,
        lowFindings: 0
      }
    });
    assert.strictEqual(iter2.currentIteration, 2);

    // Now completing succeeds and releases the lock
    const completed = await engine.completeLoop('Fixed and verified', 'Passing all test assertions');
    assert.strictEqual(completed.status, 'completed');
    assert.strictEqual(engine.getStatus().active, false);
  });

  test('WebhookStudio generates verified receivers for Stripe, GitHub, and Slack', () => {
    const stripeReceiver = WebhookStudio.generateReceiver({
      provider: 'stripe',
      language: 'typescript',
      framework: 'express',
      samplePayload: JSON.stringify({ id: 'evt_123', type: 'payment_intent.succeeded' })
    });

    assert.ok(stripeReceiver.serverCode.includes('crypto.timingSafeEqual'));
    assert.ok(stripeReceiver.serverCode.includes('stripe-signature'));
    assert.ok(stripeReceiver.serverCode.includes('tolerance'));
    assert.ok(stripeReceiver.serverCode.includes('SEEN_IDEMPOTENCY_KEYS'));
    assert.ok(stripeReceiver.testCode.includes('createSignature'));
    assert.ok(stripeReceiver.testCode.includes('testAllCases'));

    const githubReceiver = WebhookStudio.generateReceiver({
      provider: 'github',
      language: 'typescript',
      framework: 'express',
      samplePayload: JSON.stringify({ action: 'opened', pull_request: { number: 42 } })
    });

    assert.ok(githubReceiver.serverCode.includes('x-hub-signature-256'));
    assert.ok(githubReceiver.serverCode.includes('sha256='));
  });

  test('WebhookStudio verifies constant-time HMAC signatures directly', () => {
    const secret = 'whsec_test_secret_key_12345';
    const payload = '{"status":"ok","amount":1000}';
    const crypto = require('crypto');
    const validSig = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

    // Valid signature passes
    const isValid = WebhookStudio.verifyHmacSignature(payload, validSig, secret);
    assert.strictEqual(isValid, true);

    // Tampered payload fails
    const isTampered = WebhookStudio.verifyHmacSignature('{"status":"tampered"}', validSig, secret);
    assert.strictEqual(isTampered, false);

    // Invalid signature fails
    const isBadSig = WebhookStudio.verifyHmacSignature(payload, '0000000000000000', secret);
    assert.strictEqual(isBadSig, false);
  });

  test('DeslopScrubber detects conversational AI comments, empty catches, and generic UI', () => {
    const sampleCode = `
      // Here is the code for the payment gateway
      export function processPayment(amount: number) {
        try {
          // TODO: implement later
          doSomething(amount);
        } catch (e) {}
      }

      export function renderButton() {
        return '<button class="btn">Submit</button>';
      }
    `;

    const findings = DeslopScrubber.scrubContent('src/payment/gateway.ts', sampleCode);
    assert.ok(findings.length >= 3);

    const hasStaleComment = findings.some(f => f.rule === 'stale-comment');
    const hasEmptyCatch = findings.some(f => f.rule === 'empty-catch');
    const hasGenericUi = findings.some(f => f.rule === 'generic-ui');

    assert.strictEqual(hasStaleComment, true);
    assert.strictEqual(hasEmptyCatch, true);
    assert.strictEqual(hasGenericUi, true);

    // Empty catch must be blocking severity
    const emptyCatchFinding = findings.find(f => f.rule === 'empty-catch')!;
    assert.strictEqual(emptyCatchFinding.severity, 'blocking');
  });

  test('StageGateValidator enforces enterprise ADR structure', () => {
    const validator = new StageGateValidator(tmpDir);

    // Create accompanying COUNCIL synthesis file
    fs.writeFileSync(path.join(tmpDir, 'COUNCIL-001.md'), '# Council Synthesis\nConsensus: Approved', 'utf8');

    const adrFile = path.join(tmpDir, 'ADR-001.md');
    fs.writeFileSync(
      adrFile,
      `# ADR-001: Rule Engine vs Vector RAG for Wire Verification

## Context
High volume transaction compliance.

### Option 1: Rule Engine
Deterministic regex & schema mapping.

### Option 2: Vector RAG
Embedding retrieval.

### Option 3: Fine-Tuned SLM
Local weights.

## Decision
We select Option 1: Rule Engine.

## Status
Accepted

## Consequences
Deterministic sub-50ms execution latency.
`,
      'utf8'
    );

    const result = validator.validate('architecture', adrFile);
    assert.strictEqual(result.passed, true);
    assert.ok(result.score >= 80);
  });
});
