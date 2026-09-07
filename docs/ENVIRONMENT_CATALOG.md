# Client Pilot Engagement — Environment Variables & Secrets Reference

> **Maintained by:** Forward Deployed Engineering (FDE)  
> **Target Environment:** pilot  

---

## 1. Required Runtime Configuration

| Variable Name | Required | Secret? | Description / Expected Value |
| :--- | :---: | :---: | :--- |
| `GCP_PROJECT_ID` | **Yes** | Public | Runtime configuration for `GCP_PROJECT_ID` |
| `FIREBASE_TOKEN` | **Yes** | 🔒 Secret | Runtime configuration for `FIREBASE_TOKEN` |
| `DATABASE_URL` | **Yes** | Public | Runtime configuration for `DATABASE_URL` |
| `API_BEARER_TOKEN` | **Yes** | 🔒 Secret | Runtime configuration for `API_BEARER_TOKEN` |
| `PORT` | **Yes** | Public | Runtime configuration for `PORT` |

---

## 2. Setup Guide

### Local Development (`.env`):
```bash
cp .env.example .env
# Fill in local secrets safely
```

### CI/CD Deployment:
Configure all secrets under GitHub Actions / GitLab CI pipeline settings before triggering automated pilot builds.
