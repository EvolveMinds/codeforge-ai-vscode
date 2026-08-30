/**
 * fde/aiEngine.ts — Intelligent AI Copilot Layer for FDE Delivery Studio
 *
 * Provides domain-agnostic, semantic AI assistance for:
 *   1. Staging Schema Auto-Cleaning, Type Normalization & PII Detection
 *   2. Cross-Model Mart Recipe Discovery & Foreign-Key Relationship Mapping
 *   3. Natural Language / Prompt-to-Mart Dimensional Modeling
 */

export interface StagingAiAnalysisResult {
  targetColumnsText: string;
  targetModelName: string;
  targetOutputPath: string;
  piiDetected: Array<{ column: string; category: string; recommendedTransform: string }>;
  suggestedTransformations: Array<{ column: string; targetColumn: string; rule: string }>;
  summary: string;
}

export interface MartAiRecipe {
  id: string;
  title: string;
  description: string;
  baseModel: string;
  joinModel: string;
  joinType: 'LEFT' | 'INNER' | 'FULL';
  joinCondition: string;
  dimensions: string[];
  metrics: Array<{ name: string; expression: string }>;
  martName: string;
  outputPath: string;
  badge: string;
}

export interface IntrospectedTableSummary {
  tableName: string;
  schema?: string;
  columns: Array<{ name: string; type?: string }>;
}

export class FdeAiEngine {
  private static readonly PII_PATTERNS: Array<{ regex: RegExp; category: string; rule: string }> = [
    { regex: /email/i, category: 'Email Address', rule: 'LOWER(TRIM({{col}}))' },
    { regex: /phone|mobile|cell|fax/i, category: 'Phone Number', rule: "REGEXP_REPLACE({{col}}, '[^0-9+]', '')" },
    { regex: /ssn|social_security|tax_id|tin/i, category: 'National ID / SSN', rule: 'SHA256({{col}})' },
    { regex: /ip_address|ip_addr|client_ip/i, category: 'IP Address', rule: 'MASK({{col}})' },
    { regex: /credit_card|card_num|cc_num|pan/i, category: 'PCI / Credit Card', rule: "CONCAT('***', RIGHT({{col}}, 4))" },
    { regex: /password|pwd|secret|token/i, category: 'Credential / Secret', rule: 'EXCLUDE_OR_REDACT' },
    { regex: /first_name|last_name|full_name|fname|lname|patient_name/i, category: 'Individual Name', rule: 'TRIM({{col}})' },
    { regex: /dob|birth_date|date_of_birth/i, category: 'Date of Birth', rule: 'TRY_CAST({{col}} AS DATE)' },
    { regex: /street_addr|postal_code|zip_code|address/i, category: 'Physical Address', rule: 'TRIM({{col}})' },
  ];

