#!/usr/bin/env node
/**
 * scripts/sign-windows-binary.js
 *
 * Windows Authenticode Code Signing Runner for Evolve AI Enterprise Studio.
 *
 * Capabilities:
 *   - Auto-detects all production executables in dist-desktop/ (unpacked, setup, portable)
 *   - Supports dual-mode signing:
 *       1. Enterprise Production: Environment variables CSC_LINK / CERT_PFX_PATH & CSC_KEY_PASSWORD / CERT_PASSWORD
 *       2. Development / Pilot: Local build-certs/evolve-enterprise-dev.pfx (auto-generates if missing)
 *   - SHA-256 Authenticode signature with RFC 3161 DigiCert timestamping
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-desktop');
const ps1Script = path.join(__dirname, 'sign-windows-binary.ps1');
const generateCertScript = path.join(__dirname, 'generate-dev-cert.js');

function resolveCredentials() {
  let pfxPath = process.env.CERT_PFX_PATH || process.env.CSC_LINK;
  let password = process.env.CERT_PASSWORD || process.env.CSC_KEY_PASSWORD;
  const timestampUrl = process.env.TIMESTAMP_URL || 'http://timestamp.digicert.com';

  if (!pfxPath) {
    pfxPath = path.join(rootDir, 'build-certs', 'evolve-enterprise-dev.pfx');
    if (!fs.existsSync(pfxPath)) {
      console.log('[INFO] Local development certificate not found. Auto-generating...');
      execSync(`node "${generateCertScript}"`, { stdio: 'inherit', cwd: rootDir });
    }
  }

  if (!password) {
    const pwdFile = path.join(path.dirname(pfxPath), '.cert-password');
    if (fs.existsSync(pwdFile)) {
      password = fs.readFileSync(pwdFile, 'utf8').trim();
    } else {
      password = 'EvolveEnterprise2026!Secure';
    }
  }

  return { pfxPath, password, timestampUrl };
}

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const currentVersion = pkg.version;

function discoverExecutables(checkAll = false) {
  const targets = [];

  // 1. Unpacked main binary
  const unpackedDir = path.join(distDir, 'win-unpacked');
  if (fs.existsSync(unpackedDir)) {
    const files = fs.readdirSync(unpackedDir);
    for (const f of files) {
      if (f.endsWith('.exe') && !f.toLowerCase().includes('uninstall')) {
        targets.push(path.join(unpackedDir, f));
      }
    }
  }

  // 2. Installers & Portable executables in dist-desktop root
  if (fs.existsSync(distDir)) {
    const files = fs.readdirSync(distDir);
    for (const f of files) {
      if (f.endsWith('.exe') && !f.toLowerCase().includes('uninstall')) {
        if (checkAll || f.includes(currentVersion)) {
          targets.push(path.join(distDir, f));
        }
      }
    }
  }

  // Deduplicate
  return Array.from(new Set(targets));
}

function signBinary(filePath, pfxPath, password, timestampUrl) {
  const fileName = path.basename(filePath);
  console.log(`\n>>> Signing: ${fileName} (${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)} MB)...`);
  
  // Escape paths and arguments for PowerShell
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps1Script}" -FilePath "${filePath}" -PfxPath "${pfxPath}" -Password "${password}" -TimestampUrl "${timestampUrl}"`;

  try {
    execSync(cmd, { stdio: 'inherit', cwd: rootDir });
    console.log(`  ✓ Signature successfully applied: ${fileName}`);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to sign ${fileName}: ${err.message}`);
    return false;
  }
}

function main() {
  console.log('===============================================================');
  console.log('  Evolve AI Enterprise Studio — Authenticode Code Signing');
  console.log('===============================================================');

  if (process.platform !== 'win32') {
    console.warn('[WARN] Authenticode signing via PowerShell is designed for Windows environments.');
    console.warn('       Skipping on non-Windows host.');
    process.exit(0);
  }

  const { pfxPath, password, timestampUrl } = resolveCredentials();

  if (!fs.existsSync(pfxPath)) {
    console.error(`[FATAL ERROR] Certificate file not found at: ${pfxPath}`);
    process.exit(1);
  }

  let targets = [];
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

  if (args.length > 0) {
    // Specific files passed
    for (const arg of args) {
      const resolved = path.resolve(rootDir, arg);
      if (fs.existsSync(resolved)) {
        targets.push(resolved);
      } else {
        console.error(`[ERROR] Specified target not found: ${arg}`);
        process.exit(1);
      }
    }
  } else {
    // Auto-discover
    targets = discoverExecutables(process.argv.includes('--all'));
  }

  if (targets.length === 0) {
    console.warn('[WARN] No target executables found in dist-desktop/. Run `npm run desktop:build:protected` first.');
    process.exit(0);
  }

  console.log(`[INFO] Found ${targets.length} executable(s) to sign:`);
  targets.forEach((t, i) => console.log(`  [${i + 1}] ${path.relative(rootDir, t)}`));
  console.log(`[INFO] Using Certificate: ${path.basename(pfxPath)}`);
  console.log(`[INFO] Timestamp Authority: ${timestampUrl}`);

  let successCount = 0;
  for (const target of targets) {
    if (signBinary(target, pfxPath, password, timestampUrl)) {
      successCount++;
    }
  }

  console.log('\n===============================================================');
  if (successCount === targets.length) {
    console.log(`  ✓ Successfully signed all ${successCount} executable(s)!`);
    console.log('===============================================================\n');
    process.exit(0);
  } else {
    console.error(`  ❌ Signed ${successCount}/${targets.length} executable(s). Failures occurred.`);
    console.log('===============================================================\n');
    process.exit(1);
  }
}

main();
