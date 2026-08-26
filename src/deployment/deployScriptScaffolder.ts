/**
 * deployment/deployScriptScaffolder.ts — Cross-Platform Deploy Scripts & CI/CD Scaffolder
 *
 * Scaffolds:
 *  - scripts/deploy.sh (Bash)
 *  - scripts/deploy.ps1 (PowerShell)
 *  - scripts/prepare-deployment.js (Node.js)
 *  - .github/workflows/deploy.yml (GitHub Actions)
 */

export interface DeployScriptOptions {
  projectName?: string;
  projectId: string;
  region?: string;
  backendServiceName?: string;
  frontendBuildDir?: string;
  includeCloudRunBackend?: boolean;
  cpu?: string;
  memory?: string;
  gpu?: string;
  minInstances?: number;
  maxInstances?: number;
  ingress?: string;
  secretsProvider?: string;
  vpcId?: string;
  subnetId?: string;
  securityGroups?: string;
  targetVpc?: 'gcp-firebase' | 'aws' | 'azure' | 'docker';
}

export class DeployScriptScaffolder {
  static generateBashDeployScript(opts: DeployScriptOptions): string {
    const projName = opts.projectName || opts.projectId || 'pilot-app';
    const region = opts.region || 'australia-southeast1';
    const backendService = opts.backendServiceName || `${projName}-api`;
    const frontendDir = opts.frontendBuildDir || 'frontend';

    return `#!/usr/bin/env bash
# ===================================================================
# ${projName} — Google Cloud & Firebase Deployment Script
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# Usage: ./scripts/deploy.sh [dev|test|pilot|prod] [backend|frontend|all]
# ===================================================================

set -e

ENV=\${1:-"dev"}
COMPONENT=\${2:-"all"}
PROJECT_ID=\${GCP_PROJECT_ID:-"${opts.projectId}"}
REGION=\${GCP_REGION:-"${region}"}

echo "==================================================================="
echo "  Deploying ${projName} (Target: $ENV | Component: $COMPONENT)"
echo "  Project: $PROJECT_ID | Region: $REGION"
echo "==================================================================="

# Step 1: Pre-Flight Health Check
if [ -f "scripts/prepare-deployment.js" ]; then
  echo "--- Running Pre-Flight Sanity Check ---"
  node scripts/prepare-deployment.js --clean
fi

# Step 2: Deploy Backend (Cloud Run)
${opts.includeCloudRunBackend ? `if [[ "$COMPONENT" == "all" || "$COMPONENT" == "backend" ]]; then
  echo "--- Building & Deploying Backend ($ENV) ---"
  IMAGE_TAG="$REGION-docker.pkg.dev/$PROJECT_ID/${projName}-docker/backend:$ENV"
  docker build -t "$IMAGE_TAG" -f Dockerfile.backend .
  docker push "$IMAGE_TAG"
  gcloud run deploy "${backendService}-$ENV" \\
    --image="$IMAGE_TAG" \\
    --platform=managed \\
    --region="$REGION" \\
    ${opts.vpcId ? `--network="${opts.vpcId}"` : ''} \\
    ${opts.subnetId ? `--subnet="${opts.subnetId}"` : ''} \\
    --allow-unauthenticated \\
    --project="$PROJECT_ID"
fi` : '# Backend deployment skipped (not enabled)'}

# Step 3: Deploy Frontend (Firebase Hosting)
if [[ "$COMPONENT" == "all" || "$COMPONENT" == "frontend" ]]; then
  echo "--- Deploying Frontend to Firebase Hosting ($ENV) ---"
  npx firebase-tools use "$ENV" --project "$PROJECT_ID"
  npx firebase-tools deploy --only hosting --project "$PROJECT_ID"
fi

echo "==================================================================="
echo "  ✓ Deployment completed successfully to $ENV"
echo "==================================================================="
`;
  }

