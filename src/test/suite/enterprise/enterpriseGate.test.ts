/**
 * test/suite/enterprise/enterpriseGate.test.ts
 *
 * The Community/Enterprise boundary: a paid capability runs only when its code
 * is installed AND the active licence covers it.
 */

import * as assert from 'assert';
import { checkEnterpriseAccess, PaidCapability, _resetEnterpriseCache } from '../../../core/enterpriseGate';
import type { EnterpriseFeature, LicenseState } from '../../../enterprise/license/licenseTypes';

function fakeLicense(state: Partial<LicenseState>) {
  const full = { isLicensed: false, plan: 'community', features: [] as EnterpriseFeature[], ...state } as LicenseState;
  return {
    getState: () => full,
    isFeatureUnlocked: (f: EnterpriseFeature) =>
      full.isLicensed && (full.features.includes(f) || full.plan === 'enterprise_platinum'),
  };
}

suite('Enterprise Gate — Community vs Enterprise boundary', () => {
  setup(() => _resetEnterpriseCache());

  test('no licence manager → unlicensed, never unlocked by default', () => {
    const res = checkEnterpriseAccess(undefined, 'load_testing');
    assert.deepStrictEqual(res, { ok: false, reason: 'unlicensed' });
  });

  test('community state → every paid capability is refused', () => {
    const lic = fakeLicense({ isLicensed: false });
    const all: PaidCapability[] = [
      'load_testing', 'rag_scaffolder', 'data_quality', 'siem_logging', 'private_serving',
      'sql_transpiler', 'pii_masking', 'reverse_etl', 'rls_policies', 'synthetic_data', 'mock_server',
    ];
    for (const cap of all) {
      const res = checkEnterpriseAccess(lic, cap);
      assert.strictEqual(res.ok, false, `${cap} must be refused without a licence`);
    }
  });

  test('flagged capability needs its own flag on a non-platinum plan', () => {
    const lic = fakeLicense({ isLicensed: true, plan: 'enterprise_standard', features: ['rag_scaffolder'] });
    assert.strictEqual(checkEnterpriseAccess(lic, 'rag_scaffolder').ok, true);
    assert.strictEqual(checkEnterpriseAccess(lic, 'load_testing').ok, false);
  });

  test('unflagged capability needs any valid licence', () => {
    const lic = fakeLicense({ isLicensed: true, plan: 'enterprise_standard', features: [] });
    assert.strictEqual(checkEnterpriseAccess(lic, 'sql_transpiler').ok, true);
  });

  test('platinum unlocks flagged capabilities and returns the modules', () => {
    const lic = fakeLicense({ isLicensed: true, plan: 'enterprise_platinum', features: [] });
    const res = checkEnterpriseAccess(lic, 'data_quality');
    assert.strictEqual(res.ok, true);
    if (res.ok) assert.strictEqual(typeof res.modules.DataQualityGenerator.generateQualityPackage, 'function');
  });
});
