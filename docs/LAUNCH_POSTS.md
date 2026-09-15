# Launch Posts — Ready to Copy-Paste

> These are drafts for launching Evolve AI on various platforms.
> Customize with your own screenshots/GIFs before posting.

---

## 1. Hacker News — Show HN

**Title:** `Show HN: Evolve AI – Free AI coding assistant with auto-detecting stack plugins (Ollama/Gemma 4)`

**Text (self-post):**

I built an open-source AI coding assistant for VS Code that does something I haven't seen elsewhere: it auto-detects your tech stack and injects domain knowledge into every AI interaction.

Open a Terraform project? The Terraform plugin activates with HCL best practices, state management patterns, and provider-specific guidance. Working on Databricks? It adds Spark optimization rules, Delta Lake patterns, and Unity Catalog conventions. Got a CSV or a database? The Data Analysis plugin turns it into a PowerBI-style report or inline insights. 17 plugins ship out of the box: Databricks, dbt, Airflow, FastAPI, Django, Terraform, Kubernetes, Docker, Jupyter, PyTorch, Security, Git, pytest, CI/CD, AWS, Azure, and Data Analysis & Reporting.

The key architectural decision: plugins implement a standard IPlugin interface and contribute context hooks, system prompt sections, CodeLens actions, code transforms, and commands. Adding a new stack plugin is ~800 lines of TypeScript with no core changes needed.

On the AI provider side, it supports Ollama and Gemma 4 for fully local/private usage (code never leaves your machine), plus Anthropic Claude, OpenAI-compatible endpoints, Google Gemini, and HuggingFace. Switching between local and cloud is one click.

Technical details:
- TypeScript, strict mode, DI container with interface contracts
- Streaming via async generators with AbortSignal cancellation
- API keys in VS Code SecretStorage, never plaintext
- Context budget system (default 24K chars) with priority allocation
- Plugin registry handles detection, activation, event emission
- MIT licensed

GitHub: https://github.com/EvolveMinds/codeforge-ai-vscode
VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=codeforge-ai.evolve-ai

Happy to answer questions about the architecture, plugin system, or anything else.

---

## 2. Reddit — r/LocalLLaMA

**Title:** `Evolve AI: Free VS Code extension that runs Gemma 4 / Ollama locally as your AI coding assistant — with auto-detecting stack plugins`

**Body:**

Hey r/LocalLLaMA! I built a VS Code extension specifically designed for local AI usage. Here's why I think you'll like it:

**Fully local by design**
- First-class Gemma 4 support with a guided setup wizard (picks your variant based on your hardware, downloads the model, configures everything)
- Works with any Ollama model — Gemma 4, Qwen 2.5 Coder, CodeLlama, DeepSeek, etc.
- Also compatible with LM Studio, llama.cpp, and Jan
- Zero cloud dependency. Your code never leaves your machine.

**What makes it different from Continue/Cody/etc?**

13 auto-detecting stack plugins. When you open a project, the extension scans for marker files and activates relevant plugins automatically:

| Plugin | Detects | What it adds |
|--------|---------|-------------|
| Terraform | `*.tf` files | HCL patterns, state management, provider guides |
| Docker | `Dockerfile` | Multi-stage builds, compose patterns, security |
| Kubernetes | `*.yaml` with k8s | Deployment patterns, resource limits, RBAC |
| Django | `manage.py` | ORM, views, migrations, security |
| FastAPI | `fastapi` imports | Endpoints, Pydantic models, async patterns |
| Databricks | `databricks.yml` | Spark optimization, Delta Lake, Unity Catalog |
| + 7 more | dbt, Airflow, pytest, Jupyter, PyTorch, Security, Git |

Each plugin injects domain-specific context into every AI call. So when you ask "optimize this query" in a Databricks project, the AI knows about partition pruning, Z-ordering, and Delta table optimization — not just generic SQL advice.

**Gemma 4 variants supported:**
- E2B (2.3B, ~7.2GB) — fast, 8GB+ RAM
- E4B (4.5B, ~9.6GB) — recommended, 16GB+ RAM
- 26B MoE (25.2B, ~18GB) — high quality, 32GB+ RAM
- 31B Dense (30.7B, ~20GB) — maximum quality, GPU recommended

**Install:**
1. Install the extension from VS Code Marketplace
2. Run "Switch AI Provider" → select Gemma 4 → follow the wizard
3. That's it. Start coding with `Ctrl+Shift+A`

MIT licensed, fully open source: https://github.com/EvolveMinds/codeforge-ai-vscode

Would love to hear what models you're running and if there are stack plugins you'd want to see added!

---

## 3. Reddit — r/vscode

**Title:** `Evolve AI: Free AI coding assistant with 13 auto-detecting stack plugins — works with Ollama (local) or any cloud provider`

