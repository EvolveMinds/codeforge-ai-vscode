/**
 * offline/index.ts — Zero-AI Offline Developer & Data Engineering Suite entry point
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import { SqlFormatter } from './sqlFormatter';
import { SqlDialect } from './sqlDialects';
import { DataProfilerPanel } from '../ui/dataProfilerPanel';
import { WorkbenchPanel } from '../ui/workbenchPanel';
import { DbtSynchronizer } from './dbtSynchronizer';
import { InfraLinters } from './infraLinters';
import { CodeModernizer } from './codeModernizer';
import { AirGapModeManager } from './airGapMode';

export function registerOfflineSuite(vsCtx: vscode.ExtensionContext, svc: IServices): void {
  // 1. Air-Gapped Mode Manager
  const airGapMgr = AirGapModeManager.register(svc);

  // 2. Multi-Dialect SQL Document & Range Formatter Provider
  const sqlFormatProvider: vscode.DocumentFormattingEditProvider & vscode.DocumentRangeFormattingEditProvider = {
    provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions): vscode.TextEdit[] {
      const text = document.getText();
      const config = vscode.workspace.getConfiguration('aiForge.sql');
      const dialect = config.get<SqlDialect>('dialect', 'ansi');
      const keywordCase = config.get<'upper' | 'lower' | 'preserve'>('keywordCase', 'upper');
      const commaStyle = config.get<'trailing' | 'leading'>('commaStyle', 'trailing');

      const formatted = SqlFormatter.format(text, {
        dialect,
        tabWidth: options.tabSize || 2,
        useTabs: !options.insertSpaces,
        keywordCase,
        commaStyle,
      });

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length),
      );
      return [vscode.TextEdit.replace(fullRange, formatted)];
    },

    provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions): vscode.TextEdit[] {
      const text = document.getText(range);
      const config = vscode.workspace.getConfiguration('aiForge.sql');
      const dialect = config.get<SqlDialect>('dialect', 'ansi');
      const keywordCase = config.get<'upper' | 'lower' | 'preserve'>('keywordCase', 'upper');
      const commaStyle = config.get<'trailing' | 'leading'>('commaStyle', 'trailing');

      const formatted = SqlFormatter.format(text, {
        dialect,
        tabWidth: options.tabSize || 2,
        useTabs: !options.insertSpaces,
        keywordCase,
        commaStyle,
      });

      return [vscode.TextEdit.replace(range, formatted)];
    },
  };

  vsCtx.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider({ language: 'sql' }, sqlFormatProvider),
    vscode.languages.registerDocumentRangeFormattingEditProvider({ language: 'sql' }, sqlFormatProvider),
  );

  // 3. Offline Infra Linters Diagnostic Collection
  const infraDiagnostics = vscode.languages.createDiagnosticCollection('evolve-infra-linters');
  vsCtx.subscriptions.push(infraDiagnostics);

  const runInfraLinting = (doc: vscode.TextDocument) => {
    if (!doc || doc.isClosed) return;
    const lang = doc.languageId;
    const fileName = doc.fileName.toLowerCase();

    if (lang === 'terraform' || fileName.endsWith('.tf') || fileName.endsWith('.tofu')) {
      const issues = InfraLinters.lintTerraform(doc);
      const diagnostics = issues.map(iss => {
        const diag = new vscode.Diagnostic(iss.range, `[${iss.ruleId}] ${iss.message}`, iss.severity);
        diag.source = 'Evolve AI (Offline Linter)';
        return diag;
      });
      infraDiagnostics.set(doc.uri, diagnostics);
    } else if (lang === 'dockerfile' || fileName.endsWith('dockerfile') || fileName.includes('dockerfile.')) {
      const issues = InfraLinters.lintDockerfile(doc);
      const diagnostics = issues.map(iss => {
        const diag = new vscode.Diagnostic(iss.range, `[${iss.ruleId}] ${iss.message}`, iss.severity);
        diag.source = 'Evolve AI (Offline Linter)';
        return diag;
      });
      infraDiagnostics.set(doc.uri, diagnostics);
    }
  };

  vsCtx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(runInfraLinting),
    vscode.workspace.onDidSaveTextDocument(runInfraLinting),
    vscode.workspace.onDidChangeTextDocument(e => runInfraLinting(e.document)),
  );

  if (vscode.window.activeTextEditor) {
    runInfraLinting(vscode.window.activeTextEditor.document);
  }

  // 4. Command Registrations
  vsCtx.subscriptions.push(
    // SQL Formatter
    vscode.commands.registerCommand('aiForge.sql.format', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active SQL file to format.');
        return;
      }
      await vscode.commands.executeCommand('editor.action.formatDocument');
      vscode.window.setStatusBarMessage('Evolve AI: SQL formatted (offline)', 2000);
    }),

    // Data Profiler
    vscode.commands.registerCommand('aiForge.dataProfiler.profileActive', async () => {
      await DataProfilerPanel.profileActiveFile(svc);
    }),

    // dbt Schema YAML Sync
    vscode.commands.registerCommand('aiForge.dbt.syncSchemaYaml', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.endsWith('.sql')) {
        vscode.window.showInformationMessage('Open a dbt .sql model to sync schema.yml.');
        return;
      }
      const res = await DbtSynchronizer.syncModelYaml(editor.document);
      if (res) {
        const action = res.isNewFile ? 'Created' : 'Updated';
        vscode.window.showInformationMessage(
          `✓ ${action} ${res.yamlPath} (${res.addedColumns.length} columns added to "${res.modelName}")`,
        );
      } else {
        vscode.window.showInformationMessage('No projected columns found in model to sync.');
      }
    }),

    // Cron & Regex Workbench
    vscode.commands.registerCommand('aiForge.workbench.showCron', () => {
      WorkbenchPanel.show(svc, 'cron');
    }),
    vscode.commands.registerCommand('aiForge.workbench.showRegex', () => {
      WorkbenchPanel.show(svc, 'regex');
    }),

    // Code Modernizers
    vscode.commands.registerCommand('aiForge.modernize.python', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || (editor.document.languageId !== 'python' && !editor.document.fileName.endsWith('.py'))) {
        vscode.window.showInformationMessage('Open a Python file to modernize.');
        return;
      }
      const text = editor.document.getText();
      const res = CodeModernizer.modernizePython(text);
      if (res.modified) {
        const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
        await editor.edit(editBuilder => editBuilder.replace(fullRange, res.code));
        vscode.window.showInformationMessage(`✓ Modernized Python code: ${res.changesSummary.join(', ')}`);
      } else {
        vscode.window.showInformationMessage('Python code is already modern (PEP 604/585, pathlib compliant).');
      }
    }),

    vscode.commands.registerCommand('aiForge.modernize.javascript', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a JavaScript/TypeScript file to modernize.');
        return;
      }
      const text = editor.document.getText();
      const res = CodeModernizer.modernizeJavaScript(text);
      if (res.modified) {
        const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
        await editor.edit(editBuilder => editBuilder.replace(fullRange, res.code));
        vscode.window.showInformationMessage(`✓ Modernized JS/TS code: ${res.changesSummary.join(', ')}`);
      } else {
        vscode.window.showInformationMessage('JS/TS code is already modern (ESM compliant).');
      }
    }),

    // Strict Air-Gap Toggle
    vscode.commands.registerCommand('aiForge.offline.toggleStrictAirGap', async () => {
      await airGapMgr.toggleStrictAirGap();
    }),
  );
}
