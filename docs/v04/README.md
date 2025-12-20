# AFU-9 v0.4 Documentation Hub

This folder is the single source of truth for AFU-9 v0.4 planning, implementation, and release documentation.

## 🎯 Quick Start

**New to v0.4?** Start here:
- **[v0.4 Release Review](V04_RELEASE_REVIEW.md)** — **CANONICAL** reference for v0.4 stable features, scope, and foundation for v0.5

## 📋 Core Documentation

### Release & Planning
- **[V04_RELEASE_REVIEW.md](V04_RELEASE_REVIEW.md)** — Complete v0.4 release review and reference state (Issue I-06-01)
- `README-V04-ISSUES.md` — Full guide for the v0.4 milestone/issue import package
- `EXECUTION-INSTRUCTIONS.md` — Runbook for executing the import via GH Actions, TS, or Bash
- `SUMMARY.md` — One-page snapshot of the package (what it contains and expected outputs)

### Architecture & Implementation
- `v0.2-SUMMARY.md` — v0.2 architecture implementation overview
- `ECS_STABILIZATION_SUMMARY.md` — ECS deployment stabilization achievements

## Notes
- Automation workflow archive: `.github/workflows/_archived/import-v04-issues.yml`
- Data + scripts stay under `scripts/` (see `afu9-v04-issues-data.json`, `import-afu9-v04-issues.*`)
- When linking from other docs, reference this folder as the canonical location for v0.4 docs
