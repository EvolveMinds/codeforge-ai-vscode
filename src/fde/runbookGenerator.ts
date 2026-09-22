/**
 * fde/runbookGenerator.ts — Client Handoff Runbook & Architecture Generator
 *
 * For Forward Deployed Engineers (FDEs) to generate complete, client-ready handoff
 * documentation at the conclusion of a pilot or engagement.
 *
 * Outputs:
 *  - ARCHITECTURE.md (with interactive Mermaid diagrams)
 *  - DEPLOYMENT_RUNBOOK.md (Client IT operations guide)
 *  - DATA_DICTIONARY.md (Column-by-column transformation mapping)
 *  - ENVIRONMENT_CATALOG.md (Environment variable reference)
 */

import { FdeEngagementState } from './fdeContext';
import { NOT_MEASURED, documentBanner, StudioMode } from './provenance';

/** Renders a discovery field, or a visible placeholder when it was never filled in. */
function discovered(value: string | undefined, what: string): string {
  const v = (value || '').trim();
  return v.length > 0 ? v : `${NOT_MEASURED} _(${what} not recorded during discovery)_`;
}

export class RunbookGenerator {
  static generateArchitectureDoc(state: FdeEngagementState): string {
    const s = state || ({} as any);
    const client = s.clientName || 'Client';
    const targetVpc = s.targetVpc || 'gcp-firebase';

    let schemaFlows = '';
    const marts = s.dataMarts || [];
    const schemaMappings = s.schemaMappings || [];
    const apiConnectors = s.apiConnectors || [];

    if (schemaMappings.length > 0 || marts.length > 0) {
      const stagingFlows = schemaMappings.map((m: any) => {
        const cleanSrc = (m.sourceName || 'source').replace(/[^a-zA-Z0-9_]/g, '_');
        const cleanTgt = (m.targetModelName || 'model').replace(/[^a-zA-Z0-9_]/g, '_');
        const colCount = m.columns ? m.columns.length : 0;
        return `        ${cleanSrc}["Raw Source: ${m.sourceName}\\n(${colCount} columns)"] --> ${cleanTgt}["dbt Staging: ${m.targetModelName}\\n(Type Casts & Renaming)"]`;
      }).join('\n');

      let martFlows = '';
      if (marts.length > 0) {
        martFlows = marts.map((mart: any) => {
          const cleanMart = (mart.martName || 'mart').replace(/[^a-zA-Z0-9_]/g, '_');
          const baseCte = (mart.baseModel || 'base').replace(/[^a-zA-Z0-9_]/g, '_');
          const joinCtes = (mart.joins || []).map((j: any) => (j.joinModel || '').replace(/[^a-zA-Z0-9_]/g, '_')).filter(Boolean);
          const joinLines = joinCtes.map((j: any) => `        ${j} --> ${cleanMart}`).join('\n');
          const dimCount = mart.dimensions ? mart.dimensions.length : 0;
          const metricCount = mart.metrics ? mart.metrics.length : 0;
          return `        ${baseCte} --> ${cleanMart}["dbt Mart: ${mart.martName}\\n(${dimCount} dims • ${metricCount} metrics)"]\n${joinLines}\n        ${cleanMart} --> Database`;
        }).join('\n');
      } else {
        martFlows = schemaMappings.map((m: any) => `        ${(m.targetModelName || 'model').replace(/[^a-zA-Z0-9_]/g, '_')} --> Database`).join('\n');
      }

      schemaFlows = `${stagingFlows}\n${martFlows}`;
    } else {
      schemaFlows = `        RawData["Raw Client Data\\n(CSV / Oracle / SQL)"] --> StagingModel["dbt Staging Model\\n(Type Casts & Renaming)"]\n        StagingModel --> Database`;
    }

    let apiFlows = '';
    if (apiConnectors.length > 0) {
      apiFlows = apiConnectors.map((c: any) => {
        const cleanConn = (c.connectorName || 'conn').replace(/[^a-zA-Z0-9_]/g, '_');
        return `        ${cleanConn}_Api["External API: ${c.connectorName}\\n(${c.baseUrl})"] --> ${cleanConn}_Sdk["Resilient SDK: ${c.connectorName}\\n(Auth: ${c.authType})"]\n        ${cleanConn}_Sdk --> Backend`;
      }).join('\n');
    } else {
      apiFlows = `        ClientApi["Client Internal APIs\\n(REST / Webhooks)"] --> ResilientSdk["Resilient Connector SDK\\n(Retries & Rate Limits)"]\n        ResilientSdk --> Backend`;
    }

    // Section 5B writes `deploymentConfig`; `deployment` is the older discovered-
    // resources session. Prefer what the FDE actually entered, and say NOT MEASURED
    // rather than inventing "1 vCPU / 1Gi / VPC default" for a client's blueprint.
    const dcfg = state.deploymentConfig;
    const dep = state.deployment as any;
    const cfg = {
      cpu: dcfg?.cpu || dep?.cpu,
      memory: dcfg?.memory || dep?.memory,
      gpu: dcfg?.gpu || dep?.gpu,
      vpcId: dcfg?.vpcId || dep?.vpcId,
      ingress: dcfg?.ingress || dep?.ingress,
      secretsProvider: dcfg?.secretsProvider || dep?.secretsProvider,
      projectId: dcfg?.projectId || dep?.projectId
    };

    const cloudProvider = (dcfg?.provider || state.deployment?.discoveredCloudResources?.provider || targetVpc || 'gcp').toUpperCase();
    const vpcInfo = cfg.vpcId ? `\\n(VPC: ${cfg.vpcId})` : '';

    const disc = state.discovery;
    const ai = state.aiSolution;
    const evals = state.evals;

    const roiSection = disc?.controllersThreeNumbers ? `
### Controller's Three Numbers & Economic ROI (Phase 1)
* **Monthly Volume:** \`${disc.controllersThreeNumbers.volume.toLocaleString()} tasks/mo\`
* **Handle Time / Latency:** \`${disc.controllersThreeNumbers.handleTimeMins} min/task\`
* **Fully-Burdened Wage:** \`$${disc.controllersThreeNumbers.hourlyWage}/hr\`
* **Projected Monthly Savings:** \`$${((disc.controllersThreeNumbers.volume * (disc.controllersThreeNumbers.handleTimeMins / 60) * disc.controllersThreeNumbers.hourlyWage * 0.7) / 1000).toFixed(1)}k / month\`
* **Annual Capacity Reclaimed:** \`${Math.round((disc.controllersThreeNumbers.volume * (disc.controllersThreeNumbers.handleTimeMins / 60) * 0.7) * 12).toLocaleString()} labor hours/year\`
` : '';

    // Architecture claims are only as good as the decisions actually recorded.
    // Where 3A/3B/3C never ran, say so rather than asserting a rule engine the
    // client never agreed to.
    const ragLine = ai?.ragArchitectureName
      ? `**${ai.ragArchitectureName}**${ai.isGroundedRagScaffolded ? ` — air-gapped ${ai.ragStore || 'pgvector'}, ${ai.ragChunkSize || 128}-token window` : ''}`
      : (ai?.isGroundedRagScaffolded
        ? `Air-Gapped ${ai.ragStore || 'pgvector'} with ${ai.ragChunkSize || 128}-token semantic window`
        : NOT_MEASURED);

    const aiSolutionSection = `
---

## 3. AI Solutioning Architecture & Decision Gates (Phase 3)

* **Architecture Capability Target:** ${ai?.ladderTitle ? `**${ai.ladderTitle}**` : NOT_MEASURED}
* **Decision Gate Rationale:** ${ai?.ruleModelParadigm || NOT_MEASURED}
* **Rule vs. Model Verdict:** ${ai?.ruleVsModelVerdict ? `**${ai.ruleVsModelVerdict.toUpperCase()}** — ${ai.ruleVsModelRationale || 'rationale not recorded'}` : NOT_MEASURED}
* **RAG Vector Architecture:** ${ragLine}
* **Model Context Protocol (MCP):** ${ai?.isMcpServerScaffolded ? 'Standardized MCP Server (`src/mcp/server.ts`) exposing secure database tools' : 'Not scaffolded for this engagement'}
`;

    // Every number in this section is a measurement or it is absent. The old
    // `|| 98.0` / `|| 49` / `|| 18` fallbacks produced a complete, plausible
    // reliability report for a system that had never been executed — which is
    // exactly the failure this section now refuses to reproduce.
    const ran = evals?.benchmarkExecuted === true;

    const evalsSection = `
---

## 4. Reliability & Evaluation Suite (Phase 4)

${ran ? '' : `> [!CAUTION]
> **No golden benchmark has been executed for this engagement.** The metrics below
> are unpopulated by design. Run the Phase 4 benchmark against a real target before
> presenting any reliability claim to the client.

`}* **Golden Benchmark Accuracy:** ${ran && evals?.accuracyScorePct !== undefined
      ? `**${evals.accuracyScorePct}%** (${evals.passedCases ?? '?'} / ${evals.totalCases ?? '?'} cases passed)`
      : NOT_MEASURED}
* **Latency Profile (P50 / P95):** ${ran && evals?.latencyP50Ms !== undefined
      ? `\`${evals.latencyP50Ms}ms / ${evals.latencyP95Ms ?? '?'}ms\``
      : NOT_MEASURED}
* **Citation & Groundedness:** ${evals?.groundednessScorePct !== undefined
      ? `**${evals.groundednessScorePct}%**${evals.groundednessMethod ? ` (method: ${evals.groundednessMethod})` : ''}`
      : NOT_MEASURED}
* **Audit Trail Integrity:** ${evals?.groundednessAuditSignature
      ? `\`${evals.groundednessAuditSignature}\` — SHA-256 content digest (tamper-evident; **not** a digital signature)`
      : NOT_MEASURED}
* **Human-in-the-Loop (HITL) Policy:** ${evals?.hitlThreshold
      ? `Items below threshold (\`${evals.hitlThreshold}\`) auto-cleared; higher-risk items routed to the supervisor queue.`
      : NOT_MEASURED}
`;

    return `${documentBanner((s.studioMode as StudioMode) || 'DEMO')}# ${client} — System Architecture & Integration Blueprint

> **Generated by Evolve AI (Forward Deployed Engineer Suite)**
> **Engagement Target:** ${client} Production & Pilot Deployment
> **Infrastructure Target:** ${cloudProvider} ${vpcInfo}
> **Canonical Delivery Standard:** 5-Phase Forward-Deployed Engineering Curriculum

---

## 1. Executive Problem Reframing & Economic Boundaries (Phase 1)

* **Original Client Request:** ${disc?.rawClientAsk?.trim() ? `"${disc.rawClientAsk}"` : discovered(undefined, 'raw client ask')}
* **Identified Failure Modes:** ${discovered(disc?.riskAnalysis, 'risk analysis')}
* **Agreed Production Target (Observation-to-Spec / O2S):** ${discovered(disc?.reframedProblem, 'reframed problem')}
* **Explicit Out-of-Scope Boundaries:** ${(disc?.outOfScope && disc.outOfScope.length > 0) ? disc.outOfScope.map(o => `\`${o}\``).join(', ') : `${NOT_MEASURED} _(no boundary locks agreed during discovery)_`}
${roiSection}

---

## 2. Executive System Overview & Data Lineage

This document specifies the end-to-end architecture, data lineage flows, and deployment topology implemented for the **${client}** pilot engagement.

\`\`\`mermaid
graph TD
    subgraph Client Data Ingestion & Mart Layer
${schemaFlows}
    end

    subgraph External & Connected API Feeds
${apiFlows}
    end

    subgraph Cloud Delivery Layer (${cloudProvider})
        Frontend["Web & App Frontends\\n(SPA + Edge Caching)"]
        Backend["Compute Services / Containers\\n(${cfg.cpu || 'unspecified'} vCPU · ${cfg.memory || 'unspecified'})"]
        Database["PostgreSQL / Supabase / Lakehouse\\n(Relational & Analytics)"]
    end

    Frontend --> Backend
    Backend --> Database
\`\`\`

---

## 3. Ingested Data Models & Transformations (Phase 2)

### Staging Models
| Source Dataset | Target Model | Dialect | Columns | Status |
| :--- | :--- | :--- | :---: | :--- |
${schemaMappings.map((m: any) => `| \`${m.sourceName}\` | \`${m.targetModelName}\` | \`${m.dialect}\` | ${m.columns ? m.columns.length : 0} columns | Active |`).join('\n') || '| *(No schema models mapped yet)* | - | - | - | - |'}

