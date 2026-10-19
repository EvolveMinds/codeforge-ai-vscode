#!/usr/bin/env node
/**
 * scripts/generate-dev-cert.js
 *
 * Cross-platform entrypoint for generating an X.509 Authenticode Code Signing Certificate
 * for Evolve AI Enterprise Studio development and offline enterprise pilot testing.
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const certsDir = path.join(rootDir, 'build-certs');
const pfxFile = path.join(certsDir, 'evolve-enterprise-dev.pfx');
const cerFile = path.join(certsDir, 'evolve-enterprise-dev.cer');
const pwdFile = path.join(certsDir, '.cert-password');
const ps1Script = path.join(__dirname, 'generate-dev-cert.ps1');

const force = process.argv.includes('--force');

function main() {
  console.log('===============================================================');
  console.log('  Evolve AI Enterprise Studio — Code Signing Certificate Setup');
  console.log('===============================================================');

  if (process.platform !== 'win32') {
    console.warn('[WARN] Authenticode certificate generation via PowerShell requires Windows.');
    console.warn('       On non-Windows systems, provide a pre-generated PFX via CERT_PFX_PATH / CSC_LINK.');
    if (fs.existsSync(pfxFile)) {
      console.log(`[INFO] Existing PFX detected at: ${pfxFile}`);
      process.exit(0);
    }
    process.exit(1);
  }

  if (fs.existsSync(pfxFile) && !force) {
    console.log(`[INFO] Code signing certificate already exists at:`);
    console.log(`       ${pfxFile}`);
    console.log(`       (Pass --force to regenerate new certificate and key)`);
    process.exit(0);
  }

  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  console.log('[INFO] Invoking PowerShell to generate 2048-bit RSA Code Signing Certificate...');
  try {
    const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps1Script}" -OutputDir "${certsDir}"`;
    execSync(cmd, { stdio: 'inherit', cwd: rootDir });

    if (fs.existsSync(pfxFile) && fs.existsSync(cerFile)) {
      console.log('\n[SUCCESS] Code signing certificate and private key successfully ready.');
      console.log(`          PFX: ${pfxFile}`);
      console.log(`          CER: ${cerFile}`);
      process.exit(0);
    } else {
      console.error('\n[ERROR] Certificate files were not found after generation.');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR] Failed to generate code signing certificate:', err.message);
    process.exit(1);
  }
}

main();
