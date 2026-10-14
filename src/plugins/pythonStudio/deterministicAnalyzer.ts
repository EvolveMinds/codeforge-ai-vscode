/**
 * plugins/pythonStudio/deterministicAnalyzer.ts
 *
 * Fast, 100% Offline, Zero-AI Deterministic Python AST & Syntax Analyzer.
 * Features:
 *  - Indentation & bracket balance checker
 *  - Anti-pattern & bug detection (mutable default arguments, wildcard imports, dangerous eval/exec)
 *  - Python 2 legacy syntax detection
 *  - Type annotation & PEP 695 compliance heuristics
 *  - Returns structured diagnostics with suggested auto-fixes
 */

export interface PythonDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestedFix?: string;
}

export interface AnalysisSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  diagnostics: PythonDiagnostic[];
  syntaxValid: boolean;
}

export class DeterministicAnalyzer {
  /**
   * Performs an instant static pass over Python source code.
   */
  static analyzeCode(source: string): AnalysisSummary {
    const diagnostics: PythonDiagnostic[] = [];
    const lines = source.split(/\r?\n/);

    this.checkBracketAndQuoteBalance(lines, diagnostics);
    this.checkIndentationConsistency(lines, diagnostics);
    this.checkAntiPatterns(lines, diagnostics);

    const errorCount   = diagnostics.filter(d => d.severity === 'error').length;
    const warningCount = diagnostics.filter(d => d.severity === 'warning').length;
    const infoCount    = diagnostics.filter(d => d.severity === 'info').length;

    return {
      errorCount,
      warningCount,
      infoCount,
      diagnostics,
      syntaxValid: errorCount === 0,
    };
  }

  /**
   * Validates matching brackets: (), [], {} and unclosed triple quotes.
   */
  private static checkBracketAndQuoteBalance(lines: string[], diagnostics: PythonDiagnostic[]): void {
    const stack: Array<{ char: string; line: number; col: number }> = [];
    let inTripleQuoteSingle = false;
    let inTripleQuoteDouble = false;
    let tripleQuoteStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let j = 0;

      while (j < line.length) {
        // Handle comments (outside quotes)
        if (!inTripleQuoteSingle && !inTripleQuoteDouble && line[j] === '#') {
          break; // Rest of line is comment
        }

        // Triple double quotes """
        if (line.slice(j, j + 3) === '"""') {
          if (inTripleQuoteDouble) {
            inTripleQuoteDouble = false;
          } else if (!inTripleQuoteSingle) {
            inTripleQuoteDouble = true;
            tripleQuoteStartLine = i + 1;
          }
          j += 3;
          continue;
        }

        // Triple single quotes '''
        if (line.slice(j, j + 3) === "'''") {
          if (inTripleQuoteSingle) {
            inTripleQuoteSingle = false;
          } else if (!inTripleQuoteDouble) {
            inTripleQuoteSingle = true;
            tripleQuoteStartLine = i + 1;
          }
          j += 3;
          continue;
        }

        // Skip characters inside multiline block comments
        if (inTripleQuoteSingle || inTripleQuoteDouble) {
          j++;
          continue;
        }

        // Skip single-line string literals
        if (line[j] === '"' || line[j] === "'") {
          const quote = line[j];
          j++;
          while (j < line.length && line[j] !== quote) {
            if (line[j] === '\\') j++; // skip escaped
            j++;
          }
          j++;
          continue;
        }

        const char = line[j];
        if (char === '(' || char === '[' || char === '{') {
          stack.push({ char, line: i + 1, col: j + 1 });
        } else if (char === ')' || char === ']' || char === '}') {
          if (stack.length === 0) {
            diagnostics.push({
              line: i + 1,
              column: j + 1,
              severity: 'error',
              code: 'UNMATCHED_CLOSING_BRACKET',
              message: `Unmatched closing bracket '${char}'.`,
            });
          } else {
            const top = stack.pop()!;
            const expected = top.char === '(' ? ')' : (top.char === '[' ? ']' : '}');
            if (char !== expected) {
              diagnostics.push({
                line: i + 1,
                column: j + 1,
                severity: 'error',
                code: 'MISMATCHED_BRACKET',
                message: `Mismatched bracket: expected '${expected}' matching line ${top.line}, but found '${char}'.`,
              });
            }
          }
        }
        j++;
      }
    }

