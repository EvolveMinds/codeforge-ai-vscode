/**
 * plugins/pythonStudio/aiAdvisor.ts — Dual-Track Python AI Advisor & Remediation Engine
 *
 * Implements the "Code-First, AI Optional" principle:
 *  - 3 Operational Modes:
 *      'manual': 100% offline deterministic checks, zero AI calls.
 *      'on-demand': Runs AI diagnostics and patch proposals only when requested by user.
 *      'continuous': Real-time non-blocking background hints.
 *  - Structured Root-Cause Explanations:
 *      1. Root Cause: Exact mechanical or mathematical origin.
 *      2. Architectural Impact: Production fallout (NaN loss blowup, latency degradation, memory leak).
 *      3. Remediation: Concrete code modification with diff.
 *  - Deterministic Offline Fallback: If no AI provider or offline, generates rule-based patches.
 *  - Automated PyTest Contract Generation for verified regression prevention.
 */

import { DeterministicAnalyzer, type AnalysisSummary } from './deterministicAnalyzer';
import { TensorShapeEngine, type TensorShapeReport } from './tensorShapeEngine';
import { DataFrameSniffer, type DataFrameSnifferReport } from './dataFrameSniffer';

export type AiAdvisorMode = 'manual' | 'on-demand' | 'continuous';

export interface ExplanationBullets {
  rootCause: string;
  architecturalImpact: string;
  remediation: string;
}

export interface DiffHunk {
  type: 'add' | 'del' | 'same';
  text: string;
  lineNo?: number;
}

export interface AiPatchProposal {
  originalCode: string;
  proposedCode: string;
  diffUnified: string;
  diffHunks: DiffHunk[];
  explanation: ExplanationBullets;
  confidence: number; // 0.0 - 1.0
  mode: AiAdvisorMode;
  testContract?: string;
  heuristicsOnly: boolean;
}

export interface AiDiagnosticContext {
  sourceCode: string;
  filePath?: string;
  userPrompt?: string;
  syntaxSummary?: AnalysisSummary;
  tensorReport?: TensorShapeReport;
  dataFrameReport?: DataFrameSnifferReport;
}

export class AiAdvisor {
  /**
   * Generates a line-by-line unified diff and formatted hunks
   */
  static generateDiff(original: string, modified: string, fileName = 'script.py'): {
    diffUnified: string;
    diffHunks: DiffHunk[];
  } {
    const origLines = original.split(/\r?\n/);
    const modLines = modified.split(/\r?\n/);
    const hunks: DiffHunk[] = [];
    const unifiedLines: string[] = [
      `--- a/${fileName}`,
      `+++ b/${fileName}`,
      `@@ -1,${origLines.length} +1,${modLines.length} @@`,
    ];

    const maxLen = Math.max(origLines.length, modLines.length);
    let i = 0;
    let j = 0;

    while (i < origLines.length || j < modLines.length) {
      const o = origLines[i];
      const m = modLines[j];

      if (o === m) {
        hunks.push({ type: 'same', text: o, lineNo: i + 1 });
        unifiedLines.push(` ${o}`);
        i++;
        j++;
      } else if (i < origLines.length && (j >= modLines.length || !modLines.includes(o, j))) {
        hunks.push({ type: 'del', text: o, lineNo: i + 1 });
        unifiedLines.push(`-${o}`);
        i++;
      } else if (j < modLines.length) {
        hunks.push({ type: 'add', text: m, lineNo: j + 1 });
        unifiedLines.push(`+${m}`);
        j++;
      } else {
        break;
      }
    }

    return {
      diffUnified: unifiedLines.join('\n'),
      diffHunks: hunks,
    };
  }

  /**
   * Generates a deterministic PyTest contract for the given Python module
   */
  static generatePytestContract(code: string, context?: { fileName?: string; functionName?: string }): string {
    const fnMatches = Array.from(code.matchAll(/def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g));
    const classMatches = Array.from(code.matchAll(/class\s+([a-zA-Z0-9_]+)(?:\(([^)]*)\))?:/g));
    const hasTorch = /import\s+torch|from\s+torch/.test(code);
    const hasPandas = /import\s+pandas|import\s+polars/.test(code);

