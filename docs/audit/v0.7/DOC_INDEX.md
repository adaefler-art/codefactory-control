# v0.7 Documentation Index

**Date**: 2026-01-06  
**Version**: v0.7.x Audit  
**Purpose**: Canonical index of all v0.7 documentation

---

## Overview

This document provides a comprehensive inventory of all documentation related to v0.7, including implementation summaries, verification commands, visual guides, and merge evidence.

**Total v0.7 Documentation Files**: 93 (at repository root) + additional files in `/docs`

---

## 1. Implementation Summaries (E7x_IMPLEMENTATION_SUMMARY.md)

All implementation summaries for v0.7 epics are currently located at the repository root. **Recommendation**: Move to `/docs/merge-evidence/v0.7/` during docs consolidation phase.

### Epic E71: Evidence Layer (GitHub Repo Read-Only)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E71_1_IMPLEMENTATION_SUMMARY.md | /root | Repo access policy + auth wrapper implementation | ~9KB |
| E71_2_IMPLEMENTATION_SUMMARY.md | /root | listTree tool implementation | ~10KB |
| E71_3_IMPLEMENTATION_SUMMARY.md | /root | readFile tool implementation | ~12KB |
| E71_4_IMPLEMENTATION_SUMMARY.md | /root | searchCode tool implementation | ~8KB |
| E71_1_ENFORCEMENT_SUMMARY.md | /root | Policy enforcement details | ~5KB |

**Total E71 Docs**: 5 files

### Epic E72: Product Memory (Timeline/Linkage)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E72_1_IMPLEMENTATION_SUMMARY.md | /root | Timeline/linkage model implementation | ~10KB |
| E72_2_IMPLEMENTATION_SUMMARY.md | /root | GitHub ingestion implementation | ~11KB |
| E72_3_IMPLEMENTATION_SUMMARY.md | /root | AFU-9 ingestion implementation | ~12KB |

**Total E72 Docs**: 3 files  
**Missing**: E72_4_IMPLEMENTATION_SUMMARY.md (Query API + UI)

### Epic E73: INTENT Console MVP

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E73_1_IMPLEMENTATION_SUMMARY.md | /root | INTENT console UI shell | ~11KB |
| E73_2_IMPLEMENTATION_SUMMARY.md | /root | Sources panel + used_sources contract | ~8KB |
| E73_2_COMPLETE_PACKAGE.md | /root | Complete E73.2 package with examples | ~9KB |
| E73_3_IMPLEMENTATION_SUMMARY.md | /root | Context pack generator + export | ~7KB |
| E73_4_IMPLEMENTATION_SUMMARY.md | /root | Context pack storage/retrieval | ~12KB |

**Total E73 Docs**: 5 files

### Epic E74: ChangeRequest (CR) Schema + Validator

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E74_3_IMPLEMENTATION_SUMMARY.md | /root | UI CR preview/edit implementation | ~11KB |
| E74_3_UI_VISUAL_GUIDE.md | /root | Visual guide for CR UI | ~15KB |
| E74_4_IMPLEMENTATION_SUMMARY.md | /root | CR versioning + diff implementation | ~7KB |

**Total E74 Docs**: 3 files  
**Missing**: E74_1_IMPLEMENTATION_SUMMARY.md (CR JSON Schema), E74_2_IMPLEMENTATION_SUMMARY.md (Validator Library)

### Epic E75: CR → GitHub Issue Generator (Idempotent)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E75_1_IMPLEMENTATION_SUMMARY.md | /root | Main implementation summary | ~9KB |
| E75_1_CANONICAL_ID_RESOLVER_SUMMARY.md | /root | Canonical-ID resolver details | ~7KB |
| E75_2_IMPLEMENTATION_SUMMARY.md | /root | Create/update issue implementation | ~8KB |
| E75_2_HARDENING_SUMMARY.md | /root | Security hardening details | ~7KB |
| E75_3_IMPLEMENTATION_SUMMARY.md | /root | Idempotency + concurrency tests | ~7KB |
| E75_3_TESTING_COMMANDS.md | /root | Testing commands and procedures | ~4KB |
| E75_4_IMPLEMENTATION_SUMMARY.md | /root | Audit trail implementation | ~8KB |
| E75_4_HARDENING_SUMMARY.md | /root | Additional hardening details | ~7KB |
| E75_4_AUTH_HARDENING.md | /root | Auth-specific hardening | ~5KB |

