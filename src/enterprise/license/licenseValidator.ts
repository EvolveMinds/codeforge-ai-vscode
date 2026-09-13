/**
 * enterprise/license/licenseValidator.ts
 *
 * 100% Offline Cryptographic License Validator (Ed25519 Asymmetric Verification)
 * Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

import * as crypto from 'crypto';
import { EnterpriseLicensePayload, LicenseVerificationResult, EnterpriseFeature } from './licenseTypes';

/**
 * Official Evolve Mind Solutions Master Public Key (Ed25519)
 */
const EVOLVE_MASTER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+knvPt16q6Y8c+M1YCWiQ/CQp3b0Bv6ILowxZnDl4DM=
-----END PUBLIC KEY-----`;

export class LicenseValidator {
  private static readonly TOKEN_PREFIX = 'EM-ENT-V1.';

  /**
   * Cryptographically verifies an offline license key string.
   */
  public static verify(rawKey: string, customPublicKey?: string): LicenseVerificationResult {
    if (!rawKey || typeof rawKey !== 'string') {
      return {
        valid: false,
        isExpired: false,
        status: 'unlicensed',
        error: 'No license key provided.',
      };
    }

    const trimmed = (rawKey || '').replace(/[\r\n\s\t]+/g, '').trim();
    if (!trimmed.startsWith(this.TOKEN_PREFIX)) {
      return {
        valid: false,
        isExpired: false,
        status: 'malformed',
        error: 'Invalid license format. Expected "EM-ENT-V1.<payload>.<signature>".',
      };
    }

    const parts = trimmed.slice(this.TOKEN_PREFIX.length).split('.');
    if (parts.length !== 2) {
      return {
        valid: false,
        isExpired: false,
        status: 'malformed',
        error: 'Malformed license token structure.',
      };
    }

    const [payloadB64, signatureB64] = parts;

    try {
      let payloadStr = '';
      try {
        payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
      } catch {
        const cleaned = payloadB64.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
        const padded = cleaned.padEnd(cleaned.length + (4 - (cleaned.length % 4)) % 4, '=');
        payloadStr = Buffer.from(padded, 'base64').toString('utf8');
      }
      const payload: EnterpriseLicensePayload = JSON.parse(payloadStr);

      // Verify cryptographic signature against Master Public Key
      const pubKey = customPublicKey || EVOLVE_MASTER_PUBLIC_KEY;
      const cleanSig = signatureB64.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
      const paddedSig = cleanSig.padEnd(cleanSig.length + (4 - (cleanSig.length % 4)) % 4, '=');
      const signatureBuf = Buffer.from(paddedSig, 'base64');
      const payloadBuf = Buffer.from(payloadStr, 'utf8');

      const isSignatureValid = crypto.verify(null, payloadBuf, pubKey, signatureBuf);
      if (!isSignatureValid) {
        return {
          valid: false,
          isExpired: false,
          status: 'invalid_signature',
          error: 'Cryptographic signature verification failed. Token has been modified or forged.',
        };
      }

      // Check Expiration
      const now = new Date();
      const expiresAt = new Date(payload.expiresAt);
      const isExpired = now > expiresAt;
      const diffMs = expiresAt.getTime() - now.getTime();
      const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

      if (isExpired) {
        return {
          valid: false,
          isExpired: true,
          status: 'expired',
          payload: payload,
          daysRemaining: 0,
          error: `License expired on ${expiresAt.toLocaleDateString()}. Please renew at https://www.evolveminds.com.au/`,
        };
      }

      return {
        valid: true,
        isExpired: false,
        status: 'active',
        payload: payload,
        daysRemaining: daysRemaining,
      };
    } catch (err: any) {
      return {
        valid: false,
        isExpired: false,
        status: 'malformed',
        error: `Failed to decode license payload: ${err.message || err}`,
      };
    }
  }

  /**
   * Helper to check if a specific feature is entitled under the active license.
   */
  public static hasFeature(payload: EnterpriseLicensePayload | undefined, feature: EnterpriseFeature): boolean {
    if (!payload || !payload.features) return false;
    return payload.features.includes(feature) || payload.plan === 'enterprise_platinum';
  }
}