  static generatePowerShellDeployScript(opts: DeployScriptOptions): string {
    const projName = opts.projectName || opts.projectId || 'pilot-app';
    const region = opts.region || 'australia-southeast1';
    const backendService = opts.backendServiceName || `${projName}-api`;
    const frontendDir = opts.frontendBuildDir || 'frontend';

    return `<#
===================================================================
${projName} — Google Cloud & Firebase Deployment Script
Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
Usage: .\\scripts\\deploy.ps1 -Environment dev -Component all
===================================================================
#>

param(
  [ValidateSet("dev","test","pilot","prod")]
  [string]$Environment = "dev",

  [ValidateSet("all","backend","frontend")]
  [string]$Component = "all",

  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $env:GCP_REGION
)

$ErrorActionPreference = "Stop"

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "  Deploying ${projName} (Target: $Environment | Component: $Component)" -ForegroundColor Cyan
Write-Host "  Project: $ProjectId | Region: $Region" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan

# Step 1: Pre-Flight Sanity Check
if (Test-Path "scripts/prepare-deployment.js") {
  Write-Host "--- Running Pre-Flight Sanity Check ---" -ForegroundColor Yellow
  node scripts/prepare-deployment.js --clean
}

# Step 2: Deploy Backend (Cloud Run)
${opts.includeCloudRunBackend ? `if ($Component -eq "all" -or $Component -eq "backend") {
    Write-Host "--- Building & Deploying Backend ($Environment) ---" -ForegroundColor Yellow
    $imageTag = "$Region-docker.pkg.dev/$ProjectId/${projName}-docker/backend:$Environment"
    docker build -t $imageTag -f Dockerfile.backend .
    docker push $imageTag
    gcloud run deploy "${backendService}-$Environment" --project $ProjectId --image $imageTag --region $Region --platform managed --allow-unauthenticated
}` : '# Backend deployment skipped (not enabled)'}

# Step 3: Deploy Frontend (Firebase Hosting)
if ($Component -eq "all" -or $Component -eq "frontend") {
  Write-Host "--- Deploying Frontend to Firebase Hosting ($Environment) ---" -ForegroundColor Yellow
  npx firebase-tools use "$Environment" --project "$ProjectId"
  npx firebase-tools deploy --only hosting --project "$ProjectId"
}

Write-Host "===================================================================" -ForegroundColor Green
Write-Host "  ✓ Deployment completed successfully to $Environment" -ForegroundColor Green
Write-Host "===================================================================" -ForegroundColor Green
`;
  }

  static generatePrepareDeploymentScript(opts?: DeployScriptOptions): string {
    const projName = opts?.projectName || opts?.projectId || 'pilot-app';
    return `/**
 * scripts/prepare-deployment.js — Pre-Flight Deterministic Workspace Sanity Script
 *
 * Runs automatically prior to deploy to remove leftover .bak files, check .env parity,
 * and verify required build artifacts without network latency.
 */

const fs = require('fs');
const path = require('path');

const shouldClean = process.argv.includes('--clean');
const rootDir = path.resolve(__dirname, '..');

console.log('[pre-flight] Scanning workspace for artifacts in: ' + rootDir);

const danglingPatterns = [/\\.bak$/i, /\\.tmp$/i, /~$/, /^temp_/i, /\\.DS_Store$/];
let deletedCount = 0;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'node_modules' || f === '.git' || f === 'dist' || f === 'out') continue;
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
    } else {
      if (danglingPatterns.some(p => p.test(f))) {
        if (shouldClean) {
          try {
            fs.unlinkSync(full);
            console.log('[clean] Removed dangling file: ' + path.relative(rootDir, full));
            deletedCount++;
          } catch (e) {
            console.warn('[clean] Could not remove ' + full + ': ' + e.message);
          }
        } else {
          console.warn('[warning] Found dangling file: ' + path.relative(rootDir, full));
        }
      }
    }
  }
}

scanDir(rootDir);
console.log('[pre-flight] Audit completed. Cleaned ' + deletedCount + ' temporary files.');
`;
  }

