const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const rendererDir = path.resolve(__dirname, '..', 'src', 'desktop', 'renderer');
const rendererHtmlPath = path.resolve(rendererDir, 'index.html');
const outDir = path.resolve(__dirname, '..', 'docs', 'screenshots');

const baseHtml = fs.readFileSync(rendererHtmlPath, 'utf8');

const script2D = `
  const gate = document.getElementById('licenseGateOverlay');
  if (gate) gate.style.display = 'none';

  document.querySelector('[data-tab="delivery"]')?.click();
  document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
  const pane = document.getElementById('pane-delivery');
  if (pane) pane.style.display = 'block';

  document.querySelectorAll('.content-card').forEach(c => c.style.display = 'none');
  const p2 = document.getElementById('phase2Card');
  if (p2) p2.style.display = 'block';

  const btnCosmos = document.getElementById('btnP2OpenCosmos');
  if (btnCosmos) {
    btnCosmos.click();
  }

  const p2StepB = document.getElementById('p2StepBPanel');
  if (p2StepB) {
    p2StepB.removeAttribute('hidden');
    p2StepB.style.display = 'block';
  }

  const cosmosView = document.getElementById('subpanelCosmosView');
  if (cosmosView) cosmosView.style.display = 'block';
`;

const injectedHtml = baseHtml.replace(
  '</body>',
  `<script>
    window.addEventListener('DOMContentLoaded', () => {
      try {
        ${script2D}
      } catch(e) { console.error(e); }
    });
  </script></body>`
);

const tempHtml = path.resolve(rendererDir, `__temp_01_schema_topology.html`);
const outPng = path.resolve(outDir, `01_schema_topology_2d_3d.png`);
fs.writeFileSync(tempHtml, injectedHtml, 'utf8');

console.log('Capturing refreshed 01_schema_topology_2d_3d...');
try {
  const fileUrl = 'file:///' + tempHtml.replace(/\\/g, '/');
  const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --virtual-time-budget=3000 --window-size=1440,900 --hide-scrollbars --screenshot="${outPng}" "${fileUrl}"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log(`Saved: ${outPng}`);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  try { fs.unlinkSync(tempHtml); } catch(e) {}
}