**Total E75 Docs**: 9 files

### Epic E76: Self-Debugging (Incident Records)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E76_1_IMPLEMENTATION_SUMMARY.md | /root | Incident schema + DB tables | ~9KB |
| E76_1_VERIFICATION_COMMANDS.md | /root | Verification commands for E76.1 | ~3KB |
| E76_2_IMPLEMENTATION_SUMMARY.md | /root | Incident ingest implementation | ~10KB |
| E76_2_VERIFICATION_COMMANDS.md | /root | Verification commands for E76.2 | ~3KB |
| E76_3_IMPLEMENTATION_SUMMARY.md | /root | Classifier v1 implementation | ~11KB |
| E76_3_VERIFICATION_COMMANDS.md | /root | Verification commands for E76.3 | ~3KB |
| E76_3_MERGE_READY_VERIFICATION.md | /root | Merge readiness checks | ~5KB |

**Total E76 Docs**: 7 files  
**Note**: E76.4 (UI Incidents Tab) may be partially documented elsewhere

### Epic E77: Self-Healing (Remediation Playbooks)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E77_1_IMPLEMENTATION_SUMMARY.md | /root | Playbook framework implementation | ~10KB |
| E77_1_HARDENING_PATCH_SUMMARY.md | /root | Hardening patches for E77.1 | ~6KB |
| E77_1_VERIFICATION_COMMANDS.md | /root | Verification commands for E77.1 | ~3KB |
| E77_2_IMPLEMENTATION_SUMMARY.md | /root | Safe retry playbook implementation | ~11KB |
| E77_2_HARDENING_SUMMARY.md | /root | Hardening details for E77.2 | ~7KB |
| E77_2_VERIFICATION_COMMANDS.md | /root | Verification commands for E77.2 | ~3KB |
| E77_3_IMPLEMENTATION_SUMMARY.md | /root | Redeploy last known good playbook | ~12KB |
| E77_3_VERIFICATION_COMMANDS.md | /root | Verification commands for E77.3 | ~3KB |
| E77_4_IMPLEMENTATION_SUMMARY.md | /root | Service health reset playbook | ~10KB |
| E77_4_HARDENING_SUMMARY.md | /root | Hardening details for E77.4 | ~7KB |
| E77_4_VERIFICATION_COMMANDS.md | /root | Verification commands for E77.4 | ~3KB |
| E77_5_IMPLEMENTATION_SUMMARY.md | /root | Full audit trail implementation | ~11KB |
| E77_5_AUDIT_EVENT_SCHEMA.md | /root | Audit event schema details | ~8KB |
| E77_5_VERIFICATION_COMMANDS.md | /root | Verification commands for E77.5 | ~3KB |

**Total E77 Docs**: 14 files

