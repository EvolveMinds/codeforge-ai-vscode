# Packaging & Release Guide

> **Read this fully before publishing any version to the VS Code Marketplace.**
> Publishing is irreversible: a version number can never be reused, unpublished, or
> overwritten once accepted. Every install auto-updates. There is no rollback —
> the only remedy for a bad release is publishing a higher version on top of it.

This document is the single source of truth for how Evolve AI is built, packaged,
and shipped. It exists so that a release performed on **any machine** produces an
identical, correct result.

---

## 1. What we publish

Evolve AI bundles native binaries (Biome + Ruff) for code analysis. Because those
binaries are platform-specific, we do **not** ship one universal `.vsix`. We ship
**six platform-targeted `.vsix` files**, one per supported target.

| Target tag | Platform | Package script |
|---|---|---|
| `win32-x64` | Windows Intel/AMD | `npm run package:win-x64` |
| `win32-arm64` | Windows ARM | `npm run package:win-arm64` |
| `darwin-x64` | macOS Intel | `npm run package:mac-x64` |
| `darwin-arm64` | macOS Apple Silicon | `npm run package:mac-arm64` |
| `linux-x64` | Linux Intel/AMD | `npm run package:linux-x64` |
| `linux-arm64` | Linux ARM | `npm run package:linux-arm64` |

**All six must be built and published for every release.** Publishing only some
leaves users on the missing platforms stranded on the previous version, with no
error message explaining why they never receive the update.

### Why plain `vsce package` is not enough

`npm run package` (bare `vsce package`) builds **only for the machine you are on**,
using whatever happens to be sitting in `bin/`. It produces a `.vsix` with no target
tag. If published, the Marketplace treats it as universal and serves those
host-specific binaries to every platform — Windows users would receive Linux
binaries. **Never publish the output of bare `vsce package`.**

---

## 2. Where we publish

### Primary: VS Code Marketplace

- Publisher ID: `codeforge-ai`
- Extension name: `evolve-ai`
- Full identifier: `codeforge-ai.evolve-ai`
- URL: https://marketplace.visualstudio.com/items?itemName=codeforge-ai.evolve-ai

Requires a **Personal Access Token** from Azure DevOps with **Marketplace →
Manage** scope, against the organisation that owns the `codeforge-ai` publisher.
The token expires (max 1 year) — a failed publish with a 401 usually means an
expired token, not a broken package.

### Secondary: Open VSX (optional, not currently automated)

Open VSX serves VSCodium, Gitpod, Cursor, and other non-Microsoft builds. We have
referenced it (`docs/GEMMA4_MASTER_PLAN.md`) but do not currently publish there.
If enabled, it takes the *same six* `.vsix` files:

```bash
npx ovsx publish evolve-ai-<target>-<version>.vsix -p <OVSX_TOKEN>
```

Decide deliberately whether a release goes to Open VSX. Skipping it is fine;
publishing there inconsistently is worse than not publishing at all, because it
leaves those users on a stale version indefinitely.

---

## 3. The binary bundling model — the most important section

`scripts/download-binaries.js` fetches two native binaries into `bin/`:

- **Biome** (pinned `1.9.4`) — downloaded as a bare executable
- **Ruff** (pinned `0.7.4`) — downloaded as `.zip` (Windows) or `.tar.gz` (macOS/Linux),
  then extracted so only the single binary lands in `bin/`

The script runs in three ways:

| Invocation | Behaviour |
|---|---|
| `npm install` (via `postinstall`) | Fetches binaries for **your current machine** only |
| `node scripts/download-binaries.js --platform=<tag>` | Fetches for **one specific target** |
| `npm run download-bins:all` | Fetches **all six targets** into `bin/` at once |

### The contamination trap

`bin/` is **shared mutable state**, and the download script **skips files that are
already present** (unless `--force`). This creates a serious failure mode:

> If `bin/` still holds another target's binaries when you package, those extra
> binaries are silently included in the `.vsix`. The package still builds. It still
> publishes. It is just wrong and bloated — and nothing warns you.

