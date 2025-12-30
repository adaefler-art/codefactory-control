---
Doc-ID: MEMORY-INDEX-V06
Version: 0.6
Status: CANONICAL
Last-Updated: 2025-12-30
---

# AFU-9 Product Memory Index

**Purpose:** Entry point for INTENT, Context Packs, and canonical documentation references.

This index provides a structured view of AFU-9's product memory, linking to canonical sources and current project state.

---

## Canonical Sources

The following documents define the binding truth for v0.6:

### Release Definition
- **[RELEASE.md](../releases/v0.6/RELEASE.md)**
  - Purpose: v0.6 canonical scope, evidence order, and boundaries
  - Status: CANONICAL
  - Last Updated: 2025-12-30

### Issue Metadata
- **[issues.json](../releases/v0.6/issues.json)**
  - Purpose: Machine-readable issue metadata (mode, order, active status)
  - Status: CANONICAL
  - Last Updated: 2025-12-30

### Scope Guard
- **[SCOPE_GUARD.md](../canon/SCOPE_GUARD.md)**
  - Purpose: Binding guardrails for code quality, API patterns, and consistency
  - Status: CANONICAL (copied from docs/guardrails/GUARDRAIL_CONSISTENCY_CANONICALS.md)
  - Last Updated: 2025-12-30

### Review Checklist
- **[REVIEW_CHECKLIST.md](../canon/REVIEW_CHECKLIST.md)**
  - Purpose: Review gates for code, evidence, and releases
  - Status: CANONICAL
  - Last Updated: 2025-12-30

### Terminology
- **[GLOSSARY.md](../canon/GLOSSARY.md)**
  - Purpose: Canonical definitions for Runs, Playbooks, Workflows, Verdicts, Incidents, Context Packs
  - Status: CANONICAL
  - Last Updated: 2025-12-30

---

## Current Mode

**Release Mode:** `REVIEW_ONLY`

**Current Release:** v0.6

**Canonical Evidence Order:**

1. **E63.2** - Runs Ledger DB (runs, run_steps, run_artifacts) ✓
2. **E63.3** - Issue UI Runs Tab (Start, Re-run, Logs, Artifacts) ✓
3. **E64.1** - GitHub Runner Adapter (dispatch, poll, ingest) ✓
4. **E64.2** - Playbook Deploy Determinism Check ✓
5. **E65.1** - Deploy Status Monitor (GREEN/YELLOW/RED) ✓
6. **E65.2** - Post-Deploy Verification Playbook (in progress)

**Active Issues:** None (REVIEW_ONLY mode)

---

## Context Packs

Context Packs are curated collections of documentation and code samples for specific domains or tasks.

**Status in v0.6:** Not fully implemented. Deferred to v0.7.

**Future Context Packs (planned):**
- API Development Context Pack
- Database Migration Context Pack
- Deploy & Verification Context Pack
- UI Component Development Context Pack

---

## Memory Snapshots

Memory snapshots capture the project state at specific points in time, providing historical context and decision records.

### Template
- **[MEMORY_SNAPSHOT_TEMPLATE.md](./templates/MEMORY_SNAPSHOT_TEMPLATE.md)**
  - Purpose: Template for creating memory snapshots
  - Use when: Completing evidence items, making architectural decisions, or documenting incidents

### Active Snapshots
(None yet - snapshots will be created as v0.6 progresses)

---

## How to Use This Index

### For LLM Agents
1. Start here to understand canonical sources and current mode
2. Consult GLOSSARY.md for terminology
3. Check SCOPE_GUARD.md before making code changes
4. Review RELEASE.md for scope boundaries
5. Use REVIEW_CHECKLIST.md before submitting changes

### For Developers
1. Reference canonical sources for binding requirements
2. Create memory snapshots when completing evidence items
3. Update issues.json when issue status changes
4. Follow guardrails and review gates

### For Product/PM
1. Track progress via canonical evidence order
2. Understand scope boundaries via RELEASE.md
3. Review memory snapshots for historical decisions
4. Use issues.json for current state

---

## Related Documentation

### Project Documentation
- [v0.6 Backlog](../roadmaps/afu9_v0_6_backlog.md) - Original epic and issue definitions
- [v0.7 Backlog](../roadmaps/afu9_v0_7_backlog.md) - Future scope

### Technical Documentation
- [API Routes](../API_ROUTES.md)
- [Database Contract Pattern](../DB_CONTRACT_PATTERN.md)
- [MCP Server Documentation](../mcp/)

### Guardrails Source
- [GUARDRAIL_CONSISTENCY_CANONICALS.md](../guardrails/GUARDRAIL_CONSISTENCY_CANONICALS.md) - Original source (kept for reference)

---

## Maintenance

This index should be updated when:
- Release mode changes (e.g., from REVIEW_ONLY to ACTIVE)
- New canonical documents are added
- Evidence order is modified
- Context Packs are implemented

**Maintainer:** AFU-9 Documentation Copilot  
**Review Frequency:** At each evidence item completion
