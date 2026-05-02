/**
 * core/gcpClient.ts — Google Cloud Platform REST API client
 *
 * Wraps GCP REST APIs using only Node.js built-in modules.
 * Credentials are stored/retrieved via IAIService secret storage.
 * OAuth2 JWT authentication with RS256 signing and token caching.
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import type { IAIService } from './interfaces';

// ── Secret keys ──────────────────────────────────────────────────────────────

const SECRET_SERVICE_ACCOUNT = 'gcp-service-account-json';
const SECRET_PROJECT_ID = 'gcp-project-id';

// ── Timeouts ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const BQ_QUERY_TIMEOUT_MS = 120_000;

// ── Type definitions ─────────────────────────────────────────────────────────

export interface GCPFunction {
  name: string;
  state: string;
  environment: string;
  buildConfig?: { runtime: string; entryPoint: string; source?: unknown };
  serviceConfig?: { uri?: string; serviceAccountEmail?: string };
  updateTime: string;
}

export interface GCPFunctionDetail extends GCPFunction {
  description?: string;
  labels?: Record<string, string>;
  eventTrigger?: { triggerRegion: string; eventType: string; pubsubTopic?: string };
  kmsKeyName?: string;
}

export interface CloudRunService {
  name: string;
  uid: string;
  uri?: string;
  generation: string;
  conditions?: Array<{ type: string; state: string; message?: string }>;
  latestReadyRevision?: string;
  updateTime: string;
}

export interface CloudRunServiceDetail extends CloudRunService {
  description?: string;
  labels?: Record<string, string>;
  template?: {
    containers?: Array<{ image: string; ports?: Array<{ containerPort: number }> }>;
    scaling?: { minInstanceCount?: number; maxInstanceCount?: number };
    serviceAccount?: string;
  };
  traffic?: Array<{ type: string; revision?: string; percent: number }>;
}

export interface CloudRunRevision {
  name: string;
  uid: string;
  generation: string;
  conditions?: Array<{ type: string; state: string }>;
  createTime: string;
}

export interface BQDataset {
  datasetReference: { datasetId: string; projectId: string };
  friendlyName?: string;
  location: string;
}

export interface BQTable {
  tableReference: { projectId: string; datasetId: string; tableId: string };
  type: string;
  creationTime: string;
}

export interface BQTableDetail extends BQTable {
  schema?: { fields: Array<{ name: string; type: string; mode?: string; description?: string }> };
  numRows?: string;
  numBytes?: string;
  description?: string;
}

export interface BQQueryResult {
  jobComplete: boolean;
  totalRows?: string;
  schema?: { fields: Array<{ name: string; type: string }> };
  rows?: Array<{ f: Array<{ v: string | null }> }>;
  jobReference?: { jobId: string };
  errors?: Array<{ reason: string; message: string }>;
}

/**
 * Result of a BigQuery dry-run (jobs.insert with dryRun: true). Returns
 * the same statistics block the real query would, without billing or
 * executing. Used by DE #2 query analyzer.
 */
export interface BQDryRunResult {
  status: { state: string; errorResult?: { reason: string; message: string } };
  statistics?: {
    totalBytesProcessed?: string;
    totalBytesBilled?:    string;
    query?: {
      schema?:           { fields: Array<{ name: string; type: string }> };
      referencedTables?: Array<{ projectId: string; datasetId: string; tableId: string }>;
      statementType?:    string;
      ddlOperationPerformance?: string;
    };
  };
}

export interface BQJob {
  jobReference: { projectId: string; jobId: string };
  configuration: { jobType: string; query?: { query: string } };
  status: { state: string; errorResult?: { reason: string; message: string } };
  statistics?: { creationTime: string; startTime?: string; endTime?: string };
}

export interface GCSBucket {
  name: string;
  location: string;
  storageClass: string;
  timeCreated: string;
}

export interface GCSObject {
  name: string;
  bucket: string;
  size: string;
  contentType: string;
  updated: string;
}

export interface PubSubTopic {
  name: string;
  labels?: Record<string, string>;
}

export interface PubSubSubscription {
  name: string;
  topic: string;
  ackDeadlineSeconds: number;
  pushConfig?: { pushEndpoint?: string };
}

export interface FirestoreDoc {
  name: string;
  fields: Record<string, { stringValue?: string; integerValue?: string; booleanValue?: boolean; mapValue?: unknown; arrayValue?: unknown }>;
  createTime: string;
  updateTime: string;
}

