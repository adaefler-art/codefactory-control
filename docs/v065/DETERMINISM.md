# Build Determinism & Repo Hygiene Policy

**Issue:** I671 (E67) — Repo Hygiene & Determinism  
**Release:** v0.6.5  
**Last Updated:** 2025-12-30

## Purpose

This document defines the policies and practices for maintaining **reproducible builds** and **clean repository hygiene** in the codefactory-control project. These policies ensure that:

1. Builds are deterministic and reproducible across environments
2. Build artifacts are never committed to version control
3. The git working tree remains clean after builds
4. Dependencies are locked and versioned consistently

## Core Principles

### 1. Clean Repository Canon

> **"The git tree must be clean after any build operation"**

No build or development operation should leave uncommitted changes in the working directory. This ensures:
- Builds are reproducible from source
- No accidental artifact commits
- Clear separation between source and generated code
- Smaller repository size and faster clones

### 2. Artifact Exclusion

> **"Build outputs must never be committed to git"**

All build artifacts, runtime outputs, and generated files must be excluded via `.gitignore`. This includes:
- `.next/` - Next.js build output
- `cdk.out/` - CDK synthesis output
- `dist/` - TypeScript compilation output
- `node_modules/` - Node.js dependencies
- `.local/` - Local development artifacts
- `coverage/` - Test coverage reports
- `.cache/`, `.turbo/` - Build caches

See [.gitignore](../../.gitignore) for the complete list.

### 3. Deterministic Dependencies

> **"Use locked dependencies and consistent tooling"**

All dependencies must be locked to specific versions to ensure reproducible builds:
- Use `package-lock.json` (npm) - **REQUIRED**
- Always use `npm ci` (not `npm install`) in CI/CD
- Never commit `node_modules/`
- Pin Node.js version across environments

## Node.js & Package Manager Policy

### Node.js Version

**Required Version:** Node.js **20** (LTS)

- Use Node 20 in all environments (local, CI, production)
- Specify in `.nvmrc` if using nvm
- Use `actions/setup-node@v4` with `node-version: '20'` in GitHub Actions

### Package Manager

**Required:** npm (bundled with Node.js)

### Dependency Installation

✅ **REQUIRED:** Use `npm ci` for all CI/CD builds

```bash
# CI/CD and production
npm ci

# CI/CD for control-center
npm --prefix control-center ci
```

❌ **FORBIDDEN:** Do not use `npm install` in CI/CD
- `npm install` may update dependencies unpredictably
- `npm ci` requires package-lock.json and fails if out of sync
- `npm ci` removes node_modules/ first for clean installs

### Local Development

For local development, you may use:
```bash
# Install dependencies (updates package-lock.json if needed)
npm install

# Install dependencies for control-center
npm --prefix control-center install
```

However, always commit updated `package-lock.json` files when dependencies change.

### Lockfile Policy

1. **Lockfile Required:** `package-lock.json` must exist and be committed
2. **Lockfile Sync:** Lockfile must match `package.json`
3. **Lockfile Updates:** Only update via explicit dependency changes
4. **No Manual Edits:** Never manually edit lockfiles

## Build Operations

### Root Project Build

```bash
# Install dependencies
npm ci

# Build TypeScript (CDK infrastructure)
npm run build

# Verify clean tree
git status --porcelain  # Should be empty
```

### Control Center Build

```bash
# Install dependencies
npm --prefix control-center ci

# Build Next.js application
npm --prefix control-center run build

# Verify clean tree
git status --porcelain  # Should be empty
```

### Expected Build Outputs (NOT committed)

| Output | Location | Purpose |
|--------|----------|---------|
| `.next/` | `control-center/.next/` | Next.js build cache & output |
| `cdk.out/` | `cdk.out/` | CDK synthesis artifacts |
| `*.js`, `*.d.ts` | Various | TypeScript compilation output |
| `node_modules/` | Root & subprojects | Installed dependencies |
| `build-metadata.json` | `control-center/public/` | Auto-generated build info |

All these outputs are excluded in `.gitignore`.

## Verification & Gates

### Local Verification

Before committing, verify repository hygiene:

```bash
# Run all repository canon checks
npm run repo:verify

# Check for uncommitted changes
git status --porcelain
```