This is exactly why every `package:*` script begins with `npm run clean:bin`:

```
"package:win-x64": "npm run clean:bin && node scripts/download-binaries.js --platform=win32-x64 && vsce package --target win32-x64"
```

**Consequences to internalise:**

- **Never** run `npm run download-bins:all` and then a `package:*` script expecting a
  clean result — `clean:bin` protects you, but only if you use the `package:*`
  scripts and never call `vsce package` directly.
- **Never** call `vsce package --target <tag>` by hand. It skips `clean:bin` and
  packages whatever is in `bin/`.
- Run the six package scripts **sequentially, not in parallel.** They all write to the
  same `bin/` directory; running them concurrently makes them overwrite each other's
  binaries mid-build and produces corrupt packages.
- Between releases, `bin/` will hold whatever the last build left there. That is
  normal and harmless *provided* you always package via `package:*`.

### Expected size

Each correct `.vsix` is roughly **20–21 MB**. Meaningful deviation is a red flag:

- **Much larger (35 MB+)** → contaminated `bin/`; more than one target's binaries included
- **Much smaller (< 5 MB)** → binaries missing entirely; the download silently failed
  and the extension will not run code analysis on the user's machine

---

## 4. What must never ship inside the `.vsix`

`vsce` does **not** respect `.gitignore`. It respects `.vscodeignore` **only**. A file
can be correctly git-ignored and still be packaged and published to the world.

`.vscodeignore` currently excludes: `src/`, all `*.ts`, `tsconfig.json`, `docs/`,
`CLAUDE.md`, `.claude/`, build scaffolding, tests, `node_modules/`, other `*.vsix`
files, and the secret patterns below.

**Secret patterns already excluded** — keep these entries, never remove them:

```
.env
.env.*
.ovsx-token
.vsce-token
```

**Mandatory pre-publish secret scan.** Run this and confirm it returns nothing:

```bash
npx vsce ls | grep -iE "token|secret|\.env|credential|password|key"
```

`vsce ls` prints the exact file list that will be packaged. This is the last point
at which a leaked credential can be caught. A published `.vsix` is permanently
downloadable by anyone, so a secret that ships must be treated as compromised and
rotated immediately — removing it in a later version does not undo the exposure.

Also confirm no stray `*.vsix` from earlier builds is being packaged (the repo root
accumulates them; `.vscodeignore` covers this with `*.vsix`, but verify after any
change to that file).

---

## 5. Pre-release checklist — discoverability surfaces

Every release updates these. Skipping them means shipped features that no user can
discover, and a Marketplace listing that misrepresents the product.

- [ ] **`package.json` → `version`** — bumped, following semver
- [ ] **`package.json` → `description`** — reflects current headline capability
- [ ] **`package.json` → `keywords`** — new feature terms added (drives Marketplace search)
- [ ] **`package.json` → `categories`** — still accurate for what the extension now does
- [ ] **`CHANGELOG.md`** — new version section, user-facing language, not commit subjects
- [ ] **`README.md`** — feature list, screenshots, and version references updated
- [ ] **`docs/`** — any guide affected by the change (`CICD.md`, `DATA_ANALYSIS.md`, etc.)
- [ ] **`GETTING_STARTED.md`** — if setup or first-run flow changed
- [ ] **`CLAUDE.md`** — commands table, settings table, plugin status table
- [ ] **`docs/ARCHITECTURE.md`** — if any structural change was made
- [ ] **What's New** (`aiForge.whatsNew`) — release notes for the new version
- [ ] **New commands** added to `package.json` → `contributes.commands`
- [ ] **New settings** added to `package.json` → `contributes.configuration`

Commands and settings that exist in code but not in `package.json` are invisible to
users — they will not appear in the command palette or settings UI.

---

## 6. Release procedure

Run from a clean working tree, on the branch that will become the release.

### Step 1 — Verify starting state

```bash
git status                # must be clean
git branch --show-current # confirm the intended branch
node -e "console.log(require('./package.json').version)"
```

Confirm the version is bumped and **not already published**. Check the live version:

