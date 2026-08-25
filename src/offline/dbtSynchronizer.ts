/**
 * offline/dbtSynchronizer.ts — Deterministic dbt SQL to schema.yml synchronizer
 *
 * 100% offline & rule-based. Extracts projected columns from dbt SQL models
 * and scaffolds or synchronizes missing columns and test definitions in schema.yml.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface DbtSyncResult {
  modelName: string;
  yamlPath: string;
  isNewFile: boolean;
  addedColumns: string[];
  totalColumns: number;
  updatedYamlContent: string;
}

export class DbtSynchronizer {
  /**
   * Synchronizes schema YAML for a given dbt SQL document
   */
  static async syncModelYaml(document: vscode.TextDocument): Promise<DbtSyncResult | null> {
    const sqlPath = document.uri.fsPath;
    if (!sqlPath.endsWith('.sql')) return null;

    const sqlContent = document.getText();
    const modelName = path.basename(sqlPath, '.sql');
    const modelDir = path.dirname(sqlPath);

    // 1. Extract projected columns from the SQL content
    const columns = DbtSynchronizer.extractColumnsFromSql(sqlContent);
    if (columns.length === 0) {
      return null;
    }

    // 2. Locate schema.yml or models.yml in the same directory or create schema.yml
    let yamlPath = path.join(modelDir, 'schema.yml');
    if (!fs.existsSync(yamlPath)) {
      const altModelsPath = path.join(modelDir, 'models.yml');
      const altUnderPath = path.join(modelDir, `_${modelName}.yml`);
      if (fs.existsSync(altModelsPath)) yamlPath = altModelsPath;
      else if (fs.existsSync(altUnderPath)) yamlPath = altUnderPath;
    }

    let isNewFile = !fs.existsSync(yamlPath);
    let existingYaml = isNewFile ? '' : fs.readFileSync(yamlPath, 'utf8');

    const syncResult = DbtSynchronizer.mergeColumnsIntoYaml(existingYaml, modelName, columns);

    // Write updated content to file
    fs.writeFileSync(yamlPath, syncResult.updatedYamlContent, 'utf8');

    return {
      modelName,
      yamlPath,
      isNewFile,
      addedColumns: syncResult.addedColumns,
      totalColumns: columns.length,
      updatedYamlContent: syncResult.updatedYamlContent,
    };
  }

  /**
   * Rule-based extraction of output column aliases / names from SQL
   */
  static extractColumnsFromSql(sql: string): string[] {
    const cleaned = sql
      .replace(/--.*$/gm, '') // remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // remove block comments
      .replace(/\{#[\s\S]*?#\}/g, ''); // remove Jinja comments

    // Find the last top-level SELECT statement (after all CTEs)
    const selectMatches = [...cleaned.matchAll(/\bSELECT\b([\s\S]*?)\bFROM\b/gi)];
    if (selectMatches.length === 0) return [];

    const finalSelectBody = selectMatches[selectMatches.length - 1][1];
    const rawCols = DbtSynchronizer._splitSelectColumns(finalSelectBody);

    const columnNames: string[] = [];
    for (const raw of rawCols) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '*') continue;

      // Check for explicit alias: `expr AS alias` or `expr alias`
      const asMatch = trimmed.match(/\bAS\s+([a-zA-Z0-9_`"\[\]]+)$/i);
      if (asMatch) {
        columnNames.push(asMatch[1].replace(/[`"\[\]]/g, ''));
        continue;
      }

      // Check for implicit alias or single column reference: e.g. `col_name` or `tbl.col_name`
      const simpleMatch = trimmed.match(/(?:[a-zA-Z0-9_`"\[\]]+\.)?([a-zA-Z0-9_`"\[\]]+)$/);
      if (simpleMatch) {
        const name = simpleMatch[1].replace(/[`"\[\]]/g, '');
        if (!['ASC', 'DESC', 'NULL', 'DISTINCT'].includes(name.toUpperCase())) {
          columnNames.push(name);
        }
      }
    }

    return [...new Set(columnNames)];
  }

  private static _splitSelectColumns(selectClause: string): string[] {
    const cols: string[] = [];
    let current = '';
    let parenDepth = 0;
    let inQuote: string | null = null;

    for (let i = 0; i < selectClause.length; i++) {
      const char = selectClause[i];

      if (inQuote) {
        current += char;
        if (char === inQuote && selectClause[i - 1] !== '\\') {
          inQuote = null;
        }
        continue;
      }

      if (char === "'" || char === '"' || char === '`') {
        inQuote = char;
        current += char;
        continue;
      }

      if (char === '(') {
        parenDepth++;
        current += char;
        continue;
      }
      if (char === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        current += char;
        continue;
      }

      if (char === ',' && parenDepth === 0) {
        cols.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      cols.push(current);
    }

    return cols;
  }

  /**
   * Merges extracted columns into existing or new schema.yml content
   */
  static mergeColumnsIntoYaml(existingYaml: string, modelName: string, columns: string[]): { updatedYamlContent: string; addedColumns: string[] } {
    const addedColumns: string[] = [];

    if (!existingYaml.trim()) {
      const lines: string[] = [
        'version: 2',
        '',
        'models:',
        `  - name: ${modelName}`,
        `    description: "Documentation for ${modelName}"`,
        '    columns:',
      ];

      for (const col of columns) {
        lines.push(`      - name: ${col}`);
        lines.push(`        description: ""`);
        addedColumns.push(col);
      }

      return {
        updatedYamlContent: lines.join('\n') + '\n',
        addedColumns,
      };
    }

    // Existing YAML: find model block
    const modelRegex = new RegExp(`(^|\\n)([ \\t]*)-[ \\t]+name:[ \\t]*['"]?${modelName}['"]?`, 'i');
    const match = existingYaml.match(modelRegex);

    if (!match) {
      // Model not in existing YAML: append model block
      const lines = [
        existingYaml.trimEnd(),
        '',
        `  - name: ${modelName}`,
        `    description: "Documentation for ${modelName}"`,
        '    columns:',
      ];
      for (const col of columns) {
        lines.push(`      - name: ${col}`);
        lines.push(`        description: ""`);
        addedColumns.push(col);
      }
      return {
        updatedYamlContent: lines.join('\n') + '\n',
        addedColumns,
      };
    }

    // Model exists: check existing column names
    const existingColRegex = /-[ \t]+name:[ \t]*['"]?([a-zA-Z0-9_]+)['"]?/g;
    const foundExistingCols = new Set<string>();
    let colMatch: RegExpExecArray | null;
    while ((colMatch = existingColRegex.exec(existingYaml)) !== null) {
      foundExistingCols.add(colMatch[1].toLowerCase());
    }

    const missingColumns = columns.filter(c => !foundExistingCols.has(c.toLowerCase()));
    if (missingColumns.length === 0) {
      return {
        updatedYamlContent: existingYaml,
        addedColumns: [],
      };
    }

    // Append missing columns to the columns list of the model
    const newColLines = missingColumns.map(col => {
      addedColumns.push(col);
      return `      - name: ${col}\n        description: ""`;
    }).join('\n');

    // Find where columns are defined or insert columns section
    let updated = existingYaml;
    if (updated.includes('columns:')) {
      updated = updated.replace(/(columns:[ \t]*\r?\n)/i, `$1${newColLines}\n`);
    } else {
      updated = updated.replace(modelRegex, `$1$2- name: ${modelName}\n    columns:\n${newColLines}`);
    }

    return {
      updatedYamlContent: updated,
      addedColumns,
    };
  }
}
