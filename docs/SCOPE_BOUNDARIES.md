# Discovery Scope Boundaries & Controller's ROI Summary
**Client Engagement**: Client Pilot Engagement
**Engagement Archetype**: Custom Engagement
**Project Delivery Nature**: 🌱 Greenfield (Net-New Application from Scratch — Single Canonical State)
**Updated**: 2026-10-20T09:25:24.076Z

---

## 1. Ground-Truth Discovery & Observation-to-Spec (O2S)
* **Delivery Standard**: SIMPLE
* **Raw Client Request**: Pending user input
* **Floor Observations & Shadow IT**: Direct operator shadow IT and manual workarounds
* **Operational Risk & Failure Modes**: Pending risk analysis
* **Agreed Production Target**: Pending reframed goal

### Diagnostic Gemba Inquiry Probes
- [x] **[Shadow IT]** What offline spreadsheets, sticky notes, or WhatsApp chats are consulted before approval?
- [x] **[Failure Mode]** If an edge-case transaction executes incorrectly, what is the recovery SLA and legal blast radius?
- [x] **[Exception Iceberg]** What percentage of tasks deviate from standard process and who resolves them?
- [x] **[Regulatory Gate]** Is cryptographic audit logging or multi-party authorization legally required?

### First-Principles Invariant Gates
| Naive Client Assumption | Fundamental Physics / Constraint | Hard Invariant |
| :--- | :--- | :--- |
| AI can calculate decimal currency amounts and balances | LLMs are probabilistic token predictors, mathematically incapable of guaranteed decimal arithmetic | Zero LLM arithmetic: all calculations executed in compiled SQL tolerance models (<5ms) |
| Autonomous transaction mutations can proceed without review | Direct external API writes without authorization violate statutory compliance and create liability | Autonomous payouts locked; transactions route to Human-in-the-Loop Controller approval |

---

## 2. Dynamic Out-of-Scope Boundary Locks
- [x] **LOCKED**: No automated write access to production database without explicit audit log
- [x] **LOCKED**: No external customer email dispatch without human supervisor gate
- [x] **LOCKED**: No processing of unredacted PII (must enforce masking stage)
- [x] **LOCKED**: No ungrounded responses (must cite verified documents)

---

## 3. The Controller's Three Numbers (Financial ROI)
* **Monthly Workflow Volume**: 0 units/mo
* **Average Handle Time**: 0 mins
* **Operator Hourly Wage**: $0/hr
* **Reclaimed Labor Capacity**: 0 hrs/mo (~0.0 FTEs)

**Estimated monthly saving: $0 - $0** (expected $0/mo / $0/yr)

Basis: 0 hrs/mo reclaimed at 70% automation, costed at $0/hr x 1.3 loaded multiplier ($0.00/hr loaded), with a +/-20% confidence band. These are estimates built on the assumptions above, not measured results.
