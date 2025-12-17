# Canonical Prompt Library Registry

**Version:** 1.0.0  
**Last Updated:** 2024-12-17  
**Status:** ✅ Active

## Overview

This document serves as the **canonical registry** for all prompts used in the AFU-9 Factory Intelligence system. Each prompt listed here is versioned, tracked, and governed according to the rules defined in [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md).

## Purpose

The Canonical Prompt Library provides:

1. **Single Source of Truth**: All factory prompts are registered and versioned here
2. **Traceability**: Every agent run tracks which prompt version was used
3. **Breaking Change Management**: Clear rules for versioning and migration
4. **Quality Control**: Standardized prompts ensure consistent Factory behavior
5. **KPI Tracking**: Prompt Stability metrics monitor usage and changes

## Canonical Prompts

### Analysis Category

#### 1. Issue Analyzer (`issue_analyzer`)

**Purpose:** Analyzes GitHub issues to determine scope, complexity, and implementation approach

**Current Version:** 1.0.0  
**Status:** Active  
**Published:** 2024-12-17

**Variables:**
- `title` (string): Issue title
- `body` (string): Issue description
- `labels` (string): Comma-separated labels

**Model Config:**
- Temperature: 0.2
- Max Tokens: 2000

**Usage Context:** Issue interpretation step in AFU-9 workflows

**Change History:**
- v1.0.0 (2024-12-17): Initial version - Analysis framework established

**Database ID:** See `prompts` table, name: `issue_analyzer`

---

### Review Category

#### 2. Code Reviewer (`code_reviewer`)

**Purpose:** Reviews code changes and provides feedback on quality, style, and potential issues

**Current Version:** 1.0.0  
**Status:** Active  
**Published:** 2024-12-17

**Variables:**
- `diff` (string): Git diff content
- `pr_title` (string): Pull request title
- `pr_description` (string): Pull request description

**Model Config:**
- Temperature: 0.3
- Max Tokens: 3000

**Usage Context:** Pull request review workflows

**Change History:**
- v1.0.0 (2024-12-17): Initial version - Code review framework established

**Database ID:** See `prompts` table, name: `code_reviewer`

---

## Prompt Status Definitions

| Status | Description |
|--------|-------------|
| Active | Currently in use and maintained |
| Deprecated | Scheduled for removal, use replacement instead |
| Draft | Under development, not yet published |
| Archived | No longer in use, kept for historical reference |

## Adding New Prompts

To add a new prompt to the canonical library:

1. **Create Prompt via API:**
   ```bash
   POST /api/prompts
   ```
   Provide: name, category, description, purpose, systemPrompt, variables

2. **Document in this Registry:**
   Add entry to appropriate category section with all metadata

3. **Update Change History:**
   Document v1.0.0 creation

4. **Tag in Database:**
   Ensure `prompts` table entry is marked as canonical

5. **Notify Stakeholders:**
   Announce new canonical prompt to team

See [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md) for detailed governance rules.

## Version History

### Registry Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-12-17 | Initial canonical registry with 2 prompts |

## Governance

All prompts in this registry are governed by the rules defined in:
- [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md) - Versioning and change management
- [PROMPT_LIBRARY.md](./PROMPT_LIBRARY.md) - Technical implementation details
- [PROMPT_LIBRARY_CHANGELOG.md](./PROMPT_LIBRARY_CHANGELOG.md) - Complete change history and audit trail
- [KPI_DEFINITIONS.md](./KPI_DEFINITIONS.md) - Prompt Stability KPI metrics

## Traceability

Every agent run that uses a prompt from this library is tracked:

- **Database:** `agent_runs` table includes `prompt_version_id` column
- **Metrics:** `prompt_stability_metrics` view provides usage statistics
- **API:** `/api/metrics?type=prompt-stability` returns KPI data

## Breaking Change Rules

**MAJOR Version (X.0.0)** - Breaking Changes
- Removing required variables
- Changing variable types
- Significant system prompt changes (>50% difference)
- **Requirements:** Document breaking changes, provide migration guide

**MINOR Version (X.Y.0)** - Non-Breaking Additions
- Adding optional variables
- Enhancing prompts without changing core behavior
- **Requirements:** Document improvements

**PATCH Version (X.Y.Z)** - Bug Fixes
- Fixing typos
- Correcting minor issues
- **Requirements:** Brief description

See [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md) for complete versioning rules.

## Quality Standards

All canonical prompts must meet these standards:

1. **Clear Purpose:** Well-defined use case and context
2. **Documented Variables:** All template variables explained
3. **Version History:** Complete changelog of all versions
4. **Test Coverage:** Validated against real scenarios
5. **Performance Metrics:** KPIs tracked via Prompt Stability metrics

## Support

For questions about the Canonical Prompt Library:

1. Review this registry for prompt metadata
2. Check [PROMPT_LIBRARY.md](./PROMPT_LIBRARY.md) for API usage
3. Consult [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md) for change procedures
4. Query `prompt_stability_metrics` view for usage data

## Related Documentation

- [PROMPT_LIBRARY.md](./PROMPT_LIBRARY.md) - Technical implementation and API reference
- [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md) - Governance and change management
- [KPI_DEFINITIONS.md](./KPI_DEFINITIONS.md) - Prompt Stability KPI definition
- [WORKFLOW-SCHEMA.md](./WORKFLOW-SCHEMA.md) - Workflow integration
- [EPIC6_IMPLEMENTATION_SUMMARY.md](../EPIC6_IMPLEMENTATION_SUMMARY.md) - Implementation overview

---

**Last Review:** 2024-12-17  
**Next Review:** 2025-01-17  
**Maintained by:** AFU-9 Factory Intelligence Team
