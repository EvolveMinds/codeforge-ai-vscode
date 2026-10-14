/**
 * fde/codebaseGraph/repoSecurityScanner.ts — Global Multi-Jurisdiction Security & Secret Scanner
 *
 * Deterministically scans local repositories for:
 *  - Universal Credential & Secret Leaks (Cloud, AI, VCS, Payment, PEM keys, DB connection strings)
 *  - Global Multi-Jurisdiction PII & Compliance Leaks (US SSN/EIN/HIPAA, UK NINO/NHS, EU IBAN,
 *    Canadian SIN, Australian TFN, Credit Cards Luhn, Singapore NRIC)
 *  - Static Application Security Testing (SAST) Code Vulnerabilities (SQLi, Command Injection, Path Traversal, Insecure Crypto)
 *  - Git Working Tree & Repository Hygiene (.env, certificates, service account files, unpinned dependencies)
 *
 * 100% Offline, Deterministic, Zero Cloud Calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SecurityFinding,
  SecurityAuditReport,
  SecurityAuditSummary,
  SecuritySeverity,
  SecurityCategory,
  SecurityJurisdiction,
  SecurityScanOptions
} from './types';

// =============================================================================
// 1. ALGORITHMIC CHECKSUM & ENTROPY UTILITIES
// =============================================================================

/**
 * Calculates Shannon Entropy for a candidate string (bits of entropy per character).
 * Random API keys and cryptographically secure tokens generally exhibit entropy > 3.8 bits/char.
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const char of str) {
    freq[char] = (freq[char] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const char in freq) {
    const p = freq[char] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Validates 13-19 digit number against the ISO/IEC 7812 Luhn algorithm.
 * Used for Credit/Debit Cards (PAN) and Canadian Social Insurance Numbers (SIN).
 */
export function validateLuhn(numStr: string): boolean {
  const clean = numStr.replace(/[\s-]/g, '');
  if (!/^\d{9,19}$/.test(clean)) return false;

  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Validates Canadian 9-digit Social Insurance Number (SIN) via Luhn algorithm.
 */
export function validateCanadianSin(sin: string): boolean {
  const clean = sin.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(clean)) return false;
  return validateLuhn(clean);
}

/**
 * Validates Australian 8 or 9 digit Tax File Number (TFN) via Modulo-11 weighting.
 */
export function validateAustralianTfn(tfn: string): boolean {
  const clean = tfn.replace(/[\s-]/g, '');
  if (/^\d{8}$/.test(clean)) {
    const weights = [10, 7, 8, 4, 6, 3, 5, 1];
    const sum = clean.split('').reduce((acc, digit, idx) => acc + parseInt(digit, 10) * weights[idx], 0);
    return sum % 11 === 0;
  }
  if (/^\d{9}$/.test(clean)) {
    const weights = [1, 4, 3, 7, 5, 8, 6, 9, 10];
    const sum = clean.split('').reduce((acc, digit, idx) => acc + parseInt(digit, 10) * weights[idx], 0);
    return sum % 11 === 0;
  }
  return false;
}

/**
 * Validates International Bank Account Number (IBAN) using ISO 13616 Modulo-97 algorithm.
 */
export function validateIban(iban: string): boolean {
  const clean = iban.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, ch => (ch.charCodeAt(0) - 55).toString());

  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = remainder.toString() + numeric.substring(i, i + 7);
    remainder = parseInt(chunk, 10) % 97;
  }
  return remainder === 1;
}

/**
 * Validates UK 10-digit National Health Service (NHS) number using Modulo-11 checksum.
 */
export function validateUkNhs(nhs: string): boolean {
  const clean = nhs.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(clean)) return false;
  const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean[i], 10) * weights[i];
  }
  const remainder = sum % 11;
  const checkDigit = 11 - remainder;
  const expected = checkDigit === 11 ? 0 : checkDigit;
  if (expected === 10) return false;
  return parseInt(clean[9], 10) === expected;
}

/**
 * Validates US Social Security Number format and excludes impossible prefixes/groups.
 */
export function validateUsSsn(ssn: string): boolean {
  const match = ssn.match(/^(\d{3})-(\d{2})-(\d{4})$/);
  if (!match) return false;
  const area = parseInt(match[1], 10);
  const group = parseInt(match[2], 10);
  const serial = parseInt(match[3], 10);

  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;
  return true;
}

// =============================================================================
// 2. SCANNER ENGINE & RULES REGISTRY
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

const RECOMMENDED_GITIGNORE_ENTRIES = [
  '.env',
  '.env.local',
  '.env.*.local',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_ed25519',
  '*credentials*.json',
  '*serviceAccount*.json',
  '.secrets'
];

export class RepoSecurityScanner {
  /**
   * Main entry point: Scans repository files and produces structured SecurityAuditReport.
   */
  public static scan(repoPath: string, options?: SecurityScanOptions): SecurityAuditReport {
    const startTime = Date.now();
    const excludeDirs = new Set(options?.excludeDirs || DEFAULT_EXCLUDE_DIRS);
    const maxFiles = options?.maxFiles ?? 2500;
    const jurisdiction = options?.jurisdiction || 'all';

    const findings: SecurityFinding[] = [];
    const scannedFiles: string[] = [];

    // Load persistent developer exceptions / ignores
    const exceptions = this.loadExceptions(repoPath);

    // 1. Walk repository filesystem
    this.walkWorkspace(repoPath, repoPath, scannedFiles, excludeDirs, maxFiles);

    // 2. Scan tracked files for hygiene and sensitive files
    this.auditFileHygiene(repoPath, scannedFiles, findings);

    // 3. Scan contents of each file
    for (const relFile of scannedFiles) {
      const absPath = path.join(repoPath, relFile);
      this.scanFileContent(absPath, relFile, jurisdiction, findings);
    }

    // 4. Correlate with persistent exceptions
    for (const f of findings) {
      const exc = exceptions.get(f.id) || exceptions.get(`${f.file}::${f.matchedRule}`);
      if (exc) {
        f.isIgnored = true;
        f.ignoredAt = exc.ignoredAt;
        f.ignoredReason = exc.reason;
      }
    }

    // 5. Check missing .gitignore entries
    const missingGitignorePatterns = this.checkMissingGitignore(repoPath);

    // 6. Calculate summary metrics & executive health score
    const summary = this.buildSummary(findings);
    const score = this.calculateScore(summary);
    const grade = this.scoreToGrade(score);

    return {
      timestamp: Date.now(),
      repoPath,
      score,
      grade,
      pass: summary.critical === 0 && summary.high === 0,
      findings,
      summary,
      scannedFilesCount: scannedFiles.length,
      scanDurationMs: Date.now() - startTime,
      missingGitignorePatterns,
      exceptionsPath: this.getExceptionsFilePath(repoPath)
    };
  }

