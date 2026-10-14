#!/usr/bin/env node
/**
 * scripts/check-package-contents.js — verify what a .vsix will contain, before it is built.
 *
 * Usage:
 *   node scripts/check-package-contents.js                       # Community (uses .vscodeignore)
 *   node scripts/check-package-contents.js --enterprise --ignoreFile=<path>
 *
 * Checks, against the exact file list `vsce ls` reports:
 *   - no private key material in any shipped file (both editions)
 *   - no licence-issuing code (both editions)
 *   - Community only: no proprietary code (out/desktop, out/enterprise beyond the licence checker)
 *   - Community only: every relative require() in shipped JS resolves to a shipped file, so
 *     excluding code cannot leave the extension crashing on load. The single guarded require
 *     in core/enterpriseGate.js is the one allowed exception.
 *
 * Exits non-zero on any failure.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const enterprise = args.includes('--enterprise');
const ignoreArg = args.find(a => a.startsWith('--ignoreFile='));
const ignoreFlag = ignoreArg ? ` --ignoreFile "${ignoreArg.slice('--ignoreFile='.length)}"` : '';

const COMMUNITY_ALLOWED_ENTERPRISE = new Set([
  'out/enterprise/license/licenseTypes.js',
  'out/enterprise/license/licenseValidator.js',
  'out/enterprise/license/licenseManager.js',
]);
// Requires that are allowed to point at files the Community package does not ship.
const GUARDED_REQUIRES = new Set(['out/core/enterpriseGate.js -> ../enterprise']);

const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\s*[A-Za-z0-9+/=]{20,}/;

const files = execSync(`npx vsce ls${ignoreFlag}`, { encoding: 'utf8', cwd: root })
  .split(/\r?\n/).map(s => s.trim().replace(/\\/g, '/')).filter(Boolean);
const shipped = new Set(files);
const failures = [];

for (const f of files) {
  if (/licenseGenerator|issue-license|generate-license/i.test(f)) {
    failures.push(`licence-issuing code is packaged: ${f}`);
  }
  if (/AUDIT_REPORT|\.stackdump$/i.test(f)) {
    failures.push(`internal report or crash dump is packaged: ${f}`);
  }
  if (!enterprise && f.startsWith('out/desktop/')) {
    failures.push(`proprietary desktop code in Community package: ${f}`);
  }
  if (!enterprise && f.startsWith('out/enterprise/') && !COMMUNITY_ALLOWED_ENTERPRISE.has(f)) {
    failures.push(`proprietary enterprise code in Community package: ${f}`);
  }

  const full = path.join(root, f);
  let stat;
  try { stat = fs.statSync(full); } catch { continue; }
  if (stat.size > 5 * 1024 * 1024 || f.startsWith('bin/')) continue;
  const text = fs.readFileSync(full, 'utf8');
  if (PRIVATE_KEY.test(text)) failures.push(`private key material in: ${f}`);

  if (!enterprise && f.startsWith('out/') && f.endsWith('.js')) {
    const re = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      const spec = m[1];
      if (GUARDED_REQUIRES.has(`${f} -> ${spec}`)) continue;
      const base = path.posix.join(path.posix.dirname(f), spec);
      const candidates = [base, `${base}.js`, `${base}.json`, `${base}/index.js`];
      if (!candidates.some(c => shipped.has(c))) {
        failures.push(`${f} requires "${spec}", which is not in the package`);
      }
    }
  }
}

const edition = enterprise ? 'Enterprise' : 'Community';
if (failures.length) {
  console.error(`\n[ERROR] ${edition} package contents check failed (${failures.length}):`);
  failures.slice(0, 50).forEach(f => console.error(`  - ${f}`));
  if (failures.length > 50) console.error(`  ... and ${failures.length - 50} more`);
  process.exit(1);
}
console.log(`  ✓ ${edition} package contents clean (${files.length} files checked).`);
