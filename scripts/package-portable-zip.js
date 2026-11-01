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

  // Ensure trust-pilot-cert.ps1 has Authenticode signature
  const ps1Path = path.join(scriptsDir, 'trust-pilot-cert.ps1');
  const signerScript = path.join(scriptsDir, 'sign-windows-binary.ps1');
  if (fs.existsSync(ps1Path) && fs.existsSync(signerScript)) {
    try {
      execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${signerScript}" -FilePath "${ps1Path}"`, { stdio: 'ignore' });
    } catch {}
  }

  if (fs.existsSync(path.join(scriptsDir, 'trust-pilot-cert.bat'))) {
    fs.copyFileSync(path.join(scriptsDir, 'trust-pilot-cert.bat'), path.join(stagingDir, 'trust-pilot-cert.bat'));
  }
  if (fs.existsSync(ps1Path)) {
    fs.copyFileSync(ps1Path, path.join(stagingDir, 'trust-pilot-cert.ps1'));
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
1. Extract all files to any folder (e.g. C:\\Tools\\EvolveAI or your Desktop).
2. Simply double-click "${exeName}" to launch!
   - Runs 100% self-contained with zero installation or admin rights.
   - If Windows SmartScreen shows an initial prompt ("Windows protected your PC"),
     click "More info" -> "Run anyway".

CORPORATE TEST WORKSTATIONS (ONE-TIME TRUST SETUP):
If you want to permanently eliminate SmartScreen prompts across this computer:
1. Right-click "trust-pilot-cert.bat" and select "Run as administrator".
2. On the Windows prompt ("Publisher: Unknown Publisher"), click "Run".
   (Windows displays this standard prompt on all batch scripts downloaded from the web).
3. The script automatically installs the pilot certificate into Windows Trusted Root
   and Trusted Publishers stores in 2 seconds and unblocks the executable.
4. Once completed, the application will display:
   "Publisher: Evolve Mind Solutions Pty Ltd (Enterprise Pilot)"

NOTE ABOUT "evolve-enterprise-dev.cer":
- You do NOT need to open or click this certificate file directly.
- It is the public key certificate used automatically by trust-pilot-cert.bat.
- Opening it manually before installation prompts "Unknown Publisher" because Windows
  does not yet recognize any certificate until it is installed into the Trusted Root store.

AIR-GAPPED & SOVEREIGN OPERATION:
* Operates completely offline with zero SaaS dependencies.
* Connects to local Ollama, LM Studio, or corporate AI gateways.
* Includes offline cryptographic licensing and local AST analyzers.

SUPPORT & ENTERPRISE LICENSING:
* Corporate Portal: https://www.evolveminds.com.au/products/evolve-ai/
* Enterprise Inquiries: support@evolveminds.com.au
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
