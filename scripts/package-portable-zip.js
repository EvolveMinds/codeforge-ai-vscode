#!/usr/bin/env node
/**
 * scripts/package-portable-zip.js
 *
 * Packages the standalone portable executable, trust configuration scripts,
 * and quick-start instructions into a friction-free zip package:
 * dist-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.zip
 *
 * This format eliminates browser "uncommon download" warnings (Google Safe Browsing)
 * on bare .exe downloads while maintaining 100% portable zero-install execution.
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;

const distDir = path.join(rootDir, 'dist-desktop');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const exeName = `evolve-ai-enterprise-portable-${version}-win32-x64.exe`;
const exePath = path.join(distDir, exeName);

if (!fs.existsSync(exePath)) {
  console.error(`[ERROR] Portable executable not found: ${exePath}`);
  console.error(`Please run "npm run desktop:build:portable && npm run desktop:sign" first.`);
  process.exit(1);
}

const zipName = `evolve-ai-enterprise-portable-${version}-win32-x64.zip`;
const zipPath = path.join(distDir, zipName);

const stagingDir = path.join(distDir, `staging-portable-zip-${Date.now()}`);
fs.mkdirSync(stagingDir, { recursive: true });

try {
  console.log(`\n===============================================================`);
  console.log(`  Evolve AI Enterprise Studio (v${version}) — Portable ZIP Bundler`);
  console.log(`  Evolve Mind Solutions Pty Ltd • Enterprise Edition`);
  console.log(`===============================================================\n`);

  // 1. Copy signed executable
  console.log(`[1/4] Copying signed executable (${exeName})...`);
  fs.copyFileSync(exePath, path.join(stagingDir, exeName));

  // 2. Copy trust scripts and certificate
  console.log(`[2/4] Bundling 1-Click Trust Tool scripts and certificate...`);
  const scriptsDir = path.join(rootDir, 'scripts');
  const certsDir = path.join(rootDir, 'build-certs');

  if (fs.existsSync(path.join(scriptsDir, 'trust-pilot-cert.bat'))) {
    fs.copyFileSync(path.join(scriptsDir, 'trust-pilot-cert.bat'), path.join(stagingDir, 'trust-pilot-cert.bat'));
  }
  if (fs.existsSync(path.join(scriptsDir, 'trust-pilot-cert.ps1'))) {
    fs.copyFileSync(path.join(scriptsDir, 'trust-pilot-cert.ps1'), path.join(stagingDir, 'trust-pilot-cert.ps1'));
  }
  if (fs.existsSync(path.join(certsDir, 'evolve-enterprise-dev.cer'))) {
    fs.copyFileSync(path.join(certsDir, 'evolve-enterprise-dev.cer'), path.join(stagingDir, 'evolve-enterprise-dev.cer'));
  }

  // 3. Create README.txt
  console.log(`[3/4] Writing Quick Start guide (README.txt)...`);
  const readme = `======================================================================
  Evolve AI Enterprise Studio (v${version}) — Windows x64 Portable
  Evolve Mind Solutions Pty Ltd • Proprietary Commercial Edition
======================================================================

QUICK START:
1. Extract all files in this archive to any folder (e.g. C:\\Tools\\EvolveAI,
   Desktop, or a secure corporate network share).
2. Double-click "${exeName}" to launch.
   - The application runs 100% self-contained with zero installation.
   - All runtime configs, AI model settings, and encrypted credentials
     are stored in your local user profile.

CORPORATE TRUST SETUP (FOR TEST & EVALUATION MACHINES):
This executable is digitally signed with our official Authenticode certificate:
  Signer: CN=Evolve Mind Solutions Pty Ltd (Enterprise Pilot)

If Windows Defender SmartScreen shows an initial verification banner:
  Option A: Click "More info" -> "Run anyway" (instant 1-time bypass).
  Option B: Right-click "trust-pilot-cert.bat" -> "Run as administrator".
            This automatically installs the enterprise certificate into your
            Trusted Root and Trusted Publishers stores and unblocks downloaded
            binaries, giving permanent zero-warning execution across your machine.

AIR-GAPPED & SOVEREIGN OPERATION:
* Operates completely offline with zero SaaS dependencies.
* Connects to local Ollama, LM Studio, or corporate AI gateways.
* Includes offline cryptographic licensing and local AST analyzers.

SUPPORT & ENTERPRISE LICENSING:
* Corporate Portal: https://www.evolveminds.com.au/products/evolve-ai/
* Enterprise Inquiries: info@evolveminds.com.au
======================================================================
`;
  fs.writeFileSync(path.join(stagingDir, 'README.txt'), readme, 'utf8');

  // 4. Compress into zip archive
  console.log(`[4/4] Creating ZIP archive: ${zipName}...`);
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Use PowerShell Compress-Archive for standard native Windows zip
  const cmd = `powershell.exe -NoProfile -NonInteractive -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force"`;
  execSync(cmd, { stdio: 'inherit' });

  const buf = fs.readFileSync(zipPath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
  const mb = (buf.length / (1024 * 1024)).toFixed(2);

  console.log(`\n===============================================================`);
  console.log(`  ✓ Portable Studio ZIP Package Created Successfully!`);
  console.log(`  File:   ${zipPath}`);
  console.log(`  Bytes:  ${buf.length} (${mb} MB)`);
  console.log(`  SHA256: ${hash}`);
  console.log(`===============================================================\n`);
} finally {
  // Cleanup staging directory
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch (_) {}
}
