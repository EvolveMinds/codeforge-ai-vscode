/**
 * ui/queryAnalysisProviders.ts — CodeLens + Hover for query cost preview (DE #2)
 *
 * For every SQL statement detected in the active file, show a CodeLens above
 * line 1 of the statement:
 *   - "$(zap) Preview cost (Databricks)" before any analysis runs
 *   - "$(zap) 12.3 GB · ~$0.06 · 2 warnings" after a cached analysis
 *   - "$(error) EXPLAIN failed: …" when the engine rejected the SQL
 *
 * Clicking the lens runs the analyzer (if not cached) and opens the panel.
 * The lens only appears when at least one analyzer supports the file —
 * otherwise it's invisible.
 */

import * as vscode from 'vscode';
import type { FileContext } from '../core/contextService';
import { QueryAnalysisStore }    from './queryAnalysisStore';
import { extractStatementsFromFile, summariseAnalysisOneLine } from '../plugins/queryAnalysis';
import { sha1 }                  from '../plugins/queryAnalysis';

function fileFromDoc(doc: vscode.TextDocument): FileContext {
  return {
    path:     doc.uri.fsPath,
    relPath:  vscode.workspace.asRelativePath(doc.uri),
    content:  doc.getText(),
    language: doc.languageId,
  };
}

// ── CodeLens ─────────────────────────────────────────────────────────────────

export class QueryAnalysisCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly _store: QueryAnalysisStore) {
    _store.onDidChange(() => this._onDidChange.fire());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const file = fileFromDoc(doc);
    if (!this._store.hasAnalyzerFor(file)) return [];
    const analyzer = this._store.pickAnalyzer(file);
    if (!analyzer) return [];

    const stmts = extractStatementsFromFile(file.content, file.language, file.relPath);
    if (stmts.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    for (const s of stmts) {
      const line = Math.max(0, s.startLine - 1);
      const range = new vscode.Range(line, 0, line, 0);
      const cached = this._store.get(sha1(s.sql));
      let title: string;
      if (cached?.error) {
        title = `$(error) ${cached.error.slice(0, 80)}`;
      } else if (cached) {
        title = `$(zap) ${analyzer.displayName}: ${summariseAnalysisOneLine(cached)}`;
      } else {
        title = `$(zap) Preview cost via ${analyzer.displayName}`;
      }
      lenses.push(new vscode.CodeLens(range, {
        title,
        command: 'aiForge.queryAnalysis.runForStatement',
        arguments: [doc.uri, s.sql, s.startLine, s.endLine],
        tooltip: 'Click to analyse this query (no actual execution).',
      }));
    }
    return lenses;
  }
}

// ── Hover (rich preview when cached) ─────────────────────────────────────────

export class QueryAnalysisHoverProvider implements vscode.HoverProvider {
  constructor(private readonly _store: QueryAnalysisStore) {}

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const file = fileFromDoc(doc);
    if (!this._store.hasAnalyzerFor(file)) return undefined;

    // Find the statement at pos
    const stmts = extractStatementsFromFile(file.content, file.language, file.relPath);
    const stmt = stmts.find(s => pos.line + 1 >= s.startLine && pos.line + 1 <= s.endLine);
    if (!stmt) return undefined;
    const cached = this._store.get(sha1(stmt.sql));
    if (!cached) return undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    md.appendMarkdown(`**Query cost preview** _(${cached.engine})_\n\n`);
    if (cached.error) {
      md.appendMarkdown(`❌ ${cached.error}\n`);
      return new vscode.Hover(md);
    }
    if (cached.bytesScanned !== undefined)     md.appendMarkdown(`- Bytes scanned: \`${formatBytes(cached.bytesScanned)}\`\n`);
    if (cached.estimatedCostUsd !== undefined) md.appendMarkdown(`- Estimated cost: \`${formatUsd(cached.estimatedCostUsd)}\`\n`);
    if (cached.rowsProcessed !== undefined)    md.appendMarkdown(`- Rows: \`${cached.rowsProcessed.toLocaleString()}\`\n`);
    if (cached.tablesRead && cached.tablesRead.length > 0) {
      md.appendMarkdown(`- Tables: ${cached.tablesRead.map(t => `\`${t.fqn}\``).join(', ')}\n`);
    }
    if (cached.warnings.length > 0) {
      md.appendMarkdown(`\n**Warnings:**\n`);
      for (const w of cached.warnings) md.appendMarkdown(`- ${w.message}\n`);
    }
    return new vscode.Hover(md);
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  const u = ['KB','MB','GB','TB','PB']; let v = n / 1024; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}
function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n < 0.01) return '<$0.01';
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

// ── Registration ─────────────────────────────────────────────────────────────

const SELECTORS: vscode.DocumentSelector = [
  { language: 'sql' },
  { language: 'python' },
  { language: 'jinja-sql' },
  { pattern: '**/*.sql' },
  { pattern: '**/*.py' },
  { pattern: '**/*.ipynb' },
];

export function registerQueryAnalysisProviders(
  vsCtx: vscode.ExtensionContext,
  store: QueryAnalysisStore,
): void {
  const codeLens = new QueryAnalysisCodeLensProvider(store);
  const hover    = new QueryAnalysisHoverProvider(store);
  vsCtx.subscriptions.push(
    vscode.languages.registerCodeLensProvider(SELECTORS, codeLens),
    vscode.languages.registerHoverProvider(SELECTORS, hover),
  );
}
