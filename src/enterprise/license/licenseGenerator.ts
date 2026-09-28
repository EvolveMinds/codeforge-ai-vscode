/**
 * enterprise/license/licenseGenerator.ts
 *
 * Official License Key Generator for Evolve Mind Solutions (Administrative & Offline Tooling).
 * Uses Ed25519 asymmetric signing to issue cryptographically unforgeable license tokens.
 * Evolve Mind Solutions Pty Ltd. All rights reserved.
 *
 * NOTE: This tool is strictly for administrative use (e.g. backend functions, offline key issuance).
 * The master signing private key is loaded from the environment (EVOLVE_MASTER_PRIVATE_KEY)
 * and must NEVER be bundled into client-side extension or desktop applications.
 */

import * as crypto from 'crypto';
import { EnterpriseLicensePayload } from './licenseTypes';

export class LicenseGenerator {
  /**
   * Generates a signed license key string for a customer payload.
   * Requires either customPrivateKey or process.env.EVOLVE_MASTER_PRIVATE_KEY.
   */
  public static sign(payload: EnterpriseLicensePayload, customPrivateKey?: string): string {
    const privKey =
      customPrivateKey ||
      process.env.EVOLVE_MASTER_PRIVATE_KEY ||
      process.env.LICENSE_SIGNING_PRIVATE_KEY;

    if (!privKey) {
      throw new Error(
        'Missing enterprise signing key: EVOLVE_MASTER_PRIVATE_KEY environment variable is required to generate signed licenses.'
      );
    }

    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64');
    const payloadBuf = Buffer.from(payloadStr, 'utf8');

    const signatureBuf = crypto.sign(null, payloadBuf, privKey);
    const signatureB64 = signatureBuf.toString('base64');

    return `EM-ENT-V1.${payloadB64}.${signatureB64}`;
  }

  /**
   * Generates a signed 30-day Enterprise Trial license token for customer pilots.
   */
  public static generateTrialKey(
    organizationName: string = 'Demo Enterprise Client',
    days: number = 30,
    customPrivateKey?: string
  ): string {
    const now = new Date();
    const expiry = new Date();
    expiry.setDate(now.getDate() + days);

    const payload: EnterpriseLicensePayload = {
      organization: organizationName,
      licenseId: `EM-TRIAL-${Date.now()}`,
      plan: 'enterprise_platinum',
      licenseScope: 'seat',
      maxSeats: 25,
      issuedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
      features: [
        'load_testing',
        'rag_scaffolder',
        'data_quality',
        'siem_logging',
        'co_branding',
        'multi_tenant_sync',
        'priority_sla',
      ],
      contactEmail: 'sales@evolveminds.com.au',
    };

    return this.sign(payload, customPrivateKey);
  }

  /**
   * Generates a signed Enterprise Site License token (organization-wide, unlimited developer seats).
   */
  public static generateSiteLicenseKey(
    organizationName: string = 'Demo Enterprise Partner',
    days: number = 365,
    customPrivateKey?: string
  ): string {
    const now = new Date();
    const expiry = new Date();
    expiry.setDate(now.getDate() + days);

    const payload: EnterpriseLicensePayload = {
      organization: organizationName,
      licenseId: `EM-SITE-${Date.now()}`,
      plan: 'enterprise_platinum',
      licenseScope: 'site',
      maxSeats: -1, // -1 denotes unlimited seats
      issuedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
      features: [
        'load_testing',
        'rag_scaffolder',
        'data_quality',
        'siem_logging',
        'co_branding',
        'multi_tenant_sync',
        'priority_sla',
      ],
      contactEmail: 'sales@evolveminds.com.au',
    };

    return this.sign(payload, customPrivateKey);
  }
}
