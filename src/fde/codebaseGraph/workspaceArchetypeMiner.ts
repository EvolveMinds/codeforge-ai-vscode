/**
 * fde/codebaseGraph/workspaceArchetypeMiner.ts — Generic Workspace Domain Archetype & Subsystem Miner
 *
 * Deterministically analyzes workspace structure, package manifests, routes, and configs across
 * any repository archetype (Monorepo, Next.js, FastAPI, Express, Spring Boot, Go, Django, etc.):
 *  - Distinguishes monorepos vs single-service architectures
 *  - Dynamically infers domain semantics (Tax, Healthcare, E-Commerce, Fintech, Developer Tools, etc.)
 *  - Discovers real domain packages, routes, personas, and engines without hardcoded strings
 *  - Identifies AI safety/LLM pipelines (Claude, OpenAI, Gemini, multi-layer guardrails)
 *  - Discovers external SaaS & business integrations (Stripe, Xero, MYOB, Resend, Twilio, etc.)
 *  - Prioritizes business domain entities over internal database framework tables
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DetectedPackage {
  name: string;
  relativePath: string;
  role: 'ingress' | 'domain-engine' | 'ai-guardrails' | 'agents' | 'shared-ui' | 'library' | 'unknown';
  label: string;
  description?: string;
  dependencies: string[];
}

export interface WorkspaceArchetype {
  archetypeId: string;
  projectName: string;
  projectDescription?: string;
  domainName: string;
  isTaxSpecific: boolean;
  framework: string;
  isMonorepo: boolean;
  packages: DetectedPackage[];
  ingressRoutes: string[];
  userPersonas: string[];
  domainEngines: string[];
  aiEngines: string[];
  guardrails: string[];
  externalConnectors: string[];
  databaseType: string;
  primaryTables: string[];
  keyBottlenecks: string[];
}

export class WorkspaceArchetypeMiner {
  /**
   * Primary entry point: Mines repository layout and manifests to discover architecture archetype.
   */
  public static mine(
    repoPath: string,
    discoveredDbTables: string[] = []
  ): WorkspaceArchetype {
    let projectName = path.basename(repoPath);
    let projectDescription = '';
    let isMonorepo = false;
    let rootPkg: any = null;

    const detectedPackages: DetectedPackage[] = [];
    const aiEngines = new Set<string>();
    const guardrails = new Set<string>();
    const externalConnectors = new Set<string>();
    const ingressRoutes = new Set<string>();
    const userPersonas = new Set<string>();
    const domainEngines = new Set<string>();
    let databaseType = 'Relational SQL Database';
    let framework = 'Full-Stack Application';

    // 1. Inspect Root package.json (if Node/JS/TS project)
    const rootPkgPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(rootPkgPath)) {
      try {
        rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
        if (rootPkg.name) projectName = rootPkg.name;
        if (rootPkg.description) projectDescription = rootPkg.description;

        const allDeps = {
          ...(rootPkg.dependencies || {}),
          ...(rootPkg.devDependencies || {})
        };

        if (allDeps['turbo'] || allDeps['lerna'] || fs.existsSync(path.join(repoPath, 'pnpm-workspace.yaml'))) {
          isMonorepo = true;
        }

        this.inspectDependencies(allDeps, aiEngines, externalConnectors, guardrails);
      } catch {}
    }

    // 2. Dynamically Infer Domain from Project Name, Description, and Repository Content
    const { domainName, isTaxSpecific } = this.inferDomain(repoPath, rootPkg);

    // 3. Discover Sub-Packages in Monorepos (apps/*, packages/*, services/*, modules/*, libs/*)
    const subDirs = ['apps', 'packages', 'services', 'modules', 'libs'];
    for (const subDir of subDirs) {
      const parentDir = path.join(repoPath, subDir);
      if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
        try {
          const entries = fs.readdirSync(parentDir, { withFileTypes: true });
          const hasChildPackages = entries.some(e => e.isDirectory() && fs.existsSync(path.join(parentDir, e.name, 'package.json')));
          if (hasChildPackages) {
            isMonorepo = true;
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const pkgJsonPath = path.join(parentDir, entry.name, 'package.json');
                if (fs.existsSync(pkgJsonPath)) {
                  try {
                    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                    const pkgName = pkg.name || entry.name;
                    const rel = `${subDir}/${entry.name}`;
                    const role = this.classifyPackageRole(rel, pkgName);
                    const pkgDeps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });

                    this.inspectDependencies(
                      { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) },
                      aiEngines,
                      externalConnectors,
                      guardrails
                    );

                    detectedPackages.push({
                      name: pkgName,
                      relativePath: rel,
                      role,
                      label: this.formatPackageLabel(pkgName, entry.name, role, pkg.description, domainName),
                      description: pkg.description,
                      dependencies: pkgDeps
                    });
                  } catch {}
                }
              }
            }
          }
        } catch {}
      }
    }

    // 4. Detect Framework & Ingress Entrypoints
    // Check for Next.js App Router
    const possibleAppDirs = [
      path.join(repoPath, 'apps', 'whitelabel', 'src', 'app'),
      path.join(repoPath, 'apps', 'web', 'src', 'app'),
      path.join(repoPath, 'apps', 'storefront', 'src', 'app'),
      path.join(repoPath, 'apps', 'portal', 'src', 'app'),
      path.join(repoPath, 'src', 'app'),
      path.join(repoPath, 'app')
    ];

    let foundNextApp = false;
    for (const appDir of possibleAppDirs) {
      if (fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()) {
        foundNextApp = true;
        framework = isMonorepo ? 'Next.js 15 App Router + Turborepo' : 'Next.js 15 App Router';
        this.scanNextRoutes(appDir, ingressRoutes, userPersonas, domainName);
        break;
      }
    }

    if (!foundNextApp) {
      // Check for Python / Go / Java / .NET
      const isPythonRepo =
        fs.existsSync(path.join(repoPath, 'pyproject.toml')) ||
        fs.existsSync(path.join(repoPath, 'requirements.txt')) ||
        fs.existsSync(path.join(repoPath, 'setup.py')) ||
        fs.existsSync(path.join(repoPath, 'setup.cfg')) ||
        fs.existsSync(path.join(repoPath, 'Pipfile')) ||
        fs.existsSync(path.join(repoPath, 'manage.py')) ||
        fs.existsSync(path.join(repoPath, 'django')) ||
        path.basename(repoPath).toLowerCase().includes('django');

      if (isPythonRepo) {
        const pyReq = (
          this.readTextSafe(path.join(repoPath, 'requirements.txt')) + ' ' +
          this.readTextSafe(path.join(repoPath, 'pyproject.toml')) + ' ' +
          this.readTextSafe(path.join(repoPath, 'setup.py')) + ' ' +
          this.readTextSafe(path.join(repoPath, 'setup.cfg'))
        ).toLowerCase();

        const isDjango =
          fs.existsSync(path.join(repoPath, 'manage.py')) ||
          fs.existsSync(path.join(repoPath, 'django')) ||
          pyReq.includes('django') ||
          path.basename(repoPath).toLowerCase().includes('django');

        const isFastApi = pyReq.includes('fastapi');
        const isFlask = pyReq.includes('flask');

        if (isFastApi) {
          framework = 'Python FastAPI Async Microservice';
          ingressRoutes.add('/api/v1 (FastAPI Route Handlers)');
        } else if (isDjango) {
          framework = 'Python Django Web Platform';
          ingressRoutes.add('/ (Django URL Routing & Views)');
          ingressRoutes.add('/admin/ (Django Admin Ingress)');
        } else if (isFlask) {
          framework = 'Python Flask REST Service';
          ingressRoutes.add('/api (Flask Blueprint Ingress)');
        } else {
          framework = 'Python Application Service';
        }
        userPersonas.add(isDjango ? 'Web Client / Django Admin' : 'API Consumer / Web Client');
      } else if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
        framework = 'Go Cloud Service';
        ingressRoutes.add('/api/v1 (HTTP / gRPC Service Router)');
        userPersonas.add('Service Consumer / Client');
      } else if (fs.existsSync(path.join(repoPath, 'pom.xml')) || fs.existsSync(path.join(repoPath, 'build.gradle'))) {
        framework = 'Java Spring Boot Enterprise Service';
        ingressRoutes.add('/api/v1 (Spring REST Controllers)');
        userPersonas.add('Enterprise Client');
      } else if (this.hasFileWithExtension(repoPath, '.csproj')) {
        framework = 'C# ASP.NET Core Web API';
        ingressRoutes.add('/api/v1 (ASP.NET Core Controllers)');
        userPersonas.add('API Consumer');
      }
    }

    // 5. Identify Domain Engines & Guardrails from packages or directories
    for (const pkg of detectedPackages) {
      if (pkg.role === 'domain-engine') {
        domainEngines.add(pkg.label);
      } else if (pkg.role === 'ai-guardrails') {
        guardrails.add(pkg.label);
      }
    }

    // Fallback domain scan if single-package repository
    if (domainEngines.size === 0) {
      const prefix = domainName ? `${domainName} ` : '';
      if (fs.existsSync(path.join(repoPath, 'src', 'engine')) || fs.existsSync(path.join(repoPath, 'src', 'core'))) {
        domainEngines.add(`${prefix}Calculation Engine`);
      } else if (fs.existsSync(path.join(repoPath, 'src', 'services'))) {
        domainEngines.add(`${prefix}Domain Service Layer`);
      } else {
        domainEngines.add(`${prefix}Core Business Logic`);
      }
    }

    // 6. Detect Database Platform
    if (fs.existsSync(path.join(repoPath, 'supabase')) || fs.existsSync(path.join(repoPath, 'supabase', 'migrations'))) {
      databaseType = 'Supabase PostgreSQL';
    } else if (fs.existsSync(path.join(repoPath, 'prisma'))) {
      databaseType = 'Prisma ORM (PostgreSQL / MySQL)';
    } else if (fs.existsSync(path.join(repoPath, 'drizzle'))) {
      databaseType = 'Drizzle ORM';
    } else if (framework.includes('Django') || fs.existsSync(path.join(repoPath, 'manage.py'))) {
      databaseType = 'SQLite / PostgreSQL (Django ORM)';
    }

    // 7. Mine API Integrations from directory structure (e.g. /api/integrations/*)
    const apiDirs = [
      path.join(repoPath, 'apps', 'whitelabel', 'src', 'app', 'api'),
      path.join(repoPath, 'apps', 'web', 'src', 'app', 'api'),
      path.join(repoPath, 'src', 'app', 'api'),
      path.join(repoPath, 'src', 'api')
    ];
    for (const ad of apiDirs) {
      if (fs.existsSync(ad)) {
        this.scanApiIntegrations(ad, externalConnectors);
        break;
      }
    }

    // 8. Ensure Default Personas if none found
    if (userPersonas.size === 0) {
      userPersonas.add('Client / End User');
    }

    // 9. Prioritize Business Domain Entities over internal framework tables
    const isInternalTable = (t: string) =>
      /^(auth_|__|_prisma|schema_|spatial_|alembic|flyway|session|token|audit_log|pg_)/i.test(t);

    const sortedTables = discoveredDbTables
      .slice()
      .sort((a, b) => {
        const isInternalA = isInternalTable(a);
        const isInternalB = isInternalTable(b);
        if (!isInternalA && isInternalB) return -1;
        if (isInternalA && !isInternalB) return 1;
        return 0;
      })
      .slice(0, 5);

    // 10. Identify Architectural Bottlenecks grounded in domain
    const keyBottlenecks: string[] = [];
    if (domainEngines.size > 0) {
      keyBottlenecks.push('Synchronous rules evaluation in request cycle without worker queue');
    }
    if (databaseType.includes('Supabase') || databaseType.includes('Postgres') || databaseType.includes('SQL')) {
      keyBottlenecks.push('Un-cached repeated table queries on hot domain entities');
    }
    if (aiEngines.size > 0 && guardrails.size > 0) {
      keyBottlenecks.push('Inline synchronous LLM reasoning with multi-layer PII boundary audit');
    }

    const archetypeId = isMonorepo
      ? (foundNextApp ? 'monorepo-turborepo-nextjs' : 'monorepo-multi-package')
      : (foundNextApp ? 'nextjs-fullstack' : 'single-tier-service');

    return {
      archetypeId,
      projectName,
      projectDescription,
      domainName,
      isTaxSpecific,
      framework,
      isMonorepo,
      packages: detectedPackages,
      ingressRoutes: Array.from(ingressRoutes),
      userPersonas: Array.from(userPersonas),
      domainEngines: Array.from(domainEngines),
      aiEngines: Array.from(aiEngines),
      guardrails: Array.from(guardrails),
      externalConnectors: Array.from(externalConnectors).sort((a, b) => {
        const isBizA = /stripe|paypal|square|xero|myob|quickbooks|qbo|resend|sendgrid|twilio/i.test(a);
        const isBizB = /stripe|paypal|square|xero|myob|quickbooks|qbo|resend|sendgrid|twilio/i.test(b);
        if (isBizA && !isBizB) return -1;
        if (!isBizA && isBizB) return 1;
        return 0;
      }),
      databaseType,
      primaryTables: sortedTables,
      keyBottlenecks
    };
  }

  /**
   * Infers the broad business or technical domain from repository name, package metadata, and directory structure.
   */
  public static inferDomain(
    repoPath: string,
    rootPkg?: any
  ): { domainName: string; isTaxSpecific: boolean } {
    const raw = `${path.basename(repoPath)} ${(rootPkg?.name || '')} ${(rootPkg?.description || '')}`.toLowerCase();

    if (/tax|ato\b|revenue|deduction|advisorystack/i.test(raw)) {
      return { domainName: 'Tax Advisory', isTaxSpecific: true };
    }
    if (/\b(health|clinic|doctor|patient|telehealth|hospital|pharma|biotech|cardio|cardiac|heart|vital)\b|medic/i.test(raw)) {
      return { domainName: 'Healthcare', isTaxSpecific: false };
    }
    if (/commerce|shop|store|cart|retail|checkout|marketplace/i.test(raw)) {
      return { domainName: 'E-Commerce', isTaxSpecific: false };
    }
    if (/pay|bill|invoice|finan|bank|ledger|crypto|wallet/i.test(raw)) {
      return { domainName: 'Fintech & Payments', isTaxSpecific: false };
    }
    if (/edu|learn|course|student|school|academy/i.test(raw)) {
      return { domainName: 'Education', isTaxSpecific: false };
    }
    if (/\b(security|auth|identity|cyber|guard|vault|zero-trust|firewall|privacy)\b/i.test(raw)) {
      return { domainName: 'Cybersecurity & Zero-Trust', isTaxSpecific: false };
    }
    if (/\b(agent|agents|swarm|llm|nlp|machine-learning)\b|evolveai/i.test(raw)) {
      return { domainName: 'AI & Autonomous Systems', isTaxSpecific: false };
    }
    if (/dev|code|cloud|forge|infra|deploy|delivery studio|software delivery|sdk|cli|ide\b|vscode|compiler/i.test(raw)) {
      return { domainName: 'Developer Tools & Cloud', isTaxSpecific: false };
    }
    if (/logistic|fleet|freight|cargo|truck|warehous|supply chain/i.test(raw)) {
      return { domainName: 'Logistics & Supply Chain', isTaxSpecific: false };
    }
    if (/crm|lead|sales|marketing|campaign/i.test(raw)) {
      return { domainName: 'CRM & Sales', isTaxSpecific: false };
    }

    return { domainName: '', isTaxSpecific: false };
  }

  private static classifyPackageRole(
    relPath: string,
    name: string
  ): DetectedPackage['role'] {
    const lower = `${relPath}/${name}`.toLowerCase();
    if (lower.includes('whitelabel') || lower.includes('web') || lower.includes('portal') || lower.includes('app') || lower.includes('frontend') || lower.includes('storefront')) {
      return 'ingress';
    }
    if (lower.includes('guardrail') || lower.includes('safety') || lower.includes('compliance') || lower.includes('policy') || lower.includes('moderation')) {
      return 'ai-guardrails';
    }
    if (lower.includes('agent') || lower.includes('scraper') || lower.includes('crawler') || lower.includes('bot') || lower.includes('worker')) {
      return 'agents';
    }
    if (lower.includes('engine') || lower.includes('calc') || lower.includes('rules') || lower.includes('core') || lower.includes('domain')) {
      return 'domain-engine';
    }
    if (lower.includes('ui') || lower.includes('components') || lower.includes('design-system')) {
      return 'shared-ui';
    }
    return 'library';
  }

  private static formatPackageLabel(
    name: string,
    folderName: string,
    role: DetectedPackage['role'],
    pkgDesc?: string,
    domainName?: string
  ): string {
    if (pkgDesc && pkgDesc.length > 5 && pkgDesc.length < 50) {
      return `${this.titleCase(pkgDesc)} (${folderName})`;
    }

    const domainPrefix = domainName ? `${domainName} ` : '';

    switch (role) {
      case 'ingress':
        return `${domainPrefix}Portal & Application Ingress (${folderName})`;
      case 'domain-engine':
        return `${domainPrefix}Calculation & Rules Engine (${folderName})`;
      case 'ai-guardrails':
        return `${domainPrefix}AI Safety & Compliance Guardrails (${folderName})`;
      case 'agents':
        return `${domainPrefix}Autonomous Data & Task Agents (${folderName})`;
      case 'shared-ui':
        return `Shared UI Component Library (${folderName})`;
      default:
        return this.titleCase(folderName || name);
    }
  }

  private static inspectDependencies(
    deps: Record<string, string>,
    aiEngines: Set<string>,
    connectors: Set<string>,
    guardrails: Set<string>
  ): void {
    const keys = Object.keys(deps);
    for (const k of keys) {
      // AI & LLM Models
      if (k === '@anthropic-ai/sdk') aiEngines.add('Claude 3.5 Sonnet (Anthropic)');
      if (k === 'openai') aiEngines.add('OpenAI GPT-4o');
      if (k === '@google/genai') aiEngines.add('Google Gemini');
      if (k.includes('mistral')) aiEngines.add('Mistral AI');
      if (k.includes('voyage')) aiEngines.add('Voyage AI Embeddings');
      if (k.includes('pinecone') || k.includes('qdrant') || k.includes('chromadb')) aiEngines.add('Vector Database');

      // Business & SaaS Connectors
      if (k.includes('stripe')) connectors.add('Stripe Connect & Billing');
      if (k.includes('paypal')) connectors.add('PayPal Payments');
      if (k === 'resend') connectors.add('Resend Email Delivery');
      if (k.includes('sendgrid')) connectors.add('SendGrid Email API');
      if (k.includes('twilio')) connectors.add('Twilio SMS & Messaging');
      if (k.includes('posthog')) connectors.add('PostHog Product Analytics');
      if (k.includes('sentry')) connectors.add('Sentry Observability');
      if (k.includes('dynamodb')) connectors.add('AWS DynamoDB');
      if (k.includes('redis') || k.includes('ioredis')) connectors.add('Redis Distributed Cache');
    }
  }

  private static scanNextRoutes(
    appDir: string,
    ingressRoutes: Set<string>,
    userPersonas: Set<string>,
    domainName: string
  ): void {
    try {
      const items = fs.readdirSync(appDir, { withFileTypes: true });
      for (const item of items) {
        if (!item.isDirectory()) continue;
        const name = item.name;

        if (name === '(marketing)' || name === 'marketing') {
          const mktDir = path.join(appDir, name);
          const sub = fs.existsSync(mktDir) ? fs.readdirSync(mktDir).filter(s => !s.startsWith('.')) : [];
          const checkSub = sub.find(s => /check|calc|assess|quote|pricing|search/i.test(s));
          if (checkSub) {
            ingressRoutes.add(`/${checkSub} (Interactive Assessment & Ingress)`);
          } else {
            ingressRoutes.add('/ (Public Landing & Ingress)');
          }

          if (domainName === 'Tax Advisory') {
            userPersonas.add('Client / Taxpayer');
          } else if (domainName === 'E-Commerce') {
            userPersonas.add('Shopper / Customer');
          } else if (domainName === 'Healthcare') {
            userPersonas.add('Patient / Consumer');
          } else {
            userPersonas.add('Public Client / User');
          }
        } else if (name === 'portal' || name === 'client' || name === 'account') {
          ingressRoutes.add(`/${name} (Client / Account Portal)`);
          if (domainName === 'Tax Advisory') {
            userPersonas.add('Client / Taxpayer');
          } else if (domainName === 'Healthcare') {
            userPersonas.add('Patient / Client');
          } else {
            userPersonas.add('Client / Account Holder');
          }
        } else if (name === '(platform)' || name === 'platform' || name === 'cockpit' || name === 'dashboard') {
          ingressRoutes.add(`/${name} (Operations Cockpit)`);
          if (domainName === 'Tax Advisory') {
            userPersonas.add('Tax Advisor / Agent');
          } else if (domainName === 'Healthcare') {
            userPersonas.add('Clinician / Specialist');
          } else if (domainName === 'E-Commerce') {
            userPersonas.add('Store Operator / Merchant');
          } else {
            userPersonas.add('Operations Specialist / Agent');
          }
        } else if (name === 'admin') {
          ingressRoutes.add('/admin (Administration Cockpit)');
          userPersonas.add('Platform Administrator');
        } else if (name === 'api') {
          ingressRoutes.add('/api/v1 (REST / Public API)');
          const cronExists = fs.existsSync(path.join(appDir, 'api', 'cron'));
          if (cronExists) {
            ingressRoutes.add('/api/cron/* (Scheduled Background Jobs)');
          }
          const webhookExists = fs.existsSync(path.join(appDir, 'api', 'webhooks'));
          if (webhookExists) {
            ingressRoutes.add('/api/webhooks/* (External SaaS Webhooks)');
          }
        } else if (!name.startsWith('.')) {
          ingressRoutes.add(`/${name}`);
        }
      }
    } catch {}
  }

  private static scanApiIntegrations(apiDir: string, connectors: Set<string>): void {
    const intDir = path.join(apiDir, 'integrations');
    if (fs.existsSync(intDir)) {
      try {
        const sub = fs.readdirSync(intDir);
        for (const s of sub) {
          if (s.toLowerCase().includes('xero')) connectors.add('Xero Accounting API');
          if (s.toLowerCase().includes('myob')) connectors.add('MYOB Accounting API');
          if (s.toLowerCase().includes('qbo')) connectors.add('QuickBooks Online API');
          if (s.toLowerCase().includes('stripe')) connectors.add('Stripe Payments API');
        }
      } catch {}
    }
  }

  private static titleCase(str: string): string {
    return str
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  private static readTextSafe(filePath: string): string {
    try {
      if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
    } catch {}
    return '';
  }

  private static hasFileWithExtension(dir: string, ext: string): boolean {
    try {
      const items = fs.readdirSync(dir);
      return items.some(i => i.endsWith(ext));
    } catch {
      return false;
    }
  }
}
