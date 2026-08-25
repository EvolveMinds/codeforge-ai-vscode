# Zero-AI Offline Developer & Data Engineering Suite

> **100% Deterministic · Zero External Network Calls · Air-Gapped Ready**

The **Zero-AI Offline Suite** in Evolve AI enables developers, data engineers, and DevOps teams to execute formatting, profiling, schema synchronization, static security analysis, and codemods directly inside VS Code without connecting to any AI model or external service.

---

## 1. Multi-Dialect SQL Formatter (Rule-Based)

Format, align, and standardize SQL code locally across 8 dialect targets.

### Supported Dialects
* **Databricks / Spark SQL** (Delta Lake, `CLUSTER BY`, `OPTIMIZE`, `VACUUM`)
* **Snowflake** (`QUALIFY`, `MATCH_RECOGNIZE`, stage syntax)
* **Google BigQuery** (safe cast, unnest, backtick-quoted table identifiers)
* **PostgreSQL** (`RETURNING`, `ON CONFLICT`, JSONB operators)
* **DuckDB** (`SUMMARIZE`, `PIVOT`, `READ_PARQUET`)
* **MySQL**
* **T-SQL / Microsoft SQL Server**
* **SQLite / ANSI SQL**

### Formatting Capabilities
* **Clause Indentation**: Aligns `SELECT`, `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `WINDOW`, `QUALIFY`, `ORDER BY`, `LIMIT`.
* **CTEs & Subqueries**: Formats `WITH ... AS (...)` blocks and nested parenthesized expressions cleanly.
* **CASE Expressions**: Nested indentation for `CASE ... WHEN ... THEN ... ELSE ... END`.
* **Comma Styles**: Configurable `trailing` (default) or `leading` comma placement.
* **Jinja Preservation**: Safely preserves dbt Jinja expressions (`{{ ref(...) }}`, `{{ source(...) }}`, `{{ config(...) }}`).

### Usage
* Use VS Code standard **Format Document** (`Shift+Alt+F` on Windows/Linux, `Shift+Option+F` on macOS).
* Command: `Evolve AI: Format SQL (Multi-Dialect Offline)` (`aiForge.sql.format`).

---

## 2. Offline Data Profiler & Quality Auditor

Profile tabular datasets (CSV, TSV, JSON, JSONL) locally with instant statistics and anomaly detection.

### Computed Metrics
* **Schema Inference**: Inferred column data types (`integer`, `float`, `boolean`, `datetime`, `date`, `json`, `string`).
* **Nullability & Uniqueness**: Null count, missingness percentage, distinct cardinality, uniqueness ratio.
* **Numeric Summaries**: Minimum, maximum, mean, median, standard deviation, count of zeros, count of negative values.
* **Temporal Bounds**: Earliest date, latest date, duration span (days).
* **Categorical Breakdown**: Top 10 frequent values with occurrences and percentages.
* **Quality Anomaly Alerts**:
  * Primary Key candidate detection (100% unique & 0% nulls).
  * High missingness warning (>20% null values).
  * Single constant value detection.
  * Negative value detection in unsigned contexts (e.g. `price`, `quantity`, `age`).

### One-Click Exporters
1. **Export dbt Tests YAML**: Auto-generates `models:` schema YAML containing `unique`, `not_null`, and `accepted_values` tests.
2. **Export Great Expectations**: Generates a standard JSON Expectation Suite.
3. **Export Markdown Report**: Generates a clean tabular Markdown data profile summary.

### Usage
* Command: `Evolve AI: Profile Dataset & Quality Audit (Offline)` (`aiForge.dataProfiler.profileActive`).

---

## 3. Deterministic dbt Model & YAML Synchronizer

Automatically syncs dbt SQL output projections with `schema.yml` without sending SQL to an LLM.

### Capabilities
* Parses top-level and final CTE `SELECT` clauses to discover all projected column names and aliases.
* Locates existing `schema.yml` / `models.yml` or scaffolds a new version 2 schema file.
* Appends missing column definitions and documentation boilerplate without overwriting existing human-written docstrings.

### Usage
* Command: `Evolve AI: Sync dbt Model to schema.yml (Offline)` (`aiForge.dbt.syncSchemaYaml`).

---

## 4. Interactive Cron & Regex Workbench

A built-in developer workbench for schedule planning and regular expression debugging.

### Features
* **Cron Schedule Visualizer**:
  * Validates standard 5/6-field cron expressions, step intervals (`*/15`), ranges (`1-5`), and Airflow presets (`@daily`, `@hourly`, `@weekly`).
  * Explains the schedule in natural English (e.g. *"Every 15 minutes, at 4 AM, on Monday through Friday"*).
  * Computes the upcoming 10 and previous 10 execution timestamps with timezone awareness.
* **Interactive Regex Tester**:
  * Live evaluation with flag toggles (`g`, `i`, `m`, `s`, `u`).
  * Displays total match counts, character indices, and capture group breakdowns.

### Usage
* Command: `Evolve AI: Open Cron Schedule Visualizer` (`aiForge.workbench.showCron`).
* Command: `Evolve AI: Open Regex Tester` (`aiForge.workbench.showRegex`).

---

## 5. Offline Infrastructure & Security Linters

Static rule-based security and optimization analyzers for infrastructure files.

### Terraform & OpenTofu
* `TF-SEC-01`: Flags wide-open ingress CIDR (`0.0.0.0/0` or `::/0`).
* `TF-SEC-02`: Flags unencrypted S3 and cloud storage buckets.
* `TF-SEC-03`: Flags unpinned module / provider versions.

### Dockerfile
* `DOCKER-01`: Flags unpinned or `:latest` base image tags.
* `DOCKER-02`: Flags missing `USER` instruction (container executing as default root).
* `DOCKER-03`: Flags missing `.dockerignore` file in workspace.
* `DOCKER-04`: Flags insecure script pipes (`curl | bash`, `sudo`).
* `DOCKER-05`: Layer optimization — flags consecutive unchained `RUN` statements.

---

## 6. AST-Based Deterministic Code Modernizer

Rule-based codemods to modernize legacy code patterns without AI hallucinations.

### Python Codemods
* **PEP 604 & 585 Type Hints**: `Union[A, B]` &rarr; `A | B`, `Optional[T]` &rarr; `T | None`, `List[T]` &rarr; `list[T]`, `Dict[K, V]` &rarr; `dict[K, V]`.
* **Pathlib Modernization**: `os.path.join(a, b)` &rarr; `Path(a) / b`, `os.path.exists()`, `os.path.basename()`, `os.path.dirname()`.
* **f-Strings**: Converts simple `.format()` strings to clean Python f-strings.

### JavaScript / TypeScript Codemods
* **CommonJS to ESM**: Converts `const x = require('x')` and `module.exports` &rarr; `import` and `export`.

### Usage
* Command: `Evolve AI: Modernize Python Code (AST / Zero-AI)` (`aiForge.modernize.python`).
* Command: `Evolve AI: Modernize JS/TS Code (ESM / Zero-AI)` (`aiForge.modernize.javascript`).

---

## 7. Strict Air-Gapped Mode

For financial, healthcare, defense, and air-gapped workstations where zero outbound traffic is permitted:

* **Configuration**: `"aiForge.strictOffline": true`
* **Status Bar Indicator**: Displays `$(shield) Air-Gapped` in the status bar.
* **Network Enforcement**: Installs an active request interceptor that blocks any non-offline AI requests.

### Usage
* Click the `Air-Gapped` status bar item or run `Evolve AI: Toggle Strict Air-Gapped Mode` (`aiForge.offline.toggleStrictAirGap`).
