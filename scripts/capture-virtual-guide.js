const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const rendererDir = path.resolve(__dirname, '..', 'src', 'desktop', 'renderer');
const rendererHtmlPath = path.resolve(rendererDir, 'index.html');
const outDir = path.resolve(__dirname, '..', 'docs', 'screenshots');

const baseHtml = fs.readFileSync(rendererHtmlPath, 'utf8');

const captureScript = `
  const gate = document.getElementById('licenseGateOverlay');
  if (gate) gate.style.display = 'none';
  document.body.classList.remove('licensed-pending');

  document.querySelector('[data-tab="delivery"]')?.click();
  document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
  const pane = document.getElementById('pane-delivery');
  if (pane) pane.style.display = 'block';

  document.querySelectorAll('.content-card').forEach(c => c.style.display = 'none');
  const p3 = document.getElementById('phase3Card');
  if (p3) p3.style.display = 'block';

  const drawer = document.getElementById('appHelpGuideDrawer');
  if (drawer) {
    drawer.style.display = 'flex';
  }

  // Add a sample query and answer into the chat
  const chatContainer = document.getElementById('helpGuideChatContainer');
  if (chatContainer) {
    chatContainer.innerHTML += \`
      <div style="background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px; padding: 10px; margin-bottom: 10px; font-size: 11px;">
        <div style="font-weight: 700; color: #a5b4fc; margin-bottom: 4px;">User: How do I configure Multi-Agent Swarm with DB2 / Oracle write-back?</div>
        <div style="color: #e2e8f0; line-height: 1.4;">Navigate to <strong>Phase 4 &rarr; Multi-Agent Studio</strong>. Enable the <em>Four-Way Communication Matrix</em>, connect your enterprise schema via the Two-Phase Commit (2PC) write-back bridge, and select your Vector DB Storage tier (pgvector/Pinecone).</div>
      </div>
    \`;
  }
`;

const injectedHtml = baseHtml.replace(
  '</body>',
  `<script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        try {
          ${captureScript}
        } catch(e) { console.error(e); }
      }, 400);
    });
  </script></body>`
);

const tempHtml = path.resolve(rendererDir, '__temp_guide.html');
const outPng = path.resolve(outDir, '08_in_app_virtual_guide_drawer.png');
fs.writeFileSync(tempHtml, injectedHtml, 'utf8');

console.log('Capturing Virtual Guide...');
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
