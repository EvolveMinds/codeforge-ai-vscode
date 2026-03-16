/**
 * core/databricksClient.ts — Databricks REST API 2.x client
 *
 * Wraps every major Databricks API surface with typed methods.
 * Uses only Node.js built-in http/https modules (zero external deps).
 * Credentials are stored/retrieved via IAIService SecretStorage.
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import type { IAIService } from './interfaces';

// ── Secret keys ──────────────────────────────────────────────────────────────

const SECRET_HOST  = 'databricks-host';
const SECRET_TOKEN = 'databricks-token';

// ── Custom error ─────────────────────────────────────────────────────────────

export class DatabricksError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DatabricksError';
  }
}

// ── Type definitions ─────────────────────────────────────────────────────────

// -- Clusters --

export interface ClusterInfo {
  cluster_id: string;
  cluster_name: string;
  state: string;
  spark_version: string;
  node_type_id: string;
  num_workers?: number;
  autoscale?: { min_workers: number; max_workers: number };
  creator_user_name?: string;
  start_time?: number;
  cluster_source?: string;
  driver_node_type_id?: string;
  autotermination_minutes?: number;
}

// -- Jobs --

export interface JobInfo {
  job_id: number;
  settings: {
    name: string;
    [key: string]: unknown;
  };
  created_time?: number;
  creator_user_name?: string;
}

export interface JobDetail {
  job_id: number;
  settings: {
    name: string;
    tasks?: JobTask[];
    schedule?: { quartz_cron_expression: string; timezone_id: string };
    max_concurrent_runs?: number;
    [key: string]: unknown;
  };
  created_time?: number;
  creator_user_name?: string;
  run_as_user_name?: string;
}

export interface JobTask {
  task_key: string;
  notebook_task?: { notebook_path: string; base_parameters?: Record<string, string> };
  spark_python_task?: { python_file: string; parameters?: string[] };
  pipeline_task?: { pipeline_id: string; full_refresh?: boolean };
  depends_on?: { task_key: string }[];
  existing_cluster_id?: string;
  new_cluster?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface JobCreateConfig {
  name: string;
  tasks: JobTask[];
  schedule?: { quartz_cron_expression: string; timezone_id: string; pause_status?: string };
  max_concurrent_runs?: number;
  email_notifications?: Record<string, unknown>;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

export interface RunInfo {
  run_id: number;
  run_name?: string;
  state: {
    life_cycle_state: string;
    result_state?: string;
    state_message?: string;
  };
  start_time?: number;
  end_time?: number;
  setup_duration?: number;
  execution_duration?: number;
  cleanup_duration?: number;
  tasks?: { task_key: string; state: { life_cycle_state: string; result_state?: string } }[];
}

export interface RunOutput {
  metadata: RunInfo;
  notebook_output?: { result: string; truncated: boolean };
  error?: string;
  error_trace?: string;
  logs?: string;
  logs_truncated?: boolean;
}

// -- Workspace --

export interface WorkspaceObject {
  path: string;
  object_type: 'DIRECTORY' | 'NOTEBOOK' | 'LIBRARY' | 'FILE' | 'REPO';
  object_id?: number;
  language?: 'PYTHON' | 'SQL' | 'SCALA' | 'R';
}

// -- Unity Catalog --

export interface CatalogInfo {
  name: string;
  comment?: string;
  owner?: string;
  created_at?: number;
  updated_at?: number;
  catalog_type?: string;
}

export interface SchemaInfo {
  name: string;
  catalog_name: string;
  comment?: string;
  owner?: string;
  created_at?: number;
}

export interface TableInfo {
  name: string;
  catalog_name: string;
  schema_name: string;
  full_name: string;
  table_type: string;
  data_source_format?: string;
  comment?: string;
}

export interface TableDetail extends TableInfo {
  columns?: ColumnInfo[];
  owner?: string;
  created_at?: number;
  updated_at?: number;
  storage_location?: string;
  properties?: Record<string, string>;
}

export interface ColumnInfo {
  name: string;
  type_name: string;
  type_text: string;
  position: number;
  comment?: string;
  nullable: boolean;
}

// -- SQL Warehouses --

export interface WarehouseInfo {
  id: string;
  name: string;
  state: string;
  cluster_size: string;
  num_clusters: number;
  auto_stop_mins?: number;
  creator_name?: string;
  warehouse_type?: string;
}

export interface SQLResult {
  statement_id: string;
  status: { state: string; error?: { message: string; error_code: string } };
  manifest?: {
    schema: { columns: { name: string; type_text: string; position: number }[] };
    total_row_count?: number;
  };
  result?: {
    data_array?: string[][];
    row_count?: number;
  };
}

// -- DBFS --

export interface DbfsFileInfo {
  path: string;
  is_dir: boolean;
  file_size: number;
  modification_time?: number;
}

// -- Secrets --

export interface SecretScope {
  name: string;
  backend_type: string;
}

// -- Pipelines (DLT) --

export interface PipelineInfo {
  pipeline_id: string;
  name: string;
  state: string;
  creator_user_name?: string;
  cluster_id?: string;
}

export interface PipelineDetail {
  pipeline_id: string;
  name: string;
  state: string;
  spec: {
    libraries?: { notebook?: { path: string } }[];
    target?: string;
    catalog?: string;
    configuration?: Record<string, string>;
    clusters?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  creator_user_name?: string;
  latest_updates?: {
    update_id: string;
    state: string;
    creation_time?: string;
  }[];
  cause?: string;
}

// ── Internal types ───────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

// ── Default timeouts ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const SQL_TIMEOUT_MS     = 120_000;

// ── Client ───────────────────────────────────────────────────────────────────

export class DatabricksClient {
  private readonly host: string;
  private readonly token: string;
  private readonly protocol: typeof https | typeof http;
  private readonly parsedHost: URL;

  constructor(host: string, token: string) {
    // Normalise: strip trailing slashes
    this.host  = host.replace(/\/+$/, '');
    this.token = token;

    this.parsedHost = new URL(this.host);
    this.protocol   = this.parsedHost.protocol === 'https:' ? https : http;
  }

  // ── Static helpers ───────────────────────────────────────────────────────

  /**
   * Build a client from credentials stored in VS Code SecretStorage.
   * Returns null when host or token are not yet configured.
   */
  static async fromSecrets(ai: IAIService): Promise<DatabricksClient | null> {
    const host  = await ai.getSecret(SECRET_HOST);
    const token = await ai.getSecret(SECRET_TOKEN);
    if (!host || !token) {
      return null;
    }
    return new DatabricksClient(host, token);
  }

  /**
   * Persist host and token into VS Code SecretStorage.
   */
  static async configureCredentials(
    ai: IAIService,
    host: string,
    token: string
  ): Promise<void> {
    await ai.storeSecret(SECRET_HOST, host.replace(/\/+$/, ''));
    await ai.storeSecret(SECRET_TOKEN, token);
  }

  // ── Private HTTP layer ───────────────────────────────────────────────────

  private _request<T = unknown>(opts: RequestOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const { method, path, body, query, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

      // Build URL with query params
      const url = new URL(path, this.host);
      if (query) {
        for (const [k, v] of Object.entries(query)) {
          if (v !== undefined && v !== null) {
            url.searchParams.set(k, String(v));
          }
        }
      }

      const payload = body ? JSON.stringify(body) : undefined;

      const reqOpts: https.RequestOptions = {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept':        'application/json',
          ...(payload ? {
            'Content-Type':   'application/json',
            'Content-Length':  Buffer.byteLength(payload).toString(),
          } : {}),
        },
        timeout: timeoutMs,
      };

      const req = this.protocol.request(reqOpts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;

          if (status >= 200 && status < 300) {
            if (!raw || raw.trim().length === 0) {
              resolve({} as T);
              return;
            }
            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              resolve(raw as unknown as T);
            }
          } else {
            let errorCode: string | undefined;
            let message = `Databricks API error ${status}: ${raw}`;
            let details: unknown;
            try {
              const parsed = JSON.parse(raw);
              errorCode = parsed.error_code;
              message   = parsed.message || parsed.error || message;
              details   = parsed;
            } catch {
              // raw was not JSON — keep default message
            }
            reject(new DatabricksError(message, status, errorCode, details));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new DatabricksError(
          `Request timed out after ${timeoutMs}ms: ${method} ${path}`,
          0, 'TIMEOUT'
        ));
      });

      req.on('error', (err) => {
        reject(new DatabricksError(
          `Network error: ${err.message}`,
          0, 'NETWORK_ERROR', err
        ));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  // Convenience wrappers
  private _get<T>(path: string, query?: Record<string, string | number | boolean | undefined>, timeoutMs?: number): Promise<T> {
    return this._request<T>({ method: 'GET', path, query, timeoutMs });
  }

  private _post<T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return this._request<T>({ method: 'POST', path, body, timeoutMs });
  }

  // ── Workspace & Authentication ───────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this._get('/api/2.0/clusters/list');
      return { ok: true, message: 'Connected successfully' };
    } catch (err) {
      const msg = err instanceof DatabricksError ? err.message : String(err);
      return { ok: false, message: msg };
    }
  }

  async getCurrentUser(): Promise<{ userName: string; displayName: string }> {
    const res = await this._get<{ userName: string; displayName: string }>(
      '/api/2.0/preview/scim/v2/Me'
    );
    return { userName: res.userName, displayName: res.displayName };
  }

  // ── Clusters ─────────────────────────────────────────────────────────────

  async listClusters(): Promise<ClusterInfo[]> {
    const res = await this._get<{ clusters?: ClusterInfo[] }>('/api/2.0/clusters/list');
    return res.clusters ?? [];
  }

  async getCluster(clusterId: string): Promise<ClusterInfo> {
    return this._get<ClusterInfo>('/api/2.0/clusters/get', { cluster_id: clusterId });
  }

  async startCluster(clusterId: string): Promise<void> {
    await this._post('/api/2.0/clusters/start', { cluster_id: clusterId });
  }

  async terminateCluster(clusterId: string): Promise<void> {
    await this._post('/api/2.0/clusters/delete', { cluster_id: clusterId });
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────

  async listJobs(limit?: number): Promise<JobInfo[]> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (limit !== undefined) {
      query.limit = limit;
    }
    const res = await this._get<{ jobs?: JobInfo[] }>('/api/2.1/jobs/list', query);
    return res.jobs ?? [];
  }

  async getJob(jobId: number): Promise<JobDetail> {
    return this._get<JobDetail>('/api/2.1/jobs/get', { job_id: jobId });
  }

  async runJob(
    jobId: number,
    params?: Record<string, string>
  ): Promise<{ run_id: number }> {
    const body: Record<string, unknown> = { job_id: jobId };
    if (params) {
      body.notebook_params = params;
    }
    return this._post<{ run_id: number }>('/api/2.1/jobs/run-now', body);
  }

  async listJobRuns(jobId: number, limit?: number): Promise<RunInfo[]> {
    const query: Record<string, string | number | boolean | undefined> = { job_id: jobId };
    if (limit !== undefined) {
      query.limit = limit;
    }
    const res = await this._get<{ runs?: RunInfo[] }>('/api/2.1/jobs/runs/list', query);
    return res.runs ?? [];
  }

  async getRunOutput(runId: number): Promise<RunOutput> {
    return this._get<RunOutput>('/api/2.1/jobs/runs/get-output', { run_id: runId });
  }

  async cancelRun(runId: number): Promise<void> {
    await this._post('/api/2.1/jobs/runs/cancel', { run_id: runId });
  }

  async createJob(config: JobCreateConfig): Promise<{ job_id: number }> {
    return this._post<{ job_id: number }>('/api/2.1/jobs/create', config);
  }

  // ── Workspace (Notebooks) ───────────────────────────────────────────────

  async listWorkspace(path: string): Promise<WorkspaceObject[]> {
    const res = await this._get<{ objects?: WorkspaceObject[] }>(
      '/api/2.0/workspace/list', { path }
    );
    return res.objects ?? [];
  }

  async exportNotebook(
    path: string,
    format: 'SOURCE' | 'HTML' | 'JUPYTER' | 'DBC' = 'SOURCE'
  ): Promise<string> {
    const res = await this._get<{ content: string }>(
      '/api/2.0/workspace/export', { path, format, direct_download: false }
    );
    // Content is returned base64-encoded
    return Buffer.from(res.content, 'base64').toString('utf-8');
  }

  async importNotebook(
    path: string,
    content: string,
    language: 'PYTHON' | 'SQL' | 'SCALA' | 'R',
    overwrite: boolean = false
  ): Promise<void> {
    const encoded = Buffer.from(content, 'utf-8').toString('base64');
    await this._post('/api/2.0/workspace/import', {
      path,
      content: encoded,
      language,
      format: 'SOURCE',
      overwrite,
    });
  }

  // ── Unity Catalog ────────────────────────────────────────────────────────

  async listCatalogs(): Promise<CatalogInfo[]> {
    const res = await this._get<{ catalogs?: CatalogInfo[] }>(
      '/api/2.1/unity-catalog/catalogs'
    );
    return res.catalogs ?? [];
  }

  async listSchemas(catalog: string): Promise<SchemaInfo[]> {
    const res = await this._get<{ schemas?: SchemaInfo[] }>(
      '/api/2.1/unity-catalog/schemas', { catalog_name: catalog }
    );
    return res.schemas ?? [];
  }

  async listTables(catalog: string, schema: string): Promise<TableInfo[]> {
    const res = await this._get<{ tables?: TableInfo[] }>(
      '/api/2.1/unity-catalog/tables', { catalog_name: catalog, schema_name: schema }
    );
    return res.tables ?? [];
  }

  async getTable(fullName: string): Promise<TableDetail> {
    // fullName is catalog.schema.table — encode for the URL path segment
    const encoded = encodeURIComponent(fullName);
    return this._get<TableDetail>(`/api/2.1/unity-catalog/tables/${encoded}`);
  }

  // ── SQL Warehouses ───────────────────────────────────────────────────────

  async listWarehouses(): Promise<WarehouseInfo[]> {
    const res = await this._get<{ warehouses?: WarehouseInfo[] }>(
      '/api/2.0/sql/warehouses'
    );
    return res.warehouses ?? [];
  }

  async executeStatement(
    warehouseId: string,
    sql: string,
    catalog?: string,
    schema?: string
  ): Promise<SQLResult> {
    const body: Record<string, unknown> = {
      warehouse_id: warehouseId,
      statement: sql,
      wait_timeout: '120s',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    };
    if (catalog) {
      body.catalog = catalog;
    }
    if (schema) {
      body.schema = schema;
    }
    return this._post<SQLResult>('/api/2.0/sql/statements', body, SQL_TIMEOUT_MS);
  }

  // ── DBFS ─────────────────────────────────────────────────────────────────

  async listDbfs(path: string): Promise<DbfsFileInfo[]> {
    const res = await this._get<{ files?: DbfsFileInfo[] }>(
      '/api/2.0/dbfs/list', { path }
    );
    return res.files ?? [];
  }

  async readDbfsFile(path: string): Promise<string> {
    const res = await this._get<{ data: string; bytes_read: number }>(
      '/api/2.0/dbfs/read', { path }
    );
    return Buffer.from(res.data, 'base64').toString('utf-8');
  }

  // ── Secrets ──────────────────────────────────────────────────────────────

  async listSecretScopes(): Promise<SecretScope[]> {
    const res = await this._get<{ scopes?: SecretScope[] }>(
      '/api/2.0/secrets/scopes/list'
    );
    return res.scopes ?? [];
  }

  // ── Pipelines (DLT) ─────────────────────────────────────────────────────

  async listPipelines(): Promise<PipelineInfo[]> {
    const res = await this._get<{ statuses?: PipelineInfo[] }>('/api/2.0/pipelines');
    return res.statuses ?? [];
  }

  async getPipeline(pipelineId: string): Promise<PipelineDetail> {
    return this._get<PipelineDetail>(`/api/2.0/pipelines/${encodeURIComponent(pipelineId)}`);
  }

  async startPipeline(pipelineId: string, fullRefresh: boolean = false): Promise<void> {
    await this._post(
      `/api/2.0/pipelines/${encodeURIComponent(pipelineId)}/updates`,
      { full_refresh: fullRefresh }
    );
  }
}
