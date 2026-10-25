/**
 * src/fde/agents/agentDispatcher.ts
 *
 * Autonomous Forward Deployed Engineer (FDE) Agent Fleet & Dispatcher.
 * Resolves GAP-06.
 *
 * Implements the 15 visible specialized FDE roles with strict role contracts,
 * input/output boundaries, automated blind review delegation, and Codebase Cosmos
 * context injection.
 */

import { CoreAIService, CoreAIRequest } from '../../core/ai/coreAiService';
import { CosmosContextBridge } from '../codebaseGraph/cosmosContextBridge';
import { LearningsEngine } from '../learningsEngine';
import { LoopEngine } from '../loopEngine';

export interface FdeAgentRole {
  id: string;
  name: string;
  description: string;
  category: 'core' | 'review' | 'data' | 'platform' | 'specialist';
  systemPrompt: string;
  outputArtifactType: 'PRD' | 'ADR' | 'SPEC' | 'CODE' | 'REVIEW' | 'RUNBOOK' | 'LEARNING' | 'STORY';
  requiresModelCouncil?: boolean;
}

export interface AgentExecutionRequest {
  roleId: string;
  taskTitle: string;
  instruction: string;
  contextFiles?: string[];
  issueId?: string;
}

export interface AgentExecutionResponse {
  roleId: string;
  output: string;
  executedModel: string;
  latencyMs: number;
  cosmosIntelligenceInjected: boolean;
  learningsInjectedCount: number;
}

export class AgentDispatcher {
  private _roles = new Map<string, FdeAgentRole>();

  constructor(
    private readonly _workspaceRoot: string,
    private readonly _aiCore: CoreAIService,
    private readonly _cosmosBridge: CosmosContextBridge,
    private readonly _learningsEngine: LearningsEngine,
    private readonly _loopEngine?: LoopEngine
  ) {
    this._registerFleet();
  }

  public getRegisteredRoles(): FdeAgentRole[] {
    return Array.from(this._roles.values());
  }

  public getRole(roleId: string): FdeAgentRole | undefined {
    return this._roles.get(roleId.toLowerCase());
  }

  public async execute(req: AgentExecutionRequest): Promise<AgentExecutionResponse> {
    const role = this._roles.get(req.roleId.toLowerCase());
    if (!role) {
      throw new Error(`Unknown FDE Agent Role: "${req.roleId}". Use "getRegisteredRoles()" to view available fleet.`);
    }

    const t0 = process.hrtime();
    let promptContext = req.instruction;
    let cosmosInjected = false;
    let learningsCount = 0;

    // 1. Inject Codebase Cosmos Intelligence for Engineering & Architecture
    if (role.id === 'engineer' || role.id === 'architect' || role.id === 'orchestrator') {
      const cosmosSummary = await this._cosmosBridge.getContextSummary({
        focusFiles: req.contextFiles
      });
      promptContext = `${cosmosSummary}\n\n${promptContext}`;
      cosmosInjected = true;
    }

    // 2. Inject Reusable Historical Learnings
    const learnings = await this._learningsEngine.retrieveRelevantLearnings(req.taskTitle, 2);
    if (learnings.length > 0) {
      promptContext = `## 🧠 Past Learnings & Discovered Pitfalls (From docs/artifacts/learnings/)\n${learnings.join('\n---\n')}\n\n${promptContext}`;
      learningsCount = learnings.length;
    }

    // 3. Execute via CoreAIService
    const aiReq: CoreAIRequest = {
      messages: [{ role: 'user', content: promptContext }],
      system: role.systemPrompt,
      mode: 'agent'
    };

    const output = await this._aiCore.complete(aiReq);
    const diff = process.hrtime(t0);
    const latencyMs = Math.round(diff[0] * 1000 + diff[1] / 1e6);

    return {
      roleId: role.id,
      output,
      executedModel: 'CoreAI',
      latencyMs,
      cosmosIntelligenceInjected: cosmosInjected,
      learningsInjectedCount: learningsCount
    };
  }

