Official standalone portable release of **Evolve AI Enterprise Studio v2.31.0** for Windows x64 and Offline Hot Patch Archive (`.zip`).

### ⚡ Commercial Enterprise Edition (v2.31.0)

Version 2.31.0 introduces the **IBM Mainframe (z/OS) & iSeries (AS/400 TN5250) Modernization Studio**, bringing enterprise terminal emulation, natural language Control Language (CL) command navigation, dual-view CRT/modern cards, 1-click OpenAPI 3.0 and React component scaffolding, robust connection validation decks, and an enhanced Pre-Flight Neural & AST Debugger cockpit.

* **IBM iSeries (AS/400 TN5250) & z/OS Modernization Engine:** Integrated terminal emulation engine (`mainframeScreenEngine.ts`) with out-of-the-box screen templates (`MAIN`, `WRKACTJOB`, `WRKSYSSTS`, `WRKSPLF`, `DSPMSG`, `STRSQL`, `ISPF_PRIM`, `SDSF_DA`, `CICS_CEMT`), clickable menu hotspots, and keyboard F-key navigation.
* **Dual-View Cockpit (Phosphor CRT ⇄ Modern Web Card View):** Real-time dual display allowing forward-deployed engineers to inspect raw terminal greenscreens or interact with modern card interfaces and data tables.
* **Ask Copilot Natural Language Command Navigator:** Natural language intent resolver translating plain English into AS/400 CL and z/OS commands (`WRKACTJOB`, `WRKSYSSTS`, `WRKSPLF`, `STRSQL`, `DSPMSG`).
* **1-Click OpenAPI 3.0 & React 18 Scaffolder:** Generates production-ready REST API specifications and React 18 modernization components directly from active mainframe screens.
* **Strict Connection Parameters Validation:** Pre-flight credential checks ensuring Host, Port, User, and Password fields are validated before live TN5250, TN3270, or z/OSMF attempts with dedicated inline diagnostics deck.
* **Pre-Flight Neural, AST & Flow Debugger Cockpit:** Re-engineered visual layout with dedicated pre-flight checks, tensor shape visualizer, and DataFrame schema sniffer.
* **Dedicated Plugin Navigation & Stack Icon Separation:** Distinct sidebar branding and menu separation between the IBM Mainframe Modernization Studio (`🖥️`) and Polyglot AI Coding Studio (`💻`).

### ⚠️ First Launch on Windows

This executable is **not code-signed**. On first run, Windows SmartScreen will show *"Windows protected your PC"*.

To proceed: click **More info** → **Run anyway**.

This is expected for an unsigned binary and does not indicate a problem with the download. Verify the SHA-256 below to confirm the file is exactly what we published.

### 📦 Binary Verification

* **Desktop Executable**: `evolve-ai-enterprise-portable-2.31.0-win32-x64.exe`
* **Architecture**: `win32-x64` (Windows 10 / 11 64-bit)
* **Size**: 79.6 MB (83,486,697 bytes)
* **SHA-256**: `3B63A47CB371AB41A67BF2EEA2BA640569D26AF45A677B3F027F637D7C113386`

* **Air-Gapped Patch Archive**: `evolve-ai-enterprise-patch-2.31.0.zip`
* **Size**: 4.2 KB (4,257 bytes)
* **SHA-256**: `68C852857CD134CB125F99B2E41063FF00586BD0D65BC19BBA8C9A913A62D0C7`

Verify before running:
```powershell
(Get-FileHash 'evolve-ai-enterprise-portable-2.31.0-win32-x64.exe' -Algorithm SHA256).Hash
```

### 🔒 100% Air-Gapped & Sovereign Execution

* Runs completely offline with zero telemetry and zero external SaaS dependencies.
* Standalone single executable — no installation, no registry modifications, **no administrator privileges**, and no external runtime requirements.
* Proprietary Commercial Enterprise Edition licensed by Evolve Mind Solutions Pty Ltd.
