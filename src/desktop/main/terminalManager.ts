/**
 * Evolve AI Enterprise Desktop Edition — Dual-Mode Interactive Terminal Manager
 */

import * as child_process from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { TerminalSessionInfo, TerminalSpawnOptions } from '../shared/desktopTypes';

interface ActiveSession {
  info: TerminalSessionInfo;
  process: child_process.ChildProcess;
}

export class DesktopTerminalManager {
  private _sessions: Map<string, ActiveSession> = new Map();
  private _dataListeners: Array<(id: string, data: string) => void> = [];
  private _exitListeners: Array<(id: string, code: number) => void> = [];

  constructor() {}

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
    const cwd = options.cwd || process.cwd();

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

  public executeCommand(sessionId: string, cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const session = this._sessions.get(sessionId);
    const targetCwd = cwd || (session ? session.info.cwd : process.cwd());

    // Emit echo of command to listeners
    for (const listener of this._dataListeners) {
      try { listener(sessionId, `\r\n\x1b[33m❯ ${cmd}\x1b[0m\r\n`); } catch {}
    }

    return new Promise((resolve) => {
      const isWin = os.platform() === 'win32';
      const shellCmd = isWin ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWin ? ['-NoLogo', '-Command', cmd] : ['-c', cmd];

      const child = child_process.spawn(shellCmd, shellArgs, {
        cwd: targetCwd,
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
        for (const listener of this._dataListeners) {
          try { listener(sessionId, `\r\nPS ${targetCwd}> `); } catch {}
        }
        resolve({ stdout, stderr, code: code || 0 });
      });

      child.on('error', (err) => {
        for (const listener of this._dataListeners) {
          try { listener(sessionId, `\r\n\x1b[31mCommand error: ${err.message}\x1b[0m\r\nPS ${targetCwd}> `); } catch {}
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
