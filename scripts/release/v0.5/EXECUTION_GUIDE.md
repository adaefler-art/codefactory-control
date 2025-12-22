# AFU-9 v0.4 Release + v0.5 Project — Execution Guide (PowerShell-first)

This guide is the canonical, repo-local replacement for any previous temp-directory release script references.

## Prereqs

- Git configured and authenticated for `origin`
- Optional: GitHub CLI `gh` installed and authenticated (`gh auth status`)

## One-command (recommended)

From repo root:

```powershell
pwsh ./scripts/release/v0.5/create-release-and-project.ps1
```

By default this is **dry-run** (prints commands). To execute:

```powershell
pwsh ./scripts/release/v0.5/create-release-and-project.ps1 -Execute
```

## Manual (explicit)

### 1) Create and push annotated tag

```powershell
git fetch --tags origin
git tag -a v0.4.0 22cdb6a41c42366ad165a0fb4c96282304f6f7ae -m "Release v0.4.0"
git push origin v0.4.0
```

### 2) Create GitHub release

Web UI: https://github.com/adaefler-art/codefactory-control/releases/new

Or GitHub CLI:

```powershell
gh release create v0.4.0 `
  --repo adaefler-art/codefactory-control `
  --title "AFU-9 v0.4.0" `
  --notes-file "./scripts/release/v0.5/release-notes-v0.4.0.md" `
  --target 22cdb6a41c42366ad165a0fb4c96282304f6f7ae `
  --verify-tag
```

### 3) Create GitHub project (v0.5)

Web UI: https://github.com/orgs/adaefler-art/projects

Or GitHub CLI:

```powershell
gh project create --owner adaefler-art --title "AFU-9 Codefactory v0.5"
```

### 4) Create issues

Use the authoritative backlog list in `docs/v05/V05_RELEASE_PREP.md`.
