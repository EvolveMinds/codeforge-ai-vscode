/**
 * fde/codebaseGraph/types.ts — Core Types for Codebase Cosmos & Git Intelligence
 *
 * Defines the canonical data structures for:
 *  - Code nodes (files/modules) and directed links (imports, temporal, DB queries)
 *  - Behavioral Git churn, defect metrics, and author bus factor
 *  - Multi-language AST dependency analysis
 *  - Brownfield Strangler Fig categorization & Mermaid topologies
 */

export type CodeLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'java'
  | 'csharp'
  | 'rust'
  | 'sql'
  | 'markdown'
  | 'yaml'
  | 'json'
  | 'other';

export type ModernizationCategory =
  | 'preserve'     // Stable, low churn, high quality core
  | 'strangle'     // Volatile, high defect, tightly coupled — extract to microservice/agent
  | 'retire'       // Dormant, dead code, orphaned models
  | 'neutral';     // Standard component

export interface CodeNode {
  /** Normalized workspace-relative path (e.g. "src/billing/service.ts") */
  id: string;
  /** File basename (e.g. "service.ts") */
  label: string;
  /** Relative directory (e.g. "src/billing") */
  directory: string;
  /** Detected programming language */
  language: CodeLanguage;
  /** Physical line count */
  linesOfCode: number;
  /** Total commits touching this file in the analyzed window */
  commitCount: number;
  /** Total lines added + deleted across commits */
  churnLines: number;
  /** Bug-fix commit matches (e.g. "fix:", "bug:", "hotfix") */
  defectCount: number;
  /** Normalized volatility score (0.0 to 100.0) based on Churn × Commits × Defects */
  hotspotScore: number;
  /** True if this file is in the top 10% highest volatility bracket */
  isHotspot: boolean;
  /** Dominant author with the highest commit share */
  primaryAuthor: string;
  /** Primary author's commit share percentage (0 - 100) */
  primaryAuthorShare: number;
  /** True if primary author owns >80% of commits on a high-churn/defect module */
  busFactorRisk: boolean;
  /** Introspected database tables referenced in this file */
  linkedTables: string[];
  /** Modernization classification under the Strangler Fig pattern */
  modernizationCategory: ModernizationCategory;
  /** In-degree: count of other files importing this module */
  inDegree: number;
  /** Out-degree: count of imports this module makes */
  outDegree: number;
  /** Subsystem or architectural group (e.g. "api", "core", "models", "ui") */
  subsystem?: string;
  /** Last modified timestamp in ISO format */
  lastModified?: string;
}

export type CodeLinkType =
  | 'import'       // Static syntactic import or require
  | 'temporal'     // Behavioral co-commit coupling (files change together)
  | 'data-access'; // Code queries or binds to a database table

export interface CodeLink {
  source: string;  // Node ID (file path or table name)
  target: string;  // Node ID (file path or table name)
  type: CodeLinkType;
  /** Coupling weight / strength (e.g. Jaccard similarity or import frequency) */
  weight: number;
  /** Optional human-readable description (e.g. "82% co-commit" or "ORM Entity") */
  label?: string;
}

export interface TemporalLink {
  fileA: string;
  fileB: string;
  /** Jaccard similarity score (0.0 - 1.0) */
  jaccard: number;
  /** Count of commits where both files were touched together */
  coCommits: number;
  /** Total commits touching fileA */
  commitsA: number;
  /** Total commits touching fileB */
  commitsB: number;
}

export interface AuthorStats {
  name: string;
  email: string;
  commitCount: number;
  linesAdded: number;
  linesDeleted: number;
  filesTouched: number;
  primaryFilesCount: number;
}

export interface CircularDependencyLoop {
  cycle: string[]; // e.g. ["a.ts", "b.ts", "c.ts", "a.ts"]
  length: number;
}

export interface DbCodeLineage {
  tableName: string;
  files: string[];
  matchTypes: Array<'sql-query' | 'orm-model' | 'migration' | 'repository'>;
}

export interface CodebaseAnalysisOptions {
  /** Maximum number of git commits to parse (defaults to 3000 for sub-second execution) */
  maxCommits?: number;
  /** Days of history to analyze (defaults to 180 days) */
  daysWindow?: number;
  /** List of file extensions to include in dependency graph */
  includeExtensions?: string[];
  /** Directories to ignore (defaults to node_modules, .git, dist, build, out, etc.) */
  excludeDirs?: string[];
  /** Live database table names to cross-reference against code */
  databaseTables?: string[];
}