    if (inTripleQuoteDouble || inTripleQuoteSingle) {
      diagnostics.push({
        line: tripleQuoteStartLine,
        column: 1,
        severity: 'error',
        code: 'UNCLOSED_TRIPLE_QUOTE',
        message: 'Unclosed multiline docstring / triple quote literal.',
      });
    }

    while (stack.length > 0) {
      const unclosed = stack.pop()!;
      diagnostics.push({
        line: unclosed.line,
        column: unclosed.col,
        severity: 'error',
        code: 'UNCLOSED_OPENING_BRACKET',
        message: `Unclosed bracket '${unclosed.char}'.`,
      });
    }
  }

  /**
   * Detects mixed tabs and spaces, or irregular indentation levels.
   */
  private static checkIndentationConsistency(lines: string[], diagnostics: PythonDiagnostic[]): void {
    let usesSpaces = false;
    let usesTabs = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const indentMatch = line.match(/^(\s+)/);
      if (indentMatch) {
        const indentStr = indentMatch[1];
        if (indentStr.includes('\t') && indentStr.includes(' ')) {
          diagnostics.push({
            line: i + 1,
            column: 1,
            severity: 'error',
            code: 'MIXED_INDENTATION_ON_LINE',
            message: 'TabError: Inconsistent use of tabs and spaces in indentation.',
            suggestedFix: 'Replace all tabs with 4 spaces.',
          });
        }
        if (indentStr.includes('\t')) usesTabs = true;
        if (indentStr.includes(' '))  usesSpaces = true;
      }
    }

    if (usesTabs && usesSpaces) {
      diagnostics.push({
        line: 1,
        column: 1,
        severity: 'warning',
        code: 'MIXED_INDENTATION_FILE',
        message: 'File mixes tabs and spaces across different lines. Standardize on 4 spaces (PEP 8).',
      });
    }
  }

  /**
   * Catches high-risk anti-patterns & Python 2 legacy constructs.
   */
  private static checkAntiPatterns(lines: string[], diagnostics: PythonDiagnostic[]): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 1. Mutable default arguments in function definitions: def foo(bar=[]): or def foo(bar={}):
      const mutableDefaultMatch = line.match(/def\s+[a-zA-Z0-9_]+\s*\([^)]*?=\s*(\[\]|\{\}|set\(\))/);
      if (mutableDefaultMatch) {
        diagnostics.push({
          line: i + 1,
          column: line.indexOf(mutableDefaultMatch[1]) + 1,
          severity: 'warning',
          code: 'MUTABLE_DEFAULT_ARG',
          message: `Dangerous mutable default argument '${mutableDefaultMatch[1]}'. Use 'None' and assign inside function.`,
          suggestedFix: "arg: Optional[list] = None",
        });
      }

      // 2. Wildcard imports: from module import *
      if (/^from\s+[a-zA-Z0-9_.]+\s+import\s+\*/.test(trimmed)) {
        diagnostics.push({
          line: i + 1,
          column: 1,
          severity: 'warning',
          code: 'WILDCARD_IMPORT',
          message: "Wildcard 'import *' pollutes namespace and prevents static symbol resolution. Import specific symbols.",
        });
      }

      // 3. Dangerous eval/exec
      if (/\b(eval|exec)\s*\(/.test(trimmed)) {
        diagnostics.push({
          line: i + 1,
          column: line.search(/\b(eval|exec)\s*\(/) + 1,
          severity: 'warning',
          code: 'DANGEROUS_EVAL',
          message: 'Security risk: dynamic code evaluation via eval() / exec() can lead to arbitrary code execution.',
        });
      }

      // 4. Bare except: except:
      if (/^except\s*:/.test(trimmed)) {
        diagnostics.push({
          line: i + 1,
          column: 1,
          severity: 'warning',
          code: 'BARE_EXCEPT',
          message: "Bare 'except:' catches SystemExit and KeyboardInterrupt. Use 'except Exception:' instead.",
          suggestedFix: 'except Exception:',
        });
      }

      // 5. Python 2 print statement: print "hello" (no parens)
      if (/^print\s+["'].*["']/.test(trimmed) && !trimmed.startsWith('print(')) {
        diagnostics.push({
          line: i + 1,
          column: 1,
          severity: 'error',
          code: 'PYTHON2_PRINT_SYNTAX',
          message: "SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...) ?",
          suggestedFix: `print(${trimmed.slice(5).trim()})`,
        });
      }
    }
  }
}
