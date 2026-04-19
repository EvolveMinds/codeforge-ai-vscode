/**
 * analysis/types.ts — Shared types for the code-analysis subsystem
 */

export type Severity = 'error' | 'warning' | 'info';

export type Category =
  | 'whitespace'
  | 'quotes'
  | 'semicolons'
  | 'importOrder'
  | 'unusedVars'
  | 'anyTypes'
  | 'style'
  | 'correctness'
  | 'other';

export interface Issue {
  tool: string;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: Severity;
  category: Category;
  rule: string;
  message: string;
  fixable: boolean;
  safe: boolean;
}

export interface FixResult {
  file: string;
  originalContent: string;
  fixedContent: string;
  tool: string;
  appliedRules: string[];
}

export interface Report {
  file: string;
  language: string;
  durationMs: number;
  issues: Issue[];
  fix?: FixResult;
  skipped?: string;
}

export interface ToolAdapter {
  name: string;
  supportedLanguages: string[];
  isAvailable(projectRoot: string): Promise<boolean>;
  detectsProjectConfig(projectRoot: string): Promise<boolean>;
  run(args: {
    filePath: string;
    content: string;
    projectRoot: string;
  }): Promise<{ issues: Issue[]; fix?: FixResult }>;
}

export type ConsentMode = 'prompt' | 'autoSafe' | 'silent' | 'off';
export type ConsentScope = 'file' | 'workspace' | 'global';

export interface ConsentDecision {
  mode: ConsentMode;
  scope: ConsentScope;
  rememberedAt: number;
}
