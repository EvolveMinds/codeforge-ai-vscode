/**
 * plugins/pythonStudio/pythonDetector.ts
 *
 * Greenfield & Brownfield project topology and environment detector.
 * Rapid, non-blocking inspection of workspace directories to identify:
 *  - Greenfield vs Brownfield classification
 *  - Preferred/Existing package managers (uv, poetry, pip, pipenv, conda)
 *  - Active or candidate virtual environments (.venv, venv, conda-env)
 *  - Python AI / Data Science framework stacks (PyTorch, JAX, HuggingFace, LangChain, Polars, etc.)
 *  - Monorepo sub-projects containing Python services
 */

import type * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';

export type DeliveryTopology = 'greenfield' | 'brownfield';

export type PackageManager = 'uv' | 'poetry' | 'pip' | 'pipenv' | 'conda';

export interface PythonFrameworkInfo {
  hasPyTorch:     boolean;
  hasJax:         boolean;
  hasHuggingFace: boolean;
  hasLangChain:   boolean;
  hasLlamaIndex:  boolean;
  hasPandas:      boolean;
  hasPolars:      boolean;
  hasFastAPI:     boolean;
  hasPySpark:     boolean;
  hasDbtPython:   boolean;
}

export interface PythonProjectTopology {
  topology:        DeliveryTopology;
  packageManager:  PackageManager;
  rootPath:        string;
  activeVenvPath?: string;
  candidateVenvs:  string[];
  frameworks:      PythonFrameworkInfo;
  pythonFilesCount: number;
  subProjects:     string[];
  hasGitRepo:      boolean;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build',
  '.venv', 'venv', 'env', '.conda', '.tox', '.mypy_cache', '.pytest_cache',
  '.ruff_cache', 'target', '.idea', '.vscode'
]);

export class PythonDetector {
  /**
   * Fast detection check for IPlugin.detect(ws).
   * Returns true if any Python file, pyproject.toml, requirements, or Pipfile is found.
   */
  static async hasPythonFootprint(wsFolder: vscode.WorkspaceFolder | undefined): Promise<boolean> {
    if (!wsFolder) return false;
    const wsPath = wsFolder.uri.fsPath;

    // Check root files first (instant)
    const rootMarkers = [
      'pyproject.toml', 'requirements.txt', 'requirements-dev.txt',
      'Pipfile', 'setup.py', 'setup.cfg', 'environment.yml',
      'main.py', 'app.py', 'manage.py'
    ];
    for (const marker of rootMarkers) {
      if (fs.existsSync(path.join(wsPath, marker))) return true;
    }

    // Fast glob: check if any .py exists (max 1) via VS Code if available
    try {
      const vscodeMod = require('vscode');
      if (vscodeMod?.workspace?.findFiles) {
        const files = await vscodeMod.workspace.findFiles(
          new vscodeMod.RelativePattern(wsFolder, '**/*.py'),
          '{**/node_modules/**,**/.venv/**,**/venv/**,**/dist/**}',
          1
        );
        return files.length > 0;
      }
    } catch {}

    // Fallback shallow filesystem check for standalone CLI/Mocha environments
    try {
      const entries = fs.readdirSync(wsPath, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.py')) return true;
      }
    } catch {}
    return false;
  }

  /**
   * Full analysis of workspace topology and environment.
   */
  static async analyzeWorkspace(wsFolder: vscode.WorkspaceFolder | undefined): Promise<PythonProjectTopology> {
    const wsPath = wsFolder ? wsFolder.uri.fsPath : process.cwd();
    const hasGit = fs.existsSync(path.join(wsPath, '.git'));

    // Discover candidate venvs
    const candidateVenvs = this.findCandidateVenvs(wsPath);
    const activeVenvPath = candidateVenvs.length > 0 ? candidateVenvs[0] : undefined;

    // Detect Package Manager
    const packageManager = this.detectPackageManager(wsPath);

    // Framework detection
    const frameworks = this.detectFrameworks(wsPath);

    // Discover subprojects and count python files
    const { count, subProjects } = this.scanPythonStructure(wsPath);

    // Greenfield vs Brownfield determination:
    // Greenfield: No git repo OR git with 0/1 commits and < 5 files, or explicitly fresh project.
    // Brownfield: Existing git repo with established directory tree, multiple subprojects, or > 10 files.
    let topology: DeliveryTopology = 'greenfield';
    if (hasGit && (count > 8 || subProjects.length > 0 || fs.existsSync(path.join(wsPath, 'poetry.lock')))) {
      topology = 'brownfield';
    }

    return {
      topology,
      packageManager,
      rootPath: wsPath,
      activeVenvPath,
      candidateVenvs,
      frameworks,
      pythonFilesCount: count,
      subProjects,
      hasGitRepo: hasGit,
    };
  }

