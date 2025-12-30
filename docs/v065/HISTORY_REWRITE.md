# Git History Rewrite Guide — v0.6.5

**Release:** v0.6.5  
**Date:** 2025-12-30  
**Epic:** E66 (I661)  
**Type:** Security Hardening / History Sanitization

## ⚠️ BREAKING CHANGE NOTICE

**THIS IS A BREAKING CHANGE** if git history rewrite is performed.

After a history rewrite, all team members must:
1. Delete their local clone
2. Re-clone the repository
3. Recreate any work-in-progress branches

## Current Status

**Git History Status:** ✅ CLEAN

As of 2025-12-30, git history has been scanned and **NO secrets were found**. This document provides procedures for future reference if history sanitization is ever needed.

## When History Rewrite Is Needed

History rewrite is required when:
- Secrets are committed and pushed to remote
- Sensitive files (`.env.local`, `*.pem`, etc.) are in git history
- Previous commits contain credentials that have been rotated

## Pre-Rewrite Checklist

Before performing a history rewrite:

- [ ] **Communicate with team** - Notify all developers of the breaking change
- [ ] **Backup current repository** - Create a full backup of the repository
- [ ] **Verify secrets are rotated** - Ensure exposed secrets are already revoked/rotated
- [ ] **Plan coordination window** - Schedule a time when no one is actively working
- [ ] **Document affected commits** - List commits that contain secrets
- [ ] **Prepare re-clone instructions** - Ensure this document is accessible

## History Sanitization Methods

### Option 1: git-filter-repo (Recommended)

`git-filter-repo` is the modern, fast, and safe way to rewrite git history.

#### Installation

```bash
# macOS
brew install git-filter-repo

# Ubuntu/Debian
sudo apt-get install git-filter-repo

# Python pip
pip3 install git-filter-repo
```

#### Remove Specific Files

```bash
# Remove a specific file from all history
git filter-repo --path github-app-private-key.pem --invert-paths

# Remove multiple files
git filter-repo --path github-app-private-key.pem \
                --path github-app-private-key.pkcs8.pem \
                --path .env.local \
                --invert-paths

# Remove all files matching a pattern
git filter-repo --path-glob '*.pem' --invert-paths
git filter-repo --path-glob '*private-key*' --invert-paths
```

#### Remove Directories

```bash
# Remove a directory from all history
git filter-repo --path secrets/ --invert-paths
```

#### Remove Text/Secrets from Files

```bash
# Create a replacements file
cat > /tmp/replacements.txt << 'EOF'
ghp_oldtoken123456789==><REDACTED_GITHUB_TOKEN>
sk-proj-oldopenaikey==><REDACTED_OPENAI_KEY>
AKIAIOSFODNN7EXAMPLE==><REDACTED_AWS_KEY>
EOF

# Apply text replacements
git filter-repo --replace-text /tmp/replacements.txt
```

### Option 2: BFG Repo-Cleaner (Alternative)

BFG is faster than `git filter-branch` but less flexible than `git-filter-repo`.

#### Installation

```bash
# macOS
brew install bfg

# Or download JAR directly
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar
```

#### Remove Files

```bash
# Remove a specific file
java -jar bfg.jar --delete-files github-app-private-key.pem

# Remove multiple files by pattern
java -jar bfg.jar --delete-files '*.pem'

# Remove folders
java -jar bfg.jar --delete-folders secrets
```

#### Remove Text/Secrets

```bash
# Create a file with secrets to replace
cat > /tmp/secrets.txt << 'EOF'
ghp_oldtoken123456789
sk-proj-oldopenaikey
AKIAIOSFODNN7EXAMPLE
EOF

# Replace secrets with ***REMOVED***
java -jar bfg.jar --replace-text /tmp/secrets.txt
```

### Option 3: git filter-branch (Legacy, Not Recommended)

Only use if `git-filter-repo` and BFG are unavailable.

```bash
# Remove a file from all history
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch github-app-private-key.pem" \
  --prune-empty --tag-name-filter cat -- --all
```

## Complete Sanitization Workflow

### 1. Backup Repository

```bash
# Create a backup
cd ..
cp -r codefactory-control codefactory-control-backup-$(date +%Y%m%d)
cd codefactory-control
```

### 2. Identify Secrets in History

```bash
# Find all .pem files in history
git log --all --name-only --pretty=format: -- "*.pem" | sort -u

# Find .env.local files
git log --all --name-only --pretty=format: -- ".env.local" | sort -u

# Search for specific secret patterns in commits
git log --all -S "ghp_" --source --all
git log --all -S "sk-proj-" --source --all
git log --all -S "AKIA" --source --all
```

### 3. Perform History Rewrite

```bash
# Example: Remove all secret files
git filter-repo --path-glob '*.pem' --invert-paths
git filter-repo --path-glob '*private-key*' --invert-paths
git filter-repo --path .env.local --invert-paths

# Verify removal
git log --all --name-only --pretty=format: -- "*.pem" | sort -u
# Should return empty
```

