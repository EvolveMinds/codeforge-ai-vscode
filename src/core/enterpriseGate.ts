/**
 * core/enterpriseGate.ts — the one door between the free extension and the paid modules.
 *
 * The Community package on the Marketplace does not contain the Enterprise
 * generators at all: `.vscodeignore` drops `out/enterprise/**` (everything
 * except the licence checker) and `out/desktop/**`. Only the Enterprise package
 * built by `scripts/package-enterprise.js` ships them.
 *
 * That makes two separate questions, and every paid feature must ask both:
 *
 *   1. INSTALLED — is the Enterprise code in this package? It is loaded with a
 *      guarded `require`, never a static import, so the Community build still
 *      activates when the files are absent.
 *   2. LICENSED — does the active licence or trial cover this capability?
 *      Answered by `LicenseManager`, which verifies the Ed25519 signature.
 *
 * Callers get the modules back only when both answers are yes. Checking the
 * licence only in the webview, after the files are already written, is what
 * this module exists to replace.
 */

import type { LicenseManager } from '../enterprise/license/licenseManager';
import type { EnterpriseFeature } from '../enterprise/license/licenseTypes';

export type EnterpriseModules = typeof import('../enterprise');

/**
 * Every paid capability the extension can invoke.
 *
 * Only four of them have their own licence flag. The rest predate per-feature
 * flags, so they need a valid licence of any plan. Adding new flags here would
 * lock out customers whose already-issued keys do not list them.
 */
export type PaidCapability =
  | 'load_testing'
  | 'rag_scaffolder'
  | 'data_quality'
  | 'siem_logging'
  | 'private_serving'
  | 'sql_transpiler'
  | 'pii_masking'
  | 'reverse_etl'
  | 'rls_policies'
  | 'synthetic_data'
  | 'mock_server';

const REQUIRED_FLAG: Record<PaidCapability, EnterpriseFeature | null> = {
  load_testing:    'load_testing',
  rag_scaffolder:  'rag_scaffolder',
  data_quality:    'data_quality',
  siem_logging:    'siem_logging',
  private_serving: null,
  sql_transpiler:  null,
  pii_masking:     null,
  reverse_etl:     null,
  rls_policies:    null,
  synthetic_data:  null,
  mock_server:     null,
};

export type EnterpriseAccess =
  | { ok: true; modules: EnterpriseModules }
  | { ok: false; reason: 'not_installed' | 'unlicensed' };

let _cached: EnterpriseModules | null | undefined;

/** The Enterprise barrel, or `null` when this is the Community package. */
export function loadEnterpriseModules(): EnterpriseModules | null {
  if (_cached !== undefined) return _cached;
  try {
    _cached = require('../enterprise') as EnterpriseModules;
  } catch {
    _cached = null;
  }
  return _cached;
}

export function isEnterpriseInstalled(): boolean {
  return loadEnterpriseModules() !== null;
}

export function checkEnterpriseAccess(
  license: Pick<LicenseManager, 'getState' | 'isFeatureUnlocked'> | undefined,
  capability: PaidCapability,
): EnterpriseAccess {
  const modules = loadEnterpriseModules();
  if (!modules) return { ok: false, reason: 'not_installed' };
  if (!license) return { ok: false, reason: 'unlicensed' };

  const flag = REQUIRED_FLAG[capability];
  const allowed = flag ? license.isFeatureUnlocked(flag) : license.getState().isLicensed;
  return allowed ? { ok: true, modules } : { ok: false, reason: 'unlicensed' };
}

/** Test hook: forget the cached load result. */
export function _resetEnterpriseCache(): void {
  _cached = undefined;
}
