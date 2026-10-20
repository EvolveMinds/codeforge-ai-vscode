/**
 * fde/c4TopologyEngine.ts — Multi-Level C4 Architectural Topology & Drill-Down Engine
 * 
 * Provides:
 * 1. 3-Level Hierarchical C4 Architecture Model (Context -> Container -> Component)
 * 2. Extensive Domain Expertise:
 *    - Data Engineering & Lakehouse Pipelines (Airflow, Spark, dbt, Iceberg, BigQuery, Schema Drift Gate)
 *    - Banking & Wire Clearing (Finacle, Kafka, Neo4j AML, Fedwire, ISO 20022, Sanctions Gate)
 *    - Insurance Claims & Underwriting (Guidewire, FNOL, Actuarial Risk, Four-Eyes Gate)
 *    - Higher Education & LMS (Canvas, Banner SIS, Turnitin AI, Academic Integrity Ombudsman Gate)
 *    - Enterprise Payroll & HCM Automation (Workday, Gross-to-Net, NACHA ACH, Payroll Variance Gate)
 *    - Healthcare & Clinical Integration (Salesforce, MuleSoft, CHIB, EMR Sunrise, Clinician Gate)
 *    - E-Commerce Microservices & Fraud Operations Gate
 *    - Industrial IoT Streaming & Plant Safety Gate
 *    - Greenfield & Autonomous Multi-Agent AI Core
 * 3. First-Class Human-in-the-Loop (HITL) Exception & Review Gate Modeling
 * 4. Interactive SVG Renderer with Dynamic Trust Boundaries, Protocol Badges, and Glow Filters
 * 5. Deep Component Contract & Payload Schema Inspector
 * 
 * Pure functions, zero network dependencies, completely air-gapped.
 */

export interface C4SystemNode {
  id: string;
  label: string;
  category: 'actor' | 'saas' | 'gateway' | 'service' | 'database' | 'ehr' | 'queue' | 'hitl';
  zone: 'client' | 'integration' | 'core' | 'governance' | 'thirdparty';
  icon: string;
  role: string;
  description: string;
  technologies: string[];
  containerCount: number;
}

export interface C4ContainerNode {
  id: string;
  parentSystemId: string;
  label: string;
  type: 'api' | 'orchestrator' | 'adapter' | 'store' | 'queue' | 'gate';
  technology: string;
  endpoint?: string;
  description: string;
  componentCount: number;
}

export interface C4DataContract {
  field: string;
  type: string;
  required: boolean;
  source: string;
  destination: string;
  description: string;
  validationRule?: string;
}

export interface C4ComponentNode {
  id: string;
  parentContainerId: string;
  label: string;
  role: string;
  description: string;
  contracts: C4DataContract[];
  slaMs?: number;
  retryPolicy?: string;
}

export interface C4Connection {
  from: string;
  to: string;
  label: string;
  protocol: string;
  isAsync?: boolean;
  isException?: boolean;
  isHitl?: boolean;
  order: number;
}

export interface C4HitlGate {
  id: string;
  systemId: string;
  title: string;
  triggerCondition: string;
  reviewSurface: string;
  reviewRole: string;
  slaMinutes: number;
  diagnosticDetails?: string;
  humanActions: Array<{
    name: string;
    action: 'approve' | 'override' | 'reject' | 'escalate';
    impact: string;
  }>;
  auditProvenance: string;
}

export interface C4ArchitectureModel {
  title: string;
  scenarioDescription: string;
  level1: {
    systems: C4SystemNode[];
    connections: C4Connection[];
    zones: Array<{ id: string; label: string }>;
  };
  level2: Record<string, {
    parentSystem: C4SystemNode;
    containers: C4ContainerNode[];
    connections: C4Connection[];
  }>;
  level3: Record<string, {
    parentContainer: C4ContainerNode;
    components: C4ComponentNode[];
  }>;
  hitlGates: C4HitlGate[];
}

export class C4TopologyEngine {
  /**
   * Synthesizes a full 3-level C4 architectural topology model from text or diagram source
   */
  public static synthesizeModel(text: string, title?: string): C4ArchitectureModel {
    const model = this.synthesizeRawModel(text, title);
    if (model && model.level1 && model.level1.systems) {
      for (const sys of model.level1.systems) {
        if (sys.category !== 'hitl' && sys.id !== 'HITL_Gate' && sys.id !== 'hitl') {
          this.ensureLevel2(model, sys.id);
        }
      }
    }
    return model;
  }

  private static synthesizeRawModel(text: string, title?: string): C4ArchitectureModel {
    const raw = (text || '').toLowerCase();
    const scenarioTitle = title || 'Enterprise Architecture Topology';

    // 1. Data Engineering & Lakehouse Pipelines
    const isDataEng = raw.includes('data engineering') || raw.includes('lakehouse') || raw.includes('iceberg') || raw.includes('spark') || raw.includes('airflow') || raw.includes('dbt') || raw.includes('bigquery') || raw.includes('dataproc') || raw.includes('schema drift') || raw.includes('parquet') || raw.includes('pipeline') || raw.includes('etl') || raw.includes('elt');
    if (isDataEng) {
      return this.buildDataEngineeringModel(scenarioTitle);
    }

    // 2. Enterprise Payroll & Automation Space
    const isPayroll = raw.includes('payroll') || raw.includes('hcm') || raw.includes('workday') || raw.includes('timesheet') || raw.includes('garnishment') || raw.includes('gross-to-net') || raw.includes('nacha') || raw.includes('direct deposit') || raw.includes('wage');
    if (isPayroll) {
      return this.buildPayrollAutomationModel(scenarioTitle);
    }

    // 3. Higher Education & LMS Space
    const isEducation = raw.includes('education') || raw.includes('student') || raw.includes('canvas') || raw.includes('lms') || raw.includes('curriculum') || raw.includes('grade') || raw.includes('transcript') || raw.includes('rubric') || raw.includes('plagiarism') || raw.includes('academic') || raw.includes('ombudsman');
    if (isEducation) {
      return this.buildEducationModel(scenarioTitle);
    }

    // 4. Insurance Claims & Underwriting
    const isInsurance = raw.includes('insurance') || raw.includes('claim') || raw.includes('policy') || raw.includes('guidewire') || raw.includes('actuar') || raw.includes('underwriting') || raw.includes('fnol');
    if (isInsurance) {
      return this.buildInsuranceModel(scenarioTitle);
    }

    // 5. Core Banking & Wire Settlement
    const isBanking = raw.includes('finacle') || raw.includes('core banking') || raw.includes('teller') || raw.includes('fedwire') || raw.includes('aml') || raw.includes('swift') || raw.includes('wire');
    if (isBanking) {
      return this.buildBankingModel(scenarioTitle);
    }

    // 6. Healthcare & Clinical Integrations
    const isHealthcare = raw.includes('mule') || raw.includes('emr') || raw.includes('chib') || raw.includes('salesforce') || raw.includes('referral') || raw.includes('visit id') || raw.includes('clinical') || raw.includes('hipaa');
    if (isHealthcare) {
      return this.buildHealthcareModel(scenarioTitle);
    }

    // 7. E-Commerce Microservices
    const isEcommerce = raw.includes('dynamodb') || raw.includes('fastapi') || raw.includes('stripe') || raw.includes('cart') || raw.includes('checkout') || raw.includes('shopper');
    if (isEcommerce) {
      return this.buildEcommerceModel(scenarioTitle);
    }

    // 8. Industrial IoT & Stream Analytics
    const isIot = raw.includes('telematics') || raw.includes('emqx') || raw.includes('mqtt') || raw.includes('flink') || raw.includes('sensor');
    if (isIot) {
      return this.buildIotModel(scenarioTitle);
    }

    // Default: Universal Enterprise AI Core Architecture
    return this.buildGenericEnterpriseModel(scenarioTitle, text);
  }

  /**
   * Renders high-fidelity Level 1 System Context or Level 2 Container SVG
   */

  /**
   * Guarantees that a system node has a populated Level 2 container model
   * and that all its containers have populated Level 3 component data contracts.
   */
  public static ensureLevel2(model: C4ArchitectureModel, systemId: string): void {
    if (!model.level2) model.level2 = {};
    if (!model.level3) model.level3 = {};

    const sys = model.level1.systems.find(s => s.id === systemId);
    if (!sys || sys.category === 'hitl' || sys.id === 'HITL_Gate') return;

    if (!model.level2[systemId]) {
      const tech1 = sys.technologies[0] || 'REST / HTTPS API';
      const tech2 = sys.technologies[1] || 'Async Worker / Orchestrator';
      const tech3 = sys.technologies[2] || 'State Store / Database';

      model.level2[systemId] = {
        parentSystem: { ...sys },
        containers: [
          {
            id: `${systemId}_Ingress`,
            parentSystemId: systemId,
            label: `${sys.label} API Ingress`,
            type: 'api',
            endpoint: `/api/v1/${systemId.toLowerCase()}`,
            technology: tech1,
            description: `Secure gateway accepting requests and enforcing mTLS authentication for ${sys.label}.`,
            componentCount: 2
          },
          {
            id: `${systemId}_Worker`,
            parentSystemId: systemId,
            label: `${sys.label} Core Worker`,
            type: 'orchestrator',
            endpoint: `internal://${systemId.toLowerCase()}-worker`,
            technology: tech2,
            description: `Core orchestration engine and business logic processor for ${sys.label}.`,
            componentCount: 2
          },
          {
            id: `${systemId}_Store`,
            parentSystemId: systemId,
            label: `${sys.label} Data Store`,
            type: 'store',
            technology: tech3,
            description: `Persistent database and state ledger maintaining transactional integrity for ${sys.label}.`,
            componentCount: 1
          }
        ],
        connections: [
          { from: `${systemId}_Ingress`, to: `${systemId}_Worker`, label: 'Process Request', protocol: 'Internal Event', order: 1 },
          { from: `${systemId}_Worker`, to: `${systemId}_Store`, label: 'Commit Transaction', protocol: 'State Sync / SQL', order: 2 }
        ]
      };
    }

    // Ensure all containers in Level 2 have Level 3 contracts
    for (const c of model.level2[systemId].containers) {
      if (!model.level3[c.id]) {
        model.level3[c.id] = {
          parentContainer: { ...c },
          components: [
            {
              id: `${c.id}_Validator`,
              parentContainerId: c.id,
              label: `${c.label} Payload Contract`,
              role: 'Schema Validation & Serialization',
              description: `Validates strict enterprise schema compliance, field types, and tenant isolation for ${c.label}.`,
              slaMs: 150,
              retryPolicy: 'Max 3 retries (100ms backoff)',
              contracts: [
                { field: 'Transaction_ID', type: 'UUIDv4', required: true, source: 'Ingress Client', destination: c.label, description: 'Unique idempotent transaction identifier.', validationRule: 'RFC 4122 UUID' },
                { field: 'Payload_Body', type: 'JSON / Avro Schema', required: true, source: 'Upstream Caller', destination: c.label, description: 'Validated structured domain payload payload.', validationRule: 'Strict schema adherence' },
                { field: 'Authorization_Token', type: 'JWT Bearer', required: true, source: 'OAuth2 / mTLS', destination: c.label, description: 'Scoped enterprise authentication token.' }
              ]
            }
          ]
        };
      }
    }
  }

  public static renderTopologySvg(
    model: C4ArchitectureModel,
    level: 1 | 2,
    activeSystemId?: string,
    showHitlExceptionPath = false,
    isExecutiveMode = false
  ): string {
    if (level === 2 && activeSystemId) {
      this.ensureLevel2(model, activeSystemId);
      if (model.level2[activeSystemId]) {
        return this.renderLevel2ContainerSvg(model.level2[activeSystemId], showHitlExceptionPath, isExecutiveMode);
      }
    }
    return this.renderLevel1ContextSvg(model, showHitlExceptionPath, isExecutiveMode);
  }


