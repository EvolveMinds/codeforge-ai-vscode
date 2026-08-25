/**
 * offline/codeModernizer.ts — AST & rule-based deterministic code modernization
 *
 * 100% offline & deterministic. Zero AI dependencies.
 */

export interface ModernizeResult {
  modified: boolean;
  code: string;
  changesSummary: string[];
}

export class CodeModernizer {
  // ── Python Modernizer ───────────────────────────────────────────────────────

  static modernizePython(code: string): ModernizeResult {
    let current = code;
    const changes: string[] = [];

    // 1. Modernize Type Hints (PEP 604 / PEP 585)
    // Union[A, B] -> A | B (handles nested brackets)
    if (current.includes('Union[')) {
      const before = current;
      current = CodeModernizer._replaceBracketConstruct(current, 'Union', inner => {
        const parts = CodeModernizer._splitTopLevel(inner, ',');
        return parts.map(p => p.trim()).join(' | ');
      });
      if (current !== before) {
        changes.push('Modernized Union[...] to pipe syntax | (PEP 604)');
      }
    }

    // List[T] -> list[T], Dict[K, V] -> dict[K, V], Set[T] -> set[T], Tuple[T] -> tuple[T]
    const genericReplacements = [
      { from: /\bList\[/g, to: 'list[', name: 'List' },
      { from: /\bDict\[/g, to: 'dict[', name: 'Dict' },
      { from: /\bSet\[/g, to: 'set[', name: 'Set' },
      { from: /\bTuple\[/g, to: 'tuple[', name: 'Tuple' },
    ];
    for (const r of genericReplacements) {
      if (r.from.test(current)) {
        current = current.replace(r.from, r.to);
        changes.push(`Modernized typing.${r.name} to builtin ${r.name.toLowerCase()} (PEP 585)`);
      }
    }

    // Optional[T] -> T | None (handles nested generics)
    if (current.includes('Optional[')) {
      const before = current;
      current = CodeModernizer._replaceBracketConstruct(current, 'Optional', inner => `${inner.trim()} | None`);
      if (current !== before) {
        changes.push('Modernized Optional[T] to T | None (PEP 604)');
      }
    }

    // 2. os.path to pathlib.Path
    let hasPathlib = current.includes('from pathlib import Path') || current.includes('import pathlib');
    let convertedPathlib = false;

    // os.path.exists(p) -> Path(p).exists()
    if (/os\.path\.exists\(([^)]+)\)/.test(current)) {
      current = current.replace(/os\.path\.exists\(([^)]+)\)/g, 'Path($1).exists()');
      convertedPathlib = true;
      changes.push('Converted os.path.exists() to Path().exists()');
    }

    // os.path.join(a, b) -> Path(a) / b
    if (/os\.path\.join\(([^,]+),\s*([^)]+)\)/.test(current)) {
      current = current.replace(/os\.path\.join\(([^,]+),\s*([^)]+)\)/g, 'Path($1) / $2');
      convertedPathlib = true;
      changes.push('Converted os.path.join() to Path() / slash operator');
    }

    // os.path.basename(p) -> Path(p).name
    if (/os\.path\.basename\(([^)]+)\)/.test(current)) {
      current = current.replace(/os\.path\.basename\(([^)]+)\)/g, 'Path($1).name');
      convertedPathlib = true;
      changes.push('Converted os.path.basename() to Path().name');
    }

    // os.path.dirname(p) -> Path(p).parent
    if (/os\.path\.dirname\(([^)]+)\)/.test(current)) {
      current = current.replace(/os\.path\.dirname\(([^)]+)\)/g, 'Path($1).parent');
      convertedPathlib = true;
      changes.push('Converted os.path.dirname() to Path().parent');
    }

    if (convertedPathlib && !hasPathlib) {
      current = 'from pathlib import Path\n' + current;
    }

    // 3. String formatting to f-strings: "Hello {}".format(name) -> f"Hello {name}"
    const formatSingle = /"([^"{}]*)\{\}"\.format\(([a-zA-Z0-9_]+)\)/g;
    if (formatSingle.test(current)) {
      current = current.replace(formatSingle, 'f"$1{$2}"');
      changes.push('Converted simple .format() to f-string');
    }

    return {
      modified: changes.length > 0,
      code: current,
      changesSummary: changes,
    };
  }

  // ── JavaScript / TypeScript Modernizer ───────────────────────────────────────

  static modernizeJavaScript(code: string): ModernizeResult {
    let current = code;
    const changes: string[] = [];

    // 1. CommonJS require to ESM import
    // const { a, b } = require('pkg'); -> import { a, b } from 'pkg';
    const requireNamed = /(?:const|let|var)\s+\{\s*([^}]+?)\s*\}\s*=\s*require\((['"][^'"]+['"])\);?/g;
    if (requireNamed.test(current)) {
      current = current.replace(requireNamed, (_m, names, mod) => {
        const cleaned = names.split(',').map((n: string) => n.trim()).join(', ');
        return `import { ${cleaned} } from ${mod};`;
      });
      changes.push('Converted CommonJS named require() to ESM named import');
    }

    // const x = require('pkg'); -> import x from 'pkg';
    const requireDefault = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*require\((['"][^'"]+['"])\);?/g;
    if (requireDefault.test(current)) {
      current = current.replace(requireDefault, 'import $1 from $2;');
      changes.push('Converted CommonJS require() to ESM default import');
    }

    // module.exports = { a, b }; -> export { a, b };
    const moduleExportsNamed = /module\.exports\s*=\s*\{\s*([^}]+?)\s*\};?/g;
    if (moduleExportsNamed.test(current)) {
      current = current.replace(moduleExportsNamed, (_m, names) => {
        const cleaned = names.split(',').map((n: string) => n.trim()).join(', ');
        return `export { ${cleaned} };`;
      });
      changes.push('Converted module.exports = { ... } to export { ... }');
    }

    // module.exports = x; -> export default x;
    const moduleExportsSingle = /module\.exports\s*=\s*([a-zA-Z0-9_$]+);?/g;
    if (moduleExportsSingle.test(current)) {
      current = current.replace(moduleExportsSingle, 'export default $1;');
      changes.push('Converted module.exports to export default');
    }

    return {
      modified: changes.length > 0,
      code: current,
      changesSummary: changes,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private static _splitTopLevel(str: string, delimiter: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '[' || c === '(' || c === '{') depth++;
      else if (c === ']' || c === ')' || c === '}') depth--;
      else if (c === delimiter && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += c;
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  private static _replaceBracketConstruct(text: string, prefix: string, transform: (inner: string) => string): string {
    let result = text;
    let idx: number;
    while ((idx = result.indexOf(prefix + '[')) !== -1) {
      let depth = 0;
      let endIdx = -1;
      for (let i = idx + prefix.length; i < result.length; i++) {
        if (result[i] === '[') depth++;
        else if (result[i] === ']') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      if (endIdx === -1) break;
      const inner = result.slice(idx + prefix.length + 1, endIdx);
      const transformed = transform(inner);
      result = result.slice(0, idx) + transformed + result.slice(endIdx + 1);
    }
    return result;
  }
}
