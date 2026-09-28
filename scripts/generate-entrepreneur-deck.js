const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const screenshotDir = path.resolve(__dirname, '..', 'docs', 'screenshots');

function getBase64Image(filename) {
  const filePath = path.join(screenshotDir, filename);
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString('base64')}`;
  }
  console.warn(`Warning: Image ${filename} not found at ${filePath}`);
  return '';
}

const img01_cockpit = getBase64Image('01_schema_topology_2d_3d.png');
const img02_livedb = getBase64Image('02_live_db_introspector_modal.png');
const img03_topology = getBase64Image('03_schema_topology_2d_3d_real.png');
const img04_solutioning = getBase64Image('04_ai_solutioning_phase3_real.png');
const img05_3dmanifold = getBase64Image('05_3d_visual_analytics_manifold_real.png');
const img06_converter = getBase64Image('05_code_converter_26lang.png');
const img07_security = getBase64Image('06_security_preflight_scanner.png');

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
      padding: 56px 80px 44px 80px;
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
      margin-bottom: 20px;
    }

    .brand-pill {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(56, 189, 248, 0.35);
      padding: 8px 20px;
      border-radius: 9999px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #38bdf8;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      font-weight: 600;
      color: #89d185;
      background: rgba(137, 209, 133, 0.12);
      border: 1px solid rgba(137, 209, 133, 0.3);
      padding: 6px 16px;
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
      margin-bottom: 18px;
    }

    .category-kicker {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #4ec9b0;
      margin-bottom: 8px;
      display: block;
    }

    .main-title {
      font-size: 40px;
      line-height: 1.15;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: #ffffff;
      margin-bottom: 8px;
    }

    .main-title .highlight-cyan {
      background: linear-gradient(135deg, #38bdf8 0%, #4ec9b0 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .main-title .highlight-red {
      color: #f43f5e;
    }

    .main-title .highlight-ochre {
      background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      font-size: 19.5px;
      line-height: 1.4;
      color: #94a3b8;
      font-weight: 500;
      max-width: 1520px;
    }

    /* Two-Column Split Layout for Capability Slides */
    .slide-body-split {
      display: grid;
      grid-template-columns: 1.25fr 0.75fr;
      gap: 36px;
      align-items: center;
      flex: 1;
      margin: 10px 0;
    }

    .screenshot-frame {
      background: #0f172a;
      border: 1.5px solid rgba(56, 189, 248, 0.4);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75);
      position: relative;
    }

    .screenshot-frame-header {
      background: rgba(30, 41, 59, 0.95);
      padding: 8px 16px;
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
      font-size: 11.5px;
      color: #94a3b8;
      font-weight: 600;
    }

    .screenshot-img {
      width: 100%;
      height: auto;
      display: block;
      object-fit: contain;
      background: #060911;
    }

    /* Cards & Feature Callouts */
    .features-list {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .feature-card {
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(51, 65, 85, 0.8);
      border-radius: 14px;
      padding: 18px 22px;
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
      font-size: 17.5px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .feature-desc {
      font-size: 14.5px;
      line-height: 1.48;
      color: #94a3b8;
    }

    .feature-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
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
      gap: 24px;
      flex: 1;
      align-items: stretch;
      margin: 14px 0;
    }

    .card-problem {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(244, 63, 94, 0.4);
      border-top: 4px solid #f43f5e;
      border-radius: 16px;
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card-problem-title {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .card-problem-desc {
      font-size: 16px;
      line-height: 1.55;
      color: #94a3b8;
    }

    /* Comparison Table */
    .table-container {
      margin: 16px 0;
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
      background: rgba(30, 41, 59, 0.8);
      padding: 16px 24px;
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #cbd5e1;
      border-bottom: 1px solid rgba(51, 65, 85, 0.8);
    }

    .roi-table td {
      padding: 16px 24px;
      font-size: 16px;
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
      padding-top: 18px;
      border-top: 1px solid rgba(51, 65, 85, 0.6);
      margin-top: 10px;
    }

    .footer-brand {
      font-size: 14px;
      font-weight: 600;
      color: #64748b;
    }

    .footer-brand strong {
      color: #cbd5e1;
    }

    .footer-page {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 4px 14px;
      border-radius: 6px;
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
  </style>
</head>
<body>

  <!-- ==================== SLIDE 1: COVER ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill">
            <span>⚡ EVOLVE AI ENTERPRISE STUDIO</span>
          </div>
          <div class="status-badge">
            <span class="pulse-dot"></span>
            <span>100% AIR-GAPPED &bull; SOVEREIGN DESKTOP</span>
          </div>
        </div>

        <div class="heading-group" style="margin-top: 40px; margin-bottom: 30px;">
          <span class="category-kicker">ENTERPRISE DELIVERY PLATFORM FOR AI FOUNDERS &amp; ENTREPRENEURS</span>
          <h1 class="main-title" style="font-size: 56px; line-height: 1.12; max-width: 1400px;">
            Deploy Client AI in <span class="highlight-cyan">14 Days</span> Instead of 3 Months
          </h1>
          <p class="subtitle" style="font-size: 24px; margin-top: 16px; max-width: 1300px;">
            The zero-admin, standalone engineering workbench that turns complex enterprise legacy databases, strict InfoSec compliance, and client IT lockouts into rapid, high-margin delivery.
          </p>
        </div>

        <!-- 3 Feature Highlight Boxes -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 40px;">
          <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 16px; padding: 26px;">
            <div style="font-size: 28px; margin-bottom: 10px;">💻</div>
            <div style="font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 6px;">Zero Admin Rights (.exe)</div>
            <div style="font-size: 15px; color: #94a3b8; line-height: 1.45;">Portable 74.7 MB desktop binary runs immediately on locked-down client machines with zero installation friction.</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 16px; padding: 26px;">
            <div style="font-size: 28px; margin-bottom: 10px;">🌐</div>
            <div style="font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 6px;">2D &amp; 3D Schema Topology</div>
            <div style="font-size: 15px; color: #94a3b8; line-height: 1.45;">Introspects 7 live DB engines, renders column-to-column bezier links, and auto-generates production dbt staging marts.</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 16px; padding: 26px;">
            <div style="font-size: 28px; margin-bottom: 10px;">🔒</div>
            <div style="font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 6px;">Bank-Grade InfoSec Day 1</div>
            <div style="font-size: 15px; color: #94a3b8; line-height: 1.45;">Operates 100% air-gapped inside client VPCs. Zero cloud data leaks, offline Ed25519 licensing, and SHA-256 integrity audits.</div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          Published by <strong>Evolve Mind Solutions Pty Ltd</strong> &bull; Sydney, Australia &bull; <span style="color:#38bdf8;">evolveminds.com.au</span>
        </div>
        <div class="footer-page">Slide 01 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 2: THE PROBLEM ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>THE ENTERPRISE CHASM</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>WHY FOUNDERS STALL</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">THE UNGLAMOROUS REALITY OF ENTERPRISE CLIENT PILOTS</span>
          <h2 class="main-title">
            Why 80% of Enterprise AI Pilots <span class="highlight-red">Burn Runway &amp; Fail</span>
          </h2>
          <p class="subtitle">
            Technical founders don't lose enterprise deals on AI intelligence. They lose them on delivery friction, IT permission blocks, and weeks of manual data plumbing.
          </p>
        </div>

        <div class="grid-3col">
          <div class="card-problem">
            <div class="card-problem-title">
              <span>💻</span> 1. The IT Admin Wall
            </div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #fb7185; font-weight: 700;">4 TO 8 WEEKS LOST</div>
            <div class="card-problem-desc">
              Client security policies strictly prohibit third-party installers, command-line developer tools, or VS Code plugins on enterprise laptops. Your engineers waste up to two months waiting for IT ticketing approvals just to set up basic developer tooling.
            </div>
          </div>

          <div class="card-problem">
            <div class="card-problem-title">
              <span>🔒</span> 2. The Cloud SaaS InfoSec Veto
            </div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #fb7185; font-weight: 700;">BLOCKED BY RISK &amp; COMPLIANCE</div>
            <div class="card-problem-desc">
              Proprietary banking schemas, customer PII, and production transactional databases cannot touch public SaaS endpoints or third-party cloud LLM APIs. Cloud-dependent coding tools fail bank-grade data sovereignty reviews immediately.
            </div>
          </div>

          <div class="card-problem">
            <div class="card-problem-title">
              <span>🍝</span> 3. The Spaghetti Schema Sinkhole
            </div>
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #fb7185; font-weight: 700;">80% OF TIME SPENT ON PLUMBING</div>
            <div class="card-problem-desc">
              Client data is locked across 200+ undocumented relational tables in Oracle, Postgres, or SQL Server. Engineers spend weeks hand-crafting schema mappers, writing pipeline glue, and transposing legacy stored procedures instead of building AI features.
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>The Takeaway:</strong> To scale enterprise AI revenue, founders need a sovereign, zero-install delivery platform that satisfies InfoSec on Day 1.
        </div>
        <div class="footer-page">Slide 02 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 3: CAPABILITY 1 — DESKTOP COCKPIT ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 1 &bull; DESKTOP STUDIO</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>ZERO ADMIN PRIVILEGES</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PORTABLE SOVEREIGN COCKPIT</span>
          <h2 class="main-title">
            Zero-Admin Portable <span class="highlight-cyan">Desktop Architecture</span>
          </h2>
          <p class="subtitle">
            Runs instantly as a standalone 74.7 MB executable. No admin elevation, no registry edits, and no VS Code dependency.
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
              <div class="window-caption">Evolve AI Enterprise Studio — Frontline Delivery Cockpit</div>
            </div>
            <img src="${img01_cockpit}" class="screenshot-img" alt="Desktop Studio Cockpit" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>💻</span> Standalone Portable Executable
                <span class="feature-badge">ZERO INSTALL</span>
              </div>
              <div class="feature-desc">
                Engineers download and launch the app immediately on client-managed Windows laptops. Eliminates the 6-week IT procurement bottleneck completely.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🛡️</span> 100% Air-Gapped &amp; Local Execution
                <span class="feature-badge">AIR-GAPPED V8</span>
              </div>
              <div class="feature-desc">
                Zero external telemetry, zero SaaS dependencies. Operates entirely inside the client’s local VPC or air-gapped network with offline Ollama model bindings.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>🌿</span> Integrated Git &amp; Step Navigation
                <span class="feature-badge">PHASES 1–6</span>
              </div>
              <div class="feature-desc">
                Structured delivery methodology: Discover &amp; Frame ➔ Engineering Core ➔ AI Solutioning ➔ Reliability &amp; Evals ➔ Deploy &amp; Influence ➔ DevOps &amp; Git.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Frontline Velocity:</strong> Deploy your team on Day 1 without filing a single IT installation ticket.
        </div>
        <div class="footer-page">Slide 03 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 4: CAPABILITY 2 — LIVE DB INTROSPECTOR ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 2 &bull; DATABASE INTROSPECTOR</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>7 ENGINES SUPPORTED</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">INSTANT DATA CONNECTIVITY &amp; SAMPLING</span>
          <h2 class="main-title">
            Universal Live <span class="highlight-cyan">Database Introspection</span>
          </h2>
          <p class="subtitle">
            Direct read-only schema scanning and live data sampling across 7 major database engines with zero data leaving the VPC.
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
              <div class="window-caption">Connect Live Database / Warehouse — Multi-Engine Matrix</div>
            </div>
            <img src="${img02_livedb}" class="screenshot-img" alt="Live Database Introspector" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🔌</span> Multi-Engine Matrix
                <span class="feature-badge">READ-ONLY</span>
              </div>
              <div class="feature-desc">
                Native drivers for <strong>PostgreSQL, Snowflake, BigQuery, SQL Server, MySQL, SQLite, and ClickHouse</strong>. Scans schemas in seconds without overhead.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>⚡</span> 1-Click Config Auto-Detection
                <span class="feature-badge">AUTO-DETECT</span>
              </div>
              <div class="feature-desc">
                Instantly parses workspace configuration files (<code style="color:#38bdf8;">.env</code>, <code style="color:#38bdf8;">dbt_project.yml</code>, Prisma, Supabase) to establish live connections in 1 click.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>🔐</span> In-Memory Vault Policy
                <span class="feature-badge">SESSION ONLY</span>
              </div>
              <div class="feature-desc">
                Credentials are kept in volatile memory only and never written to plain-text configuration files, meeting strict bank-grade InfoSec policies.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Schema Discovery:</strong> Eliminate manual DDL dumps and discover live client schemas in under 5 minutes.
        </div>
        <div class="footer-page">Slide 04 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 5: CAPABILITY 3 — 2D & 3D SCHEMA TOPOLOGY ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 3 &bull; DATA TOPOLOGY</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>265+ TABLES AUTO-FIT</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">CROSS-TABLE TOPOLOGY &amp; CLIENT SHOWCASE</span>
          <h2 class="main-title">
            Interactive <span class="highlight-cyan">2D &amp; 3D Schema Topology</span>
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
                1-click toggle between a 20x14 dynamic technical ERD grid and an interactive 3D Celestial star cluster. Auto-fits massive enterprise schemas (265+ tables) with responsive bounding-box layout.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>🔗</span> Column-to-Column Relational Linking
                <span class="feature-badge">[PK] ➔ [FK]</span>
              </div>
              <div class="feature-desc">
                Illuminated cubic bezier curves linking exact primary keys to foreign keys with socket pins. Hover within 14px for live join formula tooltips, multi-hop path resolution, and cardinality metrics.
              </div>
            </div>

            <div class="feature-card ochre">
              <div class="feature-title">
                <span>💡</span> Table &amp; Link Isolation Mode
                <span class="feature-badge">4% GHOST OPACITY</span>
              </div>
              <div class="feature-desc">
                Click any connection line to dim unrelated noise to <strong>4% blueprint ghost opacity</strong>, spotlighting joined transactional entities with glowing halos, animated photon particles, and instant ANSI SQL generation.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Visual Impact:</strong> Walk into client architectural reviews and project crystal-clear data models that establish instant executive authority.
        </div>
        <div class="footer-page">Slide 05 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 6: CAPABILITY 4 — AI SOLUTIONING CONTRACT ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 4 &bull; AI SOLUTIONING</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>DETERMINISTIC AI</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">PHASE 3: GOVERNANCE, RAG ARCHITECTURE &amp; CAPABILITY LADDER</span>
          <h2 class="main-title">
            AI Solutioning Contract &amp; <span class="highlight-cyan">Hybrid RAG Engine</span>
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
                Explicitly verifies "Do We Need AI?" Auto-locks target capability levels (Level 1 deterministic rules to Level 5 autonomous agents) to eliminate hallucinations and unnecessary API costs.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>🛠️</span> 1-Click Code &amp; MCP Scaffolding
                <span class="feature-badge">NODE / PYTHON</span>
              </div>
              <div class="feature-desc">
                Instantly scaffolds production TypeScript/Python Hybrid RAG services, PostgreSQL + pgvector connectors, and standardized Model Context Protocol (MCP) tool servers.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Enterprise Trust:</strong> Give clients verifiable, audited AI architectures with guaranteed zero drift and transparent cost controls.
        </div>
        <div class="footer-page">Slide 06 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 7: CAPABILITY 5 — 3D DATA VISUAL ANALYTICS ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 5 &bull; 3D DATA ANALYTICS</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>TOPOLOGICAL MANIFOLD</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">ADVANCED 3D DATA MANIFOLD &amp; OUTLIER DIAGNOSTICS</span>
          <h2 class="main-title">
            3D Visual Analytics Manifold &amp; <span class="highlight-cyan">Diagnostics</span>
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
        <div class="footer-page">Slide 07 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 8: CAPABILITY 6 — CODE CONVERTER ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 6 &bull; CODE MODERNIZATION</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>26 LANGUAGES</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">CROSS-STACK AST IDIOM TRANSLATION</span>
          <h2 class="main-title">
            26-Language Code Modernizer &amp; <span class="highlight-cyan">SQL Transpiler</span>
          </h2>
          <p class="subtitle">
            Transpile legacy Oracle PL/SQL &amp; T-SQL into modern Snowflake/BigQuery dbt models, and modernize backend code into cloud-native targets.
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
              <div class="window-caption">Code Converter Studio — 26-Language Cross-Stack Translation</div>
            </div>
            <img src="${img06_converter}" class="screenshot-img" alt="Code Converter Studio" />
          </div>

          <div class="features-list">
            <div class="feature-card accent">
              <div class="feature-title">
                <span>🔄</span> Oracle &amp; T-SQL Transpiler
                <span class="feature-badge">DBT MODELS</span>
              </div>
              <div class="feature-desc">
                Converts complex stored procedures directly into verified Snowflake &amp; BigQuery dbt models complete with schema validation contracts.
              </div>
            </div>

            <div class="feature-card green">
              <div class="feature-title">
                <span>⚡</span> Real AST Idiom Translation
                <span class="feature-badge">ZERO MOCKS</span>
              </div>
              <div class="feature-desc">
                Translates code across 26 languages (COBOL, C#, Java, Python, TypeScript, Go) with real abstract syntax tree idiom mapping—no placeholder code.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>🛡️</span> Row-Level Security (RLS) Scaffolder
                <span class="feature-badge">MULTI-TENANT</span>
              </div>
              <div class="feature-desc">
                Generates production multi-tenant isolation and row-level security policies across Postgres, Snowflake, and BigQuery automatically.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Migration Velocity:</strong> Cut enterprise legacy modernization projects from 6 months down to 2 weeks.
        </div>
        <div class="footer-page">Slide 08 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 9: CAPABILITY 7 — SECURITY & PRE-FLIGHT ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>CAPABILITY 7 &bull; SECURITY AUDITOR</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>100/100 CLEAN WORKSPACE</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">ZERO-TRUST SOVEREIGNTY &amp; AUDITABILITY</span>
          <h2 class="main-title">
            Pre-Flight Security Auditor &amp; <span class="highlight-cyan">Compliance</span>
          </h2>
          <p class="subtitle">
            Pre-flight secret scanning, in-flight PII masking, and cryptographic verification designed to pass strict bank and healthcare audits on Day 1.
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
              <div class="window-caption">Security Scanner &amp; Pre-Flight Health Auditor — 100/100 Clean</div>
            </div>
            <img src="${img07_security}" class="screenshot-img" alt="Security Scanner & Pre-Flight" />
          </div>

          <div class="features-list">
            <div class="feature-card green">
              <div class="feature-title">
                <span>🛡️</span> 100/100 Pre-Flight Health Auditor
                <span class="feature-badge">ZERO LEAKS</span>
              </div>
              <div class="feature-desc">
                Scans the entire project workspace for dangling API credentials, unencrypted secrets, and leftover build artifacts before client code handoff.
              </div>
            </div>

            <div class="feature-card accent">
              <div class="feature-title">
                <span>🔐</span> Offline Ed25519 Cryptographic Licensing
                <span class="feature-badge">NODE-LOCKED</span>
              </div>
              <div class="feature-desc">
                Hardware-bound asymmetric key validation with corporate email domain enforcement. Operates 100% offline with zero external license servers.
              </div>
            </div>

            <div class="feature-card purple">
              <div class="feature-title">
                <span>📜</span> Tamper-Evident SHA-256 Receipts
                <span class="feature-badge">AUDIT READY</span>
              </div>
              <div class="feature-desc">
                Every generated deliverable and data contract carries an immutable cryptographic digest for client governance and regulatory audit trails.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Security Guarantee:</strong> Pass InfoSec and compliance on Day 1—no cloud data leaks, no corporate policy violations.
        </div>
        <div class="footer-page">Slide 09 / 10</div>
      </div>
    </div>
  </div>

  <!-- ==================== SLIDE 10: THE ENTREPRENEUR MOAT & ROI ==================== -->
  <div class="slide">
    <div class="content-layer">
      <div>
        <div class="top-bar">
          <div class="brand-pill"><span>FOUNDER ROI &bull; PARTNERSHIP</span></div>
          <div class="status-badge"><span class="pulse-dot"></span><span>PRIVATE PILOT COHORT</span></div>
        </div>

        <div class="heading-group">
          <span class="category-kicker">DELIVERY VELOCITY AS A COMPETITIVE MOAT</span>
          <h2 class="main-title">
            The Entrepreneur Advantage: <span class="highlight-cyan">4x Faster Client Handoff</span>
          </h2>
          <p class="subtitle">
            How technical founders and agency entrepreneurs win high-compliance enterprise deals and protect delivery margins.
          </p>
        </div>

        <div class="table-container">
          <table class="roi-table">
            <thead>
              <tr>
                <th style="width: 25%;">Delivery Dimension</th>
                <th style="width: 37%;">Traditional Consulting / Custom Code</th>
                <th style="width: 38%;">Evolve AI FDE Delivery Studio</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Client Tooling Setup</td>
                <td>4–8 Weeks (IT procurement &amp; MSI tickets)</td>
                <td>Instant (Portable .exe, Zero Admin Rights)</td>
              </tr>
              <tr>
                <td>InfoSec &amp; Compliance</td>
                <td>Stalled / Blocked by Cloud SaaS Bans</td>
                <td>Pass Day 1 (100% Air-Gapped / Local VPC)</td>
              </tr>
              <tr>
                <td>Database &amp; Schema Discovery</td>
                <td>2–3 Weeks manual DDL &amp; ERD drafting</td>
                <td>&lt; 15 Minutes (Live 7-DB + 2D/3D Topology)</td>
              </tr>
              <tr>
                <td>Legacy Code / SQL Migration</td>
                <td>Months of tedious manual SQL rewrites</td>
                <td>Automated (Phase 5 AST Transpiler Engine)</td>
              </tr>
              <tr>
                <td>Deliverable Packaging</td>
                <td>Ad-hoc scripts &amp; scattered markdown</td>
                <td>Turnkey GitOps Repo &amp; POC Approval Pack</td>
              </tr>
              <tr>
                <td>Client Delivery Timeline</td>
                <td>90–120 Days average POC cycle</td>
                <td>&lt; 14 Days Guaranteed Delivery</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Call to Action Box -->
        <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%); border: 1.5px solid rgba(56, 189, 248, 0.4); border-radius: 16px; padding: 22px 28px; display: flex; justify-content: space-between; align-items: center; margin-top: 14px;">
          <div>
            <div style="font-size: 20px; font-weight: 700; color: #fff;">Join the Private Enterprise Pilot Program</div>
            <div style="font-size: 14.5px; color: #94a3b8; margin-top: 4px;">Equip your technical delivery team with the standalone studio and test it against your client schemas.</div>
          </div>
          <div style="text-align: right;">
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 700; color: #38bdf8;">evolveminds.com.au/products/evolve-ai/</div>
            <div style="font-size: 13.5px; color: #94a3b8; margin-top: 2px;">Bala Thiyagarajan &bull; contact@evolveminds.com.au</div>
          </div>
        </div>
      </div>

      <div class="slide-footer">
        <div class="footer-brand">
          <strong>Evolve Mind Solutions Pty Ltd</strong> &bull; Level 1, 63-73 Ann St, Surry Hills NSW 2010 &bull; Sydney, Australia
        </div>
        <div class="footer-page">Slide 10 / 10 &bull; Finish</div>
      </div>
    </div>
  </div>

</body>
</html>
`;

const outputHtmlPath = path.join(__dirname, '..', 'docs', 'Evolve_AI_Entrepreneur_Presentation_Deck.html');
fs.writeFileSync(outputHtmlPath, htmlContent, 'utf-8');
console.log('Saved updated presentation deck HTML to:', outputHtmlPath);

const outputPdfPath = path.join(__dirname, '..', 'docs', 'Evolve_AI_Entrepreneur_Deck.pdf');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

console.log('Compiling 16:9 widescreen presentation PDF with Chrome headless...');
try {
  const cmd = `"${chromePath}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw --print-to-pdf="${outputPdfPath}" --no-pdf-header-footer "${outputHtmlPath}"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log('Successfully re-compiled presentation PDF to:', outputPdfPath);

  // Also attempt to copy to the original filename if unlocked
  try {
    const origPath = path.join(__dirname, '..', 'docs', 'Evolve_AI_Entrepreneur_Presentation_Deck.pdf');
    fs.copyFileSync(outputPdfPath, origPath);
    console.log('Also updated:', origPath);
  } catch(e) {
    console.log('Note: Original file is locked by a viewer, main updated PDF is at:', outputPdfPath);
  }
} catch (err) {
  console.error('Error generating PDF:', err.message);
  process.exit(1);
}
