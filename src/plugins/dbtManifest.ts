/**
 * plugins/dbtManifest.ts — Shared dbt target/manifest.json reader (DE #3)
 *
 * Originally lived inside dbtLineage.ts; pulled out so the impact-analysis
 * features (downstream models, exposures, test status) can reuse the same
 * mtime-cached loader without DE #1 having to depend on DE #3 features.
 *
 * Exposes:
 *   - loadManifest(projectRoot)        — mtime-cached parse
 *   - findDbtProjectRoot(start, ws)    — walk up to nearest dbt_project.yml
 *   - getManifestStaleHours(root)
 *   - getDownstream(root, modelName)   — children + exposures (DE #3)
 *   - getUpstream(root, modelName)     — parents + sources (DE #3)
 *   - getModelByFile(root, filePath)   — match an open .sql file to its node
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ManifestNodeColumn {
  name:        string;
  data_type?:  string;
  description?: string;
  tags?:       string[];
  meta?:       { tags?: string[] };
}

export interface ManifestNode {
  name:          string;
  resource_type: string;            // 'model' | 'source' | 'test' | 'seed' | 'snapshot' | 'analysis'
  schema?:       string;
  database?:     string;
  description?:  string;
  columns?:      Record<string, ManifestNodeColumn>;
  tags?:         string[];
  meta?:         Record<string, unknown>;
  depends_on?:   { nodes?: string[] };
  raw_code?:     string;
  package_name?: string;
  source_name?:  string;
  identifier?:   string;
  /** Path to the model's .sql file relative to the project root */
  original_file_path?: string;
  /** dbt config block, may carry materialization */
  config?:       { materialized?: string; tags?: string[] };
}

export interface ManifestExposure {
  name:        string;
  type?:       string;             // 'dashboard' | 'analysis' | 'application' | 'ml' | 'notebook'
  description?: string;
  owner?:      { name?: string; email?: string };
  url?:        string;
  depends_on?: { nodes?: string[] };
  package_name?: string;
}

export interface Manifest {
  metadata?:  { generated_at?: string; project_name?: string };
  nodes?:     Record<string, ManifestNode>;
  sources?:   Record<string, ManifestNode>;
  exposures?: Record<string, ManifestExposure>;
  /** parent → children */
  child_map?: Record<string, string[]>;
  /** child → parents */
  parent_map?: Record<string, string[]>;
}

export interface CachedManifest {
  mtime:         number;
  parsed:        Manifest;
  /** lowercase model name → node */
  modelsByName:  Map<string, ManifestNode>;
  /** lowercase model name → node id (e.g. 'model.proj.stg_orders') */
  modelIdByName: Map<string, string>;
  /** `${source}.${table}` lowercase → source node */
  sourcesByName: Map<string, ManifestNode>;
  /** lowercase relative file path → node id */
  modelIdByFile: Map<string, string>;
  /** model id → list of test kinds attached to it */
  testsByModel:  Map<string, string[]>;
  /** model id → exposure ids that depend on it (direct) */
  exposuresByModel: Map<string, string[]>;
}

// ── Cache ────────────────────────────────────────────────────────────────────

const _cache = new Map<string, CachedManifest>();

/** Force-clear the cache (used by tests + the manual refresh command). */
export function invalidateManifestCache(projectRoot?: string): void {
  if (projectRoot) _cache.delete(projectRoot);
  else _cache.clear();
}

