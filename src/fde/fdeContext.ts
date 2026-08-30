/**
 * fde/fdeContext.ts — Forward Deployed Engineer (FDE) engagement state management
 *
 * Tracks the live state of a client engagement across the 4 delivery phases:
 *   1. Data & Schema Ingest
 *   2. Client API Connectors
 *   3. Pilot Deployment & Pre-Flight Delivery
 *   4. Client Handoff & Runbooks
 *
 * Persists session state to VS Code workspaceState so context is shared across
 * tools, wizards, and panels without re-entering parameters.
 */

import * as vscode from 'vscode';

export interface MappedColumn {
  sourceColumn: string;
  targetColumn: string;
  sourceType: string;
  targetType: string;
  confidence: number;
  transformation?: string;
  notes?: string;
}

export interface SchemaMappingSession {
  sourceName: string;
  targetModelName: string;
  dialect: 'dbt' | 'pyspark' | 'sql_view';
  columns: MappedColumn[];
  unmappedSource: string[];
  unmappedTarget: string[];
  createdAt: number;
}

export interface ApiConnectorSession {
  connectorName: string;
  targetLanguage: 'typescript' | 'python';
  baseUrl: string;
  authType: 'bearer' | 'apiKey' | 'oauth2' | 'basic' | 'none';
  endpoints: Array<{
    name: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    description?: string;
  }>;
  createdAt: number;
}

export interface DeploymentSession {
  clientName: string;
  environment: 'dev' | 'test' | 'pilot' | 'prod';
  targetVpc: 'gcp-firebase' | 'aws' | 'docker' | 'azure';
  frontendTarget?: string;
  backendService?: string;
  cpu?: string;
  memory?: string;
  gpu?: string;
  ingress?: string;
  minInstances?: number;
  maxInstances?: number;
  secretsProvider?: string;
  vpcId?: string;
  subnetId?: string;
  securityGroups?: string;
  discoveredCloudResources?: {
    provider?: string;
    vpcs?: string[];
    subnets?: string[];
    clusters?: string[];
    regions?: string[];
    authenticated?: boolean;
    activeAccount?: string;
    activeProject?: string;
  };
  lastPreflightScore?: number;
  lastPreflightIssuesCount?: number;
  deployedAt?: number;
}

export interface DataMartJoin {
  joinType: 'LEFT' | 'INNER' | 'FULL';
  joinModel: string;
  onCondition: string;
}

export interface DataMartMetric {
  name: string;
  expr: string;
  description?: string;
}

export interface DataMartSession {
  martName: string;
  baseModel: string;
  joins: DataMartJoin[];
  dimensions: string[];
  metrics: DataMartMetric[];
  dialect: 'dbt' | 'pyspark' | 'sql_view';
  generatedSql?: string;
  createdAt: number;
}

export interface FdeEngagementState {
  id: string;
  clientName: string;
  engagementGoal: string;
  targetVpc: 'gcp-firebase' | 'aws' | 'docker' | 'azure';
  activePhase: 1 | 2 | 3 | 4 | 5;
  completedPhases: number[];
  schemaMappings: SchemaMappingSession[];
  dataMarts?: DataMartSession[];
  apiConnectors: ApiConnectorSession[];
  deployment?: DeploymentSession;
  activeDbConnection?: {
    dialect: string;
    host?: string;
    database?: string;
    schema?: string;
    lastConnectedTable?: string;
  };
  discoveredEnvVars: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface FdeWorkspaceStore {
  activeProjectId: string;
  projects: FdeEngagementState[];
}

const FDE_STORE_KEY = 'evolve.fde.workspaceStore';
const FDE_LEGACY_KEY = 'evolve.fde.engagementState';

export class FdeContextManager {
  constructor(private readonly _vsCtx: vscode.ExtensionContext) {}

