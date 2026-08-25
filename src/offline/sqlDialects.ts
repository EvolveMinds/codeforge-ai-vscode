/**
 * offline/sqlDialects.ts — Multi-dialect SQL definitions & keywords
 */

export type SqlDialect =
  | 'ansi'
  | 'databricks'
  | 'snowflake'
  | 'bigquery'
  | 'postgres'
  | 'mysql'
  | 'tsql'
  | 'duckdb'
  | 'sqlite';

export interface DialectConfig {
  name: SqlDialect;
  displayName: string;
  quoteChar: string; // Identifier quote (e.g. ` or ")
  stringQuoteChar: string;
  namedKeywords: string[];
  clauseKeywords: string[];
  blockKeywords: string[];
}

export const COMMON_CLAUSE_KEYWORDS = [
  'WITH',
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'QUALIFY',
  'WINDOW',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'UNION',
  'UNION ALL',
  'EXCEPT',
  'INTERSECT',
  'MINUS',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'MERGE INTO',
  'CREATE TABLE',
  'CREATE OR REPLACE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'TRUNCATE TABLE',
];

export const COMMON_JOIN_KEYWORDS = [
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'LEFT OUTER JOIN',
  'RIGHT JOIN',
  'RIGHT OUTER JOIN',
  'FULL JOIN',
  'FULL OUTER JOIN',
  'CROSS JOIN',
  'SEMI JOIN',
  'ANTI JOIN',
  'NATURAL JOIN',
  'LATERAL VIEW',
];

export const SQL_KEYWORDS_BASE = [
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE', 'RLIKE', 'REGEXP',
  'BETWEEN', 'EXISTS', 'AS', 'ON', 'USING', 'DISTINCT', 'ALL',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'CAST', 'TRY_CAST', 'COALESCE', 'NULLIF', 'NVL', 'IFNULL',
  'OVER', 'PARTITION BY', 'ROWS BETWEEN', 'RANGE BETWEEN',
  'PRECEDING', 'FOLLOWING', 'UNBOUNDED', 'CURRENT ROW',
  'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST',
  'TRUE', 'FALSE', 'BOOLEAN', 'INT', 'INTEGER', 'BIGINT', 'FLOAT', 'DOUBLE',
  'VARCHAR', 'STRING', 'TEXT', 'DATE', 'TIMESTAMP', 'ARRAY', 'MAP', 'STRUCT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROW_NUMBER', 'RANK', 'DENSE_RANK',
  'LEAD', 'LAG', 'FIRST_VALUE', 'LAST_VALUE', 'NTILE',
];

export const DIALECT_KEYWORDS: Record<SqlDialect, string[]> = {
  ansi: SQL_KEYWORDS_BASE,
  databricks: [
    ...SQL_KEYWORDS_BASE,
    'OPTIMIZE', 'ZORDER BY', 'VACUUM', 'CLUSTER BY', 'DELTA', 'DELETION VECTORS',
    'COLLECT_LIST', 'COLLECT_SET', 'FLATTEN', 'EXPLODE', 'POSEXPLODE', 'ARRAY_CONTAINS',
    'MAP_FROM_ENTRIES', 'STRUCT', 'NAMED_STRUCT', 'FROM_JSON', 'TO_JSON', 'SCHEMA_OF_JSON',
  ],
  snowflake: [
    ...SQL_KEYWORDS_BASE,
    'CLUSTER BY', 'STAGE', 'COPY INTO', 'FLATTEN', 'PARSE_JSON', 'TRY_PARSE_JSON',
    'OBJECT_CONSTRUCT', 'ARRAY_CONSTRUCT', 'ARRAY_AGG', 'ZEROIFNULL', 'IFF',
    'QUALIFY', 'MATCH_RECOGNIZE', 'SAMPLE', 'TABLESAMPLE', 'TIME_TRAVEL',
  ],
  bigquery: [
    ...SQL_KEYWORDS_BASE,
    'PARTITION BY', 'CLUSTER BY', 'OPTIONS', 'SAFE_CAST', 'SAFE_DIVIDE',
    'ARRAY_AGG', 'STRING_AGG', 'ARRAY_LENGTH', 'GENERATE_ARRAY',
    'UNNEST', 'STRUCT', 'JSON_EXTRACT', 'JSON_EXTRACT_SCALAR', 'JSON_QUERY', 'JSON_VALUE',
    'TIMESTAMP_TRUNC', 'DATE_TRUNC', 'DATETIME_TRUNC',
  ],
  postgres: [
    ...SQL_KEYWORDS_BASE,
    'RETURNING', 'ON CONFLICT', 'DO NOTHING', 'DO UPDATE', 'ILIKE', 'SIMILAR TO',
    'FILTER', 'JSONB_AGG', 'TO_JSONB', 'JSONB_EXTRACT_PATH', 'STRING_AGG',
    'GENERATE_SERIES', 'ARRAY_AGG', 'UNNEST',
  ],
  mysql: [
    ...SQL_KEYWORDS_BASE,
    'AUTO_INCREMENT', 'IFNULL', 'GROUP_CONCAT', 'JSON_OBJECT', 'JSON_ARRAY',
    'JSON_EXTRACT', 'USE INDEX', 'FORCE INDEX', 'IGNORE INDEX',
  ],
  tsql: [
    ...SQL_KEYWORDS_BASE,
    'TOP', 'CROSS APPLY', 'OUTER APPLY', 'OUTPUT', 'INTO', 'IDENTITY',
    'ISNULL', 'STRING_SPLIT', 'STRING_AGG', 'FOR JSON', 'FOR XML',
  ],
  duckdb: [
    ...SQL_KEYWORDS_BASE,
    'READ_CSV', 'READ_PARQUET', 'READ_JSON', 'COPY', 'INSTALL', 'LOAD',
    'SUMMARIZE', 'DESCRIBE', 'PIVOT', 'UNPIVOT', 'COLUMNS', 'EXCLUDE', 'REPLACE',
  ],
  sqlite: [
    ...SQL_KEYWORDS_BASE,
    'AUTOINCREMENT', 'GLOB', 'PRAGMA', 'INDEXED BY', 'NOT INDEXED',
  ],
};

export function getDialectConfig(dialect: SqlDialect): DialectConfig {
  const quoteChar = (dialect === 'bigquery' || dialect === 'databricks' || dialect === 'mysql') ? '`' : '"';
  return {
    name: dialect,
    displayName: dialect.charAt(0).toUpperCase() + dialect.slice(1),
    quoteChar,
    stringQuoteChar: "'",
    namedKeywords: DIALECT_KEYWORDS[dialect] || SQL_KEYWORDS_BASE,
    clauseKeywords: COMMON_CLAUSE_KEYWORDS,
    blockKeywords: ['CASE', 'WITH', 'BEGIN', 'END'],
  };
}
