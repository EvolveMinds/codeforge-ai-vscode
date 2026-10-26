/**
 * fde/mainframeScreenEngine.ts
 *
 * Enterprise IBM Mainframe (z/OS & iSeries AS/400) Screen Emulation & Modernization Engine.
 * 
 * Capabilities:
 *  - Full screen state modeling for IBM iSeries (TN5250) & IBM z/OS (TN3270).
 *  - Interactive 24x80 terminal rendering with clickable menu hotspots and command prompts.
 *  - Real enterprise screen templates:
 *     * IBM i (AS/400): MAIN (Main Menu), WRKACTJOB (Active Jobs), WRKSYSSTS (System Status),
 *                       WRKSPLF (Spooled Files), DSPMSG (System Messages), STRSQL (Db2 for i SQL).
 *     * IBM z/OS:       ISPF Primary Option Menu, SDSF DA (Active Jobs & CPU), CICS CEMT Operator.
 *  - Modern Navigation: Mouse-clickable hotspots, modern function keys (F1-F12, Enter, Cancel),
 *    command palette with autocomplete, and Natural Language navigation (e.g. "show active jobs").
 *  - Dual-View Architecture: Seamlessly renders as Classic CRT Phosphor Terminal OR Modern Web Card View.
 *  - 1-Click Modernization: Automatically generates OpenAPI 3.0 REST endpoints and React components
 *    that replicate the screen in modern web applications.
 */

export type MainframeSystemType = 'iseries_5250' | 'zos_3270';

export interface ScreenHotspot {
  text: string;
  command: string;
  targetScreenId?: string;
  description: string;
}

export interface ModernMetric {
  label: string;
  value: string;
  color?: string;
  percentage?: number;
}

export interface ModernTable {
  title?: string;
  headers: string[];
  rows: Array<string[]>;
}

export interface ModernCardModel {
  title: string;
  subtitle: string;
  badge: string;
  system: string;
  metrics?: ModernMetric[];
  tables?: ModernTable[];
  quickActions: Array<{ label: string; command: string; color?: string }>;
}

export interface ModernApiSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  description: string;
  parameters?: Array<{ name: string; in: string; type: string; description: string }>;
  responseExample: any;
}

export interface MainframeScreen {
  id: string;
  system: MainframeSystemType;
  title: string;
  rawText: string[];
  hotspots: ScreenHotspot[];
  modernModel: ModernCardModel;
  apiSpec: ModernApiSpec;
  reactSnippet: string;
}

export class MainframeScreenEngine {
  private _screens: Map<string, MainframeScreen> = new Map();
  private _currentScreenId: string = 'MAIN';
  private _systemType: MainframeSystemType = 'iseries_5250';
  private _history: string[] = [];

  constructor() {
    this._initScreens();
  }

  public get currentScreenId(): string {
    return this._currentScreenId;
  }

  public get systemType(): MainframeSystemType {
    return this._systemType;
  }

  public setSystemType(sys: MainframeSystemType): void {
    this._systemType = sys;
    if (sys === 'iseries_5250') {
      this._currentScreenId = 'MAIN';
    } else {
      this._currentScreenId = 'ISPF_PRIM';
    }
  }

  public getCurrentScreen(): MainframeScreen {
    const screen = this._screens.get(this._currentScreenId);
    if (!screen) {
      return this._screens.get('MAIN')!;
    }
    return screen;
  }

  public getAllScreens(): MainframeScreen[] {
    return Array.from(this._screens.values());
  }

  public getScreensForSystem(sys: MainframeSystemType): MainframeScreen[] {
    return this.getAllScreens().filter(s => s.system === sys);
  }

  /**
   * Navigates to a specific screen ID.
   */
  public navigateTo(screenId: string): boolean {
    if (this._screens.has(screenId)) {
      this._history.push(this._currentScreenId);
      this._currentScreenId = screenId;
      this._systemType = this._screens.get(screenId)!.system;
      return true;
    }
    return false;
  }

  /**
   * Executes a command string (CL command, TSO command, option number, or natural language query).
   */
  public executeCommand(input: string): { success: boolean; message: string; targetScreen?: string } {
    const trimmed = input.trim();
    if (!trimmed) {
      return { success: false, message: 'Empty command entered.' };
    }

    const upper = trimmed.toUpperCase();

    // 1. Check direct screen ID or command aliases
    if (upper === 'WRKACTJOB' || upper === 'ACTJOB' || upper === 'JOBS') {
      this.navigateTo('WRKACTJOB');
      return { success: true, message: 'Navigated to Work with Active Jobs (WRKACTJOB)', targetScreen: 'WRKACTJOB' };
    }

    if (upper === 'WRKSYSSTS' || upper === 'SYSSTS' || upper === 'STATUS' || upper === 'SYS') {
      this.navigateTo('WRKSYSSTS');
      return { success: true, message: 'Navigated to Work with System Status (WRKSYSSTS)', targetScreen: 'WRKSYSSTS' };
    }

    if (upper === 'WRKSPLF' || upper === 'SPLF' || upper === 'SPOOL' || upper === 'PRINTS') {
      this.navigateTo('WRKSPLF');
      return { success: true, message: 'Navigated to Work with Spooled Files (WRKSPLF)', targetScreen: 'WRKSPLF' };
    }

    if (upper === 'DSPMSG' || upper === 'MESSAGES' || upper === 'MSG') {
      this.navigateTo('DSPMSG');
      return { success: true, message: 'Navigated to Display System Messages (DSPMSG)', targetScreen: 'DSPMSG' };
    }

    if (upper === 'STRSQL' || upper === 'SQL' || upper === 'DB2') {
      this.navigateTo('STRSQL');
      return { success: true, message: 'Navigated to Interactive SQL (STRSQL)', targetScreen: 'STRSQL' };
    }

    if (upper === 'MAIN' || upper === 'GO MAIN' || upper === 'MENU') {
      this.navigateTo('MAIN');
      return { success: true, message: 'Navigated to AS/400 Main Menu (MAIN)', targetScreen: 'MAIN' };
    }

    if (upper === 'ISPF' || upper === 'TSO ISPF') {
      this.navigateTo('ISPF_PRIM');
      return { success: true, message: 'Navigated to z/OS ISPF Primary Option Menu', targetScreen: 'ISPF_PRIM' };
    }

    if (upper === 'SDSF' || upper === 'DA') {
      this.navigateTo('SDSF_DA');
      return { success: true, message: 'Navigated to z/OS SDSF Display Active (DA)', targetScreen: 'SDSF_DA' };
    }

    if (upper === 'CICS' || upper === 'CEMT') {
      this.navigateTo('CICS_CEMT');
      return { success: true, message: 'Navigated to CICS Master Terminal (CEMT)', targetScreen: 'CICS_CEMT' };
    }

    // 2. Contextual Menu Options on current screen
    const current = this.getCurrentScreen();
    for (const hs of current.hotspots) {
      if (hs.command.toUpperCase() === upper && hs.targetScreenId) {
        this.navigateTo(hs.targetScreenId);
        return { success: true, message: `Option ${hs.command} selected: ${hs.description}`, targetScreen: hs.targetScreenId };
      }
    }

    // 3. Natural Language Navigation Intent
    const nlMatch = this.navigateByNaturalLanguage(trimmed);
    if (nlMatch.success) {
      return nlMatch;
    }

    return {
      success: false,
      message: `Command or option "${trimmed}" not recognized on screen ${current.id}. Try WRKACTJOB, WRKSYSSTS, WRKSPLF, DSPMSG, STRSQL, or F3 to exit.`
    };
  }

