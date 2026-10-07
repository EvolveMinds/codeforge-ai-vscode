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
import { DesktopSecretVault } from './secretVault';
import { EnterpriseFeature } from '../../enterprise/license/licenseTypes';

export class DesktopLicenseAuth {
  private _storageDir: string;
  private _licenseFile: string;
  private _profileFile: string;
  private _licenseMgr: LicenseManager;
  private _vault: DesktopSecretVault;

  constructor(customStorageDir?: string) {
    this._storageDir = customStorageDir || path.join(os.homedir(), '.evolve');
    if (!fs.existsSync(this._storageDir)) {
      try { fs.mkdirSync(this._storageDir, { recursive: true }); } catch {}
    }
    this._licenseFile = path.join(this._storageDir, 'license.json');
    this._profileFile = path.join(this._storageDir, 'profile.json');
    this._vault = new DesktopSecretVault(this._storageDir);

    const mockStorage: any = {
      get: async (key: string) => {
        try {
          if (fs.existsSync(this._licenseFile)) {
            const raw = JSON.parse(fs.readFileSync(this._licenseFile, 'utf8'));
            if (key === 'evolve.enterprise.trialInfo') {
              return raw[key] || (raw.isTrial ? JSON.stringify(raw) : undefined);
            }
            return raw[key] || raw.licenseKey || raw.key || (typeof raw === 'string' ? raw : undefined);
          }
        } catch {}
        return undefined;
      },
      store: async (key: string, val: string) => {
        try {
          let raw: any = {};
          if (fs.existsSync(this._licenseFile)) {
            try { raw = JSON.parse(fs.readFileSync(this._licenseFile, 'utf8')); } catch {}
          }
          raw[key] = val;
          if (key === 'evolve.enterprise.licenseKey') {
            raw.licenseKey = val;
            raw.key = val;
            delete raw['evolve.enterprise.trialInfo'];
            delete raw.isTrial;
          } else if (key === 'evolve.enterprise.trialInfo') {
            raw.isTrial = true;
          }
          fs.writeFileSync(this._licenseFile, JSON.stringify(raw, null, 2), 'utf8');
        } catch {}
      },
      delete: async (key: string) => {
        try {
          if (fs.existsSync(this._licenseFile)) {
            const raw = JSON.parse(fs.readFileSync(this._licenseFile, 'utf8'));
            delete raw[key];
            if (key === 'evolve.enterprise.licenseKey') {
              delete raw.licenseKey;
              delete raw.key;
            }
            if (key === 'evolve.enterprise.trialInfo') {
              delete raw.isTrial;
            }
            fs.writeFileSync(this._licenseFile, JSON.stringify(raw, null, 2), 'utf8');
          }
        } catch {}
      }
    };

    this._licenseMgr = new LicenseManager(mockStorage);
    this._syncFromStorage();
  }

  private _computeTrialSignature(firstActivated: string, expiresAt: string): string {
    const entropy = `evolve:trial:${os.platform()}:${os.hostname()}:${os.userInfo().username}:${firstActivated}:${expiresAt}`;
    return crypto.createHash('sha256').update(entropy).digest('hex');
  }