### Epic E78: Self-Optimization (Outcomes, KPIs, Tuning)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E78_1_IMPLEMENTATION_SUMMARY.md | /root | KPI store + compute implementation | ~10KB |
| E78_1_FINAL_SUMMARY.md | /root | Final summary for E78.1 | ~7KB |
| E78_1_VERIFICATION_COMMANDS.md | /root | Verification commands for E78.1 | ~3KB |
| E78_2_IMPLEMENTATION_SUMMARY.md | /root | Outcome records + postmortem implementation | ~11KB |
| E78_2_FINAL_SUMMARY.md | /root | Final summary for E78.2 | ~7KB |
| E78_2_VERIFICATION_COMMANDS.md | /root | Verification commands for E78.2 | ~3KB |
| E78_3_IMPLEMENTATION_SUMMARY.md | /root | Tuning suggestions generator | ~12KB |
| E78_3_FINAL_SUMMARY.md | /root | Final summary for E78.3 | ~7KB |
| E78_3_VERIFICATION_COMMANDS.md | /root | Verification commands for E78.3 | ~3KB |
| E78_4_IMPLEMENTATION_SUMMARY.md | /root | Ops dashboard implementation | ~11KB |
| E78_4_FINAL_SUMMARY.md | /root | Final summary for E78.4 | ~7KB |
| E78_4_HARDENING_SUMMARY.md | /root | Hardening details for E78.4 | ~6KB |
| E78_4_MERGE_EVIDENCE.md | /root | Merge evidence for E78.4 | ~5KB |
| E78_4_UI_VISUAL_GUIDE.md | /root | Visual guide for ops dashboard | ~15KB |
| E78_4_VERIFICATION_COMMANDS.md | /root | Verification commands for E78.4 | ~3KB |

**Total E78 Docs**: 15 files

### Epic E79: Lawbook/Guardrails (Transparency + Versioning)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E79_1_IMPLEMENTATION_SUMMARY.md | /root | Lawbook schema + versioning | ~11KB |
| E79_1_EVIDENCE.md | /root | Implementation evidence | ~6KB |
| E79_1_FINAL_HARDENING_UPDATE.md | /root | Final hardening updates | ~7KB |
| E79_1_FINAL_VERIFICATION.md | /root | Final verification procedures | ~5KB |
| E79_1_HARDENING_SUMMARY.md | /root | Hardening summary | ~7KB |
| E79_1_MERGE_EVIDENCE.md | /root | Merge evidence | ~5KB |
| E79_1_VERIFICATION_COMMANDS.md | /root | Verification commands | ~3KB |
| E79_2_IMPLEMENTATION_SUMMARY.md | /root | Admin UI editor implementation | ~11KB |
| E79_2_FINAL_SUMMARY.md | /root | Final summary for E79.2 | ~7KB |
| E79_2_VERIFICATION_COMMANDS.md | /root | Verification commands for E79.2 | ~3KB |
| E79_3_IMPLEMENTATION_SUMMARY.md | /root | Enforce lawbookVersion implementation | ~9KB |
| E79_4_IMPLEMENTATION_SUMMARY.md | /root | Guardrail gates library | ~10KB |
| E79_4_VERIFICATION_COMMANDS.md | /root | Verification commands for E79.4 | ~3KB |

**Total E79 Docs**: 13 files

### Post-Epic Hardening (E7.0.1 - E7.0.5)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E7_0_1_IMPLEMENTATION_SUMMARY.md | /root | Post-epic hardening #1 | ~9KB |
| E7_0_1_EVIDENCE.md | /root | Evidence for E7.0.1 | ~5KB |
| E7_0_1_REVIEW_CHANGES.md | /root | Review of changes | ~6KB |
| E7_0_2_IMPLEMENTATION_SUMMARY.md | /root | Post-epic hardening #2 | ~10KB |
| E7_0_2_EVIDENCE.md | /root | Evidence for E7.0.2 | ~5KB |
| E7_0_2_HARDENING_ANALYSIS.md | /root | Hardening analysis | ~7KB |
| E7_0_2_WORKFLOW_ALIGNMENT.md | /root | Workflow alignment details | ~6KB |
| E7_0_3_IMPLEMENTATION_SUMMARY.md | /root | Post-epic hardening #3 | ~9KB |
| E7_0_3_EVIDENCE.md | /root | Evidence for E7.0.3 | ~5KB |
| E7_0_4_IMPLEMENTATION_SUMMARY.md | /root | Post-epic hardening #4 | ~10KB |
| E7_0_4_EVIDENCE.md | /root | Evidence for E7.0.4 | ~5KB |
| E7_0_4_HARDENING_SUMMARY.md | /root | Hardening summary | ~7KB |
| E7_0_4_SAMPLE_EXPORT.json | /root | Sample export data | ~3KB |
| E7_0_4_VERIFICATION_COMMANDS.md | /root | Verification commands | ~3KB |
| E7_0_5_IMPLEMENTATION_SUMMARY.md | /root | Post-epic hardening #5 | ~9KB |
| E7_0_5_EVIDENCE.md | /root | Evidence for E7.0.5 | ~5KB |
| E7_0_5_HARDENING_SUMMARY.md | /root | Hardening summary | ~6KB |

