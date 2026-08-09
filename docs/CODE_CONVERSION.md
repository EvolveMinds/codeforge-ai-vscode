# Code Converter

> Convert code into another language — a selection, a file, or a folder — and see the result beside
> the original with an honest account of what was translated exactly, what was approximated, and
> what still needs a human.
>
> Introduced in **v2.12.0**.

---

## Why this isn't just a prompt

Asking any AI to "convert this to Go" is easy and the answer usually looks right. That's the
problem. The failure mode is not gibberish, it's *plausible*: the retry loop quietly disappears, a
`Decimal` becomes a `float64`, a library call is replaced by a function that doesn't exist, and
nothing in the output tells you which lines to distrust.

The Code Converter is built around that failure mode:

| The risk | What the converter does |
|---|---|
| Output looks fine, behaviour differs | Every conversion returns a **fidelity report**: what mapped 1:1, what was approximated, what a human must fix |
| Files converted one by one drift apart | A folder is converted **as one unit**, so shared types and cross-file calls stay consistent |
| Invented library APIs | The prompt states the **dependency policy** and requires every package to be listed and justified |
| Transliterated, not idiomatic | Each target language carries its own **idioms and known conversion traps** into the prompt |
| Broken code you find out about later | **Checks its own output** with the target language's parser, and feeds failures back for repair |
| Rejected attempts litter the repo | **Nothing is written to disk** until you approve the review |
| The model silently sees only half your code | The job is **sized against the model's real context window** before it runs, and the request carries an explicit window so nothing is silently truncated |
| Too big for the model you have | It **splits into passes** — and tells you which model would do it in one |

---

## Getting started

Four ways in — they all end at the same review:

| Route | Best for |
|---|---|
| Chat panel → mode pill → **Code Convertor** | The full panel: pick source, target, and how faithful |
| Right-click a selection → **Evolve AI ▸ Convert Selection…** | A single function or block |
| Right-click a file in the Explorer → **Convert This File…** | One file, target chosen from a quick pick |
| Right-click a folder in the Explorer → **Convert Folder / Project…** | A module or a small project |

Or the Command Palette: `Evolve AI: Convert Code to Another Language`.

---

## Step 1 — What to convert

The panel takes source from wherever it actually is:

- **The active file** — whatever is open right now
- **The selected code** — just the highlighted lines
- **Choose files…** — one or many, from anywhere on disk. Converted together.
- **Choose a folder…** — walked recursively, skipping `node_modules`, `.git`, `venv`, build output
  and friends, capped by `aiForge.convert.maxFiles` (default 20)

A folder conversion keeps only the **dominant language** it finds. A stray `deploy.sh` sitting next
to forty Python files would otherwise just confuse the model about what it is porting.

Queued files are listed with their detected language and line count; remove any of them with `×`.

## Step 2 — Convert to

A searchable grid of 26 languages, grouped by how they're normally used. Type to filter, press Enter
to take the first match.

**Popular** Python · TypeScript · JavaScript
**Systems** Go · Rust · C++ · C · Swift
**JVM / .NET** Java · C# · Kotlin · Scala
**Web** PHP · Dart
**Data & Science** R · SQL · MATLAB
**Scripting** Ruby · Bash · PowerShell · Lua · Elixir
**Legacy** Perl · VBA · COBOL · SAS

There's also an optional **framework / runtime** box — `FastAPI`, `.NET 8`, `Spring Boot`,
`React` — for when the target language alone doesn't pin down what you want.

## Step 3 — How faithful

| Choice | What you get | Use when |
|---|---|---|
| **Idiomatic** *(default)* | Restructured so it reads like native code in the target language. Behaviour identical. | Most of the time |
| **Line-by-line** | Original structure, ordering and names preserved (adjusted only for naming convention). Clumsier, but diffable against the source. | The conversion has to be **auditable** — regulated code, or a port someone else must sign off |
| **Idiomatic + modernise** | Idiomatic, plus dated patterns upgraded: real types, async where the work is I/O-bound, current stdlib APIs. Every change beyond the language is logged as a note. | Porting old code you also want improved |

