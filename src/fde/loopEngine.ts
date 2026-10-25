/**
 * src/fde/loopEngine.ts
 *
 * Mechanical Iterative Quality Loop Engine for Evolve AI Forward Deployed Engineers.
 * Resolves GAP-05.
 *
 * Enforces risk-scaled iteration minima, SHA-256 bound verification receipts,
 * independent subagent review verdicts, and pre-commit Git blocking.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { FdeStateStore, QualityLoopState, QualityLoopIteration, LoopRiskClass } from './fdeStateStore';
export { LoopRiskClass };

export interface LoopStartOptions {
  taskTitle: string;
  riskClass?: LoopRiskClass;
  issueId?: string;
  coveredFiles?: string[];
}

export interface ReviewerVerdictInput {
  verdict: 'approved' | 'rejected' | 'changes_requested';
  reviewerId: string;
  highFindings: number;
  mediumFindings: number;
  lowFindings: number;
  notes?: string;
}

export interface IterationInput {
  summary: string;
  evidenceContent: string;
  reviewerVerdict?: ReviewerVerdictInput;
}

export class LoopEngine {
  private static _instances = new Map<string, LoopEngine>();

  public static getInstance(workspaceRoot: string): LoopEngine {
    let inst = this._instances.get(workspaceRoot);
    if (!inst) {
      inst = new LoopEngine(workspaceRoot);
      this._instances.set(workspaceRoot, inst);
    }
    return inst;
  }

  public static readonly RISK_MINIMA: Record<LoopRiskClass, number> = {
    'standard': 1,
    'auto-fix': 2,
    'complex-delivery': 3,
    'high-risk': 5
  };

  constructor(
    private readonly _workspaceRoot: string,
    private readonly _store: FdeStateStore = FdeStateStore.getInstance(_workspaceRoot)
  ) {}

  public getStatus(): { active: boolean; loop: QualityLoopState | null; message: string } {
    const loop = this._store.getLoopState();
    if (!loop || loop.status !== 'active') {
      return {
        active: false,
        loop: null,
        message: 'No active quality loop in progress.'
      };
    }

    const lastIter = loop.iterations[loop.iterations.length - 1];
    const verdict = lastIter?.reviewerVerdict?.verdict || 'pending_review';
    return {
      active: true,
      loop,
      message: `Loop [${loop.loopId}] in progress. Iteration ${loop.currentIteration}/${loop.minIterations} (${loop.riskClass}). Latest Verdict: ${verdict}`
    };
  }

  public async startLoop(opts: LoopStartOptions): Promise<QualityLoopState> {
    const existing = this._store.getLoopState();
    if (existing && existing.status === 'active') {
      throw new Error(`Active quality loop [${existing.loopId}] already in progress. Complete or reset it before starting another.`);
    }

    const riskClass = opts.riskClass || 'standard';
    const minIterations = LoopEngine.RISK_MINIMA[riskClass];

    const state: QualityLoopState = {
      loopId: `LOOP-${Date.now().toString(36).toUpperCase()}`,
      issueId: opts.issueId,
      taskTitle: opts.taskTitle,
      riskClass,
      minIterations,
      currentIteration: 0,
      status: 'active',
      iterations: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this._store.setLoopState(state);
    return state;
  }

  public async recordIteration(input: IterationInput): Promise<QualityLoopState> {
    const loop = this._requireActiveLoop();

    const sha256 = crypto.createHash('sha256').update(input.evidenceContent || '', 'utf8').digest('hex');
    const iterNumber = loop.currentIteration + 1;

    const iter: QualityLoopIteration = {
      iteration: iterNumber,
      summary: input.summary,
      evidenceSha256: sha256,
      recordedAt: Date.now(),
      reviewerVerdict: input.reviewerVerdict
    };

    loop.currentIteration = iterNumber;
    loop.iterations.push(iter);
    loop.updatedAt = Date.now();

    await this._store.setLoopState(loop);
    return loop;
  }

  public async completeLoop(summary: string, finalEvidence: string): Promise<QualityLoopState> {
    const loop = this._requireActiveLoop();

    // 1. Enforce risk-scaled minimum iteration floor
    if (loop.currentIteration < loop.minIterations) {
      throw new Error(
        `[Loop Gate Blocked] Risk tier "${loop.riskClass}" mandates at least ${loop.minIterations} verified iterations. Current: ${loop.currentIteration}`
      );
    }

    // 2. Final iteration must contain an approved reviewer verdict
    const lastIter = loop.iterations[loop.iterations.length - 1];
    if (!lastIter || !lastIter.reviewerVerdict) {
      throw new Error(
        '[Loop Gate Blocked] The final iteration requires an independent subagent reviewer verdict before completion.'
      );
    }

    const verdict = lastIter.reviewerVerdict;
    if (verdict.verdict !== 'approved') {
      throw new Error(
        `[Loop Gate Blocked] Final reviewer verdict is "${verdict.verdict}". Work cannot complete until approved.`
      );
    }

    if (verdict.highFindings > 0 || verdict.mediumFindings > 0) {
      throw new Error(
        `[Loop Gate Blocked] Unresolved defects: ${verdict.highFindings} HIGH, ${verdict.mediumFindings} MEDIUM. Must be 0/0 to complete.`
      );
    }

    loop.status = 'completed';
    loop.updatedAt = Date.now();

    // Store final evidence record
    const evidenceDir = path.join(this._workspaceRoot, 'docs', 'artifacts', 'reviews', 'loops');
    if (!fs.existsSync(evidenceDir)) {
      try { fs.mkdirSync(evidenceDir, { recursive: true }); } catch {}
    }
    const evidenceFile = path.join(evidenceDir, `${loop.loopId}-EVIDENCE.json`);
    try {
      fs.writeFileSync(evidenceFile, JSON.stringify({
        loop,
        summary,
        finalEvidenceSha256: crypto.createHash('sha256').update(finalEvidence || '', 'utf8').digest('hex'),
        completedAt: Date.now()
      }, null, 2), 'utf8');
    } catch {}

    await this._store.setLoopState(loop);
    return loop;
  }

  public async resetLoop(): Promise<void> {
    await this._store.resetLoopState();
  }

  public async recordPostLoopVerification(result: 'passed' | 'failed' | 'declined', logPath?: string): Promise<QualityLoopState> {
    const loop = this._store.getLoopState();
    if (!loop) throw new Error('No loop state found.');
    loop.verifiedPostLoop = {
      result,
      logPath,
      verifiedAt: Date.now()
    };
    await this._store.setLoopState(loop);
    return loop;
  }

  private _requireActiveLoop(): QualityLoopState {
    const loop = this._store.getLoopState();
    if (!loop || loop.status !== 'active') {
      throw new Error('No active quality loop in progress. Run "evolve loop start" first.');
    }
    return loop;
  }
}
