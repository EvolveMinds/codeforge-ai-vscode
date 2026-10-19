#!/usr/bin/env node
/**
 * scripts/build-desktop-protected.js
 *
 * Commercial Desktop Build Pipeline for Evolve AI Enterprise Studio.
 * Enforces defense-in-depth protection:
 *   1. Full TypeScript compilation check
 *   2. Isolated desktop staging (leaving community out/ pristine)
 *   3. esbuild bundling, tree-shaking, and symbol mangling
 *   4. javascript-obfuscator string encryption & licensing protection
 *   5. bytenode V8 bytecode compilation (.jsc)
 *   6. Electron security fuses lockdown via afterPack hook
 *   7. Traceability manifest generation and anti-reverse audit
 *
 * Copyright (c) 2026 Evolve Mind Solutions Pty Ltd. All rights reserved.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const bytenode = require('bytenode');
const JavaScriptObfuscator = require('javascript-obfuscator');

const rootDir = path.join(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

const stagingDir = path.join(rootDir, 'dist-desktop-staging');
const outputDir = path.join(rootDir, 'dist-desktop');

console.log(`\n===============================================================`);
console.log(`  Evolve AI Enterprise Studio (v${version}) — Protected Build    `);
console.log(`  Defense-in-Depth: Bytecode + Obfuscation + Sealed Fuses      `);
console.log(`===============================================================\n`);

function copyDirRecursive(src, dest, filterFn) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (filterFn && !filterFn(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, filterFn);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function runProtectedBuild() {
  const startTime = Date.now();

  // ---------------------------------------------------------------------------
  // Step 0: Pre-Flight Integrity Check
  // ---------------------------------------------------------------------------
  console.log(`[1/8] Running pre-flight version & literal checks...`);
  if (process.platform === 'win32') {
    try {
      execSync('powershell.exe -NoProfile -Command "Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' });
    } catch {}
  }
  execSync('node scripts/check-version-literals.js', { stdio: 'inherit', cwd: rootDir });

  // ---------------------------------------------------------------------------
  // Step 1: Ensure TypeScript & Assets are Compiled
  // ---------------------------------------------------------------------------
  console.log(`\n[2/8] Compiling baseline TypeScript (tsc -p ./)...`);
  execSync('npm run compile', { stdio: 'inherit', cwd: rootDir });

  // ---------------------------------------------------------------------------
  // Step 2: Initialize Isolated Staging Directory
  // ---------------------------------------------------------------------------
  console.log(`\n[3/8] Staging isolated desktop runtime in: ${stagingDir}...`);
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  const mainStagingDir = path.join(stagingDir, 'desktop', 'main');
  const rendererStagingDir = path.join(stagingDir, 'desktop', 'renderer');
  fs.mkdirSync(mainStagingDir, { recursive: true });
  fs.mkdirSync(rendererStagingDir, { recursive: true });

  // Copy renderer static assets (HTML, CSS, media) — strictly exclude .ts files
  const rendererSrcDir = path.join(rootDir, 'src', 'desktop', 'renderer');
  copyDirRecursive(rendererSrcDir, rendererStagingDir, (filePath) => !filePath.endsWith('.ts'));

  // Copy compiled renderer scripts from out/
  const generatedRendererScripts = ['renderer.js', 'flowchart.js', 'agentBuilder.js'];
  for (const scriptName of generatedRendererScripts) {
    const srcScript = path.join(rootDir, 'out', 'desktop', 'renderer', scriptName);
    if (fs.existsSync(srcScript)) {
      const destScript = path.join(rendererStagingDir, scriptName);
      // Minify using esbuild
      await esbuild.build({
        entryPoints: [srcScript],
        bundle: false,
        minify: true,
        outfile: destScript,
        sourcemap: false
      });
      console.log(`  ✓ Minified & staged: desktop/renderer/${scriptName}`);
    }
  }

  // Copy media folder
  copyDirRecursive(path.join(rootDir, 'media'), path.join(stagingDir, 'media'));

  // Copy bytenode module into staging node_modules so Electron runtime can require it
  const stagingNodeModules = path.join(stagingDir, 'node_modules');
  fs.mkdirSync(stagingNodeModules, { recursive: true });
  copyDirRecursive(path.join(rootDir, 'node_modules', 'bytenode'), path.join(stagingNodeModules, 'bytenode'));

  // Create lightweight production package.json for the desktop distribution
  const desktopPkg = {
    name: 'evolve-ai-enterprise-studio',
    productName: 'Evolve AI Enterprise Studio',
    version: version,
    description: pkg.description,
    main: 'desktop/main/main.js',
    author: pkg.author,
    license: 'Proprietary'
  };
  fs.writeFileSync(path.join(stagingDir, 'package.json'), JSON.stringify(desktopPkg, null, 2), 'utf8');

  // ---------------------------------------------------------------------------
  // Step 3: Bundle & Obfuscate Main Entrypoint and Preload
  // ---------------------------------------------------------------------------
  console.log(`\n[4/8] Bundling and obfuscating main process & licensing engine...`);

  // Bundle Main process (inlines all workspace, terminal, licensing, and enterprise logic)
  const rawMainBundlePath = path.join(mainStagingDir, 'main.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'out', 'desktop', 'main', 'main.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['electron', 'bytenode'],
    outfile: rawMainBundlePath,
    minify: true,
    sourcemap: false,
    sourcesContent: false
  });

  // Apply high-grade string encryption & obfuscation to the bundled main script
  const rawMainCode = fs.readFileSync(rawMainBundlePath, 'utf8');
  console.log(`  - Obfuscating main bundle (${(rawMainCode.length / 1024).toFixed(1)} KB)...`);
  const tObf = Date.now();
  const obfuscatedMain = JavaScriptObfuscator.obfuscate(rawMainCode, {
    compact: true,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.5
  });
  fs.writeFileSync(rawMainBundlePath, obfuscatedMain.getObfuscatedCode(), 'utf8');
  console.log(`  ✓ Main bundle obfuscated in ${((Date.now() - tObf) / 1000).toFixed(1)}s`);

  // Bundle Preload script
  const rawPreloadBundlePath = path.join(mainStagingDir, 'preload.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'out', 'desktop', 'main', 'preload.js')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    outfile: rawPreloadBundlePath,
    minify: true,
    sourcemap: false
  });

  // Obfuscate Preload script
  const rawPreloadCode = fs.readFileSync(rawPreloadBundlePath, 'utf8');
  console.log(`  - Obfuscating preload bridge (${(rawPreloadCode.length / 1024).toFixed(1)} KB)...`);
  const obfuscatedPreload = JavaScriptObfuscator.obfuscate(rawPreloadCode, {
    compact: true,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.5
  });
  const finalPreloadPath = path.join(mainStagingDir, 'preload.js');
  fs.writeFileSync(finalPreloadPath, obfuscatedPreload.getObfuscatedCode(), 'utf8');
  fs.unlinkSync(rawPreloadBundlePath);
  console.log(`  ✓ Preload bridge obfuscated and sealed.`);

  // ---------------------------------------------------------------------------
  // Step 4: Compile Main Process to V8 Bytecode (.jsc) via Electron
  // ---------------------------------------------------------------------------
  console.log(`\n[5/8] Compiling main process into V8 Bytecode (.jsc)...`);
  const mainJscPath = path.join(mainStagingDir, 'main.jsc');
  await bytenode.compileFile({
    filename: rawMainBundlePath,
    output: mainJscPath,
    electron: true
  });

  // Remove the uncompiled bundle
  fs.unlinkSync(rawMainBundlePath);

  // Write the bootstrap loader main.js
  const loaderCode = `'use strict';
require('bytenode');
require('./main.jsc');
`;
  fs.writeFileSync(path.join(mainStagingDir, 'main.js'), loaderCode, 'utf8');
  console.log(`  ✓ Main process sealed in V8 Bytecode: desktop/main/main.jsc`);
  console.log(`  ✓ Bootstrap loader created: desktop/main/main.js`);

  // ---------------------------------------------------------------------------
  // Step 5: Package Desktop Application with electron-builder
  // ---------------------------------------------------------------------------
  console.log(`\n[6/8] Packaging executable with electron-builder...`);
  
  // Create an explicit config for packaging the staged directory
  const builderConfigPath = path.join(stagingDir, 'electron-builder-staged.json');
  const baseConfig = {
    appId: 'com.evolveminds.evolveai.enterprise',
    productName: 'Evolve AI Enterprise Studio',
    copyright: 'Copyright © 2026 Evolve Mind Solutions Pty Ltd',
    electronVersion: '28.2.0',
    directories: {
      output: outputDir,
      buildResources: path.join(rootDir, 'media')
    },
    afterPack: path.join(rootDir, 'scripts', 'apply-fuses.js'),
    extraMetadata: {
      main: 'desktop/main/main.js'
    },
    files: [
      'desktop/**/*',
      'media/**/*',
      'node_modules/bytenode/**/*',
      'package.json'
    ],
    win: {
      target: [
        { target: 'nsis', arch: ['x64'] },
        { target: 'portable', arch: ['x64'] },
        { target: 'dir', arch: ['x64'] }
      ],
      icon: path.join(rootDir, 'media', 'icon-512.png')
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: 'always',
      createStartMenuShortcut: true,
      shortcutName: 'Evolve AI Enterprise Studio',
      artifactName: 'evolve-ai-enterprise-setup-${version}-win32-x64.exe'
    },
    portable: {
      artifactName: 'evolve-ai-enterprise-portable-${version}-win32-x64.exe'
    }
  };

  fs.writeFileSync(builderConfigPath, JSON.stringify(baseConfig, null, 2), 'utf8');

  // Execute electron-builder against the staged configuration
  execSync(`npx electron-builder --config "${builderConfigPath}" --projectDir "${stagingDir}"`, {
    stdio: 'inherit',
    cwd: rootDir
  });

  // ---------------------------------------------------------------------------
  // Step 6: Apply Windows Authenticode Code Signing with RFC 3161 Timestamping
  // ---------------------------------------------------------------------------
  console.log(`\n[7/8] Signing Windows executables with Authenticode & DigiCert timestamping...`);
  execSync(`node scripts/sign-windows-binary.js`, { stdio: 'inherit', cwd: rootDir });

  // ---------------------------------------------------------------------------
  // Step 7: Generate Traceability Manifest & Anti-Reverse Verification
  // ---------------------------------------------------------------------------
  console.log(`\n[8/8] Generating traceability manifest and running anti-reverse verification...`);
  execSync(`node scripts/verify-desktop-build.js`, { stdio: 'inherit', cwd: rootDir });

  // Cleanup staging directory
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    console.log(`  ✓ Cleaned up transient staging directory.`);
  } catch {}

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n===============================================================`);
  console.log(`  ✓ Evolve AI Enterprise Studio Build Complete! (${elapsed}s)   `);
  console.log(`  Output directory: dist-desktop/                              `);
  console.log(`===============================================================\n`);
}

runProtectedBuild().catch(err => {
  console.error(`\n[FATAL ERROR] Protected build failed:`, err);
  process.exit(1);
});
