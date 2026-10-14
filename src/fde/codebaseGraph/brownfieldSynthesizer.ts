/**
 * fde/codebaseGraph/brownfieldSynthesizer.ts — Brownfield Evolutionary Modernization & Strangler Fig Synthesizer
 *
 * Classifies brownfield codebase components (Preserve / Strangle / Retire) and
 * auto-generates executable Mermaid As-Is and To-Be workflow topologies
 * for Phase 1 Step 3 and Phase 3 AI Solutioning.
 */

import { CodeNode, CircularDependencyLoop, TemporalLink, DbCodeLineage } from './types';
import { WorkspaceArchetype } from './workspaceArchetypeMiner';

export interface ModernizationSynthesisResult {
  asIsMermaid: string;
  toBeMermaid: string;
  modernizationCandidates: CodeNode[];
  preservedCore: CodeNode[];
  retiredCandidates: CodeNode[];
  summaryNarrative: string;
}

export class BrownfieldSynthesizer {
  /**
   * Primary entry point: Synthesizes brownfield metrics into architecture diagrams and classifications.
   */
  public static synthesize(
    nodes: CodeNode[],
    hotspots: CodeNode[],
    cycles: CircularDependencyLoop[],
    temporalCouplings: TemporalLink[],
    dbLineages: DbCodeLineage[],
    archetype?: WorkspaceArchetype
  ): ModernizationSynthesisResult {
    // 1. Perform Strangler Fig Categorization
    const cycleFiles = new Set<string>();
    for (const c of cycles) {
      for (const f of c.cycle) cycleFiles.add(f);
    }

    const modernizationCandidates: CodeNode[] = [];
    const preservedCore: CodeNode[] = [];
    const retiredCandidates: CodeNode[] = [];

    for (const node of nodes) {
      if (node.isHotspot || cycleFiles.has(node.id) || node.defectCount >= 3) {
        node.modernizationCategory = 'strangle';
        modernizationCandidates.push(node);
      } else if (node.inDegree === 0 && node.outDegree === 0 && node.commitCount <= 1) {
        node.modernizationCategory = 'retire';
        retiredCandidates.push(node);
      } else if (node.commitCount > 0 && node.defectCount === 0 && !node.busFactorRisk) {
        node.modernizationCategory = 'preserve';
        preservedCore.push(node);
      } else {
        node.modernizationCategory = 'neutral';
      }
    }

    // 2. Identify top entities for diagram generation
    const topHotspot = hotspots.length > 0 ? hotspots[0] : null;
    const topHotspotLabel = topHotspot ? this.cleanLabel(topHotspot.label) : 'Legacy Core Monolith';
    const primaryDbTable = dbLineages.length > 0
      ? dbLineages[0].tableName
      : (archetype?.primaryTables?.[0] || 'Operational Store');

    // 3. Generate As-Is Mermaid Sequence Diagram (archetype-grounded if detected)
    const asIsMermaid = (archetype && (archetype.packages.length > 0 || archetype.userPersonas.length > 0))
      ? this.generateArchetypeAsIsDiagram(archetype, hotspots, cycles, primaryDbTable)
      : this.generateAsIsDiagram(topHotspotLabel, primaryDbTable, hotspots, cycles);

    // 4. Generate To-Be Mermaid Sequence Diagram (archetype-grounded if detected)
    const toBeMermaid = (archetype && (archetype.packages.length > 0 || archetype.userPersonas.length > 0))
      ? this.generateArchetypeToBeDiagram(archetype, modernizationCandidates.length, primaryDbTable)
      : this.generateToBeDiagram(topHotspotLabel, primaryDbTable, modernizationCandidates.length);

    // 5. Generate human-readable narrative summary
    const summaryNarrative = this.generateNarrative(
      nodes.length,
      hotspots.length,
      modernizationCandidates.length,
      cycles.length,
      temporalCouplings.length,
      dbLineages.length,
      archetype
    );

    return {
      asIsMermaid,
      toBeMermaid,
      modernizationCandidates,
      preservedCore,
      retiredCandidates,
      summaryNarrative
    };
  }

