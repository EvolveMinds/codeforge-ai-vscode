/**
 * core/codeConvert.ts — the code-conversion engine
 *
 * Naive "convert this to Go" produces code that looks right and is wrong: the
 * error handling quietly disappears, a library call is replaced by a plausible
 * function that doesn't exist, and nothing tells you which parts you still have
 * to check. This module exists so conversion is not a single hopeful prompt.
 *
 * It owns four things, and they are owned HERE — not in a prompt string
 * somewhere, and not in the model's discretion:
 *
 *  1. THE LANGUAGE CATALOGUE — for every language we convert to, the real
 *     facts: file extension, naming convention, package manifest, test
 *     framework, the syntax checker on the user's machine, and the idioms +
 *     pitfalls that separate native-looking code from transliterated code.
 *     This is the domain knowledge that makes the output idiomatic.
 *
 *  2. THE OUTPUT CONTRACT — the model returns files as fenced blocks carrying
 *     their path, followed by ONE json block: the conversion report. The parser
 *     below is deliberately tolerant, because models drift.
 *
 *  3. THE FIDELITY REPORT — every conversion states what was mapped 1:1, what
 *     was approximated, what was dropped, and what a human must do. A
 *     conversion you cannot audit is not a conversion you can ship.
 *
 *  4. THE PROMPTS — conversion, repair (feed a failing syntax check back), and
 *     refinement ("make it use channels instead of a mutex").
 *
 * Nothing in here imports vscode, so it stays unit-testable.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type NamingStyle = 'snake' | 'camel' | 'pascal' | 'kebab' | 'keep';

/** How literally to follow the source. */
export type Fidelity = 'idiomatic' | 'literal' | 'modernise';

/** How free the conversion is with third-party packages. */
export type DependencyPolicy = 'stdlib' | 'popular' | 'mirror';

/**
 * A check we can run locally on ONE file, when the toolchain happens to be
 * installed. Only tools whose exit code means "this file is broken" belong
 * here — a formatter that fails on unformatted-but-valid code (rustfmt
 * --check, black --check) would report false failures on every conversion and
 * is deliberately excluded.
 */
export interface SyntaxCheck {
  /** Executable, spawned with shell:false. */
  cmd: string;
  /** Argument builder. `file` is an absolute path; `dir` a scratch output dir. */
  args: (file: string, dir: string) => string[];
  /** What the user needs installed, in plain words. */
  needs: string;
  /**
   * 'syntax'  — parses the file alone; a failure is always a real defect.
   * 'compile' — also resolves imports/headers, so a failure may just mean the
   *             dependency isn't installed here. The UI says so rather than
   *             blaming the conversion.
   */
  verifies: 'syntax' | 'compile';
  /** True when the check writes artefacts and needs a scratch output dir. */
  writesOutput?: boolean;
}

export interface LanguageSpec {
  id: string;
  label: string;
  /** Grouping used by the target picker. */
  group: 'Popular' | 'Systems' | 'JVM' | 'Web' | 'Data & Science' | 'Scripting' | 'Legacy';
  /** Primary output extension, with the dot. */
  ext: string;
  /** Extra extensions that identify this language as a SOURCE. */
  altExts?: string[];
  /** VS Code language id — drives syntax highlighting in the review panel. */
  vsLang: string;
  /** Markdown fence tag the model should use. */
  fence: string;
  /** File-naming convention for generated files. */
  naming: NamingStyle;
  /** Dependency manifest the conversion may need to create. */
  manifest?: string;
  /** Idiomatic test framework, named so generated tests are runnable. */
  testFramework?: string;
  /** Local syntax check, when one exists that works on a single file. */
  check?: SyntaxCheck;
  /**
   * What makes code in this language look native rather than transliterated.
   * Injected into the prompt verbatim — this is the quality lever.
   */
  idioms: string[];
  /** Traps that produce confident, broken conversions. */
  pitfalls?: string[];
}

/** One converted file, before it touches disk. */
export interface ConvertedFile {
  /** Path relative to the conversion output root. */
  relPath: string;
  content: string;
  /** Source file this came from, when attributable. */
  fromRelPath?: string;
  /** Fence language tag the model used. */
  lang: string;
}

export type NoteSeverity = 'info' | 'warn' | 'action';

export interface ConversionNote {
  severity: NoteSeverity;
  title: string;
  detail: string;
  /** e.g. "orders.py:42" */
  sourceRef?: string;
  /** e.g. "orders.go:31" */
  targetRef?: string;
}

export interface DependencyMapping {
  source: string;
  target: string;
  status: 'mapped' | 'approximated' | 'none' | 'builtin';
  note?: string;
}

export interface ConversionReport {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  dependencies: DependencyMapping[];
  notes: ConversionNote[];
  manualSteps: string[];
  /** Commands to install deps / build / run, in the target ecosystem. */
  setup: string[];
}

export interface ConversionSpec {
  /** Target language id from LANGUAGES. */
  target: string;
  /** Source language id, best-effort. Empty when unknown. */
  source: string;
  fidelity: Fidelity;
  dependencies: DependencyPolicy;
  /** Also produce tests for the converted code. */
  includeTests: boolean;
  /** Carry comments/docstrings across (translated, not copied verbatim). */
  keepComments: boolean;
  /** Emit the package manifest (go.mod, package.json, …) for the batch. */
  emitManifest: boolean;
  /** Free-text extra requirements from the user. */
  notes: string;
  /** Target framework/runtime, when the user named one (e.g. "FastAPI", ".NET 8"). */
  framework: string;
}

/** A source file handed to the converter. */
export interface SourceFile {
  /** Absolute path — used for display and for re-reading. */
  absPath: string;
  /** Path relative to the conversion root; drives the output layout. */
  relPath: string;
  content: string;
  /** Detected source language id. */
  langId: string;
}

/** The full result of one conversion round. */
export interface ConversionResult {
  files: ConvertedFile[];
  report: ConversionReport;
  /** Raw model output, kept for "show me what it actually said". */
  raw: string;
}

// ── The language catalogue ───────────────────────────────────────────────────
//
// Order matters: the target picker shows this order, so the languages people
// actually convert to come first.

