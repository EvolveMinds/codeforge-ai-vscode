#!/usr/bin/env node
/**
 * scripts/package-enterprise.js — Build and package Evolve AI Enterprise (Commercial) Edition VSIX packages.
 *
 * Usage:
 *   node scripts/package-enterprise.js
 *   node scripts/package-enterprise.js --platform=win32-x64
 *   npm run package:enterprise
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

let requestedPlatform = null;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--platform=')) {
    requestedPlatform = arg.slice('--platform='.length);
  }
}

const TARGETS = requestedPlatform ? [requestedPlatform] : [
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64'
];

console.log(`\n===============================================================`);
console.log(`  Evolve AI Enterprise Edition (v${version}) — Packaging Tool   `);
console.log(`  Evolve Mind Solutions Pty Ltd • Proprietary Commercial Build `);
console.log(`===============================================================\n`);

// 1. Compile TypeScript source
console.log(`[1/4] Compiling TypeScript source (tsc -p ./)...`);
execSync('npm run compile', { stdio: 'inherit', cwd: rootDir });

// 2. Run Enterprise Unit Test Suite
console.log(`\n[2/4] Running Enterprise automated test suite...`);
execSync('npx mocha --ui tdd out/test/suite/enterprise/*.test.js', { stdio: 'inherit', cwd: rootDir });

// 3. Security & Secret Scan
console.log(`\n[3/4] Performing enterprise packaging security scan...`);
const vsceList = execSync('npx vsce ls', { encoding: 'utf8', cwd: rootDir });
const secretMatches = vsceList.split('\n').filter(line => /token|secret|\.env|credential|password/i.test(line));
if (secretMatches.length > 0) {
  console.error(`\n[ERROR] Secret scan failed! The following sensitive files matched:\n`);
  secretMatches.forEach(m => console.error(`  - ${m}`));
  process.exit(1);
}
console.log(`  ✓ Secret scan clean (0 sensitive leaks detected).`);

// 4. Sequentially build enterprise VSIX packages
console.log(`\n[4/4] Building Enterprise platform packages...\n`);

const generatedPackages = [];

for (let i = 0; i < TARGETS.length; i++) {
  const target = TARGETS[i];
  console.log(`---------------------------------------------------------------`);
  console.log(`[${i + 1}/${TARGETS.length}] Packaging Enterprise Target: ${target}`);
  console.log(`---------------------------------------------------------------`);

  // Clean bin/
  const binDir = path.join(rootDir, 'bin');
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true, force: true });
  }

  // Fetch native platform binaries
  console.log(`  Fetching bundled binaries for ${target}...`);
  execSync(`node scripts/download-binaries.js --platform=${target}`, {
    stdio: 'inherit',
    cwd: rootDir
  });

  // Package with vsce
  const outName = `evolve-ai-enterprise-${target}-${version}.vsix`;
  console.log(`  Packaging ${outName}...`);
  execSync(`npx vsce package --target ${target} --out ${outName} --allow-missing-repository`, {
    stdio: 'inherit',
    cwd: rootDir
  });

  const vsixPath = path.join(rootDir, outName);
  if (fs.existsSync(vsixPath)) {
    const stats = fs.statSync(vsixPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    generatedPackages.push({ target, file: outName, sizeMB });
    console.log(`  ✓ Successfully built Enterprise package: ${outName} (${sizeMB} MB)\n`);
  } else {
    console.error(`\n[ERROR] Failed to find generated vsix: ${outName}`);
    process.exit(1);
  }
}

console.log(`\n===============================================================`);
console.log(`  Enterprise Build Summary (v${version})`);
console.log(`===============================================================`);
generatedPackages.forEach(p => {
  console.log(`  - ${p.file.padEnd(50)} ${p.sizeMB} MB  [✓ ENTERPRISE READY]`);
});
console.log(`\nAll enterprise packages built successfully! Ready for private client distribution.\n`);