  /**
   * Generates domain-grounded Mermaid sequence diagram matching the workspace archetype (e.g. Next.js, monorepo, AI stack).
   */
  private static generateArchetypeAsIsDiagram(
    archetype: WorkspaceArchetype,
    hotspots: CodeNode[],
    cycles: CircularDependencyLoop[],
    primaryDbTable: string
  ): string {
    const primaryPersona = archetype.userPersonas[0] || 'Client / User';
    const secondaryPersona = archetype.userPersonas.length > 1 ? archetype.userPersonas[1] : null;

    const ingressPkg = archetype.packages.find(p => p.role === 'ingress');
    const ingressLabel = ingressPkg
      ? `${ingressPkg.label} (${ingressPkg.name})`
      : `${archetype.framework} Ingress`;

    const domainPkg = archetype.packages.find(p => p.role === 'domain-engine');
    const domainLabel = domainPkg
      ? `${domainPkg.label} (${domainPkg.name})`
      : (archetype.domainEngines[0] || `${archetype.domainName || 'Domain'} Calculation Engine`);

    const guardrailPkg = archetype.packages.find(p => p.role === 'ai-guardrails');
    const aiLabel = guardrailPkg
      ? `${guardrailPkg.label}`
      : (archetype.aiEngines.length > 0 ? `${archetype.aiEngines[0]} & AI Guardrails` : null);

    const tables = archetype.primaryTables.length > 0
      ? archetype.primaryTables.slice(0, 3).join(', ')
      : primaryDbTable;
    const dbLabel = `${archetype.databaseType} [${tables}]`;

    const connectorsLabel = archetype.externalConnectors.length > 0
      ? `External Connectors (${archetype.externalConnectors.slice(0, 3).map(c => c.split(' ')[0]).join(', ')})`
      : null;

    const route = archetype.ingressRoutes[0] || '/';
    let action = 'Submit Request Payload';
    if (route.includes('check') || route.includes('assess')) {
      action = archetype.isTaxSpecific
        ? 'Submit Tax Health Profile & Financials (/check)'
        : (archetype.domainName ? `Submit ${archetype.domainName} Assessment (${route.split(' ')[0]})` : `Submit Assessment & Profile (${route.split(' ')[0]})`);
    } else if (route.includes('order') || route.includes('checkout')) {
      action = `Submit Order & Checkout (${route.split(' ')[0]})`;
    } else if (route.includes('portal') || route.includes('client') || route.includes('account')) {
      action = `Submit Client Request & Data (${route.split(' ')[0]})`;
    } else if (route.includes('upload') || route.includes('doc')) {
      action = `Upload Document Batch (${route.split(' ')[0]})`;
    } else if (route.includes('api')) {
      action = `POST API Request (${route.split(' ')[0]})`;
    }

    const hotspotNote = hotspots.length > 0
      ? `\n    Note over DomainEngine: High Churn Hotspot: ${this.cleanLabel(hotspots[0].label)} (${hotspots[0].defectCount} defects, ${hotspots[0].churnLines} lines churn)`
      : '';

    const bottleneckNote = archetype.keyBottlenecks.length > 0
      ? `\n    Note over DomainEngine: Bottleneck: ${archetype.keyBottlenecks[0]}`
      : '\n    Note over DomainEngine: Synchronous In-Process Execution Bottleneck';

    const cycleNote = cycles.length > 0
      ? `\n    Note over DomainEngine,DB: Warning: ${cycles.length} circular dependency loops detected`
      : '';

    const auditText = archetype.isTaxSpecific
      ? 'Multi-layer compliance audit & TFN de-identification'
      : 'Multi-layer compliance audit & PII de-identification';

    const resultText = archetype.isTaxSpecific
      ? 'Calculated scenario model & savings breakdown'
      : (archetype.domainName ? `Calculated ${archetype.domainName} response payload` : 'Processed domain transaction result');

    const renderText = archetype.isTaxSpecific
      ? 'Render interactive dashboard & PDF report'
      : 'Render interactive response & dashboard view';

    let d = `sequenceDiagram
    autonumber
    actor User as ${primaryPersona}\n`;

    if (secondaryPersona) {
      d += `    actor Advisor as ${secondaryPersona}\n`;
    }

    d += `    participant Ingress as ${ingressLabel}
    participant DomainEngine as ${domainLabel}\n`;

    if (aiLabel) {
      d += `    participant AILayer as ${aiLabel}\n`;
    }

    d += `    participant DB as ${dbLabel}\n`;

    if (connectorsLabel) {
      d += `    participant External as ${connectorsLabel}\n`;
    }

    d += `\n    User->>Ingress: ${action}
    Ingress->>DomainEngine: In-process invocation: evaluate scenario rules & baseline${hotspotNote}${bottleneckNote}${cycleNote}
    DomainEngine->>DB: Direct SQL query on ${archetype.primaryTables[0] || primaryDbTable}
    DB-->>DomainEngine: Un-cached record set & baseline data\n`;

    if (aiLabel) {
      d += `    DomainEngine->>AILayer: Pass context for PII redaction & advice boundary check
    AILayer->>AILayer: ${auditText}
    AILayer-->>DomainEngine: Certified advice insights payload\n`;
    }

    d += `    DomainEngine-->>Ingress: ${resultText}
    Ingress-->>User: ${renderText}\n`;

    if (connectorsLabel) {
      d += `    Ingress->>External: Synchronous webhook & billing/ledger sync\n`;
    }

    return d.trim();
  }

