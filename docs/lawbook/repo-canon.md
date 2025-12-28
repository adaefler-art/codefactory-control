# Repository Canon – Structural Guardrails

**Status:** Active  
**Owner:** AFU-9 Control Plane  
**Last Updated:** 2025-12-28  
**Related Issues:** ISSUE 1 (Repo Canon & Guardrails), ISSUE 4 (Repo Hygiene Automation)

## Purpose

This document defines the **structural guardrails** enforced on the `codefactory-control` repository to prevent structural drift and ensure consistency between API routes, client calls, and infrastructure changes.

## Enforcement

The repo canon is enforced via:
- **Script:** `scripts/repo-verify.ts`
- **npm command:** `npm run repo:verify`
- **GitHub Action:** `.github/workflows/repo-verify.yml` (runs on all PRs)
- **Pre-commit Hook:** `.husky/pre-commit` → `scripts/precommit-gate.mjs` (optional)

### Pre-Commit Hook

The optional pre-commit hook prevents problematic commits locally before they reach CI:

**Setup:**
```bash
npm install  # Installs husky and sets up hooks
```

**Bypass (when necessary):**
```bash
# Skip pre-commit hook for this commit
git commit --no-verify -m "message"

# Override mixed-scope check
ALLOW_MIXED_CHANGES=true git commit -m "message"
```

**What it checks:**
- ✅ Forbidden paths in staged files
- ✅ Mixed-scope changes (control-center + infra)
- ✅ All repo:verify checks
- ✅ All routes:verify checks

**Note:** The hook only runs on staged changes, making it faster than full repo verification.

## Rules

### 1. Route-Map Coupling (API Routes ↔ Client Calls)

**Principle:** All client-side API calls must correspond to an existing API route definition.

#### API Route Discovery
- **Pattern:** `control-center/app/api/**/route.ts`
- **Derives:** `/api/**` endpoints based on Next.js App Router convention
- **Example:** `control-center/app/api/issues/route.ts` → `/api/issues`
- **Dynamic routes:** `control-center/app/api/issues/[id]/route.ts` → `/api/issues/[id]`

#### Client Call Discovery
- **Patterns searched:**
  - `fetch(\`/api/...)` 
  - `fetch('/api/...)`
  - `fetch("/api/...)`
- **Files scanned:** `control-center/**/*.{ts,tsx}`
- **Exclusions:** `control-center/app/api/**` (routes themselves)

#### Verification Logic
1. Extract all API route paths from `route.ts` files
2. Extract all client fetch calls targeting `/api/**`
3. Match client calls against route definitions (with dynamic segment support)
4. **FAIL** if any client call lacks a corresponding route

#### Dynamic Route Matching
- Client call `/api/issues/123` matches route `/api/issues/[id]`
- Client call `/api/workflow/execution/abc-def` matches route `/api/workflow/execution/[id]`

---

### 2. Forbidden Paths Check

**Principle:** Certain directories contain generated artifacts and must never be committed to version control.

#### Forbidden Paths
- `.next/` – Next.js build output
- `.worktrees/` – Git worktree artifacts
- `standalone/` – Standalone deployment artifacts

#### Verification Logic
1. Check if any of the forbidden directories exist in the repository root or subdirectories
2. **FAIL** if forbidden paths are present (not in .gitignore)

**Note:** This check verifies physical presence of these directories, not just git-tracked files.

---

### 3. Empty Folders Check

**Principle:** Empty directories clutter the repository and may indicate incomplete cleanup.

#### Verification Logic
1. Recursively scan key directories: `control-center/`, `lib/`, `scripts/`, `docs/`
2. Identify directories with no visible files (excluding hidden files like `.git`)
3. **ALLOW** directories with `.gitkeep` file (intentionally preserved)
4. **FAIL** if empty folders are found without `.gitkeep`

#### Remedy
- **Remove:** `rm -rf <empty-folder>`
- **Preserve:** `touch <folder>/.gitkeep` (if folder structure is needed)

