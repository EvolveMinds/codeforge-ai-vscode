/**
 * fde/codebaseGraph/index.ts — Unified Codebase Cosmos & Brownfield Architecture Engine
 *
 * Orchestrates:
 *  1. GitLogMiner: Churn, defects, authors, commit timelines
 *  2. DependencyGrapher: Multi-language imports, Tarjan cycle detection, orphans
 *  3. TemporalCoupler: Jaccard co-commit correlation & hidden architectural ties
 *  4. CodeToDbLinker: Database table to code file cross-referencing
 *  5. BrownfieldSynthesizer: Strangler Fig categorization & Mermaid sequence generation
 */

import * as path from 'path';
import {
  CodeNode,
  CodeLink,
  CodebaseAnalysisOptions,
  CodebaseAnalysisResult,
  AuthorStats
} from './types';
import { GitLogMiner } from './gitLogMiner';
import { DependencyGrapher } from './dependencyGrapher';
import { TemporalCoupler } from './temporalCoupler';
import { CodeToDbLinker } from './codeToDbLinker';
import { BrownfieldSynthesizer } from './brownfieldSynthesizer';
import { WorkspaceArchetypeMiner } from './workspaceArchetypeMiner';
import { RepoSecurityScanner } from './repoSecurityScanner';
import { RepoQualityGatekeeper } from './repoQualityGatekeeper';
import { ProjectOrientationSynthesizer } from './projectOrientationSynthesizer';

export * from './types';
export * from './gitLogMiner';
export * from './dependencyGrapher';
export * from './temporalCoupler';
export * from './codeToDbLinker';
export * from './brownfieldSynthesizer';
export * from './workspaceArchetypeMiner';
export * from './repoSecurityScanner';
export * from './repoQualityGatekeeper';
export * from './projectOrientationSynthesizer';

