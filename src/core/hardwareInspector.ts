/**
 * core/hardwareInspector.ts — System hardware detection for smart Gemma 4 setup
 *
 * Detects RAM, CPU, GPU, disk space, Ollama version, and installed Gemma 4 variants.
 * All detection runs in parallel with timeouts; failures degrade gracefully.
 *
 * Recommends the best Gemma 4 variant for the user's hardware, or returns
 * `unsupported` with actionable alternatives if the system can't run any variant.
 *
 * Privacy: nothing leaves the machine. Detection is opt-in via explicit consent.
 */

import * as os    from 'os';
import * as path  from 'path';
import * as fs    from 'fs';
import { spawn } from 'child_process';

export interface GpuInfo {
  vendor:  'nvidia' | 'amd' | 'apple' | 'intel';
  vramGb:  number;
  name:    string;
}

export interface OllamaInfo {
  installed:    boolean;
  version:      string | null;
  needsUpdate:  boolean;
}

export interface Gemma4Info {
  installed:    boolean;
  variants:     string[];
}

export interface HardwareProfile {
  ramGb:        number;
  cpu:          { model: string; cores: number; arch: string };
  gpu:          GpuInfo | null;
  diskFreeGb:   number;
  ollama:       OllamaInfo;
  gemma4:       Gemma4Info;
  platform:     NodeJS.Platform;
  detectedAt:   number;
}

export type Recommendation =
  | { kind: 'ok';          variant: string; reason: string; warnings: string[] }
  | { kind: 'unsupported'; reasons: string[]; suggestions: string[] };

// Minimum Ollama version: covers CVE-2024-37032 (RCE via malicious model files,
// fixed in 0.7.0), CVE-2025-51471 (cross-domain token exposure), and
// CVE-2025-63389 (missing auth on model-management ops, fixed in 0.12.4).
// Gemma 4 also needs 0.3.10+ for the model itself.
const MIN_OLLAMA_VERSION = '0.12.4';
const SHELL_TIMEOUT_MS   = 3_000;

export class HardwareInspector {
  /** Run all detection checks in parallel. Never throws. */
  async inspect(): Promise<HardwareProfile> {
    const platform = process.platform;
    const ramGb    = Math.round(os.totalmem() / (1024 ** 3));
    const cpus     = os.cpus();
    const cpu      = {
      model: cpus[0]?.model?.trim() ?? 'Unknown',
      cores: cpus.length,
      arch:  os.arch(),
    };

    const [gpu, diskFreeGb, ollama, gemma4] = await Promise.all([
      this._detectGpu(platform),
      this._detectDiskSpace(platform),
      this._detectOllama(),
      this._detectGemma4(),
    ]);

    return {
      ramGb,
      cpu,
      gpu,
      diskFreeGb,
      ollama,
      gemma4,
      platform,
      detectedAt: Date.now(),
    };
  }

  /** Recommend the best Gemma 4 variant for the user's hardware. */
  recommend(hw: HardwareProfile): Recommendation {
    const ram  = hw.ramGb;
    const vram = hw.gpu?.vramGb ?? 0;
    const disk = hw.diskFreeGb;

    // Hard floor: nothing will run if RAM or disk is too low
    const blockers: string[] = [];
    if (ram < 6)  { blockers.push(`Only ${ram}GB RAM detected — Gemma 4 needs at least 8GB (E2B variant)`); }
    if (disk > 0 && disk < 8) { blockers.push(`Only ${disk}GB free disk space — the smallest Gemma 4 variant needs ~7.2GB`); }

    if (blockers.length > 0) {
      return {
        kind: 'unsupported',
        reasons: blockers,
        suggestions: [
          'Free up disk space (need at least 8GB for the smallest variant)',
          'Use a cloud provider instead (Anthropic Claude, OpenAI, HuggingFace) — runs in the cloud, only needs an API key',
          'Use the built-in Offline mode — pattern-based, no LLM required',
        ],
      };
    }

    // Highest-quality variant that fits
    if (ram >= 32 && vram >= 20 && disk >= 25) {
      return { kind: 'ok', variant: 'gemma4:31b', reason: 'Your GPU has enough VRAM for the highest-quality variant', warnings: [] };
    }
    if (ram >= 32 && disk >= 22) {
      const warnings = vram === 0 ? ['No GPU detected — inference will be slower than with a GPU'] : [];
      return { kind: 'ok', variant: 'gemma4:26b', reason: 'Mixture-of-Experts model — high quality with efficient inference', warnings };
    }
    if (ram >= 16 && disk >= 12) {
      return { kind: 'ok', variant: 'gemma4:e4b', reason: 'Best balance of quality and speed for your system', warnings: [] };
    }
    if (ram >= 8 && disk >= 9) {
      const warnings = ram < 12 ? ['RAM is tight — close other apps for best performance'] : [];
      return { kind: 'ok', variant: 'gemma4:e2b', reason: 'Lightweight variant — fits your available RAM', warnings };
    }

    // Edge case: just barely under the bar
    return {
      kind: 'unsupported',
      reasons: [`Your system has ${ram}GB RAM and ${disk}GB free disk — too tight for any Gemma 4 variant`],
      suggestions: [
        'Free up RAM by closing other applications',
        'Free up disk space (need at least 8GB)',
        'Use a cloud provider (Anthropic Claude, OpenAI) instead',
      ],
    };
  }

