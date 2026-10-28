Official standalone portable release of **Evolve AI Enterprise Studio v2.31.1** for Windows x64, 1-Click Pilot Trust Tool (`.zip`), Offline Hot Patch Archive (`.zip`), and VS Code Extension (`.vsix`).

### ⚡ Commercial Enterprise Edition (v2.31.1)

Version 2.31.1 is an enterprise operational hotfix addressing corporate SSL inspection proxies, internal AI gateways, custom base URLs, self-contained trust tooling, and direct API key testing.

* **Embedded 1-Click Trust Certificate Tool:** The public pilot certificate is now embedded directly inside `trust-pilot-cert.bat` and `trust-pilot-cert.ps1`. Works 100% standalone anywhere without requiring sibling files or extracting archives first.
* **Corporate SSL Inspection Proxy Compatibility:** Automatic handling of enterprise TLS interception (Zscaler, Netskope, Fortinet, Palo Alto) preventing `self signed certificate in certificate chain` errors on office workstations.
* **Enterprise AI Gateway & Custom Base URLs:** Native support for `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` for routing through corporate proxies (LiteLLM, Cloudflare AI Gateway, Portkey, Azure APIM, PrivateLink).
* **Dual Header Auth (`ANTHROPIC_AUTH_TOKEN`):** Automatic support for Bearer tokens alongside standard `x-api-key` headers.
* **In-App 1-Click "⚡ Test Key" Health Check:** Instant verification of API keys and connectivity inside Settings.
* **Frontier Model Alias Resolver:** Maps futuristic catalogue names to active upstream provider models to eliminate 404 Model Not Found errors.
* **Cleaned Header Bar:** Removed the redundant "Live DB" button from the top navigation bar.

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

* **Desktop Executable (Signed)**: `evolve-ai-enterprise-portable-2.31.1-win32-x64.exe`
* **Architecture**: `win32-x64` (Windows 10 / 11 64-bit)
* **Size**: 79.6 MB (83,500,752 bytes)
* **SHA-256**: `3E49460AC1E9448EFD720209049E24D8D6711A09FE917E8A316E4D1E9955CBD1`

* **1-Click Pilot Trust Tool**: `evolve-ai-pilot-trust-tool.zip`
* **Size**: 6.1 KB (6,283 bytes)
* **SHA-256**: `F95FF1A6596B21A37FC239CA4784424C67D6D3CA7F07B752B2D0B85F84DBF260`

* **Air-Gapped Patch Archive**: `evolve-ai-enterprise-patch-2.31.1.zip`
* **Size**: 2.6 KB (2,674 bytes)
* **SHA-256**: `B5216B53FFF5BE5941F4B8E15FC6900CB7E38AF91F0178DA149D08337DF3B19D`

* **VS Code Extension Package**: `evolve-ai-2.31.1.vsix`
* **Size**: 151.6 MB (158,966,710 bytes)
* **SHA-256**: `507973E77A58BE3FFF6F80EEB16F5AA44FC531DC04A09DFE6DC19D090A0CD555`

Verify before running:
```powershell
(Get-FileHash 'evolve-ai-enterprise-portable-2.31.1-win32-x64.exe' -Algorithm SHA256).Hash
```

### 🔒 100% Air-Gapped & Sovereign Execution

* Runs completely offline with zero telemetry and zero external SaaS dependencies.
* Sovereign AI model execution with on-prem Ollama, LM Studio, or local API gateways.
