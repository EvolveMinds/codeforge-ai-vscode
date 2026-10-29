/**
 * core/agent/agentRunner.ts — Autonomous Multi-Turn Agent Loop & Build Coordinator
 *
 * Orchestrates autonomous multi-turn tool loops, coordinating:
 * 1. Spec reading & code search
 * 2. Multi-file generation across Java backend and Vue frontend
 * 3. Gradle / Vite build verification
 * 4. Self-correction of compiler errors until 0 errors remain.
 */

import type { IAIService } from '../interfaces';
import type { SessionManager } from '../session/sessionManager';
import { AgentTools } from './agentTools';
import { BuildVerifier, type VerificationResult } from './buildVerifier';
import { GovernancePrimer } from './governancePrimer';

export interface AgentRunnerOptions {
  workspaceRoot: string;
  aiService: IAIService;
  sessionManager: SessionManager;
  maxTurns?: number;
  onProgress?: (step: string, detail?: string) => void;
  onFileTouched?: (filePath: string) => void;
  signal?: AbortSignal;
}

export interface AgentRunSummary {
  success: boolean;
  filesTouched: string[];
  totalTurns: number;
  lastBuildStatus: 'success' | 'failed' | 'untested';
  durationMs: number;
  message: string;
}

export class AgentRunner {
  private _tools: AgentTools;
  private _verifier: BuildVerifier;
  private _primer: GovernancePrimer;

  constructor(private readonly _opts: AgentRunnerOptions) {
    this._tools = new AgentTools(_opts.workspaceRoot);
    this._verifier = new BuildVerifier(_opts.workspaceRoot, this._tools);
    this._primer = new GovernancePrimer(_opts.workspaceRoot);
  }

  public async runBuild(instruction: string): Promise<AgentRunSummary> {
    const startTime = Date.now();
    const maxTurns = this._opts.maxTurns ?? 6;
    const filesTouchedSet = new Set<string>();

    this._opts.onProgress?.('🚀 Initiating Autonomous Build Agent', 'Inspecting workspace layout and governance rules');

    // 1. Prime System Prompt with Project Governance
    const systemPrompt = this._primer.assembleSystemPrompt(
      'You are Evolve AI Autonomous Agent. Execute the user build request by reading specs, writing coordinated files, and verifying builds.'
    );

    let currentPrompt = instruction;
    let turnCount = 0;
    let lastBuildStatus: 'success' | 'failed' | 'untested' = 'untested';
    let finalMessage = '';

    while (turnCount < maxTurns) {
      if (this._opts.signal?.aborted) {
        return {
          success: false,
          filesTouched: Array.from(filesTouchedSet),
          totalTurns: turnCount,
          lastBuildStatus: 'untested',
          durationMs: Date.now() - startTime,
          message: 'Build cancelled by user.',
        };
      }

      turnCount++;
      this._opts.onProgress?.(`Turn ${turnCount}/${maxTurns}: Reasoning & Generating Code`);

      // Record prompt in session
      await this._opts.sessionManager.addMessageToActiveSession({
        role: 'user',
        content: currentPrompt,
      });

      // Call AI Service
      const activeSession = this._opts.sessionManager.getActiveSession();
      let aiOutput = '';
      try {
        aiOutput = await this._opts.aiService.send({
          messages: activeSession.messages.map(m => ({ role: m.role, content: m.content })),
          system: systemPrompt,
          instruction: currentPrompt,
          mode: 'new',
          providerOverride: activeSession.provider,
          modelOverride: activeSession.model,
          signal: this._opts.signal,
        });
      } catch (err: any) {
        return {
          success: false,
          filesTouched: Array.from(filesTouchedSet),
          totalTurns: turnCount,
          lastBuildStatus,
          durationMs: Date.now() - startTime,
          message: `AI call failed: ${err.message}`,
        };
      }

      await this._opts.sessionManager.addMessageToActiveSession({
        role: 'assistant',
        content: aiOutput,
      });

      // Parse and apply multi-file outputs or tool calls
      const parsedFiles = this.parseFilesFromOutput(aiOutput);
      for (const file of parsedFiles) {
        this._opts.onProgress?.(`Writing: ${file.path}`);
        await this._tools.writeFile(file.path, file.content);
        filesTouchedSet.add(file.path);
        this._opts.onFileTouched?.(file.path);
        await this._opts.sessionManager.recordFileTouched(file.path);
      }

      // Check if files were written: if so, trigger automated build verification!
      if (parsedFiles.length > 0) {
        this._opts.onProgress?.('⚙️ Running Workspace Build Verification', 'Executing compiler and test checks');
        const verifyRes: VerificationResult = await this._verifier.runVerification();

        if (verifyRes.passed) {
          lastBuildStatus = 'success';
          finalMessage = `Build verification passed (${verifyRes.commandRun}) in ${Math.round(verifyRes.durationMs / 1000)}s! ${parsedFiles.length} file(s) generated with 0 errors.`;
          this._opts.onProgress?.('✅ Build Succeeded!', finalMessage);
          break;
        } else {
          lastBuildStatus = 'failed';
          this._opts.onProgress?.('⚠️ Build Failed', `Compiler reported ${verifyRes.diagnostics.length} diagnostic(s). Retrying self-correction...`);
          currentPrompt = verifyRes.selfCorrectionPrompt || 'Compilation failed. Please fix the compiler errors.';
          continue;
        }
      } else {
        // No files written in this turn: check if model concluded or needs guidance
        finalMessage = aiOutput.slice(0, 300);
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const isSuccess = lastBuildStatus === 'success' || (filesTouchedSet.size > 0 && lastBuildStatus !== 'failed');

    await this._opts.sessionManager.updateActiveSession({
      stats: {
        toolCallCount: filesTouchedSet.size,
        lastBuildStatus,
        durationMs,
      },
    });

    return {
      success: isSuccess,
      filesTouched: Array.from(filesTouchedSet),
      totalTurns: turnCount,
      lastBuildStatus,
      durationMs,
      message: finalMessage || (isSuccess ? 'Build completed successfully.' : 'Build reached turn limit.'),
    };
  }

  public parseFilesFromOutput(output: string): Array<{ path: string; content: string }> {
    const files: Array<{ path: string; content: string }> = [];

    // Pattern 1: ## filename.ext\n```code```
    const p1 = /^#{1,4}\s+(?:(?:file\s*name|filename|file|path)\s*[:\-]?\s*)?[*`"']*([\w./\\-]+\.\w+)[*`"']*\s*\n+```[\w]*\n([\s\S]*?)```/gim;
    let m: RegExpExecArray | null;
    while ((m = p1.exec(output)) !== null) {
      files.push({
        path: m[1].trim(),
        content: m[2].trim(),
      });
    }

    // Pattern 2: <write_file path="...">...</write_file>
    const p2 = /<write_file\s+path=["']([^"']+)["']>\s*([\s\S]*?)\s*<\/write_file>/gim;
    while ((m = p2.exec(output)) !== null) {
      files.push({
        path: m[1].trim(),
        content: m[2].trim(),
      });
    }

    return files;
  }
}
