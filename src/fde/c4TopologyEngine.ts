/**
 * fde/c4TopologyEngine.ts — Multi-Level C4 Architectural Topology & Drill-Down Engine
 * 
 * Provides:
 * 1. 3-Level Hierarchical C4 Architecture Model (Context -> Container -> Component)
 * 2. First-class Human-in-the-Loop (HITL) Exception & Review Gate Modeling
 * 3. Interactive SVG Renderer with Trust Boundaries, Protocol Badges, and Photon Animation
 * 4. Deep Component Contract & Payload Schema Inspector
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
    const raw = (text || '').toLowerCase();
    const scenarioTitle = title || 'Enterprise Architecture Topology';

    // 1. Detect Domain Archetype
    const isHealthcare = raw.includes('mule') || raw.includes('emr') || raw.includes('chib') || raw.includes('salesforce') || raw.includes('referral') || raw.includes('visit id');
    const isBanking = raw.includes('finacle') || raw.includes('core banking') || raw.includes('teller') || raw.includes('fedwire') || raw.includes('aml');
    const isEcommerce = raw.includes('dynamodb') || raw.includes('fastapi') || raw.includes('stripe') || raw.includes('cart') || raw.includes('checkout');
    const isIot = raw.includes('telematics') || raw.includes('emqx') || raw.includes('mqtt') || raw.includes('flink');

    if (isHealthcare) {
      return this.buildHealthcareModel(scenarioTitle);
    }
    if (isBanking) {
      return this.buildBankingModel(scenarioTitle);
    }
    if (isEcommerce) {
      return this.buildEcommerceModel(scenarioTitle);
    }
    if (isIot) {
      return this.buildIotModel(scenarioTitle);
    }

    // Default: Universal Enterprise AI Core Architecture
    return this.buildGenericEnterpriseModel(scenarioTitle, text);
  }

  /**
   * Renders high-fidelity Level 1 System Context or Level 2 Container SVG
   */
  public static renderTopologySvg(
    model: C4ArchitectureModel,
    level: 1 | 2,
    activeSystemId?: string,
    showHitlExceptionPath = false
  ): string {
    if (level === 2 && activeSystemId && model.level2[activeSystemId]) {
      return this.renderLevel2ContainerSvg(model.level2[activeSystemId], showHitlExceptionPath);
    }
    return this.renderLevel1ContextSvg(model, showHitlExceptionPath);
  }

  // ── Level 1 System Context SVG ──────────────────────────────────────────────

  private static renderLevel1ContextSvg(model: C4ArchitectureModel, showHitlException: boolean): string {
    const systems = model.level1.systems;
    const connections = model.level1.connections;

    const width = 960;
    const height = 480;

    // Node layout positions: 3 columns (Client/Ingress -> Integration/Middleware -> Core EHR/Data)
    // plus a top/bottom governance row for HITL
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

    // Layout HITL nodes at bottom or dedicated right position
    hitlNodes.forEach((s, idx) => {
      nodePositions[s.id] = { x: 300 + idx * 260, y: 340, w: 240, h: 92 };
    });

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

      <!-- Trust Boundaries -->
      <g class="c4-zones">
        <rect x="20" y="45" width="220" height="390" rx="10" fill="rgba(30, 41, 59, 0.25)" stroke="rgba(148, 163, 184, 0.2)" stroke-dasharray="6 4"/>
        <text x="32" y="65" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.5">BOUNDARY: CLIENT INGRESS / SAAS</text>

        <rect x="270" y="45" width="280" height="270" rx="10" fill="rgba(139, 92, 246, 0.06)" stroke="rgba(139, 92, 246, 0.25)" stroke-dasharray="6 4"/>
        <text x="282" y="65" fill="#c084fc" font-size="10" font-weight="700" letter-spacing="0.5">BOUNDARY: INTEGRATION CLOUD (MTLS / VPC)</text>

        <rect x="580" y="45" width="260" height="390" rx="10" fill="rgba(245, 158, 11, 0.05)" stroke="rgba(245, 158, 11, 0.22)" stroke-dasharray="6 4"/>
        <text x="592" y="65" fill="#fbbf24" font-size="10" font-weight="700" letter-spacing="0.5">BOUNDARY: CORE CLINICAL EHR / RECORDS</text>

        <rect x="270" y="325" width="280" height="110" rx="10" fill="rgba(239, 68, 68, 0.08)" stroke="rgba(239, 68, 68, 0.35)" stroke-dasharray="4 4"/>
        <text x="282" y="342" fill="#f87171" font-size="9.5" font-weight="800" letter-spacing="0.5">BOUNDARY: HUMAN GOVERNANCE &amp; EXCEPTION REVIEW</text>
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

      // Compute start and end points
      let x1 = fromPos.x + fromPos.w;
      let y1 = fromPos.y + fromPos.h / 2;
      let x2 = toPos.x;
      let y2 = toPos.y + toPos.h / 2;

      // Handle downward routing to HITL
      if (toPos.y > fromPos.y + 100) {
        x1 = fromPos.x + fromPos.w / 2;
        y1 = fromPos.y + fromPos.h;
        x2 = toPos.x + toPos.w / 2;
        y2 = toPos.y;
      } else if (fromPos.x > toPos.x) {
        // Reverse direction
        x1 = fromPos.x;
        x2 = toPos.x + toPos.w;
      }

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      svg += `
        <g class="c4-edge" data-order="${c.order}" style="cursor: pointer;">
          <path d="M ${x1} ${y1} Q ${midX} ${midY - 12} ${x2} ${y2}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${dash} ${filter} marker-end="url(#${markerId})"/>
          <!-- Label Pill -->
          <rect x="${midX - 55}" y="${midY - 16}" width="110" height="15" rx="3" fill="#0f172a" stroke="${strokeColor}" stroke-width="0.8" opacity="0.95"/>
          <text x="${midX}" y="${midY - 5}" fill="${isRed ? '#fca5a5' : '#e2e8f0'}" font-size="8" font-weight="700" text-anchor="middle">${c.order}. ${escapeXml(c.protocol)}</text>
        </g>
      `;
    });

    svg += `</g>
      <!-- Systems Nodes (Level 1) -->
      <g class="c4-nodes">`;

    // Draw systems
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
        glowFilter = showHitlException ? 'filter="url(#c4-glow-red)"' : 'filter="url(#c4-glow-amber)"';
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
          
          <!-- Header Bar with Icon & Badge -->
          <text x="12" y="24" font-size="16">${s.icon}</text>
          <text x="36" y="20" fill="#f8fafc" font-size="11" font-weight="700">${escapeXml(s.label)}</text>
          <text x="36" y="32" fill="${strokeColor}" font-size="8.5" font-weight="600">[${escapeXml(s.role)}]</text>

          <!-- Description line -->
          <text x="12" y="52" fill="#94a3b8" font-size="8" font-weight="500">${escapeXml(s.description.slice(0, 44))}</text>
          <text x="12" y="64" fill="#64748b" font-size="7.5">${escapeXml(s.technologies.slice(0, 3).join(' • '))}</text>

          <!-- Drill-down indicator pill -->
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
      <!-- Title & Watermark -->
      <text x="20" y="24" fill="#38bdf8" font-size="13" font-weight="800" letter-spacing="0.5">🌐 LEVEL 1: SYSTEM CONTEXT TOPOLOGY</text>
      <text x="20" y="38" fill="#94a3b8" font-size="9" font-weight="500">${escapeXml(model.title)} — Click any system to drill down 1 level deeper into internal containers</text>
    </svg>`;

    return svg;
  }

  // ── Level 2 Container SVG ───────────────────────────────────────────────────

  private static renderLevel2ContainerSvg(
    l2: { parentSystem: C4SystemNode; containers: C4ContainerNode[]; connections: C4Connection[] },
    showHitlException: boolean
  ): string {
    const parent = l2.parentSystem;
    const containers = l2.containers;
    const connections = l2.connections;

    const width = 960;
    const height = 480;

    const nodePositions: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const count = containers.length;

    // Distribute containers in a clean 2-row grid or horizontal pipeline
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

      const x1 = fromPos.x + fromPos.w / 2;
      const y1 = fromPos.y + fromPos.h;
      const x2 = toPos.x + toPos.w / 2;
      const y2 = toPos.y;

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

          <text x="12" y="44" fill="#38bdf8" font-size="8.5" font-weight="600 font-family="monospace">${escapeXml(c.endpoint || c.technology)}</text>
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
      <!-- Title & Breadcrumb Link -->
      <text x="30" y="26" fill="#a855f7" font-size="13" font-weight="800" letter-spacing="0.5">📦 LEVEL 2: CONTAINER TOPOLOGY — ${escapeXml(parent.label.toUpperCase())}</text>
      <text x="30" y="42" fill="#94a3b8" font-size="9">Click "⬆ Back to System Context" on the toolbar to return, or click any container to inspect contracts</text>
    </svg>`;

    return svg;
  }

  // ── Pre-built Healthcare Architecture Model ─────────────────────────────────

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
          {
            id: 'Clinician',
            label: 'Referring Clinician',
            category: 'actor',
            zone: 'client',
            icon: '👤',
            role: 'Clinical User / Intake Agent',
            description: 'Initiates referral intake and handles exception reconciliations.',
            technologies: ['Salesforce UI', 'Health Cloud Portal'],
            containerCount: 0
          },
          {
            id: 'Salesforce',
            label: 'Salesforce Health Cloud',
            category: 'saas',
            zone: 'client',
            icon: '☁️',
            role: 'Referral System of Record',
            description: 'Manages patient referral records, file attachments, and status transitions.',
            technologies: ['Apex REST', 'Platform Events', 'OAuth2', 'S3 File Store'],
            containerCount: 4
          },
          {
            id: 'MuleSoft',
            label: 'MuleSoft Anypoint Platform',
            category: 'gateway',
            zone: 'integration',
            icon: '⚡',
            role: 'API-Led Integration Core',
            description: '3-tier API-led orchestrator executing visit validation and document flows.',
            technologies: ['CloudHub 2.0', 'DataWeave 2.0', 'Experience API', 'Process API'],
            containerCount: 4
          },
          {
            id: 'CHIB',
            label: 'CHIB Integration Broker',
            category: 'gateway',
            zone: 'integration',
            icon: '🔄',
            role: 'Clinical Message Hub',
            description: 'Translates enterprise JSON payloads to clinical HL7/FHIR message protocols.',
            technologies: ['HL7 v2.5.1', 'FHIR R4', 'mTLS Gateway'],
            containerCount: 2
          },
          {
            id: 'EMR',
            label: 'EMR Sunrise Clinical Core',
            category: 'ehr',
            zone: 'core',
            icon: '🏥',
            role: 'Enterprise Clinical Registry',
            description: 'Validates Visit ID, MRN, and SAUHI against official inpatient encounters.',
            technologies: ['Allscripts Sunrise', 'MS SQL / Oracle DB', 'MPI Engine'],
            containerCount: 3
          },
          {
            id: 'xAmplify',
            label: 'xAmplify Document Engine',
            category: 'saas',
            zone: 'thirdparty',
            icon: '📄',
            role: 'Document Consolidation Core',
            description: 'Merges multi-format referral documents into a single canonical clinical PDF.',
            technologies: ['xAmplify REST API', 'PDF Linearization', 'OCR Engine'],
            containerCount: 2
          },
          {
            id: 'HITL_Gate',
            label: 'Clinician Exception Review Gate',
            category: 'hitl',
            zone: 'governance',
            icon: '🚨',
            role: 'Human-in-the-Loop Decision Gate',
            description: 'Intercepts validation mismatches; enables manual clinical override or referral rejection.',
            technologies: ['Task Queue', 'Dual-Key Approval', 'Tamper-Evident Audit'],
            containerCount: 1
          }
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
            containerCount: 4
          },
          containers: [
            {
              id: 'Mule_Exp',
              parentSystemId: 'MuleSoft',
              label: 'Mule Experience API',
              type: 'api',
              endpoint: '/api/v1/referrals/validate',
              technology: 'HTTP Listener, OAuth2 Token Validation, Policy Gate',
              description: 'Exposes secure ingress, assigns Correlation ID, and delivers immediate 200 Ack.',
              componentCount: 2
            },
            {
              id: 'Mule_Proc',
              parentSystemId: 'MuleSoft',
              label: 'Mule Process API (Visit Orchestrator)',
              type: 'orchestrator',
              endpoint: 'internal://visit-validation-process',
              technology: 'DataWeave 2.0, Flow Orchestration, State Machine',
              description: 'Coordinates EMR query, evaluates match criteria, and orchestrates doc consolidation.',
              componentCount: 3
            },
            {
              id: 'Mule_Sys_CHIB',
              parentSystemId: 'MuleSoft',
              label: 'CHIB System Connector API',
              type: 'adapter',
              endpoint: 'https://chib.internal/api/v2/query',
              technology: 'HTTP Requestor with mTLS & Circuit Breaker',
              description: 'Handles connection pooling, payload transformation, and retry policy to CHIB.',
              componentCount: 2
            },
            {
              id: 'Mule_Store',
              parentSystemId: 'MuleSoft',
              label: 'Object Store / In-Flight State Cache',
              type: 'store',
              technology: 'Mule ObjectStore v2 (TTL 4h, AES-256)',
              description: 'Maintains correlation state, idempotency keys, and document tracking tokens.',
              componentCount: 1
            }
          ],
          connections: [
            { from: 'Mule_Exp', to: 'Mule_Proc', label: 'Delegate Process (Async Flow)', protocol: 'VM Queue / Direct', order: 1 },
            { from: 'Mule_Proc', to: 'Mule_Store', label: 'Store Correlation Context', protocol: 'Binary Serialization', order: 2 },
            { from: 'Mule_Proc', to: 'Mule_Sys_CHIB', label: 'Execute EMR Validation', protocol: 'Internal REST', order: 3 }
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
            {
              id: 'SF_Intake',
              parentSystemId: 'Salesforce',
              label: 'Referral Intake Controller',
              type: 'api',
              endpoint: 'Referral__c Custom Object',
              technology: 'Apex REST / Lightning Web Component',
              description: 'Captures Visit ID, MRN, SAUHI, and triggers outbound validation callout.',
              componentCount: 2
            },
            {
              id: 'SF_TaskQueue',
              parentSystemId: 'Salesforce',
              label: 'Clinician Exception Task Queue',
              type: 'gate',
              endpoint: 'Task / Case Exception View',
              technology: 'Omni-Channel Routing & SLA Timers',
              description: 'Surfaces validation discrepancies directly to clinicians for 1-click override.',
              componentCount: 2
            },
            {
              id: 'SF_FileStore',
              parentSystemId: 'Salesforce',
              label: 'ContentVersion File Store',
              type: 'store',
              technology: 'Salesforce Files Storage & S3 Vault',
              description: 'Holds unconsolidated referral attachments and final merged clinical document.',
              componentCount: 1
            }
          ],
          connections: [
            { from: 'SF_Intake', to: 'SF_TaskQueue', label: 'Route Exception Task', protocol: 'Platform Event', order: 1 }
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
            {
              id: 'EMR_Adapter',
              parentSystemId: 'EMR',
              label: 'Sunrise HL7/FHIR Engine',
              type: 'adapter',
              technology: 'HL7 v2.5.1 MLLP & FHIR REST Provider',
              description: 'Ingests clinical queries and translates identifier verification requests.',
              componentCount: 2
            },
            {
              id: 'EMR_MPI',
              parentSystemId: 'EMR',
              label: 'Master Patient Index (MPI) & Visit DB',
              type: 'store',
              technology: 'Relational Encounters Database (MSSQL)',
              description: 'Deterministic store verifying exact match of Visit ID, MRN, and SAUHI.',
              componentCount: 2
            }
          ],
          connections: [
            { from: 'EMR_Adapter', to: 'EMR_MPI', label: 'Query Encounter Record', protocol: 'SQL / Stored Proc', order: 1 }
          ]
        }
      },
      level3: {
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
          humanActions: [
            {
              name: 'Verify & Manual Override',
              action: 'override',
              impact: 'Injects cryptographically signed clinical authorization token; forces document consolidation to proceed.'
            },
            {
              name: 'Reject Referral',
              action: 'reject',
              impact: 'Halts process; updates Salesforce status to "Referral Rejected - Identifier Mismatch" and notifies provider.'
            },
            {
              name: 'Escalate to Senior Supervisor',
              action: 'escalate',
              impact: 'Transfers case to Head of Medical Administration after 30-minute SLA expiration.'
            }
          ],
          auditProvenance: 'Captures Clinician Staff ID, timestamp, IP, reason code, and SHA-256 signature in immutable audit log.'
        }
      ]
    };
  }

  // ── Pre-built Banking Architecture Model ────────────────────────────────────

  private static buildBankingModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Universal high-speed core banking wire transfer with Kafka event mesh, automated Neo4j graph fraud detection, and a mandatory Compliance Officer Human-in-the-Loop review gate for transactions exceeding $10,000.',
      level1: {
        zones: [
          { id: 'client', label: 'Branch / Teller' },
          { id: 'integration', label: 'Event Mesh' },
          { id: 'core', label: 'Core Banking' },
          { id: 'governance', label: 'Compliance Governance' }
        ],
        systems: [
          { id: 'Teller', label: 'Branch Teller / Client', category: 'actor', zone: 'client', icon: '👤', role: 'Initiating User', description: 'Submits commercial wire transfer.', technologies: ['Teller UI', 'Omni-Channel API'], containerCount: 0 },
          { id: 'Kong', label: 'Kong Enterprise Gateway', category: 'gateway', zone: 'client', icon: '🛡️', role: 'API Ingress Gateway', description: 'mTLS verification, rate limiting, and JWT validation.', technologies: ['Kong EE', 'mTLS', 'OAuth2'], containerCount: 2 },
          { id: 'Kafka', label: 'Apache Kafka Event Mesh', category: 'queue', zone: 'integration', icon: '⚡', role: 'Real-Time Event Bus', description: 'Distributes transaction events with guaranteed ordering.', technologies: ['Kafka Cluster', 'Schema Registry'], containerCount: 3 },
          { id: 'AML', label: 'AML & Fraud Detection Core', category: 'service', zone: 'integration', icon: '🧠', role: 'Sanctions & Graph Screening', description: 'Evaluates sanction lists and graph money-laundering rings.', technologies: ['Python FastAPI', 'Neo4j Graph DB'], containerCount: 2 },
          { id: 'CoreBank', label: 'Finacle Core Banking DB', category: 'database', zone: 'core', icon: '🏦', role: 'General Ledger System', description: 'Debits originator and credits beneficiary accounts.', technologies: ['Oracle RAC', 'Finacle Core'], containerCount: 2 },
          { id: 'Fedwire', label: 'Fedwire Clearing Gateway', category: 'service', zone: 'thirdparty', icon: '🌐', role: 'Interbank Settlement Network', description: 'Settles funds with central clearing bank.', technologies: ['ISO 20022', 'SWIFT Alliance'], containerCount: 1 },
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
      level2: {},
      level3: {},
      hitlGates: [
        {
          id: 'HITL_AML',
          systemId: 'AML',
          title: 'High-Value Wire Compliance Review Gate',
          triggerCondition: 'Wire transfer amount exceeds $10,000 or Neo4j AML graph score > 0.72.',
          reviewSurface: 'ServiceNow Financial Compliance Portal',
          reviewRole: 'Certified AML Compliance Officer',
          slaMinutes: 15,
          humanActions: [
            { name: 'Approve Wire', action: 'approve', impact: 'Releases funds for immediate Fedwire clearance.' },
            { name: 'Freeze & File SAR', action: 'reject', impact: 'Blocks transaction and files Suspicious Activity Report.' }
          ],
          auditProvenance: 'FIDO2 WebAuthn biometric signature stamped into immutable transaction ledger.'
        }
      ]
    };
  }

  // ── Pre-built E-Commerce Architecture Model ─────────────────────────────────

  private static buildEcommerceModel(title: string): C4ArchitectureModel {
    return {
      title,
      scenarioDescription: 'Scalable microservices checkout topology with Cloudflare edge, FastAPI order service, RabbitMQ queues, DynamoDB, Stripe, and a Fraud Supervisor HITL review gate.',
      level1: {
        zones: [
          { id: 'client', label: 'Edge / CDN' },
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
      level2: {},
      level3: {},
      hitlGates: [
        {
          id: 'HITL_Fraud',
          systemId: 'OrderAPI',
          title: 'High-Risk Order Fraud Review Gate',
          triggerCondition: 'Radar risk score > 75 or shipping address differs from card country.',
          reviewSurface: 'Fraud Operations Dashboard',
          reviewRole: 'Fraud Risk Analyst',
          slaMinutes: 60,
          humanActions: [
            { name: 'Release Order', action: 'approve', impact: 'Clears order for immediate warehouse packing.' },
            { name: 'Cancel & Refund', action: 'reject', impact: 'Voids authorization and restocks items.' }
          ],
          auditProvenance: 'Analyst ID and resolution code recorded in DynamoDB audit trail.'
        }
      ]
    };
  }

  // ── Pre-built IoT Architecture Model ────────────────────────────────────────

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
      level2: {},
      level3: {},
      hitlGates: [
        {
          id: 'HITL_Safety',
          systemId: 'Flink',
          title: 'Turbine Thermal Anomaly Safety Gate',
          triggerCondition: 'Vibration frequency > 120Hz AND temperature > 180°C across 3 consecutive windows.',
          reviewSurface: 'Control Room SCADA Safety Terminal',
          reviewRole: 'Chief Plant Operations Engineer',
          slaMinutes: 5,
          humanActions: [
            { name: 'Authorize Emergency Shutdown', action: 'override', impact: 'Triggers emergency mechanical trip valve to prevent catastrophic turbine failure.' },
            { name: 'Acknowledge Sensor Glitch', action: 'reject', impact: 'Logs instrument recalibration ticket and bypasses shutdown.' }
          ],
          auditProvenance: 'Hard-wired key switch and digital cryptographic authorization token.'
        }
      ]
    };
  }

  // ── Generic Enterprise Architecture Model ───────────────────────────────────

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
      level3: {},
      hitlGates: [
        {
          id: 'HITL_Supervisor',
          systemId: 'Staging',
          title: 'High-Impact Action Approval Gate',
          triggerCondition: 'Action value exceeds autonomous safety threshold or AI confidence < 92%.',
          reviewSurface: 'Enterprise Review Console / Slack Interactive Card',
          reviewRole: 'Authorized Lead Supervisor',
          slaMinutes: 15,
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
