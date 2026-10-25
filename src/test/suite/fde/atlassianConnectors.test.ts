import * as assert from 'assert';
import { C4TopologyEngine, C4ArchitectureModel } from '../../../fde/c4TopologyEngine';
import { AtlassianConnector, AtlassianCredentials } from '../../../fde/atlassianConnector';

suite('FDE Suite — Tri-Architect Lens & Enterprise Atlassian Connectors', () => {
  const sampleSpec = `
Process 1 – Visit validation and document consolidation
Salesforce gets an immediate "Request Received" acknowledgement; MuleSoft then validates the visit in EMR Sunrise via CHIB and, only on "Success", fetches the referral documents and has xAmplify consolidate them.
1. Salesforce calls the Mule Experience API with Visit ID, MRN and SAUHI (plus Referral ID for correlation).
2. Mule validates the request, assigns a correlation ID and acknowledges; Salesforce updates the referral status to "Request Received".
3. Mule (Process API) calls CHIB with the same payload to validate the entry in EMR.
4. EMR validates the identifiers and sends the response back to Mule via CHIB.
5. If Visit ID, MRN and SAUHI all match, EMR returns "Success" as the acknowledgement to Mule.
6. If any validation fails, Mule passes the corresponding EMR message back to Salesforce so the user sees the reason.
7. On "Success", Mule fetches the referral documents from Salesforce and sends them to xAmplify for consolidation.
8. Mule writes the consolidated document back to the Salesforce referral (as a file) and updates the status to "Documents Consolidated", ready for Salesforce to initiate Process 2.

Integration Process flow 2 – Document consolidation and upload
Flow 2 runs asynchronously off a queue, so a slow xAmplify or Sunrise call never blocks Salesforce. Each referral is processed once, keyed on Referral ID + Visit ID.
1. EMR Referral Process API consumes the "visit validated" message from Anypoint MQ.
2. Salesforce System API retrieves the referral's documents (ContentVersion / ContentDocumentLink) and metadata.
3. Process API filters to the document types required for EMR and orders them per business rules.
4. xAmplify System API sends the documents and metadata to xAmplify, which returns one consolidated document (e.g. PDF/A).
5. Process API checks the result (file present, size limit, page count > 0, checksum).
6. Sunrise Document System API uploads the consolidated document against the validated Visit ID with document type, author, date and title.
7. Sunrise returns an acknowledgement (e.g. HL7 ACK or document ID).
8. Salesforce System API updates the referral: status "Uploaded to EMR", Sunrise document ID, timestamp, correlation ID.
`;

  let model: C4ArchitectureModel;

  suiteSetup(() => {
    model = C4TopologyEngine.synthesizeModel(sampleSpec, 'Healthcare Referral & Visit Validation');
  });

  // --- 1. Industry Standard C4-PlantUML Generation ---
  test('generates industry standard C4-PlantUML container diagram with standard stdlib imports', () => {
    const puml = C4TopologyEngine.toC4PlantUml(model);

    assert.ok(puml.includes('@startuml'), 'Should begin with @startuml');
    assert.ok(puml.includes('@enduml'), 'Should terminate with @enduml');
    assert.ok(
      puml.includes('!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml'),
      'Must include official C4_Container stdlib url'
    );
    assert.ok(puml.includes('LAYOUT_WITH_LEGEND()'), 'Should configure C4 legend layout');
    assert.ok(puml.includes('System_Boundary('), 'Should group containers inside System_Boundary');
    assert.ok(puml.includes('Rel('), 'Should output relationships using C4 Rel syntax');
    assert.ok(puml.includes('Salesforce') || puml.includes('salesforce'), 'Should reference Salesforce system');
    assert.ok(puml.includes('Mule') || puml.includes('mule'), 'Should reference MuleSoft system');
  });

  // --- 2. Confluence Storage Format XHTML Generation ---
  test('generates native Confluence Storage Format XHTML with embedded macros and SVG', () => {
    const xhtml = C4TopologyEngine.toConfluenceStorageFormat(model, { spaceKey: 'ARCH' });

    assert.ok(xhtml.includes('<ac:structured-macro ac:name="info">'), 'Should have Confluence info macro');
    assert.ok(xhtml.includes('<ac:structured-macro ac:name="mermaid">'), 'Should have Confluence Mermaid macro for interactive editing');
    assert.ok(xhtml.includes('<![CDATA['), 'Mermaid code must be CDATA protected');
    assert.ok(xhtml.includes('sequenceDiagram'), 'Macro CDATA must include sequence diagram');
    assert.ok(xhtml.includes('<ac:structured-macro ac:name="code">'), 'Should have PlantUML code macro');
    assert.ok(xhtml.includes('<svg'), 'Should include embedded standalone vector SVG');
    assert.ok(xhtml.includes('<table>'), 'Should output systems and container catalog table');
    assert.ok(xhtml.includes('<th>System / Service</th>'), 'Table should have System / Service column');
    assert.ok(xhtml.includes('<th>Security Boundary</th>'), 'Table should display Security Boundary');
    assert.ok(xhtml.includes('<th>Technology Stack</th>'), 'Table should display Technology');
  });

  // --- 3. Jira Bulk CSV Generation ---
  test('generates RFC 4180 compliant Jira Bulk Import CSV for 1-click import', () => {
    const csv = C4TopologyEngine.toJiraBulkCsv(model, { projectKey: 'PROJ' });

    const lines = csv.split('\r\n');
    assert.ok(lines.length >= 4, 'Should contain headers, Epic row, and multiple Story rows');

    // Header check
    const header = lines[0];
    assert.ok(header.includes('Issue Type') && header.includes('Summary') && header.includes('Epic Name') && header.includes('Labels'), 'Header must contain RFC 4180 Jira fields');

    // Epic row check
    const epicRow = lines[1];
    assert.ok(epicRow.startsWith('"Epic"'), 'First row must be Epic');
    assert.ok(epicRow.includes('Healthcare Referral & Visit Validation'), 'Epic summary must match architecture title');

    // Story rows check
    const storyRows = lines.slice(2).filter(l => l.startsWith('"Story"'));
    assert.ok(storyRows.length > 0, 'Should generate Story issues for architectural components');
    storyRows.forEach(row => {
      assert.ok(row.includes('system-component'), 'Story must include system component label');
    });
  });

  // --- 4. Jira Wiki Markup Generation ---
  test('generates Jira Wiki markup for ticket descriptions', () => {
    const wiki = C4TopologyEngine.toJiraWikiMarkup(model);

    assert.ok(wiki.includes(`h1. 🌐 ${model.title}`), 'Should contain Jira h1 title');
    assert.ok(wiki.includes('||System||Role||Boundary||Technologies||'), 'Should contain Jira table headers');
    assert.ok(wiki.includes('{code:title='), 'Should embed code macros with titles');
    assert.ok(wiki.includes('h2. 2. End-to-End Execution Sequence Flow'), 'Should include Execution Flow section');
  });

  // --- 5. Tri-Architect Lens SVG Rendering ---
  test('renders SVG with appropriate badges and styling for each Architect Lens', () => {
    // Lens: system (System Architect: Trust Boundaries & Security)
    const svgSystem = C4TopologyEngine.renderTopologySvg(model, 1, undefined, false, false, undefined, undefined, 'system');
    assert.ok(svgSystem.includes('SYSTEM ARCHITECT VIEW'), 'Should show System Architect badge');

    // Lens: application (Application Architect: APIs, Queues & Modularity)
    const svgApp = C4TopologyEngine.renderTopologySvg(model, 1, undefined, false, false, undefined, undefined, 'application');
    assert.ok(svgApp.includes('APPLICATION ARCHITECT VIEW'), 'Should show Application Architect badge');

    // Lens: data (Data Architect: Data Assets, Contracts & Lineage)
    const svgData = C4TopologyEngine.renderTopologySvg(model, 1, undefined, false, false, undefined, undefined, 'data');
    assert.ok(svgData.includes('DATA ARCHITECT VIEW'), 'Should show Data Architect badge');

    // Lens: all (Unified View)
    const svgAll = C4TopologyEngine.renderTopologySvg(model, 1, undefined, false, false, undefined, undefined, 'all');
    assert.ok(svgAll.includes('UNIFIED ARCHITECTURE VIEW'), 'Should show Unified badge');
  });

  // --- 6. Atlassian Connector Authentication & URL Handling ---
  test('formats Cloud Basic Auth and Data Center Bearer tokens correctly', () => {
    const cloudCreds: AtlassianCredentials = {
      baseUrl: 'https://company.atlassian.net/',
      email: 'architect@company.com',
      apiToken: 'secret_token_123'
    };
    const cloudHeader = AtlassianConnector.getAuthHeader(cloudCreds);
    assert.ok(cloudHeader.startsWith('Basic '), 'Cloud auth must be Basic base64');
    const decoded = Buffer.from(cloudHeader.replace('Basic ', ''), 'base64').toString('utf8');
    assert.strictEqual(decoded, 'architect@company.com:secret_token_123');

    const dcCreds: AtlassianCredentials = {
      baseUrl: 'https://jira.internal.company.com:8443',
      apiToken: 'pat_token_abc',
      isDataCenter: true
    };
    const dcHeader = AtlassianConnector.getAuthHeader(dcCreds);
    assert.strictEqual(dcHeader, 'Bearer pat_token_abc', 'Data Center auth must use Bearer PAT');

    assert.strictEqual(AtlassianConnector.cleanBaseUrl('https://company.atlassian.net///'), 'https://company.atlassian.net');
  });

  // --- 7. Enterprise Corporate Security Diagnosis ---
  test('diagnoses Atlassian Guard IP allowlist blocking with actionable guidance', () => {
    const ipErrorBody = JSON.stringify({
      code: 403,
      message: 'The IP address has been rejected because it is not on the allowed list configured in Atlassian Guard'
    });
    const diag = AtlassianConnector.diagnoseSecurityError(403, ipErrorBody);

    assert.strictEqual(diag.isIpBlocked, true);
    assert.strictEqual(diag.isAuthFailed, false);
    assert.ok(diag.headline.includes('Atlassian Guard IP Allowlist Restriction'));
    assert.ok(diag.recommendation.includes('VPN'), 'Recommendation should suggest connecting to corporate VPN');
    assert.ok(diag.recommendation.includes('Download Confluence Storage Format (.xhtml)'), 'Recommendation should offer offline fallback');
  });

  test('diagnoses SSO / Token authentication failure', () => {
    const authErrorBody = 'Unauthorized: invalid credentials or session token expired';
    const diag = AtlassianConnector.diagnoseSecurityError(401, authErrorBody);

    assert.strictEqual(diag.isAuthFailed, true);
    assert.strictEqual(diag.isIpBlocked, false);
    assert.ok(diag.headline.includes('Authentication Failed'));
    assert.ok(diag.recommendation.includes('API Token'), 'Recommendation should mention Atlassian API token');
  });

  test('diagnoses Corporate SSL / Proxy inspection interception', () => {
    const sslErr = { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' };
    const diag = AtlassianConnector.diagnoseSecurityError(0, '', sslErr);

    assert.strictEqual(diag.isSslError, true);
    assert.ok(diag.headline.includes('Corporate SSL/TLS Proxy Interception Detected'));
    assert.ok(diag.recommendation.includes('Zscaler') || diag.recommendation.includes('proxy') || diag.recommendation.includes('inspection'));
  });

  test('diagnoses RBAC permission denied', () => {
    const rbacErrorBody = 'Forbidden: current_user_can_create check failed for space ARCH';
    const diag = AtlassianConnector.diagnoseSecurityError(403, rbacErrorBody);

    assert.strictEqual(diag.isPermissionDenied, true);
    assert.ok(diag.headline.includes('Insufficient Space or Project Permissions'));
  });

  // --- 8. Bi-directional Confluence Import & Reverse Engineering ---
  test('extracts Mermaid and PlantUML diagrams from Confluence Storage XHTML for round-trip synchronization', () => {
    const sampleConfluenceHtml = `
      <h1>Architecture Page</h1>
      <ac:structured-macro ac:name="mermaid">
        <ac:plain-text-body><![CDATA[sequenceDiagram
autonumber
Salesforce->>MuleSoft: Validate Visit
MuleSoft->>EMR: Query Visit ID
EMR-->>MuleSoft: Status OK]]></ac:plain-text-body>
      </ac:structured-macro>
      <p>System requirements description text.</p>
    `;

    const extracted = AtlassianConnector.extractContentFromStorageXhtml(sampleConfluenceHtml);
    assert.ok(extracted.extractedMermaid, 'Should extract embedded Mermaid diagram');
    assert.ok(extracted.extractedMermaid.includes('Salesforce->>MuleSoft: Validate Visit'));
    assert.ok(extracted.plainText.includes('System requirements description text'));
  });
});