  private _syncFromStorage(): void {
    try {
      let activeVaultTrial = false;
      const vaultStart = this._vault.getSecret('trial_first_activated');
      const vaultExpiry = this._vault.getSecret('trial_expires_at');
      const vaultSig = this._vault.getSecret('trial_signature');

      if (vaultStart && vaultExpiry && vaultSig) {
        const expectedSig = this._computeTrialSignature(vaultStart, vaultExpiry);
        if (vaultSig === expectedSig) {
          const now = Date.now();
          const expiryTime = new Date(vaultExpiry).getTime();
          if (now < expiryTime) {
            activeVaultTrial = true;
          }
        }
      }

      if (fs.existsSync(this._licenseFile)) {
        const rawContent = fs.readFileSync(this._licenseFile, 'utf8').trim();
        let key = (rawContent || '').replace(/[\r\n\s\t]+/g, '').trim();
        let claimantEmail: string | undefined = undefined;
        if (rawContent.startsWith('{')) {
          try {
            const parsed = JSON.parse(rawContent);

            // Gated Trial Check: rawContent claiming isTrial is ONLY trusted if vault confirms active trial
            if (parsed.isTrial) {
              if (activeVaultTrial && vaultExpiry) {
                const now = new Date();
                const expiresAt = new Date(vaultExpiry);
                const diffMs = expiresAt.getTime() - now.getTime();
                const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
                const org = this._vault.getSecret('trial_org') || parsed.organization || 'Trial Partner';

                (this._licenseMgr as any)._state = {
                  isLicensed: true,
                  isTrial: true,
                  plan: 'enterprise_platinum',
                  organization: org,
                  licenseId: 'EM-TRIAL-LOCAL',
                  expiresAt: vaultExpiry,
                  daysRemaining: daysRemaining,
                  maxSeats: 25,
                  seats: 25,
                  licenseScope: 'seat',
                  features: [
                    'load_testing',
                    'rag_scaffolder',
                    'data_quality',
                    'siem_logging',
                    'co_branding',
                    'multi_tenant_sync',
                    'priority_sla',
                  ],
                  rawKey: 'LOCAL_TRIAL_ACTIVE',
                };
                return;
              } else {
                // license.json trial has no backing vault entitlement or is expired
                (this._licenseMgr as any)._state = {
                  isLicensed: false,
                  isTrial: false,
                  plan: 'community',
                  organization: 'Community User',
                  licenseId: '',
                  expiresAt: '',
                  daysRemaining: 0,
                  maxSeats: 0,
                  seats: 0,
                  licenseScope: 'seat',
                  features: []
                };
                return;
              }
            }

            const extracted = parsed['evolve.enterprise.licenseKey'] || parsed.licenseKey || parsed.key || rawContent;
            key = (extracted || '').replace(/[\r\n\s\t]+/g, '').trim();
            claimantEmail = parsed.claimedBy || parsed.userEmail || parsed.email;
          } catch {}
        }

        if (typeof key === 'string' && key.startsWith('EM-ENT-V1.')) {
          if (claimantEmail && (claimantEmail.includes('BEGIN PUBLIC KEY') || claimantEmail.includes('KEY-----'))) {
            claimantEmail = undefined;
          }
          const res = LicenseValidator.verify(key, claimantEmail);
          if (res.valid && res.payload) {
            (this._licenseMgr as any)._state = {
              isLicensed: true,
              isTrial: false,
              plan: res.payload.plan,
              organization: res.payload.organization,
              licenseId: res.payload.licenseId,
              expiresAt: res.payload.expiresAt,
              daysRemaining: res.daysRemaining || 0,
              maxSeats: res.payload.maxSeats,
              seats: res.payload.maxSeats,
              licenseScope: res.payload.licenseScope || (res.payload.maxSeats === -1 ? 'site' : 'seat'),
              features: res.payload.features || [],
              rawKey: key,
              allowedEmailDomains: res.payload.allowedEmailDomains,
              claimantEmail: res.payload.claimantEmail || claimantEmail,
              seatId: res.payload.seatId,
              seatNumber: res.payload.seatNumber,
            };
            return;
          }
        }
      }

      // If no valid license.json, but vault has an active trial
      if (activeVaultTrial && vaultExpiry) {
        const now = new Date();
        const expiresAt = new Date(vaultExpiry);
        const diffMs = expiresAt.getTime() - now.getTime();
        const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        const org = this._vault.getSecret('trial_org') || 'Trial Partner';

        (this._licenseMgr as any)._state = {
          isLicensed: true,
          isTrial: true,
          plan: 'enterprise_platinum',
          organization: org,
          licenseId: 'EM-TRIAL-LOCAL',
          expiresAt: vaultExpiry,
          daysRemaining: daysRemaining,
          maxSeats: 25,
          seats: 25,
          licenseScope: 'seat',
          features: [
            'load_testing',
            'rag_scaffolder',
            'data_quality',
            'siem_logging',
            'co_branding',
            'multi_tenant_sync',
            'priority_sla',
          ],
          rawKey: 'LOCAL_TRIAL_ACTIVE',
        };
        return;
      }

      // Default: unlicensed community state
      (this._licenseMgr as any)._state = {
        isLicensed: false,
        isTrial: false,
        plan: 'community',
        organization: 'Community User',
        licenseId: '',
        expiresAt: '',
        daysRemaining: 0,
        maxSeats: 0,
        seats: 0,
        licenseScope: 'seat',
        features: []
      };
    } catch {}
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
    this._syncFromStorage();
    const base = this._licenseMgr.getState();
    const hw = this.getHardwareFingerprint();

    const maxSeats = (base as any).maxSeats ?? (base as any).seats ?? 1;
    const isSite = (base as any).licenseScope === 'site' || maxSeats === -1;

    return {
      isLicensed: base.isLicensed,
      plan: base.plan,
      organization: base.organization,
      licenseId: base.licenseId,
      expiresAt: base.expiresAt,
      daysRemaining: base.daysRemaining,
      seats: isSite ? -1 : maxSeats,
      maxSeats: maxSeats,
      licenseScope: isSite ? 'site' : 'seat',
      hardwareFingerprint: hw.machineFingerprint,
      hardwareMatched: base.isLicensed ? true : false,
      features: base.features,
      claimantEmail: (base as any).claimantEmail,
      seatId: (base as any).seatId,
      seatNumber: (base as any).seatNumber,
    };
  }

