/**
 * offline/sqlFormatter.ts — Multi-dialect rule-based SQL formatter
 *
 * 100% deterministic and offline. Zero AI dependencies.
 * Respects Jinja tags (dbt), multi-dialect quotes, CTEs, subqueries, and CASE blocks.
 */

import { SqlDialect, getDialectConfig } from './sqlDialects';

export interface SqlFormatOptions {
  dialect?: SqlDialect;
  tabWidth?: number;
  useTabs?: boolean;
  keywordCase?: 'upper' | 'lower' | 'preserve';
  commaStyle?: 'trailing' | 'leading';
  linesBetweenQueries?: number;
}

const DEFAULT_OPTIONS: Required<SqlFormatOptions> = {
  dialect: 'ansi',
  tabWidth: 2,
  useTabs: false,
  keywordCase: 'upper',
  commaStyle: 'trailing',
  linesBetweenQueries: 1,
};

enum TokenType {
  WHITESPACE,
  WORD,
  NUMBER,
  STRING,
  IDENTIFIER_QUOTED,
  LINE_COMMENT,
  BLOCK_COMMENT,
  JINJA,
  SYMBOL,
  OPERATOR,
}

interface Token {
  type: TokenType;
  value: string;
  isClauseKeyword?: boolean;
  isJoinKeyword?: boolean;
  isBlockStart?: boolean;
  isBlockEnd?: boolean;
}

export class SqlFormatter {
  static format(sql: string, options: SqlFormatOptions = {}): string {
    const opts: Required<SqlFormatOptions> = { ...DEFAULT_OPTIONS, ...options };
    const formatter = new SqlFormatter(opts);
    return formatter.formatSql(sql);
  }

  private readonly _opts: Required<SqlFormatOptions>;
  private readonly _indentStr: string;
  private readonly _allKeywords: Set<string>;
  private readonly _clauseKeywords: Set<string>;
  private readonly _joinKeywords: Set<string>;

  constructor(opts: Required<SqlFormatOptions>) {
    this._opts = opts;
    this._indentStr = opts.useTabs ? '\t' : ' '.repeat(opts.tabWidth);

    const dialectCfg = getDialectConfig(opts.dialect);
    this._allKeywords = new Set([
      ...dialectCfg.namedKeywords.map(k => k.toUpperCase()),
      ...dialectCfg.clauseKeywords.map(k => k.toUpperCase()),
    ]);
    this._clauseKeywords = new Set(dialectCfg.clauseKeywords.map(k => k.toUpperCase()));
    this._joinKeywords = new Set([
      'JOIN', 'INNER JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN',
      'RIGHT JOIN', 'RIGHT OUTER JOIN', 'FULL JOIN', 'FULL OUTER JOIN',
      'CROSS JOIN', 'SEMI JOIN', 'ANTI JOIN', 'NATURAL JOIN', 'LATERAL VIEW'
    ]);
  }

