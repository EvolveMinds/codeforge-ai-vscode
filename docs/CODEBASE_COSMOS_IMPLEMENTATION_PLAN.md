# 🌐 Codebase Cosmos & Git Architecture Intelligence: Implementation Plan

> **Target Version**: v2.29.0  
> **Status**: Approved Architecture Blueprint  
> **Operational Guarantee**: 100% Deterministic, Air-Gapped, Zero-Cloud Network Egress, Sub-Second Execution inside Standalone `.exe`

---

## 1. Executive Summary & Problem Statement

Modern enterprise software modernization often fails because architects and Forward Deployed Engineers (FDEs) must either:
1. **Guess existing system architecture** by reading thousands of disconnected source files, or
2. **Rely on static-only linters** (e.g., SonarQube) that measure line counts but are blind to developer churn, bug hotspots, and temporal dependencies, or
3. **Use expensive cloud SaaS tools** (e.g., CodeScene at $20k–$100k/year) that require uploading sensitive enterprise source code to the third-party cloud—a complete non-starter for banking, defense, and healthcare.

**Evolve AI Solution**:
A native, 100% offline **Codebase Cosmos & Brownfield Git Intelligence Engine** built directly into the standalone Desktop `.exe`. In under 250 milliseconds, it mines the local `.git` repository, parses source code imports across 8+ languages, models behavioral code churn and temporal coupling, connects live database schemas directly to code modules, and automatically synthesizes **Current State (As-Is)** and **Proposed Modernized (To-Be)** workflow topologies in Phase 1 and Phase 3.

---

## 2. System Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 LOCAL DESKTOP STUDIO (.EXE RUNTIME)                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ FRONTEND VIEWPORT: "TWO-DOOR, ONE-ROOM" UX ]                                                  │
│                                                                                                  │
│   ┌──────────────────────────────────────────────┐  ┌─────────────────────────────────────────┐  │
│   │ DOOR 1: 🌿 Git & Remote Repository Hub       │  │ DOOR 2: 🚀 Delivery Studio (Phases 1-3) │  │
│   │  • [📝 Staging & Commits]                    │  │  • Phase 1: [⚡ Ingest Git Brownfield]   │  │
│   │  • [🌐 3D/2D Codebase Cosmos & Hotspots]     │  │  • Phase 2: [🔗 Overlay Code on DB]     │  │
│   │  • [🔥 Churn & Defect Heatmap]               │  │  • Phase 3: [Auto-Generated To-Be Gate] │  │
│   └──────────────────────┬───────────────────────┘  └────────────────────┬────────────────────┘  │
│                          │                                               │                       │
│                          └───────────────────────┬───────────────────────┘                       │
│                                                  │                                               │
│                                       IPC Channels (Desktop Bridge)                              │
│                                                  │                                               │
│  [ BACKEND ENGINE: src/fde/codebaseGraph/ (100% OFFLINE, ZERO NETWORK) ]                         │
│                                                                                                  │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│   │ 1. GitLogMiner (git log --numstat, Jaccard co-churn, defect density, bus factor)          │  │
│   ├───────────────────────────────────────────────────────────────────────────────────────────┤  │
│   │ 2. DependencyGrapher (AST/regex import scanner: TS/JS/PY/GO/JAVA/CS/RS/SQL, cycle detect) │  │
│   ├───────────────────────────────────────────────────────────────────────────────────────────┤  │
│   │ 3. TemporalCoupler (Cross-module hidden coupling matrix & co-commit clusters)             │  │
│   ├───────────────────────────────────────────────────────────────────────────────────────────┤  │
│   │ 4. CodeToDbLinker (Cross-references code SQL/ORM entities to introspected DB tables)      │  │
│   ├───────────────────────────────────────────────────────────────────────────────────────────┤  │
│   │ 5. BrownfieldSynthesizer (Strangler Fig classifier: Keep / Strangle / Modernize / Retire) │  │
│   └───────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                  │                                               │
│                                                  ▼                                               │
│                                  Local .git & Workspace File System                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Modules Specification (`src/fde/codebaseGraph/`)

