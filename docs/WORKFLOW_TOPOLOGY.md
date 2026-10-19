# 🗺️ Workflow Topology Architecture
> **Active Architecture Preset**: `custom`

```mermaid
sequenceDiagram
    autonumber
    participant Salesforce as Salesforce CRM
    participant MuleExp as Mule Experience API
    participant MuleProc as Mule Process API
    participant CHIB as CHIB Integration Broker
    participant EMR as EMR Sunrise Clinical Core
    participant xAmplify as xAmplify Document Consolidation Engine

    Note over Salesforce,xAmplify: Process 1: Visit validation and document consolidation

    Salesforce->>MuleExp: Calls Experience API with Visit ID, MRN & SAUHI (Referral ID correlation)
    MuleExp-->>Salesforce: Acknowledge request & assign Correlation ID (Status: "Request Received")
    MuleExp->>MuleProc: Delegate visit validation process (with Correlation ID & identifiers)
    MuleProc->>CHIB: Call CHIB with payload to validate entry in EMR
    CHIB->>EMR: Forward identifier validation query (Visit ID, MRN, SAUHI)
    EMR-->>CHIB: Validates identifiers & sends response back
    CHIB-->>MuleProc: Deliver EMR validation response to Mule
    alt Visit ID, MRN and SAUHI all match ("Success")
        EMR-->>MuleProc: Returns "Success" acknowledgement (via CHIB)
    else Validation fails
        MuleProc-->>Salesforce: Pass corresponding EMR error message back so user sees reason
    end
    opt On "Success": Document Consolidation Pipeline
        MuleProc->>Salesforce: Fetch unconsolidated referral documents
        Salesforce-->>MuleProc: Return referral document attachments
        MuleProc->>xAmplify: Send referral documents to xAmplify for consolidation
        xAmplify-->>MuleProc: Return consolidated document payload
        MuleProc->>Salesforce: Write consolidated document back as file (Status: "Documents Consolidated")
    end
```
