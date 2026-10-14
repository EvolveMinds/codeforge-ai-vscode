/**
 * test/suite/fde/pythonStudio.test.ts
 *
 * Standalone Mocha tests for Python AI Studio Plugin modules:
 *  - PythonDetector (Greenfield vs Brownfield, Frameworks, Venv discovery)
 *  - GitIntegrationHook (Leak prevention, Model weights > 50MB, .gitignore auto-repair)
 *  - CloudDeployHook (Hardened multi-stage Dockerfile, Cloud VPC scripts, Credential inspection)
 */

import * as assert from 'assert';
import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';
import { PythonDetector } from '../../../plugins/pythonStudio/pythonDetector';
import { GitIntegrationHook } from '../../../plugins/pythonStudio/gitIntegrationHook';
import { CloudDeployHook } from '../../../plugins/pythonStudio/cloudDeployHook';
import { DeterministicAnalyzer } from '../../../plugins/pythonStudio/deterministicAnalyzer';
import { TensorShapeEngine } from '../../../plugins/pythonStudio/tensorShapeEngine';
import { DataFrameSniffer } from '../../../plugins/pythonStudio/dataFrameSniffer';
import { AiAdvisor } from '../../../plugins/pythonStudio/aiAdvisor';
import { PythonEnvironmentManager } from '../../../plugins/pythonStudio/pythonEnvironmentManager';
import { PythonCodeTools } from '../../../plugins/pythonStudio/pythonCodeTools';
import { RunbookGenerator } from '../../../fde/runbookGenerator';
import type { FdeEngagementState } from '../../../fde/fdeContext';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-python-studio-fde-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