  /**
   * Intelligently analyzes, cleans, and standardizes raw source columns into a canonical staging model schema.
   */
  static analyzeAndCleanStagingSchema(
    rawColsText: string,
    tableName: string,
    options: { enablePiiMasking?: boolean; customInstruction?: string } = {}
  ): StagingAiAnalysisResult {
    const rawLines = rawColsText.split('\n').map(l => l.trim()).filter(Boolean);
    const cleanedCols: Array<{ name: string; type: string }> = [];
    const piiDetected: StagingAiAnalysisResult['piiDetected'] = [];
    const suggestedTransformations: StagingAiAnalysisResult['suggestedTransformations'] = [];

    const cleanTableBase = tableName.replace(/^public\.|^client_|_raw$|^raw_/g, '').trim() || 'data';
    const targetModelName = 'stg_' + cleanTableBase;
    const targetOutputPath = `models/staging/${targetModelName}.sql`;

    for (const line of rawLines) {
      const parts = line.split(':');
      let rawName = parts[0].trim();
      let rawType = parts[1] ? parts[1].trim() : 'string';

      // Canonical snake_case conversion
      let cleanName = rawName
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase()
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

      if (!cleanName) cleanName = 'col_' + Math.random().toString(36).substring(2, 6);

      // Normalize SQL type
      let cleanType = this.normalizeType(rawType, cleanName);

      // Check PII
      let matchedPii = null;
      for (const p of this.PII_PATTERNS) {
        if (p.regex.test(cleanName)) {
          matchedPii = { category: p.category, rule: p.rule.replace('{{col}}', rawName) };
          break;
        }
      }

      if (matchedPii) {
        piiDetected.push({
          column: cleanName,
          category: matchedPii.category,
          recommendedTransform: matchedPii.rule,
        });

        if (options.enablePiiMasking) {
          if (/email/i.test(cleanName)) {
            cleanName = 'hashed_' + cleanName;
            suggestedTransformations.push({
              column: rawName,
              targetColumn: cleanName,
              rule: `SHA256(LOWER(TRIM(${rawName}))) AS ${cleanName}`,
            });
          } else if (/ssn|tax_id|card/i.test(cleanName)) {
            cleanName = 'masked_' + cleanName;
            suggestedTransformations.push({
              column: rawName,
              targetColumn: cleanName,
              rule: `CONCAT('***', RIGHT(${rawName}, 4)) AS ${cleanName}`,
            });
          }
        }
      }

      // Apply custom instruction heuristics
      if (options.customInstruction) {
        const instr = options.customInstruction.toLowerCase();
        if (instr.includes('prefix') && instr.includes('ts_') && cleanType === 'timestamp') {
          if (!cleanName.startsWith('ts_')) cleanName = 'ts_' + cleanName;
        }
        if (instr.includes('aud') && /amt|amount|price|fare|revenue/i.test(cleanName)) {
          if (!cleanName.includes('aud')) cleanName = cleanName + '_aud';
        }
      }

      cleanedCols.push({ name: cleanName, type: cleanType });
    }

    const targetColumnsText = cleanedCols.map(c => `${c.name}:${c.type}`).join('\n');
    const piiSummary = piiDetected.length > 0
      ? ` Found ${piiDetected.length} sensitive fields (${piiDetected.map(p => p.column).join(', ')}).`
      : ' No sensitive PII detected.';

    return {
      targetColumnsText,
      targetModelName,
      targetOutputPath,
      piiDetected,
      suggestedTransformations,
      summary: `✨ AI Standardized ${cleanedCols.length} columns for '${tableName}'.${piiSummary}`,
    };
  }

