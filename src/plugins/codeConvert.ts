/**
 * plugins/codeConvert.ts — Code Converter plugin for Evolve AI
 *
 * "Convert this to Go" is the easiest thing to ask an AI and one of the easiest
 * to get subtly, expensively wrong. This plugin is built around that fact.
 *
 * The flow it enforces:
 *
 *   choose source  →  choose target + how faithful  →  convert  →  REVIEW  →  save
 *                                                                    ↑
 *                                            refine · syntax-check · undo
 *
 * Four things make it more than a prompt:
 *
 *  1. Nothing is written until the review is accepted. Converted code lives in
 *     memory next to the original, with a fidelity report, until the user says
 *     save. A rejected conversion leaves no litter in the workspace.
 *
 *  2. Batches convert together. A folder is sent as one unit (chunked only when
 *     it would blow the context budget), so shared types and cross-file calls
 *     stay consistent instead of each file inventing its own vocabulary.
 *
 *  3. It checks its own work. Where the target toolchain is on PATH, the
 *     converted files are parsed locally and failures are fed back to the model
 *     as a repair round — the user never has to copy a compiler error by hand.
 *
 *  4. Refinement is incremental. "Return errors instead of panicking" re-emits
 *     only the affected files, and every round is snapshotted so Undo works.
 *
 * All conversion knowledge (languages, idioms, prompts, output contract, report
 * parsing) lives in core/codeConvert.ts. This file is orchestration: picking
 * files, calling the AI, running checks, and writing to disk.
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import type { IPlugin, PluginCommand } from '../core/plugin';
import type { IServices } from '../core/services';
import type { AIRequest } from '../core/aiService';
import { runCommand }     from '../core/processUtil';
import type { ProviderName } from '../core/aiService';
import {
  LANGUAGES, FIDELITY_CHOICES, DEPENDENCY_CHOICES,
  CONVERT_SYSTEM, defaultSpec, languageById, languageLabel, detectSourceLanguage,
  buildConvertPrompt, buildRefinePrompt, buildRepairPrompt, buildSlicePrompt,
  parseConversionResult, renderReportMarkdown, reportHeadline, deriveOutRelPath,
  sliceSource, stitchSlices, declarationIndex, estimateConversion, sliceBudgetChars,
} from '../core/codeConvert';
import type {
  ConversionSpec, ConversionReport, ConvertedFile, SourceFile, FileSlice,
  Fidelity, DependencyPolicy, LanguageSpec,
} from '../core/codeConvert';
import {
  describeModel, assessFit, estimateTokens, suggestBiggerModels, tierLabel,
} from '../core/modelCapability';
import type { ModelCapability, FitAssessment } from '../core/modelCapability';
import { CodeConvertPanel } from '../ui/codeConvertPanel';
import type { ConvertCatalog, PanelConvertOptions, QueuedSource, TargetChoice, ModelStatus } from '../ui/codeConvertPanel';
import { ConversionReviewPanel } from '../ui/conversionReviewPanel';
import type { ReviewFile } from '../ui/conversionReviewPanel';

// ── Limits ───────────────────────────────────────────────────────────────────

/** Directories that never hold source worth converting. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', 'build', 'bin', 'obj', '.vscode', '.vscode-test',
  '__pycache__', 'venv', '.venv', 'env', 'coverage', 'target', '.next', '.nuxt', 'vendor',
  '.idea', '.gradle', 'Pods', 'DerivedData', '.terraform', '.mypy_cache', '.pytest_cache',
]);

/** A single file larger than this is almost certainly generated or vendored. */
const MAX_FILE_BYTES = 400_000;

const CLOUD_PROVIDERS = ['anthropic', 'openai', 'gemini', 'zai', 'huggingface'];

// ── Session state ────────────────────────────────────────────────────────────

interface CheckResult { ok: boolean; detail: string }

/**
 * The model this feature runs on. Null provider means "whatever the user has
 * configured globally" — the override exists so conversion can use a bigger
 * model than chat without the user switching back and forth.
 */
interface ModelChoice {
  provider: ProviderName | null;
  model: string | null;
}

/** A model choice resolved against the running system, with its real limits. */
interface ResolvedModel {
  provider: ProviderName;
  model: string;
  cap: ModelCapability;
  /** True when this came from the user's global settings rather than an override. */
  isDefault: boolean;
}

/**
 * One request's worth of work. Either a group of whole files, or one slice of a
 * file too big to convert in a single pass.
 */
type WorkUnit =
  | { kind: 'batch'; files: SourceFile[] }
  | { kind: 'slice'; slice: FileSlice; outRelPath: string };

interface Session {
  spec:      ConversionSpec;
  sources:   SourceFile[];
  files:     ConvertedFile[];
  report:    ConversionReport;
  /** Absolute directory converted files are written into. */
  outRoot:   string;
  /** Snapshots for Undo, oldest first. */
  history:   Array<{ files: ConvertedFile[]; report: ConversionReport }>;
  saved:     Set<string>;
  checks:    Map<string, CheckResult>;
  isSelection: boolean;
  raw:       string;
  abort:     AbortController | null;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export class CodeConvertPlugin implements IPlugin {
  readonly id          = 'codeConvert';
  readonly displayName = 'Code Converter';
  readonly icon        = '$(arrow-swap)';

  private _session: Session | null = null;

  /** Model override for conversion. Persists for the session; empty = global default. */
  private _choice: ModelChoice = { provider: null, model: null };

  private _lastActiveEditor: vscode.TextEditor | null = null;
  private _lastSelection: { editor: vscode.TextEditor; text: string } | null = null;

  async detect(_ws: vscode.WorkspaceFolder | undefined): Promise<boolean> {
    return true;
  }

  async activate(_services: IServices, _vsCtx: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
    this._lastActiveEditor = vscode.window.activeTextEditor ?? null;
    return [
      vscode.languages.registerCodeActionsProvider(
        { scheme: 'file' },
        new ConvertCodeActionProvider(),
        { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
      ),
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (ed && !ed.document.isUntitled && ed.document.uri.scheme === 'file') {
          this._lastActiveEditor = ed;
          if (!ed.selection.isEmpty) {
            this._lastSelection = { editor: ed, text: ed.document.getText(ed.selection) };
          }
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor && e.selections.length > 0 && !e.selections[0].isEmpty && e.textEditor.document.uri.scheme === 'file') {
          this._lastActiveEditor = e.textEditor;
          this._lastSelection = {
            editor: e.textEditor,
            text: e.textEditor.document.getText(e.selections[0]),
          };
        }
      }),
    ];
  }

  // ── Domain knowledge ──────────────────────────────────────────────────────
  // Deliberately short. Its only job is to stop the chat from producing a
  // confident one-shot port when a reviewable conversion is a command away.
  systemPromptSection(): string {
    return [
      '## Code conversion',
      'When the user asks to port or convert code between languages:',
      '- Preserve behaviour exactly, including error paths, numeric precision, ordering and null handling.',
      '- Never invent library APIs. If unsure an API exists, use the standard library and say so.',
      '- State plainly what you approximated and what needs human review — do not present a port as finished.',
      '- For anything larger than a snippet, point the user at "Evolve AI: Convert Code" (the Code Convertor mode),',
      '  which converts files or folders together and shows the result beside the original with a fidelity report.',
    ].join('\n');
  }

  // ── Commands ──────────────────────────────────────────────────────────────
  readonly commands: PluginCommand[] = [
    {
      id: 'aiForge.convert.start',
      title: 'Convert: Open Code Converter',
      handler: async (services) => this._openPanel(services),
    },
    {
      id: 'aiForge.convert.file',
      title: 'Convert: Convert Active File',
      handler: async (services, ...args) => this._convertActiveFile(services, args),
    },
    {
      id: 'aiForge.convert.selection',
      title: 'Convert: Convert Selection',
      handler: async (services) => this._convertSelection(services),
    },
    {
      id: 'aiForge.convert.folder',
      title: 'Convert: Convert Folder / Project',
      handler: async (services, ...args) => this._convertFolder(services, args),
    },
    {
      id: 'aiForge.convert.model',
      title: 'Convert: Choose AI Model for Code Conversion',
      handler: async (services) => {
        const before = await this._resolveModel(services);
        if (!await this._pickModel(services, 0)) return;
        const after = await this._resolveModel(services);
        const ctxK = Math.round(after.cap.contextTokens / 1000);
        vscode.window.showInformationMessage(
          after.isDefault
            ? `Evolve AI: code conversion follows your default model again (${after.model}).`
            : `Evolve AI: code conversion will use ${after.model} — ${ctxK}k context, ${tierLabel(after.cap.tier).toLowerCase()}. ` +
              `Your default (${before.isDefault ? before.model : defaultModelFor(await services.ai.detectProvider(), vscode.workspace.getConfiguration('aiForge'))}) is unchanged for chat and everything else.`,
        );
      },
    },
    {
      id: 'aiForge.convert.review',
      title: 'Convert: Reopen Last Conversion Review',
      handler: async (services) => {
        if (!this._session) {
          vscode.window.showInformationMessage('Evolve AI: no conversion in progress. Run "Convert Code" to start one.');
          return;
        }
        this._openReview(services);
      },
    },
    {
      id: 'aiForge.convert.verify',
      title: 'Convert: Check Converted Code Parses',
      handler: async (services) => {
        if (!this._session) {
          vscode.window.showInformationMessage('Evolve AI: nothing to check — convert something first.');
          return;
        }
        await this._verify(services);
      },
    },
  ];

