# dbt Manifest Integration (DE #3)

Open any dbt model and Evolve AI shows you what depends on it. No more
"will this break a downstream mart?" anxiety, no more grepping the repo for
`ref('model_name')`.

---

## What you see

- **Impact CodeLens** at the top of every model: `$(symbol-class) Impact: 4 downstream · 1 exposure · 12 tests`. Click to open the panel.
- **Impact panel** (`Ctrl+Alt+I` / `⌘⌥I`): direct + transitive downstream models with materialization, exposures with owners + types + URLs, total tests in the impacted graph, and upstream parents + sources for full bidirectional context.
- **Refactor with AI (impact-aware)** button in the panel: pipes the downstream impact summary into the chat panel so the AI rewrites your model with the *blast radius* in mind, not just the SQL in front of it.
- **`dbt: List Exposures`** command: quick-pick across every exposure in the project, with owner + type + upstream model count.

---

## Commands

| Command | Default keybinding | Description |
|---|---|---|
| `dbt: Show Downstream Impact` | `Ctrl+Alt+I` / `⌘⌥I` | Open the impact panel for the active model |
| `dbt: Refresh Manifest Cache` | — | Force a re-read of `target/manifest.json` |
| `dbt: List Exposures` | — | Quick-pick across every exposure |
| `dbt: Refactor with Impact Context (AI)` | — | Send the model + downstream impact into chat for AI refactor |

---

## Settings (under `aiForge.dbt.*`)

| Setting | Default | Description |
|---|---|---|
| `impactCodeLensEnabled` | `true` | Show the impact CodeLens at the top of every model |
| `impactDepth` | `5` | Max graph depth when computing transitive downstream impact |

---

## How it works

`src/plugins/dbtManifest.ts` is a shared, mtime-cached reader for `target/manifest.json`. It reuses the same `child_map` / `parent_map` data that dbt itself uses for selectors. The reader is consumed by both DE #1 lineage (column schemas) and DE #3 impact analysis (graph traversal) — so both features stay in sync without re-parsing the manifest.

Cache invalidation: the reader keys off `manifest.json`'s mtime. When you re-run `dbt compile`, the next access automatically picks up the fresh data — no manual refresh needed (though `dbt: Refresh Manifest Cache` is there for paranoia).

---

## What's NOT in scope (yet)

- **Column-level lineage** — currently model-level only. The data is in the manifest; surfacing it requires a richer column-projection parser. Likely DE #5 (schema-drift).
- **Test results history** — we know which tests *exist* per model, not their pass/fail history. Needs `run_results.json`, which is another file dbt writes.
- **Selector syntax** (`+model_name+1`) — the panel always uses your fixed `impactDepth`. Could be a future enhancement if requested.

---

## Privacy

Everything is local. The manifest is read from disk, parsed in-memory, and never uploaded. The "Refactor with AI" button is the only path that sends data outward — and only sends what you'd see in the panel, with model names, materializations, and exposure metadata. No source SQL of downstream models is included; only their names.