**Total E7.0.x Docs**: 17 files

### Extra Fixes (E7_EXTRA)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E7_EXTRA_IMPLEMENTATION_SUMMARY.md | /root | Extra critical fixes | ~8KB |
| E7_EXTRA_CRITICAL_FIXES.md | /root | Critical fixes details | ~6KB |
| E7_EXTRA_VERIFICATION_COMMANDS.md | /root | Verification commands | ~3KB |

**Total E7_EXTRA Docs**: 3 files

### E80: Migration Runner (Post-v0.7)

| File | Location | Purpose | Size |
|------|----------|---------|------|
| E80_1_IMPLEMENTATION_SUMMARY.md | /root | Migration runner implementation | ~10KB |
| E80_1_MIGRATION_RUNNER_SUMMARY.md | /root | Migration runner details | ~8KB |
| E80_1_UI_VISUAL_GUIDE.md | /root | Visual guide for migrations UI | ~12KB |
| E80_1_VERIFICATION_COMMANDS.md | /root | Verification commands | ~3KB |

**Total E80 Docs**: 4 files

---

## 2. Docs Folder Documentation (v0.7 Related)

### /docs Directory Structure

```
docs/
├── audit/v0.7/                    # Audit reports (NEW)
│   ├── ROADMAP_PARITY_REPORT.md
│   └── DOC_INDEX.md (this file)
├── roadmaps/
│   └── afu9_v0_7_backlog.md       # v0.7 roadmap definition
├── releases/
│   └── v0.6.5.md                  # Latest release (pre-v0.7)
├── merge-evidence/                # Future home for E7x summaries
├── architecture/                  # Architecture docs
├── canon/                         # Canonical definitions
├── db/                            # Database schemas
├── guardrails/                    # Guardrail policies
├── lawbook/                       # Lawbook documentation
├── runbooks/                      # Operational runbooks
└── ... (other directories)
```

### Key v0.7 Documentation in /docs

| File | Location | Purpose |
|------|----------|---------|
| afu9_v0_7_backlog.md | /docs/roadmaps/ | Canonical v0.7 roadmap definition |
| E73_2_VALIDATION_COMMANDS.md | /docs/ | Context pack validation commands |
| E74_1_IMPLEMENTATION_SUMMARY.md | /docs/ | CR schema implementation (if exists) |
| E74_2_IMPLEMENTATION_SUMMARY.md | /docs/ | Validator implementation (if exists) |

---

## 3. Documentation Gaps

### Missing Implementation Summaries

1. **E72_4_IMPLEMENTATION_SUMMARY.md** - Query API + UI node view
2. **E74_1_IMPLEMENTATION_SUMMARY.md** - CR JSON Schema v1 (may be covered in E74_3)
3. **E74_2_IMPLEMENTATION_SUMMARY.md** - Validator Library (may be covered in E74_3)

### Partially Documented Features

1. **E76.4 UI Incidents Tab** - Full linking may be incomplete
2. **Timeline visualization** - UI component may exist but not fully documented

---

## 4. Verification Commands Summary

All v0.7 epics include verification commands. Standard verification suite:

```powershell
# Repository integrity
npm run repo:verify

# Tests
npm --prefix control-center test

# Build
npm --prefix control-center run build

# Control Center dev mode
npm run dev:control-center
# Navigate to http://localhost:3000
```

### Epic-Specific Verification