  public async activateLicenseKey(licenseKey: string, userEmail?: string): Promise<{ valid: boolean; error?: string; state: EnterpriseLicenseState }> {
    const cleanKey = (licenseKey || '').replace(/[\r\n\s\t]+/g, '').trim();
    let sanitizedEmail = userEmail;
    if (sanitizedEmail && (sanitizedEmail.includes('BEGIN PUBLIC KEY') || sanitizedEmail.includes('KEY-----'))) {
      sanitizedEmail = undefined;
    }
    const result = await this._licenseMgr.activateLicense(cleanKey, sanitizedEmail);
    if (result.valid && result.payload) {
      try {
        const bundle = {
          organization: result.payload.organization,
          licenseId: result.payload.licenseId,
          ...(result.payload.seatId ? { seatId: result.payload.seatId } : {}),
          ...(result.payload.seatNumber ? { seatNumber: result.payload.seatNumber } : {}),
          plan: result.payload.plan,
          licenseScope: result.payload.licenseScope,
          maxSeats: result.payload.maxSeats,
          issuedAt: result.payload.issuedAt,
          expiresAt: result.payload.expiresAt,
          'evolve.enterprise.licenseKey': cleanKey,
          signature: cleanKey.split('.')[2] || '',
          features: result.payload.features,
          contactEmail: result.payload.contactEmail,
          ...(result.payload.allowedEmailDomains ? { allowedEmailDomains: result.payload.allowedEmailDomains } : {}),
          ...(result.payload.claimantEmail || sanitizedEmail ? { claimedBy: result.payload.claimantEmail || sanitizedEmail, claimedAt: new Date().toISOString() } : {}),
        };
        const dir = path.dirname(this._licenseFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this._licenseFile, JSON.stringify(bundle, null, 2), 'utf8');
      } catch {}
    }
    this._syncFromStorage();
    return {
      valid: result.valid,
      error: result.error,
      state: this.getLicenseState()
    };
  }

  public async deactivateLicense(): Promise<EnterpriseLicenseState> {
    await this._licenseMgr.deactivateLicense();
    try {
      if (fs.existsSync(this._licenseFile)) {
        fs.unlinkSync(this._licenseFile);
      }
    } catch {}
    this._syncFromStorage();
    return this.getLicenseState();
  }

  public async activateLocalTrial(orgName: string = 'Enterprise Partner', days: number = 30): Promise<EnterpriseLicenseState> {
    const existingStart = this._vault.getSecret('trial_first_activated');
    const existingExpiry = this._vault.getSecret('trial_expires_at');
    const existingSig = this._vault.getSecret('trial_signature');

    const now = Date.now();

    if (existingStart && existingExpiry && existingSig) {
      const expectedSig = this._computeTrialSignature(existingStart, existingExpiry);
      if (existingSig === expectedSig) {
        const expiryTime = new Date(existingExpiry).getTime();
        if (now > expiryTime) {
          throw new Error('Evaluation trial period has already expired on this workstation. To continue using Evolve AI Enterprise, please enter a valid enterprise license key.');
        }
        // Still within original 30-day window; return current active state
        this._syncFromStorage();
        return this.getLicenseState();
      }
    }

    if (existingStart) {
      throw new Error('Evaluation trial period has already expired on this workstation. To continue using Evolve AI Enterprise, please enter a valid enterprise license key.');
    }

    const startDate = new Date();
    const expiryDate = new Date(startDate.getTime() + Math.min(days, 30) * 86400000);
    const startIso = startDate.toISOString();
    const expiryIso = expiryDate.toISOString();
    const sig = this._computeTrialSignature(startIso, expiryIso);

    this._vault.setSecret('trial_first_activated', startIso);
    this._vault.setSecret('trial_expires_at', expiryIso);
    this._vault.setSecret('trial_signature', sig);
    this._vault.setSecret('trial_org', orgName);

    await this._licenseMgr.activateLocalTrial(orgName, days);

    try {
      const bundle = {
        isTrial: true,
        organization: orgName,
        plan: 'enterprise_platinum',
        licenseId: 'EM-TRIAL-LOCAL',
        startedAt: startIso,
        expiresAt: expiryIso,
        trialSignature: sig,
        features: [
          'load_testing',
          'rag_scaffolder',
          'data_quality',
          'siem_logging',
          'co_branding',
          'multi_tenant_sync',
          'priority_sla',
        ]
      };
      fs.writeFileSync(this._licenseFile, JSON.stringify(bundle, null, 2), 'utf8');
    } catch {}

    this._syncFromStorage();
    return this.getLicenseState();
  }

  public hasFeature(feature: EnterpriseFeature): boolean {
    this._syncFromStorage();
    return this._licenseMgr.hasFeature(feature);
  }

  public async generateTrialKey(orgName: string = 'Enterprise Partner', days: number = 30): Promise<string> {
    await this.activateLocalTrial(orgName, days);
    return `EM-TRIAL-ACTIVE (${days} Days Evaluation Active)`;
  }

  public generateSiteLicenseKey(_orgName?: string, _days?: number): string {
    return 'Site licenses are issued by Evolve Mind Solutions via enterprise procurement. Contact sales@evolveminds.com.au.';
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
