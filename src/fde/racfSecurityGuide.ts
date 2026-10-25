/**
 * fde/racfSecurityGuide.ts — Mainframe RACF / SAF Least-Privilege Security Clearance Guide
 *
 * Generates an executive, auditable specification proving that Evolve AI operates in
 * 100% READ-ONLY mode with ZERO data/DDL mutation rights.
 *
 * Contains exact, copy-pasteable commands for:
 *  - IBM RACF (Resource Access Control Facility)
 *  - Broadcom CA-ACF2
 *  - Broadcom CA-Top Secret
 *  - IBM DB2 for z/OS Catalog Read-Only Grants
 */

export interface RacfGuideOptions {
  userId?: string;
  groupName?: string;
  hlqPrefix?: string;
  db2Subsystem?: string;
  lparName?: string;
}

export class RacfSecurityGuide {
  public static generateMarkdown(opts: RacfGuideOptions = {}): string {
    const user = (opts.userId || 'EVOLVEID').toUpperCase();
    const group = (opts.groupName || 'EVOLVEDEV').toUpperCase();
    const hlq = (opts.hlqPrefix || 'PROD.HCM').toUpperCase();
    const db2 = (opts.db2Subsystem || 'DB2P').toUpperCase();
    const lpar = opts.lparName || 'z/OS Production / Pre-Production LPAR';

    return `# 🛡️ IBM Mainframe Read-Only Security Clearance & Governance Specification

> **Target LPAR:** \`${lpar}\`  
> **Service Principal / User ID:** \`${user}\`  
> **Application Role:** Architectural Control Plane & Workflow Extraction Engine (Evolve AI)  
> **Authority Class:** **STRICTLY READ-ONLY (ZERO ALTER / ZERO UPDATE / ZERO DDL MUTATION)**

---

## 1. Executive Security & Non-Destructive Guarantee

Evolve AI connects to the IBM z/OS Mainframe exclusively to inspect metadata, batch job dependencies, and CICS transaction sequences for modernized architectural replica planning.

- **ZERO DDL MUTATION:** Evolve AI never issues \`ALTER\`, \`DROP\`, or \`CREATE\` statements against DB2 for z/OS.
- **ZERO DATA MODIFICATION:** Evolve AI never issues \`INSERT\`, \`UPDATE\`, or \`DELETE\` statements on any business table.
- **ZERO PDS OVERWRITES:** Datasets and partitioned dataset members are accessed with exclusive read-only intent (\`DISP=SHR\`).
- **AUDIT LOGGING:** Every access triggers standard z/OS System Management Facility (SMF) Type 80 (RACF audit) and Type 30 (accounting) records for 100% compliance transparency.

---

## 2. IBM RACF Security Commands (Copy-Paste for Mainframe Sysadmin)

Submit the following commands in TSO / RACF Command Utility:

\`\`\`jcl
/* 1. Define Evolve AI Service User (If not already created) */
ADDUSER ${user} DFLTGRP(${group}) NAME('EVOLVE AI AGENT') -
        PASSWORD(TEMPPASS) RESTRICTED

/* 2. Authorize Read-Only Access to z/OSMF Dataset & Job REST Services */
RDEFINE FACILITY IZUDFSG.DATASET.READ-ONLY UACC(NONE)
PERMIT IZUDFSG.DATASET.READ-ONLY CLASS(FACILITY) ID(${user}) ACCESS(READ)

RDEFINE FACILITY IZUDFSG.JOBS.READ-ONLY UACC(NONE)
PERMIT IZUDFSG.JOBS.READ-ONLY CLASS(FACILITY) ID(${user}) ACCESS(READ)

/* 3. Grant Read-Only Access to HCM Application Datasets (JCL, COBOL, Copybooks) */
PERMIT '${hlq}.**' CLASS(DATASET) ID(${user}) ACCESS(READ)

/* 4. Refresh In-Memory RACF SAF Tables */
SETROPTS RACLIST(FACILITY) REFRESH
SETROPTS GENERIC(DATASET) REFRESH
\`\`\`

---

## 3. IBM DB2 for z/OS Catalog Read-Only Permissions

To inspect stored procedure signatures (\`SYSIBM.SYSROUTINES\`), triggers (\`SYSIBM.SYSTRIGGERS\`), and sequences (\`SYSIBM.SYSSEQUENCES\`) without touching user data:

\`\`\`sql
-- Connect to DB2 Subsystem: ${db2}
GRANT SELECT ON SYSIBM.SYSROUTINES TO ${user};
GRANT SELECT ON SYSIBM.SYSTRIGGERS TO ${user};
GRANT SELECT ON SYSIBM.SYSSEQUENCES TO ${user};
GRANT SELECT ON SYSIBM.SYSTABLES TO ${user};
GRANT SELECT ON SYSIBM.SYSCOLUMNS TO ${user};
GRANT SELECT ON SYSIBM.SYSRELS TO ${user};
GRANT SELECT ON SYSIBM.SYSFOREIGNKEYS TO ${user};

-- Explicitly DENY all mutation operations
REVOKE ALTER, DROP, INSERT, UPDATE, DELETE ON DATABASE * FROM ${user};
\`\`\`

---

## 4. Alternative ESM Equivalents (ACF2 & Top Secret)

### Broadcom CA-ACF2
\`\`\`text
SET RESOURCE(FAC)
RECADD IZUDFSG.DATASET.READ-ONLY SERVICE(READ)
COMPILE
$KEY(${hlq}) TYPE(DSN)
- UID(${user}) SERVICE(READ) ALLOW
STORE
\`\`\`

### Broadcom CA-Top Secret (TSS)
\`\`\`text
TSS PERMIT(${user}) IBMFAC(IZUDFSG.DATASET.READ-ONLY) ACCESS(READ)
TSS PERMIT(${user}) IBMFAC(IZUDFSG.JOBS.READ-ONLY) ACCESS(READ)
TSS PERMIT(${user}) DSNAME(${hlq}.) ACCESS(READ)
\`\`\`

---

## 5. Verification Checklist for Security Admin

- [x] Protocol: Encrypted HTTPS on port 10443 (z/OSMF) and DRDA on port 446 (AT-TLS enforced).
- [x] Character Set: EBCDIC-to-UTF8 automatic conversion managed server-side by z/OS.
- [x] Session Model: Stateless REST calls or ephemeral PassTicket authentication.
- [x] Preflight Gatekeeper: Evolve AI automatically halts if any DDL mutation is detected in any build workspace.
`;
  }
}
