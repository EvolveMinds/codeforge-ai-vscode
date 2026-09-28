// Shared page helpers, prepended to every shot.
const H = `
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = () => {
  const d = $('#terminalDrawer'); if (d) d.style.display = 'none';
  const r = $('#terminalResizer'); if (r) r.style.display = 'none';
  document.querySelectorAll('.toast, #toastContainer > *').forEach(t => t.remove());
  [...document.querySelectorAll('header button, header .header-pill')].filter(b => /Test Org/.test(b.textContent)).forEach(b => b.style.visibility = 'hidden');
  document.querySelectorAll('[id^="pane-"]').forEach(p => {});
};
const tab = t => { const b = [...document.querySelectorAll('.activity-btn[data-tab="'+t+'"]')][0] || $('[data-tab="'+t+'"]'); b && b.click(); };
const top = el => { if (el) el.scrollIntoView({ block: 'start' }); };
`;
const shot = (name, js, extra = {}) => ({ name, js: H + js + '\nclean();', after: H + 'clean();', afterWait: 600, ...extra });

module.exports = [
  { name: 'setup', noShot: true, wait: 1500, js: H + `
      window.__prevZoom = localStorage.getItem('evolve_desktop_zoom_factor');
      $('#btnZoomReset')?.click(); clean();` },

  shot('10_schema_erd_2d', `
      tab('delivery'); await sleep(300);
      $('.phase-nav-btn[data-phase="2"]')?.click(); await sleep(600);
      $('#btnP2OpenCosmos')?.click(); await sleep(1200);
      $('#btnP2CosmosMode2D')?.click(); await sleep(800);
      top($('#subpanelCosmosView') || $('#phase2Card'));`, { wait: 3500 }),

  shot('11_schema_3d', `
      $('#btnP2CosmosMode3D')?.click();`, { wait: 4000 }),

  shot('20_ai_solutioning_ladder', `
      tab('delivery'); $('.phase-nav-btn[data-phase="3"]')?.click(); await sleep(600);
      $('#btnP3StepA')?.click(); await sleep(400);
      $('#btnEvaluateRuleModel')?.click(); await sleep(1200);
      top($('#phase3Card'));`, { wait: 3000 }),

  shot('21_ai_solutioning_rag', `
      $('#btnP3StepC')?.click(); await sleep(800);
      $('#btnRagViewVisual')?.click(); await sleep(800);
      top($('#p3StepCPanel'));`, { wait: 3500 }),


  shot('30_data_studio_demo', `
      document.querySelectorAll('.modal, [id^="modal"]').forEach(m => { if (getComputedStyle(m).position === 'fixed') m.style.display = 'none'; });
      tab('data'); await sleep(600);
      $('.data-domain-pill[data-domain="climate"]')?.click(); await sleep(500);
      $('#cardDemoStarSchema')?.click(); await sleep(1500);
      top($('#cardDemoStarSchema'));`, { wait: 2500 }),

  shot('31_data_3d_manifold', `
      $('#btnLaunch3DManifoldDirect')?.click(); await sleep(3000);
      $('#btnSingle3DModeSurface')?.click(); await sleep(1500);
      top($('#btnDataView3DManifold')?.closest('.content-card') || $('#btnSingle3DModeSurface'));`, { wait: 5000 }),

  shot('40_code_converter', `
      tab('converter'); await sleep(600);
      [...document.querySelectorAll('button')].find(b => /Load Sample Code/.test(b.textContent))?.click();`, { wait: 2500 }),

  shot('50_hardware', `tab('hardware'); await sleep(800); top($('#pane-hardware'));`, { wait: 3500 }),
  shot('60_cloud', `tab('cloud'); await sleep(800); top($('#pane-cloud'));`, { wait: 2500 }),
  shot('70_security', `tab('security'); await sleep(300);
      [...document.querySelectorAll('button')].find(b => /Run Full Security Scan/.test(b.textContent))?.click();`, { wait: 4000 }),
  { name: "restore", noShot: true, wait: 200, js: "if (window.__prevZoom) localStorage.setItem('evolve_desktop_zoom_factor', window.__prevZoom);" },
];
