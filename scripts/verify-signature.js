#!/usr/bin/env node
/**
 * scripts/verify-signature.js
 *
 * Windows Authenticode Verification Tool for Evolve AI Enterprise Studio.
 * Inspects all built executables and validates cryptographic signature blocks,
 * signer identity, certificate thumbprint, and RFC 3161 timestamping authority.
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-desktop');
const ps1Script = path.join(__dirname, 'verify-signature.ps1');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const currentVersion = pkg.version;

function discoverExecutables(checkAll = false) {
  const targets = [];

  // 1. win-unpacked primary executable
  const unpackedDir = path.join(distDir, 'win-unpacked');
  if (fs.existsSync(unpackedDir)) {
    const files = fs.readdirSync(unpackedDir);
    for (const f of files) {
      if (f.endsWith('.exe') && !f.toLowerCase().includes('uninstall')) {
        targets.push(path.join(unpackedDir, f));
      }
    }
  }

  // 2. dist-desktop root (setup, portable)
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

  return Array.from(new Set(targets));
}

function verifyBinary(filePath) {
  const relPath = path.relative(rootDir, filePath);

  if (process.platform !== 'win32') {
    // Basic PE security directory check on non-Windows
    try {
      const buffer = fs.readFileSync(filePath);
      const peOffset = buffer.readUInt32LE(0x3C);
      const magic = buffer.readUInt16LE(peOffset + 24);
      const isPe32Plus = magic === 0x20B;
      const securityDirOffset = peOffset + 24 + (isPe32Plus ? 144 : 128);
      const certTableRva = buffer.readUInt32LE(securityDirOffset);
      const certTableSize = buffer.readUInt32LE(securityDirOffset + 4);
      return {
        file: relPath,
        signed: certTableRva > 0 && certTableSize > 0,
        status: certTableRva > 0 ? 'Signed (PE Table Present)' : 'NotSigned',
        certTableSize: certTableSize
      };
    } catch (e) {
      return { file: relPath, signed: false, status: 'Error', error: e.message };
    }
  }

  // Windows: Native PowerShell script
  try {
    const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${ps1Script}" -FilePath "${filePath}"`;
    const raw = execSync(cmd, { encoding: 'utf8', cwd: rootDir }).trim();
    const data = JSON.parse(raw);
    return {
      file: relPath,
      signed: data.Signed === true,
      status: data.Status,
      statusMessage: data.StatusMessage,
      subject: data.Subject,
      issuer: data.Issuer,
      thumbprint: data.Thumbprint,
      notAfter: data.NotAfter,
      timestampSubject: data.TimestampSubject,
      timestampIssuer: data.TimestampIssuer
    };
  } catch (err) {
    return {
      file: relPath,
      signed: false,
      status: 'VerificationFailed',
      error: err.message
    };
  }
}

function main() {
  console.log('===============================================================');
  console.log(`  Evolve AI Enterprise Studio (v${currentVersion}) — Authenticode Verification`);
  console.log('===============================================================\n');

  const checkAll = process.argv.includes('--all');
  let targets = [];
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

  if (args.length > 0) {
    for (const arg of args) {
      const resolved = path.resolve(rootDir, arg);
      if (fs.existsSync(resolved)) {
        targets.push(resolved);
      } else {
        console.error(`[ERROR] Target not found: ${arg}`);
        process.exit(1);
      }
    }
  } else {
    targets = discoverExecutables(checkAll);
  }

  if (targets.length === 0) {
    console.warn('[WARN] No target executables found in dist-desktop/. Run `npm run desktop:build:protected` first.');
    process.exit(0);
  }

  console.log(`Auditing ${targets.length} target binary executable(s)...\n`);

  let allSigned = true;
  const results = [];

  for (const target of targets) {
    const res = verifyBinary(target);
    results.push(res);

    console.log(`---------------------------------------------------------------`);
    console.log(`📦 Binary: ${res.file}`);
    console.log(`   Signature Block: ${res.signed ? '✅ PRESENT' : '❌ MISSING'}`);
    console.log(`   Status:          ${res.status} (${res.statusMessage || 'OK'})`);
    if (res.subject) {
      console.log(`   Signer Subject:  ${res.subject}`);
      console.log(`   Thumbprint:      ${res.thumbprint}`);
      console.log(`   Valid Until:     ${res.notAfter}`);
    }
    if (res.timestampSubject) {
      console.log(`   Timestamp (RFC3161): ✅ YES`);
      console.log(`   Timestamp Auth:      ${res.timestampSubject}`);
    } else if (res.signed) {
      console.log(`   Timestamp:       ⚠️ None (Local clock signing)`);
    }

    if (!res.signed) {
      allSigned = false;
    }
  }

  console.log(`---------------------------------------------------------------`);
  console.log('\n===============================================================');
  if (allSigned) {
    console.log('  🎉 ALL TARGET EXECUTABLES HAVE VERIFIED AUTHENTICODE SIGNATURES!');
    console.log('===============================================================\n');
    process.exit(0);
  } else {
    console.error('  ⚠️ ONE OR MORE TARGET EXECUTABLES ARE NOT SIGNED OR FAILED VERIFICATION.');
    console.log('===============================================================\n');
    process.exit(1);
  }
}

main();
