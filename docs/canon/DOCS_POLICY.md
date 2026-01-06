# Documentation Policy

**Version**: 1.0  
**Date**: 2026-01-06  
**Scope**: AFU-9 Control Repository  
**Authority**: Engineering Team + Copilot Agents

---

## Purpose

This document establishes governance rules for documentation in the AFU-9 Control repository, ensuring:

1. **Consistency**: Uniform structure and naming across all docs
2. **Discoverability**: Predictable locations for all documentation types
3. **Versioning**: Clear version lineage for release-specific docs
4. **Evidence**: Merge evidence and implementation summaries are preserved
5. **Minimal Sprawl**: Docs are consolidated, not scattered across repository

---

## Documentation Structure

### Root-Level Documents (Allowlist Only)

Only these documents are permitted at repository root:

```
/README.md                 - Primary repository documentation
/CHANGELOG.md              - Version history and changes
/CONTRIBUTING.md           - Contribution guidelines
/SECURITY.md               - Security policy and reporting
/LICENSE                   - Repository license
/CODE_OF_CONDUCT.md        - Community code of conduct
/.gitignore                - Git ignore rules
/.gitleaks.toml            - Secret scanning configuration
/package.json              - Root package manifest
/tsconfig.json             - TypeScript configuration
/cdk.json                  - AWS CDK configuration
/docker-compose.yml        - Local development Docker config
```

**All other documentation** must reside in `/docs`.

---

### /docs Directory Structure

```
docs/
├── audit/                          # Audit reports (by version)
│   └── v0.7/
│       ├── ROADMAP_PARITY_REPORT.md
│       ├── DOC_INDEX.md
│       ├── ENDPOINT_INVENTORY.md
│       ├── ENDPOINT_UI_MATRIX.md
│       ├── CONFIG_SURFACE.md
│       └── AUTHZ_POLICY_AUDIT.md
│
├── merge-evidence/                 # Implementation summaries and merge evidence
│   ├── v0.6/
│   │   ├── E61/
│   │   ├── E62/
│   │   └── ...
│   ├── v0.7/
│   │   ├── E71/
│   │   │   ├── E71_1_IMPLEMENTATION_SUMMARY.md
│   │   │   ├── E71_1_ENFORCEMENT_SUMMARY.md
│   │   │   ├── E71_2_IMPLEMENTATION_SUMMARY.md
│   │   │   └── ...
│   │   ├── E72/
│   │   ├── E73/
│   │   ├── E74/
│   │   ├── E75/
│   │   ├── E76/
│   │   ├── E77/
│   │   ├── E78/
│   │   ├── E79/
│   │   ├── E7.0/
│   │   └── E80/
│   └── v0.8/
│
├── design/                         # Design patterns and UI guidelines
│   ├── UI_DESIGN_PATTERNS.md
│   ├── COMPONENT_LIBRARY.md
│   └── ACCESSIBILITY.md
│
├── architecture/                   # System architecture
│   ├── README.md
│   ├── AFU9_ARCHITECTURE.md
│   ├── AWS_INFRASTRUCTURE.md
│   └── MCP_DESIGN.md
│
├── roadmaps/                       # Product roadmaps
│   ├── afu9_v0_7_backlog.md
│   ├── afu9_v0_8_backlog.md
│   └── ...
│
├── releases/                       # Release notes and changelogs
│   ├── v0.6/
│   │   └── RELEASE.md
│   ├── v0.6.5.md
│   └── v0.7/
│       └── RELEASE.md
│
├── runbooks/                       # Operational runbooks
│   ├── DEPLOY_RUNBOOK.md
│   ├── INCIDENT_RESPONSE.md
│   ├── MIGRATION_RUNBOOK.md
│   └── ROLLBACK_PROCEDURE.md
│
├── canon/                          # Canonical definitions
│   ├── GLOSSARY.md
│   ├── TERMINOLOGY.md
│   └── STANDARDS.md
│
├── db/                             # Database documentation
│   ├── SCHEMA.md
│   ├── MIGRATIONS.md
│   └── QUERY_PATTERNS.md
│
├── guardrails/                     # Guardrail policies
│   ├── GUARDRAILS_OVERVIEW.md
│   └── POLICY_DEFINITIONS.md
│
├── lawbook/                        # Lawbook documentation
│   ├── LAWBOOK_SCHEMA.md
│   └── VERSIONING.md
│
├── playbooks/                      # Remediation playbooks (documentation)
│   ├── PLAYBOOK_FRAMEWORK.md
│   └── PLAYBOOK_CATALOG.md
│
└── DOCS_POLICY.md                  # This file
```