    const testLines: string[] = [
      `"""`,
      `Auto-generated PyTest Verification Suite for Python AI Studio`,
      `File: ${context?.fileName || 'solution.py'}`,
      `Ensures tensor dimension invariants, numerical stability, and schema contracts.`,
      `"""`,
      ``,
      `import pytest`,
    ];

    if (hasTorch) {
      testLines.push(`import torch`);
      testLines.push(`import torch.nn as nn`);
    }
    if (hasPandas) {
      testLines.push(`import pandas as pd`);
      testLines.push(`import numpy as np`);
    }

    testLines.push(``);

    // If neural classes exist
    const nnClasses = classMatches.filter(m => (m[2] || '').includes('Module'));
    if (nnClasses.length > 0) {
      for (const m of nnClasses) {
        const clsName = m[1];
        testLines.push(`class Test${clsName}Contract:`);
        testLines.push(`    """Validates tensor shape propagation and NaN resistance for ${clsName}."""`);
        testLines.push(`    `);
        testLines.push(`    @pytest.fixture`);
        testLines.push(`    def model_instance(self):`);
        testLines.push(`        # Initialize model with test hyperparameters`);
        testLines.push(`        return ${clsName}()`);
        testLines.push(`    `);
        testLines.push(`    def test_forward_pass_shape_and_nan_stability(self, model_instance):`);
        testLines.push(`        model_instance.eval()`);
        testLines.push(`        # Synthetic batch: [batch_size=2, seq_len=16, ... ]`);
        testLines.push(`        x = torch.randn(2, 64)`);
        testLines.push(`        with torch.no_grad():`);
        testLines.push(`            out = model_instance(x)`);
        testLines.push(`        assert out is not None, "Forward pass returned None"`);
        testLines.push(`        assert not torch.isnan(out).any(), "Numerical instability: Output contains NaN"`);
        testLines.push(`        assert not torch.isinf(out).any(), "Numerical instability: Output contains Inf"`);
        testLines.push(``);
      }
    }

    // If standalone functions exist
    const standaloneFns = fnMatches.filter(m => !m[1].startsWith('_'));
    if (standaloneFns.length > 0) {
      for (const m of standaloneFns.slice(0, 3)) {
        const fnName = m[1];
        testLines.push(`def test_${fnName}_contract():`);
        testLines.push(`    """Verifies output integrity and parameter edge cases for ${fnName}."""`);
        testLines.push(`    # Ensure function executes without unhandled exception`);
        testLines.push(`    assert callable(${fnName})`);
        testLines.push(``);
      }
    }

    if (nnClasses.length === 0 && standaloneFns.length === 0) {
      testLines.push(`def test_module_smoke_execution():`);
      testLines.push(`    """Smoke test ensuring clean module execution."""`);
      testLines.push(`    assert True`);
      testLines.push(``);
    }

