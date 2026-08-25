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
  projectName: string;
  projectId: string;
  region?: string;
  backendServiceName?: string;
  frontendBuildDir?: string;
  includeCloudRunBackend?: boolean;
}

export class DeployScriptScaffolder {
  static generateBashDeployScript(opts: DeployScriptOptions): string {
    const region = opts.region || 'australia-southeast1';
    const backendService = opts.backendServiceName || `${opts.projectName}-api`;
    const frontendDir = opts.frontendBuildDir || 'frontend';

    return `#!/usr/bin/env bash
# ===================================================================
# ${opts.projectName} — Google Cloud & Firebase Deployment Script
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# Usage: ./scripts/deploy.sh [dev|test|pilot|prod] [backend|frontend|all]
# ===================================================================

set -e

ENV=\${1:-"dev"}
COMPONENT=\${2:-"all"}
PROJECT_ID=\${GCP_PROJECT_ID:-"${opts.projectId}"}
REGION=\${GCP_REGION:-"${region}"}

echo "==================================================================="
echo "  Deploying ${opts.projectName} (Target: $ENV | Component: $COMPONENT)"
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
  IMAGE_TAG="$REGION-docker.pkg.dev/$PROJECT_ID/${opts.projectName}-docker/backend:$ENV"
  docker build -t "$IMAGE_TAG" -f Dockerfile.backend .
  docker push "$IMAGE_TAG"
  gcloud run deploy "${backendService}-$ENV" \\
    --project="$PROJECT_ID" \\
    --image="$IMAGE_TAG" \\
    --region="$REGION" \\
    --platform=managed \\
    --allow-unauthenticated
fi` : '# (Backend deployment skipped)'}

# Step 3: Deploy Frontend (Firebase Hosting)
if [[ "$COMPONENT" == "all" || "$COMPONENT" == "frontend" ]]; then
  echo "--- Building & Deploying Frontend ($ENV) ---"
  if [ -d "${frontendDir}" ]; then
    cd ${frontendDir} && npm run build && cd ..
  else
    npm run build
  fi
  npx firebase-tools deploy --only "hosting:$ENV" --project "$PROJECT_ID"
fi

echo "✓ Deployment complete for $ENV!"
`;
  }

  static generatePowerShellDeployScript(opts: DeployScriptOptions): string {
    const region = opts.region || 'australia-southeast1';
    const backendService = opts.backendServiceName || `${opts.projectName}-api`;
    const frontendDir = opts.frontendBuildDir || 'frontend';

    return `<#
===================================================================
${opts.projectName} — Google Cloud & Firebase Deployment Script
Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
Usage: .\\scripts\\deploy.ps1 -Environment dev -Component all
===================================================================
#>
param(
    [ValidateSet("dev","test","pilot","prod")]
    [string]$Environment = "dev",

    [ValidateSet("all","backend","frontend")]
    [string]$Component = "all",

    [string]$ProjectId = "${opts.projectId}",
    [string]$Region = "${region}"
)

$ErrorActionPreference = "Stop"

Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "  Deploying ${opts.projectName} (Target: $Environment | Component: $Component)" -ForegroundColor Cyan
Write-Host "  Project: $ProjectId | Region: $Region" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan

# Step 1: Pre-Flight Health Check
if (Test-Path "scripts/prepare-deployment.js") {
    Write-Host "--- Running Pre-Flight Sanity Check ---" -ForegroundColor Yellow
    node scripts/prepare-deployment.js --clean
}

# Step 2: Deploy Backend (Cloud Run)
${opts.includeCloudRunBackend ? `if ($Component -eq "all" -or $Component -eq "backend") {
    Write-Host "--- Building & Deploying Backend ($Environment) ---" -ForegroundColor Yellow
    $imageTag = "$Region-docker.pkg.dev/$ProjectId/${opts.projectName}-docker/backend:$Environment"
    docker build -t $imageTag -f Dockerfile.backend .
    docker push $imageTag
    gcloud run deploy "${backendService}-$Environment" --project $ProjectId --image $imageTag --region $Region --platform managed --allow-unauthenticated
}` : '# (Backend deployment skipped)'}

# Step 3: Deploy Frontend (Firebase Hosting)
if ($Component -eq "all" -or $Component -eq "frontend") {
    Write-Host "--- Building & Deploying Frontend ($Environment) ---" -ForegroundColor Yellow
    if (Test-Path "${frontendDir}") {
        Push-Location "${frontendDir}"
        npm run build
        Pop-Location
    } else {
        npm run build
    }
    npx firebase-tools deploy --only "hosting:$Environment" --project $ProjectId
}

Write-Host "✓ Deployment complete for $Environment!" -ForegroundColor Green
`;
  }

  static generatePrepareDeploymentScript(): string {
    return `#!/usr/bin/env node
/**
 * scripts/prepare-deployment.js — Pre-Deployment Sanitizer & Health Check
 * Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
 */
const fs = require('fs');
const path = require('path');

const shouldClean = process.argv.includes('--clean');
const rootDir = path.join(__dirname, '..');

console.log('='.repeat(60));
console.log('PRE-DEPLOYMENT SANITY & HEALTH AUDIT');
console.log('='.repeat(60));

const BACKUP_PATTERNS = [/\\.bak$/i, /\\.backup$/i, /_OLD\\./i, /_NEW\\./i, /_temp\\./i, /\\.tmp$/i, /~$/];
const foundFiles = [];

function scan(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (['node_modules', '.git', 'dist', 'build', '.venv', 'venv'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scan(full);
    } else {
      if (BACKUP_PATTERNS.some(p => p.test(e.name))) {
        foundFiles.push(full);
      }
    }
  }
}

scan(rootDir);

if (foundFiles.length > 0) {
  console.log(\`Found \${foundFiles.length} temporary/backup files:\`);
  foundFiles.forEach(f => console.log(\`  - \${path.relative(rootDir, f)}\`));
  if (shouldClean) {
    foundFiles.forEach(f => fs.unlinkSync(f));
    console.log(\`✓ Cleaned \${foundFiles.length} files successfully.\`);
  } else {
    console.log('Run with --clean to remove these files before deploying.');
  }
} else {
  console.log('✓ Workspace clean — 0 backup/temp files detected.');
}
console.log('='.repeat(60));
`;
  }

  static generateGitHubActionsDeployWorkflow(opts: DeployScriptOptions): string {
    const region = opts.region || 'australia-southeast1';
    const backendService = opts.backendServiceName || `${opts.projectName}-api`;

    return `# ===================================================================
# ${opts.projectName} — Automated Deployment Pipeline (GCP + Firebase)
# Scaffolding: Evolve AI (Forward Deployed Engineer Suite)
# ===================================================================

name: Deploy Pipeline

on:
  push:
    branches: [main, dev, test, pilot, prod]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target deployment environment'
        required: true
        type: choice
        options: [dev, test, pilot, prod]

permissions:
  contents: read
  id-token: write

env:
  NODE_VERSION: '20'
  GCP_PROJECT_ID: '${opts.projectId}'
  GCP_REGION: '${region}'

jobs:
  validate:
    name: "1. Pre-Flight Validation"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
          cache: 'npm'
      - run: npm ci
      - name: Pre-Flight Clean & Audit
        run: node scripts/prepare-deployment.js --clean

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
}
