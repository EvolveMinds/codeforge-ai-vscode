/**
 * analysis/adapters/gofmt.ts — gofmt (from Go toolchain on PATH)
 *
 * No bundled binary — we assume anyone writing Go has Go installed.
 * Emits a single format fix when output differs.
 */

import { execFile } from 'child_process';
import type { Issue, FixResult, ToolAdapter } from '../types';
import type { BinaryManager } from '../binaryManager';

export class GofmtAdapter implements ToolAdapter {
  readonly name = 'gofmt';
  readonly supportedLanguages = ['go'];

  constructor(private readonly bins: BinaryManager) {}

  async isAvailable(projectRoot: string): Promise<boolean> {
    return (await this.bins.resolve('gofmt', projectRoot)) !== null;
  }

  async detectsProjectConfig(): Promise<boolean> {
    return true; // gofmt has no config — always correct to run
  }

  async run(args: { filePath: string; content: string; projectRoot: string }): Promise<{ issues: Issue[]; fix?: FixResult }> {
    const bin = await this.bins.resolve('gofmt', args.projectRoot);
    if (!bin) return { issues: [] };

    const formatted = await this._format(bin, args);
    if (!formatted || formatted === args.content) {
      return { issues: [] };
    }
    return {
      issues: [{
        tool: 'gofmt',
        file: args.filePath,
        line: 1,
        column: 1,
        severity: 'info',
        category: 'style',
        rule: 'gofmt',
        message: 'File needs gofmt formatting',
        fixable: true,
        safe: true,
      }],
      fix: {
        file: args.filePath,
        originalContent: args.content,
        fixedContent: formatted,
        tool: 'gofmt',
        appliedRules: ['gofmt'],
      },
    };
  }

  private _format(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<string | null> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        [],
        { cwd: args.projectRoot, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : stdout)
      );
      proc.stdin?.end(args.content);
    });
  }
}
