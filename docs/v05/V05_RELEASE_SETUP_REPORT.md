# AFU-9 v0.4 Release & v0.5 Project Setup - Final Report

**Date:** 2025-12-22  
**Repository:** adaefler-art/codefactory-control  
**Status:** Preparation Complete - Awaiting Manual Execution

---

## Executive Summary

All preparation work for AFU-9 v0.4 release and v0.5 project setup has been completed. Due to authentication constraints in the automated environment, manual execution of the final steps (tag push, release creation, project creation, issue creation) is required.

### What Was Accomplished

✅ **Tag Created:** Annotated tag `v0.4.0` created locally on commit `22cdb6a`  
✅ **Release Notes:** Comprehensive release notes prepared with proper structure  
✅ **Automation Scripts:** PowerShell scripts created for execution  
✅ **Issue Templates:** All 9 v0.5 issues fully documented and ready to create  
✅ **Project Structure:** Complete project plan with fields and configuration  
✅ **Documentation:** Full execution guide and tracking documents created

### What Requires Manual Execution

⏳ **Push Tag:** `git push origin v0.4.0`  
⏳ **Create Release:** Via script or GitHub UI  
⏳ **Create Project:** "AFU-9 Codefactory v0.5"  
⏳ **Create Issues:** 9 total (1 epic + 3 tasks + 5 findings)  
⏳ **Configure Project:** Add issues, set fields, establish relationships

---

## Step A: v0.4 Release

### A.1 Tag Information

**Tag Name:** `v0.4.0`  
**Commit SHA:** `22cdb6a41c42366ad165a0fb4c96282304f6f7ae`  
**Branch:** `main`  
**Status:** ✅ Created locally, ⏳ awaiting push

**Tag Message:**
```
AFU-9 v0.4.0 - Production-ready, operationally stable autonomous code fabrication system

- ECS Deployment Stability with zero trial-and-error
- Security Hardening (EPIC 07) with least privilege IAM
- Build Determinism (EPIC 05) with ≥95% reproducibility
- Comprehensive Documentation (150+ runbooks and guides)
- Health & Observability with Red/Yellow/Green indicators
- Cost Attribution Engine (EPIC 09)

Self-Propelling deferred to v0.5 (non-blocking).

See docs/v04/V04_RELEASE_REVIEW.md for complete details.
```

### A.2 Release Notes Structure

The prepared release notes include:

1. **Executive Summary**
   - Key achievements: ECS stability, security, determinism, documentation, observability, cost
   - Production-ready status

2. **What's Stable & Production-Ready**
   - Core Infrastructure (ECS, RDS, ALB, VPC, CDK stacks)
   - MCP Pattern Implementation (3 servers)
   - Deployment Workflows (5 GitHub Actions workflows)
   - Security Implementation (EPIC 07) - 0 errors, 0 warnings
   - Build Determinism (EPIC 05) - ≥95% target
   - KPI System (12 KPIs) & Cost Attribution

3. **What's Experimental or Unstable**
   - Workflow Engine (basic, needs refinement)
   - Control Center UI (MVP, needs polish)
   - LLM Integration (basic, needs enhancement)

4. **Known Limitations**
   - **Self-Propelling deferred to v0.5 (non-blocking)** ← Explicitly called out
   - Link to staging findings: `docs/reviews/v0.4_staging_test_findings.md`
   - Other constraints: single region, no workflow versioning, UI refresh required

5. **Deployment & Upgrade**
   - Links to canonical deployment guide
   - Links to operational runbooks
   - Quick reference commands

6. **Documentation**
   - Links to v0.4 documentation hub
   - Key document references

7. **SHA/Tag Reference**
   - Complete commit and tag information

8. **Foundation for v0.5**
   - What v0.4 enables
   - v0.5 candidate features

### A.3 Manual Execution Steps

```powershell
# 1. Push the tag
git push origin v0.4.0

# 2. Create the release (option A: PowerShell script)
pwsh ./scripts/release/v0.5/create-v0.4-release.ps1 -Execute

# OR option B: GitHub CLI
gh release create v0.4.0 `
   --repo adaefler-art/codefactory-control `
   --title "AFU-9 v0.4.0" `
   --notes-file "./scripts/release/v0.5/release-notes-v0.4.0.md" `
   --target 22cdb6a41c42366ad165a0fb4c96282304f6f7ae `
   --verify-tag