```bash
curl -s -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json;api-version=7.2-preview.1" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"codeforge-ai.evolve-ai"}]}],"flags":950}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s).results[0].extensions[0];e.versions.forEach(v=>console.log(v.version,v.targetPlatform||'universal',v.lastUpdated))})"
```

### Step 2 — Clean build

```bash
npm install
npm run compile           # must complete with zero TypeScript errors
npm test                  # must pass
```

`tsconfig.json` has `strict: true`. Do not publish with compile errors suppressed.

### Step 3 — Inspect the package contents

```bash
npx vsce ls | grep -iE "token|secret|\.env|credential|password|key"   # must return nothing
npx vsce ls | head -50                                                # sanity-check the file list
```

### Step 4 — Build all six packages, sequentially

```bash
npm run package:win-x64
npm run package:win-arm64
npm run package:mac-x64
npm run package:mac-arm64
npm run package:linux-x64
npm run package:linux-arm64
```

Do not parallelise. See §3.

### Step 5 — Verify each package

```bash
ls -la *.vsix
```

Confirm: six files, each ~20–21 MB, each named with its target tag.

Then verify each contains **only** its own target's binaries:

```bash
for f in evolve-ai-*-<version>.vsix; do
  echo "=== $f ==="
  unzip -l "$f" | grep -E "biome|ruff"
done
```

Each `.vsix` must list exactly two binaries matching its own target. Any `.tar.gz`
or `.zip` leftovers, or binaries from another platform, mean a contaminated build —
delete the `.vsix`, and rebuild from Step 4.

### Step 6 — Publish

```bash
npx vsce publish --packagePath evolve-ai-win32-x64-<version>.vsix
npx vsce publish --packagePath evolve-ai-win32-arm64-<version>.vsix
npx vsce publish --packagePath evolve-ai-darwin-x64-<version>.vsix
npx vsce publish --packagePath evolve-ai-darwin-arm64-<version>.vsix
npx vsce publish --packagePath evolve-ai-linux-x64-<version>.vsix
npx vsce publish --packagePath evolve-ai-linux-arm64-<version>.vsix
```

Publishing pre-built packages with `--packagePath` is deliberate: it ships the exact
artifacts you verified in Step 5. Never run bare `vsce publish` — it repackages from
the current working tree (and from whatever is in `bin/`), bypassing every check above.

If one target fails mid-sequence, **finish the remaining targets**. A partial release
is the worst outcome — some platforms updated, others silently stuck.

### Step 7 — Tag and merge back

```bash
git tag v<version>
git push origin v<version>
git checkout main
git merge release/<version>
git push origin main
```

### Step 8 — Confirm

Re-run the Step 1 Marketplace query. All six targets should show the new version.
Allow a few minutes for propagation, and note the listing page can cache longer than
the API.

---

## 7. Release hygiene rules

These come from problems already encountered in this repo.

**Always merge release branches back into `main`.** Releases 2.11 → 2.13 were built on
`release/*` branches that were never merged, leaving `main` three releases stale at
2.10.1. Anyone branching from `main` starts from the wrong base and risks reverting
shipped work.

**Always tag.** Tags stop at `v2.4.0` while 2.13.0 is live — roughly ten releases
shipped untagged. There is now no reliable way to reconstruct what any of those
versions contained.

**Verify a branch's contents before releasing from it, not just its name.** A branch
named `release/2.14.0` in this repo contains an unrelated Google Play Store data
project with its own `initial commit` — no shared history with the extension, a flat
`extension.js` instead of `src/`, and no plugins. It carries a valid-looking
`package.json` with `"version": "2.14.0"` and the correct publisher. Publishing it
would have replaced Evolve AI with an unrelated demo, permanently consuming the
2.14.0 version number. **Confirm `git log` and the file tree, never the branch name alone.**

**Never reuse a version number**, even for a release that failed midway. If three of
six targets published and something broke, bump the patch version and publish all six
again under the new number.

**Do not commit `.vsix` files.** `.gitignore` covers `*.vsix`, but the repo root has
accumulated many from past builds. They are build artifacts; the Marketplace is the
distribution channel.