  // ══ Entry points ══════════════════════════════════════════════════════════

  /** The friendly panel — the "Code Convertor" mode in the chat opens this. */
  private async _openPanel(services: IServices): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('aiForge');
    let spec = this._specFromSettings();
    let sources: SourceFile[] = [];

    // Pre-load whatever the user is looking at, so the common case is one click.
    let ed = vscode.window.activeTextEditor ?? this._lastActiveEditor ?? null;
    if (!ed || ed.document.isClosed) {
      ed = vscode.window.visibleTextEditors.find(e => !e.document.isUntitled && !e.document.isClosed && e.document.uri.scheme === 'file') ?? null;
    }
    if (ed && !ed.document.isUntitled && ed.document.uri.scheme === 'file') {
      this._lastActiveEditor = ed;
      const s = this._sourceFromDocument(ed.document);
      if (s.langId) sources = [s];
    }

    const catalog: ConvertCatalog = {
      targets: LANGUAGES.map((l): TargetChoice => ({ id: l.id, label: l.label, group: l.group, ext: l.ext })),
      fidelity:     FIDELITY_CHOICES.map(f => ({ id: f.id, label: f.label, description: f.description })),
      dependencies: DEPENDENCY_CHOICES.map(d => ({ id: d.id, label: d.label, description: d.description })),
      defaults: {
        target:       spec.target,
        fidelity:     spec.fidelity,
        dependencies: spec.dependencies,
        includeTests: spec.includeTests,
        keepComments: spec.keepComments,
        emitManifest: spec.emitManifest,
      },
    };

    let isSelection = false;

    const panel = CodeConvertPanel.show(catalog, async (msg) => {
      switch (msg.type) {
        case 'useActiveFile': {
          let activeEd = vscode.window.activeTextEditor ?? this._lastActiveEditor ?? null;
          if (!activeEd || activeEd.document.isClosed) {
            activeEd = vscode.window.visibleTextEditors.find(e => !e.document.isUntitled && !e.document.isClosed && e.document.uri.scheme === 'file') ?? null;
          }
          let doc = activeEd?.document;

          // If no doc directly in editor, check open workspace tabs/documents
          if (!doc || doc.isClosed) {
            const openDocs = vscode.workspace.textDocuments.filter(d => !d.isUntitled && !d.isClosed && d.uri.scheme === 'file' && !d.fileName.includes('extension-output'));
            if (openDocs.length === 1) {
              doc = openDocs[0];
            } else if (openDocs.length > 1) {
              const pick = await vscode.window.showQuickPick(
                openDocs.map(d => ({
                  label: path.basename(d.fileName),
                  description: vscode.workspace.asRelativePath(d.fileName),
                  doc: d,
                })),
                { placeHolder: 'Select an open file to convert' }
              );
              if (pick) doc = pick.doc;
              else return;
            } else {
              // Fallback to open dialog
              const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Select file to convert' });
              if (picked?.[0]) {
                doc = await vscode.workspace.openTextDocument(picked[0]);
              } else {
                panel.setStatus('No file is open in the editor. Use "Choose files…" to select one.');
                return;
              }
            }
          }

          const s = this._sourceFromDocument(doc);
          if (!s.langId) {
            panel.setStatus(`Evolve AI does not recognise ${path.extname(s.relPath) || 'that file type'} as source code it can convert.`);
            return;
          }
          sources = [s]; isSelection = false;
          panel.setStatus(`Queued active file: ${path.basename(doc.fileName)} (${languageLabel(s.langId)}, ${s.content.split('\n').length} lines)`);
          push();
          break;
        }
        case 'useSelection': {
          let activeEd = vscode.window.activeTextEditor ?? this._lastActiveEditor ?? null;
          if (!activeEd || activeEd.document.isClosed) {
            activeEd = vscode.window.visibleTextEditors.find(e => !e.document.isUntitled && !e.document.isClosed && e.document.uri.scheme === 'file') ?? null;
          }

          let selText = (activeEd && !activeEd.selection.isEmpty)
            ? activeEd.document.getText(activeEd.selection)
            : (this._lastSelection?.text || '');
          let doc = activeEd?.document ?? this._lastSelection?.editor?.document;

          if (!selText.trim()) {
            if (doc && !doc.isClosed) {
              const choice = await vscode.window.showQuickPick(
                [
                  { label: `Convert entire file: ${path.basename(doc.fileName)}`, action: 'entire' },
                  { label: 'Paste a code snippet to convert...', action: 'paste' },
                ],
                { placeHolder: 'No text is currently highlighted in the editor' }
              );
              if (!choice) return;
              if (choice.action === 'entire') {
                const s = this._sourceFromDocument(doc);
                if (!s.langId) {
                  panel.setStatus(`Evolve AI does not recognise ${path.extname(s.relPath) || 'that file type'} as source code.`);
                  return;
                }
                sources = [s]; isSelection = false;
                panel.setStatus(`Queued file: ${path.basename(doc.fileName)} (${languageLabel(s.langId)})`);
                push();
                return;
              } else if (choice.action === 'paste') {
                const pasted = await vscode.window.showInputBox({
                  prompt: 'Paste the code snippet you want to convert',
                  placeHolder: 'e.g. def calculate_total(items): ...',
                });
                if (!pasted?.trim()) return;
                selText = pasted;
              }
            } else {
              const pasted = await vscode.window.showInputBox({
                prompt: 'Paste the code snippet you want to convert',
                placeHolder: 'e.g. def calculate_total(items): ...',
              });
              if (!pasted?.trim()) {
                panel.setStatus('Highlight code in an editor or paste a snippet to convert.');
                return;
              }
              selText = pasted;
            }
          }

          const langId = doc ? detectSourceLanguage(doc.fileName, doc.languageId) : (spec.source || 'python');
          const relPath = doc ? this._rel(doc.fileName) : 'snippet';
          sources = [{
            absPath: doc?.uri.fsPath || '',
            relPath,
            content: selText,
            langId: langId || 'python',
          }];
          isSelection = true;
          panel.setStatus(`Queued code selection (${selText.split('\n').length} lines)`);
          push();
          break;
        }
        case 'browseFiles': {
          const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Convert' });
          if (!picked?.length) return;
          const loaded = picked.map(u => this._sourceFromPath(u.fsPath)).filter((s): s is SourceFile => !!s);
          if (!loaded.length) { panel.setStatus('None of those files are in a language Evolve AI can convert.'); return; }
          sources = this._rebase(loaded);
          isSelection = false;
          push();
          break;
        }
        case 'browseFolder': {
          const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Convert folder' });
          const dir = picked?.[0]?.fsPath;
          if (!dir) return;
          const found = this._collectFolder(dir);
          if (!found.length) { panel.setStatus(`No convertible source files found in ${path.basename(dir)}.`); return; }
          sources = found;
          isSelection = false;
          const cap = cfg.get<number>('convert.maxFiles', 20);
          panel.setStatus(found.length >= cap
            ? `Queued ${found.length} files (the ${cap}-file cap from aiForge.convert.maxFiles). Convert in batches for larger trees.`
            : `Queued ${found.length} file${found.length === 1 ? '' : 's'} from ${path.basename(dir)}.`);
          push();
          break;
        }
        case 'removeSource':
          sources = sources.filter(s => s.relPath !== msg.relPath);
          push();
          break;
        case 'clearSources':
          sources = []; isSelection = false;
          push();
          break;
        case 'setOptions':
          spec = this._specFromPanel(msg.options, spec);
          void this._refreshModelStatus(services, panel, sources, spec);
          break;
        case 'pickModel': {
          const est = sources.length
            ? estimateConversion(sources, spec, estimateTokens)
            : { promptTokens: 0, outputTokens: 0, sourceChars: 0 };
          const changed = await this._pickModel(services, est.promptTokens + est.outputTokens);
          if (changed) await this._refreshModelStatus(services, panel, sources, spec);
          break;
        }
        case 'cancel':
          this._session?.abort?.abort();
          panel.setStatus('Cancelled.');
          break;
        case 'convert': {
          if (!sources.length) { panel.setStatus('Pick something to convert first.'); return; }
          if (!spec.target)    { panel.setStatus('Pick a target language.'); return; }
          spec.source = sources[0].langId;
          if (spec.source === spec.target) {
            panel.setStatus(`That is already ${languageLabel(spec.target)}. Pick a different target.`);
            return;
          }
          // Refuse to start a job the model demonstrably cannot do, and offer
          // the fix rather than letting it fail halfway through.
          const rm = await this._resolveModel(services);
          if (rm.provider === 'offline') {
            panel.setStatus('The offline provider cannot convert code — choose a model first.');
            const changed = await this._pickModel(services, 0);
            if (changed) await this._refreshModelStatus(services, panel, sources, spec);
            return;
          }
          const fitNow = this._assess(sources, spec, rm.cap);
          if (fitNow.verdict === 'impossible') {
            const choice = await vscode.window.showWarningMessage(
              `${rm.model} can't convert this: ${fitNow.headline}.`,
              { modal: true, detail: fitNow.advice },
              'Choose a Different Model',
            );
            if (choice === 'Choose a Different Model') {
              const changed = await this._pickModel(services, fitNow.promptTokens + fitNow.outputTokens);
              if (changed) await this._refreshModelStatus(services, panel, sources, spec);
            }
            return;
          }
          if (fitNow.verdict === 'split') {
            const choice = await vscode.window.showWarningMessage(
              `This is bigger than ${rm.model} can take in one pass.`,
              {
                modal: true,
                detail: `${fitNow.headline}\n\n${fitNow.advice}\n\nSplitting works, but each pass sees less ` +
                  `of the whole, so cross-file consistency is weaker than a single pass.`,
              },
              `Split into ${fitNow.slices} passes`, 'Choose a Bigger Model',
            );
            if (!choice) { panel.setStatus('Cancelled — nothing was sent.'); return; }
            if (choice === 'Choose a Bigger Model') {
              const changed = await this._pickModel(services, fitNow.promptTokens + fitNow.outputTokens);
              if (changed) await this._refreshModelStatus(services, panel, sources, spec);
              return;
            }
          }

          const ok = await this._confirmCloud(services, sources);
          if (!ok) { panel.setStatus('Cancelled — nothing was sent.'); return; }

          const tick = startTicker(s => panel.setElapsed(s));
          panel.setBusy(`Converting ${sources.length} file${sources.length === 1 ? '' : 's'} to ${languageLabel(spec.target)}…`);
          try {
            const done = await this._runConversion(services, sources, spec, isSelection,
              (m) => panel.setBusy(m));
            panel.setBusy(null);
            panel.setElapsed(0);
            if (done) {
              panel.setStatus(`✓ Converted — ${reportHeadline(done)}. The review is open; nothing has been written yet.`);
            } else {
              panel.setStatus('Conversion did not produce any code. Try again, or convert fewer files at once.');
            }
          } catch (e) {
            panel.setBusy(null);
            panel.setStatus(`✗ ${String(e instanceof Error ? e.message : e)}`);
          } finally {
            tick.stop();
          }
          break;
        }
      }
    });

