/**
 * plugins/pythonStudio/gitIntegrationHook.ts
 *
 * Bridge to Evolve AI's Git Connect Suite and 1-Click Smart Commit & Push Studio.
 * Responsibilities:
 *  - Discovers Python deliverables (models, routes, tests, requirements)
 *  - Sensitive Artifacts & Leak Protection (block weights > 50MB, .venv, unencrypted API keys)
 *  - Enforces / auto-scaffolds clean .gitignore for Python AI projects
 *  - Enriches AI conventional commit drafting with Python domain context
 */

import * as path   from 'path';
import * as fs     from 'fs';

export interface SensitiveArtifactViolation {
  filePath: string;
  kind: 'large_weights' | 'unignored_venv' | 'raw_data_leak' | 'plaintext_secret';
  severity: 'error' | 'warning';
  message: string;
  sizeBytes?: number;
}

export interface PythonGitStatus {
  changedPythonFiles: string[];
  changedTestFiles:   string[];
  changedConfigs:     string[];
  violations:         SensitiveArtifactViolation[];
  isGitIgnoredClean:  boolean;
}

const MAX_WEIGHT_BYTES = 50 * 1024 * 1024; // 50MB limit before requiring Git LFS
const MAX_DATA_BYTES   = 10 * 1024 * 1024; // 10MB limit for raw CSV / Parquet

const RECOMMENDED_GITIGNORE_ENTRIES = [
  '# Python Virtual Environments',
  '.venv/',
  'venv/',
  'env/',
  '__pycache__/',
  '*.py[cod]',
  '*$py.class',
  '',
  '# Model Weights & Checkpoints (use cloud storage or Git LFS)',
  '*.pt',
  '*.pth',
  '*.bin',
  '*.safetensors',
  '*.onnx',
  'checkpoints/',
  '',
  '# Credentials & Local Data',
  '.env',
  '.env.local',
  '*.parquet',
  '*.sqlite3',
  '',
  '# Caches & Test Artefacts',
  '.pytest_cache/',
  '.ruff_cache/',
  '.mypy_cache/',
  '.coverage',
  'htmlcov/',
];

export class GitIntegrationHook {
  /**
   * Run comprehensive pre-flight scan for sensitive artifacts before committing.
   */
  static scanWorkspaceHygiene(wsPath: string): PythonGitStatus {
    const violations: SensitiveArtifactViolation[] = [];
    const changedPythonFiles: string[] = [];
    const changedTestFiles: string[] = [];
    const changedConfigs: string[] = [];

    // Check .gitignore existence and contents
    const gitignorePath = path.join(wsPath, '.gitignore');
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      try { gitignoreContent = fs.readFileSync(gitignorePath, 'utf8'); } catch {}
    }

    const hasVenvIgnored = gitignoreContent.includes('.venv') || gitignoreContent.includes('venv/');

    // Check if unignored .venv exists
    const venvDir = path.join(wsPath, '.venv');
    if (fs.existsSync(venvDir) && !hasVenvIgnored) {
      violations.push({
        filePath: '.venv/',
        kind: 'unignored_venv',
        severity: 'error',
        message: 'Local virtual environment (.venv/) is not in .gitignore. Committing will bloat Git repository.',
      });
    }

    // Scan shallow tree for weight files or unredacted datasets
    const scanFiles = (dir: string, depth = 0) => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const rel = path.relative(wsPath, full).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            if (['node_modules', '.git', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
            scanFiles(full, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            const stat = fs.statSync(full);

            // Categorize changed python files
            if (ext === '.py') {
              if (entry.name.startsWith('test_') || entry.name.endsWith('_test.py')) {
                changedTestFiles.push(rel);
              } else {
                changedPythonFiles.push(rel);
              }
            } else if (['pyproject.toml', 'requirements.txt', 'Pipfile'].includes(entry.name)) {
              changedConfigs.push(rel);
            }

            // Check for large weights
            if (['.pt', '.pth', '.bin', '.safetensors', '.onnx'].includes(ext)) {
              if (stat.size > MAX_WEIGHT_BYTES) {
                violations.push({
                  filePath: rel,
                  kind: 'large_weights',
                  severity: 'error',
                  sizeBytes: stat.size,
                  message: `Model weights file (${(stat.size / 1024 / 1024).toFixed(1)} MB) exceeds 50MB limit. Do not commit raw weights to Git.`,
                });
              }
            }

            // Check for raw large data files
            if (['.parquet', '.csv', '.jsonl'].includes(ext)) {
              if (stat.size > MAX_DATA_BYTES) {
                violations.push({
                  filePath: rel,
                  kind: 'raw_data_leak',
                  severity: 'warning',
                  sizeBytes: stat.size,
                  message: `Data file (${(stat.size / 1024 / 1024).toFixed(1)} MB) is unusually large for Git. Ensure sensitive PII is redacted.`,
                });
              }
            }

            // Check for unencrypted .env
            if (entry.name === '.env' || entry.name === '.env.local') {
              try {
                const envContent = fs.readFileSync(full, 'utf8');
                if (/(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})/i.test(envContent)) {
                  violations.push({
                    filePath: rel,
                    kind: 'plaintext_secret',
                    severity: 'error',
                    message: 'Plaintext API keys or cloud credentials detected in .env file!',
                  });
                }
              } catch {}
            }
          }
        }
      } catch {}
    };

    scanFiles(wsPath, 0);

    return {
      changedPythonFiles,
      changedTestFiles,
      changedConfigs,
      violations,
      isGitIgnoredClean: hasVenvIgnored,
    };
  }

  /**
   * Scaffolds or appends recommended Python & AI entries to .gitignore.
   */
  static ensurePythonGitignore(wsPath: string): boolean {
    const gitignorePath = path.join(wsPath, '.gitignore');
    try {
      let current = '';
      if (fs.existsSync(gitignorePath)) {
        current = fs.readFileSync(gitignorePath, 'utf8');
      }

      const missingEntries = RECOMMENDED_GITIGNORE_ENTRIES.filter(e => e && !e.startsWith('#') && !current.includes(e));
      if (missingEntries.length === 0) return false;

      const appendText = '\n# --- Evolve AI Python Studio Protections ---\n' + missingEntries.join('\n') + '\n';
      fs.appendFileSync(gitignorePath, appendText, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generates Python-specific context for AI Conventional Commit drafting.
   */
  static getCommitSummarySnippet(status: PythonGitStatus): string {
    const parts: string[] = [];
    if (status.changedPythonFiles.length > 0) {
      parts.push(`Python modules: ${status.changedPythonFiles.slice(0, 3).join(', ')}${status.changedPythonFiles.length > 3 ? '...' : ''}`);
    }
    if (status.changedTestFiles.length > 0) {
      parts.push(`Tests: ${status.changedTestFiles.slice(0, 2).join(', ')}`);
    }
    if (status.changedConfigs.length > 0) {
      parts.push(`Dependencies: ${status.changedConfigs.join(', ')}`);
    }
    return parts.join(' | ');
  }
}
