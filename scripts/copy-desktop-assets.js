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
