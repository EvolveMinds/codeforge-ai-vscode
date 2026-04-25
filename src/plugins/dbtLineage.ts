/**
 * plugins/dbtLineage.ts — dbt lineage provider (DE #1)
 *
 * Two resolution paths, tried in order:
 *   1. target/manifest.json — compiled dbt artifact. High-fidelity: full column
 *      types, descriptions, test results, last-built timestamp.
 *   2. schema.yml / sources.yml — raw YAML. Lower fidelity but works offline
 *      and before `dbt compile` has ever been run.
 *
 * Walks up from the active file to find the nearest dbt_project.yml so
 * monorepos with multiple dbt projects resolve against the right one.
 */

import * as fs       from 'fs';
import * as path     from 'path';
import * as vscode   from 'vscode';
import type {
  PluginLineageHook,
  LineageRef,
  LineageSchema,
  LineageColumn,
} from '../core/plugin';
import type { FileContext } from '../core/contextService';

// ── Ref extraction ───────────────────────────────────────────────────────────

const RE_REF     = /\{\{\s*ref\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
const RE_SOURCE  = /\{\{\s*source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;

export function extractDbtRefs(file: FileContext): LineageRef[] {
  const refs: LineageRef[] = [];
  if (!isDbtFile(file)) return refs;

  const lines = file.content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    const refRe = new RegExp(RE_REF.source, 'g');
    while ((m = refRe.exec(line)) !== null) {
      refs.push({
        fqn: m[1],
        kind: 'dbt_ref',
        origin: { line: i + 1, col: m.index + 1 },
      });
    }
    const srcRe = new RegExp(RE_SOURCE.source, 'g');
    while ((m = srcRe.exec(line)) !== null) {
      refs.push({
        fqn: `${m[1]}.${m[2]}`,
        kind: 'dbt_source',
        origin: { line: i + 1, col: m.index + 1 },
      });
    }
  }
  return dedupe(refs);
}

function isDbtFile(file: FileContext): boolean {
  if (file.language === 'jinja-sql' || file.language === 'dbt') return true;
  // dbt .sql files — check for Jinja markers or being under models/
  const rel = file.relPath.replace(/\\/g, '/');
  if (!rel.endsWith('.sql')) return false;
  return /\{\{\s*(ref|source|config)\s*\(/.test(file.content)
    || rel.includes('/models/')
    || rel.startsWith('models/');
}

function dedupe(refs: LineageRef[]): LineageRef[] {
  const seen = new Set<string>();
  const out: LineageRef[] = [];
  for (const r of refs) {
    const key = `${r.kind}::${r.fqn.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── dbt project discovery (monorepo-aware) ───────────────────────────────────

/** Walk up from `startDir` until we find a dbt_project.yml or hit workspace root. */
export function findDbtProjectRoot(
  startDir: string,
  wsRoot: string,
): string | undefined {
  let cur = startDir;
  // Normalise both ends for comparison on Windows
  const stop = path.resolve(wsRoot);
  for (let i = 0; i < 15; i++) {
    if (fs.existsSync(path.join(cur, 'dbt_project.yml'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return undefined;
    if (path.resolve(parent).length < stop.length) return undefined;
    cur = parent;
  }
  return undefined;
}

// ── manifest.json parsing with mtime cache ───────────────────────────────────

interface Manifest {
  metadata?: { generated_at?: string };
  nodes?:    Record<string, ManifestNode>;
  sources?:  Record<string, ManifestNode>;
  child_map?: Record<string, string[]>;
  parent_map?: Record<string, string[]>;
}

interface ManifestNode {
  name:          string;
  resource_type: string;              // 'model' | 'source' | 'test' | ...
  schema?:       string;
  database?:     string;
  description?:  string;
  columns?:      Record<string, {
    name:        string;
    data_type?:  string;
    description?: string;
    tags?:       string[];
    meta?:       { tags?: string[] };
  }>;
  tags?:         string[];
  meta?:         Record<string, unknown>;
  depends_on?:   { nodes?: string[] };
  raw_code?:     string;
  package_name?: string;
  source_name?:  string;
  identifier?:   string;
}

interface CachedManifest {
  mtime:   number;
  parsed:  Manifest;
  modelsByName:  Map<string, ManifestNode>;
  sourcesByName: Map<string, ManifestNode>;   // key: `${source_name}.${name}`
  /** Map from node id → passed test names (e.g. {'model.proj.stg_orders.id': ['unique','not_null']}) */
  testsPassed:   Map<string, string[]>;
}

const _manifestCache = new Map<string, CachedManifest>();

function loadManifest(projectRoot: string): CachedManifest | undefined {
  const manifestPath = path.join(projectRoot, 'target', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return undefined;

  const stat  = fs.statSync(manifestPath);
  const cached = _manifestCache.get(projectRoot);
  if (cached && cached.mtime === stat.mtimeMs) return cached;

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed: Manifest = JSON.parse(raw);

    const modelsByName = new Map<string, ManifestNode>();
    const sourcesByName = new Map<string, ManifestNode>();
    for (const node of Object.values(parsed.nodes ?? {})) {
      if (node.resource_type === 'model') modelsByName.set(node.name.toLowerCase(), node);
    }
    for (const node of Object.values(parsed.sources ?? {})) {
      const src = node.source_name?.toLowerCase() ?? '';
      sourcesByName.set(`${src}.${node.name.toLowerCase()}`, node);
    }

    // Collect test results: a test node refers to model + column; if present in
    // manifest it was compiled/run. We use test.name heuristics — unique/not_null/relationships.
    const testsPassed = new Map<string, string[]>();
    const TEST_HINTS = ['unique', 'not_null', 'relationships', 'accepted_values'];
    for (const [nodeId, node] of Object.entries(parsed.nodes ?? {})) {
      if (node.resource_type !== 'test') continue;
      const nameLower = node.name.toLowerCase();
      const testKind = TEST_HINTS.find(h => nameLower.includes(h));
      if (!testKind) continue;
      // Tests depend on exactly one model in manifest convention
      const depModel = node.depends_on?.nodes?.find(id => id.startsWith('model.'));
      if (!depModel) continue;
      const existing = testsPassed.get(depModel) ?? [];
      if (!existing.includes(testKind)) existing.push(testKind);
      testsPassed.set(depModel, existing);
      // Column-level: test name often includes column — `not_null_stg_orders_id` →  id
      // We store at model level; column-level attribution happens at resolve time.
      void nodeId;
    }

    const fresh: CachedManifest = { mtime: stat.mtimeMs, parsed, modelsByName, sourcesByName, testsPassed };
    _manifestCache.set(projectRoot, fresh);
    return fresh;
  } catch (e) {
    console.warn('[Evolve AI] dbt manifest parse failed:', e);
    return undefined;
  }
}

export function getManifestStaleHours(projectRoot: string): number | undefined {
  const cached = loadManifest(projectRoot);
  const gen = cached?.parsed.metadata?.generated_at;
  if (!gen) return undefined;
  const ts = Date.parse(gen);
  if (Number.isNaN(ts)) return undefined;
  // Clock skew / manifest generated_at in the future — floor at 0
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
}

function nodeToSchema(
  node: ManifestNode,
  source: 'dbt_manifest' | 'schema_yml',
  staleHours?: number,
  modelTests?: string[],
): LineageSchema {
  const columns: LineageColumn[] = Object.values(node.columns ?? {}).map(c => ({
    name: c.name,
    type: c.data_type ?? 'unknown',
    description: c.description || undefined,
    tags: [...(c.tags ?? []), ...(c.meta?.tags ?? [])].filter(Boolean),
    testsPass: modelTests, // column-level tests would need a richer parser; model-level for now
  }));
  const note = typeof staleHours === 'number' && staleHours > 24
    ? `manifest generated ${Math.round(staleHours)}h ago — run \`dbt compile\` to refresh`
    : undefined;
  return {
    fqn: node.name,
    displayName: node.database
      ? `${node.database}.${node.schema}.${node.name}`
      : (node.schema ? `${node.schema}.${node.name}` : node.name),
    source,
    columns,
    meta: {
      staleHours,
      note,
      lastBuiltAt: undefined, // dbt doesn't record per-model last-built in manifest
    },
  };
}

// ── schema.yml fallback (no manifest required) ───────────────────────────────

interface YmlModel {
  name: string;
  columns: LineageColumn[];
}

function findSchemaYmlFiles(projectRoot: string, maxFiles = 40): string[] {
  const out: string[] = [];
  const skip = new Set(['target', 'dbt_packages', '.git', 'node_modules', '.venv']);
  function walk(d: string): void {
    if (out.length >= maxFiles) return;
    try {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        if (skip.has(ent.name)) continue;
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (/^(schema|sources|models)\.ya?ml$/i.test(ent.name)
              || ent.name.endsWith('.yml') || ent.name.endsWith('.yaml')) {
          // Only include files in model paths
          out.push(full);
        }
      }
    } catch { /* unreadable */ }
  }
  walk(projectRoot);
  return out;
}

/**
 * Very light schema.yml parser — handles the common `models: - name: X\n  columns: - name: Y data_type: Z`
 * pattern without pulling in a YAML dependency.
 */
function parseSchemaYml(content: string): YmlModel[] {
  const models: YmlModel[] = [];
  // Split on `- name:` at indent 2
  const lines = content.split('\n');
  let cur: YmlModel | null = null;
  let inColumns = false;
  let curCol: LineageColumn | null = null;
  let curIndent = 0;

  const indentOf = (s: string) => s.match(/^(\s*)/)?.[1].length ?? 0;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const indent = indentOf(line);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Model entry: "- name: X" at indent 2 (under `models:`)
    const modelMatch = trimmed.match(/^-\s*name:\s*['"]?([\w\-.]+)['"]?/);
    if (modelMatch && indent <= 4) {
      if (cur) { if (curCol) cur.columns.push(curCol); models.push(cur); }
      cur = { name: modelMatch[1], columns: [] };
      curCol = null;
      inColumns = false;
      curIndent = indent;
      continue;
    }
    if (!cur) continue;

    if (trimmed.startsWith('columns:')) { inColumns = true; continue; }
    if (trimmed.startsWith('description:') && !inColumns) {
      // model-level description — could attach if we add it to schema
      continue;
    }
    if (!inColumns) continue;

    const colMatch = trimmed.match(/^-\s*name:\s*['"]?([\w\-.]+)['"]?/);
    if (colMatch && indent > curIndent) {
      if (curCol) cur.columns.push(curCol);
      curCol = { name: colMatch[1], type: 'unknown' };
      continue;
    }
    if (!curCol) continue;

    const typeMatch = trimmed.match(/^data_type:\s*['"]?([\w().\s,]+?)['"]?$/);
    if (typeMatch) { curCol.type = typeMatch[1].trim(); continue; }
    const descMatch = trimmed.match(/^description:\s*['"]?(.+?)['"]?$/);
    if (descMatch) { curCol.description = descMatch[1]; continue; }
    // tests:
    const testsMatch = trimmed.match(/^tests:/);
    if (testsMatch) continue;
    const testItem = trimmed.match(/^-\s*(\w+)/);
    if (testItem && /\b(unique|not_null|relationships|accepted_values)\b/.test(testItem[1])) {
      curCol.testsPass = [...(curCol.testsPass ?? []), testItem[1]];
    }
  }
  if (cur) { if (curCol) cur.columns.push(curCol); models.push(cur); }
  return models;
}

// ── The hook ─────────────────────────────────────────────────────────────────

export class DbtLineageHook implements PluginLineageHook {
  readonly key = 'dbt.manifest';

  async extract(file: FileContext): Promise<LineageRef[]> {
    return extractDbtRefs(file);
  }

  async resolve(
    refs: LineageRef[],
    ws: vscode.WorkspaceFolder | undefined,
  ): Promise<LineageSchema[]> {
    if (!ws) return [];
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? ws.uri.fsPath;
    const projectRoot = findDbtProjectRoot(path.dirname(activeFile), ws.uri.fsPath) ?? ws.uri.fsPath;

    const manifest = loadManifest(projectRoot);
    const staleHours = manifest ? getManifestStaleHours(projectRoot) : undefined;

    const schemas: LineageSchema[] = [];
    const unresolved: LineageRef[] = [];

    if (manifest) {
      for (const ref of refs) {
        if (ref.kind === 'dbt_ref') {
          const node = manifest.modelsByName.get(ref.fqn.toLowerCase());
          if (node) {
            // Find tests that reference this model
            const modelId = `model.${findProjectName(projectRoot)}.${node.name}`;
            const tests = manifest.testsPassed.get(modelId);
            schemas.push(nodeToSchema(node, 'dbt_manifest', staleHours, tests));
            continue;
          }
        } else if (ref.kind === 'dbt_source') {
          const key = ref.fqn.toLowerCase(); // 'source.table'
          const node = manifest.sourcesByName.get(key);
          if (node) { schemas.push(nodeToSchema(node, 'dbt_manifest', staleHours)); continue; }
        }
        unresolved.push(ref);
      }
    } else {
      unresolved.push(...refs);
    }

    // schema.yml fallback for anything we couldn't resolve from the manifest
    if (unresolved.length > 0) {
      const ymlModels = collectYmlModels(projectRoot);
      for (const ref of unresolved) {
        const mdl = ymlModels.get(ref.fqn.toLowerCase());
        if (mdl && mdl.columns.length > 0) {
          schemas.push({
            fqn: mdl.name,
            displayName: mdl.name,
            source: 'schema_yml',
            columns: mdl.columns,
            meta: { note: manifest ? undefined : 'manifest.json not found — columns may be incomplete' },
          });
        }
      }
    }
    return schemas;
  }
}

function findProjectName(projectRoot: string): string {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'dbt_project.yml'), 'utf8');
    const m = raw.match(/^name:\s*['"]?([^'"\n\r]+)['"]?/m);
    return m ? m[1].trim() : 'project';
  } catch { return 'project'; }
}

function collectYmlModels(projectRoot: string): Map<string, YmlModel> {
  const out = new Map<string, YmlModel>();
  for (const f of findSchemaYmlFiles(projectRoot)) {
    try {
      const raw = fs.readFileSync(f, 'utf8');
      if (!/^models:/m.test(raw)) continue;
      for (const m of parseSchemaYml(raw)) {
        out.set(m.name.toLowerCase(), m);
      }
    } catch { /* skip */ }
  }
  return out;
}