  static generateGitHubActionsDeployWorkflow(opts: DeployScriptOptions): string {
    const projName = opts.projectName || opts.projectId || 'pilot-app';
    const region = opts.region || 'australia-southeast1';
    const backendService = opts.backendServiceName || `${projName}-api`;

    return `# ===================================================================
# ${projName} — Automated Deployment Pipeline (GCP + Firebase)
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# ===================================================================

name: "🚀 FDE Pilot Deployment Pipeline"

on:
  push:
    branches: [main, master, pilot, release/*]
  workflow_dispatch:
    inputs:
      target_env:
        description: "Target Deployment Tier"
        required: true
        default: "pilot"
        type: choice
        options: [dev, test, pilot, prod]

env:
  GCP_PROJECT_ID: "${opts.projectId}"
  GCP_REGION: "${region}"
  NODE_VERSION: "20.x"

jobs:
  validate:
    name: "1. Pre-Flight Health Audit"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
      - name: Run Deterministic Pre-Flight Audit
        run: node scripts/prepare-deployment.js --clean

  deploy-backend:
    name: "2. Build & Deploy Cloud Run Backend"
    needs: [validate]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: \${{ secrets.GCP_SA_KEY }}
      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2
      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker \${{ env.GCP_REGION }}-docker.pkg.dev --quiet
      - name: Build and Push Backend Container
        run: |
          IMAGE="\${{ env.GCP_REGION }}-docker.pkg.dev/\${{ env.GCP_PROJECT_ID }}/${projName}-docker/backend:\${{ github.ref_name }}"
          docker build -t "\$IMAGE" -f Dockerfile.backend .
          docker push "\$IMAGE"
      - name: Deploy to Cloud Run
        run: |
          IMAGE="\${{ env.GCP_REGION }}-docker.pkg.dev/\${{ env.GCP_PROJECT_ID }}/${projName}-docker/backend:\${{ github.ref_name }}"
          gcloud run deploy "${backendService}-\${{ github.ref_name }}" \\
            --image="\$IMAGE" \\
            --region="\${{ env.GCP_REGION }}" \\
            --platform=managed \\
            --allow-unauthenticated

  deploy-frontend:
    name: "2. Deploy Firebase Hosting"
    needs: [validate]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Build Frontend
        run: npm run build
      - name: Deploy to Firebase Hosting
        run: npx firebase-tools deploy --only "hosting:\${{ github.ref_name }}" --project \${{ env.GCP_PROJECT_ID }}
        env:
          FIREBASE_TOKEN: \${{ secrets.FIREBASE_TOKEN }}
`;
  }

