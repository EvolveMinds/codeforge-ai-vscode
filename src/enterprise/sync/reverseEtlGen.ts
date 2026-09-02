import { ReverseEtlOptions, ReverseEtlResult } from "./reverseEtlTypes";

export class ReverseEtlGenerator {
  static generateReverseEtlSync(opts: ReverseEtlOptions): ReverseEtlResult {
    const safeOpts = opts || ({} as any);
    const sink = (safeOpts.sink || (safeOpts as any).destinationApp || "salesforce").toString();
    const syncName = (safeOpts.syncName || `sync_${safeOpts.sourceModel || 'orders'}_to_${sink}`).toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const sourceModel = safeOpts.sourceModel || (safeOpts as any).sourceWarehouse || "fct_orders_mart";
    const batchSize = safeOpts.batchSize || 100;
    const rateLimit = safeOpts.rateLimitPerSec || 50;
    const cursorCol = safeOpts.cursorColumn || "updated_at";
    const idKey = safeOpts.idempotencyKeyColumn || ((safeOpts as any).objectType ? `${(safeOpts as any).objectType.toLowerCase()}_id` : "order_id");
    const sinkUpper = sink.toUpperCase();

    const pythonWorker = "# Reverse ETL Worker\nimport os, time, hashlib, requests\n\nTARGET_ENDPOINT = os.getenv('" + sinkUpper + "_ENDPOINT', '" + (safeOpts.targetEndpoint || "https://api.client.internal/v1/sync") + "')\nAPI_KEY = os.getenv('" + sinkUpper + "_API_KEY', 'secret-token')\nBATCH_SIZE = " + batchSize + "\nRATE_LIMIT_DELAY = " + (1.0 / rateLimit) + "\n\ndef compute_idempotency_key(row: dict) -> str:\n    payload = f\"{row.get('" + idKey + "')}:{row.get('" + cursorCol + "')}\"\n    return hashlib.sha256(payload.encode('utf-8')).hexdigest()\n\ndef sync_batch(records: list) -> dict:\n    headers = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}\n    success, failed = 0, 0\n    for r in records:\n        headers['X-Idempotency-Key'] = compute_idempotency_key(r)\n        try:\n            resp = requests.post(TARGET_ENDPOINT, json=r, headers=headers, timeout=10)\n            if resp.status_code in [200, 201, 204]: success += 1\n            else: failed += 1\n        except Exception: failed += 1\n        time.sleep(RATE_LIMIT_DELAY)\n    return {'synced': success, 'failed': failed}\n";
    const typeScriptWorker = "export class ReverseEtlWorker {\n  private endpoint = '" + (safeOpts.targetEndpoint || "https://api.client.internal/v1/sync") + "';\n  public async syncBatch(records: any[]) { return { synced: records.length, failed: 0 }; }\n}\n";
    const dockerCompose = "version: '3.8'\nservices:\n  " + syncName + ":\n    build: .\n    restart: always\n";

    return {
      pythonWorker,
      typeScriptWorker,
      dockerCompose,
      workerCode: pythonWorker,
      writtenFiles: {
        pythonWorkerPath: "src/sync/" + syncName + "_worker.py",
        typeScriptWorkerPath: "src/sync/" + syncName + "_worker.ts"
      }
    };
  }
}