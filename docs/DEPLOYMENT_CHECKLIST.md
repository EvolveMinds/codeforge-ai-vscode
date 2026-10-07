# Evolve AI — Production Deployment & Release Checklist

> **Mandatory protocol for every version upgrade and commercial release.**  
> Canonical companion to [`RELEASE_RUNBOOK.md`](./RELEASE_RUNBOOK.md).  
> **Rule 0:** *Nothing may claim to be true unless it was verified.*

---

## 📋 The 6-Phase Release Protocol

Every release must complete all six phases in order. Never skip a verification step or infer success from a previous step.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Phase 1    │ ──> │   Phase 2    │ ──> │   Phase 3    │
│  Pre-Flight  │     │ Version Bump │     │ Build Assets │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Phase 6    │ <── │   Phase 5    │ <── │   Phase 4    │
│ Live Audit   │     │ Website Sync │     │ GitHub Rel.  │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

### Phase 1 · Pre-Flight Cleanliness & Automated Test Suite

Before touching version numbers or code:

- [ ] **Working Tree Clean:** `git status` reports no untracked or unstaged files.
- [ ] **Remote Synchronized:** `git checkout main && git pull origin main && git pull enterprise main`.
- [ ] **Zero-Secret Leak Guard:** `git grep -E "BEGIN (RSA |EC )?PRIVATE KEY" src/` returns zero results (no signing keys or credentials in client bundles).
- [ ] **TypeScript Compilation:** `npm run compile` exits 0.
- [ ] **Semver Single-Source Guard:** `npm run check:version` exits 0 (no hardcoded version literals).
- [ ] **Honesty & Metrics Integrity:** `npm run verify:honest` passes all 61 checks.
- [ ] **Cryptographic License Engine Tests:** `npx mocha --ui tdd out/test/suite/enterprise/license.test.js` passes all 11 tests.
- [ ] **FDE Unit & Integration Tests:** `npm run test:fde` passes all 76 tests.
- [ ] **Desktop Core Mocha Tests:** `npx mocha --ui tdd out/test/suite/desktop/desktopCore.test.js` passes 7 tests.

---

### Phase 2 · Single-Source Version Bump & Documentation

- [ ] **Bump `package.json`:** `"version": "X.Y.Z"` (the single source of truth).
- [ ] **Bump `package-lock.json`:** `npm install --package-lock-only` or update lockfile.
- [ ] **Verify Semver Guard:** `npm run check:version` outputs `vX.Y.Z` as the recognized version.
- [ ] **User-Facing Changelog:** Add `## [X.Y.Z] — YYYY-MM-DD` at top of [`CHANGELOG.md`](../CHANGELOG.md).
- [ ] **Customer Release Notes:** Update [`RELEASE_NOTES.md`](../RELEASE_NOTES.md) with feature highlights, binary verification block, PowerShell verification command, and Known Gaps.
- [ ] **FDE Task Tracking:** Update [`docs/FDE_TODO.md`](./FDE_TODO.md) to close shipped deliverables and record deferred scope.
- [ ] **Atomic Version Commit:**  
  ```bash
  git add package.json package-lock.json CHANGELOG.md RELEASE_NOTES.md docs/FDE_TODO.md
  git commit -m "chore(release): bump to X.Y.Z"
  ```

---

### Phase 3 · Dual Artifact Packaging & Verification

#### 3.1 Windows Desktop Standalone Portable (.exe)
- [ ] **Build Executable:** `npm run desktop:build:portable` (electron-builder ≥ 26).
- [ ] **File Metadata Inspection:**  
  ```powershell
  (Get-Item 'dist-desktop\evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe').VersionInfo | Format-List ProductName,ProductVersion,CompanyName
  ```
- [ ] **Hash & Size Verification:** Record exact byte count and SHA-256 hash:
  ```powershell
  (Get-FileHash 'dist-desktop\evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe' -Algorithm SHA256).Hash
  (Get-Item 'dist-desktop\evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe').Length
  ```
- [ ] **Smoke Test Unpacked Build:** Launch `dist-desktop/win-unpacked/"Evolve AI Enterprise Studio.exe"`. Verify app survives 12+ seconds and **Settings → Installed Version** displays `X.Y.Z` (not Electron version).
- [ ] **Bundle Purity:** Verify zero `node_modules` in asar:  
  ```bash
  npx asar list dist-desktop/win-unpacked/resources/app.asar | grep -c node_modules   # must be 0
  ```

