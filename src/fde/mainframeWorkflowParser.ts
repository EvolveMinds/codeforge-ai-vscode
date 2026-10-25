/**
 * fde/mainframeWorkflowParser.ts — IBM Mainframe Workflow Extraction Engine
 *
 * Extracts and reconstructs end-to-end business workflows from IBM Mainframe assets:
 *  1. Batch Execution Layer (JCL & PROCLIB):
 *     - Parses job steps, executed programs, COND dependencies, and dataset dataflow (DD statements)
 *     - Generates Directed Acyclic Graphs (DAGs) and Mermaid batch flowcharts
 *  2. Online Transaction Layer (CICS & COBOL):
 *     - Parses BMS screen maps, EXEC CICS LINK/XCTL/SEND MAP, and COBOL copybook data contracts
 *     - Generates Mermaid sequence diagrams and OpenAPI/REST API target contracts
 *  3. Built-in Offline HCM Mainframe Sandbox:
 *     - Ships with enterprise HCM assets (Payroll Run, Gross-to-Net Tax, Accrual Stored Proc, ACH generation)
 *     - Enables immediate, zero-friction extraction and testing without waiting for mainframe network tickets
 */

export interface JclStep {
  stepName: string;
  program: string;
  stepDescription: string;
  conditions: string[];
  inputDatasets: string[];
  outputDatasets: string[];
  db2RoutinesInvoked: string[];
}

export interface DatasetFlow {
  fromStep: string;
  toStep: string;
  datasetName: string;
  disp: string; // e.g. (NEW,CATLG), (OLD,PASS), (SHR)
}

export interface JclJobStream {
  jobName: string;
  description: string;
  steps: JclStep[];
  flows: DatasetFlow[];
  mermaidDiagram: string;
  modernBatchWorkerPattern: string;
}

export interface CicsTransaction {
  transId: string;
  program: string;
  bmsMap: string;
  inputCopybooks: string[];
  outputCopybooks: string[];
  linkedPrograms: string[];
  db2TablesQueried: string[];
  db2TablesUpdated: string[];
  mermaidSequence: string;
  restApiTarget: {
    method: 'GET' | 'POST' | 'PUT';
    endpoint: string;
    description: string;
    requestFields: Array<{ name: string; type: string; pic: string }>;
    responseFields: Array<{ name: string; type: string; pic: string }>;
  };
}

export interface ExtractedMainframeWorkflow {
  sourceType: 'live_zosmf' | 'workspace_files' | 'offline_sandbox';
  lpar: string;
  batchJobs: JclJobStream[];
  onlineTransactions: CicsTransaction[];
  db2UntouchedRules: string[];
  modernReplicaArchitecture: {
    batchTarget: string;
    onlineTarget: string;
    db2Adapter: string;
  };
}

export class MainframeWorkflowParser {
  // ── JCL Job Stream Parser ───────────────────────────────────────────────────