suite('FDE Suite — Python AI Studio & Delivery Integration', () => {

  suite('PythonDetector: Topology & Stacks', () => {
    let tmpDir: string;

    setup(() => {
      tmpDir = makeTmpDir();
    });

    teardown(() => {
      rmDir(tmpDir);
    });

    test('detects greenfield on empty project', async () => {
      const fakeWs: any = { uri: { fsPath: tmpDir } };
      const top = await PythonDetector.analyzeWorkspace(fakeWs);
      assert.strictEqual(top.topology, 'greenfield');
      assert.strictEqual(top.pythonFilesCount, 0);
    });

    test('detects brownfield when existing git and files present', async () => {
      fs.mkdirSync(path.join(tmpDir, '.git'));
      fs.writeFileSync(path.join(tmpDir, 'poetry.lock'), '# poetry lockfile');
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(tmpDir, `service_${i}.py`), '# code');
      }

      const fakeWs: any = { uri: { fsPath: tmpDir } };
      const top = await PythonDetector.analyzeWorkspace(fakeWs);
      assert.strictEqual(top.topology, 'brownfield');
      assert.strictEqual(top.packageManager, 'poetry');
      assert.strictEqual(top.hasGitRepo, true);
    });

    test('detects modern AI frameworks in requirements.txt', async () => {
      fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'torch>=2.2.0\npolars>=0.20.0\nfastapi>=0.110.0\nlangchain>=0.1.0\n');
      const fakeWs: any = { uri: { fsPath: tmpDir } };
      const top = await PythonDetector.analyzeWorkspace(fakeWs);

      assert.strictEqual(top.frameworks.hasPyTorch, true);
      assert.strictEqual(top.frameworks.hasPolars, true);
      assert.strictEqual(top.frameworks.hasFastAPI, true);
      assert.strictEqual(top.frameworks.hasLangChain, true);
      assert.strictEqual(top.frameworks.hasJax, false);
    });

    test('discovers active virtual environment binaries', async () => {
      const venvDir = path.join(tmpDir, '.venv');
      const binDir = process.platform === 'win32' ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const binName = process.platform === 'win32' ? 'python.exe' : 'python';
      fs.writeFileSync(path.join(binDir, binName), '# fake python');

      const fakeWs: any = { uri: { fsPath: tmpDir } };
      const top = await PythonDetector.analyzeWorkspace(fakeWs);
      assert.strictEqual(top.candidateVenvs.length, 1);
      assert.strictEqual(top.activeVenvPath, venvDir);
    });

    test('hasPythonFootprint returns true when root markers exist', async () => {
      fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.uv]\n');
      const fakeWs: any = { uri: { fsPath: tmpDir } };
      const exists = await PythonDetector.hasPythonFootprint(fakeWs);
      assert.strictEqual(exists, true);
    });
  });

  suite('GitIntegrationHook: Pre-Commit Hygiene & Leak Prevention', () => {
    let tmpDir: string;

    setup(() => {
      tmpDir = makeTmpDir();
    });

    teardown(() => {
      rmDir(tmpDir);
    });

    test('flags unignored .venv directory to prevent repo bloat', () => {
      fs.mkdirSync(path.join(tmpDir, '.venv'));
      const status = GitIntegrationHook.scanWorkspaceHygiene(tmpDir);
      assert.strictEqual(status.isGitIgnoredClean, false);
      const venvViolation = status.violations.find(v => v.kind === 'unignored_venv');
      assert.ok(venvViolation);
    });

    test('flags plaintext API keys in .env file', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'OPENAI_API_KEY=sk-1234567890abcdef1234567890abcdef\n');
      const status = GitIntegrationHook.scanWorkspaceHygiene(tmpDir);
      const secViolation = status.violations.find(v => v.kind === 'plaintext_secret');
      assert.ok(secViolation);
    });

    test('ensurePythonGitignore updates .gitignore cleanly and idempotently', () => {
      const updated = GitIntegrationHook.ensurePythonGitignore(tmpDir);
      assert.strictEqual(updated, true);

      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
      assert.ok(content.includes('.venv/'));
      assert.ok(content.includes('*.safetensors'));
      assert.ok(content.includes('checkpoints/'));

      // Re-running does not duplicate
      const secondRun = GitIntegrationHook.ensurePythonGitignore(tmpDir);
      assert.strictEqual(secondRun, false);
    });

    test('generates commit summary snippet for AI drafter', () => {
      const status = {
        changedPythonFiles: ['src/agent.py', 'src/model.py'],
        changedTestFiles: ['tests/test_agent.py'],
        changedConfigs: ['pyproject.toml'],
        violations: [],
        isGitIgnoredClean: true,
      };
      const summary = GitIntegrationHook.getCommitSummarySnippet(status);
      assert.ok(summary.includes('Python modules: src/agent.py, src/model.py'));
      assert.ok(summary.includes('Tests: tests/test_agent.py'));
    });
  });

  suite('CloudDeployHook: Cloud Containers & VPC Scripts', () => {
    test('generateHardenedDockerfile outputs secure multi-stage container with uv cache', () => {
      const dockerfile = CloudDeployHook.generateHardenedDockerfile('rag-service', 'server.api:app');
      assert.ok(dockerfile.includes('FROM python:3.12-slim AS builder'));
      assert.ok(dockerfile.includes('FROM python:3.12-slim AS runtime'));
      assert.ok(dockerfile.includes('USER appuser'));
      assert.ok(dockerfile.includes('HEALTHCHECK'));
      assert.ok(dockerfile.includes('server.api:app'));
      assert.ok(dockerfile.includes('ghcr.io/astral-sh/uv'));
    });

    test('generateDeployRunbookSnippet produces valid cloud provider deployment instructions', () => {
      const gcpSnippet = CloudDeployHook.generateDeployRunbookSnippet('gcp-firebase', 'ai-worker');
      assert.ok(gcpSnippet.includes('gcloud run deploy ai-worker'));

      const awsSnippet = CloudDeployHook.generateDeployRunbookSnippet('aws', 'ai-worker');
      assert.ok(awsSnippet.includes('aws apprunner create-service'));

      const azureSnippet = CloudDeployHook.generateDeployRunbookSnippet('azure', 'ai-worker');
      assert.ok(azureSnippet.includes('az containerapp up'));
    });

    test('inspectActiveCloudCredentials returns expected object structure', () => {
      const creds = CloudDeployHook.inspectActiveCloudCredentials();
      assert.ok(typeof creds.gcpActive === 'boolean');
      assert.ok(typeof creds.awsActive === 'boolean');
      assert.ok(typeof creds.azureActive === 'boolean');
      assert.ok(typeof creds.databricksActive === 'boolean');
    });
  });

  suite('DeterministicAnalyzer: 100% Offline AST & Syntax Verification', () => {
    test('passes on valid Python 3.12 code with balanced brackets', () => {
      const code = `
def calculate_metrics(values: list[float]) -> dict[str, float]:
    total = sum(values)
    avg = total / len(values) if values else 0.0
    return {"total": total, "average": avg}
`;
      const res = DeterministicAnalyzer.analyzeCode(code);
      assert.strictEqual(res.syntaxValid, true);
      assert.strictEqual(res.errorCount, 0);
    });

    test('detects unmatched closing bracket', () => {
      const code = `x = (1 + 2)]`;
      const res = DeterministicAnalyzer.analyzeCode(code);
      assert.strictEqual(res.syntaxValid, false);
      const err = res.diagnostics.find(d => d.code === 'UNMATCHED_CLOSING_BRACKET');
      assert.ok(err);
    });

    test('detects mismatched brackets', () => {
      const code = `data = [1, 2, 3}`;
      const res = DeterministicAnalyzer.analyzeCode(code);
      assert.strictEqual(res.syntaxValid, false);
      const err = res.diagnostics.find(d => d.code === 'MISMATCHED_BRACKET');
      assert.ok(err);
    });

    test('detects mutable default arguments in functions', () => {
      const code = `def append_to_list(val, target=[]): target.append(val); return target`;
      const res = DeterministicAnalyzer.analyzeCode(code);
      const warn = res.diagnostics.find(d => d.code === 'MUTABLE_DEFAULT_ARG');
      assert.ok(warn);
    });

    test('detects wildcard imports and dangerous eval', () => {
      const code = `from math import *\nx = eval("2 + 2")`;
      const res = DeterministicAnalyzer.analyzeCode(code);
      assert.ok(res.diagnostics.some(d => d.code === 'WILDCARD_IMPORT'));
      assert.ok(res.diagnostics.some(d => d.code === 'DANGEROUS_EVAL'));
    });

    test('detects Python 2 legacy print syntax', () => {
      const code = `print "Hello World"`;
      const res = DeterministicAnalyzer.analyzeCode(code);
      assert.ok(res.diagnostics.some(d => d.code === 'PYTHON2_PRINT_SYNTAX'));
    });
  });

  suite('TensorShapeEngine: Layer Topology & Numerical Instability', () => {
    test('extracts linear and embedding layers and computes shape flow', () => {
      const code = `
import torch.nn as nn

class TransformerClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.Embedding(30522, 768)
        self.fc1 = nn.Linear(768, 512)
        self.fc2 = nn.Linear(512, 10)
`;
      const report = TensorShapeEngine.analyzeTensorCode(code);
      assert.strictEqual(report.layers.length, 3);
      assert.strictEqual(report.anomalies.length, 0);
      assert.ok(report.shapeFlowSummary[1].includes('[*, 768] ➔ [*, 512]'));
    });

    test('detects sequential layer dimension mismatch', () => {
      const code = `
class BrokenModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.layer1 = nn.Linear(768, 512)
        self.layer2 = nn.Linear(256, 10) # Expected 512
`;
      const report = TensorShapeEngine.analyzeTensorCode(code);
      const mismatch = report.anomalies.find(a => a.code === 'TENSOR_SHAPE_MISMATCH');
      assert.ok(mismatch);
      assert.ok(mismatch.message.includes('512 dims'));
    });

    test('detects division by variance without epsilon (NaN risk)', () => {
      const code = `normalized = x / variance`;
      const report = TensorShapeEngine.analyzeTensorCode(code);
      assert.ok(report.anomalies.some(a => a.code === 'NAN_DIV_ZERO_RISK'));
    });

    test('detects unclamped torch.log (inf risk)', () => {
      const code = `prob = torch.log(scores)`;
      const report = TensorShapeEngine.analyzeTensorCode(code);
      assert.ok(report.anomalies.some(a => a.code === 'LOG_ZERO_INF_RISK'));
    });

    test('detects double softmax bug with CrossEntropyLoss', () => {
      const code = `
criterion = nn.CrossEntropyLoss()
loss = criterion(F.softmax(logits, dim=-1), labels)
`;
      const report = TensorShapeEngine.analyzeTensorCode(code);
      assert.ok(report.anomalies.some(a => a.code === 'DOUBLE_SOFTMAX_CROSS_ENTROPY'));
    });
  });

  suite('DataFrameSniffer: Pandas & Polars Pipeline Optimization', () => {
    test('detects slow iterrows loop bottleneck', () => {
      const code = `
import pandas as pd
df = pd.DataFrame({'a': [1, 2]})
for idx, row in df.iterrows():
    print(row['a'])
`;
      const report = DataFrameSniffer.sniffDataCode(code);
      assert.strictEqual(report.pandasDetected, true);
      assert.ok(report.anomalies.some(a => a.code === 'SLOW_ITERROWS_LOOP'));
    });

    test('detects SettingWithCopy chained indexing hazard', () => {
      const code = `df['users']['score'] = 100`;
      const report = DataFrameSniffer.sniffDataCode(code);
      assert.ok(report.anomalies.some(a => a.code === 'SETTING_WITH_COPY_WARNING'));
    });

    test('detects Cartesian merge risk without on= parameter', () => {
      const code = `merged = pd.merge(orders, customers)`;
      const report = DataFrameSniffer.sniffDataCode(code);
      assert.ok(report.anomalies.some(a => a.code === 'CARTESIAN_MERGE_RISK'));
    });

    test('recommends Polars migration for heavy dataframes', () => {
      const code = `import pandas as pd\ndf = pd.read_csv('test.csv')`;
      const report = DataFrameSniffer.sniffDataCode(code);
      assert.ok(report.optimizationTips.some(t => t.includes('Polars')));
    });
  });

  suite('AiAdvisor: Dual-Track Remediation & PyTest Contracts', () => {
    test('generateDiff computes unified diff and hunks cleanly', () => {
      const orig = 'x = 1\ny = 2\n';
      const mod = 'x = 1\ny = 3\nz = 4\n';
      const diff = AiAdvisor.generateDiff(orig, mod, 'calc.py');
      assert.ok(diff.diffUnified.includes('--- a/calc.py'));
      assert.ok(diff.diffUnified.includes('+++ b/calc.py'));
      assert.ok(diff.diffHunks.some(h => h.type === 'del' && h.text === 'y = 2'));
      assert.ok(diff.diffHunks.some(h => h.type === 'add' && h.text === 'y = 3'));
    });

    test('generatePytestContract produces valid PyTest contract with tensor assertions', () => {
      const code = `
import torch
import torch.nn as nn

class TransformerClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(64, 10)
    def forward(self, x):
        return self.fc(x)

def predict_batch(x):
    return x
`;
      const contract = AiAdvisor.generatePytestContract(code, { fileName: 'model.py' });
      assert.ok(contract.includes('import pytest'));
      assert.ok(contract.includes('import torch'));
      assert.ok(contract.includes('class TestTransformerClassifierContract:'));
      assert.ok(contract.includes('assert not torch.isnan(out).any()'));
      assert.ok(contract.includes('assert not torch.isinf(out).any()'));
      assert.ok(contract.includes('def test_predict_batch_contract():'));
    });

    test('createOfflineHeuristicProposal repairs missing epsilon in variance division', () => {
      const code = `norm_x = x / torch.sqrt(variance)`;
      const proposal = AiAdvisor.createOfflineHeuristicProposal({ sourceCode: code });
      assert.ok(proposal.proposedCode.includes('torch.sqrt(variance + 1e-5)'));
      assert.ok(proposal.explanation.rootCause.includes('epsilon'));
      assert.ok(proposal.explanation.architecturalImpact.includes('NaN'));
      assert.ok(proposal.explanation.remediation.includes('1e-5'));
      assert.strictEqual(proposal.heuristicsOnly, true);
    });

    test('createOfflineHeuristicProposal repairs unclamped torch.log', () => {
      const code = `log_prob = torch.log(prob)`;
      const proposal = AiAdvisor.createOfflineHeuristicProposal({ sourceCode: code });
      assert.ok(proposal.proposedCode.includes('torch.clamp(prob, min=1e-7)'));
      assert.ok(proposal.explanation.rootCause.includes('torch.log'));
      assert.ok(proposal.explanation.architecturalImpact.includes('-inf'));
    });

    test('createOfflineHeuristicProposal removes double softmax before CrossEntropyLoss', () => {
      const code = `
criterion = nn.CrossEntropyLoss()
def forward(x):
    return F.softmax(self.linear(x), dim=-1)
`;
      const proposal = AiAdvisor.createOfflineHeuristicProposal({ sourceCode: code });
      assert.ok(!proposal.proposedCode.includes('F.softmax'));
      assert.ok(proposal.proposedCode.includes('return self.linear(x)'));
      assert.ok(proposal.explanation.rootCause.includes('Softmax'));
    });

    test('createOfflineHeuristicProposal aligns sequential layer dimension mismatch', () => {
      const code = `
self.fc1 = nn.Linear(64, 128)
self.fc2 = nn.Linear(256, 10)
`;
      const proposal = AiAdvisor.createOfflineHeuristicProposal({ sourceCode: code });
      assert.ok(proposal.proposedCode.includes('self.fc2 = nn.Linear(128, 10)'));
      assert.ok(proposal.explanation.rootCause.includes('mismatch'));
    });

    test('proposePatch in manual mode executes 100% offline without calling AI', async () => {
      let aiCalled = false;
      const mockServices = {
        ai: {
          ask: async () => {
            aiCalled = true;
            return '{"proposedCode": "foo"}';
          },
        },
      };

      const proposal = await AiAdvisor.proposePatch(
        { sourceCode: `print "hello world"` },
        mockServices,
        'manual'
      );

      assert.strictEqual(aiCalled, false, 'AI must never be invoked in manual mode');
      assert.ok(proposal.proposedCode.includes('print("hello world")'));
      assert.strictEqual(proposal.mode, 'manual');
    });

    test('proposePatch gracefully falls back to deterministic heuristic if AI fails', async () => {
      const failingServices = {
        ai: {
          ask: async () => {
            throw new Error('Network offline or rate limit exceeded');
          },
        },
      };

      const proposal = await AiAdvisor.proposePatch(
        { sourceCode: `norm = x / torch.sqrt(var)` },
        failingServices,
        'on-demand'
      );

      assert.ok(proposal.proposedCode.includes('+ 1e-5'));
      assert.ok(proposal.explanation.rootCause.includes('epsilon'));
      assert.strictEqual(proposal.heuristicsOnly, true);
    });
  });

  suite('RunbookGenerator: Python Execution & Container Chapters', () => {
    test('generateDeploymentRunbook embeds Python sandbox, uv venv, and container deploy steps', () => {
      const state: FdeEngagementState = {
        id: 'proj-python-fde',
        clientName: 'Apex Financial',
        engagementGoal: 'Deliver quantitative AI pipeline',
        targetVpc: 'aws',
        activePhase: 4,
        completedPhases: [1, 2, 3],
        schemaMappings: [],
        apiConnectors: [],
        discoveredEnvVars: ['AWS_REGION'],
      };

      const runbook = RunbookGenerator.generateDeploymentRunbook(state);
      assert.ok(runbook.includes('## 5. Python AI Services, Sandboxes & Container Workloads'));
      assert.ok(runbook.includes('uv venv .venv'));
      assert.ok(runbook.includes('pytest tests/ -v'));
      assert.ok(runbook.includes('docker build -t apex-financial-service:latest'));
      assert.ok(runbook.includes('./scripts/deploy.sh aws python-service'));
    });
  });

  suite('PythonEnvironmentManager: Turnkey Setup & Airtight Suite', function () {
    this.timeout(10000);
    let tmpDir: string;

    setup(() => {
      tmpDir = makeTmpDir();
    });

    teardown(() => {
      rmDir(tmpDir);
    });

    test('detectSystemPython discovers installed Python binary or reports stub', () => {
      const status = PythonEnvironmentManager.detectSystemPython(tmpDir);
      assert.strictEqual(typeof status.isInstalled, 'boolean');
      assert.strictEqual(typeof status.isWindowsStoreStub, 'boolean');
      assert.strictEqual(typeof status.hasInternet, 'boolean');
      assert.strictEqual(typeof status.packageManagerAvailable.uv, 'boolean');
      assert.strictEqual(typeof status.packageManagerAvailable.pip, 'boolean');
    });

    test('getAutoInstallCommand returns platform-tailored installation instruction', () => {
      const plan = PythonEnvironmentManager.getAutoInstallCommand('3.12');
      assert.ok(plan.tool.length > 0);
      assert.ok(plan.command.includes('3.12'));
      assert.ok(plan.explanation.length > 0);
    });

    test('extractImportsFromCode extracts external AI libraries and ignores stdlib', () => {
      const code = `
import os
import sys
import math
import torch
import torch.nn as nn
from transformers import AutoModelForCausalLM
import polars as pl
import fastapi
from pydantic import BaseModel
`;
      const imports = PythonEnvironmentManager.extractImportsFromCode(code);
      assert.ok(imports.includes('torch'));
      assert.ok(imports.includes('transformers'));
      assert.ok(imports.includes('polars'));
      assert.ok(imports.includes('fastapi'));
      assert.ok(imports.includes('pydantic'));
      assert.strictEqual(imports.includes('os'), false);
      assert.strictEqual(imports.includes('sys'), false);
      assert.strictEqual(imports.includes('math'), false);
    });

    test('inspectDependencies parses requirements.txt and code files', () => {
      fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'torch>=2.2.0\npolars>=1.0.0\nfastapi\n');
      fs.writeFileSync(path.join(tmpDir, 'main.py'), 'import fastapi\nimport polars as pl\n');

      const report = PythonEnvironmentManager.inspectDependencies(tmpDir);
      assert.ok(report.packages.length >= 3);
      const torchPkg = report.packages.find(p => p.name === 'torch');
      assert.ok(torchPkg);
      assert.ok(torchPkg.requiredBy.includes('requirements.txt'));
      assert.strictEqual(typeof report.allReady, 'boolean');
    });

    test('generateAirtightBundle produces manifests, fetch scripts, and offline guide', () => {
      const bundle = PythonEnvironmentManager.generateAirtightBundle(tmpDir, ['torch', 'polars', 'fastapi']);
      assert.ok(fs.existsSync(bundle.bundleDir));
      assert.ok(fs.existsSync(bundle.manifestPath));
      assert.ok(fs.existsSync(bundle.fetchScriptPs1));
      assert.ok(fs.existsSync(bundle.fetchScriptSh));

      const reqContent = fs.readFileSync(bundle.manifestPath, 'utf8');
      assert.ok(reqContent.includes('torch'));
      assert.ok(reqContent.includes('polars'));
      assert.ok(reqContent.includes('fastapi'));

      const ps1Content = fs.readFileSync(bundle.fetchScriptPs1, 'utf8');
      assert.ok(ps1Content.includes('pip download'));

      const guideContent = fs.readFileSync(path.join(bundle.bundleDir, 'AIR_GAPPED_README.md'), 'utf8');
      assert.ok(guideContent.includes('Airtight / Air-Gapped Python Deployment Guide'));
    });

    test('runSetupSelfTest executes validation smoke test and reports metrics', () => {
      const result = PythonEnvironmentManager.runSetupSelfTest(tmpDir);
      assert.strictEqual(typeof result.passed, 'boolean');
      assert.strictEqual(typeof result.durationMs, 'number');
      assert.ok(result.outputLog.length > 0);
      assert.ok(Array.isArray(result.testedImports));
    });
  });

  suite('Dynamic Plugin Management & UI Visibility', () => {
    let mockStore: { disabledPlugins: string[] };
    let PluginRegistryClass: any;
    let EventBusClass: any;
    let registry: any;
    let bus: any;

    setup(() => {
      mockStore = { disabledPlugins: [] };

      // Ensure vscode is stubbed in Module._resolveFilename and require.cache for headless Mocha
      const Module = require('module');
      const origResolve = Module._resolveFilename;
      Module._resolveFilename = function (request: string, parent: any, isMain: boolean) {
        if (request === 'vscode') {
          return 'vscode';
        }
        return origResolve.apply(this, arguments);
      };

      require.cache['vscode'] = {
        id: 'vscode',
        filename: 'vscode',
        loaded: true,
        exports: {
          EventEmitter: class {
            private listeners: any[] = [];
            event = (l: any) => { this.listeners.push(l); return { dispose: () => {} }; };
            fire = (d: any) => { this.listeners.forEach(l => l(d)); };
          },
          ConfigurationTarget: { Global: 1, Workspace: 2 },
          workspace: {
            getConfiguration: () => ({
              get: (k: string, d: any) => mockStore[k as keyof typeof mockStore] !== undefined ? mockStore[k as keyof typeof mockStore] : d,
              update: async (k: string, v: any) => { (mockStore as any)[k] = v; },
            }),
            workspaceFolders: [{ uri: { fsPath: os.tmpdir() } }],
          },
          commands: {
            registerCommand: () => ({ dispose: () => {} }),
          },
          window: {
            showErrorMessage: () => {},
            showInformationMessage: () => {},
          },
        },
      } as any;

      const pluginModule = require('../../../core/plugin');
      const eventBusModule = require('../../../core/eventBus');
      PluginRegistryClass = pluginModule.PluginRegistry;
      EventBusClass = eventBusModule.EventBus;

      bus = new EventBusClass();
      registry = new PluginRegistryClass(bus);

      registry.register({
        id: 'pythonStudio',
        displayName: 'Python AI Studio',
        icon: '$(zap)',
        description: 'Interactive Python Studio & Neural Debugger Workspace',
        detect: async () => true,
        activate: async () => [],
      });
      registry.register({
        id: 'dataAnalysis',
        displayName: 'Data Analysis & Insights',
        icon: '$(graph)',
        description: 'AutoEDA & statistical profiling studio',
        detect: async () => true,
        activate: async () => [],
      });
      registry.register({
        id: 'git',
        displayName: 'Git & Deployment Delivery',
        icon: '$(git-branch)',
        description: 'Git integration & pre-commit leak audit',
        detect: async () => true,
        activate: async () => [],
      });
      registry.register({
        id: 'security',
        displayName: 'Security Preflight Auditor',
        icon: '$(shield)',
        description: 'Preflight vulnerability & credential audit',
        detect: async () => true,
        activate: async () => [],
      });
    });

    test('getAll returns all registered plugins with metadata', () => {
      const all = registry.getAll();
      assert.strictEqual(all.length, 4);
      const py = all.find((p: any) => p.id === 'pythonStudio');
      assert.ok(py);
      assert.strictEqual(py.displayName, 'Python AI Studio');
      assert.strictEqual(py.icon, '$(zap)');
      assert.ok(py.description.includes('Neural Debugger'));
    });

    test('isPluginEnabled reflects global disabledPlugins configuration', () => {
      assert.strictEqual(registry.isPluginEnabled('pythonStudio'), true);
      assert.strictEqual(registry.isPluginEnabled('dataAnalysis'), true);

      mockStore.disabledPlugins = ['pythonStudio'];
      assert.strictEqual(registry.isPluginEnabled('pythonStudio'), false);
      assert.strictEqual(registry.isPluginEnabled('dataAnalysis'), true);
    });

    test('togglePlugin toggles state and dispatches plugin.toggled and ui.status.update events', async () => {
      let toggledPayload: any = null;
      let statusUpdateFired = false;

      bus.on('plugin.toggled', (p: any) => { toggledPayload = p; });
      bus.on('ui.status.update', () => { statusUpdateFired = true; });

      // First toggle: disable
      const nowEnabled = await registry.togglePlugin('pythonStudio');
      assert.strictEqual(nowEnabled, false);
      assert.strictEqual(registry.isPluginEnabled('pythonStudio'), false);
      assert.deepStrictEqual(mockStore.disabledPlugins, ['pythonStudio']);
      assert.deepStrictEqual(toggledPayload, { pluginId: 'pythonStudio', enabled: false });
      assert.strictEqual(statusUpdateFired, true);

      // Second toggle: enable
      statusUpdateFired = false;
      const reEnabled = await registry.togglePlugin('pythonStudio');
      assert.strictEqual(reEnabled, true);
      assert.strictEqual(registry.isPluginEnabled('pythonStudio'), true);
      assert.deepStrictEqual(mockStore.disabledPlugins, []);
      assert.deepStrictEqual(toggledPayload, { pluginId: 'pythonStudio', enabled: true });
      assert.strictEqual(statusUpdateFired, true);
    });

    test('setPluginEnabled explicitly enables or disables plugins', async () => {
      await registry.setPluginEnabled('dataAnalysis', false);
      assert.strictEqual(registry.isPluginEnabled('dataAnalysis'), false);
      assert.ok(mockStore.disabledPlugins.includes('dataAnalysis'));

      await registry.setPluginEnabled('dataAnalysis', true);
      assert.strictEqual(registry.isPluginEnabled('dataAnalysis'), true);
      assert.strictEqual(mockStore.disabledPlugins.includes('dataAnalysis'), false);
    });

    test('disableAllPlugins switches to Minimal Core Mode keeping essential plugins', async () => {
      await registry.disableAllPlugins(['git', 'security']);
      assert.strictEqual(registry.isPluginEnabled('pythonStudio'), false);
      assert.strictEqual(registry.isPluginEnabled('dataAnalysis'), false);
      assert.strictEqual(registry.isPluginEnabled('git'), true);
      assert.strictEqual(registry.isPluginEnabled('security'), true);
    });

    test('enableAllPlugins reactivates all plugins and empties disabledPlugins list', async () => {
      mockStore.disabledPlugins = ['pythonStudio', 'dataAnalysis'];
      await registry.enableAllPlugins();
      assert.strictEqual(registry.isPluginEnabled('pythonStudio'), true);
      assert.strictEqual(registry.isPluginEnabled('dataAnalysis'), true);
      assert.deepStrictEqual(mockStore.disabledPlugins, []);
    });

    test('UI dynamic visibility logic: evaluates show up or go off correctly for any plugin', () => {
      const allPlugins = registry.getAll().map((p: any) => ({
        id: p.id,
        name: p.displayName,
        enabled: registry.isPluginEnabled(p.id),
      }));

      const isStudioVisible = (pid: string) => {
        const found = allPlugins.find((p: any) => p.id === pid);
        return found ? found.enabled : true;
      };

      // By default all visible ("Show Up")
      assert.strictEqual(isStudioVisible('pythonStudio'), true);
      assert.strictEqual(isStudioVisible('dataAnalysis'), true);

      // Disable pythonStudio -> disappears ("Go Off")
      mockStore.disabledPlugins = ['pythonStudio'];
      const updatedPlugins = registry.getAll().map((p: any) => ({
        id: p.id,
        name: p.displayName,
        enabled: registry.isPluginEnabled(p.id),
      }));
      const isUpdatedVisible = (pid: string) => {
        const found = updatedPlugins.find((p: any) => p.id === pid);
        return found ? found.enabled : true;
      };

      assert.strictEqual(isUpdatedVisible('pythonStudio'), false); // Goes off
      assert.strictEqual(isUpdatedVisible('dataAnalysis'), true);   // Remains visible
    });
  });

  suite('PythonCodeTools: Black/Ruff Formatter, isort Organizer & Traceback Auto-Fixer', () => {
    test('formatCode normalizes 4-space indentation, quote normalization, and operator spacing', () => {
      const unformatted = `def compute_loss(x,y):\n  variance=torch.var(x)\n  normalized=x/variance\n  return normalized\n`;
      const res = PythonCodeTools.formatCode(unformatted);
      assert.ok(res.formatted.includes('def compute_loss(x, y):'));
      assert.ok(res.formatted.includes('    variance = torch.var(x)'));
      assert.ok(res.formatted.includes('    return normalized'));
    });

    test('formatCode preserves multiline triple-quoted docstrings without corruption', () => {
      const codeWithDoc = `def foo():\n    """Multiline\n    docstring\n    content"""\n    return 42\n`;
      const res = PythonCodeTools.formatCode(codeWithDoc);
      assert.ok(res.formatted.includes('"""Multiline'));
      assert.ok(res.formatted.includes('    return 42'));
    });

    test('organizeImports correctly groups stdlib, third-party, and local modules in isort blocks', () => {
      const code = `import torch\nimport os\nfrom services import model\nimport sys\nimport polars as pl\nfrom typing import List, Dict\n\nx = 1\n`;
      const res = PythonCodeTools.organizeImports(code);
      assert.strictEqual(res.importCount, 6);
      assert.strictEqual(res.stdlibCount, 3); // os, sys, typing
      assert.strictEqual(res.thirdPartyCount, 2); // torch, polars
      assert.strictEqual(res.localCount, 1); // services

      const lines = res.organized.split('\n');
      // Verify stdlib comes first
      const osIdx = lines.findIndex(l => l.includes('import os'));
      const torchIdx = lines.findIndex(l => l.includes('import torch'));
      const servicesIdx = lines.findIndex(l => l.includes('from services import model'));

      assert.ok(osIdx !== -1 && torchIdx !== -1 && servicesIdx !== -1);
      assert.ok(osIdx < torchIdx, 'Standard library must precede third-party packages');
      assert.ok(torchIdx < servicesIdx, 'Third-party packages must precede local modules');
    });

    test('parseTraceback accurately extracts errorType, message, line, and file from Python stack trace', () => {
      const tbOutput = `Traceback (most recent call last):
  File "services/classifier.py", line 14, in forward
    out = self.fc2(torch.relu(self.fc1(x)))
RuntimeError: Expected 768 features, got 512
`;
      const diag = PythonCodeTools.parseTraceback(tbOutput);
      assert.strictEqual(diag.hasError, true);
      assert.strictEqual(diag.errorType, 'RuntimeError');
      assert.strictEqual(diag.errorMessage, 'Expected 768 features, got 512');
      assert.strictEqual(diag.file, 'services/classifier.py');
      assert.strictEqual(diag.line, 14);
    });

    test('synthesizeTracebackFix repairs ZeroDivisionError with epsilon stabilization', () => {
      const faultyCode = `def loss(pred):\n    variance = torch.var(pred)\n    return pred / variance\n`;
      const tb = `ZeroDivisionError: division by zero`;
      const fixed = PythonCodeTools.synthesizeTracebackFix(faultyCode, tb);
      assert.ok(fixed.includes('/ (variance + 1e-6)'), 'Must inject + 1e-6 numerical stability');
    });

    test('synthesizeTracebackFix repairs unclamped torch.log hazard', () => {
      const faultyCode = `def log_loss(x):\n    return torch.log(x)\n`;
      const tb = `RuntimeError: log(0) produces NaN or Inf`;
      const fixed = PythonCodeTools.synthesizeTracebackFix(faultyCode, tb);
      assert.ok(fixed.includes('torch.clamp(x, min=1e-7)'), 'Must clamp log input to min=1e-7');
    });

    test('synthesizeTracebackFix repairs shape mismatches and iterrows bottlenecks', () => {
      const code1 = `self.fc = nn.Linear(768, 256)`;
      const tb1 = `RuntimeError: Expected 768 features, got 512`;
      const fixed1 = PythonCodeTools.synthesizeTracebackFix(code1, tb1);
      assert.ok(fixed1.includes('nn.Linear(512, 256)'), 'Must align tensor dimensions to match incoming 512');

      const code2 = `for i, row in df.iterrows():\n    score = row['amount'] * 1.5`;
      const tb2 = `KeyError: 'amount'`;
      const fixed2 = PythonCodeTools.synthesizeTracebackFix(code2, tb2);
      assert.ok(fixed2.includes("row.get('amount', 0.0)"), 'Must use safe dictionary lookup');
    });

    test('CloudDeployHook generates targeted runbooks for all 4 major cloud targets', () => {
      const gcpSnippet = CloudDeployHook.generateDeployRunbookSnippet('gcp-firebase', 'ai-service');
      assert.ok(gcpSnippet.includes('gcloud run deploy ai-service'));
      assert.ok(gcpSnippet.includes('--memory 2Gi'));

      const awsSnippet = CloudDeployHook.generateDeployRunbookSnippet('aws', 'ai-service');
      assert.ok(awsSnippet.includes('aws apprunner create-service'));
      assert.ok(awsSnippet.includes('ai-service'));

      const azureSnippet = CloudDeployHook.generateDeployRunbookSnippet('azure', 'ai-service');
      assert.ok(azureSnippet.includes('az containerapp up'));
      assert.ok(azureSnippet.includes('--target-port 8080'));

      const localSnippet = CloudDeployHook.generateDeployRunbookSnippet('docker', 'ai-service');
      assert.ok(localSnippet.includes('docker build -t ai-service:pilot'));
    });
  });
});




