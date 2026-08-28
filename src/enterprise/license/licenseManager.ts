/**
 * enterprise/license/licenseManager.ts
 *
 * Enterprise License State Manager.
 * Handles encrypted key storage (vscode.SecretStorage), validation, and feature gating.
 * Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

import * as vscode from 'vscode';
import { LicenseValidator } from './licenseValidator';
import { LicenseState, LicenseVerificationResult, EnterpriseFeature } from './licenseTypes';
import type { EventBus } from '../../core/eventBus';

const SECRET_STORAGE_KEY = 'evolve.enterprise.licenseKey';

export class LicenseManager {
  private _state: LicenseState = {
    isLicensed: false,
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
   */
  public async initialize(): Promise<LicenseState> {
    try {
      const storedKey = await this._secrets.get(SECRET_STORAGE_KEY);
      if (storedKey) {
        const result = LicenseValidator.verify(storedKey);
        if (result.valid && result.payload) {
          this._state = {
            isLicensed: true,
            plan: result.payload.plan,
            organization: result.payload.organization,
            licenseId: result.payload.licenseId,
            expiresAt: result.payload.expiresAt,
            daysRemaining: result.daysRemaining || 0,
            features: result.payload.features || [],
            rawKey: storedKey,
          };
        } else {
          // Stored key is invalid or expired
          this._state.isLicensed = false;
        }
      }
    } catch (err) {
      console.warn('[Evolve LicenseManager] Error reading stored license:', err);
    }
    return this.getState();
  }

  /**
   * Activates a new enterprise license key.
   */
  public async activateLicense(rawKey: string): Promise<LicenseVerificationResult> {
    const result = LicenseValidator.verify(rawKey);
    if (!result.valid || !result.payload) {
      return result;
    }

    // Save to encrypted SecretStorage
    await this._secrets.store(SECRET_STORAGE_KEY, rawKey.trim());

    this._state = {
      isLicensed: true,
      plan: result.payload.plan,
      organization: result.payload.organization,
      licenseId: result.payload.licenseId,
      expiresAt: result.payload.expiresAt,
      daysRemaining: result.daysRemaining || 0,
      features: result.payload.features || [],
      rawKey: rawKey.trim(),
    };

    if (this._events) {
      this._events.emit('license.changed' as any, this._state);
    }

    return result;
  }

  /**
   * Deactivates the currently active license key.
   */
  public async deactivateLicense(): Promise<void> {
    await this._secrets.delete(SECRET_STORAGE_KEY);
    this._state = {
      isLicensed: false,
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
}
