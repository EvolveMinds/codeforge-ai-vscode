#!/usr/bin/env node
/**
 * scripts/create-offline-patch.js — Build an official offline hot patch (.zip) bundle.
 *
 * For air-gapped enclaves where workstations cannot reach GitHub or update servers,
 * this tool packages updated AST transpilation rules, PII sanitization dictionaries,
 * RLS policies, and synthetic data profiles into a verified .zip archive.
 *
 * Usage:
 *   node scripts/create-offline-patch.js
 *   npm run patch:create
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

console.log(`\n===============================================================`);
console.log(`  Evolve AI Enterprise — Offline Hot Patch Generator (v${version}) `);
console.log(`  Evolve Mind Solutions Pty Ltd • Air-Gapped Maintenance Tool `);
console.log(`===============================================================\n`);

const timestamp = new Date().toISOString();
const patchId = `PATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-R1`;
const patchVersion = `${version}-patch-${Date.now()}`;

// Output directories
const distDir = path.join(rootDir, 'dist-desktop');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const stagingDir = path.join(distDir, `staging-patch-${Date.now()}`);
fs.mkdirSync(stagingDir, { recursive: true });

// 1. Create Template Overrides
//
// The manifest is written LAST, after these files exist, because it records a
// SHA-256 of each one. Writing it first — as this script used to — is why the
// archive shipped with no way to detect tampering.
const templatesDir = path.join(stagingDir, 'templates');
fs.mkdirSync(path.join(templatesDir, 'sql'), { recursive: true });
fs.mkdirSync(path.join(templatesDir, 'pii'), { recursive: true });
fs.mkdirSync(path.join(templatesDir, 'rls'), { recursive: true });
fs.mkdirSync(path.join(templatesDir, 'synthetic'), { recursive: true });
fs.mkdirSync(path.join(templatesDir, 'mock'), { recursive: true });

// SQL AST Rules
fs.writeFileSync(
  path.join(templatesDir, 'sql', 'snowflake_to_databricks_ast.json'),
  JSON.stringify({
    dialect: "snowflake_to_databricks",
    version: "1.2.0",
    transforms: {
      "QUALIFY ROW_NUMBER()": "WINDOW_FILTER_WRAPPER",
      "IFF": "IF",
      "FLATTEN": "EXPLODE_OUTER",
      "TRY_TO_DATE": "TRY_CAST(date AS DATE)"
    }
  }, null, 2),
  'utf8'
);

// PII Sanitizer Patterns
fs.writeFileSync(
  path.join(templatesDir, 'pii', 'hipaa_gdpr_app_patterns.json'),
  JSON.stringify({
    jurisdiction: ["US-HIPAA", "EU-GDPR", "AU-APP"],
    rules: [
      { name: "Medicare AU", pattern: "^[2-6][0-9]{9}$", mask: "XXXXXXXXXX" },
      { name: "US SSN", pattern: "^\\d{3}-\\d{2}-\\d{4}$", mask: "***-**-****" },
      { name: "IBAN", pattern: "^[A-Z]{2}\\d{2}[A-Z0-9]{1,30}$", mask: "ANONYMIZED_IBAN" }
    ]
  }, null, 2),
  'utf8'
);

// RLS Security Policy
fs.writeFileSync(
  path.join(templatesDir, 'rls', 'multi_tenant_rls_policy.sql'),
  `-- Evolve AI Enterprise Zero-Trust RLS Template
CREATE POLICY tenant_isolation_policy ON target_data
FOR ALL TO authenticated_role
USING (tenant_id = current_setting('request.jwt.claim.tenant_id', true));
`,
  'utf8'
);

// Synthetic Data Profile
fs.writeFileSync(
  path.join(templatesDir, 'synthetic', 'fde_financial_synthetic_profile.json'),
  JSON.stringify({
    profile: "high_volume_fintech_transactions",
    distributions: {
      amount: { type: "log-normal", mean: 125.50, stddev: 45.2 },
      status: { type: "categorical", weights: { "SETTLED": 0.94, "PENDING": 0.04, "DISPUTED": 0.02 } }
    }
  }, null, 2),
  'utf8'
);

// Mock Server Endpoints
fs.writeFileSync(
  path.join(templatesDir, 'mock', 'enterprise_mock_endpoints.json'),
  JSON.stringify({
    endpoints: [
      { path: "/api/v1/payments/verify", method: "POST", response: { verified: true, code: "AUTH_200" } },
      { path: "/api/v1/identity/check", method: "GET", response: { status: "ACTIVE", complianceScore: 99.8 } }
    ]
  }, null, 2),
  'utf8'
);

// 2. Build the manifest from what is actually on disk
//
// Every file is hashed, and the manifest is then hashed over itself, so neither
// a file nor the file list can be altered without detection. This is a digest,
// not a signature: it proves the archive is unchanged since it was built, not
// who built it. There is no keypair in the product, so nothing here claims to
// be signed — the applier states the same distinction to the user.
const listFiles = (dir, prefix = '') => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(abs, rel));
    else if (entry.isFile() && rel !== 'manifest.json') out.push({ abs, rel });
  }
  return out;
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const files = listFiles(stagingDir)
  .map(({ abs, rel }) => {
    const contents = fs.readFileSync(abs);
    return { path: rel, bytes: contents.length, sha256: sha256(contents) };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  manifestVersion: 2,
  name: "Evolve AI Enterprise Air-Gapped Hot Patch",
  patchId,
  patchVersion,
  baseVersion: version,
  releasedAt: timestamp,
  publisher: "Evolve Mind Solutions Pty Ltd",
  contact: "support@evolvemindsolutions.com",
  description: "Enterprise AST transpiler rules, updated PII compliance patterns (HIPAA/GDPR/APP), and high-performance synthetic data generator profiles for air-gapped enclaves.",
  files,
  integrity: 'sha256-digest',
  signed: false
};

// Canonical form must match canonicalManifestJson() in src/fde/patchIntegrity.ts
// byte for byte, or the verifier will reject every archive this script builds.
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = canonical(value[k]);
      return acc;
    }, {});
  }
  return value;
};
manifest.manifestDigest = sha256(JSON.stringify(canonical(manifest)));

fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

// 3. Compress into .zip
const zipName = `evolve-ai-enterprise-patch-${version}.zip`;
const outputZip = path.join(distDir, zipName);

console.log(`[1/3] Assembling patch components into staging directory...`);
console.log(`      Patch ID: ${patchId}`);
console.log(`      Base Version: ${version}`);

console.log(`\n[2/3] Compressing archive into ${zipName}...`);
try {
  // Use tar or powershell Compress-Archive
  execSync(`tar -a -c -f "${outputZip}" -C "${stagingDir}" .`, { stdio: 'inherit' });
} catch (err) {
  // Fallback to powershell Compress-Archive
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${outputZip}' -Force"`, { stdio: 'inherit' });
}

// Clean up staging
try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}

// Checksum of the archive itself, for the release notes and the download page.
// Distinct from the per-file digests inside: this one lets a customer confirm
// the file they received is the file we published, before it is ever opened.
const archiveSha256 = sha256(fs.readFileSync(outputZip));
console.log(`\n  Archive SHA-256: ${archiveSha256}`);
console.log(`  Files hashed in manifest: ${files.length}`);
console.log(`  Integrity: SHA-256 digest (tamper-evident) — NOT digitally signed.`);

const stats = fs.statSync(outputZip);
const sizeKB = (stats.size / 1024).toFixed(1);
console.log(`  ✓ Successfully built patch bundle: ${zipName} (${sizeKB} KB)`);

// Also copy to user's Downloads folder if accessible for instant UI testing
const userDownloads = path.join(os.homedir(), 'Downloads');
if (fs.existsSync(userDownloads)) {
  const sampleDownloadZip = path.join(userDownloads, `evolve-ai-enterprise-patch-${version}-sample.zip`);
  fs.copyFileSync(outputZip, sampleDownloadZip);
  console.log(`\n[3/3] Copied sample patch bundle directly to Downloads folder:`);
  console.log(`      ${sampleDownloadZip}`);
  console.log(`      (You can now immediately pick this in the Evolve AI file selector!)`);
}

console.log(`\n===============================================================`);
console.log(`  Patch Bundle Ready: ${outputZip}`);
console.log(`===============================================================\n`);