  /**
   * Scans a single file's text line by line.
   */
  private static scanFileContent(
    absPath: string,
    relPath: string,
    targetJurisdiction: string,
    findings: SecurityFinding[]
  ): void {
    let content = '';
    try {
      // Skip large binary or minified files (> 2 MB)
      const stat = fs.statSync(absPath);
      if (stat.size > 2 * 1024 * 1024) return;
      content = fs.readFileSync(absPath, 'utf8');
    } catch {
      return;
    }

    const lines = content.split('\n');
    const isSourceCode = /\.(ts|tsx|js|jsx|py|java|cs|go|rs|php|rb)$/i.test(relPath);
    const isConfigFile = /\.(json|ya?ml|env|toml|ini|xml)$/i.test(relPath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      if (line.trim().length === 0 || line.length > 2000) continue;

      // -----------------------------------------------------------------------
      // A. UNIVERSAL SECRETS & CREDENTIALS
      // -----------------------------------------------------------------------
      this.checkUniversalSecrets(line, lineNum, relPath, findings);

      // -----------------------------------------------------------------------
      // B. GLOBAL MULTI-JURISDICTION PII & COMPLIANCE
      // -----------------------------------------------------------------------
      this.checkPiiCompliance(line, lineNum, relPath, targetJurisdiction, findings);

      // -----------------------------------------------------------------------
      // C. STATIC APPLICATION SECURITY TESTING (SAST)
      // -----------------------------------------------------------------------
      if (isSourceCode) {
        this.checkSastVulnerabilities(line, lineNum, relPath, findings);
      }
    }
  }