export const LANGUAGES: LanguageSpec[] = [
  {
    id: 'python', label: 'Python', group: 'Popular',
    ext: '.py', altExts: ['.pyw'], vsLang: 'python', fence: 'python', naming: 'snake',
    manifest: 'requirements.txt', testFramework: 'pytest',
    check: { cmd: 'python', args: (f) => ['-m', 'py_compile', f], needs: 'Python on PATH', verifies: 'syntax' },
    idioms: [
      'Use snake_case for functions and variables, PascalCase for classes, UPPER_SNAKE for constants.',
      'Prefer comprehensions, generators, and unpacking over manual index loops.',
      'Use context managers (`with`) for anything that must be closed or released.',
      'Raise specific exceptions; do not return error codes. Let exceptions propagate unless you can handle them.',
      'Add type hints on public functions (PEP 484) and use `dataclasses` for plain data.',
      'Use f-strings for interpolation, `pathlib.Path` for paths, `logging` rather than print for diagnostics.',
    ],
    pitfalls: [
      'Do not translate `switch` into a chain of `elif` when `match` (3.10+) or a dict lookup is clearer.',
      'Integer division is `//`; `/` always produces a float. Getting this wrong silently changes results.',
      'Default arguments are evaluated once — never use a mutable default.',
    ],
  },
  {
    id: 'typescript', label: 'TypeScript', group: 'Popular',
    ext: '.ts', altExts: ['.tsx', '.mts', '.cts'], vsLang: 'typescript', fence: 'typescript', naming: 'keep',
    manifest: 'package.json', testFramework: 'vitest',
    check: { cmd: 'npx', args: (f) => ['--no-install', 'tsc', '--noEmit', '--skipLibCheck', '--allowJs', f], needs: 'TypeScript installed in the project (npx tsc)', verifies: 'compile' },
    idioms: [
      'camelCase for values, PascalCase for types/classes. One exported concept per module.',
      'Type the public surface precisely; prefer `unknown` over `any` and narrow with type guards.',
      'Use discriminated unions instead of optional-field grab-bags, and `readonly` for data that should not mutate.',
      'async/await over raw Promise chains; never leave a Promise unawaited without an explicit `void`.',
      'Prefer `const` + arrow functions in modules; use classes when there is real per-instance state.',
    ],
    pitfalls: [
      'Do not convert dynamic-language duck typing into `any` — model the shape as an interface.',
      '`==` coerces; use `===` unless a null-check on `== null` is intended.',
      'Numbers are IEEE-754 doubles: source code using 64-bit integers needs `bigint` or a documented note.',
    ],
  },
  {
    id: 'javascript', label: 'JavaScript', group: 'Popular',
    ext: '.js', altExts: ['.jsx', '.mjs', '.cjs'], vsLang: 'javascript', fence: 'javascript', naming: 'keep',
    manifest: 'package.json', testFramework: 'vitest',
    check: { cmd: 'node', args: (f) => ['--check', f], needs: 'Node.js on PATH', verifies: 'syntax' },
    idioms: [
      'Modern ES modules (`import`/`export`), `const`/`let`, arrow functions, destructuring.',
      'async/await with try/catch; use `Promise.all` for independent work.',
      'Use optional chaining and nullish coalescing rather than defensive `&&` chains.',
      'JSDoc the public functions so editors still give type help.',
    ],
    pitfalls: [
      'Numbers are doubles — flag any 64-bit integer arithmetic from the source.',
      '`this` binding differs from most source languages; prefer closures over method extraction.',
    ],
  },
  {
    id: 'java', label: 'Java', group: 'JVM',
    ext: '.java', vsLang: 'java', fence: 'java', naming: 'pascal',
    manifest: 'pom.xml', testFramework: 'JUnit 5',
    check: { cmd: 'javac', args: (f, d) => ['-nowarn', '-d', d, f], needs: 'JDK (javac) on PATH', verifies: 'compile', writesOutput: true },
    idioms: [
      'One public type per file, file named after the type. Package declaration at the top.',
      'Prefer records for immutable data, sealed interfaces for closed hierarchies, enums for fixed sets.',
      'Use the Streams API for transformations, `Optional` for absent values — never return null from a public API.',
      'try-with-resources for anything closeable; specific checked/unchecked exceptions, never bare `Exception`.',
      'Constructor injection over field mutation; make fields `final` where possible.',
    ],
    pitfalls: [
      'A dynamic-language dict is not always a `Map` — if the keys are fixed, it is a record or a class.',
      'Integer overflow is silent; source using arbitrary-precision integers needs `BigInteger`.',
      'Checked exceptions must be declared or wrapped — do not swallow them to make it compile.',
    ],
  },
  {
    id: 'csharp', label: 'C#', group: 'JVM',
    ext: '.cs', vsLang: 'csharp', fence: 'csharp', naming: 'pascal',
    manifest: '.csproj', testFramework: 'xUnit',
    idioms: [
      'PascalCase for types/methods/properties, camelCase for locals, `_camelCase` for private fields.',
      'File-scoped namespaces, nullable reference types enabled, `record` for immutable data.',
      'LINQ for transformations, `IEnumerable<T>` for lazy sequences, `async Task` all the way down.',
      'Use `using` declarations for disposables and pass `CancellationToken` through async APIs.',
      'Prefer pattern matching and switch expressions over if/else ladders.',
    ],
    pitfalls: [
      'Do not use `async void` outside event handlers.',
      'Struct vs class matters — value semantics change behaviour silently.',
    ],
  },
  {
    id: 'go', label: 'Go', group: 'Systems',
    ext: '.go', vsLang: 'go', fence: 'go', naming: 'snake',
    manifest: 'go.mod', testFramework: 'testing (stdlib)',
    check: { cmd: 'gofmt', args: (f) => ['-e', f], needs: 'Go toolchain (gofmt) on PATH', verifies: 'syntax' },
    idioms: [
      'Errors are values: return `(T, error)` and wrap with `fmt.Errorf("...: %w", err)`. There are no exceptions.',
      'Check every error at the call site. `panic` is for programmer error only, never for control flow.',
      'Small interfaces defined by the consumer; accept interfaces, return concrete types.',
      'Pass `context.Context` as the first parameter for anything cancellable or I/O-bound.',
      'Concurrency via goroutines + channels; guard shared state with a mutex only when a channel is unnatural.',
      'Exported identifiers are PascalCase, unexported camelCase — visibility is the naming.',
    ],
    pitfalls: [
      'Translating try/except into `panic`/`recover` is wrong — convert it to explicit error returns.',
      'There are no default arguments, no overloading, no generics-by-default: use option structs or explicit variants.',
      'Slices share backing arrays — copying semantics differ from most source languages.',
      'A goroutine started without a way to stop it is a leak; wire cancellation in.',
    ],
  },
  {
    id: 'rust', label: 'Rust', group: 'Systems',
    ext: '.rs', vsLang: 'rust', fence: 'rust', naming: 'snake',
    manifest: 'Cargo.toml', testFramework: '#[cfg(test)] mod tests',
    // No single-file check: `rustfmt --check` fails on valid-but-unformatted
    // code, and `rustc` on one file needs the whole crate to resolve. Neither
    // exit code means "this conversion is broken", so we report nothing rather
    // than cry wolf. `cargo check` on the saved output is the real answer.
    idioms: [
      'Model absence with `Option<T>` and failure with `Result<T, E>`; propagate with `?`.',
      'Define a crate error enum (or use `thiserror`) instead of stringly-typed errors.',
      'Borrow by default (`&T`, `&mut T`); clone deliberately and say why. Take ownership only when you keep it.',
      'Iterators and combinators over index loops; `impl Trait` for return types where it reads better.',
      'Derive `Debug`, `Clone`, `PartialEq` on data types; use `#[derive(Serialize, Deserialize)]` when serialising.',
    ],
    pitfalls: [
      'Do not reach for `unwrap()` to make it compile — that is a hidden panic. Use `?` or handle the case.',
      'Shared mutable state from the source usually becomes `Arc<Mutex<T>>` — call that out, do not hide it.',
      'Do not use `unsafe`. If the source relied on pointer tricks, state it as a manual step instead.',
      'Lifetimes: prefer owned types in struct fields over borrowed ones when converting.',
    ],
  },
  {
    id: 'cpp', label: 'C++', group: 'Systems',
    ext: '.cpp', altExts: ['.cc', '.cxx', '.hpp', '.hh'], vsLang: 'cpp', fence: 'cpp', naming: 'snake',
    manifest: 'CMakeLists.txt', testFramework: 'GoogleTest',
    check: { cmd: 'g++', args: (f) => ['-fsyntax-only', '-std=c++17', f], needs: 'g++ on PATH', verifies: 'compile' },
    idioms: [
      'Modern C++17: RAII everywhere, `std::unique_ptr`/`std::shared_ptr`, no raw `new`/`delete`.',
      '`const` correctness, references over pointers, `auto` where the type is obvious.',
      'Use the STL containers and algorithms rather than hand-rolled loops.',
      'Throw exceptions derived from `std::exception`, or return `std::optional`/`std::expected` for expected failure.',
    ],
    pitfalls: [
      'Never return a reference or pointer to a local.',
      'Copy vs move matters for performance and correctness — be explicit.',
    ],
  },
  {
    id: 'c', label: 'C', group: 'Systems',
    ext: '.c', altExts: ['.h'], vsLang: 'c', fence: 'c', naming: 'snake',
    manifest: 'Makefile',
    check: { cmd: 'gcc', args: (f) => ['-fsyntax-only', '-std=c11', f], needs: 'gcc on PATH', verifies: 'compile' },
    idioms: [
      'C11. Every allocation has one owner and one matching free; document who frees what.',
      'Return `int` status codes and use out-parameters for results; check every return.',
      'Bound every buffer operation — `snprintf` over `sprintf`, explicit sizes everywhere.',
      'Keep headers minimal: declarations in `.h`, definitions in `.c`.',
    ],
    pitfalls: [
      'There is no string type, no bounds checking, no exceptions — dynamic-language conveniences must become explicit code.',
      'Do not silently drop error handling that the source performed.',
    ],
  },
  {
    id: 'kotlin', label: 'Kotlin', group: 'JVM',
    ext: '.kt', vsLang: 'kotlin', fence: 'kotlin', naming: 'pascal',
    manifest: 'build.gradle.kts', testFramework: 'kotlin.test',
    idioms: [
      'Null safety is the point: use `?`, `?:`, and `?.let`; avoid `!!`.',
      'Data classes for values, sealed classes for closed hierarchies, extension functions instead of util classes.',
      'Coroutines (`suspend`) for async work; structured concurrency with `coroutineScope`.',
      'Prefer immutable `val` and read-only collection types.',
    ],
    pitfalls: ['`!!` is a crash waiting to happen — model the nullability properly.'],
  },
  {
    id: 'swift', label: 'Swift', group: 'Systems',
    ext: '.swift', vsLang: 'swift', fence: 'swift', naming: 'pascal',
    manifest: 'Package.swift', testFramework: 'XCTest',
    check: { cmd: 'swiftc', args: (f) => ['-parse', f], needs: 'Swift toolchain on PATH', verifies: 'syntax' },
    idioms: [
      'Optionals for absence, `throws`/`try` for failure, `Result` at async boundaries.',
      'Structs and value semantics by default; classes only for identity/reference needs.',
      'Protocol-oriented design with extensions; `guard` for early exit.',
      'async/await with actors for shared mutable state.',
    ],
    pitfalls: ['Force-unwrapping (`!`) hides crashes — bind with `if let`/`guard let`.'],
  },
  {
    id: 'scala', label: 'Scala', group: 'JVM',
    ext: '.scala', vsLang: 'scala', fence: 'scala', naming: 'pascal',
    manifest: 'build.sbt', testFramework: 'ScalaTest',
    idioms: [
      'Immutability by default: `val`, case classes, persistent collections.',
      'Model failure with `Either`/`Try`, absence with `Option` — no nulls.',
      'Pattern matching over conditionals; for-comprehensions over nested flatMaps.',
    ],
  },
  {
    id: 'ruby', label: 'Ruby', group: 'Scripting',
    ext: '.rb', vsLang: 'ruby', fence: 'ruby', naming: 'snake',
    manifest: 'Gemfile', testFramework: 'RSpec',
    check: { cmd: 'ruby', args: (f) => ['-c', f], needs: 'Ruby on PATH', verifies: 'syntax' },
    idioms: [
      'snake_case methods, `?`/`!` suffixes for predicates and mutators, modules for mixins.',
      'Blocks and Enumerable (`map`, `select`, `each_with_object`) instead of index loops.',
      'Raise specific `StandardError` subclasses; `ensure` for cleanup.',
      'Keyword arguments for anything with more than two parameters.',
    ],
  },
  {
    id: 'php', label: 'PHP', group: 'Web',
    ext: '.php', vsLang: 'php', fence: 'php', naming: 'pascal',
    manifest: 'composer.json', testFramework: 'PHPUnit',
    check: { cmd: 'php', args: (f) => ['-l', f], needs: 'PHP CLI on PATH', verifies: 'syntax' },
    idioms: [
      'PHP 8: `declare(strict_types=1)`, typed properties, constructor promotion, enums, named arguments.',
      'PSR-12 formatting, PSR-4 autoloading, one class per file.',
      'Throw `Throwable` subclasses; never return `false` to signal failure in new code.',
      'Use the null-safe operator and match expressions.',
    ],
  },
  {
    id: 'dart', label: 'Dart', group: 'Web',
    ext: '.dart', vsLang: 'dart', fence: 'dart', naming: 'snake',
    manifest: 'pubspec.yaml', testFramework: 'package:test',
    check: { cmd: 'dart', args: (f) => ['analyze', f], needs: 'Dart SDK on PATH', verifies: 'compile' },
    idioms: [
      'Sound null safety: no `!` unless the invariant is proven right there.',
      '`final` by default, named constructors, `sealed`/`switch` expressions for closed unions.',
      'Futures and streams with async/await.',
    ],
  },
  {
    id: 'elixir', label: 'Elixir', group: 'Scripting',
    ext: '.ex', altExts: ['.exs'], vsLang: 'elixir', fence: 'elixir', naming: 'snake',
    manifest: 'mix.exs', testFramework: 'ExUnit',
    idioms: [
      'Pure functions and pattern matching in function heads; pipelines with `|>`.',
      '`{:ok, value}` / `{:error, reason}` tuples, `with` for happy-path chains.',
      'Let it crash: supervise processes instead of defensive try/rescue.',
      'Immutable data — every "mutation" returns a new value.',
    ],
    pitfalls: ['There are no loops and no mutable state — imperative source must become recursion or Enum/Stream.'],
  },
  {
    id: 'r', label: 'R', group: 'Data & Science',
    ext: '.R', altExts: ['.r'], vsLang: 'r', fence: 'r', naming: 'snake',
    testFramework: 'testthat',
    check: { cmd: 'Rscript', args: (f) => ['-e', `invisible(parse("${f.replace(/\\/g, '/')}"))`], needs: 'R (Rscript) on PATH', verifies: 'syntax' },
    idioms: [
      'Vectorised operations over loops; `apply`/`purrr::map` family where a loop is unavoidable.',
      'tidyverse (`dplyr`, `tidyr`, `ggplot2`) for data work unless base R is explicitly wanted.',
      'Functions return their last expression; use `<-` for assignment.',
    ],
    pitfalls: ['R indexes from 1 and recycles vectors silently — off-by-one and length mismatches are the classic conversion bug.'],
  },
  {
    id: 'sql', label: 'SQL', group: 'Data & Science',
    ext: '.sql', vsLang: 'sql', fence: 'sql', naming: 'snake',
    idioms: [
      'CTEs over nested subqueries; one clear step per CTE with a descriptive name.',
      'Explicit column lists, explicit JOIN types and conditions — never a comma join, never `SELECT *` in shipped code.',
      'Window functions instead of self-joins for ranking and running totals.',
      'State the dialect assumption in a leading comment when a function is dialect-specific.',
    ],
    pitfalls: ['Procedural source (loops, mutable accumulators) must become set-based logic, not a cursor.'],
  },
  {
    id: 'bash', label: 'Bash', group: 'Scripting',
    ext: '.sh', vsLang: 'shellscript', fence: 'bash', naming: 'kebab',
    check: { cmd: 'bash', args: (f) => ['-n', f], needs: 'Bash on PATH', verifies: 'syntax' },
    idioms: [
      '`#!/usr/bin/env bash` and `set -euo pipefail` at the top of every script.',
      'Quote every expansion ("$var", "${arr[@]}"); use `[[ ]]` for tests.',
      'Local variables inside functions; `trap` for cleanup; check command availability before use.',
    ],
    pitfalls: ['Unquoted variables split on whitespace — this is the single most common conversion bug.'],
  },
  {
    id: 'powershell', label: 'PowerShell', group: 'Scripting',
    ext: '.ps1', altExts: ['.psm1'], vsLang: 'powershell', fence: 'powershell', naming: 'pascal',
    idioms: [
      'Verb-Noun cmdlet naming from the approved verb list; `[CmdletBinding()]` with typed parameters.',
      'Emit objects to the pipeline rather than formatted strings; use `Write-Output`, not `Write-Host`, for data.',
      'Use `$ErrorActionPreference = "Stop"` plus try/catch for real error handling.',
    ],
    pitfalls: ['The pipeline passes objects, not text — do not port `grep`/`awk` chains literally.'],
  },
  {
    id: 'lua', label: 'Lua', group: 'Scripting',
    ext: '.lua', vsLang: 'lua', fence: 'lua', naming: 'snake',
    check: { cmd: 'luac', args: (f) => ['-p', f], needs: 'Lua compiler (luac) on PATH', verifies: 'syntax' },
    idioms: [
      'Tables are the only data structure — model records, arrays and objects with them.',
      '`local` everything; return a table as the module interface.',
      '`pcall` for protected calls instead of exceptions.',
    ],
    pitfalls: ['Lua arrays are 1-indexed and `#t` stops at the first nil.'],
  },
  {
    id: 'perl', label: 'Perl', group: 'Legacy',
    ext: '.pl', altExts: ['.pm'], vsLang: 'perl', fence: 'perl', naming: 'snake',
    check: { cmd: 'perl', args: (f) => ['-c', f], needs: 'Perl on PATH', verifies: 'compile' },
    idioms: [
      '`use strict; use warnings;` at the top, always.',
      'Lexical `my` variables, references for nested data, `die`/`eval` for error handling.',
    ],
  },
  {
    id: 'vba', label: 'VBA', group: 'Legacy',
    ext: '.bas', altExts: ['.cls', '.vb'], vsLang: 'vb', fence: 'vb', naming: 'pascal',
    idioms: [
      '`Option Explicit` at the top; declare every variable with an explicit type.',
      '`On Error GoTo` handlers with a cleanup label — never `On Error Resume Next` in new code.',
      'Work with typed objects and arrays; avoid `Variant` unless the API forces it.',
    ],
  },
  {
    id: 'cobol', label: 'COBOL', group: 'Legacy',
    ext: '.cbl', altExts: ['.cob', '.cpy'], vsLang: 'cobol', fence: 'cobol', naming: 'kebab',
    idioms: [
      'Standard four divisions; PIC clauses sized to the real data.',
      'Paragraph-per-step structure with PERFORM; no fall-through logic.',
    ],
  },
  {
    id: 'matlab', label: 'MATLAB', group: 'Data & Science',
    ext: '.m', vsLang: 'matlab', fence: 'matlab', naming: 'snake',
    idioms: [
      'Vectorised array operations; preallocate before loops.',
      'One function per file, file named after the function.',
    ],
    pitfalls: ['1-based indexing and column-major order — index translation is where conversions break.'],
  },
  {
    id: 'sas', label: 'SAS', group: 'Legacy',
    ext: '.sas', vsLang: 'sas', fence: 'sas', naming: 'snake',
    idioms: [
      'DATA steps for row logic, PROC SQL for set logic; keep them separate and named.',
      'Use LIBNAME references rather than hard-coded paths.',
    ],
  },
];

