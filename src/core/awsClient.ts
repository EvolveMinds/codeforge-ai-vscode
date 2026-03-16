/**
 * core/awsClient.ts — AWS REST API client with Signature V4 authentication
 *
 * Uses ONLY Node.js built-in modules (http, https, crypto). No AWS SDK.
 * Credentials are stored/retrieved via IAIService SecretStorage.
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import type { IAIService } from './interfaces';

// ── Type definitions ─────────────────────────────────────────────────────────

export interface LambdaFunction {
  functionName: string;
  functionArn: string;
  runtime: string;
  handler: string;
  codeSize: number;
  memorySize: number;
  timeout: number;
  lastModified: string;
  description: string;
}

export interface LambdaFunctionDetail extends LambdaFunction {
  role: string;
  environment?: Record<string, string>;
  layers?: string[];
  vpcConfig?: { subnetIds: string[]; securityGroupIds: string[] };
  tracingConfig?: string;
  state?: string;
}

export interface LambdaFunctionConfig {
  functionName: string;
  functionArn: string;
  runtime: string;
  handler: string;
  memorySize: number;
  timeout: number;
  environment?: Record<string, string>;
  layers?: { arn: string; codeSize: number }[];
  state: string;
  lastUpdateStatus: string;
}

export interface LambdaInvokeResult {
  statusCode: number;
  payload: string;
  functionError?: string;
  logResult?: string;
}

export interface LambdaLayer {
  layerName: string;
  layerArn: string;
  latestVersionArn: string;
  description: string;
  createdDate: string;
}

export interface LogEvent {
  timestamp: number;
  message: string;
  ingestionTime?: number;
  logStreamName?: string;
}

export interface LogGroup {
  logGroupName: string;
  creationTime: number;
  storedBytes: number;
  retentionInDays?: number;
  arn: string;
}

export interface GlueDatabase {
  name: string;
  description: string;
  locationUri?: string;
  createTime?: string;
  catalogId?: string;
}

export interface GlueTable {
  name: string;
  databaseName: string;
  description?: string;
  createTime?: string;
  updateTime?: string;
  tableType?: string;
  storageDescriptor?: {
    location: string;
    inputFormat: string;
    outputFormat: string;
    columns: { name: string; type: string; comment?: string }[];
  };
}

export interface GlueTableDetail extends GlueTable {
  owner?: string;
  parameters?: Record<string, string>;
  partitionKeys?: { name: string; type: string }[];
}

export interface GlueJob {
  name: string;
  description?: string;
  role: string;
  createdOn?: string;
  lastModifiedOn?: string;
  glueVersion?: string;
  workerType?: string;
  numberOfWorkers?: number;
  maxRetries?: number;
  timeout?: number;
  command?: { name: string; scriptLocation: string; pythonVersion?: string };
}

export interface GlueJobDetail extends GlueJob {
  defaultArguments?: Record<string, string>;
  connections?: string[];
  maxCapacity?: number;
  executionProperty?: { maxConcurrentRuns: number };
}

export interface GlueJobRun {
  id: string;
  jobName: string;
  jobRunState: string;
  startedOn?: string;
  completedOn?: string;
  errorMessage?: string;
  executionTime?: number;
  arguments?: Record<string, string>;
}

export interface GlueCrawler {
  name: string;
  role: string;
  databaseName: string;
  description?: string;
  state: string;
  lastCrawl?: { status: string; errorMessage?: string; startTime?: string };
}

export interface GlueWorkflow {
  name: string;
  description?: string;
  createdOn?: string;
  lastModifiedOn?: string;
  lastRun?: { status: string; startedOn?: string };
}

export interface S3Bucket {
  name: string;
  creationDate: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
  storageClass: string;
  etag?: string;
}

export interface CFStack {
  stackName: string;
  stackId: string;
  stackStatus: string;
  creationTime: string;
  lastUpdatedTime?: string;
  description?: string;
}

export interface CFStackDetail extends CFStack {
  parameters?: { key: string; value: string }[];
  outputs?: { key: string; value: string; description?: string }[];
  capabilities?: string[];
  tags?: { key: string; value: string }[];
}

export interface CFStackEvent {
  eventId: string;
  stackName: string;
  logicalResourceId: string;
  resourceType: string;
  resourceStatus: string;
  timestamp: string;
  resourceStatusReason?: string;
}

export interface StateMachine {
  stateMachineArn: string;
  name: string;
  type: string;
  creationDate: string;
}

export interface StateMachineDetail extends StateMachine {
  definition: string;
  roleArn: string;
  status: string;
  loggingConfiguration?: unknown;
}

export interface Execution {
  executionArn: string;
  stateMachineArn: string;
  name: string;
  status: string;
  startDate: string;
  stopDate?: string;
}

export interface DynamoTableDetail {
  tableName: string;
  tableArn: string;
  tableStatus: string;
  itemCount: number;
  tableSizeBytes: number;
  keySchema: { attributeName: string; keyType: string }[];
  attributeDefinitions: { attributeName: string; attributeType: string }[];
  provisionedThroughput?: { readCapacityUnits: number; writeCapacityUnits: number };
  globalSecondaryIndexes?: { indexName: string; keySchema: { attributeName: string; keyType: string }[] }[];
}

export interface DynamoItem {
  [key: string]: unknown;
}

export interface EventRule {
  name: string;
  arn: string;
  state: string;
  description?: string;
  scheduleExpression?: string;
  eventPattern?: string;
  eventBusName?: string;
}

export interface SQSQueue {
  queueUrl: string;
  queueName: string;
}

export interface SNSTopic {
  topicArn: string;
}

// ── AWS error ────────────────────────────────────────────────────────────────

export class AwsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly service: string
  ) {
    super(`AWS ${service} (${statusCode}): ${code} — ${message}`);
    this.name = 'AwsError';
  }
}

// ── Internal types ───────────────────────────────────────────────────────────

interface RawResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class AwsClient {
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly region: string;
  private readonly sessionToken?: string;

  private constructor(
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
    sessionToken?: string
  ) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
    this.sessionToken = sessionToken;
  }

  // ── Factory ──────────────────────────────────────────────────────────────

  static async fromSecrets(ai: IAIService): Promise<AwsClient | null> {
    const [accessKeyId, secretAccessKey, region] = await Promise.all([
      ai.getSecret('aws-access-key-id'),
      ai.getSecret('aws-secret-access-key'),
      ai.getSecret('aws-region'),
    ]);
    if (!accessKeyId || !secretAccessKey || !region) { return null; }
    const sessionToken = await ai.getSecret('aws-session-token');
    return new AwsClient(accessKeyId, secretAccessKey, region, sessionToken || undefined);
  }

  static async configureCredentials(
    ai: IAIService,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
    sessionToken?: string
  ): Promise<void> {
    await Promise.all([
      ai.storeSecret('aws-access-key-id', accessKeyId),
      ai.storeSecret('aws-secret-access-key', secretAccessKey),
      ai.storeSecret('aws-region', region),
    ]);
    if (sessionToken) {
      await ai.storeSecret('aws-session-token', sessionToken);
    }
  }

  // ── Signature V4 ────────────────────────────────────────────────────────

  private _sign(
    method: string,
    url: URL,
    headers: Record<string, string>,
    body: string,
    service: string
  ): Record<string, string> {
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
    const amzDate = dateStamp + 'T' + now.toISOString().replace(/[-:]/g, '').slice(9, 15) + 'Z';

    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    headers['x-amz-date'] = amzDate;
    headers['x-amz-content-sha256'] = bodyHash;
    if (this.sessionToken) {
      headers['x-amz-security-token'] = this.sessionToken;
    }

    // Canonical request
    const canonicalUri = url.pathname || '/';
    const canonicalQuerystring = url.searchParams.toString().split('&').sort().join('&');

    const signedHeaderKeys = Object.keys(headers)
      .map(k => k.toLowerCase())
      .sort();
    const canonicalHeaders = signedHeaderKeys
      .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!].trim()}`)
      .join('\n') + '\n';
    const signedHeaders = signedHeaderKeys.join(';');

    const canonicalRequest = [
      method, canonicalUri, canonicalQuerystring,
      canonicalHeaders, signedHeaders, bodyHash,
    ].join('\n');

    // String to sign
    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    // Signing key
    const hmac = (key: Buffer | string, data: string): Buffer =>
      crypto.createHmac('sha256', key).update(data).digest();
    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');

    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers['Authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headers;
  }

  // ── HTTP transport ───────────────────────────────────────────────────────

  private _httpRequest(
    method: string,
    url: URL,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number
  ): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(url, { method, headers, timeout: timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') { responseHeaders[k] = v; }
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: responseHeaders,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      if (body) { req.write(body); }
      req.end();
    });
  }

  // ── REST-style request (Lambda, S3) ──────────────────────────────────────

  private async _restRequest(
    service: string,
    method: string,
    path: string,
    body?: string,
    region?: string,
    timeoutMs = 30_000,
    extraHeaders?: Record<string, string>
  ): Promise<RawResponse> {
    const r = region ?? this.region;
    const host = `${service}.${r}.amazonaws.com`;
    const url = new URL(`https://${host}${path}`);
    const headers: Record<string, string> = { host, ...extraHeaders };
    if (body && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }
    this._sign(method, url, headers, body ?? '', service);
    return this._httpRequest(method, url, headers, body ?? '', timeoutMs);
  }

  // ── JSON-style request (Glue, DynamoDB, SFN, CloudWatch Logs, etc.) ─────

  private async _jsonRequest(
    service: string,
    target: string,
    body: unknown,
    region?: string,
    timeoutMs = 30_000
  ): Promise<RawResponse> {
    const r = region ?? this.region;
    const host = `${service}.${r}.amazonaws.com`;
    const url = new URL(`https://${host}/`);
    const payload = JSON.stringify(body ?? {});
    const headers: Record<string, string> = {
      host,
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': target,
    };
    this._sign('POST', url, headers, payload, service);
    return this._httpRequest('POST', url, headers, payload, timeoutMs);
  }

  // ── S3 request (bucket-style virtual hosting) ────────────────────────────

  private async _s3Request(
    method: string,
    bucket: string | null,
    path: string,
    body?: string,
    contentType?: string,
    timeoutMs = 30_000
  ): Promise<RawResponse> {
    const host = bucket
      ? `${bucket}.s3.${this.region}.amazonaws.com`
      : `s3.${this.region}.amazonaws.com`;
    const url = new URL(`https://${host}${path}`);
    const headers: Record<string, string> = { host };
    if (contentType) { headers['content-type'] = contentType; }
    this._sign(method, url, headers, body ?? '', 's3');
    return this._httpRequest(method, url, headers, body ?? '', timeoutMs);
  }

  // ── Error parsing ───────────────────────────────────────────────────────

  private _parseJsonError(res: RawResponse, service: string): AwsError {
    try {
      const parsed = JSON.parse(res.body);
      const code = parsed.__type?.split('#').pop() ?? parsed.Error?.Code ?? 'UnknownError';
      const message = parsed.message ?? parsed.Message ?? parsed.Error?.Message ?? res.body;
      return new AwsError(message, code, res.statusCode, service);
    } catch {
      return new AwsError(res.body, 'UnknownError', res.statusCode, service);
    }
  }

  private _parseXmlError(res: RawResponse, service: string): AwsError {
    const codeMatch = res.body.match(/<Code>([^<]+)<\/Code>/);
    const msgMatch = res.body.match(/<Message>([^<]+)<\/Message>/);
    return new AwsError(
      msgMatch?.[1] ?? res.body,
      codeMatch?.[1] ?? 'UnknownError',
      res.statusCode,
      service
    );
  }

  private _ensureOk(res: RawResponse, service: string, format: 'json' | 'xml' = 'json'): void {
    if (res.statusCode >= 200 && res.statusCode < 300) { return; }
    throw format === 'xml'
      ? this._parseXmlError(res, service)
      : this._parseJsonError(res, service);
  }

  // ── Simple XML helpers (no dependency) ──────────────────────────────────

  private _xmlTag(xml: string, tag: string): string {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    return re.exec(xml)?.[1] ?? '';
  }

  private _xmlTags(xml: string, tag: string): string[] {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) { results.push(m[1]); }
    return results;
  }

  // ── STS ──────────────────────────────────────────────────────────────────

  async getCallerIdentity(): Promise<{ account: string; arn: string; userId: string }> {
    const res = await this._jsonRequest('sts', 'AWSSecurityTokenServiceV20110615.GetCallerIdentity', {});
    this._ensureOk(res, 'sts');
    const data = JSON.parse(res.body);
    return { account: data.Account, arn: data.Arn, userId: data.UserId };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const identity = await this.getCallerIdentity();
      return { ok: true, message: `Connected as ${identity.arn} (account ${identity.account})` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg };
    }
  }

  // ── Lambda ───────────────────────────────────────────────────────────────

  async listFunctions(maxItems?: number): Promise<LambdaFunction[]> {
    const results: LambdaFunction[] = [];
    let marker: string | undefined;
    do {
      let path = '/2015-03-31/functions/';
      const params: string[] = [];
      if (maxItems) { params.push(`MaxItems=${maxItems}`); }
      if (marker) { params.push(`Marker=${encodeURIComponent(marker)}`); }
      if (params.length) { path += '?' + params.join('&'); }
      const res = await this._restRequest('lambda', 'GET', path);
      this._ensureOk(res, 'lambda');
      const data = JSON.parse(res.body);
      for (const f of data.Functions ?? []) {
        results.push({
          functionName: f.FunctionName, functionArn: f.FunctionArn,
          runtime: f.Runtime ?? '', handler: f.Handler ?? '',
          codeSize: f.CodeSize ?? 0, memorySize: f.MemorySize ?? 0,
          timeout: f.Timeout ?? 0, lastModified: f.LastModified ?? '',
          description: f.Description ?? '',
        });
      }
      marker = data.NextMarker;
      if (maxItems && results.length >= maxItems) { break; }
    } while (marker);
    return results;
  }

  async getFunction(functionName: string): Promise<LambdaFunctionDetail> {
    const res = await this._restRequest('lambda', 'GET', `/2015-03-31/functions/${encodeURIComponent(functionName)}`);
    this._ensureOk(res, 'lambda');
    const data = JSON.parse(res.body);
    const c = data.Configuration ?? data;
    return {
      functionName: c.FunctionName, functionArn: c.FunctionArn,
      runtime: c.Runtime ?? '', handler: c.Handler ?? '',
      codeSize: c.CodeSize ?? 0, memorySize: c.MemorySize ?? 0,
      timeout: c.Timeout ?? 0, lastModified: c.LastModified ?? '',
      description: c.Description ?? '', role: c.Role ?? '',
      environment: c.Environment?.Variables,
      layers: c.Layers?.map((l: { Arn: string }) => l.Arn),
      vpcConfig: c.VpcConfig ? {
        subnetIds: c.VpcConfig.SubnetIds ?? [],
        securityGroupIds: c.VpcConfig.SecurityGroupIds ?? [],
      } : undefined,
      tracingConfig: c.TracingConfig?.Mode,
      state: c.State,
    };
  }

  async invokeFunction(functionName: string, payload?: unknown): Promise<LambdaInvokeResult> {
    const body = payload !== undefined ? JSON.stringify(payload) : '';
    const res = await this._restRequest(
      'lambda', 'POST',
      `/2015-03-31/functions/${encodeURIComponent(functionName)}/invocations`,
      body, undefined, 120_000
    );
    return {
      statusCode: res.statusCode,
      payload: res.body,
      functionError: res.headers['x-amz-function-error'],
      logResult: res.headers['x-amz-log-result'],
    };
  }

  async getFunctionLogs(functionName: string, limit?: number): Promise<LogEvent[]> {
    return this.filterLogEvents(`/aws/lambda/${functionName}`, '', undefined, limit ?? 50);
  }

  async updateFunctionCode(functionName: string, zipBuffer: Buffer): Promise<void> {
    const body = JSON.stringify({ ZipFile: zipBuffer.toString('base64') });
    const res = await this._restRequest(
      'lambda', 'PUT',
      `/2015-03-31/functions/${encodeURIComponent(functionName)}/code`,
      body
    );
    this._ensureOk(res, 'lambda');
  }

  async listLayers(): Promise<LambdaLayer[]> {
    const results: LambdaLayer[] = [];
    let marker: string | undefined;
    do {
      let path = '/2015-03-31/layers/';
      if (marker) { path += `?Marker=${encodeURIComponent(marker)}`; }
      const res = await this._restRequest('lambda', 'GET', path);
      this._ensureOk(res, 'lambda');
      const data = JSON.parse(res.body);
      for (const l of data.Layers ?? []) {
        results.push({
          layerName: l.LayerName, layerArn: l.LayerArn,
          latestVersionArn: l.LatestMatchingVersion?.LayerVersionArn ?? '',
          description: l.LatestMatchingVersion?.Description ?? '',
          createdDate: l.LatestMatchingVersion?.CreatedDate ?? '',
        });
      }
      marker = data.NextMarker;
    } while (marker);
    return results;
  }

  async getFunctionConfiguration(functionName: string): Promise<LambdaFunctionConfig> {
    const res = await this._restRequest(
      'lambda', 'GET',
      `/2015-03-31/functions/${encodeURIComponent(functionName)}/configuration`
    );
    this._ensureOk(res, 'lambda');
    const c = JSON.parse(res.body);
    return {
      functionName: c.FunctionName, functionArn: c.FunctionArn,
      runtime: c.Runtime ?? '', handler: c.Handler ?? '',
      memorySize: c.MemorySize ?? 0, timeout: c.Timeout ?? 0,
      environment: c.Environment?.Variables,
      layers: c.Layers?.map((l: { Arn: string; CodeSize: number }) => ({ arn: l.Arn, codeSize: l.CodeSize })),
      state: c.State ?? '', lastUpdateStatus: c.LastUpdateStatus ?? '',
    };
  }

  // ── Glue ─────────────────────────────────────────────────────────────────

  async listDatabases(): Promise<GlueDatabase[]> {
    const results: GlueDatabase[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = {};
      if (token) { body.NextToken = token; }
      const res = await this._jsonRequest('glue', 'AWSGlue.GetDatabases', body);
      this._ensureOk(res, 'glue');
      const data = JSON.parse(res.body);
      for (const db of data.DatabaseList ?? []) {
        results.push({
          name: db.Name, description: db.Description ?? '',
          locationUri: db.LocationUri, createTime: db.CreateTime,
          catalogId: db.CatalogId,
        });
      }
      token = data.NextToken;
    } while (token);
    return results;
  }

  async listGlueTables(database: string): Promise<GlueTable[]> {
    const results: GlueTable[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = { DatabaseName: database };
      if (token) { body.NextToken = token; }
      const res = await this._jsonRequest('glue', 'AWSGlue.GetTables', body);
      this._ensureOk(res, 'glue');
      const data = JSON.parse(res.body);
      for (const t of data.TableList ?? []) {
        results.push(this._mapGlueTable(t));
      }
      token = data.NextToken;
    } while (token);
    return results;
  }

  async getTable(database: string, table: string): Promise<GlueTableDetail> {
    const res = await this._jsonRequest('glue', 'AWSGlue.GetTable', {
      DatabaseName: database, Name: table,
    });
    this._ensureOk(res, 'glue');
    const data = JSON.parse(res.body);
    const t = data.Table;
    return {
      ...this._mapGlueTable(t),
      owner: t.Owner,
      parameters: t.Parameters,
      partitionKeys: t.PartitionKeys?.map((p: { Name: string; Type: string }) => ({
        name: p.Name, type: p.Type,
      })),
    };
  }

  private _mapGlueTable(t: Record<string, unknown>): GlueTable {
    const sd = t.StorageDescriptor as Record<string, unknown> | undefined;
    return {
      name: t.Name as string, databaseName: t.DatabaseName as string ?? '',
      description: t.Description as string | undefined,
      createTime: t.CreateTime as string | undefined,
      updateTime: t.UpdateTime as string | undefined,
      tableType: t.TableType as string | undefined,
      storageDescriptor: sd ? {
        location: sd.Location as string ?? '',
        inputFormat: sd.InputFormat as string ?? '',
        outputFormat: sd.OutputFormat as string ?? '',
        columns: ((sd.Columns as { Name: string; Type: string; Comment?: string }[]) ?? []).map(c => ({
          name: c.Name, type: c.Type, comment: c.Comment,
        })),
      } : undefined,
    };
  }

  async listJobs(): Promise<GlueJob[]> {
    const results: GlueJob[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = {};
      if (token) { body.NextToken = token; }
      const res = await this._jsonRequest('glue', 'AWSGlue.GetJobs', body);
      this._ensureOk(res, 'glue');
      const data = JSON.parse(res.body);
      for (const j of data.Jobs ?? []) {
        results.push(this._mapGlueJob(j));
      }
      token = data.NextToken;
    } while (token);
    return results;
  }

  async getJob(jobName: string): Promise<GlueJobDetail> {
    const res = await this._jsonRequest('glue', 'AWSGlue.GetJob', { JobName: jobName });
    this._ensureOk(res, 'glue');
    const data = JSON.parse(res.body);
    const j = data.Job;
    return {
      ...this._mapGlueJob(j),
      defaultArguments: j.DefaultArguments,
      connections: j.Connections?.Connections,
      maxCapacity: j.MaxCapacity,
      executionProperty: j.ExecutionProperty ? { maxConcurrentRuns: j.ExecutionProperty.MaxConcurrentRuns } : undefined,
    };
  }

  private _mapGlueJob(j: Record<string, unknown>): GlueJob {
    const cmd = j.Command as Record<string, unknown> | undefined;
    return {
      name: j.Name as string, description: j.Description as string | undefined,
      role: j.Role as string ?? '', createdOn: j.CreatedOn as string | undefined,
      lastModifiedOn: j.LastModifiedOn as string | undefined,
      glueVersion: j.GlueVersion as string | undefined,
      workerType: j.WorkerType as string | undefined,
      numberOfWorkers: j.NumberOfWorkers as number | undefined,
      maxRetries: j.MaxRetries as number | undefined,
      timeout: j.Timeout as number | undefined,
      command: cmd ? {
        name: cmd.Name as string, scriptLocation: cmd.ScriptLocation as string,
        pythonVersion: cmd.PythonVersion as string | undefined,
      } : undefined,
    };
  }

  async startJobRun(jobName: string, args?: Record<string, string>): Promise<{ jobRunId: string }> {
    const body: Record<string, unknown> = { JobName: jobName };
    if (args) { body.Arguments = args; }
    const res = await this._jsonRequest('glue', 'AWSGlue.StartJobRun', body);
    this._ensureOk(res, 'glue');
    const data = JSON.parse(res.body);
    return { jobRunId: data.JobRunId };
  }

  async getJobRun(jobName: string, runId: string): Promise<GlueJobRun> {
    const res = await this._jsonRequest('glue', 'AWSGlue.GetJobRun', {
      JobName: jobName, RunId: runId,
    });
    this._ensureOk(res, 'glue');
    const data = JSON.parse(res.body);
    return this._mapGlueJobRun(data.JobRun);
  }

  async getJobRuns(jobName: string, maxResults?: number): Promise<GlueJobRun[]> {
    const body: Record<string, unknown> = { JobName: jobName };
    if (maxResults) { body.MaxResults = maxResults; }
    const res = await this._jsonRequest('glue', 'AWSGlue.GetJobRuns', body);
    this._ensureOk(res, 'glue');
    const data = JSON.parse(res.body);
    return (data.JobRuns ?? []).map((r: Record<string, unknown>) => this._mapGlueJobRun(r));
  }

  private _mapGlueJobRun(r: Record<string, unknown>): GlueJobRun {
    return {
      id: r.Id as string, jobName: r.JobName as string,
      jobRunState: r.JobRunState as string,
      startedOn: r.StartedOn as string | undefined,
      completedOn: r.CompletedOn as string | undefined,
      errorMessage: r.ErrorMessage as string | undefined,
      executionTime: r.ExecutionTime as number | undefined,
      arguments: r.Arguments as Record<string, string> | undefined,
    };
  }

  async listCrawlers(): Promise<GlueCrawler[]> {
    const results: GlueCrawler[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = {};
      if (token) { body.NextToken = token; }
      const res = await this._jsonRequest('glue', 'AWSGlue.GetCrawlers', body);
      this._ensureOk(res, 'glue');
      const data = JSON.parse(res.body);
      for (const c of data.Crawlers ?? []) {
        results.push({
          name: c.Name, role: c.Role ?? '', databaseName: c.DatabaseName ?? '',
          description: c.Description, state: c.State ?? '',
          lastCrawl: c.LastCrawl ? {
            status: c.LastCrawl.Status, errorMessage: c.LastCrawl.ErrorMessage,
            startTime: c.LastCrawl.StartTime,
          } : undefined,
        });
      }
      token = data.NextToken;
    } while (token);
    return results;
  }

  async startCrawler(crawlerName: string): Promise<void> {
    const res = await this._jsonRequest('glue', 'AWSGlue.StartCrawler', { Name: crawlerName });
    this._ensureOk(res, 'glue');
  }

  async listWorkflows(): Promise<GlueWorkflow[]> {
    const listRes = await this._jsonRequest('glue', 'AWSGlue.ListWorkflows', {});
    this._ensureOk(listRes, 'glue');
    const listData = JSON.parse(listRes.body);
    const names: string[] = listData.Workflows ?? [];
    const results: GlueWorkflow[] = [];
    for (const name of names) {
      const res = await this._jsonRequest('glue', 'AWSGlue.GetWorkflow', { Name: name });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const w = JSON.parse(res.body).Workflow;
        results.push({
          name: w.Name, description: w.Description,
          createdOn: w.CreatedOn, lastModifiedOn: w.LastModifiedOn,
          lastRun: w.LastRun ? { status: w.LastRun.Status, startedOn: w.LastRun.StartedOn } : undefined,
        });
      }
    }
    return results;
  }

  // ── S3 ───────────────────────────────────────────────────────────────────

  async listBuckets(): Promise<S3Bucket[]> {
    const res = await this._s3Request('GET', null, '/');
    this._ensureOk(res, 's3', 'xml');
    return this._xmlTags(res.body, 'Bucket').map(b => ({
      name: this._xmlTag(b, 'Name'),
      creationDate: this._xmlTag(b, 'CreationDate'),
    }));
  }

  async listObjects(bucket: string, prefix?: string, maxKeys?: number): Promise<S3Object[]> {
    const results: S3Object[] = [];
    let continuationToken: string | undefined;
    do {
      const params: string[] = ['list-type=2'];
      if (prefix) { params.push(`prefix=${encodeURIComponent(prefix)}`); }
      if (maxKeys) { params.push(`max-keys=${maxKeys}`); }
      if (continuationToken) { params.push(`continuation-token=${encodeURIComponent(continuationToken)}`); }
      const path = '/?' + params.join('&');
      const res = await this._s3Request('GET', bucket, path);
      this._ensureOk(res, 's3', 'xml');
      for (const c of this._xmlTags(res.body, 'Contents')) {
        results.push({
          key: this._xmlTag(c, 'Key'),
          size: parseInt(this._xmlTag(c, 'Size') || '0', 10),
          lastModified: this._xmlTag(c, 'LastModified'),
          storageClass: this._xmlTag(c, 'StorageClass'),
          etag: this._xmlTag(c, 'ETag') || undefined,
        });
      }
      const isTruncated = this._xmlTag(res.body, 'IsTruncated') === 'true';
      continuationToken = isTruncated ? this._xmlTag(res.body, 'NextContinuationToken') : undefined;
      if (maxKeys && results.length >= maxKeys) { break; }
    } while (continuationToken);
    return results;
  }

  async getObject(bucket: string, key: string): Promise<string> {
    const res = await this._s3Request('GET', bucket, `/${key}`);
    this._ensureOk(res, 's3', 'xml');
    return res.body;
  }

  async putObject(bucket: string, key: string, content: string, contentType?: string): Promise<void> {
    const res = await this._s3Request('PUT', bucket, `/${key}`, content, contentType ?? 'application/octet-stream');
    this._ensureOk(res, 's3', 'xml');
  }

  // ── CloudFormation ───────────────────────────────────────────────────────

  async listStacks(): Promise<CFStack[]> {
    const res = await this._jsonRequest(
      'cloudformation', 'CloudFormation_20100515.ListStacks', {}
    );
    this._ensureOk(res, 'cloudformation');
    const data = JSON.parse(res.body);
    return (data.StackSummaries ?? []).map((s: Record<string, unknown>) => ({
      stackName: s.StackName as string,
      stackId: s.StackId as string,
      stackStatus: s.StackStatus as string,
      creationTime: s.CreationTime as string,
      lastUpdatedTime: s.LastUpdatedTime as string | undefined,
      description: s.TemplateDescription as string | undefined,
    }));
  }

  async describeStack(stackName: string): Promise<CFStackDetail> {
    const res = await this._jsonRequest(
      'cloudformation', 'CloudFormation_20100515.DescribeStacks', { StackName: stackName }
    );
    this._ensureOk(res, 'cloudformation');
    const data = JSON.parse(res.body);
    const s = (data.Stacks ?? [])[0];
    if (!s) { throw new AwsError('Stack not found', 'StackNotFound', 404, 'cloudformation'); }
    return {
      stackName: s.StackName, stackId: s.StackId, stackStatus: s.StackStatus,
      creationTime: s.CreationTime, lastUpdatedTime: s.LastUpdatedTime,
      description: s.Description,
      parameters: s.Parameters?.map((p: { ParameterKey: string; ParameterValue: string }) => ({
        key: p.ParameterKey, value: p.ParameterValue,
      })),
      outputs: s.Outputs?.map((o: { OutputKey: string; OutputValue: string; Description?: string }) => ({
        key: o.OutputKey, value: o.OutputValue, description: o.Description,
      })),
      capabilities: s.Capabilities,
      tags: s.Tags?.map((t: { Key: string; Value: string }) => ({ key: t.Key, value: t.Value })),
    };
  }

  async getStackEvents(stackName: string, limit?: number): Promise<CFStackEvent[]> {
    const res = await this._jsonRequest(
      'cloudformation', 'CloudFormation_20100515.DescribeStackEvents', { StackName: stackName }
    );
    this._ensureOk(res, 'cloudformation');
    const data = JSON.parse(res.body);
    const events = (data.StackEvents ?? []).map((e: Record<string, unknown>) => ({
      eventId: e.EventId as string,
      stackName: e.StackName as string,
      logicalResourceId: e.LogicalResourceId as string,
      resourceType: e.ResourceType as string,
      resourceStatus: e.ResourceStatus as string,
      timestamp: e.Timestamp as string,
      resourceStatusReason: e.ResourceStatusReason as string | undefined,
    }));
    return limit ? events.slice(0, limit) : events;
  }

  async getStackTemplate(stackName: string): Promise<string> {
    const res = await this._jsonRequest(
      'cloudformation', 'CloudFormation_20100515.GetTemplate', { StackName: stackName }
    );
    this._ensureOk(res, 'cloudformation');
    const data = JSON.parse(res.body);
    return data.TemplateBody ?? '';
  }

  // ── Step Functions ───────────────────────────────────────────────────────

  async listStateMachines(): Promise<StateMachine[]> {
    const results: StateMachine[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = {};
      if (token) { body.nextToken = token; }
      const res = await this._jsonRequest('states', 'AWSStepFunctions.ListStateMachines', body);
      this._ensureOk(res, 'states');
      const data = JSON.parse(res.body);
      for (const sm of data.stateMachines ?? []) {
        results.push({
          stateMachineArn: sm.stateMachineArn, name: sm.name,
          type: sm.type, creationDate: sm.creationDate,
        });
      }
      token = data.nextToken;
    } while (token);
    return results;
  }

  async describeStateMachine(arn: string): Promise<StateMachineDetail> {
    const res = await this._jsonRequest('states', 'AWSStepFunctions.DescribeStateMachine', {
      stateMachineArn: arn,
    });
    this._ensureOk(res, 'states');
    const data = JSON.parse(res.body);
    return {
      stateMachineArn: data.stateMachineArn, name: data.name,
      type: data.type, creationDate: data.creationDate,
      definition: data.definition, roleArn: data.roleArn,
      status: data.status, loggingConfiguration: data.loggingConfiguration,
    };
  }

  async listExecutions(arn: string, maxResults?: number): Promise<Execution[]> {
    const body: Record<string, unknown> = { stateMachineArn: arn };
    if (maxResults) { body.maxResults = maxResults; }
    const res = await this._jsonRequest('states', 'AWSStepFunctions.ListExecutions', body);
    this._ensureOk(res, 'states');
    const data = JSON.parse(res.body);
    return (data.executions ?? []).map((e: Record<string, unknown>) => ({
      executionArn: e.executionArn as string,
      stateMachineArn: e.stateMachineArn as string,
      name: e.name as string, status: e.status as string,
      startDate: e.startDate as string, stopDate: e.stopDate as string | undefined,
    }));
  }

  async startExecution(arn: string, input?: string): Promise<{ executionArn: string }> {
    const body: Record<string, unknown> = { stateMachineArn: arn };
    if (input) { body.input = input; }
    const res = await this._jsonRequest('states', 'AWSStepFunctions.StartExecution', body);
    this._ensureOk(res, 'states');
    const data = JSON.parse(res.body);
    return { executionArn: data.executionArn };
  }

  // ── CloudWatch Logs ──────────────────────────────────────────────────────

  async getLogGroups(prefix?: string): Promise<LogGroup[]> {
    const results: LogGroup[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = {};
      if (prefix) { body.logGroupNamePrefix = prefix; }
      if (token) { body.nextToken = token; }
      const res = await this._jsonRequest('logs', 'Logs_20140328.DescribeLogGroups', body);
      this._ensureOk(res, 'logs');
      const data = JSON.parse(res.body);
      for (const g of data.logGroups ?? []) {
        results.push({
          logGroupName: g.logGroupName, creationTime: g.creationTime ?? 0,
          storedBytes: g.storedBytes ?? 0, retentionInDays: g.retentionInDays,
          arn: g.arn ?? '',
        });
      }
      token = data.nextToken;
    } while (token);
    return results;
  }

  async getLogEvents(logGroup: string, logStream: string, limit?: number): Promise<LogEvent[]> {
    const body: Record<string, unknown> = {
      logGroupName: logGroup, logStreamName: logStream, startFromHead: false,
    };
    if (limit) { body.limit = limit; }
    const res = await this._jsonRequest('logs', 'Logs_20140328.GetLogEvents', body);
    this._ensureOk(res, 'logs');
    const data = JSON.parse(res.body);
    return (data.events ?? []).map((e: { timestamp: number; message: string; ingestionTime?: number }) => ({
      timestamp: e.timestamp, message: e.message, ingestionTime: e.ingestionTime,
    }));
  }

  async filterLogEvents(
    logGroup: string, filterPattern: string,
    startTime?: number, limit?: number
  ): Promise<LogEvent[]> {
    const results: LogEvent[] = [];
    let token: string | undefined;
    const maxEvents = limit ?? 100;
    do {
      const body: Record<string, unknown> = { logGroupName: logGroup };
      if (filterPattern) { body.filterPattern = filterPattern; }
      if (startTime) { body.startTime = startTime; }
      body.limit = Math.min(maxEvents - results.length, 100);
      if (token) { body.nextToken = token; }
      const res = await this._jsonRequest('logs', 'Logs_20140328.FilterLogEvents', body);
      this._ensureOk(res, 'logs');
      const data = JSON.parse(res.body);
      for (const e of data.events ?? []) {
        results.push({
          timestamp: e.timestamp, message: e.message,
          ingestionTime: e.ingestionTime, logStreamName: e.logStreamName,
        });
      }
      token = data.nextToken;
      if (results.length >= maxEvents) { break; }
    } while (token);
    return results;
  }

  // ── DynamoDB ─────────────────────────────────────────────────────────────

  async listDynamoTables(): Promise<string[]> {
    const results: string[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = {};
      if (token) { body.ExclusiveStartTableName = token; }
      const res = await this._jsonRequest('dynamodb', 'DynamoDB_20120810.ListTables', body);
      this._ensureOk(res, 'dynamodb');
      const data = JSON.parse(res.body);
      results.push(...(data.TableNames ?? []));
      token = data.LastEvaluatedTableName;
    } while (token);
    return results;
  }

  async describeTable(tableName: string): Promise<DynamoTableDetail> {
    const res = await this._jsonRequest('dynamodb', 'DynamoDB_20120810.DescribeTable', {
      TableName: tableName,
    });
    this._ensureOk(res, 'dynamodb');
    const t = JSON.parse(res.body).Table;
    return {
      tableName: t.TableName, tableArn: t.TableArn, tableStatus: t.TableStatus,
      itemCount: t.ItemCount ?? 0, tableSizeBytes: t.TableSizeBytes ?? 0,
      keySchema: (t.KeySchema ?? []).map((k: { AttributeName: string; KeyType: string }) => ({
        attributeName: k.AttributeName, keyType: k.KeyType,
      })),
      attributeDefinitions: (t.AttributeDefinitions ?? []).map((a: { AttributeName: string; AttributeType: string }) => ({
        attributeName: a.AttributeName, attributeType: a.AttributeType,
      })),
      provisionedThroughput: t.ProvisionedThroughput ? {
        readCapacityUnits: t.ProvisionedThroughput.ReadCapacityUnits,
        writeCapacityUnits: t.ProvisionedThroughput.WriteCapacityUnits,
      } : undefined,
      globalSecondaryIndexes: t.GlobalSecondaryIndexes?.map((g: Record<string, unknown>) => ({
        indexName: g.IndexName as string,
        keySchema: ((g.KeySchema as { AttributeName: string; KeyType: string }[]) ?? []).map(k => ({
          attributeName: k.AttributeName, keyType: k.KeyType,
        })),
      })),
    };
  }

  async scanTable(tableName: string, limit?: number): Promise<DynamoItem[]> {
    const body: Record<string, unknown> = { TableName: tableName };
    if (limit) { body.Limit = limit; }
    const res = await this._jsonRequest('dynamodb', 'DynamoDB_20120810.Scan', body);
    this._ensureOk(res, 'dynamodb');
    const data = JSON.parse(res.body);
    return data.Items ?? [];
  }

  async queryTable(
    tableName: string,
    keyCondition: string,
    expressionValues: Record<string, unknown>
  ): Promise<DynamoItem[]> {
    const res = await this._jsonRequest('dynamodb', 'DynamoDB_20120810.Query', {
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: expressionValues,
    });
    this._ensureOk(res, 'dynamodb');
    const data = JSON.parse(res.body);
    return data.Items ?? [];
  }

  // ── EventBridge ──────────────────────────────────────────────────────────

  async listRules(eventBusName?: string): Promise<EventRule[]> {
    const body: Record<string, unknown> = {};
    if (eventBusName) { body.EventBusName = eventBusName; }
    const res = await this._jsonRequest('events', 'AWSEvents.ListRules', body);
    this._ensureOk(res, 'events');
    const data = JSON.parse(res.body);
    return (data.Rules ?? []).map((r: Record<string, unknown>) => ({
      name: r.Name as string, arn: r.Arn as string, state: r.State as string,
      description: r.Description as string | undefined,
      scheduleExpression: r.ScheduleExpression as string | undefined,
      eventPattern: r.EventPattern as string | undefined,
      eventBusName: r.EventBusName as string | undefined,
    }));
  }

  // ── SQS ──────────────────────────────────────────────────────────────────

  async listQueues(): Promise<SQSQueue[]> {
    const res = await this._jsonRequest('sqs', 'AmazonSQS.ListQueues', {});
    this._ensureOk(res, 'sqs');
    const data = JSON.parse(res.body);
    return (data.QueueUrls ?? []).map((url: string) => ({
      queueUrl: url,
      queueName: url.split('/').pop() ?? url,
    }));
  }

  // ── SNS ──────────────────────────────────────────────────────────────────

  async listTopics(): Promise<SNSTopic[]> {
    const results: SNSTopic[] = [];
    let token: string | undefined;
    do {
      const body: Record<string, unknown> = {};
      if (token) { body.NextToken = token; }
      const res = await this._jsonRequest('sns', 'SNS.ListTopics', body);
      this._ensureOk(res, 'sns');
      const data = JSON.parse(res.body);
      for (const t of data.Topics ?? []) {
        results.push({ topicArn: t.TopicArn });
      }
      token = data.NextToken;
    } while (token);
    return results;
  }
}
