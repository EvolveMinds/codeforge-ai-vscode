/**
 * commands/fdeCommands.ts — Forward Deployed Engineer (FDE) & Delivery Suite Commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { IServices } from '../core/services';
import { FdeCockpitPanel } from '../ui/fdeCockpitPanel';
import { PreflightAuditor } from '../deployment/preflightAuditor';
import { FirebaseConfigGenerator } from '../deployment/firebaseConfigGen';
import { DeployScriptScaffolder } from '../deployment/deployScriptScaffolder';
import { RunbookGenerator } from '../fde/runbookGenerator';
import { FdeContextManager } from '../fde/fdeContext';

export class FdeCommands {
  constructor(private readonly _svc: IServices) {}

  register(): void {
    const r = (id: string, fn: (...a: unknown[]) => unknown) =>
      this._svc.vsCtx.subscriptions.push(
        vscode.commands.registerCommand(id, async (...args: unknown[]) => {
          try {
            await fn(...args);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[Evolve AI] Command ${id} failed:`, e);
            vscode.window.showErrorMessage(`Evolve AI: ${msg}`);
          }
        })
      );

    r('aiForge.fde.openCockpit', () => this.openCockpit());
    r('aiForge.fde.preflightAudit', () => this.runPreflightAudit());
    r('aiForge.fde.scaffoldDeploy', () => this.scaffoldDeployment());
    r('aiForge.fde.generateRunbook', () => this.generateRunbooks());
  }

  openCockpit(): void {
    FdeCockpitPanel.createOrShow(this._svc.vsCtx, this._svc);
  }

  async runPreflightAudit(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showWarningMessage('Open a workspace folder first to run Pre-Flight Audit.');
      return;
    }

    const report = PreflightAuditor.scanWorkspace(ws);
    if (report.pass) {
      vscode.window.showInformationMessage(`✓ Pre-Flight Health Audit Passed (Score: ${report.score}/100) — Workspace clean & ready for deployment.`);
    } else {
      const errorCount = report.findings.filter(f => f.severity === 'error').length;
      const cleanable = report.temporaryFiles.length;
      
      const choice = await vscode.window.showWarningMessage(
        `Pre-Flight Audit: ${errorCount} errors, ${report.findings.length} total findings (Score: ${report.score}/100).`,
        cleanable > 0 ? `Clean ${cleanable} Temp Files` : 'View Details'
      );

      if (choice === `Clean ${cleanable} Temp Files`) {
        const res = PreflightAuditor.cleanTemporaryFiles(report.temporaryFiles);
        vscode.window.showInformationMessage(`Cleaned ${res.cleaned} temporary/backup files.`);
      } else if (choice === 'View Details') {
        this.openCockpit();
      }
    }
  }

  async scaffoldDeployment(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showWarningMessage('Open a workspace folder first to scaffold deployment.');
      return;
    }

    interface CloudChoiceItem extends vscode.QuickPickItem {
      id: 'studio' | 'aws' | 'gcp' | 'azure' | 'firebase' | 'k8s_docker';
    }

    const items: CloudChoiceItem[] = [
      {
        id: 'studio',
        label: '🚀 Open Interactive Multi-Cloud Studio (Recommended)',
        description: 'Visual Cockpit with live VPC discovery & IaC generator',
        detail: 'Configure AWS, GCP, Azure, Kubernetes, and Docker parameters side-by-side with live syntax previews.'
      },
      {
        id: 'aws',
        label: '☁️ Amazon Web Services (AWS)',
        description: 'ECS Fargate, Lambda, S3, IAM & Terraform IaC',
        detail: 'Scaffold AWS Terraform infrastructure and cross-platform deployment scripts.'
      },
      {
        id: 'gcp',
        label: '☁️ Google Cloud Platform (GCP)',
        description: 'Cloud Run, Artifact Registry, BigQuery & Terraform IaC',
        detail: 'Scaffold Google Cloud Run backend, Secret Manager, and Terraform configuration.'
      },
      {
        id: 'azure',
        label: '☁️ Microsoft Azure',
        description: 'Azure Container Apps, ACR, Key Vault & Terraform IaC',
        detail: 'Scaffold Azure Container Apps backend and deployment runners.'
      },
      {
        id: 'firebase',
        label: '🔥 Firebase (Classic / App Hosting)',
        description: 'firebase.json, .firebaserc & Hosting deployment scripts',
        detail: 'Scaffold multi-target Firebase configuration with security caching headers.'
      },
      {
        id: 'k8s_docker',
        label: '🐳 Kubernetes & Air-Gapped Docker',
        description: 'Kubernetes manifests & Docker Compose pilot stacks',
        detail: 'Scaffold air-gapped container orchestration manifests for on-premises/VPC pilot deployments.'
      }
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select Target Cloud & Infrastructure Provider to Scaffold',
      title: 'Evolve AI — Multi-Cloud & Pilot Deployment Hub'
    });

    if (!pick) return;

    if (pick.id === 'studio') {
      this.openCockpit();
      return;
    }

    const scriptsDir = path.join(ws, 'scripts');
    if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

    const tfDir = path.join(ws, 'terraform');
    const k8sDir = path.join(ws, 'k8s');

    if (pick.id === 'aws') {
      const projName = await vscode.window.showInputBox({
        prompt: 'Enter AWS Stack / Project Name',
        placeHolder: 'e.g. acme-aws-pilot',
        value: 'client-aws-pilot'
      });
      if (!projName) return;

      const region = await vscode.window.showInputBox({
        prompt: 'Enter AWS Region',
        placeHolder: 'e.g. ap-southeast-2, us-east-1',
        value: 'ap-southeast-2'
      });
      if (!region) return;

      if (!fs.existsSync(tfDir)) fs.mkdirSync(tfDir, { recursive: true });
      const tfAws = DeployScriptScaffolder.generateTerraform({
        projectName: projName,
        projectId: projName,
        region,
        targetVpc: 'aws'
      });
      fs.writeFileSync(path.join(tfDir, 'aws_fargate.tf'), tfAws, 'utf8');

      const prepScript = DeployScriptScaffolder.generatePrepareDeploymentScript();
      fs.writeFileSync(path.join(scriptsDir, 'prepare-deployment.js'), prepScript, 'utf8');

      const bashScript = DeployScriptScaffolder.generateBashDeployScript({ projectName: projName, projectId: projName, region });
      const psScript = DeployScriptScaffolder.generatePowerShellDeployScript({ projectName: projName, projectId: projName, region });
      fs.writeFileSync(path.join(scriptsDir, 'deploy.sh'), bashScript, { encoding: 'utf8', mode: 0o755 });
      fs.writeFileSync(path.join(scriptsDir, 'deploy.ps1'), psScript, 'utf8');

      vscode.window.showInformationMessage(`✓ Successfully scaffolded AWS Fargate & Terraform infrastructure in terraform/aws_fargate.tf and scripts/!`);
    } else if (pick.id === 'gcp') {
      const projId = await vscode.window.showInputBox({
        prompt: 'Enter Google Cloud Project ID',
        placeHolder: 'e.g. acme-gcp-pilot-2026',
        value: 'client-gcp-pilot'
      });
      if (!projId) return;

      const region = await vscode.window.showInputBox({
        prompt: 'Enter GCP Region',
        placeHolder: 'e.g. australia-southeast1, us-central1',
        value: 'australia-southeast1'
      });
      if (!region) return;

      if (!fs.existsSync(tfDir)) fs.mkdirSync(tfDir, { recursive: true });
      const tfGcp = DeployScriptScaffolder.generateTerraform({
        projectName: projId,
        projectId: projId,
        region,
        targetVpc: 'gcp-firebase'
      });
      fs.writeFileSync(path.join(tfDir, 'gcp_cloudrun.tf'), tfGcp, 'utf8');

      const bashScript = DeployScriptScaffolder.generateBashDeployScript({ projectName: projId, projectId: projId, region, includeCloudRunBackend: true });
      const psScript = DeployScriptScaffolder.generatePowerShellDeployScript({ projectName: projId, projectId: projId, region, includeCloudRunBackend: true });
      const prepScript = DeployScriptScaffolder.generatePrepareDeploymentScript();

      fs.writeFileSync(path.join(scriptsDir, 'deploy.sh'), bashScript, { encoding: 'utf8', mode: 0o755 });
      fs.writeFileSync(path.join(scriptsDir, 'deploy.ps1'), psScript, 'utf8');
      fs.writeFileSync(path.join(scriptsDir, 'prepare-deployment.js'), prepScript, 'utf8');

      vscode.window.showInformationMessage(`✓ Successfully scaffolded GCP Cloud Run & Terraform infrastructure in terraform/gcp_cloudrun.tf and scripts/!`);
    } else if (pick.id === 'azure') {
      const appName = await vscode.window.showInputBox({
        prompt: 'Enter Azure App / Resource Group Name',
        placeHolder: 'e.g. acme-azure-pilot',
        value: 'client-azure-pilot'
      });
      if (!appName) return;

      const region = await vscode.window.showInputBox({
        prompt: 'Enter Azure Location / Region',
        placeHolder: 'e.g. australiasoutheast, eastus',
        value: 'australiasoutheast'
      });
      if (!region) return;

      if (!fs.existsSync(tfDir)) fs.mkdirSync(tfDir, { recursive: true });
      const tfAzure = `# ===================================================================
# ${appName} — Azure Container Apps & Key Vault Infrastructure (Terraform)
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# ===================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "rg" {
  name     = "${appName}-rg"
  location = "${region}"
}

resource "azurerm_container_app_environment" "env" {
  name                = "${appName}-env"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_container_app" "app" {
  name                         = "${appName}-backend"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"

  template {
    container {
      name   = "backend"
      image  = "mcr.microsoft.com/azuredocs/aci-helloworld:latest"
      cpu    = 0.5
      memory = "1.0Gi"
    }
  }
}
`;
      fs.writeFileSync(path.join(tfDir, 'azure_containerapps.tf'), tfAzure, 'utf8');

      const prepScript = DeployScriptScaffolder.generatePrepareDeploymentScript();
      fs.writeFileSync(path.join(scriptsDir, 'prepare-deployment.js'), prepScript, 'utf8');

      vscode.window.showInformationMessage(`✓ Successfully scaffolded Azure Container Apps & Terraform infrastructure in terraform/azure_containerapps.tf and scripts/!`);
    } else if (pick.id === 'firebase') {
      const projId = await vscode.window.showInputBox({
        prompt: 'Enter Firebase Project ID',
        placeHolder: 'e.g. acme-pilot-2026',
        value: 'client-pilot-project'
      });
      if (!projId) return;

      const fbJson = FirebaseConfigGenerator.generateFirebaseJson({ projectId: projId });
      const fbRc = FirebaseConfigGenerator.generateFirebaseRc({ projectId: projId });
      fs.writeFileSync(path.join(ws, 'firebase.json'), fbJson, 'utf8');
      fs.writeFileSync(path.join(ws, '.firebaserc'), fbRc, 'utf8');

      const bashScript = DeployScriptScaffolder.generateBashDeployScript({ projectName: projId, projectId: projId, includeCloudRunBackend: true });
      const psScript = DeployScriptScaffolder.generatePowerShellDeployScript({ projectName: projId, projectId: projId, includeCloudRunBackend: true });
      const prepScript = DeployScriptScaffolder.generatePrepareDeploymentScript();

      fs.writeFileSync(path.join(scriptsDir, 'deploy.sh'), bashScript, { encoding: 'utf8', mode: 0o755 });
      fs.writeFileSync(path.join(scriptsDir, 'deploy.ps1'), psScript, 'utf8');
      fs.writeFileSync(path.join(scriptsDir, 'prepare-deployment.js'), prepScript, 'utf8');

      vscode.window.showInformationMessage(`✓ Successfully scaffolded Firebase Hosting configuration and cross-platform deploy scripts in scripts/!`);
    } else if (pick.id === 'k8s_docker') {
      const k8sManifest = DeployScriptScaffolder.generateKubernetesManifest({
        projectName: 'pilot-app',
        projectId: 'client-pilot-k8s'
      });
      const dockerCompose = DeployScriptScaffolder.generateDockerCompose({
        projectName: 'pilot-app',
        projectId: 'client-pilot-docker'
      });

      if (!fs.existsSync(k8sDir)) fs.mkdirSync(k8sDir, { recursive: true });
      fs.writeFileSync(path.join(k8sDir, 'deployment.yaml'), k8sManifest, 'utf8');
      fs.writeFileSync(path.join(ws, 'docker-compose.pilot.yml'), dockerCompose, 'utf8');

      const prepScript = DeployScriptScaffolder.generatePrepareDeploymentScript();
      fs.writeFileSync(path.join(scriptsDir, 'prepare-deployment.js'), prepScript, 'utf8');

      vscode.window.showInformationMessage(`✓ Successfully scaffolded Kubernetes manifests in k8s/deployment.yaml and Docker Compose in docker-compose.pilot.yml!`);
    }
  }

  async generateRunbooks(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) return;

    const ctxManager = new FdeContextManager(this._svc.vsCtx);
    const state = ctxManager.getState();

    const docsDir = path.join(ws, 'docs');
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

    const archDoc = RunbookGenerator.generateArchitectureDoc(state);
    const deployRunbook = RunbookGenerator.generateDeploymentRunbook(state);
    const dataDict = RunbookGenerator.generateDataDictionary(state);

    fs.writeFileSync(path.join(docsDir, 'ARCHITECTURE.md'), archDoc, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'DEPLOYMENT_RUNBOOK.md'), deployRunbook, 'utf8');
    fs.writeFileSync(path.join(docsDir, 'DATA_DICTIONARY.md'), dataDict, 'utf8');

    vscode.window.showInformationMessage('✓ Generated ARCHITECTURE.md, DEPLOYMENT_RUNBOOK.md, and DATA_DICTIONARY.md in docs/');
  }
}
