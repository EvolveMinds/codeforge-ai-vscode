/**
 * Evolve AI Enterprise Desktop Edition — Dual-Mode Interactive Terminal Manager
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TerminalSessionInfo, TerminalSpawnOptions } from '../shared/desktopTypes';
import { refreshPathFromRegistry } from '../../core/processUtil';

interface ActiveSession {
  info: TerminalSessionInfo;
  process: child_process.ChildProcess;
}

export class DesktopTerminalManager {
  private _sessions: Map<string, ActiveSession> = new Map();
  private _dataListeners: Array<(id: string, data: string) => void> = [];
  private _exitListeners: Array<(id: string, code: number) => void> = [];
  private _cwdListeners: Array<(id: string, newCwd: string) => void> = [];

  constructor() {}

  public onCwdChange(listener: (id: string, newCwd: string) => void): void {
    this._cwdListeners.push(listener);
  }

  public getAvailableShells(): string[] {
    const isWin = os.platform() === 'win32';
    const shells: string[] = [];

    if (isWin) {
      const pwshPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
      const sys32 = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : 'C:\\Windows\\System32';

      shells.push(path.join(sys32, 'WindowsPowerShell\\v1.0\\powershell.exe'));
      shells.push(path.join(sys32, 'cmd.exe'));
      try {
        const fs = require('fs');
        if (fs.existsSync(pwshPath)) shells.unshift(pwshPath);
        if (fs.existsSync(gitBash)) shells.push(gitBash);
      } catch {}
    } else {
      const fs = require('fs');
      ['/bin/zsh', '/bin/bash', '/bin/sh'].forEach(s => {
        try { if (fs.existsSync(s)) shells.push(s); } catch {}
      });
    }

    return shells.length > 0 ? shells : [isWin ? 'powershell.exe' : '/bin/bash'];
  }

  public getDefaultShell(): string {
    const available = this.getAvailableShells();
    return available[0] || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');
  }

  public spawnSession(options: TerminalSpawnOptions = {}): TerminalSessionInfo {
    const sessionId = options.id || 'term_' + Math.random().toString(36).substring(2, 9);
    const sessionName = options.name || 'Terminal ' + (this._sessions.size + 1);
    const shell = options.shell || this.getDefaultShell();
    // A workspace folder that has been moved or deleted would make the shell
    // spawn fail with ENOENT, leaving a terminal tab that accepts no commands.
    const requestedCwd = options.cwd || process.cwd();
    let cwd = process.cwd();
    try {
      if (fs.existsSync(requestedCwd) && fs.statSync(requestedCwd).isDirectory()) cwd = requestedCwd;
    } catch { /* keep process.cwd() */ }

    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ...(options.env || {})
    };

    const isWin = os.platform() === 'win32';
    let shellArgs: string[] = options.args || [];
    if (!options.args && isWin && shell.toLowerCase().includes('powershell')) {
      shellArgs = ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass'];
    }

    const proc = child_process.spawn(shell, shellArgs, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const info: TerminalSessionInfo = {
      id: sessionId,
      name: sessionName,
      shell,
      pid: proc.pid || 0,
      cwd,
      active: true,
      createdAt: new Date().toISOString()
    };

    this._sessions.set(sessionId, { info, process: proc });

    // Stream stdout
    if (proc.stdout) {
      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const listener of this._dataListeners) {
          try { listener(sessionId, text); } catch {}
        }
      });
    }

    // Stream stderr
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const listener of this._dataListeners) {
          try { listener(sessionId, text); } catch {}
        }
      });
    }

    // Exit listener
    proc.on('close', (code: number) => {
      info.active = false;
      this._sessions.delete(sessionId);
      for (const listener of this._exitListeners) {
        try { listener(sessionId, code || 0); } catch {}
      }
    });

    proc.on('error', (err: any) => {
      const errText = `\r\n\x1b[31m[Terminal Process Error]: ${err.message || err}\x1b[0m\r\n`;
      for (const listener of this._dataListeners) {
        try { listener(sessionId, errText); } catch {}
      }
    });

    // Send initial prompt & welcome text
    setTimeout(() => {
      const welcome = `\r\n\x1b[36m⚡ Evolve AI Terminal Session [${sessionName}] Initialized in ${cwd}\x1b[0m\r\nPS ${cwd}> `;
      for (const listener of this._dataListeners) {
        try { listener(sessionId, welcome); } catch {}
      }
    }, 50);

    return info;
  }

  /**
   * Push text to a session's listeners without running anything.
   *
   * Lets a feature that does its own work (the cloud CLI installer) show its
   * progress in the terminal the user is already watching, instead of having to
   * launder the output through a shell command.
   */
  public emitToSession(sessionId: string, text: string): void {
    for (const listener of this._dataListeners) {
      try { listener(sessionId, text); } catch { /* a dead listener must not break the caller */ }
    }
  }

  public writeData(sessionId: string, data: string): boolean {
    const session = this._sessions.get(sessionId);
    if (session && session.process.stdin && !session.process.stdin.destroyed) {
      try {
        session.process.stdin.write(data);
        return true;
      } catch {}
    }
    return false;
  }

  private _parseCdCommand(cmd: string, currentCwd: string): { isCd: boolean; newCwd?: string; error?: string } {
    const trimmed = cmd.trim();
    
    // Windows drive letter switch: e.g. "D:" or "d:"
    const driveMatch = trimmed.match(/^([a-zA-Z]):$/);
    if (driveMatch) {
      const driveLetter = driveMatch[1].toUpperCase();
      const targetPath = `${driveLetter}:\\`;
      if (fs.existsSync(targetPath)) return { isCd: true, newCwd: targetPath };
      return { isCd: true, error: `The drive ${driveLetter}: does not exist.` };
    }

    const cdRegex = /^(?:cd|chdir)(?:\s+\/d)?(?:\s+(.*))?$|^(?:pushd|Set-Location|sl)(?:\s+(.*))?$/i;
    const match = trimmed.match(cdRegex);
    if (!match) return { isCd: false };

    let target = (match[1] || match[2] || '').trim();
    if (!target) return { isCd: true, newCwd: os.homedir() };

    if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
      target = target.slice(1, -1).trim();
    }

    if (target === '~' || target.startsWith('~/') || target.startsWith('~\\')) {
      target = path.join(os.homedir(), target.slice(1));
    }

    let resolved = path.isAbsolute(target) ? path.normalize(target) : path.resolve(currentCwd, target);
    if (/^[a-zA-Z]:$/.test(resolved)) resolved += '\\';

    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return { isCd: true, newCwd: resolved };
      }
      return { isCd: true, error: `Cannot find path '${resolved}' because it does not exist.` };
    } catch (err: any) {
      return { isCd: true, error: err.message || String(err) };
    }
  }

  public executeCommand(sessionId: string, cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const session = this._sessions.get(sessionId);
    const targetCwd = (session && session.info.cwd) ? session.info.cwd : (cwd || process.cwd());

    // Emit echo of command to listeners
    for (const listener of this._dataListeners) {
      try { listener(sessionId, `\r\n\x1b[33m❯ ${cmd}\x1b[0m\r\n`); } catch {}
    }

    // Check directory change command
    const cdCheck = this._parseCdCommand(cmd, targetCwd);
    if (cdCheck.isCd) {
      return new Promise((resolve) => {
        if (cdCheck.error) {
          for (const listener of this._dataListeners) {
            try { listener(sessionId, `\x1b[31m${cdCheck.error}\x1b[0m\r\nPS ${targetCwd}> `); } catch {}
          }
          resolve({ stdout: '', stderr: cdCheck.error, code: 1 });
        } else if (cdCheck.newCwd) {
          if (session) {
            session.info.cwd = cdCheck.newCwd;
          }
          for (const listener of this._cwdListeners) {
            try { listener(sessionId, cdCheck.newCwd); } catch {}
          }
          for (const listener of this._dataListeners) {
            try { listener(sessionId, `PS ${cdCheck.newCwd}> `); } catch {}
          }
          resolve({ stdout: '', stderr: '', code: 0 });
        }
      });
    }

    return new Promise((resolve) => {
      const isWin = os.platform() === 'win32';
      const shellCmd = isWin ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWin ? ['-NoLogo', '-Command', cmd] : ['-c', cmd];

      // Pick up CLIs installed since the app launched, so the user does not
      // have to restart to use something they just installed from this terminal.
      refreshPathFromRegistry();

      // spawn fails with ENOENT when cwd is gone, which would surface as an
      // unexplained "Command error" rather than a shell message.
      const spawnCwd = (() => {
        try {
          if (targetCwd && fs.existsSync(targetCwd) && fs.statSync(targetCwd).isDirectory()) return targetCwd;
        } catch { /* fall through */ }
        return process.cwd();
      })();

      const child = child_process.spawn(shellCmd, shellArgs, {
        cwd: spawnCwd,
        env: process.env,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdout += text;
        for (const listener of this._dataListeners) {
          try { listener(sessionId, text); } catch {}
        }
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderr += text;
        for (const listener of this._dataListeners) {
          try { listener(sessionId, `\x1b[31m${text}\x1b[0m`); } catch {}
        }
      });

      child.on('close', (code) => {
        const activeCwd = (session && session.info.cwd) ? session.info.cwd : targetCwd;
        for (const listener of this._dataListeners) {
          try { listener(sessionId, `\r\nPS ${activeCwd}> `); } catch {}
        }
        resolve({ stdout, stderr, code: code || 0 });
      });

      child.on('error', (err) => {
        const activeCwd = (session && session.info.cwd) ? session.info.cwd : targetCwd;
        for (const listener of this._dataListeners) {
          try { listener(sessionId, `\r\n\x1b[31mCommand error: ${err.message}\x1b[0m\r\nPS ${activeCwd}> `); } catch {}
        }
        resolve({ stdout: '', stderr: err.message, code: 1 });
      });
    });
  }

  public killSession(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (session) {
      try {
        if (os.platform() === 'win32') {
          child_process.exec(`taskkill /pid ${session.process.pid} /T /F`);
        } else {
          session.process.kill('SIGTERM');
        }
      } catch {}
      this._sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  public listSessions(): TerminalSessionInfo[] {
    return Array.from(this._sessions.values()).map(s => s.info);
  }

  public onData(listener: (id: string, data: string) => void): void {
    this._dataListeners.push(listener);
  }

  public onExit(listener: (id: string, code: number) => void): void {
    this._exitListeners.push(listener);
  }

  public dispose(): void {
    for (const [id] of this._sessions.entries()) {
      this.killSession(id);
    }
    this._sessions.clear();
    this._dataListeners = [];
    this._exitListeners = [];
  }
}