All modules adhere strictly to Evolve AI's offline engine philosophy: **pure functions, zero external npm dependencies, deterministic execution, and graceful degradation**.

### Module 1: `gitLogMiner.ts`
- **Purpose**: Mines historical commit churn, file volatility, bug fix frequency, and developer ownership.
- **Execution**: Runs `git log --numstat --date=iso --format="COMMIT|%H|%an|%ae|%ad|%s"` via local `execFile` with max buffer 20MB.
- **Metrics Computed**:
  - `churnCount`: Total additions + deletions over the last 90 days and all-time.
  - `commitFrequency`: Number of commits touching each file.
  - `defectScore`: Count of commit messages matching bug patterns:
    `/\b(fix|bug|patch|issue|incident|defect|hotfix|resolve|closes)\b/i`.
  - `hotspotScore`: $\text{Hotspot} = \text{Normalized Commits} \times \text{Normalized Churn} \times (1 + 0.5 \times \text{Defect Score})$.
  - `busFactor`: Author distribution entropy per directory. Alerts when a single author accounts for $>80\%$ of commits on a high-churn subsystem.

### Module 2: `dependencyGrapher.ts`
- **Purpose**: Builds the static directed module dependency graph (DAG) across multi-language enterprise repositories.
- **Supported Languages**:
  - **TypeScript / JavaScript**: `import ... from '...'`, `require('...')`, dynamic `import()`.
  - **Python**: `import ...`, `from ... import ...`.
  - **Java / Kotlin**: `import com.corp.pkg...`.
  - **Go**: `import ( "..." )`.
  - **C# / .NET**: `using ...;`.
  - **Rust**: `use crate::...`, `mod ...;`.
  - **SQL**: `SELECT ... FROM [table]`, `JOIN [table]`, `CREATE TABLE`, `INSERT INTO`.
- **Topological Algorithms**:
  - **Tarjan’s Strongly Connected Components (SCC)**: Detects circular dependency loops.
  - **PageRank / In-Degree**: Identifies architectural hub modules (critical bottlenecks).
  - **Orphan Detection**: Identifies dead or unreachable files with in-degree = 0 and out-degree = 0.

### Module 3: `temporalCoupler.ts`
- **Purpose**: Uncovers invisible architectural coupling where files are repeatedly committed together despite no direct import statement.
- **Algorithm**:
  - For each pair of files $(A, B)$ committed in the same commit:
    $$\text{Jaccard Similarity}(A, B) = \frac{|C_A \cap C_B|}{|C_A \cup C_B|}$$
    where $C_X$ is the set of commits touching file $X$.
  - Filters pairs with $|C_A \cap C_B| \ge 4$ and $\text{Jaccard} \ge 0.65$.
  - Flags **Architectural Smells**: High temporal coupling between different architectural layers (e.g., UI component tightly coupled to database migration script).

### Module 4: `codeToDbLinker.ts`
- **Purpose**: Connects live database tables (introspected via `.env` or live DB connector) to codebase files.
- **Extraction Rules**:
  - Extracts table identifiers from SQL queries, ORM schema declarations (Prisma models, TypeORM `@Entity`, SQLAlchemy `__tablename__`, Hibernate `@Table`).
  - Matches discovered table names against the active `DatabaseSchema` in Evolve AI.
  - Outputs a bidirectional map: `Table -> [Files Touching Table]` and `File -> [Tables Queried]`.

### Module 5: `brownfieldSynthesizer.ts`
- **Purpose**: Synthesizes the brownfield analysis into actionable modernization deliverables for Delivery Studio.
- **Strangler Fig Categorization**:
  - 🟢 **Preserve (Core)**: Low churn, low defect density, high stability. Keep untouched.
  - 🟠 **Strangle & Modernize (Target)**: High churn, high defect density, circular imports, monolithic coupling. Candidate for microservice extraction, event streaming, or AI agent delegation.
  - 🔴 **Retire (Dead Weight)**: Zero churn for >2 years, zero incoming dependencies, orphaned models.
- **Mermaid Sequence Generation**: Automatically generates valid `sequenceDiagram` syntax representing the **As-Is Workflow** and **Proposed To-Be Modernized Workflow** for direct ingestion into Phase 1 Step 3.

