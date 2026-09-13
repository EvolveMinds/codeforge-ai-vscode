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

  test('generates and validates an Enterprise Site License (Unlimited Seats / Org-wide)', () => {
    const siteToken = LicenseGenerator.generateSiteLicenseKey('Mega Banking Group Corp', 365);
    assert.ok(siteToken.startsWith('EM-ENT-V1.'), 'Site token should have standard EM-ENT-V1 prefix');

    const result = LicenseValidator.verify(siteToken);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.status, 'active');
    assert.strictEqual(result.payload?.organization, 'Mega Banking Group Corp');
    assert.strictEqual(result.payload?.licenseScope, 'site');
    assert.strictEqual(result.payload?.maxSeats, -1, 'Site license should have maxSeats = -1 (unlimited)');
    assert.strictEqual(result.payload?.plan, 'enterprise_platinum');
    assert.ok(result.daysRemaining! >= 364);
  });

  test('validates an enterprise license with email client line-wrapping and soft breaks', () => {
    const validToken = LicenseGenerator.generateSiteLicenseKey('Wrapped Corp', 30);
    // Simulate email client wrapping after EM-ENT- and wrapping at column boundaries
    const wrappedToken = validToken.slice(0, 7) + '\r\n' + validToken.slice(7, 80) + '\n  ' + validToken.slice(80);

    const result = LicenseValidator.verify(wrappedToken);
    assert.strictEqual(result.valid, true, 'Wrapped license must validate successfully');
    assert.strictEqual(result.payload?.organization, 'Wrapped Corp');
  });

  test('validates an enterprise license when claimant corporate email matches allowed domain', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);

    const payload: EnterpriseLicensePayload = {
      organization: 'Commonwealth Bank of Australia',
      licenseId: 'EM-LIC-CBA-001',
      plan: 'enterprise_platinum',
      maxSeats: 50,
      issuedAt: new Date().toISOString(),
      expiresAt: futureDate.toISOString(),
      features: ['load_testing', 'siem_logging'],
      contactEmail: 'sarah.jenkins@cba.com.au',
      allowedEmailDomains: ['cba.com.au', 'commbank.com.au'],
    };

    const token = LicenseGenerator.sign(payload);

    // 1. Authorized corporate email should succeed
    const validResult = LicenseValidator.verify(token, 'engineer@cba.com.au');
    assert.strictEqual(validResult.valid, true, 'Matching corporate email must validate');
    assert.strictEqual(validResult.status, 'active');

    // 2. Secondary authorized domain should also succeed
    const subDomainResult = LicenseValidator.verify(token, 'lead@commbank.com.au');
    assert.strictEqual(subDomainResult.valid, true, 'Secondary corporate domain must validate');

    // 3. Unauthorized external email (e.g. Gmail) should fail with unauthorized_domain status
    const rogueResult = LicenseValidator.verify(token, 'contractor@gmail.com');
    assert.strictEqual(rogueResult.valid, false, 'External email must be rejected');
    assert.strictEqual(rogueResult.status, 'unauthorized_domain');
    assert.ok(rogueResult.error?.includes('Corporate Domain Verification Failed'), 'Error message should clearly state domain rejection');
  });

  test('enforces domain verification using contactEmail fallback for legacy tokens', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const payload: EnterpriseLicensePayload = {
      organization: 'Westpac Banking Corp',
      licenseId: 'EM-LIC-WBC-001',
      plan: 'enterprise_standard',
      maxSeats: 10,
      issuedAt: new Date().toISOString(),
      expiresAt: futureDate.toISOString(),
      features: ['load_testing'],
      contactEmail: 'procurement@westpac.com.au',
      // No explicit allowedEmailDomains — should fallback to westpac.com.au
    };

    const token = LicenseGenerator.sign(payload);

    const matchResult = LicenseValidator.verify(token, 'dev.lead@westpac.com.au');
    assert.strictEqual(matchResult.valid, true, 'Fallback to contactEmail domain must succeed for matching email');

    const mismatchResult = LicenseValidator.verify(token, 'attacker@external.com');
    assert.strictEqual(mismatchResult.valid, false, 'Fallback must reject mismatching external domain');
    assert.strictEqual(mismatchResult.status, 'unauthorized_domain');
  });
});