  /**
   * Handles modern function keys: F1, F3, F4, F5, F9, F12, Enter.
   */
  public pressFunctionKey(key: string): { success: boolean; message: string; targetScreen?: string } {
    const k = key.toUpperCase();

    if (k === 'F3' || k === 'F12') {
      // Exit / Cancel: Go back in history or to MAIN/ISPF_PRIM
      if (this._history.length > 0) {
        const prev = this._history.pop()!;
        this._currentScreenId = prev;
        return { success: true, message: `Exited to previous screen (${prev}).`, targetScreen: prev };
      }
      const root = this._systemType === 'iseries_5250' ? 'MAIN' : 'ISPF_PRIM';
      this._currentScreenId = root;
      return { success: true, message: `Returned to root screen (${root}).`, targetScreen: root };
    }

    if (k === 'F5') {
      // Refresh current screen
      return { success: true, message: `Screen ${this._currentScreenId} refreshed with live system stats.`, targetScreen: this._currentScreenId };
    }

    if (k === 'F1') {
      return { success: true, message: `Help: On screen ${this._currentScreenId}. Use clickable hotspots or type CL commands like WRKACTJOB, WRKSYSSTS.` };
    }

    if (k === 'F4') {
      return { success: true, message: `Prompt requested: Parameters for command on screen ${this._currentScreenId}.` };
    }

    if (k === 'F9') {
      return { success: true, message: `Retrieved previous command: WRKACTJOB.` };
    }

    return { success: true, message: `Function key ${key} acknowledged.` };
  }

  /**
   * Natural Language Intent Recognizer for IBM i & z/OS navigation.
   */
  public navigateByNaturalLanguage(query: string): { success: boolean; message: string; targetScreen?: string } {
    const q = query.toLowerCase();

    if (q.includes('job') || q.includes('process') || q.includes('running') || q.includes('batch')) {
      this.navigateTo(this._systemType === 'iseries_5250' ? 'WRKACTJOB' : 'SDSF_DA');
      return {
        success: true,
        message: `AI Translated: "${query}" ➔ ${this._systemType === 'iseries_5250' ? 'WRKACTJOB' : 'SDSF DA'} (Active Jobs)`,
        targetScreen: this._currentScreenId
      };
    }

    if (q.includes('cpu') || q.includes('memory') || q.includes('status') || q.includes('health') || q.includes('utilization') || q.includes('asp')) {
      this.navigateTo('WRKSYSSTS');
      return {
        success: true,
        message: `AI Translated: "${query}" ➔ WRKSYSSTS (System Health & CPU Status)`,
        targetScreen: 'WRKSYSSTS'
      };
    }

    if (q.includes('spool') || q.includes('print') || q.includes('report') || q.includes('output') || q.includes('outq')) {
      this.navigateTo('WRKSPLF');
      return {
        success: true,
        message: `AI Translated: "${query}" ➔ WRKSPLF (Spooled Files & Print Outqueues)`,
        targetScreen: 'WRKSPLF'
      };
    }

    if (q.includes('message') || q.includes('alert') || q.includes('operator') || q.includes('qsysopr')) {
      this.navigateTo('DSPMSG');
      return {
        success: true,
        message: `AI Translated: "${query}" ➔ DSPMSG (System & Operator Messages)`,
        targetScreen: 'DSPMSG'
      };
    }

    if (q.includes('sql') || q.includes('query') || q.includes('table') || q.includes('database') || q.includes('select')) {
      this.navigateTo('STRSQL');
      return {
        success: true,
        message: `AI Translated: "${query}" ➔ STRSQL (Interactive Db2 for i SQL)`,
        targetScreen: 'STRSQL'
      };
    }

    if (q.includes('home') || q.includes('main') || q.includes('menu') || q.includes('start')) {
      this.navigateTo(this._systemType === 'iseries_5250' ? 'MAIN' : 'ISPF_PRIM');
      return {
        success: true,
        message: `AI Translated: "${query}" ➔ Main Menu`,
        targetScreen: this._currentScreenId
      };
    }

    return { success: false, message: 'No natural language match found.' };
  }

  /**
   * Generates formatted HTML for the 24x80 CRT terminal with clickable hotspots.
   */
  public renderCrtHtml(screen: MainframeScreen): string {
    return screen.rawText.map((line, rowIndex) => {
      let escaped = this._escapeHtml(line);

      // Check if any hotspot is present in this line
      for (const hs of screen.hotspots) {
        if (escaped.includes(hs.text)) {
          const clickableBadge = `<span class="crt-hotspot" data-cmd="${hs.command}" data-target="${hs.targetScreenId || ''}" title="Click to navigate: ${hs.description}" style="cursor: pointer; background: rgba(56, 189, 248, 0.22); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.45); padding: 1px 4px; border-radius: 3px; font-weight: bold; text-decoration: underline;">${hs.text}</span>`;
          escaped = escaped.split(hs.text).join(clickableBadge);
        }
      }

      // Highlight headers and function keys
      if (rowIndex === 0 || rowIndex === 1) {
        escaped = `<span style="color: #67e8f9; font-weight: bold;">${escaped}</span>`;
      } else if (escaped.includes('===>')) {
        escaped = escaped.replace('===>', '<span style="color: #facc15; font-weight: bold;">===></span><span class="crt-cursor" style="display: inline-block; width: 8px; height: 14px; background: #22c55e; margin-left: 4px; vertical-align: middle; animation: blink 1s step-end infinite;"></span>');
      } else if (escaped.includes('F3=') || escaped.includes('F1=') || escaped.includes('F12=')) {
        escaped = `<span style="color: #94a3b8;">${escaped}</span>`;
      }

      return `<div class="crt-line" style="min-height: 1.35em; font-family: 'Consolas', 'Courier New', monospace; white-space: pre;">${escaped}</div>`;
    }).join('\n');
  }

