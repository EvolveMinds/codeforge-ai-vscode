/**
 * core/agent/buildVerifier.ts — Compiler Diagnostics & Autonomous Self-Correction Engine
 *
 * Automatically inspects Gradle (Java 25/Spring Boot) and Vite/Vue 3 project structures,
 * executes build verification commands, parses compiler stack traces and TypeScript diagnostics,
 * and formulates self-correction feedback prompts for the AI agent loop.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentTools } from './agentTools';

export interface CompilerDiagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
  sourceType: 'java' | 'typescript' | 'vue' | 'gradle' | 'lint' | 'general';
}

export interface VerificationResult {
  passed: boolean;
  commandRun: string;
  durationMs: number;
  diagnostics: CompilerDiagnostic[];
  rawOutput: string;
  selfCorrectionPrompt?: string;
}

export class BuildVerifier {
  constructor(
    private readonly _workspaceRoot: string,
    private readonly _tools: AgentTools
  ) {}

  public detectBuildCommands(): { backend?: string; frontend?: string } {
    const commands: { backend?: string; frontend?: string } = {};

    // 1. Detect Gradle Backend
    const backendGradlew = path.join(this._workspaceRoot, 'backend', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    const rootGradlew = path.join(this._workspaceRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

    if (fs.existsSync(backendGradlew)) {
      commands.backend = process.platform === 'win32' ? 'backend\\gradlew.bat -p backend build' : './backend/gradlew -p backend build';
    } else if (fs.existsSync(rootGradlew)) {
      commands.backend = process.platform === 'win32' ? '.\\gradlew.bat build' : './gradlew build';
    }

    // 2. Detect Frontend Check (Vue / Vite / TypeScript)
    const frontendPkg = path.join(this._workspaceRoot, 'frontend', 'package.json');
    const rootPkg = path.join(this._workspaceRoot, 'package.json');

    if (fs.existsSync(frontendPkg)) {
      commands.frontend = 'npm --prefix frontend run check';
    } else if (fs.existsSync(rootPkg)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(rootPkg, 'utf8'));
        if (pkg.scripts && pkg.scripts.check) {
          commands.frontend = 'npm run check';
        } else if (pkg.scripts && pkg.scripts.build) {
          commands.frontend = 'npm run build';
        }
      } catch {}
    }

    return commands;
  }

  public parseDiagnostics(rawOutput: string): CompilerDiagnostic[] {
    const diagnostics: CompilerDiagnostic[] = [];
    const lines = rawOutput.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // 1. Java Compiler Error:
      // Matches both "File.java:42: error: ..." and "[ERROR] File.java:[42,15] error: ..."
      const javaMatch = line.match(/(?:\[ERROR\]\s*)?([^\s:]+\.java)(?::\[?(\d+)(?:,(\d+))?\]?|:(\d+)(?::(\d+))?)(?::|\s)\s*(?:error:\s*)?(.+)/i);
      if (javaMatch) {
        const lineNum = javaMatch[2] || javaMatch[4];
        const colNum = javaMatch[3] || javaMatch[5];
        diagnostics.push({
          file: javaMatch[1].trim(),
          line: lineNum ? parseInt(lineNum, 10) : undefined,
          column: colNum ? parseInt(colNum, 10) : undefined,
          severity: 'error',
          message: (javaMatch[6] || '').trim(),
          sourceType: 'java',
        });
        continue;
      }

      // 2. TypeScript / Vue Error: src/views/PersonView.vue:55:12 - error TS2304: Cannot find name 'XYZ'.
      const tsMatch = line.match(/([a-zA-Z0-9_\-\/\\.]+\.(?:ts|tsx|vue|js)):(\d+):(\d+)\s*-\s*error\s*(?:TS\d+)?:\s*(.+)/i);
      if (tsMatch) {
        diagnostics.push({
          file: tsMatch[1].trim(),
          line: parseInt(tsMatch[2], 10),
          column: parseInt(tsMatch[3], 10),
          severity: 'error',
          message: tsMatch[4].trim(),
          sourceType: tsMatch[1].endsWith('.vue') ? 'vue' : 'typescript',
        });
        continue;
      }

      // 3. Gradle Task Failure
      if (line.includes('Execution failed for task') || line.includes('FAILURE: Build failed')) {
        diagnostics.push({
          file: 'build.gradle',
          severity: 'error',
          message: line.trim(),
          sourceType: 'gradle',
        });
      }
    }

    return diagnostics;
  }

  public async runVerification(): Promise<VerificationResult> {
    const commands = this.detectBuildCommands();
    const commandToRun = commands.backend || commands.frontend || 'npm run build';

    const execRes = await this._tools.runCommand(commandToRun, undefined, 120_000);
    const passed = execRes.success;
    const diagnostics = passed ? [] : this.parseDiagnostics(execRes.output);

    let selfCorrectionPrompt: string | undefined;
    if (!passed) {
      const errorList = diagnostics.length > 0
        ? diagnostics.map(d => `- \`${d.file}\`${d.line ? ` (line ${d.line})` : ''}: ${d.message}`).join('\n')
        : execRes.stderr || execRes.stdout.slice(-1000);

      selfCorrectionPrompt = `### ⚠️ Compilation & Build Verification Failed\n\n`
        + `The verification command \`${commandToRun}\` failed with code ${execRes.code}.\n\n`
        + `#### 🛑 Detected Compiler Diagnostics:\n${errorList}\n\n`
        + `Please inspect the errors above, read the affected files using \`read_file\`, and apply the exact fixes using \`edit_file\` or \`write_file\`.`;
    }

    return {
      passed,
      commandRun: commandToRun,
      durationMs: execRes.durationMs,
      diagnostics,
      rawOutput: execRes.output,
      selfCorrectionPrompt,
    };
  }
}
