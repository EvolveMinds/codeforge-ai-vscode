import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  GitLogMiner,
  DependencyGrapher,
  TemporalCoupler,
  CodeToDbLinker,
  BrownfieldSynthesizer,
  CodebaseGraphEngine,
  WorkspaceArchetypeMiner,
  RepoSecurityScanner,
  ProjectOrientationSynthesizer,
  calculateShannonEntropy,
  validateLuhn,
  validateCanadianSin,
  validateAustralianTfn,
  validateIban,
  validateUkNhs,
  validateUsSsn,
  CodeNode,
  ScannedFile
} from '../../../fde/codebaseGraph';

suite('FDE Suite — Codebase Cosmos & Git Architecture Intelligence', () => {
  test('GitLogMiner parses commit stream, computes churn, defects, and hotspots', () => {
    const rawGitLog = `COMMIT|hash1|Alice|alice@corp.com|2026-09-01 10:00:00|feat(billing): initial payment engine
100\t0\tsrc/billing/service.ts
50\t0\tsrc/billing/model.ts

COMMIT|hash2|Alice|alice@corp.com|2026-09-05 12:00:00|fix(billing): patch race condition bug in checkout
25\t5\tsrc/billing/service.ts
10\t2\tsrc/common/utils.ts

COMMIT|hash3|Alice|alice@corp.com|2026-09-10 14:00:00|fix(billing): resolve deadlock defect in db transaction
30\t10\tsrc/billing/service.ts
5\t1\tsrc/common/utils.ts

COMMIT|hash4|Alice|alice@corp.com|2026-09-15 16:00:00|fix(billing): hotfix for payment timeout
40\t15\tsrc/billing/service.ts
`;

    const result = GitLogMiner.parseGitLogOutput(rawGitLog);

    assert.strictEqual(result.commitsParsed, 4);
    assert.strictEqual(result.fileMetrics.size, 3);

    const billingService = result.fileMetrics.get('src/billing/service.ts');
    assert.ok(billingService);
    assert.strictEqual(billingService.commitCount, 4);
    assert.strictEqual(billingService.defectCount, 3); // 3 commit messages with "fix:", "bug", "defect", "hotfix"
    assert.strictEqual(billingService.primaryAuthor, 'Alice');
    assert.strictEqual(billingService.primaryAuthorShare, 100);
    assert.strictEqual(billingService.busFactorRisk, true); // Alice > 80% with >= 4 commits
    assert.ok(billingService.hotspotScore > 50); // High volatility hotspot
    assert.strictEqual(billingService.isHotspot, true);

    const authorAlice = result.authorStats.find(a => a.name === 'Alice');
    assert.ok(authorAlice);
    assert.strictEqual(authorAlice.commitCount, 4);
  });

  test('DependencyGrapher detects circular dependency loops via Tarjan SCC', () => {
    // Construct graph with a 3-node cycle: A -> B -> C -> A, and D -> E (acyclic)
    const graph = new Map<string, Set<string>>([
      ['moduleA.ts', new Set(['moduleB.ts'])],
      ['moduleB.ts', new Set(['moduleC.ts'])],
      ['moduleC.ts', new Set(['moduleA.ts'])],
      ['moduleD.ts', new Set(['moduleE.ts'])],
      ['moduleE.ts', new Set()]
    ]);

    const cycles = DependencyGrapher.detectCycles(graph);

    assert.strictEqual(cycles.length, 1);
    assert.strictEqual(cycles[0].length, 3);
    const cycleNodes = new Set(cycles[0].cycle);
    assert.ok(cycleNodes.has('moduleA.ts'));
    assert.ok(cycleNodes.has('moduleB.ts'));
    assert.ok(cycleNodes.has('moduleC.ts'));
    assert.ok(!cycleNodes.has('moduleD.ts'));
  });

  test('TemporalCoupler computes Jaccard co-commit similarity and identifies hidden links', () => {
    const commits = [
      {
        hash: 'c1',
        authorName: 'Bob',
        authorEmail: 'bob@corp.com',
        date: '2026-09-01',
        message: 'feat: checkout',
        isDefectFix: false,
        files: [
          { added: 10, deleted: 0, path: 'src/checkout/service.ts' },
          { added: 5, deleted: 0, path: 'src/tax/calculator.cs' }
        ]
      },
      {
        hash: 'c2',
        authorName: 'Bob',
        authorEmail: 'bob@corp.com',
        date: '2026-09-02',
        message: 'fix: tax rate',
        isDefectFix: true,
        files: [
          { added: 8, deleted: 2, path: 'src/checkout/service.ts' },
          { added: 12, deleted: 1, path: 'src/tax/calculator.cs' }
        ]
      },
      {
        hash: 'c3',
        authorName: 'Bob',
        authorEmail: 'bob@corp.com',
        date: '2026-09-03',
        message: 'feat: currency support',
        isDefectFix: false,
        files: [
          { added: 15, deleted: 3, path: 'src/checkout/service.ts' },
          { added: 20, deleted: 4, path: 'src/tax/calculator.cs' }
        ]
      }
    ];

    const result = TemporalCoupler.calculate(commits, {
      minCoCommits: 3,
      minJaccard: 0.5
    });

    assert.strictEqual(result.couplings.length, 1);
    const coupling = result.couplings[0];
    assert.strictEqual(coupling.coCommits, 3);
    assert.strictEqual(coupling.jaccard, 1.0); // Changed together in 3 out of 3 commits = 100%
    assert.strictEqual(result.hiddenCouplingCount, 1);
  });

  test('BrownfieldSynthesizer categorizes Strangler candidates and emits valid Mermaid sequence topologies', () => {
    const nodes: CodeNode[] = [
      {
        id: 'src/legacy/monolith.ts',
        label: 'monolith.ts',
        directory: 'src/legacy',
        language: 'typescript',
        linesOfCode: 1500,
        commitCount: 25,
        churnLines: 800,
        defectCount: 8,
        hotspotScore: 92.5,
        isHotspot: true,
        primaryAuthor: 'Dev1',
        primaryAuthorShare: 85,
        busFactorRisk: true,
        linkedTables: ['orders', 'users'],
        modernizationCategory: 'neutral',
        inDegree: 12,
        outDegree: 18
      },
      {
        id: 'src/stable/crypto.ts',
        label: 'crypto.ts',
        directory: 'src/stable',
        language: 'typescript',
        linesOfCode: 120,
        commitCount: 2,
        churnLines: 20,
        defectCount: 0,
        hotspotScore: 5.0,
        isHotspot: false,
        primaryAuthor: 'Dev2',
        primaryAuthorShare: 100,
        busFactorRisk: false,
        linkedTables: [],
        modernizationCategory: 'neutral',
        inDegree: 10,
        outDegree: 0
      }
    ];

    const synthesis = BrownfieldSynthesizer.synthesize(
      nodes,
      [nodes[0]], // hotspots
      [],         // cycles
      [],         // temporal
      [{ tableName: 'orders', files: ['src/legacy/monolith.ts'], matchTypes: ['sql-query'] }]
    );

    // Strangler Fig categories
    assert.strictEqual(nodes[0].modernizationCategory, 'strangle');
    assert.strictEqual(nodes[1].modernizationCategory, 'preserve');
    assert.strictEqual(synthesis.modernizationCandidates.length, 1);
    assert.strictEqual(synthesis.preservedCore.length, 1);

    // Valid Mermaid sequence syntax
    assert.ok(synthesis.asIsMermaid.includes('sequenceDiagram'));
    assert.ok(synthesis.asIsMermaid.includes('monolith.ts (Hotspot)'));
    assert.ok(synthesis.asIsMermaid.includes('Database [orders]'));

    assert.ok(synthesis.toBeMermaid.includes('sequenceDiagram'));
    assert.ok(synthesis.toBeMermaid.includes('AI Agent'));
    assert.ok(synthesis.toBeMermaid.includes('Compliance & Security Gate'));
  });

  test('CodebaseGraphEngine runs end-to-end analysis on current workspace', async function () {
    this.timeout(180000);
    const repoPath = process.cwd();
    const result = await CodebaseGraphEngine.analyze(repoPath, {
      maxCommits: 10,
      databaseTables: ['users', 'projects']
    });

    assert.ok(result);
    assert.ok(result.totalFiles > 0);
    assert.ok(result.nodes.length > 0);
    assert.ok(result.links.length > 0);
    assert.ok(result.asIsMermaidDiagram.includes('sequenceDiagram'));
    assert.ok(result.toBeMermaidDiagram.includes('sequenceDiagram'));
    assert.ok(result.summary.topSubsystems.length > 0);
    assert.ok(result.qualityReport, 'Expected qualityReport to be attached');
    assert.ok(typeof result.summary.qualityIssueCount === 'number');
  });

  test('WorkspaceArchetypeMiner discovers monorepo packages, AI guardrails, and domain topologies', () => {
    const archetype = WorkspaceArchetypeMiner.mine(process.cwd(), ['auth_profiles', 'clients']);
    assert.ok(archetype);
    assert.strictEqual(typeof archetype.projectName, 'string');
    assert.strictEqual(typeof archetype.framework, 'string');
    assert.ok(Array.isArray(archetype.packages));
    assert.ok(Array.isArray(archetype.ingressRoutes));
    assert.ok(Array.isArray(archetype.userPersonas));
  });

  test('WorkspaceArchetypeMiner.inferDomain dynamically classifies diverse industry domains', () => {
    // E-Commerce
    const ecom = WorkspaceArchetypeMiner.inferDomain('/work/medusa-storefront', { name: 'medusa-shop', description: 'Headless commerce marketplace' });
    assert.strictEqual(ecom.domainName, 'E-Commerce');
    assert.strictEqual(ecom.isTaxSpecific, false);

    // Healthcare
    const health = WorkspaceArchetypeMiner.inferDomain('/work/health-clinic', { name: 'telehealth-platform', description: 'Patient records & care management' });
    assert.strictEqual(health.domainName, 'Healthcare');
    assert.strictEqual(health.isTaxSpecific, false);

    // Cardiac Healthcare
    const cardiac = WorkspaceArchetypeMiner.inferDomain('/work/cardio-vitals', { name: 'cardiac-telemetry', description: 'Real-time heart rhythm monitor' });
    assert.strictEqual(cardiac.domainName, 'Healthcare');
    assert.strictEqual(cardiac.isTaxSpecific, false);

    // Cybersecurity
    const security = WorkspaceArchetypeMiner.inferDomain('/work/zero-trust-guard', { name: 'siem-firewall', description: 'Identity vault and access proxy' });
    assert.strictEqual(security.domainName, 'Cybersecurity & Zero-Trust');
    assert.strictEqual(security.isTaxSpecific, false);

    // AI & Autonomous Systems
    const aiStack = WorkspaceArchetypeMiner.inferDomain('/work/agent-swarm', { name: 'agentic-pipeline', description: 'Multi-agent LLM reasoning pipeline' });
    assert.strictEqual(aiStack.domainName, 'AI & Autonomous Systems');
    assert.strictEqual(aiStack.isTaxSpecific, false);

    // Fintech
    const fintech = WorkspaceArchetypeMiner.inferDomain('/work/payflow', { name: 'payflow-gateway', description: 'Invoice & ledger bank payments' });
    assert.strictEqual(fintech.domainName, 'Fintech & Payments');
    assert.strictEqual(fintech.isTaxSpecific, false);

    // Tax
    const tax = WorkspaceArchetypeMiner.inferDomain('/work/TaxIQ-Australia', { name: 'advisorystack-monorepo', description: 'Australian tax deduction advisory' });
    assert.strictEqual(tax.domainName, 'Tax Advisory');
    assert.strictEqual(tax.isTaxSpecific, true);
  });

  test('BrownfieldSynthesizer synthesizes generic e-commerce topology with zero tax references', () => {
    const ecomArchetype = {
      archetypeId: 'monorepo-turborepo-nextjs',
      projectName: 'shopfast-monorepo',
      projectDescription: 'Next.js storefront',
      domainName: 'E-Commerce',
      isTaxSpecific: false,
      framework: 'Next.js 15 App Router + Turborepo',
      isMonorepo: true,
      packages: [
        { name: '@shopfast/storefront', relativePath: 'apps/storefront', role: 'ingress' as const, label: 'E-Commerce Portal & Application Ingress (storefront)', dependencies: [] },
        { name: '@shopfast/checkout', relativePath: 'packages/checkout', role: 'domain-engine' as const, label: 'E-Commerce Calculation & Rules Engine (checkout)', dependencies: [] }
      ],
      ingressRoutes: ['/order (Checkout Ingress)', '/cart'],
      userPersonas: ['Shopper / Customer', 'Store Operator / Merchant'],
      domainEngines: ['E-Commerce Calculation & Rules Engine (checkout)'],
      aiEngines: [],
      guardrails: [],
      externalConnectors: ['Stripe Payments & Billing', 'SendGrid Email API'],
      databaseType: 'PostgreSQL Database',
      primaryTables: ['orders', 'products', 'customers'],
      keyBottlenecks: ['Synchronous inventory reservation in checkout thread']
    };

    const res = BrownfieldSynthesizer.synthesize([], [], [], [], [], ecomArchetype);

    assert.ok(res.asIsMermaid.includes('Shopper / Customer'));
    assert.ok(res.asIsMermaid.includes('E-Commerce Portal & Application Ingress'));
    assert.ok(res.asIsMermaid.includes('orders, products, customers'));
    assert.ok(res.asIsMermaid.includes('Submit Order & Checkout'));
    // Crucial: No Australian Tax strings leaked
    assert.strictEqual(res.asIsMermaid.includes('Tax'), false);
    assert.strictEqual(res.asIsMermaid.includes('ATO'), false);
    assert.strictEqual(res.asIsMermaid.includes('TFN'), false);

    // Target state To-Be
    assert.ok(res.toBeMermaid.includes('Submit E-Commerce Request Payload'));
    assert.ok(res.toBeMermaid.includes('orders, products, customers'));
  });

  test('RepoSecurityScanner validates Shannon entropy and multi-jurisdiction PII checksums', () => {
    // 1. Shannon Entropy
    const lowEntropy = calculateShannonEntropy('aaaaaaaaaaaaaaaa');
    const highEntropy = calculateShannonEntropy('sk-proj-7xK89wLmPqRtZv23YnWbAcEf');
    assert.ok(lowEntropy < 1.0, `Low entropy string should be < 1.0, got ${lowEntropy}`);
    assert.ok(highEntropy > 3.8, `High entropy token should be > 3.8, got ${highEntropy}`);

    // 2. International Credit Card Luhn Algorithm
    // Valid standard test Visa: 4532 0151 1283 0366
    assert.strictEqual(validateLuhn('4532015112830366'), true);
    assert.strictEqual(validateLuhn('4532-0151-1283-0366'), true);
    // Invalid card
    assert.strictEqual(validateLuhn('4532015112830367'), false);

    // 3. Canadian SIN (Luhn check on 9 digits)
    // 046 454 286 is valid Canadian test SIN
    assert.strictEqual(validateCanadianSin('046454286'), true);
    assert.strictEqual(validateCanadianSin('046-454-286'), true);
    assert.strictEqual(validateCanadianSin('046454287'), false);

    // 4. Australian TFN (Modulo-11)
    // 123 456 782 is valid 9-digit test TFN, 12345677 is valid 8-digit test TFN
    assert.strictEqual(validateAustralianTfn('123456782'), true);
    assert.strictEqual(validateAustralianTfn('123 456 782'), true);
    assert.strictEqual(validateAustralianTfn('12345677'), true);
    assert.strictEqual(validateAustralianTfn('123456783'), false);

    // 5. UK NHS (Modulo-11)
    // 943 476 5919 is valid UK test NHS number
    assert.strictEqual(validateUkNhs('9434765919'), true);
    assert.strictEqual(validateUkNhs('943 476 5919'), true);
    assert.strictEqual(validateUkNhs('9434765918'), false);

    // 6. EU IBAN (ISO 13616 Modulo-97)
    // Standard valid German test IBAN
    assert.strictEqual(validateIban('DE89370400440532013000'), true);
    assert.strictEqual(validateIban('DE89 3704 0044 0532 0130 00'), true);
    assert.strictEqual(validateIban('DE89370400440532013001'), false);

    // 7. US SSN Pattern
    assert.strictEqual(validateUsSsn('123-45-6789'), true);
    assert.strictEqual(validateUsSsn('000-12-3456'), false); // 000 prefix invalid
    assert.strictEqual(validateUsSsn('666-12-3456'), false); // 666 prefix invalid
    assert.strictEqual(validateUsSsn('900-12-3456'), false); // 900+ prefix invalid
  });

  test('RepoSecurityScanner detects universal API keys, credentials, and SAST flaws', function () {
    this.timeout(15000);
    const report = RepoSecurityScanner.scan(path.resolve(__dirname, '../../../../'));
    assert.ok(report.timestamp > 0);
    assert.ok(report.scannedFilesCount > 0);
    assert.ok(report.score >= 0 && report.score <= 100);
    assert.ok(['A+', 'A', 'B', 'C', 'D', 'F'].includes(report.grade));
    assert.ok(Array.isArray(report.findings));
    assert.ok(typeof report.summary.critical === 'number');
    assert.ok(typeof report.summary.high === 'number');
    assert.ok(typeof report.summary.secretsCount === 'number');
    assert.ok(typeof report.summary.piiCount === 'number');
  });

  test('RepoSecurityScanner generates compliant Markdown audit report and handles remediation', () => {
    const mockReport = {
      timestamp: Date.now(),
      repoPath: '/mock/workspace/payments-app',
      score: 92,
      grade: 'A' as const,
      pass: true,
      findings: [
        {
          id: 'SEC-1',
          file: 'src/api/auth.ts',
          line: 42,
          severity: 'high' as const,
          category: 'secret' as const,
          jurisdiction: 'global' as const,
          title: 'Database URI with Plaintext Password',
          description: 'Hardcoded postgres password',
          maskedSnippet: 'postgres://admin:***REDACTED***@db.internal:5432/main',
          matchedRule: 'DATABASE_CONN_PASSWORD',
          complianceTag: 'CWE-798',
          remediation: 'Use environment variables',
          fixable: true
        }
      ],
      summary: {
        total: 1,
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        info: 0,
        secretsCount: 1,
        piiCount: 0,
        sastCount: 0,
        hygieneCount: 0
      },
      scannedFilesCount: 120,
      scanDurationMs: 45,
      missingGitignorePatterns: ['.env', '*.pem']
    };

    const md = RepoSecurityScanner.generateSecurityReportMarkdown(mockReport);
    assert.ok(md.includes('Enterprise Repository Security & Multi-Jurisdiction Compliance Report'));
    assert.ok(md.includes('**Overall Security Grade:** **A (92 / 100)**'));
    assert.ok(md.includes('Database URI with Plaintext Password'));
    assert.ok(md.includes('***REDACTED***'));
    assert.ok(md.includes('.env'));
    assert.ok(md.includes('*.pem'));
  });

  test('RepoSecurityScanner suppresses false positives in comments/placeholders and persists exceptions', () => {
    // 1. Comment & placeholder heuristics
    assert.strictEqual(RepoSecurityScanner.isCommentOrPlaceholder('// TFN numbers are 8 digits (e.g. 25123456)', 'src/tax.ts'), true);
    assert.strictEqual(RepoSecurityScanner.isCommentOrPlaceholder('/* mock tax file number */', 'src/tax.ts'), true);
    assert.strictEqual(RepoSecurityScanner.isCommentOrPlaceholder('<input placeholder="251234567" />', 'src/Form.tsx'), true);
    assert.strictEqual(RepoSecurityScanner.isCommentOrPlaceholder('const mockTfn = "123456782";', 'src/test.ts'), true);
    assert.strictEqual(RepoSecurityScanner.isCommentOrPlaceholder('const liveUserTfn = "123456782";', 'src/models/user.ts'), false);

    // 2. Trivial & sequential mock number exclusion
    assert.strictEqual(RepoSecurityScanner.isTrivialOrMockNumber('00000000'), true);
    assert.strictEqual(RepoSecurityScanner.isTrivialOrMockNumber('11111111'), true);
    assert.strictEqual(RepoSecurityScanner.isTrivialOrMockNumber('12345678'), true);
    assert.strictEqual(RepoSecurityScanner.isTrivialOrMockNumber('123456789'), true);
    assert.strictEqual(RepoSecurityScanner.isTrivialOrMockNumber('25123456'), false);

    // 3. Exception persistence
    const tempDir = path.resolve(__dirname, '../../../../out/test-temp-sec');
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch {}

    const ignoreRes = RepoSecurityScanner.ignoreFinding(tempDir, 'FINDING-123', {
      file: 'src/mock.ts',
      matchedRule: 'AU_TFN_MOD11',
      reason: 'Synthetic test vector'
    });
    assert.strictEqual(ignoreRes.success, true);
    assert.strictEqual(ignoreRes.totalIgnored, 1);

    const loaded = RepoSecurityScanner.loadExceptions(tempDir);
    assert.ok(loaded.has('FINDING-123'));
    assert.ok(loaded.has('src/mock.ts::AU_TFN_MOD11'));

    const unignoreRes = RepoSecurityScanner.unignoreFinding(tempDir, 'FINDING-123');
    assert.strictEqual(unignoreRes.success, true);
    assert.strictEqual(unignoreRes.totalIgnored, 0);

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test('RepoSecurityScanner generates multi-format executive reports (HTML, CSV, Script)', () => {
    const mockReport = {
      timestamp: Date.now(),
      repoPath: '/mock/workspace/payments-app',
      score: 95,
      grade: 'A+' as const,
      pass: true,
      findings: [
        {
          id: 'SEC-1',
          file: 'src/api/auth.ts',
          line: 42,
          severity: 'high' as const,
          category: 'secret' as const,
          jurisdiction: 'global' as const,
          title: 'Database URI with Plaintext Password',
          description: 'Hardcoded postgres password',
          maskedSnippet: 'postgres://admin:***REDACTED***@db.internal:5432/main',
          matchedRule: 'DATABASE_CONN_PASSWORD',
          complianceTag: 'CWE-798',
          remediation: 'Use environment variables',
          fixable: true,
          isIgnored: false
        }
      ],
      summary: {
        total: 1,
        active: 1,
        ignored: 0,
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        info: 0,
        secretsCount: 1,
        piiCount: 0,
        sastCount: 0,
        hygieneCount: 0
      },
      scannedFilesCount: 120,
      scanDurationMs: 45,
      missingGitignorePatterns: ['.env', '*.pem']
    };

    // 1. Executive HTML Report
    const html = RepoSecurityScanner.generateSecurityReportHtml(mockReport);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('Enterprise Security &amp; Compliance Audit'));
    assert.ok(html.includes('Executive Health Score: 95 / 100'));
    assert.ok(html.includes('Print / Save to PDF'));
    assert.ok(html.includes('@media print'));

    // 2. CSV Export for Jira
    const csv = RepoSecurityScanner.generateSecurityReportCsv(mockReport);
    assert.ok(csv.includes('Finding ID') && csv.includes('Severity') && csv.includes('Status'));
    assert.ok(csv.includes('SEC-1'));
    assert.ok(csv.includes('Database URI with Plaintext Password'));

    // 3. Automated Fix Script
    const shScript = RepoSecurityScanner.generateSecurityFixScript(mockReport, 'sh');
    assert.ok(shScript.includes('#!/bin/sh'));
    assert.ok(shScript.includes('echo ".env" >> .gitignore'));

    const psScript = RepoSecurityScanner.generateSecurityFixScript(mockReport, 'ps1');
    assert.ok(psScript.includes('Add-Content -Path .gitignore -Value ".env"'));
  });

  test('ProjectOrientationSynthesizer synthesizes instant onboarding briefing & 1-click runbook', () => {
    const brief = ProjectOrientationSynthesizer.synthesize(process.cwd());
    assert.ok(brief);
    assert.ok(brief.projectName);
    assert.ok(brief.domainName);
    assert.ok(brief.framework);
    assert.ok(Array.isArray(brief.languageStack) && brief.languageStack.length > 0);
    assert.ok(Array.isArray(brief.runbook) && brief.runbook.length > 0);
    assert.ok(Array.isArray(brief.keyFiles) && brief.keyFiles.length > 0);
    assert.ok(Array.isArray(brief.readinessChecks) && brief.readinessChecks.length > 0);

    // Verify Runbook categories
    const categories = brief.runbook.map(r => r.category);
    assert.ok(categories.includes('setup') || categories.includes('test') || categories.includes('run'));

    // Verify Topology Mermaid
    assert.ok(brief.topologyMermaid.includes('sequenceDiagram'));
    assert.ok(brief.callFlowSummary.length > 10);

    // Verify Guided Explanation
    assert.ok(brief.codebaseExplanation.executiveSummary.length > 10);
    assert.ok(brief.codebaseExplanation.architectureMentalModel.includes('Ingress'));
    assert.ok(brief.codebaseExplanation.howToExtendGuide.length > 10);
  });

  test('ProjectOrientationSynthesizer.toMarkdown generates complete ORIENTATION.md document', () => {
    const brief = ProjectOrientationSynthesizer.synthesize(process.cwd());
    const md = ProjectOrientationSynthesizer.toMarkdown(brief);

    assert.ok(md.includes('# 🧭 Project Orientation & Architecture Briefing'));
    assert.ok(md.includes('## ⚡ 1-Click Runbook'));
    assert.ok(md.includes('## 🛡️ Pre-Flight Environment Readiness'));
    assert.ok(md.includes('## 📂 Key Files & Entrypoints'));
    assert.ok(md.includes('```mermaid'));
    assert.ok(md.includes('## 🧠 Mental Model & How to Extend'));
  });

  test('ProjectOrientationSynthesizer generates domain-grounded topologies for FastAPI, PyTorch, and Next.js', () => {
    // 1. FastAPI
    const fastApiArchetype = {
      archetypeId: 'single-tier-service',
      projectName: 'fastapi-service',
      domainName: 'Fintech & Payments',
      isTaxSpecific: false,
      framework: 'Python FastAPI Async Microservice',
      isMonorepo: false,
      packages: [],
      ingressRoutes: ['/api/v1'],
      userPersonas: ['API Client'],
      domainEngines: ['Payment Ledger Engine'],
      aiEngines: [],
      guardrails: [],
      externalConnectors: ['Stripe Payments Gateway'],
      databaseType: 'PostgreSQL Database',
      primaryTables: ['transactions', 'ledgers'],
      keyBottlenecks: []
    };

    const fastApiBrief = ProjectOrientationSynthesizer.synthesize(process.cwd(), fastApiArchetype as any);
    assert.ok(fastApiBrief.topologyMermaid.includes('FastAPI Gateway'));
    assert.ok(fastApiBrief.topologyMermaid.includes('Stripe Payments Gateway'));

    // 2. PyTorch
    const pyTorchArchetype = {
      archetypeId: 'single-tier-service',
      projectName: 'vision-model',
      domainName: 'AI & Autonomous Systems',
      isTaxSpecific: false,
      framework: 'PyTorch Deep Learning',
      isMonorepo: false,
      packages: [],
      ingressRoutes: [],
      userPersonas: ['Data Scientist'],
      domainEngines: ['Backbone ResNet Engine'],
      aiEngines: ['PyTorch Model Architecture'],
      guardrails: [],
      externalConnectors: [],
      databaseType: 'Model Weights Store',
      primaryTables: [],
      keyBottlenecks: []
    };

    const pyTorchBrief = ProjectOrientationSynthesizer.synthesize(process.cwd(), pyTorchArchetype as any);
    assert.ok(pyTorchBrief.topologyMermaid.includes('PyTorch Neural Model'));
    assert.ok(pyTorchBrief.topologyMermaid.includes('Forward Pass'));

    // 3. Next.js
    const nextArchetype = {
      archetypeId: 'nextjs-fullstack',
      projectName: 'storefront-web',
      domainName: 'E-Commerce',
      isTaxSpecific: false,
      framework: 'Next.js 15 App Router',
      isMonorepo: false,
      packages: [],
      ingressRoutes: ['/checkout', '/products'],
      userPersonas: ['Shopper'],
      domainEngines: ['Order Cart Service'],
      aiEngines: [],
      guardrails: [],
      externalConnectors: ['Stripe Checkout'],
      databaseType: 'Prisma PostgreSQL',
      primaryTables: ['orders', 'users'],
      keyBottlenecks: []
    };

    const nextBrief = ProjectOrientationSynthesizer.synthesize(process.cwd(), nextArchetype as any);
    assert.ok(nextBrief.topologyMermaid.includes('Next.js App Router'));
    assert.ok(nextBrief.topologyMermaid.includes('Server Actions'));

    // 4. Django Repository
    const djangoArchetype = {
      archetypeId: 'single-tier-service',
      projectName: 'django-webapp',
      domainName: 'Web Platform',
      isTaxSpecific: false,
      framework: 'Python Django Web Platform',
      isMonorepo: false,
      packages: [],
      ingressRoutes: ['/ (Django Views & URL Patterns)', '/admin/ (Django Admin Ingress)'],
      userPersonas: ['Web Client / Django Admin'],
      domainEngines: ['Django Views & Handlers'],
      aiEngines: [],
      guardrails: [],
      externalConnectors: [],
      databaseType: 'SQLite / PostgreSQL (Django ORM)',
      primaryTables: ['auth_user', 'django_session'],
      keyBottlenecks: []
    };

    const djangoBrief = ProjectOrientationSynthesizer.synthesize(process.cwd(), djangoArchetype as any);
    assert.strictEqual(djangoBrief.framework, 'Python Django Web Platform');
    assert.strictEqual(djangoBrief.databaseType, 'SQLite / PostgreSQL (Django ORM)');

    // Verify Runbook commands include Django commands
    const runbookCmds = djangoBrief.runbook.map(c => c.command);
    assert.ok(runbookCmds.some(c => c.includes('pytest') || c.includes('manage.py')), 'Expected test runner in runbook');
    assert.ok(runbookCmds.some(c => c.includes('pip install')), 'Expected pip install setup in runbook');
  });

  test('ProjectOrientationSynthesizer discovers .env.local and passes readiness without requiring .env', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-env-test-'));
    try {
      // Setup repo with .env.example template and .env.local active file
      fs.writeFileSync(path.join(tempDir, '.env.example'), 'DATABASE_URL=postgres://...\n', 'utf8');
      fs.writeFileSync(path.join(tempDir, '.env.local'), 'DATABASE_URL=postgres://localhost:5432/dev\n', 'utf8');
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"test-repo"}', 'utf8');

      const brief = ProjectOrientationSynthesizer.synthesize(tempDir);
      assert.ok(brief);

      const envCheck = brief.readinessChecks.find(c => c.id === 'env-present');
      assert.ok(envCheck, 'Expected env-present check item when .env.local exists');
      assert.strictEqual(envCheck.passed, true);
      assert.ok(envCheck.title.includes('.env.local'));
      assert.ok(envCheck.details.includes('.env.local'));

      // Ensure no blocker was created
      const envMissingCheck = brief.readinessChecks.find(c => c.id === 'env-missing');
      assert.strictEqual(envMissingCheck, undefined, 'Should not report missing .env when .env.local exists');

      // Key files should include .env.local
      assert.ok(brief.keyFiles.some(f => f.path === '.env.local'));
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('ProjectOrientationSynthesizer discovers .env.local inside monorepo app subdirectories', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-monorepo-env-test-'));
    try {
      // Setup Turborepo-like structure: root has .env.example, apps/web has .env.local
      fs.writeFileSync(path.join(tempDir, '.env.example'), 'NEXT_PUBLIC_API_URL=\n', 'utf8');
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"monorepo"}', 'utf8');
      fs.mkdirSync(path.join(tempDir, 'apps', 'web'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'apps', 'web', '.env.local'), 'NEXT_PUBLIC_API_URL=http://localhost:3000\n', 'utf8');

      const brief = ProjectOrientationSynthesizer.synthesize(tempDir);
      assert.ok(brief);

      const envCheck = brief.readinessChecks.find(c => c.id === 'env-present');
      assert.ok(envCheck, 'Expected env-present check item when apps/web/.env.local exists');
      assert.strictEqual(envCheck.passed, true);
      assert.ok(envCheck.details.includes('apps/web/.env.local'));

      // Ensure no blocker was created
      const envMissingCheck = brief.readinessChecks.find(c => c.id === 'env-missing');
      assert.strictEqual(envMissingCheck, undefined, 'Should not report missing env for monorepo when workspace has .env.local');

      // Key files should include the workspace env file
      assert.ok(brief.keyFiles.some(f => f.path === 'apps/web/.env.local'));
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('ProjectOrientationSynthesizer correctly flags missing environment file when only template exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-missing-env-test-'));
    try {
      fs.writeFileSync(path.join(tempDir, '.env.example'), 'API_KEY=\n', 'utf8');
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"test-repo"}', 'utf8');

      const brief = ProjectOrientationSynthesizer.synthesize(tempDir);
      assert.ok(brief);

      const envMissingCheck = brief.readinessChecks.find(c => c.id === 'env-missing');
      assert.ok(envMissingCheck, 'Expected env-missing check item when only template exists');
      assert.strictEqual(envMissingCheck.passed, false);
      assert.strictEqual(envMissingCheck.severity, 'blocker');
      assert.ok(envMissingCheck.remedyCommand);
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
});
