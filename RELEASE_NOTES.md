# Evolve AI — Release Notes

## Version 2.28.0 — October 7, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Version 2.28.0 introduces enterprise client architecture document ingestion, dual-state topology synthesis, comprehensive 7-tool Virtual Guide conversational assistance, and hardened desktop core file system watchers.

* **Client Document Ingestion Engine:** Native parsing of customer-provided architectural specifications, runbooks, and sequence diagrams in Markdown, PlantUML, and Mermaid (`clientTopologyParser.ts`).
* **Dual-State Topology Synthesis:** Supports importing client-provided current state (Legacy) and future state (Target) topologies, or synthesizing structured topologies from operational runbook prose.
* **PlantUML Transpiler:** Transpiles legacy enterprise PlantUML sequence diagrams directly into clean, compliant Mermaid sequence syntax.
* **Delivery Studio "📥 Import Client Spec" Action:** Dedicated Phase 1 button allowing FDEs to ingest client specs directly into the workspace, updating schema badges and persisting state to `.evolve/fde_state.json`.
* **7-Tool Enterprise Catalog in Virtual Guide:** Interactive guide detailing exact inputs, outputs, and safety guards for `introspect_schema`, `execute_safe_sql`, `vector_search`, `call_enterprise_api`, `mask_sensitive_payload`, and `read_workspace_document`.
* **Full Process Flow & Stuck Guides:** Complete navigational guidance for building greenfield vs brownfield applications, modifying UI/UX components, and unblocking stuck phases.
* **Section 3C MCP Tool Server Studio:** Dual-runtime scaffolding for TypeScript (stdio & Express SSE) and Python (FastMCP with Pydantic v2) with automatic database table tool bindings, Claude Desktop configuration JSON export, and Architectural Decision Records.
* **Dedicated Git & DevOps Activity Hub:** Promoted Git Hub to a dedicated Green Leaf activity pane, streamlining Delivery Studio into 6 focused phases.
* **Core Desktop Engine Hardening:** Enhanced `DesktopWorkspaceManager` with safe error-boundary listeners on `fs.FSWatcher` instances, preventing uncaught EPERM crashes upon directory deletion on Windows workstations.

---

## Version 2.27.0 — September 28, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Version 2.27.0 delivers a critical security overhaul of the enterprise licensing engine alongside Phase 4 (NLP Agent & Pipeline Studio).

* **Zero-Secret Licensing & Cryptographic Key Rotation:** Rotated the master Ed25519 signing keypair. All legacy tokens signed with the old key are invalidated.
* **Decoupled Client-Side Evaluation Trials:** 30-day evaluation trials are now locally tracked in hardware-encrypted OS vaults (`vscode.SecretStorage` / desktop storage). The client extension and desktop app contain zero private keys.
* **Decoupled Administrative Key Generator:** `LicenseGenerator` has been removed from client runtime bundles and is strictly an administrative/offline utility requiring explicit environment secrets.
* **Hardened Serverless Claim OTP Function:** The Supabase edge function now strictly loads `LICENSE_SIGNING_PRIVATE_KEY` from Supabase secrets without fallback to hardcoded keys.
* **Phase 4 NLP Agent & Pipeline Studio:** Interactive multi-model canvas supporting 8 production RAG patterns (Naive, Sentence Window, Auto-Merging, Hierarchical Summarization, HyDE, Fusion RAG, Multi-Hop RAG, Parent-Document).
* **Multi-Model Evaluation Matrix:** Live comparative benchmarking across Gemini 1.5/2.0, Claude 3.5 Sonnet, GPT-4o, Llama 3.3, Mistral Large, Cohere Command R+, DeepSeek V3/R1, and Local Ollama.
* **Interactive Pipeline Simulator:** Real-time token economics, latency measurement, confidence scores, and boundary guardrail interception with human-in-the-loop escalation.
* **Production Scaffolding:** Instant generation of FastAPI microservices, Apache Airflow DAGs, and automated Pytest evaluation test suites.
* **Enforced Pre-Flight Security Checks:** Deployment checklist now enforces an automated Zero-Secret Leak Guard before packaging.

