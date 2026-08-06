# Data Analysis & Reporting — User Guide

*Introduced in v2.7.0*

Give Evolve AI a dataset and an instruction — get insights and a report, PowerBI-style,
without leaving your editor. The **Data Analysis & Reporting** plugin
(`src/plugins/dataAnalysis.ts`) turns tabular data into narrative insights, formatted
HTML reports, reproducible notebooks, and profiling summaries — from local files
**and** from databases and cloud sources.

It is not a BI engine. It reads a **schema + a sample** of your data and asks the active
AI provider (Ollama / Gemma 4 / GLM / Claude / OpenAI / Gemini / Z.ai / Hugging Face) to
produce the deliverable. The heavy lifting over a full dataset happens in generated Python
that you run — so nothing large or sensitive is forced through a cloud model.

---

## When it activates

Automatically, when your workspace contains any `.csv`, `.tsv`, `.json`, `.xlsx`, or
`.parquet` file. The status bar shows how many data files were detected.

---

## The commands

Three ways to start:

- In the **chat panel**, open the **Mode** dropdown (bottom-left, next to the model pill) and
  pick **Analyse**.
- **Right-click a data file** in the Explorer → *Analyze Data & Report*.
- Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Data".

### The Data Analysis panel *(v2.9.0)*

When you pick **Analyse** without a file already selected, Evolve AI opens a dedicated
**Data Analysis panel** — the friendly front door. From there you can:

- **Browse for a file…** anywhere on your machine (your data doesn't have to be in the open
  project).
- **Drag & drop** a data file onto the panel.
- **Pick a file from this workspace** — the list is filtered to real data files (CSV / TSV /
  Excel / Parquet, and JSON only when it actually looks tabular; config/build JSON is hidden).
- Jump to **Database or cloud source** or **Run a data pipeline**.

Then choose a deliverable (Insights / Report / Notebook / Profile), add an optional focus, and
hit **Analyse →**. If you came in via the Explorer right-click or a CodeLens, you skip the
panel and go straight to the quick-pick.

