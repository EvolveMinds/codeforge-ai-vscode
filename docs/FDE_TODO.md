# FDE Delivery Studio — Outstanding Work

> Tracked follow-ups from the six-phase design audit (2026-09-22).
> Everything else from that audit is implemented on `fix/fde-honest-mode`.

---

## TODO 1 — Real benchmark execution engine

**Status:** Not started. **Priority:** High — this is the largest remaining gap.

### The problem

Section 4A's "Run Benchmark Suite" does not execute the system under test. Every
target branch in `RUN_GOLDEN_BENCHMARK` (`src/desktop/main/ipcHandlers.ts`)
derives its verdict from the input case's own `status` field:

| Target | What it does today |
|---|---|
| `llm_*` | Comment claims it "probes Ollama". It does not. `pass = (case.status !== 'FAILED')`, `actualOutput` echoes `expectedOutput`, latency was `Math.random()`. |
| `rest_api` | Sends a liveness `GET`, then never submits a case to the endpoint. |
| `workspace_script` | Checks `fs.existsSync`, then never spawns the script. |
| `rule_engine` | The only branch doing real work — `prompt.includes(...)` over ~10 literals. Anything unmatched passes trivially. |

Cases therefore pass by construction, and the resulting accuracy figure
described nothing.

### What has been done (interim)

The fabrication can no longer reach a client document. These paths now set
`simulated: true` with a reason, null the invented latency/cost, and return
`benchmarkExecuted: false`. `BENCHMARK.md` leads with a CAUTION block and
reports the SLA gate as NOT ASSESSED. `runbookGenerator` keys every reliability
metric off `evals.benchmarkExecuted`, so an unexecuted benchmark renders
`⚠️ NOT YET MEASURED` rather than `98.0%`.

**This is containment, not a fix. The benchmark still tests nothing.**

### What is required

1. **An execution adapter per target type**, behind one interface:
   `execute(case, targetConfig) → { actualOutput, latencyMs, tokensUsed, costUsd }`.
   - `llm_ollama` — POST `/api/generate` against `ollamaHost`, honouring
     `num_ctx` (see the note in `CLAUDE.md` about silent front-truncation).
   - `llm_openai` / `llm_anthropic` / `llm_gemini` — reuse the provider paths in
     `core/aiService.ts` rather than writing new HTTP clients.
   - `rest_api` — POST each case to `endpointUrl`, honour `numTargetTimeout`
     (currently only used by the connection ping).
   - `workspace_script` — spawn via `core/processUtil.ts` with a timeout, pass
     the case on stdin, read stdout.
2. **A comparison strategy.** Exact string match is too brittle for LLM output.
   Needs at least: exact, contains, regex, and a numeric-tolerance mode. Make it
   per-case (`matchMode` on the case), because a SQL rule case and a summarisation
   case cannot share one rule.
3. **Real latency and cost.** Measure with `process.hrtime`; derive cost from the
   provider's token counts, not a constant.
4. **Concurrency and failure isolation.** 50 sequential LLM calls is minutes.
   Bounded parallelism, and one case erroring must not abort the run.
5. **Set `benchmarkExecuted: true` only on a genuine run** — that flag is what
   permits a number to appear in a client document.

### Acceptance

- A deliberately wrong expected-output case **fails**.
- Unplugging the target produces errors, not passes.
- `evals/golden_benchmark_report.json` carries real per-case latency.
- The architecture doc quotes the measured figure.

---

## TODO 2 — Webhook Ingest Studio

**Status:** Not started. **Priority:** Medium — currently advertised but absent.

### The problem

Section 2B is titled **"Resilient Client API & Webhook Ingest Studio"**
(`src/desktop/renderer/index.html`) and the step rail says "Client API &
**Webhooks**". There is no webhook functionality anywhere in the markup or the
handlers — no receiver, no signature verification, no replay buffer, no
idempotency handling. The section is entirely outbound-connector tooling.

This is a promise the product does not keep. Either build it or retitle the
section; leaving it as-is means an FDE can look for it in front of a client.

### What is required

A webhook is an *inbound* endpoint the client's system calls, which is a
different shape from the outbound SDK generator already there.

1. **Receiver scaffolding** — generate an endpoint (Express/FastAPI/Cloud
   Function) from a pasted sample payload, inferring a typed schema the way
   `parseCurlCommand` infers one from a cURL string.
2. **Signature verification** per provider convention — Stripe (`t=`/`v1=` HMAC
   over a timestamped body), GitHub (`X-Hub-Signature-256`), Slack, and a generic
   HMAC-SHA256 mode. This is the part most often got wrong by hand, so it is the
   part most worth generating. Must be constant-time comparison.
3. **Replay protection** — reject stale timestamps outside a tolerance window,
   and keep a short-lived seen-ID set.
4. **Idempotency** — dedupe on the provider's event ID so a redelivery does not
   double-apply. The section description already claims "idempotency headers".
5. **A local test harness** — replay a captured payload at the generated
   endpoint, including a deliberately bad signature, so the FDE can demonstrate
   that rejection works.

### Acceptance

- Paste a Stripe/GitHub sample → get a receiver that verifies real signatures.
- A tampered payload is rejected; a valid one is accepted.
- A redelivered event is processed once.
- The generated code carries its own tests.

### Cheaper alternative

If this is not wanted soon, retitle Section 2B to "Resilient Client API Studio"
and drop "Webhooks" from the step label. Removing the claim is a ten-minute
change and is more honest than leaving it unbuilt.

---

## Notes for whoever picks these up

- `src/fde/provenance.ts` is the contract for anything client-facing.
  `renderMeasured()` has no default-value parameter on purpose — a `|| 98.0`
  fallback is what let unmeasured metrics reach signed documents. Do not add one.
- `evals.benchmarkExecuted` is the gate for TODO 1. Nothing else should decide
  whether a reliability figure may be printed.
- The DEMO/LIVE switch defaults to DEMO everywhere, including for state files
  written before it existed. Keep that default when adding new document output.
