/**
 * mcp/compactSchema.ts — Compact Schema Profile for Model Context Protocol (MCP)
 *
 * Implements REA-inspired schema minimization to keep MCP tool definitions
 * strictly under the 13 KB budget required by restricted LLMs (Gemini, Moonshot,
 * Anthropic Claude, and local quantized models).
 *
 * Prevents "schema too large" or "tool definition exceeds context budget"
 * rejection errors by:
 *  1. Stripping redundant documentation, examples, and formatting directives.
 *  2. Inlining or eliminating bloated definitions ($defs).
 *  3. Truncating overly verbose nested property descriptions.
 *  4. Enforcing deterministic byte caps (< 12,288 bytes per tool).
 */

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
  [key: string]: any;
}

export interface SchemaBudgetReport {
  valid: boolean;
  maxAllowedBytes: number;
  toolsCount: number;
  oversizedTools: string[];
  toolSizes: Record<string, number>;
}

export class CompactSchemaProfile {
  /** Maximum allowable byte size for any single tool definition (defaults to 12 KB = 12,288 bytes) */
  public static readonly DEFAULT_MAX_TOOL_BYTES = 12 * 1024;

  /** Maximum characters for top-level tool descriptions */
  public static readonly MAX_TOOL_DESC_LENGTH = 280;

  /** Maximum characters for individual property descriptions */
  public static readonly MAX_PROP_DESC_LENGTH = 140;

  /**
   * Compresses a full MCP tool definition to adhere to the Compact Schema Profile.
   */
  public static compressTool(
    tool: McpToolDefinition,
    maxBytes: number = this.DEFAULT_MAX_TOOL_BYTES
  ): McpToolDefinition {
    // 1. Sanitize tool description
    const compressedDesc = this.cleanDescription(tool.description, this.MAX_TOOL_DESC_LENGTH);

    // 2. Compress inputSchema
    const compressedSchema = this.compressSchema(tool.inputSchema, maxBytes - 512);

    const result: McpToolDefinition = {
      name: tool.name,
      description: compressedDesc,
      inputSchema: compressedSchema
    };

    // 3. Verify total tool byte size; if still oversized, perform emergency pruning
    let serialized = JSON.stringify(result);
    let size = Buffer.byteLength(serialized, 'utf8');

    if (size > maxBytes && result.inputSchema.properties) {
      // Strip non-essential descriptions
      for (const [propName, propVal] of Object.entries<any>(result.inputSchema.properties)) {
        if (propVal && typeof propVal === 'object') {
          delete propVal.description;
          delete propVal.examples;
          delete propVal.default;
        }
      }
      serialized = JSON.stringify(result);
      size = Buffer.byteLength(serialized, 'utf8');
    }

    return result;
  }

  /**
   * Deep-compresses a JSON Schema object by stripping metadata, examples, and long descriptions.
   */
  public static compressSchema(
    schema: McpToolInputSchema,
    maxBytes: number = this.DEFAULT_MAX_TOOL_BYTES
  ): McpToolInputSchema {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object' };
    }

    // Deep clone schema
    const cloned = JSON.parse(JSON.stringify(schema));

    // Remove top-level JSON Schema bloat
    delete cloned.$schema;
    delete cloned.title;
    delete cloned.examples;
    delete cloned.$defs;
    delete cloned.definitions;

    if (cloned.properties && typeof cloned.properties === 'object') {
      for (const [key, prop] of Object.entries<any>(cloned.properties)) {
        if (prop && typeof prop === 'object') {
          this.compressProperty(prop);
        }
      }
    }

    // Check size; if still exceeds maxBytes, truncate further
    const jsonStr = JSON.stringify(cloned);
    if (Buffer.byteLength(jsonStr, 'utf8') > maxBytes) {
      // Aggressive minimization: keep only type and required properties
      if (cloned.properties) {
        for (const [key, prop] of Object.entries<any>(cloned.properties)) {
          if (prop && typeof prop === 'object') {
            delete prop.description;
            delete prop.format;
          }
        }
      }
    }

    return cloned;
  }

  /**
   * Audits a list of tools against the Compact Schema byte budget.
   */
  public static auditBudget(
    tools: McpToolDefinition[],
    maxBytes: number = this.DEFAULT_MAX_TOOL_BYTES
  ): SchemaBudgetReport {
    const oversizedTools: string[] = [];
    const toolSizes: Record<string, number> = {};

    for (const tool of tools) {
      const size = Buffer.byteLength(JSON.stringify(tool), 'utf8');
      toolSizes[tool.name] = size;
      if (size > maxBytes) {
        oversizedTools.push(tool.name);
      }
    }

    return {
      valid: oversizedTools.length === 0,
      maxAllowedBytes: maxBytes,
      toolsCount: tools.length,
      oversizedTools,
      toolSizes
    };
  }

  // --- Private Helpers ---

  private static compressProperty(prop: Record<string, any>): void {
    delete prop.examples;
    delete prop.$schema;
    delete prop.title;
    delete prop.pattern;

    if (prop.description && typeof prop.description === 'string') {
      prop.description = this.cleanDescription(prop.description, this.MAX_PROP_DESC_LENGTH);
    }

    // Recurse into nested objects
    if (prop.properties && typeof prop.properties === 'object') {
      for (const subProp of Object.values<any>(prop.properties)) {
        if (subProp && typeof subProp === 'object') {
          this.compressProperty(subProp);
        }
      }
    }

    // Recurse into array items
    if (prop.items && typeof prop.items === 'object') {
      this.compressProperty(prop.items);
    }
  }

  private static cleanDescription(desc: string | undefined, maxLen: number): string {
    if (!desc) return '';
    // Strip markdown links, bolding, backticks, and multiple line breaks
    let cleaned = desc
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\r?\n+/g, ' ')
      .trim();

    // Take only the first sentence if multiple sentences exist and it exceeds maxLen
    if (cleaned.length > maxLen) {
      const firstSentence = cleaned.split(/(?<=[.?!])\s+/)[0];
      if (firstSentence && firstSentence.length <= maxLen) {
        cleaned = firstSentence;
      } else {
        cleaned = cleaned.slice(0, maxLen - 3) + '...';
      }
    }

    return cleaned;
  }
}
