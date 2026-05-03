/**
 * ui/dbtImpactProvider.ts — CodeLens at top of every dbt model file (DE #3)
 *
 *   $(symbol-class) 4 downstream models · 1 exposure · 12 tests
 *
 * Click → opens the impact panel for this model.
 *
 * The lens is added at line 0 of any .sql file under a dbt project's models/
 * directory that has a matching node in the manifest. Files without a
 * manifest entry get nothing (silent — same UX as missing manifest in DE #1).
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import {
  loadManifest,
  findDbtProjectRoot,
  getModelByFile,
  getDownstream,
} from '../plugins/dbtManifest';

export class DbtImpactCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  fireRefresh(): void { this._onDidChange.fire(); }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('aiForge');
    if (!cfg.get<boolean>('dbt.impactCodeLensEnabled', true)) return [];

    const filePath = doc.uri.fsPath;
    if (!filePath.toLowerCase().endsWith('.sql')) return [];
    const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!ws) return [];
    const projectRoot = findDbtProjectRoot(path.dirname(filePath), ws.uri.fsPath);
    if (!projectRoot) return [];

    const manifest = loadManifest(projectRoot);
    if (!manifest) return [];
    const match = getModelByFile(projectRoot, filePath);
    if (!match) return [];

    const depth = cfg.get<number>('dbt.impactDepth', 5);
    const ds = getDownstream(projectRoot, match.node.name, depth);
    if (!ds) return [];

    const parts: string[] = [];
    parts.push(`${ds.transitiveModels.length} downstream`);
    if (ds.exposures.length > 0) parts.push(`${ds.exposures.length} exposure${ds.exposures.length === 1 ? '' : 's'}`);
    parts.push(`${ds.totalTests} test${ds.totalTests === 1 ? '' : 's'}`);
    if (ds.truncated) parts.push('truncated');

    const range = new vscode.Range(0, 0, 0, 0);
    return [new vscode.CodeLens(range, {
      title: `$(symbol-class) Impact: ${parts.join(' · ')}`,
      command: 'aiForge.dbt.impact',
      arguments: [doc.uri],
      tooltip: 'Open the impact panel for this dbt model',
    })];
  }
}

const SELECTORS: vscode.DocumentSelector = [
  { language: 'sql' },
  { language: 'jinja-sql' },
  { pattern: '**/*.sql' },
];

export function registerDbtImpactProvider(vsCtx: vscode.ExtensionContext): DbtImpactCodeLensProvider {
  const provider = new DbtImpactCodeLensProvider();
  vsCtx.subscriptions.push(vscode.languages.registerCodeLensProvider(SELECTORS, provider));
  // Refresh when the user saves or switches files (manifest may have changed)
  vsCtx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => provider.fireRefresh()),
  );
  return provider;
}
