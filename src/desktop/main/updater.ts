/**
 * Evolve AI Enterprise Desktop Edition — Dual-Mode Auto-Updater & Patch Manager
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OfflinePatchApplyResult, UpdateCheckResult } from '../shared/desktopTypes';
import { getAppVersion } from '../shared/appVersion';
import { verifyPatch, describeIntegrity, ExtractedFile } from '../../fde/patchIntegrity';

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
    const updateUrl = process.env.EVOLVE_UPDATE_URL || 'https://raw.githubusercontent.com/EvolveMinds/codeforge-ai-vscode/main/package.json';
    const https = require('https');
    const http = require('http');

    return new Promise<ReleaseFetchResult>((resolve) => {
      try {
        const parsed = new URL(updateUrl);
        const protocol = parsed.protocol === 'http:' ? http : https;

        const req = protocol.get(updateUrl, { timeout: 4000 }, (res: any) => {
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
              resolve({
                kind: 'success',
                version: latestVer,
                notes: parsedJson.description || 'Maintenance and stability update.',
                date: new Date().toISOString(),
                downloadUrl: 'https://github.com/EvolveMinds/codeforge-ai-vscode/releases'
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

  /**
   * Applies an offline hot patch, verifying it first.
   *
   * Previously this ran `tar -xf` on whatever file it was handed, verified
   * nothing, and returned `success: true` with a hardcoded list of six
   * "reloaded" engines — including when the extraction had failed, because the
   * whole thing sat inside a `catch {}`. For a feature aimed at banking and
   * defence enclaves that was the wrong way round.
   *
   * Now: extract to a temporary directory, verify every file against the
   * manifest's SHA-256, and only then copy the contents into place. A patch
   * that fails any check is refused whole — a half-applied patch on an
   * air-gapped box is worse than one that was rejected.
   */
  public applyOfflinePatch(patchZipPath: string): OfflinePatchApplyResult {
    const refuse = (error: string, rejectionReason?: string): OfflinePatchApplyResult => ({
      success: false,
      patchedVersion: this._currentVersion,
      templatesUpdated: 0,
      enginesReloaded: [],
      error,
      rejectionReason
    });

    if (!fs.existsSync(patchZipPath)) {
      return refuse(`Patch file not found: ${patchZipPath}`, 'not-found');
    }

    const { execSync } = require('child_process');
    const stageDir = path.join(
      os.tmpdir(),
      `evolve-patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      fs.mkdirSync(stageDir, { recursive: true });

      // Extract to staging, never straight over the live templates.
      //
      // The archive is a .zip. Windows' bundled tar (bsdtar) reads zips, but GNU
      // tar — which is what is on PATH under Git Bash and most Linux images —
      // does not, and fails with "This does not look like a tar archive". Try
      // tar first, then fall back to PowerShell's Expand-Archive, mirroring the
      // two writers in scripts/create-offline-patch.js.
      let didExtract = false;
      const attempts: string[] = [];
      for (const cmd of [
        `tar -xf "${patchZipPath}" -C "${stageDir}"`,
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${patchZipPath}' -DestinationPath '${stageDir}' -Force"`
      ]) {
        try {
          execSync(cmd, { stdio: 'ignore' });
          didExtract = true;
          break;
        } catch (e: any) {
          attempts.push(`${cmd.split(' ')[0]}: ${e?.message || e}`);
        }
      }
      if (!didExtract) {
        // A failed extraction used to be swallowed and reported as success.
        return refuse(
          `The archive could not be extracted. It may be corrupt or not a valid patch archive. (${attempts.join('; ')})`,
          'extract-failed'
        );
      }

      const manifestPath = path.join(stageDir, 'manifest.json');
      const manifestRaw = fs.existsSync(manifestPath)
        ? fs.readFileSync(manifestPath, 'utf8')
        : null;

      // Read what was actually extracted, rather than trusting the manifest's
      // own account of the archive's contents.
      const extracted: ExtractedFile[] = [];
      const walk = (dir: string, prefix = ''): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(abs, rel);
          } else if (entry.isFile() && rel !== 'manifest.json') {
            extracted.push({ path: rel, contents: fs.readFileSync(abs) });
          }
        }
      };
      walk(stageDir);

      const verdict = verifyPatch(manifestRaw, extracted, this._currentVersion);
      if (!verdict.ok) {
        return refuse(verdict.message || 'The patch failed verification.', verdict.reason);
      }

      if (!fs.existsSync(this._templatesDir)) {
        fs.mkdirSync(this._templatesDir, { recursive: true });
      }

      // Archive entries are `templates/<engine>/<file>`, and _templatesDir is
      // already `<storage>/templates`, so the leading segment is stripped to
      // avoid landing everything at templates/templates/...
      const written: string[] = [];
      for (const rel of verdict.verifiedFiles) {
        const relOnDisk = rel.startsWith('templates/') ? rel.slice('templates/'.length) : rel;
        const dest = path.join(this._templatesDir, relOnDisk);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(stageDir, rel), dest);
        written.push(rel);
      }
      if (manifestRaw !== null) {
        fs.writeFileSync(path.join(this._templatesDir, 'manifest.json'), manifestRaw, 'utf8');
      }

      // Report the engines whose templates this patch actually replaced, rather
      // than a fixed list. `templates/<engine>/...` is the archive layout.
      const ENGINE_BY_DIR: Record<string, string> = {
        sql: 'SqlTranspiler',
        pii: 'PiiSanitizer',
        rls: 'RlsPolicyGenerator',
        synthetic: 'SyntheticDataGenerator',
        mock: 'MockServerGenerator',
        reverseetl: 'ReverseEtlGenerator'
      };
      const engines = Array.from(
        new Set(
          written
            .map(f => f.split('/'))
            .filter(parts => parts[0] === 'templates' && parts.length > 2)
            .map(parts => ENGINE_BY_DIR[parts[1].toLowerCase()])
            .filter((n): n is string => !!n)
        )
      ).sort();

      return {
        success: true,
        patchedVersion: verdict.manifest?.patchVersion || this._currentVersion,
        templatesUpdated: written.length,
        enginesReloaded: engines,
        verifiedFiles: verdict.verifiedFiles,
        integrityNote: describeIntegrity(verdict.manifest),
        // Engines read their templates from disk when next used, so the patch is
        // live without a restart. Say that, rather than implying a hot reload of
        // in-memory state that does not happen.
        appliesWithoutRestart: true
      };
    } catch (err: any) {
      return refuse(err?.message || String(err), 'unexpected-error');
    } finally {
      try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
    }
  }
}
