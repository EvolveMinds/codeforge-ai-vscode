/**
 * scripts/apply-fuses.js
 *
 * Electron-Builder afterPack hook to flip security fuses on the packaged executable.
 * Hardens the commercial desktop binary against reverse engineering, debug port hijacking,
 * and arbitrary script execution (Living-off-the-Land attack vectors).
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const fs = require('fs');
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function applyFuses(context) {
  const isWindows = context.electronPlatformName === 'win32';
  const isMac = context.electronPlatformName === 'darwin';
  const isLinux = context.electronPlatformName === 'linux';

  let executablePath;
  if (isWindows) {
    const candidateName = `${context.packager.appInfo.productFilename}.exe`;
    executablePath = path.join(context.appOutDir, candidateName);
    if (!fs.existsSync(executablePath)) {
      // Search for any primary .exe in appOutDir (excluding uninstallers)
      const files = fs.readdirSync(context.appOutDir);
      const exe = files.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
      if (exe) executablePath = path.join(context.appOutDir, exe);
    }
  } else if (isMac) {
    executablePath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'MacOS',
      context.packager.appInfo.productFilename
    );
  } else if (isLinux) {
    executablePath = path.join(context.appOutDir, context.packager.executableName || context.packager.appInfo.productFilename);
  }

  if (!executablePath || !fs.existsSync(executablePath)) {
    console.warn(`[Electron Fuses] Executable not found at "${executablePath}". Skipping fuse flipping.`);
    return;
  }

  console.log(`\n===============================================================`);
  console.log(`  [Electron Fuses] Hardening Executable Binary                 `);
  console.log(`  Target: ${executablePath}                                    `);
  console.log(`===============================================================`);

  try {
    await flipFuses(executablePath, {
      version: FuseVersion.V1,
      // 1. Prevent running arbitrary scripts via ELECTRON_RUN_AS_NODE=1
      [FuseV1Options.RunAsNode]: false,
      // 2. Prevent attaching debuggers via --inspect or --remote-debugging-port
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // 3. Prevent overriding Node options via NODE_OPTIONS environment variable
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      // 4. Enforce cryptographic validation of app.asar against embedded binary checksum
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      // 5. Block loading external scripts from outside the signed ASAR package
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });

    console.log(`  ✓ [FUSE LOCKED] RunAsNode: false (Prevents rogue Node.js execution)`);
    console.log(`  ✓ [FUSE LOCKED] EnableNodeCliInspectArguments: false (Blocks REA / CDP debuggers)`);
    console.log(`  ✓ [FUSE LOCKED] EnableNodeOptionsEnvironmentVariable: false (Blocks injection)`);
    console.log(`  ✓ [FUSE LOCKED] EnableEmbeddedAsarIntegrityValidation: true (Tamper-evident ASAR)`);
    console.log(`  ✓ [FUSE LOCKED] OnlyLoadAppFromAsar: true (Disallows loose script loads)`);
    console.log(`===============================================================\n`);
  } catch (err) {
    console.error(`[Electron Fuses] ERROR: Failed to flip security fuses:`, err);
    throw err;
  }
};