# OR option C: GitHub Web UI
# Navigate to: https://github.com/adaefler-art/codefactory-control/releases/new
```

### A.4 Expected Deliverables

- **Tag URL:** https://github.com/adaefler-art/codefactory-control/releases/tag/v0.4.0
- **Release URL:** https://github.com/adaefler-art/codefactory-control/releases/tag/v0.4.0
- **No separate artifacts** (all documentation in repository)

---

## Step B: v0.5 Project Creation

### B.1 Project Details

**Name:** AFU-9 Codefactory v0.5  
**Description:** v0.5 planning and delivery. Foundation: v0.4 reference state + staging findings.  
**Type:** GitHub Projects (V2)  
**Owner:** adaefler-art

### B.2 Field Configuration

| Field | Type | Values |
|-------|------|--------|
| Status | Single select | Backlog, Ready, In Progress, In Review, Done, Blocked |
| Priority | Single select | P0 (Critical), P1 (High), P2 (Medium) |
| Epic | Text or Single select | Self-Propelling, Hardening, Documentation |
| KPI / Outcome | Text | Free-form outcome tracking |

### B.3 Manual Execution Steps

**Option 1: GitHub Web UI**
1. Navigate to https://github.com/orgs/adaefler-art/projects or user projects
2. Click "New project"
3. Choose template: "Board" or "Table"
4. Name: "AFU-9 Codefactory v0.5"
5. Description: (as above)
6. Create and configure fields

**Option 2: GitHub CLI**
```powershell
gh project create \
    --owner adaefler-art \
    --title "AFU-9 Codefactory v0.5" \
    --format json
```

### B.4 Expected Deliverable

- **Project URL:** TBD (format: `https://github.com/orgs/adaefler-art/projects/[NUMBER]` or `https://github.com/users/adaefler-art/projects/[NUMBER]`)

---

## Step C: v0.5 Backlog Issues

### C.1 Issue Summary

**Total Issues:** 9

| # | Type | Title | Priority | Labels |
|---|------|-------|----------|--------|
| 1 | Epic | [v0.5 Epic] Self-Propelling | P1 | v0.5, epic, self-propelling |
| 2 | Task | Self-Propelling: Make runtime artifact access explicit | P1 | v0.5, self-propelling, hardening |
| 3 | Task | Self-Propelling: Add preflight runtime check + clear error | P1 | v0.5, self-propelling, hardening |
| 4 | Task | Self-Propelling: Wire feature behind flag and document activation | P1 | v0.5, self-propelling, docs |
| 5 | Finding | Enforce ECS healthcheck on task ENI IP (Finding 1) | P1 | v0.5, hardening, ops, ecs |
| 6 | Finding | Verify ALB healthcheck uses /api/health (Finding 2; already implemented on 22cdb6a4) | P2 | v0.5, hardening, ops, ecs |
| 7 | Finding | Add CDK context validation for staging (Finding 3) | P1 | v0.5, hardening, ops, cdk |
| 8 | Finding | Strengthen DB secret validation (Finding 4) | P1 | v0.5, hardening, ops, security |
| 9 | Finding | Verify diff gate exclusively flag (Finding 5; already implemented on 22cdb6a4) | P2 | v0.5, hardening, ops, cdk |

### C.2 Self-Propelling Epic

**Issue 1: [v0.5 Epic] Self-Propelling**

**Background:** Current implementation loads workflow definitions via filesystem. Needs explicit runtime artifact management.

**Child Tasks:**
- Issue 2: Make runtime artifact access explicit
- Issue 3: Add preflight runtime check + clear error
- Issue 4: Wire feature behind flag and document activation

**Definition of Done:**
- All 3 child tasks completed
- Feature flag implemented and documented
- Preflight checks in place
- Runtime artifacts explicitly managed
- End-to-end testing completed
- Documentation updated

**Source:** 
- API: `control-center/app/api/issues/[issueNumber]/self-propel/route.ts`
- Deferred: `docs/reviews/v0.4_staging_test_findings.md`
- Tasks: `docs/v05/README.md` lines 100-108

### C.3 Self-Propelling Tasks

**Issue 2: Make runtime artifact access explicit**

Remove hidden filesystem dependency OR ensure workflow definitions are packaged and accessible.

**Acceptance Criteria:**
- Runtime artifact dependencies explicitly documented
- Artifacts reliably available in deployed environments
- No hidden filesystem dependencies
- Code review and tests completed

---

**Issue 3: Add preflight runtime check + clear error**

Validate artifacts at startup and endpoint entry with clear error messages.

