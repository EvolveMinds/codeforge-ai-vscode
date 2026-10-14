# 🐍 Python AI Studio & Neural Debugger Guide

## 1. Overview & Architectural Philosophy

The **Python AI Studio & Neural Debugger** is an enterprise-grade, hot-pluggable plugin designed for **Evolve AI** and the **Enterprise Delivery Studio (FDE Cockpit)**. It empowers Forward-Deployed Engineers (FDEs), data scientists, and AI practitioners to write, verify, optimize, and deploy production-grade Python code effortlessly.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                  ENTERPRISE DELIVERY STUDIO (FDE COCKPIT)                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  [🐍 Python Studio] Drawer ➔ 1-Click Toggle • Hot-Pluggable (<10 MB Core)    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
           ┌───────────────────────────┴───────────────────────────┐
           ▼                                                       ▼
 ┌───────────────────────────────────┐   ┌───────────────────────────────────┐
 │       DUAL-TRACK WORKSPACE        │   │        DELIVERY & CLOUD HUB       │
 ├───────────────────────────────────┤   ├───────────────────────────────────┤
 │ • ⚡ Pure Manual (100% Offline)   │   │ • 🛡️ Git Pre-Commit Leak Audit   │
 │ • 🤖 On-Demand AI Advisory        │   │ • 🔑 Active Cloud Credential Flow │
 │ • 🔄 Continuous Background Lint   │   │ • 🐳 Multi-Stage Dockerfile Gen   │
 │ • 📋 Side-by-Side Editable Diff   │   │ • 🚀 VPC Target Deployment Scripts│
 └───────────────────────────────────┘   └───────────────────────────────────┘
