# AFU-9 v0.4 Release & v0.5 Project Setup

**Status:** Prepared (Awaiting Manual Execution)  
**Date:** 2025-12-22

## Summary

This document tracks the preparation of AFU-9 v0.4 release and v0.5 project setup.

### Step A: v0.4 Release - ✅ Prepared

**Tag:** `v0.4.0`  
**Commit:** `22cdb6a41c42366ad165a0fb4c96282304f6f7ae`  
**Branch:** `main`

✅ Annotated tag created locally  
⏳ Manual push required: `git push origin v0.4.0`  
⏳ Manual release creation required (PowerShell-first; see `scripts/release/v0.5/create-release-and-project.ps1`)

**Expected Release URL:** https://github.com/adaefler-art/codefactory-control/releases/tag/v0.4.0

### Step B: v0.5 Project - 📋 Documented

**Project Name:** AFU-9 Codefactory v0.5  
**Description:** v0.5 planning and delivery. Foundation: v0.4 reference state + staging findings.

⏳ Manual creation required (GitHub Projects V2 API or Web UI)  
📋 Field configuration documented  
📋 Issue templates prepared

**Expected Project URL:** TBD (will be assigned upon creation)

### Step C: v0.5 Backlog - 📋 Documented

**Issues to Create:** 9 total

1. ✨ **Epic:** [v0.5 Epic] Self-Propelling (P1)
2. 🔧 **Task:** Make runtime artifact access explicit (P1)
3. 🔧 **Task:** Add preflight runtime check + clear error (P1)
4. 🔧 **Task:** Wire feature behind flag and document activation (P1)
5. 🛡️ **Finding 1:** Enforce ECS healthcheck on task ENI IP (P1)
6. 🛡️ **Finding 2:** Verify ALB healthcheck uses `/api/health` (already implemented on 22cdb6a4) (P2)
7. 🛡️ **Finding 3:** Add CDK context validation for staging (P1)
8. 🛡️ **Finding 4:** Strengthen DB secret validation (P1)
9. 🛡️ **Finding 5:** Verify diff gate exclusively flag (already implemented on 22cdb6a4) (P2)

**Labels:** `v0.5`, `epic`, `self-propelling`, `hardening`, `ops`, `docs`, `ecs`, `cdk`, `security`

## Deliverables

### Automation Scripts

All scripts are located in `scripts/release/v0.5/`:

- `create-v0.4-release.ps1` - PowerShell script for tag + release creation
- `create-v0.5-project.ps1` - PowerShell script for project scaffolding
- `create-release-and-project.ps1` - Combined PowerShell entrypoint
- `release-notes-v0.4.0.md` - Release notes file for `gh release create`
- `EXECUTION_GUIDE.md` - Manual execution guide (PowerShell-first)

### Documentation References

**v0.4 Foundation:**
- Primary: `docs/v04/V04_RELEASE_REVIEW.md`
- Findings: `docs/reviews/v0.4_staging_test_findings.md`

**v0.5 Planning:**
- Hub: `docs/v05/README.md`
- Self-Propelling tasks documented in v0.5 README

## Manual Steps Required

Due to authentication constraints, the following manual steps are needed:

1. **Push Tag:**
   ```powershell
   git push origin v0.4.0
   ```

2. **Create Release:**
   - Execute (PowerShell-first): `pwsh ./scripts/release/v0.5/create-release-and-project.ps1 -Execute`
   - OR use GitHub Web UI with notes from `scripts/release/v0.5/release-notes-v0.4.0.md`

3. **Create Project:**
   - GitHub Web UI: https://github.com/orgs/adaefler-art/projects
   - OR `gh project create --owner adaefler-art --title "AFU-9 Codefactory v0.5"`

4. **Create Issues:**
   - Use templates from `scripts/release/v0.5/create-v0.5-project.ps1`
   - OR execute `gh issue create` commands from script

5. **Configure Project:**
   - Add all issues to project
   - Set Status=Backlog, Priority as documented
   - Configure fields: Status, Priority, Epic, KPI/Outcome

## TBD Items

1. **Project URL** - Will be assigned after project creation
2. **Issue Numbers** - Will be assigned after issue creation  
3. **Project Configuration** - Field values may need team input

## Success Criteria

- [ ] Tag `v0.4.0` visible at https://github.com/adaefler-art/codefactory-control/tags
- [ ] Release visible at https://github.com/adaefler-art/codefactory-control/releases/tag/v0.4.0
- [ ] Release notes include all sections as documented
- [ ] "Self-Propelling deferred to v0.5" clearly stated
- [ ] Project "AFU-9 Codefactory v0.5" created
- [ ] All 9 issues created with correct labels
- [ ] All issues added to project with Status=Backlog
- [ ] Child tasks linked to epic
- [ ] Priorities assigned as documented

## Notes

This preparation was done in an automated environment with limited GitHub authentication. All necessary content, scripts, and documentation have been prepared for manual execution by an authorized user.

---

**Prepared By:** Copilot Agent  
**Date:** 2025-12-22  
**Next Action:** Execute manual steps as documented in `scripts/release/v0.5/EXECUTION_GUIDE.md`
