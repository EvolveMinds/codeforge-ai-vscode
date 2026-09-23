# Evolve AI — Outstanding Work

> Tracked follow-ups from the six-phase FDE design audit (2026-09-22), plus
> release/distribution items raised alongside it. Everything else from that
> audit shipped in v2.25.0.

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

## TODO 3 — Code-sign the Windows desktop EXE

**Status:** Not started. **Priority:** High for enterprise sales — low for the
code itself. **Raised:** 2026-09-22, deferred for v2.25.0.

### The problem

Every desktop release shipped so far is **unsigned** — verified across
2.20.0 through 2.24.0, all report `NotSigned`. Windows therefore cannot tell
whether the binary came from Evolve Mind Solutions or from someone
impersonating us, and it has no way to detect tampering after we built it.

This is unrelated to the Ed25519 licensing inside the app. That verifies
*licences*; code signing verifies *the executable* to the operating system,
before any of our code runs.

### What customers hit today

| | Unsigned (today) | Signed |
|---|---|---|
| First launch | "Windows protected your PC" SmartScreen prompt; needs *More info → Run anyway* | Runs directly |
| Publisher shown | "Unknown publisher" | "Evolve Mind Solutions Pty Ltd" |
| Corporate AV / EDR | Often quarantined | Usually passes |
| Locked-down SOE | Frequently **blocked by policy, no user override** | Allowed |
| Admin rights required | **No** | **No** |

The last row matters: the download page's claim "Standard User (No
administrator rights required)" is **unaffected** by signing and remains true.

The real exposure is our own target market. We sell to banking, defence and
air-gapped enterprise — precisely the organisations that run application
allow-listing, where an unsigned binary from an unknown publisher is silently
blocked with no "Run anyway" option. An FDE arrives on a client laptop and the
product simply will not start, and it looks like our software is broken rather
than like a policy decision.

### Options

| Option | Cost | Clears SmartScreen | Notes |
|---|---|---|---|
| **Azure Trusted Signing** | ~US$9.99/mo (~A$180/yr) | Yes | No hardware token. **Requires the business to be 3+ years old** — check the ABN registration date first, as this is much the cheapest route if we qualify. |
| **EV certificate** | ~A$600–1,200/yr | Immediately | Hardware token required |
| **OV certificate** | ~A$300–600/yr | After reputation builds (weeks) | Hardware token required |
| Self-signed | Free | **No** | Windows does not trust the issuer, so SmartScreen and allow-listing still block it. Arguably worse than unsigned: it looks solved and stops anyone revisiting it. |
| SignPath Foundation | Free | Yes | **Open-source projects only** — the Enterprise Edition is proprietary, so we do not qualify. |

There is no free option that clears SmartScreen for proprietary commercial
software. All certificates have required hardware key storage since June 2023,
so there is a physical cost floor regardless of CA.

### Interim mitigations (free, and worth doing regardless)

1. **Publish SHA-256 checksums** with every release, on the download page and
   in the GitHub release body, so a security-conscious client can verify the
   binary is exactly what we built. This is the honest substitute for a
   signature and matches the posture we already sell.
2. **Document the first-launch SmartScreen prompt** on the download page. A
   warning we predicted reads as professionalism; an unexpected one reads as
   malware.
3. **Submit the EXE to Microsoft** via the Defender submission portal as a
   false positive. Reduces AV quarantining; does not clear SmartScreen.

### Next action

Check when Evolve Mind Solutions Pty Ltd was registered. 3+ years → pursue
Azure Trusted Signing and stop looking. Under 3 years → plan for an OV/EV
certificate and rely on the mitigations above meanwhile.

---

## TODO 4 — Offline hot patch: publish the archive, and make the claims true

**Status:** **Integrity done — publishing still outstanding.** **Raised:** 2026-09-22.
**Updated:** 2026-09-23.

### Done

Verification now exists and is enforced (`src/fde/patchIntegrity.ts`):

* The generator hashes every file and digests the manifest over itself, so
  neither a file nor the file list can be altered undetected.
* The applier extracts to a **temporary** directory, verifies every file, and
  only then copies into place. Any failure refuses the patch **whole** — no
  partial application.
* Archive paths are validated before anything is written (`../`, absolute,
  drive-letter and UNC paths are rejected), because `tar -xf` follows them.
* Reported `templatesUpdated` and `enginesReloaded` are derived from the files
  actually written; both are empty on refusal.
* A pre-integrity manifest (`manifestVersion` absent or < 2) is **refused**
  rather than waved through for compatibility.
* The UI no longer claims "cryptographically signed"; it states a SHA-256
  digest, tamper-evident and not signed.

13 unit tests in `src/test/suite/fde/patchIntegrity.test.ts`, plus an
end-to-end run that built a real archive, applied it, then confirmed a
tampered, a corrupt and a wrong-version archive were each refused with zero
engines reported.

