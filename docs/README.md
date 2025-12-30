# AFU-9 Documentation

## Product Memory (NEW)

The Product Memory system provides a clean, versionable basis for capturing project intent, decisions, and context.

### Quick Start
- **[Memory Index](memory/MEMORY_INDEX.md)** - Entry point for all canonical documentation and current project state
- **[Glossary](canon/GLOSSARY.md)** - Canonical AFU-9 terminology (Runs, Playbooks, Workflows, etc.)

### Canonical Sources (v0.6)
- **[RELEASE.md](releases/v0.6/RELEASE.md)** - v0.6 canonical scope and evidence order
- **[issues.json](releases/v0.6/issues.json)** - Machine-readable issue metadata
- **[Scope Guard](canon/SCOPE_GUARD.md)** - Binding guardrails (G-00 through G-13)
- **[Review Checklist](canon/REVIEW_CHECKLIST.md)** - Review gates for code, evidence, and releases

### Memory Snapshots
- **[Template](memory/templates/MEMORY_SNAPSHOT_TEMPLATE.md)** - Template for creating memory snapshots

---

## Technical Documentation

Documents
=========

- [Checks](checks.md): Full list of all checks done by actionlint with example inputs, outputs, and playground links.
- [Installation](install.md): Installation instructions. Prebuilt binaries, Homebrew package, a Docker image, building from
  source, a download script (for CI) are available.
- [Usage](usage.md): How to use `actionlint` command locally or on GitHub Actions, the online playground, an official Docker
  image, and integrations with reviewdog, Problem Matchers, super-linter, pre-commit.
- [Configuration](config.md): How to configure actionlint behavior. Currently only labels of self-hosted runners can be
  configured.
- [Go API](api.md): How to use actionlint as Go library.
- [References](reference.md): Links to resources.