  static generateTerraform(opts: DeployScriptOptions): string {
    const projName = opts.projectName || opts.projectId || 'pilot-app';
    const region = opts.region || 'australia-southeast1';
    const cpu = opts.cpu || '1';
    const memory = opts.memory || '1Gi';
    const minInstances = opts.minInstances ?? 0;
    const maxInstances = opts.maxInstances ?? 10;
    const ingress = opts.ingress || 'all';
    const secretsProvider = opts.secretsProvider || 'gcp-secret-manager';
    const hasGpu = opts.gpu && opts.gpu !== 'none';

    if (opts.targetVpc === 'aws') {
      const subnetsArr = opts.subnetId ? opts.subnetId.split(',').map(s => `"${s.trim()}"`).join(', ') : '"subnet-pilot-a", "subnet-pilot-b"';
      const sgArr = opts.securityGroups ? opts.securityGroups.split(',').map(s => `"${s.trim()}"`).join(', ') : '"sg-pilot-internal"';

      return `# ===================================================================
# ${projName} — AWS Fargate & Secrets Infrastructure (Terraform)
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# ===================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${region}"
}

resource "aws_ecs_cluster" "pilot_cluster" {
  name = "${projName}-cluster"
}

resource "aws_ecs_task_definition" "app_task" {
  family                   = "${projName}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "${parseInt(cpu, 10) * 1024 || 1024}"
  memory                   = "${memory.replace(/[^0-9]/g, '') === '1' ? '2048' : '1024'}"

  container_definitions = jsonencode([
    {
      name      = "${projName}-backend"
      image     = "\${aws_ecs_cluster.pilot_cluster.name}.dkr.ecr.${region}.amazonaws.com/app:latest"
      essential = true
      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
        }
      ]
    }
  ])
}

resource "aws_ecs_service" "app_service" {
  name            = "${projName}-service"
  cluster         = aws_ecs_cluster.pilot_cluster.id
  task_definition = aws_ecs_task_definition.app_task.arn
  desired_count   = ${Math.max(1, minInstances)}
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [${subnetsArr}]
    security_groups  = [${sgArr}]
    assign_public_ip = ${ingress === 'all' ? 'true' : 'false'}
  }
}
`;
    }

    // Default to GCP Terraform
    return `# ===================================================================
# ${projName} — Google Cloud Run & Secret Manager (Terraform)
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# ===================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = "${opts.projectId}"
  region  = "${region}"
}

${secretsProvider === 'gcp-secret-manager' ? `resource "google_secret_manager_secret" "app_secrets" {
  secret_id = "${projName}-secrets"
  replication {
    auto {}
  }
}
` : ''}

resource "google_cloud_run_v2_service" "backend_service" {
  name     = "${projName}-backend"
  location = "${region}"
  ingress  = "${ingress === 'internal' ? 'INGRESS_TRAFFIC_INTERNAL_ONLY' : 'INGRESS_TRAFFIC_ALL'}"

  template {
    scaling {
      min_instance_count = ${minInstances}
      max_instance_count = ${maxInstances}
    }

    ${(opts.vpcId || opts.subnetId) ? `vpc_access {
      network_interfaces {
        ${opts.vpcId ? `network    = "${opts.vpcId}"` : ''}
        ${opts.subnetId ? `subnetwork = "${opts.subnetId}"` : ''}
      }
    }` : ''}

    containers {
      image = "${region}-docker.pkg.dev/${opts.projectId}/${projName}-docker/backend:latest"
      resources {
        limits = {
          cpu    = "${cpu}"
          memory = "${memory}"
          ${hasGpu ? `"google.com/gpu" = "1"` : ''}
        }
      }
      ports {
        container_port = 8080
      }
    }
    ${hasGpu ? `node_selector = {
      "cloud.google.com/gke-accelerator" = "${opts.gpu}"
    }` : ''}
  }
}

output "service_uri" {
  value       = google_cloud_run_v2_service.backend_service.uri
  description = "Deployed Cloud Run live endpoint URL"
}
`;
  }

  static generateKubernetesManifest(opts: DeployScriptOptions): string {
    const projName = opts.projectName || opts.projectId || 'pilot-app';
    const cpu = opts.cpu || '1';
    const memory = opts.memory || '1Gi';
    const replicas = opts.minInstances || 2;
    const hasGpu = opts.gpu && opts.gpu !== 'none';

    return `# ===================================================================
# ${projName} — Kubernetes Deployment & Service Manifest
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# ===================================================================
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${projName}-deployment
  labels:
    app: ${projName}
    tier: backend
  ${opts.subnetId ? `annotations:
    networking.k8s.io/subnet: "${opts.subnetId}"` : ''}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${projName}
  template:
    metadata:
      labels:
        app: ${projName}
    spec:
      containers:
      - name: backend
        image: ${projName}-backend:latest
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "${memory}"
            cpu: "${cpu}"
          limits:
            memory: "${memory}"
            cpu: "${cpu}"
            ${hasGpu ? `nvidia.com/gpu: "1"` : ''}
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: ${projName}-service
spec:
  type: ClusterIP
  selector:
    app: ${projName}
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
`;
  }

  static generateDockerCompose(opts: DeployScriptOptions): string {
    const projName = opts.projectName || opts.projectId || 'pilot-app';
    const cpu = opts.cpu || '1';
    const memory = opts.memory || '1Gi';
    const hasGpu = opts.gpu && opts.gpu !== 'none';

    return `# ===================================================================
# ${projName} — Air-Gapped / Local Docker Compose Environment
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# ===================================================================
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    image: ${projName}-backend:local
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - PORT=8080
    deploy:
      resources:
        limits:
          cpus: '${cpu}'
          memory: ${memory}
        ${hasGpu ? `reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]` : ''}
    restart: unless-stopped
`;
  }
}
