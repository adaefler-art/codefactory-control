# Build Dependency Graph

**EPIC 5: Autonomous Build-Test-Deploy Loop**  
**Issue 5.1: Deterministic Build Graphs**

## Overview

This document provides a visual representation of build dependencies and the deterministic build pipeline for AFU-9. It serves as an audit trail for understanding what inputs affect which outputs.

## Build Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Source Inputs                             │
│  - Git commit SHA (deterministic identifier)                     │
│  - Source code files                                             │
│  - package.json & package-lock.json                              │
│  - Dockerfile & docker-compose.yml                               │
│  - Build configuration (.env, tsconfig.json)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Build Environment                             │
│  - Node.js 20.10.0 (pinned)                                      │
│  - npm ci (uses lockfile)                                        │
│  - SOURCE_DATE_EPOCH=0 (deterministic timestamps)               │
│  - Docker BuildKit with layer caching                            │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Build Execution                                │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Control Center Build                                      │   │
│  │  1. Install deps (npm ci)                                 │   │
│  │  2. Compile TypeScript → JavaScript                       │   │
│  │  3. Build Next.js app (standalone)                        │   │
│  │  4. Package into Docker image                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ MCP Server Builds (github, deploy, observability)        │   │
│  │  1. Build base package                                    │   │
│  │  2. Install server deps (npm ci)                          │   │
│  │  3. Compile TypeScript → JavaScript                       │   │
│  │  4. Package into Docker image                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Build Outputs                                 │
│  - Docker images (tagged with git SHA)                           │
│  - Image digests (content-addressable)                           │
│  - Build manifest (inputs hash + outputs hash)                   │
│  - Build logs (excluded from determinism checks)                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Determinism Validation                           │
│  - Compare inputsHash across builds                              │
│  - Verify outputsHash matches for same inputs                    │
│  - Calculate Build Determinism KPI (target: ≥95%)               │
│  - Store manifest in tracking system                             │
└─────────────────────────────────────────────────────────────────┘
```

## Component Build Graphs

### Control Center

```
package.json + package-lock.json
         │
         ├─> npm ci (install deps)
         │         │
         │         ├─> react@19.0.0
         │         ├─> next@16.0.8  
         │         └─> (other locked deps)
         │
         ├─> tsconfig.json
         │         │
         │         └─> TypeScript compilation
         │                    │
src/**/*.ts ─────────────────┘
         │
         └─> next build (standalone)
                    │
                    └─> .next/standalone/
                              │
                              └─> Docker image
                                  (control-center:${GIT_SHA})
```

### MCP Servers (github, deploy, observability)

```
base/package.json + base/package-lock.json
         │
         └─> npm ci + build base
                    │
                    └─> base/dist/
                              │
                              ├─> github server build
                              │   server/package.json + package-lock.json
                              │            │
                              │            └─> npm ci
                              │                  │
                              │   server/src/**/*.ts
                              │                  │
                              │                  └─> tsc (compile)
                              │                        │
                              │                        └─> Docker image
                              │                            (mcp-github:${GIT_SHA})
                              │
                              ├─> deploy server build (similar)
                              │
                              └─> observability server build (similar)
```

## Dependency Matrix

### Build-time Dependencies

| Component         | Direct Dependencies                      | Affects Output Hash |
|-------------------|------------------------------------------|---------------------|
| Control Center    | package-lock.json                        | ✅ Yes              |
|                   | src/**/*.ts, src/**/*.tsx                | ✅ Yes              |
|                   | tsconfig.json                            | ✅ Yes              |
|                   | next.config.js                           | ✅ Yes              |
|                   | Dockerfile                               | ✅ Yes              |
|                   | .dockerignore                            | ✅ Yes              |
| MCP GitHub        | base/dist + server package-lock.json     | ✅ Yes              |
| MCP Deploy        | base/dist + server package-lock.json     | ✅ Yes              |
| MCP Observability | base/dist + server package-lock.json     | ✅ Yes              |

### Runtime Dependencies (Not Affecting Build)

| Component      | Runtime Dependencies          | Affects Output Hash |
|----------------|-------------------------------|---------------------|
| All containers | Environment variables         | ❌ No               |
|                | AWS credentials               | ❌ No               |
|                | Database connection strings   | ❌ No               |
|                | API endpoints                 | ❌ No               |

## Build Hash Computation

### Input Hash Calculation

```typescript
inputsHash = SHA256({
  sourceFiles: {
    'workflow.json': '<file-content-hash>',
    'src/index.ts': '<file-content-hash>',
    // ... all source files
  },
  dependencies: {
    'react': '19.0.0',
    'next': '16.0.8',
    // ... from package-lock.json
  },
  environment: {
    'NODE_ENV': 'production',
    // Only build-time env vars
  },
  buildConfig: {
    dockerfile: '<dockerfile-content-hash>',
    tsconfig: '<tsconfig-content-hash>',
    // Other build configs
  }
  // NOTE: timestamp is excluded
})
```

### Output Hash Calculation

```typescript
outputsHash = SHA256({
  artifacts: {
    'image-digest': 'sha256:abc123...',
    'bundle.js': '<file-content-hash>',
    'styles.css': '<file-content-hash>',
    // ... all build artifacts
  },
  success: true
  // NOTE: durationMs is excluded
})
```

## Determinism Validation Flow

```
Build 1 (Commit ABC123)
  inputsHash: 'a1b2c3...'
  outputsHash: 'x1y2z3...'
  
Build 2 (Same Commit ABC123)
  inputsHash: 'a1b2c3...'  ← Same as Build 1
  outputsHash: 'x1y2z3...' ← Should match Build 1
  