| Command | What it does |
|---|---|
| **Analyze Data & Report** | Pick a file → choose a deliverable (insights / report / notebook / profile). The one-stop entry point (also the Explorer right-click action). |
| **Data Insights in Chat** | Streams a narrative analysis into the chat panel — patterns, trends, outliers, data-quality issues, recommendations — and you can ask follow-up questions in the same thread. Gemini-style. |
| **Generate HTML Data Report** | A single self-contained HTML report: KPI/summary tiles, charts, tables, and a written "Key insights" section. The PowerBI-style deliverable. Since v2.11.0 it opens in a live preview you can refine in plain language — see [Report design and customisation](#report-design-and-customisation-v2110). |
| **Generate Data Analysis Notebook/Script** | A reproducible pandas + plotly `.py` script (or `# %%` percent-format notebook) you can run and customize. |
| **Profile Dataset** | Column types, null counts, distributions, correlations, and data-quality flags. |
| **Analyze Data from Database or Cloud Source** | Pull a sample from a database or cloud source (see below) and run any of the above deliverables on it. |
| **Refine HTML Data Report** *(v2.11.0)* | Reopen any generated report in the preview and change it in plain language. Also on the Explorer right-click for `*-report.html`. |
| **Create Report Theme (branding)** *(v2.11.0)* | Scaffold `evolve-report-theme.json` so every report picks up your brand colours, logo and footer. |

---

## Report design and customisation *(v2.11.0)*

Reports used to be whatever the model felt like emitting — no typography scale, no palette, no
dark mode, no print styles, and no way to change anything once the file was written. Three things
changed.

### 1. The design is no longer the model's job

`src/core/reportDesign.ts` owns the stylesheet, the chart styling and the report runtime. The model
is asked only for semantic HTML against a documented class contract (`.report`, `.kpi-grid`,
`.card`, `figure.chart`, `table.data`, `ul.insights`, `.callout`, …) and is explicitly told **not**
to write CSS. The extension then stamps its own stylesheet into the finished document, so the look
holds even when the model ignores instructions or you are running a small local model.

Every report you generate now gets, for free:

- a light **and** dark theme that follows the reader's OS, with a toggle in the corner
- sortable columns and a filter box on any table over 12 rows
- print / Save-as-PDF styles that avoid breaking cards across pages
- a responsive layout that works down to phone width
- consistent chart colours, driven by your palette, in both inline SVG and matplotlib

For the large-data path, the same design is injected into the generated Python as a preamble
(`EVOLVE_STYLE`, `evolve_style_mpl`, `evolve_fig`, `evolve_kpi`, `evolve_table`,
`evolve_html_shell`, …), so a script-built report is indistinguishable from a directly-built one.

### 2. Report formats, sections and audience

Choosing **HTML report** now offers **Standard** or **Customise…**. Customising lets you pick:

| Choice | Options |
|---|---|
| **Format** | Executive summary · Deep-dive analysis · Data quality audit · Trend & time-series · Segment comparison |
| **Sections** | summary, KPI tiles, trends, breakdowns, distributions, relationships, data quality, data table, key insights, recommendations, methodology |
| **Audience** | Executives · Analysts · Data engineers · Mixed |
| **Appearance** | Follow the reader's theme · Always light · Always dark, plus an accent colour |
| **Title** | Optional — defaults to the dataset name |

The format is not cosmetic: each one changes the sections, the chart budget, the tone, and the
framing given to the model. An *Executive summary* is told to lead with the answer and spend at
most four charts; a *Data quality audit* is told the subject of the report is the data itself, and
its KPI tiles become completeness and duplicate rates.

The same options are available as an inline form in the Data Analysis panel.

### 3. The refine loop

An HTML report now opens in a **preview panel** rather than a browser tab, with a refine box
underneath:

> *"drop the raw table, add revenue by month, and explain each chart in plain language"*

The change is applied to the document that already exists — the rest of the report is preserved
verbatim, not regenerated. Every round is snapshotted, so **Undo** always steps back. From the
same panel you can open the report in a browser, view the HTML source, or **Regenerate from
data…** with different options.

Two details that make this practical:

- **Charts don't cost context.** Base64 images and the injected stylesheet are swapped for short
  placeholders before the round-trip and restored afterwards. A 29 KB report goes to the model as
  roughly 0.5 KB of structure, so a refinement costs about the same as the original request.
- **Styling changes skip the model entirely.** "Use dark theme" or "make the accent `#1f7a5a`" is
  applied locally and instantly, because the stylesheet is ours to change. Only genuine content
  changes go to the AI.

If a response comes back truncated or malformed, the existing report is left untouched.

### 4. Brand it once — `evolve-report-theme.json`

Run **Create Report Theme (branding)** to drop a commented template in your workspace root:

```jsonc
{
  "brandName": "Northwind Analytics",
  "accent": "#1f7a5a",
  "palette": ["#1f7a5a", "#e8873a", "#4f6df5", "#d6455d"],
  "theme": "auto",                    // auto | light | dark
  "logo": "",                         // data: URI — reports stay offline
  "footer": "Internal — do not distribute",
  "defaultArchetype": "executive",    // executive | deepdive | quality | timeseries | comparison
  "defaultAudience": "mixed",
  "defaultSections": [],              // [] = use the format's own sections
  "maxCharts": 6,
  "density": "comfortable"
}
```

Every report — interactive, panel-driven, or pipeline — picks it up, and the file is re-read on
each run so edits take effect without reloading the window. A malformed theme file degrades to
the built-in look rather than blocking the report.

Pipeline steps can override it per step:

```jsonc
{
  "name": "Exec deck",
  "source": { "type": "file", "path": "sales.csv" },
  "analysis": "report",
  "report": { "archetype": "executive", "audience": "exec", "maxCharts": 3, "theme": "light" }
}
```

---

## Size-adaptive execution (your data, your choice)

The plugin adapts to how big your data is so that large or sensitive datasets never get
pushed through a cloud model:

- **Small files** — the AI reads a schema + row sample and writes the finished report /
  insights directly.
- **Large files** — the AI generates a **self-contained script** that reads the *full*
  dataset locally and writes the report. Your full dataset never leaves the machine.
- **Cloud-provider safety** — when a sample *would* be sent to a cloud AI provider, the
  plugin tells you and offers to switch to a local provider or the generated-script path.

Output is written **next to your data**: `sales.csv` → `sales-report.html` /
`sales-analysis.py`. The plugin offers to open the report in a browser or run the script.

---

## Sourcing from databases and cloud

Run **Analyze Data from Database or Cloud Source** from the command palette. Two paths:

### Live query / fetch (reuses your connected-plugin credentials)

These use the extension's existing cloud clients, built from the **same credentials** you
already configured for the AWS / GCP / Azure / Databricks connected plugins — no new setup,
no new dependencies, no new credential storage. Each returns a sample (~1000 rows), which is
exactly what the AI needs; for a full-table report, choose the script deliverable.

| Source | What you provide |
|---|---|
| **BigQuery** | A SQL query |
| **Databricks SQL** | A warehouse + a SQL query |
| **Azure Cosmos DB** | Endpoint, key, database, container, a query |
| **Azure Log Analytics** | Workspace ID + a KQL query |
| **AWS DynamoDB** | A table to scan |
| **Cloud object storage** | A bucket/container + object key on **S3 / GCS / Azure Blob** (fetches a CSV/JSON and runs it through the same sniffer) |

> Not connected yet? The plugin tells you which connect command to run
> (e.g. *Configure GCP Credentials*), then try again.

### Generic SQL databases (generated script, your own credentials)

For **PostgreSQL, MySQL / MariaDB, SQLite, Snowflake, SQL Server**, or any SQLAlchemy URL,
the plugin generates a `pandas.read_sql` analysis script. You supply the connection string
via a **`DB_URL` environment variable** and run the script yourself:

```bash
# 1) pip install the driver shown at the top of db-analysis.py, plus sqlalchemy pandas plotly
# 2) set your connection string
export DB_URL="postgresql+psycopg2://user:pass@host:5432/dbname"    # mac/linux
$env:DB_URL = "postgresql+psycopg2://user:pass@host:5432/dbname"    # PowerShell
# 3) run it
python db-analysis.py
```

The extension **never stores database passwords** and opens no live connection — the
connection happens only when you run the script, with credentials from your environment.

---

## Exporting (Excel / PDF)

Excel and PDF output are produced by the **generated script** (`df.to_excel(...)`,
HTML→PDF), not by the extension itself. Ask for it in your instruction, e.g. *"also write an
Excel workbook with a sheet per region"*.

---

## Privacy model at a glance

- **Local files, small:** a sample is sent to the active AI provider. If that provider is
  in the cloud, you're warned first.
- **Local files, large:** only a schema + tiny sample is used to write a script; the full
  data is read locally by the script you run.
- **Live cloud query:** a capped sample is analysed; use a local AI provider to keep even
  that on your machine.
- **Generic SQL:** nothing is sent — a script is generated and run with your own credentials.

---

## Declarative data pipelines *(v2.8.0)*

Define a repeatable analysis once and run it on demand. A pipeline is a small JSON file
(`evolve-data-pipeline.json`) listing **steps** — each step names a **source** and an
**analysis**. It is the backend-free version of an "agent workflow": a reproducible,
versioned, multi-source run you own as a file in your repo. Nothing is hosted, nothing is
scheduled, nothing runs when your editor is closed.

- **Create Data Pipeline** (command palette) scaffolds a starter `evolve-data-pipeline.json`
  with commented examples for every source type, and opens it.
- **Run Data Pipeline** runs each step in sequence, writing deliverables into the pipeline's
  `output` folder. It continues past a failed step and summarises what succeeded/failed. Also
  available by right-clicking a `*pipeline*.json` file in the Explorer.

### Pipeline file shape

```jsonc
{
  "output": "reports",                       // folder (relative to this file) for deliverables
  "steps": [
    {
      "name": "Sales overview",
      "source": { "type": "file", "path": "sales.csv" },
      "analysis": "report",                  // insights | report | notebook | profile
      "focus": "revenue trends by month and region"
    },
    { "name": "BigQuery",
      "source": { "type": "bigquery", "query": "SELECT * FROM `p.d.t` LIMIT 1000" },
      "analysis": "profile" }
  ]
}
```

`//` line comments are allowed (the template ships with commented examples). Supported
`source.type` values: `file`, `bigquery`, `databricks`, `cosmos`, `loganalytics`, `dynamodb`,
`s3`, `gcs`, `blob`. Cloud sources reuse your connected-plugin credentials, exactly like the
interactive **Analyze from Database or Cloud Source** command.

---

## Not yet included

- **Emailing reports** is intentionally deferred to a future release.
- **Scheduling** pipelines to run unattended — a VS Code extension can't run when the editor
  is closed, so this needs infrastructure a local extension doesn't provide.

---

*See also: [README](../README.md) · [LINEAGE.md](LINEAGE.md) · [QUERY_ANALYSIS.md](QUERY_ANALYSIS.md)*