**Body:**

I've been working on a VS Code extension that takes a different approach to AI coding assistance. Instead of a generic AI chat, it has a **plugin architecture** that detects your tech stack and injects domain knowledge automatically.

**How it works:**
- Open a project with `Dockerfile` → Docker plugin activates with container best practices
- Open a project with `*.tf` files → Terraform plugin activates with HCL patterns and state management
- Open a project with `manage.py` → Django plugin activates with ORM, views, and migration guidance
- 17 plugins total, all activate silently based on your workspace files

**Provider flexibility:**
- **Local/free**: Ollama, Gemma 4, LM Studio, llama.cpp — code stays on your machine
- **Cloud**: Anthropic Claude, OpenAI/Groq/Mistral, Google Gemini, HuggingFace
- Switch with one click, no restart needed

**Features:**
- Streaming AI chat sidebar with full project context
- CodeLens hints above every function (Explain | Tests | Refactor)
- Lightbulb actions on diagnostics ("Fix with AI")
- Context budget system (active file + related files + errors + git diff + plugin data)
- Generate code, fix errors, write tests, explain code, generate commit messages
- API keys in VS Code's encrypted SecretStorage

**Keyboard shortcuts:**
- `Ctrl+Shift+A` — Open chat
- `Ctrl+Alt+E` — Explain selection
- `Ctrl+Alt+F` — Fix errors
- `Ctrl+Alt+G` — Generate code

MIT licensed, open source: https://github.com/EvolveMinds/codeforge-ai-vscode
Marketplace: https://marketplace.visualstudio.com/items?itemName=codeforge-ai.evolve-ai

What plugins would you want to see next? Currently thinking about Next.js, Rust, Go, and GraphQL.

---

## 4. Reddit — r/devops

**Title:** `Built a free VS Code AI assistant with auto-detecting plugins for Terraform, Kubernetes, Docker, and Airflow`

**Body:**

Quick show-and-tell: I built a VS Code extension with AI plugins that activate based on your project files. For the devops crowd, these are the relevant ones:

**Terraform plugin** — activates on `*.tf` files
- HCL best practices, module patterns, state management
- Provider-specific guidance (AWS, GCP, Azure)
- Security scanning for misconfigurations
- CodeLens: "Explain this resource" above every resource block

**Kubernetes plugin** — activates on k8s YAML manifests
- Deployment patterns, resource limits, RBAC
- Service mesh, ingress, and networking guidance
- Security best practices (pod security, network policies)

**Docker plugin** — activates on `Dockerfile`
- Multi-stage build optimization
- Image size reduction suggestions
- Docker Compose patterns
- Security: base image scanning, least-privilege

**Airflow plugin** — activates on `airflow` imports
- DAG best practices, task dependencies, XCom patterns
- Sensor and operator guidance
- Performance optimization

All AI runs locally via Ollama (free, private) or any cloud provider. Your infrastructure code never leaves your machine if you don't want it to.

MIT licensed: https://github.com/EvolveMinds/codeforge-ai-vscode

---

## 5. Reddit — r/dataengineering

**Title:** `Free VS Code AI assistant with auto-detecting plugins for Databricks, dbt, Airflow, and Jupyter`

**Body:**

Built a VS Code extension with AI plugins specifically useful for data engineering work:

**Databricks plugin** — activates on `databricks.yml` or Spark imports
- Spark optimization (broadcast joins, partition pruning, AQE)
- Delta Lake patterns (MERGE, Z-ordering, time travel)
- Unity Catalog conventions
- PySpark anti-patterns (collect on large datasets, UDFs vs native functions)
- DLT pipeline best practices

**dbt plugin** — activates on `dbt_project.yml`
- Model design patterns (staging → intermediate → marts)
- Jinja macro conventions
- Testing strategies (unique, not_null, relationships)
- Performance: incremental models, materializations

**Airflow plugin** — activates on `airflow` imports
- DAG patterns, task dependencies, XCom
- Operator and sensor best practices
- Scheduling and retry configuration

**Jupyter plugin** — activates on `*.ipynb`
- Notebook best practices, cell organization
- Data exploration patterns
- Visualization guidance

The plugins inject domain knowledge into every AI interaction automatically — just open your project and start asking questions. Runs fully local with Ollama/Gemma 4 (free, private) or any cloud AI provider.

MIT licensed: https://github.com/EvolveMinds/codeforge-ai-vscode

---

## 6. Product Hunt — Tagline & Description

**Tagline (60 chars max):**
`Free AI coding assistant that auto-detects your tech stack`

**Description:**
Evolve AI is a VS Code extension that brings AI code assistance with deep domain knowledge. Unlike generic AI assistants, it has 13 auto-detecting plugins that activate based on your project files — Terraform, Docker, Kubernetes, Django, FastAPI, Databricks, dbt, and more.