---

## Naming Conventions

### Implementation Summaries

**Format**: `E{epic}_{issue}_IMPLEMENTATION_SUMMARY.md`

**Examples**:
- `E71_1_IMPLEMENTATION_SUMMARY.md`
- `E78_4_IMPLEMENTATION_SUMMARY.md`

**Location**: `/docs/merge-evidence/v{version}/E{epic}/`

### Verification Commands

**Format**: `E{epic}_{issue}_VERIFICATION_COMMANDS.md`

**Examples**:
- `E71_1_VERIFICATION_COMMANDS.md`
- `E80_1_VERIFICATION_COMMANDS.md`

**Location**: `/docs/merge-evidence/v{version}/E{epic}/`

### Evidence Files

**Format**: `E{epic}_{issue}_EVIDENCE.md`

**Examples**:
- `E79_1_EVIDENCE.md`
- `E7_0_4_EVIDENCE.md`

**Location**: `/docs/merge-evidence/v{version}/E{epic}/`

### Visual Guides

**Format**: `E{epic}_{issue}_UI_VISUAL_GUIDE.md`

**Examples**:
- `E74_3_UI_VISUAL_GUIDE.md`
- `E80_1_UI_VISUAL_GUIDE.md`

**Location**: `/docs/merge-evidence/v{version}/E{epic}/`

### Hardening Summaries

**Format**: `E{epic}_{issue}_HARDENING_SUMMARY.md`

**Examples**:
- `E75_2_HARDENING_SUMMARY.md`
- `E79_1_HARDENING_SUMMARY.md`

**Location**: `/docs/merge-evidence/v{version}/E{epic}/`

### Other Files

**Format**: `E{epic}_{issue}_{PURPOSE}.md`

**Examples**:
- `E78_2_POSTMORTEM_EXAMPLE.json`
- `E75_1_CANONICAL_ID_RESOLVER_SUMMARY.md`
- `E76_3_MERGE_READY_VERIFICATION.md`

**Location**: `/docs/merge-evidence/v{version}/E{epic}/`

---

## Version Organization

### Version Directories

- **Current Development**: `/docs/current/` or `/docs/v{next}/`
- **Released Versions**: `/docs/v{major}.{minor}/` or `/docs/merge-evidence/v{major}.{minor}/`

**Example**:
- v0.6 docs: `/docs/v06/` or `/docs/v0.6/`
- v0.7 merge evidence: `/docs/merge-evidence/v0.7/`

### Version-Specific Artifacts

```
docs/
├── merge-evidence/v0.7/
│   ├── E71/
│   │   ├── E71_1_IMPLEMENTATION_SUMMARY.md
│   │   └── ...
│   └── ...
├── releases/v0.7/
│   └── RELEASE.md
└── audit/v0.7/
    └── ...
```

---

## Merge Evidence Rules

### What Qualifies as Merge Evidence?

Merge evidence documents prove that an epic/issue was:

1. **Implemented**: Code changes were made
2. **Tested**: Verification commands were run successfully
3. **Reviewed**: Evidence was reviewed and accepted
4. **Merged**: Changes were merged into main branch

### Required Merge Evidence Files

For each epic/issue (E{epic}.{issue}), the following files are **recommended** (not all required):

1. **E{epic}_{issue}_IMPLEMENTATION_SUMMARY.md** (✅ **Required**)
   - What was implemented
   - Files changed
   - Tests added
   - Acceptance criteria met

2. **E{epic}_{issue}_VERIFICATION_COMMANDS.md** (✅ **Recommended**)
   - PowerShell commands to verify implementation
   - Expected output
   - Test results

3. **E{epic}_{issue}_EVIDENCE.md** (⚠️ Optional)
   - Additional evidence (screenshots, logs, etc.)
   - Pre/post comparisons

4. **E{epic}_{issue}_UI_VISUAL_GUIDE.md** (⚠️ Optional, for UI changes)
   - Screenshots of UI changes
   - Before/after comparisons

5. **E{epic}_{issue}_HARDENING_SUMMARY.md** (⚠️ Optional, for security changes)
   - Security hardening details
   - Threat model updates

6. **E{epic}_{issue}_MERGE_EVIDENCE.md** (⚠️ Optional)
   - Explicit merge evidence
   - Review comments and approvals

### Where Merge Evidence Goes

**Current Location** (to be migrated):
- Repository root (E7*.md files)

