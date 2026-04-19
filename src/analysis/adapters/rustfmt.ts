/**
 * analysis/adapters/rustfmt.ts — rustfmt (from Rust toolchain on PATH)
 *
 * Uses stdin via --emit=stdout.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Issue, FixResult, ToolAdapter } from '../types';
import type { BinaryManager } from '../binaryManager';

export class RustfmtAdapter implements ToolAdapter {
  readonly name = 'rustfmt';
  readonly supportedLanguages = ['rust'];

  constructor(private readonly bins: BinaryManager) {}

  async isAvailable(projectRoot: string): Promise<boolean> {
    return (await this.bins.resolve('rustfmt', projectRoot)) !== null;
  }

  async detectsProjectConfig(projectRoot: string): Promise<boolean> {
    return fs.existsSync(path.join(projectRoot, 'rustfmt.toml'))
        || fs.existsSync(path.join(projectRoot, '.rustfmt.toml'))
        || fs.existsSync(path.join(projectRoot, 'Cargo.toml'));
  }

  async run(args: { filePath: string; content: string; projectRoot: string }): Promise<{ issues: Issue[]; fix?: FixResult }> {
    const bin = await this.bins.resolve('rustfmt', args.projectRoot);
    if (!bin) return { issues: [] };

    const formatted = await this._format(bin, args);
    if (!formatted || formatted === args.content) {
      return { issues: [] };
    }
    return {
      issues: [{
        tool: 'rustfmt',
        file: args.filePath,
        line: 1,
        column: 1,
        severity: 'info',
        category: 'style',
        rule: 'rustfmt',
        message: 'File needs rustfmt formatting',
        fixable: true,
        safe: true,
      }],
      fix: {
        file: args.filePath,
        originalContent: args.content,
        fixedContent: formatted,
        tool: 'rustfmt',
        appliedRules: ['rustfmt'],
      },
    };
  }

  private _format(bin: string, args: { filePath: string; content: string; projectRoot: string }): Promise<string | null> {
    return new Promise(resolve => {
      const proc = execFile(
        bin,
        ['--emit=stdout'],
        { cwd: args.projectRoot, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : stdout)
      );
      proc.stdin?.end(args.content);
    });
  }
}
