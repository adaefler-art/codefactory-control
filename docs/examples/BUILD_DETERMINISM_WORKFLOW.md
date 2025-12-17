# Build Determinism Example Workflow

This example demonstrates how AFU-9 tracks build determinism automatically during workflow execution.

## Workflow Definition

```json
{
  "steps": [
    {
      "name": "checkout_code",
      "tool": "github.getRepository",
      "params": {
        "owner": "${repo.owner}",
        "name": "${repo.name}"
      },
      "assign": "repository"
    },
    {
      "name": "build_application",
      "tool": "deploy.buildDockerImage",
      "params": {
        "dockerfile": "Dockerfile",
        "context": ".",
        "tags": ["${repo.name}:${input.version}"]
      },
      "assign": "buildResult"
    },
    {
      "name": "run_tests",
      "tool": "deploy.runTests",
      "params": {
        "image": "${buildResult.imageId}",
        "testCommand": "npm test"
      },
      "assign": "testResult"
    },
    {
      "name": "publish_artifact",
      "tool": "deploy.pushImage",
      "params": {
        "imageId": "${buildResult.imageId}",
        "registry": "ecr",
        "tags": ["${repo.name}:${input.version}"]
      },
      "condition": "${testResult.success} === true",
      "assign": "publishResult"
    }
  ]
}
```

## Build Determinism Tracking

### What Gets Tracked

**Build Inputs** (automatically captured):
```typescript
{
  sourceFiles: {
    'workflow.json': '<hash of workflow definition>'
  },
  dependencies: {
    'context': '<hash of input context>'
  },
  environment: {
    'repo.owner': 'adaefler-art',
    'repo.name': 'codefactory-control',
    'repo.branch': 'main'
  },
  buildConfig: {
    steps: [
      { name: 'checkout_code', tool: 'github.getRepository' },
      { name: 'build_application', tool: 'deploy.buildDockerImage' },
      { name: 'run_tests', tool: 'deploy.runTests' },
      { name: 'publish_artifact', tool: 'deploy.pushImage' }
    ],
    totalSteps: 4
  },
  timestamp: '2025-12-17T10:00:00Z'
}
```

**Build Outputs** (automatically captured):
```typescript
{
  artifacts: {
    'checkout_code': '<hash of step output>',
    'build_application': '<hash of step output>',
    'run_tests': '<hash of step output>',
    'publish_artifact': '<hash of step output>'
  },
  success: true,
  durationMs: 45000
}
```

### Build Manifest

The workflow engine automatically creates a build manifest:

```typescript
{
  buildId: 'exec-1703675400000-abc123',
  inputs: { /* as above */ },
  inputsHash: '3a2b1c...', // Deterministic fingerprint
  outputs: { /* as above */ },
  outputsHash: '9f8e7d...',
  metadata: {
    startedAt: '2025-12-17T10:00:00Z',
    completedAt: '2025-12-17T10:00:45Z',
    durationMs: 45000,
    reproducible: true
  }
}
```

## Determinism Validation

### Scenario 1: Perfect Determinism

Execute the same workflow twice with identical inputs:

```bash
# Execution 1
curl -X POST http://localhost:3000/api/workflow/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": { /* workflow definition */ },
    "context": {
      "input": { "version": "1.0.0" },
      "repo": {
        "owner": "adaefler-art",
        "name": "codefactory-control",
        "default_branch": "main"
      }
    }
  }'

# Execution 2 (identical inputs)
curl -X POST http://localhost:3000/api/workflow/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": { /* same workflow */ },
    "context": {
      "input": { "version": "1.0.0" },
      "repo": {
        "owner": "adaefler-art",
        "name": "codefactory-control",
        "default_branch": "main"
      }
    }
  }'
```

**Expected Result**:
- Both executions have the same `inputsHash`
- Both executions should have the same `outputsHash`
- Build Determinism Score: **100%** ✅

### Scenario 2: Non-Deterministic Build

If the second execution produces different outputs:

```
Execution 1: inputsHash='3a2b1c...', outputsHash='9f8e7d...'
Execution 2: inputsHash='3a2b1c...', outputsHash='1d2e3f...' ❌ Different!
```

**Result**:
- Build Determinism Score: **0%** for this input hash
- System logs warning about non-deterministic behavior
- Requires investigation

### Scenario 3: Build Caching

On third execution with same inputs, check cache:

```typescript
const tracker = getBuildDeterminismTracker();
const inputsHash = computeInputsHash(currentInputs);

const cached = tracker.getCachedBuild(inputsHash);
if (cached) {
  console.log('✅ Cache hit! Reusing build from', cached.lastUsed);
  console.log('Cache hit count:', cached.hitCount);
  // Skip build, reuse artifacts
}
```

## Querying Build Determinism

### Get Current Metrics

```bash
curl http://localhost:3000/api/v1/kpi/build-determinism
```

**Response**:
```json
{
  "success": true,
  "data": {
    "metrics": {
      "totalBuilds": 150,
      "uniqueInputs": 75,
      "cacheSize": 50,
      "determinismScore": 98.7,
      "cacheHitRate": 65.3
    },
    "kpi": {
      "value": 98.7,
      "unit": "percentage",
      "calculatedAt": "2025-12-17T10:30:00Z",
      "metadata": {
        "totalBuilds": 150,
        "uniqueInputs": 75,
        "cacheSize": 50,
        "cacheHitRate": 65.3,
        "description": "Percentage of input hashes where all builds produced identical outputs"
      }
    }
  },
  "timestamp": "2025-12-17T10:30:00Z"
}
```

### Historical Trends

Query KPI snapshots over time:

```sql
SELECT 
  calculated_at,
  value as determinism_score,
  metadata->>'totalBuilds' as total_builds,
  metadata->>'cacheHitRate' as cache_hit_rate
FROM kpi_snapshots
WHERE kpi_name = 'build_determinism'
  AND level = 'factory'
ORDER BY calculated_at DESC
LIMIT 30;
```

## Best Practices

### 1. Lock Dependencies

```dockerfile
# ✅ GOOD: Specific versions
FROM node:20.10.0-alpine
RUN npm ci --production  # Uses package-lock.json

# ❌ BAD: Latest versions
FROM node:latest
RUN npm install  # Non-deterministic
```

### 2. Explicit Environment

```typescript
// ✅ GOOD: Explicit environment
const buildConfig = {
  NODE_ENV: 'production',
  BUILD_VERSION: '1.0.0',
  TIMESTAMP: new Date().toISOString() // OK, excluded from hash
};

// ❌ BAD: Implicit environment
const buildConfig = {
  NODE_ENV: process.env.NODE_ENV || 'development'
};
```

### 3. Deterministic Timestamps

```typescript
// ✅ GOOD: Timestamp for tracking only
const manifest = {
  ...data,
  timestamp: new Date().toISOString() // Excluded from inputsHash
};

// ❌ BAD: Timestamp in build output
const artifact = {
  code: compiledCode,
  builtAt: Date.now() // Makes output non-deterministic!
};
```

## Troubleshooting

### Low Determinism Score

**Check 1: Review Build Logs**
```typescript
const tracker = getBuildDeterminismTracker();
const stats = tracker.getStatistics();

if (stats.determinismScore < 95) {
  console.warn('Low determinism detected!');
  // Investigate builds with same inputsHash but different outputsHash
}
```

**Check 2: Identify Non-Deterministic Steps**

Look at step outputs to find which step produces different results:
```typescript
// Compare manifests with same input hash
const manifests = getManifestsByInputHash(inputsHash);
const outputHashes = manifests.map(m => m.outputs.artifacts);
// Find which artifact hash differs
```

**Check 3: Common Causes**
- Random or time-based values in outputs
- Non-pinned dependency versions
- Parallel build race conditions
- File system timestamp metadata

## Integration with CI/CD

### GitHub Actions

```yaml
name: Deterministic Build Check

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Run workflow
        run: |
          curl -X POST ${{ secrets.AFU9_URL }}/api/workflow/execute \
            -H "Content-Type: application/json" \
            -d @workflow.json
      
      - name: Check determinism
        run: |
          SCORE=$(curl -s ${{ secrets.AFU9_URL }}/api/v1/kpi/build-determinism \
            | jq '.data.metrics.determinismScore')
          
          echo "Build Determinism Score: $SCORE%"
          
          if (( $(echo "$SCORE < 95" | bc -l) )); then
            echo "❌ Build determinism below threshold!"
            exit 1
          fi
          
          echo "✅ Build determinism check passed"
```

## References

- [Build Determinism Documentation](../BUILD_DETERMINISM.md)
- [Workflow Engine Documentation](../WORKFLOW-ENGINE.md)
- [KPI Definitions](../KPI_DEFINITIONS.md)
- [Reproducible Builds](https://reproducible-builds.org/)
