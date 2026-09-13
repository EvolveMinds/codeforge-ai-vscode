# Evolve AI Enterprise Edition — Technical Architecture Brief & Pilot Evaluation Guide

> **Confidential & Executive Briefing Document**  
> **Prepared by:** Evolve Mind Solutions Pty Ltd • Sydney, Australia  
> **Target Audience:** Chief Technology Officers (CTOs), VP of Engineering, Heads of Data Engineering, Enterprise Solutions Architects, and InfoSec Officers.  
> **Version:** 2.21.0 • 100% Air-Gapped / Zero Telemetry Guarantee

---

## 1. Executive Summary & Value Proposition

**Evolve AI Enterprise** is a dual-edition Forward-Deployed Engineers (FDE) delivery studio and sovereign AI data platform. Engineered specifically for corporate data practices, investment banks, defense contractors, and enterprise consultancies, it solves the primary bottleneck in enterprise delivery: **compressing the 3-month client pilot onboarding and deployment cycle down to 14 days without compromising data sovereignty.**

Unlike cloud-dependent AI developer tools that route code and database metadata through external SaaS APIs, Evolve AI Enterprise operates **100% locally and air-gapped**. It is distributed as a **zero-installation standalone portable desktop application (`.exe`, 74.7 MB)** that requires **no administrator rights** and **no VS Code installation**, bypassing months of corporate IT and procurement gridlock.

---

