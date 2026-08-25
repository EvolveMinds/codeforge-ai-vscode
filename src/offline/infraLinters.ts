/**
 * offline/infraLinters.ts — Offline rule-based linters for Terraform/OpenTofu & Docker
 *
 * 100% deterministic, offline static security analysis.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface LintIssue {
  ruleId: string;
  message: string;
  severity: vscode.DiagnosticSeverity;
  range: vscode.Range;
  fixSuggestion?: string;
}

export class InfraLinters {
  // ── Terraform / OpenTofu Linter ─────────────────────────────────────────────

  static lintTerraform(document: vscode.TextDocument): LintIssue[] {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const issues: LintIssue[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      // TF-SEC-01: Wide-open CIDR 0.0.0.0/0
      if (line.includes('"0.0.0.0/0"') || line.includes("'0.0.0.0/0'") || line.includes('"::/0"')) {
        // Only warn if in an ingress or security group context
        const contextSlice = lines.slice(Math.max(0, lineIdx - 10), lineIdx + 1).join('\n');
        if (/ingress|security_group|firewall|allow/i.test(contextSlice)) {
          const col = line.indexOf('0.0.0.0/0') >= 0 ? line.indexOf('0.0.0.0/0') : line.indexOf('::/0');
          issues.push({
            ruleId: 'TF-SEC-01',
            message: 'Security risk: Ingress allows unrestricted traffic from all IP addresses (0.0.0.0/0). Restrict to a specific VPC or subnet CIDR.',
            severity: vscode.DiagnosticSeverity.Warning,
            range: new vscode.Range(lineIdx, col, lineIdx, col + 9),
            fixSuggestion: 'Restrict CIDR to specific internal IP range',
          });
        }
      }

      // TF-SEC-03: Unpinned provider/module version
      if (/source\s*=\s*["'][^"']+["']/.test(line)) {
        const nextLines = lines.slice(lineIdx, lineIdx + 4).join('\n');
        if (!/version\s*=\s*["']/.test(nextLines)) {
          issues.push({
            ruleId: 'TF-SEC-03',
            message: 'Unpinned module version: specify explicit version constraint (e.g. version = "~> 5.0") to prevent breaking upstream updates.',
            severity: vscode.DiagnosticSeverity.Information,
            range: new vscode.Range(lineIdx, 0, lineIdx, line.length),
            fixSuggestion: 'Add version = "~> 1.0"',
          });
        }
      }
    }

    // TF-SEC-02: Unencrypted storage check across resource blocks
    const s3Matches = [...text.matchAll(/resource\s+["']aws_s3_bucket["']\s+["']([^"']+)["']/g)];
    for (const match of s3Matches) {
      const bucketName = match[1];
      if (!text.includes('aws_s3_bucket_server_side_encryption_configuration') && !text.includes('server_side_encryption_configuration')) {
        const lineIdx = text.slice(0, match.index || 0).split('\n').length - 1;
        issues.push({
          ruleId: 'TF-SEC-02',
          message: `Storage bucket "${bucketName}" is missing server-side encryption configuration (SSE-S3 or SSE-KMS).`,
          severity: vscode.DiagnosticSeverity.Warning,
          range: new vscode.Range(lineIdx, 0, lineIdx, (lines[lineIdx] || '').length),
          fixSuggestion: 'Add aws_s3_bucket_server_side_encryption_configuration resource',
        });
      }
    }

    return issues;
  }

  // ── Dockerfile Linter ───────────────────────────────────────────────────────

  static lintDockerfile(document: vscode.TextDocument): LintIssue[] {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const issues: LintIssue[] = [];

    let hasUserInstruction = false;
    let consecutiveRunCount = 0;
    let firstConsecutiveRunLine = -1;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx].trim();

      if (line.startsWith('#') || !line) {
        continue;
      }

      // DOCKER-01: Use of latest tag in FROM
      if (/^FROM\s+([^\s:]+)(:latest)?(\s+AS\s+\w+)?$/i.test(line)) {
        if (!line.includes(':') || line.toLowerCase().includes(':latest')) {
          issues.push({
            ruleId: 'DOCKER-01',
            message: 'Unpinned base image tag: Avoid using ":latest" or untagged base images. Pin to a specific version or digest (e.g. python:3.11-slim).',
            severity: vscode.DiagnosticSeverity.Warning,
            range: new vscode.Range(lineIdx, 0, lineIdx, lines[lineIdx].length),
            fixSuggestion: 'Pin to explicit version tag (e.g. python:3.11-slim)',
          });
        }
      }

      // USER instruction check
      if (/^USER\s+/i.test(line)) {
        hasUserInstruction = true;
      }

      // DOCKER-04: Insecure curl | bash or sudo in RUN
      if (/^RUN\s+/i.test(line)) {
        if (/curl.*\|\s*(bash|sh)|wget.*\|\s*(bash|sh)/i.test(line)) {
          issues.push({
            ruleId: 'DOCKER-04',
            message: 'Insecure script execution: piping remote URL directly into bash/sh (curl | sh). Download, verify checksum, then execute.',
            severity: vscode.DiagnosticSeverity.Warning,
            range: new vscode.Range(lineIdx, 0, lineIdx, lines[lineIdx].length),
          });
        }
        if (/\bsudo\b/i.test(line)) {
          issues.push({
            ruleId: 'DOCKER-04',
            message: 'Avoid using "sudo" in Dockerfile. Docker build commands already execute as root until the USER instruction.',
            severity: vscode.DiagnosticSeverity.Information,
            range: new vscode.Range(lineIdx, 0, lineIdx, lines[lineIdx].length),
          });
        }

        // Check consecutive RUN statements
        consecutiveRunCount++;
        if (consecutiveRunCount === 1) firstConsecutiveRunLine = lineIdx;
        if (consecutiveRunCount > 2) {
          issues.push({
            ruleId: 'DOCKER-05',
            message: 'Layer optimization: Multiple consecutive RUN commands increase image layer count and size. Chain commands using "&& \\".',
            severity: vscode.DiagnosticSeverity.Information,
            range: new vscode.Range(firstConsecutiveRunLine, 0, lineIdx, lines[lineIdx].length),
            fixSuggestion: 'Combine consecutive RUN statements with &&',
          });
          consecutiveRunCount = 0; // report once per cluster
        }
      } else {
        consecutiveRunCount = 0;
      }
    }

    // DOCKER-02: Missing USER instruction
    if (!hasUserInstruction && lines.length > 5) {
      issues.push({
        ruleId: 'DOCKER-02',
        message: 'Security recommendation: Container runs as default root user. Add "USER appuser" before CMD or ENTRYPOINT to enforce least privilege.',
        severity: vscode.DiagnosticSeverity.Information,
        range: new vscode.Range(lines.length - 1, 0, lines.length - 1, (lines[lines.length - 1] || '').length),
        fixSuggestion: 'Add USER nonroot',
      });
    }

    // DOCKER-03: Missing .dockerignore
    const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (wsFolder) {
      const dockerignore = path.join(wsFolder.uri.fsPath, '.dockerignore');
      if (!fs.existsSync(dockerignore)) {
        issues.push({
          ruleId: 'DOCKER-03',
          message: 'Missing .dockerignore in workspace root. Sensitive files (.git, .env, *.key) may accidentally leak into build context.',
          severity: vscode.DiagnosticSeverity.Information,
          range: new vscode.Range(0, 0, 0, (lines[0] || '').length),
          fixSuggestion: 'Create .dockerignore file',
        });
      }
    }

    return issues;
  }
}
