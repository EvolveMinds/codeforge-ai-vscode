# Evolve AI — Local (Community) vs. Paid (Enterprise) Management Guide

> **Official Architecture, Licensing & Operations Specification**  
> **Evolve Mind Solutions Pty Ltd** • Copyright © 2026. All rights reserved.

---

## 1. Executive Summary & Management Philosophy

Evolve AI uses a **unified single-codebase architecture** to deliver both the **Local / Community Edition** and the **Paid / Enterprise Commercial Edition**. 

### Core Design Principles
1. **Zero Code-Fork Overhead**: Both Community and Enterprise editions share the same Git branch (`main`) and core compilation pipeline (`npm run compile`). This guarantees that bug fixes, security patches, and performance optimizations are immediately available across all tiers without cherry-picking or merge conflicts.
2. **100% Air-Gapped & Offline Guarantee**: Neither edition requires an external internet connection, SaaS cloud dependency, or phone-home telemetry. All validation occurs strictly on the local machine using compiled deterministic engines, local vector databases, and offline asymmetric cryptography.
3. **Clean Runtime Feature Flag Boundary**: Enterprise capabilities are gated through an in-memory license state manager (`LicenseManager`) and hardware-encrypted local secret storage. If no license key is present, the app runs cleanly as the **Local Community Edition** without errors, warnings, or missing dependencies.

---

## 2. Summary of Recent Changes

The following end-to-end capabilities were recently engineered and verified across the codebase:

### Phase 1: AI Framing, Discovery & Version Control
- **AI Raw Ask Reframing & Risk Audit**: Implemented `DESKTOP_CHANNELS.FDE.AI_ANALYZE_RAW_ASK` to parse noisy client requests, expose operational risks (arithmetic drift, PII leaks, lack of SOX audit logs), formulate reframed production goals, and automatically inject out-of-scope boundary locks.
- **Sequence Workflow Topology Synthesizer**: Implemented `DESKTOP_CHANNELS.FDE.AI_GENERATE_TOPOLOGY` generating context-aware Mermaid sequence diagrams for both `🟢 Proposed AI Workflow` and `🔴 Legacy Bottlenecks`.
- **Scope Version Control & Snapshot Engine**: Implemented snapshotting in `.evolve/scope_versions.json` and `docs/discovery/SCOPE_v1.X.md` with active version badges, history dropdowns, and 1-click restore.
- **Client Alignment Memorandum & Brief Export**: Generates executive-ready deliverables `docs/SCOPE_ALIGNMENT_MEMO.md` and `docs/SCOPE_ALIGNMENT_BRIEF.html` with printable styling and PDF export.

### Phase 3: FDE 1–5 Capability Ladder Redesign (Section 3A)
- **Overhauled 5-Level Architecture Target**:
  - **Level 1 (Rule Engine & SQL)**: `<5ms` latency, zero tokens, zero hallucinations (FinOps, AP invoices, statutory tax, SOX limits).
  - **Level 2 (Semantic Router)**: `<30ms` latency, 98% precision (support triage, language routing, intent dispatch).
  - **Level 3 (Grounded Policy RAG)**: `<150ms` latency, 100% verified citations, 128-token semantic chunks, Ed25519 audit receipts.
  - **Level 4 (Tool Agent MCP)**: `1–3s` latency, Model Context Protocol, read-only sandboxed database and VPC API execution.
  - **Level 5 (Multi-Agent Swarm)**: `5–15s` latency, autonomous multi-role state machine with mandatory Human-in-the-Loop (HITL) supervisor gates.
- **Interactive 4-Tab Deep-Dive Canvas**:
  - `📖 Capabilities & Use Cases`: 5-KPI SLA strip, plain-English summary, 3 production use cases, ASCII topology, boundary warnings.
  - `⚡ Live Test Simulator`: In-studio interactive playground testing rule gates, semantic routes, RAG citations, MCP tool schemas, and swarm supervisor escalations.
  - `💻 Production Code`: Production TypeScript boilerplate with 1-click workspace scaffolding into `src/solution/level_X_...ts`.
  - `📊 5-Level Comparison Matrix`: Side-by-side SLA table emphasizing the **FDE Rule of Parsimony** (*always deliver at the lowest capability level that solves the problem*).