#### 3.2 VS Code Extension Package (.vsix)
- [ ] **Package Extension:** `npx @vscode/vsce package --no-dependencies -o evolve-ai-X.Y.Z.vsix`
- [ ] **Hash & Size Verification:**
  ```powershell
  (Get-FileHash 'evolve-ai-X.Y.Z.vsix' -Algorithm SHA256).Hash
  (Get-Item 'evolve-ai-X.Y.Z.vsix').Length
  ```

---

### Phase 4 · Dual GitHub Releases Publishing

Both GitHub remotes must receive identical code, tags, and release binaries:

- [ ] **Push Commits & Tag:**  
  ```bash
  git push origin main && git push enterprise main
  git tag -a vX.Y.Z -m "Evolve AI X.Y.Z release"
  git push origin vX.Y.Z && git push enterprise vX.Y.Z
  ```
- [ ] **Create Public Release (`codeforge-ai-vscode`):**
  ```bash
  gh release create vX.Y.Z-desktop \
    --repo EvolveMinds/codeforge-ai-vscode \
    --title "Evolve AI Enterprise Desktop vX.Y.Z (Windows x64 Portable & VSIX)" \
    --notes-file /tmp/release-body.md --latest \
    dist-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe \
    evolve-ai-X.Y.Z.vsix
  ```
- [ ] **Create Enterprise Release (`evolve-ai-enterprise`):**
  ```bash
  gh release create vX.Y.Z-desktop \
    --repo EvolveMinds/evolve-ai-enterprise \
    --title "Evolve AI Enterprise Desktop vX.Y.Z (Windows x64 Portable & VSIX)" \
    --notes-file /tmp/release-body.md --latest \
    dist-desktop/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe \
    evolve-ai-X.Y.Z.vsix
  ```
- [ ] **Asset Availability Verification:**  
  `gh release view vX.Y.Z-desktop --repo EvolveMinds/codeforge-ai-vscode --json assets` confirms both assets have `state == uploaded` and download URLs return HTTP 200.

---

### Phase 5 · Company Website Deployment (`EvolveMinds/Company`)

The corporate site on AWS Amplify is the public delivery channel for customers and enterprise evaluators:

- [ ] **Navigate & Sync:**  
  ```bash
  cd ../Company
  git checkout main && git pull origin main
  git checkout -b release/evolve-ai-X.Y.Z
  ```
- [ ] **Update Release Data Registry (`src/content/evolveAiReleases.ts`):**
  - Add new release entry at index 0 with `version: "vX.Y.Z"`, `tag: "vX.Y.Z-desktop"`, `isLatest: true`.
  - Register all release assets with exact size, bytes, and uppercase SHA-256 checksum:
    - Portable Executable (.exe)
    - Offline Patch Archive (.zip)
    - VS Code Extension (.vsix)
  - Ensure all asset download URLs use domain-native routes: `/products/evolve-ai/releases/assets/<filename>`.
  - Replicate full feature changelog and binary verification blocks.
- [ ] **Update Product Configuration (`src/content/site.ts`):**
  - `downloadUrl`: Set to domain-native route `/products/evolve-ai/releases/assets/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe` (**ZERO** raw GitHub download URLs exposed to users!).
  - `downloadVersion`: `"vX.Y.Z"`
  - `downloadSize`: Human readable size (e.g., `"79.0 MB"`)
  - `downloadSha256`: Measured uppercase SHA-256 hash
  - `releaseHistory`: Prepend outgoing version at top with domain-native `url` and notesUrl pointing to `/products/evolve-ai/releases/#v...`.
  - **Strict Path Constraint:** Never use `/downloads/`. All assets are under `/products/evolve-ai/releases/assets/`.
- [ ] **Configure Domain-Native Asset Rewrites (`amplify-redirects.json`):**
  - Add 302 rules mapping each `/products/evolve-ai/releases/assets/<filename>` to its GitHub release asset download URL.
  - **Crucial:** Place rules *above* the catch-all `404-200` rewrite rule.
- [ ] **Update Download Page & Structured Data (`src/app/products/evolve-ai/download/page.tsx`):**
  - Update `fileSize` in schema to exact binary bytes.
  - Update `newFeatures` array to reflect current release highlights.
  - Link version archive references to `/products/evolve-ai/releases/`.
- [ ] **Typecheck & Static Export:**  
  ```bash
  pnpm exec tsc --noEmit     # must exit 0
  pnpm run build             # must exit 0
  ```
- [ ] **Verify Built HTML Output:**  
  Inspect `out/products/evolve-ai/releases/index.html` and `out/products/evolve-ai/download/index.html`. Verify zero GitHub links exist on any download button.
