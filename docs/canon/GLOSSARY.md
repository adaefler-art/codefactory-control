---
Doc-ID: GLOSSARY-V06
Version: 0.6
Status: CANONICAL
Last-Updated: 2025-12-30
---

# AFU-9 Glossary - Canonical Terminology

**Purpose:** Define core AFU-9 concepts with consistent v0.6/v0.7 semantics.

---

## Core Concepts

### Run
**Definition:** A canonical execution record representing a single execution of a playbook against an issue.

**Characteristics:**
- Immutable once created
- Contains metadata: start time, end time, status, trigger source
- Links to run steps and run artifacts
- Stored in the runs ledger (E63.2)

**Database representation:** `runs` table

**Example:** A GitHub Actions workflow execution triggered for issue I642

---

### Run Steps
**Definition:** Individual stages or phases within a Run, representing discrete units of work.

**Characteristics:**
- Belongs to exactly one Run (parent-child relationship)
- Sequential or parallel execution
- Each step has: name, status, start time, end time, output logs
- Enables granular debugging and progress tracking

**Database representation:** `run_steps` table

**Example:** "Checkout code", "Run tests", "Deploy to staging"

---

### Run Artifacts
**Definition:** Files, outputs, or data generated during a Run or Run Step.

**Characteristics:**
- Associated with a specific Run (and optionally a Run Step)
- Includes: logs, test reports, build outputs, screenshots
- Stored with metadata: artifact type, size, content type, storage location
- Enables evidence collection and post-run analysis

**Database representation:** `run_artifacts` table

**Examples:** `test-results.json`, `deployment-logs.txt`, `coverage-report.html`

---

### Playbook
**Definition:** A class of executable definition that specifies how to perform a specific task or workflow.

**Characteristics:**
- Defines the "what" and "how" of automated execution
- Can be implemented via GitHub Actions workflows, AWS Step Functions, or other engines
- Versioned and parameterized
- Examples: debug playbook, deploy playbook, verification playbook

**NOT to be confused with:** Workflow (which is an engine-level concept)

**Example:** "deploy-determinism-check" playbook (E64.2)

---

### Workflow
**Definition:** Engine-level execution mechanism (e.g., GitHub Actions workflow, AWS Step Functions state machine).

**Characteristics:**
- Implementation detail of how a Playbook is executed
- Not a separate AFU-9 entity at the domain level
- Used interchangeably with "workflow engine" or "execution engine"

**Important:** In AFU-9 semantics, "workflow" refers to the underlying engine mechanism, NOT a third canonical entity alongside Runs and Playbooks.

---

### Verdict
**Definition:** The final outcome or result of a Run, indicating success, failure, or other terminal state.

**Possible values:**
- `SUCCESS` - Run completed successfully
- `FAILURE` - Run failed due to errors
- `CANCELLED` - Run was manually cancelled
- `TIMEOUT` - Run exceeded time limits
- `SKIPPED` - Run was skipped due to conditions

**Characteristics:**
- Immutable once set
- Used for deploy status monitoring (E65.1)
- Feeds into incident detection

---

### Incident
**Definition:** An anomalous event or condition detected during or after a Run that requires attention.

**Characteristics:**
- Can be triggered by: failed runs, timeout, resource issues, security alerts
- Has severity levels: CRITICAL, HIGH, MEDIUM, LOW
- Tracked separately from Runs (though linked)
- May trigger automated remediation or human escalation

**Example:** Deploy status RED after multiple failed verification runs

---

### Context Pack
**Definition:** A curated collection of documentation, code samples, and metadata that provides context for a specific task or domain.

**Status in v0.6:** Not fully implemented; deferred to v0.7

**Intended use:** Enable LLM agents to access relevant context when performing code changes or reviews

**Components (planned):**
- Canonical documentation references
- Code pattern examples
- Domain-specific rules and constraints
- Historical decision records

---

## AFU-9 Architecture Terms

### Control Center
The centralized web application for managing issues, runs, and deployments. Built with Next.js.

### MCP Server
Model Context Protocol server that enables zero-copy debugging by providing context to LLM agents (E63.1).

### Runner Adapter
Integration layer for dispatching and managing executions on GitHub Actions runners (E64.1).

### Deploy Status Monitor
Real-time monitoring system for tracking deployment health (GREEN/YELLOW/RED) (E65.1).

### Runs Ledger
Database component storing canonical execution records (runs, run_steps, run_artifacts) (E63.2).

---

## Relationships

```
Issue (1) ──→ (N) Runs
Run (1) ──→ (N) Run Steps
Run (1) ──→ (N) Run Artifacts
Run Step (1) ──→ (N) Run Artifacts
Playbook (1) ──→ (N) Runs (via execution)
Run (1) ──→ (1) Verdict
Run (1) ──→ (N) Incidents (optional)
```

---

## Version Notes

This glossary reflects v0.6 semantics. Future versions (v0.7+) may expand or refine these definitions, particularly for Context Packs and advanced orchestration concepts.

## References

- [RELEASE.md](../releases/v0.6/RELEASE.md) - v0.6 scope and evidence order
- [SCOPE_GUARD.md](./SCOPE_GUARD.md) - Binding guardrails
- [v0.6 Backlog](../roadmaps/afu9_v0_6_backlog.md) - Original epic and issue definitions
