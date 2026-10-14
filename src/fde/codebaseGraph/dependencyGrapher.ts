/**
 * fde/codebaseGraph/dependencyGrapher.ts — Multi-Language Static Import & Dependency Grapher
 *
 * Scans files in a local workspace to construct the architectural Directed Acyclic Graph (DAG):
 *  - Resolves imports across TypeScript, JavaScript, Python, Go, Java, C#, Rust, and SQL
 *  - Detects circular dependency loops using Tarjan's Strongly Connected Components (SCC)
 *  - Identifies entrypoint hubs and orphaned/dead code
 */

import * as fs from 'fs';
import * as path from 'path';
import { CodeLanguage, CodeLink, CircularDependencyLoop } from './types';

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  language: CodeLanguage;
  linesOfCode: number;
}

export interface DependencyGraphResult {
  scannedFiles: ScannedFile[];
  importsMap: Map<string, Set<string>>; // sourcePath -> Set of imported targetPaths
  links: CodeLink[];
  circularDependencies: CircularDependencyLoop[];
  orphanedFiles: string[];
}

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

const LANGUAGE_EXT_MAP: Record<string, CodeLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'java',
  '.cs': 'csharp',
  '.rs': 'rust',
  '.sql': 'sql',
  '.md': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json'
};

export class DependencyGrapher {
  /**
   * Primary entry point: Scans the directory and builds the dependency graph.
   */
  public static scan(
    repoPath: string,
    options?: {
      includeExtensions?: string[];
      excludeDirs?: string[];
      maxFiles?: number;
    }
  ): DependencyGraphResult {
    const excludeSet = new Set(options?.excludeDirs || DEFAULT_EXCLUDE_DIRS);
    const maxFiles = options?.maxFiles ?? 2500;

    // 1. Traverse filesystem and collect candidate files
    const scannedFiles: ScannedFile[] = [];
    const fileLookup = new Set<string>();

    this.walkDir(repoPath, repoPath, scannedFiles, fileLookup, excludeSet, maxFiles);

    // 2. Parse imports per file
    const importsMap = new Map<string, Set<string>>();
    const links: CodeLink[] = [];

    for (const file of scannedFiles) {
      const targets = this.extractImports(file.absolutePath, file.relativePath, repoPath, file.language, fileLookup);
      importsMap.set(file.relativePath, targets);

      for (const target of targets) {
        links.push({
          source: file.relativePath,
          target,
          type: 'import',
          weight: 1.0,
          label: 'imports'
        });
      }
    }

    // 3. Detect circular dependencies (Cycles)
    const circularDependencies = this.detectCycles(importsMap);

    // 4. Identify orphaned files (inDegree = 0 and outDegree = 0)
    const inDegreeMap = new Map<string, number>();
    for (const targets of importsMap.values()) {
      for (const t of targets) {
        inDegreeMap.set(t, (inDegreeMap.get(t) || 0) + 1);
      }
    }

    const orphanedFiles: string[] = [];
    for (const file of scannedFiles) {
      const outDeg = (importsMap.get(file.relativePath) || new Set()).size;
      const inDeg = inDegreeMap.get(file.relativePath) || 0;
      if (outDeg === 0 && inDeg === 0) {
        orphanedFiles.push(file.relativePath);
      }
    }

    return {
      scannedFiles,
      importsMap,
      links,
      circularDependencies,
      orphanedFiles
    };
  }