    const push = () => {
      const queued: QueuedSource[] = sources.map(s => ({
        relPath:   s.relPath,
        langLabel: languageLabel(s.langId),
        lines:     s.content.split('\n').length,
        isSelection,
      }));
      const langs = [...new Set(sources.map(s => languageLabel(s.langId)))];
      panel.setSources(queued, langs.length ? `Detected: ${langs.join(', ')}` : '');
      // The fit verdict depends on what's queued, so it is recomputed here
      // rather than only when the model changes.
      void this._refreshModelStatus(services, panel, sources, spec);
    };

    push();
    await this._providerHint(services, panel);
  }

  /** Quick path: convert the active file with a target picked from a quick pick. */
  private async _convertActiveFile(services: IServices, args: unknown[]): Promise<void> {
    const uri = args.find((a): a is vscode.Uri => a instanceof vscode.Uri);
    const doc = uri
      ? await vscode.workspace.openTextDocument(uri)
      : vscode.window.activeTextEditor?.document;
    if (!doc) { vscode.window.showWarningMessage('Evolve AI: open a file to convert, or use "Convert Code" for the full converter.'); return; }

    const source = this._sourceFromDocument(doc);
    if (!source.langId) {
      vscode.window.showWarningMessage(`Evolve AI: ${path.basename(doc.fileName)} is not in a language the converter recognises.`);
      return;
    }
    const spec = await this._pickSpecQuick(source.langId);
    if (!spec) return;
    await this._convertWithProgress(services, [source], spec, false);
  }

  private async _convertSelection(services: IServices): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) {
      vscode.window.showWarningMessage('Evolve AI: select the code you want converted first.');
      return;
    }
    const source = this._sourceFromSelection(ed);
    const spec = await this._pickSpecQuick(source.langId);
    if (!spec) return;
    await this._convertWithProgress(services, [source], spec, true);
  }

  private async _convertFolder(services: IServices, args: unknown[]): Promise<void> {
    const uri = args.find((a): a is vscode.Uri => a instanceof vscode.Uri);
    let dir = uri?.fsPath;
    if (!dir) {
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Convert folder' });
      dir = picked?.[0]?.fsPath;
    }
    if (!dir) return;

    const sources = this._collectFolder(dir);
    if (!sources.length) {
      vscode.window.showWarningMessage(`Evolve AI: no convertible source files found in ${path.basename(dir)}.`);
      return;
    }
    const spec = await this._pickSpecQuick(sources[0].langId);
    if (!spec) return;

    const proceed = await vscode.window.showInformationMessage(
      `Convert ${sources.length} file${sources.length === 1 ? '' : 's'} from ${path.basename(dir)} to ${languageLabel(spec.target)}?`,
      { modal: true, detail: 'They are converted together so cross-file references stay consistent. Nothing is written until you approve the review.' },
      'Convert',
    );
    if (proceed !== 'Convert') return;
    await this._convertWithProgress(services, sources, spec, false);
  }

  // ══ Conversion ════════════════════════════════════════════════════════════

  /** Notification-progress wrapper for the non-panel entry points. */
  private async _convertWithProgress(
    services: IServices,
    sources: SourceFile[],
    spec: ConversionSpec,
    isSelection: boolean,
  ): Promise<void> {
    if (!await this._checkFitInteractive(services, sources, spec)) return;
    if (!await this._confirmCloud(services, sources)) return;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Evolve AI: converting to ${languageLabel(spec.target)}…`,
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => this._session?.abort?.abort());
        const report = await this._runConversion(services, sources, spec, isSelection,
          (m) => progress.report({ message: m }));
        if (!report) {
          vscode.window.showWarningMessage('Evolve AI: the conversion returned no code. Try again, or convert fewer files at once.');
        }
      },
    );
  }

  /**
   * The core round. Sizes the job against the chosen model, splits it into
   * units that each fit, streams every unit, stitches sliced files back
   * together, merges the reports, and opens the review.
   */
  private async _runConversion(
    services: IServices,
    sources: SourceFile[],
    spec: ConversionSpec,
    isSelection: boolean,
    onProgress: (message: string) => void,
  ): Promise<ConversionReport | null> {
    const rm    = await this._resolveModel(services);
    const fit   = this._assess(sources, spec, rm.cap);
    const units = this._plan(sources, spec, rm.cap);

    const abort = new AbortController();
    const files: ConvertedFile[] = [];
    let   merged: ConversionReport | null = null;
    let   raw = '';
    let   done = 0;   // units completed

    // Slice bookkeeping: pieces of each sliced output file, in order, plus the
    // running declaration index that keeps later slices consistent with earlier ones.
    const slicePieces = new Map<string, string[]>();
    const sliceDecls  = new Map<string, string[]>();
    const sliceOrigin = new Map<string, string>();

    // Provisional session so Cancel from any surface reaches this abort.
    this._session = {
      spec, sources, files: [], report: emptyReport(), outRoot: this._outRoot(sources, spec, isSelection),
      history: [], saved: new Set(), checks: new Map(), isSelection, raw: '', abort,
    };

    // Room for the response is reserved inside the window, and Ollama is told
    // the window explicitly — otherwise it silently drops the front of the prompt.
    const perUnitOutput = Math.min(
      rm.cap.maxOutputTokens,
      Math.max(1_024, Math.ceil(fit.outputTokens / Math.max(1, units.length)) + 512),
    );

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const label = unit.kind === 'slice'
        ? `${path.basename(unit.slice.source.relPath)} — part ${unit.slice.index} of ${unit.slice.total}`
        : `${unit.files.length} file${unit.files.length === 1 ? '' : 's'}`;
      onProgress(units.length > 1
        ? `Pass ${i + 1} of ${units.length} · ${label}…`
        : `Converting ${label} to ${languageLabel(spec.target)}…`);

      const prompt = unit.kind === 'slice'
        ? buildSlicePrompt(spec, unit.slice, unit.outRelPath, sliceDecls.get(unit.outRelPath) ?? [])
        : buildConvertPrompt(spec, unit.files, {
            isSelection,
            projectContext: units.length > 1
              ? `This is pass ${i + 1} of ${units.length} from one codebase. Already converted: ` +
                `${files.map(f => f.relPath).join(', ') || 'nothing yet'}. Keep names, types and helper ` +
                `APIs consistent with them.`
              : undefined,
          });

      const req: AIRequest = {
        messages:    [{ role: 'user', content: prompt }],
        system:      CONVERT_SYSTEM,
        instruction: `convert ${spec.source || 'code'} → ${spec.target}`,
        mode:        'new',
        signal:      abort.signal,
        providerOverride: rm.isDefault ? undefined : rm.provider,
        modelOverride:    rm.isDefault ? undefined : rm.model,
        maxOutputTokens:  perUnitOutput,
        contextTokens:    isOllamaBacked(rm.provider) ? rm.cap.contextTokens : undefined,
      };

      let out = '';
      try {
        for await (const chunk of services.ai.stream(req)) {
          if (abort.signal.aborted) break;
          out += chunk;
        }
      } catch (e) {
        if (abort.signal.aborted) break;
        throw e;
      }
      if (abort.signal.aborted) break;

      raw += (raw ? '\n\n' : '') + out;

      if (unit.kind === 'slice') {
        // Slices are accumulated and stitched once the file is complete —
        // pushing each as its own file would leave the user with main-1.go,
        // main-2.go and no working file at all.
        const result = parseConversionResult(out, spec, [unit.slice.source]);
        const body = result.files.map(f => f.content).join('\n\n');
        const key = unit.outRelPath;
        if (!slicePieces.has(key)) { slicePieces.set(key, []); sliceOrigin.set(key, unit.slice.source.relPath); }
        slicePieces.get(key)!.push(body);
        sliceDecls.set(key, [...(sliceDecls.get(key) ?? []), ...declarationIndex(body)].slice(0, 60));
        merged = merged ? mergeReports(merged, result.report) : result.report;
      } else {
        const result = parseConversionResult(out, spec, unit.files);
        files.push(...result.files);
        merged = merged ? mergeReports(merged, result.report) : result.report;
      }
      done++;
    }

    // Stitch every sliced file back into one.
    for (const [relPath, pieces] of slicePieces) {
      files.push({
        relPath,
        content: stitchSlices(pieces),
        lang: languageById(spec.target)?.fence ?? '',
        fromRelPath: sliceOrigin.get(relPath),
      });
    }

    if (!files.length) { this._session = null; return null; }

    const report = merged ?? emptyReport();

    // Slicing is a compromise and the report says so. The seams between parts
    // are exactly where a conversion goes wrong, and the reader should know
    // which files have seams at all.
    if (slicePieces.size) {
      const names = [...slicePieces.keys()].join(', ');
      report.notes.unshift({
        severity: 'warn',
        title: 'Large file converted in parts and rejoined',
        detail: `${names} exceeded what ${rm.model} can convert in one pass, so it was split at top-level ` +
          `boundaries, converted part by part, and joined back together. Each part saw the declarations from ` +
          `the parts before it, but check the joins: duplicated or missing imports, and anything that spanned ` +
          `a boundary. A model with a larger context window would convert it in one piece.`,
      });
    }

    // Cancelling partway leaves real work on the table. Keeping it is better
    // than binning it, but a partial result that looks complete is worse than
    // either — so it says so, at the top of the report.
    if (abort.signal.aborted && done < units.length) {
      report.confidence = 'low';
      report.notes.unshift({
        severity: 'action',
        title: 'Conversion was cancelled partway through',
        detail: `${done} of ${units.length} passes completed. The rest were never sent, so code is missing ` +
          `and what is here may reference it.`,
      });
    }
    this._session = {
      spec, sources, files, report,
      outRoot: this._outRoot(sources, spec, isSelection),
      history: [], saved: new Set(), checks: new Map(), isSelection, raw,
      abort: null,
    };

    this._openReview(services);
    return report;
  }

  // ══ Review ════════════════════════════════════════════════════════════════

  private _openReview(services: IServices): void {
    const s = this._session;
    if (!s) return;

    const panel = ConversionReviewPanel.show(async (msg) => {
      const sess = this._session;
      if (!sess) return;
      switch (msg.type) {
        case 'refine':  await this._refine(services, msg.text); break;
        case 'cancel':  sess.abort?.abort(); break;
        case 'undo': {
          const prev = sess.history.pop();
          if (!prev) { panel.setStatus('Nothing left to undo.'); return; }
          sess.files  = prev.files;
          sess.report = prev.report;
          sess.checks.clear();
          this._pushReview(panel);
          panel.setStatus('Reverted the last change.');
          break;
        }
        case 'saveAll':  await this._saveAll(services, panel);  break;
        case 'saveOne':  await this._saveOne(services, panel, msg.relPath); break;
        case 'copy': {
          const f = sess.files.find(x => x.relPath === msg.relPath);
          if (f) { await vscode.env.clipboard.writeText(f.content); panel.setStatus(`Copied ${f.relPath} to the clipboard.`); }
          break;
        }
        case 'verify':   await this._verify(services); break;
        case 'openSource': {
          const f = sess.files[0];
          const src = sess.sources.find(x => x.relPath === f?.fromRelPath) ?? sess.sources[0];
          if (src && fs.existsSync(src.absPath)) {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(src.absPath)));
          }
          break;
        }
        case 'discard': {
          const unsaved = sess.files.filter(f => !sess.saved.has(f.relPath)).length;
          const ok = await vscode.window.showWarningMessage(
            'Discard this conversion?',
            { modal: true, detail: unsaved ? `${unsaved} converted file${unsaved === 1 ? ' has' : 's have'} not been saved and will be lost.` : 'All files were already saved; only the review closes.' },
            'Discard',
          );
          if (ok === 'Discard') { this._session = null; panel.dispose(); }
          break;
        }
      }
    });

    this._pushReview(panel);
    panel.setStatus(`${reportHeadline(s.report)} — review it, refine it, then save.`);
  }

  private _pushReview(panel: ConversionReviewPanel): void {
    const s = this._session;
    if (!s) return;
    const files: ReviewFile[] = s.files.map(f => {
      const src = s.sources.find(x => x.relPath === f.fromRelPath);
      const check = s.checks.get(f.relPath);
      return {
        relPath:       f.relPath,
        content:       f.content,
        lang:          f.lang,
        fromRelPath:   f.fromRelPath,
        sourceContent: src?.content,
        sourceLang:    src ? (languageById(src.langId)?.fence ?? '') : '',
        check,
        saved:         s.saved.has(f.relPath),
      };
    });
    panel.update({
      sourceLabel: s.spec.source ? languageLabel(s.spec.source) : 'Source',
      targetLabel: languageLabel(s.spec.target),
      outputRoot:  this._displayRoot(s.outRoot),
      files,
      report:      s.report,
      canUndo:     s.history.length > 0,
    });
  }

  // ── Refinement ────────────────────────────────────────────────────────────

  private async _refine(services: IServices, instruction: string): Promise<void> {
    const s = this._session;
    const panel = ConversionReviewPanel.current;
    if (!s || !panel) return;

    const abort = new AbortController();
    s.abort = abort;
    const tick = startTicker(secs => panel.setElapsed(secs));
    panel.setBusy('Applying your change…');
    panel.addHistory(instruction);

    try {
      // Refinement re-emits whole files, so it needs the same room the original
      // conversion had — inheriting chat's 4096-token default would truncate it.
      const rm = await this._resolveModel(services);
      const req: AIRequest = {
        messages:    [{ role: 'user', content: buildRefinePrompt(s.spec, s.files, instruction) }],
        system:      CONVERT_SYSTEM,
        instruction: 'refine conversion',
        mode:        'new',
        signal:      abort.signal,
        providerOverride: rm.isDefault ? undefined : rm.provider,
        modelOverride:    rm.isDefault ? undefined : rm.model,
        maxOutputTokens:  rm.cap.maxOutputTokens,
        contextTokens:    isOllamaBacked(rm.provider) ? rm.cap.contextTokens : undefined,
      };
      let out = '';
      for await (const chunk of services.ai.stream(req)) {
        if (abort.signal.aborted) break;
        out += chunk;
      }
      if (abort.signal.aborted) { panel.setStatus('Stopped — nothing changed.'); return; }

      const result = parseConversionResult(out, s.spec, s.sources);
      if (!result.files.length) { panel.setStatus('No change came back. Try rephrasing the request.'); return; }

      // Snapshot before mutating so Undo always has somewhere to go.
      s.history.push({ files: s.files.map(f => ({ ...f })), report: { ...s.report } });

      const changed: string[] = [];
      for (const nf of result.files) {
        const i = s.files.findIndex(f => f.relPath === nf.relPath);
        if (i >= 0) {
          // Keep the source attribution — the refine prompt doesn't carry it.
          s.files[i] = { ...nf, fromRelPath: nf.fromRelPath ?? s.files[i].fromRelPath };
        } else {
          s.files.push(nf);
        }
        changed.push(nf.relPath);
        s.checks.delete(nf.relPath);
        s.saved.delete(nf.relPath);
      }
      s.report = mergeReports(s.report, result.report);

      this._pushReview(panel);
      panel.setStatus(`Updated ${changed.length} file${changed.length === 1 ? '' : 's'}: ${changed.join(', ')}. Undo is available.`);
    } catch (e) {
      panel.setStatus(`✗ ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      tick.stop();
      s.abort = null;
      panel.setBusy(null);
      panel.setElapsed(0);
    }
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  private async _saveAll(services: IServices, panel: ConversionReviewPanel): Promise<void> {
    const s = this._session;
    if (!s) return;

    const targets = s.files.map(f => path.join(s.outRoot, f.relPath));
    const clashes = targets.filter(t => fs.existsSync(t));
    const detail =
      `Writing to ${this._displayRoot(s.outRoot)}\n\n` +
      s.files.map(f => `  ${f.relPath}`).join('\n') +
      (clashes.length ? `\n\n⚠ ${clashes.length} file${clashes.length === 1 ? '' : 's'} already exist${clashes.length === 1 ? 's' : ''} and will be overwritten.` : '') +
      `\n\nA conversion report is written alongside them.`;

    const ok = await vscode.window.showInformationMessage(
      `Save ${s.files.length} converted file${s.files.length === 1 ? '' : 's'}?`,
      { modal: true, detail },
      'Save', 'Choose a different folder…',
    );
    if (!ok) return;

    if (ok === 'Choose a different folder…') {
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Save here' });
      if (!picked?.[0]) return;
      s.outRoot = picked[0].fsPath;
    }

    for (const f of s.files) {
      const abs = path.join(s.outRoot, f.relPath);
      // The parser already confines model-supplied paths, but this is the last
      // point before a write — verify rather than assume.
      if (!isInside(abs, s.outRoot)) {
        vscode.window.showErrorMessage(`Evolve AI: refused to write "${f.relPath}" — it resolves outside the output folder.`);
        continue;
      }
      await services.workspace.writeFile(abs, f.content, false);
      s.saved.add(f.relPath);
    }

    const reportPath = path.join(s.outRoot, 'CONVERSION-REPORT.md');
    await services.workspace.writeFile(
      reportPath,
      renderReportMarkdown(s.report, s.spec, s.files, s.sources),
      false,
    );

    this._pushReview(panel);
    panel.setStatus(`✓ Saved ${s.files.length} file${s.files.length === 1 ? '' : 's'} to ${this._displayRoot(s.outRoot)}, plus CONVERSION-REPORT.md`);

    const first = s.files[0];
    const next = await vscode.window.showInformationMessage(
      `Evolve AI: saved ${s.files.length} converted file${s.files.length === 1 ? '' : 's'} to ${this._displayRoot(s.outRoot)}.`,
      'Open Files', 'Open Report', 'Check It Parses',
    );
    if (next === 'Open Files' && first) {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(s.outRoot, first.relPath))),
      );
    } else if (next === 'Open Report') {
      await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(reportPath));
    } else if (next === 'Check It Parses') {
      await this._verify(services);
    }
  }

  private async _saveOne(services: IServices, panel: ConversionReviewPanel, relPath: string): Promise<void> {
    const s = this._session;
    const f = s?.files.find(x => x.relPath === relPath);
    if (!s || !f) return;
    const abs = path.join(s.outRoot, f.relPath);
    if (!isInside(abs, s.outRoot)) {
      vscode.window.showErrorMessage(`Evolve AI: refused to write "${f.relPath}" — it resolves outside the output folder.`);
      return;
    }
    if (fs.existsSync(abs)) {
      const ok = await vscode.window.showWarningMessage(
        `${f.relPath} already exists. Overwrite it?`, { modal: true }, 'Overwrite');
      if (ok !== 'Overwrite') return;
    }
    await services.workspace.writeFile(abs, f.content, true);
    s.saved.add(f.relPath);
    this._pushReview(panel);
    panel.setStatus(`✓ Saved ${f.relPath}`);
  }

  // ── Verification ──────────────────────────────────────────────────────────

  /**
   * Parse each converted file with the target language's own tooling, when it
   * happens to be installed. This is a syntax check, not a build — it catches
   * the class of error that makes converted code obviously broken, without
   * needing the project's dependencies to be present.
   */
  private async _verify(services: IServices): Promise<void> {
    const s = this._session;
    if (!s) return;
    const panel = ConversionReviewPanel.current;
    const target = languageById(s.spec.target);

    if (!target?.check) {
      const msg = `Evolve AI: no single-file syntax check is available for ${languageLabel(s.spec.target)} — ` +
        `build it with your own toolchain to verify.`;
      panel ? panel.setStatus(msg) : vscode.window.showInformationMessage(msg);
      return;
    }

    const tmpRoot = path.join(services.vsCtx.globalStorageUri.fsPath, 'convert-check');
    fs.mkdirSync(tmpRoot, { recursive: true });

    panel?.setBusy(`Parsing with ${target.check.cmd}…`);
    let toolMissing = false;
    let failures = 0;
    let checked  = 0;

    try {
      for (const f of s.files) {
        // Only check files in the target language — a generated go.mod or
        // README is not something gofmt has an opinion about.
        if (path.extname(f.relPath).toLowerCase() !== target.ext.toLowerCase()) continue;

        const tmpFile = path.join(tmpRoot, path.basename(f.relPath));
        fs.writeFileSync(tmpFile, f.content, 'utf8');
        const outDir = path.join(tmpRoot, 'out');
        if (target.check.writesOutput) fs.mkdirSync(outDir, { recursive: true });

        const res = await runCommand(
          target.check.cmd,
          target.check.args(tmpFile, outDir),
          { timeoutMs: 20_000, cwd: tmpRoot },
        );
        try { fs.unlinkSync(tmpFile); } catch { /* best effort */ }

        if (res === null) { toolMissing = true; break; }
        checked++;
        const ok = res.code === 0;
        if (!ok) failures++;
        s.checks.set(f.relPath, {
          ok,
          detail: ok ? 'Parses cleanly' : cleanCheckOutput(`${res.stderr}\n${res.stdout}`, tmpRoot),
        });
      }
    } finally {
      panel?.setBusy(null);
    }

    if (toolMissing) {
      const msg = `Evolve AI: could not run the ${languageLabel(s.spec.target)} check — needs ${target.check.needs}. ` +
        `Install it to have conversions verified automatically.`;
      panel ? panel.setStatus(msg) : vscode.window.showWarningMessage(msg);
      return;
    }
    if (panel) this._pushReview(panel);

    if (checked === 0) {
      panel?.setStatus('Nothing to check — no files in the target language.');
      return;
    }
    if (failures === 0) {
      const msg = `✓ All ${checked} file${checked === 1 ? '' : 's'} pass ${target.check.cmd}. ` +
        (target.check.verifies === 'syntax'
          ? 'That is syntax only — it says nothing about whether the behaviour survived. The fidelity report still needs reading.'
          : 'Imports resolve and it type-checks. Behaviour still needs review — read the fidelity report.');
      panel ? panel.setStatus(msg) : vscode.window.showInformationMessage(`Evolve AI: ${msg}`);
      return;
    }

    const msg = `${failures} of ${checked} file${checked === 1 ? '' : 's'} failed the ${target.check.cmd} check.`;
    // A 'compile' checker resolves imports, so a failure can mean the package
    // simply isn't installed on this machine. Saying so is the difference
    // between a useful warning and a misleading one.
    const caveat = target.check.verifies === 'compile'
      ? ` ${target.check.cmd} also resolves imports, so an "unresolved/not found" error may mean the dependency isn't installed here rather than that the conversion is wrong.`
      : '';
    panel?.setStatus(`✗ ${msg} Open each tab to see what ${target.check.cmd} said.${caveat}`);
    const fix = await vscode.window.showWarningMessage(
      `Evolve AI: ${msg}${caveat}`, 'Fix With AI', 'Leave It',
    );
    if (fix === 'Fix With AI') await this._repair(services, target);
  }

  /** Feed each failing file plus its checker output back for a repair round. */
  private async _repair(services: IServices, target: LanguageSpec): Promise<void> {
    const s = this._session;
    const panel = ConversionReviewPanel.current;
    if (!s) return;

    const broken = s.files.filter(f => s.checks.get(f.relPath)?.ok === false);
    if (!broken.length) return;

    s.history.push({ files: s.files.map(f => ({ ...f })), report: { ...s.report } });

    const abort = new AbortController();
    s.abort = abort;
    const tick = startTicker(secs => panel?.setElapsed(secs));
    const rm = await this._resolveModel(services);

    try {
      for (let i = 0; i < broken.length; i++) {
        const f = broken[i];
        panel?.setBusy(`Fixing ${f.relPath} (${i + 1}/${broken.length})…`);
        const errors = s.checks.get(f.relPath)?.detail ?? '';
        const req: AIRequest = {
          messages:    [{ role: 'user', content: buildRepairPrompt(s.spec, f, errors) }],
          system:      CONVERT_SYSTEM,
          instruction: `repair converted ${target.label}`,
          mode:        'new',
          signal:      abort.signal,
          providerOverride: rm.isDefault ? undefined : rm.provider,
          modelOverride:    rm.isDefault ? undefined : rm.model,
          maxOutputTokens:  rm.cap.maxOutputTokens,
          contextTokens:    isOllamaBacked(rm.provider) ? rm.cap.contextTokens : undefined,
        };
        let out = '';
        for await (const chunk of services.ai.stream(req)) {
          if (abort.signal.aborted) break;
          out += chunk;
        }
        if (abort.signal.aborted) break;

        const result = parseConversionResult(out, s.spec, s.sources);
        const fixed = result.files.find(x => x.relPath === f.relPath) ?? result.files[0];
        if (fixed) {
          const idx = s.files.findIndex(x => x.relPath === f.relPath);
          if (idx >= 0) s.files[idx] = { ...f, content: fixed.content };
          s.checks.delete(f.relPath);
          s.saved.delete(f.relPath);
        }
      }
    } catch (e) {
      panel?.setStatus(`✗ ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      tick.stop();
      s.abort = null;
      panel?.setBusy(null);
      panel?.setElapsed(0);
    }

    if (panel) this._pushReview(panel);
    // Re-check so the result of the repair is visible rather than assumed.
    await this._verify(services);
  }

  // ══ Model choice + fit ════════════════════════════════════════════════════

  /**
   * Work out which model this conversion will actually use, and what it can
   * handle. Ollama is asked directly for the model's real context length —
   * a live answer beats any table, and the table only fills the gap.
   */
  private async _resolveModel(services: IServices): Promise<ResolvedModel> {
    const cfg = vscode.workspace.getConfiguration('aiForge');
    const isDefault = !this._choice.provider;
    const provider: ProviderName = this._choice.provider ?? await services.ai.detectProvider();
    const model = this._choice.model ?? defaultModelFor(provider, cfg);

    let detected: { contextTokens?: number } | null = null;
    if (isOllamaBacked(provider) && services.ai.getOllamaModelInfo) {
      try { detected = await services.ai.getOllamaModelInfo(model); } catch { /* fall back to the table */ }
    }
    return { provider, model, cap: describeModel(model, detected ?? undefined), isDefault };
  }

  /** Size the job against the resolved model. */
  private _assess(sources: SourceFile[], spec: ConversionSpec, cap: ModelCapability): FitAssessment {
    const est = estimateConversion(sources, spec, estimateTokens);
    return assessFit(cap, est.promptTokens, est.outputTokens);
  }

  /** Push the model line + fit verdict into the panel. */
  private async _refreshModelStatus(
    services: IServices,
    panel: CodeConvertPanel,
    sources: SourceFile[],
    spec: ConversionSpec,
  ): Promise<void> {
    const rm = await this._resolveModel(services);
    const ctxK = rm.cap.contextTokens >= 1000
      ? `${Math.round(rm.cap.contextTokens / 1000)}k`
      : `${rm.cap.contextTokens}`;
    const detail =
      `${providerLabel(rm.provider)} · ${ctxK} context · ${tierLabel(rm.cap.tier)}` +
      ` (${rm.cap.source})` + (rm.isDefault ? ' · your default' : ' · set for conversion only');

    const status: ModelStatus = {
      label: rm.model || '(none configured)',
      detail,
      verdict: '', headline: '', advice: '', suggestions: [],
    };

    if (rm.provider === 'offline') {
      status.verdict = 'impossible';
      status.headline = 'The offline provider cannot convert code';
      status.advice = 'It is pattern-based, not a language model. Choose Ollama (local) or a cloud provider.';
      status.suggestions = ['ollama pull qwen2.5-coder:7b — free, local, private'];
      panel.setModel(status);
      return;
    }

    if (sources.length) {
      const fit = this._assess(sources, spec, rm.cap);
      status.verdict = fit.verdict;
      status.headline = fit.headline;
      status.advice = fit.advice;
      if (rm.cap.note && fit.verdict !== 'comfortable') {
        status.advice = `${rm.cap.note} ${status.advice}`.trim();
      }
      if (fit.verdict === 'split' || fit.verdict === 'impossible') {
        const installed = isOllamaBacked(rm.provider) ? await safeModels(services) : [];
        status.suggestions = suggestBiggerModels(
          rm.provider, installed, fit.promptTokens + fit.outputTokens);
      }
    }
    panel.setModel(status);
  }

  /**
   * Model picker. Lists what is actually installed with its real limits, so the
   * choice is informed rather than a guess at what a name implies.
   */
  private async _pickModel(services: IServices, needTokens: number): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration('aiForge');
    const current = await this._resolveModel(services);

    interface Item extends vscode.QuickPickItem { provider: ProviderName | null; model: string | null }
    const items: Item[] = [];

    const defProvider = await services.ai.detectProvider();
    items.push({
      label: '$(settings-gear) Use my default',
      description: `${providerLabel(defProvider)} · ${defaultModelFor(defProvider, cfg)}`,
      detail: 'Follow the provider and model set for the whole extension',
      provider: null, model: null,
    });

    // Installed local models, annotated with what they can actually take on.
    const installed = await safeModels(services);
    if (installed.length) {
      items.push({ label: 'Installed locally (Ollama)', kind: vscode.QuickPickItemKind.Separator, provider: null, model: null } as Item);
      for (const m of installed) {
        let detected: { contextTokens?: number } | null = null;
        if (services.ai.getOllamaModelInfo) {
          try { detected = await services.ai.getOllamaModelInfo(m); } catch { /* table fallback */ }
        }
        const cap = describeModel(m, detected ?? undefined);
        const fits = cap.contextTokens * 0.95 >= needTokens;
        const ctxK = `${Math.round(cap.contextTokens / 1000)}k`;
        items.push({
          label: `${fits ? '$(check)' : '$(warning)'} ${m}`,
          description: `${ctxK} context · ${tierLabel(cap.tier)}`,
          detail: needTokens > 0
            ? (fits ? 'Handles this job in one pass' : 'Too small for this job — it would be split into slices')
            : (cap.note ?? ''),
          provider: 'ollama', model: m,
        });
      }
    }

    // Cloud options, listed whether or not a key is stored — the provider flow
    // prompts for one, and hiding them makes the list look broken.
    items.push({ label: 'Cloud', kind: vscode.QuickPickItemKind.Separator, provider: null, model: null } as Item);
    const cloud: Array<[ProviderName, string, string]> = [
      ['anthropic', cfg.get<string>('anthropicModel', 'claude-sonnet-4-6'), 'Anthropic Claude'],
      ['openai',    cfg.get<string>('openaiModel', 'gpt-4o'),               'OpenAI / compatible'],
      ['gemini',    cfg.get<string>('geminiModel', 'gemini-2.5-flash'),     'Google Gemini'],
      ['zai',       cfg.get<string>('zaiModel', 'glm-4.6'),                 'GLM (Z.ai)'],
      ['huggingface', cfg.get<string>('huggingfaceModel', 'Qwen/Qwen2.5-Coder-32B-Instruct'), 'Hugging Face'],
    ];
    for (const [p, m, label] of cloud) {
      const cap = describeModel(m);
      items.push({
        label: `$(cloud) ${label}`,
        description: `${m} · ${Math.round(cap.contextTokens / 1000)}k context`,
        detail: needTokens > 0 && cap.contextTokens * 0.95 >= needTokens
          ? 'Handles this job in one pass — sends your source to the cloud'
          : 'Sends your source code to a cloud API',
        provider: p, model: m,
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Model for code conversion (currently ${current.model})`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return false;
    this._choice = { provider: picked.provider, model: picked.model };
    return true;
  }

  /**
   * The fit conversation for the command-palette paths, which have no panel to
   * show a live verdict in. Returns false when the user backs out.
   */
  private async _checkFitInteractive(
    services: IServices,
    sources: SourceFile[],
    spec: ConversionSpec,
  ): Promise<boolean> {
    for (;;) {
      const rm = await this._resolveModel(services);

      if (rm.provider === 'offline') {
        const pick = await vscode.window.showWarningMessage(
          'The offline provider is pattern-based and cannot convert code.',
          { modal: true, detail: 'Choose a model to use for this conversion.' },
          'Choose a Model',
        );
        if (pick !== 'Choose a Model') return false;
        if (!await this._pickModel(services, 0)) return false;
        continue;
      }

      const fit = this._assess(sources, spec, rm.cap);
      if (fit.verdict === 'comfortable') return true;

      if (fit.verdict === 'tight') {
        // Worth stating, not worth blocking on.
        vscode.window.setStatusBarMessage(`Evolve AI: ${fit.headline}`, 6000);
        return true;
      }

      const needed = fit.promptTokens + fit.outputTokens;
      const suggestions = fit.verdict === 'impossible' || fit.verdict === 'split'
        ? suggestBiggerModels(rm.provider, isOllamaBacked(rm.provider) ? await safeModels(services) : [], needed)
        : [];
      const detail = [fit.headline, '', fit.advice, ...(suggestions.length ? ['', 'Options:', ...suggestions.map(s => `• ${s}`)] : [])].join('\n');

      if (fit.verdict === 'impossible') {
        const pick = await vscode.window.showWarningMessage(
          `${rm.model} cannot convert this job.`, { modal: true, detail }, 'Choose a Different Model',
        );
        if (pick !== 'Choose a Different Model') return false;
        if (!await this._pickModel(services, needed)) return false;
        continue;
      }

      const pick = await vscode.window.showWarningMessage(
        `This is bigger than ${rm.model} can take in one pass.`,
        { modal: true, detail },
        `Split into ${fit.slices} passes`, 'Choose a Bigger Model',
      );
      if (!pick) return false;
      if (pick === 'Choose a Bigger Model') {
        if (!await this._pickModel(services, needed)) return false;
        continue;
      }
      return true;
    }
  }

  // ══ Planning: batches and slices ══════════════════════════════════════════

  /**
   * Break the job into requests that each fit the model.
   *
   * Two different problems, two different answers: many files are grouped into
   * batches (so cross-file references stay visible to the model), while a
   * single file bigger than the budget is sliced at top-level boundaries and
   * stitched back together afterwards.
   */
  private _plan(sources: SourceFile[], spec: ConversionSpec, cap: ModelCapability): WorkUnit[] {
    const target = languageById(spec.target);
    const cfgBudget = vscode.workspace.getConfiguration('aiForge').get<number>('convert.maxCharsPerBatch', 60_000);
    // The model's real capacity, capped by the user's preference — whichever is
    // smaller. A setting should be able to make requests smaller, never bigger
    // than the model can take.
    const modelBudget = sliceBudgetChars(cap.contextTokens, cap.maxOutputTokens, spec, 3.2);
    const budget = Math.max(1_000, Math.min(cfgBudget, modelBudget));

    const units: WorkUnit[] = [];
    let batch: SourceFile[] = [];
    let batchSize = 0;

    const flush = () => {
      if (batch.length) { units.push({ kind: 'batch', files: batch }); batch = []; batchSize = 0; }
    };

    for (const s of sources) {
      if (s.content.length > budget) {
        // Too big for any batch — slice it, on its own.
        flush();
        const outRelPath = target ? deriveOutRelPath(s.relPath, target) : s.relPath;
        for (const slice of sliceSource(s, budget)) {
          units.push({ kind: 'slice', slice, outRelPath });
        }
        continue;
      }
      if (batchSize + s.content.length > budget && batch.length) flush();
      batch.push(s);
      batchSize += s.content.length;
    }
    flush();
    return units;
  }

  // ══ Helpers ═══════════════════════════════════════════════════════════════

  private _specFromSettings(): ConversionSpec {
    const cfg = vscode.workspace.getConfiguration('aiForge');
    return defaultSpec({
      target:       cfg.get<string>('convert.defaultTarget', ''),
      fidelity:     cfg.get<Fidelity>('convert.fidelity', 'idiomatic'),
      dependencies: cfg.get<DependencyPolicy>('convert.dependencies', 'popular'),
      includeTests: cfg.get<boolean>('convert.includeTests', false),
      keepComments: cfg.get<boolean>('convert.keepComments', true),
      emitManifest: cfg.get<boolean>('convert.emitManifest', true),
    });
  }

  private _specFromPanel(o: PanelConvertOptions, prev: ConversionSpec): ConversionSpec {
    return {
      ...prev,
      target:       o.target,
      fidelity:     (['idiomatic', 'literal', 'modernise'] as Fidelity[]).includes(o.fidelity as Fidelity)
                      ? o.fidelity as Fidelity : prev.fidelity,
      dependencies: (['stdlib', 'popular', 'mirror'] as DependencyPolicy[]).includes(o.dependencies as DependencyPolicy)
                      ? o.dependencies as DependencyPolicy : prev.dependencies,
      includeTests: o.includeTests,
      keepComments: o.keepComments,
      emitManifest: o.emitManifest,
      framework:    o.framework.trim(),
      notes:        o.notes.trim(),
    };
  }

  /** Target + options via quick picks, for the command-palette paths. */
  private async _pickSpecQuick(sourceLang: string): Promise<ConversionSpec | undefined> {
    const base = this._specFromSettings();
    const items = LANGUAGES
      .filter(l => l.id !== sourceLang)
      .map(l => ({
        label: `$(symbol-file) ${l.label}`,
        description: l.ext,
        detail: l.id === base.target ? `${l.group} · your default target` : l.group,
        id: l.id,
      }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: sourceLang ? `Convert ${languageLabel(sourceLang)} to…` : 'Convert to…',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return undefined;

    const fid = await vscode.window.showQuickPick(
      FIDELITY_CHOICES.map(f => ({ label: f.label, detail: f.description, id: f.id })),
      { placeHolder: 'How faithful should the conversion be?' },
    );
    if (!fid) return undefined;

    return { ...base, source: sourceLang, target: picked.id, fidelity: fid.id };
  }

  private _sourceFromDocument(doc: vscode.TextDocument): SourceFile {
    const abs = doc.uri.fsPath;
    return {
      absPath: abs,
      relPath: this._rel(abs),
      content: doc.getText(),
      langId:  detectSourceLanguage(abs, doc.languageId),
    };
  }

  private _sourceFromSelection(ed: vscode.TextEditor): SourceFile {
    const abs = ed.document.uri.fsPath;
    return {
      absPath: abs,
      relPath: this._rel(abs),
      content: ed.document.getText(ed.selection),
      langId:  detectSourceLanguage(abs, ed.document.languageId),
    };
  }

  private _sourceFromPath(abs: string): SourceFile | null {
    const langId = detectSourceLanguage(abs);
    if (!langId) return null;
    try {
      if (fs.statSync(abs).size > MAX_FILE_BYTES) return null;
      return { absPath: abs, relPath: this._rel(abs), content: fs.readFileSync(abs, 'utf8'), langId };
    } catch { return null; }
  }

  /** Recursively gather convertible files under `dir`, bounded and de-noised. */
  private _collectFolder(dir: string): SourceFile[] {
    const cap = Math.max(1, vscode.workspace.getConfiguration('aiForge').get<number>('convert.maxFiles', 20));
    const found: string[] = [];
    const walk = (d: string, depth: number) => {
      if (found.length >= cap || depth > 6) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (found.length >= cap) return;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          walk(full, depth + 1);
        } else if (detectSourceLanguage(full)) {
          found.push(full);
        }
      }
    };
    walk(dir, 0);

    // Rebase paths on the chosen folder so the output mirrors its structure.
    const loaded: SourceFile[] = [];
    for (const f of found) {
      const s = this._sourceFromPath(f);
      if (!s) continue;
      loaded.push({ ...s, relPath: path.relative(dir, f).replace(/\\/g, '/') });
    }
    // Convert the dominant language; a stray .sh next to 40 .py files only
    // confuses the model about what it is porting.
    const counts = new Map<string, number>();
    for (const s of loaded) counts.set(s.langId, (counts.get(s.langId) ?? 0) + 1);
    let dominant = '';
    let best = 0;
    for (const [id, n] of counts) if (n > best) { best = n; dominant = id; }
    return loaded.filter(s => s.langId === dominant);
  }

  /** Give a set of hand-picked files relative paths against their common folder. */
  private _rebase(files: SourceFile[]): SourceFile[] {
    if (files.length < 2) return files;
    const dirs = files.map(f => path.dirname(f.absPath).split(/[\\/]/));
    let common = dirs[0];
    for (const d of dirs.slice(1)) {
      const next: string[] = [];
      for (let i = 0; i < Math.min(common.length, d.length); i++) {
        if (common[i] !== d[i]) break;
        next.push(common[i]);
      }
      common = next;
    }
    const root = common.join(path.sep);
    if (!root) return files;
    return files.map(f => ({ ...f, relPath: path.relative(root, f.absPath).replace(/\\/g, '/') }));
  }

  private _rel(abs: string): string {
    const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(abs));
    return ws ? path.relative(ws.uri.fsPath, abs).replace(/\\/g, '/') : path.basename(abs);
  }

  /**
   * Where converted files land by default.
   *  - one file or a selection → beside the original, so it is easy to find
   *  - a batch → a dedicated folder, so a 30-file port does not shuffle into
   *    the source tree and become impossible to unpick
   */
  private _outRoot(sources: SourceFile[], spec: ConversionSpec, isSelection: boolean): string {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if ((sources.length === 1 || isSelection) && sources[0]) {
      return path.dirname(sources[0].absPath);
    }
    const folder = vscode.workspace.getConfiguration('aiForge').get<string>('convert.outputFolder', 'converted');
    const base = ws ?? (sources[0] ? path.dirname(sources[0].absPath) : process.cwd());
    return path.join(base, folder, spec.target);
  }

  private _displayRoot(abs: string): string {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (ws && abs.startsWith(ws)) {
      const rel = path.relative(ws, abs).replace(/\\/g, '/');
      return rel ? `./${rel}` : './';
    }
    return abs;
  }

  /**
   * Warn before proprietary source code leaves the machine. Checks the model
   * this conversion will ACTUALLY use — an override can point at the cloud even
   * when the user's global default is local, and that must still be announced.
   */
  private async _confirmCloud(services: IServices, sources: SourceFile[]): Promise<boolean> {
    const provider = (await this._resolveModel(services)).provider;
    if (!CLOUD_PROVIDERS.includes(provider)) return true;
    const what = sources.length === 1
      ? path.basename(sources[0].relPath)
      : `${sources.length} source files`;
    const ok = await vscode.window.showWarningMessage(
      `Converting sends ${what} to the ${provider} cloud API.`,
      {
        modal: true,
        detail: 'The full text of the code is included in the request. For code you cannot share, cancel and ' +
          'switch to a local provider (Ollama, Gemma 4, GLM) — conversion works identically offline.',
      },
      'Send and Convert',
    );
    return ok === 'Send and Convert';
  }

  /** A quiet nudge when a small local model is driving a demanding job. */
  private async _providerHint(services: IServices, panel: CodeConvertPanel): Promise<void> {
    try {
      const provider = await services.ai.detectProvider();
      if (provider === 'offline') {
        panel.setHint('The offline provider is pattern-based and cannot convert code. Switch to Ollama or a cloud provider first.');
      } else if (provider === 'ollama' || provider === 'gemma4' || provider === 'glm') {
        panel.setHint('Running locally — nothing leaves your machine. Conversion is demanding: a coding-tuned model ' +
          '(qwen2.5-coder or larger) gives noticeably better results than a general chat model.');
      }
    } catch { /* a hint is not worth an error */ }
  }
}

