import { ReverseEtlOptions, ReverseEtlResult } from "./reverseEtlTypes";
export class ReverseEtlGenerator {
  static generateReverseEtlSync(opts: ReverseEtlOptions): ReverseEtlResult {
    const syncName = (opts.syncName || "sync_orders_to_salesforce").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const sourceModel = opts.sourceModel || "fct_orders_mart";
    const batchSize = opts.batchSize || 100;
    const rateLimit = opts.rateLimitPerSec || 50;
    const cursorCol = opts.cursorColumn || "updated_at";
    const idKey = opts.idempotencyKeyColumn || "order_id";
    const pythonWorker = "# Reverse ETL Worker\nimport os, time, hashlib, requests\n\nTARGET_ENDPOINT = os.getenv('" + opts.sink.toUpperCase() + "_ENDPOINT', '" + (opts.targetEndpoint || "https://api.client.internal/v1/sync") + "')\nAPI_KEY = os.getenv('" + opts.sink.toUpperCase() + "_API_KEY', 'secret-token')\nBATCH_SIZE = " + batchSize + "\nRATE_LIMIT_DELAY = " + (1.0 / rateLimit) + "\n\ndef compute_idempotency_key(row: dict) -> str:\n    payload = f\"{row.get('" + idKey + "')}:{row.get('" + cursorCol + "')}\"\n    return hashlib.sha256(payload.encode('utf-8')).hexdigest()\n\ndef sync_batch(records: list) -> dict:\n    headers = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}\n    success, failed = 0, 0\n    for r in records:\n        headers['X-Idempotency-Key'] = compute_idempotency_key(r)\n        try:\n            resp = requests.post(TARGET_ENDPOINT, json=r, headers=headers, timeout=10)\n            if resp.status_code in [200, 201, 204]: success += 1\n            else: failed += 1\n        except Exception: failed += 1\n        time.sleep(RATE_LIMIT_DELAY)\n    return {'synced': success, 'failed': failed}\n";
    const typeScriptWorker = "export class ReverseEtlWorker {\n  private endpoint = '" + (opts.targetEndpoint || "https://api.client.internal/v1/sync") + "';\n  public async syncBatch(records: any[]) { return { synced: records.length, failed: 0 }; }\n}\n";
    const dockerCompose = "version: '3.8'\nservices:\n  " + syncName + ":\n    build: .\n    restart: always\n";
    return {
      pythonWorker,
      typeScriptWorker,
      dockerCompose,
      writtenFiles: {
        pythonWorkerPath: "src/sync/" + syncName + "_worker.py",
        typeScriptWorkerPath: "src/sync/" + syncName + "_worker.ts"
      }
    };
  }
}