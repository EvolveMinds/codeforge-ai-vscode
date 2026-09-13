/**
 * Test Suite: Code Converter Core Engine & Polyglot Language Specifications
 */

import * as assert from 'assert';
import { DesktopIpcHandlers } from '../../desktop/main/ipcHandlers';
import { DESKTOP_CHANNELS } from '../../desktop/shared/eventChannels';
import {
  LANGUAGES,
  languageById,
  deriveOutRelPath,
  buildConvertPrompt,
  parseConversionResult,
  CONVERT_SYSTEM,
  ConversionSpec,
  SourceFile
} from '../../core/codeConvert';

suite('Code Converter Core Engine — 26-Language Multi-Target Specifications', function () {
  this.timeout(15000);

  test('Catalogue contains exactly 26 enterprise languages with valid specifications', () => {
    assert.strictEqual(LANGUAGES.length, 26, 'Should define exactly 26 supported languages');

    const expectedLanguages = [
      'python', 'typescript', 'javascript', 'java', 'csharp',
      'go', 'rust', 'cpp', 'c', 'kotlin', 'swift', 'scala',
      'ruby', 'php', 'dart', 'elixir', 'r', 'sql', 'bash',
      'powershell', 'lua', 'perl', 'vba', 'cobol', 'matlab', 'sas'
    ];

    for (const id of expectedLanguages) {
      const spec = languageById(id);
      assert.ok(spec, `Language '${id}' should exist in catalogue`);
      assert.ok(spec.ext.startsWith('.'), `Extension for '${id}' must start with a dot`);
      assert.ok(spec.idioms.length > 0, `Language '${id}' must have at least one idiom`);
    }
  });

  test('SAS specification contains correct extension, DATA step/PROC FCMP idioms and syntax pitfalls', () => {
    const sas = languageById('sas');
    assert.ok(sas, 'SAS spec must exist');
    assert.strictEqual(sas.ext, '.sas');
    assert.strictEqual(sas.fence, 'sas');

    // Check idioms
    const idiomText = sas.idioms.join(' ');
    assert.ok(idiomText.includes('DATA steps'), 'Must guide model to use DATA steps for row processing');
    assert.ok(idiomText.includes('PROC FCMP'), 'Must guide model to use PROC FCMP for callable functions');
    assert.ok(idiomText.includes('semicolon'), 'Must guide model that statements require semicolons');
    assert.ok(idiomText.includes('/* comment */'), 'Must guide model on SAS comment syntax');

    // Check pitfalls
    assert.ok(sas.pitfalls && sas.pitfalls.length > 0, 'SAS must define pitfalls');
    const pitfallText = sas.pitfalls.join(' ');
    assert.ok(pitfallText.includes('curly braces'), 'Must warn against curly braces');
    assert.ok(pitfallText.includes('//'), 'Must warn against double-slash comments');
    assert.ok(pitfallText.includes('for item in data'), 'Must guide model on translating Python record iterations');
  });

  test('COBOL, VBA, MATLAB, and Perl specifications include explicit idioms and pitfalls', () => {
    const cobol = languageById('cobol');
    assert.ok(cobol && cobol.ext === '.cbl');
    assert.ok(cobol.pitfalls && cobol.pitfalls.some(p => p.includes('Area A')));

    const vba = languageById('vba');
    assert.ok(vba && vba.ext === '.bas');
    assert.ok(vba.pitfalls && vba.pitfalls.some(p => p.includes('Set')));

    const matlab = languageById('matlab');
    assert.ok(matlab && matlab.ext === '.m');
    assert.ok(matlab.pitfalls && matlab.pitfalls.some(p => p.includes('1-based indexing')));

    const perl = languageById('perl');
    assert.ok(perl && perl.ext === '.pl');
    assert.ok(perl.pitfalls && perl.pitfalls.some(p => p.includes('Sigil')));
  });

  test('deriveOutRelPath creates correct target extensions', () => {
    const sasSpec = languageById('sas')!;
    assert.strictEqual(deriveOutRelPath('active_module.py', sasSpec), 'active_module.sas');
    assert.strictEqual(deriveOutRelPath('src/utils/calc.ts', sasSpec), 'src/utils/calc.sas');

    const cobolSpec = languageById('cobol')!;
    assert.strictEqual(deriveOutRelPath('orders.py', cobolSpec), 'orders.cbl');

    const vbaSpec = languageById('vba')!;
    assert.strictEqual(deriveOutRelPath('calc.py', vbaSpec), 'Calc.bas');
  });

  test('CONVERT_SYSTEM includes non-negotiable rule 6 for paradigm adaptation', () => {
    assert.ok(CONVERT_SYSTEM.includes('6. PARADIGM ADAPTATION'));
    assert.ok(CONVERT_SYSTEM.includes('DATA step'));
    assert.ok(CONVERT_SYSTEM.includes('PROC FCMP'));
  });

  test('buildConvertPrompt includes target idioms and fidelity guidance', () => {
    const spec: ConversionSpec = {
      target: 'sas',
      source: 'python',
      fidelity: 'idiomatic',
      dependencies: 'popular',
      includeTests: false,
      keepComments: true,
      emitManifest: false,
      framework: '',
      notes: ''
    };

    const sourceFiles: SourceFile[] = [{
      absPath: '/workspace/metrics.py',
      relPath: 'metrics.py',
      content: 'def calculate_metrics(data):\n    return [item["value"] * 2 for item in data]\n',
      langId: 'python'
    }];

    const prompt = buildConvertPrompt(spec, sourceFiles);
    assert.ok(prompt.includes('Convert the following file from Python to SAS.'));
    assert.ok(prompt.includes('DATA steps with SET statements'));
    assert.ok(prompt.includes('PROC FCMP'));
    assert.ok(prompt.includes('Never emit curly braces'));
    assert.ok(prompt.includes('metrics.py'));
  });

  test('parseConversionResult extracts valid SAS code blocks and structured report', () => {
    const spec: ConversionSpec = {
      target: 'sas',
      source: 'python',
      fidelity: 'idiomatic',
      dependencies: 'popular',
      includeTests: false,
      keepComments: true,
      emitManifest: false,
      framework: '',
      notes: ''
    };

    const sourceFiles: SourceFile[] = [{
      absPath: '/workspace/active_module.py',
      relPath: 'active_module.py',
      content: 'def calculate_metrics(data):\n    return [item["value"] * 2 for item in data]\n',
      langId: 'python'
    }];

    const mockAiOutput = `
\`\`\`sas path=active_module.sas
/* Converted from Python to SAS */
data result;
    set data;
    value_doubled = value * 2;
run;
\`\`\`

\`\`\`json
{
  "summary": "Converted Python record loop to SAS DATA step.",
  "confidence": "high",
  "dependencies": [],
  "notes": [
    {
      "severity": "info",
      "title": "Row-by-row iteration transformed",
      "detail": "Replaced in-memory Python list loop with native SAS DATA step dataset processing."
    }
  ],
  "manualSteps": [],
  "setup": []
}
\`\`\`
`;

    const res = parseConversionResult(mockAiOutput, spec, sourceFiles);
    assert.strictEqual(res.files.length, 1);
    assert.strictEqual(res.files[0].relPath, 'active_module.sas');
    assert.ok(res.files[0].content.includes('data result;'));
    assert.ok(res.files[0].content.includes('set data;'));
    assert.strictEqual(res.report.confidence, 'high');
    assert.strictEqual(res.report.notes.length, 1);
    assert.strictEqual(res.report.notes[0].title, 'Row-by-row iteration transformed');
  });

  test('DesktopIpcHandlers DESKTOP_CHANNELS.CONVERTER.CONVERT processes Python -> SAS correctly', async () => {
    const registeredChannels = new Map<string, Function>();
    const mockIpcMain = {
      handle: (channel: string, listener: Function) => {
        registeredChannels.set(channel, listener);
      }
    };

    const handlers = new DesktopIpcHandlers({
      workspaceMgr: {} as any,
      terminalMgr: { onCwdChange: () => {} } as any,
      licenseAuth: {} as any,
      secretVault: {} as any,
      updater: {} as any
    });

    handlers.registerAll(mockIpcMain);

    const convFn = registeredChannels.get(DESKTOP_CHANNELS.CONVERTER.CONVERT)!;
    assert.ok(convFn !== undefined, 'CONVERTER.CONVERT must be registered');

    const res = await convFn(null, {
      sourceCode: `def calculate_metrics(data):\n    result = []\n    for item in data:\n        result.append(item['value'] * 2)\n    return result`,
      fromLang: 'python',
      toLang: 'sas'
    });

    assert.strictEqual(res.targetLang, 'SAS');
    assert.strictEqual(res.targetExt, '.sas');
    assert.ok(res.targetFileName.endsWith('.sas'), `Target filename must end with .sas, got ${res.targetFileName}`);
    assert.ok(res.convertedCode.toUpperCase().includes('DATA') || res.convertedCode.toUpperCase().includes('PROC'), 'Must contain SAS DATA step or PROC');
    assert.ok(!res.convertedCode.startsWith('path='), 'Must strip header path declarations from converted code body');
    assert.ok(!res.convertedCode.includes('function calculate_metrics(data) {'), 'Must not produce JS function in SAS');
    assert.ok(!res.convertedCode.includes('// Transpiled target code for SAS'), 'Must not produce // comments in SAS');
    assert.ok(!res.convertedCode.includes('//'), 'Must not produce // C-style comments in SAS');
    assert.ok(res.fidelityReport.mappedPatterns.length > 0);
  });

  test('DesktopIpcHandlers generates valid deterministic fallback for SAS and COBOL when offline', async () => {
    const registeredChannels = new Map<string, Function>();
    const mockIpcMain = {
      handle: (channel: string, listener: Function) => {
        registeredChannels.set(channel, listener);
      }
    };

    const handlers = new DesktopIpcHandlers({
      workspaceMgr: {} as any,
      terminalMgr: { onCwdChange: () => {} } as any,
      licenseAuth: {} as any,
      secretVault: {} as any,
      updater: {} as any
    });

    handlers.registerAll(mockIpcMain);
    const convFn = registeredChannels.get(DESKTOP_CHANNELS.CONVERTER.CONVERT)!;

    // Force fallback using an invalid model name so local Ollama rejects it
    const sasRes = await convFn(null, {
      sourceCode: `def process(x):\n    return x * 2`,
      fromLang: 'python',
      toLang: 'sas',
      model: '__FORCE_OFFLINE_FALLBACK__'
    });

    assert.strictEqual(sasRes.targetLang, 'SAS');
    assert.strictEqual(sasRes.targetExt, '.sas');
    assert.ok(sasRes.convertedCode.includes('/* ====================================================================='));
    assert.ok(sasRes.convertedCode.includes('data calculated_metrics;'));
    assert.ok(sasRes.convertedCode.includes('proc fcmp'));
    assert.ok(!sasRes.convertedCode.includes('function process(x) {'));
    assert.ok(!sasRes.convertedCode.includes('//'));

    const cobolRes = await convFn(null, {
      sourceCode: `def calculate(n):\n    return n + 1`,
      fromLang: 'python',
      toLang: 'cobol',
      model: '__FORCE_OFFLINE_FALLBACK__'
    });

    assert.strictEqual(cobolRes.targetLang, 'COBOL');
    assert.strictEqual(cobolRes.targetExt, '.cbl');
    assert.ok(cobolRes.convertedCode.includes('IDENTIFICATION DIVISION.'));
    assert.ok(cobolRes.convertedCode.includes('PROCEDURE DIVISION.'));
  });

});

