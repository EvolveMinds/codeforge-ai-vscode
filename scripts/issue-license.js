/**
 * scripts/issue-license.js
 * 
 * Official Enterprise License Key Generator CLI for Evolve Mind Solutions.
 * Usage:
 *   node scripts/issue-license.js --org "Client Name" --plan enterprise_platinum --days 365 --seats 50
 *   node scripts/issue-license.js --out license.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EVOLVE_MASTER_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINYvrTn35C3FQ0Y8oQbuQz8QIY3yIjhluUNE9L4Kh1HD
-----END PRIVATE KEY-----`;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    org: 'Evolve Minds Enterprise Client',
    plan: 'enterprise_platinum',
    days: 365,
    seats: 25,
    scope: 'seat',
    email: 'admin@evolveminds.com.au',
    out: null
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--org=')) options.org = a.slice('--org='.length);
    else if (a === '--org' && args[i + 1]) options.org = args[++i];
    else if (a.startsWith('--plan=')) options.plan = a.slice('--plan='.length);
    else if (a === '--plan' && args[i + 1]) options.plan = args[++i];
    else if (a.startsWith('--days=')) options.days = parseInt(a.slice('--days='.length), 10);
    else if (a === '--days' && args[i + 1]) options.days = parseInt(args[++i], 10);
    else if (a.startsWith('--seats=')) {
      const s = a.slice('--seats='.length).toLowerCase();
      if (s === 'site' || s === 'unlimited' || s === '-1') {
        options.scope = 'site';
        options.seats = -1;
      } else {
        options.seats = parseInt(s, 10);
      }
    }
    else if (a === '--seats' && args[i + 1]) {
      const s = args[++i].toLowerCase();
      if (s === 'site' || s === 'unlimited' || s === '-1') {
        options.scope = 'site';
        options.seats = -1;
      } else {
        options.seats = parseInt(s, 10);
      }
    }
    else if (a.startsWith('--scope=')) {
      options.scope = a.slice('--scope='.length).toLowerCase();
      if (options.scope === 'site') options.seats = -1;
    }
    else if (a === '--scope' && args[i + 1]) {
      options.scope = args[++i].toLowerCase();
      if (options.scope === 'site') options.seats = -1;
    }
    else if (a === '--site') {
      options.scope = 'site';
      options.seats = -1;
    }
    else if (a.startsWith('--email=')) options.email = a.slice('--email='.length);
    else if (a === '--email' && args[i + 1]) options.email = args[++i];
    else if (a.startsWith('--out=')) options.out = a.slice('--out='.length);
    else if (a === '--out' && args[i + 1]) options.out = args[++i];
  }
  return options;
}

function issueLicense(options) {
  const now = new Date();
  const expiry = new Date();
  expiry.setDate(now.getDate() + options.days);

  const isSiteLicense = options.scope === 'site' || options.seats === -1;
  const maxSeats = isSiteLicense ? -1 : options.seats;
  const prefixId = isSiteLicense ? 'EM-SITE' : 'EM-LIC';

  const payload = {
    organization: options.org,
    licenseId: `${prefixId}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    plan: options.plan,
    maxSeats: maxSeats,
    licenseScope: isSiteLicense ? 'site' : 'seat',
    issuedAt: now.toISOString(),
    expiresAt: expiry.toISOString(),
    features: [
      'load_testing',
      'rag_scaffolder',
      'data_quality',
      'siem_logging',
      'co_branding',
      'multi_tenant_sync',
      'priority_sla'
    ],
    contactEmail: options.email
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64');
  const signatureBuf = crypto.sign(null, Buffer.from(payloadStr, 'utf8'), EVOLVE_MASTER_PRIVATE_KEY);
  const signatureB64 = signatureBuf.toString('base64');

  const token = `EM-ENT-V1.${payloadB64}.${signatureB64}`;

  const jsonBundle = {
    organization: options.org,
    licenseId: payload.licenseId,
    plan: options.plan,
    licenseScope: payload.licenseScope,
    maxSeats: payload.maxSeats,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    "evolve.enterprise.licenseKey": token,
    signature: signatureB64
  };

  return { token, jsonBundle, payload, isSiteLicense };
}

const opts = parseArgs();
const { token, jsonBundle, payload, isSiteLicense } = issueLicense(opts);

console.log('\n================================================================');
console.log('   EVOLVE AI ENTERPRISE LICENSE GENERATOR');
console.log('================================================================');
console.log(`Organization : ${payload.organization}`);
console.log(`Plan         : ${payload.plan}`);
console.log(`Scope        : ${isSiteLicense ? '🏢 ENTERPRISE SITE LICENSE (Unlimited Developers / Org-wide)' : `👥 SEAT-BASED (${payload.maxSeats} Licensed Developers)`}`);
console.log(`Issued At    : ${payload.issuedAt}`);
console.log(`Expires At   : ${payload.expiresAt} (${opts.days} days)`);
console.log('----------------------------------------------------------------');
console.log('LICENSE KEY (Copy and paste into Evolve AI):');
console.log('----------------------------------------------------------------');
console.log(token);
console.log('----------------------------------------------------------------\n');

if (opts.out) {
  const targetPath = path.resolve(opts.out);
  fs.writeFileSync(targetPath, JSON.stringify(jsonBundle, null, 2), 'utf8');
  console.log(`License file saved to: ${targetPath}\n`);
}