**Note:** Excluded directories: `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, `.husky`, `.worktrees`

---

### 4. Unreferenced API Routes Check

**Principle:** API routes that are defined but never called may be dead code.

#### Verification Logic
1. Discover all API routes from `control-center/app/api/**/route.ts`
2. Discover all client fetch calls to `/api/**`
3. Identify routes that are not referenced by any client call
4. **WARNING** (non-blocking) if unreferenced routes are found

#### Exemptions
Routes that are called externally (webhooks, callbacks) are exempt:
- `/api/webhooks/github`
- `/api/webhooks/slack`
- `/api/auth/callback`
- `/api/auth/github/callback`

To add more exemptions, edit `EXTERNALLY_CALLED_ROUTES` in `scripts/repo-verify.ts`

#### Remedy
- **Remove** unused routes to reduce code surface
- **Verify** routes are called externally (webhooks, etc.)
- **Add to exemptions** if intentionally external

**Note:** This check produces warnings only and does not block CI.

---

### 5. Mixed-Scope Check

**Principle:** Pull requests should not mix frontend (control-center) and infrastructure (lib/afu9-*stack.ts) changes without explicit justification.

#### Scope Detection
- **Frontend scope:** Changes in `control-center/**`
- **Infrastructure scope:** Changes in `lib/afu9-*stack.ts` files

#### Verification Logic
1. Detect changed files in the current PR (via git diff against base branch)
2. Categorize changes into frontend and infrastructure scopes
3. **FAIL** if both scopes are modified in the same PR, unless:
   - Explicit override flag is set: `AFU9_ALLOW_MIXED_SCOPE=true`
   - OR the PR description contains `[MIXED-SCOPE-OK]` marker

#### Override Mechanism
**Environment variable:**
```bash
AFU9_ALLOW_MIXED_SCOPE=true npm run repo:verify
```

**PR description marker:**
```markdown
[MIXED-SCOPE-OK]
Justification: Deploying new API endpoint requires both route definition and Lambda stack changes.
```

---

## Error Messages

All verification failures provide:
1. **Specific file/line** where the issue occurred
2. **Root cause** description
3. **Actionable remedy** (how to fix)

### Example Error Messages

**Route-Map Violation:**
```
❌ Route-Map Check FAILED

Client call to non-existent API route:
  File: control-center/app/issues/page.tsx
  Line: 88
  Call: fetch(`/api/issue/${id}`)
  
Error: No route defined for /api/issue/[id]

Available routes:
  - /api/issues
  - /api/issues/[id]
  - /api/issues/[id]/activate
  
Remedy: 
  - Create route at: control-center/app/api/issue/[id]/route.ts
  - OR fix typo: /api/issue → /api/issues
```

**Forbidden Paths Violation:**
```
❌ Forbidden Paths Check FAILED

Found forbidden directory:
  Path: .next/
  
Error: Build artifacts must not be committed to repository

Remedy:
  - Remove directory: rm -rf .next/
  - Verify .gitignore includes: .next/
```

**Empty Folders Violation:**
```
❌ Empty Folders Check FAILED

Found 2 empty folder(s):
  - scripts/old-utils
  - docs/drafts/archived

Error: Empty folders should be removed to keep repository clean

Remedy:
  - Remove empty folders: rm -rf <folder>
  - If folder is needed for structure, add a .gitkeep file
```

**Unreferenced Routes Warning:**
```
⚠️  Unreferenced Routes Check WARNING

Found 5 unreferenced API route(s):
  - /api/legacy/v1
    File: control-center/app/api/legacy/v1/route.ts
  - /api/experimental/feature
    File: control-center/app/api/experimental/feature/route.ts

Warning: These routes are defined but not called by any client code

Remedy:
  - Remove unused routes to reduce code surface
  - OR verify routes are called externally (webhooks, etc.)
  - OR add to EXTERNALLY_CALLED_ROUTES if intentionally external
```

**Mixed-Scope Violation:**
```
❌ Mixed-Scope Check FAILED

This PR mixes frontend and infrastructure changes:

Frontend files (3):
  - control-center/app/api/issues/route.ts
  - control-center/app/issues/page.tsx
  
Infrastructure files (2):
  - lib/afu9-ecs-stack.ts
  - lib/afu9-iam-stack.ts

Error: Mixed-scope PRs require explicit justification

Remedy:
  - Split into separate PRs (frontend vs infrastructure)
  - OR set AFU9_ALLOW_MIXED_SCOPE=true if justified
  - OR add [MIXED-SCOPE-OK] to PR description with justification
```

---

## Testing

### Manual Testing
```bash
# Run full verification
npm run repo:verify

# Test with override
AFU9_ALLOW_MIXED_SCOPE=true npm run repo:verify
```

### Acceptance Criteria
1. ✅ PR with wrong API path fails deterministically
2. ✅ Error messages name specific file + cause
3. ✅ No false positives on clean repo
4. ✅ Empty folders are detected and reported
5. ✅ Unreferenced routes are identified (as warnings)
6. ✅ Mixed-scope detection works for all AFU-9 stack files (in CI/GitHub Actions)

### Testing Notes
- **Route-Map Check:** Validates all client fetch calls have corresponding API routes
- **Forbidden Paths Check:** Ensures build artifacts (.next/, etc.) are not committed
- **Empty Folders Check:** Detects empty directories (except those with .gitkeep)
- **Unreferenced Routes Check:** Identifies API routes without client references (warning only)
- **Mixed-Scope Check:** Only runs in git environments with proper base branch reference (e.g., GitHub Actions with GITHUB_BASE_REF). Locally, it may skip if the base branch cannot be determined.

---

## Maintenance

### Adding New Forbidden Paths
Edit `scripts/repo-verify.ts` → `FORBIDDEN_PATHS` constant

### Adjusting Route Pattern Matching
Edit `scripts/repo-verify.ts` → `matchesRoute()` function

### Whitelisting Client Calls
Not supported – all client calls must have corresponding routes.

---

## Related Documentation

- [AFU-9 Architecture](../architecture/)
- [GitHub Actions Workflows](../.github/workflows/)
- [Development Workflow](../CONTRIBUTING.md)