### 4. Force Push to Remote

⚠️ **BREAKING CHANGE** - This rewrites history on remote

```bash
# Force push to all branches
git push origin --force --all

# Force push tags
git push origin --force --tags
```

### 5. Verify Remote History

```bash
# Clone fresh copy and verify
cd /tmp
git clone https://github.com/adaefler-art/codefactory-control.git verify-clean
cd verify-clean

# Search for secrets
git log --all --name-only --pretty=format: -- "*.pem" | sort -u
# Should return empty
```

### 6. Notify Team

Send notification to all team members:

```
🚨 BREAKING CHANGE: Git History Rewrite Completed

The codefactory-control repository history has been rewritten to remove secrets.

REQUIRED ACTIONS:
1. Delete your local clone: rm -rf codefactory-control
2. Re-clone: git clone https://github.com/adaefler-art/codefactory-control.git
3. Recreate any work-in-progress branches from latest main

TIMELINE:
- Completed: 2025-12-30
- Required by: Immediately

See docs/v065/HISTORY_REWRITE.md for details.
```

## Re-Clone Process for Team Members

### 1. Save Work in Progress (If Any)

```bash
# Export patches for work-in-progress branches
cd codefactory-control
git checkout my-feature-branch
git format-patch main --stdout > ~/my-feature-branch.patch
```

### 2. Delete Old Clone

```bash
# Delete the old repository clone
cd ..
rm -rf codefactory-control
```

### 3. Re-Clone Repository

```bash
# Clone fresh copy with new history
git clone https://github.com/adaefler-art/codefactory-control.git
cd codefactory-control

# Verify clean history
git log --all --name-only --pretty=format: -- "*.pem" | sort -u
# Should be empty
```

### 4. Restore Work in Progress

```bash
# Create new branch from latest main
git checkout -b my-feature-branch

# Apply saved patches
git am < ~/my-feature-branch.patch

# If patch fails, manually recreate changes
# by referencing the patch file
```

### 5. Reconfigure Git

```bash
# Set up git config (if needed)
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Set up any git hooks
npm install  # Reinstalls husky hooks
```

## Verification After Rewrite

### 1. Working Tree Scan

```bash
# Ensure no secrets in working tree
find . -name ".env.local" -o -name "*.pem" -o -name "*.pkcs8.pem" \
  | grep -v node_modules | grep -v .git
# Should be empty
```

### 2. History Scan

```bash
# Search for secret files in history
git log --all --name-only --pretty=format: -- \
  "*.pem" "*.pkcs8.pem" ".env.local" "*private-key*" \
  | sort -u
# Should be empty

# Search for secret strings in content
git log --all -S "ghp_" --source --all | wc -l
# Should be 0
```

### 3. CI Verification

```bash
# Trigger CI workflow
git commit --allow-empty -m "test: verify CI after history rewrite"
git push

# CI should pass all security gates
```

## Common Issues and Solutions

### Issue: "refusing to merge unrelated histories"

**Cause:** Local branch diverged from rewritten remote

**Solution:**
```bash
# Hard reset to remote (DESTRUCTIVE - ensure work is backed up)
git fetch origin
git reset --hard origin/main
```

### Issue: "Your branch and 'origin/main' have diverged"

**Cause:** Local history conflicts with rewritten remote

**Solution:**
```bash
# Delete local clone and re-clone (safest)
cd ..
rm -rf codefactory-control
git clone https://github.com/adaefler-art/codefactory-control.git
```

### Issue: Protected branch blocks force push

**Cause:** Branch protection rules prevent history rewrite

**Solution:**
1. Temporarily disable branch protection in GitHub Settings
2. Perform force push
3. Re-enable branch protection

## Prevention: Avoiding Future History Rewrites

### 1. CI Gates

Security gates block commits with secrets:
- `.github/workflows/security-gates.yml`
- `scripts/repo-verify.ts` with secret scanning

### 2. Pre-commit Hooks

```bash
# Install pre-commit hooks
npm install  # Installs husky hooks

# Hooks run automatically on commit
# Blocks commits with forbidden files
```

### 3. .gitignore

Ensure `.gitignore` includes all secret patterns:
```
.env
.env.local
.env*.local
*.pem
*.pkcs8.pem
*private-key*
secret-*.json
```

### 4. GitHub Secret Scanning

Enable in GitHub repository settings:
- Settings → Security → Code security and analysis
- Enable "Secret scanning"
- Enable "Push protection" (blocks pushes with secrets)

## References

- [git-filter-repo Documentation](https://github.com/newren/git-filter-repo)
- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [SECURITY_ROTATION.md](./SECURITY_ROTATION.md) - Secret rotation procedures

## Support

If you encounter issues during the re-clone process:

1. Check this document for common issues
2. Verify you have the latest version: `git fetch origin`
3. Contact team lead or post in #engineering-support
4. Emergency: Restore from backup created in step 1

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-30  
**Maintained by:** AFU-9 Security Team
