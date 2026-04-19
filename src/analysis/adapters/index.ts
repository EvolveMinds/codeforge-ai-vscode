/**
 * analysis/adapters/index.ts — Tool registry + per-language detection
 */

import { BiomeAdapter }    from './biome';
import { RuffAdapter }     from './ruff';
import { ESLintAdapter }   from './eslint';
import { PrettierAdapter } from './prettier';
import { GofmtAdapter }    from './gofmt';
import { RustfmtAdapter }  from './rustfmt';
import type { ToolAdapter } from '../types';
import type { BinaryManager } from '../binaryManager';

export function createAdapters(bins: BinaryManager): ToolAdapter[] {
  return [
    new BiomeAdapter(bins),
    new RuffAdapter(bins),
    new ESLintAdapter(bins),
    new PrettierAdapter(bins),
    new GofmtAdapter(bins),
    new RustfmtAdapter(bins),
  ];
}

/**
 * Pick adapters for a given language + project.
 *
 * Rule: if ESLint/Prettier config is present in the project, prefer those;
 * otherwise fall back to bundled Biome. Ruff always runs when available.
 */
export async function selectAdapters(
  adapters: ToolAdapter[],
  language: string,
  projectRoot: string
): Promise<ToolAdapter[]> {
  const supports = adapters.filter(a => a.supportedLanguages.includes(language));

  const picks: ToolAdapter[] = [];
  const isJsLike = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(language);

  if (isJsLike) {
    const eslint   = supports.find(a => a.name === 'eslint');
    const prettier = supports.find(a => a.name === 'prettier');
    const biome    = supports.find(a => a.name === 'biome');

    const eslintConf   = eslint   && await eslint.detectsProjectConfig(projectRoot);
    const prettierConf = prettier && await prettier.detectsProjectConfig(projectRoot);
    const biomeConf    = biome    && await biome.detectsProjectConfig(projectRoot);

    if (biomeConf && biome && await biome.isAvailable(projectRoot)) {
      picks.push(biome);
    } else {
      if (eslintConf   && eslint   && await eslint.isAvailable(projectRoot))   picks.push(eslint);
      if (prettierConf && prettier && await prettier.isAvailable(projectRoot)) picks.push(prettier);
      if (picks.length === 0 && biome && await biome.isAvailable(projectRoot)) picks.push(biome);
    }
    return picks;
  }

  // All other languages: include every supported, available adapter
  for (const a of supports) {
    if (await a.isAvailable(projectRoot)) picks.push(a);
  }
  return picks;
}