Each plugin injects stack-specific context into every AI interaction. Ask "optimize this" in a Databricks project and the AI knows about partition pruning and Z-ordering. Ask in a Django project and it knows about QuerySet optimization and N+1 queries.

Runs fully local with Ollama or Gemma 4 (free, private, your code never leaves your machine) or any cloud provider (Claude, OpenAI, Google Gemini, HuggingFace). MIT licensed and open source.

**Topics:** Artificial Intelligence, Developer Tools, Open Source, Visual Studio Code

---

## 7. LinkedIn — Enterprise Limited Pilot Launch Post (with PDF Carousel)

**Hook / Post Copy:**

```text
Why do 80% of Enterprise AI pilots stall before reaching production?

It’s almost never the model.
It’s the plumbing:

❌ 6 weeks waiting for InfoSec to approve a cloud LLM SaaS.
❌ 4 weeks waiting for IT administrator rights just to install tools.
❌ Hundreds of legacy Oracle & T-SQL stored procedures that need manual rewrites.
❌ No automated air-gapped licensing for defense/banking enclaves.

Today, we're announcing the **Evolve AI Enterprise Edition — Evaluation & Commercial Program**. 🚀

We are opening up access to enterprise teams (forward-deployed engineering teams, banks, resources, and regulated defense enclaves) to test-drive the full enterprise suite in live client environments.

Here is what enterprise teams get access to on Day 1:

1️⃣ **Zero-Install Standalone Desktop Studio (.exe)**
Runs straight from an encrypted thumb drive or client folder. Zero administrator rights required. Zero corporate proxy blockage.

2️⃣ **100% Air-Gapped Ed25519 Machine-Bound Licensing**
Zero external telemetry. Zero outbound cloud calls. Hardware machine-bound offline signatures built for banking & defense enclaves.

3️⃣ **Phase 5: Automated SQL Transpiler & Migration Suite**
Instantly transpiles Oracle PL/SQL and SQL Server T-SQL to Snowflake and BigQuery. Generates automated Row-Level Security (RLS) policies, referential synthetic test data, and reverse ETL sync workers.

4️⃣ **Phase 6: Multi-Cloud DevOps & Kubernetes Hub**
Scaffolds production Terraform HCL, GPU-enabled Kubernetes manifests, and multi-cloud CI/CD pipelines (GitHub Actions, GitLab CI, Azure DevOps, Bitbucket) in minutes.

5️⃣ **Automated PII Masking & SIEM Forwarder**
Splunk, Datadog, and Sentinel compliant audit trails generated automatically with Great Expectations drift gates.

---

📊 **Attached:** Check out the 8-slide executive carousel breaking down how Forward-Deployed Engineering teams cut client delivery cycles from 3 months to 14 days.

🎯 **Want to join the 5-Partner Limited Pilot?**
Drop a comment with **"PILOT"** below or send us a direct message, and our engineering team will provide a 90-day pilot key, architectural brief, and a 15-minute technical onboarding walkthrough.

🔗 Explore the studio: https://www.evolveminds.com.au/products/evolve-ai/
📦 Free Community Edition on VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=codeforge-ai.evolve-ai

#EnterpriseAI #ForwardDeployedEngineering #DataEngineering #AirGapped #DevOps #Databricks #BigQuery #Snowflake #GenerativeAI #LimitedPilot
```

---

## Posting Tips

### LinkedIn (Carousel PDF Post)
- Export `docs/Evolve_AI_Enterprise_LinkedIn_Carousel.html` to PDF (or use `docs/Evolve_AI_Enterprise_LinkedIn_Carousel.pdf`) and attach as a Document on LinkedIn for maximum algorithmic reach and swipe engagement.
- Post Tuesday-Thursday, 8:00 AM – 9:30 AM local time (AEDT / AEST for Sydney/Melbourne, or EST for US East).
- Tag @Evolve Mind Solutions and relevant team members in the first comment rather than the main post body.
- Reply to every comment within 60 minutes to maintain feed momentum.

### Hacker News
- Post Tuesday-Thursday, 8-10 AM Pacific
- Be in the comments for 6+ hours answering questions
- Talk like a builder, not a marketer. No superlatives.
- Link to GitHub, not the marketplace
- If it doesn't hit front page, you can try again in a few weeks

### Reddit
- Don't cross-post the same text — tailor each post to the subreddit's audience
- Engage with every comment
- Don't be defensive about criticism
- Post during US business hours for maximum visibility
- r/LocalLLaMA on weekdays, r/vscode on any day

### Product Hunt
- Prep 6 weeks ahead — get hunters, gather supporters
- Launch on Wednesday
- Have screenshots/GIFs ready (critical for PH)
- Respond to every comment within 2 hours
- Post a "Maker Comment" explaining why you built it