const BY_ID = new Map(LANGUAGES.map(l => [l.id, l]));

export function languageById(id: string): LanguageSpec | undefined {
  return BY_ID.get(id);
}

/** The fence tag → language id mapping the parser uses. */
const FENCE_ALIASES: Record<string, string> = {
  py: 'python', python3: 'python',
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', node: 'javascript',
  'c#': 'csharp', cs: 'csharp',
  'c++': 'cpp', cxx: 'cpp', cc: 'cpp',
  golang: 'go', rs: 'rust', rb: 'ruby', kt: 'kotlin',
  sh: 'bash', shell: 'shellscript', zsh: 'bash',
  ps1: 'powershell', pwsh: 'powershell',
  vb: 'vba', vbnet: 'vba',
  plsql: 'sql', tsql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql',
};

/** Detect the source language from a path and/or a VS Code language id. */
export function detectSourceLanguage(filePath: string, vsLangId?: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext) {
    for (const l of LANGUAGES) {
      if (l.ext.toLowerCase() === ext) return l.id;
      if (l.altExts?.some(e => e.toLowerCase() === ext)) return l.id;
    }
  }
  if (vsLangId) {
    const direct = LANGUAGES.find(l => l.vsLang === vsLangId);
    if (direct) return direct.id;
    const alias = FENCE_ALIASES[vsLangId.toLowerCase()];
    if (alias) return alias;
  }
  return '';
}

