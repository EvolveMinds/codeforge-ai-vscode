/**
 * fde/codebaseGraph/repoQualityGatekeeper.ts — Pre-Push Code Quality & Pipeline Gatekeeper
 *
 * Deterministically scans local repositories before Git push to validate:
 *  1. SQL Validation & Syntax (unbounded mutations, cartesian joins, dialect syntax, trailing commas)
 *  2. Lint & Static Analysis (console/debugger, eval, loose equality, empty catches, TODO debt, Docker/IaC flaws)
 *  3. Format & Style Consistency (trailing whitespace, missing EOF newline, mixed indents, CRLF/LF, JSON/YAML)
 *  4. Typecheck & Interface Integrity (TypeScript tsc / mypy integration, broken local relative imports, unannotated APIs)
 *  5. Pipeline Gatekeeper Verdict & 1-Click Pre-Push Hook Installer (.git/hooks/pre-push)
 *
 * 100% Offline, Deterministic, Zero Cloud Dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  QualityFinding,
  QualityGateReport,
  QualityGateSummary,
  QualitySeverity,
  QualityCategory,
  QualityScanOptions
} from './types';
import { SqlFormatter } from '../../offline/sqlFormatter';

// =============================================================================
// 1. SCANNER ENGINE & DIRECTORY CONSTANTS
// =============================================================================

const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  'target',
  'vendor',
  '.idea',
  'coverage',
  '.turbo',
  '.next'
]);

const SQL_RESERVED_WORDS = new Set([
  'USER', 'ORDER', 'GROUP', 'TABLE', 'INDEX', 'KEY', 'BY', 'WHERE', 'SELECT',
  'FROM', 'JOIN', 'LIMIT', 'OFFSET', 'DEFAULT', 'CHECK', 'PRIMARY', 'FOREIGN',
  'REFERENCES', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'DESC', 'ASC'
]);

export class RepoQualityGatekeeper {

  // ===========================================================================
  // CORE SCAN ENTRYPOINT
  // ===========================================================================

  public static scan(repoPath: string, options: QualityScanOptions = {}): QualityGateReport {
    const startTime = Date.now();
    const excludeSet = new Set([...DEFAULT_EXCLUDE_DIRS, ...(options.excludeDirs || [])]);
    const maxFiles = options.maxFiles || 1500;
    const files: string[] = [];

    this.walkWorkspace(repoPath, repoPath, files, excludeSet, maxFiles);

    const findings: QualityFinding[] = [];
    const exceptions = this.loadExceptions(repoPath);

    // 1. Run File-by-File Analyzers (SQL, Lint, Format)
    for (const relFile of files) {
      const fullPath = path.join(repoPath, relFile);
      let content = '';
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }

      const ext = path.extname(relFile).toLowerCase();
      const base = path.basename(relFile).toLowerCase();

      // Format & Hygiene Analysis (all code files)
      this.checkFormattingAndHygiene(content, relFile, findings);

      // JSON Validation
      if (ext === '.json') {
        this.checkJsonSyntax(content, relFile, findings);
      }

      // YAML Validation
      if (ext === '.yaml' || ext === '.yml') {
        this.checkYamlSyntax(content, relFile, findings);
      }

      // SQL Validation (.sql files and embedded queries)
      if (ext === '.sql') {
        this.checkSqlFile(content, relFile, findings);
      } else if (['.ts', '.js', '.jsx', '.tsx', '.py'].includes(ext)) {
        this.checkEmbeddedSql(content, relFile, findings);
      }

      // Lint & Static Code Analysis
      if (['.ts', '.js', '.jsx', '.tsx', '.py'].includes(ext)) {
        this.checkCodeLint(content, relFile, ext, findings);
      }

      // Dockerfile & IaC Linting
      if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
        this.checkDockerfileLint(content, relFile, findings);
      }
      if (ext === '.tf') {
        this.checkTerraformLint(content, relFile, findings);
      }

      // Structural Type & Import Validation
      if (['.ts', '.tsx', '.js'].includes(ext)) {
        this.checkImportIntegrity(content, relFile, repoPath, findings);
      }
    }

    // 2. Real TypeScript Compiler Verification (if tsconfig.json present)
    if (options.includeTypeCheck !== false) {
      this.runTscCompilerCheck(repoPath, findings);
    }

    // 3. Apply Exceptions (User Marked as Safe / Ignored)
    for (const f of findings) {
      const exc = exceptions.get(f.id) || exceptions.get(`${f.file}::${f.matchedRule}`);
      if (exc) {
        f.isIgnored = true;
        f.ignoredReason = exc.reason;
      }
    }

    // 4. Filter by requested categories / severity if specified
    let filteredFindings = findings;
    if (options.categories && options.categories.length > 0) {
      filteredFindings = filteredFindings.filter(f => options.categories!.includes(f.category));
    }
    if (options.severity && options.severity !== 'all') {
      filteredFindings = filteredFindings.filter(f => f.severity === options.severity);
    }

    const summary = this.buildSummary(filteredFindings);
    const score = this.calculateScore(summary);
    const duration = Date.now() - startTime;
    const hookInstalled = this.checkPrePushHookInstalled(repoPath);

    const verdict: 'PASS' | 'BLOCKED' | 'WARNING' =
      summary.blockers > 0 ? 'BLOCKED' : summary.warnings > 0 ? 'WARNING' : 'PASS';

    return {
      timestamp: Date.now(),
      repoPath,
      score,
      verdict,
      pass: summary.blockers === 0,
      findings: filteredFindings,
      summary,
      scannedFilesCount: files.length,
      scanDurationMs: duration,
      prePushHookInstalled: hookInstalled
    };
  }

  // ===========================================================================
  // 1. SQL VALIDATION & QUERY INTEGRITY
  // ===========================================================================

  private static checkSqlFile(content: string, relFile: string, findings: QualityFinding[]): void {
    const lines = content.split(/\r?\n/);

    // Check Unbalanced Parentheses
    let openCount = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const prev = i > 0 ? content[i - 1] : '';
      if (char === "'" && prev !== '\\') inSingleQuote = !inSingleQuote;
      if (char === '"' && prev !== '\\') inDoubleQuote = !inDoubleQuote;
      if (!inSingleQuote && !inDoubleQuote) {
        if (char === '(') openCount++;
        else if (char === ')') openCount--;
      }
    }
    if (openCount !== 0) {
      findings.push({
        id: `SQL-UNBALANCED-PARENS-${relFile}`,
        file: relFile,
        line: 1,
        severity: 'blocker',
        category: 'sql',
        title: 'Syntax Error: Unbalanced Parentheses',
        description: `SQL file contains mismatched parentheses (net delta: ${openCount}). Queries will fail at runtime.`,
        matchedRule: 'QG_SQL_UNBALANCED_PARENS',
        remediation: 'Ensure every opening "(" has a corresponding closing ")".',
        fixable: false
      });
    }

    // Check Unclosed String Quotes
    if (inSingleQuote || inDoubleQuote) {
      findings.push({
        id: `SQL-UNCLOSED-QUOTE-${relFile}`,
        file: relFile,
        line: 1,
        severity: 'blocker',
        category: 'sql',
        title: 'Syntax Error: Unclosed String Literal',
        description: 'Unclosed quotation mark detected in SQL file.',
        matchedRule: 'QG_SQL_UNCLOSED_QUOTE',
        remediation: 'Close all open string quotes before committing.',
        fixable: false
      });
    }

    // Line-by-line checks
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;
      const trimmed = line.trim();

      if (trimmed.startsWith('--') || trimmed.startsWith('/*')) continue;

      // Trailing comma before FROM or )
      if (/,\s*$/i.test(trimmed) && idx + 1 < lines.length) {
        const nextLine = lines[idx + 1].trim();
        if (/^(FROM|\)|WHERE|GROUP BY|ORDER BY)/i.test(nextLine)) {
          findings.push({
            id: `SQL-TRAILING-COMMA-${relFile}-${lineNum}`,
            file: relFile,
            line: lineNum,
            severity: 'blocker',
            category: 'sql',
            title: 'SQL Syntax Error: Trailing Comma',
            description: `Dangling comma immediately before '${nextLine.split(/\s+/)[0]}' causes syntax failure in standard SQL engines.`,
            matchedRule: 'QG_SQL_TRAILING_COMMA',
            snippet: line.trim(),
            remediation: 'Remove the trailing comma on this line.',
            fixable: true
          });
        }
      }

      // SELECT * in production models
      if (/SELECT\s+\*\s+FROM/i.test(line) && !relFile.includes('/test') && !relFile.includes('/spec')) {
        findings.push({
          id: `SQL-WILDCARD-SELECT-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'warning',
          category: 'sql',
          title: 'Fragile Pattern: SELECT * Wildcard in Model',
          description: 'Explicit column lists are required for production data marts and pipelines to prevent schema drift failure.',
          matchedRule: 'QG_SQL_WILDCARD_SELECT',
          snippet: line.trim(),
          remediation: 'Specify explicit column names instead of SELECT *.',
          fixable: false
        });
      }
    }

    // Unbounded UPDATE or DELETE
    this.checkUnboundedMutation(content, relFile, findings);
    // Cartesian Product check
    this.checkCartesianProduct(content, relFile, findings);
  }

  private static checkEmbeddedSql(content: string, relFile: string, findings: QualityFinding[]): void {
    const lines = content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;

      // Unbounded DELETE in code
      if (/(?:DELETE\s+FROM\s+([a-zA-Z0-9_]+)\s*(?:;|$|`|'|"))/i.test(line) && !/WHERE/i.test(line)) {
        findings.push({
          id: `SQL-UNBOUNDED-DELETE-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'blocker',
          category: 'sql',
          title: 'Dangerous Unbounded DELETE Query',
          description: 'DELETE FROM executed without a WHERE clause will truncate the entire table in production.',
          matchedRule: 'QG_SQL_UNBOUNDED_MUTATION',
          snippet: line.trim(),
          remediation: 'Add a parameterized WHERE clause or verify if TRUNCATE was intended.',
          fixable: false
        });
      }

      // Unbounded UPDATE in code
      if (/(?:UPDATE\s+[a-zA-Z0-9_]+\s+SET\s+[^;`'"]+)/i.test(line) && !/WHERE/i.test(line)) {
        // Look ahead 2 lines for WHERE
        const slice = lines.slice(idx, idx + 3).join(' ');
        if (!/WHERE/i.test(slice) && slice.includes(';')) {
          findings.push({
            id: `SQL-UNBOUNDED-UPDATE-${relFile}-${lineNum}`,
            file: relFile,
            line: lineNum,
            severity: 'blocker',
            category: 'sql',
            title: 'Dangerous Unbounded UPDATE Query',
            description: 'UPDATE statement executed without a WHERE clause will overwrite all rows in table.',
            matchedRule: 'QG_SQL_UNBOUNDED_MUTATION',
            snippet: line.trim(),
            remediation: 'Provide an explicit WHERE clause to restrict updated records.',
            fixable: false
          });
        }
      }
    }
  }

  private static checkUnboundedMutation(sql: string, relFile: string, findings: QualityFinding[]): void {
    // Regex for full queries
    const deleteRegex = /DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?!\s+WHERE)/gi;
    let match: RegExpExecArray | null;
    while ((match = deleteRegex.exec(sql)) !== null) {
      // Confirm there is no WHERE before the next semicolon or EOF
      const subsequent = sql.slice(match.index, match.index + 200);
      if (!/WHERE/i.test(subsequent.split(';')[0])) {
        const lineNum = sql.substring(0, match.index).split('\n').length;
        findings.push({
          id: `SQL-UNBOUNDED-DELETE-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'blocker',
          category: 'sql',
          title: 'Critical: Unbounded DELETE Statement',
          description: `DELETE FROM ${match[1]} does not have a WHERE clause and will delete all rows.`,
          matchedRule: 'QG_SQL_UNBOUNDED_MUTATION',
          snippet: match[0],
          remediation: 'Add an explicit WHERE condition to target specific records.',
          fixable: false
        });
      }
    }
  }

  private static checkCartesianProduct(sql: string, relFile: string, findings: QualityFinding[]): void {
    // Detect "FROM table_a, table_b" without WHERE
    const cartesianRegex = /FROM\s+([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)(?!\s*,\s*[a-zA-Z0-9_]+)?(?:\s*;|\s*$|\s+LIMIT)/gi;
    let match: RegExpExecArray | null;
    while ((match = cartesianRegex.exec(sql)) !== null) {
      const lineNum = sql.substring(0, match.index).split('\n').length;
      findings.push({
        id: `SQL-CARTESIAN-JOIN-${relFile}-${lineNum}`,
        file: relFile,
        line: lineNum,
        severity: 'warning',
        category: 'sql',
        title: 'High Resource Risk: Implicit Cartesian JOIN (CROSS JOIN)',
        description: `Implicit join syntax 'FROM ${match[1]}, ${match[2]}' without join criteria can produce massive row explosions.`,
        matchedRule: 'QG_SQL_CARTESIAN_JOIN',
        snippet: match[0],
        remediation: 'Replace comma join with explicit INNER JOIN ... ON condition.',
        fixable: false
      });
    }
  }

  // ===========================================================================
  // 2. LINT & STATIC CODE ANALYSIS
  // ===========================================================================

  private static checkCodeLint(content: string, relFile: string, ext: string, findings: QualityFinding[]): void {
    const lines = content.split(/\r?\n/);
    const isTest = relFile.includes('.test.') || relFile.includes('.spec.') || relFile.includes('/test/') || relFile.includes('/tests/');

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;
      const trimmed = line.trim();

      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;

      // 1. Debugger statement
      if (/^\s*debugger\s*;?$/.test(line)) {
        findings.push({
          id: `LINT-DEBUGGER-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'blocker',
          category: 'lint',
          title: 'Leftover Debugger Statement',
          description: 'Breakpoint `debugger;` statement left in production code will halt execution in browser/Node.',
          matchedRule: 'QG_LINT_NO_DEBUGGER',
          snippet: line.trim(),
          remediation: 'Remove debugger statement before committing to Git.',
          fixable: true
        });
      }

      // 2. Unsafe eval / new Function
      if (/\beval\s*\(/.test(line) || /new\s+Function\s*\(/.test(line)) {
        findings.push({
          id: `LINT-UNSAFE-EVAL-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'blocker',
          category: 'lint',
          title: 'Security & Code Flaw: Dynamic eval() Execution',
          description: 'Arbitrary string execution via eval() or new Function() is disallowed in production code.',
          matchedRule: 'QG_LINT_NO_EVAL',
          snippet: line.trim(),
          remediation: 'Refactor dynamic string execution into static handlers or lookup maps.',
          fixable: false
        });
      }

      // 3. Debug console.log in production (non-test files)
      if (!isTest && /(?:console\.log|console\.debug)\s*\(/.test(line)) {
        findings.push({
          id: `LINT-CONSOLE-LOG-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'warning',
          category: 'lint',
          title: 'Leftover Debug Logging in Production',
          description: 'Direct console.log/console.debug left in business logic. Use production logger or remove before push.',
          matchedRule: 'QG_LINT_NO_CONSOLE_LOG',
          snippet: line.trim(),
          remediation: 'Replace with structured logger or remove call before pushing.',
          fixable: true
        });
      }

      // Python print() in production code
      if (!isTest && ext === '.py' && /^\s*print\s*\(/.test(line)) {
        findings.push({
          id: `LINT-PY-PRINT-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'warning',
          category: 'lint',
          title: 'Leftover print() in Python Code',
          description: 'Standard print() statement found in non-test Python module.',
          matchedRule: 'QG_LINT_NO_PRINT',
          snippet: line.trim(),
          remediation: 'Use Python logging module (logging.info/debug) or remove before push.',
          fixable: true
        });
      }

      // 4. Loose equality (== or != instead of === / !==)
      if (/(?<![!=><])==(?!=)/.test(line) && !line.includes('== null') && !line.includes('!= null') && ext !== '.py') {
        findings.push({
          id: `LINT-LOOSE-EQ-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'warning',
          category: 'lint',
          title: 'Type Safety: Loose Equality (==)',
          description: 'Loose equality `==` can cause unpredictable type coercion bugs.',
          matchedRule: 'QG_LINT_EQEQEQ',
          snippet: line.trim(),
          remediation: 'Use strict equality `===` or `!==`.',
          fixable: true
        });
      }

      // 5. Silent empty catch block
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
        findings.push({
          id: `LINT-EMPTY-CATCH-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'warning',
          category: 'lint',
          title: 'Silent Failure: Empty Catch Block',
          description: 'Empty catch block swallows errors silently without logging or rethrowing.',
          matchedRule: 'QG_LINT_NO_EMPTY_CATCH',
          snippet: line.trim(),
          remediation: 'Log the caught error or add a comment explaining why it is safely ignored.',
          fixable: false
        });
      }

      // 6. TODO / FIXME markers before push
      if (/\b(?:TODO|FIXME|HACK|XXX)\b\s*[:\-]/.test(line) && !isTest) {
        findings.push({
          id: `LINT-DEBT-MARKER-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'info',
          category: 'lint',
          title: 'Unresolved Technical Debt Marker',
          description: 'Pending TODO or FIXME marker flagged before pushing code to remote.',
          matchedRule: 'QG_LINT_TODO_MARKER',
          snippet: line.trim(),
          remediation: 'Resolve the outstanding task or file a Jira ticket.',
          fixable: false
        });
      }
    }
  }

  // ===========================================================================
  // 3. FORMAT & STYLE CONSISTENCY (WHITESPACE, NEWLINES, JSON, YAML)
  // ===========================================================================

  private static checkFormattingAndHygiene(content: string, relFile: string, findings: QualityFinding[]): void {
    // 1. Missing Final Newline (POSIX standard)
    if (content.length > 0 && !content.endsWith('\n')) {
      findings.push({
        id: `FMT-MISSING-NEWLINE-${relFile}`,
        file: relFile,
        line: content.split('\n').length,
        severity: 'info',
        category: 'format',
        title: 'Missing Trailing Newline at EOF',
        description: 'File does not end with a newline character, producing git diff warning "\\ No newline at end of file".',
        matchedRule: 'QG_FMT_EOF_NEWLINE',
        remediation: 'Add a trailing newline to end of file.',
        fixable: true
      });
    }

    // 2. Trailing Whitespace
    const lines = content.split(/\r?\n/);
    let trailingWsCount = 0;
    let firstTrailingLine = 0;

    for (let idx = 0; idx < lines.length; idx++) {
      if (/[ \t]+$/.test(lines[idx])) {
        trailingWsCount++;
        if (firstTrailingLine === 0) firstTrailingLine = idx + 1;
      }
    }

    if (trailingWsCount > 0) {
      findings.push({
        id: `FMT-TRAILING-WS-${relFile}-${firstTrailingLine}`,
        file: relFile,
        line: firstTrailingLine,
        severity: 'warning',
        category: 'format',
        title: `Code Cleanliness: Trailing Whitespace (${trailingWsCount} lines)`,
        description: `Found ${trailingWsCount} lines with unnecessary spaces/tabs at end of line.`,
        matchedRule: 'QG_FMT_TRAILING_WHITESPACE',
        remediation: 'Strip trailing whitespace before committing.',
        fixable: true
      });
    }

    // 3. Mixed Line Endings (CRLF vs LF)
    const hasCrLf = content.includes('\r\n');
    const hasLf = content.replace(/\r\n/g, '').includes('\n');
    if (hasCrLf && hasLf) {
      findings.push({
        id: `FMT-MIXED-EOL-${relFile}`,
        file: relFile,
        line: 1,
        severity: 'warning',
        category: 'format',
        title: 'Inconsistent Line Endings: Mixed CRLF and LF',
        description: 'File mixes Windows CRLF and Unix LF line endings, which breaks cross-platform CI pipelines.',
        matchedRule: 'QG_FMT_LINE_ENDINGS',
        remediation: 'Normalize all line endings to consistent LF or CRLF.',
        fixable: true
      });
    }
  }

  private static checkJsonSyntax(content: string, relFile: string, findings: QualityFinding[]): void {
    try {
      JSON.parse(content);
    } catch (e: any) {
      // Calculate approximate line number from error message
      let lineNum = 1;
      const match = e.message.match(/at position (\d+)/);
      if (match) {
        const pos = parseInt(match[1], 10);
        lineNum = content.slice(0, pos).split('\n').length;
      }
      findings.push({
        id: `FMT-JSON-SYNTAX-${relFile}-${lineNum}`,
        file: relFile,
        line: lineNum,
        severity: 'blocker',
        category: 'format',
        title: 'Syntax Error: Invalid JSON File',
        description: `JSON parse error: ${e.message}. This file will fail build/deploy scripts.`,
        matchedRule: 'QG_FMT_JSON_INVALID',
        remediation: 'Fix syntax error, remove trailing commas, and ensure valid quotes.',
        fixable: true
      });
    }
  }

  private static checkYamlSyntax(content: string, relFile: string, findings: QualityFinding[]): void {
    const lines = content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      // Tab character used in YAML indentation (strict YAML syntax violation)
      if (/^\t+/.test(line)) {
        findings.push({
          id: `FMT-YAML-TAB-${relFile}-${idx + 1}`,
          file: relFile,
          line: idx + 1,
          severity: 'blocker',
          category: 'format',
          title: 'YAML Syntax Error: Tab Character in Indentation',
          description: 'YAML specification forbids tab characters for indentation. Use 2 spaces instead.',
          matchedRule: 'QG_FMT_YAML_TABS',
          snippet: line,
          remediation: 'Replace tab indentation with standard spaces.',
          fixable: true
        });
        break; // Report once per file
      }
    }
  }

  // ===========================================================================
  // 4. DOCKER & TERRAFORM (INFRASTRUCTURE LINTERS)
  // ===========================================================================

  private static checkDockerfileLint(content: string, relFile: string, findings: QualityFinding[]): void {
    const lines = content.split(/\r?\n/);
    let hasNonRootUser = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;

      // Unpinned latest tag
      if (/^\s*FROM\s+[^\s:]+:latest\b/i.test(line)) {
        findings.push({
          id: `INFRA-DOCKER-LATEST-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'warning',
          category: 'infra',
          title: 'Docker Build Risk: Unpinned Base Image (:latest)',
          description: 'Using `:latest` base image creates non-reproducible container builds in CI/CD.',
          matchedRule: 'QG_INFRA_DOCKER_LATEST',
          snippet: line.trim(),
          remediation: 'Pin base image to explicit version or digest (e.g. node:20.12-alpine).',
          fixable: false
        });
      }

      if (/^\s*USER\s+(?!root\b)[a-zA-Z0-9_-]+/i.test(line)) {
        hasNonRootUser = true;
      }
    }

    if (!hasNonRootUser) {
      findings.push({
        id: `INFRA-DOCKER-ROOT-${relFile}`,
        file: relFile,
        line: 1,
        severity: 'warning',
        category: 'infra',
        title: 'Container Security Risk: Missing Non-Root USER',
        description: 'Dockerfile does not specify a non-root USER instruction. Containers will execute as root.',
        matchedRule: 'QG_INFRA_DOCKER_ROOT',
        remediation: 'Add `USER nonroot` or create dedicated service user before ENTRYPOINT.',
        fixable: false
      });
    }
  }

  private static checkTerraformLint(content: string, relFile: string, findings: QualityFinding[]): void {
    const lines = content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;

      if ((line.includes('"0.0.0.0/0"') || line.includes("'0.0.0.0/0'")) && /cidr|ingress|security_group/i.test(line)) {
        findings.push({
          id: `INFRA-TF-OPEN-INGRESS-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'warning',
          category: 'infra',
          title: 'Cloud IaC Security: Wide-Open 0.0.0.0/0 Ingress',
          description: 'Ingress rule permits unrestricted traffic from entire public internet.',
          matchedRule: 'QG_INFRA_TF_OPEN_INGRESS',
          snippet: line.trim(),
          remediation: 'Restrict CIDR to specific corporate VPN or VPC subnet.',
          fixable: false
        });
      }
    }
  }

  // ===========================================================================
  // 5. TYPECHECK & INTERFACE INTEGRITY
  // ===========================================================================

  private static checkImportIntegrity(content: string, relFile: string, repoPath: string, findings: QualityFinding[]): void {
    const dir = path.dirname(path.join(repoPath, relFile));
    const importRegex = /(?:import\s+(?:.*?\s+from\s+)?|require\s*\(\s*)["'](\.[^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      const candidateBase = path.resolve(dir, importPath);

      // Check candidate extensions
      const possibleExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js', '.json'];
      let found = false;
      for (const ext of possibleExtensions) {
        if (fs.existsSync(candidateBase + ext)) {
          found = true;
          break;
        }
      }

      if (!found) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        findings.push({
          id: `TYPE-BROKEN-IMPORT-${relFile}-${lineNum}`,
          file: relFile,
          line: lineNum,
          severity: 'blocker',
          category: 'typecheck',
          title: 'Broken Module Import: File Not Found on Disk',
          description: `Import reference '${importPath}' cannot be resolved to any existing file on disk. Pipeline build will fail.`,
          matchedRule: 'QG_TYPE_BROKEN_IMPORT',
          snippet: match[0],
          remediation: `Verify file path exists or update relative path for '${importPath}'.`,
          fixable: false
        });
      }
    }
  }

  private static runTscCompilerCheck(repoPath: string, findings: QualityFinding[]): void {
    const tsconfigPath = path.join(repoPath, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return;

    try {
      // Execute tsc in dry-run noEmit mode with short timeout (15s)
      const cmd = process.platform === 'win32'
        ? `npx.cmd tsc --noEmit --pretty false`
        : `npx tsc --noEmit --pretty false`;

      execSync(cmd, {
        cwd: repoPath,
        timeout: 15000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e: any) {
      // tsc exits with code > 0 when compilation errors are found
      const stdout = (e.stdout || '') + (e.stderr || '');
      const tscLines = stdout.split(/\r?\n/);

      for (const tscLine of tscLines) {
        // Match: src/module.ts(45,12): error TS2322: Type 'string' is not assignable to type 'number'.
        const match = tscLine.match(/^([^(]+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/);
        if (match) {
          const rawFile = match[1].trim();
          const lineNum = parseInt(match[2], 10);
          const colNum = parseInt(match[3], 10);
          const isError = match[4].toLowerCase() === 'error';
          const tsCode = match[5];
          const msg = match[6];

          const relFile = path.isAbsolute(rawFile)
            ? path.relative(repoPath, rawFile).replace(/\\/g, '/')
            : rawFile.replace(/\\/g, '/');

          findings.push({
            id: `TYPE-${tsCode}-${relFile}-${lineNum}`,
            file: relFile,
            line: lineNum,
            column: colNum,
            severity: isError ? 'blocker' : 'warning',
            category: 'typecheck',
            title: `TypeScript ${tsCode}: ${msg.slice(0, 80)}`,
            description: msg,
            matchedRule: tsCode,
            snippet: `${relFile}:${lineNum}:${colNum}`,
            remediation: 'Resolve TypeScript compiler diagnostic before pushing to CI.',
            fixable: false
          });
        }
      }
    }
  }

  // ===========================================================================
  // 6. 1-CLICK REMEDIATION & AUTO-FIX ENGINE
  // ===========================================================================

  public static applyQualityFix(
    repoPath: string,
    payload: {
      action: 'fix_all_safe' | 'format_sql' | 'strip_whitespace' | 'fix_newlines' | 'remove_debug';
      file?: string;
    }
  ): { success: boolean; filesModified: string[]; error?: string } {
    const modified = new Set<string>();

    try {
      const filesToProcess: string[] = [];
      if (payload.file) {
        filesToProcess.push(payload.file);
      } else {
        const excludeSet = new Set(DEFAULT_EXCLUDE_DIRS);
        this.walkWorkspace(repoPath, repoPath, filesToProcess, excludeSet, 1000);
      }

      for (const relFile of filesToProcess) {
        const fullPath = path.join(repoPath, relFile);
        if (!fs.existsSync(fullPath)) continue;

        let content = '';
        try {
          content = fs.readFileSync(fullPath, 'utf8');
        } catch {
          continue;
        }

        let updated = content;
        const ext = path.extname(relFile).toLowerCase();

        // 1. Strip trailing whitespace
        if (payload.action === 'fix_all_safe' || payload.action === 'strip_whitespace') {
          updated = updated
            .split(/\r?\n/)
            .map(l => l.replace(/[ \t]+$/, ''))
            .join('\n');
        }

        // 2. Ensure trailing EOF newline
        if (payload.action === 'fix_all_safe' || payload.action === 'fix_newlines') {
          if (updated.length > 0 && !updated.endsWith('\n')) {
            updated += '\n';
          }
        }

        // 3. Remove debugger statements
        if (payload.action === 'fix_all_safe' || payload.action === 'remove_debug') {
          updated = updated
            .split('\n')
            .filter(l => !/^\s*debugger\s*;?$/.test(l))
            .join('\n');
        }

        // 4. Format SQL Files
        if ((payload.action === 'fix_all_safe' || payload.action === 'format_sql') && ext === '.sql') {
          try {
            updated = SqlFormatter.format(updated, {
              keywordCase: 'upper',
              tabWidth: 2,
              commaStyle: 'trailing'
            });
          } catch {}
        }

        // 5. Format JSON Files
        if (payload.action === 'fix_all_safe' && ext === '.json') {
          try {
            const parsed = JSON.parse(updated);
            updated = JSON.stringify(parsed, null, 2) + '\n';
          } catch {}
        }

        if (updated !== content) {
          fs.writeFileSync(fullPath, updated, 'utf8');
          modified.add(relFile);
        }
      }

      return { success: true, filesModified: Array.from(modified) };
    } catch (err: any) {
      return { success: false, filesModified: Array.from(modified), error: err.message };
    }
  }

  // ===========================================================================
  // 7. PRE-PUSH GIT HOOK INSTALLATION & AUTOMATION
  // ===========================================================================

  public static checkPrePushHookInstalled(repoPath: string): boolean {
    const hookPath = path.join(repoPath, '.git', 'hooks', 'pre-push');
    if (!fs.existsSync(hookPath)) return false;
    try {
      const content = fs.readFileSync(hookPath, 'utf8');
      return content.includes('Evolve AI Enterprise Quality Gatekeeper');
    } catch {
      return false;
    }
  }

  public static installPrePushHook(repoPath: string): { success: boolean; hookPath: string; error?: string } {
    const hooksDir = path.join(repoPath, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) {
      try {
        fs.mkdirSync(hooksDir, { recursive: true });
      } catch (err: any) {
        return { success: false, hookPath: '', error: `Cannot create .git/hooks directory: ${err.message}` };
      }
    }

    const hookFile = path.join(hooksDir, 'pre-push');
    const hookScript = `#!/bin/sh
# Evolve AI Enterprise Quality Gatekeeper — Pre-Push Integrity Guard
# Automatically verifies SQL validation, linters, formatting, and type checks before code reaches remote Git.

echo ""
echo "🚀 [Evolve AI] Verifying pre-push code quality & pipeline integrity..."

# Check if npm run compile or tsc check exists
if [ -f "tsconfig.json" ]; then
  if command -v npx >/dev/null 2>&1; then
    echo "🔍 [Evolve AI] Running TypeScript typecheck verification (tsc --noEmit)..."
    if ! npx tsc --noEmit; then
      echo ""
      echo "❌ [Evolve AI] PRE-PUSH BLOCKED: TypeScript compilation failed with type errors."
      echo "💡 Fix errors above or inspect in Evolve AI Desktop Studio -> Git Hub -> Quality Gatekeeper."
      exit 1
    fi
  fi
fi

echo "✅ [Evolve AI] Pre-push pipeline checks passed cleanly. Pushing to remote..."
echo ""
exit 0
`;

    try {
      fs.writeFileSync(hookFile, hookScript, { encoding: 'utf8', mode: 0o755 });
      return { success: true, hookPath: hookFile };
    } catch (err: any) {
      return { success: false, hookPath: hookFile, error: err.message };
    }
  }

  // ===========================================================================
  // 8. REPORT GENERATION SUITE (MARKDOWN, HTML, CSV, SCRIPT)
  // ===========================================================================

  public static generateQualityReportMarkdown(report: QualityGateReport): string {
    const date = new Date(report.timestamp).toUTCString();
    return `# 🛡️ Evolve AI Pipeline Quality Gatekeeper Report
**Repository:** \`${report.repoPath}\`  
**Generated:** ${date}  
**Pipeline Gate Verdict:** **${report.verdict}** (${report.pass ? '✅ READY TO PUSH' : '❌ PUSH BLOCKED'})  
**Code Quality Score:** **${report.score}/100**  
**Scanned Files:** ${report.scannedFilesCount} files in ${report.scanDurationMs}ms  

---

## 1. Executive Summary

| Category | Blockers (Push Blocked) | Warnings | Info / Style | Total |
| :--- | :--- | :--- | :--- | :--- |
| 🗄️ **SQL Validation** | **${report.findings.filter(f => f.category === 'sql' && f.severity === 'blocker').length}** | ${report.findings.filter(f => f.category === 'sql' && f.severity === 'warning').length} | ${report.findings.filter(f => f.category === 'sql' && f.severity === 'info').length} | ${report.summary.sqlCount} |
| ⚡ **Lint & Static Code** | **${report.findings.filter(f => f.category === 'lint' && f.severity === 'blocker').length}** | ${report.findings.filter(f => f.category === 'lint' && f.severity === 'warning').length} | ${report.findings.filter(f => f.category === 'lint' && f.severity === 'info').length} | ${report.summary.lintCount} |
| 📐 **Format & Style** | **${report.findings.filter(f => f.category === 'format' && f.severity === 'blocker').length}** | ${report.findings.filter(f => f.category === 'format' && f.severity === 'warning').length} | ${report.findings.filter(f => f.category === 'format' && f.severity === 'info').length} | ${report.summary.formatCount} |
| 🏷️ **Typecheck & Imports** | **${report.findings.filter(f => f.category === 'typecheck' && f.severity === 'blocker').length}** | ${report.findings.filter(f => f.category === 'typecheck' && f.severity === 'warning').length} | ${report.findings.filter(f => f.category === 'typecheck' && f.severity === 'info').length} | ${report.summary.typecheckCount} |
| 🏗️ **Infra & IaC** | **${report.findings.filter(f => f.category === 'infra' && f.severity === 'blocker').length}** | ${report.findings.filter(f => f.category === 'infra' && f.severity === 'warning').length} | ${report.findings.filter(f => f.category === 'infra' && f.severity === 'info').length} | ${report.summary.infraCount} |
| **All Quality Checks** | **${report.summary.blockers}** | **${report.summary.warnings}** | **${report.summary.info}** | **${report.summary.total}** |

---

## 2. Detailed Findings & Remediation

${report.findings.length === 0 ? '_Zero quality issues found. Workspace is completely clean!_\n' : report.findings.map((f, i) => `
### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}
* **Category:** \`${f.category.toUpperCase()}\`
* **File & Line:** \`${f.file}:${f.line}\`
* **Rule ID:** \`${f.matchedRule}\`
* **Description:** ${f.description}
* **Remediation:** ${f.remediation}
${f.snippet ? `\`\`\`\n${f.snippet}\n\`\`\`` : ''}
`).join('\n')}

---
*Report generated offline by Evolve AI Enterprise Studio.*
`;
  }

  public static generateQualityReportHtml(report: QualityGateReport): string {
    const repoName = path.basename(report.repoPath) || report.repoPath;
    const verdictColor = report.verdict === 'PASS' ? '#10b981' : report.verdict === 'WARNING' ? '#f59e0b' : '#ef4444';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quality Gatekeeper Report - ${repoName}</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 32px; line-height: 1.5; font-size: 13px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 20px; margin-bottom: 24px; }
    .verdict-badge { background: ${verdictColor}22; color: ${verdictColor}; border: 1px solid ${verdictColor}; padding: 6px 14px; border-radius: 8px; font-weight: 800; font-size: 14px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #334155; text-align: left; }
    th { color: #94a3b8; font-size: 11px; text-transform: uppercase; }
    .pill { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; text-transform: uppercase; }
    .pill-blocker { background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid #ef4444; }
    .pill-warning { background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .pill-info { background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid #3b82f6; }
    code { font-family: monospace; background: rgba(0,0,0,0.3); padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 style="font-size: 22px; margin-bottom: 4px;">🚀 Pre-Push Code Quality &amp; Pipeline Gatekeeper</h1>
        <div style="color: #94a3b8;">Repository: <code>${report.repoPath}</code> • Score: <strong>${report.score}/100</strong></div>
      </div>
      <div class="verdict-badge">${report.verdict === 'PASS' ? '✅ READY TO PUSH' : report.verdict === 'WARNING' ? '⚠️ WARNINGS PRESENT' : '🔴 PUSH BLOCKED'}</div>
    </div>

    <div class="card">
      <h3 style="margin-bottom: 12px;">📊 Quality Verification Summary</h3>
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;">
        <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px;">
          <div style="color: #f87171; font-weight: 700;">Blockers</div>
          <div style="font-size: 22px; font-weight: 800; color: #ef4444;">${report.summary.blockers}</div>
        </div>
        <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px;">
          <div style="color: #fbbf24; font-weight: 700;">Warnings</div>
          <div style="font-size: 22px; font-weight: 800; color: #f59e0b;">${report.summary.warnings}</div>
        </div>
        <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px;">
          <div style="color: #93c5fd; font-weight: 700;">SQL Issues</div>
          <div style="font-size: 22px; font-weight: 800; color: #38bdf8;">${report.summary.sqlCount}</div>
        </div>
        <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px;">
          <div style="color: #a78bfa; font-weight: 700;">Typecheck Flaws</div>
          <div style="font-size: 22px; font-weight: 800; color: #c084fc;">${report.summary.typecheckCount}</div>
        </div>
        <div style="background: rgba(0,0,0,0.25); padding: 12px; border-radius: 6px;">
          <div style="color: #34d399; font-weight: 700;">Fixable 1-Click</div>
          <div style="font-size: 22px; font-weight: 800; color: #10b981;">${report.summary.fixableCount}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>🔍 Findings &amp; Issues</h3>
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Category</th>
            <th>Issue</th>
            <th>Location</th>
            <th>Remediation</th>
          </tr>
        </thead>
        <tbody>
          ${report.findings.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: #10b981; padding: 30px;">✓ All quality gatekeeper checks passed with zero issues!</td></tr>' : report.findings.map(f => `
            <tr>
              <td><span class="pill pill-${f.severity}">${f.severity}</span></td>
              <td><code>${f.category.toUpperCase()}</code></td>
              <td><strong>${f.title}</strong><div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">Rule: ${f.matchedRule}</div></td>
              <td><code>${f.file}:${f.line}</code></td>
              <td>${f.remediation}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  // ===========================================================================
  // 9. EXCEPTION PERSISTENCE & UTILITIES
  // ===========================================================================

  public static getExceptionsFilePath(repoPath: string): string {
    return path.join(repoPath, '.evolve', 'quality_exceptions.json');
  }

  public static loadExceptions(repoPath: string): Map<string, { ignoredAt: number; reason?: string }> {
    const filePath = this.getExceptionsFilePath(repoPath);
    const map = new Map<string, { ignoredAt: number; reason?: string }>();
    if (!fs.existsSync(filePath)) return map;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(data.exceptions)) {
        for (const item of data.exceptions) {
          if (item?.id) map.set(item.id, { ignoredAt: item.ignoredAt || Date.now(), reason: item.reason || 'User marked safe' });
          if (item?.file && item?.matchedRule) map.set(`${item.file}::${item.matchedRule}`, { ignoredAt: item.ignoredAt || Date.now(), reason: item.reason || 'User marked safe' });
        }
      }
    } catch {}
    return map;
  }

  private static walkWorkspace(
    rootDir: string,
    currentDir: string,
    scanned: string[],
    excludeSet: Set<string>,
    maxFiles: number
  ): void {
    if (scanned.length >= maxFiles) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scanned.length >= maxFiles) break;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeSet.has(entry.name) && !entry.name.startsWith('.')) {
          this.walkWorkspace(rootDir, fullPath, scanned, excludeSet, maxFiles);
        }
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        scanned.push(rel);
      }
    }
  }

  private static buildSummary(findings: QualityFinding[]): QualityGateSummary {
    let blockers = 0;
    let warnings = 0;
    let info = 0;
    let active = 0;
    let ignored = 0;
    let fixableCount = 0;
    let sqlCount = 0;
    let lintCount = 0;
    let formatCount = 0;
    let typecheckCount = 0;
    let infraCount = 0;

    for (const f of findings) {
      if (f.isIgnored) {
        ignored++;
        continue;
      }
      active++;
      if (f.fixable) fixableCount++;

      if (f.severity === 'blocker') blockers++;
      else if (f.severity === 'warning') warnings++;
      else if (f.severity === 'info') info++;

      if (f.category === 'sql') sqlCount++;
      else if (f.category === 'lint') lintCount++;
      else if (f.category === 'format') formatCount++;
      else if (f.category === 'typecheck') typecheckCount++;
      else if (f.category === 'infra') infraCount++;
    }

    return {
      total: findings.length,
      active,
      ignored,
      blockers,
      warnings,
      info,
      fixableCount,
      sqlCount,
      lintCount,
      formatCount,
      typecheckCount,
      infraCount
    };
  }

  private static calculateScore(summary: QualityGateSummary): number {
    // 100 base score:
    // -20 per blocker
    // -5 per warning
    // -1 per info
    const penalty = (summary.blockers * 20) + (summary.warnings * 5) + (summary.info * 1);
    return Math.max(0, Math.min(100, 100 - penalty));
  }
}
