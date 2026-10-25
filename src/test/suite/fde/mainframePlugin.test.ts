/**
 * test/suite/fde/mainframePlugin.test.ts
 *
 * Verifies the IBM Mainframe Connected Plugin and Workflow Extraction Engine:
 *  - Auto-discovery of profiles & offline sandbox
 *  - Plain-English translation of cryptic RACF (ICH408I), ABEND (0C7/0C4), and JES errors
 *  - JCL Batch DAG extraction & Mermaid flowchart generation
 *  - CICS Online Transaction sequence parsing & REST API specification
 *  - RACF Least-Privilege Security Clearance guide generation
 */

import * as assert from 'assert';
import { ZosmfClient } from '../../../fde/zosmfClient';
import { MainframeWorkflowParser } from '../../../fde/mainframeWorkflowParser';
import { RacfSecurityGuide } from '../../../fde/racfSecurityGuide';

describe('IBM Mainframe (z/OS) Connected Plugin & Workflow Engine', () => {

  describe('1. Auto-Discovery & Profile Management', () => {
    it('always discovers the built-in Offline HCM Mainframe Sandbox profile', () => {
      const profiles = ZosmfClient.discoverProfiles();
      assert.ok(profiles.length >= 1, 'Should discover at least 1 profile');

      const sandbox = profiles.find(p => p.source === 'offline_sandbox');
      assert.ok(sandbox, 'Should include offline sandbox profile');
      assert.strictEqual(sandbox!.port, 10443);
      assert.strictEqual(sandbox!.user, 'HCMDEV01');
      assert.ok(sandbox!.name.includes('Offline IBM HCM Mainframe Sandbox'));
    });
  });

  describe('2. Plain-English Cryptic Error Diagnostics', () => {
    it('diagnoses RACF Insufficient Authority (ICH408I) with copy-paste remediation', () => {
      const rawError = 'ICH408I USER(HCMDEV01) GROUP(SYS1) NAME(DOE, JOHN) CL(FACILITY) INSUFFICIENT ACCESS AUTHORITY FROM IZUDFSG.DATASET.READ-ONLY(G) ACCESS INTENT(READ) - FAILED';
      const diag = ZosmfClient.diagnoseError(rawError);

      assert.strictEqual(diag.rawCode, 'ICH408I');
      assert.strictEqual(diag.category, 'RACF_SECURITY');
      assert.ok(diag.title.includes('RACF Security Authorization Failed'));
      assert.ok(diag.plainEnglishExplanation.includes('HCMDEV01'));
      assert.ok(diag.remediationCommand?.includes('PERMIT IZUDFSG.DATASET.READ-ONLY CLASS(FACILITY) ID(HCMDEV01) ACCESS(READ)'));
      assert.ok(diag.remediationCommand?.includes('SETROPTS RACLIST(FACILITY) REFRESH'));
    });

    it('diagnoses COBOL Data Exception ABEND (S0C7 / 0C7)', () => {
      const rawError = 'CEE3207S The system detected a data exception (SYSABEND S0C7). From compile unit PAY001.';
      const diag = ZosmfClient.diagnoseError(rawError);

      assert.strictEqual(diag.rawCode, 'S0C7');
      assert.strictEqual(diag.category, 'DATA_EXCEPTION');
      assert.ok(diag.title.includes('COBOL Data Exception ABEND'));
      assert.ok(diag.recommendedAction.includes('COMP-3'));
    });

    it('diagnoses JCL Batch Execution Severe Error (MAXCC=0008)', () => {
      const rawError = 'JOB PAYRUN01(JOB08921) ENDED. MAXCC=0008 BYTES=14092';
      const diag = ZosmfClient.diagnoseError(rawError);

      assert.strictEqual(diag.rawCode, 'MAXCC=0008');
      assert.strictEqual(diag.category, 'JCL_ERROR');
      assert.ok(diag.title.includes('MAXCC=0008'));
    });

    it('diagnoses Enterprise AT-TLS Certificate Failure', () => {
      const rawError = 'Error: PKIX path building failed: unable to find valid certification path to requested target';
      const diag = ZosmfClient.diagnoseError(rawError);

      assert.strictEqual(diag.rawCode, 'TLS_CERT_UNTRUSTED');
      assert.strictEqual(diag.category, 'TLS_CERT');
      assert.ok(diag.recommendedAction.includes('caCertPath'));
    });
  });

  describe('3. JCL Batch Job Stream DAG Parser', () => {
    it('parses multi-step JCL and extracts step dependencies and DB2 procedure calls', () => {
      const sampleJcl = `//HCM_TEST JOB (HCM),'PAYROLL TEST',CLASS=A
//STEP01   EXEC PGM=EXTRACT1
//EXTROUT  DD DSN=PROD.HCM.EXTR.DATA,DISP=(NEW,CATLG)
//*
//STEP02   EXEC PGM=CALCTAX,COND=(0,NE)
//EXTRIN   DD DSN=PROD.HCM.EXTR.DATA,DISP=SHR
//SYSTSIN  DD *
  CALL SP_CALCULATE_PAYROLL_ACCRUAL('2026-10-25');
/*
//
`;
      const stream = MainframeWorkflowParser.parseJcl(sampleJcl, 'HCM_TEST');

      assert.strictEqual(stream.jobName, 'HCM_TEST');
      assert.strictEqual(stream.steps.length, 2);

      assert.strictEqual(stream.steps[0].stepName, 'STEP01');
      assert.strictEqual(stream.steps[0].program, 'EXTRACT1');
      assert.ok(stream.steps[0].outputDatasets.includes('PROD.HCM.EXTR.DATA'));

      assert.strictEqual(stream.steps[1].stepName, 'STEP02');
      assert.strictEqual(stream.steps[1].program, 'CALCTAX');
      assert.ok(stream.steps[1].inputDatasets.includes('PROD.HCM.EXTR.DATA'));
      assert.ok(stream.steps[1].db2RoutinesInvoked.includes('SP_CALCULATE_PAYROLL_ACCRUAL'));

      // Check Mermaid DAG generation
      assert.ok(stream.mermaidDiagram.includes('flowchart TD'));
      assert.ok(stream.mermaidDiagram.includes('STEP01'));
      assert.ok(stream.mermaidDiagram.includes('STEP02'));
      assert.ok(stream.mermaidDiagram.includes('SP_CALCULATE_PAYROLL_ACCRUAL'));
    });
  });

  describe('4. CICS Online Transaction Parser', () => {
    it('parses COBOL CICS source and maps to modern REST API contract', () => {
      const sampleCobol = `       IDENTIFICATION DIVISION.
       PROGRAM-ID. EM01PGM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
           COPY EMPCPY.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE MAP('EMPMAP') END-EXEC.
           EXEC SQL SELECT * FROM DB2_HCM_EMP_MASTER END-EXEC.
           EXEC CICS LINK PROGRAM('SUBPGM1') END-EXEC.
           EXEC SQL UPDATE DB2_HCM_COMPENSATION_SALARY END-EXEC.
           EXEC CICS SEND MAP('EMPMAP') END-EXEC.
           EXEC CICS RETURN END-EXEC.
`;
      const tx = MainframeWorkflowParser.parseCics(sampleCobol, 'EM01');

      assert.strictEqual(tx.transId, 'EM01');
      assert.strictEqual(tx.program, 'EM01PGM');
      assert.strictEqual(tx.bmsMap, 'EMPMAP');
      assert.ok(tx.linkedPrograms.includes('SUBPGM1'));
      assert.ok(tx.db2TablesQueried.includes('DB2_HCM_EMP_MASTER'));
      assert.ok(tx.db2TablesUpdated.includes('DB2_HCM_COMPENSATION_SALARY'));

      // Check Modern REST API Target Contract
      assert.strictEqual(tx.restApiTarget.method, 'POST');
      assert.strictEqual(tx.restApiTarget.endpoint, '/api/v1/hcm/transactions/em01');
      assert.ok(tx.restApiTarget.requestFields.some(f => f.name === 'employeeId'));

      // Check Mermaid Sequence Diagram
      assert.ok(tx.mermaidSequence.includes('sequenceDiagram'));
      assert.ok(tx.mermaidSequence.includes('DB2_HCM_EMP_MASTER'));
      assert.ok(tx.mermaidSequence.includes('DB2_HCM_COMPENSATION_SALARY'));
    });
  });

  describe('5. Built-in Offline Enterprise HCM Sandbox', () => {
    it('delivers complete end-to-end batch and online workflows out of the box', () => {
      const sandbox = MainframeWorkflowParser.getOfflineHcmSandboxWorkflow();

      assert.strictEqual(sandbox.sourceType, 'offline_sandbox');
      assert.ok(sandbox.batchJobs.length >= 1);
      assert.ok(sandbox.onlineTransactions.length >= 1);

      const batch = sandbox.batchJobs[0];
      assert.strictEqual(batch.jobName, 'HCM_PAYROLL_RUN');
      assert.strictEqual(batch.steps.length, 5); // EXTR01, TAXCALC, ACCRUAL, ACHGEN, GLPOST

      assert.ok(sandbox.db2UntouchedRules.some(r => r.includes('ZERO DDL MUTATION')));
      assert.ok(sandbox.modernReplicaArchitecture.batchTarget.includes('Spring Batch'));
    });
  });

  describe('6. RACF Least-Privilege Security Clearance Guide', () => {
    it('generates an auditable markdown document with read-only SAF/RACF commands', () => {
      const md = RacfSecurityGuide.generateMarkdown({
        userId: 'TESTUSER',
        hlqPrefix: 'PROD.HCM',
        db2Subsystem: 'DB2P',
      });

      assert.ok(md.includes('# 🛡️ IBM Mainframe Read-Only Security Clearance'));
      assert.ok(md.includes('TESTUSER'));
      assert.ok(md.includes('PROD.HCM.**'));
      assert.ok(md.includes('IZUDFSG.DATASET.READ-ONLY'));
      assert.ok(md.includes('GRANT SELECT ON SYSIBM.SYSROUTINES TO TESTUSER'));
      assert.ok(md.includes('REVOKE ALTER, DROP, INSERT, UPDATE, DELETE ON DATABASE * FROM TESTUSER'));
    });
  });
});