**Acceptance Criteria:**
- Preflight check at startup
- Endpoint validation before use
- Clear, actionable errors when missing
- No silent failures
- Graceful degradation when disabled
- Tests for validation logic

---

**Issue 4: Wire feature behind flag and document activation**

Feature flag with default disabled, full documentation.

**Acceptance Criteria:**
- Feature flag implemented (e.g., `ENABLE_SELF_PROPELLING`)
- Default: `false`
- Feature respects flag at all entry points
- Documentation in `docs/v05/SELF_PROPELLING_ACTIVATION.md`
- Runbook for activation
- Tests verify flag behavior

### C.4 Staging Findings

**Issue 5: Enforce ECS healthcheck on task ENI IP (Finding 1)**

**Problem:** ECS healthchecks on `127.0.0.1` can fail in Fargate.

**Source:** `docs/reviews/v0.4_staging_test_findings.md` Finding 1

**Current State:**
- ✅ Runbook documents fix
- ✅ Control-center uses task ENI IP
- ⚠️ Need to verify pattern across all services

**Tasks:**
- Audit all task definitions
- Verify healthcheck patterns
- Add CDK validation if possible
- Update deployment checklist

---

**Issue 6: Verify ALB healthcheck uses /api/health (Finding 2; already implemented on 22cdb6a4)**

**Problem:** ALB on `/api/ready` causes startup rollbacks.

**Source:** `docs/reviews/v0.4_staging_test_findings.md` Finding 2

**Current State:**
- ✅ Runbook documents issue
- ✅ ALB configured for `/api/health`
- ⚠️ Needs verification and regression coverage

**Tasks:**
- Verify all ALB target groups use `/api/health`
- Document liveness vs readiness semantics
- Add CDK validation/tests
- Update deployment checklist

---

**Issue 7: Add CDK context validation for staging (Finding 3)**

**Problem:** Toggle `afu9-create-staging-service=false` can delete service.

**Source:** `docs/reviews/v0.4_staging_test_findings.md` Finding 3

**Current State:**
- ✅ Runbook documents modes and warnings
- ⚠️ No runtime validation

**Tasks:**
- Add CDK synthesis check for destructive changes
- Emit warning when toggle would delete resources
- Strengthen runbook warnings
- Ensure diff gate catches deletions

---

**Issue 8: Strengthen DB secret validation (Finding 4)**

**Problem:** Legacy `/master` secrets or missing keys cause failures.

**Source:** `docs/reviews/v0.4_staging_test_findings.md` Finding 4

**Current State:**
- ✅ Canonical contract documented (`afu9/database`)
- ✅ Validation helper exists
- ✅ ECS guardrails block `/master`
- ⚠️ Need better errors and enforcement

**Tasks:**
- Enhance validator error messages
- Add preflight check in deployment workflow
- Create quick reference guide
- Add integration tests

---

**Issue 9: Verify diff gate exclusively flag (Finding 5)**

**Problem:** Diff gate can block on unrelated dependencies.

**Source:** `docs/reviews/v0.4_staging_test_findings.md` Finding 5

**Current State:**
- ✅ Script uses `cdk diff --exclusively`
- ✅ Rationale documented
- ⚠️ Need verification and tests

**Tasks:**
- Verify all usages include `--exclusively`
- Add integration tests
- Update runbooks with examples
- Consider validation/warning

### C.5 Manual Execution Steps

Complete issue templates are in `scripts/release/v0.5/create-v0.5-project.ps1`

**Via GitHub CLI:**
```powershell
# Example for epic
gh issue create \
    --repo adaefler-art/codefactory-control \
    --title "[v0.5 Epic] Self-Propelling" \
    --label "v0.5,epic,self-propelling" \
    --body "<body from script>"

# Repeat for all 9 issues
```

**Via GitHub Web UI:**
1. Navigate to https://github.com/adaefler-art/codefactory-control/issues
2. Click "New issue"
3. Copy title and body from script templates
4. Add labels
5. Submit

**After Issue Creation:**
1. Add all issues to v0.5 project
2. Set Status=Backlog for all
3. Set Priority as specified
4. Link child tasks to epic (use task lists or issue references)
5. Set Epic field for child tasks

### C.6 Expected Deliverables

- **9 Issues Created:** With correct titles, bodies, labels
- **Epic Relationships:** Issues 2-4 linked to Issue 1
- **All Added to Project:** With Status=Backlog
- **Priorities Set:** 7 × P1, 2 × P2

