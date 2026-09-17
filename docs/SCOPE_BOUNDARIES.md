# Discovery Scope Boundaries & Controller's ROI Summary
**Client Engagement**: Client Pilot Engagement
**Engagement Archetype**: Support Operations Copilot (Tier 1-2 Deflection)
**Updated**: 2026-09-16T10:05:25.566Z

---

## 1. Ground-Truth Discovery & Observation-to-Spec (O2S)
* **Delivery Standard**: MEDIUM
* **Raw Client Request**: Build an AI that automates all customer support tickets and refunds so we do not need human agents.
* **Floor Observations & Shadow IT**: • Shadow IT: Agents keep 40+ personal text snippets in Notepad and message colleagues in Slack for policy interpretations.
• Process Reality: 65% of tickets are repetitive status queries ("Where is my order?"), while agents spend 12 mins researching complex exceptions.
• Risk Observed: Customers frequently paste aggressive prompts attempting to trigger auto-replies with discount codes.
* **Operational Risk & Failure Modes**: Full automation of refunds introduces critical financial exploit vectors and chargeback fraud. Unbounded generation without human gates risks compliance breach and brand reputation.
* **Agreed Production Target**: Tier-1 Operations Co-Pilot: Auto-triage, SQL customer lookup, and grounded draft generation with Human-in-the-Loop (HITL) approval gate before dispatch.

### Diagnostic Gemba Inquiry Probes
- [x] **[Failure Mode]** How do you prevent adversarial customers from using prompt injection to extract refunds or concessions?
- [x] **[Shadow IT]** What undocumented canned responses, macro shortcuts, or team Slack channels do support agents rely on?
- [x] **[Exception Iceberg]** What fraction of incoming tickets are simple status queries vs complex billing disputes?
- [x] **[Regulatory Gate]** Who has authority to grant SLA credits or policy exceptions, and what threshold requires supervisor sign-off?

### First-Principles Invariant Gates
| Naive Client Assumption | Fundamental Physics / Constraint | Hard Invariant |
| :--- | :--- | :--- |
| LLM can read emails and autonomously send replies to customers | Untrusted user input can contain prompt injection attacks and hallucinate legally binding promises | Zero autonomous dispatch: human agent 1-click confirmation required for all customer communications |
| Use large LLM for every inbound ticket triage | Large LLMs incur 1500ms latency and high compute cost for trivial status lookups | Sub-30ms deterministic intent router; routine status routed to compiled DB lookup (<10ms) |
| Copilot can draft answers from open web or arbitrary training weights | Generates outdated return policies and incorrect SLA commitments | Strict grounding: copilot answers only from versioned, approved support knowledge base |

---

## 2. Dynamic Out-of-Scope Boundary Locks
- [x] **LOCKED**: No automated refunds > $100 without Human-in-the-Loop gate
- [x] **LOCKED**: No direct external customer email dispatch in pilot phase
- [x] **LOCKED**: No DB write access without cryptographically signed audit logging
- [x] **LOCKED**: No ungrounded responses (must cite handbook)

---

## 3. The Controller's Three Numbers (Financial ROI)
* **Monthly Workflow Volume**: 10,000 units/mo
* **Average Handle Time**: 15 mins
* **Operator Hourly Wage**: $35/hr
* **Reclaimed Labor Capacity**: 1,750 hrs/mo (~13.0 FTEs)

**Estimated monthly saving: $63,700 - $95,550** (expected $79,625/mo / $955,500/yr)

Basis: 1,750 hrs/mo reclaimed at 70% automation, costed at $35/hr x 1.3 loaded multiplier ($45.50/hr loaded), with a +/-20% confidence band. These are estimates built on the assumptions above, not measured results.
