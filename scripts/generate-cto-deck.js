const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const screenshotDir = path.resolve(__dirname, '..', 'docs', 'screenshots');
const deckShotsDir = path.resolve(__dirname, '..', 'docs', 'deck', 'shots');

function getBase64Image(filePath) {
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString('base64')}`;
  }
  console.warn(`Warning: Image not found at ${filePath}`);
  return '';
}

// Load screenshots
const img00_fullapp = getBase64Image(path.join(deckShotsDir, '00_full_app.png'));
const img01_cockpit = getBase64Image(path.join(screenshotDir, '01_schema_topology_2d_3d.png'));
const img02_livedb = getBase64Image(path.join(screenshotDir, '02_live_db_introspector_modal.png'));
const img03_topology = getBase64Image(path.join(screenshotDir, '03_schema_topology_2d_3d_real.png'));
const img04_solutioning = getBase64Image(path.join(screenshotDir, '04_ai_solutioning_phase3_real.png'));
const img05_3dmanifold = getBase64Image(path.join(screenshotDir, '05_3d_visual_analytics_manifold_real.png'));
const img06_converter = getBase64Image(path.join(screenshotDir, '05_code_converter_26lang.png'));
const img07_security = getBase64Image(path.join(screenshotDir, '06_security_preflight_scanner.png'));
const img08_multiagent = getBase64Image(path.join(screenshotDir, '07_multi_agent_studio_four_way_matrix.png'));
const img09_virtualguide = getBase64Image(path.join(screenshotDir, '08_in_app_virtual_guide_drawer.png'));
const img10_dagcanvas = getBase64Image(path.join(screenshotDir, 'phase4_canvas_full_view.png'));
const img11_deployfiles = getBase64Image(path.join(deckShotsDir, '53_deploy_files.png'));
const img12_github = getBase64Image(path.join(deckShotsDir, '60_git_hub.png'));

console.log('Loaded all genuine product screenshots into memory for CTO deck.');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Evolve AI Delivery Studio — Head of Technology / VP of Engineering / CTO Deck</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

    @page {
      size: 1920px 1080px;
      margin: 0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      background-color: #060911;
      color: #f1f5f9;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      margin: 0;
      padding: 0;
    }

    .slide {
      width: 1920px;
      height: 1080px;
      page-break-after: always;
      break-after: page;
      position: relative;
      overflow: hidden;
      background: #080c16;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 42px 76px 32px 76px;
    }

    /* Ambient Glows */
    .slide::before {
      content: '';
      position: absolute;
      top: -240px;
      right: -240px;
      width: 800px;
      height: 800px;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, rgba(14, 165, 233, 0) 70%);
      pointer-events: none;
      z-index: 0;
    }

    .slide::after {
      content: '';
      position: absolute;
      bottom: -240px;
      left: -240px;
      width: 720px;
      height: 720px;
      background: radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, rgba(99, 102, 241, 0.05) 50%, rgba(0, 0, 0, 0) 75%);
      pointer-events: none;
      z-index: 0;
    }

    .content-layer {
      position: relative;
      z-index: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    /* Top Bar */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .brand-pill {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(56, 189, 248, 0.35);
      padding: 6px 18px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #38bdf8;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
      font-weight: 600;
      color: #89d185;
      background: rgba(137, 209, 133, 0.12);
      border: 1px solid rgba(137, 209, 133, 0.3);
      padding: 5px 15px;
      border-radius: 9999px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background-color: #89d185;
      border-radius: 50%;
    }

    /* Headings */
    .heading-group {
      margin-bottom: 10px;
    }

    .category-kicker {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #4ec9b0;
      margin-bottom: 4px;
      display: block;
    }

    .main-title {
      font-size: 36px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: #ffffff;
      margin-bottom: 4px;
    }

    /* SOLID HIGH-CONTRAST HIGHLIGHTS (Prints reliably in PDF) */
    .highlight-cyan {
      color: #38bdf8 !important;
      display: inline !important;
    }

    .highlight-purple {
      color: #c084fc !important;
      display: inline !important;
    }

    .highlight-green {
      color: #34d399 !important;
      display: inline !important;
    }

    .highlight-ochre {
      color: #fbbf24 !important;
      display: inline !important;
    }

    .highlight-red {
      color: #f43f5e !important;
      display: inline !important;
    }

    .subtitle {
      font-size: 16.5px;
      line-height: 1.38;
      color: #94a3b8;
      font-weight: 500;
      max-width: 1560px;
    }

    /* Slide 1 Hero Split Layout */
    .slide1-hero-split {
      display: grid;
      grid-template-columns: 780px 1fr;
      gap: 34px;
      align-items: center;
      flex: 1;
      margin: 8px 0;
    }

    .slide1-left {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .slide1-right {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .hero-solution-card {
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(51, 65, 85, 0.7);
      border-left: 4px solid #38bdf8;
      border-radius: 10px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .hero-solution-card.red {
      border-left-color: #f43f5e;
      background: linear-gradient(90deg, rgba(244, 63, 94, 0.08) 0%, rgba(15, 23, 42, 0.88) 100%);
    }

    .hero-solution-card.green {
      border-left-color: #10b981;
      background: linear-gradient(90deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.88) 100%);
    }

    .hero-solution-card.purple {
      border-left-color: #a855f7;
      background: linear-gradient(90deg, rgba(168, 85, 247, 0.08) 0%, rgba(15, 23, 42, 0.88) 100%);
    }

    .hero-solution-card.ochre {
      border-left-color: #f59e0b;
      background: linear-gradient(90deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.88) 100%);
    }

    .hero-solution-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .hero-solution-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hero-solution-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
    }

    .hero-solution-desc {
      font-size: 13px;
      line-height: 1.42;
      color: #94a3b8;
    }

    .hero-solution-desc strong {
      color: #e2e8f0;
    }

    .hero-screenshot-frame {
      background: #0f172a;
      border: 1.5px solid rgba(56, 189, 248, 0.45);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(56, 189, 248, 0.12);
    }

    .hero-screenshot-img {
      width: 100%;
      height: 570px;
      display: block;
      object-fit: cover;
      object-position: top center;
      background: #060911;
    }

    .hero-badges-row {
      display: flex;
      gap: 10px;
      justify-content: space-between;
    }

    .hero-badge-pill {
      flex: 1;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 700;
      color: #cbd5e1;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .hero-bottom-bar {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 12px;
      color: #cbd5e1;
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
    }

    /* Standard Slide Splits */
    .slide-body-split {
      display: grid;
      grid-template-columns: 1.25fr 0.75fr;
      gap: 32px;
      align-items: center;
      flex: 1;
      margin: 8px 0;
    }

    .screenshot-frame {
      background: #0f172a;
      border: 1.5px solid rgba(56, 189, 248, 0.4);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75);
      position: relative;
    }

    .screenshot-frame-header {
      background: rgba(30, 41, 59, 0.95);
      padding: 7px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .window-dots {
      display: flex;
      gap: 6px;
    }

    .window-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .dot-red { background: #ef4444; }
    .dot-yellow { background: #f59e0b; }
    .dot-green { background: #10b981; }

    .window-caption {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #94a3b8;
      font-weight: 600;
    }

    .screenshot-img {
      width: 100%;
      height: auto;
      max-height: 615px;
      display: block;
      object-fit: contain;
      background: #060911;
    }

    /* Split Screenshots Container */
    .split-shots-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      min-height: 0;
    }

    /* Cards & Feature Callouts */
    .features-list {
      display: flex;
      flex-direction: column;
      gap: 13px;
    }

    .feature-card {
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(51, 65, 85, 0.8);
      border-radius: 12px;
      padding: 16px 20px;
      position: relative;
    }

    .feature-card.accent {
      border-left: 5px solid #38bdf8;
      background: linear-gradient(90deg, rgba(56, 189, 248, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%);
    }

    .feature-card.green {
      border-left: 5px solid #10b981;
      background: linear-gradient(90deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%);
    }

    .feature-card.ochre {
      border-left: 5px solid #f59e0b;
      background: linear-gradient(90deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%);
    }

    .feature-card.purple {
      border-left: 5px solid #a855f7;
      background: linear-gradient(90deg, rgba(168, 85, 247, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%);
    }

    .feature-title {
      font-size: 16.5px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .feature-desc {
      font-size: 14px;
      line-height: 1.45;
      color: #94a3b8;
    }

    .feature-desc code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      background: rgba(0, 0, 0, 0.4);
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .feature-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 5px;
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
      margin-left: auto;
    }

    /* 6 Phases Grid for Slide 2 */
    .grid-phases {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      flex: 1;
    }

    .phase-tile {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 10px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .phase-tile-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .phase-tile-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 800;
      color: #38bdf8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .phase-tile-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
    }

    .phase-tile-desc {
      font-size: 12.5px;
      color: #94a3b8;
      line-height: 1.4;
    }

    /* Comparison Table */
    .table-container {
      margin: 10px 0;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(51, 65, 85, 0.8);
      background: rgba(15, 23, 42, 0.7);
    }

    .scorecard-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    .scorecard-table th {
      background: rgba(30, 41, 59, 0.85);
      padding: 12px 18px;
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #cbd5e1;
      border-bottom: 1px solid rgba(51, 65, 85, 0.8);
    }

    .scorecard-table td {
      padding: 12px 18px;
      font-size: 14px;
      color: #94a3b8;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
    }

    .scorecard-table tr:last-child td {
      border-bottom: none;
    }

    .scorecard-table td:first-child {
      font-weight: 700;
      color: #ffffff;
    }

    .scorecard-table td:nth-child(2) {
      color: #f87171;
    }

    .scorecard-table td:last-child {
      color: #34d399;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.08);
    }

    /* Footer */
    .slide-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid rgba(51, 65, 85, 0.6);
      margin-top: 6px;
    }

    .footer-brand {
      font-size: 13.5px;
      font-weight: 600;
      color: #64748b;
    }

    .footer-brand strong {
      color: #cbd5e1;
    }

    .footer-page {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
      font-weight: 700;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 4px 12px;
      border-radius: 6px;
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
  </style>
</head>
<body>

  <!-- ==================== SLIDE 1: COMBINED EXECUTIVE HERO & FAILURE MODES SOLVED ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>EVOLVE MIND SOLUTIONS &bull; ENTERPRISE DELIVERY STUDIO</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>v2.28.0 PRODUCTION RELEASE &bull; AIR-GAP CERTIFIED</span></div>
        </div>

        <div class="slide1-hero-split">
          <!-- Left: Problem & Solved Architecture -->
          <div class="slide1-left">
            <div class="heading-group">
              <span class="category-kicker">ENTERPRISE ENGINEERING ARCHITECTURE &amp; PRODUCTION COCKPIT</span>
              <h1 class="main-title" style="font-size: 34px;">
                Evolve AI Enterprise <span class="highlight-cyan">Delivery Studio</span>
              </h1>
              <p class="subtitle" style="font-size: 15.5px;">
                The Air-Gapped Engineering Cockpit for Forward Deployed AI — Built to solve the 4 critical failure modes of enterprise GenAI deployments.
              </p>
            </div>

            <!-- 4 Failure Mode Solutions -->
            <div class="hero-solution-card red">
              <div class="hero-solution-header">
                <div class="hero-solution-title"><span>🔒</span> 01. Data Exfiltration &amp; CISO Veto</div>
                <span class="hero-solution-badge" style="color:#34d399; border-color:#34d399; background:rgba(16,185,129,0.15);">100% AIR-GAPPED</span>
              </div>
              <div class="hero-solution-desc">
                <strong>Solved:</strong> 100% offline local inference (<code>Ollama</code>, <code>local Gemma</code>, <code>vLLM</code>) with zero outbound network calls. Credentials encrypted in native OS keyrings (Windows DPAPI, macOS Keychain).
              </div>
            </div>

            <div class="hero-solution-card green">
              <div class="hero-solution-header">
                <div class="hero-solution-title"><span>⚖️</span> 02. Nondeterministic Silent Drift</div>
                <span class="hero-solution-badge">&lt;5MS &bull; 0% DRIFT</span>
              </div>
              <div class="hero-solution-desc">
                <strong>Solved:</strong> Mathematical Rule-First Decision Gates evaluate latency &amp; arithmetic, locking <strong>Level 1 deterministic rules</strong> over LLMs. Hybrid RAG (HNSW + BM25) delivers 100% SKU/domain recall.
              </div>
            </div>

            <div class="hero-solution-card ochre">
              <div class="hero-solution-header">
                <div class="hero-solution-title"><span>💸</span> 03. Runaway Token OpEx &amp; GPU Sinkhole</div>
                <span class="hero-solution-badge" style="color:#fbbf24; border-color:#fbbf24; background:rgba(245,158,11,0.15);">HARDWARE SIZED</span>
              </div>
              <div class="hero-solution-desc">
                <strong>Solved:</strong> Automatically profiles host CPU/RAM/VRAM to fit local models before download; eliminates unpredictable per-token SaaS invoices and external GPU cluster lease overhead.
              </div>
            </div>

            <div class="hero-solution-card purple">
              <div class="hero-solution-header">
                <div class="hero-solution-title"><span>🍝</span> 04. Spaghetti "Glue-Code" Technical Debt</div>
                <span class="hero-solution-badge" style="color:#c084fc; border-color:#c084fc; background:rgba(168,85,247,0.15);">4-WAY QUAD BUS</span>
              </div>
              <div class="hero-solution-desc">
                <strong>Solved:</strong> Multi-Agent Studio unifies App Bus, A2A Mesh, Vector DB, and Client DB with Oracle/DB2 2PC write-back, plus 1-click Terraform &amp; Kubernetes production scaffolding.
              </div>
            </div>

            <div class="hero-bottom-bar">
              <span><strong>PERIMETER:</strong> Air-Gapped On-Prem &bull; Private VPC</span>
              <span><strong>INTEGRITY:</strong> Zero Guesswork &bull; 100/100 Security Score</span>
            </div>
          </div>

          <!-- Right: Hero 4K Desktop Cockpit Screenshot -->
          <div class="slide1-right">
            <div class="hero-screenshot-frame">
              <div class="screenshot-frame-header">
                <div class="window-dots">
                  <div class="window-dot dot-red"></div>
                  <div class="window-dot dot-yellow"></div>
                  <div class="window-dot dot-green"></div>
                </div>
                <div class="window-caption">Evolve AI Delivery Studio — Full Multi-Phase Engineering Cockpit (3200x2002 4K)</div>
              </div>
              <img src="${img00_fullapp}" class="hero-screenshot-img" alt="Evolve AI Full Desktop Cockpit" />
            </div>

            <div class="hero-badges-row">
              <div class="hero-badge-pill"><span>🌐</span> 6-Phase Systematic Lifecycle</div>
              <div class="hero-badge-pill"><span>🤖</span> 4-Way Multi-Agent Quad Bus</div>
              <div class="hero-badge-pill"><span>🌿</span> Dedicated Green Leaf Git Hub</div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Evolve Mind Solutions Pty Ltd</strong> &bull; Melbourne, Australia &bull; support@evolveminds.com.au
        </div>
        <div class="footer-page">Slide 01 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 2: 6-PHASE DELIVERY LIFECYCLE ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>DELIVERY STUDIO &bull; 6-PHASE RUNBOOK</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>SYSTEMATIC DELIVERY</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">AUDITABLE, REPEATABLE CLIENT ENGAGEMENT RUNBOOK</span>
          <h2 class="main-title">
            One Unified Studio Following the <span class="highlight-cyan">Whole Client Engagement</span>
          </h2>
          <p class="subtitle">
            Move seamlessly from boardroom scoping to production-grade deployment within a single cockpit engineered specifically for Forward Deployed Engineering teams.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Evolve AI Desktop Cockpit — 6-Phase Delivery Studio Navigation Rail</div>
            </div>
            <img src="${img01_cockpit}" class="screenshot-img" alt="Delivery Studio Cockpit" />
          </div>

          <div class="grid-phases">
            <div class="phase-tile">
              <div class="phase-tile-header">
                <span class="phase-tile-num">PHASE 1</span>
                <span>🎯</span>
              </div>
              <div class="phase-tile-title">Discover &amp; Frame</div>
              <div class="phase-tile-desc">Define objectives, ROI metrics, compliance bounds, and sign-off gates.</div>
            </div>

            <div class="phase-tile">
              <div class="phase-tile-header">
                <span class="phase-tile-num">PHASE 2</span>
                <span>🗄️</span>
              </div>
              <div class="phase-tile-title">Engineering Core</div>
              <div class="phase-tile-desc">Connect live databases, map 2D/3D schemas, and scaffold dimensional marts.</div>
            </div>

            <div class="phase-tile">
              <div class="phase-tile-header">
                <span class="phase-tile-num">PHASE 3</span>
                <span>🧠</span>
              </div>
              <div class="phase-tile-title">AI Solutioning</div>
              <div class="phase-tile-desc">Rule-vs-model gate, 8 RAG patterns, and dual-runtime MCP server scaffolding.</div>
            </div>

            <div class="phase-tile">
              <div class="phase-tile-header">
                <span class="phase-tile-num">PHASE 4</span>
                <span>🤖</span>
              </div>
              <div class="phase-tile-title">AI Engineering</div>
              <div class="phase-tile-desc">2D visual DAG canvas, multi-agent swarms, and live in-studio simulator.</div>
            </div>

            <div class="phase-tile">
              <div class="phase-tile-header">
                <span class="phase-tile-num">PHASE 5</span>
                <span>☁️</span>
              </div>
              <div class="phase-tile-title">Evals &amp; Deploy</div>
              <div class="phase-tile-desc">Empirical latency/token testing, 1-click Terraform, Docker &amp; K8s manifests.</div>
            </div>

            <div class="phase-tile">
              <div class="phase-tile-header">
                <span class="phase-tile-num">PHASE 6</span>
                <span>🌿</span>
              </div>
              <div class="phase-tile-title">DevOps &amp; Git</div>
              <div class="phase-tile-desc">Dedicated Green Leaf pane, 1-click Git wizards, live diffs &amp; AI commit drafting.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Efficiency Multiplier:</strong> Eliminates fragmented handoffs, ensuring client requirements remain anchored to code and architecture.
        </div>
        <div class="footer-page">Slide 02 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 3: AIR-GAP & SECURITY PERIMETER ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>SECURITY PERIMETER &bull; DATA SOVEREIGNTY</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>100/100 AUDIT SCORE</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">ZERO TRUST ARCHITECTURE &amp; AIR-GAPPED HARDENING</span>
          <h2 class="main-title">
            Air-Gapped Local Execution &amp; <span class="highlight-cyan">Zero Data Exfiltration Architecture</span>
          </h2>
          <p class="subtitle">
            Engineered from the ground up for strictly regulated enterprise perimeters. All data, schemas, code, and model weights remain inside your firewall with verifiable zero-egress guarantees.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Security Pre-Flight Scanner &amp; Workspace Health Auditor (100/100 Clean)</div>
            </div>
            <img src="${img07_security}" class="screenshot-img" alt="Security Pre-Flight Scanner" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🔒</span> 100% Air-Gapped Local Execution
                <span class="feature-badge">ZERO EGRESS</span>
              </div>
              <div class="feature-desc">
                Operates completely offline with zero outbound network calls. Compatible with local inference engines (<code>Ollama</code>, <code>local Gemma</code>, <code>ONNX</code>, <code>vLLM</code>) executing directly on workstation or on-prem cluster hardware.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🔑</span> Native OS Keyring Credential Vaults
                <span class="feature-badge">ZERO PLAINTEXT</span>
              </div>
              <div class="feature-desc">
                API tokens and database credentials are encrypted strictly inside native OS keyrings (Windows DPAPI, macOS Keychain, Linux Secret Service). Zero plaintext exposure in <code>.env</code> or configuration files.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>🛡️</span> Pre-Flight Security Scanner (100/100)
                <span class="feature-badge">CISO AUDIT READY</span>
              </div>
              <div class="feature-desc">
                Automated static analysis suite validates dynamic PII tokenization masks, audits dependency CVEs, flags hardcoded secret patterns, and enforces strict Ed25519 IPC licensing boundary checks.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>CISO Approved:</strong> Passes enterprise information security audits on day one with zero external telemetry and verifiable air-gap guarantees.
        </div>
        <div class="footer-page">Slide 03 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 4: ZERO-PERSISTENCE INTROSPECTION ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>DATA INTROSPECTION &bull; ZERO FOOTPRINT</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>SESSION-ONLY MEMORY</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 2: UNIVERSAL LIVE WAREHOUSE INTROSPECTION MATRIX</span>
          <h2 class="main-title">
            Zero-Persistence Live Database Introspection &amp; <span class="highlight-cyan">Governance</span>
          </h2>
          <p class="subtitle">
            Harvest complex enterprise schemas, foreign key trees, and data profiles with ephemeral session-only memory and zero disk writes.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Phase 2: Universal Live Database Connect &amp; Schema Introspector</div>
            </div>
            <img src="${img02_livedb}" class="screenshot-img" alt="Live DB Introspector" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>⚡</span> Universal Multi-Dialect Matrix
                <span class="feature-badge">8+ WAREHOUSES</span>
              </div>
              <div class="feature-desc">
                Native read drivers for Snowflake, BigQuery, Databricks, PostgreSQL, Oracle, IBM DB2, Microsoft SQL Server, and SQLite with automated metadata extraction.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🛡️</span> Ephemeral Session-Only Memory
                <span class="feature-badge">0 DISK WRITES</span>
              </div>
              <div class="feature-desc">
                Connection pools and schema metadata exist strictly in volatile RAM. Never cached in dotfiles, settings, or unencrypted local storage.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>📐</span> Automated Star Schema &amp; Mart Scaffolding
                <span class="feature-badge">DBT &bull; ANSI SQL</span>
              </div>
              <div class="feature-desc">
                Discovers fact entities, dimension tables, and composite keys to automatically generate ANSI SQL and dbt staging models with full foreign key provenance.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Data Governance:</strong> Eliminate manual SQL dumps and insecure CSV extracts during client architectural discovery.
        </div>
        <div class="footer-page">Slide 04 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 5: 2D & 3D SCHEMA TOPOLOGY ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>DATA TOPOLOGY &bull; ARCHITECTURE VISUALIZATION</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>265+ TABLES AUTO-FIT</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">CROSS-TABLE TOPOLOGY &amp; HIGH-SCALE MODELING</span>
          <h2 class="main-title">
            2D Technical ERD &amp; <span class="highlight-cyan">3D Celestial Topology Modeling</span>
          </h2>
          <p class="subtitle">
            Eliminate schema ambiguity across massive enterprise data models (265+ tables) with column-level relational linking and join isolation.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Phase 2: 2D &amp; 3D Schema Topology &amp; Cross-Table Relational Map</div>
            </div>
            <img src="${img03_topology}" class="screenshot-img" alt="2D & 3D Schema Topology" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🌐</span> Dual-Mode Topology Engine
                <span class="feature-badge">2D / 3D DUAL</span>
              </div>
              <div class="feature-desc">
                Switch between an interactive 20x14 technical ERD grid and a 3D Celestial star cluster with responsive auto-fit for 265+ enterprise tables.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🔗</span> Column-to-Column Illuminated Bezier Pinning
                <span class="feature-badge">[PK] ➔ [FK]</span>
              </div>
              <div class="feature-desc">
                Illuminated cubic bezier curves connecting exact <code style="color:#38bdf8;">[PK]</code> to <code style="color:#34d399;">[FK]</code> socket pins with live join formula tooltips, multi-hop join resolution, and cardinality metrics.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>💡</span> Table Isolation Mode (4% Ghost Opacity)
                <span class="feature-badge">4% GHOST OPACITY</span>
              </div>
              <div class="feature-desc">
                Click any connection line to dim unrelated tables to <strong>4% blueprint ghost opacity</strong>, spotlighting the transactional path with photon pulses and ANSI SQL generation.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Architecture Speed:</strong> Architects instantly understand multi-table join trees, partition keys, and relational dependencies without manual documentation.
        </div>
        <div class="footer-page">Slide 05 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 6: DETERMINISTIC AI SOLUTIONING ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>AI GOVERNANCE &bull; DECISION GATES</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>DETERMINISTIC &bull; &lt;5MS LATENCY</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 3: GOVERNANCE, CAPABILITY LADDER &amp; HYBRID RETRIEVAL</span>
          <h2 class="main-title">
            Deterministic Decision Gates &amp; <span class="highlight-cyan">The 5-Level Capability Ladder</span>
          </h2>
          <p class="subtitle">
            Eliminate unpredictable prompt drift and runaway token OpEx. Enforce mathematical decision gates that prioritize compiled rule engines when probabilistic models are overkill.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Phase 3: AI Solutioning — Component Architecture &amp; Hybrid RAG Engine</div>
            </div>
            <img src="${img04_solutioning}" class="screenshot-img" alt="AI Solutioning Contract" />
          </div>

          <div class="features-list">
            <div class="feature-card green">
              <div class="feature-title">
                <span>⚖️</span> Rule vs. Model Decision Gate
                <span class="feature-badge">&lt;5ms &bull; 0% DRIFT</span>
              </div>
              <div class="feature-desc">
                Evaluates latency budgets, arithmetic determinism, and hallucination bounds. Automatically locks <strong>Level 1 deterministic rules</strong> over LLMs for ledger audits, compliance checks, and routing (<code style="color:#34d399;">&lt;5ms</code>, 0% drift).
              </div>
            </div>

            <div class="feature-card accent">
              <div class="feature-title">
                <span>🧠</span> Hybrid RAG Retrieval Engine
                <span class="feature-badge">100% SKU RECALL</span>
              </div>
              <div class="feature-desc">
                Production visual pipeline fusing <strong>Dense HNSW Vectors</strong> (cosine semantic match) and <strong>Sparse BM25 Engines</strong> via Reciprocal Rank Fusion (RRF), eliminating missing part numbers, SKU codes, and enterprise acronyms.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>🛠️</span> Dual-Runtime MCP Tool Server
                <span class="feature-badge">NODE / PYTHON</span>
              </div>
              <div class="feature-desc">
                Auto-generates production TypeScript and Python Model Context Protocol (MCP) servers, tool schemas, Claude Desktop JSON export (<code>claude_desktop_config.json</code>), and signed Architecture Decision Records (ADRs).
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Financial &amp; Technical Sanity:</strong> Save 90%+ in token costs by deploying LLMs only where probabilistic reasoning is strictly required.
        </div>
        <div class="footer-page">Slide 06 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 7: 3D DATA VISUAL ANALYTICS ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>MATHEMATICAL DIAGNOSTICS &bull; 3D MANIFOLD</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>100% LOCAL COMPUTATION</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">DATA ANALYSIS STUDIO &amp; AIR-GAPPED MATHEMATICAL DIAGNOSTICS</span>
          <h2 class="main-title">
            3D Visual Analytics Manifold &amp; <span class="highlight-cyan">Topological Spatial Diagnostics</span>
          </h2>
          <p class="subtitle">
            Perform multi-variate 3D PCA, K-Means cluster partitioning, and continuous regression surface meshes with 100% local in-memory computation and zero data transmission.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">3D Visual Analytics Manifold — Topological Surface Mesh &amp; Outliers</div>
            </div>
            <img src="${img05_3dmanifold}" class="screenshot-img" alt="3D Visual Analytics Manifold" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🌊</span> Topological Surface Mesh &amp; 3D PCA
                <span class="feature-badge">IN-MEMORY SVD</span>
              </div>
              <div class="feature-desc">
                Converts multi-column database tables into interactive 3D spatial manifolds (Principal Component Analysis, K-Means clustering, and continuous regression surface meshes) rendered in a Cyberpunk Neon palette.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🎯</span> Autonomous Outlier &amp; Pareto Risk
                <span class="feature-badge">80/20 LEVERAGE</span>
              </div>
              <div class="feature-desc">
                Automated Focus Presets detect operational bottlenecks, key metric drivers, and Pareto outlier risk, color-encoding data points by distance to cluster centroid with automated risk scoring.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>🔍</span> Floating Deep Record Inspector
                <span class="feature-badge">ROW-LEVEL TRACE</span>
              </div>
              <div class="feature-desc">
                Interactive spatial drill-down: click any point in 3D space to inspect raw row attributes against cluster boundaries. All matrix factorizations compute locally in RAM with zero cloud egress.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Mathematical Rigor:</strong> All matrix factorizations and 3D geometry compute in local RAM with zero data leaving the host workstation.
        </div>
        <div class="footer-page">Slide 07 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 8: MULTI-AGENT STUDIO ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>AGENTIC ARCHITECTURE &bull; A2A MESH</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>FOUR-WAY PROTOCOL</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 4: AGENTIC MESH ARCHITECTURE &amp; LEGACY INTEGRATION</span>
          <h2 class="main-title">
            Multi-Agent Studio &amp; <span class="highlight-purple">Four-Way Communication Matrix</span>
          </h2>
          <p class="subtitle">
            Architect, schedule, and test specialized autonomous AI agent swarms with direct legacy database connectivity and 2PC write-back.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Phase 4: Multi-Agent Studio — Four-Way Matrix &amp; Live Consensus Runner</div>
            </div>
            <img src="${img08_multiagent}" class="screenshot-img" alt="Multi-Agent Studio" />
          </div>

          <div class="features-list">
            <div class="feature-card purple">
              <div class="feature-title">
                <span>🕸️</span> Four-Way Quad-Bus Matrix
                <span class="feature-badge">QUAD-BUS MESH</span>
              </div>
              <div class="feature-desc">
                Bridges: <strong>(1) Host App Bus</strong> for lifecycle events, <strong>(2) A2A Mesh</strong> for peer consensus, <strong>(3) RAG</strong> for vector memory, and <strong>(4) Client DB</strong> for relational persistence.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🏢</span> Legacy DB Integration &amp; 2PC Write-Back
                <span class="feature-badge">ACID CONSISTENCY</span>
              </div>
              <div class="feature-desc">
                Connects agents directly to legacy <strong>Oracle, IBM DB2, and Teradata</strong> warehouses with guaranteed Two-Phase Commit (2PC) ACID write-back and audit logs.
              </div>
            </div>

            <div class="feature-card accent">
              <div class="feature-title">
                <span>🧪</span> Drag-and-Drop Scheduler &amp; Test Console
                <span class="feature-badge">CODEGEN READY</span>
              </div>
              <div class="feature-desc">
                Priority queueing, concurrency limits, agent model ID selectors, and live consensus testing with automated TypeScript code generation (<code style="color:#38bdf8;">multiAgentOrchestrator.ts</code>).
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Production Multi-Agent:</strong> Replace toy single-turn prompts with deterministic, distributed agent swarms that coordinate safely.
        </div>
        <div class="footer-page">Slide 08 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 9: 2D VISUAL DAG CANVAS ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>PIPELINE ENGINEERING &bull; VISUAL DAG</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>8 CANONICAL RAG PATTERNS</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 4: VISUAL DAG PIPELINE &amp; VECTOR SPECIFICATIONS</span>
          <h2 class="main-title">
            2D Visual DAG Canvas &amp; <span class="highlight-cyan">Pluggable Vector Store Architecture</span>
          </h2>
          <p class="subtitle">
            Visually build, parameterize, and profile 8 canonical RAG architectures with multi-tier vector store targeting and dialect-agnostic SQL co-architecting.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Phase 4: 2D Visual DAG Pipeline Canvas &amp; In-Studio Simulator</div>
            </div>
            <img src="${img10_dagcanvas}" class="screenshot-img" alt="Visual DAG Pipeline Canvas" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🎨</span> Interactive 2D Visual DAG Pipeline
                <span class="feature-badge">8 CANONICAL RAGS</span>
              </div>
              <div class="feature-desc">
                Visually model and inspect Ingest, Embedding, Retrieval, Reranking, and Generation stages across 8 canonical RAG patterns (HyDE, Hybrid RRF, CRAG, Graph RAG, Self-RAG) with real-time parameter tuning.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>💾</span> Multi-Tier Vector Store Targeting
                <span class="feature-badge">PLUGGABLE VECTORS</span>
              </div>
              <div class="feature-desc">
                Target <code>pgvector</code>, <code>Pinecone</code>, <code>Qdrant</code>, or <code>Milvus</code> with 1-click presets. Fine-tunes HNSW/IVFFlat index parameters, embedding dimensions, and chunking strategy.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>🧙‍♂️</span> AI SQL Co-Architect &amp; Dialect Transpiler
                <span class="feature-badge">MULTI-DIALECT DDL</span>
              </div>
              <div class="feature-desc">
                Convert, test, and validate complex queries across Snowflake, BigQuery, PostgreSQL, and Oracle with push-pull DDL editing, automated index recommendations, and explain-plan guidance.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Developer Ergonomics:</strong> Give engineers a visual workbench that turns abstract pipeline diagrams into deployable code instantly.
        </div>
        <div class="footer-page">Slide 09 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 10: 26-LANG CODE CONVERTER ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>LEGACY MODERNIZATION &bull; AST TRANSPILER</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>26 SUPPORTED LANGUAGES</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">ENTERPRISE CODEBASE REFACTORING &amp; MAINFRAME MIGRATION</span>
          <h2 class="main-title">
            26-Language Code Modernizer &amp; <span class="highlight-cyan">AST-Grounded Transpiler</span>
          </h2>
          <p class="subtitle">
            De-risk mission-critical legacy migrations by translating monolithic code into modern cloud-native targets with compiler verification.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="screenshot-frame">
            <div class="screenshot-frame-header">
              <div class="window-dots">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
              </div>
              <div class="window-caption">Code Modernizer Studio — Side-by-Side Review &amp; Compiler Feedback</div>
            </div>
            <img src="${img06_converter}" class="screenshot-img" alt="Code Modernizer Studio" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🔄</span> 26-Language Cross-Stack Translation
                <span class="feature-badge">LEGACY ➔ MODERN</span>
              </div>
              <div class="feature-desc">
                Modernizes legacy codebases (COBOL, SAS, VBA, Fortran, Perl, PL/SQL) into cloud-native Python, TypeScript, Go, Rust, and dbt models with architectural parity.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🛡️</span> Strict Side-by-Side Review Guarantee
                <span class="feature-badge">ZERO BLIND OVERWRITES</span>
              </div>
              <div class="feature-desc">
                Zero code is written to disk until engineers inspect side-by-side AST diffs, variable mappings, and logic parity indicators in the studio review pane.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>⚡</span> Automated Syntax Self-Repair Loop
                <span class="feature-badge">PARSER FEEDBACK</span>
              </div>
              <div class="feature-desc">
                Validates generated code against local target language parsers. Syntactic failures are fed back for immediate self-correction before human review.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Modernization Velocity:</strong> Accelerate multi-year legacy migration projects into weeks without losing business logic or audit history.
        </div>
        <div class="footer-page">Slide 10 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 11: INFRASTRUCTURE & GIT OPS ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>INFRASTRUCTURE AS CODE &bull; GIT OPS</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>MULTI-CLOUD &bull; K8S &bull; TF</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 5 &amp; 6: CLOUD SCAFFOLDING &amp; DEDICATED GREEN LEAF GIT HUB</span>
          <h2 class="main-title">
            1-Click Multi-Cloud Scaffolding &amp; <span class="highlight-cyan">🌿 Git DevOps Hub</span>
          </h2>
          <p class="subtitle">
            Export production-ready Terraform, Docker, Kubernetes, and CI/CD pipelines, and manage repositories directly from the dedicated Green Leaf pane.
          </p>
        </div>

        <div class="slide-body-split">
          <div class="split-shots-container">
            <div class="screenshot-frame">
              <div class="screenshot-frame-header">
                <div class="window-dots">
                  <div class="window-dot dot-red"></div>
                  <div class="window-dot dot-yellow"></div>
                  <div class="window-dot dot-green"></div>
                </div>
                <div class="window-caption">Phase 5: Terraform, K8s &amp; CI/CD Scaffolding</div>
              </div>
              <img src="${img11_deployfiles}" class="screenshot-img" alt="Deployment Scaffolding" />
            </div>

            <div class="screenshot-frame">
              <div class="screenshot-frame-header">
                <div class="window-dots">
                  <div class="window-dot dot-red"></div>
                  <div class="window-dot dot-yellow"></div>
                  <div class="window-dot dot-green"></div>
                </div>
                <div class="window-caption">Phase 6: 🌿 Dedicated Git &amp; DevOps Hub</div>
              </div>
              <img src="${img12_github}" class="screenshot-img" alt="Git and DevOps Hub" />
            </div>
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>☁️</span> 1-Click Multi-Cloud Scaffolding
                <span class="feature-badge">TF &bull; K8S &bull; DOCKER</span>
              </div>
              <div class="feature-desc">
                Scaffolds production Terraform, Kubernetes manifests, Docker Compose, and environment scripts targeting AWS, Azure, Google Cloud, or air-gapped on-prem.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🌿</span> Dedicated Green Leaf Git Hub
                <span class="feature-badge">BITBUCKET &bull; GITHUB &bull; GITLAB</span>
              </div>
              <div class="feature-desc">
                Integrated Git workflows: 1-click repo wizards, live branch diffs, AI-assisted commit message drafting, and PR creation without leaving the desktop app.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>💡</span> In-App Virtual Guide (IP Guardrails)
                <span class="feature-badge">DOC INGESTION</span>
              </div>
              <div class="feature-desc">
                Ingests client enterprise architecture documents, provides contextual workflow guidance, and delivers architectural deep-dives under strict IP guardrails.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>DevOps Hygiene:</strong> Client deliverables land directly in their Git repos and cloud environments with clean commit histories.
        </div>
        <div class="footer-page">Slide 11 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 12: TECHNICAL SCORECARD ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>TECHNICAL EVALUATION &bull; ARCHITECTURE SCORECARD</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>EXECUTIVE SIGN-OFF</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">ENTERPRISE ENGINEERING COMPARISON &amp; PLATFORM SCORECARD</span>
          <h2 class="main-title">
            Enterprise Technical Scorecard: <span class="highlight-cyan">Status Quo vs. Evolve AI</span>
          </h2>
          <p class="subtitle">
            The architectural, operational, and financial proof points that justify enterprise platform adoption.
          </p>
        </div>

        <div class="table-container">
          <table class="scorecard-table">
            <thead>
              <tr>
                <th>Architectural Dimension</th>
                <th>Status Quo Ad-Hoc Cloud AI Stacks</th>
                <th>Evolve AI Enterprise Studio</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Data Perimeter Security</td>
                <td>Exfiltration risk to public LLM APIs over external HTTPS</td>
                <td>100% Air-Gapped Local Execution (Zero data leaves host)</td>
              </tr>
              <tr>
                <td>Determinism &amp; Hallucination</td>
                <td>Nondeterministic prompt guessing with high drift</td>
                <td>Mathematical Rule vs Model Gates (&lt;5ms, 0% drift)</td>
              </tr>
              <tr>
                <td>Legacy Warehouse Integration</td>
                <td>Read-only connectors or fragile custom ETL pipelines</td>
                <td>Native Oracle/DB2/Teradata with 2PC ACID write-back</td>
              </tr>
              <tr>
                <td>Infrastructure Governance</td>
                <td>Manual, error-prone cloud setup across multiple consoles</td>
                <td>1-Click Terraform, Docker Compose &amp; Kubernetes scaffolding</td>
              </tr>
              <tr>
                <td>Credential Management</td>
                <td>Config files, dotfiles, or plaintext environment vars</td>
                <td>OS Keyring Native Vaults (Windows DPAPI, macOS Keychain)</td>
              </tr>
              <tr>
                <td>Hardware Utilization &amp; TCO</td>
                <td>Unpredictable per-token cloud bills &amp; GPU cloud leases</td>
                <td>Runs on existing local CPUs/GPUs (Ollama, local Gemma)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 8px;">
          <div class="feature-card accent" style="padding: 14px 18px;">
            <div class="feature-title" style="font-size: 16px;">
              <span>🏆</span> The VP of Engineering Advantage
            </div>
            <div class="feature-desc" style="font-size: 13.5px;">
              Eliminates the maintenance nightmare of disconnected notebooks, brittle glue code, and shadow AI scripts. Delivers an <strong>auditable, standardized engineering pipeline</strong> that client teams can operate with confidence.
            </div>
          </div>

          <div class="feature-card green" style="padding: 14px 18px;">
            <div class="feature-title" style="font-size: 16px;">
              <span>🚀</span> Immediate Evaluation &amp; Pilot Deployment
            </div>
            <div class="feature-desc" style="font-size: 13.5px;">
              <strong>Production Release v2.28.0</strong> is packaged and ready for deployment. We onboard enterprise engineering teams through focused cohorts with direct core architect support: <strong style="color: #34d399;">support@evolveminds.com.au</strong>.
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Next Action:</strong> Schedule an architectural technical deep-dive or deploy the air-gapped evaluation binary today.
        </div>
        <div class="footer-page">Slide 12 / 12 &bull; Finish</div>
      </div>
    </div>
  </div>

</body>
</html>
`;

