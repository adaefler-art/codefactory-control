# Build Determinism System

**EPIC 5: Autonomous Build-Test-Deploy Loop**  
**Issue 5.1: Deterministic Build Graphs**

## Overview

The Build Determinism System ensures reproducible builds by tracking inputs, computing checksums, and validating that identical inputs produce identical outputs. This is critical for:

- **Reproducibility**: Same inputs always produce same outputs
- **Caching**: Reuse build artifacts when inputs haven't changed
- **Auditability**: Track build history and validate consistency
- **Efficiency**: Avoid redundant builds through intelligent caching

## Key Concepts

### Build Determinism

A build is **deterministic** if:
1. Given the same inputs (source code, dependencies, environment, configuration)
2. The build process produces identical outputs (artifacts, binaries)
3. This behavior is **consistent across multiple executions**

### Build Inputs

Build inputs include all factors that affect the output:

```typescript
interface BuildInputs {
  // Source code files with their content hashes
  sourceFiles: Record<string, string>;
  
  // Dependencies with exact versions
  dependencies: Record<string, string>;
  
  // Environment variables that affect the build
  environment: Record<string, string>;
  
  // Build configuration
  buildConfig: Record<string, any>;
  
  // Timestamp (for tracking, not included in hash)
  timestamp?: string;
}
```

**Important**: Timestamps are tracked but **excluded from hash computation** to ensure determinism.

### Build Outputs

Build outputs are the artifacts produced:

```typescript
interface BuildOutputs {
  // Artifact files with their content hashes
  artifacts: Record<string, string>;
  
  // Build logs hash (optional)
  logsHash?: string;
  
  // Success status
  success: boolean;
  
  // Duration in milliseconds (not included in hash)
  durationMs: number;
}
```

**Important**: Duration is tracked but **excluded from hash computation** since build times may vary.

### Build Manifest

A complete record of a build:

```typescript
interface BuildManifest {
  buildId: string;
  inputs: BuildInputs;
  inputsHash: string;        // Deterministic fingerprint
  outputs: BuildOutputs;
  outputsHash: string;
  metadata: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    reproducible: boolean;
  };
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Engine                           │
│  - Executes build workflows                                  │
│  - Tracks inputs and outputs                                 │
│  - Computes checksums                                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│             Build Determinism Tracker                        │
│  - Registers build manifests                                 │
│  - Manages build cache                                       │
│  - Calculates determinism scores                             │
│  - Validates reproducibility                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    KPI Service                               │
│  - Calculates Build Determinism KPI                          │
│  - Persists metrics to database                              │
│  - Provides historical tracking                              │
└─────────────────────────────────────────────────────────────┘
```

## Usage

### 1. Automatic Tracking in Workflows

The Workflow Engine automatically tracks build determinism for every execution:

```typescript
import { getWorkflowEngine } from './lib/workflow-engine';

const engine = getWorkflowEngine();

const result = await engine.execute(
  workflowDefinition,
  context,
  config
);

// Build determinism is automatically tracked!
```

### 2. Manual Tracking

You can also manually track builds:

```typescript
import { 
  getBuildDeterminismTracker,
  createBuildManifest,
  BuildInputs,
  BuildOutputs,
} from './lib/build-determinism';

const tracker = getBuildDeterminismTracker();

// Define inputs
const inputs: BuildInputs = {
  sourceFiles: {
    'src/index.ts': 'abc123...',
    'src/utils.ts': 'def456...',
  },
  dependencies: {
    'react': '19.0.0',
    'next': '16.0.8',
  },
  environment: {
    'NODE_ENV': 'production',
  },
  buildConfig: {
    mode: 'production',
    minify: true,
  },
};

// Define outputs
const outputs: BuildOutputs = {
  artifacts: {
    'dist/bundle.js': 'xyz789...',
    'dist/styles.css': '123abc...',
  },
  success: true,
  durationMs: 5000,
};

// Create and register manifest
const manifest = createBuildManifest(
  'build-12345',
  inputs,
  outputs,
  startedAt,
  completedAt
);

tracker.registerBuild(manifest);
```

### 3. Build Caching

Check if a build can be reused:

```typescript
import { computeInputsHash } from './lib/build-determinism';

const tracker = getBuildDeterminismTracker();

// Compute hash of current inputs
const inputsHash = computeInputsHash(currentInputs);

// Check cache
const cached = tracker.getCachedBuild(inputsHash);

if (cached) {
  console.log('Cache hit! Reusing previous build:', cached.outputsHash);
  // Reuse artifacts from cached.artifactsPath
} else {
  console.log('Cache miss. Running new build...');
  // Execute build
  // Store results in cache
  tracker.cacheBuild(inputsHash, outputsHash, artifactsPath);
}
```

### 4. Query Metrics

Get current statistics:

```typescript
const tracker = getBuildDeterminismTracker();
const stats = tracker.getStatistics();

console.log('Build Statistics:', {
  totalBuilds: stats.totalBuilds,
  uniqueInputs: stats.uniqueInputs,
  cacheSize: stats.cacheSize,
  determinismScore: stats.determinismScore,  // 0-100
  cacheHitRate: stats.cacheHitRate,         // 0-100
});
```

## KPI: Build Determinism Score

### Definition

The **Build Determinism Score** measures the percentage of input hashes where all builds produced identical outputs.