export interface CodebaseAnalysisResult {
  repoPath: string;
  analyzedAt: string;
  totalFiles: number;
  totalCommitsParsed: number;
  authors: AuthorStats[];
  nodes: CodeNode[];
  links: CodeLink[];
  hotspots: CodeNode[];
  temporalCouplings: TemporalLink[];
  circularDependencies: CircularDependencyLoop[];
  orphanedFiles: string[];
  dbLineages: DbCodeLineage[];
  /** Inferred workspace architecture archetype (monorepo, packages, frameworks, AI pipelines) */
  archetype?: any;
  /** Comprehensive project orientation, 1-click runbook, key entrypoints, and readiness audit */
  orientation?: any;
  /** Auto-generated Mermaid Sequence Diagram representing the legacy As-Is architecture */
  asIsMermaidDiagram: string;
  /** Auto-generated Mermaid Sequence Diagram representing the modernized To-Be architecture */
  toBeMermaidDiagram: string;
  summary: {
    criticalHotspotCount: number;
    busFactorWarningCount: number;
    circularLoopCount: number;
    orphanedFileCount: number;
    modernizationCandidates: number;
    topSubsystems: string[];
    securityAlertCount?: number;
    qualityIssueCount?: number;
  };
  securityReport?: SecurityAuditReport;
  qualityReport?: QualityGateReport;
}

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SecurityCategory = 'secret' | 'pii' | 'sast' | 'hygiene';

export type SecurityJurisdiction = 'global' | 'us' | 'ca' | 'uk' | 'eu' | 'au' | 'apac';

export interface SecurityFinding {
  id: string;
  file: string;
  line: number;
  column?: number;
  severity: SecuritySeverity;
  category: SecurityCategory;
  jurisdiction: SecurityJurisdiction;
  title: string;
  description: string;
  maskedSnippet: string;
  rawSnippet?: string;
  matchedRule: string;
  complianceTag?: string; // e.g. "PCI-DSS 3.4", "GDPR Art 9", "HIPAA", "CWE-89", "CWE-798"
  remediation: string;
  fixable: boolean;
  entropy?: number;
  isExample?: boolean;
  isIgnored?: boolean;
  ignoredAt?: number;
  ignoredReason?: string;
}

export interface SecurityAuditSummary {
  total: number;
  active?: number;
  ignored?: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  secretsCount: number;
  piiCount: number;
  sastCount: number;
  hygieneCount: number;
}

export interface SecurityAuditReport {
  timestamp: number;
  repoPath: string;
  score: number; // 0 to 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  pass: boolean;
  findings: SecurityFinding[];
  summary: SecurityAuditSummary;
  scannedFilesCount: number;
  scanDurationMs: number;
  missingGitignorePatterns: string[];
  exceptionsPath?: string;
}

export interface SecurityScanOptions {
  jurisdiction?: 'all' | 'us' | 'ca' | 'uk' | 'eu' | 'au' | 'apac';
  includeGitHistory?: boolean;
  maxCommitsToCheck?: number;
  excludeDirs?: string[];
  maxFiles?: number;
}

// =============================================================================
// PRE-PUSH QUALITY GATEKEEPER & PIPELINE VALIDATION TYPES
// =============================================================================

export type QualitySeverity = 'blocker' | 'warning' | 'info';

export type QualityCategory = 'sql' | 'lint' | 'format' | 'typecheck' | 'infra';

export interface QualityFinding {
  id: string;
  file: string;
  line: number;
  column?: number;
  severity: QualitySeverity;
  category: QualityCategory;
  title: string;
  description: string;
  matchedRule: string;
  snippet?: string;
  remediation: string;
  fixable: boolean;
  isIgnored?: boolean;
  ignoredReason?: string;
}

export interface QualityGateSummary {
  total: number;
  active: number;
  ignored: number;
  blockers: number;
  warnings: number;
  info: number;
  fixableCount: number;
  sqlCount: number;
  lintCount: number;
  formatCount: number;
  typecheckCount: number;
  infraCount: number;
}

export interface QualityGateReport {
  timestamp: number;
  repoPath: string;
  score: number; // 0 to 100
  verdict: 'PASS' | 'BLOCKED' | 'WARNING';
  pass: boolean;
  findings: QualityFinding[];
  summary: QualityGateSummary;
  scannedFilesCount: number;
  scanDurationMs: number;
  prePushHookInstalled: boolean;
}

export interface QualityScanOptions {
  categories?: QualityCategory[];
  severity?: QualitySeverity | 'all';
  includeTypeCheck?: boolean;
  repoPath?: string;
  excludeDirs?: string[];
  maxFiles?: number;
}
