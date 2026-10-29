/**
 * core/agent/governancePrimer.ts — Project Architecture Rules & Memory Ingestion
 *
 * Discovers workspace instructions (CLAUDE.md, MEMORY.md, ADRs) and injects
 * enterprise guardrails into the agent's system prompt to prevent architectural violations.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface GovernanceRules {
  hasClaudeMd: boolean;
  hasMemoryMd: boolean;
  rulesText: string;
}

export class GovernancePrimer {
  constructor(private readonly _workspaceRoot: string) {}

  public loadRules(): GovernanceRules {
    let rulesText = '';
    let hasClaudeMd = false;
    let hasMemoryMd = false;

    // 1. Check workspace CLAUDE.md
    const claudeMdPath = path.join(this._workspaceRoot, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      hasClaudeMd = true;
      try {
        const content = fs.readFileSync(claudeMdPath, 'utf8');
        rulesText += `\n\n--- WORKSPACE ARCHITECTURE RULES (CLAUDE.MD) ---\n${content.slice(0, 8000)}\n`;
      } catch {}
    }

    // 2. Check sibling or local eshr-memory/MEMORY.md
    const siblingMemoryPath = path.resolve(this._workspaceRoot, '..', 'eshr-memory', 'MEMORY.md');
    const localMemoryPath = path.join(this._workspaceRoot, 'eshr-memory', 'MEMORY.md');
    const memoryTarget = fs.existsSync(localMemoryPath)
      ? localMemoryPath
      : fs.existsSync(siblingMemoryPath)
      ? siblingMemoryPath
      : null;

    if (memoryTarget) {
      hasMemoryMd = true;
      try {
        const memContent = fs.readFileSync(memoryTarget, 'utf8');
        rulesText += `\n\n--- SHARED ARCHITECTURE DECISIONS (MEMORY.MD) ---\n${memContent.slice(0, 4000)}\n`;
      } catch {}
    }

    return {
      hasClaudeMd,
      hasMemoryMd,
      rulesText,
    };
  }

  public assembleSystemPrompt(baseSystemPrompt: string): string {
    const { rulesText } = this.loadRules();
    return `${baseSystemPrompt}

You are an Autonomous Senior Enterprise Full-Stack Systems Architect & Coding Agent.
You are tasked with implementing features, creating coordinated multi-file slices across backend and frontend, and verifying that builds compile cleanly with zero errors.

AVAILABLE WORKSPACE TOOLS:
1. read_file(path, startLine?, endLine?)
2. write_file(path, content)
3. edit_file(path, target, replacement)
4. list_dir(path, maxDepth?)
5. search_code(pattern, subDir?)
6. run_command(command, cwd?)

EXECUTION PROTOCOL:
- Read specifications and reference code before writing new files.
- Coordinate types across all layers (database entities, service DTOs, REST controllers, Vue frontend views, and routing tables).
- Always verify your work by running the workspace build command.
- If the build reports compiler or lint errors, immediately isolate the error lines and apply fixes.
${rulesText}`;
  }
}
