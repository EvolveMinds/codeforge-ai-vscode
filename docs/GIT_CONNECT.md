# Git/Bitbucket Connect Wizard

> **Status:** Released in v2.0.0. Mirrors the Gemma 4 setup wizard pattern.
> **Goal:** Take a user from "fresh folder" or "disconnected repo" to a verified `git push` in one command — no docs-hunting, no shell incantations.

---

## When to use it

Run **Evolve AI: Connect Git Remote (Wizard)** when:

- You opened a folder that isn't a git repo yet and want it linked to GitHub or Bitbucket.
- You cloned a fresh repo on a new machine and HTTPS keeps prompting for a username.
- You want to rotate auth — switch from HTTPS PAT to SSH, or from `gh auth login` to VS Code's built-in GitHub provider.
- The status bar shows `· not connected` next to the branch name.

The wizard also runs automatically (as a one-time non-blocking toast) the first time you open a workspace whose `.git/` exists but has no `origin` remote configured. Dismiss with **"Don't show again"** to silence forever per workspace.

---

## What it inspects (read-only)

Before doing anything, the wizard collects a profile of your environment:

| Probe | What it checks |
|---|---|
| Git install | `git --version` — installed? version recent enough? |
| Identity | `git config --global user.name` / `user.email` — set? |
| Repo state | Inside a git work tree? Branch? Has commits? |
| Remote | `git remote get-url origin` — configured? Host? Protocol? |
| SSH keys | `~/.ssh/*.pub` — existing public keys |
| GitHub CLI | `gh --version` and `gh auth status` |
| VS Code GitHub session | `vscode.authentication.getSession('github', …, { silent: true })` |
| Credential helper | `git config --global --get credential.helper` |
| Stored PATs | Whether a token already exists in `vscode.SecretStorage` |
| Workspace trust | `vscode.workspace.isTrusted` — wizard refuses to act if false |

All probes run in parallel with timeouts and never throw. Nothing leaves your machine.

---

## What it does (with consent)

The orchestrator builds a step list — only steps that aren't already satisfied are added — then runs them inside a single `vscode.window.withProgress` notification with a working **Cancel** button.

### 1. Install Git (only if missing)

| Platform | Action |
|---|---|
| Windows | Opens the official installer page; polls `git --version` for up to 5 minutes |
| macOS | Triggers `xcode-select --install` in a managed terminal; polls for completion |
| Linux | Opens a managed terminal with package-manager install commands (apt / dnf / pacman); polls for completion |

### 2. Set identity (only if missing)

Asks for `name` and `email` (validated against a basic email regex), then runs `git config --global user.name "…"` / `user.email "…"`.

### 3. Init / clone / link repo

Three options shown depending on the workspace state:

- **Initialise empty repo here** — `git init -b main` (falls back to plain `git init` for old git versions).
- **Clone existing repo into this folder** — `git clone <url> .` (folder must be empty).
- **Link to existing remote (no clone)** — `git init` if needed, then `git remote add origin <url>` (or `set-url` if origin already exists).

### 4. Configure auth — pick what fits you

The wizard offers only the methods that make sense for your host and what's on your system. Choices:

#### Sign in with VS Code  *(recommended for github.com)*

Calls `vscode.authentication.getSession('github', ['repo','workflow','read:user'], { createIfNone: true })`. The token is owned by VS Code's built-in GitHub auth provider — refresh, revocation, and expiry are handled for you. **No token to paste, nothing to store.** Available only for github.com.

#### Personal Access Token / Bitbucket App Password

Wizard opens the right "create token" page and waits for you to paste:

- **GitHub**: `https://github.com/settings/tokens/new?scopes=repo,workflow&description=Evolve+AI+(VS+Code)`. Required scopes: `repo`, `workflow`.
- **Bitbucket**: `https://bitbucket.org/account/settings/app-passwords/new`. Paste as `username:app_password`. Required scopes: Repositories Read + Write.
- **GitLab / other**: PAT works the same way — paste raw token.

Token is **validated** before storage:
- GitHub: `GET https://api.github.com/user` — must return 200.
- Bitbucket: `GET https://api.bitbucket.org/2.0/user` with HTTP Basic auth.

