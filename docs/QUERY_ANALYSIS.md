# Query Cost / Perf Preview (DE #2)

Before you ask the AI to optimise a query — or before you accidentally run a
50 GB scan on production — Evolve AI can show you the actual cost the engine
estimates. No execution. No bill.

---

## What it does

For every SQL statement detected in the active file (standalone `.sql` files
plus `spark.sql("...")` blocks in PySpark), Evolve AI shows a `$(zap) Preview
cost` CodeLens. Click it (or press **Ctrl+Alt+Q** / **⌘⌥Q**) and the analyzer
runs against your connected engine:

| Engine | Mechanism | Cost on engine side |
|---|---|---|
| **Databricks** | `EXPLAIN COST` on a SQL warehouse (falls back to plain `EXPLAIN`) | Small — a few seconds of warehouse time |
| **BigQuery**   | `jobs.insert` with `dryRun: true` | **Free** |

The result opens in the Query Cost panel:

- Bytes scanned, estimated USD cost, row count
- Tables read
- Heuristic warnings (`SELECT *`, missing partition filter, cross join, wide date range)
- Engine warnings (`large-scan` when >50 GB)
- The first 8 KB of the EXPLAIN plan (Databricks)
- **Optimise with AI** button — sends the query + analysis into the chat panel for an AI rewrite

---

## Commands

| Command | Default keybinding | Description |
|---|---|---|
| `Evolve AI: Preview Query Cost (Active Statement)` | `Ctrl+Alt+Q` / `⌘⌥Q` | Analyse the SQL at the cursor (or the first SQL in the file) |
| `Evolve AI: Preview Query Cost (Selection)` | — | Analyse only the highlighted text |
| `Evolve AI: Optimise Query with AI` | — | Inject the cached analysis into a chat-panel rewrite request |

---

## Settings (all under `aiForge.queryAnalysis.*`)

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Show CodeLens / Hover for SQL files when an analyzer is connected |
| `databricksUsdPerTb` | `5` | Cost-per-TB-scanned for Databricks USD estimates (Serverless ~$5, Pro varies) |
| `bigqueryUsdPerTb` | `5` | Cost-per-TB-scanned for BigQuery USD estimates ($5 = on-demand pricing) |
| `databricksWarehouseId` | `""` | Sticky warehouse for analysis. Set on first run; clear to re-prompt. |

---

## Privacy & cost

- Both analyzers use **dry-run / EXPLAIN** semantics. The actual query is **never executed**.
- BigQuery dry-run is free.
- Databricks `EXPLAIN COST` consumes a few seconds of warehouse time. Results
  are cached for 5 minutes per SQL hash, so the same query isn't re-analysed
  on every CodeLens refresh.

---

## How "Optimise with AI" works

When you click **Optimise with AI** in the panel (or run the command), Evolve
AI builds a chat instruction that includes:

- The exact SQL
- Engine name + bytes scanned + estimated cost
- Each warning (heuristic + engine)
- The list of tables read

The AI receives this as factual context — so its rewrite suggestions reference
real bottlenecks instead of guessing. This stacks well with **Lineage-Aware
Context (DE #1)**: column types and tests from the upstream tables flow in
automatically.

---

## Not in v1 (planned)

- Snowflake `EXPLAIN` analyzer (the contribution point is ready — see
  `PluginQueryAnalyzer` in `src/core/plugin.ts`).
- Per-statement cost history graph in the panel.
- Auto-analysis on save (currently opt-in via CodeLens click only).