// Save the HTML file
const htmlOutPath = path.resolve(__dirname, '..', 'docs', 'Evolve_AI_CTO_Engineering_Presentation_Deck.html');
fs.writeFileSync(htmlOutPath, htmlContent, 'utf8');
console.log(`Saved self-contained presentation HTML to: ${htmlOutPath} (${(fs.statSync(htmlOutPath).size / 1024 / 1024).toFixed(2)} MB)`);

// Compile to PDF using Chrome Headless
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pdfOutPath = path.resolve(__dirname, '..', 'docs', 'Evolve_AI_CTO_Engineering_Deck.pdf');
const tempPdfPath = path.resolve(__dirname, '..', 'docs', 'Evolve_AI_CTO_Engineering_Deck_temp.pdf');

console.log('Compiling 16:9 widescreen presentation PDF via Chrome headless...');
try {
  const fileUrl = 'file:///' + htmlOutPath.replace(/\\/g, '/');
  const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --virtual-time-budget=5000 --print-to-pdf="${tempPdfPath}" --print-to-pdf-no-header "${fileUrl}"`;
  execSync(cmd, { stdio: 'inherit' });

  // Always write to v2 so there is a fresh, guaranteed unlocked copy
  const v2Path = path.resolve(__dirname, '..', 'docs', 'Evolve_AI_CTO_Engineering_Deck_v2.pdf');
  fs.copyFileSync(tempPdfPath, v2Path);
  console.log(`Saved unlocked updated copy to: ${v2Path}`);

  // Safely attempt to replace destination
  try {
    if (fs.existsSync(pdfOutPath)) {
      fs.unlinkSync(pdfOutPath);
    }
    fs.renameSync(tempPdfPath, pdfOutPath);
    console.log(`Successfully compiled PDF to: ${pdfOutPath} (${(fs.statSync(pdfOutPath).size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (renameErr) {
    console.warn(`Note: Could not overwrite ${pdfOutPath} directly (file is currently locked by a viewer). Use ${v2Path} instead.`);
  }
} catch (e) {
  console.error('Error compiling PDF:', e.message);
}
