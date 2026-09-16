# 🗺️ Workflow Topology Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Field Operator
    participant EdgeApp as Mobile Edge Client
    participant AICore as Auto-Extraction & Validation Core
    actor Reviewer as Quality Assurance Gate
    participant ERP as Enterprise SAP / ERP
    participant VectorStore as Vector Store
    Operator->>EdgeApp: Snap invoice / receipt photo (⚡ Instant)
    EdgeApp->>AICore: Upload OCR image payload
    AICore->>AICore: Multi-modal document parsing & tax check
    AICore->>Reviewer: Exception routing on 99.8% confidence
    Reviewer-->>AICore: Approve batch anomaly
    AICore->>ERP: Post journal entry via authenticated REST API
    ERP-->>Operator: Confirmed transaction receipt (⚡ <1.5s)
```
