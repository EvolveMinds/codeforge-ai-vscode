# Discovery Scope Boundaries & Controller's ROI Summary
**Client Engagement**: Client Pilot Engagement
**Engagement Archetype**: Custom Engagement
**Project Delivery Nature**: 🌱 Greenfield (Net-New Application from Scratch — Single Canonical State)
**Updated**: 2026-10-06T08:37:08.822Z

---

## 1. Ground-Truth Discovery & Observation-to-Spec (O2S)
* **Delivery Standard**: SIMPLE
* **Raw Client Request**: Pending user input
* **Floor Observations & Shadow IT**: Direct operator shadow IT and manual workarounds
* **Operational Risk & Failure Modes**: Pending risk analysis
* **Agreed Production Target**: Pending reframed goal

### Diagnostic Gemba Inquiry Probes
- [x] **[Shadow IT]** What manual workarounds, personal spreadsheets, or unofficial channels bypass the official system?
- [x] **[Failure Mode]** What is the absolute worst-case outcome if this automated workflow executes incorrect actions?
- [x] **[Exception Iceberg]** What proportion of inputs do not follow the declared standard process, and who handles them today?
- [x] **[Regulatory Gate]** What compliance frameworks, audit log requirements, or legal constraints govern this workflow?

### First-Principles Invariant Gates
| Naive Client Assumption | Fundamental Physics / Constraint | Hard Invariant |
| :--- | :--- | :--- |
| Full autonomous automation can replace human operators on Day 1 | Edge-case entropy and real-world variance make unconstrained end-to-end automation brittle | Deterministic core for repeatable rules + Human-in-the-Loop approval gate for variance exceptions |
| Probabilistic AI outputs can directly mutate operational databases | AI hallucination rate > 0% creates creeping data corruption without cryptographically verified provenance | Zero direct database writes from generative models without schema validation and signed audit trails |

---

## 2. Dynamic Out-of-Scope Boundary Locks
- [x] **LOCKED**: No direct production write access without cryptographically signed audit log
- [x] **LOCKED**: No ungrounded responses or unverified external API mutations

---

## 3. The Controller's Three Numbers (Financial ROI)
* **Monthly Workflow Volume**: 11,600 units/mo
* **Average Handle Time**: 14 mins
* **Operator Hourly Wage**: $22/hr
* **Reclaimed Labor Capacity**: 1,895 hrs/mo (~14.0 FTEs)

**Estimated monthly saving: $43,358 - $65,036** (expected $54,197/mo / $650,364/yr)

Basis: 1,895 hrs/mo reclaimed at 70% automation, costed at $22/hr x 1.3 loaded multiplier ($28.60/hr loaded), with a +/-20% confidence band. These are estimates built on the assumptions above, not measured results.
