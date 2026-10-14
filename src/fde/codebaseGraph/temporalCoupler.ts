/**
 * fde/codebaseGraph/temporalCoupler.ts — Behavioral Temporal Coupling & Co-Commit Correlation Engine
 *
 * Uncovers invisible architectural coupling by calculating Jaccard co-commit similarity
 * across git revision history. Identifies files that change together despite having
 * no explicit import statements (e.g. distributed copy-paste debt or leaky abstractions).
 */

import { RawCommit } from './gitLogMiner';
import { TemporalLink, CodeLink } from './types';

export interface TemporalCouplingOptions {
  /** Minimum number of commits two files must share to be considered (default: 3) */
  minCoCommits?: number;
  /** Minimum Jaccard similarity threshold (0.0 - 1.0, default: 0.45) */
  minJaccard?: number;
  /** Maximum number of temporal links to return (default: 100) */
  maxCouplings?: number;
  /** Set of known static import links: "source|target" to distinguish hidden vs known coupling */
  knownImportLinks?: Set<string>;
}

export interface TemporalCouplingResult {
  couplings: TemporalLink[];
  links: CodeLink[];
  hiddenCouplingCount: number; // Pairs that have NO static import but high co-commit
}

export class TemporalCoupler {
  /**
   * Primary entry point: Calculates pairwise temporal coupling from commit history.
   */
  public static calculate(
    commits: RawCommit[],
    options?: TemporalCouplingOptions
  ): TemporalCouplingResult {
    const minCoCommits = options?.minCoCommits ?? 3;
    const minJaccard = options?.minJaccard ?? 0.45;
    const maxCouplings = options?.maxCouplings ?? 100;
    const knownImports = options?.knownImportLinks ?? new Set<string>();

    // 1. Tally commits per file and pairwise co-commits
    const fileCommitCounts = new Map<string, number>();
    const pairCoCommits = new Map<string, number>();

    for (const commit of commits) {
      // Discard massive automated merge commits or dependency lockfile bumps with > 60 files
      if (commit.files.length > 60 || commit.files.length < 2) continue;

      // Extract unique normalized paths touched in this commit
      const uniqueFiles = Array.from(new Set(commit.files.map(f => f.path)));

      // Update individual file counts
      for (const file of uniqueFiles) {
        fileCommitCounts.set(file, (fileCommitCounts.get(file) || 0) + 1);
      }

      // Generate pairs
      for (let i = 0; i < uniqueFiles.length; i++) {
        for (let j = i + 1; j < uniqueFiles.length; j++) {
          const fileA = uniqueFiles[i] < uniqueFiles[j] ? uniqueFiles[i] : uniqueFiles[j];
          const fileB = uniqueFiles[i] < uniqueFiles[j] ? uniqueFiles[j] : uniqueFiles[i];
          const pairKey = `${fileA}|${fileB}`;

          pairCoCommits.set(pairKey, (pairCoCommits.get(pairKey) || 0) + 1);
        }
      }
    }

    // 2. Compute Jaccard Similarity scores
    const couplings: TemporalLink[] = [];
    const links: CodeLink[] = [];
    let hiddenCount = 0;

    for (const [pairKey, coCommits] of pairCoCommits.entries()) {
      if (coCommits < minCoCommits) continue;

      const [fileA, fileB] = pairKey.split('|');
      const commitsA = fileCommitCounts.get(fileA) || coCommits;
      const commitsB = fileCommitCounts.get(fileB) || coCommits;

      // Jaccard formula: intersection / union
      const union = commitsA + commitsB - coCommits;
      if (union <= 0) continue;

      const jaccard = Math.round((coCommits / union) * 100) / 100;

      if (jaccard >= minJaccard) {
        couplings.push({
          fileA,
          fileB,
          jaccard,
          coCommits,
          commitsA,
          commitsB
        });

        const isKnown =
          knownImports.has(`${fileA}|${fileB}`) || knownImports.has(`${fileB}|${fileA}`);
        if (!isKnown) {
          hiddenCount++;
        }

        links.push({
          source: fileA,
          target: fileB,
          type: 'temporal',
          weight: jaccard,
          label: `${Math.round(jaccard * 100)}% co-commit (${coCommits}x)`
        });
      }
    }

    // Sort by highest Jaccard coupling first
    couplings.sort((a, b) => b.jaccard - a.jaccard || b.coCommits - a.coCommits);
    const trimmedCouplings = couplings.slice(0, maxCouplings);
    const trimmedLinks = links.slice(0, maxCouplings);

    return {
      couplings: trimmedCouplings,
      links: trimmedLinks,
      hiddenCouplingCount: hiddenCount
    };
  }
}
