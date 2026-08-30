import { PiiSanitizeOptions, PiiSanitizeResult } from "./piiSanitizerTypes";
export class PiiSanitizer {
  static generatePiiMaskingSuite(opts: PiiSanitizeOptions): PiiSanitizeResult {
    const model = (opts.modelName || "stg_sensitive_data").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const sourceTable = opts.sourceTable || "raw_source";
    const dbtMacroSql = "{% macro mask_pii_column(column_name, strategy, salt='client_salt') %}\n" +
      "  {% if strategy == 'hash_sha256' %}\n" +
      "    TO_HEX(SHA256(CONCAT({{ column_name }}, '{{ salt }}')))\n" +
      "  {% elif strategy == 'redact_full' %}\n" +
      "    '[REDACTED]'\n" +
      "  {% elif strategy == 'redact_partial' %}\n" +
      "    CONCAT('***-**-', RIGHT(CAST({{ column_name }} AS STRING), 4))\n" +
      "  {% else %}\n" +
      "    {{ column_name }}\n" +
      "  {% endif %}\n" +
      "{% endmacro %}";
    const columnsSql = opts.rules.map(r => {
      if (r.strategy === "hash_sha256") return "    {{ mask_pii_column('" + r.columnName + "', 'hash_sha256') }} AS " + r.columnName + "_tokenized";
      if (r.strategy === "redact_partial") return "    {{ mask_pii_column('" + r.columnName + "', 'redact_partial') }} AS " + r.columnName + "_masked";
      if (r.strategy === "redact_full") return "    {{ mask_pii_column('" + r.columnName + "', 'redact_full') }} AS " + r.columnName;
      return "    " + r.columnName;
    }).join(",\n");
    const stagingModelSql = "{{\n  config(\n    materialized='view',\n    schema='staging',\n    tags=['pii_sanitized', 'hipaa_compliant']\n  )\n}}\n\nWITH raw_source AS (\n  SELECT * FROM {{ source('raw', '" + sourceTable + "') }}\n)\n\nSELECT\n" + (columnsSql || "    *") + "\nFROM raw_source\n";
    const pythonSanitizerCode = "import hashlib\nimport hmac\nimport pandas as pd\n\nDEFAULT_SALT = b'enterprise_client_salt'\n\ndef hash_token(val: str, salt: bytes = DEFAULT_SALT) -> str:\n    if pd.isna(val) or val is None: return ''\n    return hmac.new(salt, str(val).encode('utf-8'), hashlib.sha256).hexdigest()\n\ndef redact_partial(val: str) -> str:\n    if pd.isna(val) or val is None: return ''\n    s = str(val)\n    return '***-**-' + s[-4:] if len(s) >= 4 else '[REDACTED]'\n";
    const auditMarkdown = "# Compliance PII/PHI Masking Audit\n**Model**: `" + model + "`\n**Classification**: High-Risk Restricted Data (SOC2 / HIPAA)\n**Rules Applied**:\n" + opts.rules.map(r => "- Column `" + r.columnName + "` (" + r.piiType.toUpperCase() + "): Masked with `" + r.strategy + "`").join("\n") + "\n";
    return {
      dbtMacroSql,
      stagingModelSql,
      pythonSanitizerCode,
      auditMarkdown,
      writtenFiles: {
        dbtMacroPath: "macros/mask_pii.sql",
        stagingModelPath: "models/staging/" + model + ".sql",
        pythonPath: "src/security/pii_sanitizer.py"
      }
    };
  }
}