**Target Location** (post-migration):
- `/docs/merge-evidence/v{version}/E{epic}/`

**Example**:
```
/docs/merge-evidence/v0.7/E71/
├── E71_1_IMPLEMENTATION_SUMMARY.md
├── E71_1_ENFORCEMENT_SUMMARY.md
├── E71_2_IMPLEMENTATION_SUMMARY.md
├── E71_3_IMPLEMENTATION_SUMMARY.md
└── E71_4_IMPLEMENTATION_SUMMARY.md
```

---

## Linking Docs from PRs/Issues

### Pull Request Documentation Requirements

Every PR **should** include:

1. **Title**: Clear, concise description of change
   - Format: `[Epic E{epic}.{issue}] {Short description}`
   - Example: `[Epic E71.1] Implement Repo Access Policy + Auth Wrapper`

2. **Description**: Link to implementation summary
   - Format: `See: E{epic}_{issue}_IMPLEMENTATION_SUMMARY.md`
   - Example: `See: E71_1_IMPLEMENTATION_SUMMARY.md`

3. **Verification**: Link to verification commands
   - Format: `Verification: E{epic}_{issue}_VERIFICATION_COMMANDS.md`
   - Example: `Verification: E71_1_VERIFICATION_COMMANDS.md`

### Issue Documentation Requirements

Every issue **should** include:

1. **Acceptance Criteria**: Clear, testable criteria
2. **Implementation Plan**: Link to related docs
3. **Verification**: How to verify completion

---

## Migration Procedure (Root → /docs)

### Phase 1: Create Target Directories

```bash
mkdir -p docs/merge-evidence/v0.7/{E71,E72,E73,E74,E75,E76,E77,E78,E79,E7.0,E80}
```

### Phase 2: Move Files (Preserve Git History)

```bash
# Example: Move E71 files
git mv E71_1_IMPLEMENTATION_SUMMARY.md docs/merge-evidence/v0.7/E71/
git mv E71_1_ENFORCEMENT_SUMMARY.md docs/merge-evidence/v0.7/E71/
# ... repeat for all E71 files
```

### Phase 3: Update Cross-References

Search for references to moved files and update paths:

```bash
# Example: Update references to E71_1_IMPLEMENTATION_SUMMARY.md
grep -r "E71_1_IMPLEMENTATION_SUMMARY.md" docs/
# Update each reference to new path
```

### Phase 4: Commit and Verify

```bash
git commit -m "docs: consolidate v0.7 merge evidence to /docs/merge-evidence/v0.7/"
git push
```

### Phase 5: Validate No Broken Links

```bash
# Use link checker or grep to ensure all references updated
npm run docs:check-links  # (if available)
```

---

## Enforcement

### Pre-Commit Hooks

Consider adding pre-commit hooks to enforce:

1. No new .md files at repository root (except allowlist)
2. Naming convention checks for merge evidence files
3. Required fields in implementation summaries

### CI Checks

Add CI checks to validate:

1. All PRs reference implementation summaries
2. All implementation summaries have verification commands
3. No orphaned documentation files

---

## Exceptions

### When to Deviate

Deviations from this policy are acceptable when:

1. **Third-party tools** require specific file locations (e.g., `.github/` for GitHub Actions)
2. **Security** requires certain files at root (e.g., `SECURITY.md`)
3. **Build tools** require config at root (e.g., `tsconfig.json`)

### How to Request Exception

1. Open an issue with `docs-policy` label
2. Explain why exception is needed
3. Propose alternative solution
4. Get approval from team lead

---

## Maintenance

### Regular Reviews

This policy should be reviewed:

- **Quarterly**: Check for new doc types that need categorization
- **Post-Release**: After each major version release
- **On Request**: When team members identify gaps or issues

### Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-01-06 | Initial policy created | GitHub Copilot (Issue #6) |

---

## Quick Reference

### File at Root?

❌ **No** - Move to `/docs` (unless on allowlist)

### Where to put implementation summary?

✅ `/docs/merge-evidence/v{version}/E{epic}/E{epic}_{issue}_IMPLEMENTATION_SUMMARY.md`

### Where to put audit report?

✅ `/docs/audit/v{version}/{AUDIT_NAME}.md`

### Where to put UI design patterns?

✅ `/docs/design/UI_DESIGN_PATTERNS.md`

### Where to put runbook?

✅ `/docs/runbooks/{RUNBOOK_NAME}.md`

---

**Policy Maintained By**: Engineering Team  
**Last Updated**: 2026-01-06  
**Next Review**: 2026-04-06 (Quarterly)
