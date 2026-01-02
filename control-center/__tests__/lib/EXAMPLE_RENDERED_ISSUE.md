# Example GitHub Issue Rendering

This document shows an example of how a CR (Change Request) is rendered as a GitHub issue.

## Input CR JSON

```json
{
  "crVersion": "0.7.0",
  "canonicalId": "CR-2026-01-02-001",
  "title": "Implement GitHub Issue Create/Update Flow",
  "motivation": "Enable automated creation and updating of GitHub issues from INTENT change requests. This provides traceability from conversation to implementation and ensures all work is tracked in GitHub.",
  "scope": {
    "summary": "Implement E75.2 - GitHub Issue Creator with idempotent create/update flow",
    "inScope": [
      "Issue body template rendering with deterministic sections",
      "Label management (AFU-9 labels, state, KPI)",
      "Create/update logic using Canonical-ID Resolver",
      "API endpoint for issue creation from CR"
    ],
    "outOfScope": [
      "GitHub webhook integration",
      "Issue state machine transitions",
      "Multi-repository batch creation"
    ]
  },
  "targets": {
    "repo": {
      "owner": "adaefler-art",
      "repo": "codefactory-control"
    },
    "branch": "main"
  },
  "changes": {
    "files": [
      {
        "path": "control-center/src/lib/github/issue-renderer.ts",
        "changeType": "create",
        "rationale": "Deterministic markdown template for issue bodies"
      },
      {
        "path": "control-center/src/lib/github/issue-creator.ts",
        "changeType": "create",
        "rationale": "Core create/update logic with validation and policy enforcement"
      },
      {
        "path": "control-center/app/api/intent/sessions/[id]/github-issue/route.ts",
        "changeType": "create",
        "rationale": "API endpoint for triggering issue creation"
      }
    ]
  },
  "acceptanceCriteria": [
    "Deterministic issue rendering - same CR produces same markdown",
    "Idempotent operations - repeated calls update same issue",
    "CR validation before network calls",
    "Repo allowlist enforced via I711",
    "Labels applied: afu9, v0.7, state:CREATED, KPI targets",
    "Tests pass and build succeeds"
  ],
  "tests": {
    "required": [
      "Issue creation flow (mock GitHub API)",
      "Issue update flow (preserve markers)",
      "Label merge determinism",
      "CR validation failures",
      "Repo allowlist enforcement"
    ]
  },
  "risks": {
    "items": [
      {
        "risk": "GitHub API rate limits",
        "impact": "medium",
        "mitigation": "Use authenticated app tokens with higher limits"
      }
    ]
  },
  "rollout": {
    "steps": [
      "Deploy to staging",
      "Test with sample CRs",
      "Deploy to production"
    ],
    "rollbackPlan": "Revert deployment; issue creation can be done manually"
  },
  "evidence": [
    {
      "kind": "github_issue",
      "repo": { "owner": "adaefler-art", "repo": "codefactory-control" },
      "number": 751,
      "title": "E75.1: Canonical-ID Resolver"
    }
  ],
  "constraints": {
    "determinismNotes": ["Stable section ordering", "Sorted labels", "Canonical evidence sorting"],
    "idempotencyNotes": ["Resolver ensures same canonicalId → same issue"],
    "lawbookVersion": "0.7.0"
  },
  "metadata": {
    "createdAt": "2026-01-02T16:00:00Z",
    "createdBy": "intent",
    "kpiTargets": ["D2D", "HSH"]
  }
}
```

## Rendered GitHub Issue

### Title
```
[CID:CR-2026-01-02-001] Implement GitHub Issue Create/Update Flow
```

### Body

```markdown
Canonical-ID: CR-2026-01-02-001

**CR-Version:** 0.7.0

---

## Motivation

Enable automated creation and updating of GitHub issues from INTENT change requests. This provides traceability from conversation to implementation and ensures all work is tracked in GitHub.

---

## Scope

**Summary:** Implement E75.2 - GitHub Issue Creator with idempotent create/update flow

**In Scope:**
- Issue body template rendering with deterministic sections
- Label management (AFU-9 labels, state, KPI)
- Create/update logic using Canonical-ID Resolver
- API endpoint for issue creation from CR

**Out of Scope:**
- GitHub webhook integration
- Issue state machine transitions
- Multi-repository batch creation

---

## Planned Changes

### Files
- **create**: `control-center/src/lib/github/issue-renderer.ts` - Deterministic markdown template for issue bodies
- **create**: `control-center/src/lib/github/issue-creator.ts` - Core create/update logic with validation and policy enforcement
- **create**: `control-center/app/api/intent/sessions/[id]/github-issue/route.ts` - API endpoint for triggering issue creation

---

## Acceptance Criteria

1. Deterministic issue rendering - same CR produces same markdown
2. Idempotent operations - repeated calls update same issue
3. CR validation before network calls
4. Repo allowlist enforced via I711
5. Labels applied: afu9, v0.7, state:CREATED, KPI targets
6. Tests pass and build succeeds

---

## Tests

### Required Tests
- Issue creation flow (mock GitHub API)
- Issue update flow (preserve markers)
- Label merge determinism
- CR validation failures
- Repo allowlist enforcement

---

## Risks

### GitHub API rate limits
- **Impact:** medium
- **Mitigation:** Use authenticated app tokens with higher limits

---

## Rollout + Rollback

### Rollout Steps
1. Deploy to staging
2. Test with sample CRs
3. Deploy to production

### Rollback Plan
Revert deployment; issue creation can be done manually

---

## Evidence

### GitHub Issues

- **Issue:** [#751](https://github.com/adaefler-art/codefactory-control/issues/751) - E75.1: Canonical-ID Resolver

---

## Governance

**Lawbook Version:** 0.7.0

**Determinism Notes:**
- Stable section ordering
- Sorted labels
- Canonical evidence sorting

**Idempotency Notes:**
- Resolver ensures same canonicalId → same issue

---

## Meta

**Generated At:** 2026-01-02T16:00:00Z
**Generated By:** INTENT
**CR Version:** 0.7.0
**Canonical ID:** CR-2026-01-02-001
**KPI Targets:** D2D, HSH
```

### Labels Applied

For a **new issue**:
```json
[
  "afu9",
  "kpi:D2D",
  "kpi:HSH",
  "state:CREATED",
  "v0.7"
]
```

For an **existing issue update** (preserving existing labels):
```json
[
  "afu9",
  "custom-label",
  "kpi:D2D",
  "kpi:HSH",
  "state:IN_PROGRESS",
  "v0.7"
]
```

## Key Features

1. **Deterministic Rendering**: Same CR → same markdown every time
2. **Canonical ID Marker**: `Canonical-ID: CR-2026-01-02-001` in body for resolver
3. **Compact Evidence**: References only (no full content)
4. **Governance Metadata**: lawbookVersion, determinism notes, idempotency notes
5. **Structured Sections**: 11 sections in stable order
6. **Label Management**: AFU-9 labels, state tracking, KPI targets
7. **Idempotency**: Repeated generation updates same issue via canonical ID
