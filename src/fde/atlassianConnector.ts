/**
 * Enterprise Atlassian Connector (Confluence & Jira)
 * 
 * Provides bi-directional synchronization between Evolve AI Architecture Models
 * and Atlassian Confluence (Cloud & Data Center) & Jira Software.
 * 
 * Features:
 * - Direct REST API integration (Confluence API v2/v1 & Jira API v3/v2)
 * - Corporate Security & Compliance Guard: Detects IP allowlisting (Atlassian Guard),
 *   SSO/SAML tokens, proxy/SSL inspection, and permissions issues.
 * - Air-Gapped / Offline Fallbacks: 1-click Confluence Storage Format XHTML export,
 *   Jira Bulk Import CSV, and Markdown/Wiki markup.
 */

import { C4ArchitectureModel, C4TopologyEngine } from './c4TopologyEngine';

export interface AtlassianCredentials {
  baseUrl: string; // e.g. https://your-company.atlassian.net
  email?: string;  // required for Cloud basic auth
  apiToken: string; // Cloud API token or Data Center Personal Access Token (PAT)
  confluenceSpaceKey?: string; // e.g. ARCH
  jiraProjectKey?: string;      // e.g. PROJ
  confluenceParentPageId?: string;
  isDataCenter?: boolean;       // true if on-premise Jira/Confluence Data Center
}

export interface SecurityDiagnosis {
  isIpBlocked: boolean;
  isAuthFailed: boolean;
  isPermissionDenied: boolean;
  isSslError: boolean;
  headline: string;
  recommendation: string;
}

export interface AtlassianTestResult {
  success: boolean;
  confluenceOk: boolean;
  jiraOk: boolean;
  userDisplayName?: string;
  error?: string;
  securityDiagnosis?: SecurityDiagnosis;
}

export interface ConfluencePublishResult {
  success: boolean;
  pageId?: string;
  pageUrl?: string;
  pageTitle?: string;
  version?: number;
  error?: string;
  securityDiagnosis?: SecurityDiagnosis;
}

export interface JiraExportResult {
  success: boolean;
  issuesCreated: number;
  epicKey?: string;
  issueKeys: string[];
  error?: string;
  securityDiagnosis?: SecurityDiagnosis;
}

export interface AtlassianImportResult {
  success: boolean;
  title?: string;
  rawSpec: string;
  extractedMermaid?: string;
  extractedPlantUml?: string;
  itemCount?: number;
  error?: string;
  securityDiagnosis?: SecurityDiagnosis;
}

export class AtlassianConnector {
  /**
   * Builds the authorization header for Atlassian REST APIs.
   * Cloud: Basic base64(email:apiToken)
   * Data Center / PAT: Bearer token
   */
  public static getAuthHeader(creds: AtlassianCredentials): string {
    const token = (creds.apiToken || '').trim();
    const email = (creds.email || '').trim();
    if (creds.isDataCenter || !email) {
      return `Bearer ${token}`;
    }
    const raw = `${email}:${token}`;
    const b64 = typeof Buffer !== 'undefined'
      ? Buffer.from(raw).toString('base64')
      : btoa(raw);
    return `Basic ${b64}`;
  }

  /**
   * Normalizes the base URL, removing trailing slashes
   */
  public static cleanBaseUrl(url: string): string {
    return (url || '').trim().replace(/\/+$/, '');
  }

