# Desktop Release Runbook — Enterprise EXE, Patch ZIP & Website

> **For whoever ships the next desktop release, human or AI.**
>
> This is the end-to-end procedure for the **commercial Enterprise Desktop**
> (portable `.exe` + offline patch `.zip`), the GitHub releases that host them,
> and the company website that points customers at them.
>
> For the **VS Code extension** (`.vsix`, six platform targets, Marketplace) see
> [`PACKAGING.md`](./PACKAGING.md) — that is a separate pipeline with separate
> rules, and nothing here applies to it.
>
> Written from the v2.25.0 release (2026-09-22) and updated/verified through
> the v2.26.0 release (2026-09-25). Every command below was run for real;
> the traps in §9 are ones that actually bit, not hypotheticals. Every release
> must update both the desktop binaries and the company website, and record
> verification in §11.

---

## 0. The rule that governs everything here

**Nothing may claim to be true unless it was verified.** That applies to version
numbers on a page, a checksum in release notes, "signed", "tested", and
"up to date". If a step below says *verify*, run the check — do not infer it
from the fact that the previous step succeeded.

The corollary: **a stale published artifact is worse than a missing one**,
because nobody goes looking for it.

---

## 1. Version is one field

The version lives in exactly one place:

```
package.json  →  "version": "X.Y.Z"
```

Everything else resolves from it at runtime or build time:

| Surface | How it gets the version |
|---|---|
| App header pill, Settings → INSTALLED VERSION | `getAppVersion()` in `src/desktop/shared/appVersion.ts` |
| Update check | `DesktopUpdater`, from the same helper |
| `.exe` filename and file metadata | `electron-builder.yml` `${version}` |
| Website download page, CTA, archive, structured data | `downloadVersion` in `Company` → `src/content/site.ts` |
| Licence emails | Not versioned at all — they link to the download page (see §7) |

`npm run check:version` fails the build on a hardcoded literal. It is wired into
`package:enterprise` and both desktop build scripts. **Do not add a version
string anywhere else**, including comments that look like documentation.

Two exceptions, both deliberate:

* `HITL_POLICY_SCHEMA_VERSION` in `renderer.ts` — a *file format* version for
  exported policies. It is intentionally decoupled; bump it only when the
  emitted shape changes.
* `INITIAL_DOWNLOADS` in the website's `src/portal/lib/storage.ts` — historical
  telemetry records. They describe past downloads and must not move.

---

## 2. Pre-flight

```bash
git checkout main && git pull origin main
git status --short          # must be clean
```

**Check for a concurrently active session on this repo.** If `git status` shows
changes you did not make, stop and find out whose they are. See §9.1 — this cost
a broken `package.json` in v2.25.0.

```bash
npm ci                      # or npm install
npm run compile             # must exit 0
npm run check:version       # must pass
npm run verify:honest       # 61 checks
npm run test:fde            # 76 tests
npx mocha --ui tdd out/test/suite/desktop/desktopCore.test.js   # 7 tests
```

All five must pass **before** the version bump, so a failure is attributable to
the code and not to the release.

---

## 3. Bump the version

```bash
# edit package.json → "version": "X.Y.Z"
npm run check:version       # now reports the new version
```

Then update, in this order:

1. **`CHANGELOG.md`** — new `## [X.Y.Z] — YYYY-MM-DD` section at the top.
   Lead with what changed for a user, not a file list.
2. **`RELEASE_NOTES.md`** — customer-facing summary. Include a **Known Gaps**
   section: anything in `docs/FDE_TODO.md` that a customer could reasonably
   expect to work. Do not quietly omit it.
3. **`docs/FDE_TODO.md`** — close what shipped, add what this release deferred.

Commit the bump on its own:

```bash
git add package.json CHANGELOG.md RELEASE_NOTES.md docs/FDE_TODO.md
git commit -m "chore(release): bump to X.Y.Z"
```

---

## 4. Build the EXE

```bash
npm run desktop:build:portable
# → dist-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe
```

**`electron-builder` must be 26.x or newer** (pinned in `devDependencies`).
24.x and 25.x fail on Windows with a symlink error before packaging even
starts — see `PACKAGING.md` for the full diagnosis and the four workarounds
that do *not* help.

Verify the artifact, do not assume it:

