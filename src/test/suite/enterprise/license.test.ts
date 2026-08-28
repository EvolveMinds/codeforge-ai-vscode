/**
 * test/suite/enterprise/license.test.ts
 *
 * Unit tests for Ed25519 Cryptographic License Verification and LicenseManager.
 * Evolve Mind Solutions Pty Ltd.
 */

import * as assert from 'assert';
import { LicenseValidator } from '../../../enterprise/license/licenseValidator';
import { LicenseGenerator, EVOLVE_MASTER_PRIVATE_KEY } from '../../../enterprise/license/licenseGenerator';
import { EnterpriseLicensePayload } from '../../../enterprise/license/licenseTypes';

suite('Enterprise Suite — Cryptographic License Engine (Ed25519)', () => {

  test('generates and validates a valid active enterprise license', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 90);

    const payload: EnterpriseLicensePayload = {
      organization: 'Global Bank Corp',
      licenseId: 'EM-LIC-TEST-001',
      plan: 'enterprise_platinum',
      maxSeats: 50,
      issuedAt: new Date().toISOString(),
      expiresAt: futureDate.toISOString(),
      features: ['load_testing', 'rag_scaffolder', 'data_quality', 'siem_logging'],
    };

    const token = LicenseGenerator.sign(payload);
    assert.ok(token.startsWith('EM-ENT-V1.'), 'Token should have standard prefix');

    const result = LicenseValidator.verify(token);
    assert.strictEqual(result.valid, true, 'License should be valid');
    assert.strictEqual(result.status, 'active');
    assert.strictEqual(result.payload?.organization, 'Global Bank Corp');
    assert.strictEqual(result.payload?.plan, 'enterprise_platinum');
    assert.strictEqual(result.payload?.maxSeats, 50);
    assert.ok(result.daysRemaining! >= 89, 'Days remaining should be calculated accurately');
  });

  test('rejects an expired enterprise license', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    const payload: EnterpriseLicensePayload = {
      organization: 'Expired Corp',
      licenseId: 'EM-LIC-EXPIRED-001',
      plan: 'enterprise_standard',
      maxSeats: 10,
      issuedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
      expiresAt: pastDate.toISOString(),
      features: ['load_testing'],
    };

    const token = LicenseGenerator.sign(payload);
    const result = LicenseValidator.verify(token);

    assert.strictEqual(result.valid, false, 'Expired license must not be valid');
    assert.strictEqual(result.status, 'expired');
    assert.strictEqual(result.isExpired, true);
    assert.strictEqual(result.daysRemaining, 0);
  });

  test('rejects tampered or forged payload strings', () => {
    const validToken = LicenseGenerator.generateTrialKey('Original Corp', 30);
    const parts = validToken.split('.');

    // Tamper with payload
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    decoded.organization = 'Hacked Corp';
    decoded.maxSeats = 9999;
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded)).toString('base64');

    const forgedToken = `EM-ENT-V1.${tamperedPayloadB64}.${parts[2]}`;
    const result = LicenseValidator.verify(forgedToken);

    assert.strictEqual(result.valid, false, 'Tampered token must fail signature check');
    assert.strictEqual(result.status, 'invalid_signature');
  });

  test('correctly evaluates feature flags via hasFeature', () => {
    const payload: EnterpriseLicensePayload = {
      organization: 'FinTech Pro',
      licenseId: 'EM-PRO-001',
      plan: 'pro',
      maxSeats: 5,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      features: ['load_testing'],
    };

    assert.strictEqual(LicenseValidator.hasFeature(payload, 'load_testing'), true);
    assert.strictEqual(LicenseValidator.hasFeature(payload, 'rag_scaffolder'), false);
  });
});
