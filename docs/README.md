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

## Version-Specific Evidence

Evidence documentation (implementation summaries, testing guides, sanity checks) is organized by version:

- **[v0.6 Evidence](v06/evidence/)** - E61-E65 implementation details
- **[v0.7 Evidence](v07/evidence/)** - E70-E79 implementation details

---

## Technical Documentation

- **[AFU-9 Runtime Policy & Service Auth](architecture/afu9-runtime-policy.md)** — Single source of truth for cluster/service policy and Engine ↔ Control-Center auth.