✅ Deterministic: Same inputs → Same outputs

Build 3 (Commit ABC124)  ← Different commit
  inputsHash: 'd4e5f6...'  ← Different inputs
  outputsHash: 'p7q8r9...' ← Expected to differ
  
✅ Valid: Different inputs → Different outputs
```

## Cache Strategy

### Layer Caching (Docker)

```dockerfile
# Layer 1: Base image (cached by digest)
FROM node:20.10.0-alpine

# Layer 2: Dependencies (cached by package-lock.json hash)
COPY package.json package-lock.json ./
RUN npm ci

# Layer 3: Source code (cached by source hash)
COPY . .

# Layer 4: Build output (invalidated when Layer 3 changes)
RUN npm run build
```

### GitHub Actions Cache

```yaml
- name: Cache dependencies
  uses: actions/cache@v3
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    # Cache key is deterministic: OS + lockfile hash
```

## Audit Trail

### Build Manifest Storage

Each build generates a manifest stored in the database:

```sql
CREATE TABLE build_manifests (
  build_id TEXT PRIMARY KEY,
  git_sha TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  outputs_hash TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NOT NULL,
  duration_ms INTEGER NOT NULL,
  reproducible BOOLEAN NOT NULL,
  metadata JSONB
);

-- Index for determinism queries
CREATE INDEX idx_inputs_hash ON build_manifests(inputs_hash);
CREATE INDEX idx_git_sha ON build_manifests(git_sha);
```

### Query Examples

**Find all builds for a commit:**
```sql
SELECT build_id, inputs_hash, outputs_hash, reproducible
FROM build_manifests
WHERE git_sha = 'abc123...';
```

**Check reproducibility for same inputs:**
```sql
SELECT inputs_hash, COUNT(DISTINCT outputs_hash) as output_variations
FROM build_manifests
GROUP BY inputs_hash
HAVING COUNT(DISTINCT outputs_hash) > 1;
-- Shows non-deterministic builds
```

**Calculate determinism score:**
```sql
WITH input_groups AS (
  SELECT 
    inputs_hash,
    COUNT(DISTINCT outputs_hash) as output_count
  FROM build_manifests
  GROUP BY inputs_hash
)
SELECT 
  COUNT(*) FILTER (WHERE output_count = 1) * 100.0 / COUNT(*) as determinism_score
FROM input_groups;
```

## GitHub Actions Integration

### Build Tag Strategy

```yaml
- name: Generate image tags
  id: image-tags
  run: |
    # Primary deterministic identifier
    SHORT_SHA=$(echo ${{ github.sha }} | cut -c1-7)
    echo "short_sha=${SHORT_SHA}" >> $GITHUB_OUTPUT
    
    # Supplementary timestamp for human readability
    echo "timestamp=$(date +%Y%m%d-%H%M%S)" >> $GITHUB_OUTPUT

- name: Build and push
  uses: docker/build-push-action@v5
  with:
    tags: |
      ${{ env.ECR_REPO }}:${{ steps.image-tags.outputs.short_sha }}
      ${{ env.ECR_REPO }}:${{ steps.image-tags.outputs.timestamp }}
      ${{ env.ECR_REPO }}:staging-latest
    # SHA tag is used for determinism
    # Timestamp and latest tags are for convenience
```

### Determinism Validation in CI

```yaml
- name: Validate build determinism
  run: |
    # Build the same commit twice
    docker build -t test:1 .
    DIGEST1=$(docker inspect test:1 --format='{{.Id}}')
    
    docker build -t test:2 .
    DIGEST2=$(docker inspect test:2 --format='{{.Id}}')
    
    if [ "$DIGEST1" != "$DIGEST2" ]; then
      echo "❌ Build is non-deterministic!"
      echo "Digest 1: $DIGEST1"
      echo "Digest 2: $DIGEST2"
      exit 1
    fi
    
    echo "✅ Build is deterministic"

- name: Check determinism KPI
  run: |
    SCORE=$(curl -s https://api.afu-9.com/v1/kpi/build-determinism \
      | jq '.data.metrics.determinismScore')
    
    echo "Build Determinism Score: $SCORE%"
    
    if (( $(echo "$SCORE < 95" | bc -l) )); then
      echo "❌ Build determinism below threshold (95%)!"
      exit 1
    fi
    
    echo "✅ Build determinism check passed"
```

## Continuous Monitoring

### KPI Dashboard

Real-time tracking via Control Center:

```
┌──────────────────────────────────────┐
│    Build Determinism Metrics         │
├──────────────────────────────────────┤
│ Score: 98.7%                    🟢   │
│ Total Builds: 150                    │
│ Unique Inputs: 75                    │
│ Cache Hit Rate: 65.3%                │
│                                      │
│ Last Build:                          │
│  - Git SHA: abc123...                │
│  - Input Hash: 3a2b1c...             │
│  - Output Hash: 9f8e7d...            │
│  - Reproducible: ✅                  │
└──────────────────────────────────────┘
```

### Alerting Thresholds

| Metric              | Warning     | Critical    |
|---------------------|-------------|-------------|
| Determinism Score   | < 95%       | < 90%       |
| Cache Hit Rate      | < 50%       | < 30%       |
| Non-deterministic   | > 2/day     | > 5/day     |

## References

- [Build Determinism Implementation Summary](BUILD_DETERMINISM_IMPLEMENTATION_SUMMARY.md)
- [Build Determinism System](BUILD_DETERMINISM.md)
- [Build Determinism Criteria](BUILD_DETERMINISM_CRITERIA.md)
- [KPI Definitions](KPI_DEFINITIONS.md)
- [Workflow Engine](WORKFLOW-ENGINE.md)
