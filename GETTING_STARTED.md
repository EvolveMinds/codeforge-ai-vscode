# Getting Started with Evolve AI

Welcome! This guide walks you through setting up Evolve AI for the first time. By the end, you'll have AI-powered code assistance running in your editor.

---

## Step 1: Choose Your AI Provider

Evolve AI needs an AI model to power its features. You have five options:

### Option A: Gemma 4 (Free, Local, Multimodal) — Recommended

Google's latest open-weight model — text, image, and audio. Runs locally via Ollama. Apache 2.0 licensed.
**One click handles everything.**

1. In VS Code, press `Ctrl+Shift+P` → **Evolve AI: Switch AI Provider**
2. Select **Gemma 4**
3. Approve the one-time consent dialog (asks permission to inspect your system — RAM, GPU, disk)
4. Review the recommended variant for your hardware (e.g. *"Recommended: gemma4:e4b — Best balance of quality and speed for your system"*)
5. Click **"Install Everything"** — the wizard handles:
   - Installing Ollama (if not present)
   - Upgrading Ollama (if older than 0.3.10)
   - Downloading the model with live MB/total progress
   - Configuring Evolve AI to use Gemma 4

**Privacy:** All hardware detection is local. Nothing is sent anywhere.

**If your system can't run any variant**, the wizard shows a modal with three actionable alternatives:
- Switch to a cloud provider (Claude, OpenAI, HuggingFace)
- Use offline mode (pattern-based, no setup)
- Free up disk space (with tips)

You're never left at a dead end.

### Option B: Ollama (Free, Local, Any Model)

Your code never leaves your machine. No API key. No cost.