Two real bugs surfaced while testing, both fixed: the generator writes a
**zip**, but the applier used `tar -xf`, which GNU tar cannot read (it now
falls back to PowerShell's `Expand-Archive`); and files were landing at
`templates/templates/...` because the archive prefix was not stripped.

### Still outstanding

* **Publish the archive.** No patch `.zip` has ever been attached to a release.
  Until one is, the UI control has nothing to select — see `RELEASE_RUNBOOK.md`
  §5, which currently tells the next release to skip it.
* **A real signature**, if the product is to claim origin and not just
  tamper-evidence. That needs a keypair and is the same decision as TODO 3.

### The problem

Settings → Updates & Version offers **"Apply Offline Patch (.zip)"**, described
as importing *"a cryptographically signed patch archive to hot-reload dbt
templates, regex schema mappers, and transpilation engines without restarting or
re-licensing"*, aimed at *"banking, defense, and high-assurance enclaves"*.

Two things are wrong with that today.

**1. The archive has never been published.** Every GitHub release on both
`codeforge-ai-vscode` and `evolve-ai-enterprise` contains exactly one asset: the
portable `.exe`. No patch `.zip` has ever been attached, for any version. The
only one that exists is `dist-desktop/evolve-ai-enterprise-patch-2.24.0.zip` on
a build machine, and `dist-desktop/` is gitignored. A customer clicking the
button has no file to select.

**2. Nothing is signed, and nothing is verified.** `scripts/create-offline-patch.js`
contains no signing, hashing or checksum code at all. Its `manifest.json` carries
descriptive metadata (`patchId`, `baseVersion`, `publisher`, a template list) but
no digest and no signature. `DesktopUpdater.applyOfflinePatch()`
(`src/desktop/main/updater.ts`) then runs `tar -xf` on whatever file it is handed
and verifies nothing.

The applier also reports results it did not produce:

| Reported | Reality |
|---|---|
| `enginesReloaded: [6 engine names]` | A hardcoded array in the applier, returned unconditionally. No engine is reloaded — the running process is untouched. |
| `templatesUpdated` | Defaults to `12`; only corrected if the manifest happens to list files. |
| `patchedVersion` | Derived from the archive's **mtime** when no manifest is found. |
| `success: true` | The extraction is wrapped in `catch {}`, so a failed `tar` still returns success with the full "reloaded" list. |

So a customer in an air-gapped enclave can hand it an arbitrary zip — or a
corrupt one — and be told six engines reloaded successfully. For the audience
this feature names, that is the least acceptable place to overstate.

### What is required

1. **Real integrity.** Add a SHA-256 per file plus a manifest digest at build
   time, and verify both before extracting. If the product is to claim
   *signed*, it needs a keypair and a real signature — the same distinction
   drawn for audit receipts in v2.25.0: a digest is tamper-evident, a signature
   proves origin. Until a keypair exists, the UI must say digest, not signed.
2. **Refuse bad input.** Validate the manifest, check `baseVersion` against the
   running version, reject path traversal in archive entries (`../`), and fail
   loudly rather than inside `catch {}`.
3. **Report what actually happened.** Return the files genuinely written and the
   engines genuinely reloaded. If hot-reload is not implemented, say the patch
   applies on restart rather than naming six engines that were not touched.
4. **Publish the archive** as a release asset alongside the `.exe`, with its
   SHA-256 in the release notes and on the download page, the same way the
   executable is handled.

### Acceptance

- A tampered archive is **rejected**, not extracted.
- A corrupt or unreadable archive reports failure, not success.
- The applier's reported file and engine counts match what changed on disk.
- `evolve-ai-enterprise-patch-<version>.zip` is attached to the release and
  listed on the download page with its checksum.
- The UI wording matches what the code actually does.

### Interim

Until the above is done, **hide the Apply Offline Patch control**. An advertised
feature with no artifact and unverified claims is worse than an absent one — the
same reasoning that drove the v2.25.0 honesty pass.

---

## TODO 5 — Rebuild and replace the v2.25.0 desktop asset

**Status:** Not started. **Priority:** Low — cosmetic for packaged builds, but
worth folding into the next release. **Raised:** 2026-09-22.

### The problem

The published `evolve-ai-enterprise-portable-2.25.0-win32-x64.exe` was built
just before the fix for Electron's version leaking through as the app version
(`main.ts` asked `app.getVersion()` first, and Electron returns *its own*
version when the app has none of its own).

In a **packaged** build `app.getVersion()` reads the bundled `package.json`
correctly, so the shipped artifact does report `2.25.0`. The defect only shows
when the desktop entry is run directly, e.g.

```
npx electron <path>/out/desktop/main/main.js <workspace>
```

which is a developer path, not a customer one. That is why the asset was left
in place rather than pulled.

### Why it still matters

The update check compares the resolved version against the release registry. In
any situation where the leak occurs, the app compares an Electron version such
as `44.4.3` against real releases, concludes it is ahead of everything, and
reports *"Up to date"* — so it would **never** tell that user an update exists.
The packaged build is not believed to be affected, but the failure mode is
silent, which is reason enough not to leave a known-stale binary published
indefinitely.

### What is required

Rebuild from a commit that includes the fix (`a35954c` or later) and replace the
asset on both releases, or supersede it with the next version. If replacing in
place, the SHA-256 changes — so the release notes, the download page and
`releaseHistory` in the website's `src/content/site.ts` all need the new hash.

### Acceptance

- The published binary is built from a commit containing the version fix.
- Its SHA-256 matches what the download page and release notes state.
- `getAppVersion()` in the packaged app returns the package version under an
  Electron runtime of a different major.

---

## Notes for whoever picks these up

- `src/fde/provenance.ts` is the contract for anything client-facing.
  `renderMeasured()` has no default-value parameter on purpose — a `|| 98.0`
  fallback is what let unmeasured metrics reach signed documents. Do not add one.
- `evals.benchmarkExecuted` is the gate for TODO 1. Nothing else should decide
  whether a reliability figure may be printed.
- The DEMO/LIVE switch defaults to DEMO everywhere, including for state files
  written before it existed. Keep that default when adding new document output.