// ── Lightbulb (⚡) actions, on every language ─────────────────────────────────

class ConvertCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    // Only offer conversion for files we can actually identify a language for —
    // an untitled scratch buffer or a .log has nothing to convert.
    if (!detectSourceLanguage(doc.uri.fsPath, doc.languageId)) return [];

    const make = (title: string, command: string) => {
      const a = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
      a.command = { command, title };
      return a;
    };
    const actions: vscode.CodeAction[] = [];
    if (!range.isEmpty) {
      actions.push(make('$(arrow-swap) Evolve AI: Convert selection to another language…', 'aiForge.convert.selection'));
    }
    actions.push(make('$(arrow-swap) Evolve AI: Convert this file to another language…', 'aiForge.convert.file'));
    return actions;
  }
}

// ── Free functions ───────────────────────────────────────────────────────────

function emptyReport(): ConversionReport {
  return { summary: '', confidence: 'medium', dependencies: [], notes: [], manualSteps: [], setup: [] };
}

/** Merge a later batch/refinement report into the running one, without duplicates. */
function mergeReports(a: ConversionReport, b: ConversionReport): ConversionReport {
  const rank = { high: 2, medium: 1, low: 0 } as const;
  const key = (s: string) => s.trim().toLowerCase();
  const notes = [...a.notes];
  for (const n of b.notes) {
    if (!notes.some(x => key(x.title) === key(n.title) && x.severity === n.severity)) notes.push(n);
  }
  const deps = [...a.dependencies];
  for (const d of b.dependencies) {
    if (!deps.some(x => key(x.source) === key(d.source) && key(x.target) === key(d.target))) deps.push(d);
  }
  return {
    summary: b.summary && a.summary && b.summary !== a.summary ? `${a.summary}\n\n${b.summary}` : (b.summary || a.summary),
    confidence: rank[b.confidence] < rank[a.confidence] ? b.confidence : a.confidence,
    dependencies: deps,
    notes,
    manualSteps: [...new Set([...a.manualSteps, ...b.manualSteps])],
    setup:       [...new Set([...a.setup, ...b.setup])],
  };
}