export interface LogEntry {
  logName: string;
  timestamp: string;
  severity: string;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  resource?: { type: string; labels?: Record<string, string> };
}

export interface LogMetric {
  name: string;
  description?: string;
  filter: string;
  metricDescriptor?: { metricKind: string; valueType: string };
}

export interface DataflowJob {
  id: string;
  name: string;
  type: string;
  currentState: string;
  createTime: string;
  location: string;
  stageStates?: Array<{ executionStageName: string; executionStageState: string }>;
}

export interface SchedulerJob {
  name: string;
  description?: string;
  schedule: string;
  timeZone: string;
  state: string;
  lastAttemptTime?: string;
  scheduleTime?: string;
  httpTarget?: { uri: string; httpMethod: string };
  pubsubTarget?: { topicName: string };
}

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GcpErrorBody {
  error?: {
    code: number;
    message: string;
    status?: string;
    errors?: Array<{ message: string; domain: string; reason: string }>;
  };
}

// ── GCP Client ───────────────────────────────────────────────────────────────

export class GcpClient {
  private readonly serviceAccount: ServiceAccountKey;
  private readonly projectId: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  private constructor(serviceAccount: ServiceAccountKey, projectId: string) {
    this.serviceAccount = serviceAccount;
    this.projectId = projectId;
  }

  // ── Factory methods ──────────────────────────────────────────────────────

  /** Create a client from stored secrets, or return null if not configured. */
  static async fromSecrets(ai: IAIService): Promise<GcpClient | null> {
    const json = await ai.getSecret(SECRET_SERVICE_ACCOUNT);
    const projectId = await ai.getSecret(SECRET_PROJECT_ID);
    if (!json || !projectId) { return null; }
    try {
      const sa: ServiceAccountKey = JSON.parse(json);
      if (!sa.private_key || !sa.client_email || !sa.token_uri) {
        return null;
      }
      return new GcpClient(sa, projectId);
    } catch {
      return null;
    }
  }

  /** Store credentials for future use. */
  static async configureCredentials(
    ai: IAIService,
    serviceAccountJson: string,
    projectId: string,
  ): Promise<void> {
    await ai.storeSecret(SECRET_SERVICE_ACCOUNT, serviceAccountJson);
    await ai.storeSecret(SECRET_PROJECT_ID, projectId);
  }

