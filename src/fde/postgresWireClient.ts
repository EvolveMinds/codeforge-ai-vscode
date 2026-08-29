/**
 * fde/postgresWireClient.ts — Zero-Dependency PostgreSQL & Supabase Wire Introspector
 *
 * Implements native PostgreSQL v3 protocol client over Node.js TCP/TLS sockets
 * and Supabase PostgREST OpenAPI schema extractor.
 * Requires 0 external npm binaries.
 */

import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'crypto';
import * as https from 'https';
import { DbTableMeta, DbColumnMeta, DbIntrospector } from './dbIntrospector';

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl?: boolean;
  timeoutMs?: number;
}

export interface PostgresQueryResult {
  success: boolean;
  rows: Array<Record<string, string>>;
  serverVersion?: string;
  error?: string;
  latencyMs?: number;
}

export class PostgresWireClient {
  /**
   * Introspects tables from Supabase via PostgREST OpenAPI endpoint (HTTPS).
   */
  static async introspectSupabaseRest(
    projectRef: string,
    apiKey: string,
    schema = 'public'
  ): Promise<{ success: boolean; tables: DbTableMeta[]; error?: string }> {
    return new Promise((resolve) => {
      const url = `https://${projectRef}.supabase.co/rest/v1/?apikey=${apiKey}`;
      const req = https.get(url, { headers: { 'Accept': 'application/openapi+json', 'apikey': apiKey } }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          resolve({ success: false, tables: [], error: `Supabase PostgREST returned HTTP ${res.statusCode}` });
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const spec = JSON.parse(data);
            const tables: DbTableMeta[] = [];
            const defs = spec.definitions || spec.components?.schemas || {};

            for (const [tblName, def] of Object.entries<any>(defs)) {
              const props = def.properties || {};
              const requiredCols = new Set(def.required || []);
              const columns: DbColumnMeta[] = [];

              for (const [colName, colDef] of Object.entries<any>(props)) {
                const rawType = colDef.format || colDef.type || 'string';
                columns.push({
                  name: colName,
                  type: DbIntrospector.normalizeSqlType(rawType),
                  isNullable: !requiredCols.has(colName),
                  comment: colDef.description,
                });
              }

              tables.push({
                tableName: tblName,
                schema,
                columns,
                columnsFormatted: columns.map(c => `${c.name}:${c.type}`).join('\n'),
              });
            }

            tables.sort((a, b) => a.tableName.localeCompare(b.tableName));
            resolve({ success: tables.length > 0, tables });
          } catch (e: any) {
            resolve({ success: false, tables: [], error: `Failed to parse Supabase schema: ${e?.message || e}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, tables: [], error: `Supabase connection error: ${err.message}` });
      });
      req.setTimeout(8000, () => {
        req.destroy();
        resolve({ success: false, tables: [], error: 'Supabase connection timed out' });
      });
    });
  }

  /**
   * Tests raw TCP/TLS connection handshake to a PostgreSQL server.
   */
  static async testConnection(cfg: PostgresConnectionConfig): Promise<{ success: boolean; latencyMs: number; message: string; error?: string }> {
    const start = Date.now();
    const queryRes = await this.query(cfg, 'SELECT version() AS version;');
    const latencyMs = Date.now() - start;

    if (queryRes.success) {
      const ver = queryRes.rows[0]?.version || 'PostgreSQL';
      return {
        success: true,
        latencyMs,
        message: `✓ Connected to PostgreSQL in ${latencyMs}ms (${ver.split(' on ')[0]})`,
      };
    } else {
      return {
        success: false,
        latencyMs,
        message: `Connection failed: ${queryRes.error}`,
        error: queryRes.error,
      };
    }
  }

  /**
   * Runs a SQL query over pure Node TCP/TLS socket using PostgreSQL v3 wire protocol.
   */
  static async query(cfg: PostgresConnectionConfig, sql: string): Promise<PostgresQueryResult> {
    const start = Date.now();
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (res: PostgresQueryResult) => {
        if (!resolved) {
          resolved = true;
          try { socket?.destroy(); } catch {}
          resolve({ ...res, latencyMs: Date.now() - start });
        }
      };

      const timeout = setTimeout(() => {
        finish({ success: false, rows: [], error: `Connection timed out after ${cfg.timeoutMs || 8000}ms` });
      }, cfg.timeoutMs || 8000);

      let socket: net.Socket;
      let fields: string[] = [];
      const rows: Array<Record<string, string>> = [];
      let serverVersion = '';

      try {
        socket = net.connect({ host: cfg.host, port: cfg.port }, () => {
          // Send SSLRequest: length 8, code 80877103
          const sslReq = Buffer.alloc(8);
          sslReq.writeInt32BE(8, 0);
          sslReq.writeInt32BE(80877103, 4);
          socket.write(sslReq);
        });
      } catch (err: any) {
        clearTimeout(timeout);
        return finish({ success: false, rows: [], error: `Socket creation failed: ${err.message}` });
      }

      let sslHandshakeComplete = false;
      let authenticated = false;

      socket.once('error', (err) => {
        clearTimeout(timeout);
        finish({ success: false, rows: [], error: `Socket error (${cfg.host}:${cfg.port}): ${err.message}` });
      });

      socket.on('data', (chunk) => {
        try {
          if (!sslHandshakeComplete) {
            // First byte is SSL response ('S' or 'N')
            const sslResp = chunk.toString('utf8', 0, 1);
            if (sslResp === 'S') {
              // Upgrade to TLS
              const secureSocket = tls.connect({
                socket,
                servername: cfg.host,
                rejectUnauthorized: false,
              }, () => {
                this.sendStartupPacket(secureSocket, cfg);
              });

              socket = secureSocket;
              secureSocket.on('data', handlePacket);
              secureSocket.once('error', (err) => {
                clearTimeout(timeout);
                finish({ success: false, rows: [], error: `TLS Handshake Error: ${err.message}` });
              });
              sslHandshakeComplete = true;
              return;
            } else {
              // Server doesn't support SSL, send startup over plain TCP
              sslHandshakeComplete = true;
              this.sendStartupPacket(socket, cfg);
              if (chunk.length > 1) {
                handlePacket(chunk.slice(1));
              }
              return;
            }
          }

          handlePacket(chunk);
        } catch (e: any) {
          clearTimeout(timeout);
          finish({ success: false, rows: [], error: `Protocol parse error: ${e.message}` });
        }
      });

      const handlePacket = (data: Buffer) => {
        let offset = 0;
        while (offset < data.length) {
          if (offset + 5 > data.length) break;
          const msgType = String.fromCharCode(data[offset]);
          const msgLen = data.readInt32BE(offset + 1);
          if (offset + 1 + msgLen > data.length) break;

          const payload = data.slice(offset + 5, offset + 1 + msgLen);
          offset += 1 + msgLen;

          if (msgType === 'R') {
            // Authentication message
            const authType = payload.readInt32BE(0);
            if (authType === 0) {
              // Auth OK
              authenticated = true;
            } else if (authType === 3) {
              // Cleartext password
              this.sendPassword(socket, cfg.password || '');
            } else if (authType === 5) {
              // MD5 password
              const salt = payload.slice(4, 8);
              const md5Pass = this.computeMd5Password(cfg.user, cfg.password || '', salt);
              this.sendPassword(socket, md5Pass);
            } else if (authType === 10) {
              // SASL SCRAM auth requested
              clearTimeout(timeout);
              return finish({
                success: false,
                rows: [],
                error: 'Server requires SCRAM-SHA-256. For Supabase, use the Transaction Pooler URI or PostgREST API.',
              });
            }
          } else if (msgType === 'E') {
            // ErrorResponse
            const errorMsg = this.parseErrorResponse(payload);
            clearTimeout(timeout);
            return finish({ success: false, rows: [], error: errorMsg });
          } else if (msgType === 'S') {
            // ParameterStatus
            const str = payload.toString('utf8');
            const parts = str.split('\0');
            if (parts[0] === 'server_version') {
              serverVersion = parts[1] || '';
            }
          } else if (msgType === 'Z') {
            // ReadyForQuery
            if (authenticated) {
              if (sql) {
                this.sendQuery(socket, sql);
                sql = ''; // execute once
              } else {
                clearTimeout(timeout);
                finish({ success: true, rows, serverVersion });
              }
            }
          } else if (msgType === 'T') {
            // RowDescription
            fields = this.parseRowDescription(payload);
          } else if (msgType === 'D') {
            // DataRow
            const rowObj = this.parseDataRow(payload, fields);
            rows.push(rowObj);
          }
        }
      };
    });
  }

  private static sendStartupPacket(sock: net.Socket | tls.TLSSocket, cfg: PostgresConnectionConfig) {
    const params = [
      'user', cfg.user,
      'database', cfg.database,
      'client_encoding', 'UTF8',
      '',
    ];
    let paramBuf = Buffer.alloc(0);
    for (const p of params) {
      paramBuf = Buffer.concat([paramBuf, Buffer.from(p + '\0', 'utf8')]);
    }

    const len = 4 + 4 + paramBuf.length;
    const header = Buffer.alloc(8);
    header.writeInt32BE(len, 0);
    header.writeInt32BE(196608, 4); // Protocol 3.0

    sock.write(Buffer.concat([header, paramBuf]));
  }

  private static sendPassword(sock: net.Socket | tls.TLSSocket, passwordStr: string) {
    const passBuf = Buffer.from(passwordStr + '\0', 'utf8');
    const len = 4 + passBuf.length;
    const header = Buffer.alloc(5);
    header.write('p', 0);
    header.writeInt32BE(len, 1);
    sock.write(Buffer.concat([header, passBuf]));
  }

  private static sendQuery(sock: net.Socket | tls.TLSSocket, querySql: string) {
    const queryBuf = Buffer.from(querySql + '\0', 'utf8');
    const len = 4 + queryBuf.length;
    const header = Buffer.alloc(5);
    header.write('Q', 0);
    header.writeInt32BE(len, 1);
    sock.write(Buffer.concat([header, queryBuf]));
  }

  private static computeMd5Password(user: string, pass: string, salt: Buffer): string {
    const h1 = crypto.createHash('md5').update(pass + user, 'utf8').digest('hex');
    const h2 = crypto.createHash('md5').update(Buffer.concat([Buffer.from(h1, 'utf8'), salt])).digest('hex');
    return 'md5' + h2;
  }

  private static parseErrorResponse(payload: Buffer): string {
    let msg = 'PostgreSQL Error';
    const str = payload.toString('utf8');
    const fields = str.split('\0');
    for (const f of fields) {
      if (f.startsWith('M')) msg = f.slice(1);
    }
    return msg;
  }

  private static parseRowDescription(payload: Buffer): string[] {
    const numFields = payload.readInt16BE(0);
    let offset = 2;
    const names: string[] = [];

    for (let i = 0; i < numFields; i++) {
      const nullIdx = payload.indexOf(0, offset);
      if (nullIdx < 0) break;
      const colName = payload.toString('utf8', offset, nullIdx);
      names.push(colName);
      offset = nullIdx + 1 + 18;
    }

    return names;
  }

  private static parseDataRow(payload: Buffer, fields: string[]): Record<string, string> {
    const numCols = payload.readInt16BE(0);
    let offset = 2;
    const row: Record<string, string> = {};

    for (let i = 0; i < numCols; i++) {
      const colLen = payload.readInt32BE(offset);
      offset += 4;
      const fieldName = fields[i] || `col_${i}`;

      if (colLen === -1) {
        row[fieldName] = '';
      } else {
        const val = payload.toString('utf8', offset, offset + colLen);
        row[fieldName] = val;
        offset += colLen;
      }
    }

    return row;
  }
}