## 2. High-Level System Architecture & Component Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           AIR-GAPPED CLIENT HOST MACHINE / ENCLAVE VPC                           │
│                                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │               Evolve AI Enterprise Studio (Portable Standalone Executable / VSIX)         │  │
│  │                                                                                           │  │
│  │  ┌─────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  │  │
│  │  │   Phases 1–4: Core FDE  │  │  Phase 5: Enterprise     │  │  Phase 6: Multi-Cloud    │  │  │
│  │  │   • 7-DB Introspection  │  │  • Oracle/T-SQL Transpiler│  │  • Terraform HCL (3 Clouds│  │  │
│  │  │   • Semantic SchemaMap  │  │  • Row-Level Security    │  │  • GPU Kubernetes        │  │  │
│  │  │   • dbt Mart Compiler   │  │  • Reverse ETL Sync      │  │  • CI/CD (4 Platforms)   │  │  │
│  │  │   • Resilient SDK Gen   │  │  • Synthetic Data & Mock │  │  • Runbooks & Lineage     │  │  │
│  │  └───────────┬─────────────┘  └────────────┬─────────────┘  └────────────┬─────────────┘  │  │
│  │              │                             │                             │                │  │
│  │              ▼                             ▼                             ▼                │  │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                  Deterministic FDE 1–5 Capability Ladder & AI Gateway               │  │  │
│  │  │  • L1: Rule Engine & SQL (<5ms)       • L3: Air-Gapped Policy RAG (<150ms)          │  │  │
│  │  │  • L2: Semantic Router (<30ms)        • L4/L5: MCP Tool Agents & Supervised Swarms  │  │  │
│  │  │  • Local Models: Ollama / Gemma 4     • Private Serving: vLLM / Triton / TGI        │  │  │
│  │  └─────────────────────────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                         Hardware-Enforced Security & Sovereignty Foundation               │  │
│  │  • Ed25519 Asymmetric Offline Licensing          • DPAPI / OS Keychain Secret Vault       │  │
│  │  • In-Flight PII Sanitization & Masking          • SIEM Audit Forwarding (Splunk/Sentinel)│  │
│  │  • Great Expectations & Soda Drift Gates         • Databricks Unity Catalog Lineage       │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │                              │
                                   ▼                              ▼
                 [ Client Internal Databases ]       [ Multi-Cloud VPC Deployment ]
                 Postgres · Snowflake · BigQuery     AWS ECS / GCP Cloud Run / Azure
                 SQL Server · Oracle · ClickHouse    Terraform GitOps Repository
```

---

## 3. The 6-Phase Delivery Studio Breakdown

### Phase 1: Live Database Introspection (7 Engines)
* **Engines Supported:** PostgreSQL, Snowflake, Google BigQuery, Microsoft SQL Server, MySQL, SQLite, and ClickHouse.
* **Mechanism:** Direct, read-only driver connections executing deterministic metadata catalog queries (`information_schema`, system catalogs).
* **Security Guarantee:** Schema metadata and sample distributions are processed entirely in memory. Zero external network telemetry.

### Phase 2: Automated Semantic SchemaMapper & dbt Scaffolding
* **Capabilities:** Zero-shot mapping of cryptic enterprise column naming conventions (e.g., `CUST_TXN_NBR` ➔ `customer_id`, `TX_AMT_NET` ➔ `net_amount`).
* **Output:** Compiles production-ready **dbt dimensional staging models** (`stg_client_data.sql`), schema YAML files with tests (`unique`, `not_null`), and automated data contracts.

### Phase 3: Resilient Client Connector SDK Generator
* **Languages:** Modern TypeScript (ESNext/Fetch) and Python (Asyncio/Httpx).
* **Guardrails:** Embedded exponential backoff with jitter, `Retry-After` header parsing, circuit breakers, and rate-limiting guards to prevent tripping enterprise firewalls.

### Phase 4: Client Handover Runbooks & Architecture Diagrams
* **Deliverables:** Auto-compiles markdown and HTML documentation:
  * `DEPLOYMENT_RUNBOOK.md`: Complete operations guide, smoke tests, and rollback procedures.
  * `DATA_DICTIONARY.md`: Full entity-relationship schema catalog with nullability and types.
  * Context-aware Mermaid sequence diagrams detailing current vs. proposed workflows.

### Phase 5: Heavyweight Enterprise Modernization Suite *(Paid Enterprise Exclusive)*
* **Oracle & T-SQL Transpiler:** Converts legacy Oracle PL/SQL packages, stored procedures, and SQL Server T-SQL scripts directly into modern Snowflake and BigQuery SQL models with dbt Jinja headers and automated unit tests. Saves hundreds of migration hours.
* **Row-Level Security (RLS) Generator:** Scaffolds multi-tenant tenant-isolation policies, user context functions, and masking rules across Postgres, Snowflake, and BigQuery.
* **Reverse ETL Sync Workers:** Generates idempotent data synchronization microservices with dead-letter queues, exponential batching, and crash recovery for syncing data warehouse marts back into SaaS APIs and operational datastores.
* **Synthetic Data & Mock APIs:** Produces referentially intact synthetic CSV/JSON test datasets and zero-dependency mock REST servers in Node.js and Python for offline testing.

### Phase 6: Multi-Cloud DevOps & Infrastructure Hub *(Paid Enterprise Exclusive)*
* **Terraform HCL Scaffolder:** Generates complete production Infrastructure as Code for AWS, GCP, and Azure (VPC, private subnets, least-privilege IAM roles, Cloud Run / ECS containers, BigQuery / Snowflake datasets).
* **GPU Kubernetes Manifests & Docker Compose:** Hardened multi-stage container Dockerfiles and Kubernetes deployment manifests with GPU resource allocations and namespace boundaries.
* **Automated CI/CD Workflows:** 1-click generation of pipeline workflows for GitHub Actions, GitLab CI, Bitbucket Pipelines, and Azure DevOps.

---

## 4. InfoSec, Compliance & Cryptographic Trust Model

| Security Dimension | Implementation Standard in Evolve AI Enterprise |
| :--- | :--- |
| **Air-Gapped Guarantee** | 100% offline deterministic execution. No analytics trackers, no SaaS telemetry, no external phone-home network calls. |
| **Offline Licensing** | Asymmetric **Ed25519 digital signatures** verified against a compiled master public key. Licenses can be issued, renewed, and machine-fingerprinted without an internet connection. |
| **Zero-Admin Portability** | Standalone portable executable (`.exe`, 74.7 MB) runs immediately from local user space or encrypted USB without requiring local administrative rights or registry tampering. |
| **Credential Security** | Zero plaintext credentials in files or workspace. Backed by OS-level hardware vaults: Windows Credential Manager (DPAPI), macOS Keychain, or Linux SecretService. |
| **Audit & Governance** | Cryptographically signed compliance receipts. Tamper-evident audit logs forwarded to enterprise SIEM platforms (**Splunk, Datadog, Microsoft Sentinel**). In-flight PII sanitization and masking. |
| **Data Quality Drift** | Pre-flight validation runners using **Great Expectations and Soda Core** to halt pipelines before bad data reaches production. |
| **Regulatory Alignment** | Aligned with **ISO 42001** and the **Australian Privacy Act** automated-decision governance rules. |

---

## 5. 90-Day Pilot Evaluation Protocol (How to Evaluate)

### Step 1: Launch the Portable Desktop Studio (60 Seconds)
1. Download the standalone Windows executable:  
   `evolve-ai-enterprise-portable-2.21.0-win32-x64.exe` (74.7 MB) from `https://www.evolveminds.com.au/products/evolve-ai/download/`.
2. Double-click to launch. No installer, no administrative privileges, and no VS Code required.

### Step 2: Activate Your Enterprise License
* **Instant Evaluation:** Inside the app, navigate to Settings or the Enterprise Suite tab and click **"✨ 30-Day Air-Gapped Platinum Trial"** to immediately evaluate in-memory.
* **Custom Pilot License:** Enter your team's signed Ed25519 key (`EM-ENT-V1...`) provided by Evolve Mind Solutions to unlock full 90-day multi-seat evaluation.

### Step 3: Test on Your Client Stack
* Connect the **Database Introspector** to a local or VPC database.
* Transpile a legacy Oracle/T-SQL query into Snowflake or BigQuery.
* Scaffold a Terraform deployment and review the generated `DEPLOYMENT_RUNBOOK.md`.

---

## 6. Contact & Enterprise Support

* **Organization:** Evolve Mind Solutions Pty Ltd (ABN: 41 672 546 217)
* **Headquarters:** Level 1, 63-73 Ann Street, Surry Hills, Sydney NSW 2010, Australia
* **Product Portal:** [evolveminds.com.au/products/evolve-ai/](https://www.evolveminds.com.au/products/evolve-ai/)
* **Direct Pilot Contact:** `contact@evolveminds.com.au`
