import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AppIntrospector } from '../../../fde/appIntrospector';
import { EvidenceLedger } from '../../../fde/provenance';

suite('FDE Suite — AppIntrospector & Automated Architecture Synthesis', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-app-introspect-'));
  });

  teardown(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('extracts database connections, redacts passwords, and records evidence', async () => {
    const ledger = new EvidenceLedger();
    const serverFile = path.join(tmpDir, 'dbConfig.ts');
    fs.writeFileSync(serverFile, `
      // Database connection setup
      const pgUrl = 'postgres://admin:SuperSecret123@db.prod.internal:5432/finance_db';
      const mssqlUrl = 'Server=sql01.corp.local;Database=WarehouseDb;User Id=sa;Password=CompanyPassword99!;';
    `);

    const result = await AppIntrospector.introspect({
      targetPath: tmpDir,
      appName: 'BillingService',
      ledger
    });

    assert.strictEqual(result.connections.length, 2);

    const pgConn = result.connections.find(c => c.dialect === 'postgres');
    assert.ok(pgConn);
    assert.strictEqual(pgConn.database, 'finance_db');
    assert.strictEqual(pgConn.sanitizedUri, 'postgres://admin:***@db.prod.internal:5432/finance_db');
    assert.strictEqual(pgConn.isPlaintextPasswordExposed, true);

    const mssqlConn = result.connections.find(c => c.dialect === 'mssql');
    assert.ok(mssqlConn);
    assert.strictEqual(mssqlConn.database, 'WarehouseDb');
    assert.ok(mssqlConn.sanitizedUri.includes('Password=***;'));

    // Check evidence was anchored
    const records = ledger.getAll();
    assert.ok(records.some(r => r.kind === 'schema_introspection' && r.summary.includes('finance_db')));

    // Check unknown was registered for plaintext password exposure
    const unknowns = ledger.getUnknowns();
    assert.ok(unknowns.some(u => u.target.includes('Plaintext Credential Exposure')));
  });

  test('extracts SQL queries, tables, and ORM entities', async () => {
    const ledger = new EvidenceLedger();
    const serviceFile = path.join(tmpDir, 'orderRepository.ts');
    fs.writeFileSync(serviceFile, `
      async function getRecentOrders() {
        return await db.query('SELECT id, customer_id, total_amount, created_at FROM orders WHERE status = $1', ['PAID']);
      }

      async function insertOrder() {
        return await db.query('INSERT INTO orders (id, total_amount) VALUES ($1, $2)');
      }
    `);

    const schemaFile = path.join(tmpDir, 'schema.prisma');
    fs.writeFileSync(schemaFile, `
      model CustomerAccount {
        id          String   @id @default(uuid())
        email       String   @unique
        balance     Float
        createdAt   DateTime @default(now())
      }
    `);

    const result = await AppIntrospector.introspect({
      targetPath: tmpDir,
      ledger
    });

    assert.ok(result.tables.length >= 2);

    const ordersTable = result.tables.find(t => t.name.toLowerCase() === 'orders');
    assert.ok(ordersTable);
    assert.ok(ordersTable.operations.includes('SELECT'));
    assert.ok(ordersTable.operations.includes('INSERT'));
    assert.ok(ordersTable.columns.includes('customer_id'));
    assert.ok(ordersTable.columns.includes('total_amount'));

    const customerModel = result.tables.find(t => t.name === 'CustomerAccount');
    assert.ok(customerModel);
    assert.ok(customerModel.columns.includes('email'));
    assert.ok(customerModel.columns.includes('balance'));
  });

  test('extracts REST API routes and Electron IPC channels', async () => {
    const ledger = new EvidenceLedger();
    const routeFile = path.join(tmpDir, 'appRoutes.ts');
    fs.writeFileSync(routeFile, `
      import express from 'express';
      const app = express();

      app.get('/api/v1/invoices', (req, res) => res.json([]));
      app.post('/api/v1/invoices/pay', (req, res) => res.json({ success: true }));
      app.delete('/api/v1/invoices/:id', (req, res) => res.sendStatus(204));
    `);

    const ipcFile = path.join(tmpDir, 'mainElectron.ts');
    fs.writeFileSync(ipcFile, `
      import { ipcMain } from 'electron';
      ipcMain.handle('print-receipt', async (event, args) => {
        return { printed: true };
      });
      ipcRenderer.send('window-minimize');
    `);

    const result = await AppIntrospector.introspect({
      targetPath: tmpDir,
      ledger
    });

    assert.strictEqual(result.routes.length, 3);
    assert.ok(result.routes.some(r => r.method === 'GET' && r.path === '/api/v1/invoices'));
    assert.ok(result.routes.some(r => r.method === 'POST' && r.path === '/api/v1/invoices/pay'));
    assert.ok(result.routes.some(r => r.method === 'DELETE' && r.path === '/api/v1/invoices/:id'));

    assert.strictEqual(result.ipcChannels.length, 2);
    assert.ok(result.ipcChannels.some(ipc => ipc.channel === 'print-receipt' && ipc.direction === 'main-to-renderer'));
    assert.ok(result.ipcChannels.some(ipc => ipc.channel === 'window-minimize' && ipc.direction === 'renderer-to-main'));
  });

  test('auto-generates dbt staging models and sources.yml', async () => {
    const tables = [
      {
        name: 'customer_transactions',
        sourceFile: 'repo/tx.sql',
        columns: ['transaction_id', 'account_id', 'amount', 'transaction_date'],
        operations: ['SELECT' as const]
      }
    ];

    const { dbtModels, dbtSourcesYaml } = AppIntrospector.generateDbtAssets(tables, 'bank_core');

    assert.strictEqual(dbtModels.length, 1);
    assert.strictEqual(dbtModels[0].filePath, 'models/staging/bank_core/stg_bank_core__customer_transactions.sql');
    assert.ok(dbtModels[0].sqlContent.includes("{{ source('bank_core', 'customer_transactions') }}"));
    assert.ok(dbtModels[0].sqlContent.includes('cast(transaction_id as {{ dbt.type_string() }})'));
    assert.ok(dbtModels[0].sqlContent.includes('cast(transaction_date as {{ dbt.type_timestamp() }})'));

    assert.ok(dbtSourcesYaml.includes('name: bank_core'));
    assert.ok(dbtSourcesYaml.includes('name: customer_transactions'));
    assert.ok(dbtSourcesYaml.includes('- unique'));
    assert.ok(dbtSourcesYaml.includes('- not_null'));
  });

  test('auto-generates TypeScript and Python resilient SDK connectors', async () => {
    const routes = [
      { method: 'GET' as const, path: '/api/v2/orders', sourceFile: 'controllers/order.ts', protocol: 'http' as const },
      { method: 'POST' as const, path: '/api/v2/orders/cancel', sourceFile: 'controllers/order.ts', protocol: 'http' as const }
    ];

    const { typescriptSdk, pythonSdk } = AppIntrospector.generateConnectors('OrderManager', routes);

    assert.ok(typescriptSdk.includes('class OrderManagerClient'));
    assert.ok(typescriptSdk.includes('async getOrders'));
    assert.ok(typescriptSdk.includes('async postOrdersCancel'));
    assert.ok(typescriptSdk.includes('maxRetries'));

    assert.ok(pythonSdk.includes('class OrderManagerClient:'));
    assert.ok(pythonSdk.includes('def getorders'));
    assert.ok(pythonSdk.includes('def postorderscancel'));
  });

  test('synthesizes Architecture Blueprint with Mermaid diagram and audit trail', async () => {
    const ledger = new EvidenceLedger();
    const appFile = path.join(tmpDir, 'server.js');
    fs.writeFileSync(appFile, `
      const dbUrl = 'postgres://app:pw@localhost:5432/appdb';
      app.get('/api/health', (req, res) => res.send('OK'));
      db.query('SELECT id, name FROM users');
    `);

    const result = await AppIntrospector.introspect({
      targetPath: tmpDir,
      appName: 'InventorySystem',
      ledger
    });

    const doc = result.architectureBlueprint;
    assert.ok(doc.includes('# System Architecture & Integration Blueprint: InventorySystem'));
    assert.ok(doc.includes('```mermaid'));
    assert.ok(doc.includes('flowchart TD'));
    assert.ok(doc.includes('Client Application: InventorySystem'));
    assert.ok(doc.includes('`POSTGRES`'));
    assert.ok(doc.includes('users'));
    assert.ok(doc.includes('/api/health'));
    assert.ok(doc.includes('## 5. Traceability & Unknowns Audit'));
  });

  test('flags dynamic string concatenation in SQL queries as unknown', async () => {
    const ledger = new EvidenceLedger();
    const vulnerableFile = path.join(tmpDir, 'dynamicQuery.ts');
    fs.writeFileSync(vulnerableFile, `
      function fetchCustom(table: string) {
        return db.query("SELECT * FROM " + table + " WHERE active = 1");
      }
    `);

    await AppIntrospector.introspect({
      targetPath: tmpDir,
      ledger
    });

    const unknowns = ledger.getUnknowns();
    const dynamicSqlUnknown = unknowns.find(u => u.target.includes('Dynamic SQL String Construction'));
    assert.ok(dynamicSqlUnknown, 'Expected dynamic SQL unknown to be recorded');
    assert.strictEqual(dynamicSqlUnknown.severity, 'warning');
    assert.ok(dynamicSqlUnknown.remediation.includes('parameterized queries'));
  });
});