  formatSql(sql: string): string {
    if (!sql || !sql.trim()) return sql;

    const rawTokens = this._tokenize(sql);
    if (rawTokens.length === 0) return '';

    // Merge multi-word keywords (e.g. GROUP BY, ORDER BY, LEFT JOIN, UNION ALL, CREATE TABLE)
    const tokens = this._mergeMultiWordKeywords(rawTokens);

    let result = '';
    let indentLevel = 0;
    let inCaseBlock = 0;
    let parenStack: number[] = [];
    let isStartOfLine = true;
    let prevToken: Token | null = null;

    const appendIndent = (level: number) => {
      result += this._indentStr.repeat(Math.max(0, level));
    };

    const appendNewline = () => {
      // Trim any trailing spaces on previous line
      result = result.replace(/[ \t]+$/, '');
      result += '\n';
      isStartOfLine = true;
    };

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const nextToken: Token | null = tokens[i + 1] || null;

      // Handle Comments
      if (token.type === TokenType.LINE_COMMENT) {
        if (!isStartOfLine) result += ' ';
        result += token.value;
        appendNewline();
        continue;
      }
      if (token.type === TokenType.BLOCK_COMMENT) {
        if (!isStartOfLine) result += ' ';
        result += token.value;
        continue;
      }

      // Handle Semicolon (End of statement)
      if (token.value === ';') {
        result = result.replace(/[ \t]+$/, '');
        result += ';';
        appendNewline();
        if (this._opts.linesBetweenQueries > 1) {
          result += '\n'.repeat(this._opts.linesBetweenQueries - 1);
        }
        indentLevel = 0;
        inCaseBlock = 0;
        parenStack = [];
        prevToken = token;
        continue;
      }

      // Handle Parentheses
      if (token.value === '(') {
        // Check if this parenthesis starts a subquery (e.g. following SELECT, FROM, AS, IN)
        const isSubquery = nextToken && (
          nextToken.value.toUpperCase() === 'SELECT' ||
          nextToken.value.toUpperCase() === 'WITH'
        );

        if (prevToken && ['AS', 'IN', 'VALUES', 'AND', 'OR', 'NOT', 'WITH', 'BY'].includes(prevToken.value.toUpperCase())) {
          if (!result.endsWith(' ') && !result.endsWith('\n')) {
            result += ' ';
          }
        }

        result += '(';
        if (isSubquery) {
          indentLevel++;
          parenStack.push(indentLevel);
          appendNewline();
          appendIndent(indentLevel);
        } else {
          parenStack.push(-1); // inline paren
        }
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      if (token.value === ')') {
        const matchingIndent = parenStack.pop();
        if (matchingIndent && matchingIndent > 0) {
          indentLevel = Math.max(0, indentLevel - 1);
          appendNewline();
          appendIndent(indentLevel);
          result += ')';
        } else {
          result = result.replace(/[ \t]+$/, '');
          result += ')';
        }
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      // Handle Clause Keywords (SELECT, FROM, WHERE, GROUP BY, ORDER BY, etc.)
      const upperVal = token.value.toUpperCase();
      if (this._clauseKeywords.has(upperVal)) {
        if (!isStartOfLine) {
          appendNewline();
        }
        appendIndent(indentLevel);
        result += this._casedKeyword(token.value);
        isStartOfLine = false;

        // Sub-indent contents under SELECT / WHERE / GROUP BY unless immediately followed by newline
        if (upperVal === 'SELECT') {
          // If followed by DISTINCT or ALL
          if (nextToken && (nextToken.value.toUpperCase() === 'DISTINCT' || nextToken.value.toUpperCase() === 'ALL')) {
            result += ' ' + this._casedKeyword(nextToken.value);
            i++; // skip nextToken
          }
        }
        prevToken = token;
        continue;
      }

      // Handle JOIN keywords
      if (this._joinKeywords.has(upperVal)) {
        if (!isStartOfLine) {
          appendNewline();
        }
        appendIndent(indentLevel);
        result += this._casedKeyword(token.value);
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      // Handle AND / OR in WHERE / ON clauses
      if (upperVal === 'AND' || upperVal === 'OR') {
        if (!isStartOfLine) {
          appendNewline();
        }
        appendIndent(indentLevel + 1);
        result += this._casedKeyword(token.value) + ' ';
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      // Handle CASE statements
      if (upperVal === 'CASE') {
        inCaseBlock++;
        if (isStartOfLine) appendIndent(indentLevel);
        result += this._casedKeyword(token.value);
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      if (upperVal === 'WHEN' || upperVal === 'ELSE') {
        if (!isStartOfLine) appendNewline();
        appendIndent(indentLevel + inCaseBlock);
        result += this._casedKeyword(token.value) + ' ';
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      if (upperVal === 'THEN') {
        result += ' ' + this._casedKeyword(token.value) + ' ';
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      if (upperVal === 'END') {
        if (inCaseBlock > 0) inCaseBlock--;
        if (!isStartOfLine) appendNewline();
        appendIndent(indentLevel + inCaseBlock);
        result += this._casedKeyword(token.value);
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      // Handle Commas
      if (token.value === ',') {
        result = result.replace(/[ \t]+$/, '');
        if (this._opts.commaStyle === 'trailing') {
          result += ',';
          appendNewline();
          appendIndent(indentLevel + 1);
        } else {
          appendNewline();
          appendIndent(indentLevel + 1);
          result += ', ';
        }
        isStartOfLine = false;
        prevToken = token;
        continue;
      }

      // General Words, Keywords, Literals
      let formattedVal = token.value;
      if (token.type === TokenType.WORD && this._allKeywords.has(upperVal)) {
        formattedVal = this._casedKeyword(token.value);
      }

      if (isStartOfLine) {
        appendIndent(indentLevel + 1);
        result += formattedVal;
        isStartOfLine = false;
      } else {
        // Decide spacing
        const needsSpaceBefore = this._needsSpaceBetween(prevToken, token);
        if (needsSpaceBefore) {
          result += ' ';
        }
        result += formattedVal;
      }

      prevToken = token;
    }

    return result.trimEnd();
  }

  private _casedKeyword(kw: string): string {
    switch (this._opts.keywordCase) {
      case 'upper': return kw.toUpperCase();
      case 'lower': return kw.toLowerCase();
      default: return kw;
    }
  }

  private _needsSpaceBetween(prev: Token | null, curr: Token): boolean {
    if (!prev) return false;
    if (prev.value === '(' || curr.value === ')') return false;
    if (curr.value === ',' || curr.value === ';' || curr.value === '.') return false;
    if (prev.value === '.' || (prev.value === ',' && this._opts.commaStyle === 'leading')) return false;
    if (prev.value === '[' || curr.value === ']') return false;
    if (prev.value === '::' || curr.value === '::') return false; // Postgres cast
    return true;
  }

  private _mergeMultiWordKeywords(tokens: Token[]): Token[] {
    const merged: Token[] = [];
    let i = 0;

    while (i < tokens.length) {
      const t1 = tokens[i];
      const t2 = tokens[i + 1];
      const t3 = tokens[i + 2];

      if (t1 && t2 && t1.type === TokenType.WORD && t2.type === TokenType.WORD) {
        // 3-word checks (e.g. CREATE OR REPLACE, LEFT OUTER JOIN, RIGHT OUTER JOIN, FULL OUTER JOIN)
        if (t3 && t3.type === TokenType.WORD) {
          const tri = `${t1.value} ${t2.value} ${t3.value}`.toUpperCase();
          if (
            tri === 'CREATE OR REPLACE' ||
            tri === 'LEFT OUTER JOIN' ||
            tri === 'RIGHT OUTER JOIN' ||
            tri === 'FULL OUTER JOIN'
          ) {
            merged.push({ type: TokenType.WORD, value: `${t1.value} ${t2.value} ${t3.value}` });
            i += 3;
            continue;
          }
        }

        // 2-word checks (e.g. GROUP BY, ORDER BY, UNION ALL, INSERT INTO, DELETE FROM, MERGE INTO, CROSS JOIN, INNER JOIN, LEFT JOIN, RIGHT JOIN, FULL JOIN, PARTITION BY, CLUSTER BY)
        const bi = `${t1.value} ${t2.value}`.toUpperCase();
        if (
          bi === 'GROUP BY' ||
          bi === 'ORDER BY' ||
          bi === 'PARTITION BY' ||
          bi === 'CLUSTER BY' ||
          bi === 'UNION ALL' ||
          bi === 'INSERT INTO' ||
          bi === 'DELETE FROM' ||
          bi === 'MERGE INTO' ||
          bi === 'CREATE TABLE' ||
          bi === 'ALTER TABLE' ||
          bi === 'DROP TABLE' ||
          bi === 'TRUNCATE TABLE' ||
          bi === 'INNER JOIN' ||
          bi === 'LEFT JOIN' ||
          bi === 'RIGHT JOIN' ||
          bi === 'FULL JOIN' ||
          bi === 'CROSS JOIN' ||
          bi === 'SEMI JOIN' ||
          bi === 'ANTI JOIN' ||
          bi === 'NATURAL JOIN' ||
          bi === 'LATERAL VIEW' ||
          bi === 'NOT IN' ||
          bi === 'IS NOT' ||
          bi === 'IS NULL' ||
          bi === 'IS NOT NULL' ||
          bi === 'PRIMARY KEY' ||
          bi === 'FOREIGN KEY'
        ) {
          merged.push({ type: TokenType.WORD, value: `${t1.value} ${t2.value}` });
          i += 2;
          continue;
        }
      }

      merged.push(t1);
      i++;
    }

    return merged;
  }

  private _tokenize(sql: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = sql.length;

    while (i < len) {
      const char = sql[i];

      // Whitespace
      if (/\s/.test(char)) {
        i++;
        continue;
      }

      // Line Comment (-- or #)
      if (
        (char === '-' && sql[i + 1] === '-') ||
        (char === '#' && this._opts.dialect === 'mysql')
      ) {
        let start = i;
        while (i < len && sql[i] !== '\n') i++;
        tokens.push({ type: TokenType.LINE_COMMENT, value: sql.slice(start, i) });
        continue;
      }

      // Block Comment (/* ... */)
      if (char === '/' && sql[i + 1] === '*') {
        let start = i;
        i += 2;
        while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
        if (i < len) i += 2;
        tokens.push({ type: TokenType.BLOCK_COMMENT, value: sql.slice(start, i) });
        continue;
      }

      // Jinja Expression ({{ ... }}, {% ... %}, {# ... #})
      if (char === '{' && (sql[i + 1] === '{' || sql[i + 1] === '%' || sql[i + 1] === '#')) {
        const closeChar = sql[i + 1];
        let start = i;
        i += 2;
        while (i < len && !(sql[i] === closeChar && sql[i + 1] === '}')) i++;
        if (i < len) i += 2;
        tokens.push({ type: TokenType.JINJA, value: sql.slice(start, i) });
        continue;
      }

      // Quoted Strings ('...')
      if (char === "'") {
        let start = i;
        i++;
        while (i < len) {
          if (sql[i] === "'") {
            if (sql[i + 1] === "'") {
              i += 2; // escaped quote
            } else {
              i++;
              break;
            }
          } else if (sql[i] === '\\') {
            i += 2; // backslash escape
          } else {
            i++;
          }
        }
        tokens.push({ type: TokenType.STRING, value: sql.slice(start, i) });
        continue;
      }

      // Quoted Identifiers (`...`, "...", [...])
      if (char === '`' || (char === '"' && this._opts.dialect !== 'mysql') || char === '[') {
        const closer = char === '[' ? ']' : char;
        let start = i;
        i++;
        while (i < len && sql[i] !== closer) {
          if (sql[i] === '\\') i += 2;
          else i++;
        }
        if (i < len) i++;
        tokens.push({ type: TokenType.IDENTIFIER_QUOTED, value: sql.slice(start, i) });
        continue;
      }

      // Numbers
      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
        let start = i;
        while (i < len && /[0-9a-zA-Z._]/.test(sql[i])) i++;
        tokens.push({ type: TokenType.NUMBER, value: sql.slice(start, i) });
        continue;
      }

      // Operators and Symbols
      if (
        char === ',' || char === ';' || char === '(' || char === ')' ||
        char === '[' || char === ']' || char === '{' || char === '}'
      ) {
        tokens.push({ type: TokenType.SYMBOL, value: char });
        i++;
        continue;
      }

      // Multi-char operators (::, !=, <>, <=, >=, ==, ||)
      const twoChar = sql.slice(i, i + 2);
      if (['::', '!=', '<>', '<=', '>=', '==', '||', '->', '=>'].includes(twoChar)) {
        tokens.push({ type: TokenType.OPERATOR, value: twoChar });
        i += 2;
        continue;
      }

      if (['=', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '~', '!'].includes(char)) {
        tokens.push({ type: TokenType.OPERATOR, value: char });
        i++;
        continue;
      }

      // Words (Identifiers, Column names, Unquoted Keywords)
      if (/[a-zA-Z0-9_]/.test(char) || char === '$') {
        let start = i;
        while (i < len && /[a-zA-Z0-9_$.]/.test(sql[i])) {
          // If we hit a dot, check if it separates identifiers (e.g. table.col)
          if (sql[i] === '.' && !/[a-zA-Z0-9_]/.test(sql[i + 1] || '')) {
            break;
          }
          i++;
        }
        const val = sql.slice(start, i);
        tokens.push({ type: TokenType.WORD, value: val });
        continue;
      }

      // Fallback: individual char
      tokens.push({ type: TokenType.SYMBOL, value: char });
      i++;
    }

    return tokens;
  }
}