  /**
   * Generates the Modern Web Card View HTML for the active screen.
   */
  public renderModernCardHtml(screen: MainframeScreen): string {
    const m = screen.modernModel;
    let html = `
<div class="modern-mainframe-view" style="display: flex; flex-direction: column; gap: 14px;">
  <!-- Header Card -->
  <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;">
    <div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px; font-weight: 700; color: #fff;">${m.title}</span>
        <span style="font-size: 10px; font-weight: 700; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 2px 8px; border-radius: 10px;">${m.badge}</span>
        <span style="font-size: 10px; color: var(--text-muted);">${m.system}</span>
      </div>
      <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 4px;">${m.subtitle}</div>
    </div>
    <div style="display: flex; gap: 6px;">
      ${m.quickActions.map(a => `
        <button class="btn-quick btn-mf-card-action" data-cmd="${a.command}" style="font-size: 11px; padding: 5px 12px; color: ${a.color || '#38bdf8'}; border-color: ${a.color || 'rgba(56,189,248,0.4)'}; cursor: pointer;">
          ${a.label}
        </button>
      `).join('')}
    </div>
  </div>`;

    // Metrics if present
    if (m.metrics && m.metrics.length > 0) {
      html += `
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;">
    ${m.metrics.map(met => `
      <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px;">
        <div style="font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">${met.label}</div>
        <div style="font-size: 16px; font-weight: 800; color: ${met.color || '#38bdf8'}; margin-top: 2px;">${met.value}</div>
        ${met.percentage !== undefined ? `
          <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; margin-top: 6px; overflow: hidden;">
            <div style="width: ${met.percentage}%; height: 100%; background: ${met.color || '#38bdf8'};"></div>
          </div>
        ` : ''}
      </div>
    `).join('')}
  </div>`;
    }

    // Tables if present
    if (m.tables && m.tables.length > 0) {
      for (const t of m.tables) {
        html += `
  <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
    ${t.title ? `<div style="padding: 10px 14px; font-size: 12px; font-weight: 700; color: #f1f5f9; border-bottom: 1px solid var(--border);">${t.title}</div>` : ''}
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
        <thead>
          <tr style="background: rgba(255, 255, 255, 0.03); color: var(--text-secondary); border-bottom: 1px solid var(--border);">
            ${t.headers.map(h => `<th style="padding: 8px 12px; font-weight: 600;">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${t.rows.map((r, ri) => `
            <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04); background: ${ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'};">
              ${r.map((cell, ci) => {
                let cellHtml = cell;
                if (ci === r.length - 1 && (cell === 'RUN' || cell === 'ACTIVE')) {
                  cellHtml = `<span style="background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); padding: 1px 6px; border-radius: 8px; font-weight: bold;">${cell}</span>`;
                } else if (cell === 'DLY' || cell === 'MSGW' || cell === 'HLD') {
                  cellHtml = `<span style="background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); padding: 1px 6px; border-radius: 8px; font-weight: bold;">${cell}</span>`;
                }
                return `<td style="padding: 8px 12px; color: ${ci === 0 ? '#38bdf8' : '#e2e8f0'}; font-weight: ${ci === 0 ? '700' : 'normal'}; font-family: monospace;">${cellHtml}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
      }
    }

    html += `</div>`;
    return html;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private _initScreens(): void {
    // ── 1. IBM i: AS/400 Main Menu (MAIN) ──────────────────────────────────
    this._screens.set('MAIN', {
      id: 'MAIN',
      system: 'iseries_5250',
      title: 'AS/400 Main Menu',
      rawText: [
        '                             AS/400 Main Menu                                  ',
        '                                                           System:   ISYSTEM1  ',
        ' Select one of the following:                                                  ',
        '                                                                               ',
        '      1. User tasks                                                            ',
        '      2. Office tasks                                                          ',
        '      3. General system tasks                                                  ',
        '      4. Files, libraries, and folders                                         ',
        '      5. Programming                                                           ',
        '      6. Communications                                                        ',
        '      7. Define or change the system                                           ',
        '      8. Problem handling                                                      ',
        '      9. Display a menu                                                        ',
        '     10. Information Assistant options                                         ',
        '     11. IBM i (AS/400) options                                                ',
        '                                                                               ',
        '     90. Sign off                                                              ',
        '                                                                               ',
        ' Selection or command                                                          ',
        ' ===>                                                                          ',
        '                                                                               ',
        '                                                                               ',
        ' F3=Exit   F4=Prompt   F9=Retrieve   F12=Cancel   F13=Information Assistant    ',
        '                                                                               '
      ],
      hotspots: [
        { text: '1. User tasks', command: '1', targetScreenId: 'WRKACTJOB', description: 'User tasks & active jobs' },
        { text: '3. General system tasks', command: '3', targetScreenId: 'WRKSYSSTS', description: 'Work with system status & health' },
        { text: '4. Files, libraries, and folders', command: '4', targetScreenId: 'WRKSPLF', description: 'Work with spooled files & libraries' },
        { text: '5. Programming', command: '5', targetScreenId: 'STRSQL', description: 'Interactive SQL & development' },
        { text: '8. Problem handling', command: '8', targetScreenId: 'DSPMSG', description: 'System operator messages & alerts' },
        { text: '90. Sign off', command: '90', description: 'Sign off session' }
      ],
      modernModel: {
        title: 'IBM iSeries (AS/400) Enterprise Portal',
        subtitle: 'Subsystem: QSYS / Base Operating System V7R5 | Terminal: 5250 Model 11',
        badge: '5250 ROOT',
        system: 'IBM i on Power',
        metrics: [
          { label: 'System Host', value: 'ISYSTEM1', color: '#38bdf8' },
          { label: 'OS Version', value: 'IBM i 7.5', color: '#a855f7' },
          { label: 'Security Level', value: 'Level 50 (Strict)', color: '#34d399' },
          { label: 'Active Jobs', value: '148 Jobs', color: '#fbbf24' }
        ],
        tables: [
          {
            title: 'Quick Menu Navigation (Click to Open)',
            headers: ['Option', 'Task Category', 'Modern Equivalent', 'Action'],
            rows: [
              ['1', 'User Tasks', 'WRKACTJOB (Job Orchestration & Microservices)', 'Open Active Jobs'],
              ['3', 'General System Tasks', 'WRKSYSSTS (Infrastructure Health & APM)', 'Open System Status'],
              ['4', 'Files, Libraries & Spools', 'WRKSPLF (Report Distribution & Outqueues)', 'Open Spooled Files'],
              ['5', 'Programming & SQL', 'STRSQL (Db2 for i Query Console)', 'Open Interactive SQL'],
              ['8', 'Problem Handling & Alerts', 'DSPMSG (System Log & Alert Notification)', 'Open Messages']
            ]
          }
        ],
        quickActions: [
          { label: '⚡ Active Jobs (WRKACTJOB)', command: 'WRKACTJOB', color: '#38bdf8' },
          { label: '📊 System Status (WRKSYSSTS)', command: 'WRKSYSSTS', color: '#a855f7' },
          { label: '🖨️ Spool Files (WRKSPLF)', command: 'WRKSPLF', color: '#34d399' },
          { label: '🗄️ Db2 SQL (STRSQL)', command: 'STRSQL', color: '#fbbf24' }
        ]
      },
      apiSpec: {
        method: 'GET',
        path: '/api/v1/iseries/menu/main',
        summary: 'Retrieve AS/400 Main Menu Options and Subsystem Status',
        description: 'Exposes the top-level IBM i navigation taxonomy for modern portal integration.',
        responseExample: {
          system: 'ISYSTEM1',
          osVersion: 'V7R5M0',
          menuItems: [
            { id: 1, name: 'User Tasks', command: 'WRKACTJOB' },
            { id: 3, name: 'System Tasks', command: 'WRKSYSSTS' },
            { id: 4, name: 'Files & Spools', command: 'WRKSPLF' },
            { id: 5, name: 'Programming & SQL', command: 'STRSQL' }
          ]
        }
      },
      reactSnippet: `// Modern React Component replicating AS/400 Main Menu
export const ISeriesMainMenu: React.FC = () => {
  return (
    <div className="grid grid-cols-2 gap-4 p-6 bg-slate-900 rounded-xl">
      <Card title="Active Jobs" onClick={() => navigate('/iseries/jobs')} icon="⚡" />
      <Card title="System Status" onClick={() => navigate('/iseries/status')} icon="📊" />
      <Card title="Spooled Reports" onClick={() => navigate('/iseries/spool')} icon="🖨️" />
      <Card title="Db2 for i SQL" onClick={() => navigate('/iseries/sql')} icon="🗄️" />
    </div>
  );
};`
    });

    // ── 2. IBM i: Work with Active Jobs (WRKACTJOB) ─────────────────────────
    this._screens.set('WRKACTJOB', {
      id: 'WRKACTJOB',
      system: 'iseries_5250',
      title: 'Work with Active Jobs (WRKACTJOB)',
      rawText: [
        '                            Work with Active Jobs                      ISYSTEM1',
        '                                                       26/10/26  14:05:00      ',
        ' CPU %:     14.2     Elapsed time:   00:05:12     Active jobs:   148           ',
        '                                                                               ',
        ' Type options, press Enter.                                                    ',
        '   2=Change   3=Hold   4=End   5=Work with   6=Release   7=Display message     ',
        '   8=Work with spooled files   13=Disconnect ...                               ',
        '                                                                               ',
        ' Opt  Subsystem/Job  User        Type  CPU %  Function        Status           ',
        '      QBASE          QSYS        SBS      .0                  DEQW             ',
        '        QINTER       QSYS        SBS      .0                  DEQW             ',
        '          DSP01      JDOE        INT     1.2  CMD-WRKACTJOB   RUN              ',
        '          DSP02      ASMITH      INT      .4  MENU-MAIN       CNDW             ',
        '        QBATCH       QSYS        SBS      .0                  DEQW             ',
        '          PAYROLL    PRODUSER    BCH     8.6  PGM-PAYCALC     RUN              ',
        '          INVOICE    PRODUSER    BCH     3.8  PGM-INV001      RUN              ',
        '        QSYSWRK      QSYS        SBS      .0                  DEQW             ',
        '          QHTTPSVR   QTMHHTTP    BCH      .2  PGM-QZSRHTTP    SIGW             ',
        '                                                                               ',
        ' Parameters or command                                                         ',
        ' ===>                                                                          ',
        '                                                                               ',
        ' F3=Exit   F5=Refresh   F10=Restart statistics   F11=Display elapsed   F12=Cancel '
      ],
      hotspots: [
        { text: 'DSP01', command: '5 DSP01', description: 'Work with interactive job DSP01' },
        { text: 'PAYROLL', command: '5 PAYROLL', description: 'Inspect batch payroll calculation job' },
        { text: 'INVOICE', command: '5 INVOICE', description: 'Inspect batch invoice generation job' },
        { text: 'QHTTPSVR', command: '5 QHTTPSVR', description: 'Inspect Apache HTTP server daemon' }
      ],
      modernModel: {
        title: 'IBM i Active Jobs & Subsystems (WRKACTJOB)',
        subtitle: 'Live process orchestration across interactive, batch, and web daemons',
        badge: 'PROCESS MONITOR',
        system: 'IBM i on Power',
        metrics: [
          { label: 'Total CPU Utilization', value: '14.2%', color: '#38bdf8', percentage: 14.2 },
          { label: 'Active Jobs', value: '148 Jobs', color: '#4ade80' },
          { label: 'Batch Payroll Load', value: '8.6% CPU', color: '#fbbf24' },
          { label: 'Subsystem Status', value: 'ALL ACTIVE', color: '#34d399' }
        ],
        tables: [
          {
            title: 'Active Workload Stream (Auto-updating)',
            headers: ['Job Name', 'Subsystem', 'User', 'Type', 'CPU %', 'Current Function', 'Status'],
            rows: [
              ['DSP01', 'QINTER', 'JDOE', 'INTERACTIVE', '1.2%', 'CMD-WRKACTJOB', 'RUN'],
              ['DSP02', 'QINTER', 'ASMITH', 'INTERACTIVE', '0.4%', 'MENU-MAIN', 'CNDW'],
              ['PAYROLL', 'QBATCH', 'PRODUSER', 'BATCH', '8.6%', 'PGM-PAYCALC', 'RUN'],
              ['INVOICE', 'QBATCH', 'PRODUSER', 'BATCH', '3.8%', 'PGM-INV001', 'RUN'],
              ['QHTTPSVR', 'QSYSWRK', 'QTMHHTTP', 'HTTP DAEMON', '0.2%', 'PGM-QZSRHTTP', 'SIGW']
            ]
          }
        ],
        quickActions: [
          { label: '🔄 Refresh (F5)', command: 'F5', color: '#38bdf8' },
          { label: '🖨️ View Spooled Files', command: 'WRKSPLF', color: '#34d399' },
          { label: '📊 System Metrics', command: 'WRKSYSSTS', color: '#a855f7' },
          { label: '🏠 Main Menu (F3)', command: 'MAIN', color: '#94a3b8' }
        ]
      },
      apiSpec: {
        method: 'GET',
        path: '/api/v1/iseries/jobs/active',
        summary: 'List Active Jobs, CPU Utilization, and Execution Status',
        description: 'Replaces WRKACTJOB green-screen queries with a high-speed JSON endpoint.',
        parameters: [
          { name: 'subsystem', in: 'query', type: 'string', description: 'Filter by subsystem (e.g. QBATCH, QINTER)' },
          { name: 'status', in: 'query', type: 'string', description: 'Filter by job status (e.g. RUN, MSGW)' }
        ],
        responseExample: {
          cpuPercent: 14.2,
          totalJobs: 148,
          jobs: [
            { jobName: 'PAYROLL', user: 'PRODUSER', number: '104921', type: 'BATCH', cpuPercent: 8.6, function: 'PGM-PAYCALC', status: 'RUN' },
            { jobName: 'INVOICE', user: 'PRODUSER', number: '104922', type: 'BATCH', cpuPercent: 3.8, function: 'PGM-INV001', status: 'RUN' },
            { jobName: 'DSP01', user: 'JDOE', number: '098112', type: 'INTERACTIVE', cpuPercent: 1.2, function: 'CMD-WRKACTJOB', status: 'RUN' }
          ]
        }
      },
      reactSnippet: `// Modern React Component for WRKACTJOB
import React, { useEffect, useState } from 'react';

export const ActiveJobsTable: React.FC = () => {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    fetch('/api/v1/iseries/jobs/active')
      .then(res => res.json())
      .then(data => setJobs(data.jobs));
  }, []);

  return (
    <table className="w-full text-sm text-left text-slate-300">
      <thead>
        <tr className="border-b border-slate-700">
          <th>Job</th><th>User</th><th>Type</th><th>CPU %</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map(j => (
          <tr key={j.number} className="hover:bg-slate-800">
            <td className="font-mono font-bold text-sky-400">{j.jobName}</td>
            <td>{j.user}</td>
            <td>{j.type}</td>
            <td>{j.cpuPercent}%</td>
            <td><span className="px-2 py-0.5 rounded bg-emerald-900 text-emerald-300">{j.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};`
    });

    // ── 3. IBM i: Work with System Status (WRKSYSSTS) ────────────────────────
    this._screens.set('WRKSYSSTS', {
      id: 'WRKSYSSTS',
      system: 'iseries_5250',
      title: 'Work with System Status (WRKSYSSTS)',
      rawText: [
        '                           Work with System Status                     ISYSTEM1',
        '                                                       26/10/26  14:05:00      ',
        ' % CPU used . . . . . . . :       14.2    System ASP . . . . . . . :     842.6 G',
        ' Elapsed time . . . . . . :   00:05:12    % system ASP used  . . . :       61.4%',
        ' Jobs in system . . . . . :       1842    Total auxiliary storage  :    1280.0 G',
        ' Total pools  . . . . . . :          4    Current unprotect used . :    4820.5 M',
        ' Main storage size  . . . :     64.0 G    Maximum unprotect  . . . :    5120.0 M',
        '                                                                               ',
        ' Pool    Size (M)  Reserved (M)  Max Act  Fault  Pages  Act-Wait  Wait-Inlg     ',
        '   1       1200.0         450.0   ++++++     .0     .0     .0       .0         ',
        '   2      32000.0          20.0      120     .2     .8     .0       .0         ',
        '   3      24000.0          10.0       80     .1     .4     .0       .0         ',
        '   4       6800.0           5.0       40     .0     .1     .0       .0         ',
        '                                                                               ',
        ' Command                                                                       ',
        ' ===>                                                                          ',
        '                                                                               ',
        ' F3=Exit   F4=Prompt   F9=Retrieve   F10=Restart statistics   F12=Cancel        ',
        '                                                                               '
      ],
      hotspots: [
        { text: '61.4%', command: 'WRKDSKSTS', description: 'Work with disk status and storage pools' },
        { text: '1842', command: 'WRKACTJOB', targetScreenId: 'WRKACTJOB', description: 'Inspect jobs in system' }
      ],
      modernModel: {
        title: 'IBM i Infrastructure Status & Storage APM (WRKSYSSTS)',
        subtitle: 'System ASP disk capacity, memory storage pools, and CPU headroom',
        badge: 'INFRASTRUCTURE APM',
        system: 'IBM i on Power',
        metrics: [
          { label: 'CPU Headroom', value: '14.2% Used', color: '#38bdf8', percentage: 14.2 },
          { label: 'ASP Disk Storage', value: '61.4% (842.6 GB)', color: '#fbbf24', percentage: 61.4 },
          { label: 'Main Memory (RAM)', value: '64.0 GB', color: '#34d399' },
          { label: 'Total Jobs in Catalog', value: '1,842 Jobs', color: '#c084fc' }
        ],
        tables: [
          {
            title: 'Memory Pools Allocation',
            headers: ['Pool ID', 'Pool Name / Subsystem', 'Allocated Size (MB)', 'Max Active Threads', 'Paging Fault Rate'],
            rows: [
              ['1', '*SYSTEM (Core OS)', '1,200 MB', 'Unlimited', '0.0 / sec'],
              ['2', '*BASE (Batch Execution)', '32,000 MB', '120 Threads', '0.8 / sec'],
              ['3', '*INTERACT (Interactive DSP)', '24,000 MB', '80 Threads', '0.4 / sec'],
              ['4', '*SPOOL (Print Formatting)', '6,800 MB', '40 Threads', '0.1 / sec']
            ]
          }
        ],
        quickActions: [
          { label: '🔄 Refresh Stats (F5)', command: 'F5', color: '#38bdf8' },
          { label: '⚡ Active Jobs (WRKACTJOB)', command: 'WRKACTJOB', color: '#4ade80' },
          { label: '🗄️ Db2 SQL Console', command: 'STRSQL', color: '#fbbf24' }
        ]
      },
      apiSpec: {
        method: 'GET',
        path: '/api/v1/iseries/system/status',
        summary: 'Get IBM i System Performance, Storage ASP, and Memory Pool Metrics',
        description: 'Telemetry endpoint for Prometheus, Grafana, or modern SRE dashboards.',
        responseExample: {
          cpuUsedPercent: 14.2,
          aspUsedPercent: 61.4,
          aspCapacityGb: 1280.0,
          aspUsedGb: 842.6,
          mainStorageGb: 64.0,
          jobsInSystem: 1842
        }
      },
      reactSnippet: `// Modern Infrastructure Dashboard Card
export const ISeriesSystemHealthGauge: React.FC<{ cpu: number; asp: number }> = ({ cpu, asp }) => (
  <div className="flex gap-6 p-4 bg-slate-900 border border-slate-800 rounded-lg">
    <div>
      <div className="text-xs text-slate-400">CPU LOAD</div>
      <div className="text-2xl font-bold text-sky-400">{cpu}%</div>
    </div>
    <div>
      <div className="text-xs text-slate-400">STORAGE ASP</div>
      <div className="text-2xl font-bold text-amber-400">{asp}%</div>
    </div>
  </div>
);`
    });

    // ── 4. IBM i: Work with Spooled Files (WRKSPLF) ─────────────────────────
    this._screens.set('WRKSPLF', {
      id: 'WRKSPLF',
      system: 'iseries_5250',
      title: 'Work with Spooled Files (WRKSPLF)',
      rawText: [
        '                            Work with Spooled Files                    ISYSTEM1',
        '                                                       26/10/26  14:05:00      ',
        ' Type options, press Enter.                                                    ',
        '   1=Send   2=Change   3=Hold   4=Delete   5=Display   6=Release   7=Messages  ',
        '   8=Attributes   9=Work with printing status                                  ',
        '                                                                               ',
        ' Opt  File        User        User Data   Status   Pages   Copies  Form Type   Pty',
        '      QPJOBLOG    JDOE        INTERACT    RDY         12        1  *STD          5',
        '      QPRINT      PRODUSER    PAYROLL     HLD        145        1  *STD          4',
        '      INVREPORT   PRODUSER    INVOICES    RDY         84        2  CUSTOM        5',
        '      QSYSPRT     QSYS        BACKUP      RDY          4        1  *STD          3',
        '                                                                               ',
        ' Parameters or command                                                         ',
        ' ===>                                                                          ',
        '                                                                               ',
        ' F3=Exit   F10=Restart   F11=Display details   F12=Cancel   F24=More keys       '
      ],
      hotspots: [
        { text: 'QPJOBLOG', command: '5 QPJOBLOG', description: 'Display interactive job log report' },
        { text: 'QPRINT', command: '5 QPRINT', description: 'Display payroll execution print spool' },
        { text: 'INVREPORT', command: '5 INVREPORT', description: 'Display customer invoice print spool' },
        { text: 'QSYSPRT', command: '5 QSYSPRT', description: 'Display daily backup report' }
      ],
      modernModel: {
        title: 'IBM i Spooled Files & Digital Document Hub (WRKSPLF)',
        subtitle: 'Converts legacy 5250 print streams (SCS/AFPDS) into PDF/JSON artifacts',
        badge: 'DOCUMENT REPO',
        system: 'IBM i on Power',
        metrics: [
          { label: 'Total Spools in Queue', value: '4 Documents', color: '#38bdf8' },
          { label: 'Ready for Export', value: '3 Ready', color: '#34d399' },
          { label: 'Pending Hold', value: '1 Held (Payroll)', color: '#fbbf24' },
          { label: 'Total Page Volume', value: '245 Pages', color: '#c084fc' }
        ],
        tables: [
          {
            title: 'Spooled File Queue',
            headers: ['File Name', 'Owner', 'User Data / Tag', 'Pages', 'Copies', 'Status', 'Modern Action'],
            rows: [
              ['QPJOBLOG', 'JDOE', 'INTERACTIVE_LOG', '12', '1', 'RDY', 'Download PDF'],
              ['QPRINT', 'PRODUSER', 'PAYROLL_DETAIL', '145', '1', 'HLD', 'Release / Export'],
              ['INVREPORT', 'PRODUSER', 'INVOICES_OCT', '84', '2', 'RDY', 'Send to Customer'],
              ['QSYSPRT', 'QSYS', 'SYSTEM_BACKUP', '4', '1', 'RDY', 'Audit Log View']
            ]
          }
        ],
        quickActions: [
          { label: '🔄 Refresh Queue', command: 'F5', color: '#38bdf8' },
          { label: '⚡ Active Jobs', command: 'WRKACTJOB', color: '#4ade80' },
          { label: '🏠 Main Menu', command: 'MAIN', color: '#94a3b8' }
        ]
      },
      apiSpec: {
        method: 'GET',
        path: '/api/v1/iseries/spools',
        summary: 'Retrieve Spooled Files and Convert SCS/AFPDS to PDF',
        description: 'Provides programmatic access to spool streams for digital document delivery.',
        responseExample: {
          totalSpools: 4,
          spools: [
            { file: 'INVREPORT', user: 'PRODUSER', pages: 84, status: 'RDY', downloadUrl: '/api/v1/iseries/spools/INVREPORT/pdf' }
          ]
        }
      },
      reactSnippet: `// Document Delivery Component
export const SpoolViewer: React.FC = () => (
  <button onClick={() => window.open('/api/v1/iseries/spools/INVREPORT/pdf')}>
    📄 Download Invoice PDF (Converted from 5250 Spool)
  </button>
);`
    });

    // ── 5. IBM i: Interactive SQL for Db2 for i (STRSQL) ─────────────────────
    this._screens.set('STRSQL', {
      id: 'STRSQL',
      system: 'iseries_5250',
      title: 'Enter SQL Statements (STRSQL - Db2 for i)',
      rawText: [
        '                            Enter SQL Statements                       ISYSTEM1',
        ' Current connection is to relational database ISYSTEM1.                        ',
        ' Type SQL statement, press Enter.                                              ',
        ' ===> SELECT EMP_ID, FIRST_NAME, LAST_NAME, SALARY FROM PRODLIB.EMPLOYEE_MASTER',
        '                                                                               ',
        ' EMP_ID    FIRST_NAME      LAST_NAME        SALARY                             ',
        ' E00101    SARAH           CONNOR        125000.00                             ',
        ' E00102    MICHAEL         CHANG         118500.00                             ',
        ' E00103    ELIZABETH       BENNET        134000.00                             ',
        ' E00104    JAMES           HOLDEN        142000.00                             ',
        ' E00105    NAOMI           NAGATA        155000.00                             ',
        ' Bottom of data reached.                                                       ',
        '                                                                               ',
        '                                                                               ',
        ' F3=Exit   F4=Prompt   F6=Insert line   F9=Retrieve   F12=Cancel   F24=More keys'
      ],
      hotspots: [
        { text: 'E00101', command: 'SELECT * FROM PRODLIB.EMPLOYEE_MASTER WHERE EMP_ID = "E00101"', description: 'Inspect Sarah Connor record' },
        { text: 'PRODLIB.EMPLOYEE_MASTER', command: 'DSPFFD PRODLIB/EMPLOYEE_MASTER', description: 'Display File Field Description (Schema)' }
      ],
      modernModel: {
        title: 'Db2 for i Interactive Data Explorer (STRSQL)',
        subtitle: 'Direct relational database access via JT400 / DRDA wire protocol',
        badge: 'DB2 FOR i',
        system: 'IBM i on Power',
        metrics: [
          { label: 'Connected Database', value: 'ISYSTEM1 (Db2 for i)', color: '#38bdf8' },
          { label: 'Active Schema / Library', value: 'PRODLIB', color: '#a855f7' },
          { label: 'Rows Returned', value: '5 Rows (Sample)', color: '#34d399' },
          { label: 'Query Execution Time', value: '1.4 ms', color: '#fbbf24' }
        ],
        tables: [
          {
            title: 'Query Result: PRODLIB.EMPLOYEE_MASTER',
            headers: ['EMP_ID', 'FIRST_NAME', 'LAST_NAME', 'ANNUAL_SALARY ($)', 'STATUS'],
            rows: [
              ['E00101', 'SARAH', 'CONNOR', '125,000.00', 'ACTIVE'],
              ['E00102', 'MICHAEL', 'CHANG', '118,500.00', 'ACTIVE'],
              ['E00103', 'ELIZABETH', 'BENNET', '134,000.00', 'ACTIVE'],
              ['E00104', 'JAMES', 'HOLDEN', '142,000.00', 'ACTIVE'],
              ['E00105', 'NAOMI', 'NAGATA', '155,000.00', 'ACTIVE']
            ]
          }
        ],
        quickActions: [
          { label: '📋 Export to CSV / JSON', command: 'EXPORT_SQL_JSON', color: '#38bdf8' },
          { label: '⚡ Active Jobs', command: 'WRKACTJOB', color: '#4ade80' },
          { label: '🏠 Main Menu (F3)', command: 'MAIN', color: '#94a3b8' }
        ]
      },
      apiSpec: {
        method: 'POST',
        path: '/api/v1/iseries/db2/query',
        summary: 'Execute Parameterized Read-Only Query against Db2 for i',
        description: 'Direct SQL query proxy executing over DRDA / JT400 port 446.',
        parameters: [
          { name: 'sql', in: 'body', type: 'string', description: 'SELECT statement (DDL/mutation strictly blocked)' }
        ],
        responseExample: {
          columns: ['EMP_ID', 'FIRST_NAME', 'LAST_NAME', 'SALARY'],
          rows: [
            ['E00101', 'SARAH', 'CONNOR', 125000.00],
            ['E00102', 'MICHAEL', 'CHANG', 118500.00]
          ]
        }
      },
      reactSnippet: `// Modern Db2 Data Table
export const Db2DataTable: React.FC<{ data: any[] }> = ({ data }) => (
  <div className="bg-slate-900 rounded-lg p-4 font-sans">
    <h3 className="font-bold text-white mb-2">Db2 for i Employee Master</h3>
    <table className="w-full text-sm">
      {/* Dynamic rendering */}
    </table>
  </div>
);`
    });

    // ── 6. IBM i: Display System Messages (DSPMSG) ──────────────────────────
    this._screens.set('DSPMSG', {
      id: 'DSPMSG',
      system: 'iseries_5250',
      title: 'Display Messages (DSPMSG QSYSOPR)',
      rawText: [
        '                               Display Messages                        ISYSTEM1',
        '                                                       26/10/26  14:05:00      ',
        ' Queue . . . . . :   QSYSOPR                Program . . . . :   *DSP           ',
        '   Library . . . :     QSYS                   Library . . . :                  ',
        ' Severity  . . . :   00                     Delivery  . . . :   *HOLD          ',
        '                                                                               ',
        ' Type reply (if required), press Enter.                                        ',
        '   From  . . . :   PRODUSER      02:15:00   Message . . . :   CPF0001          ',
        '   Daily Batch Payroll Job PAYROLL completed successfully (CC 0000).           ',
        '                                                                               ',
        '   From  . . . :   QSYS          04:00:12   Message . . . :   CPI0999          ',
        '   System ASP storage reached 61.4% capacity. Informational warning.           ',
        '                                                                               ',
        ' Parameters or reply                                                           ',
        ' ===>                                                                          ',
        '                                                                               ',
        ' F3=Exit   F5=Refresh   F11=Remove a message   F12=Cancel   F16=Remove all     '
      ],
      hotspots: [
        { text: 'CPF0001', command: 'DSPMSGD CPF0001', description: 'Explain IBM message CPF0001' },
        { text: 'CPI0999', command: 'DSPMSGD CPI0999', description: 'Explain storage threshold message' }
      ],
      modernModel: {
        title: 'IBM i System Operator Messages & Alerts (DSPMSG)',
        subtitle: 'Real-time QSYSOPR message queue feed for incident response',
        badge: 'ALERT FEED',
        system: 'IBM i on Power',
        metrics: [
          { label: 'Unanswered Messages', value: '0 Critical', color: '#34d399' },
          { label: 'Information Alerts', value: '2 Today', color: '#38bdf8' },
          { label: 'Message Queue', value: 'QSYS/QSYSOPR', color: '#a855f7' }
        ],
        tables: [
          {
            title: 'Operator Message Feed',
            headers: ['Time', 'Origin / User', 'Message ID', 'Severity', 'Message Text', 'Status'],
            rows: [
              ['02:15:00', 'PRODUSER', 'CPF0001', '00', 'Daily Batch Payroll PAYROLL completed successfully (CC 0000)', 'INFO'],
              ['04:00:12', 'QSYS', 'CPI0999', '10', 'System ASP storage reached 61.4% capacity threshold', 'WARNING']
            ]
          }
        ],
        quickActions: [
          { label: '🔄 Refresh Alerts', command: 'F5', color: '#38bdf8' },
          { label: '⚡ Active Jobs', command: 'WRKACTJOB', color: '#4ade80' },
          { label: '🏠 Main Menu', command: 'MAIN', color: '#94a3b8' }
        ]
      },
      apiSpec: {
        method: 'GET',
        path: '/api/v1/iseries/messages',
        summary: 'Stream System Operator Messages (QSYSOPR)',
        description: 'Exposes QSYSOPR events into modern webhook/Slack/PagerDuty alerting.',
        responseExample: {
          messages: [
            { id: 'CPI0999', time: '04:00:12', text: 'System ASP storage reached 61.4% capacity threshold' }
          ]
        }
      },
      reactSnippet: `// Alert Banner
export const SystemAlerts: React.FC<{ alerts: any[] }> = ({ alerts }) => (
  <div className="bg-amber-950 border border-amber-800 p-3 rounded text-amber-200">
    ⚠️ {alerts[0]?.text}
  </div>
);`
    });

    // ── 7. z/OS: ISPF Primary Option Menu (TN3270) ──────────────────────────
    this._screens.set('ISPF_PRIM', {
      id: 'ISPF_PRIM',
      system: 'zos_3270',
      title: 'ISPF Primary Option Menu (IBM z/OS)',
      rawText: [
        '   Menu  Utilities  Compilers  Options  Status  Help                           ',
        ' ───────────────────────────────────────────────────────────────────────────────',
        '                           ISPF Primary Option Menu                            ',
        ' Option ===>                                                                   ',
        '                                                                               ',
        ' 0  Settings      Terminal and user parameters            User ID . : IBMUSER  ',
        ' 1  View          Display source data or listings         Time. . . : 14:05    ',
        ' 2  Edit          Create or change source data            Terminal. : 3278     ',
        ' 3  Utilities     Perform utility functions               Screen. . : 1        ',
        ' 4  Foreground    Interactive language processing         Language. : ENGLISH  ',
        ' 5  Batch         Submit job for language processing      Appl ID . : ISR      ',
        ' 6  Command       Enter TSO or Workstation commands       TSO logon : ISPFPROC ',
        ' 7  Dialog Test   Perform dialog testing                  Release . : ISPF 7.5 ',
        ' 9  IBM Products  IBM program development products                             ',
        ' 10 SCLM          Software Configuration and Library Manager                   ',
        ' 11 Workplace     ISPF Object/Action Workplace                                 ',
        ' M  SDSF          Spool Display and Search Facility (Active Jobs)              ',
        '                                                                               ',
        ' Enter X to Terminate using log/list defaults                                  ',
        ' F1=Help      F2=Split     F3=Exit      F7=Backward  F8=Forward   F9=Swap      ',
        ' F10=Actions  F12=Cancel                                                       '
      ],
      hotspots: [
        { text: '1  View', command: '1', targetScreenId: 'WRKSPLF', description: 'View dataset members' },
        { text: '3  Utilities', command: '3', description: 'Dataset and library utilities' },
        { text: 'M  SDSF', command: 'M', targetScreenId: 'SDSF_DA', description: 'SDSF Spool Display & Active Jobs' }
      ],
      modernModel: {
        title: 'IBM z/OS ISPF Modern Navigation Portal',
        subtitle: 'z/OS 2.5 Mainframe LPAR | 3270 Model 2 Emulation',
        badge: '3270 ISPF',
        system: 'IBM z/OS Mainframe',
        metrics: [
          { label: 'RACF User ID', value: 'IBMUSER', color: '#38bdf8' },
          { label: 'Active LPAR', value: 'SYS1 (z16)', color: '#a855f7' },
          { label: 'TSO Logon Proc', value: 'ISPFPROC', color: '#34d399' },
          { label: 'Terminal Mode', value: '3278-2 (24x80)', color: '#fbbf24' }
        ],
        tables: [
          {
            title: 'ISPF Utility Options',
            headers: ['Option', 'Function', 'Modern Web Capability'],
            rows: [
              ['1', 'View / Browse', 'Browse PDS Datasets and JCL decks via REST'],
              ['2', 'Edit', 'In-browser Monaco Editor with COBOL/JCL syntax highlighting'],
              ['3', 'Utilities', 'Dataset allocation, catalog management, copy/rename'],
              ['M', 'SDSF DA', 'Live JES2 Spool, active job execution, return codes']
            ]
          }
        ],
        quickActions: [
          { label: '⚡ SDSF Active Jobs', command: 'SDSF', color: '#38bdf8' },
          { label: '🔄 CICS Terminal', command: 'CICS', color: '#a855f7' },
          { label: '🖨️ JES2 Spool View', command: 'WRKSPLF', color: '#34d399' }
        ]
      },
      apiSpec: {
        method: 'GET',
        path: '/api/v1/zos/ispf/options',
        summary: 'Get ISPF Navigation Hierarchy',
        description: 'Exposes z/OS ISPF utilities as modern REST APIs.',
        responseExample: { user: 'IBMUSER', lpar: 'SYS1', ispfVersion: '7.5' }
      },
      reactSnippet: `// z/OS Modern Portal
export const ZosPortal: React.FC = () => (
  <div className="bg-slate-900 p-4 text-white">
    <h2>IBM z/OS Mainframe Modern Control Deck</h2>
  </div>
);`
    });

    // ── 8. z/OS: SDSF DA (Display Active Jobs & CPU) ────────────────────────
    this._screens.set('SDSF_DA', {
      id: 'SDSF_DA',
      system: 'zos_3270',
      title: 'SDSF DA - Display Active Jobs (IBM z/OS)',
      rawText: [
        ' SDSF DA SYS1     SYS1     PAG    0  CPU  22/ 18  LINE 1-10 (10)                ',
        ' COMMAND INPUT ===>                                            SCROLL ===> CSR ',
        ' NP   JOBNAME  StepName ProcStep JobID    Owner    C  Pos  DP Real Paging  SIO ',
        '      JES2     JES2     IEFPROC  STC00012 +SYS     S  IN   FE 145M   0.00    0 ',
        '      VTAM     VTAM     VTAM     STC00015 +SYS     S  IN   F8  98M   0.00    0 ',
        '      TCPIP    TCPIP    TCPIP    STC00021 +SYS     S  IN   F4 210M   0.00    2 ',
        '      DB2PMSTR DBM1     IEFPROC  STC00030 +SYS     S  IN   F0 850M   0.00   45 ',
        '      CICSREG1 CICS     DFHSIP   STC00045 CICSUSR  S  IN   E4 512M   0.00   12 ',
        '      PAYRUN01 STEP1    PAYEXTR  JOB08921 HCMDEV01 S  IN   A0  45M   0.00    8 ',
        '                                                                               ',
        '                                                                               ',
        ' F1=HELP  F2=SPLIT  F3=END  F4=RETURN  F5=IFIND  F6=BOOK  F7=UP  F8=DOWN       '
      ],
      hotspots: [
        { text: 'DB2PMSTR', command: 'DB2', description: 'Inspect DB2 Subsystem Master Address Space' },
        { text: 'CICSREG1', command: 'CICS', targetScreenId: 'CICS_CEMT', description: 'Inspect CICS Online Region' },
        { text: 'PAYRUN01', command: 'PAYRUN01', description: 'Inspect active Payroll JCL Job' }
      ],
      modernModel: {
        title: 'SDSF Display Active (DA) Process Monitor',
        subtitle: 'z/OS MVS Address Spaces, System Tasks & Batch Jobs',
        badge: 'SDSF MONITOR',
        system: 'IBM z/OS Mainframe',
        metrics: [
          { label: 'System CPU Load', value: '22%', color: '#38bdf8', percentage: 22 },
          { label: 'Active Address Spaces', value: '6 Tasks', color: '#34d399' },
          { label: 'DB2 Buffer Pool', value: '850 MB Real', color: '#fbbf24' }
        ],
        tables: [
          {
            title: 'Active MVS Address Spaces',
            headers: ['Job Name', 'Step Name', 'Job ID', 'Owner', 'Real Storage', 'SIO Rate'],
            rows: [
              ['JES2', 'IEFPROC', 'STC00012', '+SYS', '145 MB', '0 /s'],
              ['DB2PMSTR', 'IEFPROC', 'STC00030', '+SYS', '850 MB', '45 /s'],
              ['CICSREG1', 'DFHSIP', 'STC00045', 'CICSUSR', '512 MB', '12 /s'],
              ['PAYRUN01', 'PAYEXTR', 'JOB08921', 'HCMDEV01', '45 MB', '8 /s']
            ]
          }
        ],
        quickActions: [
          { label: '🔄 Refresh SDSF', command: 'F5', color: '#38bdf8' },
          { label: '🌐 CICS Region', command: 'CICS', color: '#a855f7' },
          { label: '🏠 ISPF Menu', command: 'ISPF', color: '#94a3b8' }
        ]
      },
      apiSpec: {
        method: 'GET',
        path: '/api/v1/zos/jobs/active',
        summary: 'List Running Address Spaces and Batch Jobs from SDSF',
        description: 'Replaces 3270 SDSF DA panels with JSON telemetry.',
        responseExample: {
          cpuLoad: 22,
          addressSpaces: [
            { jobName: 'DB2PMSTR', jobId: 'STC00030', realStorageMb: 850, sio: 45 },
            { jobName: 'CICSREG1', jobId: 'STC00045', realStorageMb: 512, sio: 12 }
          ]
        }
      },
      reactSnippet: `// SDSF Table
export const SdsfJobGrid: React.FC = () => (
  <div className="p-4 bg-slate-900 rounded font-mono text-emerald-400">
    <h3>SDSF Active Jobs</h3>
  </div>
);`
    });

    // ── 9. z/OS: CICS Master Terminal (CICS CEMT) ───────────────────────────
    this._screens.set('CICS_CEMT', {
      id: 'CICS_CEMT',
      system: 'zos_3270',
      title: 'CICS Master Terminal (CEMT INQ PROGRAM)',
      rawText: [
        ' CEMT INQUIRE PROGRAM                                                          ',
        ' STATUS:  RESULTS - OVERTYPE TO MODIFY                                         ',
        '  Prog(PAYCICS01) Len(00024576) Cob Pro Ena Pri Nep Sha Res(000)               ',
        '     Use(00000012) Usef(00000012) Def( Con ) Ced                              ',
        '  Prog(TAXTIER ) Len(00012288) Cob Pro Ena Pri Nep Sha Res(000)               ',
        '     Use(00000045) Usef(00000045) Def( Con ) Ced                              ',
        '                                                                               ',
        '                                                                               ',
        '                                                                               ',
        '                                                                               ',
        '                                                                               ',
        ' SYSID=CIC1  APPLID=CICSREG1                                                  ',
        ' RESPONSE: NORMAL                              TIME: 14:05:00  DATE: 26.10.26  ',
        ' F1=HELP  F3=END  F5=VAR  F7=UP  F8=DOWN  F9=MSG  F10=ACT  F11=PRT             '
      ],
      hotspots: [
        { text: 'PAYCICS01', command: 'CEMT INQ PROG(PAYCICS01)', description: 'Inquire CICS Payroll COBOL Program' },
        { text: 'TAXTIER', command: 'CEMT INQ PROG(TAXTIER)', description: 'Inquire CICS Tax Table Routine' }
      ],
      modernModel: {
        title: 'CICS Transaction & Program Console (CEMT)',
        subtitle: 'Online transaction processing region CICSREG1',
        badge: 'CICS ONLINE',
        system: 'IBM z/OS Mainframe',
        metrics: [
          { label: 'Active Region', value: 'CICSREG1', color: '#a855f7' },
          { label: 'Program Status', value: 'ENABLED (ENA)', color: '#34d399' },
          { label: 'Active Transactions', value: '57 Invocations', color: '#38bdf8' }
        ],
        tables: [
          {
            title: 'Online Programs in Memory',
            headers: ['Program', 'Language', 'Length (Bytes)', 'Status', 'Usage Count'],
            rows: [
              ['PAYCICS01', 'COBOL', '24,576 B', 'ENABLED', '12 runs'],
              ['TAXTIER', 'COBOL', '12,288 B', 'ENABLED', '45 runs']
            ]
          }
        ],
        quickActions: [
          { label: '🔄 Refresh Region', command: 'F5', color: '#38bdf8' },
          { label: '⚡ SDSF Monitor', command: 'SDSF', color: '#4ade80' },
          { label: '🏠 ISPF Menu', command: 'ISPF', color: '#94a3b8' }
        ]
      },
      apiSpec: {
        method: 'POST',
        path: '/api/v1/zos/cics/transactions/em01',
        summary: 'Invoke CICS Transaction via REST API',
        description: 'Replaces BMS terminal input with a modern JSON payload.',
        responseExample: {
          transaction: 'EM01',
          program: 'PAYCICS01',
          status: 'SUCCESS',
          output: { employeeId: 'EMP00192', approvedSalary: 142000.00 }
        }
      },
      reactSnippet: `// CICS Microservice Invocation
export const ExecuteCicsTx = async (payload: any) => {
  const res = await fetch('/api/v1/zos/cics/transactions/em01', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res.json();
};`
    });
  }
}