### Downstream Business Marts
| Mart Name | Base Model | Joins | Dimensions | Metrics | Status |
| :--- | :--- | :--- | :---: | :---: | :--- |
${marts.map((mart: any) => `| \`${mart.martName}\` | \`${mart.baseModel}\` | ${(mart.joins || []).map((j: any) => `${j.joinType} ${j.joinModel}`).join(', ') || 'None'} | ${mart.dimensions ? mart.dimensions.length : 0} | ${mart.metrics ? mart.metrics.length : 0} | Active |`).join('\n') || '| *(No data marts generated yet)* | - | - | - | - | - |'}

### Connected APIs & External Feeds
| Connector Name | Base URL | Auth Strategy | Endpoints | Status |
| :--- | :--- | :--- | :---: | :--- |
${apiConnectors.map((c: any) => `| \`${c.connectorName}\` | \`${c.baseUrl}\` | \`${c.authType}\` | ${c.endpoints ? c.endpoints.length : 0} endpoints | Active |`).join('\n') || '| *(No API connectors registered)* | - | - | - | - |'}

${aiSolutionSection}
${evalsSection}
---

## 5. Multi-Cloud Infrastructure & Security Posture (Phase 5)

* **Compute Target:** ${cloudProvider} (${cfg.cpu ? `${cfg.cpu} vCPU` : NOT_MEASURED}, ${cfg.memory ? `${cfg.memory} Memory` : NOT_MEASURED}, GPU: ${cfg.gpu || 'None'})
* **Network Isolation:** Ingress set to ${cfg.ingress ? `\`${cfg.ingress}\`` : NOT_MEASURED} within VPC ${cfg.vpcId ? `\`${cfg.vpcId}\`` : NOT_MEASURED}.
* **Secrets Provider:** ${cfg.secretsProvider ? `\`${cfg.secretsProvider}\`` : NOT_MEASURED}.
* **Air-Gapped Ready:** The deployment is compatible with strict air-gapped and non-exfiltrating client boundaries.
`;
  }

  static generateDeploymentRunbook(state: FdeEngagementState): string {
    const client = state.clientName || 'Client';
    const cfg = {
      projectId: state.deploymentConfig?.projectId || (state.deployment as any)?.projectId
    };

    return `${documentBanner((state.studioMode as StudioMode) || 'DEMO')}# ${client} — Operations & Deployment Runbook