  private _registerFleet(): void {
    // 1. Orchestration Hub FDE
    this._roles.set('orchestrator', {
      id: 'orchestrator',
      name: 'Evolve Orchestration FDE',
      description: 'End-to-end task decomposition, specialist role routing, and workflow verification.',
      category: 'core',
      outputArtifactType: 'SPEC',
      systemPrompt: 'You are the Evolve Orchestration FDE. You analyze user goals, break down complex requirements, and route tasks to specialist FDEs (Product, Architecture, Engineering, Review, QA).'
    });

    // 2. Product Manager FDE
    this._roles.set('product-manager', {
      id: 'product-manager',
      name: 'Evolve Product FDE',
      description: 'Product scope framing, PRD generation, INVEST user stories, and acceptance criteria.',
      category: 'core',
      outputArtifactType: 'PRD',
      systemPrompt: 'You are the Evolve Product FDE. You transform raw stakeholder requests into structured PRDs with quantifiable success metrics, user stories, and acceptance criteria.'
    });

    // 3. Architecture FDE
    this._roles.set('architect', {
      id: 'architect',
      name: 'Evolve Architecture FDE',
      description: 'System boundary design, ADR authoring with 3+ options, C4 diagrams, and technical specifications.',
      category: 'core',
      outputArtifactType: 'ADR',
      requiresModelCouncil: true,
      systemPrompt: 'You are the Evolve Architecture FDE. You evaluate at least 3 distinct architectural options with trade-offs, draft ADRs, convene the Model Council, and define system boundaries.'
    });

    // 4. Experience (UX) FDE
    this._roles.set('ux-designer', {
      id: 'ux-designer',
      name: 'Evolve Experience FDE',
      description: 'User journeys, accessible interfaces (WCAG 2.1 AA), and interactive HTML/CSS prototypes.',
      category: 'core',
      outputArtifactType: 'SPEC',
      systemPrompt: 'You are the Evolve UX FDE. You create accessible, responsive user interface specifications and standalone working HTML/CSS prototypes in docs/ux/prototypes/.'
    });

    // 5. Engineering FDE
    this._roles.set('engineer', {
      id: 'engineer',
      name: 'Evolve Engineering FDE',
      description: 'Production code implementation following Karpathy simplicity rules and surgical changes.',
      category: 'core',
      outputArtifactType: 'CODE',
      systemPrompt: 'You are the Evolve Engineering FDE. You follow Karpathy guidelines: Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven. Touch only what is strictly necessary.'
    });

    // 6. Reviewer FDE (Independent Blind Auditor)
    this._roles.set('reviewer', {
      id: 'reviewer',
      name: 'Evolve Reviewer FDE',
      description: 'Independent blind reviewer evaluating code quality, security, and contract adherence.',
      category: 'review',
      outputArtifactType: 'REVIEW',
      systemPrompt: 'You are the Evolve Reviewer FDE. You independently audit deliverables against the 10-dimension code-quality rubric. Return structured HIGH, MEDIUM, and LOW findings with zero author bias.'
    });

    // 7. Auto-Fix FDE
    this._roles.set('auto-fix', {
      id: 'auto-fix',
      name: 'Evolve Auto-Fix FDE',
      description: 'Applies safe, verified, non-breaking corrections to review findings.',
      category: 'review',
      outputArtifactType: 'CODE',
      systemPrompt: 'You are the Evolve Auto-Fix FDE. You inspect Review findings and apply safe, minimal, behavior-preserving fixes under Quality Loop iteration 2+.'
    });

    // 8. DevOps & SRE FDE
    this._roles.set('devops', {
      id: 'devops',
      name: 'Evolve DevOps FDE',
      description: 'CI/CD pipeline generation, Docker/Cloud Run configs, zero-downtime deployment automation.',
      category: 'platform',
      outputArtifactType: 'RUNBOOK',
      systemPrompt: 'You are the Evolve DevOps FDE. You create resilient CI/CD pipelines, containerization scripts, and deployment runbooks with zero-downtime rollback procedures.'
    });

    // 9. Tester & Certification FDE
    this._roles.set('tester', {
      id: 'tester',
      name: 'Evolve Test FDE',
      description: 'Test pyramid authoring (unit, integration, regression), test certification reports.',
      category: 'core',
      outputArtifactType: 'REVIEW',
      systemPrompt: 'You are the Evolve Test FDE. You author test suites adhering to the test pyramid and write production certification reports.'
    });

    // 10. Fabric & Data FDE
    this._roles.set('fabric-engineer', {
      id: 'fabric-engineer',
      name: 'Evolve Fabric FDE',
      description: 'Microsoft Fabric Lakehouse, Warehouse, Delta Lake, PySpark jobs, and medallion pipelines.',
      category: 'data',
      outputArtifactType: 'CODE',
      systemPrompt: 'You are the Evolve Fabric FDE. You build idempotent Microsoft Fabric Lakehouse structures, Spark pipelines, quality checks, and medallion architecture models.'
    });

    // 11. Power Platform Builder FDE
    this._roles.set('power-platform', {
      id: 'power-platform',
      name: 'Evolve Power Platform FDE',
      description: 'Portable unmanaged low-code solutions, Dataverse, Power Pages, PCF components.',
      category: 'platform',
      outputArtifactType: 'CODE',
      systemPrompt: 'You are the Evolve Power Platform FDE. You scaffold unpacked unmanaged solution source for Dataverse, canvas apps, and flows, operating fail-closed for tenant mutations.'
    });

    // 12. Power BI Analyst FDE
    this._roles.set('powerbi-analyst', {
      id: 'powerbi-analyst',
      name: 'Evolve Power BI FDE',
      description: 'Semantic models, DAX measures, Power Query transformations, and executive reporting.',
      category: 'data',
      outputArtifactType: 'SPEC',
      systemPrompt: 'You are the Evolve Power BI FDE. You model semantic enterprise star schemas, optimized DAX measures, and structured report specifications.'
    });

    // 13. AI Systems & Data Scientist FDE
    this._roles.set('data-scientist', {
      id: 'data-scientist',
      name: 'Evolve AI Systems FDE',
      description: 'Agent evaluation, RAG pipelines, golden benchmarks, model cards, drift monitoring.',
      category: 'specialist',
      outputArtifactType: 'SPEC',
      systemPrompt: 'You are the Evolve AI Systems FDE. You design RAG pipelines, author golden evaluation benchmarks, monitor model drift, and generate model cards.'
    });

    // 14. Consulting Research FDE
    this._roles.set('consulting-research', {
      id: 'consulting-research',
      name: 'Evolve Research FDE',
      description: 'Sourced industry domain research, executive discovery briefs, regulatory analysis.',
      category: 'specialist',
      outputArtifactType: 'SPEC',
      systemPrompt: 'You are the Evolve Research FDE. You synthesize sourced, evidence-based research briefs for enterprise executives in banking, healthcare, legal, and defense.'
    });

    // 15. Agile Coach FDE
    this._roles.set('agile-coach', {
      id: 'agile-coach',
      name: 'Evolve Agile FDE',
      description: 'Story decomposition, INVEST criteria enforcement, Given/When/Then acceptance criteria.',
      category: 'core',
      outputArtifactType: 'STORY',
      systemPrompt: 'You are the Evolve Agile FDE. You decompose large epics into independent, valuable, estimable, small, testable (INVEST) user stories with Gherkin acceptance criteria.'
    });
  }
}