  /** Format a one-line summary for display. */
  summary(hw: HardwareProfile): string {
    const parts: string[] = [`${hw.ramGb}GB RAM`];
    if (hw.gpu) {
      parts.push(`${hw.gpu.name} (${hw.gpu.vramGb}GB VRAM)`);
    } else {
      parts.push('No GPU detected');
    }
    if (hw.diskFreeGb > 0) {
      parts.push(`${hw.diskFreeGb}GB free disk`);
    }
    return parts.join(' \u00B7 ');
  }

  // ── Detection internals ─────────────────────────────────────────────────────

  private async _detectGpu(platform: NodeJS.Platform): Promise<GpuInfo | null> {
    // NVIDIA: nvidia-smi works on Windows, Linux, and macOS (rare)
    const nvidia = await this._tryNvidia();
    if (nvidia) return nvidia;

    // AMD: rocm-smi (Linux primarily)
    if (platform === 'linux') {
      const amd = await this._tryAmd();
      if (amd) return amd;
    }

    // Apple Metal (macOS)
    if (platform === 'darwin') {
      const apple = await this._tryAppleGpu();
      if (apple) return apple;
    }

    return null;
  }

  private async _tryNvidia(): Promise<GpuInfo | null> {
    const out = await this._runCommand('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    if (!out) return null;
    const line = out.trim().split('\n')[0];
    if (!line) return null;
    const [name, vramMib] = line.split(',').map(s => s.trim());
    const vramGb = Math.round(Number(vramMib) / 1024);
    if (!name || isNaN(vramGb)) return null;
    return { vendor: 'nvidia', vramGb, name };
  }

  private async _tryAmd(): Promise<GpuInfo | null> {
    const out = await this._runCommand('rocm-smi', ['--showproductname', '--showmeminfo', 'vram', '--csv']);
    if (!out) return null;
    // rocm-smi output is messy; try to find the VRAM line
    const vramMatch = out.match(/Total VRAM \(B\)[,:]\s*(\d+)/i);
    if (!vramMatch) return null;
    const vramGb = Math.round(Number(vramMatch[1]) / (1024 ** 3));
    const nameMatch = out.match(/Card series[,:]\s*([^,\n]+)/i);
    const name = nameMatch ? nameMatch[1].trim() : 'AMD GPU';
    return { vendor: 'amd', vramGb, name };
  }

  private async _tryAppleGpu(): Promise<GpuInfo | null> {
    const out = await this._runCommand('system_profiler', ['SPDisplaysDataType']);
    if (!out) return null;
    // Apple Silicon shows unified memory; we report total RAM as VRAM since they share
    const isAppleSilicon = out.includes('Apple M') || out.includes('Apple GPU');
    if (!isAppleSilicon) return null;
    const nameMatch = out.match(/Chipset Model:\s*([^\n]+)/);
    const name = nameMatch ? nameMatch[1].trim() : 'Apple GPU';
    // Apple Silicon: GPU shares system memory; treat all RAM as effective VRAM
    const vramGb = Math.round(os.totalmem() / (1024 ** 3));
    return { vendor: 'apple', vramGb, name };
  }

  private async _detectDiskSpace(platform: NodeJS.Platform): Promise<number> {
    try {
      const ollamaDir = platform === 'win32'
        ? path.join(process.env.USERPROFILE ?? os.homedir(), '.ollama', 'models')
        : path.join(os.homedir(), '.ollama', 'models');
      // statfs exists on Node 18.15+ and 19+
      const dirToCheck = fs.existsSync(ollamaDir) ? ollamaDir : os.homedir();
      const stats = await fs.promises.statfs(dirToCheck);
      return Math.round((stats.bsize * stats.bavail) / (1024 ** 3));
    } catch {
      return 0; // unknown — caller should treat as "skip disk warnings"
    }
  }

  private async _detectOllama(): Promise<OllamaInfo> {
    const out = await this._runCommand('ollama', ['--version']);
    if (!out) return { installed: false, version: null, needsUpdate: false };
    // Output: "ollama version is 0.3.12" or "ollama version 0.3.12"
    const match = out.match(/(\d+\.\d+\.\d+)/);
    if (!match) return { installed: true, version: null, needsUpdate: false };
    const version = match[1];
    return {
      installed: true,
      version,
      needsUpdate: this._versionLessThan(version, MIN_OLLAMA_VERSION),
    };
  }

  private async _detectGemma4(): Promise<Gemma4Info> {
    const out = await this._runCommand('ollama', ['list']);
    if (!out) return { installed: false, variants: [] };
    const variants: string[] = [];
    for (const line of out.split('\n')) {
      const match = line.match(/^(gemma4\S*)\s/);
      if (match) variants.push(match[1]);
    }
    return { installed: variants.length > 0, variants };
  }

  /** Run a shell command with a timeout. Returns stdout or null on failure. */
  private _runCommand(cmd: string, args: string[]): Promise<string | null> {
    return new Promise(resolve => {
      let settled = false;
      const done = (val: string | null) => { if (!settled) { settled = true; resolve(val); } };
      try {
        const proc = spawn(cmd, args, { shell: false, windowsHide: true });
        let stdout = '';
        const timer = setTimeout(() => { proc.kill(); done(null); }, SHELL_TIMEOUT_MS);
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.on('error', () => { clearTimeout(timer); done(null); });
        proc.on('close', (code: number | null) => {
          clearTimeout(timer);
          done(code === 0 ? stdout : null);
        });
      } catch {
        done(null);
      }
    });
  }

  /** Compare semver strings. Returns true if a < b. */
  private _versionLessThan(a: string, b: string): boolean {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const av = aParts[i] ?? 0;
      const bv = bParts[i] ?? 0;
      if (av < bv) return true;
      if (av > bv) return false;
    }
    return false;
  }
}