---

## 3. Where Code Lives: Folder & File Directory Map

The table below details where every component lives in the repository and how it relates to Local vs. Paid tiers:

```
d:\EvolveMInds\EvolveAI\
├── src\
│   ├── core\                               # [SHARED] Service container, interfaces, event bus, AI service
│   │   ├── aiService.ts                    # Multi-provider AI interface (Ollama, Anthropic, Gemini, OpenAI, Offline)
│   │   └── services.ts                     # Dependency injection root
│   │
│   ├── desktop\                            # [SHARED] Electron Desktop Application Architecture
│   │   ├── main\
│   │   │   ├── main.ts                     # Electron main process entry point & window lifecycle
│   │   │   ├── ipcHandlers.ts              # IPC channel registry (FDE, Terminal, Workspace, AI, License)
│   │   │   ├── licenseAuth.ts              # Desktop license authenticator & hardware fingerprinting
│   │   │   ├── terminalManager.ts          # Embedded streaming terminal manager
│   │   │   ├── workspaceManager.ts         # Local file tree, file reader/writer, and project inspector
│   │   │   └── secretVault.ts              # Hardware-backed DPAPI/Keychain local encryption
│   │   ├── renderer\
│   │   │   ├── index.html                  # Unified Desktop UI (Phases 1–5, FDE Studio, Enterprise Suite)
│   │   │   └── renderer.ts                 # Renderer client logic, event listeners, live simulators
│   │   └── shared\
│   │       ├── eventChannels.ts            # IPC channel constants (DESKTOP_CHANNELS)
│   │       └── desktopTypes.ts             # Desktop data contracts and interfaces
│   │
│   ├── enterprise\                         # [PAID / ENTERPRISE COMMERCIAL MODULES]
│   │   ├── index.ts                        # Unified enterprise export barrel
│   │   ├── license\                        # 100% Offline Cryptographic Licensing Engine
│   │   │   ├── licenseTypes.ts             # LicensePlan, EnterpriseFeature, LicenseState
│   │   │   ├── licenseValidator.ts         # Ed25519 asymmetric signature verification (Master Public Key)
│   │   │   ├── licenseGenerator.ts         # Enterprise key generator (Private key signing)
│   │   │   └── licenseManager.ts           # Runtime feature flag evaluator & SecretStorage bridge
│   │   ├── rag\                            # Air-gapped RAG pipeline scaffolder (Python+pgvector, TS+Qdrant)
│   │   ├── loadTesting\                    # Distributed k6 and Locust SLA load test generator
│   │   ├── dataQuality\                    # Great Expectations & Soda Core quality & schema drift gates
│   │   ├── security\                       # SIEM forwarder (Splunk/Datadog/Sentinel), PII sanitizer, RLS policy gen
│   │   ├── migration\                      # Enterprise SQL Transpiler (Oracle/T-SQL to BigQuery/Snowflake)
│   │   ├── sync\                           # Reverse ETL sync worker with idempotency keys
│   │   ├── synthetic\                      # Referentially intact synthetic CSV data generator
│   │   ├── mockServer\                     # Standalone mock API server generator (Node.js & Python)
│   │   └── serving\                        # Private air-gapped model client (vLLM / Triton / Ollama)
│   │
│   ├── solution\                           # [SCAFFOLDED OUTPUT] Client Target Architecture
│   │   ├── level_1_rule_engine.ts          # Generated Level 1 deterministic rule gate
│   │   ├── level_2_semantic_router.ts      # Generated Level 2 intent classifier
│   │   ├── level_3_grounded_rag.ts         # Generated Level 3 citation RAG
│   │   ├── level_4_mcp_tool_agent.ts       # Generated Level 4 MCP tool definition
│   │   └── level_5_agent_swarm.ts          # Generated Level 5 multi-agent swarm state machine
│   │
│   ├── tools\                              # [LOCAL / COMMUNITY] Free Offline Developer Utilities
│   │   ├── sqlFormatter.ts                 # Multi-dialect offline SQL formatter
│   │   ├── linters.ts                      # Terraform and Dockerfile security analyzers
│   │   ├── dbtSync.ts                      # dbt schema YAML extractor and synchronizer
│   │   ├── dataProfiler.ts                 # CSV data profiler and statistical summary generator
│   │   ├── cronWorkbench.ts                # 5-field cron expression & regex evaluator
│   │   └── codeModernizer.ts               # Python type hints (PEP 604) & JS modernizer
│   │
│   └── test\                               # [TESTS] Comprehensive automated test suite
│       └── suite\
│           ├── enterprise\license.test.ts  # Cryptographic license verification tests
│           └── enterprise\*.test.ts        # All 12 commercial module tests
│
├── scripts\
│   ├── copy-desktop-assets.js              # Copies renderer HTML/CSS into out/ on compile
│   ├── generate-license.js                 # Official CLI tool to issue Ed25519 enterprise license keys
│   ├── package-enterprise.js               # Builds enterprise commercial VSIX packages with security scan
│   ├── package-all.js                      # Builds standard cross-platform packages
│   └── download-binaries.js                # Fetches bundled platform binaries
│
└── docs\                                   # [DOCUMENTATION] Handbooks, Runbooks & Specifications
    ├── LOCAL_VS_PAID_MANAGEMENT.md         # This document
    ├── ARCHITECTURE.md                     # Core extension architecture & plugin layer
    ├── FDE_PLAYBOOK.md                     # 14-day frontline engagement playbook
    └── OFFLINE_SUITE.md                    # Zero-AI offline developer tools reference
```

