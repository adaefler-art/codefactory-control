# AFU-9 v0.4 Issue Import - Execution Instructions

## ⚠️ Important Note

This directory contains **all the tooling and data needed** to create the AFU-9 v0.4 issues and milestones, but the **actual creation requires manual execution** by someone with GitHub repository access and credentials.

## Quick Start

Choose one of these methods to import the issues:

### Method 1: GitHub Actions Workflow (Recommended)

1. Go to the **Actions** tab in GitHub
2. Select the **"Import AFU-9 v0.4 Issues"** workflow
3. Click **"Run workflow"**
4. Enter `import-v04` in the confirmation field
5. Click **"Run workflow"** button

This will automatically create all 6 milestones and 13 issues.

### Method 2: TypeScript Script with GitHub Token

```bash
# Set your GitHub Personal Access Token
export GITHUB_TOKEN="ghp_your_token_here"

# Run the import
npm run import-v04-issues
```

### Method 3: Bash Script with GitHub CLI

```bash
# Make sure gh CLI is installed and authenticated
gh auth status

# Run the import script
./scripts/import-afu9-v04-issues.sh
```

### Method 4: Manual Creation

If automation isn't possible, manually create issues using the data in:
- **Data file**: `../../scripts/afu9-v04-issues-data.json`
- **Documentation**: `docs/v04/README-V04-ISSUES.md`

## What Gets Created

### 6 Milestones (EPICs)

1. **EPIC 1 — ECS Deployment Stabilität (Core)** - 3 issues
   - Fix DB Secret-Key Mapping
   - Secret-Key-Preflight guardrail
   - ECS Circuit Breaker diagnosis

2. **EPIC 2 — Konfigurationsklarheit & Feature Flags** - 2 issues
   - DB-Off Mode implementation
   - Context name validation

3. **EPIC 3 — Deploy Safety & Diff-Gates** - 2 issues
   - Diff-Gate implementation
   - Deploy prompt documentation

4. **EPIC 4 — Observability & Health Signale** - 2 issues
   - Health vs Ready separation
   - Status signals definition

5. **EPIC 5 — Runbooks & Wissenssicherung** - 2 issues
   - UPDATE_ROLLBACK_COMPLETE runbook
   - Secret injection failures runbook

6. **EPIC 6 — Release-Abschluss & Qualitätssicherung** - 2 issues
   - v0.4 final review
   - v0.5 go decision

**Total: 6 milestones + 13 issues**

## Files Created

- ✅ `scripts/import-afu9-v04-issues.ts` - TypeScript import script
- ✅ `scripts/import-afu9-v04-issues.sh` - Bash wrapper using gh CLI
- ✅ `scripts/afu9-v04-issues-data.json` - Structured data (all issues & epics)
- ✅ `docs/v04/README-V04-ISSUES.md` - Comprehensive documentation
- ✅ `docs/v04/EXECUTION-INSTRUCTIONS.md` - This file
- ✅ `.github/workflows/_archived/import-v04-issues.yml` - GitHub Actions workflow (archived)
- ✅ `package.json` - Added npm script: `import-v04-issues`

## Verification After Import

After running any import method, verify:

1. **Milestones created**:
   - Visit: https://github.com/adaefler-art/codefactory-control/milestones
   - Should show 6 new milestones labeled with v0.4

2. **Issues created**:
   - Visit: https://github.com/adaefler-art/codefactory-control/issues?q=is%3Aissue+label%3Av0.4
   - Should show 13 new issues
   - Each issue should be assigned to its milestone

3. **Issue structure**:
   - Each issue has German descriptions
   - Each issue has checkboxes for acceptance criteria
   - Each issue has appropriate labels

## Troubleshooting

### GitHub Actions Workflow

If the workflow fails:
- Check workflow logs in the Actions tab
- Ensure GITHUB_TOKEN has repo permissions
- Verify the repository allows Actions

### TypeScript Script

If the script fails:
- Ensure GITHUB_TOKEN is set: `echo $GITHUB_TOKEN`
- Check token has `repo` scope
- Verify dependencies are installed: `npm install`

### Bash Script

If the bash script fails:
- Ensure gh CLI is authenticated: `gh auth status`
- Install gh CLI if needed: https://cli.github.com/
- Check you have write access to the repository

## Next Steps After Import

1. **Review** all created issues and milestones
2. **Prioritize** work within each EPIC
3. **Assign** team members to issues
4. **Start work** on EPIC 1 (highest priority)

## Support

For issues with the import scripts, check:
- Script logs and error messages
- GitHub API rate limits
- Repository permissions
- Token scopes and expiration

## Summary

✅ All scripts and data files are ready
✅ Multiple import methods available
✅ Comprehensive documentation provided
⏳ Awaiting manual execution by authorized user

The import is **ready to execute** whenever you're ready to proceed.