```bash
# Metadata must show the new version and the company
powershell -Command "(Get-Item 'dist-desktop\evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe').VersionInfo | Format-List ProductName,ProductVersion,CompanyName"

# Checksum — record this, it is published in three places
powershell -Command "(Get-FileHash 'dist-desktop\evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe' -Algorithm SHA256).Hash"

# Size, for the release notes and the website
ls -la dist-desktop/*X.Y.Z*.exe
```

**Smoke-test the packaged app** — a build that compiles can still fail to start:

```bash
# Launch the unpacked build; it must survive ~12s without exiting
dist-desktop/win-unpacked/"Evolve AI Enterprise Studio.exe"
```

Confirm in the running app that **Settings → INSTALLED VERSION shows X.Y.Z**,
not an Electron version. If it shows something like `v44.4.3`, that is Electron's
version leaking through — see §9.3.

Finally, confirm no dependency leaked into the bundle:

```bash
npx asar list dist-desktop/win-unpacked/resources/app.asar | grep -c node_modules   # must be 0
```

### 4.1 Package the VS Code Extension (.vsix)

The Enterprise release publishes both the zero-install standalone Windows EXE
and the VS Code extension VSIX:

```bash
npx @vscode/vsce package --no-dependencies -o evolve-ai-X.Y.Z.vsix

# Checksum & Size
powershell -Command "(Get-FileHash 'evolve-ai-X.Y.Z.vsix' -Algorithm SHA256).Hash"
ls -la evolve-ai-X.Y.Z.vsix
```

---

## 5. Build the patch ZIP

> ⚠️ **As of v2.25.0 this is not shippable.** `scripts/create-offline-patch.js`
> produces an archive with no checksum and no signature, and
> `applyOfflinePatch()` verifies nothing while reporting engines it did not
> reload. See **TODO 4** in `docs/FDE_TODO.md`.
>
> **Do not publish a patch ZIP until TODO 4 is done.** Publishing one makes a
> non-functional feature look functional. The UI control should stay hidden
> until then.

Once TODO 4 lands, the procedure is:

```bash
npm run patch:create
# → dist-desktop/evolve-ai-enterprise-patch-X.Y.Z.zip
```

and it must satisfy, before publishing:

- [ ] Manifest carries a SHA-256 per file **and** a manifest digest
- [ ] A tampered archive is **rejected**, verified by testing one
- [ ] A corrupt archive reports failure, not success
- [ ] Reported file/engine counts match what actually changed on disk
- [ ] Archive checksum recorded for the release notes

---

## 6. Publish the GitHub releases

Both repos get the same code, tags and releases:

| Repo | Purpose |
|---|---|
| `EvolveMinds/codeforge-ai-vscode` | Public. The website links here. |
| `EvolveMinds/evolve-ai-enterprise` | Private enterprise mirror. |

```bash
# Code + version tag to both
git push origin main   && git push enterprise main
git tag -a vX.Y.Z -m "Evolve AI X.Y.Z — <one line>"
git push origin vX.Y.Z && git push enterprise vX.Y.Z
```

The **desktop release** uses a distinct tag, `vX.Y.Z-desktop`, and carries the
binaries. Write the notes to a file first so both repos get identical text:

```bash
gh release create vX.Y.Z-desktop \
  --repo EvolveMinds/codeforge-ai-vscode \
  --title "Evolve AI Enterprise Desktop vX.Y.Z (Windows x64 Portable & VSIX)" \
  --notes-file /tmp/release-body.md --latest \
  dist-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe \
  evolve-ai-X.Y.Z.vsix

# repeat verbatim for EvolveMinds/evolve-ai-enterprise
```

The release body must contain:

- [ ] What changed, in user terms
- [ ] **First Launch on Windows** — the SmartScreen notice (§8), while unsigned
- [ ] Binary verification block: filename, architecture, size, **SHA-256**
- [ ] The PowerShell one-liner for verifying the hash
- [ ] **Known Gaps**, matching `docs/FDE_TODO.md`

Verify the release is actually reachable — the asset upload can silently lag:

```bash
gh release view vX.Y.Z-desktop --repo EvolveMinds/codeforge-ai-vscode \
  --json assets --jq '.assets[] | "\(.name) \(.size) \(.state)"'   # state must be "uploaded"

curl -sIL -o /dev/null -w "%{http_code}\n" \
  "https://github.com/EvolveMinds/codeforge-ai-vscode/releases/download/vX.Y.Z-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe"   # 200
```