### CI Gates

All PRs must pass these gates:

1. **Repo Hygiene Gate** (`.github/workflows/repo-verify.yml`)
   - Checks for tracked artifacts
   - Validates .gitignore coverage
   - Enforces file size limits
   - Scans for secret files

2. **Build Determinism Gate** (`.github/workflows/build-determinism.yml`)
   - Runs `npm ci` + build operations
   - Verifies git tree is clean after build
   - Ensures no artifacts are created in tracked paths

### Automated Checks

The `scripts/repo-verify.ts` script performs:

- **Forbidden Paths Check:** Detects build artifacts (`.next/`, `cdk.out/`, etc.)
- **Tracked Artifacts Check:** Scans git for committed artifacts
- **Large File Check:** Flags files >10MB (with allowlist)
- **Secret Files Check:** Detects committed secrets/keys
- **Empty Folders Check:** Identifies unnecessary empty directories

## Troubleshooting

### "Forbidden directory detected" Error

```
Error: Build artifacts must not be committed to repository
  Path: control-center/.next
```

**Fix:**
```bash
# Remove from filesystem
rm -rf control-center/.next

# If already committed, remove from git
git rm -r --cached control-center/.next

# Ensure .gitignore includes .next/
grep -q ".next/" .gitignore || echo ".next/" >> .gitignore
```

### "Tracked artifacts detected" Error

```
Error: Build/runtime artifacts must NEVER be committed to repository
```

**Fix:**
```bash
# Remove from git tracking
git rm -r --cached <artifact-path>

# Verify .gitignore coverage
npm run repo:verify

# Clean working directory
git status --porcelain  # Should be empty
```

### Git Tree Not Clean After Build

```bash
# Check what changed
git status

# Review changes
git diff

# If TypeScript outputs (.js, .d.ts):
# → Verify .gitignore includes *.js and *.d.ts
# → Ensure negation patterns (!bin/*.js) are correct

# If build metadata:
# → Verify control-center/public/build-metadata.json is in .gitignore
```

### Package Lock Out of Sync

```
npm ERR! `npm ci` can only install packages when your package.json and package-lock.json are in sync.
```

**Fix:**
```bash
# Update lockfile to match package.json
npm install

# Commit updated lockfile
git add package-lock.json
git commit -m "chore: update package-lock.json"
```

## Best Practices

### DO ✅

- Use `npm ci` in CI/CD and production
- Commit `package-lock.json` after dependency changes
- Run `npm run repo:verify` before committing
- Keep `.gitignore` up-to-date with new artifact types
- Clean local artifacts regularly: `rm -rf .next/ cdk.out/ dist/`
- Use Node 20 LTS in all environments

### DON'T ❌

- Commit build artifacts or outputs
- Use `npm install` in CI/CD
- Manually edit `package-lock.json`
- Ignore repo-verify warnings
- Commit `node_modules/`
- Mix Node.js versions across environments
- Disable artifact checks without justification

## Related Documentation

- [.gitignore](../../.gitignore) - Complete artifact exclusion list
- [scripts/repo-verify.ts](../../scripts/repo-verify.ts) - Verification script source
- [.github/workflows/repo-verify.yml](../../.github/workflows/repo-verify.yml) - CI gate workflow
- [.github/workflows/build-determinism.yml](../../.github/workflows/build-determinism.yml) - Build determinism workflow
- [BUILD_DETERMINISM_CRITERIA.md](../BUILD_DETERMINISM_CRITERIA.md) - Detailed determinism criteria

## Enforcement

These policies are enforced via:

1. **Pre-commit hooks** (Husky) - Local validation
2. **CI gates** (GitHub Actions) - PR blocking checks
3. **Code review** - Manual verification
4. **Documentation** - This guide and related docs

Violations of determinism policies will cause CI failures and block PR merges.

## Policy Updates

This policy may be updated as the project evolves. Changes require:
- Update to this document
- Update to `.gitignore` if needed
- Update to `scripts/repo-verify.ts` if checks change
- CI workflow updates if gate behavior changes
- Communication to team about policy changes

---

**Questions?** See [docs/lawbook/repo-canon.md](../lawbook/repo-canon.md) or open an issue with label `determinism`.
