# Data Analysis & Reporting Studio — Visualisation Roadmap

> Status: proposal, not yet started. Target: v2.25.0 → v2.28.0.
> Scope: closes the analytical gaps in the Studio's visualisation layer and raises it from
> "shows you charts" to "finds the finding and proves it".

---

## 1. Where we are today

Three independent visualisation stacks, no shared state between them:

| Stack | Location | Renderer | Inventory |
|---|---|---|---|
| Report charts | `core/reportBlocks.ts` | matplotlib → base64 PNG | `bar, barh, line, area, scatter, pie, histogram, box` |
| Single-dataset 3D Manifold | `desktop/renderer/renderer.ts:21821` | hand-written Canvas 2D | scatter / PCA / surface / k-means |
| Data Cosmos (schema graph) | `desktop/renderer/renderer.ts:26313` | hand-written Canvas 2D | force-directed 3D + 2D ERD, path→SQL |

Analytics live in `offline/dataScientistEngine.ts` (3,153 lines) as a **pure static class**:
key drivers (Pearson r, p-value, R²), Tukey IQR outliers, Pareto 80/20, cohort gap analysis,
bottleneck detection. Rendered as hand-built SVG (Waterfall, Tornado, Pareto, correlation matrix).

### The two constraints every item below respects

1. **`dependencies: {}`** — the extension ships with zero runtime dependencies. Everything is
   hand-rolled, including a real PCA (power iteration + Gram-Schmidt, `renderer.ts:22268`).
   Nothing in this roadmap adds a runtime dependency. Air-gap mode must keep working.
2. **`DataScientistEngine` is static and pure** (`analyze(rows, columns, options)`), invoked from
   `desktop/main/ipcHandlers.ts:3032`. New analytics are therefore pure functions, unit-testable
   with no Electron and no VS Code host. This is the cheapest seam in the codebase — use it.

### Confirmed gaps (grepped, all returned zero or near-zero)

| Gap | Evidence | Consequence |
|---|---|---|
| Time & forecasting | 2 incidental hits repo-wide | Cannot answer "what happens next" or "when did this change" |
| Geospatial | 0 hits | Any region/country column is an invisible dimension |
| Flow & hierarchy | 0 hits (sankey/treemap/sunburst/chord/parcoords) | Relationships between *values* are unseeable |
| Cross-view linking | selection is per-engine, single-point | Every visual is an island |
| Scale ceiling | `dataScientistEngine.ts:1313` → `rows.slice(0, 300)` | Demo-grade; breaks the pitch on a real dataset |

---

## 2. Sequencing principle

Ordered by **insight delivered per unit of effort**, not visual spectacle.

The temptation is to add twenty chart types. We should resist it. We lose a chart-count race with
Tableau on day one. What differentiates this product is that the engine *finds the finding* and the
visual *proves* it. Phases 1 and 2 deepen exactly that. A sunburst mostly looks good in a
screenshot.

**Phases 1 and 2 are the release.** Phases 3–5 are additive and can slip without harming the story.

---

## Phase 1 — Time Intelligence
**Target v2.25.0 · highest value · new file `offline/timeIntelligence.ts`**

The biggest hole. Most business questions are temporal, and we currently answer none of them.

### Deliverables

1. **Date column auto-detection** — extend the existing `semanticRoles` detection in
   `dataScientistEngine.ts` with a `dateCol` role. Parse ISO, `DD/MM/YYYY`, `MM/DD/YYYY`, epoch
   seconds/millis. Infer grain (day/week/month/quarter) from median inter-row spacing.
2. **Trend decomposition** — classical additive decomposition into trend / seasonal / residual.
   Centred moving average for trend, period-averaged detrended series for seasonal, remainder as
   residual. ~80 lines, no dependencies.
3. **Changepoint detection** — CUSUM or binary segmentation over the mean. Emits
   *"margin broke on 14 March, −18% sustained"*. This is the single highest-value sentence the
   product can produce.
4. **Forecast** — Holt-Winters triple exponential smoothing (level/trend/season) with a prediction
   interval. Falls back to Holt's linear method when no seasonality is detected. Confidence cone
   rendered as a shaded band.
5. **New chart kinds** — add `'timeline'` and `'forecast'` to `ChartKind` in `core/reportBlocks.ts`,
   with matching `chartWord()` entries and matplotlib generation in the report path.

### Interfaces

```ts
export interface TimeSeriesAnalysis {
  dateColumn: string;
  grain: 'day' | 'week' | 'month' | 'quarter' | 'year';
  decomposition: { trend: number[]; seasonal: number[]; residual: number[] };
  changepoints: Array<{
    index: number; date: string; magnitudePct: number;
    direction: 'up' | 'down'; confidence: number; narrative: string;
  }>;
  forecast: Array<{ date: string; value: number; lower: number; upper: number }>;
  seasonalityDetected: boolean;
  seasonalPeriod: number | null;
}
```

Added to `DataScienceAnalysisResult` as `timeSeries?: TimeSeriesAnalysis` — optional, so every
existing caller keeps compiling.

### Acceptance
- Unit tests in `test/suite/offline/timeIntelligence.test.ts`: synthetic series with a known
  changepoint at a known index is detected within ±1; a known seasonal period is recovered.
- Datasets with no date column degrade silently — `timeSeries` stays `undefined`, nothing breaks.

---

## Phase 2 — Cross-filtering / linked brushing
**Target v2.25.0 · the "how did you do that" moment · new file `desktop/renderer/selectionStore.ts`**

Currently each visual is an island. This is the change that most makes a user feel they are
*interrogating* data rather than *viewing* it — and it needs no new rendering engine at all.