/** True for providers that are served by a local Ollama instance. */
function isOllamaBacked(p: ProviderName): boolean {
  return p === 'ollama' || p === 'gemma4' || p === 'glm';
}

/** The model a provider uses by default, from settings. */
function defaultModelFor(p: ProviderName, cfg: vscode.WorkspaceConfiguration): string {
  switch (p) {
    case 'ollama':      return cfg.get<string>('ollamaModel', 'qwen2.5-coder:7b');
    case 'gemma4':      return cfg.get<string>('gemma4Model', 'gemma4:e4b');
    case 'glm':         return cfg.get<string>('glmModel', 'codegeex4-all-9b');
    case 'colibri':     return cfg.get<string>('colibriModel', 'glm-5.2');
    case 'anthropic':   return cfg.get<string>('anthropicModel', 'claude-sonnet-4-6');
    case 'openai':      return cfg.get<string>('openaiModel', 'gpt-4o');
    case 'gemini':      return cfg.get<string>('geminiModel', 'gemini-2.5-flash');
    case 'zai':         return cfg.get<string>('zaiModel', 'glm-4.6');
    case 'huggingface': return cfg.get<string>('huggingfaceModel', 'Qwen/Qwen2.5-Coder-32B-Instruct');
    default:            return 'offline';
  }
}

