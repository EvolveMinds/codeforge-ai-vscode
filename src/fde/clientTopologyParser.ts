/**
 * fde/clientTopologyParser.ts — Enterprise Client Architecture Document Ingestion Engine
 * Parses customer-provided architectural documents, specifications, PlantUML, and Mermaid diagrams
 * into canonical Current (As-Is / Legacy) and Target (To-Be / Future) Workflow Topologies.
 */

export interface ClientTopologyParseOptions {
  content: string;
  target: 'legacy' | 'future' | 'both';
  docName?: string;
  rawAsk?: string;
  reframedGoal?: string;
}

export interface ClientTopologyParseResult {
  success: boolean;
  docName: string;
  target: 'legacy' | 'future' | 'both';
  legacyDiagram?: string;
  futureDiagram?: string;
  detectedFormat: 'mermaid' | 'plantuml' | 'structured-spec' | 'unstructured-prose';
  participantCount: number;
  messageCount: number;
  extractedEntities: string[];
  summary: string;
  error?: string;
}

interface ParsedEntity {
  id: string;
  label: string;
  isActor: boolean;
  type: 'actor' | 'gateway' | 'service' | 'database' | 'queue' | 'gate';
}

interface ParsedStep {
  from: string;
  to: string;
  message: string;
  isReply?: boolean;
  note?: string;
  isGate?: boolean;
}