---

## 7. Update the company website

Repo: **`EvolveMinds/Company`** — a Next.js site on AWS Amplify.
**Merging to `main` deploys to production.** Always work on a branch and open a
PR; never push to `main` directly.

```bash
# Navigate to Company outside this repo (see §9.2)
cd ../Company

# ALWAYS pull latest main before branching (see §9.6)
git checkout main && git pull origin main
git checkout -b release/evolve-ai-X.Y.Z
pnpm install --frozen-lockfile
```

### 7.1 Single source of truth: `src/content/site.ts`

In `src/content/site.ts`, update the `evolve-ai` product entry:

```ts
downloadUrl:      "https://github.com/EvolveMinds/codeforge-ai-vscode/releases/download/vX.Y.Z-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe",
downloadVersion:  "vX.Y.Z",
downloadSize:     "<from §4, e.g. '78.8 MB'>",
downloadSha256:   "<from §4>",
downloadSigned:   false,          // flip to true when TODO 3 lands
releaseHistory: [
  // Move the OUTGOING release to the top of this array, with its own
  // checksum, size, and release notes URL. Never delete an entry: customers
  // reproducing a validated environment need the exact build they qualified.
  {
    version: "vPREV",
    released: "YYYY-MM-DD",
    url: "...",
    size: "...",
    sha256: "...",
    summary: "...",
    notesUrl: "...",
  },
  ...
],
```

Everything else — the download page, the `/products/evolve-ai/` CTA, the
`/products` card, the version archive, the FAQ structured data and the licence
email — derives from that entry. **If you find yourself editing a version in a
second file, that is a bug: fix the derivation instead.**

### 7.2 Structured data & download page attributes

In `src/app/products/evolve-ai/download/page.tsx`:
* Update `fileSize` in the Schema.org JSON-LD to the exact binary size in bytes.
* Update `newFeatures` array to highlight the headline deliverables of the new release.

### 7.3 Verify before merging

```bash
pnpm exec tsc --noEmit     # must exit 0
pnpm run build             # must exit 0

# Verify no stale versions in the built HTML output
powershell -Command "Get-ChildItem -Path '.next/server/app' -Recurse -Filter '*.html' | ForEach-Object { \$matches = (Select-String -Path \$_.FullName -Pattern 'v2\.[0-9]+\.[0-9]+' -AllMatches).Matches.Value | Select-Object -Unique; if (\$matches) { \"\$(\$_.Name): \$(\$matches -join ', ')\" } }"
```

Expect the new version everywhere, and **only** `versions.html` listing older
superseded builds.

Open a PR, review, and merge to `main`:

```bash
git add src/content/site.ts src/app/products/evolve-ai/download/page.tsx src/components/EditionComparison.tsx
git commit -m "feat(release): update Evolve AI Enterprise Desktop to vX.Y.Z"
git push -u origin release/evolve-ai-X.Y.Z
gh pr create --repo EvolveMinds/Company --fill
gh pr merge <PR_NUMBER> --repo EvolveMinds/Company --merge --delete-branch
```

Amplify redeploys automatically — allow 2–3 minutes.

### 7.4 Verify production, by downloading

This is the step that proves the chain works end to end:

```bash
# Verify pages report new version
curl -s "https://www.evolveminds.com.au/products/evolve-ai/download/" | grep -o "v[0-9]\+\.[0-9]\+\.[0-9]\+" | sort -u

# Download what a customer downloads and confirm the published hash
powershell -Command "Invoke-WebRequest -Uri '<downloadUrl from site.ts>' -OutFile '\$env:TEMP\dl.exe'; (Get-FileHash '\$env:TEMP\dl.exe' -Algorithm SHA256).Hash"
```

The resulting hash must match `downloadSha256` exactly.

---

## 8. While the binary is unsigned

Every desktop release so far is **unsigned** (`NotSigned`). Until **TODO 3**
lands, each release must carry the first-launch notice, on the download page and
in the release body:

> **First launch on Windows.** This build is not code-signed, so Windows
> SmartScreen shows *"Windows protected your PC"* the first time you run it.
> Click **More info**, then **Run anyway**. This is expected and does not
> indicate a problem with the download. Verify the SHA-256 to confirm the file
> is exactly what we published. Administrator rights are still not required.

