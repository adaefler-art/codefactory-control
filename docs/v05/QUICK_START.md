# AFU-9 v0.4 Release & v0.5 Project Setup - Quick Start

**Date:** 2025-12-22  
**Status:** ✅ All preparation complete - Ready for manual execution

---

## What's Ready

Everything needed for v0.4 release and v0.5 project setup has been prepared. Manual execution is required due to GitHub authentication constraints.

### ✅ Completed

1. **Tag v0.4.0 created locally** on commit `22cdb6a`
2. **Comprehensive release notes** prepared
3. **9 issue templates** fully documented
4. **Project structure** defined
5. **Automation scripts** created (PowerShell + Bash)
6. **Execution guide** written

### ⏳ Awaiting Manual Execution

1. Push tag to GitHub
2. Create GitHub Release
3. Create GitHub Project
4. Create 9 issues
5. Configure project board

---

## Quick Execute

### Option 1: Use Automation Script (Recommended)

```bash
# Execute the all-in-one script
/tmp/afu9-release/create-release-and-project.sh
```

This script will:
- Push tag v0.4.0
- Create GitHub Release
- Show commands for project and issue creation

### Option 2: Manual Steps

#### 1. Push Tag

```bash
cd /home/runner/work/codefactory-control/codefactory-control
git push origin v0.4.0
```

#### 2. Create Release

Visit: https://github.com/adaefler-art/codefactory-control/releases/new

Or use GitHub CLI:
```bash
gh release create v0.4.0 \
    --repo adaefler-art/codefactory-control \
    --title "AFU-9 v0.4.0" \
    --notes-file /tmp/afu9-release/release-notes.txt \
    --target 22cdb6a41c42366ad165a0fb4c96282304f6f7ae \
    --verify-tag
```

#### 3. Create Project

Visit: https://github.com/orgs/adaefler-art/projects (or user projects)

Or use GitHub CLI:
```bash
gh project create \
    --owner adaefler-art \
    --title "AFU-9 Codefactory v0.5"
```

Configure fields: Status, Priority, Epic, KPI/Outcome

#### 4. Create Issues

Use the issue templates in `/tmp/afu9-release/create-v0.5-project.ps1`

9 issues to create:
1. [v0.5 Epic] Self-Propelling (P1)
2-4. Three Self-Propelling tasks (P1 each)
5-9. Five staging findings issues (4 × P1, 1 × P2)

#### 5. Configure Project

- Add all 9 issues to project
- Set Status=Backlog for all
- Set priorities as documented
- Link child tasks to epic

---

## Key Information

### v0.4 Release

**Tag:** `v0.4.0`  
**Commit:** `22cdb6a41c42366ad165a0fb4c96282304f6f7ae`  
**Expected URL:** https://github.com/adaefler-art/codefactory-control/releases/tag/v0.4.0

**Key Points:**
- ✅ Production-ready, operationally stable
- ✅ ECS deployment stability
- ✅ Security hardening (EPIC 07)
- ✅ Build determinism (EPIC 05)
- ✅ 150+ runbooks and guides
- ⚠️ Self-Propelling deferred to v0.5 (non-blocking)

### v0.5 Project

**Name:** AFU-9 Codefactory v0.5  
**Description:** v0.5 planning and delivery. Foundation: v0.4 reference state + staging findings.

**Issues (9 total):**
- 1 Epic: Self-Propelling
- 3 Tasks: Runtime artifacts, preflight checks, feature flag
- 5 Findings: ECS/ALB healthchecks, staging toggle, DB secrets, diff gate

**Priorities:**
- P1: 8 issues (epic + 3 tasks + 4 findings)
- P2: 1 issue (diff gate finding)

---

## Documentation

**Comprehensive Report:** `docs/v05/V05_RELEASE_SETUP_REPORT.md`  
**Execution Guide:** `/tmp/afu9-release/EXECUTION_GUIDE.md`  
**Tracking Doc:** `docs/v05/V05_RELEASE_PREP.md`

**Scripts:**
- `/tmp/afu9-release/create-release-and-project.sh` (Bash, executable)
- `/tmp/afu9-release/create-v0.4-release.ps1` (PowerShell)
- `/tmp/afu9-release/create-v0.5-project.ps1` (PowerShell)

---

## Verification Checklist

After execution, verify:

### Release
- [ ] Tag visible at GitHub
- [ ] Release published
- [ ] All links work
- [ ] Self-Propelling deferral clearly stated

### Project
- [ ] Project created
- [ ] Fields configured
- [ ] URL documented

### Issues
- [ ] All 9 issues created
- [ ] All added to project
- [ ] Status=Backlog for all
- [ ] Priorities set correctly
- [ ] Epic relationships established

---

## Need Help?

**Full Details:** See `docs/v05/V05_RELEASE_SETUP_REPORT.md`  
**Step-by-Step:** See `/tmp/afu9-release/EXECUTION_GUIDE.md`  
**Issue Templates:** See `/tmp/afu9-release/create-v0.5-project.ps1`

---

**Status:** Ready to execute  
**Estimated Time:** 15-20 minutes for complete setup  
**Next Action:** Run `/tmp/afu9-release/create-release-and-project.sh` or follow manual steps above
