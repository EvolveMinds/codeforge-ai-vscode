/**
 * plugins/pythonStudio/pythonRuntime.ts
 *
 * Isolated Python Sandbox Runner & Virtual Environment Manager.
 * Responsibilities:
 *  - Discovers or initializes high-speed virtual environments via `uv` or `venv`
 *  - Resolves active Python interpreter paths across platforms
 *  - Spawns isolated terminals with injected enterprise cloud credentials
 *  - Executes fast syntax compilation and tests without blocking VS Code
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import { CloudDeployHook } from './cloudDeployHook';

export interface ExecutionResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

export class PythonRuntime {
  private static _terminal: vscode.Terminal | undefined;

  /**
   * Resolves the primary Python binary in the workspace.
   * Prefers active candidate venv, falls back to system Python.
   */
  static resolvePythonInterpreter(wsPath: string, activeVenvPath?: string): string {
    const isWin = process.platform === 'win32';

    // 1. Specified venv
    if (activeVenvPath) {
      const venvBin = isWin
        ? path.join(activeVenvPath, 'Scripts', 'python.exe')
        : path.join(activeVenvPath, 'bin', 'python');
      if (fs.existsSync(venvBin)) return venvBin;
    }

    // 2. Local .venv folder
    const defaultVenv = path.join(wsPath, '.venv');
    const defaultBin = isWin
      ? path.join(defaultVenv, 'Scripts', 'python.exe')
      : path.join(defaultVenv, 'bin', 'python');
    if (fs.existsSync(defaultBin)) return defaultBin;

    // 3. Fallback to platform default
    return isWin ? 'python.exe' : 'python3';
  }

  /**
   * Spawns or reuses the dedicated Python AI Sandbox terminal with injected Cloud Hub credentials.
   */
  static getOrCreateSandboxTerminal(wsPath: string): vscode.Terminal {
    const termName = '🐍 Python AI Sandbox';
    const existing = vscode.window.terminals.find(t => t.name === termName);
    if (existing) return existing;

    const cloudEnv = CloudDeployHook.getSandboxEnvironment();

    const terminal = vscode.window.createTerminal({
      name: termName,
      cwd: wsPath,
      env: {
        ...cloudEnv,
        PYTHONUNBUFFERED: '1',
      },
    });

    this._terminal = terminal;
    return terminal;
  }

  /**
   * Runs a Python file inside the dedicated terminal.
   */
  static runScriptInTerminal(wsPath: string, scriptPath: string, args: string[] = []): void {
    const term = this.getOrCreateSandboxTerminal(wsPath);
    term.show();

    const interp = this.resolvePythonInterpreter(wsPath);
    const argStr = args.length > 0 ? ' ' + args.join(' ') : '';
    term.sendText(`& "${interp}" "${scriptPath}"${argStr}`);
  }

  /**
   * 1-Click quick command to initialize a modern uv or standard venv.
   */
  static provisionVenvCommand(wsPath: string): void {
    const term = this.getOrCreateSandboxTerminal(wsPath);
    term.show();
    term.sendText(`Write-Host "🚀 Initializing Python Virtual Environment..." -ForegroundColor Cyan`);
    term.sendText(`if (Get-Command uv -ErrorAction SilentlyContinue) { uv venv .venv } else { python -m venv .venv }`);
    term.sendText(`Write-Host "✓ Virtual environment ready in .venv" -ForegroundColor Green`);
  }

  /**
   * 1-Click install package into local venv using uv or pip.
   */
  static installPackage(wsPath: string, packageName: string): void {
    const term = this.getOrCreateSandboxTerminal(wsPath);
    term.show();
    term.sendText(`Write-Host "📦 Installing package '${packageName}'..." -ForegroundColor Cyan`);
    term.sendText(`if (Test-Path ".venv/Scripts/python.exe") { if (Get-Command uv -ErrorAction SilentlyContinue) { uv pip install "${packageName}" } else { .venv/Scripts/python.exe -m pip install "${packageName}" } } else { pip install "${packageName}" }`);
  }
}
