#!/usr/bin/env node
/**
 * scripts/check-pipelines.js — Self-contained CI/CD anti-pattern checker
 *
 * Invoked by the git pre-push hook installed via `aiForge.cicd.installHook`.
 * Reads pipeline file paths from argv or stdin, parses each one, and exits:
 *   0 → no hard-block issues (warnings still printed to stderr)
 *   1 → at least one hard-block issue (push blocked unless --no-verify)
 *
 * Self-contained on purpose. No imports from the extension. Pure Node, works
 * standalone, survives extension uninstall. Logic is a focused subset of
 * `src/plugins/cicd.ts`'s `parsePipelineSummary()`. Two are MUST keep in sync:
 *   - The set of paths considered pipeline files
 *   - The rule definitions for "hard-block" vs "warn"
 *
 * Usage:
 *   node check-pipelines.js [--mode=block|warn|off] [<file1> <file2> ...]
 *   (with no files, reads NUL-separated paths from stdin)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Rule definitions ────────────────────────────────────────────────────────
// Hard-block: known supply-chain or credential-leak risks. These block by
// default (mode=block). Switch to warn-tier with --mode=warn.
// Warn-only: best-practice nudges that never block.

const RULES = {
  unpinnedActions: {
    severity: 'block',
    message:  (refs, file) =>
      `${file}: ${refs.length} unpinned action reference(s): ${refs.slice(0, 5).join(', ')}${refs.length > 5 ? '…' : ''}\n  → Supply-chain risk. Pin each to a 40-char commit SHA. Quick fix: gh api repos/<owner>/<repo>/git/ref/tags/<tag> | jq -r .object.sha`,
  },
  longLivedCloudCreds: {
    severity: 'block',
    message:  (secrets, file) =>
      `${file}: long-lived cloud credentials referenced as secrets: ${secrets.join(', ')}\n  → Use OIDC instead (no rotating keys, no leak risk). GitHub Actions → AWS/GCP/Azure all support it.`,
  },
  missingTimeout: {
    severity: 'warn',
    message:  (count, file) => `${file}: ${count} job(s) without timeout-minutes — runaway runs can sit idle for 6h.`,
  },
  missingConcurrency: {
    severity: 'warn',
    message:  (_unused, file) => `${file}: no concurrency block — duplicate runs may race or waste runner minutes.`,
  },
  missingPermissions: {
    severity: 'warn',
    message:  (_unused, file) => `${file}: GitHub Actions workflow has no top-level permissions: block — implicitly grants write to the GITHUB_TOKEN.`,
  },
};

// Keys that strongly suggest long-lived cloud credentials when found as secrets.
// We deliberately skip generic names (TOKEN, API_KEY, etc.) — too many false positives.
const LONG_LIVED_CRED_SECRETS = [
  /^AWS_ACCESS_KEY_ID$/, /^AWS_SECRET_ACCESS_KEY$/, /^AWS_SESSION_TOKEN$/,
  /^GCP_SA_KEY$/, /^GOOGLE_APPLICATION_CREDENTIALS$/, /^GCP_CREDENTIALS$/,
  /^AZURE_CLIENT_SECRET$/, /^AZURE_SP$/, /^AZURE_CREDENTIALS$/,
];

// ── Classification ──────────────────────────────────────────────────────────

function classifyPlatform(file) {
  const norm = file.replace(/\\/g, '/');
  if (/^\.github\/workflows\/.+\.ya?ml$/i.test(norm))          return 'github-actions';
  if (/(^|\/)\.gitlab-ci(-[\w-]+)?\.ya?ml$/i.test(norm))       return 'gitlab-ci';
  if (/(^|\/)Jenkinsfile(\.[\w-]+)?$/.test(norm))              return 'jenkins';
  if (/(^|\/)\.circleci\/config\.ya?ml$/i.test(norm))          return 'circleci';
  if (/(^|\/)azure-pipelines(-[\w-]+)?\.ya?ml$/i.test(norm))   return 'azure-pipelines';
  if (/(^|\/)bitbucket-pipelines\.ya?ml$/i.test(norm))         return 'bitbucket-pipelines';
  return null;
}

// ── Parser (a focused subset of plugins/cicd.ts) ────────────────────────────

function analysePipeline(file, content, platform) {
  const findings = { hardBlocks: [], warnings: [] };

  // Action references — GitHub Actions only.
  if (platform === 'github-actions') {
    const usesPattern = /uses:\s*([^\s@]+)@([^\s#\n]+)/g;
    const unpinned = [];
    let m;
    while ((m = usesPattern.exec(content)) !== null) {
      // Skip local-action and docker-image refs.
      const owner = m[1];
      if (owner.startsWith('./') || owner.startsWith('docker://')) continue;
      // 40-hex SHA = pinned. Anything else = mutable.
      if (!/^[0-9a-f]{40}$/i.test(m[2])) unpinned.push(`${owner}@${m[2]}`);
    }
    if (unpinned.length > 0) {
      findings.hardBlocks.push(RULES.unpinnedActions.message(unpinned, file));
    }
  }

  // Long-lived cloud credentials.
  const secretPatterns = [
    /\$\{\{\s*secrets\.([A-Z_][\w]*)\s*\}\}/g,            // GitHub
    /\$([A-Z_][\w]*)/g,                                    // GitLab / Bitbucket / Jenkins shell-style
  ];
  const referenced = new Set();
  for (const sp of secretPatterns) {
    let m;
    while ((m = sp.exec(content)) !== null) referenced.add(m[1]);
  }
  const flagged = Array.from(referenced).filter(s => LONG_LIVED_CRED_SECRETS.some(re => re.test(s)));
  if (flagged.length > 0) {
    findings.hardBlocks.push(RULES.longLivedCloudCreds.message(flagged, file));
  }

  // Warn: missing top-level permissions: (GitHub Actions only).
  if (platform === 'github-actions') {
    if (!/^permissions:/m.test(content)) {
      findings.warnings.push(RULES.missingPermissions.message(null, file));
    }
  }

  // Warn: jobs without timeout-minutes. Count `runs-on:` (or Jenkins stage) as proxy for jobs.
  if (platform === 'github-actions' || platform === 'gitlab-ci' || platform === 'azure-pipelines' || platform === 'circleci') {
    const jobCount  = (content.match(/^\s*runs-on:/gm) || []).length || (content.match(/^\s{2}[\w.-]+:\s*$/gm) || []).length;
    const timeoutCount = (content.match(/timeout-minutes:\s*\d+/g) || []).length + (content.match(/timeout:\s*[\dhmsdwo]+/gi) || []).length;
    if (jobCount > 0 && timeoutCount < jobCount) {
      findings.warnings.push(RULES.missingTimeout.message(jobCount - timeoutCount, file));
    }
  }

  // Warn: no concurrency block (GitHub Actions).
  if (platform === 'github-actions' && !/^concurrency:/m.test(content)) {
    findings.warnings.push(RULES.missingConcurrency.message(null, file));
  }

  return findings;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { mode: 'block', files: [] };
  for (const a of argv) {
    if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length);
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else if (a.startsWith('--')) { /* ignore unknown */ }
    else args.files.push(a);
  }
  return args;
}

