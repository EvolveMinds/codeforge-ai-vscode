# Evolve AI — Release Notes

## Version 2.20.0 — September 11, 2026

**Publisher:** `codeforge-ai`  
**Company:** [Evolve Mind Solutions Pty Ltd](https://www.evolveminds.com.au/)  
**License:** MIT (Community Edition) / Proprietary Commercial (Enterprise Edition)

---

### Highlights & Summary

Evolve AI version 2.20.0 introduces clear tier alignment between the **Free Community Edition** on the VS Code Marketplace and the **Commercial Enterprise Edition**, alongside a complete **High-DPI Display Scale & Zoom Manager**, **Ed25519 Commercial Licensing Engine**, and an **Updates & Version Management Hub**.

---

### 1. Free Community Edition Alignment (4-Step Frontline Studio)
The Free VS Code Community Edition focuses on the core frontline delivery toolkit:
* **Step 1: Ingestion & Schema Mapper**: Live database introspection (PostgreSQL, Supabase, Snowflake, BigQuery, MySQL, SQLite) and dbt dimensional data mart generation.
* **Step 2: Client API Studio**: Resilient TypeScript and Python SDK generator with exponential backoff, jitter, and rate-limiting circuit breakers.
* **Step 3: Pre-Flight Health Auditor**: Offline secret leak detection, dangling backup cleaner, and multi-cloud deployment scaffolding (Firebase, Cloud Run, Kubernetes, Docker, Terraform).
* **Step 4: Client IT Handoff & Runbook Factory**: Comprehensive documentation compiler generating `ARCHITECTURE.md` with rendered Mermaid diagrams, `DEPLOYMENT_RUNBOOK.md`, `DATA_DICTIONARY.md`, and `ENVIRONMENT_CATALOG.md`.
* **Clear Tier Distinction**: Direct in-app links to explore and procure the Commercial Enterprise Edition for advanced transpilation, synthetic data, reverse ETL, and team site licensing.

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
