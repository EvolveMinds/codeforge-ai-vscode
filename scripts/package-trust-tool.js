#!/usr/bin/env node
/**
 * scripts/package-trust-tool.js
 *
 * Packages the 1-Click Pilot Trust Tool (trust-pilot-cert.bat, trust-pilot-cert.ps1,
 * evolve-enterprise-dev.cer, and README.txt) into dist-desktop/evolve-ai-pilot-trust-tool.zip.
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-desktop');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const stagingDir = path.join(distDir, `staging-trust-tool-${Date.now()}`);
fs.mkdirSync(stagingDir, { recursive: true });

// Copy scripts and certificate
fs.copyFileSync(path.join(__dirname, 'trust-pilot-cert.bat'), path.join(stagingDir, 'trust-pilot-cert.bat'));
fs.copyFileSync(path.join(__dirname, 'trust-pilot-cert.ps1'), path.join(stagingDir, 'trust-pilot-cert.ps1'));
fs.copyFileSync(path.join(rootDir, 'build-certs', 'evolve-enterprise-dev.cer'), path.join(stagingDir, 'evolve-enterprise-dev.cer'));

// Create README.txt
const readme = `======================================================================
  Evolve AI Enterprise Studio — 1-Click Pilot Trust Tool
  Evolve Mind Solutions Pty Ltd • Enterprise Evaluation & Pilot Kit
======================================================================

PURPOSE:
This tool configures corporate test machines and developer workstations
to trust Evolve AI Enterprise Studio binaries, preventing Windows Defender
SmartScreen warnings ("Windows protected your PC") and Mark-of-the-Web blocks.

WHAT THIS SCRIPT DOES:
1. Installs the official Evolve AI Enterprise Pilot Certificate 
   (evolve-enterprise-dev.cer) into:
   - Windows Local Machine \\ Trusted Publishers
   - Windows Local Machine \\ Trusted Root Certification Authorities
2. Automatically removes the NTFS Mark-of-the-Web (Zone.Identifier) stream
   from downloaded Evolve AI executable binaries (evolve-ai-enterprise-*.exe)
   in your Downloads folder and current folder.
3. Windows SmartScreen and Defender will recognize the binary as signed by 
   "Evolve Mind Solutions Pty Ltd (Enterprise Pilot)" and execute directly.

HOW TO RUN:
Option A (Recommended):
  1. Right-click "trust-pilot-cert.bat" and select "Run as administrator".
  2. Click "Yes" on the User Account Control prompt.
  3. The script will complete in 2 seconds and display a [SUCCESS] message.

Option B (PowerShell):
  1. Open PowerShell as Administrator.
  2. Navigate to this folder and execute:
     .\\trust-pilot-cert.ps1

VERIFICATION:
You can verify the certificate thumbprint:
  Thumbprint: 3EB7C14853038D3C46FB1530FF713B651527681C
  Subject:    CN=Evolve Mind Solutions Pty Ltd (Enterprise Pilot)

SUPPORT:
Questions or enterprise deployments: support@evolveminds.com.au
`;

fs.writeFileSync(path.join(stagingDir, 'README.txt'), readme, 'utf8');

const outputZip = path.join(distDir, 'evolve-ai-pilot-trust-tool.zip');
if (fs.existsSync(outputZip)) {
  fs.unlinkSync(outputZip);
}

try {
  execSync(`tar -a -c -f "${outputZip}" -C "${stagingDir}" .`, { stdio: 'inherit' });
} catch {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${outputZip}' -Force"`, { stdio: 'inherit' });
}

// Clean staging
try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}

const stats = fs.statSync(outputZip);
const bytes = stats.size;
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(outputZip)).digest('hex').toUpperCase();

console.log(`\n===============================================================`);
console.log(`  1-Click Pilot Trust Tool Packaged Successfully!`);
console.log(`  File:   ${outputZip}`);
console.log(`  Bytes:  ${bytes}`);
console.log(`  SHA256: ${sha256}`);
console.log(`===============================================================\n`);