An unexpected warning reads as malware; a predicted one reads as a formality.
The notice is gated on `downloadSigned`, so it disappears by itself once a
signed build ships.

---

## 9. Traps that actually bit

### 9.1 A concurrent session can eat your `package.json`

`git add -A` while another session is editing the same file silently committed a
`package.json` that had lost `scripts`, `keywords` and `devDependencies`, and
had `main` pointing at the desktop entry instead of the extension.

* Run `git status` before staging and account for every changed file.
* Prefer `git add <explicit paths>` during a release.
* After committing `package.json`, verify it:
  ```bash
  node -e "const p=require('./package.json');console.log(Object.keys(p.scripts||{}).length,'scripts |',p.main)"
  ```
  Expect ~27 scripts and `./out/extension.js`.

### 9.2 Never clone another repo inside this one

`gh repo clone EvolveMinds/Company` run from the product repo root puts a nested
git repo inside it, which `git add -A` will happily stage. Clone to a scratch
directory or side-by-side workspace folder (`../Company`).

### 9.3 Electron's version can masquerade as the app version

`app.getVersion()` does **not** fail when the app has no version of its own — it
returns *Electron's* version. Running the desktop entry directly once made the
app display `v44.4.3` and report "Up to date" against every real release, so it
would never have offered an update.

Fixed in `main.ts` by asking `getAppVersion()` first and rejecting any value
equal to `process.versions.electron`. A regression test guards it. **If a version
with an implausible major appears anywhere, this is the cause.**

### 9.4 `main` in `package.json` is the extension's entry, not the desktop's

`electron-builder.yml` injects `out/desktop/main/main.js` via `extraMetadata` at
package time. The committed `main` must stay `./out/extension.js`, or the VS Code
extension breaks.

### 9.5 The build machine's artifacts are not the published ones

`dist-desktop/` is gitignored. The only published copies are GitHub release
assets. Before quoting a checksum for an *older* build, download the published
asset and hash that — do not trust a local file of the same name.

### 9.6 Always pull `origin/main` in `Company` before creating a release branch

If local `main` in the `Company` repository lags behind previously merged pull
requests, branching off it causes merge conflicts and git will mark the PR
dirty/unmergeable. Always run `git checkout main && git pull origin main` first.

### 9.7 Verify binaries and hashes directly from disk before quoting

Never estimate or handcraft SHA-256 digests or file sizes. Run `Get-FileHash`
on both `dist-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe` and
`evolve-ai-X.Y.Z.vsix` directly.

### 9.8 Version archive synchronization

Never remove superseded builds from `releaseHistory` in `src/content/site.ts`.
Enterprise clients qualifying specific builds in banking/air-gapped enclaves
require permanent access to superseded binaries and hashes.

---

## 10. Release checklist

Copy into the release PR or issue before beginning every version upgrade:

**1. Pre-flight**
- [ ] `main` clean, pulled, no foreign changes in `git status`
- [ ] `npm run compile` · `npm run check:version` · `npm run verify:honest` · `npm run test:fde` — all pass
- [ ] Desktop mocha tests pass: `npx mocha --ui tdd out/test/suite/desktop/desktopCore.test.js`

**2. Version Bump**
- [ ] `package.json` bumped: `"version": "X.Y.Z"`
- [ ] `npm run check:version` confirms single-source semver
- [ ] `CHANGELOG.md` updated with new user-facing section
- [ ] `RELEASE_NOTES.md` updated with highlights, SHA-256 verification table, and Known Gaps
- [ ] `docs/FDE_TODO.md` updated (completed items closed, deferred items logged)
- [ ] Commit version bump: `git commit -m "chore(release): bump to X.Y.Z"`

**3. Package Binaries**
- [ ] `npm run desktop:build:portable` succeeds (electron-builder ≥ 26)
- [ ] EXE metadata shows ProductVersion and Company: `(Get-Item 'dist-desktop\*.exe').VersionInfo`
- [ ] Package VS Code Extension: `npx @vscode/vsce package --no-dependencies -o evolve-ai-X.Y.Z.vsix`
- [ ] SHA-256 and byte sizes recorded for BOTH `.exe` and `.vsix`
- [ ] Smoke-test packaged desktop app (Settings shows X.Y.Z, not Electron version)
- [ ] `app.asar` contains no `node_modules` (`npx asar list ... | grep -c node_modules` is 0)
- [ ] Patch ZIP: **skipped** unless TODO 4 has landed