## Step 4 — Dependencies

| Choice | Meaning |
|---|---|
| **Standard library only** | No third-party packages. More code, nothing to install or audit. |
| **Well-known packages** *(default)* | What an experienced developer in that ecosystem would reach for. Every one listed in the report. |
| **Closest equivalent to each source library** | One-for-one mapping from the source's dependencies, with the differences spelled out. |

Plus three toggles: **generate tests** (in the target's usual framework), **carry comments across**
(rewritten in the target's doc style, not copy-pasted), and **emit the dependency manifest**
(`go.mod`, `package.json`, `requirements.txt`, …).

The free-text box takes anything else that must hold: *"keep the CLI flags identical"*, *"must run
on Java 11"*, *"no external HTTP client"*.

---

## Step 5 — The AI model

Conversion is a demanding job with a different shape from chat: a long prompt, a long response, and
a strict output format. So it gets **its own model choice**, separate from the model the rest of the
extension uses. Pick a big model for a port without changing what your chat runs on, and without
having to change it back afterwards.

**Change model…** lists what you can actually reach, annotated with what it can actually do:

```
  ⚙ Use my default                    Ollama (local) · qwen2.5-coder:7b
─── Installed locally (Ollama) ───
  ✓ qwen2.5-coder:32b                 32k context · Strong at code
      Handles this job in one pass
  ⚠ llama3.2:1b                       8k context · Weak — expect problems
      Too small for this job — it would be split into slices
─── Cloud ───
  ☁ Anthropic Claude                  claude-sonnet-4-6 · 200k context
      Handles this job in one pass — sends your source to the cloud
```

The context figures for local models are **queried from Ollama itself** (`/api/show`), not guessed
from the name — the panel labels each figure `detected`, `known` or `assumed` so you can see which
numbers are real. Your choice lasts for the session; **Use my default** returns to the global setting.

Also available from the palette: `Evolve AI: Choose AI Model for Code Conversion`.

### The fit check

Under the model line sits a live verdict for whatever you have queued:

| Verdict | Meaning |
|---|---|
| 🟢 **Fits comfortably** | One pass, with room to spare |
| 🟡 **Fits, but only just** | One pass, close to the limit. If the result looks truncated, use fewer files or a bigger model |
| 🟡 **Too big for one pass** | It will be split. Says how many passes and what forced it — context window or response length |
| 🔴 **Cannot do this job** | The window leaves no usable room. It won't start; it offers alternatives instead |

The important part is *what* gets measured. A context window is shared between the prompt and the
response, and a conversion's response is roughly the size of its input — so fitting the prompt alone
is not enough. That's exactly how you get a reply that stops mid-file. The check reserves room for
the response before deciding, and errs toward overestimating it.

When something doesn't fit you get concrete options, not a shrug — models you already have installed
that are big enough, the `ollama pull` command for one that would work, or the cloud.

### Splitting: how a job too big for one pass is handled

Two different problems get two different answers.

**Many files** are grouped into batches that each fit the window. Later batches are told what earlier
ones produced, so names and types stay consistent.

**One file too big for any single pass** is *sliced*. Slicing cuts at real top-level boundaries — a
declaration at column zero after a blank line — never at an arbitrary line, because half a function
isn't convertible. Then:

- Part 1 emits the file preamble (package declaration, imports); later parts are explicitly told not
  to, so the rejoined file doesn't end up with three import blocks
- Each part receives the **declarations already generated**, so part 3 reuses `OrderService` instead
  of inventing `OrderSvc`
- Parts are stitched back into one file in order
- The conversion report gets a warning naming every file that was rejoined, and telling you to check
  the seams

Slicing is a compromise and the tool says so. Each pass sees less of the whole, so cross-file
consistency is weaker than a single pass. If a bigger model is available, it is the better answer —
which is why you're offered one before the split starts.

## The review

This is where the conversion is actually judged. It opens automatically and **nothing has been
written to disk yet**.

```
┌─────────────────────────────┬─────────────────────────────┐
│ Original                    │ Converted                   │
│ order_service.py            │ order_service.go   ✓ parses │
│                             │                             │
│  1  def process(order):     │  1  func Process(o Order)   │
│  2      try:                │  2      if err := v(o); ... │
│ …                           │ …                           │
└─────────────────────────────┴─────────────────────────────┘
  [ Refine in plain language…            ] [Apply]
  Save all files…   Check it parses   ↶ Undo last change
```

- **Tabs** across the top — one per converted file, plus **Report**. A dot on a tab shows its check
  result: green parses, red doesn't, grey already saved.
- **Converted only** collapses the split view when the panel is narrow.
- **Save this file** / **Copy** act on the tab you're looking at.

### The Report tab

- **Needs a human** — things that *will* be wrong until you intervene
- **Check these** — semantics that differ subtly: numeric precision, ordering, concurrency, error
  behaviour, timezones
- **Decisions made** — deliberate structural choices worth knowing about
- **Dependencies** — source package → target package, and whether it was mapped, approximated, or
  has no equivalent
- **Manual steps** and **Getting it running** — what code can't do for you, and the commands to build
  and run the result

A header badge shows the model's own confidence. If a conversion comes back with no report at all,
that is itself reported as a warning — a missing report is never quietly filled in with optimism.

### Refining

Say what you want changed in plain language:

> *"return errors instead of panicking, and drop the third-party HTTP client"*

Only the affected files are re-emitted; everything else is preserved. Every round is snapshotted, so
**Undo last change** always works. One-click chips cover the usual asks — add error handling, make
it more idiomatic, stdlib only, add doc comments, address every action item in the report.

### Checking it parses

**Check it parses** runs the target language's own tooling over each converted file, when that
toolchain is installed:

| | |
|---|---|
| Parse-only (a failure is always a real defect) | Python `py_compile` · JavaScript `node --check` · Go `gofmt -e` · Ruby `ruby -c` · PHP `php -l` · Bash `bash -n` · Lua `luac -p` · R `parse()` · Swift `swiftc -parse` |
| Also resolves imports (a failure may just be a missing local package) | TypeScript `tsc --noEmit` · Java `javac` · C `gcc -fsyntax-only` · C++ `g++ -fsyntax-only` · Dart `dart analyze` · Perl `perl -c` |

The distinction matters, and the messages respect it: an unresolved import from `javac` usually
means the dependency isn't installed on *your* machine, not that the conversion is wrong.

If the toolchain isn't on your PATH, you're told which one would enable the check — nothing fails
silently. Languages without a sound single-file check say so rather than inventing a verdict. (Rust
is deliberately unchecked: `rustfmt --check` fails on valid-but-unformatted code, which would flag
almost every conversion. `cargo check` on the saved output is the real answer.)

When files fail, **Fix With AI** feeds each failure and its checker output back for a repair round,
then re-runs the check so you see the actual result rather than a claim.

> A passing parse says the syntax is valid. It says nothing about whether the behaviour survived.
> That's what the fidelity report is for.

### Saving

**Save all files…** shows exactly what will be written and where, warns about any overwrites, and
lets you redirect to a different folder. Alongside the code it writes **`CONVERSION-REPORT.md`** —
the fidelity report as Markdown, so the next person to read the port gets the same caveats you did.

Where files land:

| Conversion | Destination |
|---|---|
| One file, or a selection | Beside the original |
| Multiple files, or a folder | `converted/<language>/` in the workspace, structure preserved (`aiForge.convert.outputFolder`) |

---

## Privacy

Converting sends the **full text** of your source code to whichever provider is configured. If that
provider is a cloud one (Anthropic, OpenAI, Gemini, Z.ai, Hugging Face), a modal says so before
anything is sent, names the provider, and offers to cancel.

Conversion works identically on a local provider — Ollama, Gemma 4, or GLM — where nothing leaves
your machine. For proprietary code that's the right answer. A coding-tuned local model
(`qwen2.5-coder` or larger) makes a noticeable difference; conversion is a demanding task.

The built-in **offline** provider is pattern-based and cannot convert code. The panel tells you so
rather than producing nonsense.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `aiForge.convert.defaultTarget` | `""` | Language pre-selected in the panel. Blank = choose each time. |
| `aiForge.convert.fidelity` | `idiomatic` | `idiomatic` / `literal` / `modernise` |
| `aiForge.convert.dependencies` | `popular` | `stdlib` / `popular` / `mirror` |
| `aiForge.convert.includeTests` | `false` | Also generate tests |
| `aiForge.convert.keepComments` | `true` | Carry comments across |
| `aiForge.convert.emitManifest` | `true` | Also emit the dependency manifest |
| `aiForge.convert.outputFolder` | `converted` | Root for multi-file conversions |
| `aiForge.convert.maxFiles` | `20` | Cap on files queued from one folder |
| `aiForge.convert.maxCharsPerBatch` | `60000` | Upper bound on characters per request. The converter also derives a budget from the chosen model's real window and uses whichever is **smaller** — this can only make requests smaller, never bigger than the model can take |

The model choice itself is not a setting: it's per-session, chosen in the panel or via
`Evolve AI: Choose AI Model for Code Conversion`, so it can't quietly outlive the job it was for.

---

## How it works underneath

```
sources ──► resolveModel()                   core/modelCapability.ts
              ├─ Ollama /api/show → real context window
              └─ table lookup → output cap + coding tier
                      │
                      ▼
            estimateConversion() + assessFit()
              └─ comfortable │ tight │ split (n passes) │ impossible
                      │
                      ▼
              plan()  ─── batches of whole files
                     └── slices of one oversized file (cut at declarations)
                      │
                      ▼
            buildConvertPrompt() / buildSlicePrompt()   core/codeConvert.ts
              ├─ target idioms + pitfalls     (the quality lever)
              ├─ fidelity + dependency brief
              ├─ suggested output paths
              └─ the output contract
                      │
                      ▼
              AIService.stream()
                ├─ modelOverride    — this job's model, not your global one
                ├─ maxOutputTokens  — sized to the job, not chat's 4096
                └─ contextTokens    — explicit num_ctx, so Ollama cannot
                                      silently truncate the prompt
                      │
                      ▼
            parseConversionResult()          tolerant: path= / file= /
              ├─ ConvertedFile[]             leading comment / no path at all
              └─ ConversionReport            missing report ⇒ flagged, not faked
                      │
                      ▼
            ConversionReviewPanel  ◄──► refine · verify · repair · undo
                      │
                      ▼
              save  →  files + CONVERSION-REPORT.md
```

Everything a conversion knows lives in **`src/core/codeConvert.ts`** — the language catalogue, the
prompts, the output contract, the parser, the report renderer. Adding a language means adding one
entry there; its idioms and pitfalls are what stop the output reading like the source language
wearing a costume.

---

## Limits, stated plainly

- **Machine translation of code needs a human review before it ships.** Everything above is designed
  to make that review possible, not to remove it.
- **A folder is not a build system.** The converter ports source files. Wiring the result into a
  build, resolving version-specific API differences, and running the tests are yours.
- **Large trees convert in batches, and huge files in slices.** Both work, and both are weaker than a
  single pass — each request sees less of the whole. The tool tells you when it is about to do this
  and what would avoid it. A very large port is still best done a module at a time, reviewed as you go.
- **Token counts are estimates.** Sizing uses a characters-per-token approximation (deliberately
  pessimistic), not the model's real tokeniser. It is there to catch the order-of-magnitude mistake
  that silently truncates a prompt, not to be exact.
- **Binary and generated files are skipped**, along with anything over 400 KB.
- **Passing the parse check is not passing the tests.** Generate tests, or bring your own.