function printUsage() {
  process.stdout.write([
    'Usage: node check-pipelines.js [--mode=block|warn|off] [<files...>]',
    '  --mode=block  (default) Hard-block issues exit 1.',
    '  --mode=warn   Hard-block issues print to stderr but exit 0.',
    '  --mode=off    Skip checks entirely. Useful for the git hook stub.',
    '',
    'If no files are given, read NUL-separated paths from stdin.',
  ].join('\n') + '\n');
}

async function readStdinFiles() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { buf += d; });
    process.stdin.on('end',  ()   => resolve(buf.split('\0').filter(Boolean)));
    process.stdin.on('error', ()  => resolve([]));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'off') process.exit(0);

  let files = args.files;
  if (files.length === 0 && !process.stdin.isTTY) {
    files = await readStdinFiles();
  }

  if (files.length === 0) {
    // Nothing to check. Don't block the push.
    process.exit(0);
  }

  let hardBlockCount = 0;
  let warnCount      = 0;
  const lines = [];

  for (const rel of files) {
    const platform = classifyPlatform(rel);
    if (!platform) continue;   // not a pipeline file we know about
    let content;
    try { content = fs.readFileSync(rel, 'utf8'); }
    catch (e) {
      // File may be deleted — that's fine, nothing to check.
      continue;
    }
    const findings = analysePipeline(rel, content, platform);
    for (const m of findings.hardBlocks) { lines.push('  ✗ ' + m); hardBlockCount++; }
    for (const m of findings.warnings)   { lines.push('  ⚠ ' + m); warnCount++; }
  }

  if (lines.length === 0) {
    process.exit(0);
  }

  const banner = '— Evolve AI: CI/CD pipeline check —';
  process.stderr.write(`\n${banner}\n${lines.join('\n')}\n\n`);

  if (hardBlockCount === 0) {
    process.stderr.write(`No blocking issues (${warnCount} warning${warnCount === 1 ? '' : 's'}). Push allowed.\n\n`);
    process.exit(0);
  }

  if (args.mode === 'warn') {
    process.stderr.write(`Mode is 'warn' — ${hardBlockCount} blocking issue${hardBlockCount === 1 ? '' : 's'} detected but push will proceed. Set aiForge.cicd.hookMode to 'block' to enforce.\n\n`);
    process.exit(0);
  }

  process.stderr.write(`${hardBlockCount} blocking issue${hardBlockCount === 1 ? '' : 's'} detected. Push refused.\n`);
  process.stderr.write(`Bypass with: git push --no-verify  (use sparingly).\n`);
  process.stderr.write(`Disable: aiForge.cicd.hookMode = "off"  or  remove .git/hooks/pre-push\n\n`);
  process.exit(1);
}

main().catch((e) => {
  // Never block on internal errors — that would be worse than the bug itself.
  process.stderr.write(`evolve-ai pre-push hook internal error: ${e.message}\n`);
  process.exit(0);
});
