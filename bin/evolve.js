#!/usr/bin/env node
/**
 * bin/evolve.js — Evolve AI Forward Deployed Engineer CLI
 *
 * Unified Headless CLI for Quality Loops, Agent Fleet Dispatch,
 * Deslop Scrubbing, Stage-Gate Verification, and Golden Benchmarks.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const cwd = process.cwd();
const outDir = path.join(__dirname, '..', 'out');

// Ensure compiled code is accessible
const fdeStateStorePath = path.join(outDir, 'fde', 'fdeStateStore.js');
const loopEnginePath = path.join(outDir, 'fde', 'loopEngine.js');
const deslopScrubberPath = path.join(outDir, 'fde', 'deslopScrubber.js');
const stageGateValidatorPath = path.join(outDir, 'fde', 'stageGateValidator.js');

if (!fs.existsSync(loopEnginePath)) {
  console.error('Error: Evolve AI build output not found. Please run "npm run compile" first.');
  process.exit(1);
}

const { FdeStateStore } = require(fdeStateStorePath);
const { LoopEngine } = require(loopEnginePath);
const { DeslopScrubber } = require(deslopScrubberPath);
const { StageGateValidator } = require(stageGateValidatorPath);

const args = process.argv.slice(2);
const command = args[0] || 'help';

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') || arg.startsWith('-')) {
      const key = arg.replace(/^-+/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(args.slice(1));

  try {
    if (command === 'loop') {
      const sub = args[1] || 'status';
      const store = FdeStateStore.getInstance(cwd);
      const engine = new LoopEngine(cwd, store);

      if (sub === 'status') {
        const res = engine.getStatus();
        console.log(res.message);
        if (res.loop) {
          console.log('\nLoop Details:');
          console.log(`  ID: ${res.loop.loopId}`);
          console.log(`  Task: ${res.loop.taskTitle}`);
          console.log(`  Risk Tier: ${res.loop.riskClass} (min iterations: ${res.loop.minIterations})`);
          console.log(`  Iterations Recorded: ${res.loop.currentIteration}`);
          res.loop.iterations.forEach(it => {
            const v = it.reviewerVerdict ? `[Verdict: ${it.reviewerVerdict.verdict} by ${it.reviewerVerdict.reviewerId}]` : '[No Verdict]';
            console.log(`    #${it.iteration}: ${it.summary} ${v}`);
          });
        }
      } else if (sub === 'start') {
        const title = flags.p || flags.prompt || flags.title || args[2] || 'Unspecified Task';
        const risk = flags.c || flags.class || flags.risk || 'standard';
        const issue = flags.i || flags.issue;
        const res = await engine.startLoop({ taskTitle: title, riskClass: risk, issueId: issue });
        console.log(`✓ Quality Loop started: [${res.loopId}] for task "${res.taskTitle}" (${res.riskClass} tier, min ${res.minIterations} iterations)`);
      } else if (sub === 'iterate') {
        const summary = flags.s || flags.summary || args[2] || 'Completed work cycle';
        const evidence = flags.e || flags.evidence || 'Verification performed';
        let verdict = undefined;
        if (flags.verdict) {
          verdict = {
            verdict: flags.verdict,
            reviewerId: flags.reviewer || 'fde-reviewer-subagent',
            highFindings: parseInt(flags.high || '0', 10),
            mediumFindings: parseInt(flags.medium || '0', 10),
            lowFindings: parseInt(flags.low || '0', 10),
            notes: flags.notes
          };
        }
        const res = await engine.recordIteration({ summary, evidenceContent: evidence, reviewerVerdict: verdict });
        console.log(`✓ Iteration ${res.currentIteration}/${res.minIterations} recorded for [${res.loopId}]. ${verdict ? `Verdict: ${verdict.verdict}` : ''}`);
      } else if (sub === 'complete') {
        const summary = flags.s || flags.summary || 'Task completed and verified';
        const evidence = flags.e || flags.evidence || 'Final evidence passing';
        const res = await engine.completeLoop(summary, evidence);
        console.log(`✓ Quality Loop [${res.loopId}] COMPLETED successfully with approved review. Commits unlocked.`);
      } else if (sub === 'reset') {
        await engine.resetLoop();
        console.log('✓ Quality Loop state reset.');
      } else {
        console.log(`Unknown loop command: ${sub}. Use "evolve loop [status|start|iterate|complete|reset]"`);
      }
      store.dispose();
      process.exit(0);
    } else if (command === 'scrub') {
      const targetDir = flags.Path || flags.p || cwd;
      console.log(`🔍 Running Deslop Anti-Slop Scanner over: ${targetDir}...`);
      const report = DeslopScrubber.scrubDirectory(targetDir);
      console.log(`\nScan Complete:`);
      console.log(`  Scanned Files: ${report.scannedFilesCount}`);
      console.log(`  Clean Files: ${report.cleanFilesCount}`);
      console.log(`  Total Findings: ${report.totalFindings} (${report.blockingCount} blocking, ${report.advisoryCount} advisory)`);
      if (report.findings.length > 0) {
        console.log('\nFindings:');
        report.findings.forEach(f => {
          const rel = path.relative(cwd, f.file);
          console.log(`  [${f.severity.toUpperCase()}] ${rel}:${f.line} - ${f.message}`);
          console.log(`    > ${f.snippet}`);
        });
      }
      process.exit(report.isClean ? 0 : 1);
    } else if (command === 'stage-gate') {
      const stage = args[1] || flags.stage;
      const file = args[2] || flags.file || flags.Path;
      if (!stage || !file) {
        console.error('Usage: evolve stage-gate <requirements|architecture|ux|review|certification> <path-to-file>');
        process.exit(1);
      }
      const validator = new StageGateValidator(cwd);
      const res = validator.validate(stage, file);
      console.log(`\nStage-Gate Result for [${stage.toUpperCase()}]: ${res.passed ? '✓ PASSED' : '❌ BLOCKED'} (Score: ${res.score}/100)`);
      if (res.findings.length > 0) {
        res.findings.forEach(f => {
          console.log(`  [${f.severity.toUpperCase()}] ${f.rule}: ${f.message}`);
        });
      }
      process.exit(res.passed ? 0 : 1);
    } else {
      console.log(`
Evolve AI — Forward Deployed Engineer CLI

Usage:
  evolve loop <status|start|iterate|complete|reset> [options]
  evolve scrub [-Path <dir>]
  evolve stage-gate <stage> <file>
  evolve help

Examples:
  evolve loop start -p "Implement Inbound Webhook Studio" -c complex-delivery
  evolve loop iterate -s "Scaffolded Stripe receiver" -e "HMAC verified" --verdict approved --reviewer fde-reviewer
  evolve loop complete -s "Verified end to end" -e "Test harness pass"
  evolve scrub -Path src/
  evolve stage-gate architecture docs/artifacts/adr/ADR-001.md
`);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