If validation succeeds, the token is stored in `vscode.SecretStorage` under `aiForge.githubPAT` or `aiForge.bitbucketPAT`. **It never touches `settings.json`.**

##### Credential helper handling

If you already have a `credential.helper` configured globally (`manager` on Windows, `osxkeychain` on macOS, `store` on Linux), **the wizard does not overwrite it**. Instead it embeds the token in the remote URL using `git remote set-url origin https://<user>:<token>@host/owner/repo.git`. This is done with explicit consent — we tell you what we're about to do before running it.

If no helper is set, the token sits only in SecretStorage; we don't auto-write a `~/.git-credentials` file.

#### SSH key

1. Detects `~/.ssh/id_ed25519.pub`. If missing, generates a new keypair via `ssh-keygen -t ed25519 -C "<your-email>" -f ~/.ssh/id_ed25519 -N "<passphrase>"`. The wizard uses `spawn` with `shell: false` and an args array — no PowerShell quoting issues on Windows.
2. Copies the **public** key to your clipboard and opens the platform's "Add SSH key" page (`https://github.com/settings/ssh/new` or `https://bitbucket.org/account/settings/ssh-keys/`).
3. Waits for you to confirm "I've added it" via a modal dialog.
4. Tests with `ssh -T -o StrictHostKeyChecking=accept-new -o BatchMode=yes git@<host>`. GitHub returns exit 1 with "successfully authenticated" — the wizard parses for that string. Bitbucket returns exit 0.

> **Windows note:** OpenSSH client must be installed. If `ssh-keygen` fails with "not found", enable **Settings → Apps → Optional features → OpenSSH Client**, then re-run the wizard.

#### GitHub CLI (`gh auth login`)

Only offered if `gh --version` works. The wizard launches `gh auth login --hostname github.com --git-protocol https --web` in a managed terminal. After you click **"I'm done"**, it verifies with `gh auth status --hostname github.com` and parses for `Logged in to`.

### 5. Create remote on the platform  *(optional)*

If your repo doesn't have an `origin` yet, the wizard offers to create one for you:

- Asks for `owner/name` (GitHub) or `workspace/slug` (Bitbucket).
- Asks Private vs Public.
- Calls `POST https://api.github.com/user/repos` (or `/orgs/<org>/repos` if `owner` differs from your login), or `POST https://api.bitbucket.org/2.0/repositories/<workspace>/<slug>` for Bitbucket.
- Adds the returned clone URL as `origin`.

This step requires a token — either a freshly-validated PAT (PAT path) or the VS Code GitHub session (`github-builtin` path).

### 6. Push HEAD  *(optional, off by default)*

Set `aiForge.gitConnect.pushOnConnect` to `true` to run `git push -u origin HEAD` after the remote is in place. This sets upstream tracking so future `git push` / `git pull` work without arguments.

### 7. Verify connection

Always runs (unless you set `aiForge.gitConnect.autoVerify` to `false`). Detects HTTPS-vs-SSH from the origin URL, then runs `git ls-remote --heads origin` with a 10-second timeout. If it succeeds, you're done. If it fails, the wizard surfaces the exact `git` error in a single toast — no nested errors.

---

## Privacy & security

| Concern | What we do |
|---|---|
| Tokens in `settings.json` | **Never.** Always `vscode.SecretStorage`. |
| SSH private keys | Never read or transmitted. We only generate them at your request and copy `.pub` to clipboard. |
| Existing `credential.helper` | Never overwritten. We use SecretStorage + URL-embedded token (with consent) instead. |
| Workspace trust | Wizard refuses to run in untrusted workspaces (matches `configSafe.readHostSetting`). |
| API timeouts | All token validation and repo-creation calls have a 10-second timeout — no silent hangs. |
| Network errors | Surface as a single error toast; no nested error chains. |
| Cancel mid-flow | `Esc` on the progress notification aborts the orchestrator's `AbortSignal` cleanly. |

---

## Commands