  /**
   * Generates domain-grounded Modernized Target State (To-Be) Strangler Fig sequence diagram.
   */
  private static generateArchetypeToBeDiagram(
    archetype: WorkspaceArchetype,
    candidateCount: number,
    primaryDbTable: string
  ): string {
    const primaryPersona = archetype.userPersonas[0] || 'Client / User';
    const tables = archetype.primaryTables.length > 0
      ? archetype.primaryTables.slice(0, 3).join(', ')
      : primaryDbTable;

    const domainPkg = archetype.packages.find(p => p.role === 'domain-engine');
    const workerLabel = domainPkg
      ? `${domainPkg.label} Worker`
      : `${archetype.domainName || 'Domain Engine'} Worker`;

    const requestPayloadLabel = archetype.domainName
      ? `Submit ${archetype.domainName} Request Payload`
      : 'Submit Domain Transaction Request';

    let d = `sequenceDiagram
    autonumber
    actor User as ${primaryPersona}
    participant Gateway as API Gateway / Edge Ingress (${archetype.framework.split(' ')[0]})
    participant Queue as Event-Driven Job Queue (Temporal / BullMQ)
    participant Worker as ${workerLabel}
    participant VectorCache as Distributed Cache & Embeddings (Redis / Vectors)
    participant ModernDB as ${archetype.databaseType} [Read Replicas: ${tables}]
    actor AuditGate as Automated Compliance & Zero-Trust Audit\n`;

    if (archetype.externalConnectors.length > 0) {
      const connName = archetype.externalConnectors.slice(0, 2).map(c => c.split(' ')[0]).join(', ');
      d += `    participant AsyncConnectors as Async Integration Worker (${connName})\n`;
    }

    d += `\n    User->>Gateway: ${requestPayloadLabel}
    Gateway->>Queue: Enqueue calculation job (Decoupled event ingress)
    Gateway-->>User: Immediate 202 Accepted + Job Stream Token
    Queue->>Worker: Stream event batch to background worker
    Worker->>VectorCache: Check pre-computed rules & cached embeddings
    alt Cache Hit
        VectorCache-->>Worker: Sub-millisecond context return
    else Cache Miss
        Worker->>ModernDB: Non-blocking structured read query
        ModernDB-->>Worker: Strongly-typed schema entity
        Worker->>VectorCache: Warm distributed cache index
    end
    Worker->>AuditGate: Submit transaction for cryptographic compliance seal
    AuditGate-->>Worker: Certified approval token (Zero-Trust)\n`;

    if (archetype.externalConnectors.length > 0) {
      d += `    Worker->>AsyncConnectors: Dispatch async webhook event\n`;
    }

    d += `    Worker-->>Gateway: Broadcast SSE / WebSocket computation result
    Gateway-->>User: Real-time interactive UI update`;

    return d.trim();
  }

  /**
   * Generates valid Mermaid sequenceDiagram syntax representing the legacy Current State (As-Is) fallback.
   */
  private static generateAsIsDiagram(
    hotspotLabel: string,
    dbTable: string,
    hotspots: CodeNode[],
    cycles: CircularDependencyLoop[]
  ): string {
    const cycleNote = cycles.length > 0
      ? `\n    Note over LegacyCore,DirectDB: Warning: ${cycles.length} circular dependency loops detected`
      : '';

    return `sequenceDiagram
    autonumber
    actor Client as Legacy Client / Web Portal
    participant Ingress as Monolithic Controller
    participant LegacyCore as ${hotspotLabel} (Hotspot)
    participant DirectDB as Database [${dbTable}]
    
    Client->>Ingress: Synchronous HTTP request
    Ingress->>LegacyCore: Tightly coupled in-process invocation
    Note over LegacyCore: High Volatility & Churn Bottleneck (Risk Zone)${cycleNote}
    LegacyCore->>DirectDB: Blocking direct SQL query
    DirectDB-->>LegacyCore: Uncached result set
    LegacyCore-->>Ingress: Synchronous data response
    Ingress-->>Client: HTTP response payload`;
  }

