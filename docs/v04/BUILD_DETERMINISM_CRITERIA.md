# Build Determinism Criteria

**EPIC 5: Autonomous Build-Test-Deploy Loop**  
**Issue 5.1: Deterministic Build Graphs – Reproduzierbare Build-Prozesse**

## Overview

This document defines the explicit criteria for ensuring deterministic and reproducible builds in AFU-9. It complements the [Build Determinism System](BUILD_DETERMINISM.md) documentation by providing concrete rules and validation procedures.

## Determinism Principles

A build is **deterministic** if and only if:

1. **Identical inputs → Identical outputs**: Given the same source code, dependencies, and configuration, the build produces byte-for-byte identical artifacts
2. **No hidden state**: The build does not depend on implicit or external state
3. **Reproducible across machines**: The build produces the same output on different machines
4. **Reproducible over time**: The build produces the same output at different times

## What Must Be Deterministic

### ✅ Included in Determinism Checks

These factors MUST produce identical outputs when unchanged:

1. **Source Code**
   - All application source files
   - Build scripts and configurations
   - Docker build context files

2. **Dependencies**
   - Package versions (locked via package-lock.json)
   - System dependencies (pinned base image versions)
   - Build tool versions

3. **Build Configuration**
   - Environment variables that affect compilation
   - Build flags and options
   - Compiler settings

4. **Build Process**
   - Build commands and scripts
   - Multi-stage Docker build steps
   - Asset compilation and bundling

### ❌ Excluded from Determinism Checks

These factors are tracked but do NOT affect determinism validation:

1. **Timestamps**
   - Build start/end times
   - File modification times (use SOURCE_DATE_EPOCH=0)
   - Log timestamps

2. **Build Duration**
   - Wall-clock time to complete build
   - CPU time consumed

3. **Build Identifiers**
   - Build IDs and run numbers
   - Git commit metadata (tracked separately)

4. **Cache State**
   - Whether dependencies were cached
   - Previous build artifacts

5. **Metadata**
   - Build machine hostname
   - Build user identity
   - Geographic location

## Determinism Implementation

### Docker Images

All Docker images MUST follow these rules:

```dockerfile
# ✅ CORRECT: Pinned version
FROM node:20.10.0-alpine

# ❌ WRONG: Floating tag
FROM node:20-alpine
FROM node:latest

# ✅ CORRECT: Use lockfile
RUN npm ci

# ❌ WRONG: Non-deterministic install
RUN npm install

# ✅ CORRECT: Deterministic timestamps
ENV SOURCE_DATE_EPOCH=0

# ❌ WRONG: No timestamp control
# (timestamps in artifacts will vary)
```

### Package Management

**JavaScript/Node.js:**

```bash
# ✅ CORRECT: Use lockfile
npm ci

# ❌ WRONG: Update lockfile
npm install
```

**Always commit package-lock.json** to ensure consistent dependency resolution.

### Environment Variables

**Build-time environment variables:**

```typescript
// ✅ CORRECT: Explicit configuration
const buildConfig = {
  NODE_ENV: 'production',
  API_VERSION: 'v1',
  FEATURE_FLAGS: { newUI: true }
};

// ❌ WRONG: Implicit from environment
const buildConfig = {
  NODE_ENV: process.env.NODE_ENV || 'development'
};
```

**Runtime environment variables** (credentials, API endpoints) do not affect build determinism.

### Build Artifacts

**What should be deterministic:**

- Compiled JavaScript bundles
- CSS stylesheets
- Static assets (after processing)
- Container images (layers)

**What is allowed to vary:**

- Log files
- Temporary build files (excluded via .dockerignore)
- Cache metadata

## Validation Procedures

### 1. Manual Validation

Build the same commit twice and compare outputs:

```bash
# Build 1
git checkout <commit-sha>
docker build -t test-image:build1 .

# Build 2 (same commit)
docker build -t test-image:build2 .

# Compare image digests
docker inspect test-image:build1 --format='{{.Id}}'
docker inspect test-image:build2 --format='{{.Id}}'

# Digests should be identical
```

### 2. Automated Validation

Use the build determinism tracking system:

```typescript
import { getBuildDeterminismTracker } from './lib/build-determinism';

const tracker = getBuildDeterminismTracker();
const stats = tracker.getStatistics();

// Target: ≥95% determinism score
if (stats.determinismScore < 95) {
  console.error('Build determinism below threshold!');
  process.exit(1);
}
```

### 3. CI/CD Validation

GitHub Actions workflow validates determinism:

```yaml
- name: Build twice and compare
  run: |
    docker build -t test:1 .
    DIGEST1=$(docker inspect test:1 --format='{{.Id}}')
    
    docker build -t test:2 .
    DIGEST2=$(docker inspect test:2 --format='{{.Id}}')
    
    if [ "$DIGEST1" != "$DIGEST2" ]; then
      echo "Build is non-deterministic!"
      exit 1
    fi
```

## Git SHA as Deterministic Identifier

