---
Doc-ID: MEMORY-SNAPSHOT-TEMPLATE
Version: 0.6
Status: TEMPLATE
Last-Updated: 2025-12-30
---

# Memory Snapshot Template

**Purpose:** Capture project state, decisions, and context at specific points in time.

**When to use:**
- Completing evidence items
- Making architectural or design decisions
- Documenting incidents or production issues
- End of sprint/milestone
- Before major refactoring

**Instructions:** Copy this template, fill in all sections, and save with naming convention:
`SNAPSHOT-YYYY-MM-DD-<brief-description>.md`

---

## Metadata

**Date:** YYYY-MM-DD  
**Snapshot ID:** SNAP-XXXX (sequential, e.g., SNAP-0001)  
**Author:** [Your name or agent name]  
**Release:** v0.X  
**Mode:** [REVIEW_ONLY | ACTIVE | DEPLOY | etc.]

---

## Covered Evidence

**Evidence IDs:** List all evidence items this snapshot relates to (e.g., E63.2, E64.1)

**Links to Evidence:**
- [E63.2 Implementation Summary](../path/to/E63_2_IMPLEMENTATION_SUMMARY.md)
- [E64.1 Implementation Summary](../path/to/E64_1_IMPLEMENTATION_SUMMARY.md)
- [Related PR](https://github.com/org/repo/pull/XXX)
- [Related Issue](https://github.com/org/repo/issues/XXX)

**Completion Status:**
- E63.2: ✓ Complete
- E64.1: ⧗ In Progress
- E64.2: ☐ Not Started

---

## Current Release Mode

**Mode:** [REVIEW_ONLY | ACTIVE | DEPLOY]

**Description:** Briefly describe what this mode means for the current state.

Example: "REVIEW_ONLY - All v0.6 evidence items are code-complete. Currently in review phase before release."

---

## Active Order

**Canonical Evidence Order:**

1. E63.2 - [Status: ✓/⧗/☐] - [Brief note]
2. E63.3 - [Status: ✓/⧗/☐] - [Brief note]
3. E64.1 - [Status: ✓/⧗/☐] - [Brief note]
4. E64.2 - [Status: ✓/⧗/☐] - [Brief note]
5. E65.1 - [Status: ✓/⧗/☐] - [Brief note]
6. E65.2 - [Status: ✓/⧗/☐] - [Brief note]

**Currently Active:** [E-ID or "None"]

---

## Key Decisions

**Requirement:** Each decision MUST include evidence references (links to PRs, issues, docs, or commits).

### Decision 1: [Brief Title]

**Date:** YYYY-MM-DD  
**Context:** Why was this decision needed?

**Decision:** What was decided?

**Rationale:** Why was this approach chosen?

**Alternatives Considered:**
- Option A: [Pros/Cons]
- Option B: [Pros/Cons]

**Evidence:**
- [PR #123](https://github.com/org/repo/pull/123) - Implementation
- [Discussion in issue #456](https://github.com/org/repo/issues/456#issuecomment-xxx)
- [Architecture doc](../path/to/doc.md)

**Impact:**
- Affected components: [List]
- Migration required: [Yes/No]
- Breaking changes: [Yes/No]

---

### Decision 2: [Brief Title]

[Repeat structure above for each decision]

---

## Open Risks

**Requirement:** Each risk MUST include evidence or references.

### Risk 1: [Brief Title]

**Severity:** [CRITICAL | HIGH | MEDIUM | LOW]  
**Likelihood:** [HIGH | MEDIUM | LOW]

**Description:** What is the risk?

**Impact if realized:** What happens if this risk materializes?

**Mitigation:** What are we doing to reduce or eliminate this risk?

**Evidence:**
- [Related incident](../path/to/incident-report.md)
- [Monitoring dashboard](https://link-to-dashboard)

**Owner:** [Name or team]  
**Target Resolution:** YYYY-MM-DD

---

### Risk 2: [Brief Title]

[Repeat structure above for each risk]

---

## Open Questions

**Requirement:** Track unresolved questions that need answers.

1. **Question:** [The question]
   - **Context:** Why is this important?
   - **Owner:** Who is responsible for answering?
   - **Target Date:** When do we need an answer?
   - **References:** [Links to discussions, docs]

2. **Question:** [The question]
   [Repeat structure]

---

## Next Actions

**Requirement:** Each action MUST have an owner and target date.

### Immediate (Within 1 week)

1. **Action:** [What needs to be done]
   - **Owner:** [Name]
   - **Target:** YYYY-MM-DD
   - **Evidence/Link:** [Related issue or PR]

2. **Action:** [What needs to be done]
   [Repeat structure]

### Short-term (1-4 weeks)

1. **Action:** [What needs to be done]
   - **Owner:** [Name]
   - **Target:** YYYY-MM-DD
   - **Evidence/Link:** [Related issue or PR]

### Long-term (1+ months)

1. **Action:** [What needs to be done]
   - **Owner:** [Name]
   - **Target:** YYYY-MM-DD or "v0.X"
   - **Evidence/Link:** [Related backlog item]

---

## Technical Notes

**Optional section for technical details, debugging notes, or implementation observations.**

### Performance Observations
- Metric: Value
- Benchmark: Results

### Known Issues
- Issue: Description
- Workaround: If any

### Dependencies
- External service versions
- Library versions
- Infrastructure requirements

---

## References

**All referenced documents and evidence:**

- [RELEASE.md](../../releases/v0.6/RELEASE.md)
- [issues.json](../../releases/v0.6/issues.json)
- [SCOPE_GUARD.md](../../canon/SCOPE_GUARD.md)
- [Implementation Summary](../path/to/doc.md)
- [PR #XXX](https://github.com/org/repo/pull/XXX)

---

## Template Version

**Template Version:** 1.0  
**Template Last Updated:** 2025-12-30  
**Template Source:** docs/memory/templates/MEMORY_SNAPSHOT_TEMPLATE.md

---

## Instructions for Completing This Template

1. **Replace all placeholders** (text in [brackets], YYYY-MM-DD, etc.)
2. **Provide evidence** for all decisions, risks, and actions
3. **Be specific** - avoid vague statements
4. **Link liberally** - reference PRs, issues, commits, docs
5. **Update Active Order** based on current issues.json
6. **Remove this instructions section** when creating actual snapshot
7. **Save with proper naming:** `SNAPSHOT-YYYY-MM-DD-<description>.md`
8. **Add link** to this snapshot in MEMORY_INDEX.md

**Example filename:** `SNAPSHOT-2025-12-30-e63-2-completion.md`