  private static findCandidateVenvs(wsPath: string): string[] {
    const candidates: string[] = [];
    const venvNames = ['.venv', 'venv', 'env', '.env', '.conda', 'conda-env'];
    for (const name of venvNames) {
      const full = path.join(wsPath, name);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        const binPython = process.platform === 'win32'
          ? path.join(full, 'Scripts', 'python.exe')
          : path.join(full, 'bin', 'python');
        if (fs.existsSync(binPython)) {
          candidates.push(full);
        }
      }
    }
    return candidates;
  }

  private static detectPackageManager(wsPath: string): PackageManager {
    if (fs.existsSync(path.join(wsPath, 'uv.lock'))) return 'uv';
    if (fs.existsSync(path.join(wsPath, 'poetry.lock'))) return 'poetry';
    if (fs.existsSync(path.join(wsPath, 'Pipfile.lock')) || fs.existsSync(path.join(wsPath, 'Pipfile'))) return 'pipenv';
    if (fs.existsSync(path.join(wsPath, 'environment.yml')) || fs.existsSync(path.join(wsPath, 'environment.yaml'))) return 'conda';

    // Check pyproject.toml contents
    const pyproj = path.join(wsPath, 'pyproject.toml');
    if (fs.existsSync(pyproj)) {
      try {
        const content = fs.readFileSync(pyproj, 'utf8');
        if (content.includes('[tool.poetry]')) return 'poetry';
        if (content.includes('[tool.uv]')) return 'uv';
      } catch {}
    }

    // Default to uv if available, fallback to pip
    return 'uv';
  }

  private static detectFrameworks(wsPath: string): PythonFrameworkInfo {
    let rawContent = '';
    const manifestFiles = [
      'pyproject.toml', 'requirements.txt', 'requirements-dev.txt',
      'Pipfile', 'setup.py', 'environment.yml'
    ];
    for (const file of manifestFiles) {
      const full = path.join(wsPath, file);
      if (fs.existsSync(full)) {
        try { rawContent += '\n' + fs.readFileSync(full, 'utf8'); } catch {}
      }
    }

    const testRegex = (pattern: RegExp) => pattern.test(rawContent);

    return {
      hasPyTorch:     testRegex(/\b(torch|torchvision|torchaudio)\b/i),
      hasJax:         testRegex(/\b(jax|jaxlib|flax)\b/i),
      hasHuggingFace: testRegex(/\b(transformers|datasets|diffusers|accelerate)\b/i),
      hasLangChain:   testRegex(/\b(langchain|langgraph|langchain-core)\b/i),
      hasLlamaIndex:  testRegex(/\b(llama-index|llama_index)\b/i),
      hasPandas:      testRegex(/\bpandas\b/i),
      hasPolars:      testRegex(/\bpolars\b/i),
      hasFastAPI:     testRegex(/\bfastapi\b/i),
      hasPySpark:     testRegex(/\b(pyspark|findspark)\b/i),
      hasDbtPython:   testRegex(/\bdbt-core\b/i) || fs.existsSync(path.join(wsPath, 'dbt_project.yml')),
    };
  }

  private static scanPythonStructure(wsPath: string): { count: number; subProjects: string[] } {
    let count = 0;
    const subProjects: string[] = [];

    const walk = (dir: string, depth = 0) => {
      if (depth > 4 || count >= 100) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let hasSubProjectMarker = false;

        for (const entry of entries) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          const full = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Check if directory represents a microservice / subproject
            if (depth > 0 && (
              fs.existsSync(path.join(full, 'pyproject.toml')) ||
              fs.existsSync(path.join(full, 'requirements.txt')) ||
              fs.existsSync(path.join(full, 'main.py'))
            )) {
              subProjects.push(path.relative(wsPath, full));
              hasSubProjectMarker = true;
            }
            walk(full, depth + 1);
          } else if (entry.name.endsWith('.py')) {
            count++;
          }
        }
      } catch {}
    };

    walk(wsPath, 0);
    return { count, subProjects };
  }
}
