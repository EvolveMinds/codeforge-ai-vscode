import * as assert from 'assert';
import { ARCHETYPE_NAMES, buildScopeMarkdown, DEFAULT_ROI_ASSUMPTIONS } from '../../../desktop/main/ipcHandlers';

suite('FDE Suite — Discovery Archetypes & Scope Serialization', () => {
  test('maps all engagement archetypes to descriptive enterprise labels', () => {
    assert.strictEqual(ARCHETYPE_NAMES['support-copilot'], 'Support Operations Copilot (Tier 1-2 Deflection)');
    assert.strictEqual(ARCHETYPE_NAMES['fin-reconcile'], 'Financial Ledger & Payment Reconciliation');
    assert.strictEqual(ARCHETYPE_NAMES['health-records'], 'Clinical Records & Diagnostic Intake Extraction');
    assert.strictEqual(ARCHETYPE_NAMES['supply-chain'], 'Supply Chain Disruption & ASN Routing Agent');
    assert.strictEqual(ARCHETYPE_NAMES['custom'], 'Custom Engagement');
  });

  test('DEFAULT_ROI_ASSUMPTIONS contains defensible enterprise defaults', () => {
    assert.strictEqual(DEFAULT_ROI_ASSUMPTIONS.automationRatioPct, 70);
    assert.strictEqual(DEFAULT_ROI_ASSUMPTIONS.loadedCostMultiplier, 1.3);
    assert.strictEqual(DEFAULT_ROI_ASSUMPTIONS.productiveHoursPerMonth, 135);
    assert.strictEqual(DEFAULT_ROI_ASSUMPTIONS.confidenceBandPct, 20);
  });

  test('buildScopeMarkdown serializes complete Support Copilot archetype with error rework savings', () => {
    const data = {
      standard: 'enterprise',
      archetype: 'support-copilot',
      rawClientAsk: 'We need AI to answer customer support tickets in Zendesk.',
      inquiryProbes: [
        { category: 'Shadow IT', question: 'What manual macros do tier-1 operators use?', checked: true },
        { category: 'Failure Mode', question: 'What happens if a billing ticket gets wrong advice?', checked: true },
      ],
      floorObservations: 'Agents maintain 40+ personal Google Docs snippets.',
      firstPrinciplesDeconstruction: [
        {
          assumption: 'LLM can answer all tier-1 tickets with 100% accuracy',
          physics: 'Hallucination rate > 0% on edge cases; unbounded questions have infinite variance',
          invariant: 'Human-in-the-loop review for high-risk topics; deterministic lookup for pricing'
        }
      ],
      riskAnalysis: 'Customer churn from hallucinated cancellation policies.',
      reframedProblem: 'Deflect 60% of tier-1 inquiries with confidence-scored grounding.',
      outOfScope: [
        'Direct automated refunds over $50 without manager approval',
        'Customer credit card updates via chat'
      ],
      controllersThreeNumbers: {
        volume: 5000,
        handleTimeMins: 12,
        hourlyWage: 28
      },
      roiAssumptions: {
        automationRatioPct: 70,
        loadedCostMultiplier: 1.3,
        productiveHoursPerMonth: 135,
        baselineErrorRatePct: 18,
        residualErrorRatePct: 2,
        reworkCostPerError: 12,
        confidenceBandPct: 20
      }
    };

    const md = buildScopeMarkdown('Acme Global Support', data);

    // Header & Archetype
    assert.ok(md.includes('# Discovery Scope Boundaries & Controller\'s ROI Summary'));
    assert.ok(md.includes('**Client Engagement**: Acme Global Support'));
    assert.ok(md.includes('**Engagement Archetype**: Support Operations Copilot (Tier 1-2 Deflection)'));

    // Section 1: O2S Discovery
    assert.ok(md.includes('## 1. Ground-Truth Discovery & Observation-to-Spec (O2S)'));
    assert.ok(md.includes('* **Delivery Standard**: ENTERPRISE'));
    assert.ok(md.includes('We need AI to answer customer support tickets in Zendesk.'));
    assert.ok(md.includes('Agents maintain 40+ personal Google Docs snippets.'));
    assert.ok(md.includes('Customer churn from hallucinated cancellation policies.'));
    assert.ok(md.includes('Deflect 60% of tier-1 inquiries with confidence-scored grounding.'));

    // Inquiry Probes checklist
    assert.ok(md.includes('### Diagnostic Gemba Inquiry Probes'));
    assert.ok(md.includes('- [x] **[Shadow IT]** What manual macros do tier-1 operators use?'));
    assert.ok(md.includes('- [x] **[Failure Mode]** What happens if a billing ticket gets wrong advice?'));

    // Invariant Gates table
    assert.ok(md.includes('### First-Principles Invariant Gates'));
    assert.ok(md.includes('| Naive Client Assumption | Fundamental Physics / Constraint | Hard Invariant |'));
    assert.ok(md.includes('| LLM can answer all tier-1 tickets with 100% accuracy | Hallucination rate > 0% on edge cases; unbounded questions have infinite variance | Human-in-the-loop review for high-risk topics; deterministic lookup for pricing |'));

    // Section 2: Boundary Locks
    assert.ok(md.includes('## 2. Dynamic Out-of-Scope Boundary Locks'));
    assert.ok(md.includes('- [x] **LOCKED**: Direct automated refunds over $50 without manager approval'));
    assert.ok(md.includes('- [x] **LOCKED**: Customer credit card updates via chat'));

    // Section 3: Controller\'s Three Numbers & Combined ROI
    assert.ok(md.includes('## 3. The Controller\'s Three Numbers (Financial ROI)'));
    assert.ok(md.includes('* **Monthly Workflow Volume**: 5,000 units/mo'));
    assert.ok(md.includes('* **Average Handle Time**: 12 mins'));
    assert.ok(md.includes('* **Operator Hourly Wage**: $28/hr'));

    // Labor capacity: 5000 * 12 / 60 = 1000 hrs. 70% = 700 hrs. 700 * (28 * 1.3 = 36.4) = $25,480 labour
    assert.ok(md.includes('* **Reclaimed Labor Capacity**: 700 hrs/mo (~5.2 FTEs)'));

    // Error reduction: 18% - 2% = 16% avoided. 5000 * 16% = 800 avoided errors * $12 = $9,600 rework
    assert.ok(md.includes('* **Baseline Error Rate**: 18%'));
    assert.ok(md.includes('* **Residual Error Rate**: 2% (-89% error reduction)'));
    assert.ok(md.includes('* **Downstream Rework Savings**: $9,600/mo (800 errors avoided @ $12/error)'));

    // Total expected: $25,480 + $9,600 = $35,080 / mo
    assert.ok(md.includes('expected $35,080/mo'));
    assert.ok(md.includes('plus $9,600/mo error rework avoided'));
  });

  test('buildScopeMarkdown handles minimal custom engagement with zero errors gracefully', () => {
    const data = {
      standard: 'speed',
      rawClientAsk: 'Automate invoice intake',
      controllersThreeNumbers: {
        volume: 1000,
        handleTimeMins: 30,
        hourlyWage: 40
      }
    };

    const md = buildScopeMarkdown('Beta Corp', data);

    assert.ok(md.includes('**Engagement Archetype**: Custom Engagement'));
    assert.ok(md.includes('* **Delivery Standard**: SPEED'));
    assert.ok(md.includes('* **Monthly Workflow Volume**: 1,000 units/mo'));
    assert.ok(!md.includes('Baseline Error Rate'));
    assert.ok(!md.includes('Downstream Rework Savings'));
    assert.ok(md.includes('- _No custom boundaries defined._'));
  });
});
