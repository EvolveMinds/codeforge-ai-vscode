/**
 * enterprise/license/licenseManager.ts
 *
 * Enterprise License State Manager.
 * Handles encrypted key storage (vscode.SecretStorage), validation, and feature gating.
 * Every licence, including a 30-day evaluation trial, is an Ed25519-signed key issued by
 * Evolve Mind Solutions. Nothing here can grant a trial locally; a trial is requested by
 * email and arrives as a key whose licenseId starts with EM-TRIAL-.
 * Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

import * as vscode from 'vscode';
import { LicenseValidator } from './licenseValidator';
import { LicenseState, LicenseVerificationResult, EnterpriseFeature } from './licenseTypes';
import type { EventBus } from '../../core/eventBus';

const SECRET_STORAGE_KEY = 'evolve.enterprise.licenseKey';
const TRIAL_STORAGE_KEY = 'evolve.enterprise.trialInfo';

/** Trial keys are ordinary signed licences whose id marks them as a trial. */
export function isTrialLicence(licenseId?: string): boolean {
  return !!licenseId && licenseId.startsWith('EM-TRIAL-');
}

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
            isTrial: isTrialLicence(result.payload.licenseId),
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

      // 2. Trials are signed keys issued by Evolve Mind Solutions, handled above like any
      //    other licence. Older versions stored a self-activated trial here; it is not
      //    honoured any more, so remove it.
      try {
        await this._secrets.delete(TRIAL_STORAGE_KEY);
      } catch {}

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
      isTrial: isTrialLicence(result.payload.licenseId),
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
