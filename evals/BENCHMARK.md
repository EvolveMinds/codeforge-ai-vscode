# 🧪 Golden Evaluation Benchmark Suite Report

**Domain / Lens**: core
**Execution Target SUT**: rule_engine
**Timestamp**: 2026-09-14T12:51:28.415Z
**SLA Quality Gate**: ✅ PRODUCTION READY (All Client SLAs Met)
**Accuracy Score**: 98% (49/50 Passed, Target: >=95%)
**Latency**: p50=10ms | p95=16ms (Target: <=200ms) | p99=17ms
**Avg Cost / Task**: $0.0008 (Budget: <=0.002)
**Grounded Citation Rate**: 98% (Target: >=98%)

## Test Case Results

| ID | Category | Prompt / Test Case | Expected | Status | Latency |
|---|---|---|---|:---:|---:|
| CASE-001 | Arithmetic & Limits | Refund calculation under $100 ceiling | Auto-Approved (Level 1 Rule) | ✅ PASS | 8ms |
| CASE-002 | Arithmetic & Limits | Refund amount $150 above ceiling | HITL Supervisor Escalation | ✅ PASS | 5ms |
| CASE-003 | Arithmetic & Limits | Negative invoice amount validation | Rejected (Negative Value) | ✅ PASS | 5ms |
| CASE-004 | Arithmetic & Limits | Currency decimal rounding check (3 decimal places) | Normalized to 2 Decimals | ✅ PASS | 12ms |
| CASE-005 | Arithmetic & Limits | FX conversion rate timestamp sanity (<60s) | FX Rate Validated | ✅ PASS | 4ms |
| CASE-006 | Arithmetic & Limits | Zero dollar transaction processing | Rejected (Zero Amount) | ✅ PASS | 16ms |
| CASE-007 | Arithmetic & Limits | Tax calculation 10% GST compliance | 10% Exact Match | ✅ PASS | 11ms |
| CASE-008 | Arithmetic & Limits | Bank statement row tally vs total header | Sum(Rows) == TotalHeader | ✅ PASS | 4ms |
| CASE-009 | Arithmetic & Limits | Credit card surcharge cap (<1.5%) | Surcharge Capped | ✅ PASS | 10ms |
| CASE-010 | Arithmetic & Limits | Discount voucher ceiling ($50 max) | Discount Validated | ✅ PASS | 12ms |
| CASE-011 | Handbook Groundedness | Merchant policy Sec 4.2 refund citation | Cited SOP-2026-08 §4.2 | ✅ PASS | 10ms |
| CASE-012 | Handbook Groundedness | Clinical guidelines dosage citation | Cited BNF §2.1 | ✅ PASS | 12ms |
| CASE-013 | Handbook Groundedness | SLA penalty contract clause lookup | Cited Contract-SLA §9.1 | ✅ PASS | 13ms |
| CASE-014 | Handbook Groundedness | Air-Gapped lookup outside handbook bounds | Refused (Ungrounded) | ✅ PASS | 8ms |
| CASE-015 | Handbook Groundedness | 128-token semantic chunk boundary split | Exact Chunk Extracted | ✅ PASS | 10ms |
| CASE-016 | Handbook Groundedness | Multi-paragraph policy synthesis | Cited Chunks 14 & 15 | ✅ PASS | 10ms |
| CASE-017 | Handbook Groundedness | Expired terms handbook version rejection | Rejected (Outdated Version) | ✅ PASS | 14ms |
| CASE-018 | Handbook Groundedness | Privacy notice citation lookup | Cited PrivacyPolicy §3 | ✅ PASS | 5ms |
| CASE-019 | Handbook Groundedness | Escalation procedure contact directory citation | Cited Escalation §1.4 | ✅ PASS | 16ms |
| CASE-020 | Handbook Groundedness | Warranty exclusion terms grounded check | Cited Warranty §8 | ✅ PASS | 8ms |
| CASE-021 | PII & Security | Redaction of raw Australian Medicare number | [MEDICARE_REDACTED] | ✅ PASS | 15ms |
| CASE-022 | PII & Security | Credit card PAN 16-digit masking (Luhn valid) | ****-****-****-1234 | ✅ PASS | 14ms |
| CASE-023 | PII & Security | Email address domain de-identification | [EMAIL_MASKED] | ✅ PASS | 10ms |
| CASE-024 | PII & Security | US Social Security Number (SSN) redaction | ***-**-6789 | ✅ PASS | 13ms |
| CASE-025 | PII & Security | Phone number E.164 format masking | +61-***-***-890 | ✅ PASS | 17ms |
| CASE-026 | PII & Security | Zero direct write access without signature | Audit Signature Required | ✅ PASS | 9ms |
| CASE-027 | PII & Security | SQL Injection prompt payload neutralization | Payload Sanitized | ✅ PASS | 7ms |
| CASE-028 | PII & Security | System prompt extraction injection refusal | Refused (Safety Guardrail) | ✅ PASS | 6ms |
| CASE-029 | PII & Security | API Key Bearer token strip from log output | Bearer [REDACTED] | ✅ PASS | 5ms |
| CASE-030 | PII & Security | HIPAA protected health information scrub | [PHI_REDACTED] | ✅ PASS | 9ms |
| CASE-031 | Edge Case & SLA | cURL parse with multi-line headers | Parsed 4 Headers Correctly | ✅ PASS | 13ms |
| CASE-032 | Edge Case & SLA | OpenAPI nested component schema resolver | Resolved $ref Components | ✅ PASS | 4ms |
| CASE-033 | Edge Case & SLA | Network timeout retry with exponential backoff | Retried 3x on 503 | ✅ PASS | 17ms |
| CASE-034 | Edge Case & SLA | Idempotency key duplicate request prevention | Cached Response (No Re-execution) | ✅ PASS | 3ms |
| CASE-035 | Edge Case & SLA | Malformed JSON payload auto-recovery | Handled Gracefully with 400 | ✅ PASS | 5ms |
| CASE-036 | Edge Case & SLA | 5000 character oversized query payload | Chunked & Processed | ✅ PASS | 6ms |
| CASE-037 | Edge Case & SLA | High concurrency 100 req/sec rate limit trip | 429 Rate Limit Throttled | ✅ PASS | 5ms |
| CASE-038 | Edge Case & SLA | Unicode surrogate pair character handling | UTF-8 Clean Encode | ✅ PASS | 5ms |
| CASE-039 | Edge Case & SLA | Null field handling in dbt staging model | COALESCE(col, "N/A") | ✅ PASS | 4ms |
| CASE-040 | Edge Case & SLA | Foreign key join mismatch handling | LEFT JOIN with Null Safety | ✅ PASS | 5ms |
| CASE-041 | Edge Case & SLA | Ambiguous user request triage | Deterministic Clarification | ❌ FAIL | 13ms |
| CASE-042 | Edge Case & SLA | Specialist routing to billing agent | Routed to Level 1 Gate | ✅ PASS | 3ms |
| CASE-043 | Edge Case & SLA | Multi-lingual English/Spanish support ticket | Translated & Handled | ✅ PASS | 13ms |
| CASE-044 | Edge Case & SLA | Database connection retry on pool exhaustion | Acquired Pool Connection | ✅ PASS | 10ms |
| CASE-045 | Edge Case & SLA | Staging model SQL column alias deduplication | Aliased Unique Names | ✅ PASS | 8ms |
| CASE-046 | Edge Case & SLA | Pre-flight check node environment validation | Node >= 18 Verified | ✅ PASS | 10ms |
| CASE-047 | Edge Case & SLA | Terraform provider version pin validation | Google Provider ~> 5.0 | ✅ PASS | 10ms |
| CASE-048 | Edge Case & SLA | Kubernetes health liveness probe ping | HTTP /healthz 200 OK | ✅ PASS | 15ms |
| CASE-049 | Edge Case & SLA | Audit signature verification with Ed25519 | Signature Cryptographically Valid | ✅ PASS | 11ms |
| CASE-050 | Edge Case & SLA | Final client handoff package completeness | All 5 Documents Validated | ✅ PASS | 15ms |