function providerLabel(p: ProviderName): string {
  return {
    ollama: 'Ollama (local)', gemma4: 'Gemma 4 (local)', glm: 'GLM (local)',
    colibri: 'Colibri (local)', anthropic: 'Anthropic', openai: 'OpenAI',
    gemini: 'Google Gemini', zai: 'GLM (Z.ai)', huggingface: 'Hugging Face',
    offline: 'Offline (no LLM)', auto: 'Auto',
  }[p] ?? p;
}

/** Installed Ollama models, or an empty list if the server isn't reachable. */
async function safeModels(services: IServices): Promise<string[]> {
  try { return await services.ai.getOllamaModels(); } catch { return []; }
}

/** Strip temp paths and noise from checker output so the message is readable. */
function cleanCheckOutput(raw: string, tmpRoot: string): string {
  return raw
    .split('\n')
    .map(l => l.split(tmpRoot).join('').replace(/^[\\/]+/, ''))
    .filter(l => l.trim().length > 0)
    .slice(0, 20)
    .join('\n')
    .slice(0, 2000) || 'Failed with no output';
}

/** True when `target` resolves to a path at or under `root`. */
function isInside(target: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Elapsed-seconds ticker shared by every long-running surface. */
function startTicker(onTick: (secs: number) => void): { stop: () => void } {
  const started = Date.now();
  const handle = setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 1000);
  return { stop: () => clearInterval(handle) };
}