  private _createDefaultProject(id = 'proj-default', name = 'Client Pilot Engagement'): FdeEngagementState {
    return {
      id,
      clientName: name,
      engagementGoal: 'Deploy standard platform integration & data pipeline on client infrastructure',
      targetVpc: 'gcp-firebase',
      activePhase: 1,
      completedPhases: [],
      schemaMappings: [],
      dataMarts: [],
      apiConnectors: [],
      discoveredEnvVars: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  getStore(): FdeWorkspaceStore {
    const rawStore = this._vsCtx.workspaceState.get<FdeWorkspaceStore>(FDE_STORE_KEY);
    if (rawStore && rawStore.projects && rawStore.projects.length > 0) {
      // Ensure active project exists
      const activeExists = rawStore.projects.some(p => p.id === rawStore.activeProjectId);
      if (!activeExists) {
        rawStore.activeProjectId = rawStore.projects[0].id;
      }
      return rawStore;
    }

    // Migrate from legacy single-state if present
    const legacy = this._vsCtx.workspaceState.get<FdeEngagementState>(FDE_LEGACY_KEY);
    if (legacy && legacy.clientName) {
      const proj: FdeEngagementState = {
        ...legacy,
        id: legacy.id || 'proj-1',
        createdAt: legacy.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      const store: FdeWorkspaceStore = {
        activeProjectId: proj.id,
        projects: [proj],
      };
      this._vsCtx.workspaceState.update(FDE_STORE_KEY, store);
      return store;
    }

    const defaultProj = this._createDefaultProject();
    return {
      activeProjectId: defaultProj.id,
      projects: [defaultProj],
    };
  }

  async saveStore(store: FdeWorkspaceStore): Promise<void> {
    await this._vsCtx.workspaceState.update(FDE_STORE_KEY, store);
  }

  getAllProjects(): FdeEngagementState[] {
    return this.getStore().projects;
  }

  getState(): FdeEngagementState {
    const store = this.getStore();
    return store.projects.find(p => p.id === store.activeProjectId) || store.projects[0];
  }

  async updateState(updater: (prev: FdeEngagementState) => FdeEngagementState): Promise<FdeEngagementState> {
    const store = this.getStore();
    const activeIdx = store.projects.findIndex(p => p.id === store.activeProjectId);
    const current = activeIdx >= 0 ? store.projects[activeIdx] : store.projects[0];
    const next = { ...updater(current), updatedAt: Date.now() };

    if (activeIdx >= 0) {
      store.projects[activeIdx] = next;
    } else {
      store.projects.push(next);
      store.activeProjectId = next.id;
    }

    await this.saveStore(store);
    return next;
  }

  async createProject(name: string, targetVpc: 'gcp-firebase' | 'aws' | 'docker' | 'azure' = 'gcp-firebase', goal?: string): Promise<FdeEngagementState> {
    const store = this.getStore();
    const newId = `proj-${Date.now().toString(36)}`;
    const newProj: FdeEngagementState = {
      id: newId,
      clientName: name.trim() || 'New Client Engagement',
      engagementGoal: goal?.trim() || 'Deploy platform integration and pipeline',
      targetVpc,
      activePhase: 1,
      completedPhases: [],
      schemaMappings: [],
      apiConnectors: [],
      discoveredEnvVars: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.projects.push(newProj);
    store.activeProjectId = newId;
    await this.saveStore(store);
    return newProj;
  }

  async switchProject(projectId: string): Promise<FdeEngagementState> {
    const store = this.getStore();
    const target = store.projects.find(p => p.id === projectId);
    if (target) {
      store.activeProjectId = projectId;
      await this.saveStore(store);
      return target;
    }
    return this.getState();
  }

  async deleteProject(projectId: string): Promise<FdeWorkspaceStore> {
    const store = this.getStore();
    store.projects = store.projects.filter(p => p.id !== projectId);
    if (store.projects.length === 0) {
      const def = this._createDefaultProject();
      store.projects = [def];
      store.activeProjectId = def.id;
    } else if (store.activeProjectId === projectId) {
      store.activeProjectId = store.projects[0].id;
    }
    await this.saveStore(store);
    return store;
  }

  async resetCurrentProject(): Promise<FdeEngagementState> {
    return this.updateState(s => ({
      ...s,
      activePhase: 1,
      completedPhases: [],
      schemaMappings: [],
      dataMarts: [],
      apiConnectors: [],
      deployment: undefined,
      discoveredEnvVars: [],
      updatedAt: Date.now(),
    }));
  }

  async deleteSchemaMapping(sourceName: string): Promise<void> {
    await this.updateState(s => {
      const filtered = s.schemaMappings.filter(m => m.sourceName !== sourceName);
      const completed = filtered.length === 0 ? s.completedPhases.filter(p => p !== 1) : s.completedPhases;
      return { ...s, schemaMappings: filtered, completedPhases: completed };
    });
  }

  async deleteDataMart(martName: string): Promise<void> {
    await this.updateState(s => {
      const filtered = (s.dataMarts || []).filter(m => m.martName !== martName);
      return { ...s, dataMarts: filtered };
    });
  }

  async recordDataMart(mart: DataMartSession): Promise<void> {
    await this.updateState(s => {
      const existing = (s.dataMarts || []).filter(m => m.martName !== mart.martName);
      return { ...s, dataMarts: [...existing, mart] };
    });
  }

  async deleteApiConnector(connectorName: string): Promise<void> {
    await this.updateState(s => {
      const filtered = s.apiConnectors.filter(c => c.connectorName !== connectorName);
      const completed = filtered.length === 0 ? s.completedPhases.filter(p => p !== 2) : s.completedPhases;
      return { ...s, apiConnectors: filtered, completedPhases: completed };
    });
  }

  async recordSchemaMapping(mapping: SchemaMappingSession): Promise<void> {
    await this.updateState(s => {
      const mappings = [...s.schemaMappings.filter(m => m.sourceName !== mapping.sourceName), mapping];
      const completed = Array.from(new Set([...s.completedPhases, 1]));
      return { ...s, schemaMappings: mappings, completedPhases: completed, activePhase: Math.max(s.activePhase, 2) as 1 | 2 | 3 | 4 };
    });
  }

  async recordApiConnector(connector: ApiConnectorSession): Promise<void> {
    await this.updateState(s => {
      const connectors = [...s.apiConnectors.filter(c => c.connectorName !== connector.connectorName), connector];
      const completed = Array.from(new Set([...s.completedPhases, 2]));
      return { ...s, apiConnectors: connectors, completedPhases: completed, activePhase: Math.max(s.activePhase, 3) as 1 | 2 | 3 | 4 };
    });
  }

  async recordDeployment(deployment: DeploymentSession): Promise<void> {
    await this.updateState(s => {
      const completed = Array.from(new Set([...s.completedPhases, 3]));
      return { ...s, deployment, completedPhases: completed, activePhase: 4 };
    });
  }

  async recordDeploymentSettings(settings: Partial<DeploymentSession>): Promise<void> {
    await this.updateState(s => {
      const existing: DeploymentSession = s.deployment || {
        clientName: s.clientName,
        environment: 'pilot',
        targetVpc: s.targetVpc,
      };
      return {
        ...s,
        deployment: {
          ...existing,
          ...settings,
        }
      };
    });
  }

  async recordRunbooksGenerated(): Promise<void> {
    await this.updateState(s => {
      const completed = Array.from(new Set([...s.completedPhases, 4]));
      return { ...s, completedPhases: completed, activePhase: 4 };
    });
  }

  async recordDbConnection(conn: { dialect: string; host?: string; database?: string; schema?: string; lastConnectedTable?: string }): Promise<void> {
    await this.updateState(s => {
      return { ...s, activeDbConnection: conn };
    });
  }

  private static _cachedTables: any[] = [];

  getLastIntrospectedTables(): any[] {
    const fromState = this._vsCtx.workspaceState.get<any[]>('evolve.fde.cachedTables');
    if (fromState && fromState.length > 0) return fromState;
    return FdeContextManager._cachedTables || [];
  }

  async recordIntrospectedTables(tables: any[]): Promise<void> {
    FdeContextManager._cachedTables = tables || [];
    await this._vsCtx.workspaceState.update('evolve.fde.cachedTables', tables || []);
  }

  async addDiscoveredEnvVars(vars: string[]): Promise<void> {
    await this.updateState(s => {
      const merged = Array.from(new Set([...s.discoveredEnvVars, ...vars]));
      return { ...s, discoveredEnvVars: merged };
    });
  }
}

