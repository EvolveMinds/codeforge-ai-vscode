/**
 * test/suite/enterprise/license.test.ts
 *
 * Unit tests for Ed25519 Cryptographic License Verification and LicenseManager.
 * Tests offline asymmetric signing, tampering detection, email domain restrictions,
 * and zero-secret local evaluation trials.
 * Evolve Mind Solutions Pty Ltd.
 */

import * as assert from 'assert';
import * as crypto from 'crypto';
import { LicenseValidator } from '../../../enterprise/license/licenseValidator';
import { LicenseGenerator } from '../../../enterprise/license/licenseGenerator';
import { LicenseManager } from '../../../enterprise/license/licenseManager';
import { EnterpriseLicensePayload } from '../../../enterprise/license/licenseTypes';

suite('Enterprise Suite — Cryptographic License Engine (Ed25519)', () => {
  let testPrivKey: string;
  let testPubKey: string;

  suiteSetup(() => {
    // Generate an ephemeral Ed25519 keypair for self-contained test verification
    const pair = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    testPrivKey = pair.privateKey;
    testPubKey = pair.publicKey;
  });

  test('generates and validates a valid active enterprise license using asymmetric Ed25519', () => {
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

    const token = LicenseGenerator.sign(payload, testPrivKey);
    assert.ok(token.startsWith('EM-ENT-V1.'), 'Token should have standard prefix');

    const result = LicenseValidator.verify(token, undefined, testPubKey);
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

    const token = LicenseGenerator.sign(payload, testPrivKey);
    const result = LicenseValidator.verify(token, undefined, testPubKey);

    assert.strictEqual(result.valid, false, 'Expired license must not be valid');
    assert.strictEqual(result.status, 'expired');
    assert.strictEqual(result.isExpired, true);
    assert.strictEqual(result.daysRemaining, 0);
  });

  test('rejects tampered or forged payload strings', () => {
    const validToken = LicenseGenerator.generateTrialKey('Original Corp', 30, testPrivKey);
    const parts = validToken.split('.');

    // Tamper with payload
    const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    decoded.organization = 'Hacked Corp';
    decoded.maxSeats = 9999;
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded)).toString('base64');

    const forgedToken = `EM-ENT-V1.${tamperedPayloadB64}.${parts[2]}`;
    const result = LicenseValidator.verify(forgedToken, undefined, testPubKey);

    assert.strictEqual(result.valid, false, 'Tampered token must fail signature check');
    assert.strictEqual(result.status, 'invalid_signature');
  });

  test('rejects token signed with an unknown or forged key against master public key', () => {
    // Generate an untrusted rouge keypair
    const rogue = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const payload: EnterpriseLicensePayload = {
      organization: 'Attacker Corp',
      licenseId: 'EM-FORGED-001',
      plan: 'enterprise_platinum',
      maxSeats: 999,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 365).toISOString(),
      features: ['load_testing', 'rag_scaffolder'],
    };
    const forgedToken = LicenseGenerator.sign(payload, rogue.privateKey);

    // Verify against default master public key without custom pubkey — must fail
    const result = LicenseValidator.verify(forgedToken);
    assert.strictEqual(result.valid, false);
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
    const siteToken = LicenseGenerator.generateSiteLicenseKey('Mega Banking Group Corp', 365, testPrivKey);
    assert.ok(siteToken.startsWith('EM-ENT-V1.'), 'Site token should have standard EM-ENT-V1 prefix');

    const result = LicenseValidator.verify(siteToken, undefined, testPubKey);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.status, 'active');
    assert.strictEqual(result.payload?.organization, 'Mega Banking Group Corp');
    assert.strictEqual(result.payload?.licenseScope, 'site');
    assert.strictEqual(result.payload?.maxSeats, -1, 'Site license should have maxSeats = -1 (unlimited)');
    assert.strictEqual(result.payload?.plan, 'enterprise_platinum');
    assert.ok(result.daysRemaining! >= 364);
  });

  test('validates an enterprise license with email client line-wrapping and soft breaks', () => {
    const validToken = LicenseGenerator.generateSiteLicenseKey('Wrapped Corp', 30, testPrivKey);
    // Simulate email client wrapping after EM-ENT- and wrapping at column boundaries
    const wrappedToken = validToken.slice(0, 7) + '\r\n' + validToken.slice(7, 80) + '\n  ' + validToken.slice(80);

    const result = LicenseValidator.verify(wrappedToken, undefined, testPubKey);
    assert.strictEqual(result.valid, true, 'Wrapped license must validate successfully');
    assert.strictEqual(result.payload?.organization, 'Wrapped Corp');
  });

  test('validates an enterprise license when claimant corporate email matches allowed domain', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);

    const payload: EnterpriseLicensePayload = {
      organization: 'Acme Financial Corporation',
      licenseId: 'EM-LIC-ACME-001',
      plan: 'enterprise_platinum',
      maxSeats: 50,
      issuedAt: new Date().toISOString(),
      expiresAt: futureDate.toISOString(),
      features: ['load_testing', 'siem_logging'],
      contactEmail: 'admin@acme-financial.example.com',
      allowedEmailDomains: ['acme-financial.example.com', 'acme-corp.example.com'],
    };

    const token = LicenseGenerator.sign(payload, testPrivKey);

    // 1. Authorized corporate email should succeed
    const validResult = LicenseValidator.verify(token, 'engineer@acme-financial.example.com', testPubKey);
    assert.strictEqual(validResult.valid, true, 'Matching corporate email must validate');
    assert.strictEqual(validResult.status, 'active');

    // 2. Secondary authorized domain should also succeed
    const subDomainResult = LicenseValidator.verify(token, 'lead@acme-corp.example.com', testPubKey);
    assert.strictEqual(subDomainResult.valid, true, 'Secondary corporate domain must validate');

    // 3. Unauthorized external email (e.g. Gmail) should fail with unauthorized_domain status
    const rogueResult = LicenseValidator.verify(token, 'contractor@gmail.com', testPubKey);
    assert.strictEqual(rogueResult.valid, false, 'External email must be rejected');
    assert.strictEqual(rogueResult.status, 'unauthorized_domain');
    assert.ok(rogueResult.error?.includes('Corporate Domain Verification Failed'), 'Error message should clearly state domain rejection');
  });

  test('enforces domain verification using contactEmail fallback for legacy tokens', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const payload: EnterpriseLicensePayload = {
      organization: 'Pacific Enterprise Holdings',
      licenseId: 'EM-LIC-PEH-001',
      plan: 'enterprise_standard',
      maxSeats: 10,
      issuedAt: new Date().toISOString(),
      expiresAt: futureDate.toISOString(),
      features: ['load_testing'],
      contactEmail: 'procurement@pacific-holdings.example.com',
    };

    const token = LicenseGenerator.sign(payload, testPrivKey);

    const matchResult = LicenseValidator.verify(token, 'dev.lead@pacific-holdings.example.com', testPubKey);
    assert.strictEqual(matchResult.valid, true, 'Fallback to contactEmail domain must succeed for matching email');

    const mismatchResult = LicenseValidator.verify(token, 'attacker@external.com', testPubKey);
    assert.strictEqual(mismatchResult.valid, false, 'Fallback must reject mismatching external domain');
    assert.strictEqual(mismatchResult.status, 'unauthorized_domain');
  });

  test('validates unique per-seat key for bound claimant and rejects other corporate colleagues', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const alicePayload: EnterpriseLicensePayload = {
      organization: 'Evolve Mind Solutions',
      licenseId: 'EM-LIC-2026-56K3WI',
      seatId: 'SEAT-01/25',
      seatNumber: 1,
      claimantEmail: 'alice@evolveminds.com.au',
      plan: 'enterprise_platinum',
      maxSeats: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: futureDate.toISOString(),
      features: ['load_testing', 'siem_logging'],
      allowedEmailDomains: ['evolveminds.com.au'],
    };

    const aliceToken = LicenseGenerator.sign(alicePayload, testPrivKey);

    // 1. Alice verifies with her own email — must succeed
    const aliceResult = LicenseValidator.verify(aliceToken, 'alice@evolveminds.com.au', testPubKey);
    assert.strictEqual(aliceResult.valid, true, 'Alice must successfully validate her own unique seat key');
    assert.strictEqual(aliceResult.status, 'active');
    assert.strictEqual(aliceResult.payload?.seatId, 'SEAT-01/25');
    assert.strictEqual(aliceResult.payload?.claimantEmail, 'alice@evolveminds.com.au');

    // 2. Bob (even with corporate email) tries to use Alice's key — must fail with unauthorized_claimant
    const bobResult = LicenseValidator.verify(aliceToken, 'bob@evolveminds.com.au', testPubKey);
    assert.strictEqual(bobResult.valid, false, 'Bob must be rejected from using Alice unique seat key');
    assert.strictEqual(bobResult.status, 'unauthorized_claimant');
    assert.ok(bobResult.error?.includes('Seat Identity Mismatch'), 'Error message must state seat identity mismatch');
  });

  test('LicenseManager activates zero-secret local evaluation trial and unlocks enterprise features', async () => {
    const storageMap = new Map<string, string>();
    const mockSecrets: any = {
      get: async (k: string) => storageMap.get(k),
      store: async (k: string, v: string) => storageMap.set(k, v),
      delete: async (k: string) => storageMap.delete(k),
    };

    const mgr = new LicenseManager(mockSecrets);
    await mgr.initialize();
    assert.strictEqual(mgr.getState().isLicensed, false, 'Initial state must be unlicensed community');
    assert.strictEqual(mgr.isFeatureUnlocked('load_testing'), false);

    // Activate local evaluation trial
    const trialState = await mgr.activateLocalTrial('Acme Test Org', 30);
    assert.strictEqual(trialState.isLicensed, true);
    assert.strictEqual(trialState.isTrial, true);
    assert.strictEqual(trialState.plan, 'enterprise_platinum');
    assert.strictEqual(trialState.daysRemaining, 30);
    assert.strictEqual(mgr.isFeatureUnlocked('load_testing'), true, 'Features must unlock during trial');
    assert.strictEqual(mgr.isFeatureUnlocked('rag_scaffolder'), true);

    // Re-initialize from storage to simulate app restart
    const restartedMgr = new LicenseManager(mockSecrets);
    const restoredState = await restartedMgr.initialize();
    assert.strictEqual(restoredState.isLicensed, true, 'Restored trial must be licensed');
    assert.strictEqual(restoredState.isTrial, true);
    assert.strictEqual(restoredState.daysRemaining, 30);

    // Deactivate trial
    await restartedMgr.deactivateLicense();
    assert.strictEqual(restartedMgr.getState().isLicensed, false);
    assert.strictEqual(restartedMgr.isFeatureUnlocked('load_testing'), false);
  });
});
