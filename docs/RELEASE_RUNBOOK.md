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
> Written from the v2.25.0 release (2026-09-22). Every command below was run for
> real; the traps in §9 are ones that actually bit, not hypotheticals.

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
  --title "Evolve AI Enterprise Desktop vX.Y.Z (Windows x64 Portable)" \
  --notes-file /tmp/release-body.md --latest \
  dist-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe

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
gh repo clone EvolveMinds/Company    # clone OUTSIDE the product repo — see §9.2
cd Company && git checkout -b release/evolve-ai-X.Y.Z
pnpm install --frozen-lockfile
```

### One file to edit

`src/content/site.ts`, the `evolve-ai` product entry:

```ts
downloadUrl:      ".../vX.Y.Z-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe",
downloadVersion:  "vX.Y.Z",
downloadSize:     "<from §4>",
downloadSha256:   "<from §4>",
downloadSigned:   false,          // flip to true when TODO 3 lands
releaseHistory: [
  // Move the OUTGOING release to the top of this array, with its own
  // checksum. Never delete an entry: customers reproducing a validated
  // environment need the exact build they qualified.
  { version, released, url, size, sha256, summary, notesUrl },
  ...
],
```

Everything else — the download page, the `/products/evolve-ai/` CTA, the
`/products` card, the version archive, the FAQ structured data and the licence
email — derives from that entry. **If you find yourself editing a version in a
second file, that is a bug: fix the derivation instead.**

### Verify before merging

```bash
pnpm exec tsc --noEmit     # 0
pnpm run build             # 0

# No stale version anywhere in the built output
for f in $(find .next/server/app -name "*.html"); do
  hits=$(grep -o "v[0-9]\+\.[0-9]\+\.[0-9]\+" "$f" | sort -u | tr '\n' ' ')
  [ -n "$hits" ] && echo "${f#.next/server/app/}: $hits"
done
```

Expect the new version everywhere, and **only** the archive page listing older
ones.

Open a PR, get it reviewed, then merge. Amplify redeploys automatically — allow
a few minutes.

### Verify production, by downloading

This is the step that proves the chain works end to end:

```bash
for u in /products/evolve-ai/ /products/evolve-ai/download/ /products/evolve-ai/download/versions/; do
  curl -s "https://www.evolveminds.com.au$u" | grep -o "v[0-9]\+\.[0-9]\+\.[0-9]\+" | sort -u | tr '\n' ' '
  echo "  <- $u"
done

# Download what a customer downloads and confirm the published hash
curl -sL -o /tmp/dl.exe "<downloadUrl from site.ts>"
powershell -Command "(Get-FileHash /tmp/dl.exe -Algorithm SHA256).Hash"   # must equal downloadSha256
```

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
directory.

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

---

## 10. Release checklist

Copy into the release PR or issue.

**Pre-flight**
- [ ] `main` clean, pulled, no foreign changes in `git status`
- [ ] `npm run compile` · `check:version` · `verify:honest` · `test:fde` · desktop tests — all pass

**Version**
- [ ] `package.json` bumped
- [ ] `CHANGELOG.md`, `RELEASE_NOTES.md` (with Known Gaps), `docs/FDE_TODO.md` updated
- [ ] `check:version` passes against the new number

**Build**
- [ ] `npm run desktop:build:portable` succeeds (electron-builder ≥ 26)
- [ ] EXE metadata shows the new ProductVersion and the company
- [ ] SHA-256 and byte size recorded
- [ ] Packaged app launches and Settings shows the new version — **not** an Electron version
- [ ] `app.asar` contains no `node_modules`
- [ ] Patch ZIP: **skipped** unless TODO 4 has landed

**Publish**
- [ ] Code + `vX.Y.Z` tag pushed to `origin` **and** `enterprise`
- [ ] `vX.Y.Z-desktop` release created on **both** repos, EXE attached, marked latest
- [ ] Release body: changes, SmartScreen notice, verification block, Known Gaps
- [ ] Asset `state == uploaded`; download URL returns 200

**Website**
- [ ] Branch + PR against `EvolveMinds/Company` (never push to `main`)
- [ ] Only `src/content/site.ts` edited; outgoing release moved into `releaseHistory` with its checksum
- [ ] `tsc --noEmit` and `pnpm run build` pass
- [ ] Built HTML shows the new version on every page; only the archive lists older ones
- [ ] PR reviewed and merged; Amplify deployed
- [ ] Live pages verified; **binary downloaded and hash matched**

**After**
- [ ] `docs/FDE_TODO.md` reflects what shipped and what was deferred
- [ ] Anything discovered during the release added to §9 of this runbook
