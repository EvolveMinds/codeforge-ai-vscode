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

// Also sync full out/desktop to VS Code installed extension directory if present
try {
  const os = require('os');
  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
  if (fs.existsSync(extensionsDir)) {
    const extDirs = fs.readdirSync(extensionsDir).filter(d => d.startsWith('codeforge-ai.evolve-ai-'));
    for (const extDir of extDirs) {
      const targetDesktop = path.join(extensionsDir, extDir, 'out', 'desktop');
      const sourceDesktop = path.join(__dirname, '..', 'out', 'desktop');
      if (fs.existsSync(sourceDesktop)) {
        copyRecursive(sourceDesktop, targetDesktop);
        console.log(`✓ Synchronized out/desktop to VS Code extension: ${extDir}`);
      }
    }
  }
} catch (e) {
  // non-fatal
}

