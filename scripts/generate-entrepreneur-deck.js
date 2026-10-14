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
const img11_gathub = getBase64Image(path.join(deckShotsDir, '60_git_hub.png'));

console.log('Loaded all genuine product screenshots into memory.');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Evolve AI Forward Deployed Engineers Delivery Studio — Entrepreneur Presentation Deck</title>
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
      padding: 52px 76px 40px 76px;
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
      margin-bottom: 16px;
    }

    .brand-pill {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(56, 189, 248, 0.35);
      padding: 7px 18px;
      border-radius: 9999px;
      font-size: 13.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #38bdf8;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
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
      margin-bottom: 14px;
    }

    .category-kicker {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #4ec9b0;
      margin-bottom: 6px;
      display: block;
    }

    .main-title {
      font-size: 38px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: #ffffff;
      margin-bottom: 6px;
    }

    .main-title .highlight-cyan {
      color: #38bdf8 !important;
      display: inline !important;
    }

    .main-title .highlight-red {
      color: #f43f5e !important;
      display: inline !important;
    }

    .main-title .highlight-purple {
      color: #c084fc !important;
      display: inline !important;
    }

    .main-title .highlight-ochre {
      color: #fbbf24 !important;
      display: inline !important;
    }

    .subtitle {
      font-size: 18px;
      line-height: 1.4;
      color: #94a3b8;
      font-weight: 500;
      max-width: 1560px;
    }

    /* Layout Splits */
    .slide-body-split {
      display: grid;
      grid-template-columns: 1.25fr 0.75fr;
      gap: 32px;
      align-items: center;
      flex: 1;
      margin: 8px 0;
    }

    .slide-body-split-reverse {
      display: grid;
      grid-template-columns: 0.75fr 1.25fr;
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
      max-height: 610px;
      display: block;
      object-fit: contain;
      background: #060911;
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

    /* 3-Column Grid for Problem Slide */
    .grid-3col {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 22px;
      flex: 1;
      align-items: stretch;
      margin: 12px 0;
    }

    .card-problem {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(244, 63, 94, 0.4);
      border-top: 4px solid #f43f5e;
      border-radius: 14px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .card-problem-title {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .card-problem-desc {
      font-size: 15px;
      line-height: 1.5;
      color: #94a3b8;
    }

    /* 6 Phases Grid */
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
      margin: 12px 0;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid rgba(51, 65, 85, 0.8);
      background: rgba(15, 23, 42, 0.7);
    }

    .roi-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    .roi-table th {
      background: rgba(30, 41, 59, 0.85);
      padding: 14px 20px;
      font-size: 14.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #cbd5e1;
      border-bottom: 1px solid rgba(51, 65, 85, 0.8);
    }

    .roi-table td {
      padding: 14px 20px;
      font-size: 15px;
      color: #94a3b8;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
    }

    .roi-table tr:last-child td {
      border-bottom: none;
    }

    .roi-table td:first-child {
      font-weight: 700;
      color: #ffffff;
    }

    .roi-table td:nth-child(2) {
      color: #f87171;
    }

    .roi-table td:last-child {
      color: #34d399;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.08);
    }

    /* Footer */
    .slide-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 14px;
      border-top: 1px solid rgba(51, 65, 85, 0.6);
      margin-top: 8px;
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

    /* Preview Stack in Cover */
    .cover-stack {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      margin-top: 14px;
    }

    .cover-preview-card {
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 15px 35px rgba(0, 0, 0, 0.6);
    }

    .cover-preview-header {
      background: rgba(30, 41, 59, 0.9);
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 700;
      color: #38bdf8;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .cover-preview-img {
      width: 100%;
      height: 220px;
      object-fit: cover;
      display: block;
    }

    .cover-preview-desc {
      padding: 10px 14px;
      font-size: 12.5px;
      color: #94a3b8;
      line-height: 1.4;
    }
  </style>
</head>
<body>

  <!-- ==================== SLIDE 1: COVER ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>EVOLVE MIND SOLUTIONS &bull; ENTERPRISE STUDIO</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>v2.28.0 PRODUCTION RELEASE &bull; AIR-GAP CERTIFIED</span></div>
        </div>

        <div class="heading-group" style="margin-top: 10px;">
          <span class="category-kicker">COMMERCIAL PRESENTATION FOR FOUNDERS &amp; EXECUTIVES</span>
          <h1 class="main-title" style="font-size: 46px; margin-bottom: 12px;">
            Evolve AI Forward Deployed Engineers <span class="highlight-cyan">Delivery Studio</span>
          </h1>
          <p class="subtitle" style="font-size: 20px;">
            The complete local-first enterprise AI delivery cockpit. Take a client from discovery to deployed multi-agent architecture in hours — running 100% on your own hardware with verifiable, audit-ready integrity.
          </p>
        </div>

        <div style="display: flex; gap: 12px; margin: 18px 0;">
          <span class="feature-badge" style="margin: 0; padding: 6px 14px; font-size: 12px;">🔒 100% Air-Gapped Local Execution</span>
          <span class="feature-badge" style="margin: 0; padding: 6px 14px; font-size: 12px; background: rgba(16, 185, 129, 0.15); color: #34d399; border-color: rgba(16, 185, 129, 0.4);">🌐 Dual 2D/3D Schema Topology</span>
          <span class="feature-badge" style="margin: 0; padding: 6px 14px; font-size: 12px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border-color: rgba(168, 85, 247, 0.4);">🤖 Multi-Agent 4-Way Mesh</span>
          <span class="feature-badge" style="margin: 0; padding: 6px 14px; font-size: 12px; background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">⚖️ Deterministic Decision Gates</span>
        </div>

        <!-- 3 Feature Preview Cards -->
        <div class="cover-stack">
          <div class="cover-preview-card">
            <div class="cover-preview-header">
              <span>2D &amp; 3D SCHEMA TOPOLOGY</span>
              <span>PHASE 2</span>
            </div>
            <img src="${img03_topology}" class="cover-preview-img" alt="2D & 3D Schema Topology" />
            <div class="cover-preview-desc">
              Visual ERD grid &amp; 3D Celestial Cosmos star cluster. Column-to-column bezier PK/FK links with 4% ghost opacity isolation.
            </div>
          </div>

          <div class="cover-preview-card">
            <div class="cover-preview-header">
              <span>HYBRID RAG &amp; CAPABILITY LADDER</span>
              <span>PHASE 3</span>
            </div>
            <img src="${img04_solutioning}" class="cover-preview-img" alt="Hybrid RAG Pipeline" />
            <div class="cover-preview-desc">
              Dense HNSW + Sparse BM25 via Reciprocal Rank Fusion for 100% recall. Rule-vs-model gates and dual MCP scaffolding.
            </div>
          </div>

          <div class="cover-preview-card">
            <div class="cover-preview-header">
              <span>MULTI-AGENT STUDIO &amp; 4-WAY MESH</span>
              <span>PHASE 4</span>
            </div>
            <img src="${img08_multiagent}" class="cover-preview-img" alt="Multi-Agent Studio" />
            <div class="cover-preview-desc">
              App Bus, A2A Peer Mesh, RAG Store, and Client DB with 2PC Write-back. Visual scheduler &amp; live consensus testing.
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

  <!-- ==================== SLIDE 2: THE PROBLEM & OPPORTUNITY ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>THE ENTREPRENEUR MOAT &bull; MARKET GAP</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>HIGH-VALUE REGULATED SECTORS</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">ENTERPRISE DELIVERY REALITY VS. MARKETING HYPE</span>
          <h2 class="main-title">
            Enterprise AI Delivery is Broken — <span class="highlight-cyan">And That is Your Advantage</span>
          </h2>
          <p class="subtitle">
            Most AI consulting engagements stall between proof-of-concept and production because current tooling relies on fragmented cloud APIs, uncontrolled prompt guessing, and manual glue code.
          </p>
        </div>

        <div class="grid-3col">
          <div class="card-problem">
            <div class="card-problem-title">
              <span style="font-size: 26px;">📉</span> Context Evaporates Across 10 Tools
            </div>
            <div class="card-problem-desc">
              Engineering teams juggle ERD diagrams, Jupyter notebooks, cloud consoles, Miro boards, and IDEs. Architectural decisions, data types, and security constraints are lost at every handoff, leading to costly scope creep.
            </div>
            <div style="margin-top: auto; font-size: 13.5px; color: #f87171; font-weight: 700;">
              Result: 3-6 month delayed delivery cycles &amp; burnt margins.
            </div>
          </div>

          <div class="card-problem">
            <div class="card-problem-title">
              <span style="font-size: 26px;">🔒</span> Regulated Data Cannot Leave the Firewall
            </div>
            <div class="card-problem-desc">
              Financial institutions, healthcare providers, defense contractors, and government agencies legally prohibit sending proprietary schemas or data to public cloud LLMs. Vendors requiring public SaaS endpoints are instantly disqualified.
            </div>
            <div style="margin-top: auto; font-size: 13.5px; color: #f87171; font-weight: 700;">
              Result: $100B+ regulated market remains locked to cloud AI.
            </div>
          </div>

          <div class="card-problem">
            <div class="card-problem-title">
              <span style="font-size: 26px;">💸</span> The Token Cost &amp; Hallucination Trap
            </div>
            <div class="card-problem-desc">
              Teams default to deploying massive language models for deterministic arithmetic and rule-based queries. The result is runaway token bills, unpredictable hallucination risks, and zero SLA guarantees for audit committees.
            </div>
            <div style="margin-top: auto; font-size: 13.5px; color: #f87171; font-weight: 700;">
              Result: Failed enterprise pilot sign-offs &amp; audit vetoes.
            </div>
          </div>
        </div>

        <div class="feature-card accent" style="margin-top: 10px; padding: 14px 20px;">
          <div class="feature-title" style="font-size: 16px; margin-bottom: 2px;">
            <span>🚀</span> The Evolve AI Solution: A Self-Contained Desktop Cockpit
          </div>
          <div class="feature-desc" style="font-size: 14px;">
            Evolve AI unites client discovery, live data introspection, deterministic decision gates, multi-agent orchestration, and cloud scaffolding into <strong>one unified desktop environment</strong> that runs completely air-gapped on existing hardware.
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Commercial Advantage:</strong> Win client trust on day one by providing mathematical determinism and complete data sovereignty.
        </div>
        <div class="footer-page">Slide 02 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 3: 6-PHASE DELIVERY LIFECYCLE ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>DELIVERY STUDIO &bull; 6-PHASE LIFECYCLE</span></div>
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
        <div class="footer-page">Slide 03 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 4: CAPABILITY 1 — LIVE DB INTROSPECTION ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 1 &bull; DATA INTROSPECTION</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>ZERO PERSISTENCE</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 2: UNIVERSAL LIVE DATA INTROSPECTION MATRIX</span>
          <h2 class="main-title">
            Connect &amp; Introspect Any Enterprise Warehouse <span class="highlight-cyan">in Seconds</span>
          </h2>
          <p class="subtitle">
            Extract live schemas, table geometries, primary/foreign keys, and data samples with zero footprint and zero persistent credential storage.
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
                <span>⚡</span> Universal Enterprise Warehouse Connect
                <span class="feature-badge">MULTI-DIALECT</span>
              </div>
              <div class="feature-desc">
                Native connection drivers for Snowflake, BigQuery, Databricks, PostgreSQL, Oracle, IBM DB2, Microsoft SQL Server, and SQLite with automated schema harvesting.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🛡️</span> Zero-Persistence In-Memory Security
                <span class="feature-badge">AIR-GAP SAFE</span>
              </div>
              <div class="feature-desc">
                Credentials remain purely in volatile session memory during discovery. Zero credentials or connection strings are serialized to config files or disk.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>📊</span> Instant Dimensional Mart &amp; POC Pack
                <span class="feature-badge">1-CLICK SIGN-OFF</span>
              </div>
              <div class="feature-desc">
                Instantly identifies fact tables, dimension hierarchies, and relational join trees. Generates a client-ready POC Approval Pack in HTML and PDF on day one.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Commercial Impact:</strong> Walk into client discovery meetings and produce verified data architectures in under 15 minutes.
        </div>
        <div class="footer-page">Slide 04 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 5: CAPABILITY 2 — 2D & 3D SCHEMA TOPOLOGY ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 2 &bull; DATA TOPOLOGY</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>265+ TABLES AUTO-FIT</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">CROSS-TABLE TOPOLOGY &amp; CLIENT VISUAL SHOWCASE</span>
          <h2 class="main-title">
            Interactive <span class="highlight-cyan">2D &amp; 3D Schema Topology</span> &amp; Celestial Cosmos
          </h2>
          <p class="subtitle">
            Explore complex enterprise database schemas in interactive 2D ERD and 3D Celestial orbit with column-to-column PK/FK linking and join isolation.
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
                <span>🌐</span> Dual-Mode 2D ERD &amp; 3D Cosmos
                <span class="feature-badge">2D / 3D DUAL</span>
              </div>
              <div class="feature-desc">
                1-click toggle between a dynamic technical ERD grid and an interactive 3D Celestial star cluster. Auto-fits massive enterprise schemas (265+ tables) with responsive bounding boxes.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🔗</span> Column-to-Column Relational Linking
                <span class="feature-badge">[PK] ➔ [FK]</span>
              </div>
              <div class="feature-desc">
                Illuminated cubic bezier curves linking exact primary keys to foreign keys with socket pins. Hover within 14px for live join formula tooltips, multi-hop paths, and cardinality metrics.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>💡</span> Table &amp; Link Isolation Mode
                <span class="feature-badge">4% GHOST OPACITY</span>
              </div>
              <div class="feature-desc">
                Click any connection line to dim unrelated noise to <strong>4% blueprint ghost opacity</strong>, spotlighting joined transactional entities with glowing halos, animated photon pulses, and instant ANSI SQL generation.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Visual Impact:</strong> Walk into client architectural reviews and project crystal-clear data models that establish instant executive authority.
        </div>
        <div class="footer-page">Slide 05 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 6: CAPABILITY 3 — AI SOLUTIONING CONTRACT ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 3 &bull; AI SOLUTIONING</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>DETERMINISTIC AI</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 3: GOVERNANCE, RAG ARCHITECTURE &amp; CAPABILITY LADDER</span>
          <h2 class="main-title">
            AI Solutioning Contract &amp; <span class="highlight-cyan">Hybrid RAG Retrieval Engine</span>
          </h2>
          <p class="subtitle">
            Enforce deterministic rule-first decision gates, architect hybrid RAG pipelines with dense vector and sparse keyword paths, and auto-scaffold MCP tool servers.
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
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🧠</span> Hybrid RAG Visual Flow &amp; Concordance
                <span class="feature-badge">100% RECALL</span>
              </div>
              <div class="feature-desc">
                Visual pipeline coupling Dense HNSW Vectors (Cosine Semantic Similarity) and Sparse BM25 Engines via Reciprocal Rank Fusion (RRF) for 100% SKU and domain jargon recall.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>⚖️</span> Rule vs. Model Decision Gate
                <span class="feature-badge">&lt;5ms &bull; 0% DRIFT</span>
              </div>
              <div class="feature-desc">
                Explicitly verifies "Do We Need AI?" Auto-locks target capability levels (Level 1 deterministic rules to Level 5 autonomous swarms) to eliminate hallucinations and unnecessary API costs.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>🛠️</span> Dual-Runtime MCP Tool Server
                <span class="feature-badge">NODE / PYTHON</span>
              </div>
              <div class="feature-desc">
                Instantly scaffolds Model Context Protocol (MCP) tool servers, TypeScript/Python handlers, Claude Desktop JSON export (<code style="color:#c084fc;">claude_desktop_config.json</code>), and signed ADRs.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Enterprise Trust:</strong> Give clients verifiable, audited AI architectures with guaranteed zero drift and transparent cost controls.
        </div>
        <div class="footer-page">Slide 06 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 7: CAPABILITY 4 — 3D DATA VISUAL ANALYTICS ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 4 &bull; 3D DATA ANALYTICS</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>TOPOLOGICAL MANIFOLD</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">ADVANCED 3D DATA MANIFOLD &amp; OUTLIER DIAGNOSTICS</span>
          <h2 class="main-title">
            3D Visual Analytics Manifold &amp; <span class="highlight-cyan">Topological Diagnostics</span>
          </h2>
          <p class="subtitle">
            Perform multi-dimensional 3D PCA, surface mesh regression, and autonomous outlier risk analysis over live enterprise database schemas with 100% air-gapped computation.
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
                <span>🌊</span> Topological Surface Mesh &amp; PCA
                <span class="feature-badge">3D SCATTER / MESH</span>
              </div>
              <div class="feature-desc">
                Transforms complex multi-variate database tables into interactive 3D spatial manifolds (PCA, K-Means clustering, and continuous regression surface meshes) in Cyberpunk Neon palette.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🎯</span> Autonomous Outlier &amp; Pareto Risk
                <span class="feature-badge">80/20 LEVERAGE</span>
              </div>
              <div class="feature-desc">
                Automated Focus Presets: Find Bottlenecks &amp; Delays, Key Driver Analysis, and Pareto Outlier Risk. Includes floating Deep Record Inspector for instant single-record drill-downs.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>🔒</span> 100% Air-Gapped Local Computation
                <span class="feature-badge">0 BYTES EXTERNALLY</span>
              </div>
              <div class="feature-desc">
                All 3D transformations, matrix factorizations, and regression surfaces run locally in-memory. Zero data transmitted externally, paired with 1-click print and PDF dashboard exports.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Executive Insights:</strong> Reveal hidden multi-dimensional patterns and anomaly clusters that 2D spreadsheets and traditional BI tools miss.
        </div>
        <div class="footer-page">Slide 07 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 8: CAPABILITY 5 — MULTI-AGENT STUDIO ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 5 &bull; MULTI-AGENT STUDIO</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>A2A MESH &bull; 4-WAY PROTOCOL</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 4: AGENTIC SWARM ORCHESTRATION &amp; ENTERPRISE INTEGRATION</span>
          <h2 class="main-title">
            Multi-Agent Studio &amp; <span class="highlight-purple">Four-Way Communication Matrix</span>
          </h2>
          <p class="subtitle">
            Orchestrate specialized autonomous agent swarms across a four-way communication matrix connecting Host Apps, Peer Agents, Vector Stores, and Enterprise DBs with 2PC write-back.
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
                <span>🕸️</span> Four-Way Communication Matrix
                <span class="feature-badge">QUAD-BUS</span>
              </div>
              <div class="feature-desc">
                Seamlessly bridges: <strong>(1) App Bridge</strong> for lifecycle events, <strong>(2) A2A Mesh</strong> for inter-agent consensus, <strong>(3) RAG</strong> for vector memory, and <strong>(4) Client DB</strong> for relational persistence.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🏢</span> Legacy DB Integration &amp; 2PC Write-Back
                <span class="feature-badge">ORACLE / DB2 / TERADATA</span>
              </div>
              <div class="feature-desc">
                Equips agents to query legacy corporate data and execute verified updates via Two-Phase Commit (2PC) transactions, ensuring strict ACID consistency and auditability.
              </div>
            </div>

            <div class="feature-card accent">
              <div class="feature-title">
                <span>🧪</span> Drag-and-Drop Scheduler &amp; Test Console
                <span class="feature-badge">LIVE TRACE &bull; CODEGEN</span>
              </div>
              <div class="feature-desc">
                Visual scheduler with priority queues, concurrency bounds, and model selectors. Executes live scenarios (Invoice Reconcile, Disputes) and emits production <code style="color:#38bdf8;">multiAgentOrchestrator.ts</code> code.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Enterprise Value:</strong> Transform brittle single-prompt chatbots into robust, multi-agent automated workforces connected directly to legacy systems.
        </div>
        <div class="footer-page">Slide 08 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 9: CAPABILITY 6 — 2D VISUAL DAG CANVAS & SQL CO-ARCHITECT ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 6 &bull; VISUAL DAG PIPELINE</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>8 RAG PATTERNS &bull; LIVE DAG</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 4: 2D VISUAL DAG CANVAS &amp; VECTOR STORE ARCHITECTURE</span>
          <h2 class="main-title">
            2D Visual DAG Canvas &amp; <span class="highlight-cyan">Multi-Tier Vector Architecture</span>
          </h2>
          <p class="subtitle">
            Visually construct end-to-end RAG pipelines across 8 canonical patterns, select destination vector stores, and co-architect SQL across disparate dialects.
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
                <span>🎨</span> Interactive 2D Visual DAG Canvas
                <span class="feature-badge">8 RAG CANONICALS</span>
              </div>
              <div class="feature-desc">
                Connect and inspect Ingest, Embedding, Retrieval, Reranking, and Generator nodes. Supports HyDE, Hybrid RRF, CRAG, Graph RAG, and Self-RAG with live node param tuning.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>💾</span> Multi-Tier Vector Store Selector
                <span class="feature-badge">PGVECTOR / PINECONE</span>
              </div>
              <div class="feature-desc">
                Select between pgvector, Pinecone, Qdrant, and Milvus. Inspects vector dimensions, index types (HNSW/IVFFlat), and auto-tunes chunk size and overlap strategies.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>🧙‍♂️</span> AI SQL Co-Architect &amp; Dialect Transpiler
                <span class="feature-badge">PUSH-PULL DDL</span>
              </div>
              <div class="feature-desc">
                Convert and optimize complex SQL queries between Snowflake, BigQuery, PostgreSQL, and Oracle with interactive DDL editors and automated execution plan advice.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Engineering Speed:</strong> Bridge the gap between whiteboard concept and deployable code with interactive visual DAG modeling.
        </div>
        <div class="footer-page">Slide 09 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 10: CAPABILITY 7 — 26-LANG CODE CONVERTER ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 7 &bull; CODE MODERNIZATION</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>26 LANGUAGES</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">CROSS-STACK AST IDIOM TRANSLATION &amp; LEGACY MODERNIZATION</span>
          <h2 class="main-title">
            26-Language Code Modernizer &amp; <span class="highlight-cyan">AST-Grounded Transpiler</span>
          </h2>
          <p class="subtitle">
            Transpile legacy COBOL, SAS, VBA, Fortran, and Oracle PL/SQL into modern cloud-native targets with target AST validation and complete audit trails.
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
                <span>🔄</span> 26-Language Universal Coverage
                <span class="feature-badge">LEGACY ➔ MODERN</span>
              </div>
              <div class="feature-desc">
                Modernizes legacy codebases (COBOL, SAS, VBA, Fortran, Perl, PL/SQL) into modern Python, TypeScript, Go, Rust, and dbt SQL models with structural parity.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🛡️</span> Side-by-Side Review Guarantee
                <span class="feature-badge">ZERO BLIND OVERWRITES</span>
              </div>
              <div class="feature-desc">
                Strict human-in-the-loop review: zero code is written to disk until engineers inspect side-by-side AST diffs, variable mappings, and logic parity indicators.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>⚡</span> Automated Syntax Self-Repair Loop
                <span class="feature-badge">COMPILER VERIFIED</span>
              </div>
              <div class="feature-desc">
                Validates generated code against local target language parsers. Syntactic failures are fed back for immediate self-correction before presenting to the engineer.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Commercial Advantage:</strong> Unlock lucrative multi-million dollar mainframe modernization and data stack migration projects with zero risk.
        </div>
        <div class="footer-page">Slide 10 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 11: CAPABILITY 8 — SECURITY, GIT & VIRTUAL GUIDE ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 8 &bull; SECURITY &amp; ASSISTANCE</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>100/100 AUDIT SCORE</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">GOVERNANCE, DEV-OPS HUB &amp; IN-APP ARCHITECTURAL ASSISTANCE</span>
          <h2 class="main-title">
            Pre-Flight Security Auditor, <span class="highlight-cyan">🌿 Git Hub &amp; Virtual Guide</span>
          </h2>
          <p class="subtitle">
            Ship with 100/100 enterprise security scores, push code directly via the Green Leaf Git pane, and navigate complex architectures with the In-App Virtual Guide.
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
              <div class="window-caption">In-App Virtual Assistant Drawer &amp; Security Auditor Dashboard</div>
            </div>
            <img src="${img09_virtualguide}" class="screenshot-img" alt="Virtual Guide & Security" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🛡️</span> Pre-Flight Security Scanner (100/100)
                <span class="feature-badge">ZERO LEAKS</span>
              </div>
              <div class="feature-desc">
                Automated security audits: detects hardcoded secrets, validates PII tokenization masks, audits dependency CVEs, and locks credentials in native OS vaults.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🌿</span> Dedicated Green Leaf Git &amp; DevOps Hub
                <span class="feature-badge">1-CLICK SHIPPING</span>
              </div>
              <div class="feature-desc">
                Direct repository integration for Bitbucket, GitHub, and GitLab. Live working tree diffs, AI-assisted commit message drafting, and pull request initiation without leaving the app.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>💡</span> In-App Virtual Guide &amp; Doc Ingestion
                <span class="feature-badge">IP GUARDRAILS</span>
              </div>
              <div class="feature-desc">
                Ingests client enterprise architecture documents, answers workflow questions, suggests phase navigation, and provides architectural deep-dives under strict IP guardrails.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Enterprise Readiness:</strong> Passes enterprise CISO security audits on day one with zero external telemetry and complete provenance trails.
        </div>
        <div class="footer-page">Slide 11 / 12</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 12: THE ENTREPRENEUR MOAT & ROI ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>COMMERCIAL MOAT &bull; ROI MULTIPLIER</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>4X MARGIN EXPANSION</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">COMMERCIAL ADVANTAGE &amp; SCALABLE REPEATABILITY</span>
          <h2 class="main-title">
            The Entrepreneur's Moat: <span class="highlight-cyan">Turn Consulting into High-Margin Delivery</span>
          </h2>
          <p class="subtitle">
            Scale your AI solutions practice from bespoke manual consulting into a high-margin, repeatable delivery machine with defensible intellectual property.
          </p>
        </div>

        <div class="table-container">
          <table class="roi-table">
            <thead>
              <tr>
                <th>Delivery Dimension</th>
                <th>Status Quo AI Consulting</th>
                <th>Evolve AI Delivery Studio</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Discovery to Architectural Contract</td>
                <td>3 to 6 weeks of disjointed workshops &amp; slide decks</td>
                <td>Under 2 hours with live introspected 2D/3D models &amp; signed ADRs</td>
              </tr>
              <tr>
                <td>Regulated Enterprise Market Eligibility</td>
                <td>0% — Blocked by data-exfiltration &amp; public SaaS policies</td>
                <td>100% — Air-gapped local execution on existing client hardware</td>
              </tr>
              <tr>
                <td>Hallucination &amp; Drift Risk</td>
                <td>High — Uncontrolled prompts &amp; heuristic guessing</td>
                <td>Zero Drift — Strict Rule vs Model gates &amp; 100% SKU Recall</td>
              </tr>
              <tr>
                <td>Infrastructure &amp; Token Overhead</td>
                <td>Runaway monthly cloud SaaS &amp; GPU token expenses</td>
                <td>Zero Cloud Overhead — Runs on local hardware (Ollama, local Gemma)</td>
              </tr>
              <tr>
                <td>Gross Delivery Margins</td>
                <td>20% – 30% (linear manual labor &amp; bespoke rework)</td>
                <td>70% – 85% (repeatable multi-agent swarms &amp; automated scaffolding)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px;">
          <div class="feature-card accent" style="padding: 16px 20px;">
            <div class="feature-title" style="font-size: 16.5px;">
              <span>🏆</span> Defensible Enterprise Market Monopoly
            </div>
            <div class="feature-desc" style="font-size: 14px;">
              While competitors fight over commodity wrapper startups, Evolve AI unlocks the <strong>untapped $100B+ regulated enterprise sector</strong> by guaranteeing 100% data sovereignty, mathematical determinism, and full auditability.
            </div>
          </div>

          <div class="feature-card green" style="padding: 16px 20px;">
            <div class="feature-title" style="font-size: 16.5px;">
              <span>🤝</span> Onboarding &amp; Immediate Pilot Engagement
            </div>
            <div class="feature-desc" style="font-size: 14px;">
              <strong>Production Release v2.28.0</strong> is packaged and ready for deployment. We onboard enterprise clients through focused cohorts with dedicated engineering support. Contact us for a live walkthrough: <strong style="color: #34d399;">support@evolveminds.com.au</strong>.
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Next Action:</strong> Request a live executive demonstration or deploy the v2.28.0 desktop binary in your environment today.
        </div>
        <div class="footer-page">Slide 12 / 12 &bull; Finish</div>
      </div>
    </div>
  </div>

</body>
</html>
`;

// Save the HTML file
const htmlOutPath = path.resolve(__dirname, '..', 'docs', 'Evolve_AI_Entrepreneur_Presentation_Deck.html');
fs.writeFileSync(htmlOutPath, htmlContent, 'utf8');
console.log(`Saved self-contained presentation HTML to: ${htmlOutPath} (${(fs.statSync(htmlOutPath).size / 1024 / 1024).toFixed(2)} MB)`);

// Compile to PDF using Chrome Headless
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pdfOutPath = path.resolve(__dirname, '..', 'docs', 'Evolve_AI_Entrepreneur_Deck.pdf');
const tempPdfPath = path.resolve(__dirname, '..', 'docs', 'Evolve_AI_Entrepreneur_Deck_temp.pdf');

console.log('Compiling 16:9 widescreen presentation PDF via Chrome headless...');
try {
  const fileUrl = 'file:///' + htmlOutPath.replace(/\\/g, '/');
  const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --virtual-time-budget=5000 --print-to-pdf="${tempPdfPath}" --print-to-pdf-no-header "${fileUrl}"`;
  execSync(cmd, { stdio: 'inherit' });

  // Safely replace destination
  try {
    if (fs.existsSync(pdfOutPath)) {
      fs.unlinkSync(pdfOutPath);
    }
    fs.renameSync(tempPdfPath, pdfOutPath);
    console.log(`Successfully compiled PDF to: ${pdfOutPath} (${(fs.statSync(pdfOutPath).size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (renameErr) {
    console.warn(`Note: Could not overwrite ${pdfOutPath} directly (file may be open in a viewer). Saved as: ${tempPdfPath}`);
  }
} catch (e) {
  console.error('Error compiling PDF:', e.message);
}
