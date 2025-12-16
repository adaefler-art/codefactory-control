---
name: Local Sync
about: Safe, deterministic local ↔ remote synchronization (Git / Windows / Node / CDK)
title: "local-sync: <short description>"
labels: ["local-sync", "ops", "runbook"]
assignees: []
---

## Ziel
Lokale Änderungen **verlustfrei sichern**, Repository **sauber mit origin/main synchronisieren** und WIP **kontrolliert weiterführen** – ohne Merge-Chaos, ohne Datenverlust, ohne implizite Entscheidungen.

Dieses Issue dient als **Runbook** und **Audit-Anker** für wiederkehrende Sync-Probleme.

---

## Kontext
- OS: Windows (PowerShell)
- Repo: `codefactory-control`
- Typische Blocker:
  - lokale Änderungen blockieren `git pull`
  - Windows File Locks (`node.exe`, Next.js)
  - untracked Runtime-/Audit-Artefakte
  - Konflikte in `package.json`

---

## Checkliste (immer in dieser Reihenfolge)

### 1️⃣ Status erfassen
```powershell
git status
git stash list
