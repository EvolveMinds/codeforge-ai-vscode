import * as assert from 'assert';
import { ClientTopologyParser } from '../../../fde/clientTopologyParser';
import { C4TopologyEngine } from '../../../fde/c4TopologyEngine';
import { generateHelpGuideReply } from '../../../desktop/main/ipcHandlers';

suite('FDE Suite — Client Architecture Document Ingestion Engine', () => {
  test('ingests native Mermaid diagram directly into legacy or future state', () => {
    const rawMermaid = `sequenceDiagram
    autonumber
    actor Customer as Retail Customer
    participant Mobile as Mobile iOS App
    participant Core as Core Banking DB
    Customer->>Mobile: Submit Fund Transfer ($500)
    Mobile->>Core: Direct SQL Write
    Core-->>Customer: Transfer Confirmed`;

    // 1. Target = legacy
    const legacyRes = ClientTopologyParser.parse({
      content: rawMermaid,
      target: 'legacy',
      docName: 'Client Core Banking Topology'
    });

    assert.strictEqual(legacyRes.success, true);
    assert.strictEqual(legacyRes.detectedFormat, 'mermaid');
    assert.strictEqual(legacyRes.target, 'legacy');
    assert.ok(legacyRes.legacyDiagram && legacyRes.legacyDiagram.includes('Customer->>Mobile'));
    assert.strictEqual(legacyRes.futureDiagram, undefined);
    assert.strictEqual(legacyRes.participantCount, 3);
    assert.strictEqual(legacyRes.messageCount, 3);

    // 2. Target = future
    const futureRes = ClientTopologyParser.parse({
      content: rawMermaid,
      target: 'future',
      docName: 'Mandated Future Topology'
    });

    assert.strictEqual(futureRes.success, true);
    assert.strictEqual(futureRes.target, 'future');
    assert.ok(futureRes.futureDiagram && futureRes.futureDiagram.includes('Mobile->>Core'));
    assert.strictEqual(futureRes.legacyDiagram, undefined);
  });

  test('transpiles PlantUML sequence diagram to verified Mermaid sequence syntax', () => {
    const plantUml = `@startuml
autonumber
actor "Borrower" as Client
participant "Kong Gateway" as Gateway
participant "Underwriting Engine" as Engine
database "PostgreSQL DB" as DB
actor "Senior Underwriter" as HITL

Client -> Gateway : POST /loans
Gateway -> Engine : Process Application
Engine -> DB : Query Credit Bureau
DB --> Engine : Credit Score Data
alt High Risk Loan
    Engine -> HITL : Request Sign-Off
    HITL --> Engine : Approval Token
end
Engine -> DB : Commit Loan Record
Engine --> Gateway : Response 201 Created
Gateway --> Client : Confirmation
@enduml`;

    const res = ClientTopologyParser.parse({
      content: plantUml,
      target: 'future',
      docName: 'Enterprise Architecture PlantUML Spec'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.detectedFormat, 'plantuml');
    assert.ok(res.futureDiagram && res.futureDiagram.startsWith('sequenceDiagram'));
    assert.ok(res.futureDiagram.includes('autonumber'));
    assert.ok(res.futureDiagram.includes('participant Gateway as Kong Gateway'));
    assert.ok(res.futureDiagram.includes('participant DB as PostgreSQL DB'));
    assert.ok(res.futureDiagram.includes('Client->>Gateway: POST /loans'));
    assert.ok(res.futureDiagram.includes('DB-->>Engine: Credit Score Data'));
  });

  test('synthesizes Mermaid topology from unstructured client runbook prose', () => {
    const prose = `
# Current Legacy Operations Runbook
Brokers receive commercial loan applications as PDF attachments via email.
Brokers manually re-key loan data into an unencrypted Excel spreadsheet on an SFTP share.
Every night at midnight, a batch cron script picks up the spreadsheet and attempts to ingest records into AS400 core mainframe.
Underwriters open spreadsheets manually to verify debt-to-income ratio.
There is zero automated validation, high manual transcription error rate, and a 48-hour batch delay.
`;

    const res = ClientTopologyParser.parse({
      content: prose,
      target: 'legacy',
      docName: 'Commercial Lending As-Is Runbook'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.legacyDiagram && res.legacyDiagram.includes('sequenceDiagram'));
    assert.ok(res.legacyDiagram.includes('AS400 Mainframe Core Banking'));
    assert.ok(res.legacyDiagram.includes('Manual Spreadsheets & Email Ingress') || res.legacyDiagram.includes('Unsecured SFTP Drop Share'));
    assert.ok(res.legacyDiagram.includes('Nightly Batch Cron & ETL Scripts') || res.legacyDiagram.includes('Ad-Hoc Manual Processing Silo'));
    assert.ok(res.legacyDiagram.includes('Note over'));
    assert.strictEqual(res.futureDiagram, undefined);
  });

  test('handles bifurcated client document generating both legacy and target topologies', () => {
    const bifurcatedDoc = `
## Current State (As-Is Bottlenecks)
Brokers receive PDF applications via email.
Brokers manually transcribe data into spreadsheets.
Batch scripts load unvalidated records into AS400 core system.

## Future State (Target Architecture)
All applications enter through Apigee API Gateway with OAuth2 mutual TLS.
Apigee publishes events to Apache Kafka message queue.
Evolve AI copilot parses payload and queries pgvector knowledge base.
Human supervisor reviews exceptions in ServiceNow before final commit.
Transactions committed to Oracle RAC database with cryptographic receipts.
`;

    const res = ClientTopologyParser.parse({
      content: bifurcatedDoc,
      target: 'both',
      docName: 'Commercial Lending SAD v4.0'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.target, 'both');
    assert.ok(res.legacyDiagram && res.legacyDiagram.includes('AS400'));
    assert.ok(res.futureDiagram && res.futureDiagram.includes('Apigee API Gateway'));
    assert.ok(res.futureDiagram.includes('Apache Kafka Event Mesh'));
    assert.ok(res.futureDiagram.includes('Evolve AI Copilot'));
    assert.ok(res.futureDiagram.includes('Human-in-the-Loop (HITL) Review Gate'));
    assert.ok(res.futureDiagram.includes('Oracle RAC'));
  });

  test('Virtual Guide answers queries regarding client-provided current and future topologies', () => {
    const userQueries = [
      'what if the company has something that is what they wanted us to use as current topology and in some cases use the ones they give as future topology too? how can we address it if they have some document and wanted us to use that',
      'Can I import client architecture documents or existing diagrams?',
      'How do we use company provided architecture as current topology or target topology?'
    ];

    for (const q of userQueries) {
      const reply = generateHelpGuideReply(q);
      assert.strictEqual(reply.success, true);
      assert.ok(reply.reply.includes('Ingesting Client-Provided Architecture Documents & Specifications'));
      assert.ok(reply.reply.includes('Phase 1 Step 3'));
      assert.ok(reply.reply.includes('Import Client Spec'));
      assert.ok(reply.reply.includes('Current State (As-Is / Legacy Bottlenecks)'));
      assert.ok(reply.reply.includes('Future State (To-Be / Target Architecture)'));
      assert.ok(reply.actions && reply.actions.length >= 2);
      
      const p1Step3Action = reply.actions!.find(a => a.phase === 1 && a.subStep === '3');
      assert.ok(p1Step3Action, 'Must include link to Phase 1 Step 3');
    }
  });

  test('handles massive complex requirements document and synthesizes multi-step workflow topology', () => {
    const hugeRequirement = `
# Global Commercial Lending & Credit Assessment Platform Specification
Document Version: 3.2.0-PROD
Classification: Internal Enterprise Mandate

1. Executive Summary & Architecture Overview
This specification defines the end-to-end automated loan intake, scoring, and servicing topology.
All interactions must be authenticated, tenant-isolated, and cryptographically signed.

2. Interaction Steps and Operational Flows
1. Borrower submits loan application via the Mobile React Native App with KYC documents.
2. API Gateway validates OAuth2 tenant claims and executes mTLS verification.
3. API Gateway routes verified application payload to the Underwriting Service.
4. Underwriting Service queries the Credit Bureau API to fetch consumer risk scores and history.
5. Underwriting Service calls the Fraud Detection Service to evaluate synthetic identity risks.
6. If fraud score exceeds risk threshold, Underwriting Service routes to Senior Underwriter for review.
7. Senior Underwriter issues cryptographic 1-click approval token in ServiceNow portal.
8. Underwriting Service dispatches approved event to Apache Kafka topic 'commercial-loans-approved'.
9. Loan Servicing Service consumes approval event and commits loan balance to PostgreSQL Core DB.
10. Notification Service sends SMS and email confirmation receipts with contract PDF to Borrower.

3. Out-of-Scope Constraints
- No manual paper re-keying allowed in production.
- Direct database mutation without API schema validation is strictly blocked.
`;

    const res = ClientTopologyParser.parse({
      content: hugeRequirement,
      target: 'future',
      docName: 'Lending_Platform_Reqs_v3.2.docx'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.target, 'future');
    assert.ok(res.futureDiagram && res.futureDiagram.startsWith('sequenceDiagram'));
    assert.ok(res.futureDiagram.includes('autonumber'));
    assert.ok(res.participantCount >= 4, `Expected at least 4 participants, got ${res.participantCount}`);
    assert.ok(res.messageCount >= 5, `Expected at least 5 messages, got ${res.messageCount}`);
    assert.ok(res.futureDiagram.includes('Underwriting Service') || res.futureDiagram.includes('API Gateway') || res.futureDiagram.includes('Borrower'));
    assert.ok(res.futureDiagram.includes('Kafka') || res.futureDiagram.includes('PostgreSQL') || res.futureDiagram.includes('Supervisor') || res.futureDiagram.includes('Underwriter'));
  });

  test('synthesizes accurate MuleSoft API-led healthcare integration topology (Salesforce, CHIB, EMR, xAmplify)', () => {
    const healthcareRequirement = `Process 1 – Visit validation and document consolidation
Salesforce gets an immediate "Request Received" acknowledgement; MuleSoft then validates the visit in EMR Sunrise via CHIB and, only on "Success", fetches the referral documents and has xAmplify consolidate them.
1. Salesforce calls the Mule Experience API with Visit ID, MRN and SAUHI (plus Referral ID for correlation).
2. Mule validates the request, assigns a correlation ID and acknowledges; Salesforce updates the referral status to "Request Received".
3. Mule (Process API) calls CHIB with the same payload to validate the entry in EMR.
4. EMR validates the identifiers and sends the response back to Mule via CHIB.
5. If Visit ID, MRN and SAUHI all match, EMR returns "Success" as the acknowledgement to Mule.
6. If any validation fails, Mule passes the corresponding EMR message back to Salesforce so the user sees the reason.
7. On "Success", Mule fetches the referral documents from Salesforce and sends them to xAmplify for consolidation.
8. Mule writes the consolidated document back to the Salesforce referral (as a file) and updates the status to "Documents Consolidated", ready for Salesforce to initiate Process 2.`;

    const res = ClientTopologyParser.parse({
      content: healthcareRequirement,
      target: 'future',
      docName: 'Enterprise Healthcare Integration Spec v1.0'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.target, 'future');
    assert.ok(res.futureDiagram && res.futureDiagram.startsWith('sequenceDiagram'));
    assert.ok(res.futureDiagram.includes('autonumber'));

    // Check participants: all 6 domain systems must be present
    assert.ok(res.futureDiagram.includes('participant Salesforce as Salesforce CRM'), 'Must have Salesforce participant');
    assert.ok(res.futureDiagram.includes('participant MuleExp as Mule Experience API'), 'Must have Mule Experience API');
    assert.ok(res.futureDiagram.includes('participant MuleProc as Mule Process API'), 'Must have Mule Process API');
    assert.ok(res.futureDiagram.includes('participant CHIB as CHIB Integration Broker'), 'Must have CHIB participant');
    assert.ok(res.futureDiagram.includes('participant EMR as EMR Sunrise Clinical Core'), 'Must have EMR Sunrise participant');
    assert.ok(res.futureDiagram.includes('participant xAmplify as xAmplify Document Consolidation Engine'), 'Must have xAmplify participant');

    // Check that generic template entities are NOT hallucinated
    assert.strictEqual(res.futureDiagram.includes('Evolve AI Copilot'), false, 'Should not inject generic Evolve AI Copilot');
    assert.strictEqual(res.futureDiagram.includes('Deterministic Schema'), false, 'Should not inject generic Deterministic Schema');

    // Check scenario note
    assert.ok(res.futureDiagram.includes('Note over Salesforce,xAmplify: Process 1: Visit validation and document consolidation'));

    // Check critical interaction steps
    assert.ok(res.futureDiagram.includes('Salesforce->>MuleExp: Calls Experience API with Visit ID, MRN & SAUHI (Referral ID correlation)'));
    assert.ok(res.futureDiagram.includes('MuleExp-->>Salesforce: Acknowledge request & assign Correlation ID (Status: "Request Received")'));
    assert.ok(res.futureDiagram.includes('MuleExp->>MuleProc: Delegate visit validation process'));
    assert.ok(res.futureDiagram.includes('MuleProc->>CHIB: Call CHIB with payload to validate entry in EMR'));
    assert.ok(res.futureDiagram.includes('CHIB->>EMR: Forward identifier validation query'));
    assert.ok(res.futureDiagram.includes('EMR-->>CHIB: Validates identifiers & sends response back'));
    assert.ok(res.futureDiagram.includes('CHIB-->>MuleProc: Deliver EMR validation response to Mule'));

    // Check conditional blocks
    assert.ok(res.futureDiagram.includes('alt Visit ID, MRN and SAUHI all match ("Success")'));
    assert.ok(res.futureDiagram.includes('EMR-->>MuleProc: Returns "Success" acknowledgement (via CHIB)'));
    assert.ok(res.futureDiagram.includes('else Validation fails'));
    assert.ok(res.futureDiagram.includes('MuleProc-->>Salesforce: Pass corresponding EMR error message back so user sees reason'));

    // Check consolidation pipeline
    assert.ok(res.futureDiagram.includes('opt On "Success": Document Consolidation Pipeline'));
    assert.ok(res.futureDiagram.includes('MuleProc->>Salesforce: Fetch unconsolidated referral documents'));
    assert.ok(res.futureDiagram.includes('Salesforce-->>MuleProc: Return referral document attachments'));
    assert.ok(res.futureDiagram.includes('MuleProc->>xAmplify: Send referral documents to xAmplify for consolidation'));
    assert.ok(res.futureDiagram.includes('xAmplify-->>MuleProc: Return consolidated document payload'));
    assert.ok(res.futureDiagram.includes('MuleProc->>Salesforce: Write consolidated document back as file (Status: "Documents Consolidated")'));
  });

  test('synthesizes universal e-commerce microservices architecture (Cloudflare, FastAPI, RabbitMQ, DynamoDB, Stripe, SendGrid)', () => {
    const ecommerceDoc = `Process 1: Order Checkout and Inventory Reservation
1. Customer submits checkout form on React Web App.
2. React Web App sends payment token to Cloudflare Ingress.
3. Cloudflare Ingress routes order payload to FastAPI Gateway.
4. FastAPI Gateway validates HMAC signature and pushes order event to RabbitMQ OrdersQueue.
5. Inventory Worker consumes message from RabbitMQ OrdersQueue.
6. Inventory Worker queries DynamoDB to check stock availability.
7. Inventory Worker calls Stripe API to authorize credit card charge.
8. Stripe API returns payment authorization token to Inventory Worker.
9. If payment authorized, Inventory Worker commits stock reduction in DynamoDB.
10. If payment declined, Inventory Worker alerts Customer via SendGrid Service.
`;

    const res = ClientTopologyParser.parse({
      content: ecommerceDoc,
      target: 'future',
      docName: 'E-Commerce Microservices Spec v1'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.target, 'future');
    assert.ok(res.futureDiagram && res.futureDiagram.startsWith('sequenceDiagram'));
    assert.ok(res.futureDiagram.includes('actor Customer as Customer'));
    assert.ok(res.futureDiagram.includes('participant ReactWebApp as React Web App'));
    assert.ok(res.futureDiagram.includes('participant CloudflareIngress as Cloudflare Ingress'));
    assert.ok(res.futureDiagram.includes('participant FastAPIGateway as FastAPI Gateway'));
    assert.ok(res.futureDiagram.includes('participant RabbitMQOrdersQueue as RabbitMQ OrdersQueue'));
    assert.ok(res.futureDiagram.includes('participant InventoryWorker as Inventory Worker'));
    assert.ok(res.futureDiagram.includes('participant DynamoDB as DynamoDB'));
    assert.ok(res.futureDiagram.includes('participant StripeAPI as Stripe API'));

    // Check steps and control flow
    assert.ok(res.futureDiagram.includes('Customer->>ReactWebApp: Submits checkout form on React Web App'));
    assert.ok(res.futureDiagram.includes('ReactWebApp->>CloudflareIngress: Sends payment token to Cloudflare Ingress'));
    assert.ok(res.futureDiagram.includes('CloudflareIngress->>FastAPIGateway: Routes order payload to FastAPI Gateway'));
    assert.ok(res.futureDiagram.includes('InventoryWorker->>DynamoDB'));
    assert.ok(res.futureDiagram.includes('StripeAPI-->>InventoryWorker: Returns payment authorization token to Inventory Worker'));
    assert.ok(res.futureDiagram.includes('alt payment authorized'));
    assert.ok(res.futureDiagram.includes('else payment declined'));
    assert.ok(res.futureDiagram.includes('end'));
  });

  test('synthesizes universal banking core wire settlement architecture (Teller, Finacle, Kafka, AML, Neo4j, Postgres, Fedwire)', () => {
    const bankingDoc = `Core Banking Wire Settlement:
1. Teller logs into Finacle Core with Biometric Key.
2. Finacle Core sends payment instruction to Kafka WireTopic.
3. AML Screening Service consumes message from Kafka WireTopic.
4. AML Screening Service queries sanction list in Neo4j Graph DB.
5. If sanction hit found: AML Screening Service freezes transfer in Postgres Ledger.
6. If clean: AML Screening Service forwards payment to Fedwire Terminal.
7. Fedwire Terminal confirms clearing to AML Screening Service.
`;

    const res = ClientTopologyParser.parse({
      content: bankingDoc,
      target: 'future',
      docName: 'Banking Wire Clearing Architecture'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.target, 'future');
    assert.ok(res.futureDiagram && res.futureDiagram.startsWith('sequenceDiagram'));
    assert.ok(res.futureDiagram.includes('actor Teller as Teller'));
    assert.ok(res.futureDiagram.includes('participant FinacleCore as Finacle Core'));
    assert.ok(res.futureDiagram.includes('participant KafkaWireTopic as Kafka WireTopic'));
    assert.ok(res.futureDiagram.includes('participant AMLScreeningService as AML Screening Service'));
    assert.ok(res.futureDiagram.includes('participant Neo4j as Neo4j') || res.futureDiagram.includes('participant Neo4jGraphDB as Neo4j Graph DB'));
    assert.ok(res.futureDiagram.includes('participant PostgresLedger as Postgres Ledger'));
    assert.ok(res.futureDiagram.includes('participant FedwireTerminal as Fedwire Terminal'));

    // Check sequence interactions
    assert.ok(res.futureDiagram.includes('Teller->>FinacleCore: Logs into Finacle Core with Biometric Key') || res.futureDiagram.includes('Teller->>FinacleCore'));
    assert.ok(res.futureDiagram.includes('FinacleCore->>KafkaWireTopic: Sends payment instruction to Kafka WireTopic'));
    assert.ok(res.futureDiagram.includes('AMLScreeningService->>KafkaWireTopic: Consumes message from Kafka WireTopic'));
    assert.ok(res.futureDiagram.includes('alt sanction hit found'));
    assert.ok(res.futureDiagram.includes('AMLScreeningService->>PostgresLedger: Freezes transfer in Postgres Ledger'));
    assert.ok(res.futureDiagram.includes('else clean'));
    assert.ok(res.futureDiagram.includes('AMLScreeningService->>FedwireTerminal: Forwards payment to Fedwire Terminal'));
    assert.ok(res.futureDiagram.includes('FedwireTerminal-->>AMLScreeningService: Confirms clearing to AML Screening Service'));
    assert.ok(res.futureDiagram.includes('end'));
  });

  test('synthesizes universal IoT industrial stream analytics topology (Vehicle Telematics Unit, EMQX MQTT, Kafka, Flink, InfluxDB, PagerDuty)', () => {
    const iotDoc = `Fleet Telematics Stream Pipeline:
1. Vehicle Telematics Unit sends GPS telemetry to EMQX Broker.
2. EMQX Broker forwards telematics stream to Kafka TelematicsTopic.
3. Flink Stream Processor consumes telematics stream from Kafka TelematicsTopic.
4. Flink Stream Processor writes engine metrics to InfluxDB TimeSeries Store.
5. If engine temperature exceeds threshold, Flink Stream Processor alerts Operations Dispatcher via PagerDuty Engine.
6. Operations Dispatcher acknowledges alert to Flink Stream Processor.
`;

    const res = ClientTopologyParser.parse({
      content: iotDoc,
      target: 'future',
      docName: 'Fleet Telematics Architecture'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.target, 'future');
    assert.ok(res.futureDiagram && res.futureDiagram.startsWith('sequenceDiagram'));
    assert.ok(res.futureDiagram.includes('VehicleTelematicsUnit') || res.futureDiagram.includes('Vehicle Telematics Unit'));
    assert.ok(res.futureDiagram.includes('EMQXBroker') || res.futureDiagram.includes('EMQX Broker'));
    assert.ok(res.futureDiagram.includes('KafkaTelematicsTopic') || res.futureDiagram.includes('Kafka TelematicsTopic'));
    assert.ok(res.futureDiagram.includes('FlinkStreamProcessor') || res.futureDiagram.includes('Flink Stream Processor'));
    assert.ok(res.futureDiagram.includes('InfluxDB') || res.futureDiagram.includes('InfluxDB TimeSeries Store'));
    assert.ok(res.futureDiagram.includes('PagerDutyEngine') || res.futureDiagram.includes('PagerDuty Engine') || res.futureDiagram.includes('Operations Dispatcher'));

    assert.ok(res.futureDiagram.includes('VehicleTelematicsUnit->>EMQXBroker'));
    assert.ok(res.futureDiagram.includes('EMQXBroker->>KafkaTelematicsTopic'));
    assert.ok(res.futureDiagram.includes('FlinkStreamProcessor->>InfluxDB'));
    assert.ok(res.futureDiagram.includes('alt engine temperature exceeds threshold'));
  });

  test('synthesizes 3-level C4 hierarchical architecture model with Human-in-the-Loop exception gate', () => {
    const healthcareDoc = `Process 1 – Visit validation and document consolidation:
1. Salesforce calls the Mule Experience API with Visit ID, MRN and SAUHI.
2. Mule validates the request, assigns a correlation ID and acknowledges.
3. Mule Process API calls CHIB with the same payload to validate the entry in EMR.
4. EMR validates the identifiers and sends the response back to Mule via CHIB.
5. If Visit ID, MRN and SAUHI all match, EMR returns Success as acknowledgement to Mule.
6. If any validation fails, Mule routes exception to Clinician Review Gate.
7. On Success, Mule fetches referral documents and sends to xAmplify for consolidation.
8. Mule writes consolidated document back to Salesforce.
`;

    const res = ClientTopologyParser.parse({
      content: healthcareDoc,
      target: 'both',
      docName: 'Healthcare Integration Spec'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.c4Model, 'C4 Model should be generated');

    const m = res.c4Model!;
    // Level 1 System Context validation
    assert.ok(m.level1.systems.length >= 6, 'Must have at least 6 core systems in context');
    const systemIds = m.level1.systems.map(s => s.id);
    assert.ok(systemIds.includes('Salesforce'), 'Must include Salesforce');
    assert.ok(systemIds.includes('MuleSoft'), 'Must include MuleSoft');
    assert.ok(systemIds.includes('CHIB'), 'Must include CHIB');
    assert.ok(systemIds.includes('EMR'), 'Must include EMR');
    assert.ok(systemIds.includes('xAmplify'), 'Must include xAmplify');
    assert.ok(systemIds.includes('HITL_Gate'), 'Must include Human-in-the-Loop Review Gate');

    // Level 2 Container Drill-Down validation
    assert.ok(m.level2['MuleSoft'], 'Must support Level 2 drill-down into MuleSoft');
    const muleContainers = m.level2['MuleSoft'].containers.map(c => c.id);
    assert.ok(muleContainers.includes('Mule_Exp'), 'Must have Experience API container');
    assert.ok(muleContainers.includes('Mule_Proc'), 'Must have Process API orchestrator');
    assert.ok(muleContainers.includes('Mule_Sys_CHIB'), 'Must have System API connector');
    assert.ok(muleContainers.includes('Mule_Store'), 'Must have Object Store state cache');

    // Level 3 Component & Contract validation
    assert.ok(m.level3['Mule_Proc'], 'Must support Level 3 drill-down into Mule_Proc');
    const contracts = m.level3['Mule_Proc'].components[0].contracts;
    assert.ok(contracts.some(c => c.field === 'Visit_ID'), 'Must define Visit_ID contract');
    assert.ok(contracts.some(c => c.field === 'MRN'), 'Must define MRN contract');
    assert.ok(contracts.some(c => c.field === 'Correlation_ID'), 'Must define Correlation_ID contract');

    // Human-in-the-Loop (HITL) Gate validation
    assert.ok(m.hitlGates.length >= 1, 'Must define at least 1 HITL gate');
    const hitl = m.hitlGates[0];
    assert.strictEqual(hitl.reviewRole, 'Referring Clinician / Medical Records Specialist');
    assert.ok(hitl.humanActions.some(a => a.action === 'override'), 'Must support manual clinical override');
    assert.ok(hitl.humanActions.some(a => a.action === 'reject'), 'Must support referral rejection');
    assert.strictEqual(hitl.slaMinutes, 30);
    assert.ok(hitl.auditProvenance.includes('SHA-256'), 'Must enforce immutable audit trail');
  });

  test('renders Level 1 System Context and Level 2 Container SVGs with drill-down metadata', () => {
    const model = C4TopologyEngine.synthesizeModel('Salesforce, MuleSoft, CHIB, EMR Sunrise, xAmplify');
    
    // Level 1 SVG
    const svgL1 = C4TopologyEngine.renderTopologySvg(model, 1, undefined, false);
    assert.ok(svgL1.includes('LEVEL 1: SYSTEM CONTEXT TOPOLOGY'));
    assert.ok(svgL1.includes('BOUNDARY: INTEGRATION CLOUD'));
    assert.ok(svgL1.includes('BOUNDARY: HUMAN GOVERNANCE'));
    assert.ok(svgL1.includes('HITL GATE'));
    assert.ok(svgL1.includes('MuleSoft'));

    // Level 1 SVG with HITL exception path simulated
    const svgL1Exception = C4TopologyEngine.renderTopologySvg(model, 1, undefined, true);
    assert.ok(svgL1Exception.includes('c4-glow-red'));

    // Level 2 SVG for MuleSoft
    const svgL2 = C4TopologyEngine.renderTopologySvg(model, 2, 'MuleSoft', false);
    assert.ok(svgL2.includes('LEVEL 2: CONTAINER TOPOLOGY'));
    assert.ok(svgL2.includes('SYSTEM CONTAINER BOUNDARY: MULESOFT'));
    assert.ok(svgL2.includes('Mule Experience API'));
    assert.ok(svgL2.includes('Mule Process API'));
    assert.ok(svgL2.includes('Object Store'));
  });
});

