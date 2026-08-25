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
  lastPreflightScore?: number;
  lastPreflightIssuesCount?: number;
  deployedAt?: number;
}

export interface FdeEngagementState {
  clientName: string;
  engagementGoal: string;
  targetVpc: 'gcp-firebase' | 'aws' | 'docker' | 'azure';
  activePhase: 1 | 2 | 3 | 4;
  completedPhases: number[];
  schemaMappings: SchemaMappingSession[];
  apiConnectors: ApiConnectorSession[];
  deployment?: DeploymentSession;
  discoveredEnvVars: string[];
}

const FDE_STATE_KEY = 'evolve.fde.engagementState';

export class FdeContextManager {
  constructor(private readonly _vsCtx: vscode.ExtensionContext) {}

  getState(): FdeEngagementState {
    const defaultState: FdeEngagementState = {
      clientName: 'Client Pilot Engagement',
      engagementGoal: 'Deploy standard platform integration & data pipeline on client infrastructure',
      targetVpc: 'gcp-firebase',
      activePhase: 1,
      completedPhases: [],
      schemaMappings: [],
      apiConnectors: [],
      discoveredEnvVars: [],
    };

    return this._vsCtx.workspaceState.get<FdeEngagementState>(FDE_STATE_KEY, defaultState);
  }

  async updateState(updater: (prev: FdeEngagementState) => FdeEngagementState): Promise<FdeEngagementState> {
    const current = this.getState();
    const next = updater(current);
    await this._vsCtx.workspaceState.update(FDE_STATE_KEY, next);
    return next;
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

  async addDiscoveredEnvVars(vars: string[]): Promise<void> {
    await this.updateState(s => {
      const merged = Array.from(new Set([...s.discoveredEnvVars, ...vars]));
      return { ...s, discoveredEnvVars: merged };
    });
  }
}