---

## 4. Feature Matrix: Local (Community) vs. Paid (Enterprise)

| Capability / Module | Local (Community) Edition | Paid (Enterprise) Edition | Code Implementation Path |
| :--- | :---: | :---: | :--- |
| **Price & Licensing** | **Free & Open** (MIT) | **Commercial Tier** (`pro`, `standard`, `platinum`) | `src/enterprise/license/` |
| **Network Requirement** | 100% Offline / Local | 100% Offline / Air-Gapped | Both run without internet |
| **Phase 1: Discovery & Problem Framing** | Full Access | Full Access | `src/desktop/main/ipcHandlers.ts` |
| **Phase 1: AI Scope & Risk Drafter** | Full Access | Full Access | `src/desktop/main/ipcHandlers.ts` |
| **Phase 1: Scope Version Control** | Full Access | Full Access | `.evolve/scope_versions.json` |
| **Phase 1: Client Memo Export (.md & .html)** | Full Access | Full Access | `docs/SCOPE_ALIGNMENT_MEMO.md` |
| **Phase 2: Database Introspector (7 DBs)** | Full Access | Full Access | `src/fde/dbIntrospect.ts` |
| **Phase 2: SchemaMapper & Mart Builder** | Full Access | Full Access | `src/fde/schemaMapper.ts` |
| **Phase 3: FDE 1–5 Capability Ladder** | Full Access | Full Access | `src/desktop/renderer/renderer.ts` |
| **Phase 3: Rule vs Model Gate Evaluator** | Full Access | Full Access | `src/desktop/renderer/renderer.ts` |
| **Phase 4: Runbook & Diagram Factory** | Full Access | Full Access | `src/fde/runbookGenerator.ts` |
| **Offline Developer Suite (SQL, Linters, Regex)** | Full Access | Full Access | `src/tools/` |
| **Air-Gapped RAG Studio Scaffolder** | Preview Mode | **Unlocked** (`rag_scaffolder`) | `src/enterprise/rag/` |
| **Distributed k6 & Locust Load Testing** | Preview Mode | **Unlocked** (`load_testing`) | `src/enterprise/loadTesting/` |
| **Great Expectations & Soda Quality Gates** | Preview Mode | **Unlocked** (`data_quality`) | `src/enterprise/dataQuality/` |
| **SIEM Forwarder (Splunk, Datadog, Sentinel)** | Preview Mode | **Unlocked** (`siem_logging`) | `src/enterprise/security/siemForwarder.ts` |
| **SQL Transpiler (Oracle/T-SQL to BigQuery)** | Preview Mode | **Unlocked** | `src/enterprise/migration/sqlTranspiler.ts` |
| **Automated PII Masking & Data Sanitizer** | Preview Mode | **Unlocked** | `src/enterprise/security/piiSanitizer.ts` |
| **Reverse ETL Sync Worker (Idempotent)** | Preview Mode | **Unlocked** | `src/enterprise/sync/reverseEtlGen.ts` |
| **Row-Level Security (RLS) Policy Gen** | Preview Mode | **Unlocked** | `src/enterprise/security/rlsPolicyGen.ts` |
| **Referential Synthetic Data Generator** | Preview Mode | **Unlocked** | `src/enterprise/synthetic/syntheticDataGen.ts` |
| **Standalone Mock API Server Generator** | Preview Mode | **Unlocked** | `src/enterprise/mockServer/mockServerGen.ts` |
| **Private Model Serving Client (vLLM/Triton)** | Preview Mode | **Unlocked** | `src/enterprise/serving/privateModelClient.ts` |
| **White-Label Co-Branding & Priority SLA** | N/A | **Unlocked** (`co_branding`, `priority_sla`) | `src/enterprise/license/` |

