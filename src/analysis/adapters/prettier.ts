/**
 * analysis/adapters/prettier.ts — Prettier (from project's node_modules)
 *
 * Format-only; emits a single FixResult when content would change.
 */

import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import type { Issue, FixResult, ToolAdapter } from '../types';
import type { BinaryManager } from '../binaryManager';

const CONFIG_FILES = [
  '.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml',
  '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.toml',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
];

export class PrettierAdapter implements ToolAdapter {
  readonly name = 'prettier';
  readonly supportedLanguages = [
    'javascript', 'typescript', 'javascriptreact', 'typescriptreact',
    'json', 'jsonc', 'css', 'scss', 'less', 'html', 'markdown', 'yaml',
  ];

  constructor(private readonly bins: BinaryManager) {}

  async isAvailable(projectRoot: string): Promise<boolean> {
    return (await this.bins.resolve('prettier', projectRoot)) !== null;
  }

  async detectsProjectConfig(projectRoot: string): Promise<boolean> {
    if (CONFIG_FILES.some(f => fs.existsSync(path.join(projectRoot, f)))) return true;
    // prettier key in package.json
    const pkg = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        return !!json.prettier;
      } catch { /* ignore */ }
    }
    return false;
  }

  async run(args: { filePath: string; content: string; projectRoot: string }): Promise<{ issues: Issue[]; fix?: FixResult }> {
    const bin = await this.bins.resolve('prettier', args.projectRoot);
    if (!bin) return { issues: [] };

    const formatted = await this._format(bin, args);
    if (!formatted || formatted === args.content) {
      return { issues: [] };
    }
    return {
      issues: [{
        tool: 'prettier',
        file: args.filePath,
        line: 1,
        column: 1,
        severity: 'info',
        category: 'style',
        rule: 'prettier/format',
        message: 'File needs formatting',
        fixable: true,
        safe: true,
      }],
      fix: {
        file: args.filePath,
        originalContent: args.content,
        fixedContent: formatted,
        tool: 'prettier',
        appliedRules: ['format'],
      },
    };
  }

  private _format(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<string | null> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        ['--stdin-filepath', args.filePath],
        { cwd: args.projectRoot, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err || !stdout) { resolve(null); return; }
          resolve(stdout);
        }
      );
      proc.stdin?.end(args.content);
    });
  }
}
