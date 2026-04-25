/**
 * ui/lineageProviders.ts — CodeLens, Hover, Completion, Diagnostics for lineage (DE #1)
 *
 * All four providers read from LineageStore so they share a single resolved
 * snapshot per file. They add no AI calls on their own — pure data views over
 * what ContextService already resolved for the prompt.
 */

import * as vscode from 'vscode';
import type { LineageSchema, LineageColumn, LineageRef } from '../core/plugin';
import type { FileContext } from '../core/contextService';
import { LineageStore }      from './lineageStore';
import { extractDbtRefs }    from '../plugins/dbtLineage';
import { extractSparkRefs }  from '../plugins/databricksLineage';

// Shared: collect every ref a file contains (for UI positioning).
function refsForFile(doc: vscode.TextDocument): LineageRef[] {
  const file: FileContext = {
    path:     doc.uri.fsPath,
    relPath:  vscode.workspace.asRelativePath(doc.uri),
    content:  doc.getText(),
    language: doc.languageId,
  };
  // Both extractors are resilient to non-matching files and return [].
  return [...extractDbtRefs(file), ...extractSparkRefs(file)];
}

function findSchema(schemas: LineageSchema[], fqn: string): LineageSchema | undefined {
  const lower = fqn.toLowerCase();
  return schemas.find(s =>
    s.fqn.toLowerCase() === lower ||
    s.displayName.toLowerCase() === lower ||
    s.displayName.toLowerCase().endsWith(`.${lower}`),
  );
}

function formatAge(hours?: number): string | undefined {
  if (hours === undefined) return undefined;
  if (hours < 1) return 'built <1h ago';
  if (hours < 24) return `built ${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `built ${days}d ago`;
}

// ── CodeLens provider ────────────────────────────────────────────────────────

export class LineageCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly _store: LineageStore) {
    _store.onDidChange(() => this._onDidChange.fire());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const snap = this._store.get(doc.uri);
    if (!snap) return [];
    const refs = refsForFile(doc);
    if (refs.length === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    for (const ref of refs) {
      const line = Math.max(0, ref.origin.line - 1);
      const range = new vscode.Range(line, 0, line, 0);
      const schema = findSchema(snap.schemas, ref.fqn);
      if (schema) {
        const age = formatAge(schema.meta?.staleHours);
        const stale = (schema.meta?.staleHours ?? 0) > 24;
        const icon = stale ? '$(warning)' : '$(database)';
        const label = `${icon} ${schema.displayName} — ${schema.columns.length} columns${age ? `, ${age}` : ''}`;
        lenses.push(new vscode.CodeLens(range, {
          title: label,
          command: 'aiForge.lineage.showPanel',
          arguments: [schema.fqn],
          tooltip: stale
            ? 'Schema may be stale. Run `dbt compile` to refresh.'
            : 'Click to view columns, types, tests, and descriptions.',
        }));
      } else {
        // Broken ref — highlights typos before dbt run
        lenses.push(new vscode.CodeLens(range, {
          title: `$(error) ${ref.fqn} — not resolved (check name / run dbt compile)`,
          command: 'aiForge.lineage.showPanel',
          arguments: [],
        }));
      }
    }
    return lenses;
  }
}

// ── Hover provider ───────────────────────────────────────────────────────────

export class LineageHoverProvider implements vscode.HoverProvider {
  constructor(private readonly _store: LineageStore) {}

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const snap = this._store.get(doc.uri);
    if (!snap || snap.schemas.length === 0) return undefined;

    const wordRange = doc.getWordRangeAtPosition(pos, /[\w.]+/);
    if (!wordRange) return undefined;
    const word = doc.getText(wordRange);

    // 1. Hovering over a table name (possibly dotted)
    const tableSchema = findSchema(snap.schemas, word);
    if (tableSchema) return new vscode.Hover(renderSchemaHover(tableSchema), wordRange);

    // 2. Hovering over `table.column`
    if (word.includes('.')) {
      const parts = word.split('.');
      const col = parts[parts.length - 1];
      const tbl = parts.slice(0, -1).join('.');
      const schema = findSchema(snap.schemas, tbl);
      const column = schema?.columns.find(c => c.name.toLowerCase() === col.toLowerCase());
      if (schema && column) {
        return new vscode.Hover(renderColumnHover(schema, column), wordRange);
      }
    }

    // 3. Hovering over a bare column name — match if unambiguous across schemas
    const matches: Array<{ schema: LineageSchema; col: LineageColumn }> = [];
    for (const s of snap.schemas) {
      for (const c of s.columns) {
        if (c.name.toLowerCase() === word.toLowerCase()) matches.push({ schema: s, col: c });
      }
    }
    if (matches.length === 1) {
      return new vscode.Hover(renderColumnHover(matches[0].schema, matches[0].col), wordRange);
    }
    return undefined;
  }
}

function renderSchemaHover(s: LineageSchema): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  const age = formatAge(s.meta?.staleHours);
  md.appendMarkdown(`**${s.displayName}** _(${s.source.replace('_', ' ')}${age ? `, ${age}` : ''})_\n\n`);
  if (s.meta?.note) md.appendMarkdown(`> ${s.meta.note}\n\n`);
  md.appendMarkdown(`**Columns (${s.columns.length}):**\n\n`);
  for (const c of s.columns.slice(0, 15)) {
    const tests = c.testsPass?.length ? ` _tests: ${c.testsPass.join('+')}_` : '';
    const tags = c.tags?.length ? ` _tags: ${c.tags.join(',')}_` : '';
    md.appendMarkdown(`- \`${c.name}\` \`${c.type}\`${tests}${tags}${c.description ? ` — ${c.description}` : ''}\n`);
  }
  if (s.columns.length > 15) md.appendMarkdown(`\n_...and ${s.columns.length - 15} more_\n`);
  return md;
}

