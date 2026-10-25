#!/usr/bin/env node
/**
 * scripts/check-quality-loop.js — Evolve AI Mechanical Pre-Commit Gate
 *
 * Verifies that staged code changes have completed an authorized
 * Iterative Quality Loop before git commits are accepted.
 *
 * Exit Codes:
 *   0 → Gate passed or staged changes exempt
 *   1 → Gate blocked (unreviewed code, incomplete loop iterations)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Determine repo root
const repoRoot = process.cwd();
const loopStatePath = path.join(repoRoot, '.evolve', 'state', 'loop-state.json');

// Check staged files
let stagedFiles = [];
try {
  const output = execSync('git diff --cached --name-only', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  stagedFiles = output.split('\n').map(s => s.trim()).filter(Boolean);
} catch {
  // Not a git repo or git error, pass through
  process.exit(0);
}

if (stagedFiles.length === 0) {
  process.exit(0);
}

// Covered extensions & paths requiring an iterative quality loop
const COVERED_EXTENSIONS = new Set(['.ts', '.js', '.py', '.go', '.java', '.cs', '.rs', '.sql']);
const isCoveredFile = (file) => {
  const ext = path.extname(file).toLowerCase();
  if (COVERED_EXTENSIONS.has(ext)) return true;
  if (/^docs\/artifacts\/(prd|specs|adr)\//.test(file.replace(/\\/g, '/'))) return true;
  return false;
};

const coveredStaged = stagedFiles.filter(isCoveredFile);
if (coveredStaged.length === 0) {
  // Staged files are exempt (docs, markdown, configs)
  process.exit(0);
}

// Staged files are covered — verify quality loop
if (!fs.existsSync(loopStatePath)) {
  console.error('\n❌ [Evolve AI Quality Gate Blocked]');
  console.error(`You have staged ${coveredStaged.length} covered implementation file(s):`);
  coveredStaged.slice(0, 5).forEach(f => console.error(`  • ${f}`));
  if (coveredStaged.length > 5) console.error(`  ... and ${coveredStaged.length - 5} more`);
  console.error('\nNo active or completed Quality Loop found in .evolve/state/loop-state.json.');
  console.error('All implementation code must undergo a verified Quality Loop before commit.');
  console.error('Fix: Run "evolve loop start -p \\"<task>\\"" and complete independent review.\n');
  process.exit(1);
}

let loopState;
try {
  loopState = JSON.parse(fs.readFileSync(loopStatePath, 'utf8'));
} catch (e) {
  console.error('\n❌ [Evolve AI Quality Gate Blocked] Corrupt loop-state.json file.\n');
  process.exit(1);
}

if (loopState.status !== 'completed') {
  console.error('\n❌ [Evolve AI Quality Gate Blocked]');
  console.error(`Loop [${loopState.loopId}] is currently "${loopState.status}".`);
  console.error(`Progress: Iteration ${loopState.currentIteration}/${loopState.minIterations} (${loopState.riskClass} risk tier).`);
  console.error('Work must be completed with an independent reviewer verdict before committing.');
  console.error('Fix: Run "evolve loop iterate" with review verdict and "evolve loop complete".\n');
  process.exit(1);
}

if (loopState.currentIteration < loopState.minIterations) {
  console.error('\n❌ [Evolve AI Quality Gate Blocked]');
  console.error(`Risk tier "${loopState.riskClass}" requires at least ${loopState.minIterations} iterations. Only ${loopState.currentIteration} recorded.\n`);
  process.exit(1);
}

const lastIter = loopState.iterations && loopState.iterations[loopState.iterations.length - 1];
if (!lastIter || !lastIter.reviewerVerdict || lastIter.reviewerVerdict.verdict !== 'approved') {
  console.error('\n❌ [Evolve AI Quality Gate Blocked]');
  console.error('Final iteration does not have an APPROVED independent reviewer verdict.\n');
  process.exit(1);
}

if (lastIter.reviewerVerdict.highFindings > 0 || lastIter.reviewerVerdict.mediumFindings > 0) {
  console.error('\n❌ [Evolve AI Quality Gate Blocked]');
  console.error(`Final iteration has ${lastIter.reviewerVerdict.highFindings} HIGH and ${lastIter.reviewerVerdict.mediumFindings} MEDIUM findings remaining.\n`);
  process.exit(1);
}

// All checks passed
console.log(`✓ [Evolve AI Quality Gate] Loop [${loopState.loopId}] approved (${loopState.currentIteration} iterations, 0 defects). Commit authorized.`);
process.exit(0);
