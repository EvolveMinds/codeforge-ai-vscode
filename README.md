# Evolve AI — Context-Aware AI Coding Assistant for VS Code

<!-- TODO: Add banner image here: ![Evolve AI](media/banner.png) -->
<!-- TODO: Add animated GIF demo here: ![Demo](media/demo.gif) -->

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/codeforge-ai.evolve-ai?label=VS%20Code%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=codeforge-ai.evolve-ai)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/codeforge-ai.evolve-ai?color=green)](https://marketplace.visualstudio.com/items?itemName=codeforge-ai.evolve-ai)
[![License: MIT](https://img.shields.io/github/license/EvolveMinds/codeforge-ai-vscode?color=brightgreen)](LICENSE)

**Evolve AI** brings powerful AI code assistance directly into your editor. It works with **Ollama** (local/offline), **Gemma 4** (Google's multimodal open model), **Anthropic Claude**, **OpenAI-compatible APIs**, and **Hugging Face** — so you choose where your code goes.

### Why Evolve AI?

- **Free & private** — runs fully offline with Ollama or Gemma 4. Your code never leaves your machine.
- **Auto-detecting stack plugins** — 13 plugins that activate automatically based on your project: Databricks, Terraform, Docker, Kubernetes, Django, FastAPI, dbt, Airflow, PyTorch, and more.
- **Any AI provider** — bring your own model or API key. Switch between local and cloud in one click.
- **Deep context** — understands your active file, related files, diagnostics, git state, and cloud platform connections.

> Also works in **Cursor**, **VSCodium**, and other VS Code forks.

---

## Get Started in 60 Seconds

```bash
# 1. Install Ollama (free, local AI)
# Download from https://ollama.com — or on Linux:
curl -fsSL https://ollama.ai/install.sh | sh

# 2. Pull a model (pick one)
ollama pull gemma4:e4b        # Google Gemma 4 — multimodal, 128K context (recommended)
ollama pull qwen2.5-coder:7b  # Qwen — optimized for code

# 3. Install the extension and start coding
# Ctrl+Shift+A to open chat — Evolve AI detects Ollama automatically
```

No API key. No account. No data leaving your machine. That's it.

---

## How Does It Compare?

| Feature | Evolve AI | GitHub Copilot | Continue.dev | Cody |
|---------|-----------|---------------|-------------|------|
| **Free local AI** (Ollama, Gemma 4) | Yes | No | Yes | No |
| **Auto-detecting stack plugins** (13) | Yes | No | No | No |
| **Cloud platform integration** (AWS, GCP, Azure, Databricks) | Yes | No | No | No |
| **Multimodal** (images via Gemma 4) | Yes | No | Partial | No |
| **Multiple AI providers** | 6 | 1 | Multiple | 1 |
| **Offline mode** | Yes | No | No | No |
| **Open source** | MIT | No | Apache 2.0 | Apache 2.0 |
| **Price** | Free | $10-19/mo | Free | Free tier |

---

## Features

### Multi-Provider AI Support

| Provider | Privacy | Setup |
|---|---|---|
| **Ollama** (local) | Code never leaves your machine | Free, runs locally |
| **Gemma 4** (local) | Code never leaves your machine | Free, guided setup via Ollama |
| **Anthropic Claude** | Cloud API | API key required |
| **OpenAI / Compatible** | Cloud API (Groq, Mistral, Together AI, LM Studio) | API key required |
| **Hugging Face** | Cloud API | API key required |
| **Offline mode** | Fully offline, pattern-based | No setup needed |

### AI Chat Sidebar

- Streaming responses with full project context
- Understands your active file, related files, diagnostics, and git state
- Context budget system ensures efficient token usage

### Smart Code Actions

- **CodeLens hints** above every function: Explain | Tests | Refactor
- **Lightbulb actions**: "Fix with AI" on any diagnostic
- **Right-click menu**: Explain, refactor, fix, document, generate tests
- **Keyboard shortcuts**: Quick access to common actions

### 17 Core Commands

- Open AI Chat (`Ctrl+Shift+A`)
- Generate Code from Description (`Ctrl+Alt+G`)
- Fix Current Errors (`Ctrl+Alt+F`)
- Explain Selected Code (`Ctrl+Alt+E`)
- Generate Commit Message (`Ctrl+Alt+M`)
- Refactor Selection, Add Documentation, Generate Tests, Apply Folder Transforms
- Explain Changes, Generate PR Description, Build Framework, Run & Auto-Fix
- Switch Provider, Setup Ollama, Gemma 4 Info & Tips, What's New

### 16 Auto-Detecting Plugins

Plugins activate automatically based on your workspace files. No configuration required.

| Plugin | Detects | Highlights |
|---|---|---|
| **Databricks** | `databricks.yml`, PySpark imports | 10+ commands, live workspace API: clusters, jobs, notebooks, Unity Catalog, SQL warehouse, DLT pipelines |
| **AWS** | `serverless.yml`, `template.yaml`, AWS SDK | 28+ commands, live API: Lambda, Glue, S3, CloudFormation, Step Functions, DynamoDB, IAM, SAM, CDK |
| **Google Cloud** | `app.yaml`, GCP SDK imports | 26+ commands, live API: Cloud Functions, Cloud Run, BigQuery, GCS, Pub/Sub, Firestore, Cloud Build |
| **Azure** | `host.json`, Azure SDK imports | 28+ commands, live API: Functions, Logic Apps, Cosmos DB, Storage, DevOps Pipelines, Bicep, Log Analytics |
| **dbt** | `dbt_project.yml` | 6 commands: explain models, tests, incremental, docs, optimize |
| **Apache Airflow** | `airflow.cfg`, DAG files | 6 commands: explain DAGs, TaskFlow, sensors, retry, monitoring |
| **pytest** | `pytest.ini`, `conftest.py` | 6 commands: generate tests, fixtures, parametrize, coverage |
| **FastAPI** | FastAPI imports | 6 commands: endpoints, validation, CRUD, auth, tests |
| **Django** | `manage.py` | 6 commands: models, serializers, admin, views, URLs, tests |
| **Terraform** | `*.tf` files | 6 commands: explain, variables, tags, modules, outputs, security |
| **Kubernetes** | K8s YAML manifests | 6 commands: explain, probes, resources, security, manifests, network |
| **Docker** | `Dockerfile` | 6 commands: explain, optimize, healthcheck, security, compose |
| **Jupyter** | `*.ipynb` files | 5 commands: explain, document, clean, convert, generate |
| **PyTorch** | PyTorch imports | 6 commands: models, training loops, checkpoints, mixed precision |
| **Security** | Always active | 3 commands: scan file, scan workspace, fix findings |
| **Git** | Always active | 4 commands: blame, changelog, commit messages, PR templates |

### Cloud Platform Integration

The **Databricks**, **AWS**, **Google Cloud**, and **Azure** plugins go beyond code assistance. They connect to your actual cloud accounts to:

- **Manage resources** — list and inspect Lambda functions, Cloud Run services, Azure Functions, Databricks clusters
- **Execute queries** — run SQL on BigQuery, Cosmos DB, Databricks SQL warehouses
- **Browse storage** — navigate S3 buckets, GCS objects, Azure Blob containers, Unity Catalog
- **Trigger and monitor jobs** — run Glue jobs, Databricks workflows, Step Functions
- **AI-powered diagnostics** — analyze failed job runs with AI explanations and fix suggestions
- **Deploy from VS Code** — deploy notebooks, upload to S3/GCS/Azure Storage, manage DLT pipelines

### Secure by Design

- **API keys** stored in VS Code's encrypted `SecretStorage` — never in plaintext settings
- **Cloud credentials** use standard provider SDKs and authentication flows
- **All file edits** go through VS Code's undo stack
- **Diff preview** before applying AI-generated changes
- **Context budget** caps prevent excessive token usage
- **Workspace Trust enforced** — in untrusted workspaces, workspace-level overrides of provider host URLs (`ollamaHost`, `openaiBaseUrl`, `huggingfaceBaseUrl`) are ignored so a malicious `.vscode/settings.json` can't redirect your chat to an attacker-controlled server
- **Remote-host warning** — if a provider URL isn't loopback/private, a one-time toast tells you your code is leaving your machine
- **Image uploads** validated (10 MB cap, PNG/JPEG/WEBP/GIF only)
- **Ollama minimum 0.12.4** — the smart-setup wizard prompts for upgrades to close known Ollama CVEs

---

## Quick Start

1. **Install the extension** from the VS Code Marketplace
2. **Choose your AI provider**:
   - For **local/private**: Install [Ollama](https://ollama.com), pull a model (`ollama pull qwen2.5-coder:7b`), and you're ready
   - For **cloud AI**: Run `Evolve AI: Switch AI Provider` from the command palette, select your provider, and enter your API key when prompted
3. **Start coding**: Open the AI Chat sidebar (`Ctrl+Shift+A`) or use any command from the command palette
4. **Cloud plugins** activate automatically when they detect relevant files in your workspace

---

## AI Providers

### Ollama (local, recommended)

Run AI completely on your machine — no API key, no cost, no data leaving your network.

```bash
# Install Ollama: https://ollama.ai
ollama pull qwen2.5-coder:7b
```

Set `aiForge.provider` to `ollama` (or leave on `auto` — it detects Ollama automatically).

Also compatible with **LM Studio**, **llama.cpp**, and **Jan** — point `aiForge.ollamaHost` at your server.

### Gemma 4 (local, multimodal)

Google's latest open model with text, image, and audio understanding. Runs locally and privately via Ollama. Apache 2.0 licensed.

**One-click setup** — run **Switch AI Provider** → select **Gemma 4**. Evolve AI:
1. Asks consent to inspect your system (RAM, GPU, disk, Ollama version) — *no data leaves your machine*
2. Recommends the variant that fits your hardware
3. Shows a single **"Install Everything"** button that handles Ollama install/upgrade + model download + config
4. Reports live download progress (MB/total) right in the notification

If your system can't run any variant, you get actionable alternatives instead of a dead end (cloud providers or offline mode).

Or set up manually:

```bash
# Install Ollama: https://ollama.com
ollama pull gemma4:e4b    # Recommended for most users (~9.6GB)
```

Choose your variant in `aiForge.gemma4Model`:

| Variant | Params | Size | Best for |
|---------|--------|------|----------|
| `gemma4:e4b` | 4.5B | ~9.6GB | Balanced speed & quality (recommended) |
| `gemma4:e2b` | 2.3B | ~7.2GB | Fast, lightweight tasks |
| `gemma4:26b` | 25.2B MoE | ~18GB | High-quality reasoning (32GB+ RAM) |
| `gemma4:31b` | 30.7B | ~20GB | Maximum quality (32GB+ RAM, GPU) |

### Anthropic Claude

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Run command: **Switch AI Provider** -> select Anthropic
3. Enter your API key when prompted (stored in VS Code SecretStorage)

### OpenAI / Compatible

Works with OpenAI, Groq, Mistral, Together AI, LiteLLM, and any OpenAI-compatible endpoint.

1. Set `aiForge.openaiBaseUrl` to your endpoint (default: `https://api.openai.com/v1`)
2. Set `aiForge.openaiModel` to your model name
3. Run **Switch AI Provider** -> select OpenAI -> enter API key

### HuggingFace Inference API

Access thousands of open models via the HuggingFace Inference API.

1. Get a token from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Set `aiForge.huggingfaceModel` (default: `Qwen/Qwen2.5-Coder-32B-Instruct`)
3. Run **Switch AI Provider** -> select HuggingFace -> enter token

### Built-in Offline AI

Pattern-based code analysis — works instantly with no setup, no network, no LLM.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `aiForge.provider` | `auto` | AI provider: `auto`, `ollama`, `gemma4`, `anthropic`, `openai`, `huggingface`, `offline` |
| `aiForge.ollamaHost` | `http://localhost:11434` | Ollama server URL (also LM Studio, llama.cpp) |
| `aiForge.ollamaModel` | `qwen2.5-coder:7b` | Ollama model name |
| `aiForge.gemma4Model` | `gemma4:e4b` | Gemma 4 variant: `gemma4:e2b`, `gemma4:e4b`, `gemma4:26b`, `gemma4:31b` |
| `aiForge.gemma4ThinkingMode` | `false` | Enable chain-of-thought reasoning (better results, slower) |
| `aiForge.allowHardwareDetection` | `true` | Allow inspecting system specs (RAM, GPU, disk) to recommend best Gemma 4 variant |
| `aiForge.allowAutoInstall` | `false` | When `true`, skip the per-install confirmation dialog. When `false` (default), the wizard asks before downloading the Ollama installer |
| `aiForge.openaiBaseUrl` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `aiForge.openaiModel` | `gpt-4o` | OpenAI model name |
| `aiForge.anthropicModel` | `claude-sonnet-4-6` | Anthropic model name |
| `aiForge.huggingfaceModel` | `Qwen/Qwen2.5-Coder-32B-Instruct` | Hugging Face model ID |
| `aiForge.codeLensEnabled` | `true` | Show CodeLens hints above functions |
| `aiForge.contextBudgetChars` | `24000` | Total character cap for AI context |
| `aiForge.maxContextFiles` | `5` | Max related files in context |
| `aiForge.disabledPlugins` | `[]` | Plugin IDs to disable (e.g., `["databricks", "aws"]`) |

---

## Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Open chat panel | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| Generate code from description | `Ctrl+Alt+G` | `Cmd+Alt+G` |
| Fix current file errors | `Ctrl+Alt+F` | `Cmd+Alt+F` |
| Explain selected code | `Ctrl+Alt+E` | `Cmd+Alt+E` |
| Generate commit message | `Ctrl+Alt+M` | `Cmd+Alt+M` |

---

## How Context Works

Every AI call automatically includes:

1. **Active file** — full content of your current file (priority budget allocation)
2. **Related files** — imported/importing files (remaining budget, capped at `maxContextFiles`)
3. **Diagnostics** — current errors and warnings (if `includeErrorsInContext` is enabled)
4. **Git diff** — unstaged changes (if `includeGitDiffInContext` is enabled)
5. **Plugin context** — domain-specific data from active plugins (e.g., dbt manifest, Terraform state, Databricks cluster info)

Total characters capped by `contextBudgetChars` (default 24,000). Increase for larger models; decrease for faster/cheaper ones.

---

## Cloud Plugin Setup Guides

### Databricks Connected

Connect to your Databricks workspace for live cluster management, job monitoring, notebook deployment, Unity Catalog browsing, and SQL execution.

**What you need:** A Databricks workspace URL and a Personal Access Token (PAT).

**Setup:**
1. Open the command palette (`Ctrl+Shift+P`)
2. Run **Evolve AI: Databricks: Connect to Workspace**
3. Enter your workspace URL (e.g., `https://adb-1234567890.12.azuredatabricks.net`)
4. Enter your Personal Access Token
   - Generate one at: Workspace > User Settings > Developer > Access Tokens > Generate New Token
5. The status bar will show a green dot with your workspace name when connected

**Available commands after connecting:**

| Command | What it does |
|---|---|
| List Clusters | Shows all clusters with status, type, and Spark version |
| Cluster Details & Optimization | AI analyses a cluster's config and suggests optimizations |
| List Jobs | Shows all jobs with schedule and last run status |
| Run Job | Triggers a job run and monitors it |
| Analyse Failed Job Run | Fetches error logs from a failed run — AI diagnoses the root cause |
| Design Workflow with AI | Describe what you need — AI designs a complete Databricks workflow |
| Browse & Import Notebook | Navigate workspace notebooks and open them locally |
| Deploy Current File as Notebook | Push the current file to your Databricks workspace |
| Explore Unity Catalog | Browse catalogs, schemas, and tables with AI-powered data model analysis |
| AI Query Suggestion for Table | Select a table — AI generates useful queries for it |
| Execute SQL on Warehouse | Run SQL against a SQL warehouse and see results |
| Manage DLT Pipeline | View, start, stop, and troubleshoot Delta Live Tables pipelines |

---

### AWS Connected

Connect to your AWS account for Lambda management, Glue job monitoring, S3 browsing, CloudFormation analysis, Step Functions design, and DynamoDB exploration.

**What you need:** An IAM user or role with programmatic access (Access Key ID + Secret Access Key).

**Recommended IAM permissions:** `ReadOnlyAccess` for browsing, plus `lambda:InvokeFunction`, `glue:StartJobRun`, `s3:PutObject`, `states:StartExecution` for execution commands.

**Setup:**
1. Open the command palette (`Ctrl+Shift+P`)
2. Run **Evolve AI: AWS: Connect to Account**
3. Enter your AWS Access Key ID
4. Enter your AWS Secret Access Key
5. Enter your AWS Region (e.g., `us-east-1`, `eu-west-1`)
6. The extension tests the connection with STS GetCallerIdentity

**Environment variable alternative:** Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION` — the plugin picks these up automatically.

**Available commands after connecting:**

| Command | What it does |
|---|---|
| List Lambda Functions | Shows all functions with runtime, memory, and timeout |
| Lambda Function Details | Deep-dive into a function's config — AI suggests optimizations |
| Invoke Lambda Function | Run a function with custom payload and see the response |
| View Lambda Logs | Fetch recent CloudWatch logs for a function |
| Debug Lambda Errors | Fetches error logs + config for functions with recent errors — AI diagnoses issues |
| List Glue Jobs | Shows all Glue jobs with type, version, and worker count |
| Glue Job Details | Inspect job config, script location, connections |
| Run Glue Job | Trigger a Glue job with optional arguments |
| Analyse Glue Job Failure | Pick a failed run — AI analyses the error and suggests fixes |
| Browse Glue Data Catalog | Navigate databases and tables with schema details |
| Browse S3 | Drill into buckets and folders, download files to editor |
| Deploy File to S3 | Upload the current file to an S3 bucket |
| List CloudFormation Stacks | Shows stacks with status and drift detection |
| CloudFormation Stack Details | Resources, outputs, events, template — AI explains the architecture |
| List Step Functions | Shows state machines with definition analysis |
| Design Step Function with AI | Describe a workflow — AI generates the complete ASL definition |
| Explore DynamoDB | Browse tables, inspect schemas, sample data — AI suggests access patterns |

---

### Google Cloud Connected

Connect to your GCP project for Cloud Functions management, Cloud Run monitoring, BigQuery analysis, GCS browsing, Pub/Sub messaging, and Firestore exploration.

**What you need:** A GCP service account JSON key file and your project ID.

**Setup:**
1. Open the command palette (`Ctrl+Shift+P`)
2. Run **Evolve AI: Google Cloud: Connect to Project**
3. Select your service account JSON key file (file picker dialog)
   - Create one at: GCP Console > IAM & Admin > Service Accounts > Keys > Add Key > JSON
4. Enter your GCP project ID
5. The extension tests the connection by fetching project info

**Recommended roles:** `Viewer` for browsing, plus `Cloud Functions Invoker`, `BigQuery User`, `Storage Object Admin` for execution commands.

**Available commands after connecting:**

| Command | What it does |
|---|---|
| List Cloud Functions | Shows all functions with runtime, status, and trigger type |
| Function Details | Deep-dive into config — AI suggests optimizations |
| Invoke Function | Call an HTTP function with custom payload |
| View Function Logs | Fetch Cloud Logging entries for a function |
| Debug Function Errors | Scans for functions with errors — AI diagnoses issues |
| List Cloud Run Services | Shows services with URL, revision, and scaling config |
| Cloud Run Details | Inspect config, scaling, traffic routing — AI optimizes |
| Explore BigQuery | Browse datasets and tables with schema details — AI explains data model |
| Run BigQuery SQL | Execute a query and see results — AI analyses the output |
| Analyse BigQuery Failures | Inspect failed BigQuery jobs — AI diagnoses query issues |
| Browse Cloud Storage | Navigate buckets and objects, download to editor |
| Deploy to Cloud Storage | Upload current file to a GCS bucket |
| List Pub/Sub Topics | Shows topics and subscriptions — AI explains messaging architecture |
| Publish Pub/Sub Message | Send a message to a topic |
| Explore Firestore | Browse collections and documents — AI explains data model |

---

### Azure Connected

Connect to your Azure subscription for Functions management, Logic Apps monitoring, Cosmos DB querying, Storage browsing, DevOps pipeline analysis, and Log Analytics.

**What you need:** An Azure service principal (App Registration) with Tenant ID, Client ID, Client Secret, and Subscription ID.

**Setup:**
1. Open the command palette (`Ctrl+Shift+P`)
2. Run **Evolve AI: Azure: Connect to Subscription**
3. Enter your Tenant ID
4. Enter your Application (Client) ID
5. Enter your Client Secret
6. Enter your Subscription ID
7. The extension tests the connection by fetching subscription info

**Creating a service principal:**
```bash
# Using Azure CLI
az ad sp create-for-rbac --name "Evolve-AI" --role "Reader" \
  --scopes /subscriptions/<your-subscription-id>
```
This outputs `appId` (Client ID), `password` (Client Secret), and `tenant` (Tenant ID).

**Available commands after connecting:**

| Command | What it does |
|---|---|
| List Function Apps | Shows all Azure Functions apps with runtime and status |
| Function App Details | Pick an app — AI analyses config and suggests optimizations |
| Invoke Function | Call a function with custom payload |
| View Function Logs | Fetch recent logs — AI analyses errors |
| Debug Function Errors | AI diagnoses problematic function apps |
| List Logic Apps | Shows Logic Apps with status and workflow info |
| Analyse Logic App Failure | Inspect failed runs — AI diagnoses issues |
| Explore Cosmos DB | Browse accounts, databases, containers — AI explains data model |
| Query Cosmos DB | Run SQL queries against a container |
| Browse Storage | Navigate storage accounts, containers, blobs — download to editor |
| Deploy to Storage | Upload current file to blob storage |
| List DevOps Pipelines | Shows pipelines with recent run status |
| Analyse Pipeline Failure | Pick a failed pipeline run — AI diagnoses the issue |
| List Web Apps | Shows App Service web apps with status |
| Restart Web App | Restart a web app with confirmation |
| Query Log Analytics | Run KQL queries against a Log Analytics workspace |
| List Active Alerts | Shows Azure Monitor alerts — AI explains and suggests remediation |

---

## Troubleshooting

### Chat shows OFFLINE / No response

**Ollama not detected:**
1. Verify Ollama is running: open `http://localhost:11434` in your browser — it should say "Ollama is running"
2. If using Windows and `localhost` doesn't work, try setting `aiForge.ollamaHost` to `http://127.0.0.1:11434`
3. Make sure you have a model pulled: `ollama list` should show at least one model
4. Check the model name matches `aiForge.ollamaModel` (default: `qwen2.5-coder:7b`)

**Cloud provider not responding:**
1. Check your API key is set: run **Evolve AI: Switch AI Provider** and re-enter your key
2. Verify network connectivity to the provider's API endpoint
3. Check VS Code's Developer Tools console (`Help > Toggle Developer Tools`) for error messages

### Chat input not responding / buttons don't work

1. Reload the window: `Ctrl+Shift+P` > "Developer: Reload Window"
2. If the issue persists, close and reopen the chat panel
3. Check VS Code's Developer Tools console for JavaScript errors in the webview

### Plugin not activating

Plugins activate automatically based on workspace files. If a plugin isn't showing:
1. Make sure the workspace contains the expected marker files (see the plugin table above)
2. Check `aiForge.disabledPlugins` in settings — make sure the plugin ID isn't listed
3. Reload the window to trigger re-detection

### Cloud plugin shows "not connected"

1. Run the connect command for your provider (e.g., **AWS: Connect to Account**)
2. Verify your credentials are correct — the connect command tests the connection
3. Check that your credentials have sufficient permissions (see setup guides above)
4. For AWS: ensure your region is correct and your IAM user/role is active
5. For GCP: ensure the service account JSON key is valid and not expired
6. For Azure: ensure the client secret hasn't expired
7. For Databricks: ensure the PAT hasn't expired and your workspace URL is correct

### Commands show "command not found"

This happens when a cloud plugin command is triggered but the plugin isn't active. Cloud plugin commands only register when:
1. The plugin **detects** matching files in your workspace (e.g., `serverless.yml` for AWS)
2. The plugin has **activated** (connected to the cloud provider)

**Fix:** Open a workspace that contains files for that cloud platform, then run the connect command.

### Slow responses

1. **Ollama:** Use a smaller model (e.g., `qwen2.5-coder:3b` instead of `7b`)
2. **Context too large:** Reduce `aiForge.contextBudgetChars` (try `12000`) or `aiForge.maxContextFiles` (try `3`)
3. **Cloud context:** Connected plugins add live data to context — this adds a small delay on each request

### Gemma 4 setup wizard issues

**"aiForge.gemma4Model is not a registered configuration" error**
- This happens on v1.4.0 only, when the extension is installed or upgraded into a running VS Code window. VS Code's Configuration Registry hasn't picked up the new settings schema yet.
- **Fix:** Reload the window (`Ctrl+Shift+P` → "Developer: Reload Window"), then run **Switch AI Provider** → Gemma 4 again. Setup will complete normally.
- **Fixed in v1.4.1+**: The wizard now detects this and shows a one-click **Reload Window** button automatically.

**"System cannot run Gemma 4" modal appears**
- Your RAM or free disk space is below the minimum for any variant (8GB RAM, 8GB disk)
- The modal lists the specific blockers and three alternatives (cloud, offline, free up resources)
- If you know you have plenty of disk, the check looks at the Ollama models directory (`~/.ollama/models` on Linux/macOS, `%USERPROFILE%\.ollama\models` on Windows). Run `df -h ~/.ollama` (or check disk in Explorer) to confirm

**Setup hangs at "Downloading… 0%"**
- Verify Ollama is running: open `http://localhost:11434` in your browser
- Verify internet connectivity: `ping ollama.ai`
- If stuck more than 5 minutes, click Cancel in the progress notification and retry

**Hardware detection shows "No GPU detected" but you have one**
- NVIDIA: ensure `nvidia-smi` is on your PATH (`nvidia-smi --version` in terminal)
- AMD: ensure `rocm-smi` is installed (Linux only)
- Apple Silicon: detection requires `system_profiler` (built-in on macOS)
- Intel integrated GPUs are not detected — Gemma 4 won't use them anyway
- You can manually pick a variant via the "Choose Different Variant" button in the wizard

**Ollama upgrade fails during setup**
- The wizard auto-upgrades Ollama when it's older than 0.3.10 (required for Gemma 4)
- If the upgrade fails, manually download from [ollama.com](https://ollama.com) and run the installer
- Then re-run **Evolve AI: Switch AI Provider** → Gemma 4

**"Could not find gemma4 variant" after setup completes**
- Ollama may still be pulling the model in the background — wait 5-10 minutes
- Verify with `ollama list` in your terminal — should show your `gemma4:*` tag
- If missing, run `ollama pull gemma4:e4b` manually and try again

### How to disconnect / change credentials

Run the disconnect command for your provider:
- **Evolve AI: AWS: Disconnect**
- **Evolve AI: Google Cloud: Disconnect**
- **Evolve AI: Azure: Disconnect**
- **Evolve AI: Databricks: Disconnect**

Then run the connect command again with new credentials.

---

## FAQ

### General

**Q: Is my code sent to the cloud?**
A: It depends on your provider. With **Ollama**, everything stays on your machine — no data leaves your network. With cloud providers (Anthropic, OpenAI, HuggingFace), your code context is sent to their API. Choose based on your privacy requirements.

**Q: Which AI provider should I use?**
A: For **privacy and cost**: Gemma 4 or Ollama (free, local, your code never leaves your machine). For **best quality**: Anthropic Claude or OpenAI GPT-4o. For **speed on a budget**: Groq (via OpenAI-compatible endpoint). For **no setup**: the built-in offline mode (limited to pattern-based analysis).

**Q: What is Gemma 4 and why should I use it?**
A: Gemma 4 is Google's latest open-weight AI model (Apache 2.0 license). It runs locally via Ollama with no API key, no cost, and no data leaving your machine. It supports text, image, and audio input with 128K-256K context windows. The E4B variant (~9.6GB) is recommended for most users. Select **Gemma 4** in the provider switcher for a guided setup wizard.

**Q: How does the Gemma 4 setup wizard pick the right variant for me?**
A: When you select Gemma 4, Evolve AI asks one-time consent to inspect your system: RAM (`os.totalmem()`), GPU (NVIDIA via `nvidia-smi`, AMD via `rocm-smi`, Apple Silicon via `system_profiler`), free disk space, and your Ollama version. It scores each variant against your hardware and recommends one — typically E2B for 8GB RAM, E4B for 16GB, 26B MoE for 32GB+, 31B Dense for 32GB+ with a GPU. **No data leaves your machine** — detection is purely local.

**Q: Will the wizard auto-install Ollama or download models without asking?**
A: No. Each step asks explicit consent before running:
- "Install Ollama?" — opens the official installer download (only if Ollama isn't installed)
- "Upgrade Ollama?" — only if your version is older than 0.3.10 (required for Gemma 4)
- "Download <variant>?" — confirms before pulling the model
You see a setup plan listing every step before clicking **"Install Everything"**, and the whole process is cancellable mid-way.

**Q: What if my system can't run Gemma 4?**
A: The wizard shows a modal explaining exactly why (e.g. "only 4GB RAM detected — needs at least 8GB") and offers three actionable alternatives:
- **Switch to a cloud provider** (Anthropic Claude, OpenAI, HuggingFace) — runs in the cloud, only needs an API key
- **Use Offline mode** — pattern-based AI, no LLM required, works instantly
- **Free up resources** — disk-space tips if that's the blocker
You're never left at a dead end.

**Q: Can I disable hardware detection?**
A: Yes. Set `aiForge.allowHardwareDetection` to `false` in settings. The wizard then falls back to showing all 4 variants without inspection — you pick manually. Or decline the one-time consent dialog when it first appears.

**Q: Can I use multiple providers?**
A: You can switch providers at any time via **Evolve AI: Switch AI Provider**. The extension uses one provider at a time.

**Q: What models work with Ollama?**
A: Any model Ollama supports. Recommended: `gemma4:e4b` (Google Gemma 4, multimodal, strong coding), `qwen2.5-coder:7b` (code-optimized), `codellama:13b` (larger, better quality), `deepseek-coder:6.7b`. Run `ollama list` to see installed models.

**Q: Does Evolve AI work with LM Studio / llama.cpp / Jan?**
A: Yes. Set `aiForge.ollamaHost` to your server's URL (e.g., `http://localhost:1234/v1` for LM Studio). These servers implement the same API as Ollama.

### Plugins

**Q: How do plugins activate?**
A: Automatically. When you open a workspace, Evolve AI scans for marker files (e.g., `Dockerfile` for Docker, `manage.py` for Django). Matching plugins activate silently and start injecting domain knowledge into every AI interaction. The status bar shows active plugins.

**Q: Can I disable a plugin?**
A: Yes. Add the plugin ID to `aiForge.disabledPlugins` in settings. Example: `["databricks", "docker"]`. Plugin IDs: `databricks`, `databricks-connected`, `aws`, `aws-connected`, `gcp`, `gcp-connected`, `azure`, `azure-connected`, `dbt`, `airflow`, `pytest`, `fastapi`, `django`, `terraform`, `kubernetes`, `docker`, `jupyter`, `pytorch`, `security`, `git`.

**Q: What's the difference between the base and connected versions of cloud plugins?**
A: The **base** plugin (e.g., AWS) activates on file detection and injects best-practice knowledge into AI responses — no credentials needed. The **connected** plugin (e.g., AWS Connected) adds live API access — browse resources, run queries, analyze failures, deploy code. Both can be active simultaneously.

**Q: Do cloud plugins cost anything?**
A: The plugins themselves are free. But they call your cloud provider's APIs, which may incur costs depending on your plan. Read-only operations (listing resources, reading logs) are typically free or low-cost. Execution operations (invoking Lambda, running BigQuery queries) may have associated costs.

### Cloud Credentials

**Q: Where are my credentials stored?**
A: In VS Code's encrypted `SecretStorage` — the same mechanism VS Code uses for its own authentication. Credentials are never written to settings files, `.env` files, or any plaintext location.

**Q: Can I use temporary/session credentials?**
A: For **AWS**, yes — you can provide a session token along with your access key and secret key. For **Azure**, the client secret has an expiry set in Azure AD. For **GCP**, service account keys don't expire but can be rotated. For **Databricks**, PATs have configurable expiry.

**Q: What permissions do I need?**
A: At minimum, read-only access to list and inspect resources. For execution features (invoking functions, running jobs, deploying files), you need the corresponding write permissions. See each cloud plugin's setup guide above for specific IAM recommendations.

**Q: Is it safe to use in production?**
A: The extension only performs the actions you explicitly trigger via commands. It never modifies cloud resources automatically. Execution commands (run job, invoke function, deploy) always require your manual action.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

**Quick start for contributors:**

1. Fork the repo and clone it
2. `npm install && npm run watch`
3. Press `F5` to launch the Extension Development Host
4. Make your changes and test them

**Easiest way to contribute** — add a new stack plugin:

1. Read `docs/PLUGIN_GUIDE.md` for the step-by-step template
2. Create `src/plugins/<name>.ts` implementing the `IPlugin` interface
3. Register it in `src/plugins/index.ts`
4. Add commands to `package.json` under `contributes.commands`

**Plugin ideas (community contributions welcome):**
- **Next.js** — App Router, Server Components, API routes
- **Rust** — ownership, lifetimes, async patterns
- **Go** — goroutines, interfaces, error handling
- **GraphQL** — schema, resolvers, queries
- **React Native** — Expo, Metro, native modules
- **Spring Boot** — Java/Kotlin, dependency injection, JPA

---

## Requirements

- VS Code 1.85.0 or later
- For local AI: [Ollama](https://ollama.com) with a pulled model
- For cloud AI: An API key from your chosen provider
- For cloud plugins: Appropriate credentials (see setup guides above)

---

## License

[MIT](LICENSE)
