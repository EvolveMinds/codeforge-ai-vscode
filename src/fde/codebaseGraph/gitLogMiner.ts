/**
 * fde/codebaseGraph/gitLogMiner.ts — Deterministic Offline Git History & Behavioral Churn Miner
 *
 * Mins local git logs with zero network overhead, producing:
 *  - Churn metrics (additions, deletions, total volatility)
 *  - Defect density scores (commit message bug/fix patterns)
 *  - Author ownership & bus factor risk assessment
 *  - Commit co-occurrence file sets for temporal coupling
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { AuthorStats } from './types';

const execFileAsync = promisify(execFile);

export interface RawCommitFileChange {
  added: number;
  deleted: number;
  path: string;
}

export interface RawCommit {
  hash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  message: string;
  isDefectFix: boolean;
  files: RawCommitFileChange[];
}

export interface FileGitMetrics {
  path: string;
  commitCount: number;
  linesAdded: number;
  linesDeleted: number;
  churnLines: number;
  defectCount: number;
  hotspotScore: number;
  isHotspot: boolean;
  primaryAuthor: string;
  primaryAuthorShare: number;
  busFactorRisk: boolean;
  lastModified?: string;
  commitHashes: Set<string>;
}

export interface GitLogMinerResult {
  commitsParsed: number;
  fileMetrics: Map<string, FileGitMetrics>;
  authorStats: AuthorStats[];
  commits: RawCommit[];
}

const DEFECT_REGEX = /\b(fix|bug|patch|issue|incident|defect|hotfix|resolve|closes|broken|crash|regression)\b/i;

export class GitLogMiner {
  /**
   * Primary entry point: Mines git commit history directly from the workspace folder.
   */
  public static async mine(
    repoPath: string,
    options?: { maxCommits?: number; daysWindow?: number }
  ): Promise<GitLogMinerResult> {
    const maxCommits = options?.maxCommits ?? 3000;
    const daysWindow = options?.daysWindow;

    const gitArgs = [
      'log',
      `--max-count=${maxCommits}`,
      '--numstat',
      '--no-renames',
      '--date=iso',
      '--format=COMMIT|%H|%an|%ae|%ad|%s'
    ];

    if (daysWindow && daysWindow > 0) {
      gitArgs.push(`--since=${daysWindow} days ago`);
    }

    let rawOutput = '';
    try {
      const { stdout } = await execFileAsync('git', gitArgs, {
        cwd: repoPath,
        maxBuffer: 40 * 1024 * 1024, // 40MB
        timeout: 45000
      });
      rawOutput = stdout || '';
    } catch {
      // Graceful fallback if not a git repository or git command unavailable
      return {
        commitsParsed: 0,
        fileMetrics: new Map(),
        authorStats: [],
        commits: []
      };
    }

    return this.parseGitLogOutput(rawOutput);
  }

  /**
   * Pure parsing function: transforms raw git log string into structured commit and file metrics.
   */
  public static parseGitLogOutput(rawOutput: string): GitLogMinerResult {
    const lines = rawOutput.split('\n');
    const commits: RawCommit[] = [];
    const fileMetricsMap = new Map<string, FileGitMetrics>();
    const authorMap = new Map<string, AuthorStats>();

    let currentCommit: RawCommit | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('COMMIT|')) {
        if (currentCommit) {
          commits.push(currentCommit);
        }

        const parts = line.split('|');
        const hash = parts[1] || '';
        const authorName = (parts[2] || 'Unknown').trim();
        const authorEmail = (parts[3] || '').trim().toLowerCase();
        const date = parts[4] || '';
        const message = parts.slice(5).join('|') || '';
        const isDefectFix = DEFECT_REGEX.test(message);

        currentCommit = {
          hash,
          authorName,
          authorEmail,
          date,
          message,
          isDefectFix,
          files: []
        };

        // Update author commit count
        const authorKey = authorEmail || authorName;
        if (!authorMap.has(authorKey)) {
          authorMap.set(authorKey, {
            name: authorName,
            email: authorEmail,
            commitCount: 0,
            linesAdded: 0,
            linesDeleted: 0,
            filesTouched: 0,
            primaryFilesCount: 0
          });
        }
        authorMap.get(authorKey)!.commitCount += 1;
        continue;
      }

      // Parse numstat line: e.g. "12\t4\tsrc/billing/service.ts"
      if (currentCommit) {
        const statMatch = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
        if (statMatch) {
          const added = statMatch[1] === '-' ? 0 : parseInt(statMatch[1], 10) || 0;
          const deleted = statMatch[2] === '-' ? 0 : parseInt(statMatch[2], 10) || 0;
          let rawPath = statMatch[3].trim();

          // Handle git rename syntax: e.g. "old/{name => new}/path"
          rawPath = this.normalizeGitPath(rawPath);

          currentCommit.files.push({ added, deleted, path: rawPath });

          // Update file metrics
          let fileMetric = fileMetricsMap.get(rawPath);
          if (!fileMetric) {
            fileMetric = {
              path: rawPath,
              commitCount: 0,
              linesAdded: 0,
              linesDeleted: 0,
              churnLines: 0,
              defectCount: 0,
              hotspotScore: 0,
              isHotspot: false,
              primaryAuthor: currentCommit.authorName,
              primaryAuthorShare: 0,
              busFactorRisk: false,
              lastModified: currentCommit.date,
              commitHashes: new Set()
            };
            fileMetricsMap.set(rawPath, fileMetric);
          }

          fileMetric.commitCount += 1;
          fileMetric.linesAdded += added;
          fileMetric.linesDeleted += deleted;
          fileMetric.churnLines += added + deleted;
          if (currentCommit.isDefectFix) {
            fileMetric.defectCount += 1;
          }
          fileMetric.commitHashes.add(currentCommit.hash);

          // Update author lines
          const authorKey = currentCommit.authorEmail || currentCommit.authorName;
          const author = authorMap.get(authorKey);
          if (author) {
            author.linesAdded += added;
            author.linesDeleted += deleted;
          }
        }
      }
    }

    if (currentCommit) {
      commits.push(currentCommit);
    }

    // Secondary pass: compute primary authors, bus factor, and normalized hotspot scores
    this.calculateAuthorshipAndHotspots(commits, fileMetricsMap, authorMap);

    return {
      commitsParsed: commits.length,
      fileMetrics: fileMetricsMap,
      authorStats: Array.from(authorMap.values()).sort((a, b) => b.commitCount - a.commitCount),
      commits
    };
  }

  /**
   * Normalizes git rename format e.g. "src/{old => new}/file.ts" -> "src/new/file.ts"
   */
  public static normalizeGitPath(filePath: string): string {
    let p = filePath.replace(/\{.*?=>\s*(.*?)\}/g, '$1');
    p = p.replace(/\/\//g, '/').replace(/^\.\//, '');
    return p.split(path.win32.sep).join(path.posix.sep); // Ensure forward slashes
  }

  /**
   * Computes primary author share, bus factor warnings, and normalized hotspot scores.
   */
  private static calculateAuthorshipAndHotspots(
    commits: RawCommit[],
    fileMetricsMap: Map<string, FileGitMetrics>,
    authorMap: Map<string, AuthorStats>
  ): void {
    // 1. Author ownership tally per file
    const fileAuthorCounts = new Map<string, Map<string, number>>();

    for (const commit of commits) {
      const authorKey = commit.authorName;
      for (const file of commit.files) {
        if (!fileAuthorCounts.has(file.path)) {
          fileAuthorCounts.set(file.path, new Map());
        }
        const fileAuthors = fileAuthorCounts.get(file.path)!;
        fileAuthors.set(authorKey, (fileAuthors.get(authorKey) || 0) + 1);
      }
    }

    // 2. Identify primary authors and check bus factor risk
    for (const [filePath, fileMetric] of fileMetricsMap.entries()) {
      const fileAuthors = fileAuthorCounts.get(filePath);
      if (fileAuthors && fileAuthors.size > 0) {
        let maxAuthor = fileMetric.primaryAuthor;
        let maxCount = 0;
        let totalFileCommits = 0;

        for (const [author, count] of fileAuthors.entries()) {
          totalFileCommits += count;
          if (count > maxCount) {
            maxCount = count;
            maxAuthor = author;
          }
        }

        const share = totalFileCommits > 0 ? Math.round((maxCount / totalFileCommits) * 100) : 100;
        fileMetric.primaryAuthor = maxAuthor;
        fileMetric.primaryAuthorShare = share;

        // Bus factor risk: single author owns > 80% of commits on a frequently touched file
        if (share >= 80 && fileMetric.commitCount >= 4) {
          fileMetric.busFactorRisk = true;
        }

        // Tally primary files for author stats
        for (const authorStat of authorMap.values()) {
          if (authorStat.name === maxAuthor) {
            authorStat.primaryFilesCount += 1;
            break;
          }
        }
      }
    }

    // 3. Compute normalized Hotspot Volatility Scores
    const isDocOrMeta = (p: string) => {
      const lower = p.toLowerCase();
      return (
        lower.endsWith('.md') ||
        lower.endsWith('.txt') ||
        lower.endsWith('.csv') ||
        lower.endsWith('.lock') ||
        lower.endsWith('.svg') ||
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.ico') ||
        lower.endsWith('.gif') ||
        lower.startsWith('docs/') ||
        lower.includes('/docs/')
      );
    };

    let maxCodeScore = 0;
    let maxDocScore = 0;
    const rawScores = new Map<string, number>();

    for (const [filePath, metric] of fileMetricsMap.entries()) {
      // Formula: CommitCount × ln(1 + Churn) × (1 + 0.8 × DefectCount)
      const rawScore =
        metric.commitCount *
        Math.log(1 + metric.churnLines) *
        (1 + 0.8 * metric.defectCount);

      rawScores.set(filePath, rawScore);
      if (isDocOrMeta(filePath)) {
        if (rawScore > maxDocScore) maxDocScore = rawScore;
      } else {
        if (rawScore > maxCodeScore) maxCodeScore = rawScore;
      }
    }

    // Normalize to 0 - 100
    for (const [filePath, metric] of fileMetricsMap.entries()) {
      const raw = rawScores.get(filePath) || 0;
      const isDoc = isDocOrMeta(filePath);
      const denominator = isDoc
        ? (maxDocScore > 0 ? maxDocScore : maxCodeScore)
        : (maxCodeScore > 0 ? maxCodeScore : maxDocScore);
      const normalized = denominator > 0 ? Math.round((raw / denominator) * 1000) / 10 : 0;
      metric.hotspotScore = normalized;

      // Top hotspots: code files with score >= 35 and commit count >= 3 (docs excluded from architecture hotspots)
      if (!isDoc && metric.hotspotScore >= 35 && metric.commitCount >= 3) {
        metric.isHotspot = true;
      }
    }
  }
}