  /**
   * Checks for Cloud, AI, VCS, and Database secrets.
   */
  private static checkUniversalSecrets(
    line: string,
    lineNum: number,
    relPath: string,
    findings: SecurityFinding[]
  ): void {
    // 1. OpenAI Keys
    const openAiMatch = line.match(/\b(sk-proj-[A-Za-z0-9_-]{48,}|sk-[A-Za-z0-9]{32,})\b/);
    if (openAiMatch) {
      findings.push({
        id: `SEC-OPENAI-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Exposed OpenAI API Key',
        description: 'Hardcoded OpenAI API key detected. Leaked keys can lead to unauthorized API access, quota exhaustion, and billing charges.',
        maskedSnippet: this.maskSecret(line, openAiMatch[1]),
        rawSnippet: line.trim(),
        matchedRule: 'OPENAI_API_KEY',
        complianceTag: 'CWE-798 Hardcoded Credentials',
        remediation: 'Move key to environment variable (e.g. OPENAI_API_KEY) and store in secure vault.',
        fixable: true,
        entropy: calculateShannonEntropy(openAiMatch[1])
      });
    }

    // 2. Anthropic Claude Keys
    const anthropicMatch = line.match(/\b(sk-ant-api03-[A-Za-z0-9_-]{80,}|sk-ant-[A-Za-z0-9_-]{30,})\b/);
    if (anthropicMatch) {
      findings.push({
        id: `SEC-CLAUDE-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Exposed Anthropic Claude API Key',
        description: 'Hardcoded Anthropic API secret key detected.',
        maskedSnippet: this.maskSecret(line, anthropicMatch[1]),
        rawSnippet: line.trim(),
        matchedRule: 'ANTHROPIC_API_KEY',
        complianceTag: 'CWE-798 Hardcoded Credentials',
        remediation: 'Store in environment variable ANTHROPIC_API_KEY or AWS Secrets Manager.',
        fixable: true,
        entropy: calculateShannonEntropy(anthropicMatch[1])
      });
    }

    // 3. Google Cloud / Gemini Keys
    const geminiMatch = line.match(/\bAIza[0-9A-Za-z-_]{35}\b/);
    if (geminiMatch && !relPath.includes('test') && !relPath.includes('example')) {
      findings.push({
        id: `SEC-GEMINI-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Exposed Google Cloud / Gemini API Key',
        description: 'Live Google Cloud / Gemini API key detected.',
        maskedSnippet: this.maskSecret(line, geminiMatch[0]),
        rawSnippet: line.trim(),
        matchedRule: 'GOOGLE_API_KEY',
        complianceTag: 'CWE-798 Hardcoded Credentials',
        remediation: 'Rotate this API key in Google Cloud Console and pass via environment variables.',
        fixable: true,
        entropy: calculateShannonEntropy(geminiMatch[0])
      });
    }

    // 4. AWS Access Keys
    const awsMatch = line.match(/\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/);
    if (awsMatch) {
      findings.push({
        id: `SEC-AWS-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Exposed AWS Access Key ID',
        description: 'Hardcoded AWS Access Key ID detected. Gives authenticated access to AWS infrastructure.',
        maskedSnippet: this.maskSecret(line, awsMatch[0]),
        rawSnippet: line.trim(),
        matchedRule: 'AWS_ACCESS_KEY',
        complianceTag: 'CWE-798 Hardcoded Credentials',
        remediation: 'Rotate IAM access key immediately and configure AWS IAM Roles / Instance Profiles.',
        fixable: true,
        entropy: calculateShannonEntropy(awsMatch[0])
      });
    }

    // 5. GitHub Personal Access Tokens
    const ghMatch = line.match(/\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/);
    if (ghMatch) {
      findings.push({
        id: `SEC-GH-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Exposed GitHub Personal Access Token (PAT)',
        description: 'Hardcoded GitHub Personal Access Token detected.',
        maskedSnippet: this.maskSecret(line, ghMatch[0]),
        rawSnippet: line.trim(),
        matchedRule: 'GITHUB_PAT',
        complianceTag: 'CWE-798 Hardcoded Credentials',
        remediation: 'Revoke token immediately in GitHub Settings -> Developer Settings -> Personal access tokens.',
        fixable: true,
        entropy: calculateShannonEntropy(ghMatch[0])
      });
    }

    // 6. GitLab Personal Access Tokens
    const glMatch = line.match(/\bglpat-[0-9a-zA-Z\-_]{20,}\b/);
    if (glMatch) {
      findings.push({
        id: `SEC-GL-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Exposed GitLab Personal Access Token',
        description: 'Hardcoded GitLab PAT detected.',
        maskedSnippet: this.maskSecret(line, glMatch[0]),
        rawSnippet: line.trim(),
        matchedRule: 'GITLAB_PAT',
        complianceTag: 'CWE-798 Hardcoded Credentials',
        remediation: 'Revoke token in GitLab User Settings -> Access Tokens.',
        fixable: true
      });
    }

    // 7. Stripe Live Keys
    const stripeMatch = line.match(/\b(sk_live_[0-9a-zA-Z]{24,}|rk_live_[0-9a-zA-Z]{24,})\b/);
    if (stripeMatch) {
      findings.push({
        id: `SEC-STRIPE-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Exposed Stripe Live Secret Key',
        description: 'Live Stripe payment secret key detected. Allows financial operations and charge creation.',
        maskedSnippet: this.maskSecret(line, stripeMatch[0]),
        rawSnippet: line.trim(),
        matchedRule: 'STRIPE_LIVE_KEY',
        complianceTag: 'PCI-DSS Req 3 & CWE-798',
        remediation: 'Rotate this secret key in the Stripe Dashboard immediately.',
        fixable: true
      });
    }

    // 8. PEM Private Keys
    if (/-----BEGIN (?:RSA|EC|DSA|OPENSSH|PGP)? PRIVATE KEY-----/.test(line)) {
      findings.push({
        id: `SEC-PEM-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Hardcoded Private Cryptographic Key (PEM)',
        description: 'Private SSH / TLS certificate key embedded in source files.',
        maskedSnippet: '-----BEGIN [REDACTED PRIVATE KEY]-----',
        rawSnippet: line.trim(),
        matchedRule: 'PEM_PRIVATE_KEY',
        complianceTag: 'CWE-321 Use of Hard-coded Cryptographic Key',
        remediation: 'Remove private key from repository. Store certificates in Cloud KMS or Secret Manager.',
        fixable: true
      });
    }

    // 9. Database Connection String with Cleartext Password
    const dbMatch = line.match(/\b(?:postgres|mysql|mongodb|mongodb\+srv|redis|mariadb):\/\/[^:\s'"]+:([^@\s'"]+)@/i);
    if (dbMatch && dbMatch[1] && dbMatch[1].length > 3 && !dbMatch[1].includes('${') && !dbMatch[1].includes('password')) {
      findings.push({
        id: `SEC-DBCONN-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'high',
        category: 'secret',
        jurisdiction: 'global',
        title: 'Database URI with Plaintext Password',
        description: 'Relational or NoSQL connection string contains embedded database credentials.',
        maskedSnippet: this.maskSecret(line, dbMatch[1]),
        rawSnippet: line.trim(),
        matchedRule: 'DATABASE_CONN_PASSWORD',
        complianceTag: 'CWE-798 Hardcoded Credentials',
        remediation: 'Pass DATABASE_URL via secure environment variable without committing credentials.',
        fixable: true
      });
    }
  }

  /**
   * Checks multi-jurisdiction PII compliance standards (Luhn PAN, SSN, SIN, NINO, NHS, TFN, IBAN).
   * Context-aware: intelligently distinguishes real production leaks from comments, mocks, and placeholders.
   */
  private static checkPiiCompliance(
    line: string,
    lineNum: number,
    relPath: string,
    jurisdiction: string,
    findings: SecurityFinding[]
  ): void {
    const isGlobalOr = (jur: string) => jurisdiction === 'all' || jurisdiction === jur;
    const isPlaceholderOrComment = this.isCommentOrPlaceholder(line, relPath);

    // 1. Payment Cards (PAN) via Luhn Algorithm (Universal International Standard)
    if (isGlobalOr('global')) {
      const ccCandidates = line.match(/\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{15,16}\b/g);
      if (ccCandidates) {
        for (const candidate of ccCandidates) {
          if (this.isTrivialOrMockNumber(candidate)) continue;
          if (validateLuhn(candidate)) {
            const isInfo = isPlaceholderOrComment;
            findings.push({
              id: `PII-CARD-${relPath}-${lineNum}`,
              file: relPath,
              line: lineNum,
              severity: isInfo ? 'info' : 'critical',
              category: 'pii',
              jurisdiction: 'global',
              title: isInfo ? 'Payment Card (PAN) Pattern (Mock / Test Example)' : 'Exposed Credit/Debit Card Number (PAN)',
              description: isInfo
                ? 'Payment card test pattern (passes Luhn) detected inside documentation, comment, or mock fixture.'
                : 'Valid payment card number (verified by Luhn algorithm) detected in codebase.',
              maskedSnippet: this.maskCard(line, candidate),
              rawSnippet: line.trim(),
              matchedRule: 'PAYMENT_CARD_LUHN',
              complianceTag: 'PCI-DSS Req 3.4 Protection of Cardholder Data',
              remediation: isInfo
                ? 'Verify this is purely synthetic sandbox test data (e.g. Stripe 4242 test card) and not committed live cards.'
                : 'Immediately purge cardholder data from code and commit history. Use tokenization.',
              fixable: true,
              isExample: isInfo
            });
            break;
          }
        }
      }
    }

    // 2. International Bank Account Number (IBAN - ISO 13616 Mod-97)
    if (isGlobalOr('eu') || isGlobalOr('uk') || isGlobalOr('global')) {
      const ibanMatch = line.match(/\b[A-Z]{2}\d{2}[A-Za-z0-9]{11,30}\b/g);
      if (ibanMatch) {
        for (const candidate of ibanMatch) {
          if (validateIban(candidate)) {
            const isInfo = isPlaceholderOrComment;
            findings.push({
              id: `PII-IBAN-${relPath}-${lineNum}`,
              file: relPath,
              line: lineNum,
              severity: isInfo ? 'info' : 'high',
              category: 'pii',
              jurisdiction: 'eu',
              title: isInfo ? 'IBAN Pattern (Mock / Documentation Example)' : 'Exposed International Bank Account Number (IBAN)',
              description: isInfo
                ? 'IBAN pattern (verified Mod-97) detected in documentation, test fixture, or sample.'
                : 'Valid IBAN account number (verified by ISO 13616 Mod-97) detected.',
              maskedSnippet: this.maskSecret(line, candidate),
              rawSnippet: line.trim(),
              matchedRule: 'EU_IBAN_MOD97',
              complianceTag: 'GDPR Article 9 & PSD2',
              remediation: isInfo
                ? 'Ensure sample IBAN remains synthetic and is never populated with real customer accounts.'
                : 'Redact bank account numbers from test fixtures or source code.',
              fixable: true,
              isExample: isInfo
            });
            break;
          }
        }
      }
    }

    // 3. United States: Social Security Number (SSN)
    if (isGlobalOr('us')) {
      const ssnMatches = line.match(/\b\d{3}-\d{2}-\d{4}\b/g);
      if (ssnMatches) {
        for (const candidate of ssnMatches) {
          if (this.isTrivialOrMockNumber(candidate)) continue;
          if (validateUsSsn(candidate)) {
            const isInfo = isPlaceholderOrComment;
            findings.push({
              id: `PII-SSN-${relPath}-${lineNum}`,
              file: relPath,
              line: lineNum,
              severity: isInfo ? 'info' : 'high',
              category: 'pii',
              jurisdiction: 'us',
              title: isInfo ? 'US SSN Pattern (Mock / Test Example)' : 'Exposed US Social Security Number (SSN)',
              description: isInfo
                ? 'US Social Security Number pattern detected inside comment, fixture, or form placeholder.'
                : 'Valid US Social Security Number detected in plaintext.',
              maskedSnippet: this.maskSecret(line, candidate),
              rawSnippet: line.trim(),
              matchedRule: 'US_SSN_PATTERN',
              complianceTag: 'US Privacy Act / HIPAA § 164.514',
              remediation: isInfo
                ? 'Ensure SSN test string is synthetic. Live SSNs must never be logged or stored unencrypted.'
                : 'Scrub SSN from source code. Use synthetic anonymized fixtures for testing.',
              fixable: true,
              isExample: isInfo
            });
            break;
          }
        }
      }
    }

    // 4. Canada: Social Insurance Number (SIN)
    if (isGlobalOr('ca')) {
      const hasSinContext = /(?:sin|social\s*insur|canada)\b/i.test(line);
      const sinMatches = line.match(/\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g);
      if (sinMatches && (hasSinContext || /^\d{3}-\d{3}-\d{3}$/.test(line.trim()))) {
        for (const candidate of sinMatches) {
          if (this.isTrivialOrMockNumber(candidate)) continue;
          if (validateCanadianSin(candidate)) {
            const isInfo = isPlaceholderOrComment;
            findings.push({
              id: `PII-SIN-${relPath}-${lineNum}`,
              file: relPath,
              line: lineNum,
              severity: isInfo ? 'info' : 'high',
              category: 'pii',
              jurisdiction: 'ca',
              title: isInfo ? 'Canadian SIN Pattern (Mock / Test Example)' : 'Exposed Canadian Social Insurance Number (SIN)',
              description: isInfo
                ? 'Canadian Social Insurance Number pattern detected in comment or test fixture.'
                : 'Valid Canadian 9-digit SIN (verified by Luhn algorithm) detected.',
              maskedSnippet: this.maskSecret(line, candidate),
              rawSnippet: line.trim(),
              matchedRule: 'CA_SIN_LUHN',
              complianceTag: 'PIPEDA Schedule 1',
              remediation: isInfo
                ? 'Verify this is synthetic test data. Ensure live Canadian SIN numbers are not committed.'
                : 'Anonymize or scrub Canadian SIN records.',
              fixable: true,
              isExample: isInfo
            });
            break;
          }
        }
      }
    }

    // 5. United Kingdom: National Insurance Number (NINO) & NHS Number
    if (isGlobalOr('uk')) {
      const ninoMatch = line.match(/\b[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}\d{6}[A-D]{1}\b/);
      if (ninoMatch) {
        const isInfo = isPlaceholderOrComment;
        findings.push({
          id: `PII-NINO-${relPath}-${lineNum}`,
          file: relPath,
          line: lineNum,
          severity: isInfo ? 'info' : 'high',
          category: 'pii',
          jurisdiction: 'uk',
          title: isInfo ? 'UK NINO Pattern (Mock / Test Example)' : 'Exposed UK National Insurance Number (NINO)',
          description: isInfo
            ? 'UK National Insurance Number pattern detected in comment or mock dataset.'
            : 'Valid UK National Insurance Number detected.',
          maskedSnippet: this.maskSecret(line, ninoMatch[0]),
          rawSnippet: line.trim(),
          matchedRule: 'UK_NINO_PATTERN',
          complianceTag: 'UK Data Protection Act 2018 / GDPR',
          remediation: isInfo
            ? 'Verify synthetic format. Do not store real citizen identifiers in source code.'
            : 'Scrub UK NINO from source and seed datasets.',
          fixable: true,
          isExample: isInfo
        });
      }

      const hasNhsContext = /(?:nhs|patient|national\s*health)\b/i.test(line);
      if (hasNhsContext) {
        const nhsCandidates = line.match(/\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b|\b\d{10}\b/g);
        if (nhsCandidates) {
          for (const cand of nhsCandidates) {
            if (this.isTrivialOrMockNumber(cand)) continue;
            if (validateUkNhs(cand)) {
              const isInfo = isPlaceholderOrComment;
              findings.push({
                id: `PII-NHS-${relPath}-${lineNum}`,
                file: relPath,
                line: lineNum,
                severity: isInfo ? 'info' : 'high',
                category: 'pii',
                jurisdiction: 'uk',
                title: isInfo ? 'UK NHS Patient Number (Mock / Test Example)' : 'Exposed UK NHS Patient Number',
                description: isInfo
                  ? 'UK NHS 10-digit number pattern detected in comment, test fixture, or documentation.'
                  : 'Valid 10-digit UK National Health Service patient identifier (verified by Mod-11) detected.',
                maskedSnippet: this.maskSecret(line, cand),
                rawSnippet: line.trim(),
                matchedRule: 'UK_NHS_MOD11',
                complianceTag: 'NHS Caldicott Principles / UK GDPR',
                remediation: isInfo
                  ? 'Verify synthetic nature of test vector. Live NHS numbers must be protected under Caldicott principles.'
                  : 'Redact healthcare identifiers to maintain patient confidentiality.',
                fixable: true,
                isExample: isInfo
              });
              break;
            }
          }
        }
      }
    }

    // 6. Australia: Tax File Number (TFN)
    if (isGlobalOr('au')) {
      // Must have tax/tfn context keywords, or explicit delimiter formatting to avoid false matches on random 8-9 digit numbers
      const hasTfnContext = /(?:tfn|tax\s*file|taxpayer|ato|medicare)\b/i.test(line);
      const isFormattedTfn = /\b\d{3}[-\s]\d{3}[-\s]\d{2,3}\b/.test(line);

      if (hasTfnContext || isFormattedTfn) {
        const tfnCandidates = line.match(/\b\d{3}[-\s]?\d{3}[-\s]?\d{2,3}\b|\b\d{8,9}\b/g);
        if (tfnCandidates) {
          for (const cand of tfnCandidates) {
            if (this.isTrivialOrMockNumber(cand)) continue;
            if (validateAustralianTfn(cand)) {
              const isInfo = isPlaceholderOrComment;
              findings.push({
                id: `PII-TFN-${relPath}-${lineNum}`,
                file: relPath,
                line: lineNum,
                severity: isInfo ? 'info' : 'high',
                category: 'pii',
                jurisdiction: 'au',
                title: isInfo ? 'Australian TFN Pattern (Documentation / Mock Example)' : 'Exposed Australian Tax File Number (TFN)',
                description: isInfo
                  ? 'Australian Tax File Number pattern detected inside documentation, comment, or form placeholder.'
                  : 'Valid Australian Tax File Number (verified by Modulo-11 weighting) detected in code/configuration.',
                maskedSnippet: this.maskSecret(line, cand),
                rawSnippet: line.trim(),
                matchedRule: 'AU_TFN_MOD11',
                complianceTag: 'Privacy Act 1988 (Cth) & TFN Rule 2015',
                remediation: isInfo
                  ? 'Verify this is purely synthetic mock data. For production, ensure no live customer TFNs are logged.'
                  : 'TFNs must be encrypted or de-identified before ingestion into databases or LLMs.',
                fixable: true,
                isExample: isInfo
              });
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Checks Static Application Security Testing (SAST) vulnerabilities.
   */
  private static checkSastVulnerabilities(
    line: string,
    lineNum: number,
    relPath: string,
    findings: SecurityFinding[]
  ): void {
    // 1. SQL Injection Risk (String concatenation / interpolation in queries)
    const sqlConcatenationJs = /(?:db|pool|client|connection|sequelize|prisma)\.(?:query|raw|execute)\s*\(\s*`[^`]*\${[^}]+}[^`]*`/i;
    const sqlConcatenationPy = /(?:cursor|session|conn)\.execute\s*\(\s*f["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*\{[^}]+\}/i;
    if (sqlConcatenationJs.test(line) || sqlConcatenationPy.test(line)) {
      findings.push({
        id: `SAST-SQLI-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'high',
        category: 'sast',
        jurisdiction: 'global',
        title: 'Potential SQL Injection (Raw Interpolation)',
        description: 'Dynamic string interpolation detected inside database query call.',
        maskedSnippet: line.trim().slice(0, 100),
        rawSnippet: line.trim(),
        matchedRule: 'SAST_SQL_INTERPOLATION',
        complianceTag: 'CWE-89 SQL Injection / OWASP Top 10 A03',
        remediation: 'Use parameterized queries or prepared statements (e.g. query("SELECT * WHERE id = $1", [id])).',
        fixable: false
      });
    }

    // 2. Command Injection & Arbitrary Code Execution (RCE)
    const cmdInjJs = /child_process\.(?:exec|execSync)\s*\(\s*`[^`]*\${[^}]+}[^`]*`/;
    const cmdInjPy = /os\.system\s*\(\s*f["'][^"']*\{[^}]+\}/;
    if (cmdInjJs.test(line) || cmdInjPy.test(line) || /subprocess\.Popen\s*\([^)]*shell\s*=\s*True/i.test(line)) {
      findings.push({
        id: `SAST-CMDINJ-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'critical',
        category: 'sast',
        jurisdiction: 'global',
        title: 'Potential OS Command Injection',
        description: 'Shell command executed with interpolated dynamic arguments.',
        maskedSnippet: line.trim().slice(0, 100),
        rawSnippet: line.trim(),
        matchedRule: 'SAST_COMMAND_INJECTION',
        complianceTag: 'CWE-78 OS Command Injection / OWASP Top 10 A03',
        remediation: 'Use child_process.execFile with argument array or subprocess.run without shell=True.',
        fixable: false
      });
    }

    // 3. Path Traversal
    if (/(?:fs\.readFileSync|fs\.readFile|open)\s*\(\s*(?:path\.join\([^)]*req\.|req\.(?:query|params|body))/i.test(line)) {
      findings.push({
        id: `SAST-PATHTRAV-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'medium',
        category: 'sast',
        jurisdiction: 'global',
        title: 'Potential Path Traversal File Access',
        description: 'File operation directly concatenates untrusted user request parameters.',
        maskedSnippet: line.trim().slice(0, 100),
        rawSnippet: line.trim(),
        matchedRule: 'SAST_PATH_TRAVERSAL',
        complianceTag: 'CWE-22 Path Traversal',
        remediation: 'Validate input against whitelist or ensure resolved path resides inside approved sandbox directory.',
        fixable: false
      });
    }

    // 4. Insecure Cryptography (MD5 / SHA1 for passwords)
    if (/createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)|hashlib\.(?:md5|sha1)\s*\(/i.test(line)) {
      findings.push({
        id: `SAST-CRYPTO-${relPath}-${lineNum}`,
        file: relPath,
        line: lineNum,
        severity: 'low',
        category: 'sast',
        jurisdiction: 'global',
        title: 'Weak Cryptographic Hash Algorithm',
        description: 'MD5 / SHA-1 detected. Insecure for passwords or digital signatures due to collision vulnerabilities.',
        maskedSnippet: line.trim().slice(0, 100),
        rawSnippet: line.trim(),
        matchedRule: 'SAST_WEAK_CRYPTO',
        complianceTag: 'CWE-327 Broken or Risky Cryptographic Algorithm',
        remediation: 'Upgrade to SHA-256 / SHA-3 for digests, or argon2 / bcrypt for passwords.',
        fixable: false
      });
    }
  }

  /**
   * Scans tracked repository file paths for committed secret files.
   */
  private static auditFileHygiene(
    repoPath: string,
    scannedFiles: string[],
    findings: SecurityFinding[]
  ): void {
    for (const relFile of scannedFiles) {
      const base = path.basename(relFile).toLowerCase();

      // Check committed .env files
      if (base === '.env' || base === '.env.local' || base === '.env.production') {
        findings.push({
          id: `HYG-ENV-${relFile}`,
          file: relFile,
          line: 1,
          severity: 'high',
          category: 'hygiene',
          jurisdiction: 'global',
          title: 'Tracked Environment File (.env)',
          description: `Environment configuration file "${relFile}" is tracked in the repository.`,
          maskedSnippet: `File: ${relFile}`,
          rawSnippet: relFile,
          matchedRule: 'HYGIENE_TRACKED_ENV_FILE',
          complianceTag: 'CWE-200 Information Exposure',
          remediation: 'Add to .gitignore and remove from git index using `git rm --cached`.',
          fixable: true
        });
      }

      // Check committed private key files
      if (base.endsWith('.pem') || base.endsWith('.key') || base === 'id_rsa' || base === 'id_ed25519') {
        findings.push({
          id: `HYG-KEYFILE-${relFile}`,
          file: relFile,
          line: 1,
          severity: 'critical',
          category: 'hygiene',
          jurisdiction: 'global',
          title: 'Tracked Private Key File',
          description: `Private key certificate file "${relFile}" is committed to repository.`,
          maskedSnippet: `File: ${relFile}`,
          rawSnippet: relFile,
          matchedRule: 'HYGIENE_TRACKED_KEY_FILE',
          complianceTag: 'CWE-312 Cleartext Storage of Sensitive Information',
          remediation: 'Remove key file immediately and rotate any associated certificates.',
          fixable: true
        });
      }

      // Check committed service account keys
      if (base.includes('serviceaccount') && base.endsWith('.json')) {
        findings.push({
          id: `HYG-SERVICEACC-${relFile}`,
          file: relFile,
          line: 1,
          severity: 'critical',
          category: 'hygiene',
          jurisdiction: 'global',
          title: 'Tracked Service Account Key JSON',
          description: `Cloud service account credentials "${relFile}" tracked in codebase.`,
          maskedSnippet: `File: ${relFile}`,
          rawSnippet: relFile,
          matchedRule: 'HYGIENE_SERVICE_ACCOUNT_JSON',
          complianceTag: 'CWE-798 Hardcoded Credentials',
          remediation: 'Delete from Git history and revoke key in cloud console.',
          fixable: true
        });
      }
    }
  }

  /**
   * Identifies missing recommended patterns in .gitignore.
   */
  public static checkMissingGitignore(repoPath: string): string[] {
    const gitignorePath = path.join(repoPath, '.gitignore');
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      try {
        gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      } catch {}
    }

    const missing: string[] = [];
    for (const pattern of RECOMMENDED_GITIGNORE_ENTRIES) {
      if (!gitignoreContent.includes(pattern)) {
        missing.push(pattern);
      }
    }
    return missing;
  }

  /**
   * 1-Click Auto-Patch: Safely appends missing security rules to .gitignore.
   */
  public static patchGitignore(repoPath: string, patternsToAppend?: string[]): { success: boolean; added: string[] } {
    const gitignorePath = path.join(repoPath, '.gitignore');
    const missing = patternsToAppend || this.checkMissingGitignore(repoPath);
    if (missing.length === 0) {
      return { success: true, added: [] };
    }

    const block = `\n# --- Evolve AI Enterprise Security Guardrails ---\n${missing.join('\n')}\n`;
    try {
      fs.appendFileSync(gitignorePath, block, 'utf8');
      return { success: true, added: missing };
    } catch {
      return { success: false, added: [] };
    }
  }

  /**
   * 1-Click Pre-Commit Hook Scaffolding: Drops a zero-dependency secret scanner pre-commit hook into .git/hooks/pre-commit.
   */
  public static installPreCommitHook(repoPath: string): { success: boolean; hookPath: string } {
    const hooksDir = path.join(repoPath, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'pre-commit');

    if (!fs.existsSync(hooksDir)) {
      try {
        fs.mkdirSync(hooksDir, { recursive: true });
      } catch {
        return { success: false, hookPath };
      }
    }

    const hookScript = `#!/bin/sh
# Evolve AI Enterprise Pre-Commit Security Guard
# Blocks commits containing plaintext API keys, private keys, or tracked .env files.

echo "🛡️  Running Evolve AI Pre-Commit Security Guard..."

# 1. Check for staged .env files
STAGED_ENV=$(git diff --cached --name-only | grep -E '^(\.env|\.env\.local|\.env\.production)$')
if [ -n "$STAGED_ENV" ]; then
  echo "❌ [SECURITY ERROR] Attempting to commit environment file: $STAGED_ENV"
  echo "   Remove with: git reset HEAD $STAGED_ENV"
  exit 1
fi

# 2. Check for staged private keys
STAGED_KEYS=$(git diff --cached --name-only | grep -E '\.(pem|key)$|id_rsa')
if [ -n "$STAGED_KEYS" ]; then
  echo "❌ [SECURITY ERROR] Attempting to commit private key file: $STAGED_KEYS"
  exit 1
fi

# 3. Check for obvious OpenAI/Anthropic/AWS/Stripe keys in staged diffs
LEAKED_SECRETS=$(git diff --cached | grep -E -i 'sk-proj-[A-Za-z0-9_-]{48,}|sk-ant-api03-[A-Za-z0-9_-]{80,}|AKIA[0-9A-Z]{16}|sk_live_[0-9a-zA-Z]{24,}')
if [ -n "$LEAKED_SECRETS" ]; then
  echo "❌ [SECURITY ERROR] Potential plaintext API key detected in staged commit!"
  echo "   Scan with Evolve AI Desktop Studio before committing."
  exit 1
fi

echo "✅ Evolve AI Pre-Commit Guard passed."
exit 0
`;

    try {
      fs.writeFileSync(hookPath, hookScript, { encoding: 'utf8', mode: 0o755 });
      return { success: true, hookPath };
    } catch {
      return { success: false, hookPath };
    }
  }

  /**
   * Generates a formal Markdown Compliance & Security Audit Report.
   */
  /**
   * Generates a formal Markdown Compliance & Security Audit Report.
   */
  public static generateSecurityReportMarkdown(report: SecurityAuditReport): string {
    const date = new Date(report.timestamp).toISOString();
    return `# Enterprise Repository Security & Multi-Jurisdiction Compliance Report

**Target Repository:** \`${report.repoPath}\`  
**Generated At:** ${date}  
**Overall Security Grade:** **${report.grade} (${report.score} / 100)**  
**Pass Status:** ${report.pass ? '✅ PASS' : '❌ ACTION REQUIRED'}  
**Scanned Files:** ${report.scannedFilesCount} files in ${report.scanDurationMs}ms  

---

## 1. Executive Summary

| Metric | Active Threats | Ignored / Accepted | Total Findings |
| :--- | :--- | :--- | :--- |
| 🔴 **Critical Leaks** | **${report.summary.critical}** | - | - |
| 🟠 **High Risks** | **${report.summary.high}** | - | - |
| 🟡 **Medium / Low** | **${report.summary.medium + report.summary.low}** | - | - |
| ℹ️ **Info / Fixtures** | **${report.summary.info}** | - | - |
| 🛡️ **Accepted / Ignored** | - | **${report.summary.ignored || 0}** | - |
| **All Findings** | **${report.summary.active || (report.summary.total - (report.summary.ignored || 0))}** | **${report.summary.ignored || 0}** | **${report.summary.total}** |

### Breakdown by Category
- 🔑 **Secrets & Credentials:** ${report.summary.secretsCount}
- 🛡️ **PII & Compliance:** ${report.summary.piiCount}
- ⚡ **SAST Code Flaws:** ${report.summary.sastCount}
- 📁 **Git File Hygiene:** ${report.summary.hygieneCount}

---

## 2. Detailed Findings

${report.findings.length === 0 ? '_No security findings or secret leaks detected._\n' : report.findings.map((f, idx) => `
### ${idx + 1}. [${f.severity.toUpperCase()}] ${f.title} ${f.isIgnored ? '*(Marked as Safe / Ignored)*' : ''}
* **Status:** \`${f.isIgnored ? 'IGNORED (Accepted Risk)' : 'ACTIVE'}\`
* **File & Line:** \`${f.file}:${f.line}\`
* **Jurisdiction / Standard:** \`${f.jurisdiction.toUpperCase()}\` — ${f.complianceTag || 'General'}
* **Matched Rule:** \`${f.matchedRule}\`
* **Description:** ${f.description}
* **Remediation:** ${f.remediation}
* **Code Preview:**
\`\`\`
${f.maskedSnippet}
\`\`\`
${f.isIgnored && f.ignoredReason ? `* **Exception Reason:** _${f.ignoredReason}_\n` : ''}
`).join('\n')}

---

## 3. Hygiene & .gitignore Recommendations

${report.missingGitignorePatterns.length > 0 ? `The following patterns are recommended to add to \`.gitignore\`:\n` + report.missingGitignorePatterns.map(p => `- \`${p}\``).join('\n') : `\`.gitignore\` contains all recommended enterprise security rules.`}

---
*Report generated offline by Evolve AI Enterprise Studio.*
`;
  }

  /**
   * Generates a self-contained, publication-grade Executive HTML & Printable PDF Security Audit Report.
   */
  public static generateSecurityReportHtml(report: SecurityAuditReport): string {
    const date = new Date(report.timestamp).toLocaleString();
    const repoName = path.basename(report.repoPath) || report.repoPath;
    const gradeColor = report.grade === 'A+' || report.grade === 'A' ? '#10b981' : report.grade === 'B' ? '#3b82f6' : report.grade === 'C' ? '#f59e0b' : '#ef4444';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Audit Report - ${repoName} - Evolve AI Enterprise</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --critical: #ef4444;
      --high: #f59e0b;
      --medium: #3b82f6;
      --low: #64748b;
      --success: #10b981;
      --accent: #4ecdc4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 32px 24px; line-height: 1.5; font-size: 14px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
    .logo-area { display: flex; align-items: center; gap: 12px; }
    .logo-icon { font-size: 32px; background: rgba(78, 205, 196, 0.15); border: 1px solid var(--accent); padding: 6px 12px; border-radius: 10px; }
    .title { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
    .subtitle { color: var(--text-muted); font-size: 13px; margin-top: 4px; }
    .actions-bar { display: flex; gap: 10px; align-items: center; }
    .btn-print { background: var(--accent); color: #0f172a; border: none; font-weight: 700; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: opacity 0.2s; }
    .btn-print:hover { opacity: 0.9; }
    .score-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; }
    .grade-display { display: flex; align-items: center; gap: 20px; }
    .grade-circle { width: 84px; height: 84px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 900; background: rgba(0,0,0,0.3); border: 3px solid ${gradeColor}; color: ${gradeColor}; box-shadow: 0 0 20px ${gradeColor}33; }
    .score-meta h2 { font-size: 20px; font-weight: 700; color: #fff; }
    .score-meta p { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    .status-badge { display: inline-block; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; margin-top: 6px; }
    .status-pass { background: rgba(16, 185, 129, 0.2); color: var(--success); border: 1px solid var(--success); }
    .status-fail { background: rgba(239, 68, 68, 0.2); color: var(--critical); border: 1px solid var(--critical); }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 28px; }
    .kpi-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .kpi-label { font-size: 11.5px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
    .kpi-value { font-size: 26px; font-weight: 800; margin-top: 6px; }
    .kpi-desc { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
    .section-title { font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 28px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    th { background: rgba(0,0,0,0.25); color: var(--text-muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--border); }
    td { padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .sev-pill { display: inline-block; font-size: 10px; font-weight: 800; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; }
    .sev-critical { background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid #ef4444; }
    .sev-high { background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .sev-medium { background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid #3b82f6; }
    .sev-low { background: rgba(100,116,139,0.2); color: #cbd5e1; border: 1px solid #64748b; }
    .sev-info { background: rgba(78,205,196,0.2); color: #4ecdc4; border: 1px solid #4ecdc4; }
    .code-box { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 6px 10px; font-family: monospace; font-size: 11px; word-break: break-all; margin-top: 4px; }
    .ignored-tag { font-size: 10px; background: rgba(168,85,247,0.2); color: #c084fc; border: 1px solid #a855f7; border-radius: 3px; padding: 1px 5px; font-weight: 700; margin-left: 6px; }
    .footer { text-align: center; color: var(--text-muted); font-size: 12px; padding-top: 24px; border-top: 1px solid var(--border); }
    @media print {
      body { background: #fff !important; color: #000 !important; padding: 0 !important; }
      .no-print { display: none !important; }
      .score-card, .kpi-card, table { background: #fff !important; border-color: #ccc !important; box-shadow: none !important; }
      th { background: #f1f5f9 !important; color: #334155 !important; }
      td { color: #0f172a !important; border-bottom-color: #e2e8f0 !important; }
      .code-box { background: #f8fafc !important; color: #0f172a !important; border-color: #cbd5e1 !important; }
      .title, .score-meta h2, .section-title { color: #0f172a !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-area">
        <div class="logo-icon">🛡️</div>
        <div>
          <div class="title">Enterprise Security &amp; Compliance Audit</div>
          <div class="subtitle">Target: <strong>${report.repoPath}</strong> • Scanned on ${date}</div>
        </div>
      </div>
      <div class="actions-bar no-print">
        <button class="btn-print" onclick="window.print()">🖨️ Print / Save to PDF</button>
      </div>
    </div>

    <div class="score-card">
      <div class="grade-display">
        <div class="grade-circle">${report.grade}</div>
        <div class="score-meta">
          <h2>Executive Health Score: ${report.score} / 100</h2>
          <p>Scanned ${report.scannedFilesCount} files in ${report.scanDurationMs}ms across all active jurisdictions.</p>
          <span class="status-badge ${report.pass ? 'status-pass' : 'status-fail'}">
            ${report.pass ? '✓ Compliant / Pass' : '⚠️ Action Required'}
          </span>
        </div>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--text-muted); text-align: right;">Audited with Zero Cloud Calls</div>
        <div style="font-size: 13px; font-weight: 700; color: #fff; text-align: right; margin-top: 2px;">100% Deterministic Air-Gapped Engine</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label" style="color: #ef4444;">🔴 Critical Leaks</div>
        <div class="kpi-value" style="color: #ef4444;">${report.summary.critical}</div>
        <div class="kpi-desc">API keys, PEM certs, AWS/Stripe keys</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label" style="color: #f59e0b;">🟠 High Risks</div>
        <div class="kpi-value" style="color: #f59e0b;">${report.summary.high}</div>
        <div class="kpi-desc">Live PII, SQLi, .env tracked</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label" style="color: #3b82f6;">🟡 Medium / Low</div>
        <div class="kpi-value" style="color: #3b82f6;">${report.summary.medium + report.summary.low}</div>
        <div class="kpi-desc">Path traversal, weak crypto</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label" style="color: #c084fc;">🛡️ Accepted / Safe</div>
        <div class="kpi-value" style="color: #c084fc;">${report.summary.ignored || 0}</div>
        <div class="kpi-desc">Persisted in exceptions catalogue</div>
      </div>
    </div>

    <div class="section-title"><span>📋</span> Detailed Security Findings &amp; Remediations (${report.findings.length})</div>
    <table>
      <thead>
        <tr>
          <th style="width: 90px;">Severity</th>
          <th style="width: 220px;">Issue &amp; Rule</th>
          <th style="width: 180px;">Location</th>
          <th style="width: 140px;">Standard</th>
          <th>Masked Preview &amp; Remediation</th>
        </tr>
      </thead>
      <tbody>
        ${report.findings.length === 0 ? `
          <tr>
            <td colspan="5" style="text-align: center; color: var(--success); padding: 40px 10px;">
              ✓ Zero security vulnerabilities or secrets found in codebase.
            </td>
          </tr>
        ` : report.findings.map(f => `
          <tr>
            <td>
              <span class="sev-pill sev-${f.severity}">${f.severity}</span>
              ${f.isIgnored ? '<span class="ignored-tag">SAFE</span>' : ''}
            </td>
            <td>
              <div style="font-weight: 700; color: #fff;">${f.title}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Rule: <code>${f.matchedRule}</code></div>
            </td>
            <td style="font-family: monospace; font-size: 11.5px; color: #38bdf8;">
              ${f.file}:${f.line}
            </td>
            <td>
              <div style="font-weight: 700; font-size: 11px; text-transform: uppercase;">${f.jurisdiction}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${f.complianceTag || 'General'}</div>
            </td>
            <td>
              <div class="code-box">${f.maskedSnippet}</div>
              <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 6px;">💡 <strong>Fix:</strong> ${f.remediation}</div>
              ${f.isIgnored && f.ignoredReason ? `<div style="font-size: 11px; color: #c084fc; margin-top: 4px;">🛡️ <em>Exception Note:</em> ${f.ignoredReason}</div>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${report.missingGitignorePatterns.length > 0 ? `
      <div class="section-title"><span>🛡️</span> Recommended .gitignore Guardrails</div>
      <div style="background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 28px;">
        <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 10px;">
          The following patterns are currently missing from <code>.gitignore</code> and could result in sensitive files being committed:
        </p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${report.missingGitignorePatterns.map(p => `<code style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 11px;">${p}</code>`).join('')}
        </div>
      </div>
    ` : ''}

    <div class="footer">
      Generated by Evolve AI Enterprise Studio • Air-Gapped Compliance &amp; Secret Architecture Prober
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates a standard CSV report for ticketing systems (Jira, ServiceNow, Excel).
   */
  public static generateSecurityReportCsv(report: SecurityAuditReport): string {
    const headers = [
      'Finding ID',
      'Severity',
      'Status',
      'Category',
      'Title',
      'File',
      'Line',
      'Jurisdiction',
      'Compliance Standard',
      'Matched Rule',
      'Masked Snippet',
      'Remediation',
      'Exception Reason'
    ];

    const escapeCsv = (str: string) => `"${(str || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

    const rows = report.findings.map(f => [
      f.id,
      f.severity.toUpperCase(),
      f.isIgnored ? 'IGNORED / SAFE' : 'ACTIVE',
      f.category.toUpperCase(),
      f.title,
      f.file,
      f.line.toString(),
      f.jurisdiction.toUpperCase(),
      f.complianceTag || 'General',
      f.matchedRule,
      f.maskedSnippet,
      f.remediation,
      f.ignoredReason || ''
    ]);

    const lines = [headers.map(escapeCsv).join(',')];
    for (const row of rows) {
      lines.push(row.map(escapeCsv).join(','));
    }
    return lines.join('\r\n');
  }

  /**
   * Generates an automated shell or PowerShell fix script to remediate hygiene and gitignore issues.
   */
  public static generateSecurityFixScript(report: SecurityAuditReport, shellType: 'sh' | 'ps1' = 'sh'): string {
    if (shellType === 'ps1') {
      const gitignoreEntries = report.missingGitignorePatterns.map(p => `Add-Content -Path .gitignore -Value "${p}"`).join('\r\n');
      const untrackLines = report.findings
        .filter(f => f.category === 'hygiene' && (f.file.startsWith('.env') || f.file.endsWith('.pem') || f.file.endsWith('.key')))
        .map(f => `git rm --cached "${f.file}"`)
        .join('\r\n');

      return `# Evolve AI Enterprise Security Remediation Script (PowerShell)
# Target: ${report.repoPath}
# Generated: ${new Date(report.timestamp).toISOString()}

Write-Host "🛡️ Starting Evolve AI Automated Security Remediation..." -ForegroundColor Cyan

# 1. Append missing .gitignore rules
if (-not (Test-Path .gitignore)) { New-Item -ItemType File -Path .gitignore }
${gitignoreEntries || '# No missing .gitignore rules'}
Write-Host "✓ Patched .gitignore" -ForegroundColor Green

# 2. Untrack sensitive files from Git index
${untrackLines || '# No tracked sensitive files to untrack'}

Write-Host "✅ Remediation complete. Re-run security scan in Evolve AI Desktop Studio to verify." -ForegroundColor Green
`;
    }

    // Default bash / sh
    const gitignoreEntries = report.missingGitignorePatterns.map(p => `echo "${p}" >> .gitignore`).join('\n');
    const untrackLines = report.findings
      .filter(f => f.category === 'hygiene' && (f.file.startsWith('.env') || f.file.endsWith('.pem') || f.file.endsWith('.key')))
      .map(f => `git rm --cached "${f.file}" 2>/dev/null || true`)
      .join('\n');

    return `#!/bin/sh
# Evolve AI Enterprise Security Remediation Script
# Target: ${report.repoPath}
# Generated: ${new Date(report.timestamp).toISOString()}

set -e
echo "🛡️ Starting Evolve AI Automated Security Remediation..."

# 1. Append missing .gitignore rules
touch .gitignore
${gitignoreEntries || '# No missing .gitignore rules'}
echo "✓ Patched .gitignore"

# 2. Untrack sensitive files from Git index
${untrackLines || '# No tracked sensitive files to untrack'}

echo "✅ Remediation complete. Re-run scan with Evolve AI Desktop Studio."
`;
  }

  // ---------------------------------------------------------------------------
  // EXCEPTION PERSISTENCE & HELPERS
  // ---------------------------------------------------------------------------

  public static getExceptionsFilePath(repoPath: string): string {
    return path.join(repoPath, '.evolve', 'security_exceptions.json');
  }

  public static loadExceptions(repoPath: string): Map<string, { ignoredAt: number; reason?: string }> {
    const filePath = this.getExceptionsFilePath(repoPath);
    const map = new Map<string, { ignoredAt: number; reason?: string }>();
    if (!fs.existsSync(filePath)) return map;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(data.exceptions)) {
        for (const item of data.exceptions) {
          if (item && item.id) {
            map.set(item.id, { ignoredAt: item.ignoredAt || Date.now(), reason: item.reason || 'User marked safe' });
          }
          if (item && item.file && item.matchedRule) {
            map.set(`${item.file}::${item.matchedRule}`, { ignoredAt: item.ignoredAt || Date.now(), reason: item.reason || 'User marked safe' });
          }
        }
      }
    } catch {}
    return map;
  }