export class CodebaseGraphEngine {
  /**
   * Primary entry point: Runs complete deterministic codebase and Git intelligence analysis.
   */
  public static async analyze(
    repoPath: string,
    options?: CodebaseAnalysisOptions
  ): Promise<CodebaseAnalysisResult> {
    const startTime = Date.now();

    // 1. Mine Git commit history and behavioral churn
    const gitMinerResult = await GitLogMiner.mine(repoPath, {
      maxCommits: options?.maxCommits ?? 3000,
      daysWindow: options?.daysWindow ?? 180
    });

    // 2. Scan multi-language source files and build import DAG
    const depResult = DependencyGrapher.scan(repoPath, {
      includeExtensions: options?.includeExtensions,
      excludeDirs: options?.excludeDirs
    });

    // 3. Extract known static imports for temporal filtering
    const knownImportLinks = new Set<string>();
    for (const link of depResult.links) {
      knownImportLinks.add(`${link.source}|${link.target}`);
    }

    // 4. Calculate behavioral temporal coupling
    const temporalResult = TemporalCoupler.calculate(gitMinerResult.commits, {
      knownImportLinks,
      minCoCommits: 3,
      minJaccard: 0.40
    });

    // 5. Cross-reference database tables with code
    const dbTables = options?.databaseTables || [];
    const dbLinkResult = CodeToDbLinker.link(depResult.scannedFiles, dbTables);

    // 6. Compute in-degree and out-degree maps
    const inDegreeMap = new Map<string, number>();
    const outDegreeMap = new Map<string, number>();

    for (const [src, targets] of depResult.importsMap.entries()) {
      outDegreeMap.set(src, targets.size);
      for (const t of targets) {
        inDegreeMap.set(t, (inDegreeMap.get(t) || 0) + 1);
      }
    }

    // 7. Assemble Unified Code Nodes
    const nodes: CodeNode[] = [];
    const nodeLookup = new Map<string, CodeNode>();

    for (const file of depResult.scannedFiles) {
      const gitMetrics = gitMinerResult.fileMetrics.get(file.relativePath);
      const linkedTables = Array.from(dbLinkResult.fileToTablesMap.get(file.relativePath) || []);

      const dir = path.dirname(file.relativePath).replace(/\\/g, '/');
      const baseName = path.basename(file.relativePath);
      const subsystem = this.inferSubsystem(dir, baseName);

      const node: CodeNode = {
        id: file.relativePath,
        label: baseName,
        directory: dir === '.' ? '' : dir,
        language: file.language,
        linesOfCode: file.linesOfCode,
        commitCount: gitMetrics?.commitCount || 0,
        churnLines: gitMetrics?.churnLines || 0,
        defectCount: gitMetrics?.defectCount || 0,
        hotspotScore: gitMetrics?.hotspotScore || 0,
        isHotspot: gitMetrics?.isHotspot || false,
        primaryAuthor: gitMetrics?.primaryAuthor || 'Uncommitted',
        primaryAuthorShare: gitMetrics?.primaryAuthorShare || 0,
        busFactorRisk: gitMetrics?.busFactorRisk || false,
        linkedTables,
        modernizationCategory: 'neutral', // Synthesizer will categorize
        inDegree: inDegreeMap.get(file.relativePath) || 0,
        outDegree: outDegreeMap.get(file.relativePath) || 0,
        subsystem,
        lastModified: gitMetrics?.lastModified
      };

      nodes.push(node);
      nodeLookup.set(node.id, node);
    }

    // Sort nodes to isolate top hotspots
    const hotspots = nodes
      .filter(n => n.isHotspot || n.hotspotScore >= 35)
      .sort((a, b) => b.hotspotScore - a.hotspotScore);

    // 8. Mine Workspace Domain Archetype & Subsystems
    const discoveredTables = dbLinkResult.lineages.map(l => l.tableName);
    const archetype = WorkspaceArchetypeMiner.mine(repoPath, discoveredTables);

    // 9. Synthesize Brownfield Modernization Categories & Mermaid Sequence Topologies
    const synthesis = BrownfieldSynthesizer.synthesize(
      nodes,
      hotspots,
      depResult.circularDependencies,
      temporalResult.couplings,
      dbLinkResult.lineages,
      archetype
    );

    // 10. Combine All Graph Links (Imports + Temporal + Data-Access)
    const allLinks: CodeLink[] = [
      ...depResult.links,
      ...temporalResult.links,
      ...dbLinkResult.links
    ];

    // Compute top subsystems
    const subsystemCounts = new Map<string, number>();
    for (const n of nodes) {
      if (n.subsystem) {
        subsystemCounts.set(n.subsystem, (subsystemCounts.get(n.subsystem) || 0) + 1);
      }
    }
    const topSubsystems = Array.from(subsystemCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s]) => s);

    const busFactorWarningCount = nodes.filter(n => n.busFactorRisk).length;

    // 6. Run Offline Security & Secret Audit
    let securityReport;
    try {
      securityReport = RepoSecurityScanner.scan(repoPath);
    } catch {}

    // 7. Run Pre-Push Quality Gatekeeper & Lint Validation
    let qualityReport;
    try {
      qualityReport = RepoQualityGatekeeper.scan(repoPath, { includeTypeCheck: false });
    } catch {}

    // 8. Synthesize Developer Project Orientation & Onboarding Briefing
    let orientation;
    try {
      orientation = ProjectOrientationSynthesizer.synthesize(repoPath, archetype);
    } catch {}

    return {
      repoPath,
      analyzedAt: new Date().toISOString(),
      totalFiles: nodes.length,
      totalCommitsParsed: gitMinerResult.commitsParsed,
      authors: gitMinerResult.authorStats,
      nodes,
      links: allLinks,
      hotspots,
      temporalCouplings: temporalResult.couplings,
      circularDependencies: depResult.circularDependencies,
      orphanedFiles: depResult.orphanedFiles,
      dbLineages: dbLinkResult.lineages,
      archetype,
      orientation,
      asIsMermaidDiagram: synthesis.asIsMermaid,
      toBeMermaidDiagram: synthesis.toBeMermaid,
      securityReport,
      qualityReport,
      summary: {
        criticalHotspotCount: hotspots.length,
        busFactorWarningCount,
        circularLoopCount: depResult.circularDependencies.length,
        orphanedFileCount: depResult.orphanedFiles.length,
        modernizationCandidates: synthesis.modernizationCandidates.length,
        topSubsystems,
        securityAlertCount: securityReport?.summary?.total || 0,
        qualityIssueCount: qualityReport?.summary?.total || 0
      }
    };
  }

  /**
   * Infers high-level subsystem grouping from folder hierarchy.
   */
  private static inferSubsystem(directory: string, baseName: string): string {
    const lower = `${directory}/${baseName}`.toLowerCase();
    if (lower.includes('/api') || lower.includes('/routes') || lower.includes('/controllers')) return 'api';
    if (lower.includes('/core') || lower.includes('/engine')) return 'core';
    if (lower.includes('/db') || lower.includes('/models') || lower.includes('/schemas') || lower.includes('/entities')) return 'data-models';
    if (lower.includes('/client') || lower.includes('/ui') || lower.includes('/renderer') || lower.includes('/views')) return 'frontend';
    if (lower.includes('/services') || lower.includes('/workers')) return 'services';
    if (lower.includes('/test') || lower.includes('/spec')) return 'tests';
    if (lower.includes('/utils') || lower.includes('/helpers')) return 'utilities';
    return directory ? directory.split('/')[0] : 'root';
  }
}