  // ── OAuth2 JWT authentication ────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && now < this.tokenExpiresAt - 60) {
      return this.cachedToken;
    }

    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: this.serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: this.serviceAccount.token_uri,
      iat: now,
      exp: now + 3600,
    })).toString('base64url');

    const unsigned = `${header}.${payload}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    const signature = signer.sign(this.serviceAccount.private_key, 'base64url');
    const jwt = `${unsigned}.${signature}`;

    const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`;
    const tokenUrl = new URL(this.serviceAccount.token_uri);

    const resp = await this.rawRequest<TokenResponse>({
      hostname: tokenUrl.hostname,
      path: tokenUrl.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body).toString() },
    }, body, DEFAULT_TIMEOUT_MS);

    this.cachedToken = resp.access_token;
    this.tokenExpiresAt = now + resp.expires_in;
    return this.cachedToken;
  }

  // ── HTTP layer ───────────────────────────────────────────────────────────

  private rawRequest<T>(
    options: https.RequestOptions,
    body?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const proto = options.port === 80 ? http : https;
      const req = proto.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const parsed = JSON.parse(raw) as T & GcpErrorBody;
            if (parsed.error) {
              reject(new GcpApiError(parsed.error.code, parsed.error.message, parsed.error.status));
            } else {
              resolve(parsed as T);
            }
          } catch {
            // Non-JSON response — return as raw text cast to T
            resolve(raw as unknown as T);
          }
        });
      });
      req.on('error', (err) => reject(new Error(`GCP request failed: ${err.message}`)));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`GCP request timed out after ${timeoutMs}ms`));
      });
      if (body) { req.write(body); }
      req.end();
    });
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }
    return this.rawRequest<T>({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers,
    }, payload, timeoutMs);
  }

  private get<T>(url: string, timeoutMs?: number): Promise<T> {
    return this.request<T>('GET', url, undefined, timeoutMs);
  }

  private post<T>(url: string, body?: unknown, timeoutMs?: number): Promise<T> {
    return this.request<T>('POST', url, body, timeoutMs);
  }

  // ── IAM / Identity ───────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const proj = await this.getProject();
      return { ok: true, message: `Connected to project "${proj.name}" (${proj.projectId}), state: ${proj.state}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  }

  async getProject(): Promise<{ projectId: string; name: string; state: string }> {
    const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}`;
    return this.get<{ projectId: string; name: string; lifecycleState: string }>(url)
      .then(r => ({ projectId: r.projectId, name: r.name, state: r.lifecycleState }));
  }

  // ── Cloud Functions (v2) ─────────────────────────────────────────────────

  async listFunctions(): Promise<GCPFunction[]> {
    const url = `https://cloudfunctions.googleapis.com/v2/projects/${encodeURIComponent(this.projectId)}/locations/-/functions`;
    const resp = await this.get<{ functions?: GCPFunction[] }>(url);
    return resp.functions ?? [];
  }

  async getFunction(name: string): Promise<GCPFunctionDetail> {
    const url = `https://cloudfunctions.googleapis.com/v2/${name}`;
    return this.get<GCPFunctionDetail>(url);
  }

  async callFunction(name: string, data?: unknown): Promise<{ result: string }> {
    const detail = await this.getFunction(name);
    const triggerUrl = detail.serviceConfig?.uri;
    if (!triggerUrl) {
      throw new Error(`Function "${name}" has no HTTP trigger URL`);
    }
    const token = await this.getAccessToken();
    const payload = data !== undefined ? JSON.stringify(data) : '{}';
    const parsed = new URL(triggerUrl);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
    };
    const result = await this.rawRequest<string>({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers,
    }, payload, DEFAULT_TIMEOUT_MS);
    return { result: typeof result === 'string' ? result : JSON.stringify(result) };
  }

  async getFunctionLogs(functionName: string, limit = 50): Promise<LogEntry[]> {
    const shortName = functionName.includes('/') ? functionName.split('/').pop()! : functionName;
    const filter = `resource.type="cloud_function" AND resource.labels.function_name="${shortName}"`;
    return this.listLogEntries(filter, limit);
  }

  // ── Cloud Run ────────────────────────────────────────────────────────────

  async listServices(): Promise<CloudRunService[]> {
    const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(this.projectId)}/locations/-/services`;
    const resp = await this.get<{ services?: CloudRunService[] }>(url);
    return resp.services ?? [];
  }

  async getService(name: string): Promise<CloudRunServiceDetail> {
    const url = `https://run.googleapis.com/v2/${name}`;
    return this.get<CloudRunServiceDetail>(url);
  }

  async getServiceRevisions(name: string): Promise<CloudRunRevision[]> {
    const url = `https://run.googleapis.com/v2/${name}/revisions`;
    const resp = await this.get<{ revisions?: CloudRunRevision[] }>(url);
    return resp.revisions ?? [];
  }

  // ── BigQuery ─────────────────────────────────────────────────────────────

  async listDatasets(): Promise<BQDataset[]> {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/datasets`;
    const resp = await this.get<{ datasets?: BQDataset[] }>(url);
    return resp.datasets ?? [];
  }

  async listTables(datasetId: string): Promise<BQTable[]> {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`;
    const resp = await this.get<{ tables?: BQTable[] }>(url);
    return resp.tables ?? [];
  }

  async getTable(datasetId: string, tableId: string): Promise<BQTableDetail> {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}`;
    return this.get<BQTableDetail>(url);
  }

  async runQuery(sql: string, useLegacySql = false): Promise<BQQueryResult> {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/queries`;
    return this.post<BQQueryResult>(url, {
      query: sql,
      useLegacySql,
      maxResults: 1000,
    }, BQ_QUERY_TIMEOUT_MS);
  }

  /**
   * Validate a query and get bytes-processed estimate WITHOUT running it.
   * Posts to jobs.insert with dryRun: true. Costs nothing on BigQuery's side.
   */
  async dryRunQuery(sql: string, useLegacySql = false): Promise<BQDryRunResult> {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/jobs`;
    return this.post<BQDryRunResult>(url, {
      configuration: {
        dryRun: true,
        query: { query: sql, useLegacySql },
      },
    }, BQ_QUERY_TIMEOUT_MS);
  }

  async listJobs(maxResults = 20): Promise<BQJob[]> {
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/jobs?maxResults=${maxResults}`;
    const resp = await this.get<{ jobs?: BQJob[] }>(url);
    return resp.jobs ?? [];
  }

  // ── Cloud Storage (GCS) ──────────────────────────────────────────────────

  async listBuckets(): Promise<GCSBucket[]> {
    const url = `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(this.projectId)}`;
    const resp = await this.get<{ items?: GCSBucket[] }>(url);
    return resp.items ?? [];
  }

  async listObjects(bucket: string, prefix?: string, maxResults = 1000): Promise<GCSObject[]> {
    let url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?maxResults=${maxResults}`;
    if (prefix) { url += `&prefix=${encodeURIComponent(prefix)}`; }
    const resp = await this.get<{ items?: GCSObject[] }>(url);
    return resp.items ?? [];
  }

  async getObject(bucket: string, object: string): Promise<string> {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
    return this.get<string>(url);
  }

  async uploadObject(
    bucket: string,
    object: string,
    content: string,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`;
    const token = await this.getAccessToken();
    const parsed = new URL(url);
    await this.rawRequest<unknown>({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(content).toString(),
      },
    }, content, DEFAULT_TIMEOUT_MS);
  }

  // ── Pub/Sub ──────────────────────────────────────────────────────────────

  async listTopics(): Promise<PubSubTopic[]> {
    const url = `https://pubsub.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/topics`;
    const resp = await this.get<{ topics?: PubSubTopic[] }>(url);
    return resp.topics ?? [];
  }

  async listSubscriptions(): Promise<PubSubSubscription[]> {
    const url = `https://pubsub.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/subscriptions`;
    const resp = await this.get<{ subscriptions?: PubSubSubscription[] }>(url);
    return resp.subscriptions ?? [];
  }

  async publishMessage(topic: string, data: string): Promise<{ messageId: string }> {
    const topicPath = topic.startsWith('projects/')
      ? topic
      : `projects/${this.projectId}/topics/${topic}`;
    const url = `https://pubsub.googleapis.com/v1/${topicPath}:publish`;
    const encoded = Buffer.from(data).toString('base64');
    const resp = await this.post<{ messageIds: string[] }>(url, {
      messages: [{ data: encoded }],
    });
    return { messageId: resp.messageIds[0] };
  }

  // ── Firestore ────────────────────────────────────────────────────────────

  async listCollections(): Promise<string[]> {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents:listCollectionIds`;
    const resp = await this.post<{ collectionIds?: string[] }>(url, {});
    return resp.collectionIds ?? [];
  }

  async listDocuments(collection: string, limit = 20): Promise<FirestoreDoc[]> {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents/${encodeURIComponent(collection)}?pageSize=${limit}`;
    const resp = await this.get<{ documents?: FirestoreDoc[] }>(url);
    return resp.documents ?? [];
  }

  async getDocument(path: string): Promise<FirestoreDoc> {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents/${path}`;
    return this.get<FirestoreDoc>(url);
  }

  // ── Cloud Logging ────────────────────────────────────────────────────────

  async listLogEntries(filter: string, limit = 50): Promise<LogEntry[]> {
    const url = 'https://logging.googleapis.com/v2/entries:list';
    const resp = await this.post<{ entries?: LogEntry[] }>(url, {
      resourceNames: [`projects/${this.projectId}`],
      filter,
      orderBy: 'timestamp desc',
      pageSize: limit,
    });
    return resp.entries ?? [];
  }

  async getLogMetrics(): Promise<LogMetric[]> {
    const url = `https://logging.googleapis.com/v2/projects/${encodeURIComponent(this.projectId)}/metrics`;
    const resp = await this.get<{ metrics?: LogMetric[] }>(url);
    return resp.metrics ?? [];
  }

  // ── Dataflow ─────────────────────────────────────────────────────────────

  async listDataflowJobs(): Promise<DataflowJob[]> {
    const url = `https://dataflow.googleapis.com/v1b3/projects/${encodeURIComponent(this.projectId)}/jobs`;
    const resp = await this.get<{ jobs?: DataflowJob[] }>(url);
    return resp.jobs ?? [];
  }

  // ── Cloud Scheduler ──────────────────────────────────────────────────────

  async listSchedulerJobs(location = '-'): Promise<SchedulerJob[]> {
    const url = `https://cloudscheduler.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/locations/${encodeURIComponent(location)}/jobs`;
    const resp = await this.get<{ jobs?: SchedulerJob[] }>(url);
    return resp.jobs ?? [];
  }
}

// ── Error class ──────────────────────────────────────────────────────────────

export class GcpApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly status?: string,
  ) {
    super(`GCP API error ${code}${status ? ` (${status})` : ''}: ${message}`);
    this.name = 'GcpApiError';
  }
}
