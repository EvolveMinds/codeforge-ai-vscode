/**
 * test/suite/fde/mainframeScreenEngine.test.ts
 *
 * Verifies the IBM Mainframe (z/OS & iSeries AS/400) Screen Emulation & Modernization Engine:
 *  - State initialization and system switching (IBM iSeries TN5250 vs IBM z/OS TN3270)
 *  - Command execution and navigation (WRKACTJOB, WRKSYSSTS, WRKSPLF, STRSQL, DSPMSG, ISPF, SDSF, CICS)
 *  - Clickable menu options and hotspot routing
 *  - Function keys (F1, F3, F5, F12) and history stack
 *  - Natural language navigation intent resolution
 *  - 24x80 CRT HTML rendering with interactive spans
 *  - Modern Web Card View HTML rendering
 *  - OpenAPI 3.0 REST spec & React component code generation
 */

import * as assert from 'assert';
import { MainframeScreenEngine } from '../../../fde/mainframeScreenEngine';

suite('IBM Mainframe (z/OS & iSeries AS/400) Screen Engine & Modernization', () => {
  let engine: MainframeScreenEngine;

  setup(() => {
    engine = new MainframeScreenEngine();
  });

  suite('1. System Type & Initial Screen State', () => {
    test('defaults to IBM iSeries (AS/400) with MAIN screen', () => {
      assert.strictEqual(engine.systemType, 'iseries_5250');
      assert.strictEqual(engine.currentScreenId, 'MAIN');

      const screen = engine.getCurrentScreen();
      assert.strictEqual(screen.id, 'MAIN');
      assert.strictEqual(screen.system, 'iseries_5250');
      assert.ok(screen.title.includes('AS/400 Main Menu'));
      assert.ok(screen.rawText.length >= 20);
    });

    test('switches system type to IBM z/OS (TN3270) and lands on ISPF_PRIM', () => {
      engine.setSystemType('zos_3270');
      assert.strictEqual(engine.systemType, 'zos_3270');
      assert.strictEqual(engine.currentScreenId, 'ISPF_PRIM');

      const screen = engine.getCurrentScreen();
      assert.strictEqual(screen.id, 'ISPF_PRIM');
      assert.ok(screen.title.includes('ISPF Primary Option Menu'));
    });
  });

  suite('2. Command & Hotspot Navigation', () => {
    test('navigates to WRKACTJOB via direct command', () => {
      const res = engine.executeCommand('WRKACTJOB');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.targetScreen, 'WRKACTJOB');
      assert.strictEqual(engine.currentScreenId, 'WRKACTJOB');

      const screen = engine.getCurrentScreen();
      assert.ok(screen.modernModel.title.includes('WRKACTJOB'));
      assert.ok(screen.modernModel.metrics!.length > 0);
    });

    test('navigates to WRKSYSSTS via direct command and option number', () => {
      const res = engine.executeCommand('WRKSYSSTS');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'WRKSYSSTS');

      // Go back to MAIN
      engine.executeCommand('MAIN');
      assert.strictEqual(engine.currentScreenId, 'MAIN');

      // Select option '3' on MAIN
      const resOpt = engine.executeCommand('3');
      assert.strictEqual(resOpt.success, true);
      assert.strictEqual(engine.currentScreenId, 'WRKSYSSTS');
    });

    test('navigates to WRKSPLF (Spooled Files) via option 4 on MAIN', () => {
      const res = engine.executeCommand('4');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'WRKSPLF');
      assert.ok(engine.getCurrentScreen().modernModel.title.includes('Spooled Files'));
    });

    test('navigates to STRSQL (Db2 for i SQL) via option 5 on MAIN', () => {
      const res = engine.executeCommand('5');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'STRSQL');
      assert.ok(engine.getCurrentScreen().modernModel.title.includes('Db2 for i'));
    });

    test('navigates to DSPMSG (System Messages) via option 8 on MAIN', () => {
      const res = engine.executeCommand('8');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'DSPMSG');
      assert.ok(engine.getCurrentScreen().modernModel.title.includes('Messages'));
    });

    test('navigates to z/OS SDSF DA via command', () => {
      const res = engine.executeCommand('SDSF');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'SDSF_DA');
      assert.strictEqual(engine.systemType, 'zos_3270');
    });

    test('navigates to CICS CEMT via command', () => {
      const res = engine.executeCommand('CICS');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'CICS_CEMT');
      assert.strictEqual(engine.systemType, 'zos_3270');
    });
  });

  suite('3. Modern Function Keys & History Stack', () => {
    test('F3 / F12 exits back to previous screen in history', () => {
      engine.executeCommand('WRKACTJOB');
      assert.strictEqual(engine.currentScreenId, 'WRKACTJOB');

      engine.executeCommand('WRKSYSSTS');
      assert.strictEqual(engine.currentScreenId, 'WRKSYSSTS');

      const resF3 = engine.pressFunctionKey('F3');
      assert.strictEqual(resF3.success, true);
      assert.strictEqual(engine.currentScreenId, 'WRKACTJOB');

      const resF12 = engine.pressFunctionKey('F12');
      assert.strictEqual(resF12.success, true);
      assert.strictEqual(engine.currentScreenId, 'MAIN');
    });

    test('F5 triggers a simulated live refresh', () => {
      const res = engine.pressFunctionKey('F5');
      assert.strictEqual(res.success, true);
      assert.ok(res.message.includes('refreshed'));
    });
  });

  suite('4. Natural Language Intent Resolution', () => {
    test('translates "show active jobs" to WRKACTJOB', () => {
      const res = engine.executeCommand('show active jobs');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'WRKACTJOB');
      assert.ok(res.message.includes('WRKACTJOB'));
    });

    test('translates "check system memory and cpu status" to WRKSYSSTS', () => {
      const res = engine.executeCommand('check system memory and cpu status');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'WRKSYSSTS');
    });

    test('translates "view printed spooled reports" to WRKSPLF', () => {
      const res = engine.executeCommand('view printed spooled reports');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'WRKSPLF');
    });

    test('translates "query db2 database sql" to STRSQL', () => {
      const res = engine.executeCommand('query db2 database sql');
      assert.strictEqual(res.success, true);
      assert.strictEqual(engine.currentScreenId, 'STRSQL');
    });
  });

  suite('5. CRT & Modern HTML Rendering', () => {
    test('renders CRT HTML with clickable hotspot badges', () => {
      const screen = engine.getCurrentScreen();
      const crtHtml = engine.renderCrtHtml(screen);

      assert.ok(crtHtml.includes('class="crt-line"'));
      assert.ok(crtHtml.includes('class="crt-hotspot"'));
      assert.ok(crtHtml.includes('data-cmd="1"'));
      assert.ok(crtHtml.includes('1. User tasks'));
    });

    test('renders Modern Web Card View HTML with metrics and tables', () => {
      engine.executeCommand('WRKACTJOB');
      const screen = engine.getCurrentScreen();
      const cardHtml = engine.renderModernCardHtml(screen);

      assert.ok(cardHtml.includes('modern-mainframe-view'));
      assert.ok(cardHtml.includes('Total CPU Utilization'));
      assert.ok(cardHtml.includes('QINTER'));
      assert.ok(cardHtml.includes('PAYROLL'));
      assert.ok(cardHtml.includes('btn-mf-card-action'));
    });
  });

  suite('6. 1-Click Modernization Artifacts (API & React)', () => {
    test('provides complete OpenAPI REST specification for active screen', () => {
      engine.executeCommand('WRKACTJOB');
      const screen = engine.getCurrentScreen();

      assert.strictEqual(screen.apiSpec.method, 'GET');
      assert.strictEqual(screen.apiSpec.path, '/api/v1/iseries/jobs/active');
      assert.ok(screen.apiSpec.summary.includes('Active Jobs'));
      assert.ok(screen.apiSpec.responseExample.jobs.length > 0);
    });

    test('provides ready-to-use React component for active screen', () => {
      engine.executeCommand('WRKACTJOB');
      const screen = engine.getCurrentScreen();

      assert.ok(screen.reactSnippet.includes('export const ActiveJobsTable'));
      assert.ok(screen.reactSnippet.includes('/api/v1/iseries/jobs/active'));
    });
  });
});
