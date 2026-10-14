#!/usr/bin/env node
/**
 * scripts/check-release-docs.js — the parts of the release checklist a script can verify.
 *
 * Usage:
 *   node scripts/check-release-docs.js
 *
 * Runs inside `npm run package:all`. It fails when, for the version in package.json:
 *   - CHANGELOG.md has no "## [x.y.z]" section
 *   - RELEASE_NOTES.md has no "## Version x.y.z" section
 *   - src/commands/coreCommands.ts has no What's New entry ('x.y.z': in RELEASE_NOTES)
 *   - README.md never mentions the version's minor line (vX.Y)
 *   - docs/ARCHITECTURE.md is no longer the developer architecture guide (the FDE document
 *     generator writes a client ARCHITECTURE.md into whatever workspace it runs in, and
 *     replaced this repo's guide once already)
 *
 * The judgement items (description, keywords, docs/* wording) stay on the checklist in
 * docs/PACKAGING.md §5.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const version = JSON.parse(read('package.json')).version;
const minor = version.split('.').slice(0, 2).join('.');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const checks = [
  ['CHANGELOG.md has a section for ' + version,
    () => new RegExp(`^## \\[${esc(version)}\\]`, 'm').test(read('CHANGELOG.md'))],
  ['RELEASE_NOTES.md has a section for ' + version,
    () => new RegExp(`^## Version ${esc(version)}\\b`, 'm').test(read('RELEASE_NOTES.md'))],
  ["What's New (coreCommands.ts RELEASE_NOTES) has an entry for " + version,
    () => read('src/commands/coreCommands.ts').includes(`'${version}': [`)],
  ['README.md mentions v' + minor,
    () => read('README.md').includes(`v${minor}`)],
  ['docs/ARCHITECTURE.md is the developer guide ("# Evolve AI — Architecture")',
    () => /^# Evolve AI — Architecture\s*$/m.test(read('docs/ARCHITECTURE.md').split(/\r?\n/).slice(0, 3).join('\n'))],
];

const failed = checks.filter(([, ok]) => { try { return !ok(); } catch { return true; } });
if (failed.length) {
  console.error(`\n[ERROR] Release docs incomplete for v${version}:`);
  failed.forEach(([label]) => console.error(`  - missing: ${label}`));
  console.error('  See the checklist in docs/PACKAGING.md §5.\n');
  process.exit(1);
}
console.log(`  ✓ Release docs in place for v${version} (${checks.length} checks).`);
