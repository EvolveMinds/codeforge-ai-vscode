/**
 * analysis/binaryManager.ts — Resolves paths to bundled + toolchain binaries
 *
 * Bundled binaries ship per platform (see scripts/download-binaries.js).
 * Falls back to system PATH for tools like gofmt/rustfmt/eslint/prettier.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type BinaryName = 'biome' | 'ruff' | 'gofmt' | 'rustfmt' | 'eslint' | 'prettier' | 'black';

export class BinaryManager {
  constructor(private readonly extensionPath: string) {}

  /** Resolve a binary to an absolute path, or null if not found. */
  async resolve(name: BinaryName, projectRoot: string): Promise<string | null> {
    // Bundled binaries first
    if (name === 'biome' || name === 'ruff') {
      const bundled = this._bundledPath(name);
      if (bundled && fs.existsSync(bundled)) return bundled;
    }

    // Project-installed node_modules (ESLint, Prettier)
    if (name === 'eslint' || name === 'prettier') {
      const local = this._projectBinPath(projectRoot, name);
      if (local && fs.existsSync(local)) return local;
    }

    // Python venv (Black)
    if (name === 'black') {
      const venv = this._venvBinPath(projectRoot, name);
      if (venv && fs.existsSync(venv)) return venv;
    }

    // System PATH (gofmt, rustfmt, and fallbacks)
    return this._findOnPath(name);
  }

  private _bundledPath(name: 'biome' | 'ruff'): string | null {
    const platform = this._platformTag();
    if (!platform) return null;
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(this.extensionPath, 'bin', `${name}-${platform}${ext}`);
  }

  private _platformTag(): string | null {
    const arch = os.arch();
    switch (process.platform) {
      case 'win32':  return arch === 'arm64' ? 'win32-arm64' : 'win32-x64';
      case 'darwin': return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
      case 'linux':  return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
      default:       return null;
    }
  }

  private _projectBinPath(projectRoot: string, name: string): string | null {
    const ext = process.platform === 'win32' ? '.cmd' : '';
    const p = path.join(projectRoot, 'node_modules', '.bin', `${name}${ext}`);
    return p;
  }

  private _venvBinPath(projectRoot: string, name: string): string | null {
    const subdir = process.platform === 'win32' ? 'Scripts' : 'bin';
    const ext = process.platform === 'win32' ? '.exe' : '';
    const candidates = [
      path.join(projectRoot, '.venv', subdir, `${name}${ext}`),
      path.join(projectRoot, 'venv',  subdir, `${name}${ext}`),
      path.join(projectRoot, 'env',   subdir, `${name}${ext}`),
    ];
    return candidates.find(p => fs.existsSync(p)) ?? null;
  }

  private async _findOnPath(name: string): Promise<string | null> {
    const which = process.platform === 'win32' ? 'where' : 'which';
    try {
      const { stdout } = await execFileAsync(which, [name], { timeout: 3000 });
      const first = stdout.split(/\r?\n/)[0]?.trim();
      return first || null;
    } catch {
      return null;
    }
  }
}
