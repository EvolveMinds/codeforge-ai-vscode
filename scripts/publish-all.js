#!/usr/bin/env node
/**
 * scripts/publish-all.js — Publish all 6 platform-targeted packages to the VS Code Marketplace.
 *
 * Usage:
 *   node scripts/publish-all.js --pat=<YOUR_AZURE_DEVOPS_PAT>
 *   npm run publish:all -- --pat=<YOUR_AZURE_DEVOPS_PAT>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = pkg.version;

const TARGETS = [
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64'
];

let pat = null;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--pat=')) {
    pat = arg.split('=')[1];
  } else if (arg.startsWith('-p=')) {
    pat = arg.split('=')[1];
  } else if (arg === '-p' || arg === '--pat') {
    pat = process.argv[process.argv.indexOf(arg) + 1];
  }
}

if (!pat && process.env.VSCE_PAT) {
  pat = process.env.VSCE_PAT;
}

if (!pat) {
  console.error(`\n[ERROR] Missing Personal Access Token (PAT)!`);
  console.error(`Usage: node scripts/publish-all.js --pat=<YOUR_AZURE_DEVOPS_PAT>\n`);
  process.exit(1);
}

console.log(`\n===============================================================`);
console.log(`  Evolve AI (v${version}) — Publishing All 6 Platform Packages  `);
console.log(`===============================================================\n`);

for (let i = 0; i < TARGETS.length; i++) {
  const target = TARGETS[i];
  const vsixName = `evolve-ai-${target}-${version}.vsix`;
  const vsixPath = path.join(__dirname, '..', vsixName);

  if (!fs.existsSync(vsixPath)) {
    console.error(`\n[ERROR] Package file not found: ${vsixName}`);
    console.error(`Please run 'npm run package:all' first before publishing.\n`);
    process.exit(1);
  }

  console.log(`[${i + 1}/${TARGETS.length}] Publishing ${vsixName}...`);
  try {
    execSync(`npx vsce publish --packagePath "${vsixName}" -p "${pat}"`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    console.log(`  ✓ Successfully published ${vsixName}\n`);
  } catch (err) {
    console.error(`\n[ERROR] Failed to publish ${vsixName}`);
    console.error(err.message);
    process.exit(1);
  }
}

console.log(`\n===============================================================`);
console.log(`  ✓ All 6 platform packages for v${version} published successfully!`);
console.log(`===============================================================\n`);
