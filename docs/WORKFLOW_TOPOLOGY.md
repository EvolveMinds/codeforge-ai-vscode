# 🗺️ Workflow Topology Architecture
> **Active Architecture Preset**: `custom`

```mermaid
sequenceDiagram
    autonumber
    actor Broker as Commercial Broker
    participant Gateway as Secure Ingress & API Gateway (OAuth2)
    participant Staging as Deterministic Schema & Rule Staging Gate
    participant AI as Evolve AI Copilot (Air-Gapped LLM / SLM)
    participant DB as Production Warehouse & Audit Log
    actor Supervisor as Human-in-the-Loop (HITL) Review Gate

    Broker->>Gateway: Structured JSON payload with mTLS tenant token
    Gateway->>Staging: Forward to Deterministic
    Staging->>AI: Enrich payload with grounded enterprise embeddings
    AI-->>Staging: Synthesize deterministic proposal with citations (<50ms)
    Staging->>Supervisor: Route high-impact threshold action for sign-off
    Supervisor-->>Staging: 1-Click Cryptographically Signed Approval
    Staging->>DB: Atomic commit with tamper-evident audit receipt
    DB-->>Broker: Instant verified execution receipt delivered (<50ms)
```
