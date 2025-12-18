# AFU-9 v0.4 Issues Import

This directory contains scripts and data files for importing AFU-9 v0.4 issues and milestones into GitHub.

## Overview

AFU-9 v0.4 focuses on operational excellence and deployment stability with 6 EPICs and 13 issues:

### EPICs (as Milestones)
1. **EPIC 1 — ECS Deployment Stabilität (Core)** - 3 issues
2. **EPIC 2 — Konfigurationsklarheit & Feature Flags** - 2 issues  
3. **EPIC 3 — Deploy Safety & Diff-Gates** - 2 issues
4. **EPIC 4 — Observability & Health Signale** - 2 issues
5. **EPIC 5 — Runbooks & Wissenssicherung** - 2 issues
6. **EPIC 6 — Release-Abschluss & Qualitätssicherung** - 2 issues

## Files

- **`afu9-v04-issues-data.json`** - Structured data defining all epics and issues
- **`import-afu9-v04-issues.ts`** - TypeScript script to create GitHub milestones and issues
- **`README-V04-ISSUES.md`** - This documentation file

## Prerequisites

- Node.js and npm installed
- GitHub Personal Access Token with `repo` scope
- Access to the `adaefler-art/codefactory-control` repository

## Usage

### Option 1: Using npm script (Recommended)

```bash
# Set your GitHub token
export GITHUB_TOKEN="ghp_your_token_here"

# Run the import script
npm run import-v04-issues
```

### Option 2: Direct execution

```bash
# Set your GitHub token
export GITHUB_TOKEN="ghp_your_token_here"

# Run with ts-node
ts-node scripts/import-afu9-v04-issues.ts
```

### Option 3: Different repository

To import into a different repository, set these environment variables:

```bash
export GITHUB_TOKEN="ghp_your_token_here"
export GITHUB_OWNER="your-org"
export GITHUB_REPO="your-repo"
npm run import-v04-issues
```

## What the script does

The script will:

1. **Create 6 milestones** (EPICs) in order:
   - EPIC 1 — ECS Deployment Stabilität (Core)
   - EPIC 2 — Konfigurationsklarheit & Feature Flags
   - EPIC 3 — Deploy Safety & Diff-Gates
   - EPIC 4 — Observability & Health Signale
   - EPIC 5 — Runbooks & Wissenssicherung
   - EPIC 6 — Release-Abschluss & Qualitätssicherung

2. **Create 13 issues** assigned to their respective milestones:
   - Each issue includes full description and acceptance criteria
   - All issues are labeled appropriately (v0.4, epic-specific labels)
   - Issues are linked to their parent EPIC milestone

3. **Rate limiting** - The script includes small delays between API calls to avoid GitHub rate limits

## Expected Output

```
🚀 Starting AFU-9 v0.4 Import
📦 Target: adaefler-art/codefactory-control
📊 Will create 6 milestones and 13 issues

=== STEP 1: Creating Milestones ===

📌 Creating milestone: EPIC 1 — ECS Deployment Stabilität (Core)
✅ Created milestone #1: EPIC 1 — ECS Deployment Stabilität (Core)
...

=== STEP 2: Creating Issues ===

📝 Creating issue: Issue 1.1 — Fix: DB Secret-Key Mapping korrigieren
✅ Created issue #42: Issue 1.1 — Fix: DB Secret-Key Mapping korrigieren
...

✨ Import completed successfully!
📊 Summary: Created 6 milestones and 13 issues
```

## Verification

After running the script, verify in GitHub:

1. Check **Milestones** page: https://github.com/adaefler-art/codefactory-control/milestones
   - Should show 6 new milestones
   - Each labeled with v0.4

2. Check **Issues** page: https://github.com/adaefler-art/codefactory-control/issues
   - Filter by label `v0.4` to see all issues
   - Each issue should be assigned to its respective milestone

## Troubleshooting

### "GITHUB_TOKEN is not configured"
- Ensure you've set the `GITHUB_TOKEN` environment variable
- Verify the token has `repo` scope permissions

### "Bad credentials"
- Your GitHub token may be invalid or expired
- Generate a new Personal Access Token at https://github.com/settings/tokens

### "Not Found"
- Verify you have access to the repository
- Check that `GITHUB_OWNER` and `GITHUB_REPO` are correct

### "rate limit"
- GitHub API rate limit reached
- Wait a few minutes and try again
- The script includes automatic delays to minimize this

## Manual Alternative

If you prefer not to use the script, you can manually create the issues using the data in `afu9-v04-issues-data.json`:

1. Create each milestone manually in GitHub
2. For each issue in the JSON file:
   - Create a new issue with the title and body
   - Add the specified labels
   - Assign to the corresponding milestone

## Issue Structure

Each issue follows this structure:

```markdown
**Issue-ID:** I-XX-XX-IDENTIFIER

**Beschreibung:**
[Description of the issue in German]

**Akzeptanzkriterien:**
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
```

## Labels Used

- `v0.4` - Version identifier (all issues)
- `epic` - Epic/Milestone marker
- `ecs` - ECS-related issues
- `stability` - Stability improvements
- `configuration` - Configuration management
- `deploy` - Deployment-related
- `safety` - Safety mechanisms
- `observability` - Monitoring and health checks
- `documentation` - Documentation tasks
- `runbooks` - Runbook creation
- `release` - Release management
- `secrets` - Secret management
- `validation` - Validation mechanisms
- `health-checks` - Health check endpoints
- `troubleshooting` - Troubleshooting guides
- `bugfix` - Bug fixes
- `planning` - Planning tasks
- `database` - Database-related

## Next Steps

After importing the issues:

1. Review each milestone and issue in GitHub
2. Prioritize the issues within each EPIC
3. Assign team members to issues
4. Begin work on EPIC 1 (ECS Deployment Stabilität)

## Related Documentation

- [AWS Deploy Runbook](../docs/AWS_DEPLOY_RUNBOOK.md)
- [ECS Deployment Guide](../docs/ECS-DEPLOYMENT.md)
- [Post-Deploy Verification](../docs/POST_DEPLOY_VERIFICATION.md)
- [Secret Validation](../docs/SECRET_VALIDATION.md)