**Install Ollama:**
1. Download from [ollama.com](https://ollama.com) and install it
2. Open a terminal and run:
   ```
   ollama pull qwen2.5-coder:7b
   ```
3. Ollama runs as a background service — it starts automatically

**Verify it's working:**
- Open your browser and go to `http://localhost:11434`
- You should see "Ollama is running"

**Windows users:** If Evolve AI shows "OFFLINE" even though Ollama is running, go to VS Code Settings (`Ctrl+,`), search for `aiForge.ollamaHost`, and change it to `http://127.0.0.1:11434`

**That's it!** Evolve AI auto-detects Ollama. No configuration needed.

### Option C: Anthropic Claude (Cloud, Best Quality)

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In VS Code, press `Ctrl+Shift+P` and run **Evolve AI: Switch AI Provider**
3. Select **Anthropic**
4. Paste your API key when prompted

### Option D: OpenAI / Groq / Mistral (Cloud)

1. Get an API key from your provider
2. In VS Code Settings (`Ctrl+,`), search `aiForge.openaiBaseUrl` and set it to your endpoint:
   - OpenAI: `https://api.openai.com/v1` (default)
   - Groq: `https://api.groq.com/openai/v1`
   - Mistral: `https://api.mistral.ai/v1`
   - Together AI: `https://api.together.xyz/v1`
   - LM Studio: `http://localhost:1234/v1`
3. Set `aiForge.openaiModel` to your model name
4. Press `Ctrl+Shift+P` > **Evolve AI: Switch AI Provider** > **OpenAI** > paste your key

### Option E: No Setup (Offline Mode)

Evolve AI works without any AI provider! It uses pattern-based analysis — less powerful, but instant and free. Just install the extension and go.

---

## Step 2: Open the Chat

You can open Evolve AI's chat in **two places**:

- **Sidebar:** press `Ctrl+Shift+A` (`Cmd+Shift+A` on Mac).
- **Editor tab (Claude-style):** open any file and click the Evolve AI icon in the
  editor's top-right title bar. The chat opens as a tab to the right of your code.
  The two views share the same conversation in real time.

Above the input box you'll see two **pills**:

- **Mode pill** — pick what the AI does with your prompt:
  - **Chat** — Ask questions about your code.
  - **Edit** — Describe changes to apply to the current file (you review &amp; apply).
  - **Create** — Generate new files from a description.
- **Model pill** — switch model within the active provider (e.g., between installed
  Ollama models, or between `claude-sonnet-4-6` / `claude-opus-4-7`). The
  *More providers…* item at the bottom opens the full provider switch flow if you want
  to move between Ollama, Anthropic, OpenAI, Hugging Face, Gemma 4, or offline.

**Check the status indicator** in the top-left of the chat:
- Green dot + "OLLAMA" = connected to local AI
- Green dot + "ANTHROPIC" / "OPENAI" = connected to cloud AI
- Yellow dot + "OFFLINE" = no AI provider detected (see Step 1)

---

## Step 3: Try It Out

### Ask a question
Type in the chat: "What does this file do?" (with any file open)

### Explain code
Select some code in the editor, then press `Ctrl+Alt+E`

### Fix errors
If you have errors in your file (red squiggly lines), press `Ctrl+Alt+F`

### Generate code
Press `Ctrl+Alt+G` and describe what you want to build

### See all commands
Press `Ctrl+Shift+P` and type "Evolve AI" to see all available commands

---

## Step 4: Plugins (Automatic)

Evolve AI automatically detects your tech stack and activates matching plugins. **You don't need to do anything** — just open a project folder.

**How to check which plugins are active:**
- Look at the status bar (bottom-right of VS Code) — it shows icons for active plugins
- Hover over it to see plugin names

**What triggers each plugin:**

| Plugin | Your workspace must contain |
|---|---|
| Databricks | `databricks.yml` or PySpark imports |
| AWS | `serverless.yml`, `template.yaml`, `cdk.json`, `samconfig.toml`, or AWS SDK imports |
| Google Cloud | `app.yaml`, `cloudbuild.yaml`, `firebase.json`, or GCP SDK imports |
| Azure | `host.json`, `azure-pipelines.yml`, `main.bicep`, or Azure SDK imports |
| dbt | `dbt_project.yml` |
| Airflow | `airflow.cfg` or DAG files with Airflow imports |
| pytest | `pytest.ini`, `conftest.py`, or `pyproject.toml` with pytest config |
| FastAPI | Python files with `from fastapi import` |
| Django | `manage.py` |
| Terraform | `.tf` files |
| Kubernetes | YAML files with `apiVersion` and `kind` fields |
| Docker | `Dockerfile` or `docker-compose.yml` |
| Jupyter | `.ipynb` files |
| PyTorch | Python files with `import torch` |
| Security | Always active |
| Git | Always active |

**If a plugin isn't activating:**
1. Make sure the required files exist in your workspace root
2. Press `Ctrl+Shift+P` > "Developer: Reload Window" to re-trigger detection
3. Check that the plugin isn't in `aiForge.disabledPlugins` in your settings

---

## Step 5: Connect to Cloud Platforms (Optional)

If you work with Databricks, AWS, GCP, or Azure, you can connect Evolve AI to your cloud accounts for live management, debugging, and deployment.

### Connect to Databricks

**Pre-requisites:**
- A Databricks workspace URL
- A Personal Access Token (PAT)
  - Generate at: Your Workspace > User Settings > Developer > Access Tokens > Generate New Token

**Connect:**
1. Open a folder with Databricks files (e.g., `databricks.yml`)
2. Press `Ctrl+Shift+P` > **Evolve AI: Databricks: Connect to Workspace**
3. Enter your workspace URL
4. Enter your PAT

### Connect to AWS

**Pre-requisites:**
- An IAM user with programmatic access
- Access Key ID and Secret Access Key
- Know your AWS Region (e.g., `us-east-1`)

**Connect:**
1. Open a folder with AWS files (e.g., `serverless.yml`, `template.yaml`)
2. Press `Ctrl+Shift+P` > **Evolve AI: AWS: Connect to Account**
3. Enter Access Key ID, Secret Key, and Region

**Alternative:** Set environment variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION` — Evolve AI picks them up automatically.

### Connect to Google Cloud

**Pre-requisites:**
- A GCP service account JSON key file
  - Create at: GCP Console > IAM & Admin > Service Accounts > select account > Keys > Add Key > JSON
- Your GCP Project ID

**Connect:**
1. Open a folder with GCP files (e.g., `app.yaml`, `cloudbuild.yaml`)
2. Press `Ctrl+Shift+P` > **Evolve AI: Google Cloud: Connect to Project**
3. Select your JSON key file (file picker)
4. Enter your Project ID

### Connect to Azure

**Pre-requisites:**
- An Azure service principal (App Registration) with:
  - Tenant ID
  - Application (Client) ID
  - Client Secret
  - Subscription ID

**Create a service principal (Azure CLI):**
```
az ad sp create-for-rbac --name "Evolve-AI" --role "Reader" --scopes /subscriptions/YOUR_SUBSCRIPTION_ID
```
This outputs `appId`, `password`, and `tenant`.

**Connect:**
1. Open a folder with Azure files (e.g., `host.json`, `azure-pipelines.yml`)
2. Press `Ctrl+Shift+P` > **Evolve AI: Azure: Connect to Subscription**
3. Enter Tenant ID, Client ID, Client Secret, and Subscription ID

---

## Keyboard Shortcuts

| Action | Windows / Linux | Mac |
|---|---|---|
| Open chat (sidebar) | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| Open chat (editor tab) | Click the Evolve AI icon in the editor title bar | Same |
| Generate code | `Ctrl+Alt+G` | `Cmd+Alt+G` |
| Fix errors | `Ctrl+Alt+F` | `Cmd+Alt+F` |
| Explain selection | `Ctrl+Alt+E` | `Cmd+Alt+E` |
| Generate commit message | `Ctrl+Alt+M` | `Cmd+Alt+M` |
| Command palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |

---

## Common Issues

### "OFFLINE" even though Ollama is running

**Windows:** Change `aiForge.ollamaHost` in settings to `http://127.0.0.1:11434`

**All platforms:**
1. Make sure Ollama is running: `http://localhost:11434` in browser should say "Ollama is running"
2. Check you have a model: run `ollama list` in terminal
3. Reload VS Code: `Ctrl+Shift+P` > "Developer: Reload Window"

### Chat input doesn't respond / buttons don't work

1. `Ctrl+Shift+P` > "Developer: Reload Window"
2. If still broken, close VS Code completely and reopen

### Plugin command says "not active"

This means the plugin didn't detect matching files in your workspace.
- The popup will offer **Reload Window** or **Open Folder** buttons
- Make sure you opened the correct project folder

### Error popup when clicking a command

This means the command ran but encountered an issue. The error message will tell you what went wrong. Common causes:
- Cloud plugin: not connected (run the Connect command first)
- No active file open (some commands need an open file)
- AI provider timeout (check your internet connection or Ollama status)

### Nothing happens when I type in chat

Check the status dot:
- **Yellow dot / OFFLINE** = no AI provider. Follow Step 1 above.
- **Green dot** = provider connected. Try typing "hello" and pressing Enter or clicking the green arrow. If no response, check the Developer Tools console (`Help > Toggle Developer Tools`) for errors.

### Gemma 4 setup wizard issues

**"aiForge.gemma4Model is not a registered configuration" error (v1.4.0 only)**
- Happens when the extension is installed/upgraded into a running VS Code window. The config schema hasn't been loaded yet.
- **Fix:** `Ctrl+Shift+P` → "Developer: Reload Window", then re-run **Switch AI Provider** → Gemma 4.
- **v1.4.1 and later** handle this automatically with a one-click Reload Window prompt.

**"System cannot run Gemma 4" appears**
- Your RAM or disk space is below the minimum (8GB / 8GB)
- The modal lists specific blockers and offers cloud / offline alternatives — pick one to continue
- Disk check looks at the Ollama models directory (`~/.ollama/models` on Linux/macOS, `%USERPROFILE%\.ollama\models` on Windows)

**Setup hangs at "Downloading… 0%"**
- Verify Ollama is running: `http://localhost:11434` should say "Ollama is running"
- Check internet: `ping ollama.ai`
- Cancel via the progress notification and retry

**Hardware detection shows no GPU but you have one**
- NVIDIA: ensure `nvidia-smi --version` works in your terminal
- AMD: ensure `rocm-smi` is installed (Linux only)
- Apple Silicon: requires `system_profiler` (built-in on macOS)
- Click **"Choose Different Variant"** in the wizard to override the recommendation

**Ollama upgrade fails during setup**
- The wizard auto-upgrades Ollama when it's older than 0.3.10
- If it fails, manually download from [ollama.com](https://ollama.com), install, then re-run the wizard

---

## Settings Reference

Open Settings (`Ctrl+,`) and search "aiForge" to see all options:

| Setting | What it does | When to change |
|---|---|---|
| `aiForge.provider` | Which AI to use (`auto`, `ollama`, `gemma4`, `anthropic`, `openai`, `huggingface`, `offline`) | Set to `gemma4` for smart Gemma 4 setup |
| `aiForge.ollamaHost` | Ollama server URL | Change to `http://127.0.0.1:11434` on Windows if needed |
| `aiForge.ollamaModel` | Which Ollama model | If you pulled a different model |
| `aiForge.gemma4Model` | Which Gemma 4 variant (`gemma4:e2b`, `e4b`, `26b`, `31b`) | The wizard sets this automatically |
| `aiForge.gemma4ThinkingMode` | Toggle chain-of-thought reasoning | Enable for complex tasks (slower, better) |
| `aiForge.allowHardwareDetection` | Consent to inspect system specs for the Gemma 4 wizard | Leave `true` for smart recommendations |
| `aiForge.allowAutoInstall` | When `true`, skips the per-install confirmation dialog. When `false`, asks before downloading Ollama | Set to `true` only if you want fully hands-off setup |
| `aiForge.openaiBaseUrl` | API endpoint for OpenAI-compatible services | When using Groq, Mistral, LM Studio, etc. |
| `aiForge.codeLensEnabled` | Show Explain/Tests/Refactor above functions | Set to false if too noisy |
| `aiForge.contextBudgetChars` | Max characters sent to AI | Reduce for faster/cheaper responses |
| `aiForge.disabledPlugins` | Plugin IDs to disable | If a plugin is unwanted |

---

## Need Help?

- Press `Ctrl+Shift+P` and type "Evolve AI" to see all available commands
- Check the status bar (bottom-right) for connection status
- Check Developer Tools console (`Help > Toggle Developer Tools`) for detailed error logs
- Report issues at the project's GitHub repository
