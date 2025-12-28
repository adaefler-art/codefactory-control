codefactory-control orchestrates AFU-9: autonomous code fabrication via AWS Lambda, Step Functions,
GitHub Actions and LLM-based patching. Use TypeScript for Lambdas, modular design, async/await,
no secrets in code, and strict alignment with the nine AFU-9 modules. Keep code production-ready
and consistent with the architecture.

## Repo-Regeln (ab 2025-12-28)

- Ändere nur Dateien in: control-center/**, docs/**, scripts/**, .github/**
- Ändere niemals: .next/**, .worktrees/**, standalone/**, lib/** (außer ich sage explizit „infra-scope“)
- Kein Refactor/Umbenennen/Formatieren außerhalb des Problems.
- Halte den Diff minimal und in einem Commit-Block.
- Nach Änderungen: gib PowerShell Kommandos für:
	- npm run repo:verify
	- npm --prefix control-center test
	- npm --prefix control-center run build
- Wenn du feststellst, dass das Problem infra betrifft: STOP und sage „infra-scope nötig“.
