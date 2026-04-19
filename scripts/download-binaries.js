#!/usr/bin/env node
/**
 * scripts/download-binaries.js — Fetch bundled binaries for code analysis.
 *
 * Downloads Biome + Ruff for the current platform into bin/.
 * Called on `npm install` (via postinstall) AND by the platform-specific
 * package script, which passes --platform=<tag> to fetch any target.
 *
 * Targets: win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const os = require('os');
const zlib = require('zlib');

// ── Version pins (bump when updating) ─────────────────────────────────────────
const BIOME_VERSION = '1.9.4';
const RUFF_VERSION  = '0.7.4';

// ── Platform mapping ──────────────────────────────────────────────────────────
const BIOME_ASSET = {
  'win32-x64':    'biome-win32-x64.exe',
  'win32-arm64':  'biome-win32-arm64.exe',
  'darwin-x64':   'biome-darwin-x64',
  'darwin-arm64': 'biome-darwin-arm64',
  'linux-x64':    'biome-linux-x64',
  'linux-arm64':  'biome-linux-arm64',
};

// Ruff ships as tar.gz / zip archives with a single binary inside
const RUFF_ASSET = {
  'win32-x64':    { archive: `ruff-x86_64-pc-windows-msvc.zip`,        bin: 'ruff.exe' },
  'win32-arm64':  { archive: `ruff-aarch64-pc-windows-msvc.zip`,       bin: 'ruff.exe' },
  'darwin-x64':   { archive: `ruff-x86_64-apple-darwin.tar.gz`,        bin: 'ruff' },
  'darwin-arm64': { archive: `ruff-aarch64-apple-darwin.tar.gz`,       bin: 'ruff' },
  'linux-x64':    { archive: `ruff-x86_64-unknown-linux-gnu.tar.gz`,   bin: 'ruff' },
  'linux-arm64':  { archive: `ruff-aarch64-unknown-linux-gnu.tar.gz`,  bin: 'ruff' },
};

// ── Target detection ──────────────────────────────────────────────────────────
function currentTarget() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  switch (process.platform) {
    case 'win32':  return `win32-${arch}`;
    case 'darwin': return `darwin-${arch}`;
    case 'linux':  return `linux-${arch}`;
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { target: null, all: false, skipIfPresent: true };
  for (const a of args) {
    if (a.startsWith('--platform=')) out.target = a.split('=')[1];
    else if (a === '--all') out.all = true;
    else if (a === '--force') out.skipIfPresent = false;
  }
  return out;
}

// ── HTTP with redirects ───────────────────────────────────────────────────────
function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'evolve-ai-bundler' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.unlinkSync(dest);
        fetchToFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', e => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

// ── Biome download ────────────────────────────────────────────────────────────
async function downloadBiome(target, outDir) {
  const asset = BIOME_ASSET[target];
  if (!asset) throw new Error(`Biome: unsupported target ${target}`);
  const url = `https://github.com/biomejs/biome/releases/download/cli%2Fv${BIOME_VERSION}/${asset}`;
  const ext = target.startsWith('win32') ? '.exe' : '';
  const dest = path.join(outDir, `biome-${target}${ext}`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`  ✓ biome-${target} already present`);
    return;
  }
  console.log(`  ↓ downloading biome-${target}...`);
  await fetchToFile(url, dest);
  if (!target.startsWith('win32')) fs.chmodSync(dest, 0o755);
  console.log(`  ✓ biome-${target} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
}

// ── Ruff download + extract ───────────────────────────────────────────────────
async function downloadRuff(target, outDir) {
  const meta = RUFF_ASSET[target];
  if (!meta) throw new Error(`Ruff: unsupported target ${target}`);
  const ext = target.startsWith('win32') ? '.exe' : '';
  const dest = path.join(outDir, `ruff-${target}${ext}`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`  ✓ ruff-${target} already present`);
    return;
  }
  console.log(`  ↓ downloading ruff-${target}...`);
  const url = `https://github.com/astral-sh/ruff/releases/download/${RUFF_VERSION}/${meta.archive}`;
  const archiveExt = meta.archive.endsWith('.zip') ? '.zip' : '.tar.gz';
  const tmp = path.join(outDir, `__ruff-${target}${archiveExt}`);
  await fetchToFile(url, tmp);

  if (meta.archive.endsWith('.zip')) {
    extractSingleFromZip(tmp, meta.bin, dest);
  } else {
    extractSingleFromTarGz(tmp, meta.bin, dest);
  }
  fs.unlinkSync(tmp);
  if (!target.startsWith('win32')) fs.chmodSync(dest, 0o755);
  console.log(`  ✓ ruff-${target} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
}

function extractSingleFromZip(zipPath, innerName, destPath) {
  // Use system 'unzip' on POSIX, PowerShell on Windows — avoid extra npm deps.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruff-'));
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'inherit' });
    }
    const found = findFile(tmpDir, innerName);
    if (!found) throw new Error(`Not found in archive: ${innerName}`);
    fs.copyFileSync(found, destPath);
  } finally {
    rmrf(tmpDir);
  }
}

function extractSingleFromTarGz(tarPath, innerName, destPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruff-'));
  try {
    execSync(`tar -xzf "${tarPath}" -C "${tmpDir}"`, { stdio: 'inherit' });
    const found = findFile(tmpDir, innerName);
    if (!found) throw new Error(`Not found in archive: ${innerName}`);
    fs.copyFileSync(found, destPath);
  } finally {
    rmrf(tmpDir);
  }
}

function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (e.name === name) {
      return full;
    }
  }
  return null;
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { target: cliTarget, all } = parseArgs();
  const outDir = path.resolve(__dirname, '..', 'bin');
  fs.mkdirSync(outDir, { recursive: true });

  const targets = all
    ? Object.keys(BIOME_ASSET)
    : [cliTarget || currentTarget()];

  console.log(`[Evolve AI] Downloading bundled analysis binaries for: ${targets.join(', ')}`);
  for (const t of targets) {
    try {
      await downloadBiome(t, outDir);
      await downloadRuff(t, outDir);
    } catch (e) {
      console.error(`  ✗ failed for ${t}: ${e.message}`);
      // Don't fail the whole install — user can re-run scripts later.
    }
  }
  console.log('[Evolve AI] Done.');
}

main().catch(e => {
  console.error('[Evolve AI] Binary download failed:', e);
  process.exit(0); // non-fatal: extension still works with fallback tools
});
