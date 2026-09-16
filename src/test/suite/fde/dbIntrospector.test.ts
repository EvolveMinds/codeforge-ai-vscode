import * as assert from 'assert';
import { DbIntrospector } from '../../../fde/dbIntrospector';

suite('FDE Suite — DbIntrospector', () => {
  test('parses information_schema rows into structured table definitions', () => {
    const sampleRows = [
      { table_name: 'orders', column_name: 'order_id', data_type: 'character varying', is_nullable: 'NO' },
      { table_name: 'orders', column_name: 'customer_id', data_type: 'bigint', is_nullable: 'NO' },
      { table_name: 'orders', column_name: 'amount', data_type: 'numeric', is_nullable: 'YES' },
      { table_name: 'orders', column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { table_name: 'users', column_name: 'user_id', data_type: 'integer', is_nullable: 'NO' },
      { table_name: 'users', column_name: 'email', data_type: 'varchar', is_nullable: 'NO' },
    ];

    const tables = DbIntrospector.parseInformationSchemaRows(sampleRows, 'public');
    assert.strictEqual(tables.length, 2);

    const orders = tables.find(t => t.tableName === 'orders')!;
    assert.ok(orders);
    assert.strictEqual(orders.columns.length, 4);
    assert.strictEqual(orders.columns[0].name, 'order_id');
    assert.strictEqual(orders.columns[0].type, 'string');
    assert.strictEqual(orders.columns[1].name, 'customer_id');
    assert.strictEqual(orders.columns[1].type, 'integer');
    assert.strictEqual(orders.columns[2].name, 'amount');
    assert.strictEqual(orders.columns[2].type, 'numeric');
    assert.strictEqual(orders.columns[3].name, 'created_at');
    assert.strictEqual(orders.columns[3].type, 'timestamp');
    assert.strictEqual(orders.columnsFormatted, 'order_id:string\ncustomer_id:integer\namount:numeric\ncreated_at:timestamp');

    const users = tables.find(t => t.tableName === 'users')!;
    assert.ok(users);
    assert.strictEqual(users.columns.length, 2);
    assert.strictEqual(users.columns[1].name, 'email');
    assert.strictEqual(users.columns[1].type, 'string');
  });

  test('normalizes raw SQL types correctly across dialects', () => {
    assert.strictEqual(DbIntrospector.normalizeSqlType('VARCHAR(255)'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('TEXT'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('INT8'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('BIGSERIAL'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('NUMERIC(10,2)'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('DOUBLE PRECISION'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('BOOLEAN'), 'boolean');
    assert.strictEqual(DbIntrospector.normalizeSqlType('TIMESTAMPTZ'), 'timestamp');
    assert.strictEqual(DbIntrospector.normalizeSqlType('DATE'), 'timestamp');
    assert.strictEqual(DbIntrospector.normalizeSqlType('JSONB'), 'json');
  });

  test('parses connection URI into host, port, database, and user', () => {
    const uri = 'postgresql://admin_user:secret_pass@db.client-vpc.internal:5432/pilot_analytics';
    const parsed = DbIntrospector.parseConnectionUri(uri);

    assert.strictEqual(parsed.host, 'db.client-vpc.internal');
    assert.strictEqual(parsed.port, 5432);
    assert.strictEqual(parsed.database, 'pilot_analytics');
    assert.strictEqual(parsed.username, 'admin_user');
  });

  test('extracts database settings from .env file content', () => {
    const envSample = `
      # Client Pilot Configuration
      NODE_ENV=production
      DATABASE_URL=postgresql://fde_user:enc_pass123@prod-db.acme.corp:5432/enterprise_dw
      PORT=8080
    `;

    const detected = DbIntrospector.parseEnvForDb(envSample);
    assert.strictEqual(detected.found, true);
    assert.strictEqual(detected.dialect, 'postgres');
    assert.strictEqual(detected.database, 'enterprise_dw');
    assert.strictEqual(detected.host, 'prod-db.acme.corp');
    assert.strictEqual(detected.username, 'fde_user');
  });

  test('generates valid INFORMATION_SCHEMA SQL query', () => {
    const sql = DbIntrospector.getInformationSchemaSql('custom_schema');
    assert.ok(sql.includes("table_schema = 'custom_schema'"));
    assert.ok(sql.includes('information_schema.columns'));
  });

  test('parses SQLite CREATE TABLE DDL into column definitions', () => {
    const sqliteDdl = `
      CREATE TABLE orders (
        order_id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        created_at DATETIME
      );
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT
      );
    `;

    const tables = DbIntrospector.parseSqliteSchemaDdl(sqliteDdl);
    assert.strictEqual(tables.length, 2);
    assert.strictEqual(tables[0].tableName, 'orders');
    assert.strictEqual(tables[0].columns.length, 3);
    assert.strictEqual(tables[0].columns[1].name, 'amount');
    assert.strictEqual(tables[0].columns[1].type, 'numeric');
  });

  test('extracts database settings from component variables in .env (DB_HOST, DB_USER, etc.)', () => {
    const envSample = `
      DB_HOST=aws-rds.client.internal
      DB_PORT=5432
      DB_NAME=taxiq_prod
      DB_USER=app_service
      DB_PASSWORD=SecurePass!2026
      DB_SCHEMA=analytics
    `;

    const detected = DbIntrospector.parseEnvForDb(envSample);
    assert.strictEqual(detected.found, true);
    assert.strictEqual(detected.dialect, 'postgres');
    assert.strictEqual(detected.database, 'taxiq_prod');
    assert.strictEqual(detected.host, 'aws-rds.client.internal');
    assert.strictEqual(detected.port, 5432);
    assert.strictEqual(detected.username, 'app_service');
    assert.strictEqual(detected.password, 'SecurePass!2026');
    assert.strictEqual(detected.schema, 'analytics');
    assert.ok(detected.connectionUri?.includes('aws-rds.client.internal:5432/taxiq_prod'));
  });

  test('extracts Supabase / Prisma DIRECT_URL with schema search parameter', () => {
    const envSample = `
      NEXT_PUBLIC_SUPABASE_URL=https://abcxyz123.supabase.co
      DIRECT_URL="postgresql://postgres:secret_supa_pass@db.abcxyz123.supabase.co:5432/postgres?sslmode=require&schema=custom_tenant"
    `;

    const detected = DbIntrospector.parseEnvForDb(envSample);
    assert.strictEqual(detected.found, true);
    assert.strictEqual(detected.dialect, 'postgres');
    assert.strictEqual(detected.database, 'postgres');
    assert.strictEqual(detected.host, 'db.abcxyz123.supabase.co');
    assert.strictEqual(detected.username, 'postgres');
    assert.strictEqual(detected.password, 'secret_supa_pass');
    assert.strictEqual(detected.schema, 'custom_tenant');
  });

  // --- ORACLE ENTERPRISE TESTS ---
  test('normalizes Oracle SQL data types correctly', () => {
    assert.strictEqual(DbIntrospector.normalizeSqlType('VARCHAR2(100)'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('NVARCHAR2(50)'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('CLOB'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('NCLOB'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('NUMBER(10,2)'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('NUMBER(18,0)'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('NUMBER'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('BINARY_DOUBLE'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('RAW(16)'), 'binary');
    assert.strictEqual(DbIntrospector.normalizeSqlType('BLOB'), 'binary');
  });

  test('parses Oracle connection URIs (standard & JDBC thin syntax)', () => {
    const stdUri = 'oracle://system:Mgr2026!@oracledb.corp.internal:1521/ORCLPDB1';
    const parsedStd = DbIntrospector.parseConnectionUri(stdUri);
    assert.strictEqual(parsedStd.host, 'oracledb.corp.internal');
    assert.strictEqual(parsedStd.port, 1521);
    assert.strictEqual(parsedStd.database, 'ORCLPDB1');
    assert.strictEqual(parsedStd.username, 'system');
    assert.strictEqual(parsedStd.password, 'Mgr2026!');

    const jdbcUri = 'jdbc:oracle:thin:@oracledb.corp.internal:1521/ORCLPDB1';
    const parsedJdbc = DbIntrospector.parseConnectionUri(jdbcUri);
    assert.strictEqual(parsedJdbc.host, 'oracledb.corp.internal');
    assert.strictEqual(parsedJdbc.port, 1521);
    assert.strictEqual(parsedJdbc.database, 'ORCLPDB1');
  });

  test('detects Oracle configurations from .env environment variables', () => {
    const envSample = `
      ORACLE_HOST=oracledw.enterprise.bank
      ORACLE_PORT=1521
      ORACLE_SERVICE_NAME=EDW_FIN_PDB
      ORACLE_USER=fin_etl_user
      ORACLE_PASSWORD=SecretWallet123
      TNS_ADMIN=/opt/oracle/network/admin
    `;

    const detected = DbIntrospector.parseEnvForDb(envSample);
    assert.strictEqual(detected.found, true);
    assert.strictEqual(detected.dialect, 'oracle');
    assert.strictEqual(detected.host, 'oracledw.enterprise.bank');
    assert.strictEqual(detected.port, 1521);
    assert.strictEqual(detected.database, 'EDW_FIN_PDB');
    assert.strictEqual(detected.username, 'fin_etl_user');
    assert.strictEqual(detected.password, 'SecretWallet123');
    assert.strictEqual(detected.tnsAdmin, '/opt/oracle/network/admin');
  });

  test('generates high-fidelity Oracle fallback schema tables', () => {
    const tables = DbIntrospector.generateOracleFallbackTables('CUSTOMER_MASTER');
    assert.strictEqual(tables.length, 3);
    const cust = tables.find(t => t.tableName === 'CUSTOMER_MASTER_EDW')!;
    assert.ok(cust);
    assert.ok(cust.columns.some(c => c.name === 'CUST_ID' && c.type === 'integer'));
    assert.ok(cust.columns.some(c => c.name === 'ANNUAL_REVENUE' && c.type === 'numeric'));
    assert.ok(cust.columns.some(c => c.name === 'PARTY_NAME' && c.type === 'string'));
  });

  // --- TERADATA EDW & GDW TESTS ---
  test('normalizes Teradata DBC 1-2 char type codes and native types', () => {
    // DBC.ColumnsV 1-2 char codes
    assert.strictEqual(DbIntrospector.normalizeSqlType('CV'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('CF'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('I'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('I1'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('I2'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('I8'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('D'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('F'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('DA'), 'timestamp');
    assert.strictEqual(DbIntrospector.normalizeSqlType('TS'), 'timestamp');
    assert.strictEqual(DbIntrospector.normalizeSqlType('JN'), 'json');

    // Standard Teradata Keywords
    assert.strictEqual(DbIntrospector.normalizeSqlType('BYTEINT'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('DECIMAL(18,4)'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('PERIOD(DATE)'), 'timestamp');
  });

  test('parses Teradata connection URIs (standard & JDBC syntax)', () => {
    const stdUri = 'teradata://dbc_app:Pass987@edwcop1.corp.internal:1025/edw_retail';
    const parsedStd = DbIntrospector.parseConnectionUri(stdUri);
    assert.strictEqual(parsedStd.host, 'edwcop1.corp.internal');
    assert.strictEqual(parsedStd.port, 1025);
    assert.strictEqual(parsedStd.database, 'edw_retail');
    assert.strictEqual(parsedStd.username, 'dbc_app');
    assert.strictEqual(parsedStd.password, 'Pass987');

    const jdbcUri = 'jdbc:teradata://gdwcop1.corp.internal/DBS_PORT=1025,DATABASE=financial_gdw';
    const parsedJdbc = DbIntrospector.parseConnectionUri(jdbcUri);
    assert.strictEqual(parsedJdbc.host, 'gdwcop1.corp.internal');
    assert.strictEqual(parsedJdbc.port, 1025);
    assert.strictEqual(parsedJdbc.database, 'financial_gdw');
  });

  test('detects Teradata configurations from .env environment variables', () => {
    const envSample = `
      TDPID=teradata-prod.dw.corp
      TERADATA_PORT=1025
      TERADATA_DATABASE=GDW_ENTERPRISE
      TERADATA_USER=fde_dw_service
      TERADATA_PASSWORD=VaultAliasToken
      TERADATA_ACCOUNT=$M$EDW_PRIORITY
    `;

    const detected = DbIntrospector.parseEnvForDb(envSample);
    assert.strictEqual(detected.found, true);
    assert.strictEqual(detected.dialect, 'teradata');
    assert.strictEqual(detected.host, 'teradata-prod.dw.corp');
    assert.strictEqual(detected.port, 1025);
    assert.strictEqual(detected.database, 'GDW_ENTERPRISE');
    assert.strictEqual(detected.username, 'fde_dw_service');
    assert.strictEqual(detected.accountString, '$M$EDW_PRIORITY');
  });

  test('generates high-fidelity Teradata EDW & GDW fallback schema tables', () => {
    const tables = DbIntrospector.generateTeradataFallbackTables('CUSTOMER');
    assert.strictEqual(tables.length, 3);
    const dim = tables.find(t => t.tableName === 'EDW_CUSTOMER_PARTY_DIM')!;
    assert.ok(dim);
    assert.ok(dim.columns.some(c => c.name === 'PARTY_ID' && c.type === 'integer'));
    assert.ok(dim.columns.some(c => c.name === 'TOTAL_ASSETS_AMT' && c.type === 'numeric'));
    assert.ok(dim.columns.some(c => c.name === 'SYS_EFFECTIVE_TS' && c.type === 'timestamp'));
  });

  // --- IBM DB2 (LUW & z/OS MAINFRAME) TESTS ---
  test('normalizes IBM DB2 data types correctly', () => {
    assert.strictEqual(DbIntrospector.normalizeSqlType('VARGRAPHIC(255)'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('GRAPHIC(10)'), 'string');
    assert.strictEqual(DbIntrospector.normalizeSqlType('XML'), 'json');
    assert.strictEqual(DbIntrospector.normalizeSqlType('DECFLOAT(34)'), 'numeric');
    assert.strictEqual(DbIntrospector.normalizeSqlType('SMALLINT'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('BIGINT'), 'integer');
    assert.strictEqual(DbIntrospector.normalizeSqlType('TIMESTAMPTZ'), 'timestamp');
  });

  test('parses IBM DB2 connection URIs (LUW port 50000 & z/OS DRDA port 446)', () => {
    const luwUri = 'db2://db2inst1:IbmPass2026@db2luw.bank.internal:50000/SAMPLE';
    const parsedLuw = DbIntrospector.parseConnectionUri(luwUri);
    assert.strictEqual(parsedLuw.host, 'db2luw.bank.internal');
    assert.strictEqual(parsedLuw.port, 50000);
    assert.strictEqual(parsedLuw.database, 'SAMPLE');
    assert.strictEqual(parsedLuw.username, 'db2inst1');

    const zosUri = 'jdbc:db2://mainframe-drda.bank.internal:446/DSNA';
    const parsedZos = DbIntrospector.parseConnectionUri(zosUri);
    assert.strictEqual(parsedZos.host, 'mainframe-drda.bank.internal');
    assert.strictEqual(parsedZos.port, 446);
    assert.strictEqual(parsedZos.database, 'DSNA');
  });

  test('detects IBM DB2 configurations from .env environment variables', () => {
    const envSample = `
      DB2_HOST=db2zos-prod.main.corp
      DB2_PORT=446
      DB2_DATABASE=DSNA
      DB2_USER=cif_batch_usr
      DB2_PASSWORD=MainframeRacfPass
      DB2_SUBSYSTEM=DSNA
    `;

    const detected = DbIntrospector.parseEnvForDb(envSample);
    assert.strictEqual(detected.found, true);
    assert.strictEqual(detected.dialect, 'db2');
    assert.strictEqual(detected.host, 'db2zos-prod.main.corp');
    assert.strictEqual(detected.port, 446);
    assert.strictEqual(detected.database, 'DSNA');
    assert.strictEqual(detected.username, 'cif_batch_usr');
    assert.strictEqual(detected.db2SubsystemLocation, 'DSNA');
  });

  test('generates high-fidelity IBM DB2 fallback schema tables', () => {
    const tables = DbIntrospector.generateDb2FallbackTables('LEDGER');
    assert.strictEqual(tables.length, 3);
    const ledger = tables.find(t => t.tableName === 'DB2_CORE_BANKING_LEDGER')!;
    assert.ok(ledger);
    assert.ok(ledger.columns.some(c => c.name === 'ACCT_NBR' && c.type === 'integer'));
    assert.ok(ledger.columns.some(c => c.name === 'CURR_BAL' && c.type === 'numeric'));
    assert.ok(ledger.columns.some(c => c.name === 'LAST_TXN_TS' && c.type === 'timestamp'));
  });

  // --- INTROSPECT & CONNECTION TESTING FOR ORACLE, TERADATA, DB2 ---
  test('introspects Oracle with fallback schema generation', async () => {
    const res = await DbIntrospector.introspect({
      dialect: 'oracle',
      connectionUri: 'oracle://system:manager@localhost:1521/ORCLPDB1',
      schema: 'SYSTEM',
      database: 'ORCLPDB1',
    });

    assert.ok(res.tables.length > 0);
    assert.strictEqual(res.dialect, 'oracle');
    assert.ok(res.tables.some(t => t.tableName.includes('EDW') || t.tableName.includes('CUSTOMER') || t.tableName.includes('GL')));
  });

  test('introspects Teradata with fallback schema generation', async () => {
    const res = await DbIntrospector.introspect({
      dialect: 'teradata',
      connectionUri: 'teradata://dbc:dbc@localhost:1025/edw_db',
      schema: 'EDW_SCHEMA',
      database: 'edw_db',
    });

    assert.ok(res.tables.length > 0);
    assert.strictEqual(res.dialect, 'teradata');
    assert.ok(res.tables.some(t => t.tableName.includes('EDW') || t.tableName.includes('GDW')));
  });

  test('introspects DB2 with fallback schema generation', async () => {
    const res = await DbIntrospector.introspect({
      dialect: 'db2',
      connectionUri: 'db2://db2inst1:password@localhost:50000/sample',
      schema: 'DB2INST1',
      database: 'SAMPLE',
    });

    assert.ok(res.tables.length > 0);
    assert.strictEqual(res.dialect, 'db2');
    assert.ok(res.tables.some(t => t.tableName.includes('DB2_') || t.tableName.includes('LEDGER')));
  });

  test('tests connection reachability without throwing unhandled exceptions', async () => {
    const res = await DbIntrospector.testConnection({
      dialect: 'oracle',
      connectionUri: 'oracle://user:pass@127.0.0.1:59999/dummy',
    });

    // Should return structured response even when host port is closed
    assert.strictEqual(typeof res.success, 'boolean');
    assert.ok(res.message || res.error);
    assert.strictEqual(typeof res.latencyMs, 'number');
  });
});
