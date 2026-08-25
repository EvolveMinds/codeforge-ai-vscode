/**
 * deployment/preflightAuditor.ts — Deterministic Pre-Flight Health Auditor
 *
 * Scans a workspace before production or client pilot deployments to ensure zero
 * secret leaks, clean workspaces, environment parity, and Docker compliance.
 *
 * 100% Deterministic — Zero External AI / Network Calls.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AuditFinding {
  code: string;
  category: 'cleanup' | 'security' | 'env_parity' | 'docker' | 'build';
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  fixable: boolean;
}

export interface PreflightReport {
  timestamp: number;
  workspacePath: string;
  score: number; // 0 to 100
  pass: boolean;
  findings: AuditFinding[];
  temporaryFiles: string[];
  cleanableCount: number;
  environmentSummary: {
    exampleKeysCount: number;
    missingProdKeys: string[];
    extraProdKeys: string[];
  };
}

const BACKUP_PATTERNS = [
  /\.bak$/i,
  /\.backup$/i,
  /_OLD\.[a-zA-Z0-9]+$/i,
  /_NEW\.[a-zA-Z0-9]+$/i,
  /_temp\.[a-zA-Z0-9]+$/i,
  /\.tmp$/i,
  /~$/,
  /\.orig$/i,
];

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z-_]{35}/, // Google API Key
  /sk-[a-zA-Z0-9]{20,}/,   // OpenAI key
  /ghp_[a-zA-Z0-9]{36}/,   // GitHub PAT
  /glpat-[a-zA-Z0-9-_]{20,}/, // GitLab PAT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // RSA/SSH key
  /postgres:\/\/[^:]+:[^@]+@/, // Raw postgres connection string with password
];

export class PreflightAuditor {
  static scanWorkspace(wsPath: string): PreflightReport {
    const findings: AuditFinding[] = [];
    const temporaryFiles: string[] = [];

    // 1. Scan for backup & temp files
    this.scanForBackupFiles(wsPath, wsPath, temporaryFiles);
    for (const f of temporaryFiles) {
      findings.push({
        code: 'PRE-TEMP-01',
        category: 'cleanup',
        severity: 'warning',
        message: `Dangling temporary/backup file found: ${path.relative(wsPath, f)}`,
        file: f,
        fixable: true,
      });
    }

    // 2. Scan for secret leakage in dist / build folders
    this.scanBuildFoldersForSecrets(wsPath, findings);

    // 3. Scan environment variable parity
    const envSummary = this.auditEnvironmentParity(wsPath, findings);

    // 4. Check Docker & Firebase configuration
    this.auditDeploymentConfigs(wsPath, findings);

    // Calculate score: 100 - 15 per error - 5 per warning
    const errorCount = findings.filter(f => f.severity === 'error').length;
    const warningCount = findings.filter(f => f.severity === 'warning').length;
    const score = Math.max(0, 100 - (errorCount * 20) - (warningCount * 5));

    return {
      timestamp: Date.now(),
      workspacePath: wsPath,
      score,
      pass: errorCount === 0,
      findings,
      temporaryFiles,
      cleanableCount: temporaryFiles.length,
      environmentSummary: envSummary,
    };
  }

  static cleanTemporaryFiles(files: string[]): { cleaned: number; errors: string[] } {
    let cleaned = 0;
    const errors: string[] = [];

    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          cleaned++;
        }
      } catch (err: any) {
        errors.push(`Failed to delete ${file}: ${err.message}`);
      }
    }

    return { cleaned, errors };
  }

  private static scanForBackupFiles(currentDir: string, rootDir: string, results: string[], depth = 0): void {
    if (depth > 6) return;
    const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', 'out', 'coverage']);

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) {
            this.scanForBackupFiles(path.join(currentDir, entry.name), rootDir, results, depth + 1);
          }
        } else if (entry.isFile()) {
          for (const pattern of BACKUP_PATTERNS) {
            if (pattern.test(entry.name)) {
              results.push(path.join(currentDir, entry.name));
              break;
            }
          }
        }
      }
    } catch { /* skip read error */ }
  }

  private static scanBuildFoldersForSecrets(wsPath: string, findings: AuditFinding[]): void {
    const buildDirs = ['dist', 'build', 'out', 'public'];
    for (const bDir of buildDirs) {
      const fullDir = path.join(wsPath, bDir);
      if (fs.existsSync(fullDir)) {
        try {
          const files = fs.readdirSync(fullDir);
          for (const file of files) {
            if (/\.(js|json|html|map)$/i.test(file)) {
              const content = fs.readFileSync(path.join(fullDir, file), 'utf8');
              for (const secPattern of SECRET_PATTERNS) {
                if (secPattern.test(content)) {
                  findings.push({
                    code: 'PRE-SEC-01',
                    category: 'security',
                    severity: 'error',
                    message: `Possible leaked secret/key detected in compiled client artifact: ${bDir}/${file}`,
                    file: path.join(fullDir, file),
                    fixable: false,
                  });
                  break;
                }
              }
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  private static auditEnvironmentParity(
    wsPath: string,
    findings: AuditFinding[]
  ): { exampleKeysCount: number; missingProdKeys: string[]; extraProdKeys: string[] } {
    const exampleFile = path.join(wsPath, '.env.example');
    const prodFile = path.join(wsPath, '.env.production') || path.join(wsPath, '.env');

    let exampleKeys: string[] = [];
    let prodKeys: string[] = [];

    if (fs.existsSync(exampleFile)) {
      exampleKeys = this.parseEnvKeys(fs.readFileSync(exampleFile, 'utf8'));
    }
    if (fs.existsSync(prodFile)) {
      prodKeys = this.parseEnvKeys(fs.readFileSync(prodFile, 'utf8'));
    }

    const missingProdKeys = exampleKeys.filter(k => !prodKeys.includes(k));
    const extraProdKeys = prodKeys.filter(k => !exampleKeys.includes(k));

    if (missingProdKeys.length > 0) {
      findings.push({
        code: 'PRE-ENV-01',
        category: 'env_parity',
        severity: 'warning',
        message: `Missing ${missingProdKeys.length} environment variables in production config: ${missingProdKeys.slice(0, 4).join(', ')}${missingProdKeys.length > 4 ? '...' : ''}`,
        file: prodFile,
        fixable: false,
      });
    }

    return {
      exampleKeysCount: exampleKeys.length,
      missingProdKeys,
      extraProdKeys,
    };
  }

  private static auditDeploymentConfigs(wsPath: string, findings: AuditFinding[]): void {
    // Check .gitignore contains .env
    const gitignore = path.join(wsPath, '.gitignore');
    if (fs.existsSync(gitignore)) {
      const content = fs.readFileSync(gitignore, 'utf8');
      if (!/\.env/i.test(content)) {
        findings.push({
          code: 'PRE-GIT-01',
          category: 'security',
          severity: 'error',
          message: '.gitignore does not contain .env ignore pattern! Risk of committing credentials.',
          file: gitignore,
          fixable: true,
        });
      }
    }

    // Check Dockerfile doesn't default to root
    const dockerfiles = ['Dockerfile', 'Dockerfile.backend', 'Dockerfile.frontend'];
    for (const df of dockerfiles) {
      const dfPath = path.join(wsPath, df);
      if (fs.existsSync(dfPath)) {
        const content = fs.readFileSync(dfPath, 'utf8');
        if (!/USER\s+[a-zA-Z0-9_-]+/i.test(content)) {
          findings.push({
            code: 'PRE-DOCKER-01',
            category: 'docker',
            severity: 'warning',
            message: `${df} does not specify a non-root USER instruction.`,
            file: dfPath,
            fixable: false,
          });
        }
      }
    }
  }

  private static parseEnvKeys(content: string): string[] {
    const keys: string[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Z0-9_]+)\s*=/i);
      if (match && match[1]) {
        keys.push(match[1]);
      }
    }
    return keys;
  }
}