| Command | Description |
|---|---|
| `Evolve AI: Connect Git Remote (Wizard)` | Main entry — runs the wizard end-to-end. |
| `Evolve AI: Git Connection Status` | Prints a one-line summary of the inspector's findings; offers buttons to run the wizard, open settings, or close. |
| `Evolve AI: Disconnect Git Credentials` | Quick pick to remove stored PATs / app passwords. SSH keys are **never** deleted. To fully sign out of VS Code's GitHub provider, use the workbench Accounts menu. |
| `Evolve AI: Test Git Remote Connection` | Re-runs `git ls-remote origin` on demand. Useful after rotating credentials on the platform. |

---

## Settings (`aiForge.gitConnect.*`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `preferredAuth` | `'auto' \| 'github-builtin' \| 'pat' \| 'ssh' \| 'gh-cli'` | `auto` | Which auth method to pre-select in the wizard's quick pick. |
| `autoVerify` | boolean | `true` | Run `git ls-remote origin` after the wizard finishes to confirm everything works. |
| `pushOnConnect` | boolean | `false` | After creating / linking the remote, run `git push -u origin HEAD`. |
| `statusHint` | boolean | `true` | When the repo has no remote, append `· not connected` to the status bar item and show a one-time first-run toast. |

### SecretStorage keys

| Key | Stored when |
|---|---|
| `aiForge.githubPAT` | User chose the PAT path for GitHub. |
| `aiForge.bitbucketPAT` | User chose the PAT path for Bitbucket — stored as `username:app_password`. |

---

## Troubleshooting

### "This workspace is not trusted"
Click **Trust** in the workbench toolbar, then re-run the wizard.

### `ssh-keygen: command not found` (Windows)
Open **Settings → Apps → Optional features → Add a feature → OpenSSH Client** and install. Re-run the wizard.

### SSH test fails with "Host key verification failed"
Run `ssh-keygen -R github.com` (or `bitbucket.org`) to remove a stale entry, then retry the wizard.

### Bitbucket PAT is rejected
Bitbucket app passwords use HTTP Basic auth — paste them as `username:app_password` (separated by a colon). Token-only does not work.

### `gh auth login` succeeds in the terminal but the wizard says "not logged in"
Make sure you finished the browser flow before clicking **"I'm done"**. Verify manually with `gh auth status --hostname github.com`.

### `git push` failed after `pushOnConnect`
The default branch on the platform may differ from your local `HEAD`. Check the platform's repo page (often `main`), then run `git push -u origin <branch>` manually.

### Clearing tokens but VS Code still shows me as signed in
`Disconnect Git Credentials` clears stored PATs. To fully sign out of VS Code's GitHub provider, click the **Accounts** icon at the bottom-left of the workbench → **GitHub → Sign Out**.

### How do I rotate a token?
Run **Disconnect Git Credentials** and pick the relevant PAT, then re-run the wizard. The wizard will validate the new token and (if a `credential.helper` isn't set) re-embed it into the remote URL.

---

## Architecture (for contributors)

The wizard mirrors the Gemma 4 setup pattern intentionally — see [ARCHITECTURE.md](ARCHITECTURE.md) for the broader picture.

- `src/core/processUtil.ts` — shared `runCommand` / `runForStdout` / `waitForCommand` / `versionLessThan`. Used by both this wizard and the Gemma 4 wizard.
- `src/core/gitConnectInspector.ts` — read-only detection. Returns a `GitConnectProfile` and a `recommendNextStep` for the wizard's starting screen.
- `src/core/gitConnectOrchestrator.ts` — `planSteps()` returns a step list, `execute()` runs them inside `withProgress` with a single AbortController.
- `src/commands/gitConnectCommands.ts` — the four user-facing commands; drives the choice-collection UX via `showQuickPick` / `showInputBox` / `showInformationMessage`.
- `src/plugins/git.ts` — surfaces a `· not connected` hint in the status bar and a one-time first-run toast; adds a `git.connection` context hook so AI prompts know whether the workspace is connected.

The wizard's services are wired into `IServices` as **optional** (`gitConnectInspector?` / `gitConnectOrchestrator?`) so test mocks don't need to implement them. They are always present in the production `ServiceContainer`.
