/**
 * core/agent/agentTools.ts — Workspace Primitives & Execution Tool Suite
 *
 * Implements read_file, write_file, edit_file, list_dir, search_code,
 * and run_command tools with path sanitization, cross-platform shell
 * execution, and streaming output buffers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  data?: any;
}

export class AgentTools {
  constructor(private readonly _workspaceRoot: string) {}

  public resolvePath(targetPath: string): string {
    if (path.isAbsolute(targetPath)) {
      return path.normalize(targetPath);
    }
    return path.normalize(path.join(this._workspaceRoot, targetPath));
  }

  public async readFile(filePath: string, startLine?: number, endLine?: number): Promise<ToolExecutionResult> {
    try {
      const fullPath = this.resolvePath(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: '', error: `File not found: ${filePath}` };
      }
      const raw = fs.readFileSync(fullPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      
      let slice = lines;
      if (startLine !== undefined || endLine !== undefined) {
        const start = Math.max(0, (startLine ?? 1) - 1);
        const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
        slice = lines.slice(start, end);
      }

      const content = slice.join('\n');
      return {
        success: true,
        output: content,
        data: { totalLines: lines.length, returnedLines: slice.length },
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to read file: ${err.message}` };
    }
  }

  public async writeFile(filePath: string, content: string): Promise<ToolExecutionResult> {
    try {
      const fullPath = this.resolvePath(filePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, content, 'utf8');
      return {
        success: true,
        output: `✓ Successfully wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}`,
        data: { path: fullPath, size: Buffer.byteLength(content, 'utf8') },
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to write file: ${err.message}` };
    }
  }

  public async editFile(filePath: string, target: string, replacement: string): Promise<ToolExecutionResult> {
    try {
      const fullPath = this.resolvePath(filePath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: '', error: `File not found: ${filePath}` };
      }
      let content = fs.readFileSync(fullPath, 'utf8');

      // Normalize line endings for replacement lookup
      const normContent = content.replace(/\r\n/g, '\n');
      const normTarget = target.replace(/\r\n/g, '\n');
      const normReplacement = replacement.replace(/\r\n/g, '\n');

      if (!normContent.includes(normTarget)) {
        return {
          success: false,
          output: '',
          error: `Target snippet to replace was not found in ${filePath}. Check indentation and whitespace.`,
        };
      }

      const replaced = normContent.replace(normTarget, normReplacement);
      fs.writeFileSync(fullPath, replaced, 'utf8');
      return {
        success: true,
        output: `✓ Applied surgical edit to ${filePath}`,
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to edit file: ${err.message}` };
    }
  }

  public async listDir(dirPath: string = '.', maxDepth: number = 2): Promise<ToolExecutionResult> {
    try {
      const fullPath = this.resolvePath(dirPath);
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: '', error: `Directory not found: ${dirPath}` };
      }

      const results: string[] = [];
      const traverse = (currentDir: string, currentDepth: number) => {
        if (currentDepth > maxDepth) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.gradle') continue;
          const subPath = path.join(currentDir, entry.name);
          const rel = path.relative(this._workspaceRoot, subPath);
          results.push(entry.isDirectory() ? `${rel}/` : rel);
          if (entry.isDirectory()) {
            traverse(subPath, currentDepth + 1);
          }
        }
      };

      traverse(fullPath, 1);
      return {
        success: true,
        output: results.join('\n'),
        data: { count: results.length },
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Failed to list directory: ${err.message}` };
    }
  }

  public async searchCode(pattern: string, subDir: string = '.'): Promise<ToolExecutionResult> {
    try {
      const searchRoot = this.resolvePath(subDir);
      if (!fs.existsSync(searchRoot)) {
        return { success: false, output: '', error: `Directory not found: ${subDir}` };
      }

      const matches: Array<{ file: string; line: number; text: string }> = [];
      const regex = new RegExp(pattern, 'i');

      const scan = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'out') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(full);
          } else if (entry.isFile()) {
            try {
              const text = fs.readFileSync(full, 'utf8');
              const lines = text.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  matches.push({
                    file: path.relative(this._workspaceRoot, full),
                    line: i + 1,
                    text: lines[i].trim().slice(0, 160),
                  });
                  if (matches.length >= 50) return;
                }
              }
            } catch {}
          }
        }
      };

      scan(searchRoot);
      const out = matches.map(m => `${m.file}:${m.line}  ${m.text}`).join('\n');
      return {
        success: true,
        output: out || `No matches found for pattern "${pattern}"`,
        data: { matchCount: matches.length },
      };
    } catch (err: any) {
      return { success: false, output: '', error: `Search failed: ${err.message}` };
    }
  }

  public runCommand(
    command: string,
    cwd?: string,
    timeoutMs: number = 60_000
  ): Promise<ToolExecutionResult & { code: number | null; stdout: string; stderr: string; durationMs: number }> {
    return new Promise(resolve => {
      const start = Date.now();
      const workingDir = cwd ? this.resolvePath(cwd) : this._workspaceRoot;

      let stdout = '';
      let stderr = '';

      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/bash';
      const shellArgs = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

      const child = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        child.kill();
        resolve({
          success: false,
          code: -1,
          stdout,
          stderr: stderr + `\nCommand timed out after ${timeoutMs}ms`,
          output: stdout + (stderr ? `\nSTDERR:\n${stderr}` : ''),
          error: `Timeout after ${timeoutMs}ms`,
          durationMs: Date.now() - start,
        });
      }, timeoutMs);

      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', chunk => {
        stderr += chunk.toString('utf8');
      });

      child.on('close', code => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const success = code === 0;
        resolve({
          success,
          code,
          stdout,
          stderr,
          output: stdout + (stderr ? `\nSTDERR:\n${stderr}` : ''),
          error: success ? undefined : `Exited with code ${code}`,
          durationMs,
        });
      });

      child.on('error', err => {
        clearTimeout(timer);
        resolve({
          success: false,
          code: -1,
          stdout,
          stderr: err.message,
          output: err.message,
          error: err.message,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}
