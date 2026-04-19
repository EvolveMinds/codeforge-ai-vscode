/**
 * analysis/analysisService.ts — Code cleanup orchestrator
 *
 * Responsibilities:
 *   - Decide whether a file is in scope
 *   - Pick the right tool adapters (ESLint vs Biome vs Prettier etc.)
 *   - Run them in parallel, merge results
 *   - Cache by content hash
 *   - Partition issues into safe / risky buckets
 *
 * The applier and UI are in separate modules — this service only
 * produces a Report. It does not prompt the user or edit files.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AnalysisCache } from './cache';
import { BinaryManager } from './binaryManager';
import { createAdapters, selectAdapters } from './adapters';
import type { Issue, Report, ToolAdapter, FixResult } from './types';

export interface AnalysisServiceOptions {
  extensionPath: string;
  ctx: vscode.ExtensionContext;
}

export class AnalysisService {
  private readonly _cache = new AnalysisCache();
  private readonly _bins: BinaryManager;
  private readonly _adapters: ToolAdapter[];

  constructor(opts: AnalysisServiceOptions) {
    this._bins = new BinaryManager(opts.extensionPath);
    this._adapters = createAdapters(this._bins);
  }

  async analyze(doc: vscode.TextDocument): Promise<Report> {
    const started = Date.now();

    if (!this._inScope(doc)) {
      return this._skipped(doc, 'out-of-scope', started);
    }

    const content = doc.getText();
    const hash = AnalysisCache.hash(content);
    const cached = this._cache.get(doc.uri.fsPath, hash);
    if (cached) return cached;

    const projectRoot = this._projectRoot(doc);
    const picks = await selectAdapters(this._adapters, doc.languageId, projectRoot);

    if (picks.length === 0) {
      return this._skipped(doc, 'no-tools-available', started);
    }

    const args = { filePath: doc.uri.fsPath, content, projectRoot };
    const results = await Promise.all(picks.map(a => safeRun(a, args)));

    const issues: Issue[] = [];
    let mergedFix: FixResult | undefined;
    for (const r of results) {
      issues.push(...r.issues);
      if (r.fix && !mergedFix) mergedFix = r.fix;
      else if (r.fix && mergedFix) {
        // Chain: apply next formatter on top of previous
        mergedFix = {
          ...mergedFix,
          fixedContent: r.fix.fixedContent,
          appliedRules: [...mergedFix.appliedRules, ...r.fix.appliedRules],
          tool: `${mergedFix.tool}+${r.fix.tool}`,
        };
      }
    }

    const report: Report = {
      file: doc.uri.fsPath,
      language: doc.languageId,
      durationMs: Date.now() - started,
      issues,
      fix: mergedFix,
    };
    this._cache.set(doc.uri.fsPath, hash, report);
    return report;
  }

  invalidate(filePath?: string): void {
    this._cache.invalidate(filePath);
  }

  /** Split issues into auto-apply-safe vs prompt-required buckets. */
  partition(report: Report, autoApply: Record<string, boolean>): { safe: Issue[]; risky: Issue[] } {
    const safe: Issue[] = [];
    const risky: Issue[] = [];
    for (const iss of report.issues) {
      if (iss.safe && iss.fixable && autoApply[iss.category]) safe.push(iss);
      else risky.push(iss);
    }
    return { safe, risky };
  }

  private _inScope(doc: vscode.TextDocument): boolean {
    if (doc.uri.scheme !== 'file') return false;
    const cfg = vscode.workspace.getConfiguration('aiForge.codeAnalysis');
    const maxKb = cfg.get<number>('scope.maxFileSizeKb', 1024);
    if (doc.getText().length / 1024 > maxKb) return false;

    const excludes = cfg.get<string[]>('scope.exclude', [
      '**/node_modules/**', '**/dist/**', '**/.next/**', '**/out/**',
      '**/build/**', '**/target/**', '**/*.generated.*',
    ]);
    const rel = vscode.workspace.asRelativePath(doc.uri);
    for (const pat of excludes) {
      if (minimatchLite(rel, pat)) return false;
    }
    return true;
  }

  private _projectRoot(doc: vscode.TextDocument): string {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    return folder ? folder.uri.fsPath : path.dirname(doc.uri.fsPath);
  }

  private _skipped(doc: vscode.TextDocument, reason: string, started: number): Report {
    return {
      file: doc.uri.fsPath,
      language: doc.languageId,
      durationMs: Date.now() - started,
      issues: [],
      skipped: reason,
    };
  }
}

async function safeRun(adapter: ToolAdapter, args: { filePath: string; content: string; projectRoot: string }): Promise<{ issues: Issue[]; fix?: FixResult }> {
  try {
    return await adapter.run(args);
  } catch (e) {
    console.error(`[Evolve AI] Adapter ${adapter.name} failed:`, e);
    return { issues: [] };
  }
}

/** Minimal glob match for `**`, `*`, single-char wildcards. Good enough for exclude lists. */
function minimatchLite(input: string, pattern: string): boolean {
  const re = new RegExp(
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§/g, '.*')
      .replace(/\?/g, '.') +
    '$',
    'i'
  );
  return re.test(input.replace(/\\/g, '/'));
}