---

## Version 2.26.0 — September 25, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Version 2.26.0 introduces full end-to-end integration of Phase 3 (AI Solutioning), the Model Advisor suite, and automated pipeline verification.

* **Phase 3 AI Solutioning Contract:** Ground-truth problem framing, out-of-scope boundary locks, first-principles invariants, and the Controller's 3 numbers flow seamlessly into Phase 3 solution architecture and executive contracts.
* **Database Schema Bindings:** Discovered tables and column definitions from Phase 2 are bound directly to Level 1 deterministic rule engines, eliminating mock schemas.
* **Auto-Locking Decision Gate:** Evaluating the rule-vs-model gate automatically locks the target capability level across the Capability Ladder, Component Architecture, and Solution Contract.
* **Automated In-Browser Verification Runner:** Direct execution of pipeline verification tests measuring live latency, validating boundary interception with HITL escalation, and verifying 0.0% drift.
* **Canonical Multi-File Scaffolding:** Scaffolds production service code, canonical pipeline contracts, and Vitest/Jest verification suites simultaneously.
* **Model Advisor Suite:** Objective job-centric model selection based on true model capabilities (vision, thinking, embeddings, fill-in-the-middle) with explicit provenance tracking.
* **29 Offline Flowchart Diagrams:** Self-contained vector flowchart rendering with animation support on air-gapped workstations.

---

## Version 2.25.0 — September 22, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Version 2.25.0 is a correctness and trust release for the FDE Delivery Studio.
A full six-phase audit found that generated client documents were stating
figures nobody had measured, so this release makes that structurally impossible.

* **No document states an unmeasured number.** Reliability metrics previously
  fell back to `98.0%`, `49/50` and `18ms` whenever real results were missing —
  which was always, because nothing persisted them. Unmeasured values now render
  as a visible `NOT YET MEASURED` marker instead of a plausible figure.
* **DEMO / LIVE mode.** A switch in the engagement bar marks whether the Studio
  is running on sample data or a real engagement. DEMO documents carry a banner
  identifying them as demonstration artifacts, and DEMO is the default.
* **Honest integrity stamps.** Audit receipts previously claimed Ed25519
  signatures that did not exist. They now record SHA-256 content digests,
  described accurately as tamper-evident rather than digitally signed.
  (Enterprise licensing Ed25519 is genuine and unchanged.)
* **Client-ready deliverables.** Every generated document is also produced as a
  formatted, printable HTML page under `docs/client/`, suitable for sending to a
  client or saving as PDF. They are fully self-contained and open on air-gapped
  machines.
* **Engagement state persists.** Work done in Phases 2 through 5 — connectors,
  the rule-vs-model verdict, the chosen RAG architecture, evaluation results and
  deployment configuration — now survives a restart and flows into the
  documents, which previously fell back to defaults.
* **API SDK scaffolding repaired.** Both TypeScript and Python scaffold buttons
  failed on every use and produced connectors with no authentication header.
  Fixed, with new retry, timeout and rate-limit controls.
* **Client documents are no longer overwritten by accident.** Opening the Runbook
  Factory tab used to rewrite six deliverables in `docs/` with no prompt.

### Known Gaps

Tracked in `docs/FDE_TODO.md`:
* The golden benchmark does not yet execute the system under test. Simulated
  runs are clearly marked and cannot be presented as measured results.
* The advertised Webhook Ingest Studio is not implemented.

---

