/**
 * scripts/copy-desktop-assets.js
 * Copies HTML, CSS, and static assets from src/desktop/renderer to out/desktop/renderer
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'desktop', 'renderer');
const outDir = path.join(__dirname, '..', 'out', 'desktop', 'renderer');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (entry.isFile() && !entry.name.endsWith('.ts')) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[Desktop Assets] Copied: ${entry.name}`);
    }
  }
}

copyRecursive(srcDir, outDir);
console.log('✓ Desktop renderer assets synced to out/desktop/renderer/');

/*
 * Emit the offline flowchart renderer as a classic browser script.
 *
 * The Electron renderer runs with contextIsolation:true and nodeIntegration:false,
 * and index.html loads renderer.js with a plain <script> tag — there is no module
 * loader and no bundler in this build. renderer.ts therefore has no real imports:
 * adding one makes tsc emit a require() call that throws at runtime and brings the
 * window up blank.
 *
 * So rather than importing the module, we wrap its compiled CommonJS output in a
 * three-line shim that supplies the `exports` object it expects and hangs the
 * result off globalThis. One source file, one compile, no duplicated parser, and
 * no new dependency — which is what keeps the air-gap promise intact.
 *
 * Runs before the VS Code sync below so the emitted file is copied along with it.
 */
try {
  const modulePath = path.join(__dirname, '..', 'out', 'offline', 'flowchartRenderer.js');
  if (fs.existsSync(modulePath)) {
    const body = fs.readFileSync(modulePath, 'utf8');

    // A require() here would throw in the renderer, so fail the build loudly
    // rather than shipping a blank window.
    if (/\brequire\s*\(/.test(body)) {
      console.error('[Desktop Assets] flowchartRenderer.js contains require() — it cannot be ' +
        'loaded as a classic script. Remove the top-level import that introduced it.');
      process.exit(1);
    }

    const shimmed =
      '(function(){var exports={};var module={exports:exports};\n' +
      body +
      '\nglobalThis.EvolveFlowchart=exports;})();\n';

    const dest = path.join(__dirname, '..', 'out', 'desktop', 'renderer', 'flowchart.js');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, shimmed);
    console.log('[Desktop Assets] Emitted: flowchart.js (classic-script shim)');
  }
} catch (e) {
  console.error('[Desktop Assets] Could not emit flowchart.js:', e.message);
  process.exit(1);
}

// Also sync full out/ directory to VS Code installed extension directories if present
try {
  const os = require('os');
  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
  if (fs.existsSync(extensionsDir)) {
    const extDirs = fs.readdirSync(extensionsDir).filter(d => d.includes('evolve-ai'));
    const sourceOut = path.join(__dirname, '..', 'out');
    for (const extDir of extDirs) {
      const targetOut = path.join(extensionsDir, extDir, 'out');
      if (fs.existsSync(sourceOut)) {
        copyRecursive(sourceOut, targetOut);
        console.log(`✓ Synchronized full out/ to VS Code extension: ${extDir}`);
      }
    }
  }
} catch (e) {
  // non-fatal
}