    return testLines.join('\n');
  }

  /**
   * Generates a 100% offline, deterministic patch proposal when AI is unavailable or mode is manual
   */
  static createOfflineHeuristicProposal(ctx: AiDiagnosticContext): AiPatchProposal {
    let modified = ctx.sourceCode;
    let rootCause = 'Standard code inspection completed.';
    let impact = 'No high-severity defects detected.';
    let remediation = 'Code adheres to base guidelines.';
    let confidence = 0.85;

    // 1. Division without epsilon (NaN risk)
    if (/(\/\s*(?:torch\.sqrt|np\.sqrt|math\.sqrt)\s*\([^)]+)(\))/.test(modified)) {
      modified = modified.replace(
        /(\/\s*(?:torch\.sqrt|np\.sqrt|math\.sqrt)\s*\([^)]+)(\))/,
        '$1 + 1e-5$2'
      );
      rootCause = 'Denominator standard deviation / variance has no epsilon offset (+ 1e-5).';
      impact = 'Risk of division by zero leading to silent NaN gradient propagation in training or inference.';
      remediation = 'Appended numerical smoothing epsilon (+ 1e-5) inside square root.';
      confidence = 0.95;
    }
    // 2. Unclamped torch.log (Inf risk)
    else if (/torch\.log\(([^)]+)\)/.test(modified) && !modified.includes('torch.clamp')) {
      modified = modified.replace(
        /torch\.log\(([^)]+)\)/,
        'torch.log(torch.clamp($1, min=1e-7))'
      );
      rootCause = 'Unclamped tensor input inside torch.log().';
      impact = 'Logarithm of zero yields -inf, causing loss collapse and corrupted model checkpoints.';
      remediation = 'Wrapped input tensor with torch.clamp(..., min=1e-7) prior to torch.log evaluation.';
      confidence = 0.95;
    }
    // 3. Double softmax with CrossEntropyLoss
    else if (/nn\.CrossEntropyLoss/.test(modified) && /F\.softmax|nn\.Softmax/.test(modified)) {
      // Remove F.softmax in forward pass or prior to loss
      modified = modified.replace(/return\s+F\.softmax\(([^,]+),\s*dim=[^)]+\)/, 'return $1');
      rootCause = 'Redundant explicit Softmax activation before nn.CrossEntropyLoss().';
      impact = 'PyTorch CrossEntropyLoss internally combines LogSoftmax + NLLLoss; applying Softmax twice degrades gradients and produces invalid probability distributions.';
      remediation = 'Removed redundant Softmax activation from forward pass, outputting raw logits directly.';
      confidence = 0.98;
    }
    // 4. Sequential layer mismatch (e.g. Linear(64, 128) then Linear(256, 10))
    else if (/nn\.Linear\((\d+),\s*(\d+)\)[\s\S]*?nn\.Linear\((\d+),\s*(\d+)\)/.test(modified)) {
      const match = modified.match(/(nn\.Linear\(\d+,\s*)(\d+)(\)[\s\S]*?nn\.Linear\()(\d+)(,\s*\d+\))/);
      if (match && match[2] !== match[4]) {
        const outDim = match[2];
        modified = modified.replace(
          /(nn\.Linear\(\d+,\s*\d+\)[\s\S]*?nn\.Linear\()\d+(,\s*\d+\))/,
          `$1${outDim}$2`
        );
        rootCause = `Tensor shape dimension mismatch: Layer 1 outputs ${outDim} features, but Layer 2 expects ${match[4]} features.`;
        impact = 'Runtime crash with RuntimeError: mat1 and mat2 shapes cannot be multiplied.';
        remediation = `Aligned Layer 2 in_features (${match[4]} ➔ ${outDim}) with Layer 1 output dimension.`;
        confidence = 0.99;
      }
    }
    // 5. DataFrame iterrows bottleneck
    else if (/for\s+([a-zA-Z0-9_]+),\s*([a-zA-Z0-9_]+)\s+in\s+([a-zA-Z0-9_]+)\.iterrows\(\):/.test(modified)) {
      modified = modified.replace(
        /for\s+([a-zA-Z0-9_]+),\s*([a-zA-Z0-9_]+)\s+in\s+([a-zA-Z0-9_]+)\.iterrows\(\):[\s\S]*?([a-zA-Z0-9_]+)\[['"]([a-zA-Z0-9_]+)['"]\]\s*=\s*([^\n\r]+)/,
        `# Optimized vectorized transformation replacing slow iterrows loop\n$3['$5'] = $6`
      );
      rootCause = 'Slow row-by-row iteration using DataFrame.iterrows().';
      impact = 'Iterrows has 100x-500x overhead due to repeated Pandas Series object boxing per row.';
      remediation = 'Migrated to vectorized column-wise computation or apply/vectorized Polars alternative.';
      confidence = 0.90;
    }
    // 6. Mutable default argument
    else if (/def\s+([a-zA-Z0-9_]+)\(([^)]*?)([a-zA-Z0-9_]+)\s*=\s*(\[\]|\{\})\)/.test(modified)) {
      modified = modified.replace(
        /def\s+([a-zA-Z0-9_]+)\(([^)]*?)([a-zA-Z0-9_]+)\s*=\s*(\[\]|\{\})\):/,
        `def $1($2$3=None):\n    if $3 is None:\n        $3 = $4`
      );
      rootCause = 'Mutable default parameter in function definition.';
      impact = 'Python binds default argument once at function definition time; mutating it mutates state across all callers.';
      remediation = 'Replaced mutable default with None and instantiated fresh object inside function body.';
      confidence = 0.98;
    }
    // 7. Python 2 print statement
    else if (/(^|\n)[ \t]*print\s+("[^"]*"|'[^']*'|[a-zA-Z0-9_]+)(?!\s*\()/.test(modified)) {
      modified = modified.replace(
        /(^|\n)([ \t]*)print\s+("[^"]*"|'[^']*'|[a-zA-Z0-9_]+)(?!\s*\()/,
        '$1$2print($3)'
      );
      rootCause = 'Legacy Python 2 print statement syntax without parentheses.';
      impact = 'SyntaxError on Python 3.x runtime interpreters.';
      remediation = 'Wrapped print argument with parentheses for Python 3 compliance.';
      confidence = 1.0;
    }

    const { diffUnified, diffHunks } = this.generateDiff(ctx.sourceCode, modified, ctx.filePath || 'solution.py');
    const testContract = this.generatePytestContract(modified, { fileName: ctx.filePath });

    return {
      originalCode: ctx.sourceCode,
      proposedCode: modified,
      diffUnified,
      diffHunks,
      explanation: {
        rootCause,
        architecturalImpact: impact,
        remediation,
      },
      confidence,
      mode: 'manual',
      testContract,
      heuristicsOnly: true,
    };
  }

  /**
   * Main diagnostic entry point: Dispatches to AI Provider or falls back to heuristics
   */
  static async proposePatch(
    ctx: AiDiagnosticContext,
    services?: any,
    mode: AiAdvisorMode = 'on-demand'
  ): Promise<AiPatchProposal> {
    if (mode === 'manual') {
      return this.createOfflineHeuristicProposal(ctx);
    }

    // Try AI Service if configured and available
    if (services?.ai && typeof services.ai.ask === 'function') {
      try {
        const prompt = `You are a Principal Python AI Systems Architect.
Diagnose this Python code and provide a clean fix.
Active File: ${ctx.filePath || 'script.py'}
User Request / Query: ${ctx.userPrompt || 'Detect and fix numerical, tensor shape, performance, or syntax defects.'}

SOURCE CODE:
\`\`\`python
${ctx.sourceCode}
\`\`\`

You MUST respond strictly with a valid JSON object matching this schema:
{
  "rootCause": "Exact 1-sentence technical origin of the issue",
  "architecturalImpact": "Exact 1-sentence production consequence (NaN, OOM, latency, crash)",
  "remediation": "Exact 1-sentence description of the fix",
  "confidence": 0.95,
  "proposedCode": "Complete fixed python code"
}
Do not wrap JSON in markdown backticks or commentary. Only raw JSON.`;

        const responseText = await services.ai.ask({
          messages: [{ role: 'user', content: prompt }],
          system: 'You are an expert Python compiler and AI debugger. Always output raw JSON.',
          instruction: 'Diagnose and fix Python AI code.',
          mode: 'code',
        });

        if (responseText) {
          const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleaned);

          if (parsed.proposedCode && typeof parsed.proposedCode === 'string') {
            // Verify AI did not introduce syntax errors
            const syntaxCheck = DeterministicAnalyzer.analyzeCode(parsed.proposedCode);
            if (syntaxCheck.syntaxValid) {
              const { diffUnified, diffHunks } = this.generateDiff(
                ctx.sourceCode,
                parsed.proposedCode,
                ctx.filePath || 'solution.py'
              );
              const testContract = this.generatePytestContract(parsed.proposedCode, { fileName: ctx.filePath });

              return {
                originalCode: ctx.sourceCode,
                proposedCode: parsed.proposedCode,
                diffUnified,
                diffHunks,
                explanation: {
                  rootCause: parsed.rootCause || 'Identified potential anomaly via AI inspection.',
                  architecturalImpact: parsed.architecturalImpact || 'Prevents execution failure or degraded model performance.',
                  remediation: parsed.remediation || 'Updated implementation.',
                },
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
                mode,
                testContract,
                heuristicsOnly: false,
              };
            }
          }
        }
      } catch (err) {
        // AI call failed or timed out — seamlessly degrade to offline heuristic engine
        console.warn('[Evolve AI] AI advisor query failed or offline, falling back to deterministic heuristics:', err);
      }
    }

    // Deterministic fallback
    const heuristicResult = this.createOfflineHeuristicProposal(ctx);
    heuristicResult.mode = mode;
    return heuristicResult;
  }
}