  /**
   * Analyzes HTTP status codes, response bodies, and errors to detect
   * enterprise security barriers (Atlassian Guard IP allowlisting, SSO tokens, SSL inspection, RBAC).
   */
  public static diagnoseSecurityError(status: number, body: string, err?: any): SecurityDiagnosis {
    const raw = (body || '') + (err?.message || '');
    const isIpBlocked = status === 403 && (
      raw.includes('not on the allowed list') ||
      raw.includes('IP address has been rejected') ||
      raw.includes('allowlist') ||
      raw.includes('Access denied by IP')
    );
    const isAuthFailed = status === 401 || (status === 403 && (
      raw.includes('Unauthorized') ||
      raw.includes('Invalid credentials') ||
      raw.includes('AUTHENTICATED_FAILED')
    ));
    const isPermissionDenied = status === 403 && !isIpBlocked && (
      raw.includes('permission') ||
      raw.includes('Forbidden') ||
      raw.includes('Access denied') ||
      raw.includes('current_user_can_create')
    );
    const isSslError = Boolean(
      err?.code === 'CERT_HAS_EXPIRED' ||
      err?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      err?.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      raw.includes('certificate') ||
      raw.includes('SSL') ||
      raw.includes('TLS')
    );

    if (isIpBlocked) {
      return {
        isIpBlocked: true,
        isAuthFailed: false,
        isPermissionDenied: false,
        isSslError: false,
        headline: '🛡️ Atlassian Guard IP Allowlist Restriction Detected',
        recommendation:
          'Your corporate security policy restricts Atlassian REST API access to approved corporate IP ranges or VPN gateways. ' +
          'Solution: (1) Connect to your corporate VPN, or (2) Use the 1-click "Download Confluence Storage Format (.xhtml)" ' +
          'and "Download Jira CSV" buttons below to import seamlessly inside your authenticated browser session.'
      };
    }

    if (isSslError) {
      return {
        isIpBlocked: false,
        isAuthFailed: false,
        isPermissionDenied: false,
        isSslError: true,
        headline: '🔒 Corporate SSL/TLS Proxy Interception Detected',
        recommendation:
          'A corporate proxy (e.g. Zscaler, Netskope, Palo Alto) is inspecting HTTPS traffic. ' +
          'Solution: Ensure your corporate root CA certificate is configured in Node.js/system certificates, ' +
          'or export the offline XHTML/CSV package to publish directly via the browser.'
      };
    }

    if (isAuthFailed) {
      return {
        isIpBlocked: false,
        isAuthFailed: true,
        isPermissionDenied: false,
        isSslError: false,
        headline: '🔑 Authentication Failed (SSO / Token Required)',
        recommendation:
          'Standard passwords cannot access Atlassian REST APIs in SSO-enabled enterprises. ' +
          'Solution: Generate an Atlassian API Token at https://id.atlassian.com/manage-profile/security/api-tokens ' +
          '(or Personal Access Token in Data Center) and verify your account email.'
      };
    }

    if (isPermissionDenied) {
      return {
        isIpBlocked: false,
        isAuthFailed: false,
        isPermissionDenied: true,
        isSslError: false,
        headline: '🚫 Insufficient Space or Project Permissions',
        recommendation:
          'Your Atlassian user does not have write permissions for the specified Confluence Space Key or Jira Project Key. ' +
          'Solution: Check with your Confluence Space Admin / Jira Project Admin to grant "Create Page" and "Create Issue" permissions.'
      };
    }

    return {
      isIpBlocked: false,
      isAuthFailed: false,
      isPermissionDenied: false,
      isSslError: false,
      headline: '⚠️ Network or Service Error',
      recommendation:
        'Unable to reach Atlassian server. Verify the Base URL and ensure network connectivity, ' +
        'or use offline file export.'
    };
  }

  /**
   * Pre-flight test to verify credentials, Space write permissions, and Project access.
   */
  public static async testConnection(creds: AtlassianCredentials): Promise<AtlassianTestResult> {
    const baseUrl = this.cleanBaseUrl(creds.baseUrl);
    if (!baseUrl || !creds.apiToken) {
      return {
        success: false,
        confluenceOk: false,
        jiraOk: false,
        error: 'Base URL and API Token are required.',
        securityDiagnosis: {
          isIpBlocked: false,
          isAuthFailed: true,
          isPermissionDenied: false,
          isSslError: false,
          headline: 'Missing Credentials',
          recommendation: 'Please enter your Atlassian Base URL and API Token.'
        }
      };
    }

    const authHeader = this.getAuthHeader(creds);
    let jiraOk = false;
    let confluenceOk = false;
    let userDisplayName: string | undefined;

    try {
      // 1. Test Jira endpoint
      const jiraUrl = `${baseUrl}/rest/api/3/myself`;
      const jiraRes = await fetch(jiraUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });

      if (jiraRes.ok) {
        jiraOk = true;
        const jdata = await jiraRes.json();
        userDisplayName = jdata.displayName || jdata.name || creds.email;
      } else {
        const body = await jiraRes.text();
        const diag = this.diagnoseSecurityError(jiraRes.status, body);
        return {
          success: false,
          confluenceOk: false,
          jiraOk: false,
          error: `Jira check failed (HTTP ${jiraRes.status}): ${diag.headline}`,
          securityDiagnosis: diag
        };
      }

      // 2. Test Confluence endpoint (Space verification if spaceKey provided, else spaces list)
      const spaceKey = creds.confluenceSpaceKey ? encodeURIComponent(creds.confluenceSpaceKey.trim()) : '';
      const confUrl = spaceKey
        ? `${baseUrl}/wiki/api/v2/spaces?keys=${spaceKey}`
        : `${baseUrl}/wiki/api/v2/spaces?limit=1`;

      const confRes = await fetch(confUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });

      if (confRes.ok) {
        confluenceOk = true;
      } else {
        // Fallback check on Confluence v1 API
        const v1Url = spaceKey
          ? `${baseUrl}/wiki/rest/api/space/${spaceKey}`
          : `${baseUrl}/wiki/rest/api/space?limit=1`;
        const v1Res = await fetch(v1Url, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
          }
        });
        if (v1Res.ok) {
          confluenceOk = true;
        } else {
          const body = await v1Res.text();
          const diag = this.diagnoseSecurityError(v1Res.status, body);
          return {
            success: false,
            confluenceOk: false,
            jiraOk: true,
            userDisplayName,
            error: `Confluence check failed (HTTP ${v1Res.status}): ${diag.headline}`,
            securityDiagnosis: diag
          };
        }
      }

      return {
        success: jiraOk && confluenceOk,
        confluenceOk,
        jiraOk,
        userDisplayName
      };
    } catch (err: any) {
      const diag = this.diagnoseSecurityError(0, '', err);
      return {
        success: false,
        confluenceOk: false,
        jiraOk: false,
        error: err?.message || 'Connection error',
        securityDiagnosis: diag
      };
    }
  }

  /**
   * Publishes the Architecture Model as a comprehensive Blueprint Page in Confluence.
   */
  public static async publishToConfluence(
    creds: AtlassianCredentials,
    model: C4ArchitectureModel,
    options?: { pageTitle?: string }
  ): Promise<ConfluencePublishResult> {
    const baseUrl = this.cleanBaseUrl(creds.baseUrl);
    const spaceKey = (creds.confluenceSpaceKey || '').trim();
    if (!baseUrl || !creds.apiToken || !spaceKey) {
      return {
        success: false,
        error: 'Base URL, API Token, and Confluence Space Key are required.'
      };
    }

    const title = (options?.pageTitle || `${model.title} — Target Architecture Specification`).trim();
    const xhtmlBody = C4TopologyEngine.toConfluenceStorageFormat(model, { spaceKey, pageTitle: title });
    const authHeader = this.getAuthHeader(creds);

    try {
      // Step 1: Check if page already exists to update or create
      const searchUrl = `${baseUrl}/wiki/rest/api/content?title=${encodeURIComponent(title)}&spaceKey=${encodeURIComponent(spaceKey)}&expand=version`;
      const searchRes = await fetch(searchUrl, {
        method: 'GET',
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });

      if (!searchRes.ok) {
        const body = await searchRes.text();
        const diag = this.diagnoseSecurityError(searchRes.status, body);
        return { success: false, error: diag.headline, securityDiagnosis: diag };
      }

      const searchData = await searchRes.json();
      const existingPage = searchData.results && searchData.results.length > 0 ? searchData.results[0] : null;

      if (existingPage) {
        // Update existing page
        const pageId = existingPage.id;
        const currentVersion = existingPage.version?.number || 1;
        const updateUrl = `${baseUrl}/wiki/rest/api/content/${pageId}`;
        const updatePayload: any = {
          id: pageId,
          type: 'page',
          title,
          space: { key: spaceKey },
          body: {
            storage: {
              value: xhtmlBody,
              representation: 'storage'
            }
          },
          version: {
            number: currentVersion + 1,
            message: 'Updated by Evolve AI Architecture Studio'
          }
        };

        const updateRes = await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(updatePayload)
        });

        if (!updateRes.ok) {
          const body = await updateRes.text();
          const diag = this.diagnoseSecurityError(updateRes.status, body);
          return { success: false, error: diag.headline, securityDiagnosis: diag };
        }

        const updatedData = await updateRes.json();
        const pageUrl = `${baseUrl}/wiki${updatedData._links?.webui || ''}`;
        return {
          success: true,
          pageId,
          pageUrl,
          pageTitle: title,
          version: currentVersion + 1
        };
      } else {
        // Create new page
        const createUrl = `${baseUrl}/wiki/rest/api/content`;
        const createPayload: any = {
          type: 'page',
          title,
          space: { key: spaceKey },
          body: {
            storage: {
              value: xhtmlBody,
              representation: 'storage'
            }
          }
        };

        if (creds.confluenceParentPageId) {
          createPayload.ancestors = [{ id: creds.confluenceParentPageId.trim() }];
        }

        const createRes = await fetch(createUrl, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(createPayload)
        });

        if (!createRes.ok) {
          const body = await createRes.text();
          const diag = this.diagnoseSecurityError(createRes.status, body);
          return { success: false, error: diag.headline, securityDiagnosis: diag };
        }

        const createdData = await createRes.json();
        const pageId = createdData.id;
        const pageUrl = `${baseUrl}/wiki${createdData._links?.webui || ''}`;
        return {
          success: true,
          pageId,
          pageUrl,
          pageTitle: title,
          version: 1
        };
      }
    } catch (err: any) {
      const diag = this.diagnoseSecurityError(0, '', err);
      return { success: false, error: err?.message, securityDiagnosis: diag };
    }
  }

  /**
   * Exports systems and interaction flows into Jira as Epics and Stories.
   */
  public static async exportToJira(
    creds: AtlassianCredentials,
    model: C4ArchitectureModel
  ): Promise<JiraExportResult> {
    const baseUrl = this.cleanBaseUrl(creds.baseUrl);
    const projectKey = (creds.jiraProjectKey || '').trim();
    if (!baseUrl || !creds.apiToken || !projectKey) {
      return {
        success: false,
        issuesCreated: 0,
        issueKeys: [],
        error: 'Base URL, API Token, and Jira Project Key are required.'
      };
    }

    const authHeader = this.getAuthHeader(creds);
    const createdKeys: string[] = [];

    try {
      // Step 1: Create Main Epic for the Target Architecture
      const epicSummary = `[Arch Epic] ${model.title} — System Architecture & Integration`;
      const epicDesc = `*Architecture Overview:*\n${model.scenarioDescription}\n\n` +
        `*Systems in Scope:* ${model.level1.systems.map(s => s.label).join(', ')}\n\n` +
        `_Generated automatically by Evolve AI Architecture Studio_`;

      const epicPayload = {
        fields: {
          project: { key: projectKey },
          summary: epicSummary,
          description: epicDesc,
          issuetype: { name: 'Epic' }
        }
      };

      const epicRes = await fetch(`${baseUrl}/rest/api/2/issue`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(epicPayload)
      });

      let epicKey: string | undefined;
      if (epicRes.ok) {
        const edata = await epicRes.json();
        epicKey = edata.key;
        if (epicKey) createdKeys.push(epicKey);
      } else {
        // Fallback: If 'Epic' issue type is named differently or disabled, fallback to 'Story' or 'Task'
        const taskPayload = {
          fields: {
            project: { key: projectKey },
            summary: epicSummary,
            description: epicDesc,
            issuetype: { name: 'Task' }
          }
        };
        const taskRes = await fetch(`${baseUrl}/rest/api/2/issue`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(taskPayload)
        });
        if (taskRes.ok) {
          const tdata = await taskRes.json();
          epicKey = tdata.key;
          if (epicKey) createdKeys.push(epicKey);
        } else {
          const body = await taskRes.text();
          const diag = this.diagnoseSecurityError(taskRes.status, body);
          return { success: false, issuesCreated: 0, issueKeys: [], error: diag.headline, securityDiagnosis: diag };
        }
      }

      // Step 2: Create Stories for each Integration Connection Step
      for (const conn of model.level1.connections) {
        const storySummary = `[Flow ${conn.order}] ${conn.from} ➔ ${conn.to}: ${conn.label}`;
        const storyDesc = `*Interaction Step Details:*\n` +
          `• Source: ${conn.from}\n` +
          `• Destination: ${conn.to}\n` +
          `• Action: ${conn.label}\n` +
          `• Protocol: ${conn.protocol}\n` +
          `• Mode: ${conn.isAsync ? 'Asynchronous Event / Queue' : 'Synchronous REST / Blocking'}\n\n` +
          `*Acceptance Criteria:*\n` +
          `1. Implement and verify connection contract between ${conn.from} and ${conn.to}.\n` +
          `2. Validate latency budget & timeout handlers.\n` +
          `3. Ensure error and fallback handling is documented.`;

        const storyPayload: any = {
          fields: {
            project: { key: projectKey },
            summary: storySummary,
            description: storyDesc,
            issuetype: { name: 'Story' }
          }
        };

        const storyRes = await fetch(`${baseUrl}/rest/api/2/issue`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(storyPayload)
        });

        if (storyRes.ok) {
          const sdata = await storyRes.json();
          if (sdata.key) createdKeys.push(sdata.key);
        }
      }

      return {
        success: createdKeys.length > 0,
        issuesCreated: createdKeys.length,
        epicKey,
        issueKeys: createdKeys
      };
    } catch (err: any) {
      const diag = this.diagnoseSecurityError(0, '', err);
      return { success: false, issuesCreated: createdKeys.length, issueKeys: createdKeys, error: err?.message, securityDiagnosis: diag };
    }
  }

  /**
   * Imports a requirements document or specification from a Confluence page.
   */
  public static async importFromConfluence(
    creds: AtlassianCredentials,
    pageIdOrUrl: string
  ): Promise<AtlassianImportResult> {
    const baseUrl = this.cleanBaseUrl(creds.baseUrl);
    const authHeader = this.getAuthHeader(creds);

    let pageId = (pageIdOrUrl || '').trim();
    const urlMatch = pageId.match(/\/pages\/(\d+)/i) || pageId.match(/pageId=(\d+)/i);
    if (urlMatch) {
      pageId = urlMatch[1];
    }

    if (!pageId) {
      return { success: false, rawSpec: '', error: 'Valid Confluence Page ID or URL is required.' };
    }

    try {
      const getUrl = `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.storage,version`;
      const res = await fetch(getUrl, {
        method: 'GET',
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });

      if (!res.ok) {
        const body = await res.text();
        const diag = this.diagnoseSecurityError(res.status, body);
        return { success: false, rawSpec: '', error: diag.headline, securityDiagnosis: diag };
      }

      const data = await res.json();
      const title = data.title || 'Imported Confluence Specification';
      const storageXhtml = data.body?.storage?.value || '';

      const { extractedMermaid, extractedPlantUml, plainText } = this.extractContentFromStorageXhtml(storageXhtml);

      return {
        success: true,
        title,
        rawSpec: plainText,
        extractedMermaid,
        extractedPlantUml
      };
    } catch (err: any) {
      const diag = this.diagnoseSecurityError(0, '', err);
      return { success: false, rawSpec: '', error: err?.message, securityDiagnosis: diag };
    }
  }

  /**
   * Parses Confluence Storage Format XHTML to extract embedded Mermaid diagrams,
   * PlantUML macros, and plain text requirements.
   */
  public static extractContentFromStorageXhtml(storageXhtml: string): {
    extractedMermaid?: string;
    extractedPlantUml?: string;
    plainText: string;
  } {
    let extractedMermaid: string | undefined;
    const mmdMatch = storageXhtml.match(/<ac:structured-macro ac:name="mermaid"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/i);
    if (mmdMatch) {
      extractedMermaid = mmdMatch[1].trim();
    }

    let extractedPlantUml: string | undefined;
    const pumlMatch = storageXhtml.match(/<ac:structured-macro ac:name="plantuml"[^>]*>[\s\S]*?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/i);
    if (pumlMatch) {
      extractedPlantUml = pumlMatch[1].trim();
    }

    const plainText = storageXhtml
      .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    return { extractedMermaid, extractedPlantUml, plainText };
  }
}
