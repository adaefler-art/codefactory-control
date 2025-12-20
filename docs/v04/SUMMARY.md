# AFU-9 v0.4 Issue Import - Complete Package

## 📋 Overview

This package contains everything needed to import 6 EPICs (as GitHub milestones) and 13 issues for AFU-9 v0.4 into the `adaefler-art/codefactory-control` repository.

## 🎯 What's Included

### Scripts
- **`import-afu9-v04-issues.ts`** - TypeScript script for programmatic import via GitHub API
- **`import-afu9-v04-issues.sh`** - Bash wrapper using GitHub CLI (`gh`)
- **`../../package.json`** - Added npm script: `npm run import-v04-issues`

### Data
- **`afu9-v04-issues-data.json`** - Complete structured data for all EPICs and issues

### Automation
- **`../../.github/workflows/_archived/import-v04-issues.yml`** - GitHub Actions workflow for one-click import (archived after execution)

### Documentation
- **`docs/v04/README-V04-ISSUES.md`** - Comprehensive usage documentation
- **`docs/v04/EXECUTION-INSTRUCTIONS.md`** - Step-by-step execution guide
- **`docs/v04/SUMMARY.md`** - This summary document

## 🚀 Quick Execution Guide

### Recommended: GitHub Actions (One-Click)

1. Go to: https://github.com/adaefler-art/codefactory-control/actions
2. Click on **"Import AFU-9 v0.4 Issues"** workflow
3. Click **"Run workflow"**
4. Type `import-v04` to confirm
5. Click the green **"Run workflow"** button
6. ✅ Done! All 6 milestones and 13 issues will be created

### Alternative: Command Line

```bash
# Option A: TypeScript (requires GitHub token)
export GITHUB_TOKEN="ghp_your_token_here"
npm run import-v04-issues

# Option B: Bash (requires gh CLI)
gh auth login
./scripts/import-afu9-v04-issues.sh
```

## 📊 What Gets Created

### 6 Milestones (EPICs)

| Epic ID | Title | Issues |
|---------|-------|--------|
| EPIC-01-ECS-STABILITY | ECS Deployment Stabilität (Core) | 3 |
| EPIC-02-CONFIGURATION | Konfigurationsklarheit & Feature Flags | 2 |
| EPIC-03-DEPLOY-SAFETY | Deploy Safety & Diff-Gates | 2 |
| EPIC-04-OBSERVABILITY | Observability & Health Signale | 2 |
| EPIC-05-RUNBOOKS | Runbooks & Wissenssicherung | 2 |
| EPIC-06-RELEASE-CLOSE | Release-Abschluss & Qualitätssicherung | 2 |

**Total: 6 Milestones + 13 Issues**

### 13 Issues

#### EPIC 1 — ECS Deployment Stabilität (Core)
1. **I-01-01-DB-SECRET-MAPPING**: Fix DB Secret-Key Mapping
2. **I-01-02-SECRET-PREFLIGHT**: Guardrail: Secret-Key-Preflight vor Deploy
3. **I-01-03-ECS-CIRCUIT-DIAG**: ECS Circuit Breaker Diagnose standardisieren

#### EPIC 2 — Konfigurationsklarheit & Feature Flags
4. **I-02-01-DB-OFF-MODE**: DB-Off Mode vollständig durchziehen
5. **I-02-02-CONTEXT-NAMES**: Kontext-Namen vereinheitlichen / absichern

#### EPIC 3 — Deploy Safety & Diff-Gates
6. **I-03-01-DIFF-GATE**: Verbindlicher Diff-Gate vor Deploy
7. **I-03-02-DEPLOY-PROMPT**: Reproduzierbarer Deploy-Prompt (kanonisch)

#### EPIC 4 — Observability & Health Signale
8. **I-04-01-HEALTH-READY**: Health vs Ready sauber trennen
9. **I-04-02-STATUS-SIGNALS**: ECS + ALB Status als Entscheidungssignale

#### EPIC 5 — Runbooks & Wissenssicherung
10. **I-05-01-RUNBOOK-ROLLBACK**: Runbook: UPDATE_ROLLBACK_COMPLETE
11. **I-05-02-RUNBOOK-SECRETS**: Runbook: ECS Secret Injection Failures

#### EPIC 6 — Release-Abschluss & Qualitätssicherung
12. **I-06-01-RELEASE-REVIEW**: v0.4 Abschluss-Review & Referenzstand
13. **I-06-02-V05-GO**: Entscheidungsvorlage für v0.5

## ✅ Quality Checks

All scripts have been validated:

- ✅ TypeScript script compiles successfully
- ✅ Bash script syntax is valid
- ✅ GitHub Actions workflow YAML is valid
- ✅ JSON data file is well-formed
- ✅ All issue references to EPICs are correct
- ✅ npm script is properly configured

## 🔍 Verification

After import, verify:

1. **Milestones**: https://github.com/adaefler-art/codefactory-control/milestones
   - Should show 6 new v0.4 milestones

2. **Issues**: https://github.com/adaefler-art/codefactory-control/issues?q=is%3Aissue+label%3Av0.4
   - Should show 13 new v0.4 issues
   - Each assigned to correct milestone

3. **Labels**: Check that all issues have proper labels:
   - `v0.4` (all issues)
   - Epic-specific labels (ecs, configuration, deploy, etc.)

## 📁 File Structure

```
codefactory-control/
├── .github/
│   └── workflows/
│       └── _archived/import-v04-issues.yml  # GitHub Actions workflow (archived)
├── docs/
│   └── v04/
│       ├── README-V04-ISSUES.md           # Comprehensive documentation
│       ├── EXECUTION-INSTRUCTIONS.md      # Step-by-step guide
│       └── SUMMARY.md                     # This file
├── scripts/
│   ├── afu9-v04-issues-data.json          # Structured data (SOURCE OF TRUTH)
│   ├── import-afu9-v04-issues.ts          # TypeScript import script
│   ├── import-afu9-v04-issues.sh          # Bash import script
└── package.json                           # Contains: npm run import-v04-issues
```

## 🎯 Next Steps After Import

1. **Review** all issues in GitHub
2. **Prioritize** work within each EPIC
3. **Assign** team members to issues
4. **Start** with EPIC 1 (highest priority for stability)
5. **Track** progress using GitHub milestones view

## 📚 Additional Resources

- **AWS Deploy Runbook**: `../AWS_DEPLOY_RUNBOOK.md`
- **ECS Deployment Guide**: `../ECS-DEPLOYMENT.md`
- **Secret Validation**: `../SECRET_VALIDATION.md`
- **Post-Deploy Verification**: `../POST_DEPLOY_VERIFICATION.md`

## 🆘 Support

If you encounter issues:

1. Check script logs for error messages
2. Verify GitHub API rate limits haven't been exceeded
3. Ensure you have write access to the repository
4. Check that your token/credentials have `repo` scope
5. Review the detailed docs: `docs/v04/README-V04-ISSUES.md`

## 📝 Summary

**Status**: ✅ Ready to execute
**Created**: Complete package with 4 execution methods
**Validated**: All scripts and data files checked
**Documentation**: Comprehensive guides included

The AFU-9 v0.4 issue import package is **production-ready** and awaiting execution.

---

**Last Updated**: 2025-12-18
**Version**: 0.4
**Target Repository**: adaefler-art/codefactory-control