- [ ] **PR & Merge to Production:**  
  ```bash
  git add src/content/site.ts src/content/evolveAiReleases.ts amplify-redirects.json src/app/products/evolve-ai/download/page.tsx src/app/products/evolve-ai/releases/
  git commit -m "feat(release): update Evolve AI Enterprise Desktop to vX.Y.Z with domain-native releases"
  git push -u origin release/evolve-ai-X.Y.Z
  gh pr create --repo EvolveMinds/Company --fill
  gh pr merge <PR_NUMBER> --repo EvolveMinds/Company --merge --delete-branch
  ```
- [ ] **Amplify Deployment Check:** Wait 2–3 minutes for AWS Amplify build to complete.

---

### Phase 6 · Production Verification & Audit Sign-Off

- [ ] **Verify Live Website Content & Releases Page:**  
  ```bash
  curl -s "https://www.evolveminds.com.au/products/evolve-ai/releases/" | grep -o "v[0-9]\+\.[0-9]\+\.[0-9]\+" | sort -u
  ```
- [ ] **Live Customer Download & Integrity Match (Domain-Native Endpoint):**  
  ```powershell
  Invoke-WebRequest -Uri "https://www.evolveminds.com.au/products/evolve-ai/releases/assets/evolve-ai-enterprise-portable-X.Y.Z-win32-x64.exe" -OutFile "$env:TEMP\verify_dl.exe"
  $hash = (Get-FileHash "$env:TEMP\verify_dl.exe" -Algorithm SHA256).Hash
  Remove-Item "$env:TEMP\verify_dl.exe"
  # Must equal downloadSha256
  ```
- [ ] **Confirm Zero Leaked Git URLs:** Verify users never see raw github.com links when downloading .exe or .zip files.
- [ ] **Update Execution Audit Log:** Append sign-off record to table below and to `RELEASE_RUNBOOK.md` §11.

---

## 📝 Release Execution Sign-Off Log

| Version | Release Date | Desktop EXE SHA-256 (Size) | VSIX SHA-256 (Size) | GitHub Releases | Website Status | Verified By |
|---|---|---|---|---|---|---|
| **v2.28.0** | 2026-10-07 | `B555E56098CAE7A3EA9B92D7AA81BE0129671A80D53DA44FAD14151A836C1897`<br>(79.0 MB / 82,879,629 B) | `908CC71E2D5CA5372E365D16E771E33E8CF7DDC1E0666469FCE27247CC680050`<br>(23.0 MB / 24,078,950 B) | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.28.0-desktop)<br>[Enterprise](https://github.com/EvolveMinds/evolve-ai-enterprise/releases/tag/v2.28.0-desktop) | Verified & Staged | Antigravity AI Engine |
| **v2.27.0** | 2026-09-28 | `B2DE171A993B70E8E1862C4C0398607CBC28443E9E5DAB9BE31E259D31736307`<br>(78.9 MB / 82,710,217 B) | `364313E625D20B598D1035350D549A986514CEA9D11B4903ABEE69985A6CAE7A`<br>(22.8 MB / 23,856,282 B) | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.27.0-desktop)<br>[Enterprise](https://github.com/EvolveMinds/evolve-ai-enterprise/releases/tag/v2.27.0-desktop) | Verified & Deployed (`main` commit `45a2b37`) | Antigravity AI Engine |
| **v2.26.0** | 2026-09-25 | `F133B5F7F3EBF7BB388A48AB8D4DF83584ADE1C769A485F80FC4C2EAD265EF8F`<br>(78.8 MB / 82,672,078 B) | `8DBB848C9ADB4ED550B88A33A05645DBCF0B94F3D9FDFDC83C0D227F7AC23130`<br>(22.7 MB / 23,812,480 B) | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.26.0-desktop)<br>[Enterprise](https://github.com/EvolveMinds/evolve-ai-enterprise/releases/tag/v2.26.0-desktop) | Verified & Merged ([PR #2](https://github.com/EvolveMinds/Company/pull/2)) | Antigravity AI Engine |
| **v2.25.0** | 2026-09-22 | `976CA196E6612DD87E2510C78F20A86BBB527A3C67FA72F3F7C3680A51F9A239`<br>(78.8 MB) | N/A | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.25.0-desktop) | Archived in `releaseHistory` | Engineering Team |
| **v2.24.0** | 2026-09-21 | `5176535787FCBCC0E6B0A911E3633495AB80E06DB986B8EB19D99D6A0063E172`<br>(71.5 MB) | N/A | [Public](https://github.com/EvolveMinds/codeforge-ai-vscode/releases/tag/v2.24.0-desktop) | Archived in `releaseHistory` | Engineering Team |
