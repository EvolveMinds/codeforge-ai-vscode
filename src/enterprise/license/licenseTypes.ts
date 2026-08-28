/**
 * enterprise/license/licenseTypes.ts
 *
 * Type definitions and data contracts for Evolve AI Enterprise Edition licensing.
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

export type LicensePlan = 'community' | 'pro' | 'enterprise_standard' | 'enterprise_platinum';

export type EnterpriseFeature =
  | 'load_testing'
  | 'rag_scaffolder'
  | 'data_quality'
  | 'siem_logging'
  | 'co_branding'
  | 'multi_tenant_sync'
  | 'priority_sla';

export interface EnterpriseLicensePayload {
  /** Customer or organization name (e.g. "Acme Financial Services") */
  organization: string;
  /** Unique license serial ID (e.g. "EM-LIC-2026-9481A") */
  licenseId: string;
  /** License tier */
  plan: LicensePlan;
  /** Maximum licensed developer seats */
  maxSeats: number;
  /** ISO 8601 issuance timestamp */
  issuedAt: string;
  /** ISO 8601 expiry timestamp */
  expiresAt: string;
  /** Explicit list of enabled enterprise features */
  features: EnterpriseFeature[];
  /** Optional customer support contact email */
  contactEmail?: string;
}

export interface LicenseVerificationResult {
  valid: boolean;
  isExpired: boolean;
  status: 'active' | 'expired' | 'invalid_signature' | 'malformed' | 'unlicensed';
  payload?: EnterpriseLicensePayload;
  error?: string;
  daysRemaining?: number;
}

export interface LicenseState {
  isLicensed: boolean;
  plan: LicensePlan;
  organization: string;
  licenseId: string;
  expiresAt: string;
  daysRemaining: number;
  features: EnterpriseFeature[];
  rawKey?: string;
}
