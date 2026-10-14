const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const rendererDir = path.resolve(__dirname, '..', 'src', 'desktop', 'renderer');
const rendererHtmlPath = path.resolve(rendererDir, 'index.html');
const outDir = path.resolve(__dirname, '..', 'docs', 'screenshots');

const baseHtml = fs.readFileSync(rendererHtmlPath, 'utf8');

const captureScript = `
  // Dismiss license gate
  const gate = document.getElementById('licenseGateOverlay');
  if (gate) gate.style.display = 'none';
  document.body.classList.remove('licensed-pending');

  // Go to Delivery Studio
  document.querySelector('[data-tab="delivery"]')?.click();
  document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
  const pane = document.getElementById('pane-delivery');
  if (pane) pane.style.display = 'block';

  // Show Phase 4
  document.querySelectorAll('.content-card').forEach(c => c.style.display = 'none');
  const p4 = document.getElementById('phase4Card');
  if (p4) p4.style.display = 'block';

  setTimeout(() => {
    try {
      const btnMultiAgent = document.getElementById('btnTabAiEngMultiAgent');
      if (btnMultiAgent) btnMultiAgent.click();

      // Trigger preset swarm to populate cards
      const btnPreset = document.getElementById('btnAiEngPresetSwarm');
      if (btnPreset) btnPreset.click();

      // Trigger run test
      setTimeout(() => {
        const btnRun = document.getElementById('btnAiEngRunMultiAgentTest');
        if (btnRun) btnRun.click();
      }, 500);
    } catch(e) {
      console.error(e);
    }
  }, 800);
`;

const injectedHtml = baseHtml.replace(
  '</body>',
  `<script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        try {
          ${captureScript}
        } catch(e) { console.error(e); }
      }, 300);
    });
  </script></body>`
);

const tempHtml = path.resolve(rendererDir, '__temp_multi_agent.html');
const outPng = path.resolve(outDir, '07_multi_agent_studio_four_way_matrix.png');
fs.writeFileSync(tempHtml, injectedHtml, 'utf8');

console.log('Capturing Multi-Agent Studio...');
try {
  const fileUrl = 'file:///' + tempHtml.replace(/\\/g, '/');
  const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --virtual-time-budget=4000 --window-size=1440,900 --hide-scrollbars --screenshot="${outPng}" "${fileUrl}"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log(`Saved: ${outPng}`);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  try { fs.unlinkSync(tempHtml); } catch(e) {}
}
