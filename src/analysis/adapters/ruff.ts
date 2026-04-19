/**
 * analysis/adapters/ruff.ts — Ruff adapter (bundled Rust binary)
 *
 * Handles Python. Replaces flake8 + isort + pyupgrade + partial black.
 * Runs 'check' for lint issues and 'format' for formatting.
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import type { Issue, FixResult, ToolAdapter } from '../types';
import type { BinaryManager } from '../binaryManager';

export class RuffAdapter implements ToolAdapter {
  readonly name = 'ruff';
  readonly supportedLanguages = ['python'];

  constructor(private readonly bins: BinaryManager) {}

  async isAvailable(projectRoot: string): Promise<boolean> {
    return (await this.bins.resolve('ruff', projectRoot)) !== null;
  }

  async detectsProjectConfig(projectRoot: string): Promise<boolean> {
    const files = ['pyproject.toml', 'ruff.toml', '.ruff.toml'];
    return files.some(f => fs.existsSync(path.join(projectRoot, f)));
  }

  async run(args: { filePath: string; content: string; projectRoot: string }): Promise<{ issues: Issue[]; fix?: FixResult }> {
    const bin = await this.bins.resolve('ruff', args.projectRoot);
    if (!bin) return { issues: [] };

    const issues = await this._check(bin, args);
    const fix = await this._format(bin, args);
    return { issues, fix };
  }

  private _check(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<Issue[]> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        ['check', '--output-format=json', '--stdin-filename', args.filePath, '-'],
        { cwd: args.projectRoot, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
        (_err, stdout) => {
          resolve(parseRuffJson(stdout, args.filePath));
        }
      );
      proc.stdin?.end(args.content);
    });
  }

  private _format(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<FixResult | undefined> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        ['format', '--stdin-filename', args.filePath, '-'],
        { cwd: args.projectRoot, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout || stdout === args.content) { resolve(undefined); return; }
          resolve({
            file: args.filePath,
            originalContent: args.content,
            fixedContent: stdout,
            tool: 'ruff',
            appliedRules: ['format'],
          });
        }
      );
      proc.stdin?.end(args.content);
    });
  }
}

function parseRuffJson(stdout: string, filePath: string): Issue[] {
  const issues: Issue[] = [];
  if (!stdout) return issues;
  try {
    const data = JSON.parse(stdout);
    for (const d of data) {
      const code = d.code ?? 'ruff';
      issues.push({
        tool: 'ruff',
        file: filePath,
        line: d.location?.row ?? 1,
        column: d.location?.column ?? 1,
        endLine: d.end_location?.row,
        endColumn: d.end_location?.column,
        severity: 'warning',
        category: mapRuffCategory(code),
        rule: code,
        message: d.message ?? 'Ruff issue',
        fixable: !!d.fix,
        safe: isSafeRuffRule(code),
      });
    }
  } catch {
    // ignore
  }
  return issues;
}

function mapRuffCategory(code: string): Issue['category'] {
  if (code.startsWith('I') || code.startsWith('F401')) return 'importOrder';
  if (code.startsWith('F841') || code.startsWith('F811')) return 'unusedVars';
  if (code.startsWith('E') || code.startsWith('W')) return 'style';
  return 'other';
}

function isSafeRuffRule(code: string): boolean {
  return code.startsWith('I') || code.startsWith('E') || code.startsWith('W') || code.startsWith('Q');
}