---

## 4. TypeScript Interface Definitions

```typescript
export interface CodeNode {
  id: string;               // Normalized relative file path (e.g., "src/billing/service.ts")
  label: string;            // Basename ("service.ts")
  directory: string;        // Parent directory ("src/billing")
  language: string;         // "typescript", "python", "sql", etc.
  linesOfCode: number;      // Physical line count
  commitCount: number;      // Number of commits touching this file
  churnLines: number;       // Additions + deletions
  defectCount: number;      // Bug-fix commit matches
  hotspotScore: number;     // Normalized 0.0 - 100.0 volatility score
  isHotspot: boolean;       // Top 10% volatility flag
  primaryAuthor: string;    // Author with highest commit share
  busFactorRisk: boolean;   // True if primary author > 80% and churn is high
  linkedTables: string[];   // Database tables referenced in this file
  modernizationCategory: 'preserve' | 'strangle' | 'retire' | 'neutral';
  inDegree: number;         // Count of incoming imports
  outDegree: number;        // Count of outgoing imports
}

export interface CodeLink {
  source: string;           // File ID
  target: string;           // File ID
  type: 'import' | 'temporal' | 'data-access';
  weight: number;           // Coupling strength / frequency
  label?: string;
}

export interface CodebaseAnalysisResult {
  repoPath: string;
  totalFiles: number;
  totalCommitsParsed: number;
  hotspots: CodeNode[];
  temporalCouplings: Array<{ fileA: string; fileB: string; score: number; coCommits: number }>;
  circularDependencies: string[][];
  orphanedFiles: string[];
  dbLinkages: Array<{ table: string; files: string[] }>;
  asIsMermaidDiagram: string;
  toBeMermaidDiagram: string;
  summary: {
    criticalHotspotCount: number;
    busFactorWarningCount: number;
    circularLoopCount: number;
    modernizationCandidates: number;
  };
}
```

---

## 5. Desktop IPC & Studio Integration

### IPC Channels (`src/desktop/main/ipcHandlers.ts`)
```typescript
DESKTOP_CHANNELS.GIT.ANALYZE_CODEBASE = 'git:analyzeCodebase';
DESKTOP_CHANNELS.GIT.GET_CODEBASE_GRAPH = 'git:getCodebaseGraph';
DESKTOP_CHANNELS.GIT.GET_HOTSPOTS = 'git:getHotspots';
DESKTOP_CHANNELS.GIT.GENERATE_MODERNIZATION_TOPOLOGY = 'git:generateModernizationTopology';
```

### Preload Exposure (`src/desktop/main/preload.ts`)
```typescript
git: {
  // Existing channels: inspect, sync, commit, push, createBranch, etc.
  analyzeCodebase: (options?: { maxCommits?: number }) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.ANALYZE_CODEBASE, options),
  getCodebaseGraph: () =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.GET_CODEBASE_GRAPH),
  generateModernizationTopology: (target: 'as-is' | 'to-be' | 'both') =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.GIT.GENERATE_MODERNIZATION_TOPOLOGY, target),
}
```

---

## 6. UI & Visualization Specification ("Two-Door, One-Room")

### Door 1: 🌿 Git & Remote Repository Hub (`#pane-git`)
In `src/desktop/renderer/index.html`, add a multi-view toggle bar beneath the Git Header:
```html
<div class="git-subview-nav" style="display: flex; gap: 8px; margin-bottom: 16px;">
  <button id="btnGitViewWorkingTree" class="btn-quick active">📝 Working Tree & Sync</button>
  <button id="btnGitViewCodebaseCosmos" class="btn-quick">🌐 Codebase Cosmos (3D/2D Graph)</button>
  <button id="btnGitViewHotspots" class="btn-quick">🔥 Hotspots & Defect Density</button>
  <button id="btnGitViewBusFactor" class="btn-quick">👥 Bus Factor & Knowledge Map</button>
</div>
```