function renderColumnHover(s: LineageSchema, c: LineageColumn): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.appendMarkdown(`**${c.name}** — \`${c.type}\`\n\n`);
  md.appendMarkdown(`_from ${s.displayName}_\n\n`);
  if (c.description) md.appendMarkdown(`${c.description}\n\n`);
  if (c.testsPass?.length) md.appendMarkdown(`Tests passing: ${c.testsPass.join(', ')}\n\n`);
  if (c.tags?.length) md.appendMarkdown(`Tags: ${c.tags.join(', ')}\n`);
  return md;
}

// ── Completion provider ──────────────────────────────────────────────────────

export class LineageCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly _store: LineageStore) {}

  provideCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
  ): vscode.CompletionItem[] {
    const snap = this._store.get(doc.uri);
    if (!snap || snap.schemas.length === 0) return [];

    // Match "tablename." before cursor to pick the target table
    const linePrefix = doc.lineAt(pos).text.slice(0, pos.character);
    const dotMatch = linePrefix.match(/([\w.]+)\.$/);
    if (!dotMatch) return [];
    const tableRef = dotMatch[1];

    const schema = findSchema(snap.schemas, tableRef);
    if (!schema) return [];

    return schema.columns.map(c => {
      const item = new vscode.CompletionItem(c.name, vscode.CompletionItemKind.Field);
      item.detail = c.type;
      const md = new vscode.MarkdownString();
      if (c.description) md.appendMarkdown(c.description);
      if (c.testsPass?.length) md.appendMarkdown(`\n\n_Tests: ${c.testsPass.join(', ')}_`);
      item.documentation = md;
      item.sortText = `0_${c.name}`;  // rank above generic suggestions
      return item;
    });
  }
}

// ── Diagnostics provider (broken refs) ───────────────────────────────────────

export class LineageDiagnostics {
  private readonly _collection: vscode.DiagnosticCollection;

  constructor(private readonly _store: LineageStore, vsCtx: vscode.ExtensionContext) {
    this._collection = vscode.languages.createDiagnosticCollection('aiForge.lineage');
    vsCtx.subscriptions.push(this._collection);

    _store.onDidChange(snap => this._refreshFor(snap.uri));
    vsCtx.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(doc => this._collection.delete(doc.uri)),
    );
  }

  private _refreshFor(uri: vscode.Uri): void {
    const snap = this._store.get(uri);
    if (!snap) { this._collection.delete(uri); return; }
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (!doc) return;

    const refs = refsForFile(doc);
    const diagnostics: vscode.Diagnostic[] = [];
    for (const ref of refs) {
      const schema = findSchema(snap.schemas, ref.fqn);
      if (schema) continue;
      // Only flag dbt refs/sources — sql_table refs may be CTEs or temp tables
      if (ref.kind !== 'dbt_ref' && ref.kind !== 'dbt_source') continue;

      const line = Math.max(0, ref.origin.line - 1);
      const lineText = doc.lineAt(line).text;
      const col = Math.max(0, ref.origin.col - 1);
      // Highlight just the ref token if we can find it
      const fqnIdx = lineText.indexOf(ref.fqn, col);
      const start = fqnIdx >= 0 ? fqnIdx : col;
      const end   = fqnIdx >= 0 ? fqnIdx + ref.fqn.length : col + 1;
      const range = new vscode.Range(line, start, line, end);

      const suggestions = suggestCloseMatches(ref.fqn, snap.schemas);
      const hint = suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(', ')}?`
        : ' Run `dbt compile` to refresh the manifest, or check the name.';
      const diag = new vscode.Diagnostic(
        range,
        `Evolve AI: lineage cannot resolve '${ref.fqn}'.${hint}`,
        vscode.DiagnosticSeverity.Warning,
      );
      diag.source = 'aiForge.lineage';
      diag.code   = 'unresolved-ref';
      diagnostics.push(diag);
    }
    this._collection.set(uri, diagnostics);
  }
}

function suggestCloseMatches(name: string, schemas: LineageSchema[]): string[] {
  const lower = name.toLowerCase();
  const candidates = schemas.map(s => s.fqn);
  // Simple substring / prefix / Levenshtein distance ≤ 2
  const scored: Array<{ c: string; score: number }> = [];
  for (const c of candidates) {
    const cl = c.toLowerCase();
    if (cl === lower) continue;
    const d = levenshtein(lower, cl);
    if (d <= 2 || cl.includes(lower) || lower.includes(cl)) {
      scored.push({ c, score: d });
    }
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, 3).map(s => s.c);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prevDiag = prev[j];
      prev[j] = cur;
    }
  }
  return prev[b.length];
}

// ── Registration helper ──────────────────────────────────────────────────────

const SELECTORS: vscode.DocumentSelector = [
  { language: 'sql' },
  { language: 'python' },
  { language: 'jinja-sql' },
  { pattern: '**/*.sql' },
  { pattern: '**/*.py' },
  { pattern: '**/*.ipynb' },
];

export function registerLineageProviders(
  vsCtx: vscode.ExtensionContext,
  store: LineageStore,
): void {
  const codeLens   = new LineageCodeLensProvider(store);
  const hover      = new LineageHoverProvider(store);
  const completion = new LineageCompletionProvider(store);

  vsCtx.subscriptions.push(
    vscode.languages.registerCodeLensProvider(SELECTORS, codeLens),
    vscode.languages.registerHoverProvider(SELECTORS, hover),
    vscode.languages.registerCompletionItemProvider(SELECTORS, completion, '.'),
  );

  new LineageDiagnostics(store, vsCtx);
}
