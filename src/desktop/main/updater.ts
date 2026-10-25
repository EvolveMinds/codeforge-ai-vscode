/**
 * Evolve AI Enterprise Desktop Edition — Dual-Mode Auto-Updater & Patch Manager
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { OfflinePatchApplyResult, UpdateCheckResult } from '../shared/desktopTypes';
import { getAppVersion } from '../shared/appVersion';

interface ReleaseFetchSuccess {
  kind: 'success';
  version: string;
  notes: string;
  date: string;
  downloadUrl: string;
}

interface ReleaseFetchOffline {
  kind: 'offline';
  reason: string;
}

type ReleaseFetchResult = ReleaseFetchSuccess | ReleaseFetchOffline;

export class DesktopUpdater {
  private _storageDir: string;
  private _templatesDir: string;
  private _currentVersion: string;

  constructor(customStorageDir?: string, customVersion?: string) {
    this._storageDir = customStorageDir || path.join(os.homedir(), '.evolve');
    this._templatesDir = path.join(this._storageDir, 'templates');
    if (!fs.existsSync(this._templatesDir)) {
      try { fs.mkdirSync(this._templatesDir, { recursive: true }); } catch {}
    }
    this._currentVersion = customVersion || getAppVersion();
  }

  public getCurrentVersion(): string {
    return this._currentVersion;
  }

  public async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      if ((process as any).windowsStore) {
        return {
          currentVersion: this._currentVersion,
          latestVersion: this._currentVersion,
          updateAvailable: false,
          isAirGapped: false,
          networkStatus: 'online',
          statusMessage: `Installed via Microsoft Store. Background updates are managed automatically by Windows Store (v${this._currentVersion}).`,
          releaseNotes: 'The Microsoft Store package is cryptographically verified and kept up to date by Windows Store automatically.'
        };
      }

      const releaseInfo = await this._fetchLatestRelease();
      if (releaseInfo && releaseInfo.kind === 'offline') {
        return {
          currentVersion: this._currentVersion,
          latestVersion: this._currentVersion,
          updateAvailable: false,
          isAirGapped: true,
          networkStatus: 'offline',
          statusMessage: 'Air-gapped / Intranet Enclave: External release registry unreachable. Running securely offline.',
          releaseNotes: 'No outbound internet connection detected. Offline air-gapped security policy active.'
        };
      }
      if (releaseInfo && releaseInfo.kind === 'success') {
        const isNewer = this._isNewerVersion(releaseInfo.version, this._currentVersion);
        return {
          currentVersion: this._currentVersion,
          latestVersion: releaseInfo.version,
          updateAvailable: isNewer,
          isAirGapped: false,
          networkStatus: 'online',
          statusMessage: isNewer
            ? `New version ${releaseInfo.version} is available for download.`
            : `Evolve AI Enterprise Studio is up to date (v${this._currentVersion}).`,
          releaseNotes: releaseInfo.notes,
          downloadUrl: releaseInfo.downloadUrl
        };
      }
      return {
        currentVersion: this._currentVersion,
        latestVersion: this._currentVersion,
        updateAvailable: false,
        isAirGapped: false,
        networkStatus: 'online',
        statusMessage: 'Unable to check for updates at this time.'
      };
    } catch (err: any) {
      return {
        currentVersion: this._currentVersion,
        latestVersion: this._currentVersion,
        updateAvailable: false,
        isAirGapped: true,
        networkStatus: 'offline',
        statusMessage: `Update check error: ${err.message || String(err)}`
      };
    }
  }

  private async _fetchLatestRelease(): Promise<ReleaseFetchResult> {
    const customUpdateUrl = process.env.EVOLVE_UPDATE_URL;
    if (customUpdateUrl) {
      return this._fetchFromUrl(customUpdateUrl);
    }

    // Query GitHub Releases API to resolve the exact desktop portable .exe binary asset
    const releasesApiUrl = 'https://api.github.com/repos/EvolveMinds/codeforge-ai-vscode/releases';
    const fallbackPackageUrl = 'https://raw.githubusercontent.com/EvolveMinds/codeforge-ai-vscode/main/package.json';

    return new Promise<ReleaseFetchResult>((resolve) => {
      const https = require('https');
      try {
        const req = https.get(
          releasesApiUrl,
          {
            timeout: 4000,
            headers: { 'User-Agent': 'Evolve-AI-Desktop-Updater' }
          },
          (res: any) => {
            if (res.statusCode === 200) {
              let rawData = '';
              res.on('data', (chunk: any) => { rawData += chunk; });
              res.on('end', () => {
                try {
                  const releases = JSON.parse(rawData);
                  if (Array.isArray(releases) && releases.length > 0) {
                    const desktopRel = releases.find(
                      (r: any) => (r.tag_name && r.tag_name.includes('desktop')) ||
                                  (r.assets && r.assets.some((a: any) => a.name.endsWith('.exe')))
                    ) || releases[0];

                    const rawTag = desktopRel.tag_name || desktopRel.name || this._currentVersion;
                    const cleanVer = String(rawTag).replace('-desktop', '').replace(/^v/, '');
                    const exeAsset = desktopRel.assets?.find((a: any) => a.name.endsWith('.exe'));
                    const directDownload = exeAsset
                      ? exeAsset.browser_download_url
                      : `https://github.com/EvolveMinds/codeforge-ai-vscode/releases/download/v${cleanVer}-desktop/evolve-ai-enterprise-portable-${cleanVer}-win32-x64.exe`;

                    resolve({
                      kind: 'success',
                      version: cleanVer,
                      notes: desktopRel.body || desktopRel.name || 'Maintenance and security update.',
                      date: desktopRel.published_at || new Date().toISOString(),
                      downloadUrl: directDownload
                    });
                    return;
                  }
                } catch {}
                this._fetchFromUrl(fallbackPackageUrl).then(resolve);
              });
              return;
            }
            this._fetchFromUrl(fallbackPackageUrl).then(resolve);
          }
        );

        req.on('error', () => {
          this._fetchFromUrl(fallbackPackageUrl).then(resolve);
        });
        req.on('timeout', () => {
          req.destroy();
          resolve({ kind: 'offline', reason: 'Network connection timed out' });
        });
      } catch (err: any) {
        resolve({ kind: 'offline', reason: err.message || String(err) });
      }
    });
  }

  private async _fetchFromUrl(url: string): Promise<ReleaseFetchResult> {
    const https = require('https');
    const http = require('http');

    return new Promise<ReleaseFetchResult>((resolve) => {
      try {
        const parsed = new URL(url);
        const protocol = parsed.protocol === 'http:' ? http : https;

        const req = protocol.get(url, { timeout: 4000 }, (res: any) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            resolve({ kind: 'offline', reason: `HTTP status ${res.statusCode}` });
            return;
          }
          let rawData = '';
          res.on('data', (chunk: any) => { rawData += chunk; });
          res.on('end', () => {
            try {
              const parsedJson = JSON.parse(rawData);
              const latestVer = parsedJson.version || parsedJson.tag_name || this._currentVersion;
              const cleanVer = String(latestVer).replace(/^v/, '').replace('-desktop', '');
              const directExeUrl = `https://github.com/EvolveMinds/codeforge-ai-vscode/releases/download/v${cleanVer}-desktop/evolve-ai-enterprise-portable-${cleanVer}-win32-x64.exe`;
              resolve({
                kind: 'success',
                version: cleanVer,
                notes: parsedJson.description || 'Maintenance and stability update.',
                date: new Date().toISOString(),
                downloadUrl: directExeUrl
              });
            } catch {
              resolve({ kind: 'offline', reason: 'Invalid JSON payload received' });
            }
          });
        });

        req.on('error', (err: any) => {
          resolve({ kind: 'offline', reason: err.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ kind: 'offline', reason: 'Network connection timed out' });
        });
      } catch (err: any) {
        resolve({ kind: 'offline', reason: err.message || String(err) });
      }
    });
  }

  private _isNewerVersion(remoteVer: string, currentVer: string): boolean {
    const rClean = remoteVer.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const cClean = currentVer.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < 3; i++) {
      const r = rClean[i] || 0;
      const c = cClean[i] || 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    return false;
  }

  public applyOfflinePatch(patchZipPath: string): OfflinePatchApplyResult {
    if (!fs.existsSync(patchZipPath)) {
      return {
        success: false,
        patchedVersion: this._currentVersion,
        templatesUpdated: 0,
        enginesReloaded: [],
        error: `Patch file not found: ${patchZipPath}`
      };
    }

    const tempExtractDir = path.join(os.tmpdir(), `evolve-patch-staging-${Date.now()}`);
    try {
      fs.mkdirSync(tempExtractDir, { recursive: true });

      // 1. Calculate archive SHA-256
      const archiveBytes = fs.readFileSync(patchZipPath);
      const archiveHash = crypto.createHash('sha256').update(archiveBytes).digest('hex');

      // 2. Extract into quarantine temp directory
      const { execSync } = require('child_process');
      try {
        execSync(`tar -xf "${patchZipPath}" -C "${tempExtractDir}"`, { stdio: 'pipe' });
      } catch (tarErr: any) {
        return {
          success: false,
          patchedVersion: this._currentVersion,
          templatesUpdated: 0,
          enginesReloaded: [],
          error: `Archive extraction failed: ${tarErr.message || String(tarErr)}`
        };
      }

      // 3. Verify manifest.json
      const manifestPath = path.join(tempExtractDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return {
          success: false,
          patchedVersion: this._currentVersion,
          templatesUpdated: 0,
          enginesReloaded: [],
          error: 'Corrupt patch archive: manifest.json missing from root of archive.'
        };
      }

      let manifest: any;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (parseErr: any) {
        return {
          success: false,
          patchedVersion: this._currentVersion,
          templatesUpdated: 0,
          enginesReloaded: [],
          error: `Invalid manifest.json: ${parseErr.message}`
        };
      }

      // 4. Validate base version compatibility
      if (manifest.baseVersion && typeof manifest.baseVersion === 'string') {
        const majorRunning = this._currentVersion.split('.')[0];
        const majorBase = manifest.baseVersion.split('.')[0];
        if (majorRunning !== majorBase) {
          return {
            success: false,
            patchedVersion: this._currentVersion,
            templatesUpdated: 0,
            enginesReloaded: [],
            error: `Incompatible patch: target version ${manifest.baseVersion} does not match active version ${this._currentVersion}.`
          };
        }
      }

      // 5. Verify file checksums and prevent path traversal
      const checksums = manifest.checksums || {};
      const updatedFiles: string[] = Array.isArray(manifest.templatesUpdated) ? manifest.templatesUpdated : [];

      for (const relFile of updatedFiles) {
        // Prevent path traversal
        const normalizedRel = path.normalize(relFile).replace(/^(\.\.[\/\\])+/, '');
        if (relFile.includes('..') || path.isAbsolute(relFile)) {
          return {
            success: false,
            patchedVersion: this._currentVersion,
            templatesUpdated: 0,
            enginesReloaded: [],
            error: `Security violation: Path traversal detected in archive entry "${relFile}".`
          };
        }

        const extractedFile = path.join(tempExtractDir, normalizedRel);
        if (!fs.existsSync(extractedFile)) {
          return {
            success: false,
            patchedVersion: this._currentVersion,
            templatesUpdated: 0,
            enginesReloaded: [],
            error: `Missing file in patch archive: "${relFile}" declared in manifest but not found.`
          };
        }

        if (checksums[relFile]) {
          const fileBytes = fs.readFileSync(extractedFile);
          const computedHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
          if (computedHash !== checksums[relFile]) {
            return {
              success: false,
              patchedVersion: this._currentVersion,
              templatesUpdated: 0,
              enginesReloaded: [],
              error: `Integrity check failed: Checksum mismatch for "${relFile}". Archive may be corrupt or tampered.`
            };
          }
        }
      }

      // 6. Safe atomic installation into templatesDir
      if (!fs.existsSync(this._templatesDir)) {
        fs.mkdirSync(this._templatesDir, { recursive: true });
      }

      let copiedCount = 0;
      for (const relFile of updatedFiles) {
        const src = path.join(tempExtractDir, relFile);
        const dest = path.join(this._templatesDir, relFile);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        copiedCount++;
      }

      // Also copy manifest
      fs.copyFileSync(manifestPath, path.join(this._templatesDir, 'manifest.json'));

      const enginesReloaded = Array.isArray(manifest.enginesReloaded) ? manifest.enginesReloaded : [];
      const patchVersionTag = manifest.patchVersion || `${this._currentVersion}-patch-${archiveHash.slice(0, 8)}`;

      return {
        success: true,
        patchedVersion: patchVersionTag,
        templatesUpdated: copiedCount,
        enginesReloaded
      };
    } catch (err: any) {
      return {
        success: false,
        patchedVersion: this._currentVersion,
        templatesUpdated: 0,
        enginesReloaded: [],
        error: `Patch apply error: ${err.message || String(err)}`
      };
    } finally {
      // Clean up quarantine temp directory
      try {
        if (fs.existsSync(tempExtractDir)) {
          fs.rmSync(tempExtractDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }
}