---

## Automation & Documentation

### Files Created

**In Repository (`docs/v05/`):**
- `V05_RELEASE_PREP.md` - Tracking document (committed)

**In `scripts/release/v0.5/`:**
- `create-v0.4-release.ps1` - PowerShell release script
- `create-v0.5-project.ps1` - PowerShell project/issues script
- `create-release-and-project.ps1` - Combined PowerShell entrypoint
- `release-notes-v0.4.0.md` - Release notes for `gh release create`
- `EXECUTION_GUIDE.md` - Comprehensive manual guide

### Script Capabilities

All scripts contain:
- Complete release notes text
- All 9 issue bodies with full content
- Proper error handling
- GitHub CLI command examples
- PowerShell-first execution path

---

## TBD Items Requiring Human Input

1. **Release URL** - Will be: `https://github.com/adaefler-art/codefactory-control/releases/tag/v0.4.0`
2. **Project URL** - Will be assigned upon creation
3. **Issue Numbers** - Will be assigned upon creation (for linking child to epic)
4. **Project Number** - Will be assigned (needed for CLI operations)

No other information is required from humans - all content is complete and ready.

---

## Verification Checklist

### After Tag Push
- [ ] Tag visible at: https://github.com/adaefler-art/codefactory-control/tags
- [ ] Tag points to commit `22cdb6a`
- [ ] Tag message is complete

### After Release Creation
- [ ] Release visible at: https://github.com/adaefler-art/codefactory-control/releases/tag/v0.4.0
- [ ] Release title: "AFU-9 v0.4.0"
- [ ] All release notes sections present
- [ ] "Self-Propelling deferred to v0.5" clearly stated
- [ ] All links work correctly
- [ ] Release target is `22cdb6a` on `main`

### After Project Creation
- [ ] Project titled "AFU-9 Codefactory v0.5"
- [ ] Description is correct
- [ ] Fields configured: Status, Priority, Epic, KPI/Outcome
- [ ] Project URL noted for documentation

### After Issue Creation
- [ ] All 9 issues created
- [ ] All titles match specification
- [ ] All labels applied correctly
- [ ] Issue bodies formatted correctly
- [ ] All doc links work

### After Project Configuration
- [ ] All 9 issues added to project
- [ ] All have Status=Backlog
- [ ] Priorities set correctly (7 × P1, 2 × P2)
- [ ] Epic field set for issues 2-4
- [ ] Child tasks linked to epic (issue 1)

---

## Next Steps (Post-Execution)

1. **Announce v0.4 Release**
   - Share release URL with team
   - Highlight key achievements
   - Note Self-Propelling deferral

2. **Review v0.5 Project**
   - Team walkthrough of project board
   - Validate priorities
   - Assign owners

3. **Begin v0.5 Planning**
   - Refine issue details as needed
   - Set milestones
   - Plan sprints

4. **Start v0.5 Development**
   - Begin work on P0/P1 issues
   - Track progress in project
   - Update documentation

---

## Support & References

### Documentation
- **v0.4 Release Review:** `docs/v04/V04_RELEASE_REVIEW.md`
- **v0.4 Staging Findings:** `docs/reviews/v0.4_staging_test_findings.md`
- **v0.5 Planning Hub:** `docs/v05/README.md`
- **v0.5 Release Prep:** `docs/v05/V05_RELEASE_PREP.md`

### Scripts
- **Execution Guide:** `scripts/release/v0.5/EXECUTION_GUIDE.md`
- **PowerShell Entrypoint:** `scripts/release/v0.5/create-release-and-project.ps1`
- **PowerShell Scripts:** `scripts/release/v0.5/*.ps1`

### GitHub Links
- **Repository:** https://github.com/adaefler-art/codefactory-control
- **Issues:** https://github.com/adaefler-art/codefactory-control/issues
- **Projects:** https://github.com/orgs/adaefler-art/projects (or /users/adaefler-art/projects)

---

## Conclusion

All preparation work for AFU-9 v0.4 release and v0.5 project setup is **100% complete**. The only remaining steps are manual execution due to authentication constraints:

1. Push tag v0.4.0
2. Create GitHub Release
3. Create GitHub Project
4. Create 9 issues
5. Configure project board

All content, templates, and automation scripts are ready for immediate use.

---

**Report Version:** 1.0  
**Generated:** 2025-12-22  
**Status:** Ready for Execution  
**Next Action:** Execute manual steps using provided scripts and guides
