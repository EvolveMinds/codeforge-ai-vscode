const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const targetPng = path.resolve(__dirname, '..', 'docs', 'deck', 'shots', '00_full_app.png');

// Backup the original just in case
const backupPng = path.resolve(__dirname, '..', 'docs', 'deck', 'shots', '00_full_app_orig.png');
if (!fs.existsSync(backupPng)) {
  fs.copyFileSync(targetPng, backupPng);
  console.log('Backed up original to', backupPng);
}

// 00_full_app is 3200 x 2002
// We render full 3200x2002 canvas, load backupPng, patch v2.28.0 at exact coordinates, and output directly
const patchHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { margin: 0; background: #000; overflow: hidden; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
const img = new Image();
img.onload = () => {
  const canvas = document.getElementById('c');
  canvas.width = 3200;
  canvas.height = 2002;
  const ctx = canvas.getContext('2d');
  
  // 1. Draw entire 4K screenshot
  ctx.drawImage(img, 0, 0, 3200, 2002);

  // 2. Erase legacy v2.26.0 text from header version pill
  // Pill coordinates in 3200x2002: x: 1417..1514, y: 29..63
  ctx.fillStyle = '#26262c';
  ctx.fillRect(1417, 29, 97, 34);

  // 3. Draw genuine v2.28.0 in exact accent color and typography
  ctx.fillStyle = '#4ec9b0';
  ctx.font = '700 23px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('v2.28.0', 1422, 46);

  document.title = 'PATCHED_READY';
};
img.src = '00_full_app_orig.png';
</script>
</body>
</html>`;

const tempDir = path.resolve(__dirname, '..', 'docs', 'deck', 'shots');
const patchHtmlPath = path.resolve(tempDir, '__patch_full_app.html');
fs.writeFileSync(patchHtmlPath, patchHtml, 'utf8');

const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files --run-all-compositor-stages-before-draw --virtual-time-budget=3000 --window-size=3200,2002 --hide-scrollbars --screenshot="${targetPng}" "file:///${patchHtmlPath.replace(/\\/g, '/')}"`;
execSync(cmd, { stdio: 'inherit' });
console.log('Successfully updated docs/deck/shots/00_full_app.png to v2.28.0!');

// Clean up temp html
try { fs.unlinkSync(patchHtmlPath); } catch(e) {}
