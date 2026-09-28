const base = require('./shots.js');
const setup = base.find(s => s.name === 'setup');
const restore = base.find(s => s.name === 'restore');
const H = setup.js.split('window.__prevZoom')[0];
const shot = (name, js, extra = {}) => ({ name, js: H + js + '\nclean();', after: H + 'clean();', afterWait: 600, ...extra });
module.exports = [
  setup,
  shot('22_models_grid', `
      tab('delivery'); await sleep(300);
      $('.phase-nav-btn[data-phase="3"]')?.click(); await sleep(600);
      $('#btnP3StepC')?.click(); await sleep(1200);
      const g = $('#advisorModelGrid');
      document.querySelector('.advisor-model-card[data-model="lcm"]')?.click(); await sleep(800);
      top(g && g.parentElement);`, { wait: 3000 }),
  shot('52_deploy_hub', `
      $('.phase-nav-btn[data-phase="5"]')?.click(); await sleep(600);
      $('#btnP5StepB')?.click(); await sleep(1000);
      top($('#p5StepBPanel'));`, { wait: 2500 }),
  shot('53_deploy_files', `
      $('#btnScaffoldDeployExact')?.click(); await sleep(3500);
      top($('#p3ResultBox'));`, { wait: 2500 }),
  shot('60_git_hub', `
      $('.phase-nav-btn[data-phase="6"]')?.click(); await sleep(1500);
      top($('#phase6Card'));`, { wait: 3500 }),
  shot('61_git_wizard', `
      $('#btnDeliveryGitSetup')?.click(); await sleep(1500);
      top($('#btnCloseGitWizard')?.closest('div[id]'));`, { wait: 2500 }),
  shot('10_erd_full', `
      $('.phase-nav-btn[data-phase="2"]')?.click(); await sleep(600);
      $('#btnP2OpenCosmos')?.click(); await sleep(1200);
      $('#btnP2CosmosMode2D')?.click(); await sleep(800);
      top($('#subpanelCosmosView') || $('#phase2Card'));`, { wait: 3500 }),
  restore,
];
