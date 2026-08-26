import * as assert from 'assert';
import { RunbookGenerator } from '../../../fde/runbookGenerator';
import { FdeEngagementState } from '../../../fde/fdeContext';

suite('FDE Suite — RunbookGenerator', () => {
  const dummyState: FdeEngagementState = {
    id: 'proj-test',
    clientName: 'Acme Health',
    engagementGoal: 'Deploy clinical pipeline',
    targetVpc: 'gcp-firebase',
    activePhase: 4,
    completedPhases: [1, 2, 3],
    schemaMappings: [
      {
        sourceName: 'raw_patient_data',
        targetModelName: 'stg_patients',
        dialect: 'dbt',
        columns: [
          { sourceColumn: 'PT_ID', targetColumn: 'patient_id', sourceType: 'string', targetType: 'string', confidence: 0.95 },
        ],
        unmappedSource: [],
        unmappedTarget: [],
        createdAt: Date.now(),
      },
    ],
    apiConnectors: [
      {
        connectorName: 'EhrClient',
        targetLanguage: 'typescript',
        baseUrl: 'https://ehr.internal',
        authType: 'bearer',
        endpoints: [{ name: 'getPatients', method: 'GET', path: '/patients' }],
        createdAt: Date.now(),
      },
    ],
    discoveredEnvVars: ['API_KEY', 'DATABASE_URL'],
  };

  test('generates architecture document with valid Mermaid sequence/system diagram', () => {
    const doc = RunbookGenerator.generateArchitectureDoc(dummyState);

    assert.ok(doc.includes('# Acme Health — System Architecture & Integration Blueprint'));
    assert.ok(doc.includes('```mermaid'));
    assert.ok(doc.includes('graph TD'));
    assert.ok(doc.includes('stg_patients'));
    assert.ok(doc.includes('EhrClient'));
  });

  test('generates deployment runbook with rollback & troubleshooting procedures', () => {
    const doc = RunbookGenerator.generateDeploymentRunbook(dummyState);

    assert.ok(doc.includes('# Acme Health — Operations & Deployment Runbook'));
    assert.ok(doc.includes('./scripts/deploy.sh'));
    assert.ok(doc.includes('firebase-tools hosting:rollback'));
  });

  test('generates comprehensive data dictionary', () => {
    const doc = RunbookGenerator.generateDataDictionary(dummyState);

    assert.ok(doc.includes('## Target Model: `stg_patients`'));
    assert.ok(doc.includes('| `patient_id` | `PT_ID` | `string` |'));
  });

  test('generates environment catalog with secret flags', () => {
    const doc = RunbookGenerator.generateEnvironmentCatalog(dummyState);

    assert.ok(doc.includes('# Acme Health — Environment Variables & Secrets Reference'));
    assert.ok(doc.includes('| `API_KEY` | **Yes** | 🔒 Secret |'));
    assert.ok(doc.includes('| `DATABASE_URL` | **Yes** | Public |'));
  });

  test('generates complete consolidated handoff package', () => {
    const doc = RunbookGenerator.generateCompleteHandoffPackage(dummyState);

    assert.ok(doc.includes('# 📦 Acme Health — Complete Engagement Handoff Bundle'));
    assert.ok(doc.includes('System Architecture & Integration Blueprint'));
    assert.ok(doc.includes('Operations & Deployment Runbook'));
    assert.ok(doc.includes('Data Dictionary & Field Mapping Reference'));
    assert.ok(doc.includes('Environment Variables & Secrets Reference'));
  });
});