export class ClientTopologyParser {
  /**
   * Primary entry point: parses client-supplied architecture text/file into Mermaid diagrams.
   */
  public static parse(opts: ClientTopologyParseOptions): ClientTopologyParseResult {
    const rawContent = (opts?.content || '').trim();
    const docName = opts?.docName?.trim() || 'Client Architecture Specification';
    const target = opts?.target || 'both';

    if (!rawContent) {
      return {
        success: false,
        docName,
        target,
        detectedFormat: 'unstructured-prose',
        participantCount: 0,
        messageCount: 0,
        extractedEntities: [],
        summary: 'No document content provided for topology parsing.',
        error: 'Content is empty.'
      };
    }

    // 1. Check if raw content already contains Mermaid diagrams
    const mermaidDiagrams = this.extractMermaidBlocks(rawContent);
    if (mermaidDiagrams.length > 0) {
      return this.handleMermaidInput(mermaidDiagrams, rawContent, target, docName);
    }

    // 2. Check if content is PlantUML sequence diagram
    if (/@startuml/i.test(rawContent) || /(actor|participant|database)\s+["\w]/i.test(rawContent) && /(-{1,2}>|-->)/.test(rawContent)) {
      return this.handlePlantUmlInput(rawContent, target, docName);
    }

    // 3. Unstructured or Semi-Structured Architecture Specification (Markdown, Spec runbook, text)
    return this.handleSpecDocInput(rawContent, target, docName, opts.rawAsk, opts.reframedGoal);
  }

  /**
   * Extract mermaid blocks or direct mermaid sequence / flowchart code
   */
  private static extractMermaidBlocks(content: string): string[] {
    const codeBlocks: string[] = [];
    const fenceRegex = /```(?:mermaid)?\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;

    while ((match = fenceRegex.exec(content)) !== null) {
      const inner = match[1].trim();
      if (/^(sequenceDiagram|flowchart|graph)\b/i.test(inner)) {
        codeBlocks.push(inner);
      }
    }

    if (codeBlocks.length === 0 && /^(sequenceDiagram|flowchart|graph)\b/i.test(content)) {
      codeBlocks.push(content);
    }

    return codeBlocks;
  }

  private static countParticipants(diagram: string): number {
    return diagram.split(/\r?\n/).filter(l => /^(participant|actor)\s+/i.test(l.trim())).length;
  }

  private static countMessages(diagram: string): number {
    return diagram.split(/\r?\n/).filter(l => /(-{1,2}>>?|-->|-\)|-x)\s*[^:]+:/.test(l.trim())).length;
  }

  private static extractEntityLabels(diagram: string): string[] {
    const labels: string[] = [];
    const lines = diagram.split(/\r?\n/);
    for (const l of lines) {
      const m = l.trim().match(/^(?:participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as\s+(.+))?$/i);
      if (m) {
        labels.push(m[2] ? m[2].trim() : m[1]);
      }
    }
    return labels;
  }

  /**
   * Handle existing Mermaid diagrams pasted or extracted from doc
   */
  private static handleMermaidInput(
    diagrams: string[],
    rawContent: string,
    target: 'legacy' | 'future' | 'both',
    docName: string
  ): ClientTopologyParseResult {
    let legacyDiagram: string | undefined;
    let futureDiagram: string | undefined;

    if (target === 'legacy') {
      legacyDiagram = diagrams[0];
    } else if (target === 'future') {
      futureDiagram = diagrams[0];
    } else {
      // Both target: check if doc clearly separated Current vs Future
      if (diagrams.length >= 2) {
        legacyDiagram = diagrams[0];
        futureDiagram = diagrams[1];
      } else {
        // Single diagram provided for 'both': test if content context indicates current or future
        const lower = rawContent.toLowerCase();
        if (lower.includes('legacy') || lower.includes('as-is') || lower.includes('current state')) {
          legacyDiagram = diagrams[0];
          // Synthesize a modernized future companion based on the legacy
          futureDiagram = this.synthesizeFutureFromLegacy(diagrams[0]);
        } else {
          futureDiagram = diagrams[0];
          // Synthesize a legacy companion
          legacyDiagram = this.synthesizeLegacyFromFuture(diagrams[0]);
        }
      }
    }

    const primaryDiagram = futureDiagram || legacyDiagram || diagrams[0];
    const participantCount = this.countParticipants(primaryDiagram);
    const messageCount = this.countMessages(primaryDiagram);
    const extractedEntities = this.extractEntityLabels(primaryDiagram);

    return {
      success: true,
      docName,
      target,
      legacyDiagram,
      futureDiagram,
      detectedFormat: 'mermaid',
      participantCount,
      messageCount,
      extractedEntities,
      summary: `Successfully ingested native Mermaid topology (${participantCount} participants, ${messageCount} steps) from "${docName}".`
    };
  }

  /**
   * Transpile PlantUML sequence diagrams to clean Mermaid sequence syntax
   */
  private static handlePlantUmlInput(
    content: string,
    target: 'legacy' | 'future' | 'both',
    docName: string
  ): ClientTopologyParseResult {
    const cleanLines = content
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('@startuml') && !l.startsWith('@enduml') && !l.startsWith('title '));

    const participants: Map<string, { id: string; label: string; isActor: boolean }> = new Map();
    const steps: string[] = [];

    for (const line of cleanLines) {
      if (/^autonumber\b/i.test(line)) continue;

      // Match: actor "User Name" as User OR actor User as "User Name" OR actor User
      const actorMatch = line.match(/^actor\s+(?:"([^"]+)"|([A-Za-z0-9_]+))(?:\s+as\s+(?:"([^"]+)"|([A-Za-z0-9_]+)))?/i);
      if (actorMatch) {
        const id = (actorMatch[4] || actorMatch[2] || actorMatch[1] || '').trim();
        const label = (actorMatch[3] || actorMatch[1] || actorMatch[2] || id).trim();
        participants.set(id, { id, label, isActor: true });
        continue;
      }

      // Match: participant / database / boundary / control
      const partMatch = line.match(/^(?:participant|database|boundary|control|entity|collections)\s+(?:"([^"]+)"|([A-Za-z0-9_]+))(?:\s+as\s+(?:"([^"]+)"|([A-Za-z0-9_]+)))?/i);
      if (partMatch) {
        const isDb = line.toLowerCase().startsWith('database');
        const id = (partMatch[4] || partMatch[2] || partMatch[1] || '').trim();
        let label = (partMatch[3] || partMatch[1] || partMatch[2] || id).trim();
        if (isDb && !label.includes('DB') && !label.includes('Database')) label += ' (DB)';
        participants.set(id, { id, label, isActor: false });
        continue;
      }

      // Match arrows: A -> B : msg, A --> B : msg, A ->> B: msg
      const arrowMatch = line.match(/^([A-Za-z0-9_]+)\s*(-{1,2}>>?|-->)\s*([A-Za-z0-9_]+)\s*:\s*(.+)$/);
      if (arrowMatch) {
        const from = arrowMatch[1];
        const arrow = arrowMatch[2];
        const to = arrowMatch[3];
        const msg = arrowMatch[4].trim();

        if (!participants.has(from)) participants.set(from, { id: from, label: from, isActor: false });
        if (!participants.has(to)) participants.set(to, { id: to, label: to, isActor: false });

        const isDashed = arrow.startsWith('--');
        const mermaidArrow = isDashed ? '-->>' : '->>';
        steps.push(`    ${from}${mermaidArrow}${to}: ${msg}`);
        continue;
      }

      // Match notes: note over A, B: text
      const noteMatch = line.match(/^note\s+(?:over\s+([A-Za-z0-9_, ]+)|left of\s+([A-Za-z0-9_]+)|right of\s+([A-Za-z0-9_]+))\s*:\s*(.+)$/i);
      if (noteMatch) {
        const targets = (noteMatch[1] || noteMatch[2] || noteMatch[3] || '').trim();
        const text = noteMatch[4].trim();
        steps.push(`    Note over ${targets}: ${text}`);
      }
    }

    const pDeclarations: string[] = [];
    for (const p of participants.values()) {
      pDeclarations.push(`    ${p.isActor ? 'actor' : 'participant'} ${p.id} as ${p.label}`);
    }

    const transpiledDiagram = [
      'sequenceDiagram',
      '    autonumber',
      ...pDeclarations,
      '',
      ...steps
    ].join('\n');

    let legacyDiagram: string | undefined;
    let futureDiagram: string | undefined;

    if (target === 'legacy') {
      legacyDiagram = transpiledDiagram;
    } else if (target === 'future') {
      futureDiagram = transpiledDiagram;
    } else {
      futureDiagram = transpiledDiagram;
      legacyDiagram = this.synthesizeLegacyFromFuture(transpiledDiagram);
    }

    const participantCount = participants.size;
    const messageCount = steps.filter(s => s.includes('->>')).length;

    return {
      success: true,
      docName,
      target,
      legacyDiagram,
      futureDiagram,
      detectedFormat: 'plantuml',
      participantCount,
      messageCount,
      extractedEntities: Array.from(participants.values()).map(p => p.label),
      summary: `Transpiled PlantUML specification to Mermaid sequence diagram (${participantCount} participants, ${messageCount} steps).`
    };
  }

  /**
   * Handle unstructured architecture document, runbook, or specification text
   */
  private static handleSpecDocInput(
    content: string,
    target: 'legacy' | 'future' | 'both',
    docName: string,
    rawAsk?: string,
    reframedGoal?: string
  ): ClientTopologyParseResult {
    // Check if doc is bifurcated into Current and Future sections
    const hasCurrentSection = /(?:#+\s*(?:current|as-is|legacy|today|existing)\b)/i.test(content);
    const hasFutureSection = /(?:#+\s*(?:future|to-be|target|proposed|solution)\b)/i.test(content);

    let legacyText = content;
    let futureText = content;

    if (hasCurrentSection && hasFutureSection) {
      const splitSections = this.splitBifurcatedDoc(content);
      legacyText = splitSections.legacy || content;
      futureText = splitSections.future || content;
    }

    const legacyEntities = this.extractEntities(legacyText, true);
    const legacySteps = this.extractSteps(legacyText, legacyEntities, true);
    const legacyDiagram = this.renderMermaid(legacyEntities, legacySteps, true, docName);

    const futureEntities = this.extractEntities(futureText, false);
    const futureSteps = this.extractSteps(futureText, futureEntities, false);
    const futureDiagram = this.renderMermaid(futureEntities, futureSteps, false, docName);

    const resLegacy = target === 'future' ? undefined : legacyDiagram;
    const resFuture = target === 'legacy' ? undefined : futureDiagram;
    const activeEntities = target === 'legacy' ? legacyEntities : futureEntities;
    const activeSteps = target === 'legacy' ? legacySteps : futureSteps;

    return {
      success: true,
      docName,
      target,
      legacyDiagram: resLegacy,
      futureDiagram: resFuture,
      detectedFormat: hasCurrentSection || hasFutureSection ? 'structured-spec' : 'unstructured-prose',
      participantCount: activeEntities.length,
      messageCount: activeSteps.length,
      extractedEntities: activeEntities.map(e => e.label),
      summary: `Synthesized production workflow topology from "${docName}" (${activeEntities.length} enterprise systems, ${activeSteps.length} interaction steps).`
    };
  }

  private static splitBifurcatedDoc(content: string): { legacy: string; future: string } {
    const lines = content.split(/\r?\n/);
    const legacyLines: string[] = [];
    const futureLines: string[] = [];
    let currentMode: 'legacy' | 'future' | 'neutral' = 'neutral';

    for (const line of lines) {
      if (/(?:#+\s*(?:current|as-is|legacy|today|existing)\b)/i.test(line)) {
        currentMode = 'legacy';
        continue;
      } else if (/(?:#+\s*(?:future|to-be|target|proposed|solution)\b)/i.test(line)) {
        currentMode = 'future';
        continue;
      }

      if (currentMode === 'legacy') legacyLines.push(line);
      else if (currentMode === 'future') futureLines.push(line);
      else {
        legacyLines.push(line);
        futureLines.push(line);
      }
    }

    return {
      legacy: legacyLines.join('\n').trim(),
      future: futureLines.join('\n').trim()
    };
  }

  /**
   * Intelligently extract enterprise systems and actors from unstructured text
   */
  private static extractEntities(text: string, isLegacy: boolean): ParsedEntity[] {
    const entities: Map<string, ParsedEntity> = new Map();
    const lower = text.toLowerCase();

    // 1. Primary Actor / User
    let actorLabel = 'Business User / Operator';
    if (lower.includes('customer') || lower.includes('borrower') || lower.includes('policyholder')) {
      actorLabel = 'Customer / End User';
    } else if (lower.includes('clinician') || lower.includes('physician') || lower.includes('doctor')) {
      actorLabel = 'Clinical Provider / Physician';
    } else if (lower.includes('trader') || lower.includes('analyst')) {
      actorLabel = 'Financial Analyst / Trader';
    } else if (lower.includes('support agent') || lower.includes('tier-1') || lower.includes('csr')) {
      actorLabel = 'Support Operator / CSR';
    }
    entities.set('User', { id: 'User', label: actorLabel, isActor: true, type: 'actor' });

    // 2. Ingress / Gateway / Portal
    if (isLegacy) {
      if (lower.includes('spreadsheet') || lower.includes('excel') || lower.includes('csv')) {
        entities.set('Portal', { id: 'Portal', label: 'Manual Spreadsheets & Email Ingress', isActor: false, type: 'gateway' });
      } else if (lower.includes('sftp') || lower.includes('ftp')) {
        entities.set('Portal', { id: 'Portal', label: 'Unsecured SFTP Drop Share', isActor: false, type: 'gateway' });
      } else {
        entities.set('Portal', { id: 'Portal', label: 'Legacy Web Portal & Email Inbox', isActor: false, type: 'gateway' });
      }
    } else {
      if (lower.includes('apigee') || lower.includes('kong') || lower.includes('api gateway') || lower.includes('ingress')) {
        const gwName = lower.includes('apigee') ? 'Apigee API Gateway (mTLS & OAuth2)' :
                       lower.includes('kong') ? 'Kong Enterprise API Gateway' : 'Secure API Gateway & Ingress';
        entities.set('Gateway', { id: 'Gateway', label: gwName, isActor: false, type: 'gateway' });
      } else {
        entities.set('Gateway', { id: 'Gateway', label: 'Secure Ingress & API Gateway (OAuth2)', isActor: false, type: 'gateway' });
      }
    }

    // 3. Processing Core / Orchestrator / Copilot
    if (isLegacy) {
      if (lower.includes('cron') || lower.includes('batch') || lower.includes('nightly')) {
        entities.set('Core', { id: 'Core', label: 'Nightly Batch Cron & ETL Scripts', isActor: false, type: 'service' });
      } else {
        entities.set('Core', { id: 'Core', label: 'Ad-Hoc Manual Processing Silo', isActor: false, type: 'service' });
      }
    } else {
      entities.set('Staging', { id: 'Staging', label: 'Deterministic Schema & Rule Staging Gate', isActor: false, type: 'service' });
      entities.set('AI', { id: 'AI', label: 'Evolve AI Copilot (Air-Gapped LLM / SLM)', isActor: false, type: 'service' });
    }

    // 4. Message Queues / Event Bus
    if (!isLegacy) {
      if (lower.includes('kafka') || lower.includes('event hub') || lower.includes('pubsub') || lower.includes('rabbitmq')) {
        const busName = lower.includes('kafka') ? 'Apache Kafka Event Mesh' :
                        lower.includes('event hub') ? 'Azure Event Hubs' :
                        lower.includes('rabbitmq') ? 'RabbitMQ Message Broker' : 'Cloud Pub/Sub Event Mesh';
        entities.set('Bus', { id: 'Bus', label: busName, isActor: false, type: 'queue' });
      }
    }

    // 5. Enterprise Data Stores / ERP / Databases
    let dbLabel = isLegacy ? 'Unprotected Core Database' : 'Production Warehouse & Audit Log';
    if (lower.includes('sap') || lower.includes('s/4hana')) {
      dbLabel = isLegacy ? 'SAP S/4HANA (Manual Exports)' : 'SAP S/4HANA Enterprise Connector';
    } else if (lower.includes('oracle') || lower.includes('rac')) {
      dbLabel = isLegacy ? 'Legacy Oracle 11g/19c (No Audit)' : 'Oracle RAC & pgvector Store';
    } else if (lower.includes('snowflake')) {
      dbLabel = isLegacy ? 'Snowflake EDW (Uncurated Raw)' : 'Snowflake EDW & Fast Query Cache';
    } else if (lower.includes('postgres') || lower.includes('postgresql')) {
      dbLabel = isLegacy ? 'PostgreSQL Database' : 'PostgreSQL Core & pgvector';
    } else if (lower.includes('salesforce') || lower.includes('crm')) {
      dbLabel = isLegacy ? 'Salesforce CRM (Ad-hoc manual sync)' : 'Salesforce CRM API Service';
    } else if (lower.includes('as400') || lower.includes('mainframe')) {
      dbLabel = isLegacy ? 'AS400 Mainframe Core Banking' : 'Mainframe Integration Gateway';
    }
    entities.set('DB', { id: 'DB', label: dbLabel, isActor: false, type: 'database' });

    // 6. Human in the Loop (HITL) Supervisor
    if (!isLegacy) {
      entities.set('Supervisor', { id: 'Supervisor', label: 'Human-in-the-Loop (HITL) Review Gate', isActor: true, type: 'gate' });
    }

    return Array.from(entities.values());
  }

  /**
   * Synthesize sequence steps from document contents
   */
  private static extractSteps(text: string, entities: ParsedEntity[], isLegacy: boolean): ParsedStep[] {
    const steps: ParsedStep[] = [];
    const lower = text.toLowerCase();

    const entMap = new Map(entities.map(e => [e.id, e]));

    if (isLegacy) {
      // Step 1: User submission
      steps.push({
        from: 'User',
        to: 'Portal',
        message: 'Submit unvalidated request (PDF attachments / Email)',
        note: 'High cognitive overhead & manual data transcription'
      });

      // Step 2: Ingress to Core
      if (entMap.has('Core')) {
        steps.push({
          from: 'Portal',
          to: 'Core',
          message: 'Ad-hoc batch export or manual copy-paste into spreadsheets'
        });
        steps.push({
          from: 'Core',
          to: 'Core',
          message: 'Manual macro calculation without automated validation',
          note: '⚠️ Bottleneck: 24-48h batch delay and zero regression tests'
        });
      }

      // Step 3: Core to DB
      if (entMap.has('DB')) {
        steps.push({
          from: 'Core',
          to: 'DB',
          message: 'Direct un-audited database mutation / manual ERP update',
          note: '⚠️ Data integrity & hallucination risk without schema guards'
        });
        steps.push({
          from: 'DB',
          to: 'User',
          message: 'Unconfirmed completion notice (high downstream rework rate)',
          isReply: true
        });
      }
    } else {
      // Future Target Architecture
      const hasBus = entMap.has('Bus');
      const hasStaging = entMap.has('Staging');
      const hasAi = entMap.has('AI');
      const hasGate = entMap.has('Supervisor');
      const hasDb = entMap.has('DB');

      // Step 1: Request
      steps.push({
        from: 'User',
        to: 'Gateway',
        message: 'Structured JSON payload with mTLS tenant token'
      });

      // Step 2: Gateway to Staging / Bus
      if (hasBus) {
        steps.push({
          from: 'Gateway',
          to: 'Bus',
          message: 'Publish verified event to partitioned topic'
        });
        steps.push({
          from: 'Bus',
          to: 'Staging',
          message: 'Stream consumer pull (<5ms latency)'
        });
      } else if (hasStaging) {
        steps.push({
          from: 'Gateway',
          to: 'Staging',
          message: 'Forward request through AST Schema Guard'
        });
      }

      // Step 3: Staging rules & AI Copilot
      if (hasStaging && hasAi) {
        steps.push({
          from: 'Staging',
          to: 'AI',
          message: 'Enrich payload with grounded enterprise embeddings'
        });
        steps.push({
          from: 'AI',
          to: 'Staging',
          message: 'Synthesize deterministic proposal with citations (<50ms)',
          isReply: true
        });
      }

      // Step 4: HITL gate
      if (hasGate && hasStaging) {
        steps.push({
          from: 'Staging',
          to: 'Supervisor',
          message: 'Route high-impact threshold action for sign-off',
          isGate: true
        });
        steps.push({
          from: 'Supervisor',
          to: 'Staging',
          message: '1-Click Cryptographically Signed Approval',
          isReply: true
        });
      }

      // Step 5: DB commit
      if (hasStaging && hasDb) {
        steps.push({
          from: 'Staging',
          to: 'DB',
          message: 'Atomic commit with tamper-evident audit receipt'
        });
        steps.push({
          from: 'DB',
          to: 'User',
          message: 'Instant verified execution receipt delivered',
          isReply: true
        });
      }
    }

    return steps;
  }

  private static renderMermaid(
    entities: ParsedEntity[],
    steps: ParsedStep[],
    isLegacy: boolean,
    docName: string
  ): string {
    const lines: string[] = ['sequenceDiagram', '    autonumber'];

    // Participants
    for (const ent of entities) {
      lines.push(`    ${ent.isActor ? 'actor' : 'participant'} ${ent.id} as ${ent.label}`);
    }
    lines.push('');

    // Steps
    for (const step of steps) {
      if (step.note) {
        lines.push(`    Note over ${step.from},${step.to}: ${step.note}`);
      }
      const arrow = step.isReply ? '-->>' : '->>';
      lines.push(`    ${step.from}${arrow}${step.to}: ${step.message}`);
    }

    return lines.join('\n');
  }

  /**
   * Helper: synthesize a modern future companion if only legacy was provided
   */
  private static synthesizeFutureFromLegacy(legacyDiagram: string): string {
    const participants = this.extractEntityLabels(legacyDiagram);
    const hasDb = participants.some(p => /db|database|sap|oracle|warehouse/i.test(p));

    return [
      'sequenceDiagram',
      '    autonumber',
      '    actor User as Business Operator / User',
      '    participant Gateway as Secure API Gateway & Ingress (OAuth2)',
      '    participant Staging as Deterministic Schema & Rule Gate',
      '    participant AI as Evolve AI Copilot (Air-Gapped)',
      '    actor Supervisor as Human-in-the-Loop (HITL) Gate',
      `    participant Core as ${hasDb ? 'Production Enterprise Store & Audit Log' : 'Enterprise Core System'}`,
      '',
      '    User->>Gateway: Submit structured request payload',
      '    Gateway->>Staging: Validate AST schema (<10ms)',
      '    Staging->>AI: Enrich with 128-token grounded handbook context',
      '    AI->>Supervisor: Draft verified proposal with citations',
      '    Supervisor->>Core: 1-Click Cryptographically Signed Approval',
      '    Core-->>User: Verified execution receipt generated'
    ].join('\n');
  }

  /**
   * Helper: synthesize a legacy companion if only future was provided
   */
  private static synthesizeLegacyFromFuture(futureDiagram: string): string {
    return [
      'sequenceDiagram',
      '    autonumber',
      '    actor User as Business Operator / User',
      '    participant Legacy as Legacy Manual Process (Spreadsheets / PDF)',
      '    participant Core as Unprotected Database / Core ERP',
      '',
      '    User->>Legacy: Submit manual unfiltered request via email',
      '    Note over User,Legacy: High cognitive overhead, error-prone manual steps',
      '    Legacy->>Core: Ad-hoc direct updates without validation',
      '    Note over Core: Hallucination & data corruption risk',
      '    Core-->>User: Un-audited completion (high rework rate)'
    ].join('\n');
  }
}