- When **🌐 Codebase Cosmos** is selected:
  - Renders interactive canvas powered by `CodebaseCosmosEngine` (using our existing pure 2D/3D canvas math from `DataCosmosEngine`).
  - **Node Coloring**:
    - 🔴 Red: Critical Hotspot (high churn + complexity + bugs).
    - 🟠 Orange: Strangler Modernization Candidate.
    - 🟢 Green: Stable Core (preserve).
    - 🔵 Blue: Database / Data-access layer.
  - **Link Rendering**:
    - Solid cyan lines: Static code imports.
    - Dashed gold lines: Temporal coupling (files that change together).
    - Purple lines: Code-to-Database entity links.
  - **Interactive Inspector**: Clicking any node opens a deep sidebar showing file metrics, primary author, defect history, temporal partners, and 1-click refactor options.

### Door 2: 🚀 Delivery Studio Phase 1 (Topology) & Phase 2 (Data Cosmos)
- **Phase 1 Step 3 (Workflow Topology)**:
  - Add button: `[⚡ Ingest Brownfield Git Repo]`.
  - Clicking this triggers `api.git.generateModernizationTopology()` and instantly populates the **Current State Topology (As-Is)** and **Proposed Target (To-Be)** sequence diagrams without manual diagramming.
- **Phase 2 (3D Data Cosmos)**:
  - Add toggle: `[🔗 Overlay Code Repository]`.
  - Tables in the 3D database cosmos display pulsating satellite nodes representing the backend services and API routes that query them.

---

## 7. Phased Implementation Roadmap

```
PHASE A: Core Backend Analyzers (src/fde/codebaseGraph/)
  ├── Task A.1: gitLogMiner.ts (churn, defect score, author stats)
  ├── Task A.2: dependencyGrapher.ts (AST/regex import scanner & cycle detection)
  ├── Task A.3: temporalCoupler.ts (Jaccard co-commit correlation matrix)
  ├── Task A.4: codeToDbLinker.ts (SQL & ORM entity matcher)
  ├── Task A.5: brownfieldSynthesizer.ts (Strangler classification & Mermaid generator)
  └── Task A.6: Automated unit test suite (test/suite/fde/codebaseGraph.test.ts)

PHASE B: Desktop IPC & Preload Integration
  ├── Task B.1: Register channels in DESKTOP_CHANNELS
  ├── Task B.2: Implement main process IPC handlers in ipcHandlers.ts with in-memory cache
  └── Task B.3: Expose bridge methods in preload.ts

PHASE C: Frontend Canvas & Git Hub Visualizer (Door 1)
  ├── Task C.1: Add subview navigation buttons in index.html (#pane-git)
  ├── Task C.2: Implement CodebaseCosmosEngine in renderer.ts (reusing 2D/3D physics)
  ├── Task C.3: Build Hotspot Heatmap & Bus Factor risk cards in renderer.ts
  └── Task C.4: Node inspection flyout with 1-click actions

PHASE D: Delivery Studio Cross-Linkage (Door 2)
  ├── Task D.1: Add [⚡ Ingest Brownfield Git Repo] in Phase 1 Step 3
  ├── Task D.2: Wire As-Is and To-Be Mermaid topology injection into Step 3 editor
  └── Task D.3: Add [🔗 Overlay Code Repository] toggle to Phase 2 3D Data Cosmos

PHASE E: End-to-End Verification & Documentation
  ├── Task E.1: Run full test suite (`pnpm test` & offline regression tests)
  ├── Task E.2: Verify zero network calls in air-gapped / airplane mode
  └── Task E.3: Update user manuals and release documentation
```

---

## 8. Verification & Acceptance Criteria

1. **Air-Gapped Guarantee**: The entire analysis must run in airplane mode (zero internet connection) with 0 network calls.
2. **Execution Latency**: Analyzing a repository with 10,000 commits and 1,500 files must complete in $\le 500\text{ ms}$.
3. **Memory Footprint**: Heap usage must not exceed 60MB during log streaming and graph construction.
4. **Zero Regressions**: Existing Git remote operations (sync, stage, commit, push, PR creation) must remain 100% operational.
5. **Topology Quality**: Auto-generated Mermaid sequence diagrams must compile cleanly through Evolve AI’s built-in offline SVG diagram renderer.
