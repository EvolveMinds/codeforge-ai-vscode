#!/usr/bin/env node
/**
 * scripts/package-all.js — Sequentially build and verify all 6 platform-targeted .vsix packages.
 *
 * Usage:
 *   node scripts/package-all.js
 *   npm run package:all
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

console.log(`\n===============================================================`);
console.log(`  Evolve AI (v${version}) — Building All 6 Platform Packages  `);
console.log(`===============================================================\n`);

// 1. Compile TypeScript first
console.log(`[1/3] Compiling TypeScript source (tsc -p ./)...`);
execSync('npm run compile', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

// 2. Secret Scan
console.log(`\n[2/3] Performing pre-packaging security and secret scan...`);
const vsceList = execSync('npx vsce ls', { encoding: 'utf8', cwd: path.join(__dirname, '..') });
const secretMatches = vsceList.split('\n').filter(line => /token|secret|\.env|credential|password|key/i.test(line));
if (secretMatches.length > 0) {
  console.error(`\n[ERROR] Secret scan failed! The following sensitive files matched:\n`);
  secretMatches.forEach(m => console.error(`  - ${m}`));
  process.exit(1);
}
console.log(`  ✓ Secret scan clean (0 sensitive patterns detected).`);

// 3. Sequentially build each target
console.log(`\n[3/3] Building 6 platform targets sequentially...\n`);

const generatedPackages = [];

for (let i = 0; i < TARGETS.length; i++) {
  const target = TARGETS[i];
  console.log(`---------------------------------------------------------------`);
  console.log(`[${i + 1}/${TARGETS.length}] Packaging target: ${target}`);
  console.log(`---------------------------------------------------------------`);

  // Clean bin/
  const binDir = path.join(__dirname, '..', 'bin');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  // Download binary for this platform
  console.log(`  Fetching native binaries for ${target}...`);
  execSync(`node scripts/download-binaries.js --platform=${target}`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });

  // Package with vsce
  console.log(`  Bundling vsix for ${target}...`);
  execSync(`npx vsce package --target ${target} --allow-missing-repository`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });

  const vsixName = `evolve-ai-${target}-${version}.vsix`;
  const vsixPath = path.join(__dirname, '..', vsixName);
  if (fs.existsSync(vsixPath)) {
    const stats = fs.statSync(vsixPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    generatedPackages.push({ target, file: vsixName, sizeMB });
    console.log(`  ✓ Successfully built ${vsixName} (${sizeMB} MB)\n`);
  } else {
    console.error(`\n[ERROR] Failed to find generated vsix: ${vsixName}`);
    process.exit(1);
  }
}

console.log(`\n===============================================================`);
console.log(`  Summary of Built Packages (v${version})`);
console.log(`===============================================================`);
generatedPackages.forEach(p => {
  const status = (p.sizeMB >= 18 && p.sizeMB <= 25) ? '✓ OK' : '⚠ WARNING (unexpected size)';
  console.log(`  - ${p.file.padEnd(45)} ${p.sizeMB} MB  [${status}]`);
});
console.log(`\nAll 6 packages built successfully! Ready for publishing.`);