> **Audience:** Client IT, DevOps, and Platform Engineering Teams  
> **Maintained by:** Forward Deployed Engineering (FDE)  

---

## 1. Quick-Start Deployment

To deploy updates to the client environment, execute the cross-platform deployment script from the project root:

\`\`\`bash
# Linux / macOS (Bash)
./scripts/deploy.sh pilot all

# Windows (PowerShell)
.\\scripts\\deploy.ps1 -Environment pilot -Component all
\`\`\`

---

## 2. Pre-Deployment Health & Sanity Checklist

Before initiating any deployment to staging or production, run the pre-flight verification script:

\`\`\`bash
node scripts/prepare-deployment.js --clean
\`\`\`

### Automated Verifications:
1. **Dangling Artifacts:** Cleans up temporary or backup files (\`*.bak\`, \`*.tmp\`, \`*_OLD.*\`).
2. **Secret Leak Prevention:** Scans build artifacts to ensure no private keys or tokens are exposed.
3. **Environment Parity:** Verifies that all required keys in \`.env.example\` are populated in the active environment.

---

## 3. Rollback Procedure

If an issue is detected post-deployment:

### Frontend (Firebase Hosting):
\`\`\`bash
# Roll back to the previous stable release instantly:
npx firebase-tools hosting:rollback --project ${cfg.projectId || 'PROJECT_ID'}
\`\`\`

### Backend (Cloud Run):
\`\`\`bash
# Route 100% of traffic back to the previous stable revision:
gcloud run services update-traffic ${state.deployment?.backendService || 'api-service'} --to-revisions=PREVIOUS_REVISION=100
\`\`\`

---

## 4. Troubleshooting & Diagnostics

| Symptom | Probable Cause | Action |
| :--- | :--- | :--- |
| **HTTP 429 Too Many Requests** | Upstream client rate limit reached | Verify \`RATE_LIMIT_PER_SEC\` config in connector SDK. |
| **Missing Environment Variable** | \`.env\` parity discrepancy | Compare local \`.env\` against \`.env.example\`. |
| **CORS Error on Frontend** | Cloud Run domain mismatch | Update \`CLIENT_URLS\` in backend environment configuration. |
`;
  }

  static generateDataDictionary(state: FdeEngagementState): string {
    const s = state || ({} as any);
    const client = s.clientName || 'Client';
    const schemaMappings = s.schemaMappings || [];
    const marts = s.dataMarts || [];

    let doc = `# ${client} — Data Dictionary & Field Mapping Reference\n\n`;

    if (schemaMappings.length === 0) {
      doc += `*No schema mappings have been generated yet. Use Phase 1 (Schema Mapper) to map client schemas.*\n`;
      return doc;
    }

    for (const m of schemaMappings) {
      doc += `## Staging Model: \`${m.targetModelName}\` (Source: \`${m.sourceName}\`)\n\n`;
      doc += `| Target Column | Source Column | Target Type | Transformation Rule | Confidence |\n`;
      doc += `| :--- | :--- | :--- | :--- | :---: |\n`;

      for (const col of (m.columns || [])) {
        doc += `| \`${col.targetColumn}\` | \`${col.sourceColumn}\` | \`${col.targetType}\` | \`${col.transformation || 'Direct mapping'}\` | ${Math.round((col.confidence || 1) * 100)}% |\n`;
      }
      doc += `\n`;
    }

    if (marts.length > 0) {
      doc += `## Downstream Dimensional Data Marts\n\n`;
      for (const mart of marts) {
        doc += `### Mart: \`${mart.martName}\` (Base: \`${mart.baseModel}\`)\n\n`;
        doc += `* **Joins:** ${(mart.joins || []).map((j: any) => `\`${j.joinType} JOIN ${j.joinModel} ON ${j.onCondition}\``).join(', ') || 'None'}\n`;
        doc += `* **Dimensions:** ${(mart.dimensions || []).map((d: any) => `\`${d}\``).join(', ') || 'None'}\n\n`;
        doc += `| Metric Name | Formula / Expression |\n`;
        doc += `| :--- | :--- |\n`;
        for (const metric of (mart.metrics || [])) {
          doc += `| \`${metric.name}\` | \`${metric.expr}\` |\n`;
        }
        doc += `\n`;
      }
    }

    return doc;
  }

  static generateEnvironmentCatalog(state: FdeEngagementState): string {
    const client = state.clientName || 'Client';
    const envVars = (state.discoveredEnvVars && state.discoveredEnvVars.length > 0) ? state.discoveredEnvVars : [
      'GCP_PROJECT_ID',
      'FIREBASE_TOKEN',
      'DATABASE_URL',
      'API_BEARER_TOKEN',
      'PORT'
    ];

    return `# ${client} — Environment Variables & Secrets Reference

> **Maintained by:** Forward Deployed Engineering (FDE)  
> **Target Environment:** ${state.deployment?.environment || 'pilot'}  

---

## 1. Required Runtime Configuration

| Variable Name | Required | Secret? | Description / Expected Value |
| :--- | :---: | :---: | :--- |
${envVars.map(v => {
  const isSecret = /KEY|SECRET|TOKEN|PASSWORD|AUTH|CREDENTIAL/i.test(v);
  return `| \`${v}\` | **Yes** | ${isSecret ? '🔒 Secret' : 'Public'} | Runtime configuration for \`${v}\` |`;
}).join('\n')}