## Version 2.24.0 — September 21, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Evolve AI version 2.24.0 delivers the complete **Section 3A Interactive Capability Ladder & Comparison Matrix**, **Section 4B Groundedness Gate & Workspace Introspection**, **Section 3C Production RAG Visual Topology**, and **Autonomous Statistical Intelligence Studio**:
* **Section 3A Interactive 5-Level Comparison Matrix**: Complete trade-off analysis across latency, token cost, hallucination SLAs, and governance models for Rule Engine (L1), Semantic Router (L2), Grounded Policy RAG (L3), Tool Agent MCP (L4), and Multi-Agent Swarm (L5). Includes row selection, `[🔍 Blueprint]` inspection, `[🎯 Set Target]` commitment, glowing active indicators, auto-scroll, and Markdown clipboard export.
* **Section 4B Native Workspace File Introspection**: Seamless workspace file selection modal and robust file loading replacing legacy prompt dialogs for zero-error groundedness validation.
* **Section 3C Interactive Vector SVG Flowchart**: Dynamic SVG pipeline flow rendering with visual/code toggles, zoom/pan navigation, 8 canonical RAG architectures matrix, and Level 3 capability ladder integration.
* **Autonomous Statistical Intelligence & 3D Manifold**: Single Dataset Studio upgraded with automated distribution testing, skewness detection, covariance analysis, specialized multi-focus presets (bottlenecks, drivers, outliers, cohorts), and interactive 3D manifold visualizer.
* **Standalone Windows Executable**: Fresh standalone portable binary `evolve-ai-enterprise-portable-2.24.0-win32-x64.exe` for air-gapped enterprise distribution.

---

## Version 2.23.0 — September 17, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Evolve AI version 2.23.0 delivers the full **Section 5D Commercial Suite & Compliance Engines**, complete **Phase 1 Ground-Truth Discovery & Interactive Sequence Topology Studio**, and refreshed enterprise packaging:
* **Interactive SQL Transpiler**: Bi-directional migration of legacy Oracle PL/SQL and SQL Server T-SQL to Snowflake and Google BigQuery with automated dbt headers and dialect AST syntax mapping.
* **Enterprise PII Masking & Tokenization**: Differential privacy, HMAC-SHA256 pseudonymization, and PCI-DSS / GDPR regex redaction with zero raw data leakage.
* **Reverse ETL Sync Engine**: CDC change-capture worker configuration with automated sync streams into Salesforce, HubSpot, Zendesk, and Snowflake.
* **Dynamic Row-Level Security (RLS)**: PostgreSQL, Snowflake, and BigQuery tenant-isolation security policy generator with RBAC rules and session attributes.
* **Synthetic Data & Edge Case Generator**: Referentially intact mock datasets with injected edge cases (nulls, boundary spikes, unicode, leap years).
* **Mock API Sandbox Server**: Standalone Node.js Express and Python FastAPI mock servers generated from OpenAPI specs with latency simulation and fault injection.
* **SLA Load Testing & Stress Engine**: k6 and Locust load testing scripts with virtual user ramps and SLA compliance thresholds.
* **Data Quality Gates & Schema Drift Detection**: Automated Great Expectations, Soda Core, and dbt test suites with CI/CD exit codes.
* **Phase 1 Ground-Truth Discovery & O2S**: 4 Enterprise Archetypes, Gemba Inquiry Probes, First-Principles Invariant Gates, and The Controller's 3 Numbers (Financial ROI).
* **Interactive Sequence Topology Studio**: Real-time editable SVG/Mermaid sequence diagram canvas with preset switching, zoom/pan navigation, and vector exports.
* **Standalone Windows Executable**: Fresh standalone portable binary `evolve-ai-enterprise-portable-2.23.0-win32-x64.exe` for air-gapped enterprise distribution.

---

