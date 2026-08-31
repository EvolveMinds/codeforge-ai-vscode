/**
 * Evolve AI Enterprise Desktop Edition — Identity & Ed25519 Licensing Engine
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ActivationChallengeRequest,
  EnterpriseLicenseState,
  HardwareFingerprintInfo,
  RegisteredUserProfile
} from '../shared/desktopTypes';
import { LicenseValidator } from '../../enterprise/license/licenseValidator';
import { LicenseManager } from '../../enterprise/license/licenseManager';

export class DesktopLicenseAuth {
  private _storageDir: string;
  private _licenseFile: string;
  private _profileFile: string;
  private _licenseMgr: LicenseManager;

  constructor(customStorageDir?: string) {
    this._storageDir = customStorageDir || path.join(os.homedir(), '.evolve');
    if (!fs.existsSync(this._storageDir)) {
      try { fs.mkdirSync(this._storageDir, { recursive: true }); } catch {}
    }
    this._licenseFile = path.join(this._storageDir, 'license.json');
    this._profileFile = path.join(this._storageDir, 'profile.json');

    const mockStorage: any = {
      get: async (key: string) => {
        try {
          if (fs.existsSync(this._licenseFile)) {
            const raw = JSON.parse(fs.readFileSync(this._licenseFile, 'utf8'));
            return raw[key] || undefined;
          }
        } catch {}
        return undefined;
      },
      store: async (key: string, val: string) => {
        try {
          let raw: any = {};
          if (fs.existsSync(this._licenseFile)) {
            raw = JSON.parse(fs.readFileSync(this._licenseFile, 'utf8'));
          }
          raw[key] = val;
          fs.writeFileSync(this._licenseFile, JSON.stringify(raw, null, 2), 'utf8');
        } catch {}
      },
      delete: async (key: string) => {
        try {
          if (fs.existsSync(this._licenseFile)) {
            const raw = JSON.parse(fs.readFileSync(this._licenseFile, 'utf8'));
            delete raw[key];
            fs.writeFileSync(this._licenseFile, JSON.stringify(raw, null, 2), 'utf8');
          }
        } catch {}
      }
    };

    this._licenseMgr = new LicenseManager(mockStorage);
  }

  public getHardwareFingerprint(): HardwareFingerprintInfo {
    const hostname = os.hostname();
    const platform = os.platform();
    const arch = os.arch();
    const cpus = os.cpus().map(c => c.model).slice(0, 2).join(';');

    let macSample = '00:00:00:00:00:00';
    try {
      const net = os.networkInterfaces();
      for (const k of Object.keys(net)) {
        const addrs = net[k];
        if (addrs) {
          for (const a of addrs) {
            if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') {
              macSample = a.mac;
              break;
            }
          }
        }
      }
    } catch {}

    const seed = `evolve:${platform}:${arch}:${hostname}:${cpus}:${macSample}`;
    const hash = crypto.createHash('sha256').update(seed).digest('hex');

    return {
      machineFingerprint: `sha256:${hash}`,
      hostname,
      platform,
      arch,
      cpus,
      macAddressSample: macSample
    };
  }

  public getLicenseState(): EnterpriseLicenseState {
    const base = this._licenseMgr.getState();
    const hw = this.getHardwareFingerprint();

    return {
      isLicensed: base.isLicensed,
      plan: base.plan,
      organization: base.organization,
      licenseId: base.licenseId,
      expiresAt: base.expiresAt,
      daysRemaining: base.daysRemaining,
      seats: (base as any).seats || 1,
      hardwareFingerprint: hw.machineFingerprint,
      hardwareMatched: base.isLicensed ? true : false,
      features: base.features
    };
  }

  public async activateLicenseKey(licenseKey: string): Promise<{ valid: boolean; error?: string; state: EnterpriseLicenseState }> {
    const result = await this._licenseMgr.activateLicense(licenseKey);
    return {
      valid: result.valid,
      error: result.error,
      state: this.getLicenseState()
    };
  }

  public generateOfflineChallenge(userId: string, orgName: string): ActivationChallengeRequest {
    const hw = this.getHardwareFingerprint();
    const challengeId = 'REQ-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    return {
      challengeId,
      userId: userId || 'fde@enterprise.com',
      organization: orgName || 'Enterprise Client',
      machineFingerprint: hw.machineFingerprint,
      requestedAt: new Date().toISOString(),
      appVersion: '2.19.1'
    };
  }

  public async importOfflineLicenseFile(filePath: string): Promise<{ valid: boolean; error?: string; state: EnterpriseLicenseState }> {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: `License file not found: ${filePath}`, state: this.getLicenseState() };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      let key = content;
      if (content.startsWith('{')) {
        const envelope = JSON.parse(content);
        key = envelope.licenseKey || envelope.key || content;
      }

      return await this.activateLicenseKey(key);
    } catch (err: any) {
      return { valid: false, error: `Failed to parse offline license file: ${err.message}`, state: this.getLicenseState() };
    }
  }

  public getProfile(): RegisteredUserProfile {
    try {
      if (fs.existsSync(this._profileFile)) {
        return JSON.parse(fs.readFileSync(this._profileFile, 'utf8'));
      }
    } catch {}

    return {
      userId: 'fde-engineer',
      userDisplayName: 'Forward Deployed Engineer',
      email: 'engineer@client.corp',
      organization: 'Enterprise Partner',
      role: 'Lead Architect',
      lastLogin: new Date().toISOString()
    };
  }

  public saveProfile(profile: Partial<RegisteredUserProfile>): RegisteredUserProfile {
    const current = this.getProfile();
    const updated: RegisteredUserProfile = {
      ...current,
      ...profile,
      lastLogin: new Date().toISOString()
    };

    try {
      fs.writeFileSync(this._profileFile, JSON.stringify(updated, null, 2), 'utf8');
    } catch {}

    return updated;
  }
}
