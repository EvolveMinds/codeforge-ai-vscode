/**
 * enterprise/license/licenseManager.ts
 *
 * Enterprise License State Manager.
 * Handles encrypted key storage (vscode.SecretStorage), validation, and feature gating.
 * Supports commercial offline Ed25519 licenses as well as zero-secret local evaluation trials.
 * Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

import * as vscode from 'vscode';
import { LicenseValidator } from './licenseValidator';
import { LicenseState, LicenseVerificationResult, EnterpriseFeature } from './licenseTypes';
import type { EventBus } from '../../core/eventBus';

const SECRET_STORAGE_KEY = 'evolve.enterprise.licenseKey';
const TRIAL_STORAGE_KEY = 'evolve.enterprise.trialInfo';

const ALL_ENTERPRISE_FEATURES: EnterpriseFeature[] = [
  'load_testing',
  'rag_scaffolder',
  'data_quality',
  'siem_logging',
  'co_branding',
  'multi_tenant_sync',
  'priority_sla',
];

export class LicenseManager {
  private _state: LicenseState = {
    isLicensed: false,
    isTrial: false,
    plan: 'community',
    organization: 'Community User',
    licenseId: '',
    expiresAt: '',
    daysRemaining: 0,
    features: [],
  };

  constructor(
    private readonly _secrets: vscode.SecretStorage,
    private readonly _events?: EventBus
  ) {}

  /**
   * Initializes license state by reading from hardware-encrypted SecretStorage.
   * Priority: Official signed enterprise license > Active local evaluation trial > Community default.
   */
  public async initialize(): Promise<LicenseState> {
    try {
      // 1. Check for cryptographically signed enterprise license
      const storedKey = await this._secrets.get(SECRET_STORAGE_KEY);
      if (storedKey) {
        const result = LicenseValidator.verify(storedKey);
        if (result.valid && result.payload) {
          this._state = {
            isLicensed: true,
            isTrial: false,
            plan: result.payload.plan,
            organization: result.payload.organization,
            licenseId: result.payload.licenseId,
            expiresAt: result.payload.expiresAt,
            daysRemaining: result.daysRemaining || 0,
            maxSeats: result.payload.maxSeats,
            seats: result.payload.maxSeats,
            licenseScope: result.payload.licenseScope || (result.payload.maxSeats === -1 ? 'site' : 'seat'),
            features: result.payload.features || [],
            rawKey: storedKey,
            seatId: result.payload.seatId,
            seatNumber: result.payload.seatNumber,
            claimantEmail: result.payload.claimantEmail,
          };
          return this.getState();
        }
      }

      // 2. Check for local evaluation trial
      const storedTrial = await this._secrets.get(TRIAL_STORAGE_KEY);
      if (storedTrial) {
        try {
          const trial = JSON.parse(storedTrial);
          if (trial && trial.expiresAt) {
            const now = new Date();
            const expiresAt = new Date(trial.expiresAt);
            if (now < expiresAt) {
              const diffMs = expiresAt.getTime() - now.getTime();
              const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
              this._state = {
                isLicensed: true,
                isTrial: true,
                plan: 'enterprise_platinum',
                organization: trial.organization || 'Community Trial User',
                licenseId: trial.licenseId || 'EM-TRIAL-LOCAL',
                expiresAt: trial.expiresAt,
                daysRemaining,
                maxSeats: 25,
                seats: 25,
                licenseScope: 'seat',
                features: [...ALL_ENTERPRISE_FEATURES],
                rawKey: 'LOCAL_TRIAL_ACTIVE',
              };
              return this.getState();
            }
          }
        } catch {}
      }

      // 3. Fallback: unlicensed community state
      this._state = {
        isLicensed: false,
        isTrial: false,
        plan: 'community',
        organization: 'Community User',
        licenseId: '',
        expiresAt: '',
        daysRemaining: 0,
        features: [],
      };
    } catch (err) {
      console.warn('[Evolve LicenseManager] Error reading stored license:', err);
    }
    return this.getState();
  }

  /**
   * Activates a local 30-day evaluation trial without requiring private signing keys.
   * State is stored securely in hardware-encrypted SecretStorage.
   */
  public async activateLocalTrial(
    organizationName: string = 'Community Trial User',
    days: number = 30
  ): Promise<LicenseState> {
    const now = new Date();
    const expiry = new Date();
    expiry.setDate(now.getDate() + days);

    const trialData = {
      licenseId: `EM-TRIAL-${Date.now()}`,
      organization: organizationName,
      plan: 'enterprise_platinum',
      startedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
      days: days,
    };

    await this._secrets.store(TRIAL_STORAGE_KEY, JSON.stringify(trialData));

    this._state = {
      isLicensed: true,
      isTrial: true,
      plan: 'enterprise_platinum',
      organization: organizationName,
      licenseId: trialData.licenseId,
      expiresAt: expiry.toISOString(),
      daysRemaining: days,
      maxSeats: 25,
      seats: 25,
      licenseScope: 'seat',
      features: [...ALL_ENTERPRISE_FEATURES],
      rawKey: 'LOCAL_TRIAL_ACTIVE',
    };

    if (this._events) {
      this._events.emit('license.changed' as any, this._state);
    }

    return this.getState();
  }

  /**
   * Activates a new enterprise license key with optional claimant identity check.
   */
  public async activateLicense(rawKey: string, claimantEmail?: string): Promise<LicenseVerificationResult> {
    const result = LicenseValidator.verify(rawKey, claimantEmail);
    if (!result.valid || !result.payload) {
      return result;
    }

    // Save to encrypted SecretStorage and clear temporary trial
    await this._secrets.store(SECRET_STORAGE_KEY, rawKey.trim());
    try {
      await this._secrets.delete(TRIAL_STORAGE_KEY);
    } catch {}

    this._state = {
      isLicensed: true,
      isTrial: false,
      plan: result.payload.plan,
      organization: result.payload.organization,
      licenseId: result.payload.licenseId,
      expiresAt: result.payload.expiresAt,
      daysRemaining: result.daysRemaining || 0,
      maxSeats: result.payload.maxSeats,
      seats: result.payload.maxSeats,
      licenseScope: result.payload.licenseScope || (result.payload.maxSeats === -1 ? 'site' : 'seat'),
      features: result.payload.features || [],
      rawKey: rawKey.trim(),
      allowedEmailDomains: result.payload.allowedEmailDomains,
      claimantEmail: result.payload.claimantEmail || claimantEmail,
      seatId: result.payload.seatId,
      seatNumber: result.payload.seatNumber,
    };

    if (this._events) {
      this._events.emit('license.changed' as any, this._state);
    }

    return result;
  }

  /**
   * Deactivates the currently active license key or trial.
   */
  public async deactivateLicense(): Promise<void> {
    await this._secrets.delete(SECRET_STORAGE_KEY);
    try {
      await this._secrets.delete(TRIAL_STORAGE_KEY);
    } catch {}

    this._state = {
      isLicensed: false,
      isTrial: false,
      plan: 'community',
      organization: 'Community User',
      licenseId: '',
      expiresAt: '',
      daysRemaining: 0,
      features: [],
    };

    if (this._events) {
      this._events.emit('license.changed' as any, this._state);
    }
  }

  /**
   * Returns current active license state.
   */
  public getState(): LicenseState {
    return { ...this._state };
  }

  /**
   * Checks if an enterprise feature is unlocked.
   */
  public isFeatureUnlocked(feature: EnterpriseFeature): boolean {
    if (!this._state.isLicensed) return false;
    return this._state.features.includes(feature) || this._state.plan === 'enterprise_platinum';
  }

  public hasFeature(feature: EnterpriseFeature): boolean {
    return this.isFeatureUnlocked(feature);
  }
}
