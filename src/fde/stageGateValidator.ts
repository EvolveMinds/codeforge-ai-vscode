/**
 * src/fde/stageGateValidator.ts
 *
 * Deterministic Stage-Gate Validator for Evolve AI Forward Deployed Engineers.
 * Enforces quality contracts before deliverables can be handed off across roles.
 */

import * as fs from 'fs';
import * as path from 'path';

export type StageGateKind = 'requirements' | 'architecture' | 'ux' | 'review' | 'certification';

export interface StageGateFinding {
  rule: string;
  message: string;
  severity: 'blocking' | 'advisory';
}

export interface StageGateResult {
  stage: StageGateKind;
  artifactPath: string;
  passed: boolean;
  findings: StageGateFinding[];
  score: number; // 0-100
}

export class StageGateValidator {
  constructor(private readonly _workspaceRoot: string) {}

  public validate(stage: StageGateKind, artifactPath: string): StageGateResult {
    const full = path.isAbsolute(artifactPath) ? artifactPath : path.join(this._workspaceRoot, artifactPath);
    const findings: StageGateFinding[] = [];

    if (!fs.existsSync(full)) {
      return {
        stage,
        artifactPath,
        passed: false,
        findings: [{ rule: 'file-exists', message: `Artifact file not found: ${artifactPath}`, severity: 'blocking' }],
        score: 0
      };
    }

    const content = fs.readFileSync(full, 'utf8');

    // 1. Shared check: Unfilled placeholders
    if (/\[TODO\]|\[TBD\]|\{insert[_\s\w]*\}|\{your[_\s\w]*\}/i.test(content)) {
      findings.push({
        rule: 'unfilled-placeholder',
        message: 'Artifact contains unpopulated placeholder tokens ([TODO], [TBD], or {insert}).',
        severity: 'blocking'
      });
    }

    // 2. Stage-specific deterministic checks
    switch (stage) {
      case 'requirements':
        this._validateRequirements(content, findings);
        break;
      case 'architecture':
        this._validateArchitecture(full, content, findings);
        break;
      case 'ux':
        this._validateUx(full, content, findings);
        break;
      case 'review':
        this._validateReview(content, findings);
        break;
      case 'certification':
        this._validateCertification(content, findings);
        break;
    }

    const blocking = findings.filter(f => f.severity === 'blocking').length;
    const score = Math.max(0, 100 - (blocking * 30) - (findings.length - blocking) * 5);

    return {
      stage,
      artifactPath,
      passed: blocking === 0 && score >= 80,
      findings,
      score
    };
  }

  private _validateRequirements(content: string, findings: StageGateFinding[]): void {
    if (!/##\s*1\.\s*(Problem Statement|Executive Summary|Context)/i.test(content)) {
      findings.push({ rule: 'missing-problem-statement', message: 'PRD is missing a clear Problem Statement section.', severity: 'blocking' });
    }
    if (!/Acceptance Criteria|User Stories|Requirements/i.test(content)) {
      findings.push({ rule: 'missing-acceptance-criteria', message: 'PRD lacks formal Acceptance Criteria.', severity: 'blocking' });
    }
    if (!/Success Metrics|KPIs|Target Invariants/i.test(content)) {
      findings.push({ rule: 'missing-metrics', message: 'PRD has no quantifiable success metrics or KPIs.', severity: 'advisory' });
    }
  }

  private _validateArchitecture(filePath: string, content: string, findings: StageGateFinding[]): void {
    // ADR must have at least 3 evaluated options
    const optionsMatch = content.match(/###\s*Option\s*\d|###\s*Alternative\s*\d|##\s*Option\s*[A-C]/gi);
    if (!optionsMatch || optionsMatch.length < 3) {
      findings.push({
        rule: 'insufficient-options',
        message: `ADR requires evaluation of at least 3 distinct options/alternatives. Found: ${optionsMatch ? optionsMatch.length : 0}`,
        severity: 'blocking'
      });
    }

    if (!/##\s*Decision|Decision Outcome|Verdict/i.test(content)) {
      findings.push({ rule: 'missing-decision', message: 'ADR lacks an explicit Decision Outcome section.', severity: 'blocking' });
    }

    // Check for matching Model Council synthesis file
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const councilFiles = fs.readdirSync(dir).filter(f => f.startsWith('COUNCIL-'));
    if (councilFiles.length === 0) {
      findings.push({
        rule: 'missing-model-council',
        message: 'High-stakes ADR requires an accompanying COUNCIL-*.md synthesis record.',
        severity: 'blocking'
      });
    }
  }

  private _validateUx(filePath: string, content: string, findings: StageGateFinding[]): void {
    // UX must link to an actual HTML prototype file that exists
    const prototypeMatch = content.match(/\[.*prototype.*\]\((.*\.html)\)/i) || content.match(/href=["'](.*\.html)["']/i);
    if (prototypeMatch) {
      const relHtml = prototypeMatch[1];
      const htmlFull = path.resolve(path.dirname(filePath), relHtml);
      if (!fs.existsSync(htmlFull)) {
        findings.push({
          rule: 'missing-html-prototype',
          message: `Linked UX HTML prototype does not exist on disk: ${relHtml}`,
          severity: 'blocking'
        });
      }
    } else {
      findings.push({
        rule: 'missing-prototype-link',
        message: 'UX deliverable must link to a functional HTML/CSS prototype in docs/ux/prototypes/.',
        severity: 'blocking'
      });
    }
  }

  private _validateReview(content: string, findings: StageGateFinding[]): void {
    const verdictMatch = content.match(/verdict:\s*(approved|changes_requested|rejected)/i) ||
                         content.match(/##\s*Verdict:\s*(approved|changes_requested|rejected)/i);
    if (!verdictMatch) {
      findings.push({ rule: 'missing-verdict', message: 'Review lacks an explicit verdict (APPROVED or CHANGES_REQUESTED).', severity: 'blocking' });
    }

    if (/HIGH\s*:\s*[1-9]/i.test(content)) {
      findings.push({ rule: 'unresolved-high-defects', message: 'Review contains unaddressed HIGH severity defects.', severity: 'blocking' });
    }
    if (/MEDIUM\s*:\s*[1-9]/i.test(content)) {
      findings.push({ rule: 'unresolved-medium-defects', message: 'Review contains unaddressed MEDIUM severity defects.', severity: 'blocking' });
    }
  }

  private _validateCertification(content: string, findings: StageGateFinding[]): void {
    if (!/Test Pyramid|Coverage|Pass Rate/i.test(content)) {
      findings.push({ rule: 'missing-test-pyramid', message: 'Test certification requires test coverage and pass rate metrics.', severity: 'blocking' });
    }
  }
}