  /**
   * Intelligently discovers multi-table graph join relationships and recommends domain-aware Data Mart recipes.
   */
  static discoverMartRecipes(
    baseModelName: string,
    allTables: IntrospectedTableSummary[]
  ): MartAiRecipe[] {
    const recipes: MartAiRecipe[] = [];
    if (!baseModelName || allTables.length === 0) return recipes;

    const cleanBaseName = baseModelName.replace(/^stg_|^public\.|^client_|_raw$/g, '');
    const baseTable = allTables.find(t => 
      t.tableName === baseModelName || 
      t.tableName === cleanBaseName || 
      t.tableName.replace(/^public\./, '') === baseModelName
    );

    const baseCols = baseTable ? baseTable.columns : [];

    // Identify foreign-key candidate companion tables
    const candidateJoins: Array<{
      table: IntrospectedTableSummary;
      condition: string;
      joinCol: string;
      baseCol: string;
      score: number;
    }> = [];

    for (const tbl of allTables) {
      if (tbl.tableName === baseModelName || tbl.tableName === cleanBaseName) continue;
      const targetAlias = tbl.tableName.replace(/^stg_|^public\.|^client_|_raw$/g, '').replace(/s$/, '');

      // Check foreign key matches (e.g. user_id -> id or users.user_id)
      for (const bCol of baseCols) {
        const bName = bCol.name.toLowerCase();
        for (const jCol of tbl.columns) {
          const jName = jCol.name.toLowerCase();

          // 1. Direct fk naming (e.g. base has user_id, target table is users with id)
          if ((bName === `${targetAlias}_id` || bName === `${targetAlias}_uuid` || bName === `${targetAlias}_key`) && 
              (jName === 'id' || jName === 'uuid' || jName === `${targetAlias}_id`)) {
            candidateJoins.push({
              table: tbl,
              condition: `${cleanBaseName}.${bCol.name} = ${targetAlias}.${jCol.name}`,
              joinCol: jCol.name,
              baseCol: bCol.name,
              score: 10,
            });
            break;
          }

          // 2. Exact match on non-generic id (e.g. account_id in both)
          if (bName === jName && (bName.endsWith('_id') || bName.endsWith('_key')) && bName !== 'id') {
            candidateJoins.push({
              table: tbl,
              condition: `${cleanBaseName}.${bCol.name} = ${targetAlias}.${jCol.name}`,
              joinCol: jCol.name,
              baseCol: bCol.name,
              score: 8,
            });
            break;
          }
        }
      }
    }

    // Sort by join score
    candidateJoins.sort((a, b) => b.score - a.score);

    // 1. If companion join tables found, build Relational Mart Recipes
    for (const match of candidateJoins.slice(0, 3)) {
      const joinTbl = match.table;
      const cleanJoinName = joinTbl.tableName.replace(/^public\./, '');
      const joinAlias = cleanJoinName.replace(/^stg_|_raw$/g, '').replace(/s$/, '');

      // Select dimensions from base and join table
      const dims: string[] = [];
      const baseStatusCol = baseCols.find(c => /status|state|type|category|reason|role/i.test(c.name));
      const baseTimeCol = baseCols.find(c => /created|requested|occurred|date|ts|at/i.test(c.name));
      const joinAttrCol = joinTbl.columns.find(c => /email|name|tier|plan|category|country|city/i.test(c.name));

      if (baseStatusCol) dims.push(`${cleanBaseName}.${baseStatusCol.name}`);
      if (baseTimeCol) dims.push(`${cleanBaseName}.${baseTimeCol.name}`);
      if (joinAttrCol) dims.push(`${joinAlias}.${joinAttrCol.name}`);
      if (dims.length === 0) dims.push(`${cleanBaseName}.${match.baseCol}`);

      // Select metrics
      const metrics: Array<{ name: string; expression: string }> = [];
      const idCol = baseCols.find(c => /id$|uuid$/i.test(c.name)) || baseCols[0];
      if (idCol) {
        metrics.push({
          name: `total_${cleanBaseName}`,
          expression: `count(distinct ${cleanBaseName}.${idCol.name})`,
        });
      }

      const numCols = baseCols.filter(c => /amt|amount|price|fare|revenue|cost|qty|balance|days|duration/i.test(c.name));
      for (const num of numCols.slice(0, 2)) {
        metrics.push({
          name: `total_${num.name.replace(/_amt|_amount/g, '')}`,
          expression: `sum(${cleanBaseName}.${num.name})`,
        });
        metrics.push({
          name: `avg_${num.name.replace(/_amt|_amount/g, '')}`,
          expression: `avg(${cleanBaseName}.${num.name})`,
        });
      }

      if (metrics.length === 1) {
        metrics.push({
          name: `unique_${joinAlias}s`,
          expression: `count(distinct ${cleanBaseName}.${match.baseCol})`,
        });
      }

      const martName = `fct_${cleanBaseName}_by_${joinAlias}`;
      recipes.push({
        id: `recipe_${cleanBaseName}_${joinAlias}`,
        title: `⚡ ${this.toTitleCase(cleanBaseName)} & ${this.toTitleCase(joinAlias)} Fact Mart`,
        description: `Joins ${baseModelName} with ${cleanJoinName} to aggregate volume and key performance metrics.`,
        baseModel: baseModelName,
        joinModel: cleanJoinName,
        joinType: 'LEFT',
        joinCondition: match.condition,
        dimensions: dims,
        metrics: metrics,
        martName: martName,
        outputPath: `models/marts/${martName}.sql`,
        badge: `Suggested Join (${Math.round(match.score * 10)}% match)`,
      });
    }

    // 2. Always generate a Periodic Time-Series / Snapshot Mart Recipe for the base model
    const timeCol = baseCols.find(c => /created|date|ts|at|timestamp|period/i.test(c.name));
    const statusCol = baseCols.find(c => /status|state|type|category|code/i.test(c.name));
    const idCol = baseCols.find(c => /id$|uuid$/i.test(c.name)) || baseCols[0];

    const snapshotDims: string[] = [];
    if (timeCol) snapshotDims.push(`${cleanBaseName}.${timeCol.name}`);
    if (statusCol) snapshotDims.push(`${cleanBaseName}.${statusCol.name}`);
    if (snapshotDims.length === 0 && baseCols.length > 0) snapshotDims.push(`${cleanBaseName}.${baseCols[0].name}`);

    const snapshotMetrics: Array<{ name: string; expression: string }> = [
      { name: `total_records`, expression: `count(${cleanBaseName}.${idCol ? idCol.name : '*'})` }
    ];

    const numCols = baseCols.filter(c => /amt|amount|price|fare|revenue|cost|qty|balance/i.test(c.name));
    for (const num of numCols.slice(0, 2)) {
      snapshotMetrics.push({
        name: `total_${num.name}`,
        expression: `sum(${cleanBaseName}.${num.name})`,
      });
    }

    const snapshotMartName = `fct_${cleanBaseName}_daily_summary`;
    recipes.push({
      id: `recipe_${cleanBaseName}_snapshot`,
      title: `📈 ${this.toTitleCase(cleanBaseName)} Daily Summary Fact`,
      description: `Time-series aggregation tracking ${cleanBaseName} activity volume and trends over time.`,
      baseModel: baseModelName,
      joinModel: candidateJoins[0] ? candidateJoins[0].table.tableName.replace(/^public\./, '') : baseModelName,
      joinType: 'LEFT',
      joinCondition: candidateJoins[0] ? candidateJoins[0].condition : `${cleanBaseName}.id = ${cleanBaseName}.id`,
      dimensions: snapshotDims,
      metrics: snapshotMetrics,
      martName: snapshotMartName,
      outputPath: `models/marts/${snapshotMartName}.sql`,
      badge: 'Time-Series Fact',
    });

    return recipes;
  }