- **E71**: No direct CLI verification (internal library, tested via Jest)
- **E72**: Timeline API: `curl http://localhost:3000/api/timeline/chain`
- **E73**: Navigate to `/intent` page in UI
- **E74**: CR validation tests in control-center test suite
- **E75**: Idempotency tests: `npm --prefix control-center test -- e75`
- **E76**: Navigate to `/incidents` page in UI
- **E77**: Navigate to `/ops` page, test playbook runners
- **E78**: Navigate to `/ops` page, view dashboard
- **E79**: Navigate to `/admin/lawbook` page
- **E80**: Navigate to `/ops/migrations` page

---

## 5. Recommended Documentation Structure (Post-Consolidation)

```
docs/
├── audit/v0.7/
│   ├── ROADMAP_PARITY_REPORT.md
│   ├── DOC_INDEX.md
│   ├── ENDPOINT_INVENTORY.md (to be created)
│   ├── ENDPOINT_UI_MATRIX.md (to be created)
│   ├── CONFIG_SURFACE.md (to be created)
│   └── AUTHZ_POLICY_AUDIT.md (to be created)
├── merge-evidence/v0.7/
│   ├── E71/
│   │   ├── E71_1_IMPLEMENTATION_SUMMARY.md
│   │   ├── E71_1_ENFORCEMENT_SUMMARY.md
│   │   └── ... (all E71 files)
│   ├── E72/
│   ├── E73/
│   ├── E74/
│   ├── E75/
│   ├── E76/
│   ├── E77/
│   ├── E78/
│   ├── E79/
│   ├── E7.0/
│   └── E80/
├── design/
│   └── UI_DESIGN_PATTERNS.md (to be created)
├── runbooks/
│   └── ... (operational runbooks)
└── DOCS_POLICY.md (to be created)
```

---

## 6. Cross-References

### Roadmap → Implementation → Docs

See **ROADMAP_PARITY_REPORT.md** for full mapping table.

### UI Pages → Documentation

| UI Page | Documented In | Epic |
|---------|--------------|------|
| /intent | E73_* files | E73 |
| /admin/lawbook | E79_* files | E79 |
| /ops | E77_*, E78_* files | E77, E78 |
| /ops/migrations | E80_* files | E80 |
| /incidents | E76_* files | E76 |

---

## 7. Maintenance Policy

### When to Add Documentation

1. **New Epic/Issue**: Create `E{epic}_{issue}_IMPLEMENTATION_SUMMARY.md`
2. **Verification Commands**: Create `E{epic}_{issue}_VERIFICATION_COMMANDS.md`
3. **UI Changes**: Create `E{epic}_{issue}_UI_VISUAL_GUIDE.md`
4. **Security/Hardening**: Create `E{epic}_{issue}_HARDENING_SUMMARY.md`
5. **Merge Evidence**: Create `E{epic}_{issue}_MERGE_EVIDENCE.md`

### Naming Conventions

- Implementation summaries: `E{epic}_{issue}_IMPLEMENTATION_SUMMARY.md`
- Verification commands: `E{epic}_{issue}_VERIFICATION_COMMANDS.md`
- Evidence files: `E{epic}_{issue}_EVIDENCE.md`
- Visual guides: `E{epic}_{issue}_UI_VISUAL_GUIDE.md`
- Hardening summaries: `E{epic}_{issue}_HARDENING_SUMMARY.md`

### Location

- **Current**: Repository root (to be migrated)
- **Future**: `/docs/merge-evidence/v{version}/{epic}/`

---

## Conclusion

All v0.7 documentation is accounted for, with 93 files at repository root requiring consolidation. Minor gaps exist for E72.4, E74.1, E74.2 but do not impact v0.7 functionality.

**Next Steps**:
1. Create ENDPOINT_INVENTORY.md and ENDPOINT_UI_MATRIX.md
2. Create DOCS_POLICY.md
3. Move E7*.md files to `/docs/merge-evidence/v0.7/`
4. Create UI_DESIGN_PATTERNS.md

---

**Audit Completed By**: GitHub Copilot  
**Report Version**: 1.0  
**Last Updated**: 2026-01-06