### The idea
Lasso a cluster of outliers in the 3D Manifold; the Waterfall, Tornado, Pareto and cohort panels
instantly recompute against **only that selection**, with the full-population figure shown ghosted
behind for contrast.

### Deliverables

1. **`SelectionStore`** — a tiny observable holding the active row-id set plus its provenance
   (which view made the selection, and how). Pub/sub; no framework.
2. **Lasso + box select in the Manifold** — the engine already tracks `renderedNodes` with screen
   coordinates (`renderer.ts:21850`) and already has a single-point `selectedPoint`. Generalise to
   a `Set<id>` and hit-test the projected points against a freehand polygon.
3. **Recompute-on-selection** — `DataScientistEngine.analyze()` is pure and already takes rows, so
   a filtered subset can be passed straight back in. Debounce ~150 ms. Guard: below ~12 rows, show
   "selection too small for reliable statistics" rather than a misleading r-value.
4. **Ghosted baseline** — every recomputed panel draws the full-population value behind the
   selection value. Contrast is the insight.
5. **Cosmos ↔ Manifold linking** — selecting a table in Cosmos filters the Manifold to rows from
   that table where the lineage is known.
6. **Clear-selection affordance** — a persistent chip showing `N of M rows selected` with an ✕.

### Risk
Recomputing full `analyze()` on every brush could stutter on larger inputs. Mitigation: debounce,
and add a `fastPath` option that skips the SVG-generation half of `analyze()` when only numbers are
needed for a live update.

### Acceptance
- Selecting in any view updates all others within 200 ms for 5k rows.
- Clearing selection restores the exact original analysis (deep-equal check in a unit test).

---

## Phase 3 — Manifold analytical modes
**Target v2.26.0 · builds directly on existing camera + canvas**

The mode switch at `renderer.ts:22032` makes each of these purely additive.

1. **Neighbour embedding (t-SNE / UMAP-style)** — reveals cluster structure that PCA's linear
   projection flattens away. A Barnes-Hut t-SNE is ~250 lines; run it in a Web Worker with a
   progress indicator, as it is the one genuinely expensive computation here.
2. **Density / contour surface** — kernel density estimate over the projected plane, drawn as
   filled contour bands. Answers "where is the mass", which a scatter of 10k points cannot.
3. **Trajectory trails** — when a date column exists (Phase 1), draw each entity's path through the
   manifold over time. Motion is what makes drift legible.
4. **Raise the row ceiling** — `rows.slice(0, 300)` → configurable `aiForge.data.maxAnalysisRows`
   (default 5,000). Add level-of-detail point culling in the renderer so the canvas stays at 60 fps:
   render all points below ~2k, density-sample above it while keeping every outlier.

---

## Phase 4 — Flow & hierarchy charts
**Target v2.27.0 · pure SVG, matching the existing Waterfall/Tornado approach**

1. **Sankey** — stage-to-stage flow. We already detect `stageColumnName`, so the data is in hand.
   Layered node placement + cubic-Bézier ribbons.
2. **Treemap** — squarified layout for nested contribution. Pairs naturally with the existing Pareto.
3. **Parallel coordinates** — the honest way to show 6+ dimensions at once, with brushing per axis
   (wires directly into Phase 2's `SelectionStore`).
4. Add `'sankey' | 'treemap' | 'parcoords'` to `ChartKind`.

---

## Phase 5 — Geospatial & narrated tour
**Target v2.28.0**

1. **Geospatial** — detect lat/long pairs and country/region names. Bundle a simplified world +
   country TopoJSON (~80 KB) and hand-roll a Mercator projection. No network calls, no
   dependencies, air-gap mode preserved. Delivers choropleth and point-density maps.
2. **Narrated insight tour** — auto-sequence the findings the engine *already* computes into a
   guided, annotated walkthrough: headline → driver → changepoint → outlier cohort → recommended
   action. Pure orchestration over existing output. Very high perceived value for very little code,
   and it is the natural demo script.

---

## 3. Cross-cutting work

| Item | Why |
|---|---|
| `ChartKind` additions land in one pass | `reportBlocks.ts` has a `Record<ChartKind, string>` in `chartWord()` — the compiler will flag every site that must be updated. Let it. |
| Settings | `aiForge.data.maxAnalysisRows` (5000), `aiForge.data.forecastHorizon` (12), `aiForge.data.enableTimeIntelligence` (true) |
| Tests | One suite per new module under `test/suite/offline/`. Analytics are pure — no Electron needed. |
| Docs | Extend `docs/DATA_ANALYSIS.md` per phase; update the CLAUDE.md capability table. |
| CLAUDE.md drift | It currently omits the FDE Cockpit, connected cloud plugins, lineage and query analysis. Worth a correcting pass alongside this work. |

---

## 4. Suggested order of execution

```
v2.25.0  Phase 1 (Time Intelligence) + Phase 2 (Cross-filtering)   ← the release
v2.26.0  Phase 3 (Manifold modes + row-ceiling lift)
v2.27.0  Phase 4 (Flow & hierarchy)
v2.28.0  Phase 5 (Geospatial + narrated tour)
```

Phases 1 and 2 are independent of each other and can be built in parallel. Phase 3's trajectory
trails depend on Phase 1; Phase 4's parallel-coordinates brushing depends on Phase 2.

---

## 5. What success looks like

Not "we support 20 chart types". Rather: a user loads a dataset they have looked at for two years,
and within thirty seconds the tool tells them something they did not know — *when* it changed,
*what* drove it, and *who* it concentrated in — then lets them lasso that group and watch every
other panel re-explain itself around the selection.

That is the wonder. The charts are just how it is proved.