## Version 2.22.0 — September 15, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Evolve AI version 2.22.0 delivers major enterprise architecture and schema exploration advancements to the **Enterprise Edition**:
* **2D Technical ERD & Celestial 3D Orbit Dual Mode**: Seamless 1-click toggling with responsive 20x14 dynamic grid layout and bounding-box auto-fit zoom for massive enterprise schemas (265+ tables).
* **Column-to-Column Relational Linking**: Exact cubic bezier curves connecting the specific source column pin to the target column pin (`[PK]` to `[FK]`) with illuminated terminal socket pins and dynamic column elevation.
* **Canvas Line Hit-Testing & Hover Tooltips**: Instant detection along bezier curves within 14px, displaying join formulas and cardinality (`orders.order_id = order_items.order_id (1:N)`).
* **Table & Link Isolation Mode**: Click any connection line to dim unrelated tables to 0.04 blueprint ghost opacity and spotlight joined entities with radiant halos, floating canvas HUD, and animated photon particles.
* **Dedicated "🔗 Relationship Deep-Dive & Join Inspector"**: Side-by-side visual column bridge, referential integrity badges, auto-generated ANSI SQL join queries, and 1-click handoffs to Preview Joined Data, Build Dimensional Mart, and Data Studio.
* **Universal Live Database Connection Modal (`#modalLiveDbConnect`)**: Instant connectivity to PostgreSQL, Snowflake, BigQuery, MySQL, and SQLite with 1-click config auto-detection and bidirectional Live DB vs. Demo Star Schema switching.
* **Table Search, Filter & Quick-Jump Toolbar**: Live autocomplete search across tables, schemas, domains, and columns, with 1-click role filter pills (`Facts`, `Dims`, `Bridges`).
* **Standalone Windows Executable**: Fresh standalone portable binary `evolve-ai-enterprise-portable-2.22.0-win32-x64.exe` for air-gapped enterprise distribution.

---

## Version 2.21.0 — September 13, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** MIT (Community Edition) / Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Evolve AI version 2.21.0 expands the Enterprise Edition with the **Data Analysis & Executive Reporting Studio** (featuring sandboxed interactive HTML dashboard previews, KPI ribbons, and print/PDF export styling), along with **Enhanced Multi-Seat Enterprise License Claim & Domain Management** and updated desktop packaging.

---

### 1. Data Analysis & Executive Reporting Studio
* **Sandboxed Interactive HTML Dashboard Previews**: High-performance isolated iframe preview canvas for HTML reports, business intelligence dashboards, and interactive visual data analyses with zero external resource leaks.
* **Executive KPI Ribbon & Stat Cards**: Live visual badges and metric cards summarizing key performance indicators, anomaly indicators, and trend directions.
* **Print & Export Stylesheets**: Native print CSS media queries (`@media print`) and PDF layout optimizations for boardroom-ready client reports and runbook exports.

---

### 2. Enterprise License Claim & Multi-Seat Activation
* **Self-Service Seat Claim Workflow**: Streamlined seat activation supporting per-seat corporate domain validation, claimant ledger tracking, and hardware profile binding.
* **Enhanced Offline Key Verification**: Continued 100% air-gapped cryptographic validation with zero telemetry or outbound network calls required.

---

## Version 2.20.0 — September 11, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** MIT (Community Edition) / Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Evolve AI version 2.20.0 introduces clear tier alignment between the **Free Community Edition** on the VS Code Marketplace and the **Enterprise Edition**, alongside a complete **High-DPI Display Scale & Zoom Manager**, **Ed25519 Commercial Licensing Engine**, and an **Updates & Version Management Hub**.

> 🔒 **Enterprise Evaluation Status**: The Enterprise Edition is available for 30-day technical evaluation and commercial licensing to rigorously evaluate production migration engines in real-world environments.

---