---

## 5. How Licensing Is Locally Managed (Cryptographic Engine)

Evolve AI never contacts an external licensing server. All license verification is performed **locally and deterministically** using the **Ed25519 Asymmetric Digital Signature Algorithm**.

```
                           OFFLINE LICENSING ARCHITECTURE
                           
  [ Evolve Mind Solutions (Issuer) ]               [ Client Air-Gapped Machine ]
                │                                                │
   1. Ed25519 Private Key                                        │
      (Kept secure offline)                                      │
                │                                                │
   2. Sign License Payload ───────────────────────────────> 3. Enter License Key
      "EM-ENT-V1.<Base64Payload>.<Base64Signature>"              │
                                                                 ▼
                                                    4. LicenseValidator.verify()
                                                       (Uses Compiled Master Public Key)
                                                                 │
                                                    5. Check Expiry & Feature Flags
                                                                 │
                                                                 ▼
                                                    6. Store in Hardware Vault
                                                       (~/.evolve/license.json or
                                                        vscode.SecretStorage)
```

### 1. Token Structure
An enterprise license key string is formatted as:
```
EM-ENT-V1.<Base64UrlEncodedJsonPayload>.<Base64UrlEncodedEd25519Signature>
```
The JSON payload contains:
- `organization`: Customer / enterprise entity name.
- `licenseId`: Unique serial ID (e.g., `EM-LIC-2026-9481A`).
- `plan`: Tier (`pro`, `enterprise_standard`, or `enterprise_platinum`).
- `maxSeats`: Maximum authorized developer seats.
- `issuedAt`: ISO 8601 creation timestamp.
- `expiresAt`: ISO 8601 expiration timestamp.
- `features`: Explicit array of unlocked enterprise feature flags.
- `contactEmail`: Authorized client administrator contact.

### 2. Hardware Fingerprint Binding
For high-security environments, `DesktopLicenseAuth.getHardwareFingerprint()` computes an immutable SHA-256 machine hash:
```typescript
const seed = `evolve:${platform}:${arch}:${hostname}:${cpus}:${macSample}`;
const hash = crypto.createHash('sha256').update(seed).digest('hex');
// Result: sha256:8f4c2e...
```
Clients can generate an **Offline Activation Challenge**:
```
REQ-A4F98B (Contains machine fingerprint, user ID, org name, and app version)
```
The Evolve Mind administrator signs this challenge offline, producing a license locked to that physical machine or server cluster.