**Formula**:
```
determinismScore = (deterministicInputHashes / totalInputHashes) × 100
```

Where:
- `totalInputHashes`: Number of unique input hashes
- `deterministicInputHashes`: Number of input hashes where all builds produced identical outputs

### Interpretation

- **100%**: Perfect determinism - all builds with same inputs produce same outputs
- **95-99%**: High determinism - most builds are reproducible
- **80-94%**: Moderate determinism - some non-deterministic behavior
- **<80%**: Low determinism - significant reproducibility issues

### Target

**Target: ≥95%**

The system should maintain at least 95% build determinism for production quality.

## API Endpoints

### GET /api/v1/kpi/build-determinism

Get current Build Determinism metrics and KPI.

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
      "calculatedAt": "2025-01-15T10:30:00Z",
      "metadata": {
        "totalBuilds": 150,
        "uniqueInputs": 75,
        "cacheSize": 50,
        "cacheHitRate": 65.3,
        "description": "Percentage of input hashes where all builds produced identical outputs"
      }
    }
  },
  "timestamp": "2025-01-15T10:30:00Z"
}
```

## Database Schema

Build Determinism KPIs are stored in the `kpi_snapshots` table:

```sql
SELECT * FROM kpi_snapshots
WHERE kpi_name = 'build_determinism'
ORDER BY calculated_at DESC
LIMIT 10;
```

Fields:
- `kpi_name`: 'build_determinism'
- `level`: 'factory' (system-wide metric)
- `value`: Score (0-100)
- `unit`: 'percentage'
- `metadata`: JSON with detailed statistics

## Best Practices

### 1. Ensure Deterministic Inputs

**DO**:
- Use exact dependency versions (no ranges)
- Explicitly specify environment variables
- Hash file contents, not timestamps
- Lock down build tool versions

**DON'T**:
- Use `latest` or `^` version specifiers
- Rely on implicit environment variables
- Include timestamps in build artifacts
- Use random or time-based identifiers

### 2. Design for Reproducibility

```typescript
// ✅ GOOD: Deterministic
const buildConfig = {
  mode: 'production',
  version: '1.2.3',
  timestamp: new Date().toISOString(), // Excluded from hash
};

// ❌ BAD: Non-deterministic
const buildConfig = {
  mode: process.env.MODE || 'development', // Implicit
  version: 'latest',                       // Non-specific
  buildId: Math.random(),                  // Random
};
```

### 3. Cache Management

```typescript
const tracker = getBuildDeterminismTracker();

// Clean old cache entries regularly
tracker.cleanCache(30); // Remove entries older than 30 days
```

### 4. Monitor Metrics

Set up alerts for:
- Determinism score drops below 95%
- Cache hit rate below 50%
- Repeated builds with identical inputs but different outputs

## Troubleshooting

### Low Determinism Score

**Symptoms**: Score < 95%

**Common Causes**:
1. **Non-deterministic dependencies**: Using version ranges or `latest`
2. **Implicit environment**: Different env vars between builds
3. **Timestamps in artifacts**: Build artifacts contain timestamps
4. **Parallel build issues**: Race conditions in parallel builds

**Solutions**:
1. Lock all dependency versions
2. Explicitly specify all environment variables
3. Strip timestamps from build outputs
4. Ensure parallel builds are isolated

### Cache Misses

**Symptoms**: Low cache hit rate

**Common Causes**:
1. **Overly sensitive hashing**: Including variables that shouldn't affect output
2. **Cache expiration**: Entries cleaned too aggressively
3. **Frequent input changes**: Normal in active development

**Solutions**:
1. Review which inputs are included in hash
2. Adjust cache cleanup policy
3. Accept lower hit rate during active development

## Integration with CI/CD

### GitHub Actions

```yaml
name: Deterministic Build

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Cache dependencies
        uses: actions/cache@v3
        with:
          path: node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
      
      - name: Build with determinism tracking
        run: npm run build
        
      - name: Check determinism score
        run: |
          SCORE=$(curl -s https://api.afu-9.com/v1/kpi/build-determinism | jq '.data.metrics.determinismScore')
          if (( $(echo "$SCORE < 95" | bc -l) )); then
            echo "Build determinism score too low: $SCORE%"
            exit 1
          fi
```

### Docker

```dockerfile
# Use specific versions for determinism
FROM node:20.10.0-alpine

# Lock dependency versions
COPY package-lock.json .
RUN npm ci --production

# Build with deterministic timestamps
ENV SOURCE_DATE_EPOCH=0
RUN npm run build
```

## Future Enhancements

1. **Artifact Storage**: Store build artifacts in S3 with content-addressable paths
2. **Distributed Cache**: Share build cache across multiple machines
3. **Smart Invalidation**: Detect which inputs actually affect outputs
4. **Build Graph Visualization**: Visual representation of build dependencies
5. **Regression Detection**: Alert when previously deterministic builds become non-deterministic

## References

- [EPIC 5: Autonomous Build-Test-Deploy Loop](/docs/roadmaps/afu9_roadmap_v0_3_issues.md#epic-5--autonomous-build-test-deploy-loop)
- [KPI Definitions](/docs/KPI_DEFINITIONS.md)
- [Workflow Engine](/docs/WORKFLOW-ENGINE.md)
- [Reproducible Builds](https://reproducible-builds.org/)
