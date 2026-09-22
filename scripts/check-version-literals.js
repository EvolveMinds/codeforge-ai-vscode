#!/usr/bin/env node
/**
 * scripts/check-version-literals.js — Guard against hardcoded app-version literals.
 *
 * Why this exists: the desktop app displayed a hardcoded "v2.23.0" in its
 * settings panel and header pill. Because the version was baked into markup and
 * renderer fallbacks, every later build kept reporting 2.23.0 — users who
 * downloaded v2.24.0 launched it and still saw v2.23.0. No rebuild could fix it,
 * because the wrong value was the source.
 *
 * The version now has exactly one source: the `version` field in package.json,
 * read at runtime via src/desktop/shared/appVersion.ts. This script fails the
 * build if a version-shaped literal reappears in the UI or provenance paths.
 *
 * Exit codes:
 *   0 → clean
 *   1 → at least one hardcoded version literal found
 *
 * Usage:
 *   node scripts/check-version-literals.js          # scan
 *   node scripts/check-version-literals.js --list   # also print scanned files
 *
 * To allow a genuinely intentional literal (a historical changelog entry, a
 * migration threshold, a third-party version), put ALLOW_VERSION_LITERAL on the
 * same line or the line directly above it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const ALLOW_MARKER = 'ALLOW_VERSION_LITERAL';

/**
 * Files scanned. Deliberately scoped to where a stale version is user-visible or
 * becomes an audit claim, rather than the whole tree — a broad scan would drown
 * in third-party version strings and get switched off.
 */
const SCAN_TARGETS = [
  'src/desktop/renderer/index.html',
  'src/desktop/renderer/renderer.ts',
  'src/desktop/main/main.ts',
  'src/desktop/main/updater.ts',
  'src/desktop/main/ipcHandlers.ts',
  'src/desktop/main/preload.ts',
  'src/desktop/shared/appVersion.ts',
  'src/desktop/shared/desktopTypes.ts'
];

/**
 * Matches a version literal that looks like THIS product's version: a quoted
 * (or v-prefixed) 3-part semver in the 1.x–9.x range. Matching the product's
 * own shape keeps unrelated dependency pins from tripping the guard.
 */
const VERSION_PATTERNS = [
  /(['"`])v?[1-9]\d?\.\d{1,2}\.\d{1,2}\1/g,   // '2.23.0' / "v2.23.0" / `2.23.0`
  />\s*v[1-9]\d?\.\d{1,2}\.\d{1,2}\s*</g      // >v2.23.0<  (HTML text node)
];

/**
 * Version-ish strings that are not this app's version. A guard that cries wolf
 * gets switched off, so these exclusions are as important as the patterns.
 */
const IGNORE_LINE_PATTERNS = [
  /electronVersion/i,
  /"(dependencies|devDependencies)"/,
  /@types\//,
  /node_modules/,
  /engines/i,
  /sdk\/server/i,
  /schemaVersion/i,
  /apiVersion/i,
  /^\s*\*/,               // JSDoc / block-comment prose
  /^\s*\/\//,             // line-comment prose
  /^\s*\/\*/,             // block-comment opener
  // User-authored artifact versions: eval gates, golden benchmarks, generated
  // scaffolds. These name the USER'S artifact, not the Evolve build.
  /GateVersion|gateVersion|benchmarkVersion|baselineVersion/i,
  /Evaluator Baseline|golden|benchmark/i,
  /FastAPI\(|app\s*=\s*FastAPI/i,
  /\btag:\s*['"]v/,       // scaffolded release-tag samples
  /\bid:\s*['"]v\d/       // scaffolded id samples
];

/**
 * In HTML, only the elements that display the APP version matter. Scanning all
 * markup would flag every unrelated version-shaped string in the UI.
 */
const HTML_VERSION_ELEMENT_IDS = [
  'lblCurrentAppVersion',
  'headerVersionLabel',
  'lblLatestAppVersion',
  'lblInstalledVersion'
];

function scanFile(relPath) {
  const abs = path.join(rootDir, relPath);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return []; // file may not exist in every edition; not this guard's problem
  }

  const lines = text.split(/\r?\n/);
  const findings = [];
  const isHtml = relPath.endsWith('.html');

  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    if (i > 0 && lines[i - 1].includes(ALLOW_MARKER)) return;
    if (IGNORE_LINE_PATTERNS.some(re => re.test(line))) return;

    // In markup, only the app-version display elements are in scope.
    if (isHtml && !HTML_VERSION_ELEMENT_IDS.some(id => line.includes(id))) return;

    for (const re of VERSION_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        findings.push({
          file: relPath,
          line: i + 1,
          match: m[0].trim(),
          text: line.trim().slice(0, 140)
        });
      }
    }
  });

  return findings;
}

function main() {
  const listFiles = process.argv.includes('--list');
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  console.log(`\n  Version-literal guard — package.json is v${pkg.version}`);
  console.log(`  Scanning ${SCAN_TARGETS.length} files for hardcoded version literals...\n`);

  let findings = [];
  for (const target of SCAN_TARGETS) {
    if (listFiles) console.log(`    · ${target}`);
    findings = findings.concat(scanFile(target));
  }

  if (findings.length === 0) {
    console.log(`  [OK] No hardcoded version literals found.`);
    console.log(`       The app version resolves from package.json at runtime.\n`);
    return 0;
  }

  console.error(`  [FAIL] Found ${findings.length} hardcoded version literal(s):\n`);
  for (const f of findings) {
    console.error(`    ${f.file}:${f.line}`);
    console.error(`      ${f.text}`);
    console.error(`      ^ literal ${f.match}\n`);
  }
  console.error(`  A hardcoded version ships as whatever it was last hand-edited to,`);
  console.error(`  so a new build reports the OLD version to every user.\n`);
  console.error(`  Fix: use getAppVersion() / getAppVersionTag() from`);
  console.error(`       src/desktop/shared/appVersion.ts (main process), or`);
  console.error(`       appVersion() / appVersionTag() in renderer.ts.`);
  console.error(`  If the literal is genuinely intentional, add ${ALLOW_MARKER}`);
  console.error(`  on that line or the line above it.\n`);
  return 1;
}

process.exit(main());