```

### Core Design Tenets
1. **Ultra-Lean Core & Pluggable**: The base Evolve AI extension bundle stays lightweight (<10 MB). The Python Studio plugin is fully modular and can be activated or deactivated on-the-fly directly inside the Delivery Studio without IDE restarts.
2. **"Code-First, AI Optional" Agency**: Programmers retain total control. If you prefer to hand-code, 100% of the deterministic engines (AST syntax checks, tensor dimension inference, numerical NaN sniffers, and DataFrame profilers) run offline with **zero AI calls**.
3. **Editable Diff Review (No Blind Overwrites)**: AI suggestions never overwrite files on disk. Every proposed patch is presented in a side-by-side interactive editor where developers can review, hand-edit, and re-verify code before accepting.
4. **Greenfield & Brownfield Delivery Ready**: Automatically differentiates clean Greenfield templates from complex legacy Brownfield repositories, mapping existing `.venv`, `pyproject.toml`, `requirements.txt`, or Poetry configurations seamlessly.

---

## 2. Greenfield & Brownfield Topology Detection

Upon opening any workspace, the plugin's `PythonDetector` inspects the project topology non-intrusively:

* **Greenfield Projects**: When starting from scratch or an empty directory, the plugin offers 1-click project initialization (`uv venv`, Pydantic v2 scaffolding, FastAPI/LangChain templates, and pre-commit `.gitignore`).
* **Brownfield Projects**: When working within established enterprise repositories, the plugin discovers:
  * Existing virtual environments (`.venv`, `env`, `conda`, `poetry`).
  * Package manager configurations (`uv`, `poetry`, `pip`, `pipenv`).
  * Framework footprints: **PyTorch**, **JAX**, **HuggingFace**, **LangChain**, **Polars**, **Pandas**, **FastAPI**, and **PySpark**.
  * Multi-module sub-projects and monorepo folders.

---

## 3. The 3 Operational Modes

Toggle between operational tracks directly from the status bar or the Python AI Studio workspace:

| Mode | AI Invocation | Best For | Verification Engine |
| :--- | :--- | :--- | :--- |
| **⚡ Pure Manual** | **Zero AI Calls (100% Offline)** | Sensitive IP, air-gapped VPCs, hand-crafted algorithms | Pure Node.js AST parser, tensor shape inference, and regex rules |
| **🤖 On-Demand AI** | **On User Click Only** | Architectural refactoring, edge-case debugging, bug remediation | User clicks "Propose Fix", AI generates 3-bullet diagnosis and diff |
| **🔄 Continuous** | **Non-blocking background hints** | Rapid prototyping, exploratory data analysis | Passive advisory notifications |

---

## 4. Deterministic Engines (100% Offline / Zero-AI)

### A. Deterministic Syntax & Anti-Pattern Analyzer (`DeterministicAnalyzer`)
* **Bracket & Indentation Matcher**: Validates bracket balance (`()`, `[]`, `{}`) across nested comprehensions and functions, alerting on mismatched closing tokens.
* **Mutable Default Argument Sniffer**: Detects functions with `def fn(x=[])` or `def fn(d={})` which cause dangerous shared state mutations across callers.
* **Wildcard Import Guard**: Flags `from module import *` to prevent namespace pollution and static analysis breakage.
* **Dangerous Eval/Exec**: Audits code for arbitrary code execution vectors (`eval()`, `exec()`).
* **Legacy Python 2 Syntax**: Flags deprecated `print "..."` syntax.

### B. Tensor Shape & Numerical Instability Engine (`TensorShapeEngine`)
* **Layer Topology Extraction**: Extracts sequential dimensions for `nn.Linear`, `nn.Conv2d`, and `nn.Embedding`.
* **Sequential Layer Dimension Checks**: Detects mismatched matrix multiplications (e.g. `nn.Linear(64, 128)` followed by `nn.Linear(256, 10)`).
* **NaN Instability Prevention**:
  * Catches division by variance without numerical smoothing (`/ torch.sqrt(var)` ➔ `/ torch.sqrt(var + 1e-5)`).
  * Catches unclamped `torch.log(x)` which yields `-inf` when inputs reach zero.
* **Double Softmax Anti-Pattern**: Identifies redundant explicit `F.softmax` prior to `nn.CrossEntropyLoss`, which degrades training gradients.

### C. DataFrame & Pipeline Sniffer (`DataFrameSniffer`)
* **Pandas `iterrows()` Bottleneck**: Flags row-by-row iteration loops (which add 100x-500x boxing overhead) and provides vectorized alternatives.
* **`SettingWithCopy` Warning Prevention**: Detects chained indexing assignments (`df['col']['idx'] = val`).
* **Cartesian Merge Risk**: Flags `pd.merge(a, b)` without explicit `on=` or `left_on=/right_on=` parameters to prevent accidental memory blowups.
* **Polars Acceleration Recommendations**: Automatically suggests zero-copy, lazy-evaluated Polars alternatives for heavy tabular transformations.

---

## 5. Side-by-Side Editable Review Workspace

Access the workspace via `Ctrl+Shift+P` ➔ **`Python Studio: Open Interactive AI & Neural Debugger Workspace`** or click **🖥️ Open Workspace** in the Delivery Studio.

### Review Workspace Capabilities:
1. **Left Pane (Original Code)**: Displays the current active Python file with live line counters.
2. **Right Pane (Proposed Patch - Editable)**: Contains the proposed fix. **You can directly edit, modify, or add comments to this code before accepting.**
3. **3-Bullet Diagnostic Summary**:
   * 🔴 **Root Cause**: Exact mathematical or mechanical flaw.
   * ⚠️ **Architectural Impact**: Production fallout (loss NaN explosion, OOM crash, 500x latency degradation).
   * 💡 **Remediation**: Recommended fix.
4. **PyTest Contract Generator**: Auto-generates contract test fixtures (`test_*.py`) with synthetic batch feeds and NaN/Inf assertions. Click **💾 Save as test_*.py** to persist the test directly to `tests/`.
5. **Accept & Apply**: Instantly applies the reviewed code back into your active VS Code editor cleanly.

---

## 6. Git Pre-Commit Hygiene & Model Weight Leak Protection

Forward-deployed AI engineering projects frequently risk bloating Git repositories with binary model checkpoints or leaking API credentials.

The **Git Pre-Commit Hygiene Hook** scans:
* **Large Model Weights (>50 MB)**: Blocks staging of `*.pt`, `*.bin`, `*.safetensors`, `*.onnx`, or `*.h5` files, advising developers to utilize Git LFS or object storage buckets (S3 / GCS / Azure Blob).
* **Unignored `.venv/` Folders**: Catches newly created virtual environments that lack a `.gitignore` entry.
* **Plaintext Secrets**: Flags API keys (`sk-...`, AWS secret access keys, JWTs) residing in `.env` files.
* **1-Click Auto-Repair**: Click **Fix .gitignore Automatically** to instantly append standardized Python AI exclusions cleanly and idempotently.

---

## 7. Cloud Hub Integration & Container Scaffolding

### Active Cloud Credential Injection
The **Python Sandbox Terminal** (`🐍 Python AI Sandbox`) automatically inherits authenticated credentials from the **Cloud Hub**:
* **GCP**: Injects `GOOGLE_APPLICATION_CREDENTIALS` and active `gcloud` project tokens.
* **AWS**: Injects active `AWS_DEFAULT_REGION` and profile credentials.
* **Azure**: Injects active subscription and tenant IDs.
* **Databricks**: Injects workspace host and personal access tokens.

### Production Multi-Stage Dockerfile Scaffolding
Running `evolve.pythonStudio.scaffoldDockerfile` generates an enterprise-hardened container specification:
* **Base Image**: `python:3.12-slim`
* **Fast Caching**: Leverages official `ghcr.io/astral-sh/uv` binary for sub-second package resolution.
* **Security Hardening**: Executes under non-privileged `appuser` (UID 10001) with root privileges dropped.
* **Container Healthcheck**: Configured for Kubernetes / Cloud Run / ECS liveness probes.

---

## 8. Pro Developer Ergonomics & Feature Parity

Evolve AI's Python Studio matches and exceeds features found in **Cursor Pro**, **PyCharm Pro**, and **Positron**:

### 1. NLP Code Copilot Layer
* Natural language prompt input with 1-click instruction chips (`Add dropout layer`, `Convert to FastAPI`, `Vectorize with Polars`).
* Generates patch proposals and immediately displays them in a **Side-by-Side Editable Diff Review** pane before applying.
* Supports **Undo** history to easily revert AI transformations.

### 2. 1-Click Traceback Auto-Fixer (Cursor / Windsurf Parity)
* Scans runtime terminal output and detects exceptions (`ZeroDivisionError`, `RuntimeError`, `KeyError`, etc.).
* Displays prominent traceback alert banners with offending line numbers and files.
* Clicking **✨ Auto-Diagnose & Fix Traceback with AI** generates a defensive patch that is loaded directly into the side-by-side diff pane.
* 100% offline fallback heuristics inject variance stabilization (`+ 1e-6`), clamp logs (`torch.clamp(min=1e-7)`), and align tensor dimensions.

### 3. Interactive DataFrame & Tensor Grid Explorer (PyCharm Pro / Positron Standard)
* Zero-copy in-memory tabular viewer for Polars/Pandas dataframes and PyTorch tensors.
* **Live Sorting**: Click column headers to toggle ascending/descending sorts (`▲`/`▼`).
* **Column Dtype Pills**: Inferred data type badges (`Int64`, `Float32`, `Bool`, `Utf8`).
* **Search & Filter**: Real-time substring filter across all columns.
* **Pagination**: 25, 50, 100, or All rows.
* **Export**: 1-click CSV and JSON export directly to clipboard.

### 4. 1-Click Code Formatter & Import Organizer (isort / Black / Ruff)
* **Format Code**: Normalizes indentation to 4 spaces, standardizes double quotes, formats operator spacing, and collapses redundant blank lines while preserving multiline docstrings.
* **Organize Imports**: Partitions import statements into three clean blocks: Standard Library, Third-Party Packages, and Local Modules, sorted alphabetically.

### 5. Dynamic Visual Tensor Flow Board
* Automatically parses layer definitions (`nn.Linear`, `nn.Conv2d`, `nn.ReLU`, `nn.Dropout`, `nn.LayerNorm`, `nn.LogSoftmax`) directly from active code in the editor.
* Traces shape transformations across layers with batch size and feature dimension multipliers.
* Dynamically detects dimension mismatches between consecutive layers and displays clear visual error badges (`⚠️ SHAPE MISMATCH`).

---

## 9. Command Reference

| Command ID | Title | Description |
| :--- | :--- | :--- |
| `evolve.pythonStudio.openWorkspace` | **Open Interactive AI & Neural Debugger Workspace** | Launches the side-by-side editable review cockpit |
| `evolve.pythonStudio.runInSandbox` | **Run in Sandbox Terminal** | Executes active script in isolated terminal with cloud tokens |
| `evolve.pythonStudio.provisionVenv` | **1-Click Provision Virtual Environment (uv)** | Creates `.venv` and installs dependencies in milliseconds |
| `evolve.pythonStudio.verifySyntaxOffline` | **Verify Syntax & Anti-Patterns (Zero-AI)** | Runs 100% offline bracket, indentation, and AST check |
| `evolve.pythonStudio.inspectTensorShapes` | **Inspect PyTorch/JAX Tensor Shapes & NaN Checks** | Traces layer dimension topology and numerical risks |
| `evolve.pythonStudio.sniffDataframe` | **Profile Pandas/Polars DataFrame Pipeline** | Audits for Cartesian merges, chained indexing, and iterrows |
| `evolve.pythonStudio.scanGitLeaks` | **Audit Git Pre-Commit Hygiene & Weight Leaks** | Scans for files >50MB, `.venv`, and plaintext secrets |
| `evolve.pythonStudio.scaffoldDockerfile` | **Scaffold Production Multi-Stage Dockerfile** | Emits production-ready multi-stage container build |
| `evolve.pythonStudio.inspectTopology` | **Show Greenfield / Brownfield Inspection Report** | Summarizes project topology, framework, and environment |

