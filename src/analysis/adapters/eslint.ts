/**
 * analysis/adapters/eslint.ts — ESLint (uses project's node_modules install)
 *
 * Only activates when the project has an ESLint config file. Uses
 * --stdin so the user's rules + plugins apply.
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import type { Issue, FixResult, ToolAdapter } from '../types';
import type { BinaryManager } from '../binaryManager';

const CONFIG_FILES = [
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
];

export class ESLintAdapter implements ToolAdapter {
  readonly name = 'eslint';
  readonly supportedLanguages = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'];

  constructor(private readonly bins: BinaryManager) {}

  async isAvailable(projectRoot: string): Promise<boolean> {
    return (await this.bins.resolve('eslint', projectRoot)) !== null;
  }

  async detectsProjectConfig(projectRoot: string): Promise<boolean> {
    return CONFIG_FILES.some(f => fs.existsSync(path.join(projectRoot, f)));
  }

  async run(args: { filePath: string; content: string; projectRoot: string }): Promise<{ issues: Issue[]; fix?: FixResult }> {
    const bin = await this.bins.resolve('eslint', args.projectRoot);
    if (!bin) return { issues: [] };

    const issues = await this._lint(bin, args, false);
    const fix = await this._fix(bin, args);
    return { issues, fix };
  }

  private _lint(bin: string, args: { filePath: string; content: string; projectRoot: string }, fixMode: boolean): Promise<Issue[]> {
    return new Promise(resolve => {
      const cliArgs = ['--stdin', '--stdin-filename', args.filePath, '--format=json'];
      if (fixMode) cliArgs.push('--fix-dry-run');
      const proc = execFile(
        bin,
        cliArgs,
        { cwd: args.projectRoot, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
        (_err, stdout) => resolve(parseESLintJson(stdout, args.filePath))
      );
      proc.stdin?.end(args.content);
    });
  }

  private _fix(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<FixResult | undefined> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        ['--stdin', '--stdin-filename', args.filePath, '--fix-dry-run', '--format=json'],
        { cwd: args.projectRoot, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
        (_err, stdout) => {
          try {
            const arr = JSON.parse(stdout);
            const output = arr?.[0]?.output;
            if (!output || output === args.content) { resolve(undefined); return; }
            resolve({
              file: args.filePath,
              originalContent: args.content,
              fixedContent: output,
              tool: 'eslint',
              appliedRules: ['--fix'],
            });
          } catch {
            resolve(undefined);
          }
        }
      );
      proc.stdin?.end(args.content);
    });
  }
}

function parseESLintJson(stdout: string, filePath: string): Issue[] {
  const issues: Issue[] = [];
  if (!stdout) return issues;
  try {
    const arr = JSON.parse(stdout);
    const result = arr?.[0];
    if (!result) return issues;
    for (const m of result.messages ?? []) {
      issues.push({
        tool: 'eslint',
        file: filePath,
        line: m.line ?? 1,
        column: m.column ?? 1,
        endLine: m.endLine,
        endColumn: m.endColumn,
        severity: m.severity === 2 ? 'error' : 'warning',
        category: categoryFromRule(m.ruleId ?? ''),
        rule: m.ruleId ?? 'eslint',
        message: m.message ?? 'ESLint issue',
        fixable: !!m.fix,
        safe: isSafeESLintRule(m.ruleId ?? ''),
      });
    }
  } catch {
    // ignore
  }
  return issues;
}

function categoryFromRule(rule: string): Issue['category'] {
  if (rule.includes('no-unused')) return 'unusedVars';
  if (rule.includes('quotes')) return 'quotes';
  if (rule.includes('semi')) return 'semicolons';
  if (rule.includes('import')) return 'importOrder';
  if (rule.includes('any')) return 'anyTypes';
  if (rule.includes('space') || rule.includes('indent')) return 'whitespace';
  return 'other';
}

function isSafeESLintRule(rule: string): boolean {
  const safePatterns = ['quotes', 'semi', 'indent', 'space', 'import/order', 'prefer-const'];
  return safePatterns.some(p => rule.includes(p));
}
