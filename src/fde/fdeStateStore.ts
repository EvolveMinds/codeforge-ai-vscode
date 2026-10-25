/**
 * src/fde/fdeStateStore.ts
 *
 * Unified Cross-Surface State Store for Evolve AI Forward Deployed Engineering (FDE).
 * Single Source of Truth persisted to `.evolve/fde_state.json` and `.evolve/state/loop-state.json`.
 *
 * Bridges the VS Code Extension, Desktop Studio (.exe), and CLI with atomic disk
 * persistence, file watching, and typed reactive events.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { FdeEngagementState } from './fdeContext';

export type LoopRiskClass = 'standard' | 'auto-fix' | 'complex-delivery' | 'high-risk';

export interface QualityLoopIteration {
  iteration: number;
  summary: string;
  evidenceSha256: string;
  recordedAt: number;
  reviewerVerdict?: {
    verdict: 'approved' | 'rejected' | 'changes_requested';
    reviewerId: string;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
    notes?: string;
  };
}

export interface QualityLoopState {
  loopId: string;
  issueId?: string;
  taskTitle: string;
  riskClass: LoopRiskClass;
  minIterations: number;
  currentIteration: number;
  status: 'active' | 'completed' | 'reset';
  iterations: QualityLoopIteration[];
  verifiedPostLoop?: {
    result: 'passed' | 'failed' | 'declined';
    logPath?: string;
    verifiedAt: number;
  };
  createdAt: number;
  updatedAt: number;
}

export class FdeStateStore extends EventEmitter {
  private static _instance: FdeStateStore | null = null;
  private _evolveDir: string;
  private _stateFile: string;
  private _loopFile: string;
  private _stateWatcher: fs.FSWatcher | null = null;
  private _loopWatcher: fs.FSWatcher | null = null;
  private _currentState: FdeEngagementState;
  private _currentLoop: QualityLoopState | null = null;
  private _isWriting = false;

  private constructor(private readonly _workspaceRoot: string) {
    super();
    this._evolveDir = path.join(this._workspaceRoot, '.evolve');
    const stateDir = path.join(this._evolveDir, 'state');
    if (!fs.existsSync(stateDir)) {
      try {
        fs.mkdirSync(stateDir, { recursive: true });
      } catch {}
    }

    this._stateFile = path.join(this._evolveDir, 'fde_state.json');
    this._loopFile = path.join(stateDir, 'loop-state.json');

    this._currentState = this._loadStateFromDisk();
    this._currentLoop = this._loadLoopFromDisk();
    this._setupWatchers();
  }

  public static getInstance(workspaceRoot: string): FdeStateStore {
    if (!FdeStateStore._instance || FdeStateStore._instance._workspaceRoot !== workspaceRoot) {
      if (FdeStateStore._instance) {
        FdeStateStore._instance.dispose();
      }
      FdeStateStore._instance = new FdeStateStore(workspaceRoot);
    }
    return FdeStateStore._instance;
  }

  public dispose(): void {
    if (this._stateWatcher) {
      try { this._stateWatcher.close(); } catch {}
      this._stateWatcher = null;
    }
    if (this._loopWatcher) {
      try { this._loopWatcher.close(); } catch {}
      this._loopWatcher = null;
    }
  }

  // ── Engagement State API ──────────────────────────────────────────────────

  public getState(): FdeEngagementState {
    return JSON.parse(JSON.stringify(this._currentState));
  }

  public async setState(state: FdeEngagementState, source: 'vscode' | 'desktop' | 'cli' = 'cli'): Promise<void> {
    this._currentState = { ...state, updatedAt: Date.now() };
    await this._flushStateToDisk();
    this.emit('state:changed', this.getState(), source);
  }

  public async updatePhaseState<K extends keyof FdeEngagementState>(
    phase: K,
    data: Partial<FdeEngagementState[K]>,
    source: 'vscode' | 'desktop' | 'cli' = 'cli'
  ): Promise<void> {
    if (typeof this._currentState[phase] === 'object' && this._currentState[phase] !== null && !Array.isArray(this._currentState[phase])) {
      this._currentState[phase] = { ...this._currentState[phase], ...data } as any;
    } else {
      this._currentState[phase] = data as any;
    }
    this._currentState.updatedAt = Date.now();
    await this._flushStateToDisk();
    this.emit('state:changed', this.getState(), source);
  }

  // ── Quality Loop State API ───────────────────────────────────────────────

  public getLoopState(): QualityLoopState | null {
    if (!this._currentLoop) return null;
    return JSON.parse(JSON.stringify(this._currentLoop));
  }

  public async setLoopState(loop: QualityLoopState): Promise<void> {
    this._currentLoop = { ...loop, updatedAt: Date.now() };
    await this._flushLoopToDisk();
    this.emit('loop:changed', this.getLoopState());
  }

  public async resetLoopState(): Promise<void> {
    if (this._currentLoop) {
      this._currentLoop.status = 'reset';
      this._currentLoop.updatedAt = Date.now();
      await this._flushLoopToDisk();
    }
    this._currentLoop = null;
    if (fs.existsSync(this._loopFile)) {
      try { await fs.promises.unlink(this._loopFile); } catch {}
    }
    this.emit('loop:changed', null);
  }

  // ── Persistence Helpers ──────────────────────────────────────────────────

  private _loadStateFromDisk(): FdeEngagementState {
    try {
      if (fs.existsSync(this._stateFile)) {
        const raw = fs.readFileSync(this._stateFile, 'utf8');
        if (raw.trim()) {
          return JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn(`[FdeStateStore] Error loading ${this._stateFile}:`, e);
    }
    return this._createDefaultState();
  }

  private _loadLoopFromDisk(): QualityLoopState | null {
    try {
      if (fs.existsSync(this._loopFile)) {
        const raw = fs.readFileSync(this._loopFile, 'utf8');
        if (raw.trim()) {
          return JSON.parse(raw);
        }
      }
    } catch (e) {
      console.warn(`[FdeStateStore] Error loading ${this._loopFile}:`, e);
    }
    return null;
  }

  private async _flushStateToDisk(): Promise<void> {
    this._isWriting = true;
    try {
      if (!fs.existsSync(this._evolveDir)) {
        await fs.promises.mkdir(this._evolveDir, { recursive: true });
      }
      const tempPath = `${this._stateFile}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
      await fs.promises.writeFile(tempPath, JSON.stringify(this._currentState, null, 2), 'utf8');
      await fs.promises.rename(tempPath, this._stateFile);
    } finally {
      setTimeout(() => { this._isWriting = false; }, 200);
    }
  }

  private async _flushLoopToDisk(): Promise<void> {
    if (!this._currentLoop) return;
    this._isWriting = true;
    try {
      const stateDir = path.dirname(this._loopFile);
      if (!fs.existsSync(stateDir)) {
        await fs.promises.mkdir(stateDir, { recursive: true });
      }
      const tempPath = `${this._loopFile}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
      await fs.promises.writeFile(tempPath, JSON.stringify(this._currentLoop, null, 2), 'utf8');
      await fs.promises.rename(tempPath, this._loopFile);
    } finally {
      setTimeout(() => { this._isWriting = false; }, 200);
    }
  }

  private _setupWatchers(): void {
    try {
      if (fs.existsSync(this._stateFile)) {
        this._stateWatcher = fs.watch(this._stateFile, () => this._onStateDiskChange());
      } else {
        // Watch directory to catch file creation
        const dirWatcher = fs.watch(this._evolveDir, (event, filename) => {
          if (filename === 'fde_state.json' && fs.existsSync(this._stateFile)) {
            dirWatcher.close();
            this._setupWatchers();
            this._onStateDiskChange();
          }
        });
      }
    } catch {}

    try {
      const stateDir = path.dirname(this._loopFile);
      if (fs.existsSync(stateDir)) {
        this._loopWatcher = fs.watch(stateDir, (event, filename) => {
          if (filename === 'loop-state.json') {
            this._onLoopDiskChange();
          }
        });
      }
    } catch {}
  }

  private _onStateDiskChange(): void {
    if (this._isWriting) return;
    try {
      const reloaded = this._loadStateFromDisk();
      if (JSON.stringify(reloaded) !== JSON.stringify(this._currentState)) {
        this._currentState = reloaded;
        this.emit('state:changed', this.getState(), 'external');
      }
    } catch {}
  }

  private _onLoopDiskChange(): void {
    if (this._isWriting) return;
    try {
      const reloaded = this._loadLoopFromDisk();
      if (JSON.stringify(reloaded) !== JSON.stringify(this._currentLoop)) {
        this._currentLoop = reloaded;
        this.emit('loop:changed', this.getLoopState());
      }
    } catch {}
  }

  private _createDefaultState(): FdeEngagementState {
    return {
      id: `ENG-${Date.now().toString(36).toUpperCase()}`,
      clientName: 'New Client Engagement',
      engagementGoal: 'Enterprise Pilot Modernization & AI Delivery',
      targetVpc: 'gcp-firebase',
      activePhase: 1,
      completedPhases: [],
      studioMode: 'DEMO',
      schemaMappings: [],
      apiConnectors: [],
      discoveredEnvVars: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
}