### Primary Identifier

The git commit SHA is the **primary deterministic identifier** for builds:

```yaml
# ✅ CORRECT: Use git SHA for deterministic tagging
tags: |
  ${{ env.ECR_REPO }}:${{ github.sha }}
  ${{ env.ECR_REPO }}:${{ steps.image-tags.outputs.short_sha }}
```

**Why git SHA:**
- Content-addressable: SHA changes when any source file changes
- Globally unique: No collisions
- Traceable: Direct link to source code state

### Timestamp Tags

Timestamp tags are **supplementary** for human readability:

```yaml
# Timestamp for tracking and rollback convenience (not determinism)
tags: |
  ${{ env.ECR_REPO }}:${{ github.sha }}              # Deterministic
  ${{ env.ECR_REPO }}:${{ steps.tags.outputs.timestamp }}  # Supplementary
  ${{ env.ECR_REPO }}:staging-latest                 # Environment pointer
```

**Timestamp purpose:**
- Human-readable chronological ordering
- Quick identification in listings
- Rollback reference point

**Timestamp is NOT used for:**
- Build input hashing
- Determinism validation
- Cache key generation

## Non-Deterministic Elements (Allowed)

These elements are acceptable and do not violate determinism:

### 1. Parallel Build Optimizations

Different CPU counts or parallel task ordering are acceptable as long as final output is identical:

```typescript
// Acceptable: Parallel builds may vary in order
await Promise.all([
  buildModule('moduleA'),
  buildModule('moduleB'),
  buildModule('moduleC')
]);
```

### 2. Build Logs

Log content may vary (timing, ordering) but does not affect artifact determinism:

```
✅ Build A logs: "Compiled in 1.2s"
✅ Build B logs: "Compiled in 1.5s"
→ Both produce identical artifacts
```

### 3. Intermediate Files

Temporary build files (in /tmp, .cache directories) can vary and are excluded from determinism checks via .dockerignore.

## Troubleshooting Non-Deterministic Builds

### Symptom: Different image digests

**Check 1: Docker build cache**

```bash
# Rebuild without cache
docker build --no-cache -t test:clean .
```

**Check 2: Timestamps in artifacts**

```bash
# Inspect artifact for embedded timestamps
tar -tzf artifact.tar.gz | head -20

# Fix: Set SOURCE_DATE_EPOCH=0
```

**Check 3: Dependency resolution**

```bash
# Ensure lockfile is used
npm ci  # ✅ Uses package-lock.json
npm install  # ❌ May update lockfile
```

### Symptom: Low determinism score

Query the system for details:

```bash
curl http://localhost:3000/api/v1/kpi/build-determinism
```

Check logs for non-deterministic builds:

```typescript
const tracker = getBuildDeterminismTracker();
const stats = tracker.getStatistics();

if (stats.determinismScore < 95) {
  // Investigate which input hashes have varying outputs
  // See BUILD_DETERMINISM.md for debugging guide
}
```

## Audit Trail

### Build Manifest

Every build generates a manifest for auditing:

```json
{
  "buildId": "exec-1703675400000-abc123",
  "inputsHash": "3a2b1c4d...",
  "outputsHash": "9f8e7d6c...",
  "metadata": {
    "startedAt": "2025-12-17T10:00:00Z",
    "completedAt": "2025-12-17T10:00:45Z",
    "durationMs": 45000,
    "reproducible": true
  }
}
```

### KPI Tracking

Build Determinism KPI is tracked in the database:

```sql
SELECT 
  kpi_name,
  value as determinism_score,
  calculated_at,
  metadata->>'totalBuilds' as total_builds
FROM kpi_snapshots
WHERE kpi_name = 'build_determinism'
ORDER BY calculated_at DESC
LIMIT 10;
```

**Target KPI: ≥95% determinism score**

## Enforcement

### Pre-commit Checks

Developers should validate local builds:

```bash
# Build twice locally
npm run build
npm run build

# Check for differences
git status  # Should show no changes
```

### CI/CD Gates

GitHub Actions enforces determinism:

1. Build validation (images must be reproducible)
2. KPI threshold check (score ≥95%)
3. Manual verification for production deploys

### Code Review

Pull requests must:
- Not introduce non-deterministic dependencies
- Not add random/timestamp-based logic to builds
- Include lockfile updates when adding dependencies

## References

- [Build Determinism Implementation Summary](BUILD_DETERMINISM_IMPLEMENTATION_SUMMARY.md) - Complete implementation overview
- [Build Determinism System](BUILD_DETERMINISM.md) - System architecture and API
- [Build Determinism Workflow Example](examples/BUILD_DETERMINISM_WORKFLOW.md) - Usage examples
- [KPI Definitions](KPI_DEFINITIONS.md) - Build Determinism KPI specification
- [Reproducible Builds](https://reproducible-builds.org/) - Industry best practices

## Version History

- **v1.0** (2025-12-17): Initial criteria document for EPIC 5 Issue 5.1
