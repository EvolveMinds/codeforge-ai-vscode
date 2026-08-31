/**
 * Evolve AI Enterprise Desktop Edition — Workspace & File System Manager
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileNode, FileOpenResult, FileSaveResult, WorkspaceInfo } from '../shared/desktopTypes';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.vscode',
  '.idea',
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  'venv',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.dbt',
  '.terraform'
]);

export class DesktopWorkspaceManager {
  private _currentWorkspace: WorkspaceInfo | null = null;
  private _recentWorkspacesFile: string;
  private _watcher: fs.FSWatcher | null = null;
  private _watchCallbacks: Array<(event: string, filename: string) => void> = [];

  constructor(customStorageDir?: string) {
    const baseDir = customStorageDir || path.join(os.homedir(), '.evolve');
    if (!fs.existsSync(baseDir)) {
      try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}
    }
    this._recentWorkspacesFile = path.join(baseDir, 'desktop-recent.json');
  }

  public getCurrentWorkspace(): WorkspaceInfo | null {
    return this._currentWorkspace;
  }

  public setCurrentWorkspace(folderPath: string): WorkspaceInfo {
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      throw new Error(`Directory does not exist: ${folderPath}`);
    }

    const folderName = path.basename(folderPath);
    const gitDir = path.join(folderPath, '.git');
    const isGitRepo = fs.existsSync(gitDir);
    let activeBranch = 'main';

    if (isGitRepo) {
      try {
        const headContent = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8');
        const match = headContent.match(/ref:\s+refs\/heads\/(.+)/);
        if (match) activeBranch = match[1].trim();
      } catch {}
    }

    let clientName = folderName;
    let targetVpc = 'default-vpc';
    const configPath = path.join(folderPath, '.evolve', 'engagement.json');
    if (fs.existsSync(configPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (raw.clientName) clientName = raw.clientName;
        if (raw.targetVpc) targetVpc = raw.targetVpc;
      } catch {}
    }

    const ws: WorkspaceInfo = {
      path: path.resolve(folderPath),
      name: folderName,
      isGitRepo,
      activeBranch,
      lastOpened: new Date().toISOString(),
      clientName,
      targetVpc
    };

    this._currentWorkspace = ws;
    this.addRecentWorkspace(ws);
    this._startWatcher(folderPath);

    return ws;
  }

  public getRecentWorkspaces(): WorkspaceInfo[] {
    try {
      if (fs.existsSync(this._recentWorkspacesFile)) {
        const data = fs.readFileSync(this._recentWorkspacesFile, 'utf8');
        const list = JSON.parse(data);
        return Array.isArray(list) ? list.filter(w => fs.existsSync(w.path)) : [];
      }
    } catch {}
    return [];
  }

  public addRecentWorkspace(ws: WorkspaceInfo): void {
    try {
      const recent = this.getRecentWorkspaces().filter(w => w.path !== ws.path);
      recent.unshift(ws);
      const capped = recent.slice(0, 15);
      fs.writeFileSync(this._recentWorkspacesFile, JSON.stringify(capped, null, 2), 'utf8');
    } catch {}
  }

  public getFileTree(dirPath?: string, maxDepth: number = 5, currentDepth: number = 0): FileNode {
    const targetDir = dirPath || (this._currentWorkspace ? this._currentWorkspace.path : process.cwd());
    const baseName = path.basename(targetDir);
    const rootRelative = this._currentWorkspace ? path.relative(this._currentWorkspace.path, targetDir) : '';

    const rootNode: FileNode = {
      name: baseName,
      path: targetDir,
      relativePath: rootRelative || '.',
      isDirectory: true,
      children: []
    };

    if (currentDepth >= maxDepth) return rootNode;

    try {
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      // Sort: Directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;

        const fullPath = path.join(targetDir, entry.name);
        const relPath = this._currentWorkspace ? path.relative(this._currentWorkspace.path, fullPath) : entry.name;

        if (entry.isDirectory()) {
          const childNode = this.getFileTree(fullPath, maxDepth, currentDepth + 1);
          rootNode.children?.push(childNode);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          let size = 0;
          try { size = fs.statSync(fullPath).size; } catch {}

          rootNode.children?.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            isDirectory: false,
            size,
            extension: ext
          });
        }
      }
    } catch {}

    return rootNode;
  }

  public readFile(filePath: string): FileOpenResult {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : (this._currentWorkspace ? path.join(this._currentWorkspace.path, filePath) : path.resolve(filePath));

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File does not exist: ${fullPath}`);
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new Error(`Cannot open directory as file: ${fullPath}`);
    }

    // Limit preview to 5MB
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error(`File too large for live preview (${(stat.size / (1024 * 1024)).toFixed(2)} MB). Max limit is 5MB.`);
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const ext = path.extname(fullPath).toLowerCase();
    const relPath = this._currentWorkspace ? path.relative(this._currentWorkspace.path, fullPath) : path.basename(fullPath);

    return {
      path: fullPath,
      relativePath: relPath,
      content,
      size: stat.size,
      readOnly: false,
      language: this._detectLanguage(ext, fullPath)
    };
  }

  public writeFile(filePath: string, content: string): FileSaveResult {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : (this._currentWorkspace ? path.join(this._currentWorkspace.path, filePath) : path.resolve(filePath));

    try {
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf8');
      const stat = fs.statSync(fullPath);

      return {
        success: true,
        path: fullPath,
        bytesWritten: stat.size
      };
    } catch (err: any) {
      return {
        success: false,
        path: fullPath,
        bytesWritten: 0,
        error: err.message || String(err)
      };
    }
  }

  public createDirectory(dirPath: string): boolean {
    const fullPath = path.isAbsolute(dirPath)
      ? dirPath
      : (this._currentWorkspace ? path.join(this._currentWorkspace.path, dirPath) : path.resolve(dirPath));

    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      return true;
    }
    return false;
  }

  public deleteItem(targetPath: string): boolean {
    const fullPath = path.isAbsolute(targetPath)
      ? targetPath
      : (this._currentWorkspace ? path.join(this._currentWorkspace.path, targetPath) : path.resolve(targetPath));

    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      return true;
    }
    return false;
  }

  public renameItem(oldPath: string, newPath: string): boolean {
    const fullOld = path.isAbsolute(oldPath)
      ? oldPath
      : (this._currentWorkspace ? path.join(this._currentWorkspace.path, oldPath) : path.resolve(oldPath));
    const fullNew = path.isAbsolute(newPath)
      ? newPath
      : (this._currentWorkspace ? path.join(this._currentWorkspace.path, newPath) : path.resolve(newPath));

    if (fs.existsSync(fullOld)) {
      fs.renameSync(fullOld, fullNew);
      return true;
    }
    return false;
  }

  public onWatchEvent(callback: (event: string, filename: string) => void): void {
    this._watchCallbacks.push(callback);
  }

  private _startWatcher(rootPath: string): void {
    if (this._watcher) {
      try { this._watcher.close(); } catch {}
      this._watcher = null;
    }

    try {
      this._watcher = fs.watch(rootPath, { recursive: true }, (event, filename) => {
        if (!filename) return;
        if (filename.includes('node_modules') || filename.includes('.git') || filename.includes('.tmp')) return;

        for (const cb of this._watchCallbacks) {
          try { cb(event, filename); } catch {}
        }
      });
    } catch {}
  }

  private _detectLanguage(ext: string, fullPath: string): string {
    switch (ext) {
      case '.sql': return 'sql';
      case '.py': return 'python';
      case '.ts': return 'typescript';
      case '.js': return 'javascript';
      case '.json': return 'json';
      case '.yaml':
      case '.yml': return 'yaml';
      case '.md': return 'markdown';
      case '.sh':
      case '.bash': return 'shell';
      case '.ps1': return 'powershell';
      case '.tf': return 'terraform';
      case '.dockerfile': return 'dockerfile';
      case '.env': return 'ini';
      default:
        if (path.basename(fullPath).toLowerCase() === 'dockerfile') return 'dockerfile';
        return 'plaintext';
    }
  }

  public dispose(): void {
    if (this._watcher) {
      try { this._watcher.close(); } catch {}
      this._watcher = null;
    }
    this._watchCallbacks = [];
  }
}