---

## 2. Setup Guide

### Local Development (\`.env\`):
\`\`\`bash
cp .env.example .env
# Fill in local secrets safely
\`\`\`

### CI/CD Deployment:
Configure all secrets under GitHub Actions / GitLab CI pipeline settings before triggering automated pilot builds.
`;
  }

  static generateExecutiveDemoScript(state: FdeEngagementState): string {
    const client = state.clientName || 'Client';
    const disc = state.discovery;
    const ai = state.aiSolution;
    const evals = state.evals;
    const nums = disc?.controllersThreeNumbers;

    // No ROI fallback. Quoting "$61.3k/month" for an engagement whose Controller's
    // Three Numbers were never captured is the kind of figure a CFO acts on.
    const hasRoi = !!nums && nums.volume > 0 && nums.handleTimeMins > 0 && nums.hourlyWage > 0;
    const monthlySavings = hasRoi
      ? `$${((nums!.volume * (nums!.handleTimeMins / 60) * nums!.hourlyWage * 0.7) / 1000).toFixed(1)}k`
      : NOT_MEASURED;
    const hoursReclaimed = hasRoi
      ? `${Math.round(nums!.volume * (nums!.handleTimeMins / 60) * 0.7).toLocaleString()} hours/month`
      : NOT_MEASURED;

    return `${documentBanner((state.studioMode as StudioMode) || 'DEMO')}# 🎤 ${client} — 5-Minute Executive Demo Presentation Script

> **Purpose:** Forward Deployed Engineer Executive Presentation Script for client CFO, CIO, and Business Unit Leaders.  
> **Total Duration:** Exactly 5 Minutes (Strict FDE Timeboxed Protocol)  
> **Prepared by:** Evolve AI Delivery Studio  

---

### [0:00 - 1:00] Slide 1: The Business Problem & The Controller's 3 Numbers
* **Speaker:** "Thank you everyone. Today, we're showing you the working prototype built specifically on your infrastructure. When we started, the original ask was: *'${disc?.rawClientAsk || 'Automate our manual workflow with AI'}'*.
* Most AI vendors would build a generic chatbot that hallucinates numbers. Instead, we started by **refusing that ask** and calculating your exact economics with your Controller.
* You process **${nums?.volume?.toLocaleString() || '10,000'} tasks a month**, taking **${nums?.handleTimeMins || 15} minutes each**, at an average cost of **$${nums?.hourlyWage || 35}/hr**.
* By implementing deterministic automation with zero hallucinations, this system reclaims **${hoursReclaimed}** and delivers **${monthlySavings}/month in hard savings**, while establishing strict boundaries: no unverified writes and no unsupervised actions above threshold."

---

### [1:00 - 2:00] Slide 2: The Plumbing — Connecting Your Data Wire
* **Speaker:** "Next, we didn't ask you to migrate your data. In Phase 2, we plugged directly into your existing data feeds.
* We generated typed staging models for your raw datasets and compiled dbt dimensional marts.
* For your external APIs, we scaffolded hardened, resilient SDKs with automated rate limiting and exponential backoff.
* Everything runs in your VPC, with all credentials encrypted in your machine vault."

---

### [2:00 - 3:00] Slide 3: Deterministic AI Solutioning (FDE Capability Ladder)
* **Speaker:** "Now let's look at the AI layer. We deliberately selected **${ai?.ladderTitle || 'Level 1: Deterministic Rule Engine & Compiled SQL'}** from the FDE capability ladder.
* Why? Because arithmetic and financial rules cannot tolerate a 2% hallucination rate.
* Any task requiring strict math runs through compiled SQL and deterministic code in under 10 milliseconds.
* Where unstructured policy interpretation is needed, our air-gapped RAG pipeline retrieves exact citations from your handbook with 128-token chunk precision."

---

### [3:00 - 4:00] Slide 4: Proof of Reliability — Golden Benchmark
${evals?.benchmarkExecuted === true && evals?.accuracyScorePct !== undefined
      ? `* **Speaker:** "Before touching any production traffic, we proved reliability against the golden evaluation suite.
* The system scored **${evals.accuracyScorePct}% accuracy** across ${evals.totalCases ?? '?'} cases${evals.latencyP50Ms !== undefined ? `, with a P50 latency of **${evals.latencyP50Ms} milliseconds**` : ''}.
* Every output carries a SHA-256 content digest in the audit trail, so any later tampering is detectable.
* For high-risk edge cases or requests over the automated limit, transactions are routed to your Human-in-the-Loop supervisor queue for one-click approval."`
      : `> [!CAUTION]
> **Do not deliver this slide.** No golden benchmark has been executed for this
> engagement, so there is no reliability result to present. Run the Phase 4
> benchmark against a real target, then regenerate this script.

* **Speaker:** _(no measured reliability results — slide intentionally left unscripted)_`}