  public static ignoreFinding(
    repoPath: string,
    findingId: string,
    details?: { file?: string; matchedRule?: string; reason?: string }
  ): { success: boolean; totalIgnored: number } {
    const filePath = this.getExceptionsFilePath(repoPath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }

    let exceptions: any[] = [];
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data.exceptions)) exceptions = data.exceptions;
      } catch {}
    }

    exceptions = exceptions.filter(e => e.id !== findingId && !(details?.file && details?.matchedRule && e.file === details.file && e.matchedRule === details.matchedRule));
    exceptions.push({
      id: findingId,
      file: details?.file,
      matchedRule: details?.matchedRule,
      ignoredAt: Date.now(),
      reason: details?.reason || 'Marked as safe / accepted risk by developer'
    });

    try {
      fs.writeFileSync(filePath, JSON.stringify({ exceptions }, null, 2), 'utf8');
      return { success: true, totalIgnored: exceptions.length };
    } catch {
      return { success: false, totalIgnored: exceptions.length };
    }
  }

  public static unignoreFinding(repoPath: string, findingId: string): { success: boolean; totalIgnored: number } {
    const filePath = this.getExceptionsFilePath(repoPath);
    if (!fs.existsSync(filePath)) return { success: true, totalIgnored: 0 };
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let exceptions = Array.isArray(data.exceptions) ? data.exceptions : [];
      exceptions = exceptions.filter((e: any) => e.id !== findingId);
      fs.writeFileSync(filePath, JSON.stringify({ exceptions }, null, 2), 'utf8');
      return { success: true, totalIgnored: exceptions.length };
    } catch {
      return { success: false, totalIgnored: 0 };
    }
  }

  /**
   * Detects whether a line or file is a comment, documentation, placeholder, mock, or test fixture.
   */
  public static isCommentOrPlaceholder(line: string, relPath: string): boolean {
    const trimmed = line.trim();
    // 1. Comments across languages (TS, JS, Python, Shell, SQL, HTML, etc.)
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('<!--') ||
      trimmed.startsWith('--') ||
      trimmed.startsWith(';') ||
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''")
    ) {
      return true;
    }

    // 2. Form placeholders, mock datasets, dummy variables, documentation samples
    const lower = line.toLowerCase();
    if (
      lower.includes('placeholder=') ||
      lower.includes('placeholder:') ||
      lower.includes('aria-placeholder') ||
      lower.includes('e.g.') ||
      lower.includes('example') ||
      lower.includes('dummy') ||
      lower.includes('fake') ||
      lower.includes('mock') ||
      lower.includes('sample') ||
      lower.includes('fixture') ||
      lower.includes('spec') ||
      lower.includes('test_') ||
      lower.includes('lorem ipsum')
    ) {
      return true;
    }

    // 3. Documentation and test file paths
    const lowerPath = relPath.toLowerCase().replace(/\\/g, '/');
    if (
      lowerPath.endsWith('.md') ||
      lowerPath.endsWith('.txt') ||
      lowerPath.endsWith('.rst') ||
      lowerPath.includes('/test/') ||
      lowerPath.includes('/tests/') ||
      lowerPath.includes('__tests__') ||
      lowerPath.includes('.test.') ||
      lowerPath.includes('.spec.') ||
      lowerPath.includes('/fixtures/') ||
      lowerPath.includes('/docs/')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Excludes trivial repeating or consecutive test numbers (e.g. 00000000, 11111111, 12345678).
   */
  public static isTrivialOrMockNumber(numStr: string): boolean {
    const clean = numStr.replace(/[\s-]/g, '');
    if (clean.length < 8) return false;
    // All same digit (00000000, 11111111, etc.)
    if (/^(\d)\1+$/.test(clean)) return true;
    // Sequential ascending or descending
    if (clean === '12345678' || clean === '123456789' || clean === '987654321' || clean === '012345678' || clean === '1234567890') {
      return true;
    }
    return false;
  }

  private static maskSecret(line: string, secret: string): string {
    if (!secret || secret.length < 8) return line.trim();
    const prefix = secret.slice(0, 4);
    const suffix = secret.slice(-3);
    const masked = `${prefix}***REDACTED***${suffix}`;
    return line.replace(secret, masked).trim();
  }

  private static maskCard(line: string, card: string): string {
    const clean = card.replace(/[\s-]/g, '');
    const prefix = clean.slice(0, 4);
    const suffix = clean.slice(-4);
    const masked = `${prefix}-****-****-${suffix}`;
    return line.replace(card, masked).trim();
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

  private static buildSummary(findings: SecurityFinding[]): SecurityAuditSummary {
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let info = 0;
    let active = 0;
    let ignored = 0;
    let secretsCount = 0;
    let piiCount = 0;
    let sastCount = 0;
    let hygieneCount = 0;

    for (const f of findings) {
      if (f.isIgnored) {
        ignored++;
        continue; // Ignored / safe findings do not count against active threat penalty
      }

      active++;
      if (f.severity === 'critical') critical++;
      else if (f.severity === 'high') high++;
      else if (f.severity === 'medium') medium++;
      else if (f.severity === 'low') low++;
      else if (f.severity === 'info') info++;

      if (f.category === 'secret') secretsCount++;
      else if (f.category === 'pii') piiCount++;
      else if (f.category === 'sast') sastCount++;
      else if (f.category === 'hygiene') hygieneCount++;
    }

    return {
      total: findings.length,
      active,
      ignored,
      critical,
      high,
      medium,
      low,
      info,
      secretsCount,
      piiCount,
      sastCount,
      hygieneCount
    };
  }

  private static calculateScore(summary: SecurityAuditSummary): number {
    // 100 base score:
    // -25 per critical
    // -12 per high
    // -4 per medium
    // -1 per low
    const penalty = (summary.critical * 25) + (summary.high * 12) + (summary.medium * 4) + (summary.low * 1);
    return Math.max(0, Math.min(100, 100 - penalty));
  }

  private static scoreToGrade(score: number): SecurityAuditReport['grade'] {
    if (score >= 95) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
}