/** Walk up from `startDir` until a dbt_project.yml is found or workspace root reached. */
export function findDbtProjectRoot(startDir: string, wsRoot: string): string | undefined {
  let cur = startDir;
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

/** mtime-cached parse of `target/manifest.json`. */
export function loadManifest(projectRoot: string): CachedManifest | undefined {
  const manifestPath = path.join(projectRoot, 'target', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return undefined;

  const stat   = fs.statSync(manifestPath);
  const cached = _cache.get(projectRoot);
  if (cached && cached.mtime === stat.mtimeMs) return cached;

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed: Manifest = JSON.parse(raw);

    const modelsByName  = new Map<string, ManifestNode>();
    const modelIdByName = new Map<string, string>();
    const sourcesByName = new Map<string, ManifestNode>();
    const modelIdByFile = new Map<string, string>();
    const testsByModel  = new Map<string, string[]>();
    const exposuresByModel = new Map<string, string[]>();

    for (const [nodeId, node] of Object.entries(parsed.nodes ?? {})) {
      if (node.resource_type === 'model') {
        const lower = node.name.toLowerCase();
        modelsByName.set(lower, node);
        modelIdByName.set(lower, nodeId);
        if (node.original_file_path) {
          modelIdByFile.set(normaliseFilePath(node.original_file_path), nodeId);
        }
      }
    }

    for (const node of Object.values(parsed.sources ?? {})) {
      const src = node.source_name?.toLowerCase() ?? '';
      sourcesByName.set(`${src}.${node.name.toLowerCase()}`, node);
    }

    // Tests — assign by name heuristics to model id (model-level resolution)
    const TEST_HINTS = ['unique', 'not_null', 'relationships', 'accepted_values'];
    for (const node of Object.values(parsed.nodes ?? {})) {
      if (node.resource_type !== 'test') continue;
      const nameLower = node.name.toLowerCase();
      const testKind = TEST_HINTS.find(h => nameLower.includes(h));
      if (!testKind) continue;
      const depModel = node.depends_on?.nodes?.find(id => id.startsWith('model.'));
      if (!depModel) continue;
      const existing = testsByModel.get(depModel) ?? [];
      if (!existing.includes(testKind)) existing.push(testKind);
      testsByModel.set(depModel, existing);
    }

    // Exposures — index by upstream model id
    for (const [exposureId, exposure] of Object.entries(parsed.exposures ?? {})) {
      const deps = exposure.depends_on?.nodes ?? [];
      for (const dep of deps) {
        if (!dep.startsWith('model.')) continue;
        const existing = exposuresByModel.get(dep) ?? [];
        if (!existing.includes(exposureId)) existing.push(exposureId);
        exposuresByModel.set(dep, existing);
      }
    }

    const fresh: CachedManifest = {
      mtime: stat.mtimeMs, parsed,
      modelsByName, modelIdByName, sourcesByName,
      modelIdByFile, testsByModel, exposuresByModel,
    };
    _cache.set(projectRoot, fresh);
    return fresh;
  } catch (e) {
    console.warn('[Evolve AI] dbt manifest parse failed:', e);
    return undefined;
  }
}

function normaliseFilePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** Hours since manifest was generated, floored at 0 for clock skew. */
export function getManifestStaleHours(projectRoot: string): number | undefined {
  const cached = loadManifest(projectRoot);
  const gen = cached?.parsed.metadata?.generated_at;
  if (!gen) return undefined;
  const ts = Date.parse(gen);
  if (Number.isNaN(ts)) return undefined;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
}

/** Return the node id for a model file path (relative to project root) or undefined. */
export function getModelByFile(projectRoot: string, filePath: string): { id: string; node: ManifestNode } | undefined {
  const cached = loadManifest(projectRoot);
  if (!cached) return undefined;
  const rel = path.relative(projectRoot, filePath);
  const id = cached.modelIdByFile.get(normaliseFilePath(rel));
  if (!id) return undefined;
  const node = cached.parsed.nodes?.[id];
  if (!node) return undefined;
  return { id, node };
}

// ── Downstream / Upstream traversal (DE #3) ──────────────────────────────────

export interface DownstreamReport {
  /** Direct children (1 hop) */
  directModels:    Array<{ id: string; node: ManifestNode }>;
  /** All transitive descendants up to maxDepth */
  transitiveModels: Array<{ id: string; node: ManifestNode; depth: number }>;
  /** Exposures that depend on this model directly OR via descendants */
  exposures:       Array<{ id: string; exposure: ManifestExposure; via: 'direct' | 'transitive' }>;
  /** Test count across this model + all descendants */
  totalTests:      number;
  /** Whether the traversal hit the depth cap */
  truncated:       boolean;
}

const DEFAULT_MAX_DEPTH = 5;

export function getDownstream(
  projectRoot: string,
  modelName: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): DownstreamReport | undefined {
  const cached = loadManifest(projectRoot);
  if (!cached) return undefined;

  const startId = cached.modelIdByName.get(modelName.toLowerCase());
  if (!startId) return undefined;

  const childMap = cached.parsed.child_map ?? {};
  const visited = new Set<string>([startId]);
  const directModels: Array<{ id: string; node: ManifestNode }> = [];
  const transitiveModels: Array<{ id: string; node: ManifestNode; depth: number }> = [];
  const exposureIds = new Set<string>();
  const directExposureIds = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const children = childMap[id] ?? [];
    for (const childId of children) {
      // Exposures
      if (childId.startsWith('exposure.')) {
        if (depth === 0) directExposureIds.add(childId);
        exposureIds.add(childId);
        continue;
      }
      // Tests are not models — track only counts via testsByModel later
      if (childId.startsWith('test.')) continue;
      if (!childId.startsWith('model.')) continue;
      if (visited.has(childId)) continue;
      visited.add(childId);

      const node = cached.parsed.nodes?.[childId];
      if (!node) continue;
      if (depth === 0) directModels.push({ id: childId, node });
      transitiveModels.push({ id: childId, node, depth: depth + 1 });

      if (depth + 1 < maxDepth) {
        queue.push({ id: childId, depth: depth + 1 });
      } else {
        truncated = true;
      }
    }
  }

  // Total tests across the model itself + all descendants
  let totalTests = (cached.testsByModel.get(startId) ?? []).length;
  for (const { id } of transitiveModels) {
    totalTests += (cached.testsByModel.get(id) ?? []).length;
  }

  const exposures = [...exposureIds].map(id => {
    const exposure = cached.parsed.exposures?.[id];
    return exposure
      ? { id, exposure, via: directExposureIds.has(id) ? 'direct' as const : 'transitive' as const }
      : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  return { directModels, transitiveModels, exposures, totalTests, truncated };
}

export interface UpstreamReport {
  directParents:    Array<{ id: string; node: ManifestNode }>;
  transitiveParents: Array<{ id: string; node: ManifestNode; depth: number }>;
  sources:          Array<{ id: string; node: ManifestNode }>;
  truncated:        boolean;
}

export function getUpstream(
  projectRoot: string,
  modelName: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): UpstreamReport | undefined {
  const cached = loadManifest(projectRoot);
  if (!cached) return undefined;

  const startId = cached.modelIdByName.get(modelName.toLowerCase());
  if (!startId) return undefined;

  const parentMap = cached.parsed.parent_map ?? {};
  const visited = new Set<string>([startId]);
  const directParents: Array<{ id: string; node: ManifestNode }> = [];
  const transitiveParents: Array<{ id: string; node: ManifestNode; depth: number }> = [];
  const sources: Array<{ id: string; node: ManifestNode }> = [];
  const sourcesSeen = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const parents = parentMap[id] ?? [];
    for (const pid of parents) {
      if (visited.has(pid)) continue;
      visited.add(pid);
      if (pid.startsWith('source.')) {
        if (sourcesSeen.has(pid)) continue;
        sourcesSeen.add(pid);
        const sNode = cached.parsed.sources?.[pid];
        if (sNode) sources.push({ id: pid, node: sNode });
        continue;
      }
      if (!pid.startsWith('model.')) continue;
      const node = cached.parsed.nodes?.[pid];
      if (!node) continue;
      if (depth === 0) directParents.push({ id: pid, node });
      transitiveParents.push({ id: pid, node, depth: depth + 1 });

      if (depth + 1 < maxDepth) {
        queue.push({ id: pid, depth: depth + 1 });
      } else {
        truncated = true;
      }
    }
  }
  return { directParents, transitiveParents, sources, truncated };
}

/** All exposures, indexed for the exposures command. */
export function listExposures(projectRoot: string): Array<{ id: string; exposure: ManifestExposure; upstreamModelIds: string[] }> | undefined {
  const cached = loadManifest(projectRoot);
  if (!cached) return undefined;
  return Object.entries(cached.parsed.exposures ?? {}).map(([id, exposure]) => ({
    id,
    exposure,
    upstreamModelIds: (exposure.depends_on?.nodes ?? []).filter(n => n.startsWith('model.')),
  }));
}
