---
Doc-ID: RELEASE-V06
Version: 0.6
Status: CANONICAL
Last-Updated: 2025-12-30
---

# AFU-9 Release v0.6 - Canonical Scope & Order

**Release Version:** v0.6  
**Status:** REVIEW_ONLY  
**Date:** 2025-12-30

## Overview

AFU-9 v0.6 establishes the foundation for autonomous code fabrication through issue lifecycle management, MCP-based debugging, and deployment guardrails.

## Canonical Evidence Order

The following evidence items define the v0.6 scope in canonical order:

1. **E63.2** - Runs Ledger DB (runs, run_steps, run_artifacts)
2. **E63.3** - Issue UI Runs Tab (Start, Re-run, Logs, Artifacts)
3. **E64.1** - GitHub Runner Adapter (dispatch, poll, ingest)
4. **E64.2** - Playbook Deploy Determinism Check
5. **E65.1** - Deploy Status Monitor (GREEN/YELLOW/RED)
6. **E65.2** - Post-Deploy Verification Playbook

## Epics

### EPIC E61 — Issue Lifecycle, Activation & GitHub Handoff
- I611 (E61.1): Issue Lifecycle State Machine & Events Ledger
- I612 (E61.2): Activate Semantik (maxActive=1) atomar erzwingen
- I613 (E61.3): GitHub Handoff Metadaten + Idempotenz

### EPIC E62 — Control Center UX: Issue-Liste & Detail
- I621 (E62.1): Issue Liste: Filter, Sort, Labels, Status
- I622 (E62.2): Issue Detail: Edit, Activity Timeline, Actions

### EPIC E63 — MCP Server Zero-Copy Debugging MVP
- I631 (E63.1): MCP Server Skeleton + RunSpec/RunResult Contracts
- I632 (E63.2): Runs Ledger DB (runs, run_steps, run_artifacts)
- I633 (E63.3): Issue UI Runs Tab (Start, Re-run, Logs, Artefakte)

### EPIC E64 — Runner Adapter: GitHub Runner Execution
- I641 (E64.1): GitHub Runner Adapter (dispatch, poll, ingest)
- I642 (E64.2): Playbook Deploy Determinism Check

### EPIC E65 — Deploy & Operate Guardrails
- I651 (E65.1): Deploy Status Monitor (GREEN/YELLOW/RED)
- I652 (E65.2): Post-Deploy Verification Playbook

## Release Scope Boundaries

### In Scope
- Issue lifecycle and activation semantics
- MCP-based debugging infrastructure
- GitHub Actions runner integration
- Deploy monitoring and verification
- Control Center UI for issue and run management

### Out of Scope
- Advanced playbook orchestration (deferred to v0.7)
- Multi-repository support
- Advanced incident management
- Context Pack full implementation

## Dependencies

- GitHub App integration (pre-existing)
- PostgreSQL database
- GitHub Actions runners
- AWS infrastructure (Lambda, Step Functions)

## Success Criteria

1. Issues can be activated and handed off to GitHub Actions
2. Debug runs are recorded in the runs ledger
3. Deploy status is monitored and reported
4. All evidence items (E63.2 through E65.2) are complete

## References

- [v0.6 Backlog](../../roadmaps/afu9_v0_6_backlog.md)
- [v0.7 Backlog](../../roadmaps/afu9_v0_7_backlog.md)
- [Scope Guard](../../canon/SCOPE_GUARD.md)