  /**
   * Exports the architecture model to official Mermaid C4Context syntax
   */
  public static toMermaidC4(model: C4ArchitectureModel): string {
    let mmd = `C4Context\n  title ${model.title}\n\n`;
    for (const sys of model.level1.systems) {
      const desc = (sys.description || '').replace(/"/g, "'").slice(0, 60);
      if (sys.category === 'actor') {
        mmd += `  Person(${sys.id}, "${sys.label}", "${desc}")\n`;
      } else if (sys.category === 'hitl') {
        mmd += `  System_Boundary(b_${sys.id}, "Human Governance") {\n    System(${sys.id}, "${sys.label}", "${desc}")\n  }\n`;
      } else {
        mmd += `  System(${sys.id}, "${sys.label}", "${desc}")\n`;
      }
    }
    mmd += '\n';
    for (const conn of model.level1.connections) {
      mmd += `  Rel(${conn.from}, ${conn.to}, "${conn.label}", "${conn.protocol}")\n`;
    }
    return mmd;
  }

  /**
   * Exports the architecture model to official Structurizr C4 DSL
   */
  public static toStructurizrDsl(model: C4ArchitectureModel): string {
    let dsl = `workspace "${model.title}" "Enterprise Architecture Specification" {\n\n  model {\n`;
    for (const sys of model.level1.systems) {
      const desc = (sys.description || '').replace(/"/g, "'");
      if (sys.category === 'actor') {
        dsl += `    ${sys.id} = person "${sys.label}" "${desc}"\n`;
      } else {
        dsl += `    ${sys.id} = softwareSystem "${sys.label}" "${desc}" {\n`;
        const l2 = model.level2[sys.id];
        if (l2 && l2.containers) {
          for (const c of l2.containers) {
            dsl += `      ${c.id} = container "${c.label}" "${c.description.replace(/"/g, "'")}" "${c.technology}"\n`;
          }
        }
        dsl += `    }\n`;
      }
    }
    dsl += '\n';
    for (const conn of model.level1.connections) {
      dsl += `    ${conn.from} -> ${conn.to} "${conn.label}" "${conn.protocol}"\n`;
    }
    dsl += `  }\n\n  views {\n    systemContext ${model.level1.systems[1]?.id || 'System'} "SystemContext" {\n      include *\n      autoLayout lr\n    }\n    theme default\n  }\n}\n`;
    return dsl;
  }

  // ── Level 1 System Context SVG ──────────────────────────────────────────────

  private static renderLevel1ContextSvg(model: C4ArchitectureModel, showHitlException: boolean, isExecutiveMode = false): string {
    const systems = model.level1.systems;
    const connections = model.level1.connections;
    const zones = model.level1.zones;

    const width = 960;
    const height = 480;

    const nodePositions: Record<string, { x: number; y: number; w: number; h: number }> = {};

    const leftCol = systems.filter(s => s.zone === 'client' || s.category === 'actor');
    const midCol = systems.filter(s => s.zone === 'integration' || s.category === 'gateway');
    const rightCol = systems.filter(s => s.zone === 'core' || s.zone === 'thirdparty' || s.category === 'database' || s.category === 'ehr');
    const hitlNodes = systems.filter(s => s.zone === 'governance' || s.category === 'hitl');

    // Layout left col
    let ly = 100;
    leftCol.forEach(s => {
      nodePositions[s.id] = { x: 40, y: ly, w: 180, h: 84 };
      ly += 110;
    });

    // Layout mid col
    let my = 80;
    midCol.forEach(s => {
      nodePositions[s.id] = { x: 300, y: my, w: 220, h: 90 };
      my += 120;
    });

    // Layout right col
    let ry = 80;
    rightCol.forEach(s => {
      nodePositions[s.id] = { x: 600, y: ry, w: 210, h: 84 };
      ry += 110;
    });

    // Layout HITL nodes at bottom
    hitlNodes.forEach((s, idx) => {
      nodePositions[s.id] = { x: 300 + idx * 260, y: 340, w: 240, h: 92 };
    });

    const clientZoneLabel = (zones.find(z => z.id === 'client')?.label || 'CLIENT & INGRESS').toUpperCase();
    const intZoneLabel = (zones.find(z => z.id === 'integration')?.label || 'INTEGRATION & COMPUTE').toUpperCase();
    const coreZoneLabel = (zones.find(z => z.id === 'core')?.label || 'CORE DATA & STORAGE').toUpperCase();
    const govZoneLabel = (zones.find(z => z.id === 'governance')?.label || 'HUMAN GOVERNANCE & EXCEPTION REVIEW').toUpperCase();

    let svg = `<svg id="fdeTopologySvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; user-select: none;">
      <defs>
        <!-- Gradients -->
        <linearGradient id="c4-grad-actor" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e293b"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <linearGradient id="c4-grad-saas" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e3a5f"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <linearGradient id="c4-grad-ipaas" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2e1065"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <linearGradient id="c4-grad-core" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#451a03"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <linearGradient id="c4-grad-hitl" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#450a0a"/>
          <stop offset="100%" stop-color="#1c1917"/>
        </linearGradient>

        <!-- Filters -->
        <filter id="c4-glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <filter id="c4-glow-amber" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <filter id="c4-glow-red" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>

        <!-- Markers -->
        <marker id="c4-arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8"/>
        </marker>
        <marker id="c4-arrow-purple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#a855f7"/>
        </marker>
        <marker id="c4-arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#ef4444"/>
        </marker>
        <marker id="c4-arrow-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#34d399"/>
        </marker>
      </defs>

      <!-- Dynamic Domain Trust Boundaries -->
      <g class="c4-zones">
        <rect x="20" y="45" width="220" height="390" rx="10" fill="rgba(30, 41, 59, 0.25)" stroke="rgba(148, 163, 184, 0.2)" stroke-dasharray="6 4"/>
        <text x="32" y="65" fill="#94a3b8" font-size="9" font-weight="700" letter-spacing="0.5">BOUNDARY: ${escapeXml(clientZoneLabel)}</text>

        <rect x="270" y="45" width="280" height="270" rx="10" fill="rgba(139, 92, 246, 0.06)" stroke="rgba(139, 92, 246, 0.25)" stroke-dasharray="6 4"/>
        <text x="282" y="65" fill="#c084fc" font-size="9" font-weight="700" letter-spacing="0.5">BOUNDARY: ${escapeXml(intZoneLabel)}</text>

        <rect x="580" y="45" width="260" height="390" rx="10" fill="rgba(245, 158, 11, 0.05)" stroke="rgba(245, 158, 11, 0.22)" stroke-dasharray="6 4"/>
        <text x="592" y="65" fill="#fbbf24" font-size="9" font-weight="700" letter-spacing="0.5">BOUNDARY: ${escapeXml(coreZoneLabel)}</text>

        <rect x="270" y="325" width="280" height="110" rx="10" fill="rgba(239, 68, 68, 0.08)" stroke="rgba(239, 68, 68, 0.35)" stroke-dasharray="4 4"/>
        <text x="282" y="342" fill="#f87171" font-size="8.5" font-weight="800" letter-spacing="0.5">BOUNDARY: ${escapeXml(govZoneLabel)}</text>
      </g>

      <!-- Connections / Links -->
      <g class="c4-connections">`;

    // Draw connection lines
    connections.forEach((c) => {
      const fromPos = nodePositions[c.from];
      const toPos = nodePositions[c.to];
      if (!fromPos || !toPos) return;

      const isHitlEdge = c.isHitl || toPos.y > 300 || fromPos.y > 300;
      const isRed = c.isException || (isHitlEdge && showHitlException);

      let strokeColor = isRed ? '#ef4444' : '#38bdf8';
      let markerId = isRed ? 'c4-arrow-red' : 'c4-arrow-blue';
      let strokeWidth = isRed ? (showHitlException ? '2.8' : '1.8') : '1.6';
      let dash = c.isAsync || isRed ? 'stroke-dasharray="6 4"' : '';
      let filter = isRed && showHitlException ? 'filter="url(#c4-glow-red)"' : '';

      let x1 = fromPos.x + fromPos.w;
      let y1 = fromPos.y + fromPos.h / 2;
      let x2 = toPos.x;
      let y2 = toPos.y + toPos.h / 2;

      if (toPos.y > fromPos.y + 100) {
        x1 = fromPos.x + fromPos.w / 2;
        y1 = fromPos.y + fromPos.h;
        x2 = toPos.x + toPos.w / 2;
        y2 = toPos.y;
      } else if (fromPos.x > toPos.x) {
        x1 = fromPos.x;
        x2 = toPos.x + toPos.w;
      }

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      svg += `
        <g class="c4-edge" data-order="${c.order}" style="cursor: pointer;">
          <path d="M ${x1} ${y1} Q ${midX} ${midY - 12} ${x2} ${y2}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${dash} ${filter} marker-end="url(#${markerId})"/>
          <!-- Label Pill -->
          <rect x="${midX - 58}" y="${midY - 16}" width="116" height="15" rx="3" fill="#0f172a" stroke="${strokeColor}" stroke-width="0.8" opacity="0.95"/>
          <text x="${midX}" y="${midY - 5}" fill="${isRed ? '#fca5a5' : '#e2e8f0'}" font-size="7.5" font-weight="700" text-anchor="middle">${c.order}. ${escapeXml(c.protocol)}</text>
        </g>
      `;
    });

    svg += `</g>
      <!-- Systems Nodes (Level 1) -->
      <g class="c4-nodes">`;

    systems.forEach((s) => {
      const pos = nodePositions[s.id];
      if (!pos) return;

      const isHitl = s.category === 'hitl';
      let strokeColor = '#38bdf8';
      let gradId = 'c4-grad-saas';
      let glowFilter = '';

      if (isHitl) {
        strokeColor = '#ef4444';
        gradId = 'c4-grad-hitl';
        glowFilter = showHitlException ? 'class="c4-hitl-pulse-active" filter="url(#c4-glow-red)"' : 'filter="url(#c4-glow-amber)"';
      } else if (s.category === 'actor') {
        strokeColor = '#38bdf8';
        gradId = 'c4-grad-actor';
      } else if (s.zone === 'integration') {
        strokeColor = '#a855f7';
        gradId = 'c4-grad-ipaas';
      } else if (s.zone === 'core') {
        strokeColor = '#f59e0b';
        gradId = 'c4-grad-core';
      }

      svg += `
        <g class="c4-node-group" data-c4-id="${s.id}" data-c4-level="1" style="cursor: pointer;" transform="translate(${pos.x}, ${pos.y})">
          <rect width="${pos.w}" height="${pos.h}" rx="8" fill="url(#${gradId})" stroke="${strokeColor}" stroke-width="1.8" ${glowFilter}/>
          
          <text x="12" y="24" font-size="16">${s.icon}</text>
          <text x="36" y="20" fill="#f8fafc" font-size="11" font-weight="700">${escapeXml(s.label)}</text>
          <text x="36" y="32" fill="${strokeColor}" font-size="8.5" font-weight="600">[${escapeXml(s.role)}]</text>

          <text x="12" y="52" fill="#94a3b8" font-size="8" font-weight="500">${escapeXml(s.description.slice(0, 44))}</text>
          <text x="12" y="64" fill="#64748b" font-size="7.5">${escapeXml(s.technologies.slice(0, 3).join(' • '))}</text>

          ${s.containerCount > 0 ? `
            <g transform="translate(${pos.w - 82}, ${pos.h - 18})">
              <rect width="74" height="14" rx="3" fill="rgba(56, 189, 248, 0.15)" stroke="${strokeColor}" stroke-width="0.8"/>
              <text x="37" y="10" fill="${strokeColor}" font-size="7.5" font-weight="700" text-anchor="middle">🔍 Drill Down (${s.containerCount})</text>
            </g>
          ` : ''}
          ${isHitl ? `
            <g transform="translate(${pos.w - 88}, ${pos.h - 18})">
              <rect width="80" height="14" rx="3" fill="rgba(239, 68, 68, 0.25)" stroke="#ef4444" stroke-width="1"/>
              <text x="40" y="10" fill="#fca5a5" font-size="7.5" font-weight="800" text-anchor="middle">🚨 HITL GATE</text>
            </g>
          ` : ''}
        </g>
      `;
    });

    svg += `</g>
      ${isExecutiveMode ? `
      <!-- Executive KPI Overlay Ribbon -->
      <g class="c4-executive-ribbon">
        <rect x="20" y="6" width="920" height="28" rx="6" fill="#1e1b4b" stroke="#f59e0b" stroke-width="1.2"/>
        <text x="480" y="24" fill="#fbbf24" font-size="10.5" font-weight="800" text-anchor="middle" letter-spacing="0.5">👔 EXECUTIVE ROI OVERVIEW: ⚡ 85% Process Cycle Reduction • 🛡️ 100% Audit Compliance • ⏱️ 30-min Max SLA • 0 Unreconciled Discrepancies</text>
      </g>
      ` : ''}
      <!-- Title & Watermark -->
      <text x="20" y="${isExecutiveMode ? 48 : 24}" fill="${isExecutiveMode ? '#fbbf24' : '#38bdf8'}" font-size="13" font-weight="800" letter-spacing="0.5">${isExecutiveMode ? '👔 EXECUTIVE SYSTEM LANDSCAPE & VALUE CHAIN' : '🌐 LEVEL 1: SYSTEM CONTEXT TOPOLOGY'}</text>
      <text x="20" y="${isExecutiveMode ? 62 : 38}" fill="#94a3b8" font-size="9" font-weight="500">${escapeXml(model.title)} — ${isExecutiveMode ? 'High-level business capabilities, security boundaries, and exception handling governance' : 'Click any system to drill down 1 level deeper into internal containers'}</text>
    </svg>`;

    return svg;
  }

  // ── Level 2 Container SVG ───────────────────────────────────────────────────

  private static renderLevel2ContainerSvg(
    l2: { parentSystem: C4SystemNode; containers: C4ContainerNode[]; connections: C4Connection[] },
    showHitlException: boolean,
    isExecutiveMode = false
  ): string {
    const parent = l2.parentSystem;
    const containers = l2.containers;
    const connections = l2.connections;

    const width = 960;
    const height = 480;

    const nodePositions: Record<string, { x: number; y: number; w: number; h: number }> = {};

    containers.forEach((c, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      nodePositions[c.id] = {
        x: 60 + col * 280,
        y: 100 + row * 160,
        w: 240,
        h: 110
      };
    });

    let svg = `<svg id="fdeTopologySvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif; user-select: none;">
      <defs>
        <linearGradient id="c4-l2-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e1e38"/>
          <stop offset="100%" stop-color="#0b0f19"/>
        </linearGradient>
        <marker id="c4-l2-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#a855f7"/>
        </marker>
        <marker id="c4-l2-arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8"/>
        </marker>
      </defs>

      <!-- Parent Subsystem Boundary Box -->
      <rect x="30" y="55" width="900" height="395" rx="12" fill="rgba(139, 92, 246, 0.05)" stroke="rgba(168, 85, 247, 0.4)" stroke-width="1.8" stroke-dasharray="8 5"/>
      <text x="50" y="80" fill="#c084fc" font-size="11" font-weight="800">SYSTEM CONTAINER BOUNDARY: ${escapeXml(parent.label.toUpperCase())}</text>
      <text x="50" y="94" fill="#94a3b8" font-size="9">${escapeXml(parent.description)}</text>

      <!-- Connections between internal containers -->
      <g class="c4-l2-connections">`;

    connections.forEach((c) => {
      const fromPos = nodePositions[c.from];
      const toPos = nodePositions[c.to];
      if (!fromPos || !toPos) return;

      svg += `
        <g class="c4-l2-edge" style="cursor: pointer;">
          <path d="M ${fromPos.x + fromPos.w} ${fromPos.y + fromPos.h / 2} L ${toPos.x} ${toPos.y + toPos.h / 2}" fill="none" stroke="#a855f7" stroke-width="1.8" marker-end="url(#c4-l2-arrow)"/>
          <rect x="${(fromPos.x + toPos.x + fromPos.w) / 2 - 40}" y="${fromPos.y + fromPos.h / 2 - 10}" width="80" height="14" rx="3" fill="#0f172a" stroke="#a855f7" stroke-width="0.8"/>
          <text x="${(fromPos.x + toPos.x + fromPos.w) / 2}" y="${fromPos.y + fromPos.h / 2 + 1}" fill="#e2e8f0" font-size="7.5" font-weight="700" text-anchor="middle">${escapeXml(c.protocol)}</text>
        </g>
      `;
    });

    svg += `</g>
      <!-- Container Nodes -->
      <g class="c4-l2-nodes">`;

    containers.forEach((c) => {
      const pos = nodePositions[c.id];
      if (!pos) return;

      const isApi = c.type === 'api';
      const isStore = c.type === 'store';
      const strokeColor = isApi ? '#38bdf8' : (isStore ? '#f59e0b' : '#a855f7');

      svg += `
        <g class="c4-container-group" data-c4-id="${c.id}" data-c4-level="2" style="cursor: pointer;" transform="translate(${pos.x}, ${pos.y})">
          <rect width="${pos.w}" height="${pos.h}" rx="8" fill="url(#c4-l2-grad)" stroke="${strokeColor}" stroke-width="1.6"/>
          
          <rect x="0" y="0" width="${pos.w}" height="26" rx="8" fill="rgba(168, 85, 247, 0.12)"/>
          <text x="12" y="17" fill="#f8fafc" font-size="11" font-weight="700">${escapeXml(c.label)}</text>
          <text x="${pos.w - 12}" y="17" fill="${strokeColor}" font-size="8.5" font-weight="700" text-anchor="end">[${c.type.toUpperCase()}]</text>

          <text x="12" y="44" fill="#38bdf8" font-size="8.5" font-weight="600" font-family="monospace">${escapeXml(c.endpoint || c.technology)}</text>
          <text x="12" y="62" fill="#94a3b8" font-size="8" font-weight="400">${escapeXml(c.description.slice(0, 52))}</text>
          <text x="12" y="76" fill="#64748b" font-size="7.5">Technology: ${escapeXml(c.technology)}</text>

          <!-- Component Inspector Pill -->
          <g transform="translate(${pos.w - 95}, ${pos.h - 20})">
            <rect width="85" height="14" rx="3" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="0.8"/>
            <text x="42" y="10" fill="#38bdf8" font-size="7.5" font-weight="700" text-anchor="middle">🔍 View Contract</text>
          </g>
        </g>
      `;
    });

    svg += `</g>
      ${isExecutiveMode ? `
      <!-- Executive Container KPI Ribbon -->
      <g class="c4-executive-ribbon">
        <rect x="20" y="6" width="920" height="26" rx="6" fill="#1e1b4b" stroke="#f59e0b" stroke-width="1.2"/>
        <text x="480" y="23" fill="#fbbf24" font-size="10" font-weight="800" text-anchor="middle" letter-spacing="0.5">👔 EXECUTIVE CONTAINER VIEW: ${escapeXml(parent.label.toUpperCase())} — 99.99% Availability • End-to-End Encryption • Fully Audited Execution</text>
      </g>
      ` : ''}
      <!-- Title & Breadcrumb Link -->
      <text x="30" y="${isExecutiveMode ? 48 : 26}" fill="${isExecutiveMode ? '#fbbf24' : '#a855f7'}" font-size="13" font-weight="800" letter-spacing="0.5">${isExecutiveMode ? '👔 EXECUTIVE CONTAINER VIEW' : '📦 LEVEL 2: CONTAINER TOPOLOGY'} — ${escapeXml(parent.label.toUpperCase())}</text>
      <text x="30" y="${isExecutiveMode ? 62 : 42}" fill="#94a3b8" font-size="9">${isExecutiveMode ? 'Key service components and secure communications' : 'Click "⬆ Back to System Context" on the toolbar to return, or click any container to inspect contracts'}</text>
    </svg>`;

    return svg;
  }

  // ── 1. Data Engineering & Modern Lakehouse Architecture Model ────────────────

  private static buildDataEngineeringModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Modern Lakehouse Data Platform with Apache Airflow orchestration, Spark/Dataproc distributed compute, dbt Core semantic modeling, Apache Iceberg ACID metadata catalog on S3/GCS, and a dedicated Great Expectations Schema Drift & Quality Quarantine Gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Data Sources & Stream Ingest' },
          { id: 'integration', label: 'Orchestration & Compute (Airflow / Spark)' },
          { id: 'core', label: 'Lakehouse & Storage (Iceberg / BigQuery)' },
          { id: 'governance', label: 'Data Quality & Schema Drift Governance' }
        ],
        systems: [
          { id: 'DataSources', label: 'OLTP DBs & Kafka Event Streams', category: 'actor', zone: 'client', icon: '📡', role: 'Data Producers', description: 'Emits CDC changelogs and raw JSON telemetry streams.', technologies: ['PostgreSQL CDC', 'Debezium', 'Kafka Connect'], containerCount: 0 },
          { id: 'Airflow', label: 'Apache Airflow / Cloud Composer', category: 'gateway', zone: 'integration', icon: '🌪️', role: 'DAG Pipeline Orchestrator', description: 'Orchestrates hourly batch dependencies, retries, and data SLAs.', technologies: ['Airflow 2.10', 'CeleryExecutor', 'Astronomer'], containerCount: 3 },
          { id: 'SparkCompute', label: 'Apache Spark / Dataproc Serverless', category: 'service', zone: 'integration', icon: '⚡', role: 'Distributed Processing Core', description: 'Executes high-throughput Bronze to Silver ETL transformations.', technologies: ['PySpark 3.5', 'Catalyst Optimizer', 'YARN / K8s'], containerCount: 3 },
          { id: 'DbtCore', label: 'dbt Core / Dataform Semantic Core', category: 'service', zone: 'integration', icon: '🧱', role: 'SQL Transformation Layer', description: 'Builds dimensional star schema, fact models, and data lineage.', technologies: ['dbt Core 1.8', 'Jinja', 'Semantic Layer'], containerCount: 2 },
          { id: 'IcebergLakehouse', label: 'Apache Iceberg ACID Lakehouse', category: 'database', zone: 'core', icon: '🧊', role: 'Transactional Lakehouse Store', description: 'Stores ACID parquet partitions with time travel and hidden partitioning.', technologies: ['Iceberg REST Catalog', 'Parquet', 'AWS S3 / GCS'], containerCount: 3 },
          { id: 'AnalyticsBI', label: 'Snowflake / BigQuery & BI', category: 'database', zone: 'thirdparty', icon: '📊', role: 'Consumption & Analytics Layer', description: 'Serves low-latency executive dashboards and ML feature stores.', technologies: ['BigQuery / Snowflake', 'Cube.js', 'Looker'], containerCount: 1 },
          { id: 'HITL_Gate', label: 'Schema Drift & Quality Quarantine Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'DataOps Human Decision Gate', description: 'Intercepts critical null violations and schema breaks before gold partition write.', technologies: ['Great Expectations', 'Monte Carlo', 'Slack Webhook'], containerCount: 1 }
        ],
        connections: [
          { from: 'DataSources', to: 'Airflow', label: 'Trigger Hourly Micro-Batch', protocol: 'Cloud Storage Sensor / Webhook', order: 1 },
          { from: 'Airflow', to: 'SparkCompute', label: 'Dispatch PySpark Job Run', protocol: 'Dataproc / EMR Job API', order: 2 },
          { from: 'SparkCompute', to: 'IcebergLakehouse', label: 'Stage Bronze Parquet Partitions', protocol: 'Iceberg REST (mTLS)', order: 3 },
          { from: 'SparkCompute', to: 'DbtCore', label: 'Trigger Dimensional Model Transforms', protocol: 'dbt Cloud / CLI Runner', order: 4 },
          { from: 'DbtCore', to: 'HITL_Gate', label: 'On Null > 5% or Schema Drift: Halt Pipeline', protocol: 'Quarantine Event', isException: true, isHitl: true, order: 5 },
          { from: 'HITL_Gate', to: 'IcebergLakehouse', label: 'Authorized Schema Migration & Re-run', protocol: 'Signed Approval Token', isHitl: true, order: 6 },
          { from: 'DbtCore', to: 'IcebergLakehouse', label: 'Commit Gold Fact & Dimension Snapshot', protocol: 'ACID Manifest Commit', order: 7 },
          { from: 'IcebergLakehouse', to: 'AnalyticsBI', label: 'Federated Query & BI Dashboard Refresh', protocol: 'Trino / BigLake Connector', order: 8 }
        ]
      },
      level2: {
        SparkCompute: {
          parentSystem: {
            id: 'SparkCompute',
            label: 'Apache Spark / Dataproc Serverless',
            category: 'service',
            zone: 'integration',
            icon: '⚡',
            role: 'Distributed Processing Core',
            description: 'Scalable cluster executing distributed in-memory data processing.',
            technologies: ['PySpark 3.5', 'Adaptive Query Execution (AQE)', 'RocksDB'],
            containerCount: 3
          },
          containers: [
            { id: 'Spark_Driver', parentSystemId: 'SparkCompute', label: 'Spark Driver & Job Coordinator', type: 'orchestrator', technology: 'JVM Spark Driver, Catalyst Optimizer', endpoint: 'spark://master:7077', description: 'Plans DAG stages, coordinates partition tasks, and negotiates cluster memory.', componentCount: 2 },
            { id: 'Spark_Executors', parentSystemId: 'SparkCompute', label: 'Distributed Executor Worker Fleet', type: 'adapter', technology: 'Containerized PySpark Pods (Kubernetes / Dataproc)', description: 'Executes parallel transformations, broadcast joins, and columnar aggregations.', componentCount: 2 },
            { id: 'DQ_Profiler', parentSystemId: 'SparkCompute', label: 'Great Expectations Profiling Engine', type: 'gate', technology: 'Great Expectations 0.18 + Soda Core', description: 'Computes statistical distributions, null fractions, and regex compliance.', componentCount: 1 }
          ],
          connections: [
            { from: 'Spark_Driver', to: 'Spark_Executors', label: 'Distribute Task Partitions', protocol: 'RPC / Netty Stream', order: 1 },
            { from: 'Spark_Executors', to: 'DQ_Profiler', label: 'Stream Partition Metrics', protocol: 'In-Memory Arrow Buffer', order: 2 }
          ]
        },
        Airflow: {
          parentSystem: {
            id: 'Airflow',
            label: 'Apache Airflow / Cloud Composer',
            category: 'gateway',
            zone: 'integration',
            icon: '🌪️',
            role: 'Pipeline Orchestrator',
            description: 'Enterprise DAG scheduler with dynamic retry policies.',
            technologies: ['Airflow 2.10', 'CeleryExecutor', 'Postgres Metadata'],
            containerCount: 3
          },
          containers: [
            { id: 'Airflow_Scheduler', parentSystemId: 'Airflow', label: 'Airflow DAG Scheduler', type: 'orchestrator', technology: 'Airflow Scheduler & Triggerer', description: 'Evaluates task dependencies and enqueues DAG runs.', componentCount: 2 },
            { id: 'Airflow_Workers', parentSystemId: 'Airflow', label: 'Celery / K8s Worker Nodes', type: 'api', technology: 'Python 3.11 Execution Runners', description: 'Executes Bash, Python, and Dataproc operators.', componentCount: 1 },
            { id: 'Airflow_StateDB', parentSystemId: 'Airflow', label: 'Airflow State & Metadata DB', type: 'store', technology: 'Cloud SQL PostgreSQL 15', description: 'Maintains task states, XCom variables, and connection credentials.', componentCount: 1 }
          ],
          connections: [
            { from: 'Airflow_Scheduler', to: 'Airflow_Workers', label: 'Dispatch Job Queue', protocol: 'RabbitMQ / Redis Broker', order: 1 }
          ]
        },
        IcebergLakehouse: {
          parentSystem: {
            id: 'IcebergLakehouse',
            label: 'Apache Iceberg ACID Lakehouse',
            category: 'database',
            zone: 'core',
            icon: '🧊',
            role: 'Transactional Lakehouse Store',
            description: 'Open table format providing snapshot isolation and ACID transactions.',
            technologies: ['Iceberg REST Catalog', 'Snappy Parquet', 'Object Storage'],
            containerCount: 2
          },
          containers: [
            { id: 'Iceberg_Catalog', parentSystemId: 'IcebergLakehouse', label: 'Iceberg REST / Polaris Catalog', type: 'api', technology: 'REST Table Catalog v1', description: 'Tracks active table metadata pointers and snapshot history.', componentCount: 2 },
            { id: 'Parquet_Lake', parentSystemId: 'IcebergLakehouse', label: 'Columnar Parquet Storage Tier', type: 'store', technology: 'AWS S3 / Google Cloud Storage', description: 'Stores immutable, compressed parquet files organized by date partitions.', componentCount: 1 }
          ],
          connections: [
            { from: 'Iceberg_Catalog', to: 'Parquet_Lake', label: 'Write Metadata Manifest List', protocol: 'S3 API / GCS JSON', order: 1 }
          ]
        }
      },
      level3: {
        Spark_Driver: {
          parentContainer: {
            id: 'Spark_Driver',
            parentSystemId: 'SparkCompute',
            label: 'Spark Driver & Job Coordinator',
            type: 'orchestrator',
            technology: 'JVM Spark Driver',
            description: 'Coordinates distributed partition execution and schema contracts.',
            componentCount: 2
          },
          components: [
            {
              id: 'SchemaValidatorStep',
              parentContainerId: 'Spark_Driver',
              label: 'Schema Evolution & Quarantine Filter',
              role: 'Schema Contract Validator',
              description: 'Ensures inbound partition matches registered Iceberg schema version.',
              slaMs: 120,
              retryPolicy: 'Zero retry — Hard quarantine on breaking schema drift',
              contracts: [
                { field: 'event_timestamp', type: 'Timestamp (UTC ISO 8601)', required: true, source: 'Ingest Kafka Payload', destination: 'Bronze Iceberg Table', description: 'Universal event occurrence timestamp.', validationRule: 'Within 24h of current time' },
                { field: 'tenant_id', type: 'UUIDv4 String', required: true, source: 'JWT Auth Header', destination: 'Partition Key', description: 'Enterprise customer isolation key.', validationRule: 'Matches ^[0-9a-f-]{36}$' },
                { field: 'revenue_usd', type: 'Decimal(18,4)', required: true, source: 'Payment Transaction Payload', destination: 'Fact Ledger Partition', description: 'Normalized monetary transaction amount in USD.', validationRule: 'Non-negative; null rate < 0.1%' },
                { field: 'schema_hash', type: 'SHA-256 Hex', required: true, source: 'Avro Schema Registry', destination: 'Iceberg Table Manifest', description: 'Cryptographic fingerprint of partition schema.', validationRule: 'Must match schema catalog ID' }
              ]
            },
            {
              id: 'PartitionPruningStep',
              parentContainerId: 'Spark_Driver',
              label: 'Adaptive Partition & Min/Max Pruner',
              role: 'Query Optimizer Component',
              description: 'Prunes untouched parquet files using file-level min/max column statistics.',
              slaMs: 45,
              contracts: [
                { field: 'partition_date', type: 'Date (YYYY-MM-DD)', required: true, source: 'DAG Run Context', destination: 'Parquet File Path', description: 'Temporal partition folder.' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_DataQuality',
          systemId: 'DbtCore',
          title: 'Data Quality Anomaly & Schema Drift Quarantine Gate',
          triggerCondition: 'Great Expectations detects null rate > 5.0% on critical business columns or schema drift introduces breaking type mismatch.',
          reviewSurface: 'Monte Carlo / Great Expectations DataOps Observability Portal',
          reviewRole: 'Lead Data Platform Engineer / Analytics Architect',
          slaMinutes: 20,
          diagnosticDetails: `• Ingestion Pipeline: Bronze S3 Partition s3://lakehouse/bronze/orders/dt=2026-10-20/
• Great Expectations Assertion: column 'revenue_usd' null_percentage = 18.4% (Threshold: < 0.5%)
• Schema Drift: Field 'customer_tax_code' detected with incompatible type change INT64 -> STRING
• Safety Action: Ingestion paused at Silver transform; partition quarantined pending schema review.`,
          humanActions: [
            { name: 'Approve Migration & Auto-Backfill', action: 'override', impact: 'Evolves Iceberg table schema, updates gold models, and un-pauses downstream DAGs.' },
            { name: 'Quarantine Partition & Alert Producers', action: 'reject', impact: 'Diverts corrupted partition to Dead Letter Queue (DLQ) and files P1 incident.' },
            { name: 'Escalate to VP of Data', action: 'escalate', impact: 'Triggers on-call escalation after 20-minute SLA timeout.' }
          ],
          auditProvenance: 'DataOps engineer SSO signature, schema delta diff, and approval hash written to Iceberg audit catalog.'
        }
      ]
    };
  }

  // ── 2. Insurance Claims & Underwriting Architecture Model ────────────────────

  private static buildInsuranceModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Enterprise Insurance Claims Adjudication & Actuarial Underwriting ecosystem with multi-channel FNOL intake, Guidewire ClaimCenter, Neo4j actuarial fraud graph, and a mandatory Four-Eyes Senior Claims Adjuster HITL Gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Policyholder & Broker Ingress' },
          { id: 'integration', label: 'Rules & Actuarial Engine (mTLS)' },
          { id: 'core', label: 'Claims Ledger & Clearing (Guidewire)' },
          { id: 'governance', label: 'Four-Eyes Claims & Actuarial Governance' }
        ],
        systems: [
          { id: 'Claimant', label: 'Policyholder / Broker Portal', category: 'actor', zone: 'client', icon: '👤', role: 'Claimant / Broker', description: 'Submits First Notice of Loss (FNOL) with police report and photos.', technologies: ['React Portal', 'Mobile App', 'OAuth2'], containerCount: 0 },
          { id: 'InsuranceGW', label: 'Kong Enterprise Gateway', category: 'gateway', zone: 'client', icon: '🛡️', role: 'Security Ingress Controller', description: 'mTLS termination, API rate limiting, and document virus scanning.', technologies: ['Kong EE', 'WAF', 'ClamAV'], containerCount: 2 },
          { id: 'ClaimsEngine', label: 'Automated Claims Adjudication Core', category: 'service', zone: 'integration', icon: '⚙️', role: 'Rules & Deductible Engine', description: 'Validates policy active status, coverage limits, and deductible rules.', technologies: ['FastAPI', 'Drools Rule Engine'], containerCount: 3 },
          { id: 'ActuarialGraph', label: 'Neo4j Fraud & Actuarial Risk Graph', category: 'service', zone: 'integration', icon: '🧠', role: 'Fraud Ring & Actuarial Scorer', description: 'Calculates claim risk score and cross-checks organized ring syndicates.', technologies: ['Neo4j Enterprise', 'Graph Data Science (GDS)'], containerCount: 2 },
          { id: 'Guidewire', label: 'Guidewire ClaimCenter Core', category: 'database', zone: 'core', icon: '🏛️', role: 'Enterprise Claims Ledger', description: 'System of record for policy reserves, payouts, and legal subrogation.', technologies: ['Guidewire Cloud', 'Oracle RAC'], containerCount: 3 },
          { id: 'ClearingBank', label: 'Federal Reserve NACHA / Wire Payout', category: 'service', zone: 'thirdparty', icon: '💳', role: 'Claims Settlement Network', description: 'Dispatches real-time claimant EFT / direct deposit settlements.', technologies: ['ISO 20022', 'Fedwire', 'NACHA ACH'], containerCount: 1 },
          { id: 'HITL_Gate', label: 'Four-Eyes Claims Adjudication Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Senior Adjuster Decision Gate', description: 'Mandatory human approval gate for claims > $25k or fraud risk index > 0.65.', technologies: ['Guidewire Adjuster Console', 'Dual-Key Auth'], containerCount: 1 }
        ],
        connections: [
          { from: 'Claimant', to: 'InsuranceGW', label: 'Submit FNOL Claim ($38,500)', protocol: 'HTTPS / REST (TLS 1.3)', order: 1 },
          { from: 'InsuranceGW', to: 'ClaimsEngine', label: 'Forward Validated Claim Payload', protocol: 'mTLS Private VPC', order: 2 },
          { from: 'ClaimsEngine', to: 'ActuarialGraph', label: 'Evaluate Fraud Ring & Telematics Risk', protocol: 'gRPC / Cypher Query', order: 3 },
          { from: 'ActuarialGraph', to: 'HITL_Gate', label: 'Claim > $25k OR Risk > 0.65: Route to Senior Adjuster', protocol: 'Escalation Event', isException: true, isHitl: true, order: 4 },
          { from: 'HITL_Gate', to: 'Guidewire', label: 'Signed Dual-Custody Approval Token', protocol: 'Signed JWT Token', isHitl: true, order: 5 },
          { from: 'ClaimsEngine', to: 'Guidewire', label: 'Allocate Loss Reserve & Adjust Policy', protocol: 'REST / SOAP Enterprise', order: 6 },
          { from: 'Guidewire', to: 'ClearingBank', label: 'Execute Direct Settlement Wire Payout', protocol: 'NACHA / Fedwire pacs.008', order: 7 }
        ]
      },
      level2: {
        ClaimsEngine: {
          parentSystem: {
            id: 'ClaimsEngine',
            label: 'Automated Claims Adjudication Core',
            category: 'service',
            zone: 'integration',
            icon: '⚙️',
            role: 'Rules & Deductible Engine',
            description: 'Executes automated policy verification and loss evaluation.',
            technologies: ['FastAPI', 'Drools Business Rules', 'Pydantic'],
            containerCount: 3
          },
          containers: [
            { id: 'FNOL_Ingest', parentSystemId: 'ClaimsEngine', label: 'FNOL Ingestion & Doc OCR', type: 'api', technology: 'FastAPI + Tesseract OCR', description: 'Extracts loss date, estimated damage, and driver details from police PDF.', componentCount: 2 },
            { id: 'Policy_Matcher', parentSystemId: 'ClaimsEngine', label: 'Coverage & Limit Evaluator', type: 'orchestrator', technology: 'Drools Rule Engine v8', description: 'Verifies premium payment status and deductibles under policy terms.', componentCount: 2 },
            { id: 'Reserve_Allocator', parentSystemId: 'ClaimsEngine', label: 'Actuarial Reserve Calculator', type: 'adapter', technology: 'Python Actuarial Framework', description: 'Calculates recommended indemnity and medical loss reserve amounts.', componentCount: 1 }
          ],
          connections: [
            { from: 'FNOL_Ingest', to: 'Policy_Matcher', label: 'Pass Normalized Claim', protocol: 'Internal REST', order: 1 },
            { from: 'Policy_Matcher', to: 'Reserve_Allocator', label: 'Calculate Loss Reserves', protocol: 'In-Memory RPC', order: 2 }
          ]
        },
        Guidewire: {
          parentSystem: {
            id: 'Guidewire',
            label: 'Guidewire ClaimCenter Core',
            category: 'database',
            zone: 'core',
            icon: '🏛️',
            role: 'Enterprise Claims Ledger',
            description: 'Guidewire Cloud platform managing active claims lifecycle and payments.',
            technologies: ['Guidewire ClaimCenter v10', 'Oracle RAC Database'],
            containerCount: 2
          },
          containers: [
            { id: 'GW_ClaimService', parentSystemId: 'Guidewire', label: 'ClaimCenter Integration API', type: 'api', technology: 'Guidewire REST APIs', description: 'Exposes claims creation, note history, and reserve adjustment endpoints.', componentCount: 1 },
            { id: 'GW_LedgerDB', parentSystemId: 'Guidewire', label: 'Claims Ledger & Reserve DB', type: 'store', technology: 'Oracle RAC 19c Multi-Tenant', description: 'Persistent financial ledger holding legal claim records and reserves.', componentCount: 1 }
          ],
          connections: [
            { from: 'GW_ClaimService', to: 'GW_LedgerDB', label: 'Commit Transaction', protocol: 'Oracle OCI / JDBC', order: 1 }
          ]
        }
      },
      level3: {
        ClaimsEngine: {
          parentContainer: {
            id: 'FNOL_Ingest',
            parentSystemId: 'ClaimsEngine',
            label: 'FNOL Ingestion & Doc OCR',
            type: 'api',
            technology: 'FastAPI + Pydantic',
            description: 'Validates inbound First Notice of Loss schema against insurance contracts.',
            componentCount: 2
          },
          components: [
            {
              id: 'FNOLValidator',
              parentContainerId: 'FNOL_Ingest',
              label: 'Claim Payload & Invariant Evaluator',
              role: 'Contract Validator Component',
              description: 'Enforces coverage validity and statutory claim filing constraints.',
              slaMs: 180,
              contracts: [
                { field: 'Claim_ID', type: 'String (CLM-YYYYMM-XXXXX)', required: true, source: 'FNOL Intake Portal', destination: 'Guidewire ClaimCenter', description: 'Universal claim identifier.', validationRule: 'Matches ^CLM-[0-9]{6}-[A-Z0-9]{5}$' },
                { field: 'Policy_Number', type: 'String (Alphanumeric 10)', required: true, source: 'Insurance Portal', destination: 'Policy Registry', description: 'Underwritten active policy account number.', validationRule: 'Must resolve to in-force policy' },
                { field: 'Loss_Date', type: 'Date (YYYY-MM-DD)', required: true, source: 'Police Report / Claimant', destination: 'Coverage Matcher', description: 'Exact date incident occurred.', validationRule: 'Loss_Date <= Today AND Loss_Date >= Policy_Start_Date' },
                { field: 'Claimed_Amount_USD', type: 'Decimal(12,2)', required: true, source: 'Claimant Estimate', destination: 'Reserve Allocator', description: 'Estimated loss amount claimed by insured.', validationRule: 'Claimed_Amount > 0.00' },
                { field: 'Fraud_Risk_Index', type: 'Float (0.000 to 1.000)', required: true, source: 'Neo4j Actuarial Graph', destination: 'HITL Review Trigger', description: 'Machine learning fraud propensity score.', validationRule: 'Scores > 0.650 force mandatory HITL gate' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_Insurance_Adjuster',
          systemId: 'ClaimsEngine',
          title: 'Four-Eyes Senior Claims Adjuster & Fraud Review Gate',
          triggerCondition: 'Claim amount exceeds $25,000 threshold OR Neo4j fraud ring risk index > 0.65.',
          reviewSurface: 'Guidewire ClaimCenter Senior Adjuster Adjudication Workbench',
          reviewRole: 'Certified Senior Claims Adjuster / Special Investigation Unit (SIU)',
          slaMinutes: 60,
          diagnosticDetails: `• Policyholder: Robert Chen (Policy #POL-AUTO-88194)
• Loss Event: Major collision on I-95, estimated claim $38,500.00 USD (Comprehensive Coverage)
• Actuarial Invariant: Claim amount exceeds autonomous threshold ($25,000.00 USD).
• Fraud Risk Model: Vehicle telematics indicates speed = 0mph at alleged incident timestamp.
• Safety Action: Claim flagged for four-eyes senior adjuster review before reserve allocation.`,
          humanActions: [
            { name: 'Approve & Release Settlement Wire', action: 'approve', impact: 'Signs dual-custody authorization; unlocks Guidewire payout for Fedwire dispatch.' },
            { name: 'Refer to Special Investigation Unit (SIU)', action: 'override', impact: 'Freezes claim; assigns investigator to subpoena dashcam footage and interview witnesses.' },
            { name: 'Deny Claim with Formal Notice', action: 'reject', impact: 'Issues certified formal letter of denial citing telematics variance; closes claim.' }
          ],
          auditProvenance: 'Senior Adjuster digital certificate, license number, and cryptographic signature anchored in claims ledger.'
        }
      ]
    };
  }

  // ── 3. Higher Education & LMS Academic Integrity Architecture Model ──────────

  private static buildEducationModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Higher Education Digital Academic Platform with Canvas LMS LTI 1.3 integration, automated competency rubric calculation, Turnitin / AI similarity detection, Ellucian Banner SIS transcript updates, and an Academic Integrity Ombudsman Review Gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Student & Faculty Ingress' },
          { id: 'integration', label: 'LMS & Evaluation Core (LTI 1.3)' },
          { id: 'core', label: 'Registrar & Transcripts (Banner SIS)' },
          { id: 'governance', label: 'Academic Integrity & Ombudsman Board' }
        ],
        systems: [
          { id: 'StudentFaculty', label: 'Students & Faculty Portal', category: 'actor', zone: 'client', icon: '🎓', role: 'Academic Users', description: 'Submits assignments, final capstone papers, and course grades.', technologies: ['Canvas Student UI', 'Mobile App', 'SAML 2.0'], containerCount: 0 },
          { id: 'CanvasLMS', label: 'Canvas / Blackboard LMS Gateway', category: 'gateway', zone: 'client', icon: '📚', role: 'LMS Ingress Gateway', description: 'Handles course enrollment, assignment dispatch, and LTI 1.3 token exchange.', technologies: ['Canvas LMS', 'IMS Global LTI 1.3', 'OAuth2'], containerCount: 2 },
          { id: 'CurriculumCore', label: 'Automated Curriculum & Rubric Core', category: 'service', zone: 'integration', icon: '📝', role: 'Grading & Competency Engine', description: 'Evaluates rubric weights, calculates curved grade averages, and tracks student progress.', technologies: ['FastAPI', 'Celery Workers', 'PostgreSQL'], containerCount: 3 },
          { id: 'IntegrityAI', label: 'Turnitin & AI Detection Core', category: 'service', zone: 'integration', icon: '🔍', role: 'Academic Integrity Scanner', description: 'Analyzes semantic embeddings, citation graphs, and AI hallucination patterns.', technologies: ['Turnitin API', 'Vector Embeddings', 'Cosine Similarity'], containerCount: 2 },
          { id: 'BannerSIS', label: 'Ellucian Banner SIS Registrar Core', category: 'database', zone: 'core', icon: '🏛️', role: 'Official Student Record System', description: 'Permanent student transcript, GPA standing, and degree conferral database.', technologies: ['Ellucian Banner 9', 'Oracle Database', 'REST APIs'], containerCount: 2 },
          { id: 'CredentialVault', label: 'Verifiable Credentials Registry', category: 'service', zone: 'thirdparty', icon: '📜', role: 'Digital Diploma Trust Network', description: 'Issues tamper-evident W3C digital diplomas and cryptographic micro-credentials.', technologies: ['W3C Verifiable Credentials', 'Open Badges 3.0'], containerCount: 1 },
          { id: 'HITL_Gate', label: 'Academic Integrity Ombudsman Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Academic Senate Ombudsman Board', description: 'Reviews flagged similarity violations > 35% or contested grade appeal filings.', technologies: ['Senate Hearing Portal', 'Case Management'], containerCount: 1 }
        ],
        connections: [
          { from: 'StudentFaculty', to: 'CanvasLMS', label: 'Submit Capstone Thesis (PDF/Git)', protocol: 'HTTPS / LTI 1.3', order: 1 },
          { from: 'CanvasLMS', to: 'CurriculumCore', label: 'Forward Submission Payload', protocol: 'REST / Webhook Event', order: 2 },
          { from: 'CurriculumCore', to: 'IntegrityAI', label: 'Scan Document for Plagiarism & AI', protocol: 'HTTPS / JSON API', order: 3 },
          { from: 'IntegrityAI', to: 'HITL_Gate', label: 'Similarity > 35%: Trigger Ombudsman Gate', protocol: 'Violation Event', isException: true, isHitl: true, order: 4 },
          { from: 'HITL_Gate', to: 'CurriculumCore', label: 'Formal Hearing Ruling / Clear Allegation', protocol: 'Signed Adjudication Token', isHitl: true, order: 5 },
          { from: 'CurriculumCore', to: 'BannerSIS', label: 'Commit Official Grade & GPA Standing', protocol: 'Banner REST API / SQL', order: 6 },
          { from: 'BannerSIS', to: 'CredentialVault', label: 'Issue Verifiable Digital Diploma', protocol: 'W3C VC JSON-LD', order: 7 }
        ]
      },
      level2: {
        CurriculumCore: {
          parentSystem: {
            id: 'CurriculumCore',
            label: 'Automated Curriculum & Rubric Core',
            category: 'service',
            zone: 'integration',
            icon: '📝',
            role: 'Grading & Competency Engine',
            description: 'Core microservices calculating weighted syllabus rubrics and degree milestones.',
            technologies: ['FastAPI', 'Python 3.11', 'Redis Cache'],
            containerCount: 3
          },
          containers: [
            { id: 'LTI_Bridge', parentSystemId: 'CurriculumCore', label: 'IMS LTI 1.3 Tool Consumer Bridge', type: 'api', technology: 'LTI Advantage REST Provider', description: 'Authenticates student identity and extracts course CRN context.', componentCount: 2 },
            { id: 'Rubric_Calculator', parentSystemId: 'CurriculumCore', label: 'Weighted Rubric Calculation Engine', type: 'orchestrator', technology: 'Deterministic Scoring Service', description: 'Applies course grading curves, late penalties, and extra credit allowances.', componentCount: 2 },
            { id: 'Competency_Tracker', parentSystemId: 'CurriculumCore', label: 'ABET / Accreditation Progress Ledger', type: 'store', technology: 'PostgreSQL 16 Multi-Tenant', description: 'Tracks course learning objectives (CLOs) and departmental accreditation audits.', componentCount: 1 }
          ],
          connections: [
            { from: 'LTI_Bridge', to: 'Rubric_Calculator', label: 'Deliver Raw Scores', protocol: 'In-Memory Stream', order: 1 }
          ]
        },
        BannerSIS: {
          parentSystem: {
            id: 'BannerSIS',
            label: 'Ellucian Banner SIS Registrar Core',
            category: 'database',
            zone: 'core',
            icon: '🏛️',
            role: 'Official Student Record System',
            description: 'Institutional system of record for university transcripts and academic honors.',
            technologies: ['Banner 9 Student', 'Oracle RAC Database'],
            containerCount: 2
          },
          containers: [
            { id: 'SIS_RegistrarAPI', parentSystemId: 'BannerSIS', label: 'Banner Student Registrar API', type: 'api', technology: 'Ellucian Ethos Integration REST', description: 'Receives signed final grade batches from department heads.', componentCount: 1 },
            { id: 'SIS_TranscriptDB', parentSystemId: 'BannerSIS', label: 'Student Transcript & Degree DB', type: 'store', technology: 'Oracle Database Enterprise', description: 'Permanent, immutable ledger of course credits and conferred degrees.', componentCount: 1 }
          ],
          connections: [
            { from: 'SIS_RegistrarAPI', to: 'SIS_TranscriptDB', label: 'Write Certified Transcript', protocol: 'SQL Stored Procedure', order: 1 }
          ]
        }
      },
      level3: {
        CurriculumCore: {
          parentContainer: {
            id: 'LTI_Bridge',
            parentSystemId: 'CurriculumCore',
            label: 'IMS LTI 1.3 Tool Consumer Bridge',
            type: 'api',
            technology: 'FastAPI + LTI Advantage',
            description: 'Component evaluating academic submission contracts and plagiarism metrics.',
            componentCount: 2
          },
          components: [
            {
              id: 'AcademicContractStep',
              parentContainerId: 'LTI_Bridge',
              label: 'Academic Submission Evaluator',
              role: 'Academic Schema Validator',
              description: 'Validates student ID, course section, and Turnitin similarity index constraints.',
              slaMs: 250,
              contracts: [
                { field: 'Student_ID', type: 'String (STU-XXXXXX)', required: true, source: 'Canvas SAML Token', destination: 'Banner SIS', description: 'Unique institutional student matriculation identifier.', validationRule: 'Matches ^STU-[0-9]{6}$' },
                { field: 'Course_CRN', type: 'String (5 Digits)', required: true, source: 'LMS Context', destination: 'Registrar Ledger', description: 'Course Reference Number in university catalog.', validationRule: 'Matches ^[0-9]{5}$' },
                { field: 'Similarity_Score_Pct', type: 'Decimal(5,2)', required: true, source: 'Turnitin AI Engine', destination: 'Integrity Ombudsman Gate', description: 'Measured plagiarism & artificial text similarity ratio.', validationRule: 'Score > 35.0% forces automatic Ombudsman hold' },
                { field: 'Final_Grade_Letter', type: 'String (A, B, C, D, F, I)', required: true, source: 'Rubric Calculator', destination: 'Official Transcript', description: 'Calculated letter grade abiding by university scale.', validationRule: 'Valid grade designation' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_Ombudsman',
          systemId: 'CurriculumCore',
          title: 'Academic Integrity & Grade Appeal Ombudsman Review Gate',
          triggerCondition: 'Turnitin / AI similarity score > 35% on capstone project or formal grade grievance filed by student.',
          reviewSurface: 'Academic Senate Ombudsman Hearing & Adjudication Board Portal',
          reviewRole: 'Academic Department Chair & University Ombudsman',
          slaMinutes: 2880,
          diagnosticDetails: `• Student: Sarah Jenkins (Student ID STU-992814)
• Course: CS-480 Distributed Systems Capstone (CRN: 50291)
• Submission: Final Architecture Paper (final_report_v2.pdf)
• Turnitin AI Detection: 42.8% similarity to peer submission in Fall 2025 semester.
• Academic Invariant: Submissions with similarity > 30% require Department Chair approval.`,
          humanActions: [
            { name: 'Dismiss Allegation & Release Grade', action: 'override', impact: 'Clears academic record; authorizes immediate Banner SIS grade posting.' },
            { name: 'Issue Academic Sanction (Grade Penalty)', action: 'approve', impact: 'Applies reduction according to syllabus; logs educational integrity warning.' },
            { name: 'Convene Academic Senate Hearing', action: 'escalate', impact: 'Freezes degree conferral; schedules formal hearing with student and counsel.' }
          ],
          auditProvenance: 'Ombudsman board decision, hearing transcript hash, and Department Chair signature anchored in registrar vault.'
        }
      ]
    };
  }

  // ── 4. Enterprise Payroll & Automation Space Architecture Model ──────────────

  private static buildPayrollAutomationModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Enterprise Automated Payroll & Compensation platform with Workday timesheet ingestion, multi-state gross-to-net tax calculation, wage garnishment compliance, NACHA ACH direct deposit generation, and a Corporate Controller Variance Review Gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Employee & Supervisor Ingress' },
          { id: 'integration', label: 'Gross-to-Net & Tax Compliance Core' },
          { id: 'core', label: 'Bank Clearing & ERP (NACHA / SAP)' },
          { id: 'governance', label: 'Corporate Controller Payroll Governance' }
        ],
        systems: [
          { id: 'Timekeeper', label: 'Employees & Shift Supervisors', category: 'actor', zone: 'client', icon: '👥', role: 'Timekeeping Users', description: 'Submits bi-weekly timesheets, PTO requests, and shift overtime.', technologies: ['Workday Mobile', 'Kiosk Badge Reader'], containerCount: 0 },
          { id: 'WorkdayHRIS', label: 'Workday / SuccessFactors HCM Core', category: 'gateway', zone: 'client', icon: '🏢', role: 'Human Capital System of Record', description: 'Maintains base salaries, employee benefit enrollments, and organizational hierarchies.', technologies: ['Workday RaaS', 'Enterprise Interface Builder (EIB)'], containerCount: 3 },
          { id: 'PayrollEngine', label: 'Automated Gross-to-Net Calculation Engine', category: 'service', zone: 'integration', icon: '🧮', role: 'Payroll Compute Core', description: 'Calculates gross pay, FLSA overtime multipliers, 401(k) pre-tax deductions, and net deposits.', technologies: ['Python FastAPI', 'In-Memory Compute Engine'], containerCount: 4 },
          { id: 'TaxCompliance', label: 'Multi-Jurisdiction Tax & Garnishment Worker', category: 'service', zone: 'integration', icon: '⚖️', role: 'Statutory Compliance Core', description: 'Computes Federal, State, and Local withholding taxes plus court-ordered child support levies.', technologies: ['Vertex / ADP SmartCompliance API'], containerCount: 2 },
          { id: 'BankClearing', label: 'Federal Reserve NACHA Direct Deposit Network', category: 'service', zone: 'core', icon: '🏦', role: 'Interbank Settlement Network', description: 'Processes 94-character fixed-width ACH PPD/CCD batch files for direct deposit clearance.', technologies: ['NACHA ACH Network', 'SFTP mTLS'], containerCount: 2 },
          { id: 'NetSuiteERP', label: 'SAP S/4HANA / NetSuite General Ledger', category: 'database', zone: 'core', icon: '📑', role: 'Corporate Accounting System', description: 'Records balanced double-entry payroll expense journal entries and tax liabilities.', technologies: ['SAP S/4HANA Finance', 'REST / OData'], containerCount: 1 },
          { id: 'HITL_Gate', label: 'Payroll Variance & Wage Garnishment Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Corporate Controller Decision Gate', description: 'Mandatory sign-off when batch variance exceeds 3.5% or new garnishment summons is received.', technologies: ['Workday Payroll Console', 'Dual-Custody FIDO2'], containerCount: 1 }
        ],
        connections: [
          { from: 'Timekeeper', to: 'WorkdayHRIS', label: 'Approve Bi-Weekly Timesheets', protocol: 'HTTPS / Web UI', order: 1 },
          { from: 'WorkdayHRIS', to: 'PayrollEngine', label: 'Stream Unprocessed Timesheet Batch', protocol: 'mTLS Workday EIB (JSON)', order: 2 },
          { from: 'PayrollEngine', to: 'TaxCompliance', label: 'Compute Withholding & Garnishment Rules', protocol: 'gRPC / JSON API', order: 3 },
          { from: 'TaxCompliance', to: 'PayrollEngine', label: 'Return Net Calculations & Tax Lines', protocol: 'Structured Response', order: 4 },
          { from: 'PayrollEngine', to: 'HITL_Gate', label: 'Variance > 3.5% OR Garnishment: Trigger Controller Gate', protocol: 'Variance Alert', isException: true, isHitl: true, order: 5 },
          { from: 'HITL_Gate', to: 'BankClearing', label: '1-Click Signed Dual-Custody Release Token', protocol: 'Cryptographic Auth', isHitl: true, order: 6 },
          { from: 'PayrollEngine', to: 'BankClearing', label: 'Dispatch 94-Char NACHA ACH File ($1.48M)', protocol: 'mTLS SFTP Direct Transmission', order: 7 },
          { from: 'PayrollEngine', to: 'NetSuiteERP', label: 'Post Balanced Payroll Journal Entry', protocol: 'OData / REST Accounting API', order: 8 }
        ]
      },
      level2: {
        PayrollEngine: {
          parentSystem: {
            id: 'PayrollEngine',
            label: 'Automated Gross-to-Net Calculation Engine',
            category: 'service',
            zone: 'integration',
            icon: '🧮',
            role: 'Payroll Compute Core',
            description: 'High-speed deterministic arithmetic calculation pipeline enforcing labor laws.',
            technologies: ['Python 3.11', 'FastAPI', 'Pandas', 'Pydantic'],
            containerCount: 4
          },
          containers: [
            { id: 'Timesheet_Ingest', parentSystemId: 'PayrollEngine', label: 'Timesheet Normalization Worker', type: 'api', technology: 'FastAPI Stream Ingestion', description: 'Ingests regular, overtime, holiday, and paid-time-off hours per cost center.', componentCount: 2 },
            { id: 'GrossToNet_Calculator', parentSystemId: 'PayrollEngine', label: 'Gross-to-Net Arithmetic Engine', type: 'orchestrator', technology: 'Deterministic Pay Calculator', description: 'Computes base salary, 1.5x/2.0x overtime premiums, and pre-tax 401(k)/HSA deductions.', componentCount: 2 },
            { id: 'Garnishment_Worker', parentSystemId: 'PayrollEngine', label: 'Statutory Wage Garnishment Worker', type: 'adapter', technology: 'CCPA Title III Garnishment Adapter', description: 'Enforces federal disposable earnings limits (25% maximum) for court orders.', componentCount: 1 },
            { id: 'NACHA_Formatter', parentSystemId: 'PayrollEngine', label: '94-Character NACHA ACH Generator', type: 'store', technology: 'Fixed-Width ACH Generator', description: 'Constructs validated NACHA batch headers, entry detail records, and control totals.', componentCount: 1 }
          ],
          connections: [
            { from: 'Timesheet_Ingest', to: 'GrossToNet_Calculator', label: 'Send Verified Hours', protocol: 'In-Memory Pipeline', order: 1 },
            { from: 'GrossToNet_Calculator', to: 'Garnishment_Worker', label: 'Calculate Disposable Earnings', protocol: 'Direct Function Call', order: 2 },
            { from: 'GrossToNet_Calculator', to: 'NACHA_Formatter', label: 'Build Payment Records', protocol: 'Binary Stream', order: 3 }
          ]
        },
        BankClearing: {
          parentSystem: {
            id: 'BankClearing',
            label: 'Federal Reserve NACHA Direct Deposit Network',
            category: 'service',
            zone: 'core',
            icon: '🏦',
            role: 'Interbank Settlement Network',
            description: 'Direct interface to banking partner clearing direct deposit funds.',
            technologies: ['NACHA ACH', 'SFTP with PGP Encryption'],
            containerCount: 2
          },
          containers: [
            { id: 'ACH_Sender', parentSystemId: 'BankClearing', label: 'Secure Banking SFTP Dispatcher', type: 'adapter', technology: 'OpenSSH SFTP + PGP Signer', description: 'Encrypts and transfers ACH files to bank transit dropboxes.', componentCount: 1 },
            { id: 'ACH_ReturnListener', parentSystemId: 'BankClearing', label: 'ACH Return (NOC / R-Code) Listener', type: 'api', technology: 'Webhook / Polling Worker', description: 'Catches R01 (Insufficient Funds) and R03 (No Account) rejection notices.', componentCount: 1 }
          ],
          connections: [
            { from: 'ACH_Sender', to: 'ACH_ReturnListener', label: 'Monitor Batch Reconciliation', protocol: 'Bank Status Feed', order: 1 }
          ]
        }
      },
      level3: {
        PayrollEngine: {
          parentContainer: {
            id: 'GrossToNet_Calculator',
            parentSystemId: 'PayrollEngine',
            label: 'Gross-to-Net Arithmetic Engine',
            type: 'orchestrator',
            technology: 'FastAPI + Pydantic',
            description: 'Component enforcing payroll contracts and statutory calculation rules.',
            componentCount: 2
          },
          components: [
            {
              id: 'PayrollContractStep',
              parentContainerId: 'GrossToNet_Calculator',
              label: 'Payroll Computation & Schema Validator',
              role: 'Compensation Schema Invariant',
              description: 'Enforces wage accuracy, tax withholding bounds, and banking checksums.',
              slaMs: 150,
              contracts: [
                { field: 'Employee_ID', type: 'String (EMP-XXXXXX)', required: true, source: 'Workday HRIS', destination: 'Payroll Engine', description: 'Universal corporate employee identifier.', validationRule: 'Matches ^EMP-[0-9]{6}$' },
                { field: 'Gross_Hours_Worked', type: 'Decimal(5,2)', required: true, source: 'Timesheet Worker', destination: 'Gross Calculator', description: 'Total bi-weekly hours logged.', validationRule: 'Non-negative; hours > 80.0 trigger overtime review' },
                { field: 'Gross_Pay_USD', type: 'Decimal(10,2)', required: true, source: 'Rate Multiplier', destination: 'Tax Compliance', description: 'Total pre-deduction compensation.', validationRule: 'Gross_Pay == (Base_Salary + Overtime_Pay + Bonus)' },
                { field: 'Total_Tax_Withheld_USD', type: 'Decimal(10,2)', required: true, source: 'Vertex Tax Engine', destination: 'General Ledger', description: 'Combined Federal, State, and FICA statutory withholdings.', validationRule: 'Withholding <= 60% of Gross_Pay' },
                { field: 'Net_Deposit_USD', type: 'Decimal(10,2)', required: true, source: 'GrossToNet Calculator', destination: 'NACHA Direct Deposit', description: 'Net take-home pay deposited into employee checking account.', validationRule: 'Net_Deposit == Gross_Pay - Taxes - Deductions' },
                { field: 'ABA_Routing_Number', type: 'String (9 Digits)', required: true, source: 'Employee Direct Deposit Form', destination: 'NACHA Batch File', description: 'Federal Reserve Transit Routing Number.', validationRule: 'Valid Mod-10 Checksum' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_Payroll_Controller',
          systemId: 'PayrollEngine',
          title: 'Corporate Controller Payroll Variance & Wage Garnishment Gate',
          triggerCondition: 'Total payroll run variance exceeds 3.5% vs prior cycle, individual pay fluctuation > $2,500, or new garnishment summons is received.',
          reviewSurface: 'Workday Enterprise Pre-Commit Payroll Dashboard',
          reviewRole: 'Corporate Payroll Controller / VP of Total Rewards',
          slaMinutes: 240,
          diagnosticDetails: `• Pay Period: Bi-Weekly Ending 2026-10-24 (Batch ID: PAY-2026-B21)
• Total Payroll Volume: $1,482,900.00 USD (+6.8% variance vs prior cycle; threshold > 3.5%)
• Anomaly Trigger: 14 employees in Engineering logged 42+ overtime hours exceeding cap.
• Statutory Compliance: New court-ordered wage garnishment summons for Employee EMP-09412.
• Safety Action: Direct deposit ACH file generation paused pending Controller dual-custody authorization.`,
          humanActions: [
            { name: 'Dual-Custody Sign & Release Batch', action: 'approve', impact: 'Applies cryptographic FIDO2 corporate signature; triggers immediate NACHA transmission.' },
            { name: 'Quarantine Flagged Employees & Release Balance', action: 'override', impact: 'Splits payroll run; releases 98% unaffected salaries and holds flagged timesheets for manual audit.' },
            { name: 'Reject Batch & Force Recalculation', action: 'reject', impact: 'Reopens timesheets for department manager correction and cancels pending ACH draft.' }
          ],
          auditProvenance: 'Controller FIDO2 WebAuthn biometric key, IP address, and SHA-256 batch hash recorded in immutable corporate payroll journal.'
        }
      ]
    };
  }

  // ── 5. Core Banking Wire Transfer & AML Architecture Model ───────────────────

  private static buildBankingModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Universal high-speed core banking wire transfer with Kafka event mesh, automated Neo4j graph fraud detection, Finacle core banking, and a mandatory Compliance Officer Human-in-the-Loop review gate for transactions exceeding $10,000.',
      level1: {
        zones: [
          { id: 'client', label: 'Branch & Commercial Ingress' },
          { id: 'integration', label: 'Event Mesh & AML Core (mTLS)' },
          { id: 'core', label: 'Core Banking Ledger & Fedwire' },
          { id: 'governance', label: 'Compliance & AML Governance' }
        ],
        systems: [
          { id: 'Teller', label: 'Branch Teller / Commercial Client', category: 'actor', zone: 'client', icon: '👤', role: 'Initiating User', description: 'Submits commercial wire transfer ($250,000 USD).', technologies: ['Teller UI', 'Omni-Channel API'], containerCount: 0 },
          { id: 'Kong', label: 'Kong Enterprise Gateway', category: 'gateway', zone: 'client', icon: '🛡️', role: 'API Ingress Gateway', description: 'mTLS verification, rate limiting, and JWT validation.', technologies: ['Kong EE', 'mTLS', 'OAuth2'], containerCount: 2 },
          { id: 'Kafka', label: 'Apache Kafka Event Mesh', category: 'queue', zone: 'integration', icon: '⚡', role: 'Real-Time Event Bus', description: 'Distributes transaction events with guaranteed ordering.', technologies: ['Kafka Cluster', 'Schema Registry'], containerCount: 3 },
          { id: 'AML', label: 'AML & Fraud Detection Core', category: 'service', zone: 'integration', icon: '🧠', role: 'Sanctions & Graph Screening', description: 'Evaluates sanction lists and graph money-laundering rings.', technologies: ['Python FastAPI', 'Neo4j Graph DB'], containerCount: 2 },
          { id: 'CoreBank', label: 'Finacle Core Banking DB', category: 'database', zone: 'core', icon: '🏦', role: 'General Ledger System', description: 'Debits originator and credits beneficiary accounts.', technologies: ['Oracle RAC', 'Finacle Core'], containerCount: 2 },
          { id: 'Fedwire', label: 'Fedwire Clearing Gateway', category: 'service', zone: 'thirdparty', icon: '🌐', role: 'Interbank Settlement Network', description: 'Settles funds with central clearing bank via ISO 20022.', technologies: ['ISO 20022', 'SWIFT Alliance'], containerCount: 1 },
          { id: 'HITL_Gate', label: 'AML Compliance Review Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Human-in-the-Loop Gate', description: 'Required sign-off for transactions > $10k or sanctions hits.', technologies: ['ServiceNow Compliance', 'FIDO2 Auth'], containerCount: 1 }
        ],
        connections: [
          { from: 'Teller', to: 'Kong', label: 'Submit Wire ($250,000)', protocol: 'HTTPS / REST', order: 1 },
          { from: 'Kong', to: 'Kafka', label: 'Publish wire.initiated topic', protocol: 'Kafka Producer (Avro)', order: 2 },
          { from: 'Kafka', to: 'AML', label: 'Consume for Fraud Analysis', protocol: 'Event Consumer', order: 3 },
          { from: 'AML', to: 'HITL_Gate', label: 'Threshold > $10,000: Trigger HITL Sign-Off', protocol: 'Exception Event', isHitl: true, isException: true, order: 4 },
          { from: 'HITL_Gate', to: 'Kafka', label: '1-Click Cryptographic Approval', protocol: 'Signed Approval Event', isHitl: true, order: 5 },
          { from: 'Kafka', to: 'CoreBank', label: 'Commit Ledger Balance', protocol: '2-Phase Commit (2PC)', order: 6 },
          { from: 'CoreBank', to: 'Fedwire', label: 'Dispatch Fedwire MT103/pacs.008', protocol: 'ISO 20022 XML', order: 7 }
        ]
      },
      level2: {
        CoreBank: {
          parentSystem: {
            id: 'CoreBank',
            label: 'Finacle Core Banking DB',
            category: 'database',
            zone: 'core',
            icon: '🏦',
            role: 'General Ledger System',
            description: 'Core banking platform executing transactional debits and credits.',
            technologies: ['Infosys Finacle 11', 'Oracle RAC Database'],
            containerCount: 2
          },
          containers: [
            { id: 'Finacle_Ledger', parentSystemId: 'CoreBank', label: 'Double-Entry Ledger Engine', type: 'store', technology: 'Finacle Core Service Engine', description: 'Performs atomic debit and credit balanced account postings.', componentCount: 2 },
            { id: 'Finacle_Audit', parentSystemId: 'CoreBank', label: 'Immutable Audit Journal', type: 'store', technology: 'Oracle Blockchain Table', description: 'Cryptographic tamper-evident transaction journal.', componentCount: 1 }
          ],
          connections: [
            { from: 'Finacle_Ledger', to: 'Finacle_Audit', label: 'Append Cryptographic Receipt', protocol: 'Internal SQL', order: 1 }
          ]
        },
        AML: {
          parentSystem: {
            id: 'AML',
            label: 'AML & Fraud Detection Core',
            category: 'service',
            zone: 'integration',
            icon: '🧠',
            role: 'Sanctions & Graph Screening',
            description: 'Real-time sanctions screening and graph-based money laundering detector.',
            technologies: ['Python FastAPI', 'Neo4j Graph Database', 'OFAC Watchlist'],
            containerCount: 2
          },
          containers: [
            { id: 'Sanction_Scanner', parentSystemId: 'AML', label: 'OFAC & PEP Sanction Matcher', type: 'api', technology: 'FastAPI + Fuzzy Levenshtein Matcher', description: 'Screens beneficiary and remitter against global sanctions lists.', componentCount: 2 },
            { id: 'Graph_Analyzer', parentSystemId: 'AML', label: 'Neo4j Smurfing & Layering Detector', type: 'adapter', technology: 'Neo4j GDS Engine', description: 'Detects circular transactions and structuring patterns across accounts.', componentCount: 1 }
          ],
          connections: [
            { from: 'Sanction_Scanner', to: 'Graph_Analyzer', label: 'Cross-Query Entity Neighbors', protocol: 'Bolt / Cypher', order: 1 }
          ]
        }
      },
      level3: {
        CoreBank: {
          parentContainer: {
            id: 'Finacle_Ledger',
            parentSystemId: 'CoreBank',
            label: 'Double-Entry Ledger Engine',
            type: 'store',
            technology: 'Finacle Core Service Engine',
            description: 'Component enforcing ISO 20022 wire transfer contracts.',
            componentCount: 2
          },
          components: [
            {
              id: 'WireContractStep',
              parentContainerId: 'Finacle_Ledger',
              label: 'Wire Transfer Contract Validator',
              role: 'Financial Schema Contract',
              description: 'Enforces ISO 20022 pacs.008 customer credit transfer specifications.',
              slaMs: 90,
              contracts: [
                { field: 'Transaction_ID', type: 'String (UUID / EndToEndId)', required: true, source: 'Teller Terminal', destination: 'Fedwire Clearing', description: 'Unique end-to-end payment identifier.', validationRule: 'Matches ^[A-Z0-9-]{16,35}$' },
                { field: 'Originator_Account', type: 'String (Account Number)', required: true, source: 'Commercial Customer', destination: 'Debit Account Ledger', description: 'Account number to be debited.', validationRule: 'Must be active with sufficient available funds' },
                { field: 'Beneficiary_IBAN', type: 'String (IBAN / Routing)', required: true, source: 'Wire Request', destination: 'Interbank Gateway', description: 'International Bank Account Number of payee.', validationRule: 'Valid IBAN Mod-97 Checksum' },
                { field: 'Transfer_Amount_USD', type: 'Decimal(15,2)', required: true, source: 'Wire Request', destination: 'General Ledger', description: 'Settlement amount in USD.', validationRule: 'Amount > 0.00; values > 10,000 force AML gate' },
                { field: 'OFAC_Match_Score', type: 'Float (0.000 to 1.000)', required: true, source: 'Sanctions Scanner', destination: 'AML Review Gate', description: 'Fuzzy match confidence against OFAC Specially Designated Nationals list.' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_AML',
          systemId: 'AML',
          title: 'High-Value Wire Compliance Review Gate',
          triggerCondition: 'Wire transfer amount exceeds $10,000 or Neo4j AML graph score > 0.72.',
          reviewSurface: 'ServiceNow Financial Compliance Portal',
          reviewRole: 'Certified AML Compliance Officer',
          slaMinutes: 15,
          diagnosticDetails: `• Initiator: Commercial Teller #4029, Branch #108 (New York Financial District)
• Originator: Acme Corp Holdings LLC (Account #8829-4102-99)
• Beneficiary: Apex Global Trading Ltd (IBAN: CH93-0000-0000-0000-0000-0)
• Amount: $250,000.00 USD (Threshold: > $10,000.00 USD)
• AML Graph Screening: Flagged by Neo4j — 3-hop connection to sanctioned entity watchlist.`,
          humanActions: [
            { name: 'Approve Wire', action: 'approve', impact: 'Releases funds for immediate Fedwire clearance.' },
            { name: 'Freeze & File SAR', action: 'reject', impact: 'Blocks transaction and files Suspicious Activity Report.' }
          ],
          auditProvenance: 'FIDO2 WebAuthn biometric signature stamped into immutable transaction ledger.'
        }
      ]
    };
  }

  // ── 6. Healthcare Clinical Integration Architecture Model ────────────────────

  private static buildHealthcareModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'MuleSoft API-led integration orchestrating Salesforce referral intake, EMR Sunrise clinical visit validation via CHIB, and automated xAmplify document consolidation with a dedicated Human-in-the-Loop Clinician Exception Gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Client / Ingress' },
          { id: 'integration', label: 'Integration Cloud' },
          { id: 'core', label: 'Core EHR' },
          { id: 'governance', label: 'Human Governance' }
        ],
        systems: [
          { id: 'Clinician', label: 'Referring Clinician', category: 'actor', zone: 'client', icon: '👤', role: 'Clinical User / Intake Agent', description: 'Initiates referral intake and handles exception reconciliations.', technologies: ['Salesforce UI', 'Health Cloud Portal'], containerCount: 2 },
          { id: 'Salesforce', label: 'Salesforce Health Cloud', category: 'saas', zone: 'client', icon: '☁️', role: 'Referral System of Record', description: 'Manages patient referral records, file attachments, and status transitions.', technologies: ['Apex REST', 'Platform Events', 'OAuth2', 'S3 File Store'], containerCount: 4 },
          { id: 'MuleSoft', label: 'MuleSoft Anypoint Platform', category: 'gateway', zone: 'integration', icon: '⚡', role: 'API-Led Integration Core', description: '3-tier API-led orchestrator executing visit validation and document flows.', technologies: ['CloudHub 2.0', 'DataWeave 2.0', 'Experience API', 'Process API'], containerCount: 5 },
          { id: 'CHIB', label: 'CHIB Integration Broker', category: 'gateway', zone: 'integration', icon: '🔄', role: 'Clinical Message Hub', description: 'Translates enterprise JSON payloads to clinical HL7/FHIR message protocols.', technologies: ['HL7 v2.5.1', 'FHIR R4', 'mTLS Gateway'], containerCount: 2 },
          { id: 'EMR', label: 'EMR Sunrise Clinical Core', category: 'ehr', zone: 'core', icon: '🏥', role: 'Enterprise Clinical Registry', description: 'Validates Visit ID, MRN, and SAUHI against official inpatient encounters.', technologies: ['Allscripts Sunrise', 'MS SQL / Oracle DB', 'MPI Engine'], containerCount: 3 },
          { id: 'xAmplify', label: 'xAmplify Document Engine', category: 'saas', zone: 'thirdparty', icon: '📄', role: 'Document Consolidation Core', description: 'Merges multi-format referral documents into a single canonical clinical PDF.', technologies: ['xAmplify REST API', 'PDF Linearization', 'OCR Engine'], containerCount: 2 },
          { id: 'HITL_Gate', label: 'Clinician Exception Review Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Human-in-the-Loop Decision Gate', description: 'Intercepts validation mismatches; enables manual clinical override or referral rejection.', technologies: ['Task Queue', 'Dual-Key Approval', 'Tamper-Evident Audit'], containerCount: 1 }
        ],
        connections: [
          { from: 'Clinician', to: 'Salesforce', label: 'Create Referral', protocol: 'Web UI', order: 1 },
          { from: 'Salesforce', to: 'MuleSoft', label: 'POST /validate (Visit, MRN, SAUHI)', protocol: 'HTTPS / REST (mTLS)', order: 2 },
          { from: 'MuleSoft', to: 'Salesforce', label: 'Immediate Ack: Request Received', protocol: 'JSON (Status Update)', order: 3 },
          { from: 'MuleSoft', to: 'CHIB', label: 'Validate Entry in EMR', protocol: 'HTTPS / JSON Payload', order: 4 },
          { from: 'CHIB', to: 'EMR', label: 'Query Encounter & Identity', protocol: 'HL7 v2.5 / FHIR R4', order: 5 },
          { from: 'EMR', to: 'CHIB', label: 'Ack Success (All Identifiers Match)', protocol: 'HL7 ACK / 200 OK', order: 6 },
          { from: 'EMR', to: 'HITL_Gate', label: 'On Validation Failure: Route to Clinician', protocol: 'Exception Event', isException: true, isHitl: true, order: 7 },
          { from: 'HITL_Gate', to: 'Salesforce', label: 'Signed Manual Override / Rejection', protocol: 'Task Resolution', isHitl: true, order: 8 },
          { from: 'MuleSoft', to: 'Salesforce', label: 'Fetch Referral Attachments', protocol: 'REST File Stream', order: 9 },
          { from: 'MuleSoft', to: 'xAmplify', label: 'Send Docs for Consolidation', protocol: 'Multipart Binary Stream', order: 10 },
          { from: 'xAmplify', to: 'MuleSoft', label: 'Return Merged PDF File', protocol: 'Binary Stream', order: 11 },
          { from: 'MuleSoft', to: 'Salesforce', label: 'Write Consolidated Doc (Process 2 Ready)', protocol: 'Salesforce ContentVersion', order: 12 }
        ]
      },
      level2: {
        Clinician: {
          parentSystem: {
            id: 'Clinician',
            label: 'Referring Clinician',
            category: 'actor',
            zone: 'client',
            icon: '👤',
            role: 'Clinical User / Intake Agent',
            description: 'Healthcare provider initiating patient referrals and reviewing clinical exceptions.',
            technologies: ['Salesforce Health Cloud UI', 'Lightning Web Components'],
            containerCount: 2
          },
          containers: [
            { id: 'Clinician_Portal', parentSystemId: 'Clinician', label: 'Provider Intake Portal', type: 'api', endpoint: 'https://healthcloud.hospital.org/referrals', technology: 'Lightning Web Components (LWC) / SSO', description: 'Web interface for submitting patient referrals with Visit ID, MRN, and attached medical files.', componentCount: 1 },
            { id: 'Clinician_TaskView', parentSystemId: 'Clinician', label: 'Clinical Exception Inbox', type: 'gate', endpoint: 'healthcloud://clinical-exceptions', technology: 'Salesforce Omni-Channel Workspaces', description: 'Dedicated review interface displaying validation discrepancies with 1-click override or reject actions.', componentCount: 1 }
          ],
          connections: [
            { from: 'Clinician_Portal', to: 'Clinician_TaskView', label: 'Surfaces Rejection / Exception', protocol: 'In-App Notification', order: 1 }
          ]
        },
        MuleSoft: {
          parentSystem: {
            id: 'MuleSoft',
            label: 'MuleSoft Anypoint Platform',
            category: 'gateway',
            zone: 'integration',
            icon: '⚡',
            role: 'API-Led Integration Core',
            description: '3-Tier API architecture separating Experience, Process, and System concerns.',
            technologies: ['CloudHub 2.0', 'DataWeave 2.0', 'ObjectStore v2'],
            containerCount: 5
          },
          containers: [
            { id: 'Mule_Exp', parentSystemId: 'MuleSoft', label: 'Mule Experience API', type: 'api', endpoint: '/api/v1/referrals/validate', technology: 'HTTP Listener, OAuth2 Token Validation, Policy Gate', description: 'Exposes secure ingress, assigns Correlation ID, and delivers immediate 200 Ack.', componentCount: 2 },
            { id: 'Mule_Proc', parentSystemId: 'MuleSoft', label: 'Mule Process API (Visit Orchestrator)', type: 'orchestrator', endpoint: 'internal://visit-validation-process', technology: 'DataWeave 2.0, Flow Orchestration, State Machine', description: 'Coordinates EMR query, evaluates match criteria, and orchestrates doc consolidation.', componentCount: 3 },
            { id: 'Mule_Sys_CHIB', parentSystemId: 'MuleSoft', label: 'CHIB System Connector API', type: 'adapter', endpoint: 'https://chib.internal/api/v2/query', technology: 'HTTP Requestor with mTLS & Circuit Breaker', description: 'Handles connection pooling, payload transformation, and retry policy to CHIB.', componentCount: 2 },
            { id: 'Mule_Store', parentSystemId: 'MuleSoft', label: 'Object Store / In-Flight State Cache', type: 'store', technology: 'Mule ObjectStore v2 (TTL 4h, AES-256)', description: 'Maintains correlation state, idempotency keys, and document tracking tokens.', componentCount: 1 },
            { id: 'Mule_Sys_Sunrise', parentSystemId: 'MuleSoft', label: 'Sunrise Document System API', type: 'adapter', endpoint: 'https://sunrise-api.internal/v1/documents', technology: 'REST / HL7 MDM_T02 Provider', description: 'Uploads consolidated PDF against validated Visit ID with metadata, author, and timestamp.', componentCount: 2 }
          ],
          connections: [
            { from: 'Mule_Exp', to: 'Mule_Proc', label: 'Delegate Process (Async Flow)', protocol: 'VM Queue / Direct', order: 1 },
            { from: 'Mule_Proc', to: 'Mule_Store', label: 'Store Correlation Context', protocol: 'Binary Serialization', order: 2 },
            { from: 'Mule_Proc', to: 'Mule_Sys_CHIB', label: 'Execute EMR Validation', protocol: 'Internal REST', order: 3 },
            { from: 'Mule_Proc', to: 'Mule_Sys_Sunrise', label: 'Upload Consolidated Doc', protocol: 'HTTPS / REST', order: 4 }
          ]
        },
        Salesforce: {
          parentSystem: {
            id: 'Salesforce',
            label: 'Salesforce Health Cloud',
            category: 'saas',
            zone: 'client',
            icon: '☁️',
            role: 'Referral System of Record',
            description: 'Health Cloud clinical intake and case management ecosystem.',
            technologies: ['Apex', 'Platform Events', 'ContentVersion'],
            containerCount: 4
          },
          containers: [
            { id: 'SF_Intake', parentSystemId: 'Salesforce', label: 'Referral Intake Controller', type: 'api', endpoint: 'Referral__c Custom Object', technology: 'Apex REST / Lightning Web Component', description: 'Captures Visit ID, MRN, SAUHI, and triggers outbound validation callout.', componentCount: 2 },
            { id: 'SF_DocApi', parentSystemId: 'Salesforce', label: 'Salesforce Document System API', type: 'api', endpoint: '/services/data/v59.0/sobjects/ContentVersion', technology: 'Salesforce REST API / ContentDocumentLink', description: 'Retrieves referral document attachments and metadata for consolidation in Process 2.', componentCount: 2 },
            { id: 'SF_TaskQueue', parentSystemId: 'Salesforce', label: 'Clinician Exception Task Queue', type: 'gate', endpoint: 'Task / Case Exception View', technology: 'Omni-Channel Routing & SLA Timers', description: 'Surfaces validation discrepancies directly to clinicians for 1-click override.', componentCount: 2 },
            { id: 'SF_FileStore', parentSystemId: 'Salesforce', label: 'ContentVersion File Store', type: 'store', technology: 'Salesforce Files Storage & S3 Vault', description: 'Holds unconsolidated referral attachments and final merged clinical document.', componentCount: 1 }
          ],
          connections: [
            { from: 'SF_Intake', to: 'SF_DocApi', label: 'Query Attachments', protocol: 'SOQL Query', order: 1 },
            { from: 'SF_Intake', to: 'SF_TaskQueue', label: 'Route Exception Task', protocol: 'Platform Event', order: 2 },
            { from: 'SF_DocApi', to: 'SF_FileStore', label: 'Fetch Binary VersionData', protocol: 'Internal Storage Bus', order: 3 }
          ]
        },
        CHIB: {
          parentSystem: {
            id: 'CHIB',
            label: 'CHIB Integration Broker',
            category: 'gateway',
            zone: 'integration',
            icon: '🔄',
            role: 'Clinical Message Hub',
            description: 'Enterprise integration gateway bridging enterprise JSON payloads with hospital clinical HL7/FHIR backends.',
            technologies: ['HL7 v2.5.1', 'FHIR R4', 'mTLS Gateway'],
            containerCount: 2
          },
          containers: [
            { id: 'CHIB_Broker', parentSystemId: 'CHIB', label: 'Clinical Message Broker', type: 'orchestrator', endpoint: 'https://chib.hospital.net/inbound', technology: 'Apache Camel / Mule Clinical Engine', description: 'Transforms inbound JSON visit validation requests into HL7 v2.5.1 QBP_Q21 encounter queries.', componentCount: 2 },
            { id: 'CHIB_HL7Adapter', parentSystemId: 'CHIB', label: 'HL7 / FHIR mTLS Gateway', type: 'adapter', endpoint: 'mllp://chib-mllp.internal:2575', technology: 'MLLP Protocol Adapter with Mutual TLS', description: 'Maintains encrypted socket sessions with EMR Sunrise clinical core.', componentCount: 2 }
          ],
          connections: [
            { from: 'CHIB_Broker', to: 'CHIB_HL7Adapter', label: 'Forward QBP Query', protocol: 'MLLP Socket', order: 1 }
          ]
        },
        EMR: {
          parentSystem: {
            id: 'EMR',
            label: 'EMR Sunrise Clinical Core',
            category: 'ehr',
            zone: 'core',
            icon: '🏥',
            role: 'Enterprise Clinical Registry',
            description: 'Allscripts Sunrise Clinical EHR system with patient encounter database.',
            technologies: ['Sunrise Platform', 'HL7 Adapter', 'Master Patient Index'],
            containerCount: 3
          },
          containers: [
            { id: 'EMR_Adapter', parentSystemId: 'EMR', label: 'Sunrise HL7/FHIR Engine', type: 'adapter', technology: 'HL7 v2.5.1 MLLP & FHIR REST Provider', description: 'Ingests clinical queries and translates identifier verification requests.', componentCount: 2 },
            { id: 'EMR_MPI', parentSystemId: 'EMR', label: 'Master Patient Index (MPI) & Visit DB', type: 'store', technology: 'Relational Encounters Database (MSSQL)', description: 'Deterministic store verifying exact match of Visit ID, MRN, and SAUHI.', componentCount: 2 },
            { id: 'EMR_DocService', parentSystemId: 'EMR', label: 'Sunrise Clinical Document Ingest', type: 'api', endpoint: 'https://sunrise-ehr.internal/api/docs', technology: 'HL7 MDM_T02 Document Management Service', description: 'Attaches certified consolidated PDF documents against verified clinical encounter records.', componentCount: 2 }
          ],
          connections: [
            { from: 'EMR_Adapter', to: 'EMR_MPI', label: 'Query Encounter Record', protocol: 'SQL / Stored Proc', order: 1 },
            { from: 'EMR_DocService', to: 'EMR_MPI', label: 'Index Attached File', protocol: 'Database Transaction', order: 2 }
          ]
        },
        xAmplify: {
          parentSystem: {
            id: 'xAmplify',
            label: 'xAmplify Document Engine',
            category: 'saas',
            zone: 'thirdparty',
            icon: '📄',
            role: 'Document Consolidation Core',
            description: 'Automated clinical document transformation and multi-page PDF/A linearization platform.',
            technologies: ['xAmplify REST API', 'PDF Linearization', 'OCR Engine'],
            containerCount: 2
          },
          containers: [
            { id: 'xAmplify_Ingress', parentSystemId: 'xAmplify', label: 'Document Intake REST Gateway', type: 'api', endpoint: 'https://api.xamplify.io/v2/merge', technology: 'REST API with Multipart Stream Handling', description: 'Accepts raw referral document streams (PDF, TIFF, JPEG) and validates size limits.', componentCount: 2 },
            { id: 'xAmplify_PdfEngine', parentSystemId: 'xAmplify', label: 'PDF/A Consolidation & OCR Engine', type: 'orchestrator', endpoint: 'internal://xamplify-linearizer', technology: 'Linearized PDF/A-1b Compiler & Tesseract OCR', description: 'Merges multi-format referral documents into a single searchable canonical PDF with checksum validation.', componentCount: 2 }
          ],
          connections: [
            { from: 'xAmplify_Ingress', to: 'xAmplify_PdfEngine', label: 'Submit Stream for Merge', protocol: 'Binary Memory Pipe', order: 1 }
          ]
        }
      },
      level3: {
        Mule_Exp: {
          parentContainer: {
            id: 'Mule_Exp',
            parentSystemId: 'MuleSoft',
            label: 'Mule Experience API',
            type: 'api',
            technology: 'HTTP Listener, OAuth2 Token Validation',
            description: 'Exposes secure ingress, assigns Correlation ID, and delivers immediate 200 Ack.',
            componentCount: 2
          },
          components: [
            {
              id: 'Mule_Exp_Listener',
              parentContainerId: 'Mule_Exp',
              label: 'Referral Ingress Listener',
              role: 'API Gateway Ingress',
              description: 'Authenticates incoming Salesforce HTTPS request via mTLS and assigns global Correlation ID.',
              slaMs: 120,
              contracts: [
                { field: 'Visit_ID', type: 'String (Alphanumeric 12)', required: true, source: 'Salesforce Referral', destination: 'MuleSoft Ingress', description: 'Patient inpatient/outpatient hospital encounter ID.', validationRule: 'Matches ^[A-Z0-9]{8,12}$' },
                { field: 'MRN', type: 'String (Medical Record Number)', required: true, source: 'Salesforce Patient Record', destination: 'MuleSoft Ingress', description: 'Patient Medical Record Number.' },
                { field: 'SAUHI', type: 'String (Hospital Unit ID)', required: true, source: 'Salesforce Referral', destination: 'MuleSoft Ingress', description: 'Specialist Ambulatory Unit Hospital Identifier.' },
                { field: 'Referral_ID', type: 'String (SF ID)', required: true, source: 'Salesforce Referral', destination: 'MuleSoft Ingress', description: 'Salesforce unique record identifier for correlation.' }
              ]
            },
            {
              id: 'Mule_Exp_AckGenerator',
              parentContainerId: 'Mule_Exp',
              label: 'Immediate 200 Ack Producer',
              role: 'Non-Blocking Acknowledgment',
              description: 'Returns instant "Request Received" status to Salesforce so UI is never blocked.',
              slaMs: 50,
              contracts: [
                { field: 'Status', type: 'String', required: true, source: 'MuleSoft Experience API', destination: 'Salesforce Health Cloud', description: 'Initial referral acknowledgment status ("Request Received").' },
                { field: 'Correlation_ID', type: 'UUIDv4', required: true, source: 'MuleSoft Experience API', destination: 'Salesforce Health Cloud', description: 'Distributed tracing UUID propagated across all logs and downstream calls.' }
              ]
            }
          ]
        },
        Mule_Proc: {
          parentContainer: {
            id: 'Mule_Proc',
            parentSystemId: 'MuleSoft',
            label: 'Mule Process API (Visit Orchestrator)',
            type: 'orchestrator',
            technology: 'DataWeave 2.0 Flow',
            description: 'Validates visit in EMR Sunrise and triggers document consolidation upon success.',
            componentCount: 3
          },
          components: [
            {
              id: 'VisitValidatorStep',
              parentContainerId: 'Mule_Proc',
              label: 'Visit Validation Evaluator',
              role: 'Deterministic Rule Engine',
              description: 'Ensures Visit ID, MRN, and SAUHI exactly match official EMR records.',
              slaMs: 450,
              retryPolicy: 'Max 3 retries (200ms exponential backoff)',
              contracts: [
                { field: 'Visit_ID', type: 'String (Alphanumeric 12)', required: true, source: 'Salesforce Referral', destination: 'EMR Sunrise Encounter', description: 'Unique hospital clinical visit identifier.', validationRule: 'Matches ^[A-Z0-9]{8,12}$' },
                { field: 'MRN', type: 'String (Medical Record Number)', required: true, source: 'Salesforce Patient Record', destination: 'EMR Sunrise MPI', description: 'Patient Medical Record Number. Must match patient identity on file.', validationRule: 'Non-empty alphanumeric string' },
                { field: 'SAUHI', type: 'String (Hospital Unit ID)', required: true, source: 'Salesforce Referral', destination: 'EMR Sunrise Ward Index', description: 'Specialist Ambulatory Unit Hospital Identifier.', validationRule: 'Valid hospital unit code' },
                { field: 'Correlation_ID', type: 'UUIDv4 String', required: true, source: 'Mule Experience API', destination: 'All Downstream Services', description: 'Distributed tracing header X-Correlation-ID.', validationRule: 'RFC 4122 UUID' }
              ]
            },
            {
              id: 'DocConsolidationStep',
              parentContainerId: 'Mule_Proc',
              label: 'Document Consolidation Coordinator',
              role: 'Binary Document Stream Pipeline',
              description: 'Fetches raw PDF/TIFF files from Salesforce and streams to xAmplify for consolidation.',
              slaMs: 1800,
              retryPolicy: 'Max 2 retries (1000ms delay)',
              contracts: [
                { field: 'Referral_ID', type: 'String (SF ID)', required: true, source: 'Salesforce Referral', destination: 'MuleSoft File Fetcher', description: 'Salesforce object record ID for attachment retrieval.' },
                { field: 'Consolidated_File', type: 'Binary Stream (PDF)', required: true, source: 'xAmplify Engine', destination: 'Salesforce ContentVersion', description: 'Single merged linear clinical PDF ready for Process 2.' }
              ]
            }
          ]
        },
        Mule_Sys_CHIB: {
          parentContainer: {
            id: 'Mule_Sys_CHIB',
            parentSystemId: 'MuleSoft',
            label: 'CHIB System Connector API',
            type: 'adapter',
            technology: 'HTTP Requestor with mTLS & Circuit Breaker',
            description: 'Handles connection pooling, payload transformation, and retry policy to CHIB.',
            componentCount: 2
          },
          components: [
            {
              id: 'CHIB_QueryWorker',
              parentContainerId: 'Mule_Sys_CHIB',
              label: 'CHIB Query Dispatcher',
              role: 'mTLS Client Adapter',
              description: 'Dispatches JSON visit validation payload to CHIB broker over mutual TLS 1.3.',
              slaMs: 800,
              retryPolicy: 'Circuit breaker trips after 5 consecutive timeouts (open 30s)',
              contracts: [
                { field: 'Visit_ID', type: 'String', required: true, source: 'Mule Process API', destination: 'CHIB Broker', description: 'Hospital encounter ID.' },
                { field: 'MRN', type: 'String', required: true, source: 'Mule Process API', destination: 'CHIB Broker', description: 'Medical Record Number.' },
                { field: 'Client_Cert_Thumbprint', type: 'SHA-256', required: true, source: 'MuleSoft Keystore', destination: 'CHIB Ingress Gateway', description: 'Client mutual TLS certificate thumbprint.' }
              ]
            }
          ]
        },
        Mule_Store: {
          parentContainer: {
            id: 'Mule_Store',
            parentSystemId: 'MuleSoft',
            label: 'Object Store / In-Flight State Cache',
            type: 'store',
            technology: 'Mule ObjectStore v2 (TTL 4h, AES-256)',
            description: 'Maintains correlation state, idempotency keys, and document tracking tokens.',
            componentCount: 1
          },
          components: [
            {
              id: 'Mule_Store_Cache',
              parentContainerId: 'Mule_Store',
              label: 'Correlation State Store',
              role: 'Idempotency & State Cache',
              description: 'Persists in-flight referral IDs and visit keys to prevent duplicate processing.',
              slaMs: 25,
              contracts: [
                { field: 'Correlation_Key', type: 'String (Referral_ID + Visit_ID)', required: true, source: 'Mule Process API', destination: 'ObjectStore v2', description: 'Compound deduplication cache key.' },
                { field: 'Visit_Status', type: 'String', required: true, source: 'Mule Process API', destination: 'ObjectStore v2', description: 'Current validation state machine status.' }
              ]
            }
          ]
        },
        Mule_Sys_Sunrise: {
          parentContainer: {
            id: 'Mule_Sys_Sunrise',
            parentSystemId: 'MuleSoft',
            label: 'Sunrise Document System API',
            type: 'adapter',
            technology: 'REST / HL7 MDM_T02 Provider',
            description: 'Uploads consolidated PDF against validated Visit ID with metadata, author, and timestamp.',
            componentCount: 2
          },
          components: [
            {
              id: 'Sunrise_Uploader',
              parentContainerId: 'Mule_Sys_Sunrise',
              label: 'Encounter Document Ingest Adapter',
              role: 'Binary Document Ingestion',
              description: 'Streams verified consolidated PDF/A directly into Allscripts Sunrise EHR against the patient encounter.',
              slaMs: 1500,
              contracts: [
                { field: 'Validated_Visit_ID', type: 'String (Alphanumeric 12)', required: true, source: 'Mule Process API', destination: 'EMR Sunrise Core', description: 'Validated inpatient visit encounter ID.' },
                { field: 'Document_Type', type: 'String (e.g., CLINICAL_REFERRAL)', required: true, source: 'Salesforce Metadata', destination: 'EMR Sunrise Document Catalog', description: 'Encounter document taxonomy code.' },
                { field: 'Author_ID', type: 'String (Provider NPI)', required: true, source: 'Salesforce Referral User', destination: 'EMR Sunrise Document Registry', description: 'Referring clinician identifier.' },
                { field: 'Binary_Payload', type: 'PDF/A Binary Stream', required: true, source: 'xAmplify Engine', destination: 'EMR Sunrise File Store', description: 'Consolidated clinical document payload.' }
              ]
            }
          ]
        },
        SF_Intake: {
          parentContainer: {
            id: 'SF_Intake',
            parentSystemId: 'Salesforce',
            label: 'Referral Intake Controller',
            type: 'api',
            technology: 'Apex REST / Lightning Web Component',
            description: 'Captures Visit ID, MRN, SAUHI, and triggers outbound validation callout.',
            componentCount: 2
          },
          components: [
            {
              id: 'SF_Intake_Trigger',
              parentContainerId: 'SF_Intake',
              label: 'Referral Creation Trigger',
              role: 'Apex Trigger & REST Dispatcher',
              description: 'Intercepts new Referral__c records and executes asynchronous HTTP callout to Mule Experience API.',
              slaMs: 200,
              contracts: [
                { field: 'Id', type: 'Id (Salesforce 18-char)', required: true, source: 'Salesforce Database', destination: 'Apex Callout', description: 'Referral record unique identifier.' },
                { field: 'Visit_ID__c', type: 'String(12)', required: true, source: 'Clinician Intake Form', destination: 'MuleSoft Exp API', description: 'Hospital encounter ID.' },
                { field: 'Patient_MRN__c', type: 'String(20)', required: true, source: 'Patient Master Index', destination: 'MuleSoft Exp API', description: 'Medical Record Number.' }
              ]
            }
          ]
        },
        SF_DocApi: {
          parentContainer: {
            id: 'SF_DocApi',
            parentSystemId: 'Salesforce',
            label: 'Salesforce Document System API',
            type: 'api',
            technology: 'Salesforce REST API / ContentDocumentLink',
            description: 'Retrieves referral document attachments and metadata for consolidation in Process 2.',
            componentCount: 2
          },
          components: [
            {
              id: 'SF_Doc_Query',
              parentContainerId: 'SF_DocApi',
              label: 'ContentVersion SOQL Provider',
              role: 'Attachment Data Provider',
              description: 'Queries and returns all document attachments linked to Referral__c record.',
              slaMs: 350,
              contracts: [
                { field: 'ContentDocumentId', type: 'Id', required: true, source: 'Salesforce SOQL', destination: 'MuleSoft Process API', description: 'Parent document container identifier.' },
                { field: 'VersionData', type: 'Base64 / Binary Stream', required: true, source: 'Salesforce Files', destination: 'xAmplify Stream Ingest', description: 'Raw document bytes.' },
                { field: 'FileType', type: 'String (PDF/TIFF/JPEG)', required: true, source: 'ContentVersion Record', destination: 'xAmplify Validator', description: 'MIME file extension.' }
              ]
            }
          ]
        },
        CHIB_Broker: {
          parentContainer: {
            id: 'CHIB_Broker',
            parentSystemId: 'CHIB',
            label: 'Clinical Message Broker',
            type: 'orchestrator',
            technology: 'Apache Camel / Mule Clinical Engine',
            description: 'Transforms inbound JSON visit validation requests into HL7 v2.5.1 QBP_Q21 encounter queries.',
            componentCount: 2
          },
          components: [
            {
              id: 'CHIB_HL7Translator',
              parentContainerId: 'CHIB_Broker',
              label: 'JSON to HL7 v2.5.1 Transformer',
              role: 'Message Protocol Translation',
              description: 'Generates standard QBP^Q21 encounter query message with PID and PV1 segments.',
              slaMs: 180,
              contracts: [
                { field: 'MSH_Control_ID', type: 'String (Alphanumeric 20)', required: true, source: 'CHIB Broker', destination: 'EMR Sunrise Adapter', description: 'Unique HL7 message control ID.' },
                { field: 'PID_3_MRN', type: 'String', required: true, source: 'JSON MRN field', destination: 'EMR Sunrise MPI', description: 'Patient identifier in PID-3.' },
                { field: 'PV1_19_Visit_Number', type: 'String', required: true, source: 'JSON Visit_ID field', destination: 'EMR Sunrise Encounters', description: 'Hospital encounter visit number in PV1-19.' }
              ]
            }
          ]
        },
        EMR_Adapter: {
          parentContainer: {
            id: 'EMR_Adapter',
            parentSystemId: 'EMR',
            label: 'Sunrise HL7/FHIR Engine',
            type: 'adapter',
            technology: 'HL7 v2.5.1 MLLP & FHIR REST Provider',
            description: 'Ingests clinical queries and translates identifier verification requests.',
            componentCount: 2
          },
          components: [
            {
              id: 'EMR_EncounterMatcher',
              parentContainerId: 'EMR_Adapter',
              label: 'Encounter Reconciliation Worker',
              role: 'Database Query & Match Engine',
              description: 'Queries Sunrise Master Patient Index to verify Visit ID, MRN, and SAUHI all point to an active valid encounter.',
              slaMs: 300,
              contracts: [
                { field: 'Match_Result', type: 'Boolean', required: true, source: 'EMR Sunrise Database', destination: 'CHIB Broker', description: 'True only if Visit ID, MRN, and SAUHI all match.' },
                { field: 'Encounter_Status', type: 'String (ADMITTED / DISCHARGED / PENDING)', required: true, source: 'EMR Sunrise Database', destination: 'MuleSoft Process API', description: 'Current encounter status.' },
                { field: 'Ack_Code', type: 'String (AA / AE / AR)', required: true, source: 'EMR Sunrise Adapter', destination: 'CHIB Broker', description: 'HL7 MSA-1 acknowledgment code.' }
              ]
            }
          ]
        },
        xAmplify_PdfEngine: {
          parentContainer: {
            id: 'xAmplify_PdfEngine',
            parentSystemId: 'xAmplify',
            label: 'PDF/A Consolidation & OCR Engine',
            type: 'orchestrator',
            technology: 'Linearized PDF/A-1b Compiler & Tesseract OCR',
            description: 'Merges multi-format referral documents into a single searchable canonical PDF with checksum validation.',
            componentCount: 2
          },
          components: [
            {
              id: 'xAmplify_Linearizer',
              parentContainerId: 'xAmplify_PdfEngine',
              label: 'PDF/A Merger & Linearizer',
              role: 'Document Compiler & Quality Gate',
              description: 'Combines multiple attachments into one continuous ISO 19005-1 PDF/A document with optical character recognition.',
              slaMs: 2500,
              contracts: [
                { field: 'Page_Count', type: 'Integer (> 0)', required: true, source: 'xAmplify Engine', destination: 'MuleSoft Process API', description: 'Total page count of merged document.' },
                { field: 'SHA256_Checksum', type: 'Hex String (64 chars)', required: true, source: 'xAmplify Engine', destination: 'MuleSoft Process API', description: 'Cryptographic hash verifying file integrity.' },
                { field: 'PDF_A_Compliant', type: 'Boolean (true)', required: true, source: 'xAmplify Engine', destination: 'EMR Sunrise File Store', description: 'Guarantees archival clinical standard compliance.' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_Clinician_Exception',
          systemId: 'Salesforce',
          title: 'Clinical Identifier Mismatch & Review Gate',
          triggerCondition: 'EMR Sunrise returns mismatch on Visit ID, MRN, or SAUHI, or patient identity conflict is detected.',
          reviewSurface: 'Salesforce Health Cloud Clinical Task Queue & Exception Portal',
          reviewRole: 'Referring Clinician / Medical Records Specialist',
          slaMinutes: 30,
          diagnosticDetails: `• Salesforce Inbound: Referral ID #REF-90412, MRN: 49281, Status: Pending
• EMR Sunrise Query: MRN 49281, Encounter ID #ENC-1092, Status: Discharged (3 days ago)
• Policy Rule: Discharged encounters cannot receive automated ambulatory referral attachment without physician review.`,
          humanActions: [
            { name: 'Verify & Manual Override', action: 'override', impact: 'Injects cryptographically signed clinical authorization token; forces document consolidation to proceed.' },
            { name: 'Reject Referral', action: 'reject', impact: 'Halts process; updates Salesforce status to "Referral Rejected - Identifier Mismatch" and notifies provider.' },
            { name: 'Escalate to Senior Supervisor', action: 'escalate', impact: 'Transfers case to Head of Medical Administration after 30-minute SLA expiration.' }
          ],
          auditProvenance: 'Captures Clinician Staff ID, timestamp, IP, reason code, and SHA-256 signature in immutable audit log.'
        }
      ]
    };
  }

  // ── 7. E-Commerce Microservices Architecture Model ───────────────────────────

  private static buildEcommerceModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Scalable microservices checkout topology with Cloudflare edge, FastAPI order service, RabbitMQ queues, DynamoDB, Stripe, and a Fraud Supervisor HITL review gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Edge & Ingress' },
          { id: 'integration', label: 'Microservices & Queues' },
          { id: 'core', label: 'Databases & Payments' },
          { id: 'governance', label: 'Fraud Operations' }
        ],
        systems: [
          { id: 'Shopper', label: 'Online Shopper', category: 'actor', zone: 'client', icon: '👤', role: 'End User', description: 'Submits order at checkout.', technologies: ['React Web', 'Mobile App'], containerCount: 0 },
          { id: 'Cloudflare', label: 'Cloudflare Edge CDN & WAF', category: 'gateway', zone: 'client', icon: '🛡️', role: 'Edge Security', description: 'DDoS mitigation and bot defense.', technologies: ['Cloudflare WAF', 'Edge Workers'], containerCount: 1 },
          { id: 'OrderAPI', label: 'FastAPI Order Service', category: 'service', zone: 'integration', icon: '⚡', role: 'Checkout Microservice', description: 'Validates cart, stock, and pricing.', technologies: ['Python FastAPI', 'Pydantic'], containerCount: 2 },
          { id: 'RabbitMQ', label: 'RabbitMQ Message Broker', category: 'queue', zone: 'integration', icon: '📬', role: 'Async Queue', description: 'Decouples payment from fulfillment.', technologies: ['RabbitMQ', 'AMQP 0-9-1'], containerCount: 1 },
          { id: 'DynamoDB', label: 'Amazon DynamoDB', category: 'database', zone: 'core', icon: '🗄️', role: 'Order Database', description: 'Single-digit millisecond latency state store.', technologies: ['DynamoDB', 'AWS KMS'], containerCount: 1 },
          { id: 'Stripe', label: 'Stripe Payment Gateway', category: 'service', zone: 'thirdparty', icon: '💳', role: 'PCI-DSS Payment Processor', description: 'Captures credit card authorization.', technologies: ['Stripe API v2024'], containerCount: 1 },
          { id: 'HITL_Gate', label: 'Fraud Operations Review Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Human-in-the-Loop Gate', description: 'Reviews high-risk billing mismatches or stolen card signals.', technologies: ['Internal Admin Portal'], containerCount: 1 }
        ],
        connections: [
          { from: 'Shopper', to: 'Cloudflare', label: 'Submit Checkout', protocol: 'HTTPS', order: 1 },
          { from: 'Cloudflare', to: 'OrderAPI', label: 'Forward Validated Request', protocol: 'mTLS', order: 2 },
          { from: 'OrderAPI', to: 'DynamoDB', label: 'Write Order (Status: Pending)', protocol: 'AWS SDK (HTTPS)', order: 3 },
          { from: 'OrderAPI', to: 'Stripe', label: 'Charge Customer Card', protocol: 'REST / TLS 1.3', order: 4 },
          { from: 'OrderAPI', to: 'HITL_Gate', label: 'On High Fraud Score: Escalate to Fraud Ops', protocol: 'Webhook Event', isHitl: true, isException: true, order: 5 },
          { from: 'OrderAPI', to: 'RabbitMQ', label: 'Publish order.confirmed Event', protocol: 'AMQP', order: 6 }
        ]
      },
      level2: {
        OrderAPI: {
          parentSystem: {
            id: 'OrderAPI',
            label: 'FastAPI Order Service',
            category: 'service',
            zone: 'integration',
            icon: '⚡',
            role: 'Checkout Microservice',
            description: 'Order management microservice validating shopping cart items.',
            technologies: ['FastAPI', 'Pydantic v2', 'Uvicorn'],
            containerCount: 2
          },
          containers: [
            { id: 'Order_Controller', parentSystemId: 'OrderAPI', label: 'Order REST Controller', type: 'api', technology: 'FastAPI Router', description: 'Processes order submission payloads and handles idempotency keys.', componentCount: 2 },
            { id: 'Inventory_Worker', parentSystemId: 'OrderAPI', label: 'Inventory Reservation Worker', type: 'adapter', technology: 'Redis Distributed Lock', description: 'Locks warehouse inventory for 15 minutes during payment.', componentCount: 1 }
          ],
          connections: [
            { from: 'Order_Controller', to: 'Inventory_Worker', label: 'Reserve SKU Stock', protocol: 'Redis TCP', order: 1 }
          ]
        }
      },
      level3: {
        OrderAPI: {
          parentContainer: {
            id: 'Order_Controller',
            parentSystemId: 'OrderAPI',
            label: 'Order REST Controller',
            type: 'api',
            technology: 'FastAPI Router',
            description: 'Component validating order contracts.',
            componentCount: 1
          },
          components: [
            {
              id: 'OrderSchemaContract',
              parentContainerId: 'Order_Controller',
              label: 'Checkout Contract Validator',
              role: 'Schema Validator',
              description: 'Enforces cart pricing and customer address contracts.',
              slaMs: 40,
              contracts: [
                { field: 'Order_ID', type: 'String (UUIDv4)', required: true, source: 'Web Checkout', destination: 'DynamoDB Table', description: 'Unique order identifier.' },
                { field: 'Total_Amount_Cents', type: 'Integer (Positive)', required: true, source: 'Cart Calculator', destination: 'Stripe Payment', description: 'Final charge amount in currency cents.' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_Fraud',
          systemId: 'OrderAPI',
          title: 'High-Risk Order Fraud Review Gate',
          triggerCondition: 'Radar risk score > 75 or shipping address differs from card country.',
          reviewSurface: 'Fraud Operations Dashboard',
          reviewRole: 'Fraud Risk Analyst',
          slaMinutes: 60,
          diagnosticDetails: `• Order ID: ORD-99214-US (Amount: $1,899.00 USD)
• Risk Flag: Radar Score 82/100 (IP geolocation: Lagos, Nigeria; Shipping address: Miami, FL)
• Card Status: Billing address mismatch; 3 failed CVV attempts in 10 minutes.`,
          humanActions: [
            { name: 'Release Order', action: 'approve', impact: 'Clears order for immediate warehouse packing.' },
            { name: 'Cancel & Refund', action: 'reject', impact: 'Voids authorization and restocks items.' }
          ],
          auditProvenance: 'Analyst ID and resolution code recorded in DynamoDB audit trail.'
        }
      ]
    };
  }

  // ── 8. Industrial IoT & Streaming Analytics Architecture Model ───────────────

  private static buildIotModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Industrial telemetry streaming architecture with MQTT broker, Apache Kafka, Apache Flink real-time anomaly detection, InfluxDB, and an Operator HITL safety gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Industrial Edge' },
          { id: 'integration', label: 'Stream Processing' },
          { id: 'core', label: 'Time-Series DB & Alerting' },
          { id: 'governance', label: 'Plant Safety Operations' }
        ],
        systems: [
          { id: 'EdgeSensors', label: 'Industrial Telematics Sensors', category: 'actor', zone: 'client', icon: '📡', role: 'Edge Devices', description: 'Streams sensor telemetry at 100Hz.', technologies: ['CAN Bus', 'Cellular 5G'], containerCount: 0 },
          { id: 'EMQX', label: 'EMQX MQTT Message Broker', category: 'gateway', zone: 'client', icon: '⚡', role: 'MQTT Ingress Hub', description: 'Handles 1M+ concurrent device connections.', technologies: ['MQTT v5.0', 'TLS 1.3'], containerCount: 2 },
          { id: 'Kafka', label: 'Apache Kafka Telemetry Mesh', category: 'queue', zone: 'integration', icon: '📬', role: 'Stream Buffer', description: 'Buffers sensor metrics with zero data loss.', technologies: ['Kafka 3.6', 'Zstandard'], containerCount: 2 },
          { id: 'Flink', label: 'Apache Flink CEP Engine', category: 'service', zone: 'integration', icon: '🧠', role: 'Complex Event Processing', description: 'Detects real-time anomalies and threshold breaches.', technologies: ['Flink SQL', 'RocksDB'], containerCount: 2 },
          { id: 'InfluxDB', label: 'InfluxDB Time-Series DB', category: 'database', zone: 'core', icon: '📈', role: 'Metrics Storage', description: 'Stores sub-second telemetry for long-term trending.', technologies: ['InfluxDB 3.0', 'Parquet'], containerCount: 1 },
          { id: 'PagerDuty', label: 'PagerDuty Incident Dispatch', category: 'service', zone: 'thirdparty', icon: '🔔', role: 'Emergency Escalator', description: 'Dispatches on-call alerts for critical failures.', technologies: ['REST API v2'], containerCount: 1 },
          { id: 'HITL_Gate', label: 'Control Room Operator Safety Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Human-in-the-Loop Gate', description: 'Authorizes emergency turbine shutdown or bypasses false positives.', technologies: ['SCADA Console', 'Safety Interlock'], containerCount: 1 }
        ],
        connections: [
          { from: 'EdgeSensors', to: 'EMQX', label: 'Publish sensor/metrics', protocol: 'MQTT v5.0', order: 1 },
          { from: 'EMQX', to: 'Kafka', label: 'Forward to Raw Ingestion Topic', protocol: 'Kafka Connector', order: 2 },
          { from: 'Kafka', to: 'Flink', label: 'Stream Window Aggregations (10s)', protocol: 'Kafka Consumer', order: 3 },
          { from: 'Flink', to: 'InfluxDB', label: 'Write Aggregated Metrics', protocol: 'Line Protocol', order: 4 },
          { from: 'Flink', to: 'HITL_Gate', label: 'Critical Anomaly Detected (>180°C)', protocol: 'Emergency Event', isHitl: true, isException: true, order: 5 },
          { from: 'HITL_Gate', to: 'PagerDuty', label: 'Trigger Operator Field Dispatch', protocol: 'Alert Trigger', isHitl: true, order: 6 }
        ]
      },
      level2: {
        Flink: {
          parentSystem: {
            id: 'Flink',
            label: 'Apache Flink CEP Engine',
            category: 'service',
            zone: 'integration',
            icon: '🧠',
            role: 'Complex Event Processing',
            description: 'Low-latency stateful stream computing engine.',
            technologies: ['Apache Flink 1.18', 'Flink SQL', 'RocksDB State Store'],
            containerCount: 2
          },
          containers: [
            { id: 'Flink_JobManager', parentSystemId: 'Flink', label: 'Flink JobManager Coordinator', type: 'orchestrator', technology: 'JVM JobManager', description: 'Manages checkpoints, failure recovery, and stream partitioning.', componentCount: 1 },
            { id: 'Flink_TaskManagers', parentSystemId: 'Flink', label: 'Flink TaskManager Fleet', type: 'adapter', technology: 'Slot Worker Cluster', description: 'Executes sliding-window aggregations and statistical anomaly filters.', componentCount: 1 }
          ],
          connections: [
            { from: 'Flink_JobManager', to: 'Flink_TaskManagers', label: 'Assign Execution Slots', protocol: 'Akka RPC', order: 1 }
          ]
        }
      },
      level3: {
        Flink: {
          parentContainer: {
            id: 'Flink_TaskManagers',
            parentSystemId: 'Flink',
            label: 'Flink TaskManager Fleet',
            type: 'adapter',
            technology: 'Flink Task Slots',
            description: 'Component evaluating sensor metrics against thermal thresholds.',
            componentCount: 1
          },
          components: [
            {
              id: 'ThermalTelemetryStep',
              parentContainerId: 'Flink_TaskManagers',
              label: 'Turbine Vibration & Temp Filter',
              role: 'Stream Threshold Filter',
              description: 'Monitors turbine vibration and heat gradient in 100ms micro-windows.',
              slaMs: 15,
              contracts: [
                { field: 'turbine_id', type: 'String (TURB-XXX)', required: true, source: 'CAN Bus Sensor', destination: 'InfluxDB', description: 'Identifier of physical turbine.' },
                { field: 'temperature_celsius', type: 'Float', required: true, source: 'Thermal Probe', destination: 'Safety Interlock', description: 'Core bearing temperature.', validationRule: 'Readings > 180°C trigger emergency safety gate' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_Safety',
          systemId: 'Flink',
          title: 'Turbine Thermal Anomaly Safety Gate',
          triggerCondition: 'Vibration frequency > 120Hz AND temperature > 180°C across 3 consecutive windows.',
          reviewSurface: 'Control Room SCADA Safety Terminal',
          reviewRole: 'Chief Plant Operations Engineer',
          slaMinutes: 5,
          diagnosticDetails: `• Unit: Steam Turbine Unit #4 (Bay Area Generation Facility)
• Telemetry Reading: Bearing temperature = 192.4°C (Safe limit: < 165°C); Vibration: 142Hz
• Pattern Breached: Sustained thermal excursion across 3 consecutive 10-second tumbling windows.`,
          humanActions: [
            { name: 'Authorize Emergency Shutdown', action: 'override', impact: 'Triggers emergency mechanical trip valve to prevent catastrophic turbine failure.' },
            { name: 'Acknowledge Sensor Glitch', action: 'reject', impact: 'Logs instrument recalibration ticket and bypasses shutdown.' }
          ],
          auditProvenance: 'Hard-wired key switch and digital cryptographic authorization token.'
        }
      ]
    };
  }

  // ── 9. Generic Enterprise AI Core Architecture Model ─────────────────────────

  private static buildGenericEnterpriseModel(title: string, content: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Universal Enterprise AI Application Architecture with deterministic ingress gating, private LLM copilot, transactional database storage, and a mandatory Supervisor HITL approval gate.',
      level1: {
        zones: [
          { id: 'client', label: 'User & Ingress' },
          { id: 'integration', label: 'AI & Orchestration Core' },
          { id: 'core', label: 'Enterprise Data Stores' },
          { id: 'governance', label: 'Human Governance' }
        ],
        systems: [
          { id: 'User', label: 'Business User / Operator', category: 'actor', zone: 'client', icon: '👤', role: 'Business User', description: 'Interacts with application via web/mobile portal.', technologies: ['Web UI', 'REST Client'], containerCount: 0 },
          { id: 'Gateway', label: 'Secure API Gateway', category: 'gateway', zone: 'client', icon: '🛡️', role: 'Ingress & Security Controller', description: 'Enforces OAuth2 mutual TLS and rate-limiting.', technologies: ['Kong / Apigee', 'OAuth2', 'WAF'], containerCount: 2 },
          { id: 'Staging', label: 'Deterministic Rule Engine', category: 'service', zone: 'integration', icon: '⚙️', role: 'Schema & Rule Validator', description: 'Validates input schema and enforces hard invariant constraints.', technologies: ['FastAPI', 'JSON Schema Validator'], containerCount: 2 },
          { id: 'AI', label: 'Evolve AI Copilot (LLM/SLM)', category: 'service', zone: 'integration', icon: '🧠', role: 'Generative Synthesis Engine', description: 'Grounded enterprise copilot generating structured recommendations.', technologies: ['Air-Gapped Private Model', 'RAG Engine'], containerCount: 2 },
          { id: 'DB', label: 'Production Database & Audit Log', category: 'database', zone: 'core', icon: '🗄️', role: 'Transactional System of Record', description: 'Stores committed records with tamper-evident cryptographic receipts.', technologies: ['PostgreSQL', 'Oracle RAC', 'pgvector'], containerCount: 2 },
          { id: 'HITL_Gate', label: 'Supervisor HITL Review Gate', category: 'hitl', zone: 'governance', icon: '🚨', role: 'Human-in-the-Loop Decision Gate', description: 'Mandatory human approval gate for high-impact actions and exceptions.', technologies: ['ServiceNow / Slack', 'Digital Signature'], containerCount: 1 }
        ],
        connections: [
          { from: 'User', to: 'Gateway', label: 'Submit Operation Payload', protocol: 'HTTPS / JSON', order: 1 },
          { from: 'Gateway', to: 'Staging', label: 'Forward Validated Request', protocol: 'mTLS', order: 2 },
          { from: 'Staging', to: 'AI', label: 'Enrich with Grounded Enterprise Embeddings', protocol: 'gRPC / JSON', order: 3 },
          { from: 'AI', to: 'Staging', label: 'Synthesize Structured Proposal (<50ms)', protocol: 'JSON Schema Response', order: 4 },
          { from: 'Staging', to: 'HITL_Gate', label: 'Threshold Action: Route for Human Sign-Off', protocol: 'Approval Event', isHitl: true, isException: true, order: 5 },
          { from: 'HITL_Gate', to: 'Staging', label: '1-Click Cryptographic Authorization', protocol: 'Signed Token', isHitl: true, order: 6 },
          { from: 'Staging', to: 'DB', label: 'Atomic Commit with Tamper-Evident Audit', protocol: 'SQL Transaction (ACID)', order: 7 },
          { from: 'DB', to: 'User', label: 'Delivered Verified Execution Receipt', protocol: 'Push / WebSocket', order: 8 }
        ]
      },
      level2: {
        Staging: {
          parentSystem: {
            id: 'Staging',
            label: 'Deterministic Rule Engine',
            category: 'service',
            zone: 'integration',
            icon: '⚙️',
            role: 'Schema & Rule Validator',
            description: 'Enforces hard business rules before any downstream execution.',
            technologies: ['FastAPI', 'Pydantic'],
            containerCount: 2
          },
          containers: [
            { id: 'Staging_Schema', parentSystemId: 'Staging', label: 'Schema Validator', type: 'api', technology: 'JSON Schema Draft 7', description: 'Validates payload shape, required fields, and boundary constraints.', componentCount: 2 },
            { id: 'Staging_Invariants', parentSystemId: 'Staging', label: 'Hard Invariant Guardrail', type: 'orchestrator', technology: 'Deterministic Rule Set', description: 'Blocks prohibited actions before invoking AI.', componentCount: 2 }
          ],
          connections: []
        }
      },
      level3: {
        Staging: {
          parentContainer: {
            id: 'Staging_Schema',
            parentSystemId: 'Staging',
            label: 'Schema Validator',
            type: 'api',
            technology: 'JSON Schema Draft 7',
            description: 'Validates operational payload structures.',
            componentCount: 1
          },
          components: [
            {
              id: 'PayloadValidator',
              parentContainerId: 'Staging_Schema',
              label: 'Payload Invariant Evaluator',
              role: 'Schema Gate',
              description: 'Validates tenant bounds and operational parameters.',
              slaMs: 25,
              contracts: [
                { field: 'request_id', type: 'UUIDv4', required: true, source: 'Gateway Ingress', destination: 'Audit Store', description: 'Unique request tracking ID.' },
                { field: 'operation_type', type: 'String', required: true, source: 'Client Action', destination: 'Rule Engine', description: 'Requested state mutation command.' }
              ]
            }
          ]
        }
      },
      hitlGates: [
        {
          id: 'HITL_Supervisor',
          systemId: 'Staging',
          title: 'High-Impact Action Approval Gate',
          triggerCondition: 'Action value exceeds autonomous safety threshold or AI confidence < 92%.',
          reviewSurface: 'Enterprise Review Console / Slack Interactive Card',
          reviewRole: 'Authorized Lead Supervisor',
          slaMinutes: 15,
          diagnosticDetails: `• Action Request: Mutate production state across 1,420 user entities
• AI Confidence Score: 87.2% (Threshold: >= 92.0%)
• Safety Policy: Autonomous execution blocked; supervisor sign-off required.`,
          humanActions: [
            { name: 'Approve & Execute', action: 'approve', impact: 'Signs transaction and triggers atomic database commit.' },
            { name: 'Reject with Feedback', action: 'reject', impact: 'Aborts operation and logs correction to model tuning ledger.' }
          ],
          auditProvenance: 'Supervisor identity, timestamp, and SHA-256 HMAC written to immutable audit store.'
        }
      ]
    };
  }
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
