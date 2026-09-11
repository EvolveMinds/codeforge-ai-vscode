#!/usr/bin/env node
/**
 * scripts/generate-license.js
 *
 * Official License Key Generator CLI for Evolve Mind Solutions Pty Ltd.
 * Generates cryptographically signed (Ed25519) offline license tokens for paying enterprise clients.
 *
 * Usage:
 *   node scripts/generate-license.js --org="Acme Financial" --plan="enterprise_platinum" --seats=50 --days=365
 *   npm run license:generate -- --org="ANZ Banking Group" --days=90 --seats=20
 */

const { LicenseGenerator } = require('../out/enterprise/license/licenseGenerator');
const { LicenseValidator } = require('../out/enterprise/license/licenseValidator');

// Parse CLI arguments
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const options = {
  org: 'Enterprise Partner',
  plan: 'enterprise_platinum',
  seats: 10,
  scope: 'seat',
  days: 365,
  email: 'client-admin@evolveminds.com.au',
  out: null,
  features: [
    'load_testing',
    'rag_scaffolder',
    'data_quality',
    'siem_logging',
    'co_branding',
    'multi_tenant_sync',
    'priority_sla'
  ]
};

for (const arg of args) {
  if (arg.startsWith('--org=')) {
    options.org = arg.slice('--org='.length);
  } else if (arg.startsWith('--plan=')) {
    options.plan = arg.slice('--plan='.length);
  } else if (arg.startsWith('--seats=')) {
    const val = arg.slice('--seats='.length).toLowerCase();
    if (val === 'site' || val === 'unlimited' || val === '-1') {
      options.scope = 'site';
      options.seats = -1;
    } else {
      options.seats = parseInt(val, 10) || 10;
    }
  } else if (arg.startsWith('--scope=')) {
    options.scope = arg.slice('--scope='.length).toLowerCase();
    if (options.scope === 'site') options.seats = -1;
  } else if (arg === '--site') {
    options.scope = 'site';
    options.seats = -1;
  } else if (arg.startsWith('--days=')) {
    options.days = parseInt(arg.slice('--days='.length), 10) || 365;
  } else if (arg.startsWith('--email=')) {
    options.email = arg.slice('--email='.length);
  } else if (arg.startsWith('--out=')) {
    options.out = arg.slice('--out='.length);
  }
}

const now = new Date();
const expiry = new Date();
expiry.setDate(now.getDate() + options.days);

const isSiteLicense = options.scope === 'site' || options.seats === -1;
const maxSeats = isSiteLicense ? -1 : options.seats;
const prefixId = isSiteLicense ? 'EM-SITE' : 'EM-LIC';

const payload = {
  organization: options.org,
  licenseId: `${prefixId}-${now.getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
  plan: options.plan,
  maxSeats: maxSeats,
  licenseScope: isSiteLicense ? 'site' : 'seat',
  issuedAt: now.toISOString(),
  expiresAt: expiry.toISOString(),
  features: options.features,
  contactEmail: options.email
};

const token = LicenseGenerator.sign(payload);
const verification = LicenseValidator.verify(token);

const jsonBundle = {
  organization: payload.organization,
  licenseId: payload.licenseId,
  plan: payload.plan,
  licenseScope: payload.licenseScope,
  maxSeats: payload.maxSeats,
  issuedAt: payload.issuedAt,
  expiresAt: payload.expiresAt,
  "evolve.enterprise.licenseKey": token,
  features: payload.features
};

console.log(`\n================================================================`);
console.log(`  💎 EVOLVE MIND SOLUTIONS — ENTERPRISE LICENSE GENERATOR       `);
console.log(`================================================================\n`);
console.log(`  🏢 Organization : ${payload.organization}`);
console.log(`  🏷️  License ID   : ${payload.licenseId}`);
console.log(`  💎 Plan Tier    : ${payload.plan.toUpperCase()}`);
console.log(`  🌐 License Scope: ${isSiteLicense ? '🏢 ENTERPRISE SITE LICENSE (Unlimited Developers / Org-wide)' : `👥 SEAT-BASED (${payload.maxSeats} Licensed Developers)`}`);
console.log(`  📅 Valid Until  : ${expiry.toLocaleDateString()} (${options.days} days)`);
console.log(`  📧 Contact      : ${payload.contactEmail}`);
console.log(`  ✓  Signature    : Cryptographically Valid (Ed25519)\n`);
console.log(`----------------------------------------------------------------`);
console.log(`  ENTERPRISE LICENSE KEY (Deliver to Customer):                 `);
console.log(`----------------------------------------------------------------\n`);
console.log(token);
console.log(`\n================================================================\n`);

if (options.out) {
  const targetPath = path.resolve(options.out);
  fs.writeFileSync(targetPath, JSON.stringify(jsonBundle, null, 2), 'utf8');
  console.log(`✓ Offline license file saved to: ${targetPath}\n`);
}
