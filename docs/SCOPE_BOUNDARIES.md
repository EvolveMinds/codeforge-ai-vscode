# Discovery Scope Boundaries & Controller's ROI Summary
**Client Engagement**: Client Pilot Engagement
**Updated**: 2026-09-13T07:16:26.411Z

---

## 1. Ground-Truth Discovery & Observation-to-Spec (O2S)
* **Delivery Standard**: MEDIUM
* **Raw Client Request**: Use an LLM to automatically read bank statements and match invoices directly to general ledger entries without rules.
* **Floor Observations & Shadow IT**: • Shadow IT: Clerks maintain an offline Excel workbook ("Exceptions_2026.xlsx") on a network share to cross-check unbilled tax IDs.
• Process Reality: 28% of invoices lack exact PO line matching; staff verify vendor ABN/tax ID on government portal before ERP approval.
• Bottleneck: Average invoice takes 18 mins not because of typing, but waiting 3 days for department head email sign-off.
* **Operational Risk & Failure Modes**: LLMs perform stochastic reasoning and suffer from arithmetic hallucinations; direct auto-reconciliation without deterministic tolerance checks causes un-auditable ledger drift.
* **Agreed Production Target**: Hybrid Financial Reconciliation Engine: Deterministic SQL tolerance matching first, with LLM parsing used solely for unstructured PDF statement extraction.

---

## 2. Dynamic Out-of-Scope Boundary Locks
- [x] **LOCKED**: No un-audited ledger posting without deterministic tolerance verification
- [x] **LOCKED**: No automated currency conversions without verified FX feed timestamp
- [x] **LOCKED**: No processing of unredacted account numbers

---

## 3. The Controller's Three Numbers (Financial ROI)
* **Monthly Workflow Volume**: 5,000 units/mo
* **Average Handle Time**: 20 mins
* **Operator Hourly Wage**: $55/hr

**Estimated monthly saving: $66,753 - $100,129** (expected $83,441)

Basis: 1,167 hrs/mo reclaimed at 70% automation, costed at $55/hr x 1.3 loaded multiplier, with a +/-20% confidence band. These are estimates built on the assumptions above, not measured results.
