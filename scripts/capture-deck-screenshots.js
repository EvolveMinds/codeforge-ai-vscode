const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const rendererDir = path.resolve(__dirname, '..', 'src', 'desktop', 'renderer');
const rendererHtmlPath = path.resolve(rendererDir, 'index.html');
const outDir = path.resolve(__dirname, '..', 'docs', 'screenshots');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const baseHtml = fs.readFileSync(rendererHtmlPath, 'utf8');

const views = [
  {
    name: '01_schema_topology_2d_3d',
    title: 'Interactive 2D & 3D Schema Topology & Column Linking',
    script: `
      // Dismiss license gate
      const gate = document.getElementById('licenseGateOverlay');
      if (gate) gate.style.display = 'none';

      // Set community/enterprise unlocked state
      document.body.classList.remove('licensed-pending');

      // Click delivery tab
      document.querySelector('[data-tab="delivery"]')?.click();
      
      // Show Phase 2
      document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
      const pane = document.getElementById('pane-delivery');
      if (pane) pane.style.display = 'block';

      document.querySelectorAll('.content-card').forEach(c => c.style.display = 'none');
      const p2 = document.getElementById('phase2Card');
      if (p2) p2.style.display = 'block';

      const cosmos = document.getElementById('subpanelCosmosView');
      if (cosmos) cosmos.style.display = 'block';

      // Switch to 2D Technical ERD
      setTimeout(() => {
        try {
          if (window.refreshP2CosmosTopology) window.refreshP2CosmosTopology();
          const btn2d = document.getElementById('btnP2CosmosMode2D');
          if (btn2d) btn2d.click();
        } catch(e) {}
      }, 300);
    `
  },
  {
    name: '02_live_db_introspector_modal',
    title: 'Universal Live Database Connection & Introspection Matrix',
    script: `
      const gate = document.getElementById('licenseGateOverlay');
      if (gate) gate.style.display = 'none';

      document.querySelector('[data-tab="delivery"]')?.click();
      document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
      document.getElementById('pane-delivery').style.display = 'block';

      const modal = document.getElementById('modalLiveDbConnect');
      if (modal) {
        modal.style.display = 'flex';
        modal.style.zIndex = '999999';
      }
    `
  },
  {
    name: '03_ai_solutioning_contract',
    title: 'Phase 3: AI Solutioning Contract, Capability Ladder & Rule-vs-Model Gate',
    script: `
      const gate = document.getElementById('licenseGateOverlay');
      if (gate) gate.style.display = 'none';

      document.querySelector('[data-tab="delivery"]')?.click();
      document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
      document.getElementById('pane-delivery').style.display = 'block';

      document.querySelectorAll('.content-card').forEach(c => c.style.display = 'none');
      const p3 = document.getElementById('phase3Card');
      if (p3) p3.style.display = 'block';
    `
  },
  {
    name: '04_data_analysis_reporting_studio',
    title: 'Executive Reporting Studio & Sandboxed HTML Dashboard Previews',
    script: `
      const gate = document.getElementById('licenseGateOverlay');
      if (gate) gate.style.display = 'none';

      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-tab="data"]')?.classList.add('active');

      document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
      const pane = document.getElementById('pane-data');
      if (pane) pane.style.display = 'block';
    `
  },
  {
    name: '05_code_converter_26lang',
    title: '26-Language Code Converter & AST Transpiler Studio',
    script: `
      const gate = document.getElementById('licenseGateOverlay');
      if (gate) gate.style.display = 'none';

      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-tab="converter"]')?.classList.add('active');

      document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
      const pane = document.getElementById('pane-converter');
      if (pane) pane.style.display = 'block';
    `
  },
  {
    name: '06_security_preflight_scanner',
    title: 'Security Scanner, PII Sanitizer & Pre-Flight Health Auditor',
    script: `
      const gate = document.getElementById('licenseGateOverlay');
      if (gate) gate.style.display = 'none';

      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-tab="security"]')?.classList.add('active');

      document.querySelectorAll('.phase-pane').forEach(p => p.style.display = 'none');
      const pane = document.getElementById('pane-security');
      if (pane) pane.style.display = 'block';
    `
  }
];

views.forEach(v => {
  const injectedHtml = baseHtml.replace(
    '</body>',
    `<script>
      window.addEventListener('DOMContentLoaded', () => {
        try {
          ${v.script}
        } catch(e) { console.error(e); }
      });
    </script></body>`
  );

  // Save the temp html file directly inside rendererDir so all relative paths (styles, scripts) resolve!
  const tempHtml = path.resolve(rendererDir, `__temp_${v.name}.html`);
  const outPng = path.resolve(outDir, `${v.name}.png`);

  fs.writeFileSync(tempHtml, injectedHtml, 'utf8');

  console.log(`Capturing ${v.name}...`);
  try {
    const fileUrl = 'file:///' + tempHtml.replace(/\\/g, '/');
    const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --virtual-time-budget=2500 --window-size=1440,900 --hide-scrollbars --screenshot="${outPng}" "${fileUrl}"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log(`Saved: ${outPng}`);
  } catch (e) {
    console.error(`Error on ${v.name}:`, e.message);
  } finally {
    try { fs.unlinkSync(tempHtml); } catch(e) {}
  }
});

console.log('Finished capturing desktop application views.');