### 1. Free Community Edition Alignment (4-Step Frontline Studio)
The Free VS Code Community Edition focuses on the core frontline delivery toolkit:
* **Step 1: Ingestion & Schema Mapper**: Live database introspection (PostgreSQL, Supabase, Snowflake, BigQuery, MySQL, SQLite) and dbt dimensional data mart generation.
* **Step 2: Client API Studio**: Resilient TypeScript and Python SDK generator with exponential backoff, jitter, and rate-limiting circuit breakers.
* **Step 3: Pre-Flight Health Auditor**: Offline secret leak detection, dangling backup cleaner, and multi-cloud deployment scaffolding (Firebase, Cloud Run, Kubernetes, Docker, Terraform).
* **Step 4: Client IT Handoff & Runbook Factory**: Comprehensive documentation compiler generating `ARCHITECTURE.md` with rendered Mermaid diagrams, `DEPLOYMENT_RUNBOOK.md`, `DATA_DICTIONARY.md`, and `ENVIRONMENT_CATALOG.md`.
* **Clear Tier Distinction**: In-app comparison modals and guidance distinguishing the Community Edition from the commercial Enterprise Edition.

---

### 2. UI Scale, Zoom Manager & High-DPI Readability Engine
* **Native GPU Subpixel Zoom (`webFrame.setZoomFactor`)**: Integrated Electron webFrame scaling providing smooth, proportional window scaling without layout breakage or misaligned resizers.
* **Automatic High-DPI Detection**: Automatically activates 115% Comfort Scale (or 125% on 4K) on first launch for high-resolution displays.
* **Multi-Tiered Interactive Controls**:
  * Top header scale indicator pill (`🔍 100% ▾`) opening the Display Scale & Text Size Popover.
  * Smooth range slider spanning **80% to 175%** with live visual feedback.
  * 6 instant one-click presets: *Compact (90%)*, *Default (100%)*, *Comfort (115%)*, *High-DPI (125%)*, *Large (140%)*, and *4K Ultra (150%)*.
  * 3 Reading Comfort Density Modes: *Compact* (13.5px base), *Balanced* (15px base), and *Large Text* (16.5px base).
* **Shortcuts & Feedback**: Fluid keyboard shortcuts (`Ctrl +`, `Ctrl -`, `Ctrl 0`), `Ctrl + Mouse Wheel` zooming, and subtle animated floating HUD notification toast (`🔍 Zoom: 125%`).
* **Elevated Theme Luminance**: Upgraded text contrast and raised font floors across card grids, file trees, navigation pills, and status bars.

---

### 3. Commercial Licensing & Offline Verification Engine
* **Asymmetric Ed25519 Cryptographic Signatures**: RFC 8032 digital signing supporting both Per-Seat volume licenses and Unlimited Site-wide licenses.
* **Offline Machine Hardware Binding**: Multi-attribute hardware fingerprinting with zero external telemetry or SaaS dependency.
* **In-App License Procurement & Key Import**:
  * "Buy License & Contact Sales" modal with 1-click automated hardware fingerprint binding request generator.
  * 1-click paste and import for signed license tokens and `license.json` files.

---

### 4. Interactive Updates & Version Management Tab
* Embedded **"Updates & Version"** panel in the Settings view.
* **Online GitHub Release Checking**: Fetches the latest published release tags, changelogs, and download links directly from GitHub releases.
* **Air-Gapped Offline Patch Management**: Supports importing and applying offline `.epk` / `.zip` update bundles for isolated defense and banking networks.

---

### 5. Terminal & Workspace Synchronisation
* Added active directory tracking across Windows PowerShell, CMD, and Linux/macOS bash shells.
* Automatically synchronizes the workspace file tree upon terminal directory changes (`cd`) and cross-drive switches.
* Draggable layout resizers between the workspace explorer and terminal drawer with responsive small-screen collapse thresholds.

---

### Supported Platform Targets
This release is built and packaged for all 6 supported platforms:
1. `win32-x64` (Windows 64-bit Intel/AMD)
2. `win32-arm64` (Windows 64-bit ARM)
3. `darwin-x64` (macOS Intel)
4. `darwin-arm64` (macOS Apple Silicon M1/M2/M3/M4)
5. `linux-x64` (Linux 64-bit x86)
6. `linux-arm64` (Linux 64-bit ARM)