  /**
   * Generates valid Mermaid sequenceDiagram syntax representing the Modernized Target State (To-Be) fallback.
   */
  private static generateToBeDiagram(
    hotspotLabel: string,
    dbTable: string,
    candidateCount: number
  ): string {
    const serviceName = hotspotLabel.replace(/\.[a-zA-Z0-9]+$/, '').replace(/Service|Controller|Module/i, '');
    const agentName = `${serviceName || 'Domain'} AI Agent`;

    return `sequenceDiagram
    autonumber
    actor Client as Modern Client / API Gateway
    participant Queue as Event Ingress / PubSub
    participant Agent as ${agentName}
    participant Cache as Distributed Cache Layer
    participant ModernDB as Database [${dbTable}]
    actor Audit as Compliance & Security Gate
    
    Client->>Queue: Asynchronous domain event
    Queue->>Agent: Stream event batch to autonomous agent
    Agent->>Cache: Check cached state & embeddings
    alt Cache Hit
        Cache-->>Agent: Sub-millisecond context return
    else Cache Miss
        Agent->>ModernDB: Non-blocking structured query
        ModernDB-->>Agent: Strongly-typed schema entity
        Agent->>Cache: Warm cache index
    end
    Agent->>Audit: Submit transaction for cryptographic verification
    Audit-->>Agent: Certified approval seal (Zero-Trust)
    Agent-->>Client: Real-time SSE / WebSocket update`;
  }

  private static generateNarrative(
    totalFiles: number,
    hotspotCount: number,
    candidateCount: number,
    cycleCount: number,
    temporalCount: number,
    dbCount: number,
    archetype?: WorkspaceArchetype
  ): string {
    if (archetype && (archetype.packages.length > 0 || archetype.userPersonas.length > 0)) {
      let narrative = `### 🏛️ Brownfield Evolutionary Modernization Summary\n\n` +
        `• **Architecture Archetype**: Detected **${archetype.projectName}** (${archetype.framework}).\n` +
        `• **Analyzed Scope**: Scanned **${totalFiles}** workspace files across **${archetype.packages.length}** packages with **${hotspotCount}** high-volatility hotspots.\n`;

      if (archetype.packages.length > 0) {
        narrative += `• **Monorepo Packages**: ${archetype.packages.map(p => `\`${p.name}\` (${p.label})`).join(', ')}.\n`;
      }
      if (archetype.ingressRoutes.length > 0) {
        narrative += `• **Key Entrypoint Routes**: ${archetype.ingressRoutes.slice(0, 4).join(', ')}.\n`;
      }
      if (archetype.aiEngines.length > 0 || archetype.guardrails.length > 0) {
        narrative += `• **AI & Safety Pipeline**: ${[...archetype.aiEngines, ...archetype.guardrails].join(', ')}.\n`;
      }
      if (archetype.externalConnectors.length > 0) {
        narrative += `• **External SaaS Connectors**: ${archetype.externalConnectors.join(', ')}.\n`;
      }
      narrative += `• **Strangler Targets**: Identified **${candidateCount}** modules recommended for evolutionary microservice or AI agent extraction.\n` +
        `• **Architectural Risks**: Detected **${cycleCount}** circular import loops and **${temporalCount}** hidden temporal coupling links.\n` +
        `• **Data Lineage**: Successfully mapped **${dbCount}** tables in **${archetype.databaseType}** directly to backend repository and ORM files.`;
      return narrative;
    }

    return `### 🏛️ Brownfield Evolutionary Modernization Summary\n\n` +
      `• **Analyzed Scope**: Scanned **${totalFiles}** workspace files and extracted **${hotspotCount}** high-volatility hotspots.\n` +
      `• **Strangler Targets**: Identified **${candidateCount}** modules recommended for evolutionary microservice or AI agent extraction.\n` +
      `• **Architectural Risks**: Detected **${cycleCount}** circular import loops and **${temporalCount}** hidden temporal coupling links.\n` +
      `• **Data Lineage**: Successfully mapped **${dbCount}** live database tables directly to backend repository and ORM files.`;
  }

  private static cleanLabel(label: string): string {
    return label.replace(/[^\w.-]/g, '_');
  }
}
