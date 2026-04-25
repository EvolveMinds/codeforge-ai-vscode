# Lineage-Aware Context (DE #1)

Evolve AI resolves the upstream tables your SQL / PySpark file references and
feeds their real column schemas into every AI prompt. The AI stops inventing
columns.

---

## What it does

When you open a dbt model or a PySpark notebook, Evolve AI walks the file for
upstream references and looks each one up:

| Reference style | Where we look | What we get |
|---|---|---|
| `{{ ref('stg_orders') }}` | `target/manifest.json` → `schema.yml` fallback | columns, types, descriptions, tests |
| `{{ source('raw', 'events') }}` | same | same |
| `spark.table("cat.sch.tbl")` | Unity Catalog API | columns, types, comments |
| `spark.read.table(...)`, `DeltaTable.forName(...)` | same | same |
| `spark.sql("... FROM cat.sch.tbl ...")` | same | same |

Anything resolved flows into:

1. **The AI prompt** — under `## Upstream table schemas`, above related files.
2. **Inline CodeLens** above each `ref()` / `spark.table(...)`.
3. **Hover tooltips** on table and column names.
4. **Column autocompletion** after typing `table.`.
5. **Diagnostics** (yellow squiggle) on refs that don't resolve — catches typos
   before `dbt run`.
6. **Status bar badge** — `$(link) N upstream` with a breakdown on hover.
7. **Lineage panel** (`Ctrl+Alt+L`) — a full view of every resolved table.

---

## Providers

Evolve AI tries providers in the order configured by
`aiForge.lineage.providerOrder` (default: dbt manifest → schema.yml → Unity
Catalog). First match wins.

### 1. dbt Manifest (`dbtManifest`)

Runs when a `dbt_project.yml` is found walking up from the active file.
Reads `target/manifest.json`. Gives the highest-fidelity data: column types,
descriptions, passing tests, and (indirectly) staleness.

If the manifest is older than 24 hours, the prompt, the status bar, and the
Lineage panel all flag it — `dbt compile` refreshes.

### 2. schema.yml fallback (`schemaYml`)

When `target/manifest.json` doesn't exist (fresh project, no `dbt compile` yet),
Evolve AI parses `schema.yml` / `sources.yml` files directly. Coverage is
partial — some columns are undocumented — but it works offline.

### 3. Unity Catalog (`unityCatalog`)

Runs only when Databricks Connected is active and authenticated. Resolves
three-part FQNs (`catalog.schema.table`) via the UC REST API. Uses the
existing client from the Databricks Connected plugin — no extra setup.

---

## Privacy — PII / PCI / sensitive columns

Columns tagged `pii`, `pci`, or `sensitive` (in dbt meta or UC) are
**redacted** before prompts reach cloud providers (Anthropic, OpenAI, Hugging
Face). Local providers (Ollama, Gemma 4) always get the full schema — the
data never leaves your machine.

Override with `aiForge.lineage.includePii: true`. The first time we detect
PII-tagged columns **and** you're on a cloud provider, we prompt once.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `aiForge.lineage.enabled` | `true` | Master switch. |
| `aiForge.lineage.includePii` | `false` | Include PII-tagged columns in cloud prompts. |
| `aiForge.lineage.maxUpstreamTables` | `8` | Cap per request. Higher = more context, more tokens. |
| `aiForge.lineage.providerOrder` | `["dbtManifest","schemaYml","unityCatalog"]` | First hit wins. |

---

## Commands

| Command | Default keybinding | What it does |
|---|---|---|
| `Evolve AI: Show Lineage Panel` | `Ctrl+Alt+L` | Open the Lineage panel for the active file. |
| `Evolve AI: Refresh Lineage` | — | Re-read manifest, re-hit UC, repopulate providers. |

---

## When lineage doesn't find anything

The Lineage panel shows specific next steps based on your setup. Common cases:

- **"No refs found"** — open a dbt model or PySpark file; lineage only runs for
  SQL / .py / .ipynb files.
- **"Unresolved ref"** diagnostic — check the name, or run `dbt compile`.
- **"Manifest stale"** — `dbt compile` to refresh, or ignore if intentional.
- **UC columns missing** — ensure "Databricks: Connect" has run and the table
  exists in the workspace you authenticated against.

---

## Budget

Lineage gets 15% of the context budget (default 24 000 chars → 3 600 chars for
lineage). When schemas don't fit, Evolve AI keeps every table but trims columns
— columns **with descriptions** are kept over columns without, so the AI gets
the highest-signal data first. The panel and status bar still show the full
schema — truncation only affects what's sent to the AI.

---

## Not in v1 (planned)

- Column-level lineage via `sqlglot` (full SELECT projection parsing).
- Cross-notebook widget resolution.
- BigQuery `INFORMATION_SCHEMA` provider.
- Iceberg / Snowflake native provider.
