/**
 * enterprise/license/licenseGenerator.ts
 *
 * Official License Key Generator for Evolve Mind Solutions.
 * Uses Ed25519 asymmetric signing to issue cryptographically unforgeable license tokens.
 * Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

import * as crypto from 'crypto';
import { EnterpriseLicensePayload } from './licenseTypes';

export const EVOLVE_MASTER_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINYvrTn35C3FQ0Y8oQbuQz8QIY3yIjhluUNE9L4Kh1HD
-----END PRIVATE KEY-----`;

export class LicenseGenerator {
  /**
   * Generates a signed license key string for a customer payload.
   */
  public static sign(payload: EnterpriseLicensePayload, customPrivateKey?: string): string {
    const payloadStr = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64');

    const privKey = customPrivateKey || EVOLVE_MASTER_PRIVATE_KEY;
    const payloadBuf = Buffer.from(payloadStr, 'utf8');

    const signatureBuf = crypto.sign(null, payloadBuf, privKey);
    const signatureB64 = signatureBuf.toString('base64');

    return `EM-ENT-V1.${payloadB64}.${signatureB64}`;
  }

  /**
   * Generates a 30-day Enterprise Trial license for testing and demonstrations.
   */
  public static generateTrialKey(organizationName: string = 'Demo Enterprise Client', days: number = 30): string {
    const now = new Date();
    const expiry = new Date();
    expiry.setDate(now.getDate() + days);

    const payload: EnterpriseLicensePayload = {
      organization: organizationName,
      licenseId: `EM-TRIAL-${Date.now()}`,
      plan: 'enterprise_platinum',
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

    return this.sign(payload);
  }
}
