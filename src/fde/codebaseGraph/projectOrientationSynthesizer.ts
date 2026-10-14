/**
 * fde/codebaseGraph/projectOrientationSynthesizer.ts — Project Orientation & Architecture Onboarding Cockpit
 *
 * Automatically inspects any downloaded/cloned Git repository (Python, TypeScript, Go, Rust, Java, polyglot)
 * and synthesizes an instant interactive onboarding cockpit for developers:
 *  1. Executive Briefing & Domain Classification
 *  2. 1-Click "How to Run & Test" Runbook (Setup, Dev, Test, Build, Docker)
 *  3. Key Files & Entrypoints Directory (with 1-click jump/open)
 *  4. Pre-Flight Environment Readiness Checklist (.env, .venv, node_modules, git health)
 *  5. Subsystem Architecture Map & Call Flow Topology (Interactive Mermaid/SVG)
 *  6. Guided "Explain This Codebase" Orientation Tour (Mental model, Request lifecycle, How to extend)
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceArchetype, WorkspaceArchetypeMiner } from './workspaceArchetypeMiner';

export interface ProjectRunbookCommand {
  id: string;
  category: 'setup' | 'run' | 'test' | 'build' | 'docker';
  label: string;
  command: string;
  explanation: string;
  isDefault?: boolean;
}

export interface KeyFileEntry {
  path: string;
  name: string;
  type: 'entrypoint' | 'config' | 'schema' | 'doc' | 'test';
  label: string;
  description: string;
  exists: boolean;
}

export interface ReadinessCheckItem {
  id: string;
  title: string;
  passed: boolean;
  severity: 'blocker' | 'warning' | 'info';
  details: string;
  remedyCommand?: string;
}

export interface ProjectOrientationBrief {
  projectName: string;
  projectDescription: string;
  domainName: string;
  framework: string;
  architectureType: string;
  isMonorepo: boolean;
  languageStack: { language: string; version?: string }[];
  databaseType: string;
  externalConnectors: string[];
  aiEngines: string[];
  guardrails: string[];
  ingressRoutes: string[];
  primaryEntities: string[];

  // Architectural Topology
  topologyMermaid: string;
  callFlowSummary: string;

  // 1-Click Runbook
  runbook: ProjectRunbookCommand[];

  // Key Entrypoints & Structure
  keyFiles: KeyFileEntry[];

  // Pre-flight Readiness Checklist
  readinessChecks: ReadinessCheckItem[];

  // Guided "Explain This Codebase" Overview
  codebaseExplanation: {
    executiveSummary: string;
    architectureMentalModel: string;
    requestLifecycle: string;
    howToExtendGuide: string;
    conventionsAndPitfalls: string;
  };
}

export class ProjectOrientationSynthesizer {
  /**
   * Synthesizes full developer orientation and architecture briefing for a repository.
   */
  public static synthesize(
    repoPath: string,
    existingArchetype?: WorkspaceArchetype
  ): ProjectOrientationBrief {
    const archetype = existingArchetype || WorkspaceArchetypeMiner.mine(repoPath);
    const projectName = archetype.projectName || path.basename(repoPath);
    const projectDescription = archetype.projectDescription || this.readReadmeDescription(repoPath) || `${archetype.domainName || 'Software'} application`;
    const domainName = archetype.domainName || 'General Application Service';
    const isMonorepo = archetype.isMonorepo;

    // 1. Detect language stack & manifests
    const languageStack = this.detectLanguageStack(repoPath);

    // 2. Discover runbook commands
    const runbook = this.discoverRunbook(repoPath, archetype, languageStack);

    // 3. Discover key entrypoints and files
    const keyFiles = this.discoverKeyFiles(repoPath, archetype);

    // 4. Run pre-flight environment readiness checklist
    const readinessChecks = this.auditReadiness(repoPath, languageStack, runbook);

    // 5. Generate Architecture Topology Diagram (Mermaid Sequence)
    const { topologyMermaid, callFlowSummary } = this.generateTopology(archetype);

    // 6. Generate Guided Codebase Explanation
    const codebaseExplanation = this.generateExplanation(
      projectName,
      domainName,
      archetype.framework,
      isMonorepo ? 'Monorepo Subsystem' : 'Single Service Architecture',
      keyFiles,
      archetype,
      runbook
    );

    return {
      projectName,
      projectDescription,
      domainName,
      framework: archetype.framework,
      architectureType: isMonorepo ? 'Modular Monorepo Architecture' : 'Single Tier / Service Architecture',
      isMonorepo,
      languageStack,
      databaseType: archetype.databaseType,
      externalConnectors: archetype.externalConnectors,
      aiEngines: archetype.aiEngines,
      guardrails: archetype.guardrails,
      ingressRoutes: archetype.ingressRoutes,
      primaryEntities: archetype.primaryTables,
      topologyMermaid,
      callFlowSummary,
      runbook,
      keyFiles,
      readinessChecks,
      codebaseExplanation
    };
  }

  /**
   * Detects programming languages and versions from lockfiles and manifests.
   */
  private static detectLanguageStack(repoPath: string): { language: string; version?: string }[] {
    const stack: { language: string; version?: string }[] = [];

    // Python
    if (
      fs.existsSync(path.join(repoPath, 'pyproject.toml')) ||
      fs.existsSync(path.join(repoPath, 'requirements.txt')) ||
      fs.existsSync(path.join(repoPath, 'Pipfile')) ||
      fs.existsSync(path.join(repoPath, 'setup.py'))
    ) {
      let pyVer: string | undefined;
      const pyVerFile = path.join(repoPath, '.python-version');
      if (fs.existsSync(pyVerFile)) {
        try { pyVer = fs.readFileSync(pyVerFile, 'utf8').trim(); } catch {}
      }
      stack.push({ language: 'Python', version: pyVer || '3.11+' });
    }

    // TypeScript / JavaScript
    const pkgPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      let nodeVer: string | undefined;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.engines?.node) nodeVer = pkg.engines.node;
      } catch {}
      const hasTs = fs.existsSync(path.join(repoPath, 'tsconfig.json'));
      stack.push({
        language: hasTs ? 'TypeScript' : 'JavaScript (Node.js)',
        version: nodeVer || '20+ LTS'
      });
    }

    // Go
    const goModPath = path.join(repoPath, 'go.mod');
    if (fs.existsSync(goModPath)) {
      let goVer: string | undefined;
      try {
        const mod = fs.readFileSync(goModPath, 'utf8');
        const m = mod.match(/^go\s+([0-9.]+)/m);
        if (m) goVer = m[1];
      } catch {}
      stack.push({ language: 'Go', version: goVer || '1.21+' });
    }

    // Rust
    if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) {
      stack.push({ language: 'Rust', version: 'Edition 2021+' });
    }

    // Java
    if (fs.existsSync(path.join(repoPath, 'pom.xml')) || fs.existsSync(path.join(repoPath, 'build.gradle'))) {
      stack.push({ language: 'Java', version: 'OpenJDK 17 / 21' });
    }

    // C# / .NET
    if (fs.existsSync(path.join(repoPath, 'global.json')) || this.hasExt(repoPath, '.csproj')) {
      stack.push({ language: 'C# / .NET', version: '.NET 8 / 9' });
    }

    return stack.length > 0 ? stack : [{ language: 'Polyglot / Generic Source', version: 'Native' }];
  }

  /**
   * Discovers executable runbook commands for setup, dev run, test, build, and containers.
   */
  private static discoverRunbook(
    repoPath: string,
    archetype: WorkspaceArchetype,
    languageStack: { language: string; version?: string }[]
  ): ProjectRunbookCommand[] {
    const commands: any[] = [];
    const fw = (archetype.framework || '').toLowerCase();
    const hasPython = languageStack.some(l => l.language.includes('Python')) ||
      fw.includes('python') || fw.includes('django') || fw.includes('fastapi') || fw.includes('flask') || fw.includes('pytorch');
    const hasNode = languageStack.some(l => l.language.includes('Script')) || fw.includes('next') || fw.includes('react') || fw.includes('node');
    const hasGo = languageStack.some(l => l.language.includes('Go')) || fw.includes('go');
    const hasRust = languageStack.some(l => l.language.includes('Rust')) || fw.includes('rust');

    // --- 1. SETUP COMMANDS ---
    if (hasPython) {
      if (fs.existsSync(path.join(repoPath, 'poetry.lock'))) {
        commands.push({
          id: 'setup-poetry',
          category: 'setup',
          label: 'Install Poetry Dependencies',
          command: 'poetry install',
          explanation: 'Creates poetry virtualenv and installs pinned dependencies from poetry.lock',
          isDefault: true
        });
      } else if (fs.existsSync(path.join(repoPath, 'uv.lock')) || fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
        commands.push({
          id: 'setup-uv',
          category: 'setup',
          label: 'Install Python Dependencies (uv / venv)',
          command: fs.existsSync(path.join(repoPath, 'uv.lock'))
            ? 'uv sync'
            : 'python -m venv .venv && pip install -r requirements.txt',
          explanation: 'Sets up isolated Python virtual environment and installs dependencies',
          isDefault: true
        });
      } else if (fs.existsSync(path.join(repoPath, 'pyproject.toml')) || fs.existsSync(path.join(repoPath, 'setup.py'))) {
        commands.push({
          id: 'setup-pip-pyproject',
          category: 'setup',
          label: 'Install Project in Editable Mode',
          command: 'pip install -e .',
          explanation: 'Installs package and development dependencies in editable mode',
          isDefault: true
        });
      } else {
        commands.push({
          id: 'setup-pip-default',
          category: 'setup',
          label: 'Install Python Dependencies (pip)',
          command: 'python -m venv .venv && pip install -r requirements.txt',
          explanation: 'Sets up isolated Python virtual environment and installs dependencies',
          isDefault: true
        });
      }

      const isDjango = archetype.framework.toLowerCase().includes('django') ||
        fs.existsSync(path.join(repoPath, 'manage.py')) ||
        fs.existsSync(path.join(repoPath, 'django')) ||
        path.basename(repoPath).toLowerCase().includes('django');

      if (isDjango && fs.existsSync(path.join(repoPath, 'manage.py'))) {
        commands.push({
          id: 'setup-django-migrate',
          category: 'setup',
          label: 'Apply Database Migrations (Django)',
          command: 'python manage.py migrate',
          explanation: 'Initialises database tables and applies Django ORM schema migrations'
        });
      }
    }

    if (hasNode) {
      let runner = 'npm';
      if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) runner = 'pnpm';
      else if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) runner = 'yarn';
      else if (fs.existsSync(path.join(repoPath, 'bun.lockb'))) runner = 'bun';

      commands.push({
        id: 'setup-node',
        category: 'setup',
        label: `Install Dependencies (${runner})`,
        command: `${runner} install`,
        explanation: `Installs packages defined in package.json using ${runner}`,
        isDefault: !hasPython
      });
    }

    if (hasGo) {
      commands.push({
        id: 'setup-go',
        category: 'setup',
        label: 'Download Go Modules',
        command: 'go mod download',
        explanation: 'Downloads module dependencies specified in go.mod'
      });
    }

    if (hasRust) {
      commands.push({
        id: 'setup-rust',
        category: 'setup',
        label: 'Fetch Cargo Crates',
        command: 'cargo fetch',
        explanation: 'Downloads Cargo crate dependencies'
      });
    }

    // --- 2. RUN / DEV COMMANDS ---
    const pkgPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        let runner = 'npm';
        if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) runner = 'pnpm';
        else if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) runner = 'yarn';

        if (pkg.scripts?.dev) {
          commands.push({
            id: 'run-dev',
            category: 'run',
            label: 'Start Dev Server',
            command: `${runner} run dev`,
            explanation: 'Launches local dev server with hot module reloading',
            isDefault: true
          });
        }
        if (pkg.scripts?.start && !pkg.scripts?.dev) {
          commands.push({
            id: 'run-start',
            category: 'run',
            label: 'Start Application',
            command: `${runner} start`,
            explanation: 'Starts production or runtime service',
            isDefault: true
          });
        }
      } catch {}
    }

    if (hasPython) {
      const isFastApi = archetype.framework.toLowerCase().includes('fastapi');
      const isDjango = archetype.framework.toLowerCase().includes('django');
      const isFlask = archetype.framework.toLowerCase().includes('flask');

      if (isFastApi) {
        const entryModule = fs.existsSync(path.join(repoPath, 'src', 'main.py')) ? 'src.main:app' : 'main:app';
        commands.push({
          id: 'run-fastapi',
          category: 'run',
          label: 'Start FastAPI Server (Uvicorn)',
          command: `uvicorn ${entryModule} --reload --port 8000`,
          explanation: 'Runs FastAPI ASGI server with auto-reload and OpenAPI docs at /docs',
          isDefault: true
        });
      } else if (isDjango) {
        commands.push({
          id: 'run-django',
          category: 'run',
          label: 'Start Django Dev Server',
          command: 'python manage.py runserver',
          explanation: 'Launches Django development web server on port 8000',
          isDefault: true
        });
      } else if (isFlask) {
        commands.push({
          id: 'run-flask',
          category: 'run',
          label: 'Start Flask Server',
          command: 'flask run --reload',
          explanation: 'Runs Flask WSGI development server with debug reload',
          isDefault: true
        });
      } else {
        // Generic Python entrypoint
        const pyEntries = ['main.py', 'app.py', 'run.py', 'src/main.py', 'train.py'];
        for (const pe of pyEntries) {
          if (fs.existsSync(path.join(repoPath, pe))) {
            commands.push({
              id: 'run-py-main',
              category: 'run',
              label: `Execute ${pe}`,
              command: `python ${pe}`,
              explanation: `Runs primary script entrypoint (${pe})`,
              isDefault: commands.filter(c => c.category === 'run').length === 0
            });
            break;
          }
        }
      }
    }

    if (hasGo) {
      commands.push({
        id: 'run-go',
        category: 'run',
        label: 'Run Go Application',
        command: 'go run .',
        explanation: 'Compiles and executes root Go package'
      });
    }

    if (hasRust) {
      commands.push({
        id: 'run-rust',
        category: 'run',
        label: 'Run Rust Binary',
        command: 'cargo run',
        explanation: 'Compiles and executes the primary Cargo binary'
      });
    }

    // --- 3. TEST COMMANDS ---
    if (hasPython) {
      const isDjango = archetype.framework.toLowerCase().includes('django') ||
        fs.existsSync(path.join(repoPath, 'manage.py')) ||
        fs.existsSync(path.join(repoPath, 'django')) ||
        path.basename(repoPath).toLowerCase().includes('django');

      if (isDjango) {
        if (fs.existsSync(path.join(repoPath, 'tests', 'runtests.py'))) {
          commands.push({
            id: 'test-django-runtests',
            category: 'test',
            label: 'Run Django Core Test Runner',
            command: 'python tests/runtests.py',
            explanation: 'Executes official Django regression test suite across core modules',
            isDefault: true
          });
        }
        if (fs.existsSync(path.join(repoPath, 'manage.py'))) {
          commands.push({
            id: 'test-django-manage',
            category: 'test',
            label: 'Run Django Test Suite',
            command: 'python manage.py test',
            explanation: 'Discovers and executes Django unit and model tests with test runner',
            isDefault: !fs.existsSync(path.join(repoPath, 'tests', 'runtests.py'))
          });
        }
        commands.push({
          id: 'test-pytest',
          category: 'test',
          label: 'Run Pytest Suite',
          command: 'pytest -v',
          explanation: 'Discovers and executes unit and integration tests with pytest',
          isDefault: !fs.existsSync(path.join(repoPath, 'tests', 'runtests.py')) && !fs.existsSync(path.join(repoPath, 'manage.py'))
        });
      } else {
        commands.push({
          id: 'test-pytest',
          category: 'test',
          label: 'Run Pytest Suite',
          command: 'pytest -v',
          explanation: 'Discovers and executes unit and integration tests with verbose output',
          isDefault: true
        });
      }
    }

    if (hasNode) {
      let runner = 'npm';
      if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) runner = 'pnpm';
      commands.push({
        id: 'test-node',
        category: 'test',
        label: 'Run Test Suite (Node)',
        command: `${runner} test`,
        explanation: 'Executes test runner (Jest, Vitest, Mocha) configured in package.json',
        isDefault: !hasPython
      });
    }

    if (hasGo) {
      commands.push({
        id: 'test-go',
        category: 'test',
        label: 'Run Go Unit Tests',
        command: 'go test -v ./...',
        explanation: 'Recursively executes all package test suites with verbose logs'
      });
    }

    if (hasRust) {
      commands.push({
        id: 'test-rust',
        category: 'test',
        label: 'Run Cargo Tests',
        command: 'cargo test',
        explanation: 'Executes all unit, integration, and documentation tests'
      });
    }

    // --- 4. BUILD / LINT COMMANDS ---
    if (hasNode) {
      commands.push({
        id: 'build-node',
        category: 'build',
        label: 'Build Production Bundle',
        command: 'npm run build',
        explanation: 'Compiles TypeScript and packages production bundles'
      });
    }

    if (hasPython) {
      const isDjango = archetype.framework.toLowerCase().includes('django') ||
        fs.existsSync(path.join(repoPath, 'manage.py')) ||
        fs.existsSync(path.join(repoPath, 'django')) ||
        path.basename(repoPath).toLowerCase().includes('django');

      if (isDjango && fs.existsSync(path.join(repoPath, 'manage.py'))) {
        commands.push({
          id: 'build-django-makemigrations',
          category: 'build',
          label: 'Generate Django Migrations',
          command: 'python manage.py makemigrations',
          explanation: 'Inspects model changes and generates new database schema migration files'
        });
      }

      commands.push({
        id: 'lint-python',
        category: 'build',
        label: 'Lint & Format Check (Ruff)',
        command: 'ruff check .',
        explanation: 'Executes high-performance Python linter across codebase'
      });
    }

    // --- 5. DOCKER / CONTAINER COMMANDS ---
    if (fs.existsSync(path.join(repoPath, 'docker-compose.yml')) || fs.existsSync(path.join(repoPath, 'docker-compose.yaml')) || fs.existsSync(path.join(repoPath, 'compose.yaml'))) {
      commands.push({
        id: 'docker-compose-up',
        category: 'docker',
        label: 'Start Containers (Docker Compose)',
        command: 'docker-compose up -d',
        explanation: 'Spawns all multi-container services, databases, and dependencies in background'
      });
    } else if (fs.existsSync(path.join(repoPath, 'Dockerfile'))) {
      commands.push({
        id: 'docker-build',
        category: 'docker',
        label: 'Build Container Image',
        command: `docker build -t ${archetype.projectName.toLowerCase() || 'app'} .`,
        explanation: 'Builds reproducible OCI container image from local Dockerfile'
      });
    }

    return commands;
  }

  /**
   * Identifies primary entrypoints, manifests, schemas, docs, and test suites.
   */
  private static discoverKeyFiles(repoPath: string, archetype: WorkspaceArchetype): KeyFileEntry[] {
    const candidateFiles: { rel: string; type: KeyFileEntry['type']; label: string; description: string }[] = [
      // Primary Entrypoints
      { rel: 'main.py', type: 'entrypoint', label: 'Primary Application Entrypoint', description: 'Application bootstrapper, server initialisation, or execution CLI' },
      { rel: 'app.py', type: 'entrypoint', label: 'Web Application Root', description: 'Flask / FastAPI application factory and route registry' },
      { rel: 'src/main.py', type: 'entrypoint', label: 'Modular Source Entrypoint', description: 'Primary service entrypoint inside src package' },
      { rel: 'src/index.ts', type: 'entrypoint', label: 'TypeScript Package Root', description: 'Main module export or runtime ingress controller' },
      { rel: 'src/main.ts', type: 'entrypoint', label: 'Application Ingress Entrypoint', description: 'NestJS / Vite / Electron main application bootstrapper' },
      { rel: 'index.js', type: 'entrypoint', label: 'Node.js Server Entrypoint', description: 'Standard CommonJS / ES module application entrypoint' },
      { rel: 'server.js', type: 'entrypoint', label: 'HTTP Server Entrypoint', description: 'Express / HTTP server listener and middleware chain' },
      { rel: 'manage.py', type: 'entrypoint', label: 'Django Management Utility', description: 'Django CLI for running migrations, dev server, and shell commands' },
      { rel: 'main.go', type: 'entrypoint', label: 'Go Package Main Entrypoint', description: 'Root Go executable function main()' },
      { rel: 'src/main.rs', type: 'entrypoint', label: 'Rust Binary Root', description: 'Primary Cargo crate binary entrypoint fn main()' },
      { rel: 'train.py', type: 'entrypoint', label: 'ML Training Script', description: 'Deep learning model training and hyperparameter execution loop' },

      // Manifests & Configurations
      { rel: 'pyproject.toml', type: 'config', label: 'Python Project Manifest', description: 'PEP 518/621 build system, dependency constraints, and tool configurations' },
      { rel: 'package.json', type: 'config', label: 'NPM Package Manifest', description: 'Node.js dependency list, execution scripts, and workspace definition' },
      { rel: 'requirements.txt', type: 'config', label: 'Python Pinned Dependencies', description: 'Pip dependency freeze list for reproducible installation' },
      { rel: 'tsconfig.json', type: 'config', label: 'TypeScript Configuration', description: 'Compiler options, target ECMAScript version, and module resolution paths' },
      { rel: '.env.local', type: 'config', label: 'Local Environment Config (.env.local)', description: 'Local environment variable overrides and secrets (untracked in VCS)' },
      { rel: '.env', type: 'config', label: 'Active Environment File (.env)', description: 'Core environment variable definitions and configuration bindings' },
      { rel: '.env.development', type: 'config', label: 'Development Environment Config (.env.development)', description: 'Development environment overrides and endpoints' },
      { rel: '.env.production', type: 'config', label: 'Production Environment Config (.env.production)', description: 'Production deployment configuration and secrets blueprint' },
      { rel: '.env.example', type: 'config', label: 'Environment Template (.env.example)', description: 'Blueprint of mandatory environment variables, secrets, and database URIs' },
      { rel: '.env.template', type: 'config', label: 'Environment Blueprint (.env.template)', description: 'Template of configuration variables and database connections' },
      { rel: 'Makefile', type: 'config', label: 'Automation Makefile', description: 'Deterministic build targets, test recipes, and operational commands' },
      { rel: 'Dockerfile', type: 'config', label: 'Container Build Spec', description: 'Multi-stage container blueprint for runtime deployment' },
      { rel: 'docker-compose.yml', type: 'config', label: 'Docker Compose Topology', description: 'Multi-service orchestration for local database, cache, and app stack' },

      // Schemas & Data Models
      { rel: 'prisma/schema.prisma', type: 'schema', label: 'Prisma ORM Schema', description: 'Relational data models, database connection, and client generation targets' },
      { rel: 'drizzle.config.ts', type: 'schema', label: 'Drizzle ORM Config', description: 'TypeScript SQL schema migrations and connection configuration' },
      { rel: 'alembic.ini', type: 'schema', label: 'SQLAlchemy Alembic Migrations', description: 'Database schema revision engine and database URL locator' },
      { rel: 'models.py', type: 'schema', label: 'Python Data Models', description: 'SQLAlchemy / Pydantic / Django ORM entity declarations' },
      { rel: 'src/models.py', type: 'schema', label: 'Domain Entities & Models', description: 'Core domain schemas and database representations' },

      // Documentation
      { rel: 'README.md', type: 'doc', label: 'Project README', description: 'Executive introduction, architecture overview, and onboarding guide' },
      { rel: 'ARCHITECTURE.md', type: 'doc', label: 'Architecture Blueprint', description: 'System design decisions, subsystem boundaries, and data flow' },
      { rel: 'CONTRIBUTING.md', type: 'doc', label: 'Contributor Guide', description: 'Coding standards, PR workflow, and testing requirements' },

      // Tests
      { rel: 'tests/runtests.py', type: 'test', label: 'Django Test Runner', description: 'Official Django core test runner script for executing framework tests' },
      { rel: 'tests', type: 'test', label: 'Test Suite Directory', description: 'Automated test suite containing unit, integration, and regression tests' },
      { rel: 'test', type: 'test', label: 'Test Suite Directory', description: 'Automated test specifications' },
      { rel: 'src/__tests__', type: 'test', label: 'Component Unit Tests', description: 'Co-located test specs and snapshot fixtures' },
      { rel: 'pytest.ini', type: 'test', label: 'Pytest Settings', description: 'Test discovery patterns, markers, and coverage thresholds' },
      { rel: 'setup.cfg', type: 'config', label: 'Python Package Configuration', description: 'Package metadata, test configurations, and tool settings' },
      { rel: 'setup.py', type: 'config', label: 'Python Build Setup Script', description: 'Distutils / setuptools package installer and build specification' },
      { rel: 'django/__init__.py', type: 'entrypoint', label: 'Django Framework Core', description: 'Core framework package root and version metadata' }
    ];

    const discovered: KeyFileEntry[] = [];
    for (const c of candidateFiles) {
      const full = path.join(repoPath, c.rel);
      if (fs.existsSync(full)) {
        discovered.push({
          path: c.rel.replace(/\\/g, '/'),
          name: path.basename(c.rel),
          type: c.type,
          label: c.label,
          description: c.description,
          exists: true
        });
      }
    }

    // Also include any active environment files discovered in monorepo workspaces
    const envInfo = this.discoverEnvFiles(repoPath);
    for (const af of envInfo.activeFiles) {
      if (!discovered.some(d => d.path === af.relPath)) {
        discovered.push({
          path: af.relPath,
          name: af.name,
          type: 'config',
          label: `Environment Config (${af.name})`,
          description: af.isRoot
            ? `Active environment variables and configuration overrides (${af.name})`
            : `Active environment variables for ${path.dirname(af.relPath)} workspace`,
          exists: true
        });
      }
    }

    return discovered;
  }

  /**
   * Comprehensive list of active environment file variations across modern stacks
   * (Next.js, Vite, Nuxt, Remix, Node, Python, Django, Docker, direnv).
   */
  public static readonly ACTIVE_ENV_NAMES = [
    '.env',
    '.env.local',
    '.env.development.local',
    '.env.development',
    '.env.dev.local',
    '.env.dev',
    '.env.production.local',
    '.env.production',
    '.env.prod.local',
    '.env.prod',
    '.env.staging.local',
    '.env.staging',
    '.env.test.local',
    '.env.test',
    '.env.preview.local',
    '.env.preview',
    '.env.app',
    '.env.server',
    '.env.client',
    '.envrc',
    'env.local',
    'env.development',
    'env.production',
    'env'
  ];

  /**
   * Template / sample environment files used to bootstrap projects.
   */
  public static readonly TEMPLATE_ENV_NAMES = [
    '.env.example',
    '.env.template',
    '.env.sample',
    '.env.default',
    '.env.defaults',
    '.env.dist',
    '.env.local.example',
    '.env.development.example',
    '.env.production.example',
    'env.example',
    'env.template',
    'env.sample',
    'example.env'
  ];

  /**
   * Discovers active environment configurations and templates across root and monorepo workspaces.
   */
  public static discoverEnvFiles(repoPath: string): {
    hasActive: boolean;
    hasTemplate: boolean;
    activeFiles: Array<{ relPath: string; name: string; isRoot: boolean }>;
    templateFiles: Array<{ relPath: string; name: string; isRoot: boolean }>;
    primaryActive?: { relPath: string; name: string; isRoot: boolean };
    primaryTemplate?: { relPath: string; name: string; isRoot: boolean };
  } {
    const activeFiles: Array<{ relPath: string; name: string; isRoot: boolean }> = [];
    const templateFiles: Array<{ relPath: string; name: string; isRoot: boolean }> = [];

    // 1. Check repository root
    for (const name of this.ACTIVE_ENV_NAMES) {
      if (fs.existsSync(path.join(repoPath, name))) {
        activeFiles.push({ relPath: name, name, isRoot: true });
      }
    }
    for (const name of this.TEMPLATE_ENV_NAMES) {
      if (fs.existsSync(path.join(repoPath, name))) {
        templateFiles.push({ relPath: name, name, isRoot: true });
      }
    }

    // 2. Scan standard monorepo app/service subdirectories
    const scanParents = ['apps', 'packages', 'services', 'modules'];
    const candidateDirs: string[] = [];

    for (const parent of scanParents) {
      const parentFull = path.join(repoPath, parent);
      if (fs.existsSync(parentFull)) {
        try {
          const entries = fs.readdirSync(parentFull, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isDirectory() && !ent.name.startsWith('.')) {
              candidateDirs.push(path.join(parent, ent.name));
            }
          }
        } catch {}
      }
    }

    const directDirs = ['frontend', 'backend', 'client', 'server', 'web', 'api', 'app', 'src'];
    for (const d of directDirs) {
      const dFull = path.join(repoPath, d);
      if (fs.existsSync(dFull) && !candidateDirs.includes(d)) {
        candidateDirs.push(d);
      }
    }

    for (const dir of candidateDirs) {
      const fullDir = path.join(repoPath, dir);
      for (const name of this.ACTIVE_ENV_NAMES) {
        if (fs.existsSync(path.join(fullDir, name))) {
          const relPath = path.join(dir, name).replace(/\\/g, '/');
          if (!activeFiles.some(f => f.relPath === relPath)) {
            activeFiles.push({ relPath, name, isRoot: false });
          }
        }
      }
      for (const name of this.TEMPLATE_ENV_NAMES) {
        if (fs.existsSync(path.join(fullDir, name))) {
          const relPath = path.join(dir, name).replace(/\\/g, '/');
          if (!templateFiles.some(f => f.relPath === relPath)) {
            templateFiles.push({ relPath, name, isRoot: false });
          }
        }
      }
    }

    return {
      hasActive: activeFiles.length > 0,
      hasTemplate: templateFiles.length > 0,
      activeFiles,
      templateFiles,
      primaryActive: activeFiles[0],
      primaryTemplate: templateFiles[0]
    };
  }

  /**
   * Audits pre-flight readiness (Missing .env, uninstalled venv/node_modules, git state).
   */
  private static auditReadiness(
    repoPath: string,
    languageStack: { language: string; version?: string }[],
    runbook: ProjectRunbookCommand[]
  ): ReadinessCheckItem[] {
    const checks: ReadinessCheckItem[] = [];

    // 1. Environment Variables Audit (.env / .env.local / combinations vs templates)
    const envInfo = this.discoverEnvFiles(repoPath);

    if (envInfo.hasActive) {
      const primary = envInfo.primaryActive!;
      const count = envInfo.activeFiles.length;
      let details = '';
      if (primary.isRoot) {
        details = count === 1
          ? `Active environment file '${primary.name}' is present in project root.`
          : `Active environment files detected: ${envInfo.activeFiles.map(a => a.name).join(', ')}.`;
      } else {
        details = count === 1
          ? `Active environment file '${primary.name}' detected at '${primary.relPath}'.`
          : `Active environment files detected across workspaces (${envInfo.activeFiles.map(a => a.relPath).join(', ')}).`;
      }

      checks.push({
        id: 'env-present',
        title: `Environment File Configured (${primary.name})`,
        passed: true,
        severity: 'info',
        details
      });
    } else if (envInfo.hasTemplate) {
      const template = envInfo.primaryTemplate!;
      // Suggest .env.local for Next.js / Vite / frontend stacks, or .env for standard backend/general stacks
      const isNextOrVite = languageStack.some(l => /Next|React|Vite|Vue|Nuxt/i.test(l.language));
      const targetName = isNextOrVite ? '.env.local' : '.env';
      const targetRel = template.isRoot
        ? targetName
        : path.join(path.dirname(template.relPath), targetName).replace(/\\/g, '/');

      const isWin = process.platform === 'win32';
      const remedyCommand = isWin
        ? `copy ${template.relPath.replace(/\//g, '\\')} ${targetRel.replace(/\//g, '\\')}`
        : `cp ${template.relPath} ${targetRel}`;

      checks.push({
        id: 'env-missing',
        title: `Missing Environment File (${targetName})`,
        passed: false,
        severity: 'blocker',
        details: `Found template '${template.relPath}' but no active environment file (${targetName} or .env) detected. Services will likely fail to connect to database or APIs without environment variables.`,
        remedyCommand
      });
    } else {
      checks.push({
        id: 'env-none',
        title: 'Standard Environment Configuration',
        passed: true,
        severity: 'info',
        details: 'No dedicated environment template (.env.example) detected; project may use default configurations or system environment variables.'
      });
    }

    // 2. Python Virtual Environment Check
    const isPython = languageStack.some(l => l.language.includes('Python'));
    if (isPython) {
      const hasVenv = fs.existsSync(path.join(repoPath, '.venv')) || fs.existsSync(path.join(repoPath, 'venv')) || fs.existsSync(path.join(repoPath, 'env'));
      if (!hasVenv) {
        checks.push({
          id: 'py-venv-missing',
          title: 'Python Virtual Environment Not Provisioned',
          passed: false,
          severity: 'warning',
          details: 'No local .venv directory detected. Dependencies may conflict with global Python or fail to resolve.',
          remedyCommand: 'python -m venv .venv'
        });
      } else {
        checks.push({
          id: 'py-venv-present',
          title: 'Python Virtual Environment Ready',
          passed: true,
          severity: 'info',
          details: 'Active local .venv directory found in repository.'
        });
      }
    }

    // 3. Node Dependencies Check
    const isNode = languageStack.some(l => l.language.includes('Script'));
    if (isNode) {
      const hasNodeModules = fs.existsSync(path.join(repoPath, 'node_modules'));
      if (!hasNodeModules) {
        checks.push({
          id: 'node-modules-missing',
          title: 'Node Dependencies Not Installed (node_modules missing)',
          passed: false,
          severity: 'blocker',
          details: 'Project manifest package.json is present, but node_modules has not been installed yet.',
          remedyCommand: runbook.find(r => r.id === 'setup-node')?.command || 'npm install'
        });
      } else {
        checks.push({
          id: 'node-modules-present',
          title: 'Node Modules Installed',
          passed: true,
          severity: 'info',
          details: 'Dependencies in node_modules are provisioned and accessible.'
        });
      }
    }

    // 4. Git Repository Integrity Check
    const hasGit = fs.existsSync(path.join(repoPath, '.git'));
    if (!hasGit) {
      checks.push({
        id: 'git-missing',
        title: 'Untracked Directory (Not a Git Repository)',
        passed: false,
        severity: 'warning',
        details: 'No .git directory found. Version history, branch management, and diffing are disabled.',
        remedyCommand: 'git init'
      });
    } else {
      checks.push({
        id: 'git-active',
        title: 'Git Version Control Active',
        passed: true,
        severity: 'info',
        details: 'Valid Git repository detected with branch tracking.'
      });
    }

    // 5. Lockfile Presence Check (Reproducibility)
    const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'poetry.lock', 'uv.lock', 'Cargo.lock', 'go.sum'];
    const hasLockfile = lockfiles.some(lf => fs.existsSync(path.join(repoPath, lf)));
    if (hasLockfile) {
      checks.push({
        id: 'lockfile-present',
        title: 'Deterministic Dependency Lockfile Present',
        passed: true,
        severity: 'info',
        details: 'Pinned lockfile guarantees reproducible builds across developer machines and CI/CD.'
      });
    } else if (isNode || isPython) {
      checks.push({
        id: 'lockfile-missing',
        title: 'No Dependency Lockfile Found',
        passed: false,
        severity: 'warning',
        details: 'No lockfile detected. Dependency resolution may pull newer minor versions causing potential drift.'
      });
    }

    return checks;
  }

  /**
   * Generates a domain-grounded Mermaid sequence diagram topology and call flow summary.
   */
  private static generateTopology(archetype: WorkspaceArchetype): { topologyMermaid: string; callFlowSummary: string } {
    const isPyTorch = archetype.framework.toLowerCase().includes('pytorch') || archetype.aiEngines.some(e => /pytorch|torch|model/i.test(e));
    const isFastApi = archetype.framework.toLowerCase().includes('fastapi');
    const isNext = archetype.framework.toLowerCase().includes('next.js') || archetype.isMonorepo;

    if (isPyTorch) {
      const mermaid = `sequenceDiagram
autonumber
actor Dev as 👤 Engineer / Client
participant Pipeline as ⚡ Data Pipeline & Loader
participant Model as 🧠 PyTorch Neural Model
participant Compute as ⚙️ Tensor Execution (GPU/CPU)
participant Storage as 🗄️ Weights & Checkpoint Store
participant Logger as 📊 Experiment & Metric Logger

Dev->>Pipeline: Feed Training / Inference Batch
Pipeline->>Model: Normalize Tensor Shapes & Dimensions
Model->>Compute: Execute Forward Pass & Loss Computation
Compute->>Storage: Save Model Weights State Dict
Storage-->>Compute: Checkpoint Synchronized
Compute-->>Logger: Stream Epoch Loss & Accuracy Metrics
Compute-->>Dev: Return Prediction Tensor / Evaluation Loss`;

      const summary = '1. Developer feeds batch tensors into Data Pipeline.\n2. Pipeline normalizes tensor shapes and transfers to Model Architecture.\n3. Compute Engine executes forward pass and layer activations on GPU/CPU.\n4. Weights and state dict are persisted to Checkpoint Store.\n5. Training loss and metrics are logged and returned to Developer.';
      return { topologyMermaid: mermaid, callFlowSummary: summary };
    }

    if (isFastApi) {
      const dbLabel = archetype.databaseType || 'PostgreSQL Database';
      const saas = archetype.externalConnectors[0] || 'External Services / AI';
      const mermaid = `sequenceDiagram
autonumber
actor Client as 👤 API Client / Frontend
participant Ingress as 🛡️ FastAPI Gateway (/api)
participant Router as ⚙️ Async Route Handlers
participant Engine as 🧠 Core Domain Services
participant Database as 🗄️ ${dbLabel}
participant External as 🌐 ${saas}

Client->>Ingress: HTTP Request (JSON Body / Auth Token)
Ingress->>Router: Pydantic Validation & Route Dispatch
Router->>Engine: Execute Business Logic & Rules
Engine->>Database: Async Query / Mutate Records
Database-->>Engine: Return Entities / State
opt Third-Party Integration
  Engine->>External: Dispatch Webhook / Call Provider API
  External-->>Engine: Provider Response Payload
end
Engine-->>Router: Domain Result Object
Router-->>Ingress: Serialize Output Model
Ingress-->>Client: 200 OK (JSON Response)`;

      const summary = `1. Client issues authenticated HTTP request to FastAPI Ingress.\n2. Pydantic validates payload schemas and routes to Async Handler.\n3. Core Domain Service executes business logic.\n4. Database (${dbLabel}) is queried or updated.\n5. External APIs (${saas}) are triggered if applicable, and formatted response returns to Client.`;
      return { topologyMermaid: mermaid, callFlowSummary: summary };
    }

    if (isNext) {
      const dbLabel = archetype.databaseType || 'Prisma / Supabase Store';
      const saas = archetype.externalConnectors[0] || 'Stripe / Third-Party SaaS';
      const mermaid = `sequenceDiagram
autonumber
actor User as 👤 End User / Web Browser
participant Web as 🛡️ Next.js App Router (UI Ingress)
participant Actions as ⚙️ Server Actions & API Routes
participant Domain as 🧠 Business & Domain Layer
participant Db as 🗄️ ${dbLabel}
participant Saas as 🌐 ${saas}

User->>Web: Navigate / Trigger User Action
Web->>Actions: Server Action Invocation / Route Dispatch
Actions->>Domain: Execute Domain Rules & Validation
Domain->>Db: Query / Mutate Data Store
Db-->>Domain: Records Acknowledged
opt External Integrations
  Domain->>Saas: Process Payment / Dispatch Event
  Saas-->>Domain: Provider Webhook / Result
end
Domain-->>Actions: Formatted Business Result
Actions-->>Web: Revalidate Cache & Render Response
Web-->>User: Hydrated UI Component / 200 OK`;

      const summary = `1. User performs an action on the Next.js UI.\n2. App Router dispatches to Server Action or Route Handler.\n3. Domain Layer processes validation and business logic.\n4. Database (${dbLabel}) executes transactions.\n5. External SaaS (${saas}) handles integrations and UI re-renders with fresh data.`;
      return { topologyMermaid: mermaid, callFlowSummary: summary };
    }

    // General Architecture Fallback
    const dbLabel = archetype.databaseType || 'Data Persistence Store';
    const saas = archetype.externalConnectors[0] || 'Cloud & External Services';
    const domainLabel = archetype.domainName ? `${archetype.domainName} Engine` : 'Core Domain Engine';

    const mermaid = `sequenceDiagram
autonumber
actor User as 👤 Developer / User
participant Ingress as 🛡️ Entrypoint & Ingress
participant Controller as ⚙️ Application Controllers
participant Engine as 🧠 ${domainLabel}
participant Storage as 🗄️ ${dbLabel}
participant External as 🌐 ${saas}

User->>Ingress: Issue Request / Run Command
Ingress->>Controller: Route Dispatch & Parameter Parsing
Controller->>Engine: Execute Business & Domain Rules
Engine->>Storage: Read / Write Persistence Records
Storage-->>Engine: State Confirmed
opt External Integration
  Engine->>External: Dispatch API Call / Event
  External-->>Engine: Acknowledgment
end
Engine-->>Controller: Return Domain Result
Controller-->>Ingress: Format Output
Ingress-->>User: Success Response`;

    const summary = `1. Request enters through Ingress / CLI entrypoint.\n2. Controller parses input and dispatches to ${domainLabel}.\n3. Domain logic interacts with ${dbLabel}.\n4. External connectors (${saas}) handle outbound integrations.\n5. Formatted result returns to User.`;

    return { topologyMermaid: mermaid, callFlowSummary: summary };
  }

  /**
   * Generates a 5-part natural language codebase explanation.
   */
  private static generateExplanation(
    projectName: string,
    domainName: string,
    framework: string,
    architectureType: string,
    keyFiles: KeyFileEntry[],
    archetype: WorkspaceArchetype,
    runbook: ProjectRunbookCommand[]
  ) {
    const entryFiles = keyFiles.filter(k => k.type === 'entrypoint').map(k => k.path);
    const schemaFiles = keyFiles.filter(k => k.type === 'schema').map(k => k.path);
    const defaultRun = runbook.find(r => r.category === 'run' && r.isDefault)?.command || runbook.find(r => r.category === 'run')?.command || 'make run';
    const defaultTest = runbook.find(r => r.category === 'test')?.command || 'pytest';

    const executiveSummary = `${projectName} is an enterprise-grade ${framework} built for the ${domainName} domain. The codebase is organized as a ${architectureType}. It integrates with ${archetype.databaseType}${archetype.externalConnectors.length > 0 ? ` and external services including ${archetype.externalConnectors.slice(0, 3).join(', ')}` : ''}.`;

    const architectureMentalModel = `To navigate this codebase effectively, understand its 4 primary boundaries:
1. Ingress & Routing (${entryFiles.length > 0 ? entryFiles.join(', ') : 'Root / API entrypoints'}): Where requests and CLI commands enter the system.
2. Business Logic & Domain Services (${archetype.domainEngines.length > 0 ? archetype.domainEngines.join(', ') : 'Core modules'}): Where business calculations, rules, and workflows are enforced.
3. Data Persistence & Models (${schemaFiles.length > 0 ? schemaFiles.join(', ') : archetype.databaseType}): Manages database state, schemas, and queries.
4. External Boundaries (${archetype.externalConnectors.length > 0 ? archetype.externalConnectors.join(', ') : 'Standard I/O'}): Outbound connectors and SaaS integrations.`;

    const requestLifecycle = `When a request or event arrives in ${projectName}:
1. Ingress handles incoming connections, authenticates credentials, and parses input parameters.
2. Route controllers validate payloads against data models.
3. Domain engines execute core business rules and calculations.
4. Transactions are persisted to ${archetype.databaseType}.
5. Response models are serialized and returned with standard status codes.`;

    const howToExtendGuide = `How to Make Your First Change:
1. Adding a new route/feature: Locate the route registry or controller in ${entryFiles[0] || 'the main entrypoint'} and declare your handler.
2. Updating data models: Modify schemas in ${schemaFiles[0] || 'models directory'} and generate corresponding migrations.
3. Running local tests: Execute \`${defaultTest}\` in the terminal to verify regression-free changes.
4. Starting local runtime: Launch the server with \`${defaultRun}\`.`;

    const conventionsAndPitfalls = `Conventions & Important Guidelines:
• Environment Secrets: Never commit sensitive keys or database credentials; always use .env (modeled after .env.example).
• Dependencies: Always declare new packages in the project manifest rather than installing globally.
• Architecture Integrity: Keep business rules inside the domain engine rather than embedding SQL or external API logic directly inside route handlers.`;

    return {
      executiveSummary,
      architectureMentalModel,
      requestLifecycle,
      howToExtendGuide,
      conventionsAndPitfalls
    };
  }

  /**
   * Serializes the orientation brief to a clean Markdown document (ORIENTATION.md).
   */
  public static toMarkdown(brief: ProjectOrientationBrief): string {
    let md = `# 🧭 Project Orientation & Architecture Briefing: ${brief.projectName}\n\n`;
    md += `> **Domain**: ${brief.domainName} | **Framework**: ${brief.framework} | **Architecture**: ${brief.architectureType}\n\n`;

    md += `## 📋 Executive Summary\n${brief.codebaseExplanation.executiveSummary}\n\n`;

    md += `## ⚡ 1-Click Runbook\n`;
    md += `| Category | Action | Command | Explanation |\n`;
    md += `|---|---|---|---|\n`;
    for (const cmd of brief.runbook) {
      md += `| \`${cmd.category}\` | **${cmd.label}** | \`${cmd.command}\` | ${cmd.explanation} |\n`;
    }
    md += `\n`;

    md += `## 🛡️ Pre-Flight Environment Readiness\n`;
    for (const check of brief.readinessChecks) {
      const icon = check.passed ? '✅' : (check.severity === 'blocker' ? '🚨' : '⚠️');
      md += `- ${icon} **${check.title}** (${check.severity.toUpperCase()}): ${check.details}\n`;
      if (check.remedyCommand) {
        md += `  - *Remedy*: \`${check.remedyCommand}\`\n`;
      }
    }
    md += `\n`;

    md += `## 📂 Key Files & Entrypoints\n`;
    for (const kf of brief.keyFiles) {
      md += `- \`${kf.path}\`: **${kf.label}** — ${kf.description}\n`;
    }
    md += `\n`;

    md += `## 🗺️ Subsystem Architecture & Call Flow\n\n`;
    md += `\`\`\`mermaid\n${brief.topologyMermaid}\n\`\`\`\n\n`;
    md += `### Call Flow Walkthrough\n${brief.callFlowSummary}\n\n`;

    md += `## 🧠 Mental Model & How to Extend\n`;
    md += `### Architecture Mental Model\n${brief.codebaseExplanation.architectureMentalModel}\n\n`;
    md += `### End-to-End Request Journey\n${brief.codebaseExplanation.requestLifecycle}\n\n`;
    md += `### How to Make Your First Change\n${brief.codebaseExplanation.howToExtendGuide}\n\n`;
    md += `### Conventions & Pitfalls\n${brief.codebaseExplanation.conventionsAndPitfalls}\n`;

    return md;
  }

  private static hasExt(dir: string, ext: string): boolean {
    try {
      const files = fs.readdirSync(dir);
      return files.some(f => f.endsWith(ext));
    } catch {
      return false;
    }
  }

  private static readReadmeDescription(repoPath: string): string {
    const readmeCandidates = ['README.md', 'README', 'readme.md'];
    for (const r of readmeCandidates) {
      const p = path.join(repoPath, r);
      if (fs.existsSync(p)) {
        try {
          const lines = fs.readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
          for (const l of lines) {
            if (!l.startsWith('#') && !l.startsWith('[') && l.length > 20) {
              return l.slice(0, 150);
            }
          }
        } catch {}
      }
    }
    return '';
  }
}