---

### [4:00 - 5:00] Slide 5: Production Deployment & Immediate Handoff
* **Speaker:** "Finally, this is not a slide deck—it is deployable code.
* We have generated your complete Multi-Cloud Infrastructure as Code—ready for ${state.deployment?.targetVpc || 'GCP Cloud Run'} and Kubernetes.
* Your engineering team receives the complete operations runbook, data dictionary, and single-command rollback procedure today.
* We are ready to begin pilot traffic rollout on Monday. Any questions?"
`;
  }

  static generateCompleteHandoffPackage(state: FdeEngagementState): string {
    const arch = this.generateArchitectureDoc(state);
    const deploy = this.generateDeploymentRunbook(state);
    const dataDict = this.generateDataDictionary(state);
    const env = this.generateEnvironmentCatalog(state);
    const demo = this.generateExecutiveDemoScript(state);

    // Banner first: this is the bundle a client is most likely to be handed,
    // so the DEMO warning must be the first thing on the page rather than
    // appearing partway down inside the embedded architecture section.
    return `${documentBanner((state.studioMode as StudioMode) || 'DEMO')}# 📦 ${state.clientName || 'Client'} — Complete Engagement Handoff Bundle
> **Generated on:** ${new Date().toISOString().split('T')[0]}
> **Prepared by:** Forward Deployed Engineering Studio (Evolve AI)

---

${arch}

---

${deploy}

---

${dataDict}

---

${env}

---

${demo}
`;
  }
}

