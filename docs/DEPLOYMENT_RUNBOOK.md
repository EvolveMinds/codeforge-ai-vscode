> [!WARNING]
> ## ⚠️ DEMONSTRATION ARTIFACT — NOT A CLIENT DELIVERABLE
>
> This document was generated while the Delivery Studio was in **DEMO mode**.
> Figures, findings and signatures in it come from built-in sample data and
> describe no real system. It must not be shared with a client, attached to a
> proposal, or used as evidence of testing.
>
> _Generated 2026-10-25T12:42:27.524Z_
# Client Pilot Engagement — Operations & Deployment Runbook

> **Audience:** Client IT, DevOps, and Platform Engineering Teams  
> **Maintained by:** Forward Deployed Engineering (FDE)  

---

## 1. Quick-Start Deployment

To deploy updates to the client environment, execute the cross-platform deployment script from the project root:

```bash
# Linux / macOS (Bash)
./scripts/deploy.sh pilot all

# Windows (PowerShell)
.\scripts\deploy.ps1 -Environment pilot -Component all
```

---

## 2. Pre-Deployment Health & Sanity Checklist

Before initiating any deployment to staging or production, run the pre-flight verification script:

```bash
node scripts/prepare-deployment.js --clean
```

### Automated Verifications:
1. **Dangling Artifacts:** Cleans up temporary or backup files (`*.bak`, `*.tmp`, `*_OLD.*`).
2. **Secret Leak Prevention:** Scans build artifacts to ensure no private keys or tokens are exposed.
3. **Environment Parity:** Verifies that all required keys in `.env.example` are populated in the active environment.

---

## 3. Rollback Procedure

If an issue is detected post-deployment:

### Frontend (Firebase Hosting):
```bash
# Roll back to the previous stable release instantly:
npx firebase-tools hosting:rollback --project acme-pilot-2026
```

### Backend (Cloud Run):
```bash
# Route 100% of traffic back to the previous stable revision:
gcloud run services update-traffic api-service --to-revisions=PREVIOUS_REVISION=100
```

---

## 4. Troubleshooting & Diagnostics

| Symptom | Probable Cause | Action |
| :--- | :--- | :--- |
| **HTTP 429 Too Many Requests** | Upstream client rate limit reached | Verify `RATE_LIMIT_PER_SEC` config in connector SDK. |
| **Missing Environment Variable** | `.env` parity discrepancy | Compare local `.env` against `.env.example`. |
| **CORS Error on Frontend** | Cloud Run domain mismatch | Update `CLIENT_URLS` in backend environment configuration. |

---

## 5. Python AI Services, Sandboxes & Container Workloads

### Local Execution & Sandbox Testing
```bash
# 1-Click virtual environment provisioning via uv (sub-second):
uv venv .venv && source .venv/bin/activate # or .venv\Scripts\activate on Windows
uv pip install -r requirements.txt

# Execute neural verification contracts and regression suite:
pytest tests/ -v
```

### Production Multi-Stage Container Build & Target VPC Deployment
```bash
# Build hardened non-root container with uv cache:
docker build -t client-pilot-engagement-service:latest .

# Deploy container to target VPC:
# Inherits active Cloud Hub credentials and VPC network policies
./scripts/deploy.sh pilot python-service
```