  /**
   * Generates a complete Data Mart configuration directly from natural language developer prompt.
   */
  static generateMartFromNaturalLanguage(
    prompt: string,
    allTables: IntrospectedTableSummary[]
  ): MartAiRecipe | null {
    if (!prompt.trim() || allTables.length === 0) return null;
    const lowerPrompt = prompt.toLowerCase();

    // 1. Identify primary base table mentioned or closest matching
    let selectedBase = allTables[0];
    let highestBaseScore = -1;

    for (const tbl of allTables) {
      const cleanName = tbl.tableName.replace(/^public\.|^stg_|_raw$/g, '').toLowerCase();
      let score = 0;
      if (lowerPrompt.includes(cleanName)) score += 10;
      if (lowerPrompt.includes(cleanName.replace(/s$/, ''))) score += 8;

      // Domain keywords for transactional tables (orders, sales, transactions, invoices, trips)
      if ((lowerPrompt.includes('sales') || lowerPrompt.includes('revenue')) && /order|sale|invoice|txn|payment|transact/i.test(cleanName)) {
        score += 15;
      }
      if ((lowerPrompt.includes('churn') || lowerPrompt.includes('deletion') || lowerPrompt.includes('cancellation')) && /deletion|cancel|churn|account/i.test(cleanName)) {
        score += 15;
      }

      // Check column overlap
      for (const col of tbl.columns) {
        if (lowerPrompt.includes(col.name.toLowerCase())) score += 2;
      }

      if (score > highestBaseScore) {
        highestBaseScore = score;
        selectedBase = tbl;
      }
    }

    // 2. Discover best recipes for this base table
    const recipes = this.discoverMartRecipes(selectedBase.tableName.replace(/^public\./, ''), allTables);
    if (recipes.length === 0) return null;

    // 3. Customize recipe based on prompt keywords
    const recipe = recipes[0];
    if (lowerPrompt.includes('churn') || lowerPrompt.includes('cancellation') || lowerPrompt.includes('retention')) {
      recipe.title = '✨ AI Generated: Customer Retention & Activity Mart';
      recipe.martName = 'dim_customer_retention_summary';
      recipe.outputPath = `models/marts/${recipe.martName}.sql`;
    } else if (lowerPrompt.includes('revenue') || lowerPrompt.includes('sales') || lowerPrompt.includes('financial')) {
      recipe.title = '✨ AI Generated: Financial Revenue KPI Mart';
      recipe.martName = 'fct_revenue_performance';
      recipe.outputPath = `models/marts/${recipe.martName}.sql`;
    }

    return recipe;
  }

  private static normalizeType(rawType: string, colName: string): string {
    const t = (rawType || '').toLowerCase();
    const c = (colName || '').toLowerCase();

    if (/bool|boolean|tinyint\(1\)/i.test(t) || /(^is_|^has_|_flag$|_flg$)/i.test(c)) {
      return 'boolean';
    }
    if (/int|bigint|smallint|tinyint|numeric|decimal|float|double|real|money|number/i.test(t)) {
      return 'numeric';
    }
    if (/timestamp|datetime|timestamptz/i.test(t)) {
      return 'timestamp';
    }
    if (/date/i.test(t)) {
      return 'date';
    }
    if (/json|jsonb|variant|struct|array|map/i.test(t)) {
      return 'json';
    }

    // Heuristic inference from column name
    if (/(_at$|_date$|_time$|_ts$|timestamp)/i.test(c)) return 'timestamp';
    if (/(_amount$|_amt$|_price$|_cost$|_fare$|_balance$|_qty$|_count$)/i.test(c)) return 'numeric';

    return 'string';
  }

  private static toTitleCase(str: string): string {
    return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
