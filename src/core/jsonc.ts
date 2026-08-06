/**
 * core/jsonc.ts — minimal JSONC tolerance for user-authored config files.
 *
 * Several Evolve AI config files are meant to be hand-edited and ship with
 * explanatory `//` comments (evolve-data-pipeline.json, evolve-report-theme.json).
 * JSON.parse rejects those, so strip line comments before parsing.
 */

/**
 * Strip `//` line comments from JSON text. Quote-aware, so `//` inside a string
 * value (e.g. an `https://` URL) is preserved.
 */
export function stripJsonComments(src: string): string {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}
