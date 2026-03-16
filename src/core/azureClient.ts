/**
 * core/azureClient.ts — Microsoft Azure REST API client
 *
 * Wraps Azure Management, Data Plane, and DevOps REST APIs using only
 * Node.js built-in modules (https, http, crypto).  Credentials are
 * stored / retrieved via IAIService.storeSecret / getSecret so they
 * live in VS Code SecretStorage — never in plain-text settings.
 *
 * Authentication: OAuth2 client-credentials flow (service principal).
 * Tokens are cached in memory and refreshed automatically before expiry.
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import type { IAIService } from './interfaces';

// ── Secret keys ──────────────────────────────────────────────────────────────

const SECRET_TENANT_ID       = 'azure-tenant-id';
const SECRET_CLIENT_ID       = 'azure-client-id';
const SECRET_CLIENT_SECRET   = 'azure-client-secret';
const SECRET_SUBSCRIPTION_ID = 'azure-subscription-id';

// ── Timeouts ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS   = 120_000;

// ── Token refresh buffer (refresh 2 min before actual expiry) ────────────────

const TOKEN_REFRESH_BUFFER_MS = 120_000;

// ── Azure scopes ─────────────────────────────────────────────────────────────

const SCOPE_MANAGEMENT  = 'https://management.azure.com/.default';
const SCOPE_KEY_VAULT   = 'https://vault.azure.net/.default';
const SCOPE_LOG_ANALYTICS = 'https://api.loganalytics.io/.default';

// ── Base URLs ────────────────────────────────────────────────────────────────

const BASE_MANAGEMENT = 'https://management.azure.com';
const BASE_LOG_ANALYTICS = 'https://api.loganalytics.io';

// ── Default API versions ─────────────────────────────────────────────────────

const API_VERSIONS: Record<string, string> = {
    subscriptions:   '2022-12-01',
    resourceGroups:  '2022-09-01',
    web:             '2023-01-01',
    logic:           '2019-05-01',
    cosmosDb:        '2023-11-15',
    storage:         '2023-01-01',
    keyVault:        '2022-07-01',
    alerts:          '2023-01-01',
    sql:             '2021-11-01',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Type definitions
// ═══════════════════════════════════════════════════════════════════════════════

export interface AzureResourceGroup {
    id: string;
    name: string;
    location: string;
    tags?: Record<string, string>;
}

export interface AzureSubscription {
    subscriptionId: string;
    displayName: string;
    state: string;
}

export interface AzureFunctionApp {
    id: string;
    name: string;
    resourceGroup: string;
    location: string;
    kind: string;
    state: string;
    defaultHostName: string;
}

export interface AzureFunctionAppDetail extends AzureFunctionApp {
    appServicePlanId: string;
    runtimeStack: string;
    appSettings: Record<string, string>;
}

export interface AzureFunction {
    id: string;
    name: string;
    language: string;
    isDisabled: boolean;
}

export interface AzureLogicApp {
    id: string;
    name: string;
    resourceGroup: string;
    location: string;
    state: string;
    createdTime: string;
    changedTime: string;
}

export interface AzureLogicAppDetail extends AzureLogicApp {
    definition: unknown;
    parameters: Record<string, unknown>;
    sku?: { name: string };
}

export interface LogicAppRun {
    id: string;
    name: string;
    status: string;
    startTime: string;
    endTime?: string;
    correlation?: { clientTrackingId: string };
}

export interface CosmosAccount {
    id: string;
    name: string;
    resourceGroup: string;
    location: string;
    kind: string;
    documentEndpoint: string;
}

export interface CosmosDatabase {
    id: string;
    _rid: string;
    _self: string;
}

export interface CosmosContainer {
    id: string;
    _rid: string;
    partitionKey: { paths: string[]; kind: string };
}

export interface CosmosQueryResult {
    Documents: unknown[];
    _count: number;
    _rid: string;
}

export interface AzureStorageAccount {
    id: string;
    name: string;
    resourceGroup: string;
    location: string;
    kind: string;
    sku: { name: string; tier: string };
}

export interface StorageContainer {
    name: string;
    properties: {
        lastModified: string;
        publicAccess: string;
        leaseStatus: string;
    };
}

export interface StorageBlob {
    name: string;
    properties: {
        contentLength: number;
        contentType: string;
        lastModified: string;
        blobType: string;
    };
}

export interface AzurePipeline {
    id: number;
    name: string;
    folder: string;
    revision: number;
    url: string;
}

export interface PipelineRun {
    id: number;
    name: string;
    state: string;
    result: string;
    createdDate: string;
    finishedDate?: string;
    url: string;
}

export interface AzureWebApp {
    id: string;
    name: string;
    resourceGroup: string;
    location: string;
    kind: string;
    state: string;
    defaultHostName: string;
}

export interface AzureWebAppDetail extends AzureWebApp {
    appServicePlanId: string;
    httpsOnly: boolean;
    siteConfig: {
        linuxFxVersion?: string;
        windowsFxVersion?: string;
        numberOfWorkers: number;
    };
}

export interface AzureKeyVault {
    id: string;
    name: string;
    resourceGroup: string;
    location: string;
    vaultUri: string;
}

export interface KeyVaultSecret {
    id: string;
    attributes: {
        enabled: boolean;
        created: number;
        updated: number;
    };
}

export interface LogQueryResult {
    tables: Array<{
        name: string;
        columns: Array<{ name: string; type: string }>;
        rows: unknown[][];
    }>;
}

export interface AzureAlert {
    id: string;
    name: string;
    properties: {
        severity: string;
        monitorCondition: string;
        alertState: string;
        startDateTime: string;
        description?: string;
    };
}

export interface AzureSqlServer {
    id: string;
    name: string;
    resourceGroup: string;
    location: string;
    fullyQualifiedDomainName: string;
    administratorLogin: string;
}

export interface AzureSqlDatabase {
    id: string;
    name: string;
    status: string;
    edition: string;
    collation: string;
    maxSizeBytes: number;
}

export interface AzureError {
    code: string;
    message: string;
    details?: Array<{ code: string; message: string }>;
}

// ── Internal token type ──────────────────────────────────────────────────────

interface CachedToken {
    accessToken: string;
    expiresAt: number; // epoch ms
}

// ── Raw HTTP response ────────────────────────────────────────────────────────

interface RawResponse {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AzureClient
// ═══════════════════════════════════════════════════════════════════════════════

export class AzureClient {

    private readonly tenantId: string;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly subscriptionId: string;

    /** Cached tokens keyed by scope */
    private readonly tokenCache = new Map<string, CachedToken>();

    // ── Construction ─────────────────────────────────────────────────────────

    private constructor(
        tenantId: string,
        clientId: string,
        clientSecret: string,
        subscriptionId: string,
    ) {
        this.tenantId = tenantId;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.subscriptionId = subscriptionId;
    }

    /**
     * Create an AzureClient from secrets stored in VS Code SecretStorage.
     * Returns `null` if any required credential is missing.
     */
    static async fromSecrets(ai: IAIService): Promise<AzureClient | null> {
        const [tenantId, clientId, clientSecret, subscriptionId] = await Promise.all([
            ai.getSecret(SECRET_TENANT_ID),
            ai.getSecret(SECRET_CLIENT_ID),
            ai.getSecret(SECRET_CLIENT_SECRET),
            ai.getSecret(SECRET_SUBSCRIPTION_ID),
        ]);

        if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
            return null;
        }

        return new AzureClient(tenantId, clientId, clientSecret, subscriptionId);
    }

    /**
     * Store Azure service principal credentials in VS Code SecretStorage.
     */
    static async configureCredentials(
        ai: IAIService,
        tenantId: string,
        clientId: string,
        clientSecret: string,
        subscriptionId: string,
    ): Promise<void> {
        await Promise.all([
            ai.storeSecret(SECRET_TENANT_ID, tenantId),
            ai.storeSecret(SECRET_CLIENT_ID, clientId),
            ai.storeSecret(SECRET_CLIENT_SECRET, clientSecret),
            ai.storeSecret(SECRET_SUBSCRIPTION_ID, subscriptionId),
        ]);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // OAuth2 client-credentials flow
    // ═════════════════════════════════════════════════════════════════════════

    private async getToken(scope: string): Promise<string> {
        const cached = this.tokenCache.get(scope);
        if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
            return cached.accessToken;
        }

        const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
        const body = [
            'grant_type=client_credentials',
            `client_id=${encodeURIComponent(this.clientId)}`,
            `client_secret=${encodeURIComponent(this.clientSecret)}`,
            `scope=${encodeURIComponent(scope)}`,
        ].join('&');

        const res = await this.rawRequest(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            timeoutMs: DEFAULT_TIMEOUT_MS,
        });

        if (res.statusCode !== 200) {
            const err = this.tryParseError(res.body);
            throw new Error(
                `Azure token request failed (${res.statusCode}): ${err?.message ?? res.body}`,
            );
        }

        const json = JSON.parse(res.body) as {
            access_token: string;
            expires_in: number;
        };

        this.tokenCache.set(scope, {
            accessToken: json.access_token,
            expiresAt: Date.now() + json.expires_in * 1000,
        });

        return json.access_token;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Low-level HTTP helpers
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Perform a raw HTTP(S) request using built-in Node modules.
     */
    private rawRequest(
        url: string,
        opts: {
            method: string;
            headers?: Record<string, string>;
            body?: string;
            timeoutMs: number;
        },
    ): Promise<RawResponse> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const transport = parsed.protocol === 'https:' ? https : http;

            const req = transport.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: opts.method,
                    headers: opts.headers,
                    timeout: opts.timeoutMs,
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () => {
                        resolve({
                            statusCode: res.statusCode ?? 0,
                            headers: res.headers,
                            body: Buffer.concat(chunks).toString('utf-8'),
                        });
                    });
                    res.on('error', reject);
                },
            );

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`Request timed out after ${opts.timeoutMs}ms: ${opts.method} ${url}`));
            });
            req.on('error', reject);

            if (opts.body) {
                req.write(opts.body);
            }
            req.end();
        });
    }

    /**
     * Authenticated GET/POST/PUT/DELETE against a fully-qualified URL.
     */
    private async request<T>(
        url: string,
        opts: {
            method?: string;
            body?: unknown;
            scope?: string;
            timeoutMs?: number;
            headers?: Record<string, string>;
        } = {},
    ): Promise<T> {
        const method = opts.method ?? 'GET';
        const scope = opts.scope ?? SCOPE_MANAGEMENT;
        const token = await this.getToken(scope);
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            ...opts.headers,
        };

        let bodyStr: string | undefined;
        if (opts.body !== undefined) {
            bodyStr = JSON.stringify(opts.body);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
        }

        const res = await this.rawRequest(url, { method, headers, body: bodyStr, timeoutMs });

        if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = this.tryParseError(res.body);
            throw new Error(
                `Azure API error ${res.statusCode} ${method} ${url}: ` +
                `${err?.code ?? 'Unknown'} — ${err?.message ?? res.body}`,
            );
        }

        // 204 No Content
        if (res.statusCode === 204 || !res.body) {
            return undefined as unknown as T;
        }

        return JSON.parse(res.body) as T;
    }

    /**
     * Shorthand: Management API request with subscription prefix.
     */
    private mgmt<T>(
        path: string,
        apiVersion: string,
        opts?: { method?: string; body?: unknown; timeoutMs?: number },
    ): Promise<T> {
        const sep = path.includes('?') ? '&' : '?';
        const url = `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}${path}${sep}api-version=${apiVersion}`;
        return this.request<T>(url, opts);
    }

    /**
     * Resource-group scoped management request.
     */
    private rgMgmt<T>(
        resourceGroup: string,
        providerPath: string,
        apiVersion: string,
        opts?: { method?: string; body?: unknown; timeoutMs?: number },
    ): Promise<T> {
        return this.mgmt<T>(
            `/resourceGroups/${resourceGroup}/providers/${providerPath}`,
            apiVersion,
            opts,
        );
    }

    private tryParseError(body: string): AzureError | null {
        try {
            const parsed = JSON.parse(body) as { error?: AzureError };
            return parsed.error ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Collect `value` array from a list response (handles pagination via nextLink).
     */
    private async listAll<T>(
        url: string,
        opts?: { scope?: string; timeoutMs?: number },
    ): Promise<T[]> {
        const results: T[] = [];
        let nextUrl: string | undefined = url;

        while (nextUrl) {
            const page: { value: T[]; nextLink?: string } = await this.request(nextUrl, opts);
            results.push(...(page.value ?? []));
            nextUrl = page.nextLink;
        }

        return results;
    }

    /**
     * Shorthand: list all from management path.
     */
    private async listMgmt<T>(
        path: string,
        apiVersion: string,
        opts?: { scope?: string; timeoutMs?: number },
    ): Promise<T[]> {
        const sep = path.includes('?') ? '&' : '?';
        const url = `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}${path}${sep}api-version=${apiVersion}`;
        return this.listAll<T>(url, opts);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Identity / Subscription
    // ═════════════════════════════════════════════════════════════════════════

    async testConnection(): Promise<{ ok: boolean; message: string }> {
        try {
            const sub = await this.getSubscription();
            return { ok: true, message: `Connected to subscription "${sub.displayName}" (${sub.state})` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, message: msg };
        }
    }

    async getSubscription(): Promise<AzureSubscription> {
        const raw = await this.mgmt<{
            subscriptionId: string;
            displayName: string;
            state: string;
        }>('', API_VERSIONS.subscriptions);
        return {
            subscriptionId: raw.subscriptionId,
            displayName: raw.displayName,
            state: raw.state,
        };
    }

    async listResourceGroups(): Promise<AzureResourceGroup[]> {
        return this.listMgmt<AzureResourceGroup>(
            '/resourcegroups',
            API_VERSIONS.resourceGroups,
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Azure Functions
    // ═════════════════════════════════════════════════════════════════════════

    async listFunctionApps(): Promise<AzureFunctionApp[]> {
        const sites = await this.listMgmt<{
            id: string;
            name: string;
            location: string;
            kind: string;
            properties: { state: string; defaultHostName: string };
        }>(
            `/providers/Microsoft.Web/sites?$filter=kind eq 'functionapp'`,
            API_VERSIONS.web,
        );

        return sites.map((s) => ({
            id: s.id,
            name: s.name,
            resourceGroup: this.extractResourceGroup(s.id),
            location: s.location,
            kind: s.kind,
            state: s.properties.state,
            defaultHostName: s.properties.defaultHostName,
        }));
    }

    async getFunctionApp(resourceGroup: string, name: string): Promise<AzureFunctionAppDetail> {
        const raw = await this.rgMgmt<{
            id: string;
            name: string;
            location: string;
            kind: string;
            properties: {
                state: string;
                defaultHostName: string;
                serverFarmId: string;
                siteConfig: { appSettings?: Array<{ name: string; value: string }> };
            };
        }>(resourceGroup, `Microsoft.Web/sites/${name}`, API_VERSIONS.web);

        const settings: Record<string, string> = {};
        for (const s of raw.properties.siteConfig.appSettings ?? []) {
            settings[s.name] = s.value;
        }

        return {
            id: raw.id,
            name: raw.name,
            resourceGroup,
            location: raw.location,
            kind: raw.kind,
            state: raw.properties.state,
            defaultHostName: raw.properties.defaultHostName,
            appServicePlanId: raw.properties.serverFarmId,
            runtimeStack: settings.FUNCTIONS_WORKER_RUNTIME ?? 'unknown',
            appSettings: settings,
        };
    }

    async listFunctions(resourceGroup: string, appName: string): Promise<AzureFunction[]> {
        const fns = await this.listAll<{
            id: string;
            name: string;
            properties: { language: string; isDisabled: boolean };
        }>(
            `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}` +
            `/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${appName}/functions` +
            `?api-version=${API_VERSIONS.web}`,
        );

        return fns.map((f) => ({
            id: f.id,
            name: f.name,
            language: f.properties.language,
            isDisabled: f.properties.isDisabled,
        }));
    }

    async getFunctionLogs(
        resourceGroup: string,
        appName: string,
        _functionName: string,
    ): Promise<string> {
        // Use the Kudu log-stream endpoint via management API
        const url =
            `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}` +
            `/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${appName}` +
            `/hostruntime/admin/vfs/LogFiles/Application/Functions/Host/` +
            `?api-version=${API_VERSIONS.web}`;

        try {
            const res = await this.request<string>(url, { timeoutMs: DEFAULT_TIMEOUT_MS });
            return typeof res === 'string' ? res : JSON.stringify(res, null, 2);
        } catch {
            return 'Unable to retrieve function logs. Ensure Application Insights is configured.';
        }
    }

    async invokeFunctionApp(url: string, payload?: unknown): Promise<unknown> {
        const method = payload !== undefined ? 'POST' : 'GET';
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        let bodyStr: string | undefined;

        if (payload !== undefined) {
            bodyStr = JSON.stringify(payload);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
        }

        const res = await this.rawRequest(url, {
            method,
            headers,
            body: bodyStr,
            timeoutMs: QUERY_TIMEOUT_MS,
        });

        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`Function invocation failed (${res.statusCode}): ${res.body}`);
        }

        try {
            return JSON.parse(res.body);
        } catch {
            return res.body;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Logic Apps
    // ═════════════════════════════════════════════════════════════════════════

    async listLogicApps(): Promise<AzureLogicApp[]> {
        const workflows = await this.listMgmt<{
            id: string;
            name: string;
            location: string;
            properties: { state: string; createdTime: string; changedTime: string };
        }>(
            '/providers/Microsoft.Logic/workflows',
            API_VERSIONS.logic,
        );

        return workflows.map((w) => ({
            id: w.id,
            name: w.name,
            resourceGroup: this.extractResourceGroup(w.id),
            location: w.location,
            state: w.properties.state,
            createdTime: w.properties.createdTime,
            changedTime: w.properties.changedTime,
        }));
    }

    async getLogicApp(resourceGroup: string, name: string): Promise<AzureLogicAppDetail> {
        const raw = await this.rgMgmt<{
            id: string;
            name: string;
            location: string;
            properties: {
                state: string;
                createdTime: string;
                changedTime: string;
                definition: unknown;
                parameters: Record<string, unknown>;
            };
            sku?: { name: string };
        }>(resourceGroup, `Microsoft.Logic/workflows/${name}`, API_VERSIONS.logic);

        return {
            id: raw.id,
            name: raw.name,
            resourceGroup,
            location: raw.location,
            state: raw.properties.state,
            createdTime: raw.properties.createdTime,
            changedTime: raw.properties.changedTime,
            definition: raw.properties.definition,
            parameters: raw.properties.parameters,
            sku: raw.sku,
        };
    }

    async listLogicAppRuns(
        resourceGroup: string,
        name: string,
        top?: number,
    ): Promise<LogicAppRun[]> {
        const topParam = top ? `&$top=${top}` : '';
        const runs = await this.listAll<{
            id: string;
            name: string;
            properties: {
                status: string;
                startTime: string;
                endTime?: string;
                correlation?: { clientTrackingId: string };
            };
        }>(
            `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}` +
            `/resourceGroups/${resourceGroup}/providers/Microsoft.Logic/workflows/${name}/runs` +
            `?api-version=${API_VERSIONS.logic}${topParam}`,
        );

        return runs.map((r) => ({
            id: r.id,
            name: r.name,
            status: r.properties.status,
            startTime: r.properties.startTime,
            endTime: r.properties.endTime,
            correlation: r.properties.correlation,
        }));
    }

    async triggerLogicApp(resourceGroup: string, name: string): Promise<void> {
        await this.rgMgmt<void>(
            resourceGroup,
            `Microsoft.Logic/workflows/${name}/triggers/manual/run`,
            API_VERSIONS.logic,
            { method: 'POST', body: {} },
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Cosmos DB
    // ═════════════════════════════════════════════════════════════════════════

    async listCosmosAccounts(): Promise<CosmosAccount[]> {
        const accounts = await this.listMgmt<{
            id: string;
            name: string;
            location: string;
            kind: string;
            properties: { documentEndpoint: string };
        }>(
            '/providers/Microsoft.DocumentDB/databaseAccounts',
            API_VERSIONS.cosmosDb,
        );

        return accounts.map((a) => ({
            id: a.id,
            name: a.name,
            resourceGroup: this.extractResourceGroup(a.id),
            location: a.location,
            kind: a.kind,
            documentEndpoint: a.properties.documentEndpoint,
        }));
    }

    async listCosmosDatabases(
        resourceGroup: string,
        account: string,
    ): Promise<CosmosDatabase[]> {
        const dbs = await this.listAll<{
            id: string;
            name: string;
            properties: { resource: { id: string; _rid: string; _self: string } };
        }>(
            `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}` +
            `/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB` +
            `/databaseAccounts/${account}/sqlDatabases` +
            `?api-version=${API_VERSIONS.cosmosDb}`,
        );

        return dbs.map((d) => ({
            id: d.properties.resource.id,
            _rid: d.properties.resource._rid,
            _self: d.properties.resource._self,
        }));
    }

    async listCosmosContainers(
        resourceGroup: string,
        account: string,
        database: string,
    ): Promise<CosmosContainer[]> {
        const containers = await this.listAll<{
            properties: {
                resource: {
                    id: string;
                    _rid: string;
                    partitionKey: { paths: string[]; kind: string };
                };
            };
        }>(
            `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}` +
            `/resourceGroups/${resourceGroup}/providers/Microsoft.DocumentDB` +
            `/databaseAccounts/${account}/sqlDatabases/${database}/containers` +
            `?api-version=${API_VERSIONS.cosmosDb}`,
        );

        return containers.map((c) => ({
            id: c.properties.resource.id,
            _rid: c.properties.resource._rid,
            partitionKey: c.properties.resource.partitionKey,
        }));
    }

    async queryCosmosDocuments(
        endpoint: string,
        key: string,
        database: string,
        container: string,
        query: string,
    ): Promise<CosmosQueryResult> {
        // Cosmos DB data-plane uses its own HMAC-SHA256 auth, not Azure AD
        const date = new Date().toUTCString();
        const resourceLink = `dbs/${database}/colls/${container}`;
        const resourceType = 'docs';

        const payload = `post\n${resourceType}\n${resourceLink}\n${date.toLowerCase()}\n\n`;
        const hmac = crypto.createHmac('sha256', Buffer.from(key, 'base64'));
        hmac.update(payload);
        const signature = hmac.digest('base64');
        const authToken = encodeURIComponent(`type=master&ver=1.0&sig=${signature}`);

        const url = `${endpoint}${resourceLink}/docs`;

        const headers: Record<string, string> = {
            'Authorization': authToken,
            'x-ms-date': date,
            'x-ms-version': '2020-07-15',
            'x-ms-documentdb-isquery': 'true',
            'Content-Type': 'application/query+json',
            'Accept': 'application/json',
        };

        const body = JSON.stringify({ query });
        headers['Content-Length'] = Buffer.byteLength(body).toString();

        const res = await this.rawRequest(url, {
            method: 'POST',
            headers,
            body,
            timeoutMs: QUERY_TIMEOUT_MS,
        });

        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`Cosmos DB query failed (${res.statusCode}): ${res.body}`);
        }

        return JSON.parse(res.body) as CosmosQueryResult;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Storage
    // ═════════════════════════════════════════════════════════════════════════

    async listStorageAccounts(): Promise<AzureStorageAccount[]> {
        const accounts = await this.listMgmt<{
            id: string;
            name: string;
            location: string;
            kind: string;
            sku: { name: string; tier: string };
        }>(
            '/providers/Microsoft.Storage/storageAccounts',
            API_VERSIONS.storage,
        );

        return accounts.map((a) => ({
            id: a.id,
            name: a.name,
            resourceGroup: this.extractResourceGroup(a.id),
            location: a.location,
            kind: a.kind,
            sku: a.sku,
        }));
    }

    async listContainers(
        resourceGroup: string,
        accountName: string,
    ): Promise<StorageContainer[]> {
        const containers = await this.listAll<{
            name: string;
            properties: {
                lastModified: string;
                publicAccess: string;
                leaseStatus: string;
            };
        }>(
            `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}` +
            `/resourceGroups/${resourceGroup}/providers/Microsoft.Storage` +
            `/storageAccounts/${accountName}/blobServices/default/containers` +
            `?api-version=${API_VERSIONS.storage}`,
        );

        return containers.map((c) => ({
            name: c.name,
            properties: c.properties,
        }));
    }

    async listBlobs(
        accountName: string,
        containerName: string,
        prefix?: string,
    ): Promise<StorageBlob[]> {
        // Blob service data-plane uses Azure AD bearer token with storage scope
        const token = await this.getToken('https://storage.azure.com/.default');
        const prefixParam = prefix ? `&prefix=${encodeURIComponent(prefix)}` : '';
        const url =
            `https://${accountName}.blob.core.windows.net/${containerName}` +
            `?restype=container&comp=list${prefixParam}`;

        const res = await this.rawRequest(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-ms-version': '2023-01-03',
                'Accept': 'application/xml',
            },
            timeoutMs: DEFAULT_TIMEOUT_MS,
        });

        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`Blob list failed (${res.statusCode}): ${res.body}`);
        }

        // Parse XML response (minimal parser for blob list)
        return this.parseBlobListXml(res.body);
    }

    async downloadBlob(
        accountName: string,
        containerName: string,
        blobName: string,
    ): Promise<string> {
        const token = await this.getToken('https://storage.azure.com/.default');
        const url =
            `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName)}`;

        const res = await this.rawRequest(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-ms-version': '2023-01-03',
            },
            timeoutMs: QUERY_TIMEOUT_MS,
        });

        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`Blob download failed (${res.statusCode}): ${res.body}`);
        }

        return res.body;
    }

    async uploadBlob(
        accountName: string,
        containerName: string,
        blobName: string,
        content: string,
    ): Promise<void> {
        const token = await this.getToken('https://storage.azure.com/.default');
        const url =
            `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName)}`;

        const res = await this.rawRequest(url, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'x-ms-version': '2023-01-03',
                'x-ms-blob-type': 'BlockBlob',
                'Content-Type': 'application/octet-stream',
                'Content-Length': Buffer.byteLength(content).toString(),
            },
            body: content,
            timeoutMs: DEFAULT_TIMEOUT_MS,
        });

        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`Blob upload failed (${res.statusCode}): ${res.body}`);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Azure DevOps Pipelines
    // ═════════════════════════════════════════════════════════════════════════

    async listPipelines(organization: string, project: string): Promise<AzurePipeline[]> {
        const url =
            `https://dev.azure.com/${organization}/${project}/_apis/pipelines?api-version=7.1`;
        const res = await this.request<{ value: AzurePipeline[] }>(url);
        return res.value ?? [];
    }

    async listPipelineRuns(
        organization: string,
        project: string,
        pipelineId: number,
    ): Promise<PipelineRun[]> {
        const url =
            `https://dev.azure.com/${organization}/${project}` +
            `/_apis/pipelines/${pipelineId}/runs?api-version=7.1`;
        const res = await this.request<{ value: PipelineRun[] }>(url);
        return res.value ?? [];
    }

    async triggerPipeline(
        organization: string,
        project: string,
        pipelineId: number,
    ): Promise<{ id: number }> {
        const url =
            `https://dev.azure.com/${organization}/${project}` +
            `/_apis/pipelines/${pipelineId}/runs?api-version=7.1`;
        return this.request<{ id: number }>(url, { method: 'POST', body: {} });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // App Service
    // ═════════════════════════════════════════════════════════════════════════

    async listWebApps(): Promise<AzureWebApp[]> {
        const sites = await this.listMgmt<{
            id: string;
            name: string;
            location: string;
            kind: string;
            properties: { state: string; defaultHostName: string };
        }>(
            '/providers/Microsoft.Web/sites',
            API_VERSIONS.web,
        );

        // Filter out function apps
        return sites
            .filter((s) => !s.kind?.includes('functionapp'))
            .map((s) => ({
                id: s.id,
                name: s.name,
                resourceGroup: this.extractResourceGroup(s.id),
                location: s.location,
                kind: s.kind,
                state: s.properties.state,
                defaultHostName: s.properties.defaultHostName,
            }));
    }

    async getWebApp(resourceGroup: string, name: string): Promise<AzureWebAppDetail> {
        const raw = await this.rgMgmt<{
            id: string;
            name: string;
            location: string;
            kind: string;
            properties: {
                state: string;
                defaultHostName: string;
                serverFarmId: string;
                httpsOnly: boolean;
                siteConfig: {
                    linuxFxVersion?: string;
                    windowsFxVersion?: string;
                    numberOfWorkers: number;
                };
            };
        }>(resourceGroup, `Microsoft.Web/sites/${name}`, API_VERSIONS.web);

        return {
            id: raw.id,
            name: raw.name,
            resourceGroup,
            location: raw.location,
            kind: raw.kind,
            state: raw.properties.state,
            defaultHostName: raw.properties.defaultHostName,
            appServicePlanId: raw.properties.serverFarmId,
            httpsOnly: raw.properties.httpsOnly,
            siteConfig: raw.properties.siteConfig,
        };
    }

    async restartWebApp(resourceGroup: string, name: string): Promise<void> {
        await this.rgMgmt<void>(
            resourceGroup,
            `Microsoft.Web/sites/${name}/restart`,
            API_VERSIONS.web,
            { method: 'POST' },
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Key Vault
    // ═════════════════════════════════════════════════════════════════════════

    async listKeyVaults(): Promise<AzureKeyVault[]> {
        const vaults = await this.listMgmt<{
            id: string;
            name: string;
            location: string;
            properties: { vaultUri: string };
        }>(
            '/providers/Microsoft.KeyVault/vaults',
            API_VERSIONS.keyVault,
        );

        return vaults.map((v) => ({
            id: v.id,
            name: v.name,
            resourceGroup: this.extractResourceGroup(v.id),
            location: v.location,
            vaultUri: v.properties.vaultUri,
        }));
    }

    async listSecrets(vaultUrl: string): Promise<KeyVaultSecret[]> {
        // Key Vault data plane uses a separate auth scope
        const baseUrl = vaultUrl.endsWith('/') ? vaultUrl.slice(0, -1) : vaultUrl;
        const url = `${baseUrl}/secrets?api-version=7.4`;

        const results: KeyVaultSecret[] = [];
        let nextUrl: string | undefined = url;

        while (nextUrl) {
            const page: { value: KeyVaultSecret[]; nextLink?: string } =
                await this.request(nextUrl, { scope: SCOPE_KEY_VAULT });
            results.push(...(page.value ?? []));
            nextUrl = page.nextLink;
        }

        return results;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Monitor / Logs
    // ═════════════════════════════════════════════════════════════════════════

    async queryLogs(
        workspaceId: string,
        query: string,
        timespan?: string,
    ): Promise<LogQueryResult> {
        const url = `${BASE_LOG_ANALYTICS}/v1/workspaces/${workspaceId}/query`;
        const body: Record<string, string> = { query };
        if (timespan) {
            body.timespan = timespan;
        }

        return this.request<LogQueryResult>(url, {
            method: 'POST',
            body,
            scope: SCOPE_LOG_ANALYTICS,
            timeoutMs: QUERY_TIMEOUT_MS,
        });
    }

    async listAlerts(resourceGroup?: string): Promise<AzureAlert[]> {
        const path = resourceGroup
            ? `/resourceGroups/${resourceGroup}/providers/Microsoft.AlertsManagement/alerts`
            : '/providers/Microsoft.AlertsManagement/alerts';

        return this.listMgmt<AzureAlert>(path, API_VERSIONS.alerts);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SQL Database
    // ═════════════════════════════════════════════════════════════════════════

    async listSqlServers(): Promise<AzureSqlServer[]> {
        const servers = await this.listMgmt<{
            id: string;
            name: string;
            location: string;
            properties: {
                fullyQualifiedDomainName: string;
                administratorLogin: string;
            };
        }>(
            '/providers/Microsoft.Sql/servers',
            API_VERSIONS.sql,
        );

        return servers.map((s) => ({
            id: s.id,
            name: s.name,
            resourceGroup: this.extractResourceGroup(s.id),
            location: s.location,
            fullyQualifiedDomainName: s.properties.fullyQualifiedDomainName,
            administratorLogin: s.properties.administratorLogin,
        }));
    }

    async listSqlDatabases(
        resourceGroup: string,
        serverName: string,
    ): Promise<AzureSqlDatabase[]> {
        const dbs = await this.listAll<{
            id: string;
            name: string;
            properties: {
                status: string;
                edition: string;
                collation: string;
                maxSizeBytes: number;
            };
        }>(
            `${BASE_MANAGEMENT}/subscriptions/${this.subscriptionId}` +
            `/resourceGroups/${resourceGroup}/providers/Microsoft.Sql` +
            `/servers/${serverName}/databases` +
            `?api-version=${API_VERSIONS.sql}`,
        );

        return dbs.map((d) => ({
            id: d.id,
            name: d.name,
            status: d.properties.status,
            edition: d.properties.edition,
            collation: d.properties.collation,
            maxSizeBytes: d.properties.maxSizeBytes,
        }));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Utility
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Extract resource group name from an Azure resource ID.
     * Format: /subscriptions/{sub}/resourceGroups/{rg}/providers/...
     */
    private extractResourceGroup(resourceId: string): string {
        const match = /\/resourceGroups\/([^/]+)/i.exec(resourceId);
        return match?.[1] ?? 'unknown';
    }

    /**
     * Minimal XML parser for Azure Blob Storage list responses.
     * Extracts <Blob> elements with name and properties.
     */
    private parseBlobListXml(xml: string): StorageBlob[] {
        const blobs: StorageBlob[] = [];
        const blobRegex = /<Blob>([\s\S]*?)<\/Blob>/g;
        let blobMatch: RegExpExecArray | null;

        while ((blobMatch = blobRegex.exec(xml)) !== null) {
            const block = blobMatch[1];
            const name = this.extractXmlValue(block, 'Name') ?? '';
            const contentLength = parseInt(this.extractXmlValue(block, 'Content-Length') ?? '0', 10);
            const contentType = this.extractXmlValue(block, 'Content-Type') ?? 'application/octet-stream';
            const lastModified = this.extractXmlValue(block, 'Last-Modified') ?? '';
            const blobType = this.extractXmlValue(block, 'BlobType') ?? 'BlockBlob';

            blobs.push({
                name,
                properties: {
                    contentLength,
                    contentType,
                    lastModified,
                    blobType,
                },
            });
        }

        return blobs;
    }

    private extractXmlValue(xml: string, tag: string): string | null {
        const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
        const match = regex.exec(xml);
        return match?.[1] ?? null;
    }
}
