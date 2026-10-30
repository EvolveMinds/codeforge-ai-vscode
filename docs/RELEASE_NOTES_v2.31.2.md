Official standalone portable release of **Evolve AI Enterprise Studio v2.31.2** for Windows x64, 1-Click Pilot Trust Tool (`.zip`), Offline Hot Patch Archive (`.zip`), and VS Code Extension (`.vsix`).

### ⚡ Commercial Enterprise Edition (v2.31.2)

Version 2.31.2 is an enterprise hotfix release resolving domain-native asset delivery, active workspace grounding, enterprise remote CI/CD host resolution, and automated model badge synchronization.

* **Direct Corporate Domain Asset Delivery:** Fully resolved the company download portal asset delivery issue by physically provisioning Authenticode-signed binaries, trust tools, and offline patch bundles directly into static public deployment assets, completely eliminating CloudFront 404 "File wasn't available on site" errors.
* **Enterprise CI/CD Host Detection:** Automatic remote URL resolution for self-hosted GitHub Enterprise (GHE), Bitbucket Data Center, and GitLab, enabling instant 1-click CI/CD navigation.
* **Active Workspace Grounding & Autonomous Inspection:** Copilot chat autonomously discovers workspace structure, active file paths, and attachment/screenshot payloads for grounded reasoning.
* **Gateway Model Extraction & UI Synchronization:** Real-time extraction of live model identifiers from reverse proxy headers with synchronized UI badges and sanitized error history traces.
* **In-Chat Model Selector & Navigation Tools:** Added quick model selector popover, prompt history arrow navigation, message copy and reply toolbar, code block copy buttons, and multi-session storage manager.

### 🛡️ Windows SmartScreen & Corporate Pilot Trust Tool

The executable is digitally signed with the official **Evolve Mind Solutions Pty Ltd (Enterprise Pilot)** Authenticode certificate. 

On test workstations and corporate machines where commercial public root CAs are enforced, you have two simple options to run without SmartScreen interruption:

* **Option 1 (Instant Click-Through)**: Click **More info** → **Run anyway** on the initial SmartScreen notification.
* **Option 2 (1-Click Trust Tool — Recommended for Test Machines)**:
  1. Download the bundled **`evolve-ai-pilot-trust-tool.zip`** from the release assets.
  2. Extract and right-click **`trust-pilot-cert.bat`** → **Run as administrator**.
  3. The batch script installs the certificate into *Trusted Publishers* & *Trusted Root CA* and clears Mark-of-the-Web on downloaded binaries.
  4. Subsequent launches will run directly with **Verified Publisher: Evolve Mind Solutions Pty Ltd (Enterprise Pilot)** and zero SmartScreen prompts!

### 📦 Binary Verification

* **Desktop Executable (Signed)**: `evolve-ai-enterprise-portable-2.31.2-win32-x64.exe`
* **Architecture**: `win32-x64` (Windows 10 / 11 64-bit)
* **Size**: 79.7 MB (83,597,856 bytes)
* **SHA-256**: `4A74F9C5CDD8E3929B80E8CB826D8A934DF5A482714AF3384D57E4A5B75F906D`

* **1-Click Pilot Trust Tool**: `evolve-ai-pilot-trust-tool.zip`
* **Size**: 6.1 KB (6,283 bytes)
* **SHA-256**: `37AEE092BB1804801576E5CE611EFC2C270B4AC2FF629CEC28A664D6B205ABF6`

* **Air-Gapped Patch Archive**: `evolve-ai-enterprise-patch-2.31.2.zip`
* **Size**: 2.6 KB (2,674 bytes)
* **SHA-256**: `8B207ECFE1496F3805EA5C639904018A530C36126B5FB23C06E4404B95E5E461`

* **VS Code Extension Package**: `evolve-ai-2.31.2.vsix`
* **Size**: 151.7 MB (159,022,977 bytes)
* **SHA-256**: `318568581FB85518819B6B2A339DD8A081F16EE75D22FFE6228F413FE139E2B1`

Verify before running:
```powershell
(Get-FileHash 'evolve-ai-enterprise-portable-2.31.2-win32-x64.exe' -Algorithm SHA256).Hash
```

### 🔒 100% Air-Gapped & Sovereign Execution

* Runs completely offline with zero telemetry and zero external SaaS dependencies.
* Sovereign AI model execution with on-prem Ollama, LM Studio, or local API gateways.
