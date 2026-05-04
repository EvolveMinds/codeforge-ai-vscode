# Airflow DAG Simulator (DE #4)

Catch broken DAGs before you push them. Evolve AI now does static analysis of
your Airflow DAG files and surfaces problems inline — cycles, broken
dependencies, sensor pitfalls, schedule mistakes — without running anything.

---

## What it catches

| Code | Severity | What it means |
|---|---|---|
| `cycle` | error | The dependency graph has a loop. Airflow rejects this at parse time. |
| `duplicate-task-id` | error | Two operators share a `task_id`. Parse-time error. |
| `invalid-cron` | error | Cron expression has an out-of-range value. |
| `undefined-dependency` | warning | `task_a >> task_b` where `task_b` isn't defined. |
| `missing-retries` | warning | `default_args` exists but doesn't set `retries`. |
| `sensor-poke-starvation` | warning | Sensor uses `mode='poke'` with a >1h timeout — holds a worker slot. |
| `sensor-no-timeout` | warning | Sensor has no `timeout` set — can hang indefinitely. |
| `missing-catchup-false` | warning | `start_date` is in the past but `catchup=False` not set. |
| `taskflow-missing-parens` | warning | `@task` function referenced without `()` in a dependency chain. |
| `missing-default-args` | info | No `default_args` dict at all. |

---

## Where you see it

- **Inline diagnostics** — yellow/red squiggles on the offending line, with the issue + a fix hint in the tooltip.
- **CodeLens at line 0**: `$(circuit-board) Airflow DAG: 7 tasks · 2 warnings — open simulator`. Click to open the panel.
- **Simulator panel** (`Ctrl+Alt+D` / `⌘⌥D`): stats, ASCII task graph, issue list grouped by severity, jump-to-line on click, and a **Fix all with AI** button.

---

## Commands

| Command | Default keybinding | Description |
|---|---|---|
| `Airflow: DAG Simulator` | `Ctrl+Alt+D` / `⌘⌥D` | Open the simulator panel for the active DAG |
| `Airflow: Re-run DAG Simulator` | — | Re-analyse the active file (paranoia hatch) |
| `Airflow: Fix DAG Issues with AI` | — | Pipe issues + DAG into chat for AI rewrite |

---

## Settings (all under `aiForge.airflow.simulator.*`)

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch for static analysis |
| `runOnSave` | `true` | Re-run only on save. False = live (every keystroke) |
| `severity` | `warning` | Minimum severity surfaced as a diagnostic |

---

## Privacy

Everything is local. The analyzer runs in-process — no Python interpreter, no
Airflow installation required. The "Fix all with AI" button is the only path
that sends data outward, and it only sends what you'd see in the panel: the
issue list and the DAG source. No connection to your Airflow webserver is
made.

---

## How the AI fix works

When you click **Fix all with AI** the analyzer's report is prepended to the
prompt:

```
## DAG Analysis
- Tasks: 7 (2 root, 1 leaf)
- Edges: 8
- dag_id: etl

### Issues (3)
- [error] line 24: Cycle detected in task dependencies: a → b → c → a
  hint: Break the cycle by removing one of the edges in the loop.
- [warning] line 12: Sensor 'wait' uses mode='poke' with a >1h timeout. ...
  hint: Switch to mode='reschedule' to free the worker between checks.
...

Fix the issues in this Airflow DAG. ... Return ONLY the complete updated file.
```

The AI receives the precise issue list, not generic "improve this DAG"
guidance — so its rewrite targets the actual problems.

---

## Limitations / not in scope

- **No Python execution.** We don't run `airflow dags test`. Pure static
  analysis. This is by design — keeps the feature working in offline mode and
  in environments without Airflow installed.
- **No symbolic dependency resolution across files.** We don't follow
  `from .helpers import shared_task`.
- **Sensor / operator config rules are heuristic.** Not every flag is caught.
  The set will grow as we hear from real users.
- **Schedule preview ("next 3 runs would fire at...") not yet shipped** — easy
  add for v1.10 if there's demand.
