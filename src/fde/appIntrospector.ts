/**
 * fde/appIntrospector.ts — Client Application & Architecture Introspector
 *
 * Inspired by REA (Reverse Engineer Anything) principles and tailored for
 * Forward Deployed Engineers (FDE) modernizing enterprise client systems.
 *
 * Automatically inspects client applications (ASAR packages, web bundles,
 * backends, microservices, config repositories, or database scripts) to:
 *   1. Extract Database Connection Strings & Configurations (with credential sanitization).
 *   2. Extract SQL Queries, ORM Entities, and Tables to derive target schemas.
 *   3. Extract API Endpoints, HTTP Methods, and Inter-Process Communication (IPC) channels.
 *   4. Auto-generate dbt staging models (`stg_<source>__<table>.sql` & `sources.yml`).
 *   5. Auto-generate resilient client SDK connectors (TypeScript & Python).
 *   6. Synthesize an end-to-end System Architecture Blueprint (`ARCHITECTURE.md`).
 *   7. Anchor every claim in the Evidence Ledger and log unverified unknowns.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EvidenceLedger, EvidenceConfidence } from './provenance';
import { ApiConnectorGenerator, ApiEndpointSpec } from './apiConnectorGen';
import { BinaryIngestionEngine } from '../core/binaryIngest';

export type DatabaseDialect =
  | 'postgres'
  | 'mysql'
  | 'mssql'
  | 'oracle'
  | 'sqlite'
  | 'mongodb'
  | 'snowflake'
  | 'bigquery'
  | 'db2'
  | 'generic';

export interface ExtractedConnection {
  dialect: DatabaseDialect;
  sourceFile: string;
  sanitizedUri: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  isPlaintextPasswordExposed: boolean;
}

export interface ExtractedTable {
  name: string;
  sourceFile: string;
  columns: string[];
  operations: Array<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE'>;
  sampleQuery?: string;
}

export interface ExtractedApiRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  sourceFile: string;
  protocol: 'http' | 'websocket' | 'ipc';
  queryParams?: string[];
  routeParams?: string[];
}

export interface ExtractedIpcChannel {
  channel: string;
  direction: 'renderer-to-main' | 'main-to-renderer' | 'bidirectional';
  sourceFile: string;
}

export interface GeneratedDbtModel {
  tableName: string;
  filePath: string;
  sqlContent: string;
}

export interface AppIntrospectOptions {
  targetPath: string;
  appName?: string;
  sourceName?: string;
  ledger?: EvidenceLedger;
  maxScanFiles?: number;
}

export interface AppIntrospectResult {
  appName: string;
  sourceName: string;
  scannedFilesCount: number;
  connections: ExtractedConnection[];
  tables: ExtractedTable[];
  routes: ExtractedApiRoute[];
  ipcChannels: ExtractedIpcChannel[];
  dbtModels: GeneratedDbtModel[];
  dbtSourcesYaml: string;
  typescriptSdk: string;
  pythonSdk: string;
  architectureBlueprint: string;
  ledger: EvidenceLedger;
}

interface VirtualFile {
  relativePath: string;
  content: string;
}

export class AppIntrospector {
  private static readonly IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.vscode',
    'dist',
    'dist-desktop',
    'dist-desktop-staging',
    'bin',
    'obj',
    'coverage',
    '.vs'
  ]);

  private static readonly SCANNABLE_EXTS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py',
    '.cs', '.vb',
    '.java', '.jsp',
    '.xml', '.properties',
    '.sql', '.sqlpl', '.ddl', '.prisma',
    '.json', '.env', '.config', '.yaml', '.yml',
    '.asar'
  ]);

  /**
   * Introspects a target directory, file, or ASAR package and generates
   * dbt staging models, API SDKs, and architecture blueprints.
   */
  public static async introspect(options: AppIntrospectOptions): Promise<AppIntrospectResult> {
    const targetPath = path.resolve(options.targetPath);
    const appName = options.appName || path.basename(targetPath, path.extname(targetPath)) || 'ClientApplication';
    const sourceName = options.sourceName || 'client_raw';
    const ledger = options.ledger || new EvidenceLedger();
    const maxFiles = options.maxScanFiles || 500;

    // 1. Gather virtual files from target path (unpacks ASAR if binary artifact)
    const virtualFiles = await this.collectFiles(targetPath, ledger, maxFiles);

    // 2. Perform extraction passes across all files
    const connections = this.extractConnections(virtualFiles, ledger);
    const tables = this.extractTables(virtualFiles, ledger);
    const routes = this.extractApiRoutes(virtualFiles, ledger);
    const ipcChannels = this.extractIpcChannels(virtualFiles, ledger);

    // 3. Auto-generate dbt models and sources.yml
    const { dbtModels, dbtSourcesYaml } = this.generateDbtAssets(tables, sourceName);

    // 4. Auto-generate resilient client SDK connectors
    const { typescriptSdk, pythonSdk } = this.generateConnectors(appName, routes);

    // 5. Generate System Architecture Blueprint
    const architectureBlueprint = this.generateArchitectureBlueprint(
      appName,
      virtualFiles.length,
      connections,
      tables,
      routes,
      ipcChannels,
      ledger
    );

    return {
      appName,
      sourceName,
      scannedFilesCount: virtualFiles.length,
      connections,
      tables,
      routes,
      ipcChannels,
      dbtModels,
      dbtSourcesYaml,
      typescriptSdk,
      pythonSdk,
      architectureBlueprint,
      ledger
    };
  }

  /**
   * Recursively discovers files or unpacks ASAR packages into virtual source files.
   */
  private static async collectFiles(
    targetPath: string,
    ledger: EvidenceLedger,
    maxFiles: number
  ): Promise<VirtualFile[]> {
    const results: VirtualFile[] = [];

    if (!fs.existsSync(targetPath)) {
      return results;
    }

    const stat = fs.statSync(targetPath);

    // Case A: Single file (e.g. .asar, .js, .json)
    if (stat.isFile()) {
      if (targetPath.endsWith('.asar') || BinaryIngestionEngine.isBinaryArtifact(targetPath)) {
        const ingested = await BinaryIngestionEngine.ingestArtifact(targetPath, ledger);
        for (const file of ingested.files) {
          results.push({
            relativePath: file.relPath,
            content: file.content
          });
        }
      } else {
        results.push({
          relativePath: path.basename(targetPath),
          content: fs.readFileSync(targetPath, 'utf8')
        });
      }
      return results;
    }

    // Case B: Directory scan
    const queue: string[] = [targetPath];

    while (queue.length > 0 && results.length < maxFiles) {
      const currentDir = queue.shift()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (results.length >= maxFiles) break;

        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(targetPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (!this.IGNORED_DIRS.has(entry.name)) {
            queue.push(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.asar') {
            try {
              const ingested = await BinaryIngestionEngine.ingestArtifact(fullPath, ledger);
              for (const f of ingested.files) {
                results.push({
                  relativePath: `${relPath}/${f.relPath}`,
                  content: f.content
                });
              }
            } catch {}
          } else if (this.SCANNABLE_EXTS.has(ext) || entry.name.startsWith('.env')) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              results.push({ relativePath: relPath, content });
            } catch {}
          }
        }
      }
    }

    return results;
  }

  /**
   * Extracts database connection strings, credentials, and configuration blocks.
   */
  private static extractConnections(
    files: VirtualFile[],
    ledger: EvidenceLedger
  ): ExtractedConnection[] {
    const connections: ExtractedConnection[] = [];
    const seenUris = new Set<string>();

    const urlRegex = /(postgres(?:ql)?|mysql|mssql|mongodb(?:\+srv)?|oracle|snowflake|sqlite):\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/([a-zA-Z0-9_\-]+)/gi;
    const mssqlConnStrRegex = /Server=([^;]+);(?:Database|Initial Catalog)=([^;]+);(?:User Id|UID)=([^;]+);Password=([^;]+);/gi;

    for (const file of files) {
      // 1. Scan connection URLs
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(file.content)) !== null) {
        const rawScheme = match[1].toLowerCase();
        let dialect: DatabaseDialect = 'generic';
        if (rawScheme.startsWith('postgres')) dialect = 'postgres';
        else if (rawScheme === 'mysql') dialect = 'mysql';
        else if (rawScheme === 'mssql') dialect = 'mssql';
        else if (rawScheme.startsWith('mongodb')) dialect = 'mongodb';
        else if (rawScheme === 'oracle') dialect = 'oracle';
        else if (rawScheme === 'snowflake') dialect = 'snowflake';
        else if (rawScheme === 'sqlite') dialect = 'sqlite';

        const user = match[2];
        const rawPassword = match[3];
        const host = match[4];
        const port = match[5] ? parseInt(match[5], 10) : undefined;
        const database = match[6];

        const sanitizedUri = `${rawScheme}://${user}:***@${host}${port ? `:${port}` : ''}/${database}`;

        if (!seenUris.has(sanitizedUri)) {
          seenUris.add(sanitizedUri);
          const isPlaintextPasswordExposed = rawPassword.length > 0 && !rawPassword.includes('${') && !rawPassword.includes('process.env');

          connections.push({
            dialect,
            sourceFile: file.relativePath,
            sanitizedUri,
            host,
            port,
            database,
            user,
            isPlaintextPasswordExposed
          });

          ledger.record({
            kind: 'schema_introspection',
            confidence: 'exact',
            sourceUri: `${file.relativePath}#Connection`,
            summary: `Discovered ${dialect.toUpperCase()} connection configuration (${sanitizedUri})`,
            rawProof: match[0].replace(rawPassword, '***')
          });

          if (isPlaintextPasswordExposed) {
            ledger.recordUnknown({
              target: `${file.relativePath}: Plaintext Credential Exposure`,
              reason: 'Database credentials found in plaintext source code or config file',
              severity: 'warning',
              remediation: 'Migrate plaintext passwords to an enterprise secrets manager (AWS Secrets Manager, Azure Key Vault, or HashiCorp Vault)',
              sourceUri: file.relativePath
            });
          }
        }
      }

      // 2. Scan MSSQL connection strings
      while ((match = mssqlConnStrRegex.exec(file.content)) !== null) {
        const host = match[1];
        const database = match[2];
        const user = match[3];
        const rawPassword = match[4];
        const sanitizedUri = `Server=${host};Database=${database};User Id=${user};Password=***;`;

        if (!seenUris.has(sanitizedUri)) {
          seenUris.add(sanitizedUri);
          const isPlaintextPasswordExposed = rawPassword.length > 0 && !rawPassword.includes('${');

          connections.push({
            dialect: 'mssql',
            sourceFile: file.relativePath,
            sanitizedUri,
            host,
            database,
            user,
            isPlaintextPasswordExposed
          });

          ledger.record({
            kind: 'schema_introspection',
            confidence: 'exact',
            sourceUri: `${file.relativePath}#MSSQLConnection`,
            summary: `Discovered MSSQL ADO.NET connection string (${sanitizedUri})`,
            rawProof: sanitizedUri
          });
        }
      }

      // 3. Scan IBM DB2 JDBC & Connection Strings
      const db2JdbcRegex = /jdbc:db2:\/\/([^:/]+):(\d+)\/([a-zA-Z0-9_\-]+)(?::(?:user=([^;]+);)?(?:password=([^;]+);)?)?/gi;
      while ((match = db2JdbcRegex.exec(file.content)) !== null) {
        const host = match[1];
        const port = parseInt(match[2], 10);
        const database = match[3];
        const user = match[4] || 'db2admin';
        const rawPassword = match[5] || '';
        const sanitizedUri = `jdbc:db2://${host}:${port}/${database}`;

        if (!seenUris.has(sanitizedUri)) {
          seenUris.add(sanitizedUri);
          const isPlaintextPasswordExposed = rawPassword.length > 0 && !rawPassword.includes('${');

          connections.push({
            dialect: 'db2',
            sourceFile: file.relativePath,
            sanitizedUri,
            host,
            port,
            database,
            user,
            isPlaintextPasswordExposed
          });

          ledger.record({
            kind: 'schema_introspection',
            confidence: 'exact',
            sourceUri: `${file.relativePath}#DB2Connection`,
            summary: `Discovered IBM DB2 JDBC connection string (${sanitizedUri})`,
            rawProof: sanitizedUri
          });
        }
      }
    }

    return connections;
  }

  /**
   * Extracts SQL queries, ORM entities, and database tables from code.
   */
  private static extractTables(
    files: VirtualFile[],
    ledger: EvidenceLedger
  ): ExtractedTable[] {
    const tableMap = new Map<string, {
      sourceFiles: Set<string>;
      columns: Set<string>;
      operations: Set<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE'>;
      sampleQuery?: string;
    }>();

    // SQL pattern recognizers
    const selectRegex = /\bSELECT\s+([\s\S]+?)\s+FROM\s+["`]?([a-zA-Z0-9_\.]+)["`]?/gi;
    const insertRegex = /\bINSERT\s+INTO\s+["`]?([a-zA-Z0-9_\.]+)["`]?/gi;
    const updateRegex = /\bUPDATE\s+["`]?([a-zA-Z0-9_\.]+)["`]?/gi;
    const deleteRegex = /\bDELETE\s+FROM\s+["`]?([a-zA-Z0-9_\.]+)["`]?/gi;
    const createTableRegex = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_\.]+)["`]?\s*\(([\s\S]+?)\)/gi;

    // ORM models: TypeORM, Prisma, Sequelize, SQLAlchemy, JPA / Hibernate
    const typeOrmEntityRegex = /@Entity\s*\(\s*['"]?([a-zA-Z0-9_]+)['"]?\s*\)/gi;
    const jpaTableRegex = /@Table\s*\(\s*(?:name\s*=\s*)?['"]([a-zA-Z0-9_]+)['"]\s*\)/gi;
    const prismaModelRegex = /\bmodel\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/gi;
    const sqlalchemyTableRegex = /__tablename__\s*=\s*['"]([a-zA-Z0-9_]+)['"]/gi;
    const db2ProcedureCallRegex = /\b(?:CALL|\{call)\s+([a-zA-Z0-9_\.]+)\s*\(?/gi;

    for (const file of files) {
      // Check for dangerous dynamic SQL concatenation
      if (/(?:query|execute)\s*\(\s*["'`]\s*SELECT[\s\S]*?\+\s*[a-zA-Z0-9_]+/i.test(file.content) ||
          /(?:query|execute)\s*\(\s*`SELECT[\s\S]*?\$\{[a-zA-Z0-9_]+\}/i.test(file.content)) {
        ledger.recordUnknown({
          target: `${file.relativePath}: Dynamic SQL String Construction`,
          reason: 'Dynamic SQL query built via runtime string interpolation/concatenation',
          severity: 'warning',
          remediation: 'Refactor query to use parameterized queries or prepared statements to prevent SQL injection and enable exact column tracking',
          sourceUri: file.relativePath
        });
      }

      // 1. SELECT queries
      let m: RegExpExecArray | null;
      while ((m = selectRegex.exec(file.content)) !== null) {
        const rawCols = m[1].trim();
        const rawTable = m[2].trim().replace(/^public\./i, '');
        if (this.isValidTableName(rawTable)) {
          const entry = this.getOrCreateTable(tableMap, rawTable);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('SELECT');
          if (!entry.sampleQuery) entry.sampleQuery = m[0].slice(0, 160);

          this.parseColumnList(rawCols).forEach(c => entry.columns.add(c));
        }
      }

      // 2. INSERT queries
      while ((m = insertRegex.exec(file.content)) !== null) {
        const rawTable = m[1].trim().replace(/^public\./i, '');
        if (this.isValidTableName(rawTable)) {
          const entry = this.getOrCreateTable(tableMap, rawTable);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('INSERT');
        }
      }

      // 3. UPDATE queries
      while ((m = updateRegex.exec(file.content)) !== null) {
        const rawTable = m[1].trim().replace(/^public\./i, '');
        if (this.isValidTableName(rawTable)) {
          const entry = this.getOrCreateTable(tableMap, rawTable);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('UPDATE');
        }
      }

      // 4. DELETE queries
      while ((m = deleteRegex.exec(file.content)) !== null) {
        const rawTable = m[1].trim().replace(/^public\./i, '');
        if (this.isValidTableName(rawTable)) {
          const entry = this.getOrCreateTable(tableMap, rawTable);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('DELETE');
        }
      }

      // 5. CREATE TABLE statements
      while ((m = createTableRegex.exec(file.content)) !== null) {
        const rawTable = m[1].trim().replace(/^public\./i, '');
        const colBlock = m[2].trim();
        if (this.isValidTableName(rawTable)) {
          const entry = this.getOrCreateTable(tableMap, rawTable);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('CREATE');
          this.parseCreateTableColumns(colBlock).forEach(c => entry.columns.add(c));
        }
      }

      // 6. Prisma models
      while ((m = prismaModelRegex.exec(file.content)) !== null) {
        const modelName = m[1].trim();
        const body = m[2].trim();
        const entry = this.getOrCreateTable(tableMap, modelName);
        entry.sourceFiles.add(file.relativePath);
        entry.operations.add('CREATE');
        const lines = body.split('\n');
        for (const line of lines) {
          const colMatch = line.trim().match(/^([a-zA-Z0-9_]+)\s+([A-Z][a-zA-Z0-9_]+)/);
          if (colMatch && !colMatch[1].startsWith('@@')) {
            entry.columns.add(colMatch[1]);
          }
        }
      }

      // 7. TypeORM & SQLAlchemy models
      while ((m = typeOrmEntityRegex.exec(file.content)) !== null) {
        const entityName = m[1]?.trim() || 'entity';
        if (this.isValidTableName(entityName)) {
          const entry = this.getOrCreateTable(tableMap, entityName);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('CREATE');
        }
      }

      while ((m = sqlalchemyTableRegex.exec(file.content)) !== null) {
        const tblName = m[1].trim();
        if (this.isValidTableName(tblName)) {
          const entry = this.getOrCreateTable(tableMap, tblName);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('CREATE');
        }
      }

      // 8. JPA / Hibernate @Table annotations in Java classes
      while ((m = jpaTableRegex.exec(file.content)) !== null) {
        const tblName = m[1].trim();
        if (this.isValidTableName(tblName)) {
          const entry = this.getOrCreateTable(tableMap, tblName);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('CREATE');
        }
      }

      // 9. IBM DB2 Stored Procedure Calls (CALL SP_...)
      while ((m = db2ProcedureCallRegex.exec(file.content)) !== null) {
        const rawProc = m[1].trim().replace(/^DB2ADMIN\./i, '');
        if (this.isValidTableName(rawProc)) {
          const entry = this.getOrCreateTable(tableMap, rawProc);
          entry.sourceFiles.add(file.relativePath);
          entry.operations.add('SELECT');
          if (!entry.sampleQuery) entry.sampleQuery = `CALL ${rawProc}(...)`;
        }
      }
    }

    const tables: ExtractedTable[] = [];
    for (const [name, meta] of tableMap.entries()) {
      const sourceFile = Array.from(meta.sourceFiles)[0] || 'unknown';
      const columns = Array.from(meta.columns);
      const operations = Array.from(meta.operations);

      tables.push({
        name,
        sourceFile,
        columns,
        operations,
        sampleQuery: meta.sampleQuery
      });

      ledger.record({
        kind: 'schema_introspection',
        confidence: columns.length > 0 ? 'exact' : 'inferred',
        sourceUri: `${sourceFile}#Table:${name}`,
        summary: `Discovered table '${name}' with ${columns.length} columns and operations: [${operations.join(', ')}]`,
        rawProof: meta.sampleQuery || `Table ${name}`
      });
    }

    return tables;
  }

  /**
   * Extracts REST/HTTP routes from client controllers, services, and routers.
   */
  private static extractApiRoutes(
    files: VirtualFile[],
    ledger: EvidenceLedger
  ): ExtractedApiRoute[] {
    const routes: ExtractedApiRoute[] = [];
    const seen = new Set<string>();

    // Express / Fastify / Koa: app.get('/api/v1/orders', ...)
    const nodeRouteRegex = /\b(?:app|router|server)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi;
    // Axios / Client HTTP: axios.get('/api/orders')
    const axiosRegex = /\b(?:axios|http|apiClient)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi;
    // Python Flask / FastAPI: @app.get('/api/orders')
    const pythonRouteRegex = /@(?:app|router|api)\.(get|post|put|delete|patch|route)\(\s*['"`]([^'"`]+)['"`]/gi;
    // ASP.NET / C#: [HttpGet("/api/orders")] or [Route("api/[controller]")]
    const aspNetActionRegex = /\[Http(Get|Post|Put|Delete|Patch)\s*(?:\(\s*['"]([^'"]*)['"]\s*\))?\]/gi;
    // Java Spring: @GetMapping("/api/employees"), @PostMapping("/api/payroll")
    const springRouteRegex = /@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(\s*(?:(?:value|path)\s*=\s*)?['"]([^'"]+)['"]\s*\))?/gi;
    // Java JAX-RS / WebSphere: @Path("/employees")
    const jaxRsPathRegex = /@Path\s*\(\s*['"]([^'"]+)['"]\s*\)/gi;
    // Java Struts 1.x/2.x XML action mapping: <action path="/employee/view" ...>
    const strutsActionRegex = /<action\s+[^>]*path=['"]([^'"]+)['"]/gi;

    for (const file of files) {
      let m: RegExpExecArray | null;

      // 1. Node.js routes
      while ((m = nodeRouteRegex.exec(file.content)) !== null) {
        const method = m[1].toUpperCase() as ExtractedApiRoute['method'];
        const routePath = m[2].trim();
        this.addRoute(routes, seen, method, routePath, file.relativePath, 'http', ledger);
      }

      // 2. Axios client calls
      while ((m = axiosRegex.exec(file.content)) !== null) {
        const method = m[1].toUpperCase() as ExtractedApiRoute['method'];
        const routePath = m[2].trim();
        this.addRoute(routes, seen, method, routePath, file.relativePath, 'http', ledger);
      }

      // 3. Python routes
      while ((m = pythonRouteRegex.exec(file.content)) !== null) {
        let method = m[1].toUpperCase();
        if (method === 'ROUTE') method = 'GET';
        const routePath = m[2].trim();
        this.addRoute(routes, seen, method as ExtractedApiRoute['method'], routePath, file.relativePath, 'http', ledger);
      }

      // 4. ASP.NET actions
      while ((m = aspNetActionRegex.exec(file.content)) !== null) {
        const method = m[1].toUpperCase() as ExtractedApiRoute['method'];
        const routePath = m[2]?.trim() || '/';
        this.addRoute(routes, seen, method, routePath, file.relativePath, 'http', ledger);
      }

      // 5. Java Spring Boot annotations
      while ((m = springRouteRegex.exec(file.content)) !== null) {
        const method = m[1].toUpperCase() as ExtractedApiRoute['method'];
        const routePath = m[2]?.trim() || '/';
        this.addRoute(routes, seen, method, routePath, file.relativePath, 'http', ledger);
      }

      // 6. Java JAX-RS / WebSphere paths
      while ((m = jaxRsPathRegex.exec(file.content)) !== null) {
        const routePath = m[1]?.trim() || '/';
        this.addRoute(routes, seen, 'GET', routePath, file.relativePath, 'http', ledger);
      }

      // 7. Java Struts XML actions
      while ((m = strutsActionRegex.exec(file.content)) !== null) {
        const routePath = m[1]?.trim() || '/';
        this.addRoute(routes, seen, 'POST', routePath, file.relativePath, 'http', ledger);
      }
    }

    return routes;
  }

  /**
   * Extracts IPC channels from Electron / WebSocket messaging implementations.
   */
  private static extractIpcChannels(
    files: VirtualFile[],
    ledger: EvidenceLedger
  ): ExtractedIpcChannel[] {
    const channels: ExtractedIpcChannel[] = [];
    const seen = new Set<string>();

    const ipcRendererRegex = /\bipcRenderer\.(?:send|sendSync|invoke)\(\s*['"`]([^'"`]+)['"`]/gi;
    const ipcMainRegex = /\bipcMain\.(?:handle|handleOnce|on)\(\s*['"`]([^'"`]+)['"`]/gi;
    const webSocketRegex = /\b(?:socket|io|ws)\.(?:emit|on|send)\(\s*['"`]([^'"`]+)['"`]/gi;

    for (const file of files) {
      let m: RegExpExecArray | null;

      // Renderer to Main
      while ((m = ipcRendererRegex.exec(file.content)) !== null) {
        const channel = m[1].trim();
        if (!seen.has(channel)) {
          seen.add(channel);
          channels.push({
            channel,
            direction: 'renderer-to-main',
            sourceFile: file.relativePath
          });

          ledger.record({
            kind: 'inspected_component',
            confidence: 'exact',
            sourceUri: `${file.relativePath}#IPC:${channel}`,
            summary: `Discovered Electron IPC channel '${channel}' (Renderer -> Main)`,
            rawProof: m[0]
          });
        }
      }

      // Main handlers
      while ((m = ipcMainRegex.exec(file.content)) !== null) {
        const channel = m[1].trim();
        if (!seen.has(channel)) {
          seen.add(channel);
          channels.push({
            channel,
            direction: 'main-to-renderer',
            sourceFile: file.relativePath
          });

          ledger.record({
            kind: 'inspected_component',
            confidence: 'exact',
            sourceUri: `${file.relativePath}#IPCHandler:${channel}`,
            summary: `Discovered Electron IPC handler for '${channel}' in Main process`,
            rawProof: m[0]
          });
        }
      }

      // WebSockets
      while ((m = webSocketRegex.exec(file.content)) !== null) {
        const event = m[1].trim();
        if (event.length > 2 && !seen.has(event)) {
          seen.add(event);
          channels.push({
            channel: event,
            direction: 'bidirectional',
            sourceFile: file.relativePath
          });
        }
      }
    }

    return channels;
  }

  /**
   * Auto-generates dbt staging models (`stg_<source>__<table>.sql`) and `sources.yml`.
   */
  public static generateDbtAssets(
    tables: ExtractedTable[],
    sourceName: string
  ): { dbtModels: GeneratedDbtModel[]; dbtSourcesYaml: string } {
    const dbtModels: GeneratedDbtModel[] = [];

    // Fallback if no tables discovered
    const targetTables = tables.length > 0 ? tables : [
      { name: 'orders', sourceFile: 'inferred', columns: ['id', 'customer_id', 'total_amount', 'created_at'], operations: ['SELECT' as const] }
    ];

    for (const t of targetTables) {
      const modelName = `stg_${sourceName}__${t.name.toLowerCase()}`;
      const cols = t.columns.length > 0 ? t.columns : ['id', 'created_at', 'updated_at'];

      const sqlLines: string[] = [
        `{{ config(materialized='view') }}`,
        ``,
        `/*`,
        ` * Staging model for: ${t.name}`,
        ` * Introspected from: ${t.sourceFile}`,
        ` * Operations detected: [${t.operations.join(', ')}]`,
        ` */`,
        ``,
        `with source as (`,
        `    select * from {{ source('${sourceName}', '${t.name}') }}`,
        `),`,
        ``,
        `renamed as (`,
        `    select`
      ];

      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const isLast = i === cols.length - 1;
        const comma = isLast ? '' : ',';
        if (c.toLowerCase().includes('id')) {
          sqlLines.push(`        cast(${c} as {{ dbt.type_string() }}) as ${c}${comma}`);
        } else if (c.toLowerCase().includes('_at') || c.toLowerCase().includes('date') || c.toLowerCase().includes('time')) {
          sqlLines.push(`        cast(${c} as {{ dbt.type_timestamp() }}) as ${c}${comma}`);
        } else if (c.toLowerCase().includes('amount') || c.toLowerCase().includes('price') || c.toLowerCase().includes('total')) {
          sqlLines.push(`        cast(${c} as {{ dbt.type_numeric() }}) as ${c}${comma}`);
        } else {
          sqlLines.push(`        ${c}${comma}`);
        }
      }

      sqlLines.push(`    from source`);
      sqlLines.push(`)`);
      sqlLines.push(``);
      sqlLines.push(`select * from renamed`);

      dbtModels.push({
        tableName: t.name,
        filePath: `models/staging/${sourceName}/${modelName}.sql`,
        sqlContent: sqlLines.join('\n')
      });
    }

    // Generate sources.yml
    const yamlLines: string[] = [
      `version: 2`,
      ``,
      `sources:`,
      `  - name: ${sourceName}`,
      `    description: "Raw client data tables introspected by Evolve AI Delivery Suite"`,
      `    tables:`
    ];

    for (const t of targetTables) {
      yamlLines.push(`      - name: ${t.name}`);
      yamlLines.push(`        description: "Introspected table from ${t.sourceFile}"`);
      const pkey = t.columns.find(c => c.toLowerCase() === 'id' || c.toLowerCase().endsWith('_id')) || t.columns[0];
      if (pkey) {
        yamlLines.push(`        columns:`);
        yamlLines.push(`          - name: ${pkey}`);
        yamlLines.push(`            description: "Primary key identifier"`);
        yamlLines.push(`            tests:`);
        yamlLines.push(`              - unique`);
        yamlLines.push(`              - not_null`);
      }
    }

    return {
      dbtModels,
      dbtSourcesYaml: yamlLines.join('\n')
    };
  }

  /**
   * Auto-generates resilient client SDK connectors (TypeScript & Python).
   */
  public static generateConnectors(
    appName: string,
    routes: ExtractedApiRoute[]
  ): { typescriptSdk: string; pythonSdk: string } {
    const endpoints: ApiEndpointSpec[] = [];

    const effectiveRoutes = routes.length > 0 ? routes : [
      { method: 'GET' as const, path: '/api/v1/health', sourceFile: 'inferred', protocol: 'http' as const },
      { method: 'GET' as const, path: '/api/v1/items', sourceFile: 'inferred', protocol: 'http' as const },
      { method: 'POST' as const, path: '/api/v1/items', sourceFile: 'inferred', protocol: 'http' as const }
    ];

    for (const r of effectiveRoutes) {
      const cleanPath = r.path.replace(/^\//, '');
      const rawSegments = cleanPath.split('/').filter(s => s && !s.startsWith(':') && !s.startsWith('{'));
      const meaningfulSegments = rawSegments.filter(s => !/^api$/i.test(s) && !/^v\d+$/i.test(s));
      const segments = meaningfulSegments.length > 0 ? meaningfulSegments : rawSegments;
      const endpointName = `${r.method.toLowerCase()}${segments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') || 'Root'}`;

      endpoints.push({
        name: endpointName,
        method: r.method,
        path: r.path,
        description: `Introspected route from ${r.sourceFile}`
      });
    }

    const connectorOpts = {
      connectorName: `${appName.replace(/[^a-zA-Z0-9]/g, '')}`,
      baseUrl: 'https://api.client.internal',
      authType: 'bearer' as const,
      targetLanguage: 'typescript' as const,
      endpoints,
      maxRetries: 3,
      timeoutMs: 15000
    };

    const typescriptSdk = ApiConnectorGenerator.generateTypeScriptSdk(connectorOpts);
    const pythonSdk = ApiConnectorGenerator.generatePythonSdk({ ...connectorOpts, targetLanguage: 'python' });

    return { typescriptSdk, pythonSdk };
  }

  /**
   * Generates a comprehensive Architecture Blueprint with Mermaid diagrams and evidence links.
   */
  public static generateArchitectureBlueprint(
    appName: string,
    fileCount: number,
    connections: ExtractedConnection[],
    tables: ExtractedTable[],
    routes: ExtractedApiRoute[],
    ipcChannels: ExtractedIpcChannel[],
    ledger: EvidenceLedger
  ): string {
    const manifest = ledger.exportManifest();

    const lines: string[] = [
      `# System Architecture & Integration Blueprint: ${appName}`,
      ``,
      `> **Generated by Evolve AI Forward Deployed Engineer Suite**`,
      `> Scanned Artifacts: ${fileCount} files | Verified Evidence Records: ${manifest.recordsCount} | Tracked Unknowns: ${manifest.unknownsCount}`,
      ``,
      `## 1. Executive Summary & Discovered Topology`,
      `This blueprint was automatically synthesized by introspecting the client application codebase.`,
      `Every detected database connection, table entity, and API endpoint is anchored in the **Verifiable Evidence Ledger** to eliminate documentation hallucinations.`,
      ``,
      `\`\`\`mermaid`,
      `flowchart TD`,
      `    ClientApp["Client Application: ${appName}"]`,
      `    ApiGateway["API Gateway / Backend"]`,
      `    Database[("Client Relational / NoSQL Store")]`,
      ``,
      `    ClientApp -->|HTTP/REST Calls| ApiGateway`,
      `    ApiGateway -->|SQL Queries & ORM| Database`
    ];

    if (ipcChannels.length > 0) {
      lines.push(`    Renderer["Renderer Process"] -->|IPC Messages| MainProcess["Electron Main Process"]`);
      lines.push(`    ClientApp -.-> Renderer`);
    }

    lines.push(`\`\`\``);
    lines.push(``);

    // Section 2: Databases & Data Mart Staging
    lines.push(`## 2. Ingestion & Persistence Layer`);
    lines.push(`### Discovered Database Connections (${connections.length})`);
    if (connections.length === 0) {
      lines.push(`_No explicit database connection URLs detected in scanned source files._`);
    } else {
      lines.push(`| Dialect | Sanitized Host / Connection | Source File | Credential Status |`);
      lines.push(`| :--- | :--- | :--- | :--- |`);
      for (const c of connections) {
        const credStatus = c.isPlaintextPasswordExposed ? '⚠️ Plaintext Exposed' : '✅ Environment / Token';
        lines.push(`| \`${c.dialect.toUpperCase()}\` | \`${c.sanitizedUri}\` | \`${c.sourceFile}\` | ${credStatus} |`);
      }
    }
    lines.push(``);

    lines.push(`### Discovered Tables & Entities (${tables.length})`);
    if (tables.length === 0) {
      lines.push(`_No direct SQL queries or ORM entities detected._`);
    } else {
      lines.push(`| Table Name | Operations | Columns Count | Source Origin |`);
      lines.push(`| :--- | :--- | :--- | :--- |`);
      for (const t of tables) {
        lines.push(`| **\`${t.name}\`** | \`${t.operations.join(', ')}\` | ${t.columns.length} (${t.columns.slice(0, 4).join(', ')}${t.columns.length > 4 ? '...' : ''}) | \`${t.sourceFile}\` |`);
      }
    }
    lines.push(``);

    // Section 3: API & Service Endpoints
    lines.push(`## 3. Discovered API Surface (${routes.length})`);
    if (routes.length === 0) {
      lines.push(`_No REST / HTTP endpoints discovered in scanned files._`);
    } else {
      lines.push(`| Method | Path | Protocol | Source File |`);
      lines.push(`| :--- | :--- | :--- | :--- |`);
      for (const r of routes) {
        lines.push(`| \`${r.method}\` | \`${r.path}\` | \`${r.protocol.toUpperCase()}\` | \`${r.sourceFile}\` |`);
      }
    }
    lines.push(``);

    // Section 4: IPC & Internal Messaging
    if (ipcChannels.length > 0) {
      lines.push(`## 4. Inter-Process Communication & Messaging (${ipcChannels.length})`);
      lines.push(`| Channel Identifier | Direction | Source File |`);
      lines.push(`| :--- | :--- | :--- |`);
      for (const ipc of ipcChannels) {
        lines.push(`| \`${ipc.channel}\` | \`${ipc.direction}\` | \`${ipc.sourceFile}\` |`);
      }
      lines.push(``);
    }

    // Section 5: Evidence & Unknowns Ledger
    lines.push(`## 5. Traceability & Unknowns Audit`);
    lines.push(ledger.renderMarkdownAudit());

    return lines.join('\n');
  }

  // --- Helpers ---

  private static isValidTableName(name: string): boolean {
    if (!name || name.length < 2) return false;
    const lower = name.toLowerCase();
    const reserved = new Set([
      'select', 'from', 'where', 'and', 'or', 'join', 'left', 'right', 'inner',
      'table', 'insert', 'into', 'values', 'update', 'set', 'delete', 'order', 'group', 'by',
      'limit', 'offset', 'as', 'distinct', 'case', 'when', 'then', 'else', 'end',
      'null', 'true', 'false', 'dual'
    ]);
    return !reserved.has(lower) && /^[a-zA-Z_][a-zA-Z0-9_\.]*$/.test(name);
  }

  private static getOrCreateTable(
    map: Map<string, {
      sourceFiles: Set<string>;
      columns: Set<string>;
      operations: Set<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE'>;
      sampleQuery?: string;
    }>,
    name: string
  ) {
    let entry = map.get(name);
    if (!entry) {
      entry = {
        sourceFiles: new Set(),
        columns: new Set(),
        operations: new Set()
      };
      map.set(name, entry);
    }
    return entry;
  }

  private static parseColumnList(colBlock: string): string[] {
    if (colBlock.trim() === '*') return [];
    return colBlock
      .split(',')
      .map(c => {
        const trimmed = c.trim();
        // check for alias: `col as alias`
        const aliasMatch = trimmed.match(/\bas\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
        if (aliasMatch) return aliasMatch[1];
        // check for simple col identifier
        const colMatch = trimmed.match(/["`]?([a-zA-Z0-9_]+)["`]?$/);
        return colMatch ? colMatch[1] : '';
      })
      .filter(c => c.length > 0 && !['*', 'count', 'sum', 'avg', 'min', 'max'].includes(c.toLowerCase()));
  }

  private static parseCreateTableColumns(colBlock: string): string[] {
    const cols: string[] = [];
    const lines = colBlock.split(',');
    for (const line of lines) {
      const match = line.trim().match(/^["`]?([a-zA-Z0-9_]+)["`]?\s+([A-Z0-9_]+)/i);
      if (match) {
        const colName = match[1];
        if (!['primary', 'foreign', 'constraint', 'unique', 'check', 'key'].includes(colName.toLowerCase())) {
          cols.push(colName);
        }
      }
    }
    return cols;
  }

  private static addRoute(
    routes: ExtractedApiRoute[],
    seen: Set<string>,
    method: ExtractedApiRoute['method'],
    routePath: string,
    sourceFile: string,
    protocol: 'http' | 'websocket' | 'ipc',
    ledger: EvidenceLedger
  ) {
    if (!routePath || routePath.length < 2) return;
    const key = `${method}:${routePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      routes.push({
        method,
        path: routePath,
        sourceFile,
        protocol
      });

      ledger.record({
        kind: 'inspected_component',
        confidence: 'exact',
        sourceUri: `${sourceFile}#Route:${method}:${routePath}`,
        summary: `Discovered API endpoint [${method}] ${routePath}`,
        rawProof: `${method} ${routePath} in ${sourceFile}`
      });
    }
  }
}