**4. Publish GitHub Releases**
- [ ] Code + `vX.Y.Z` tag pushed to `origin` **and** `enterprise` mirrors
- [ ] `vX.Y.Z-desktop` release created on **both** repos (`codeforge-ai-vscode` and `evolve-ai-enterprise`)
- [ ] Both `evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe` and `evolve-ai-X.Y.Z.vsix` attached
- [ ] Release body contains SmartScreen notice, verification table with SHA-256, and Known Gaps
- [ ] Asset upload verified (`state == uploaded`; download URLs return 200)

**5. Update Company Website**
- [ ] Switch to `Company` repo: `git checkout main && git pull origin main`
- [ ] Create branch `release/evolve-ai-X.Y.Z`
- [ ] Update `src/content/site.ts`: `downloadUrl`, `downloadVersion`, `downloadSize`, `downloadSha256`
- [ ] Move outgoing release into `releaseHistory` array at the top
- [ ] Update `fileSize` (bytes) and `newFeatures` in `src/app/products/evolve-ai/download/page.tsx`
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm run build` exits 0
- [ ] Built HTML verification: new version on all pages; only `versions.html` lists superseded ones
- [ ] PR created, reviewed, and merged to `main` (`gh pr merge --merge --delete-branch`)
- [ ] Amplify production deployment completed; live URLs & downloads verified against SHA-256

**6. Audit & Documentation**
- [ ] Release recorded in §11 of this runbook with checksums, date, and status
- [ ] `docs/DEPLOYMENT_CHECKLIST.md` verified and in sync

---

## 11. Release execution audit log

Historical record of verified production releases:

| Version | Release Date | Desktop EXE SHA-256 (Size) | VSIX SHA-256 (Size) | GitHub Releases | Website Status |
|---|---|---|---|---|---|
| **v2.28.0** | 2026-10-07 | `B555E56098CAE7A3EA9B92D7AA81BE0129671A80D53DA44FAD14151A836C1897` (79.0 MB / 82,879,629 B) | `908CC71E2D5CA5372E365D16E771E33E8CF7DDC1E0666469FCE27247CC680050` (23.0 MB / 24,078,950 B) | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.28.0-desktop) / [Enterprise](https://github.com/EvolveMinds/evolve-ai-enterprise/releases/tag/v2.28.0-desktop) | Verified & Staged |
| **v2.27.0** | 2026-09-28 | `B2DE171A993B70E8E1862C4C0398607CBC28443E9E5DAB9BE31E259D31736307` (78.9 MB / 82,710,217 B) | `364313E625D20B598D1035350D549A986514CEA9D11B4903ABEE69985A6CAE7A` (22.8 MB / 23,856,282 B) | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.27.0-desktop) / [Enterprise](https://github.com/EvolveMinds/evolve-ai-enterprise/releases/tag/v2.27.0-desktop) | Verified & Deployed |
| **v2.26.0** | 2026-09-25 | `F133B5F7F3EBF7BB388A48AB8D4DF83584ADE1C769A485F80FC4C2EAD265EF8F` (78.8 MB / 82,672,078 B) | `8DBB848C9ADB4ED550B88A33A05645DBCF0B94F3D9FDFDC83C0D227F7AC23130` (22.7 MB / 23,812,480 B) | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.26.0-desktop) / [Enterprise](https://github.com/EvolveMinds/evolve-ai-enterprise/releases/tag/v2.26.0-desktop) | Verified & Merged (PR #2) |
| **v2.25.0** | 2026-09-22 | `976CA196E6612DD87E2510C78F20A86BBB527A3C67FA72F3F7C3680A51F9A239` (78.8 MB) | N/A | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.25.0-desktop) | Archived in `releaseHistory` |
| **v2.24.0** | 2026-09-21 | `5176535787FCBCC0E6B0A911E3633495AB80E06DB986B8EB19D99D6A0063E172` (71.5 MB) | N/A | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.24.0-desktop) | Archived in `releaseHistory` |

