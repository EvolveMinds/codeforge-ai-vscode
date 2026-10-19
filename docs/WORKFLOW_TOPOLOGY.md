# 🗺️ Workflow Topology Architecture
> **Active Architecture Preset**: `custom`

```mermaid
sequenceDiagram
    autonumber
    actor User as Business User / Operator
    participant Gateway as Secure Ingress & API Gateway (OAuth2)
    participant Staging as Deterministic Schema & Rule Staging Gate
    participant AI as Evolve AI Copilot (Air-Gapped LLM / SLM)
    participant DB as Salesforce CRM API Service
    actor Supervisor as Human-in-the-Loop (HITL) Review Gate

    Note over User,Supervisor: Process 1: Visit validation and document consolidationSalesforce gets an im...

    User->>Gateway: Structured JSON payload with mTLS tenant token
    Gateway->>Staging: Forward to Deterministic
    Staging->>AI: Enrich payload with grounded enterprise embeddings
    AI-->>Staging: Synthesize deterministic proposal with citations (<50ms)
    Staging->>Supervisor: Route high-impact threshold action for sign-off
    Supervisor-->>Staging: 1-Click Cryptographically Signed Approval
    Staging->>DB: Atomic commit with tamper-evident audit receipt
    DB-->>User: Instant verified execution receipt delivered (<50ms)
```