/** Human label for a language id, falling back to the id itself. */
export function languageLabel(id: string): string {
  return BY_ID.get(id)?.label ?? (id || 'unknown');
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export function defaultSpec(partial?: Partial<ConversionSpec>): ConversionSpec {
  return {
    target:       '',
    source:       '',
    fidelity:     'idiomatic',
    dependencies: 'popular',
    includeTests: false,
    keepComments: true,
    emitManifest: true,
    notes:        '',
    framework:    '',
    ...partial,
  };
}

export const FIDELITY_CHOICES: Array<{ id: Fidelity; label: string; description: string }> = [
  {
    id: 'idiomatic', label: 'Idiomatic',
    description: 'Rewrite so it reads like native code in the target language. Same behaviour, target-language structure.',
  },
  {
    id: 'literal', label: 'Line-by-line',
    description: 'Keep the original structure and names so you can diff it against the source. Easiest to audit, least native.',
  },
  {
    id: 'modernise', label: 'Idiomatic + modernise',
    description: 'Idiomatic, plus upgrade dated patterns — async where it belongs, real types, current stdlib APIs.',
  },
];

export const DEPENDENCY_CHOICES: Array<{ id: DependencyPolicy; label: string; description: string }> = [
  {
    id: 'stdlib', label: 'Standard library only',
    description: 'No third-party packages. More code, nothing to install, nothing to audit.',
  },
  {
    id: 'popular', label: 'Well-known packages',
    description: 'Use the packages a working developer in that ecosystem would reach for. Every one is listed in the report.',
  },
  {
    id: 'mirror', label: 'Closest equivalent to each source library',
    description: 'Map each source dependency to its nearest counterpart, one for one. Best when the source leans on libraries.',
  },
];

// ── The output contract ──────────────────────────────────────────────────────
//
// One place, one format. The parser below is the only thing that reads it, and
// the prompt below is the only thing that describes it — keep them in step.

const OUTPUT_CONTRACT = `## Output format — follow exactly

For EACH converted file, emit one fenced code block whose info string carries the output path:

\`\`\`<fence> path=<relative/output/path>
<the complete file contents>
\`\`\`

Rules for the code blocks:
- Emit the COMPLETE file. Never abbreviate, never write "... rest unchanged ...", never leave a body as a TODO unless the report records it as an action item.
- Paths are relative to the output root, use forward slashes, and follow the target language's layout conventions.
- Splitting one source file into several target files is fine and often correct (one public class per file, header/implementation pairs, a package layout). Emit each as its own block.

After ALL code blocks, emit exactly ONE final block, tagged json, containing the conversion report:

\`\`\`json
{
  "summary": "two or three sentences: what this code does and what changed structurally in the conversion",
  "confidence": "high | medium | low",
  "dependencies": [
    { "source": "requests", "target": "net/http", "status": "mapped | approximated | none | builtin", "note": "why, and what differs" }
  ],
  "notes": [
    { "severity": "info | warn | action",
      "title": "short claim",
      "detail": "what was done and what a reviewer should check",
      "sourceRef": "source_file.py:42",
      "targetRef": "target_file.go:31" }
  ],
  "manualSteps": ["things the human must do that code cannot do"],
  "setup": ["shell commands to install dependencies and run the result"]
}
\`\`\`

The report is not a formality — it is how the reader decides whether to trust the code:
- severity "action" = this WILL be wrong or incomplete until a human intervenes.
- severity "warn"   = semantics differ subtly (numeric precision, ordering, concurrency, error behaviour, timezone handling).
- severity "info"   = a deliberate structural choice worth knowing about.
Report every approximation you made. An honest "low" confidence with three action items is worth more than a confident wrong answer. If something in the source has no sound equivalent, convert what you can, mark the gap with a clearly-labelled TODO comment in the code, AND record it as an "action" note.`;

// ── System prompt ────────────────────────────────────────────────────────────

export const CONVERT_SYSTEM =
  'You are a senior engineer who is fluent in both the source and the target language and who has ported ' +
  'production systems between them. You are translating real code that has to keep working.\n\n' +
  'Non-negotiables:\n' +
  '1. BEHAVIOUR IS PRESERVED. Same inputs produce the same outputs, including edge cases, error paths, ' +
  'numeric precision, ordering, and null/empty handling. When the target language cannot reproduce a ' +
  "behaviour exactly, reproduce it as closely as the language allows and say so in the report.\n" +
  '2. NOTHING IS SILENTLY DROPPED. Error handling, validation, logging, retries, transactions, and ' +
  'concurrency control all survive the trip or are reported as gaps.\n' +
  '3. NO INVENTED APIs. Only use functions, packages and signatures that genuinely exist in the target ' +
  "ecosystem. If you are not certain a library API exists, use the standard library and say why.\n" +
  '4. THE RESULT COMPILES. Imports/includes complete, names consistent across files, types line up. ' +
  'Read your own output back before finishing.\n' +
  '5. IDIOMATIC, NOT TRANSLITERATED. Use the target language\'s own constructs. A reader should not be ' +
  'able to tell which language it came from.\n\n' +
  'You do not chat. You return the converted files and the conversion report, in the specified format, and nothing else.';

// ── Prompt builders ──────────────────────────────────────────────────────────

function fidelityBrief(f: Fidelity): string {
  switch (f) {
    case 'literal':
      return 'FIDELITY: line-by-line. Preserve the original structure, ordering, and names (adjusted only for the ' +
        'target naming convention) so the result can be diffed against the source. Do not merge, split, or reorder ' +
        'functions. Prefer a clumsy-but-traceable construct over an elegant one that moves code around.';
    case 'modernise':
      return 'FIDELITY: idiomatic, and modernise while you are there. Keep the behaviour, but replace dated patterns ' +
        'with current ones — real types instead of stringly-typed data, async where the work is I/O-bound, current ' +
        'stdlib APIs instead of deprecated ones, structured errors instead of error codes. Record every modernisation ' +
        'as an "info" note so the reader can see what changed beyond the language.';
    default:
      return 'FIDELITY: idiomatic. Restructure as needed so the result reads like code written natively in the target ' +
        'language, while behaviour stays identical. Do not modernise beyond what idiom requires.';
  }
}

function dependencyBrief(d: DependencyPolicy, target: LanguageSpec): string {
  switch (d) {
    case 'stdlib':
      return `DEPENDENCIES: standard library only. Do not introduce any third-party package. Write the extra code ` +
        `yourself. If a source dependency genuinely cannot be replaced with ${target.label}'s standard library, ` +
        `implement the subset actually used and record it as an "action" note.`;
    case 'mirror':
      return 'DEPENDENCIES: mirror the source. For each library the source uses, pick the closest counterpart in the ' +
        'target ecosystem and map it one-for-one. List every mapping in the report with what differs between them.';
    default:
      return `DEPENDENCIES: use the packages an experienced ${target.label} developer would actually reach for — ` +
        `well-maintained, widely adopted, current. Prefer the standard library when it is genuinely sufficient. ` +
        `List every package you introduce in the report, with why.`;
  }
}

function languageBrief(target: LanguageSpec): string {
  const lines = [
    `## Target: ${target.label}`,
    '',
    'Idioms this conversion must follow:',
    ...target.idioms.map(i => `- ${i}`),
  ];
  if (target.pitfalls?.length) {
    lines.push('', 'Known conversion traps — check each one before you finish:', ...target.pitfalls.map(p => `- ${p}`));
  }
  lines.push('', `File extension: ${target.ext}. Naming convention for generated files: ${namingLabel(target.naming)}.`);
  if (target.manifest) lines.push(`Dependency manifest: ${target.manifest}.`);
  if (target.testFramework) lines.push(`Test framework: ${target.testFramework}.`);
  return lines.join('\n');
}

function namingLabel(n: NamingStyle): string {
  switch (n) {
    case 'snake':  return 'snake_case';
    case 'camel':  return 'camelCase';
    case 'pascal': return 'PascalCase';
    case 'kebab':  return 'kebab-case';
    default:       return 'keep the source file names';
  }
}

/**
 * The conversion prompt. `files` may hold one file, a selection, or a whole
 * batch — the shape of the brief is the same, which is why batches stay
 * coherent (cross-file references survive because the model sees them together).
 */
export function buildConvertPrompt(
  spec: ConversionSpec,
  files: SourceFile[],
  opts: { isSelection?: boolean; projectContext?: string } = {},
): string {
  const target = languageById(spec.target);
  if (!target) throw new Error(`Unknown target language: ${spec.target}`);

  const sourceLabel = spec.source ? languageLabel(spec.source) : 'the source language';
  const what = opts.isSelection
    ? 'the following code fragment'
    : files.length === 1 ? 'the following file' : `the following ${files.length} files, which belong to one codebase`;

  const parts: string[] = [];

  parts.push(
    `Convert ${what} from ${sourceLabel} to ${target.label}${spec.framework ? ` (targeting ${spec.framework})` : ''}.`,
  );

  parts.push('', '## How to convert', fidelityBrief(spec.fidelity), '', dependencyBrief(spec.dependencies, target));

  const extras: string[] = [];
  if (files.length > 1) {
    extras.push(
      'These files are one unit: keep cross-file references consistent, converting shared types and helpers once and ' +
      'importing them where needed. Preserve the directory layout unless the target language demands a different one.',
    );
  }
  if (opts.isSelection) {
    extras.push(
      'This is a fragment, not a whole file. Convert exactly this fragment. Do not invent a surrounding class, main ' +
      'function, or imports beyond what the fragment itself needs — but DO list the imports it requires in the report.',
    );
  }
  extras.push(
    spec.keepComments
      ? 'Carry the comments and doc-comments across, rewritten in the target language\'s documentation style. Do not copy them verbatim if the code they describe changed shape.'
      : 'Omit the source comments. Add doc-comments only on public API surfaces.',
  );
  if (spec.includeTests) {
    extras.push(
      `Also generate tests using ${target.testFramework ?? 'the standard test framework'}, covering the behaviour the ` +
      `source implies — including its edge cases and error paths. Tests go in their own file(s) following the target ` +
      `language's test-layout convention.`,
    );
  }
  if (spec.emitManifest && target.manifest) {
    extras.push(
      `Also emit a ${target.manifest} declaring exactly the dependencies you used — no more — so the result builds from a clean checkout.`,
    );
  }
  if (spec.notes.trim()) {
    extras.push(`Additional requirements from the user (these take precedence over defaults above): ${spec.notes.trim()}`);
  }
  parts.push('', ...extras.map(e => `- ${e}`));

  parts.push('', languageBrief(target));

  if (opts.projectContext?.trim()) {
    parts.push('', '## Project context', opts.projectContext.trim());
  }

  parts.push('', OUTPUT_CONTRACT);

  parts.push('', '## Source', '');
  for (const f of files) {
    const srcSpec = languageById(f.langId);
    const fence = srcSpec?.fence ?? '';
    const suggested = deriveOutRelPath(f.relPath, target);
    parts.push(
      `### ${f.relPath}${files.length > 1 || !opts.isSelection ? `  → suggested output: ${suggested}` : ''}`,
      '',
      '```' + fence,
      f.content,
      '```',
      '',
    );
  }

  return parts.join('\n');
}

/**
 * Repair prompt: a syntax check failed, feed it back with the file. Kept
 * separate from refinement because the ask is different — this is "make it
 * valid", not "make it different".
 */
export function buildRepairPrompt(
  spec: ConversionSpec,
  file: ConvertedFile,
  errors: string,
): string {
  const target = languageById(spec.target);
  return [
    `The converted ${target?.label ?? spec.target} file below does not pass its syntax check. Fix it.`,
    '',
    '## Checker output',
    '```',
    errors.trim().slice(0, 4000),
    '```',
    '',
    '## Rules',
    '- Fix the reported problems and any other error of the same kind elsewhere in the file.',
    '- Do NOT change behaviour, remove functionality, or delete code to make the error go away.',
    '- Do NOT stub a function body out. If something genuinely cannot compile without more context, keep it and record it as an "action" note.',
    '',
    OUTPUT_CONTRACT,
    '',
    `## File: ${file.relPath}`,
    '',
    '```' + (target?.fence ?? ''),
    file.content,
    '```',
  ].join('\n');
}

/**
 * Refinement prompt: the user asks for a change to code that already converted.
 * Only the touched files come back, so a five-file conversion is not
 * regenerated because someone wanted different error handling in one of them.
 */
export function buildRefinePrompt(
  spec: ConversionSpec,
  files: ConvertedFile[],
  instruction: string,
): string {
  const target = languageById(spec.target);
  return [
    `Change the converted ${target?.label ?? spec.target} code below as follows:`,
    '',
    instruction.trim(),
    '',
    '## Rules',
    '- Apply the change and nothing else. Preserve every behaviour not covered by the request.',
    '- Re-emit ONLY the files you actually changed. Leave the rest out entirely.',
    '- Emit each changed file complete — not a diff, not a fragment.',
    '- The report should describe THIS change: what moved, what a reviewer should re-check.',
    '',
    target ? languageBrief(target) : '',
    '',
    OUTPUT_CONTRACT,
    '',
    '## Current files',
    '',
    ...files.flatMap(f => [`### ${f.relPath}`, '', '```' + (target?.fence ?? f.lang), f.content, '```', '']),
  ].join('\n');
}

// ── Slicing a file that is too big for one pass ──────────────────────────────
//
// Batching whole files handles "many files". It does nothing for "one 4,000-line
// file and a model with an 8k window" — that file lands in its own batch and
// blows straight through the limit. Slicing handles that case: cut the file at
// real top-level boundaries, convert each piece with the context of what came
// before, and stitch the pieces back into one file.
//
// Cutting at boundaries rather than at line N matters. Half a function is not
// convertible; a whole function is.

export interface FileSlice {
  /** The source file this came from. */
  source: SourceFile;
  /** 1-based position in the slice sequence. */
  index: number;
  /** How many slices the file was cut into. */
  total: number;
  /** The slice's source text. */
  content: string;
  /** First line number of the slice in the original file (1-based). */
  startLine: number;
}

/**
 * Cut source into slices no larger than `maxChars`, preferring top-level
 * boundaries: a non-indented line that starts a new declaration, ideally after
 * a blank line. Falls back to a hard cut only if a single declaration is itself
 * larger than the budget — better a split function than a dropped one.
 */
export function sliceSource(source: SourceFile, maxChars: number): FileSlice[] {
  if (source.content.length <= maxChars) {
    return [{ source, index: 1, total: 1, content: source.content, startLine: 1 }];
  }

  const lines = source.content.split('\n');
  // Candidate cut points: a line at column 0 that looks like the start of
  // something, with a blank line before it. Language-agnostic on purpose — it
  // has to work for Python, Go, COBOL and everything between.
  const isBoundary = (i: number): boolean => {
    if (i === 0) return false;
    const line = lines[i];
    if (!line || /^\s/.test(line)) return false;          // indented ⇒ inside a block
    if (!/^[A-Za-z_@#$[({<]/.test(line)) return false;    // not a declaration-ish start
    const prev = lines[i - 1] ?? '';
    return prev.trim() === '';                            // blank line before it
  };

  const slices: FileSlice[] = [];
  let startIdx = 0;
  let size = 0;
  let lastBoundary = -1;

  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length + 1;
    if (size + len > maxChars && i > startIdx) {
      // Prefer the most recent boundary inside this window; if there wasn't
      // one, cut here rather than growing without limit.
      const cut = lastBoundary > startIdx ? lastBoundary : i;
      slices.push({
        source, index: slices.length + 1, total: 0,
        content: lines.slice(startIdx, cut).join('\n'),
        startLine: startIdx + 1,
      });
      startIdx = cut;
      size = lines.slice(cut, i + 1).reduce((a, l) => a + l.length + 1, 0);
      lastBoundary = -1;
      continue;
    }
    size += len;
    if (isBoundary(i)) lastBoundary = i;
  }
  if (startIdx < lines.length) {
    slices.push({
      source, index: slices.length + 1, total: 0,
      content: lines.slice(startIdx).join('\n'),
      startLine: startIdx + 1,
    });
  }

  const total = slices.length;
  for (const s of slices) s.total = total;
  return slices;
}

/**
 * Top-level declarations in generated code, used to tell the next slice what
 * already exists so it doesn't redefine a helper or invent a different name for
 * the same type. A cheap textual index, not a parser — it only has to be a
 * useful reminder.
 */
export function declarationIndex(code: string, limit = 40): string[] {
  const out: string[] = [];
  for (const line of code.split('\n')) {
    if (/^\s/.test(line)) continue;
    const t = line.trim();
    if (!t || t.length > 200) continue;
    if (/^(package|import|using|from|#include|require|namespace)\b/.test(t)) continue;
    if (/^(\/\/|#|--|\/\*|\*)/.test(t)) continue;
    if (/^(func|def|class|struct|type|interface|enum|impl|trait|fn|public|private|protected|const|var|let|export|module|sub|function|procedure|record|data)\b/.test(t)
        || /[({=]\s*$/.test(t)) {
      out.push(t.replace(/\s*[{(].*$/, '').trim());
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Prompt for one slice of a larger file. Slice 1 owns the file's preamble
 * (package/imports); later slices must not re-emit it, or stitching produces a
 * file with three import blocks.
 */
export function buildSlicePrompt(
  spec: ConversionSpec,
  slice: FileSlice,
  outRelPath: string,
  alreadyDeclared: string[],
): string {
  const target = languageById(spec.target);
  if (!target) throw new Error(`Unknown target language: ${spec.target}`);
  const sourceLabel = spec.source ? languageLabel(spec.source) : 'the source language';
  const srcFence = languageById(slice.source.langId)?.fence ?? '';
  const first = slice.index === 1;
  const last  = slice.index === slice.total;

  const parts: string[] = [
    `Convert part ${slice.index} of ${slice.total} of the file \`${slice.source.relPath}\` from ` +
    `${sourceLabel} to ${target.label}${spec.framework ? ` (targeting ${spec.framework})` : ''}.`,
    '',
    'This file is too large for one pass, so it is being converted in ordered parts and joined back ' +
    'together afterwards. That makes the following rules absolute:',
    '',
    first
      ? '- This is the FIRST part. Emit the file preamble — package/namespace declaration, imports/includes — ' +
        'covering what THIS part needs. Later parts will add nothing further, so if you can see from the ' +
        'declarations below that more will be needed, include those imports now.'
      : '- This is a CONTINUATION. Do NOT emit a package/namespace declaration, imports, includes, or any ' +
        'file-level preamble — part 1 already did, and repeating it produces a broken file. Start directly ' +
        'with the converted code for this part.',
    last
      ? '- This is the LAST part. Emit any closing brackets or trailing file structure the language needs.'
      : '- This is NOT the last part. Do NOT emit a closing bracket or `main` wrapper for anything that ' +
        'continues past the end of this part, and do not summarise or add "rest of file" comments.',
    '- Convert exactly what is in this part. Do not repeat code from earlier parts and do not anticipate later ones.',
    '- Keep names identical to those already generated, listed below. Consistency across parts is what makes the joined file compile.',
    '',
    fidelityBrief(spec.fidelity),
    '',
    dependencyBrief(spec.dependencies, target),
  ];

  if (alreadyDeclared.length) {
    parts.push('', '## Already generated in earlier parts — reuse these, do not redefine them',
      '```', ...alreadyDeclared.slice(0, 60), '```');
  }

  parts.push('', languageBrief(target));
  parts.push('', OUTPUT_CONTRACT);
  parts.push('',
    `Emit this part as a single code block with \`path=${outRelPath}\`. The report should cover THIS part only.`);
  parts.push('', `## Source — ${slice.source.relPath}, part ${slice.index} of ${slice.total} ` +
    `(from line ${slice.startLine})`, '', '```' + srcFence, slice.content, '```');

  return parts.join('\n');
}

/** Join converted slices of one file back into a single file, in order. */
export function stitchSlices(pieces: string[]): string {
  return pieces
    .map(p => p.replace(/^\n+|\n+$/g, ''))
    .filter(p => p.length > 0)
    .join('\n\n');
}

// ── Sizing a conversion ──────────────────────────────────────────────────────

export interface ConversionEstimate {
  /** Characters of source being converted. */
  sourceChars: number;
  /** Estimated tokens the prompt will use, brief included. */
  promptTokens: number;
  /** Estimated tokens the response needs: converted code plus the report. */
  outputTokens: number;
}

/**
 * How big is this job, in tokens?
 *
 * Converted code is usually somewhat LONGER than its source — explicit error
 * handling, type declarations, imports — so output is estimated at 1.3× the
 * source, plus the report. Overestimating output is the safe direction: it
 * reserves more of the window and produces more slices, and a conversation
 * that finishes in too many pieces beats one that stops mid-file.
 */
export function estimateConversion(
  sources: Array<{ content: string }>,
  spec: ConversionSpec,
  estimateTokens: (chars: number) => number,
): ConversionEstimate {
  const sourceChars = sources.reduce((a, s) => a + s.content.length, 0);
  // The standing brief: system prompt, output contract, idioms, pitfalls.
  const BRIEF_CHARS = 4_500 + (spec.includeTests ? 400 : 0);
  const promptTokens = estimateTokens(sourceChars + BRIEF_CHARS);
  const REPORT_CHARS = 1_200 + sources.length * 250;
  const outputTokens = estimateTokens(Math.round(sourceChars * (spec.includeTests ? 1.7 : 1.3)) + REPORT_CHARS);
  return { sourceChars, promptTokens, outputTokens };
}

/**
 * The largest slice of SOURCE that fits a model, in characters. Derived from
 * the usable window rather than a fixed setting, so a 128k model isn't held to
 * an 8k model's batch size.
 */
export function sliceBudgetChars(
  contextTokens: number,
  maxOutputTokens: number,
  spec: ConversionSpec,
  charsPerToken: number,
): number {
  const window = Math.floor(contextTokens * 0.95);
  const growth = spec.includeTests ? 1.7 : 1.3;
  // A slice of S source chars costs S/cpt prompt tokens and about S*growth/cpt
  // output tokens; both must fit the window alongside the brief.
  const briefTokens = Math.ceil(5_000 / charsPerToken);
  const perCharCost = (1 + growth) / charsPerToken;
  const affordable  = Math.floor((window - briefTokens) / perCharCost);
  // The response cap is a second, independent ceiling.
  const outputBound = Math.floor((maxOutputTokens * charsPerToken) / growth);
  return Math.max(1_000, Math.min(affordable, outputBound));
}

// ── Output paths ─────────────────────────────────────────────────────────────

export function extname(p: string): string {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i) : '';
}

export function basename(p: string, stripExt = false): string {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!stripExt) return base;
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

/** Split an identifier written in any common convention into lowercase words. */
export function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
}

export function applyNaming(name: string, style: NamingStyle): string {
  if (style === 'keep') return name;
  const words = splitWords(name);
  if (words.length === 0) return name;
  switch (style) {
    case 'snake':  return words.join('_');
    case 'kebab':  return words.join('-');
    case 'camel':  return words[0] + words.slice(1).map(cap).join('');
    case 'pascal': return words.map(cap).join('');
  }
}

function cap(w: string): string { return w.charAt(0).toUpperCase() + w.slice(1); }

/**
 * Where a source file's conversion should land, by default. The model is told
 * this and may override it (splitting one file into several is legitimate), so
 * this is a suggestion — but a good one, and the fallback when the model gives
 * no path at all.
 */
export function deriveOutRelPath(srcRelPath: string, target: LanguageSpec): string {
  const norm = srcRelPath.replace(/\\/g, '/');
  const dir  = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/') + 1) : '';
  const stem = basename(norm, true);
  return `${dir}${applyNaming(stem, target.naming)}${target.ext}`;
}

// ── Parsing the model's output ───────────────────────────────────────────────

interface RawBlock { info: string; body: string; }

/** Pull every fenced block out, keeping its info string. Tolerates ``` inside indented blocks. */
function extractBlocks(raw: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const re = /^[ \t]*```([^\n`]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    blocks.push({ info: (m[1] ?? '').trim(), body: m[2] ?? '' });
  }
  return blocks;
}

/**
 * Confine a model-supplied path to the output root. The path in a fence info
 * string is untrusted text: `../../.ssh/authorized_keys` or `C:\Windows\...`
 * would otherwise be joined onto the root and written there. Everything is
 * flattened to a relative path that cannot climb out.
 */
export function sanitizeRelPath(p: string): string {
  const cleaned = p
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:/, '')            // drive letter
    .replace(/^\/+/, '')                  // absolute
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .map(seg => seg.replace(/[<>:"|?*\x00-\x1f]/g, '_'))  // illegal on Windows
    .join('/');
  return cleaned || 'converted';
}

/** `go path=cmd/main.go` → { lang: 'go', path: 'cmd/main.go' } — tolerant of quoting and of `file=`/`filename=`. */
function parseInfoString(info: string): { lang: string; path: string } {
  const pathMatch = info.match(/\b(?:path|file|filename)\s*[=:]\s*["'`]?([^\s"'`]+)["'`]?/i);
  let path = pathMatch?.[1] ?? '';
  // Some models write ```go cmd/main.go — take a bare token that looks like a path.
  if (!path) {
    const bare = info.split(/\s+/).slice(1).find(t => /[./]/.test(t) && !t.includes('='));
    if (bare) path = bare.replace(/^["'`]|["'`]$/g, '');
  }
  const langToken = info.split(/\s+/)[0]?.toLowerCase() ?? '';
  const lang = FENCE_ALIASES[langToken] ?? langToken;
  return { lang, path: path.replace(/^\.\//, '').replace(/\\/g, '/') };
}

/** Some models put the path on a comment line at the top of the block instead. */
function pathFromLeadingComment(body: string): string {
  const first = body.split('\n', 2)[0] ?? '';
  const m = first.match(/^\s*(?:\/\/|#|--|;|<!--|\/\*)\s*(?:file|path|filename)\s*[:=]\s*([^\s*>-]+)/i);
  return m ? m[1].replace(/^\.\//, '').replace(/\\/g, '/') : '';
}

function emptyReport(summary = ''): ConversionReport {
  return { summary, confidence: 'medium', dependencies: [], notes: [], manualSteps: [], setup: [] };
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

function coerceReport(parsed: unknown): ConversionReport {
  const r = emptyReport();
  if (!parsed || typeof parsed !== 'object') return r;
  const o = parsed as Record<string, unknown>;
  r.summary = asString(o.summary);
  const conf = asString(o.confidence).toLowerCase();
  r.confidence = conf === 'high' || conf === 'low' ? conf : 'medium';
  if (Array.isArray(o.dependencies)) {
    for (const d of o.dependencies) {
      if (!d || typeof d !== 'object') continue;
      const dd = d as Record<string, unknown>;
      const status = asString(dd.status).toLowerCase();
      r.dependencies.push({
        source: asString(dd.source, '—'),
        target: asString(dd.target, '—'),
        status: status === 'mapped' || status === 'approximated' || status === 'none' || status === 'builtin'
          ? status : 'mapped',
        note: asString(dd.note) || undefined,
      });
    }
  }
  if (Array.isArray(o.notes)) {
    for (const n of o.notes) {
      if (!n || typeof n !== 'object') continue;
      const nn = n as Record<string, unknown>;
      const sev = asString(nn.severity).toLowerCase();
      r.notes.push({
        severity: sev === 'action' || sev === 'warn' ? sev : 'info',
        title:  asString(nn.title, 'Note'),
        detail: asString(nn.detail),
        sourceRef: asString(nn.sourceRef) || undefined,
        targetRef: asString(nn.targetRef) || undefined,
      });
    }
  }
  r.manualSteps = asStringArray(o.manualSteps);
  r.setup       = asStringArray(o.setup);
  return r;
}

/**
 * Parse a conversion response into files + report.
 *
 * Deliberately forgiving: a model that forgets the json block, uses `file=`
 * instead of `path=`, or emits one bare block still produces a usable result —
 * with a note saying the report was missing, so the gap is visible rather than
 * silently filled in.
 */
export function parseConversionResult(
  raw: string,
  spec: ConversionSpec,
  sources: SourceFile[],
): ConversionResult {
  const target = languageById(spec.target);
  const blocks = extractBlocks(raw);
  const files: ConvertedFile[] = [];
  let report: ConversionReport | null = null;

  for (const b of blocks) {
    const { lang, path: infoPath } = parseInfoString(b.info);
    const body = b.body.replace(/\s+$/, '');
    if (!body.trim()) continue;

    // The report block: json, and it parses to an object with our shape.
    if (!report && (lang === 'json' || lang === 'jsonc') && !infoPath) {
      try {
        const parsed = JSON.parse(stripTrailingCommas(body)) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const o = parsed as Record<string, unknown>;
          if ('summary' in o || 'notes' in o || 'confidence' in o || 'dependencies' in o) {
            report = coerceReport(parsed);
            continue;
          }
        }
      } catch { /* not the report — fall through and treat it as a file */ }
    }

    let relPath = infoPath || pathFromLeadingComment(body);
    if (!relPath) {
      // No path given. Line the block up with the source file in the same
      // position; past the end of the source list, number it. Then make sure
      // the guess is unique — two DIFFERENT blocks landing on one derived path
      // would be merged below, silently welding unrelated code together.
      // (An explicitly repeated path still merges: that is a split file.)
      const idx = files.length;
      const src = sources[idx] ?? (sources.length === 1 ? sources[0] : undefined);
      const guess = src && target
        ? deriveOutRelPath(src.relPath, target)
        : `converted-${idx + 1}${target?.ext ?? ''}`;
      relPath = uniquePath(guess, files);
    }

    files.push({
      relPath: sanitizeRelPath(relPath),
      content: body,
      lang: lang || target?.fence || '',
      fromRelPath: matchSource(relPath, sources)?.relPath,
    });
  }

  // Nothing fenced at all — the model replied in prose or emitted bare code.
  if (files.length === 0 && raw.trim()) {
    const src = sources[0];
    const relPath = src && target ? deriveOutRelPath(src.relPath, target) : `converted${target?.ext ?? '.txt'}`;
    files.push({ relPath, content: raw.trim(), lang: target?.fence ?? '', fromRelPath: src?.relPath });
  }

  if (!report) {
    report = emptyReport();
    report.confidence = 'low';
    report.notes.push({
      severity: 'warn',
      title: 'No conversion report was returned',
      detail:
        'The model produced code but not the structured report, so nothing here tells you which parts were ' +
        'approximated. Review the code closely, or run the conversion again — a smaller batch or a stronger model ' +
        'usually gets the report back.',
    });
  }

  // De-duplicate paths: a second block for the same path is a continuation the
  // model split; concatenating loses less than dropping.
  const seen = new Map<string, ConvertedFile>();
  for (const f of files) {
    const prev = seen.get(f.relPath);
    if (prev) prev.content += '\n\n' + f.content;
    else seen.set(f.relPath, f);
  }

  return { files: [...seen.values()], report, raw };
}

/** Suffix a derived path until it stops colliding with one already emitted. */
function uniquePath(candidate: string, files: ConvertedFile[]): string {
  if (!files.some(f => f.relPath === candidate)) return candidate;
  const ext  = extname(candidate);
  const stem = candidate.slice(0, candidate.length - ext.length);
  for (let n = 2; n < 100; n++) {
    const next = `${stem}-${n}${ext}`;
    if (!files.some(f => f.relPath === next)) return next;
  }
  return candidate;
}

/** Trailing commas are the one JSON sin models commit constantly. */
function stripTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, '$1');
}

/** Best-effort: which source file did this output come from? Matches on stem. */
function matchSource(outRelPath: string, sources: SourceFile[]): SourceFile | undefined {
  const stem = splitWords(basename(outRelPath, true)).join('');
  if (!stem) return undefined;
  return sources.find(s => splitWords(basename(s.relPath, true)).join('') === stem)
      ?? (sources.length === 1 ? sources[0] : undefined);
}

// ── Report rendering ─────────────────────────────────────────────────────────

const SEVERITY_MARK: Record<NoteSeverity, string> = {
  action: '🔴 Action needed',
  warn:   '🟡 Check this',
  info:   '🔵 For information',
};

/**
 * The fidelity report as Markdown, written next to the converted code. This is
 * the artefact that makes the conversion reviewable by someone who wasn't
 * sitting here when it ran.
 */
export function renderReportMarkdown(
  report: ConversionReport,
  spec: ConversionSpec,
  files: ConvertedFile[],
  sources: SourceFile[],
): string {
  const target = languageLabel(spec.target);
  const source = spec.source ? languageLabel(spec.source) : 'source';
  const L: string[] = [];

  L.push(`# Conversion report — ${source} → ${target}`, '');
  if (report.summary) L.push(report.summary, '');

  const actions = report.notes.filter(n => n.severity === 'action');
  const warns   = report.notes.filter(n => n.severity === 'warn');

  L.push('| | |', '|---|---|');
  L.push(`| **Confidence** | ${report.confidence} |`);
  L.push(`| **Files in** | ${sources.length} |`);
  L.push(`| **Files out** | ${files.length} |`);
  L.push(`| **Needs attention** | ${actions.length} action${actions.length === 1 ? '' : 's'}, ${warns.length} warning${warns.length === 1 ? '' : 's'} |`);
  L.push(`| **Style** | ${FIDELITY_CHOICES.find(f => f.id === spec.fidelity)?.label ?? spec.fidelity} · ${DEPENDENCY_CHOICES.find(d => d.id === spec.dependencies)?.label ?? spec.dependencies} |`);
  L.push('');

  if (report.notes.length) {
    L.push('## What to check', '');
    for (const sev of ['action', 'warn', 'info'] as NoteSeverity[]) {
      const group = report.notes.filter(n => n.severity === sev);
      if (!group.length) continue;
      L.push(`### ${SEVERITY_MARK[sev]}`, '');
      for (const n of group) {
        const refs = [n.sourceRef, n.targetRef].filter(Boolean).join(' → ');
        L.push(`- **${n.title}**${refs ? ` \`${refs}\`` : ''}`);
        if (n.detail) L.push(`  ${n.detail}`);
      }
      L.push('');
    }
  }

  if (report.dependencies.length) {
    L.push('## Dependencies', '', '| Source | Target | Status | Notes |', '|---|---|---|---|');
    for (const d of report.dependencies) {
      L.push(`| \`${d.source}\` | \`${d.target}\` | ${d.status} | ${(d.note ?? '').replace(/\|/g, '\\|')} |`);
    }
    L.push('');
  }

  if (report.manualSteps.length) {
    L.push('## Manual steps', '', ...report.manualSteps.map(s => `- [ ] ${s}`), '');
  }

  if (report.setup.length) {
    L.push('## Getting it running', '', '```bash', ...report.setup, '```', '');
  }

  L.push('## Files', '', '| Converted | From |', '|---|---|');
  for (const f of files) L.push(`| \`${f.relPath}\` | ${f.fromRelPath ? `\`${f.fromRelPath}\`` : '—'} |`);
  L.push('');

  L.push('---', '', '_Generated by Evolve AI. Machine translation of code needs a human review before it ships._');
  return L.join('\n');
}

/** One-line verdict for the status bar / notifications. */
export function reportHeadline(report: ConversionReport): string {
  const a = report.notes.filter(n => n.severity === 'action').length;
  const w = report.notes.filter(n => n.severity === 'warn').length;
  if (a) return `${a} item${a === 1 ? '' : 's'} need attention before this runs`;
  if (w) return `${w} thing${w === 1 ? '' : 's'} to double-check`;
  return report.confidence === 'high' ? 'Clean conversion — review and go' : 'Converted — give it a review';
}