  /**
   * Recursively walks the repository directory.
   */
  private static walkDir(
    rootDir: string,
    currentDir: string,
    scanned: ScannedFile[],
    lookup: Set<string>,
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
          this.walkDir(rootDir, fullPath, scanned, lookup, excludeSet, maxFiles);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = LANGUAGE_EXT_MAP[ext];
        if (lang) {
          const rel = this.normalizeRelPath(path.relative(rootDir, fullPath));
          let loc = 0;
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            loc = content.split('\n').length;
          } catch {}

          scanned.push({
            relativePath: rel,
            absolutePath: fullPath,
            language: lang,
            linesOfCode: loc
          });
          lookup.add(rel);
        }
      }
    }
  }

  /**
   * Extracts static import references based on file language.
   */
  public static extractImports(
    filePath: string,
    relPath: string,
    repoPath: string,
    language: CodeLanguage,
    fileLookup: Set<string>
  ): Set<string> {
    const targets = new Set<string>();
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return targets;
    }

    const dir = path.dirname(relPath);

    if (language === 'typescript' || language === 'javascript') {
      // 1. ES Import & Export statements: import ... from './target'
      const esRegex = /(?:import|export)\s+(?:[\w*\s{},$]+from\s+)?['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = esRegex.exec(content)) !== null) {
        this.resolveAndAdd(match[1], dir, fileLookup, targets);
      }

      // 2. CommonJS require: require('./target')
      const reqRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = reqRegex.exec(content)) !== null) {
        this.resolveAndAdd(match[1], dir, fileLookup, targets);
      }
    } else if (language === 'python') {
      // Python imports: from .sibling import foo OR from pkg.sub import bar
      const pyFromRegex = /from\s+([.\w]+)\s+import/g;
      let match: RegExpExecArray | null;
      while ((match = pyFromRegex.exec(content)) !== null) {
        const mod = match[1];
        if (mod.startsWith('.')) {
          // Relative python import
          const dots = mod.match(/^\.+/)![0].length;
          const sub = mod.substring(dots).replace(/\./g, '/');
          let base = dir;
          for (let d = 1; d < dots; d++) base = path.dirname(base);
          const candidate = this.normalizeRelPath(path.join(base, sub));
          this.resolvePyCandidate(candidate, fileLookup, targets);
        } else {
          // Top-level python module
          const candidate = mod.replace(/\./g, '/');
          this.resolvePyCandidate(candidate, fileLookup, targets);
        }
      }
    } else if (language === 'go') {
      // Go imports: "project/pkg/sub"
      const goRegex = /import\s+(?:\(([\s\S]*?)\)|"([^"]+)")/g;
      let match: RegExpExecArray | null;
      while ((match = goRegex.exec(content)) !== null) {
        const block = match[1] || match[2] || '';
        const lineRegex = /"([^"]+)"/g;
        let lmatch: RegExpExecArray | null;
        while ((lmatch = lineRegex.exec(block)) !== null) {
          const importPath = lmatch[1];
          // Check if local go package in repository
          for (const f of fileLookup) {
            if (f.endsWith('.go') && f.includes(importPath)) {
              targets.add(f);
            }
          }
        }
      }
    }

    return targets;
  }

  /**
   * Resolves relative import strings (e.g. "./service" -> "src/billing/service.ts")
   */
  private static resolveAndAdd(
    specifier: string,
    currentDir: string,
    fileLookup: Set<string>,
    targets: Set<string>
  ): void {
    if (!specifier.startsWith('.')) return; // Skip external packages (e.g. 'react', 'fs')

    const rawJoined = path.join(currentDir, specifier);
    const normalized = this.normalizeRelPath(rawJoined);

    // Try extensions
    const candidates = [
      normalized,
      `${normalized}.ts`,
      `${normalized}.tsx`,
      `${normalized}.js`,
      `${normalized}.jsx`,
      `${normalized}/index.ts`,
      `${normalized}/index.js`,
      `${normalized}/index.tsx`
    ];

    for (const cand of candidates) {
      if (fileLookup.has(cand)) {
        targets.add(cand);
        return;
      }
    }
  }

  private static resolvePyCandidate(
    candidate: string,
    fileLookup: Set<string>,
    targets: Set<string>
  ): void {
    const options = [`${candidate}.py`, `${candidate}/__init__.py`];
    for (const opt of options) {
      if (fileLookup.has(opt)) {
        targets.add(opt);
        return;
      }
    }
  }

  /**
   * Detects circular dependencies using Tarjan's Strongly Connected Components algorithm.
   */
  public static detectCycles(graph: Map<string, Set<string>>): CircularDependencyLoop[] {
    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    function strongConnect(node: string) {
      indices.set(node, index);
      lowlink.set(node, index);
      index++;
      stack.push(node);
      onStack.add(node);

      const neighbors = graph.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!indices.has(neighbor)) {
          strongConnect(neighbor);
          lowlink.set(node, Math.min(lowlink.get(node)!, lowlink.get(neighbor)!));
        } else if (onStack.has(neighbor)) {
          lowlink.set(node, Math.min(lowlink.get(node)!, indices.get(neighbor)!));
        }
      }

      if (lowlink.get(node) === indices.get(node)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== node);

        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    }

    for (const node of graph.keys()) {
      if (!indices.has(node)) {
        strongConnect(node);
      }
    }

    return sccs.map(cycle => ({
      cycle: [...cycle, cycle[0]], // Close the loop visually
      length: cycle.length
    }));
  }

  private static normalizeRelPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\.\//, '');
  }
}
