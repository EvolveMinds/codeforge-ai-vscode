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

## The six commands

Three ways to start:

- In the **chat panel**, open the **Mode** dropdown (bottom-left, next to the model pill) and
  pick **Analyse**.
- **Right-click a data file** in the Explorer → *Analyze Data & Report*.
- Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Data".

If no data file is found in your workspace, the flow opens a file picker so you can browse to
any file — including one outside the open folder.

| Command | What it does |
|---|---|
| **Analyze Data & Report** | Pick a file → choose a deliverable (insights / report / notebook / profile). The one-stop entry point (also the Explorer right-click action). |
| **Data Insights in Chat** | Streams a narrative analysis into the chat panel — patterns, trends, outliers, data-quality issues, recommendations — and you can ask follow-up questions in the same thread. Gemini-style. |
| **Generate HTML Data Report** | A single self-contained HTML report: KPI/summary tiles, charts, tables, and a written "Key insights" section. The PowerBI-style deliverable. |
| **Generate Data Analysis Notebook/Script** | A reproducible pandas + plotly `.py` script (or `# %%` percent-format notebook) you can run and customize. |
| **Profile Dataset** | Column types, null counts, distributions, correlations, and data-quality flags. |
| **Analyze Data from Database or Cloud Source** | Pull a sample from a database or cloud source (see below) and run any of the above deliverables on it. |

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