### 3. Local Storage Locations
- **Desktop Electron App**:
  - License state is stored in `~/.evolve/license.json`.
  - User profile details are stored in `~/.evolve/profile.json`.
  - Sensitive tokens are encrypted using machine entropy in `~/.evolve/vault.enc`.
- **VS Code Extension**:
  - License key is stored in `vscode.SecretStorage` (`evolve.enterprise.licenseKey`), backed by the operating system keychain (Windows Credential Manager, macOS Keychain, Linux SecretService).

### 4. 30-Day Air-Gapped Platinum Trial
In Step 5 of the Desktop Studio, clicking **"✨ 30-Day Air-Gapped Platinum Trial"** provisions an instant in-memory evaluation license. This allows clients and FDEs to run and evaluate every single enterprise module locally without waiting for license key issuance.

---

## 6. How Developers & FDEs Locally Manage Between Versions

### 1. Working in Free / Community Mode (Default)
When you clone the repository and run:
```bash
npm run compile
npm run desktop:start
```
The application starts in **Local Community Edition** mode. All 5 FDE phases, the 1–5 Capability Ladder, database introspectors, schema mappers, runbook generators, and offline developer utilities are 100% active and fully functional.

### 2. Generating & Testing an Enterprise Key Locally
To test the commercial enterprise features locally, run the built-in key generator CLI:
```bash
# Generate a 365-day Platinum Enterprise key
node scripts/generate-license.js --org="Local Test Corp" --plan="enterprise_platinum" --seats=5 --days=365

# Or use the npm shortcut
npm run license:generate -- --org="Client Pilot Banking" --days=90
```
Copy the printed `EM-ENT-V1...` key and:
1. Open the Desktop Studio (or click Step 5: Enterprise Commercial Suite).
2. Paste the key into the **"Enter Cryptographic License Key"** box and click **"Activate License Key"**.
3. All 12 commercial modules will unlock immediately.

### 3. Building & Packaging the Different Editions

```bash
# Compile TypeScript & sync desktop assets
npm run compile

# Run the complete test suite (629 unit & integration tests)
npm test

# Build standard Community VS Code VSIX package
npm run package

# Build proprietary Enterprise Commercial VS Code VSIX packages (with automated secret scans)
npm run package:enterprise

# Build specific platform Enterprise package (e.g. Windows x64)
npm run package:enterprise:win

# Build standalone desktop Electron executable
npm run desktop:build:win
```

### 4. Syncing Build Output to Installed VS Code Extensions
When developing locally with installed extensions, synchronize output to your VS Code extensions folders using `robocopy` (Windows):
```powershell
robocopy out "C:\Users\Balav\.vscode\extensions\codeforge-ai.evolve-ai-2.20.0\out" /E /NFL /NDL /NJH /NJS ; robocopy out "C:\Users\Balav\.vscode\extensions\evolveminds.evolve-ai-2.20.0\out" /E /NFL /NDL /NJH /NJS ; exit 0
```

---

## 7. Developer Quick Reference

| Action | Command / Location |
| :--- | :--- |
| **Launch Desktop App** | `npx electron out/desktop/main/main.js [optional_project_path]` |
| **Run All 629 Tests** | `npm test` |
| **Run Enterprise Tests** | `npx mocha out/test/suite/enterprise/*.test.js` |
| **Generate Test License** | `node scripts/generate-license.js --org="Test Org" --days=30` |
| **Scaffolded Code Output** | `src/solution/level_1_rule_engine.ts` through `level_5_agent_swarm.ts` |
| **Scope Version Storage** | `.evolve/scope_versions.json` and `docs/discovery/SCOPE_v1.X.md` |
| **Client Deliverables** | `docs/SCOPE_ALIGNMENT_MEMO.md` and `docs/SCOPE_ALIGNMENT_BRIEF.html` |
| **Desktop Storage Path** | `~/.evolve/` (`license.json`, `profile.json`, `vault.enc`) |
| **Master Public Key** | Compiled into `src/enterprise/license/licenseValidator.ts` |
