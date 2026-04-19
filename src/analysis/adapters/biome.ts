/**
 * analysis/adapters/biome.ts — Biome adapter (bundled Rust binary)
 *
 * Handles JS/TS/JSX/TSX/JSON. Replaces ESLint+Prettier when no project
 * config is present (or when user opts in).
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import type { Issue, FixResult, ToolAdapter } from '../types';
import type { BinaryManager } from '../binaryManager';

export class BiomeAdapter implements ToolAdapter {
  readonly name = 'biome';
  readonly supportedLanguages = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'json', 'jsonc'];

  constructor(private readonly bins: BinaryManager) {}

  async isAvailable(projectRoot: string): Promise<boolean> {
    return (await this.bins.resolve('biome', projectRoot)) !== null;
  }

  async detectsProjectConfig(projectRoot: string): Promise<boolean> {
    return ['biome.json', 'biome.jsonc'].some(f => fs.existsSync(path.join(projectRoot, f)));
  }

  async run(args: { filePath: string; content: string; projectRoot: string }): Promise<{ issues: Issue[]; fix?: FixResult }> {
    const bin = await this.bins.resolve('biome', args.projectRoot);
    if (!bin) return { issues: [] };

    const issues = await this._lint(bin, args);
    const fix = await this._format(bin, args);
    return { issues, fix };
  }

  private _lint(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<Issue[]> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        ['lint', '--reporter=json', `--stdin-file-path=${args.filePath}`],
        { cwd: args.projectRoot, timeout: 10_000 },
        (_err, stdout) => {
          resolve(parseBiomeLintJson(stdout, args.filePath));
        }
      );
      proc.stdin?.end(args.content);
    });
  }

  private _format(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<FixResult | undefined> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        ['format', `--stdin-file-path=${args.filePath}`],
        { cwd: args.projectRoot, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout || stdout === args.content) { resolve(undefined); return; }
          resolve({
            file: args.filePath,
            originalContent: args.content,
            fixedContent: stdout,
            tool: 'biome',
            appliedRules: ['format'],
          });
        }
      );
      proc.stdin?.end(args.content);
    });
  }
}

function parseBiomeLintJson(stdout: string, filePath: string): Issue[] {
  const issues: Issue[] = [];
  if (!stdout) return issues;
  try {
    const data = JSON.parse(stdout);
    const diagnostics: any[] = data.diagnostics ?? data.summary?.diagnostics ?? [];
    for (const d of diagnostics) {
      const cat = d.category?.toString() ?? 'other';
      const msg = d.description ?? d.message?.[0]?.content ?? 'Biome issue';
      const loc = d.location?.span ?? [0, 0];
      issues.push({
        tool: 'biome',
        file: filePath,
        line: (loc.start?.line ?? 0) + 1,
        column: (loc.start?.column ?? 0) + 1,
        severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
        category: mapCategory(cat),
        rule: cat,
        message: msg,
        fixable: !!d.suggestions?.length,
        safe: isSafeRule(cat),
      });
    }
  } catch {
    // biome sometimes emits non-json on stderr; ignore
  }
  return issues;
}

function mapCategory(rule: string): Issue['category'] {
  if (rule.includes('style')) return 'style';
  if (rule.includes('suspicious') || rule.includes('correctness')) return 'correctness';
  if (rule.includes('unused')) return 'unusedVars';
  if (rule.includes('import')) return 'importOrder';
  return 'other';
}

function isSafeRule(rule: string): boolean {
  return rule.includes('style/') || rule.includes('format') || rule.includes('sort');
}
