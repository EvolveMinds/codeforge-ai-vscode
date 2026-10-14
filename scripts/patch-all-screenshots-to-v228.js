const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function patchImage(inputPath, outputPath, canvasW, canvasH, patchInstructions) {
  const tempDir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const backupPath = path.join(tempDir, `${baseName}_orig.png`);

  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(inputPath, backupPath);
    console.log(`Backed up original to ${backupPath}`);
  }

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
  canvas.width = ${canvasW};
  canvas.height = ${canvasH};
  const ctx = canvas.getContext('2d');
  
  // Draw base image
  ctx.drawImage(img, 0, 0, ${canvasW}, ${canvasH});

  // Apply patch instructions
  ${patchInstructions}

  document.title = 'PATCHED_READY';
};
img.src = '${path.basename(backupPath)}';
</script>
</body>
</html>`;

  const patchHtmlPath = path.join(tempDir, `__patch_${baseName}.html`);
  fs.writeFileSync(patchHtmlPath, patchHtml, 'utf8');

  const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files --run-all-compositor-stages-before-draw --virtual-time-budget=2500 --window-size=${canvasW},${canvasH} --hide-scrollbars --screenshot="${outputPath}" "file:///${patchHtmlPath.replace(/\\/g, '/')}"`;
  execSync(cmd, { stdio: 'ignore' });
  console.log(`Successfully patched: ${outputPath}`);

  try { fs.unlinkSync(patchHtmlPath); } catch(e) {}
}

console.log('--- Starting Systematic v2.28.0 Screenshot Patching ---');

// 1. 00_full_app.png (3200 x 2002)
patchImage(
  path.resolve(__dirname, '..', 'docs', 'deck', 'shots', '00_full_app.png'),
  path.resolve(__dirname, '..', 'docs', 'deck', 'shots', '00_full_app.png'),
  3200, 2002,
  `
    ctx.fillStyle = '#26262c';
    ctx.fillRect(1417, 29, 97, 34);
    ctx.fillStyle = '#4ec9b0';
    ctx.font = '700 23px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('v2.28.0', 1422, 46);
  `
);

// 2. 01_schema_topology_2d_3d.png (1440 x 900)
patchImage(
  path.resolve(__dirname, '..', 'docs', 'screenshots', '01_schema_topology_2d_3d.png'),
  path.resolve(__dirname, '..', 'docs', 'screenshots', '01_schema_topology_2d_3d.png'),
  1440, 900,
  `
    // Pill bounds: x: 638..724, y: 12..38
    ctx.fillStyle = '#1e1e24';
    ctx.fillRect(648, 14, 72, 22);
    // Draw v2.28.0
    ctx.fillStyle = '#4ec9b0';
    ctx.font = '700 11.5px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('v2.28.0', 650, 25);
    // Draw 'Up to date'
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 9px system-ui, -apple-system, sans-serif';
    ctx.fillText('Up to date', 693, 25);
  `
);

// 3. 03_schema_topology_2d_3d_real.png (1024 x 545)
patchImage(
  path.resolve(__dirname, '..', 'docs', 'screenshots', '03_schema_topology_2d_3d_real.png'),
  path.resolve(__dirname, '..', 'docs', 'screenshots', '03_schema_topology_2d_3d_real.png'),
  1024, 545,
  `
    // Erase v2.26.0 (x: 543..568, y: 26..38)
    ctx.fillStyle = '#1c1d22';
    ctx.fillRect(543, 26, 26, 12);
    ctx.fillStyle = '#4ec9b0';
    ctx.font = '700 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('v2.28.0', 543, 32);
  `
);

// 4. 04_ai_solutioning_phase3_real.png (1024 x 546)
patchImage(
  path.resolve(__dirname, '..', 'docs', 'screenshots', '04_ai_solutioning_phase3_real.png'),
  path.resolve(__dirname, '..', 'docs', 'screenshots', '04_ai_solutioning_phase3_real.png'),
  1024, 546,
  `
    // Erase v2.26.0 (x: 543..568, y: 26..38)
    ctx.fillStyle = '#1c1d22';
    ctx.fillRect(543, 26, 26, 12);
    ctx.fillStyle = '#4ec9b0';
    ctx.font = '700 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('v2.28.0', 543, 32);
  `
);

// 5. 05_3d_visual_analytics_manifold_real.png (1024 x 538)
patchImage(
  path.resolve(__dirname, '..', 'docs', 'screenshots', '05_3d_visual_analytics_manifold_real.png'),
  path.resolve(__dirname, '..', 'docs', 'screenshots', '05_3d_visual_analytics_manifold_real.png'),
  1024, 538,
  `
    // Erase v2.26.0 (x: 543..568, y: 26..38)
    ctx.fillStyle = '#1c1d22';
    ctx.fillRect(543, 26, 26, 12);
    ctx.fillStyle = '#4ec9b0';
    ctx.font = '700 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('v2.28.0', 543, 32);
  `
);

console.log('--- All Screenshots Successfully Patched to v2.28.0! ---');
