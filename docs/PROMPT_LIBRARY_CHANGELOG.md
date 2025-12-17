# Prompt Library Changelog

**Version:** 1.0.0  
**Last Updated:** 2024-12-17

## Overview

This document tracks all changes to the Canonical Prompt Library, including new prompts, version updates, deprecations, and governance changes. It serves as an audit trail for Factory Intelligence evolution.

## Changelog Format

Each entry includes:
- **Date**: When the change occurred
- **Type**: Change category (NEW, UPDATE, DEPRECATE, GOVERNANCE)
- **Prompt/Action**: Name of affected prompt or action
- **Version**: New version number
- **Change Type**: MAJOR, MINOR, or PATCH
- **Description**: What changed and why
- **Impact**: Affected workflows or systems
- **Migration**: Required actions (if any)

---

## 2024-12-17

### NEW: Canonical Prompt Library Framework
**Type:** GOVERNANCE  
**Impact:** All Factory prompts

**Changes:**
- Created canonical prompt library governance framework
- Established semantic versioning rules
- Defined breaking change detection criteria (>50% threshold)
- Implemented traceability through `agent_runs.prompt_version_id`
- Created KPI tracking via `prompt_stability_metrics` view

**Documentation Created:**
- `PROMPT_LIBRARY_CANON.md` - Canonical registry
- `PROMPT_GOVERNANCE.md` - Governance rules
- `PROMPT_LIBRARY.md` - Technical implementation

**Database Schema:**
- Migration 008: Created `prompts`, `prompt_versions`, `actions`, `action_versions` tables
- Added tracking columns to `agent_runs` and `mcp_tool_calls`

---

### NEW: Issue Analyzer Prompt
**Type:** NEW  
**Prompt:** `issue_analyzer`  
**Version:** 1.0.0  
**Category:** analysis

**Purpose:** Analyzes GitHub issues to determine scope, complexity, and implementation approach

**Variables:**
- `title` (string): Issue title
- `body` (string): Issue description
- `labels` (string): Comma-separated labels

**Model Config:**
- Temperature: 0.2
- Max Tokens: 2000

**Status:** ✅ Active and available in canonical library

---

### NEW: Code Reviewer Prompt
**Type:** NEW  
**Prompt:** `code_reviewer`  
**Version:** 1.0.0  
**Category:** review

**Purpose:** Reviews code changes and provides feedback on quality, style, and potential issues

**Variables:**
- `diff` (string): Git diff content
- `pr_title` (string): Pull request title
- `pr_description` (string): Pull request description

**Model Config:**
- Temperature: 0.3
- Max Tokens: 3000

**Status:** ✅ Active and available in canonical library

---

### NEW: Create GitHub Issue Action
**Type:** NEW  
**Action:** `create_github_issue`  
**Version:** 1.0.0  
**Category:** github

**Purpose:** Creates a new GitHub issue in a repository

**Tool Reference:** `github.createIssue`

**Input Schema:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `title` (string, required): Issue title
- `body` (string): Issue description
- `labels` (array[string]): Issue labels

**Output Schema:**
- `number` (integer): Issue number
- `url` (string): Issue API URL
- `html_url` (string): Issue HTML URL

**Status:** ✅ Active and available in canonical library

---

### NEW: Create Pull Request Action
**Type:** NEW  
**Action:** `create_pull_request`  
**Version:** 1.0.0  
**Category:** github

**Purpose:** Creates a new pull request in a repository

**Tool Reference:** `github.createPullRequest`

**Input Schema:**
- `owner` (string, required): Repository owner
- `repo` (string, required): Repository name
- `title` (string, required): PR title
- `body` (string): PR description
- `head` (string, required): Head branch
- `base` (string, required): Base branch

**Output Schema:**
- `number` (integer): PR number
- `url` (string): PR API URL
- `html_url` (string): PR HTML URL

**Status:** ✅ Active and available in canonical library

---

## Upcoming Changes

### Planned for Q1 2025

**Prompt Enhancements:**
- [ ] Add deployment planning prompt
- [ ] Add error diagnosis prompt
- [ ] Add test generation prompt

**Action Additions:**
- [ ] Add GitHub branch operations
- [ ] Add ECS deployment actions
- [ ] Add CloudWatch query actions

**Governance Improvements:**
- [ ] Implement automated breaking change detection
- [ ] Add prompt performance benchmarking
- [ ] Create approval workflow for MAJOR versions

---

## Change Statistics

### Prompts
- **Total Prompts:** 2
- **Active:** 2
- **Deprecated:** 0
- **Archived:** 0

### Actions
- **Total Actions:** 2
- **Active:** 2
- **Deprecated:** 0
- **Archived:** 0

### Versions
- **Total Prompt Versions:** 2 (both v1.0.0)
- **Total Action Versions:** 2 (both v1.0.0)
- **Breaking Changes (MAJOR):** 2 (initial versions)
- **Enhancements (MINOR):** 0
- **Bug Fixes (PATCH):** 0

---

## Metrics Summary

### Prompt Stability (as of 2024-12-17)

Query the latest metrics:
```sql
SELECT * FROM prompt_stability_metrics
ORDER BY total_uses DESC;
```

**Note:** Metrics will be available after prompts are used in production workflows.

---

## Governance Updates

### 2024-12-17: Initial Governance Framework

**Established:**
1. ✅ Semantic versioning (MAJOR.MINOR.PATCH)
2. ✅ Breaking change threshold (>50% content change)
3. ✅ Traceability requirements (prompt_version_id tracking)
4. ✅ Deprecation policy (grace periods: 30/14/7 days)
5. ✅ Quality standards checklist
6. ✅ Rollback procedures

**Review Cycle:**
- Quarterly governance review
- Post-incident reviews as needed
- Next review: 2025-03-17

---

## Breaking Changes History

### 2024-12-17
No breaking changes yet. All current prompts and actions are at v1.0.0 (initial release).

**Future breaking changes will be tracked here with:**
- Date of breaking change
- Prompt/action affected
- Old version → New version
- What broke and why
- Migration guide reference
- Affected workflows

---

## Deprecation History

No deprecations yet. All prompts and actions remain active.

**Future deprecations will be tracked here with:**
- Deprecation date
- Grace period end date
- Reason for deprecation
- Replacement prompt/action
- Migration assistance provided

---

## Related Documentation

- [PROMPT_LIBRARY_CANON.md](./PROMPT_LIBRARY_CANON.md) - Canonical prompt registry
- [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md) - Governance rules
- [PROMPT_LIBRARY.md](./PROMPT_LIBRARY.md) - Technical implementation
- [KPI_DEFINITIONS.md](./KPI_DEFINITIONS.md) - Prompt Stability KPI
- [EPIC6_IMPLEMENTATION_SUMMARY.md](../EPIC6_IMPLEMENTATION_SUMMARY.md) - Implementation details

---

**Maintained by:** AFU-9 Factory Intelligence Team  
**Last Review:** 2024-12-17  
**Next Review:** 2025-01-17
