import * as assert from 'assert';
import { ClientTopologyParser } from '../../../fde/clientTopologyParser';
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
});
