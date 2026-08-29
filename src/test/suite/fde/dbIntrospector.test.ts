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
});