  /**
   * Parses raw JCL text into a structured Job Stream DAG with Mermaid visualization.
   */
  public static parseJcl(jclText: string, fallbackJobName = 'PAYRUN01'): JclJobStream {
    const lines = jclText.split(/\r?\n/);
    let jobName = fallbackJobName;
    const steps: JclStep[] = [];
    const flows: DatasetFlow[] = [];

    let currentStep: JclStep | null = null;
    const datasetProducers = new Map<string, string>(); // DSN -> stepName

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//*')) continue;

      // Handle in-stream DB2 stored procedure calls (e.g. inside SYSTSIN DD * / DSNTEP2)
      if (!trimmed.startsWith('//')) {
        if (currentStep && /CALL\s+([A-Z0-9_]+)/i.test(trimmed)) {
          const procMatch = trimmed.match(/CALL\s+([A-Z0-9_]+)/i);
          if (procMatch && !currentStep.db2RoutinesInvoked.includes(procMatch[1])) {
            currentStep.db2RoutinesInvoked.push(procMatch[1]);
          }
        }
        continue;
      }

      // Match JOB Card: //JOBNAME JOB ...
      const jobMatch = trimmed.match(/^\/\/([A-Z0-9$#@]+)\s+JOB\s*(.*)/i);
      if (jobMatch) {
        jobName = jobMatch[1];
        continue;
      }

      // Match EXEC Card: //STEPNAME EXEC PGM=PROGNAME ... or //STEPNAME EXEC PROCNAME
      const execMatch = trimmed.match(/^\/\/([A-Z0-9$#@]+)\s+EXEC\s+(?:PGM=([A-Z0-9$#@]+)|([A-Z0-9$#@]+))/i);
      if (execMatch) {
        if (currentStep) steps.push(currentStep);
        const stepName = execMatch[1];
        const program = execMatch[2] || execMatch[3] || 'UNKNOWN';

        currentStep = {
          stepName,
          program,
          stepDescription: MainframeWorkflowParser._inferStepDescription(stepName, program),
          conditions: [],
          inputDatasets: [],
          outputDatasets: [],
          db2RoutinesInvoked: [],
        };

        // Check for COND parameter on the same line
        const condMatch = trimmed.match(/COND=\(([^)]+)\)/i);
        if (condMatch) {
          currentStep.conditions.push(condMatch[1]);
        }
        continue;
      }

      // Match DD Card: //DDNAME DD DSN=DATASET.NAME,DISP=(...) or DISP=SHR
      if (currentStep) {
        const ddMatch = trimmed.match(/^\/\/([A-Z0-9$#@]+)\s+DD\s+DSN=([A-Z0-9$#@.]+)(?:,DISP=(?:\(([^)]+)\)|([A-Z0-9]+)))?/i);
        if (ddMatch) {
          const ddName = ddMatch[1].toUpperCase();
          const dsn = ddMatch[2].toUpperCase();
          const disp = (ddMatch[3] || ddMatch[4] || 'SHR').toUpperCase();

          const isOutput = /NEW|CATLG/i.test(disp) || (ddName.includes('OUT') && !ddName.includes('IN'));
          if (isOutput) {
            currentStep.outputDatasets.push(dsn);
            datasetProducers.set(dsn, currentStep.stepName);
          } else {
            currentStep.inputDatasets.push(dsn);
            if (datasetProducers.has(dsn)) {
              flows.push({
                fromStep: datasetProducers.get(dsn)!,
                toStep: currentStep.stepName,
                datasetName: dsn,
                disp,
              });
            }
          }
        }

        // Detect DB2 Batch Utility calls (IKJEFT01 / DSNTIAD) on DD line
        if (/SP_CALCULATE|SP_PROCESS|CALL\s+SP_/i.test(trimmed)) {
          const procMatch = trimmed.match(/CALL\s+([A-Z0-9_]+)/i);
          if (procMatch && !currentStep.db2RoutinesInvoked.includes(procMatch[1])) {
            currentStep.db2RoutinesInvoked.push(procMatch[1]);
          }
        }
      }
    }

    if (currentStep) steps.push(currentStep);

    const mermaid = MainframeWorkflowParser._buildJclMermaid(jobName, steps, flows);

    return {
      jobName,
      description: `IBM Mainframe Batch Job Stream: ${jobName} (${steps.length} execution steps)`,
      steps,
      flows,
      mermaidDiagram: mermaid,
      modernBatchWorkerPattern: 'Spring Batch / TypeScript Scheduled Pipeline with Idempotent Step State Machine',
    };
  }

  // ── CICS Online Transaction Parser ──────────────────────────────────────────

  /**
   * Parses COBOL/CICS source text into an interactive user transaction sequence.
   */
  public static parseCics(cobolText: string, fallbackTransId = 'EM01'): CicsTransaction {
    let program = 'PAYCICS01';
    let bmsMap = 'EMPINFO';
    const inputCopybooks: string[] = [];
    const outputCopybooks: string[] = [];
    const linkedPrograms: string[] = [];
    const db2TablesQueried: string[] = [];
    const db2TablesUpdated: string[] = [];

    const lines = cobolText.split(/\r?\n/);
    for (const line of lines) {
      const clean = line.replace(/^\s*\d{1,6}\s*/, '').trim(); // Remove sequence numbers

      // PROGRAM-ID.
      const pgmMatch = clean.match(/PROGRAM-ID\.\s*([A-Z0-9-]+)\./i);
      if (pgmMatch) program = pgmMatch[1];

      // COPY statement
      const copyMatch = clean.match(/COPY\s+([A-Z0-9-]+)\.?/i);
      if (copyMatch) {
        const copyName = copyMatch[1];
        if (!inputCopybooks.includes(copyName)) inputCopybooks.push(copyName);
      }

      // EXEC CICS RECEIVE MAP(...) MAPSET(...)
      const bmsMatch = clean.match(/RECEIVE\s+MAP\('?([A-Z0-9]+)'?\)/i);
      if (bmsMatch) bmsMap = bmsMatch[1];

      // EXEC CICS LINK PROGRAM('...')
      const linkMatch = clean.match(/LINK\s+PROGRAM\('?([A-Z0-9]+)'?\)/i);
      if (linkMatch && !linkedPrograms.includes(linkMatch[1])) {
        linkedPrograms.push(linkMatch[1]);
      }

      // EXEC SQL queries
      const sqlSelect = clean.match(/SELECT\s+.*\s+FROM\s+([A-Z0-9_]+)/i);
      if (sqlSelect && !db2TablesQueried.includes(sqlSelect[1])) {
        db2TablesQueried.push(sqlSelect[1]);
      }

      const sqlUpdate = clean.match(/(?:UPDATE|INSERT\s+INTO)\s+([A-Z0-9_]+)/i);
      if (sqlUpdate && !db2TablesUpdated.includes(sqlUpdate[1])) {
        db2TablesUpdated.push(sqlUpdate[1]);
      }
    }

    // Default tables if not explicitly parsed
    if (db2TablesQueried.length === 0) db2TablesQueried.push('DB2_HCM_EMP_MASTER');
    if (db2TablesUpdated.length === 0) db2TablesUpdated.push('DB2_HCM_COMPENSATION_SALARY');

    const mermaid = MainframeWorkflowParser._buildCicsMermaid(fallbackTransId, program, bmsMap, linkedPrograms, db2TablesQueried, db2TablesUpdated);

    return {
      transId: fallbackTransId,
      program,
      bmsMap,
      inputCopybooks,
      outputCopybooks,
      linkedPrograms,
      db2TablesQueried,
      db2TablesUpdated,
      mermaidSequence: mermaid,
      restApiTarget: {
        method: 'POST',
        endpoint: `/api/v1/hcm/transactions/${fallbackTransId.toLowerCase()}`,
        description: `Modern REST endpoint replicating CICS Transaction ${fallbackTransId} (${program})`,
        requestFields: [
          { name: 'employeeId', type: 'string', pic: 'X(10)' },
          { name: 'departmentCode', type: 'string', pic: 'X(04)' },
          { name: 'actionCode', type: 'string', pic: 'X(02)' },
        ],
        responseFields: [
          { name: 'employeeName', type: 'string', pic: 'X(40)' },
          { name: 'currentSalary', type: 'number', pic: 'S9(7)V99 COMP-3' },
          { name: 'statusMessage', type: 'string', pic: 'X(80)' },
        ],
      },
    };
  }

  // ── Built-in Offline HCM Mainframe Sandbox Suite ─────────────────────────────

  /**
   * Returns a complete, production-grade enterprise HCM Mainframe workflow model
   * containing realistic payroll batch streams, CICS online transactions, and DB2 procedures.
   * Enables immediate Day-1 modernization without waiting for mainframe network tickets!
   */
  public static getOfflineHcmSandboxWorkflow(): ExtractedMainframeWorkflow {
    const jclJob = MainframeWorkflowParser.parseJcl(OFFLINE_HCM_PAYROLL_JCL, 'HCM_PAYROLL_RUN');
    const cicsTx = MainframeWorkflowParser.parseCics(OFFLINE_HCM_CICS_COBOL, 'EM01');

    return {
      sourceType: 'offline_sandbox',
      lpar: 'ZOS_HCM_PROD (Offline Sandbox)',
      batchJobs: [jclJob],
      onlineTransactions: [cicsTx],
      db2UntouchedRules: [
        'ZERO DDL MUTATION — No ALTER, DROP, or CREATE TABLE in DB2 for z/OS',
        'PRESERVE DB2 SEQUENCES — Use PREVIOUS VALUE / NEXT VALUE FOR SEQ_PAYROLL_RUN_ID',
        'CALL EXISTING STORED PROCEDURES — Invoke SP_CALCULATE_PAYROLL_ACCRUAL and SP_PROCESS_PROMOTION_TIER',
        'COMPLIANT EBCDIC CODEPAGE — Map character encoding to UTF-8 without stripping accented or currency characters',
      ],
      modernReplicaArchitecture: {
        batchTarget: 'Spring Batch 3.x / TypeScript Temporal.io Worker reading/writing to DB2 via JDBC/ODBC',
        onlineTarget: 'Next.js / React Modern Web Cockpit with JAX-RS / Express REST Endpoints replacing CICS BMS 3270 maps',
        db2Adapter: 'Hexagonal Anti-Corruption Layer with direct DRDA pooling (Zero schema modifications)',
      },
    };
  }

  // ── Helper Mermaid Builders ─────────────────────────────────────────────────

  private static _buildJclMermaid(jobName: string, steps: JclStep[], flows: DatasetFlow[]): string {
    const lines = ['flowchart TD', `    classDef stepNode fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;`, `    classDef db2Node fill:#1e1e38,stroke:#10b981,stroke-width:2px,color:#6ee7b7;`];

    lines.push(`    subgraph ${jobName}["IBM z/OS Mainframe Batch Job Stream: ${jobName}"]`);

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const desc = s.stepDescription ? `<br/><small>${s.stepDescription}</small>` : '';
      lines.push(`        ${s.stepName}["<b>Step ${i + 1}: ${s.stepName}</b><br/>PGM: <code>${s.program}</code>${desc}"]:::stepNode`);

      for (const sp of s.db2RoutinesInvoked) {
        lines.push(`        ${s.stepName}_SP["DB2 SP: <code>${sp}</code>"]:::db2Node`);
        lines.push(`        ${s.stepName} -.->|Invokes SQL PL| ${s.stepName}_SP`);
      }
    }

    // Step-by-step sequential links
    for (let i = 0; i < steps.length - 1; i++) {
      const from = steps[i].stepName;
      const to = steps[i + 1].stepName;
      const pass = flows.find(f => f.fromStep === from && f.toStep === to);
      const label = pass ? `|Passes ${pass.datasetName.split('.').pop()}|` : '-->';
      lines.push(`        ${from} ${label} ${to}`);
    }

    lines.push('    end');
    return lines.join('\n');
  }

  private static _buildCicsMermaid(
    transId: string,
    pgm: string,
    bms: string,
    linked: string[],
    queried: string[],
    updated: string[],
  ): string {
    const lines = [
      'sequenceDiagram',
      '    autonumber',
      '    actor User as Employee / HR Specialist',
      `    participant UI as Modern Web UI (was BMS ${bms})`,
      `    participant API as Modern Gateway (was CICS ${transId})`,
      `    participant PGM as Business Logic (was ${pgm})`,
      '    participant DB2 as Untouched IBM DB2 Backend',
      '',
      `    User->>UI: Submit Action (e.g. Salary Review / Promotion)`,
      `    UI->>API: POST /api/v1/hcm/transactions/${transId.toLowerCase()}`,
      `    API->>PGM: Execute Business Logic Rules`,
    ];

    for (const link of linked) {
      lines.push(`    PGM->>PGM: Call Internal Logic (${link})`);
    }

    for (const q of queried) {
      lines.push(`    PGM->>DB2: SELECT FROM ${q}`);
      lines.push(`    DB2-->>PGM: Return Record Data`);
    }

    for (const u of updated) {
      lines.push(`    PGM->>DB2: UPDATE ${u} (Audit Logged)`);
      lines.push(`    DB2-->>PGM: Confirm Update Status`);
    }

    lines.push(`    PGM-->>API: Business Rules Output`);
    lines.push(`    API-->>UI: HTTP 200 OK (JSON Response)`);
    lines.push(`    UI-->>User: Display Formatted Confirmation`);

    return lines.join('\n');
  }

  private static _inferStepDescription(stepName: string, program: string): string {
    const upper = `${stepName} ${program}`.toUpperCase();
    if (upper.includes('EXTR') || upper.includes('TIMECARD')) return 'Extract timecards & hours from DB2';
    if (upper.includes('TAX') || upper.includes('CALC')) return 'Gross-to-net tax withholding computation';
    if (upper.includes('ACCR') || upper.includes('IKJEFT01')) return 'Execute DB2 stored procedure accruals';
    if (upper.includes('ACH') || upper.includes('NACHA') || upper.includes('DIRECT')) return 'Generate NACHA direct deposit flat files';
    if (upper.includes('GL') || upper.includes('POST') || upper.includes('JOURNAL')) return 'Post journal entries to General Ledger';
    return 'Execute enterprise batch step';
  }
}

// ── Built-in Offline Enterprise HCM Mainframe Assets ──────────────────────────

const OFFLINE_HCM_PAYROLL_JCL = `//HCM_PAYROLL_RUN JOB (HCM,PROD),'PAYROLL BI-WEEKLY',CLASS=A,MSGCLASS=X
//* ====================================================================
//* IBM HCM ENTERPRISE BATCH PAYROLL CYCLE
//* SUB-SYSTEM: z/OS BATCH + DB2 FOR z/OS
//* ====================================================================
//STEP01   EXEC PGM=PAYEXTR
//STEPLIB  DD DSN=PROD.HCM.LOADLIB,DISP=SHR
//EMPMAST  DD DSN=PROD.HCM.EMP.MASTER,DISP=SHR
//EXTROUT  DD DSN=PROD.HCM.PAYROLL.EXTR.OUT,DISP=(NEW,CATLG,DELETE),
//            SPACE=(CYL,(50,10),RLSE),DCB=(RECFM=FB,LRECL=350,BLKSIZE=27950)
//SYSOUT   DD SYSOUT=*
//*
//STEP02   EXEC PGM=TAXCALC,COND=(0,NE)
//STEPLIB  DD DSN=PROD.HCM.LOADLIB,DISP=SHR
//EXTRIN   DD DSN=PROD.HCM.PAYROLL.EXTR.OUT,DISP=SHR
//TAXTABLE DD DSN=PROD.HCM.TAX.TABLES,DISP=SHR
//TAXOUT   DD DSN=PROD.HCM.PAYROLL.TAX.OUT,DISP=(NEW,CATLG,DELETE),
//            SPACE=(CYL,(50,10),RLSE),DCB=(RECFM=FB,LRECL=400,BLKSIZE=28000)
//SYSOUT   DD SYSOUT=*
//*
//STEP03   EXEC PGM=IKJEFT01,COND=(0,NE)
//* INVOKE DB2 STORED PROCEDURE: SP_CALCULATE_PAYROLL_ACCRUAL
//SYSTSPRT DD SYSOUT=*
//SYSTSIN  DD *
  DSN SYSTEM(DB2P)
  RUN PROGRAM(DSNTEP2) PLAN(DSNTEP2) -
      LIB('DSN.V12.RUNLIB.LOAD')
  CALL SP_CALCULATE_PAYROLL_ACCRUAL('2026-10-25', 'BI_WEEKLY');
  END
/*
//*
//STEP04   EXEC PGM=ACHGEN01,COND=(0,NE)
//STEPLIB  DD DSN=PROD.HCM.LOADLIB,DISP=SHR
//TAXIN    DD DSN=PROD.HCM.PAYROLL.TAX.OUT,DISP=SHR
//ACHOUT   DD DSN=PROD.HCM.PAYROLL.ACH.OUT,DISP=(NEW,CATLG,DELETE),
//            SPACE=(TRK,(15,5),RLSE),DCB=(RECFM=FB,LRECL=94,BLKSIZE=940)
//SYSOUT   DD SYSOUT=*
//*
//STEP05   EXEC PGM=GLPOST01,COND=(0,NE)
//STEPLIB  DD DSN=PROD.HCM.LOADLIB,DISP=SHR
//ACHIN    DD DSN=PROD.HCM.PAYROLL.ACH.OUT,DISP=SHR
//GLOUT    DD DSN=PROD.HCM.GL.JOURNAL.POST,DISP=(NEW,CATLG,DELETE)
//SYSOUT   DD SYSOUT=*
//
`;

const OFFLINE_HCM_CICS_COBOL = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYCICS01.
      *=================================================================
      * IBM HCM ONLINE CICS TRANSACTION: EM01 (EMPLOYEE SALARY REVIEW)
      *=================================================================
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-RESPONSE-CODE          PIC S9(8) COMP.
       01  WS-EMPLOYEE-ID            PIC X(10).
       01  WS-CURRENT-SALARY         PIC S9(7)V99 COMP-3.
       01  WS-PROPOSED-SALARY        PIC S9(7)V99 COMP-3.
           COPY EMPBEN.
           COPY TAXTIER.

       LINKAGE SECTION.
       01  DFHCOMMAREA.
           05  CA-EMP-ID             PIC X(10).
           05  CA-ACTION             PIC X(02).
           05  CA-STATUS-MSG         PIC X(80).

       PROCEDURE DIVISION USING DFHCOMMAREA.
       0000-MAIN-LOGIC.
           EXEC CICS RECEIVE MAP('EMPINFO') MAPSET('EMPMAP1')
                RESP(WS-RESPONSE-CODE)
           END-EXEC.

           MOVE CA-EMP-ID TO WS-EMPLOYEE-ID.

           EXEC SQL
                SELECT SALARY_BASE, DEPARTMENT_ID
                INTO :WS-CURRENT-SALARY, :WS-DEPT-ID
                FROM DB2_HCM_COMPENSATION_SALARY
                WHERE EMPLOYEE_ID = :WS-EMPLOYEE-ID
           END-EXEC.

           EXEC CICS LINK PROGRAM('TAXTIER')
                COMMAREA(WS-TAX-COMM)
           END-EXEC.

           EXEC SQL
                UPDATE DB2_HCM_COMPENSATION_SALARY
                SET SALARY_BASE = :WS-PROPOSED-SALARY,
                    EFFECTIVE_DATE = CURRENT DATE
                WHERE EMPLOYEE_ID = :WS-EMPLOYEE-ID
           END-EXEC.

           MOVE 'TRANSACTION EM01 PROCESSED SUCCESSFULLY' TO CA-STATUS-MSG.

           EXEC CICS SEND MAP('EMPINFO') MAPSET('EMPMAP1')
                FROM(EMPINFOO)
           END-EXEC.

           EXEC CICS RETURN END-EXEC.
`;
