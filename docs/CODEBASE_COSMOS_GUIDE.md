# 🌐 Codebase Cosmos & Git Architecture Intelligence User Guide

> **Evolve AI Desktop Enterprise Edition**  
> **Operational Guarantee**: 100% Offline, Deterministic Graph Analytics, Sub-Second Execution, Air-Gapped / Zero Network Egress.

---

## 1. Overview

Enterprise software modernization often stalls because engineering teams must navigate brownfield codebases with missing documentation, tribal knowledge, and fear of touching monolithic legacy systems. 

**Evolve AI Codebase Cosmos** bridges the gap between historical Git behavior, static source code dependencies, and live database schemas. It runs entirely inside your standalone Windows `.exe` without requiring third-party cloud SaaS subscriptions (e.g., CodeScene) or external LLM API endpoints.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       100% LOCAL DETERMINISTIC ENGINE                       │
│                         Sub-Second Execution (<250ms)                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┴──────────────────────────────┐
        ▼                                                             ▼
┌───────────────────────────────┐             ┌───────────────────────────────┐
│ Door 1: 🌿 Git Repository Hub  │             │ Door 2: 🚀 Delivery Studio    │
│  • 3D/2D Codebase Cosmos      │             │  • Phase 1: Ingest Git Arch   │
│  • Churn & Defect Hotspots    │             │    (Strangler Fig As-Is/To-Be)│
│  • Hidden Temporal Coupling   │             │  • Phase 2: Overlay Code on DB│
│  • Bus Factor & Tarjan Loops  │             │    (Lineage & Satellite Rings)│
└───────────────────────────────┘             └───────────────────────────────┘
```

---

## 2. Door 1: 🌿 Git & Remote Repository Hub

Navigate to the **green leaf icon (🌿)** on the left navigation sidebar.

### 2.1 Scanning the Architecture
Click the **`🌐 Scan Architecture & Hotspots`** button in the top toolbar. In under 1.2 seconds, the engine streams local Git logs and scans source imports across TypeScript, JavaScript, Python, Go, Java, C#, Rust, and SQL.

### 2.2 Subview Navigation
Beneath the repository summary cards, switch across the 4 specialized views:

1. **`📄 Working Tree & Sync`**:
   - Branch lifecycle, staged changes, commit messages, push/sync, and PR creation.
2. **`🌐 3D/2D Codebase Cosmos`**:
   - **Interactive Visualizer**: 3D celestial sphere projection and 2D physics layout.
   - **Visual Cues**:
     - 🔴 **Red Spheres**: High-volatility hotspots with combined high churn, frequent bug fixes, and complexity.
     - 🟠 **Orange Spheres**: Strangler modernization targets.
     - 🟢 **Green Spheres**: Stable core foundation (preserve).
     - 🟣 **Violet Pulsing Rings**: Components linked to database tables.
     - 💡 **Photon Particles**: Animated particles flowing along dependency edges.
   - **HUD Controls**:
     - `2D/3D`: Toggle between 3D celestial view and 2D force layout.
     - `🔄 Turntable`: Auto-rotates the 3D sphere cloud for presentations.
     - `➕ / ➖`: Zoom in and out.
     - `⛶ Fit`: Center and scale the entire cosmos.
     - `Filter / Search`: Filter by Subsystem (Backend, Frontend, FDE, DB, Shared) or search filenames in real time.
   - **Node Inspector (Right Panel)**:
     - Click any node to inspect physical lines of code, commit frequency, lines churned, bug-fix commits, primary author, modernization category, and connected database tables.
3. **`🔥 Hotspots & Defect Density`**:
   - Ranked leaderboard of files with high volatility scores.
   - Displays commit counts, churn lines, and bug-fix ratios (`fix:`, `bug:`, `defect:`, `hotfix:`).
4. **`👥 Bus Factor & Knowledge Map`**:
   - **Author Distribution**: Primary authors and file ownership concentration. Alerts on single points of failure.
   - **Tarjan's Circular Dependencies**: Identifies circular dependency loops (`A ➔ B ➔ C ➔ A`) that cause brittle builds and tight coupling.
   - **Orphaned Dead Code**: Identifies dormant files with 0 in-degree and 0 recent churn.

---

## 3. Door 2: 🚀 Delivery Studio Integration

### 3.1 Phase 1 (Step 3: Discovery Archetypes & Brownfield Architecture)
- Click **`🌿 Ingest Brownfield Git`** in the topology toolbar.
- The engine categorizes components into the **Strangler Fig Pattern**:
  - `Preserve`: Stable, well-tested core models.
  - `Strangle`: High-risk monolithic hotspots to be decoupled into modern microservices, event streams, or AI agents.
  - `Retire`: Dormant and orphaned dead code.
- Auto-generates executable **Mermaid As-Is (Legacy Bottlenecks)** and **To-Be (Proposed Modern AI Architecture)** sequence diagrams directly into the architecture editor.

### 3.2 Phase 2 (Step 2: 3D Data Cosmos & Schema Topology)
- In the 3D Database Data Cosmos (and Data Analysis Studio), click **`🔗 Overlay Codebase`**.
- The engine cross-references database tables against codebase source files, ORM entities (Prisma, TypeORM, SQLAlchemy, Hibernate), and SQL statements.
- **Visual Display**:
  - Database table nodes display **pulsating violet orbital rings** and **orbiting satellite badges** showing the count of connected code files.
  - In 2D Technical ERD mode, table cards display a `💻 [Count]` badge.
  - Selecting any table opens the **Table Spotlight Inspector** featuring the **Connected Code Files & Services** list with 1-click clipboard path copying.

---

## 4. Technical Architecture & Formulas

### 4.1 Hotspot Volatility Scoring
$$\text{HotspotScore} = \min\left(100, \frac{\text{Commits}}{C_{\max}} \times 40 + \frac{\text{ChurnLines}}{L_{\max}} \times 40 + \min(20, \text{DefectCount} \times 4)\right)$$

### 4.2 Temporal Coupling (Jaccard Similarity)
For any pair of files $(A, B)$ committed in the repository history:
$$J(A, B) = \frac{|C_A \cap C_B|}{|C_A \cup C_B|}$$
Pairs with $|C_A \cap C_B| \ge 3$ and $J(A, B) \ge 0.40$ are surfaced as hidden architectural couplings.

### 4.3 Circular Dependency Detection
Uses **Tarjan’s Strongly Connected Components (SCC)** algorithm running in $O(V + E)$ linear time to detect circular reference cycles.

---

## 5. Air-Gapped & Enterprise Compliance
- **Zero Network Calls**: Pure local Node child process execution (`git log`) and local file reading.
- **Zero Cloud Dependencies**: No LLM API keys or cloud tokens required.
- **Enterprise Portable**: Runs out-of-the-box from `evolve-ai-enterprise-portable-2.28.0-win32-x64.exe`.
