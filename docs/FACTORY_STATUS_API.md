# Central Factory Status API

## Overview

The Central Factory Status API provides a read-only, versioned REST API for querying the aggregated state of the AFU-9 Factory Control Plane. This API implements **Issue 1.2** from the AFU-9 Roadmap v0.3.

**Key Features:**
- Read-only access (GET only)
- JSON-only responses
- Versioned API (currently v1.1.0)
- Aggregated view of runs, errors, verdicts, and KPIs
- Verdict Engine v1.1 integration (EPIC 2)
- Extensible design for future enhancements

**KPIs:** 
- Mean Time to Insight
- Verdict Consistency (EPIC 2)
- Auditability (EPIC 2)

## API Endpoint

### GET /api/v1/factory/status

Retrieves the current factory status including workflow runs, errors, and KPIs.

**Base URL:**
```
http://localhost:3000/api/v1/factory/status
```

**Method:** `GET`

**Authentication:** Currently no authentication required (internal API)

## Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 10 | 100 | Number of recent workflow runs to include |
| `errorLimit` | integer | 10 | 100 | Number of recent errors to include |
| `kpiPeriodHours` | integer | 24 | 168 | Time period in hours for KPI calculation (max 1 week) |

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/factory/status?limit=20&errorLimit=10&kpiPeriodHours=48"
```

## Response Format

### Success Response (200 OK)

```json
{
  "api": {
    "version": "1.1.0"
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "runs": {
    "recent": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "workflowId": "660e8400-e29b-41d4-a716-446655440000",
        "status": "completed",
        "startedAt": "2024-01-15T10:00:00.000Z",
        "completedAt": "2024-01-15T10:05:00.000Z",
        "durationMs": 300000,
        "triggeredBy": "user@example.com",
        "error": null
      }
    ],
    "total": 156
  },
  "errors": {
    "recent": [
      {
        "executionId": "770e8400-e29b-41d4-a716-446655440000",
        "workflowId": "880e8400-e29b-41d4-a716-446655440000",
        "error": "Database connection timeout",
        "timestamp": "2024-01-15T09:45:00.000Z",
        "status": "failed"
      }
    ],
    "total": 12
  },
  "kpis": {
    "meanTimeToInsightMs": 285000,
    "totalExecutions": 45,
    "completedExecutions": 38,
    "failedExecutions": 7,
    "successRate": 84.44,
    "avgExecutionDurationMs": 275000,
    "runningExecutions": 2
  },
  "verdicts": {
    "enabled": true,
    "summary": [
      {
        "id": "verdict-123",
        "executionId": "770e8400-e29b-41d4-a716-446655440000",
        "errorClass": "ACM_DNS_VALIDATION_PENDING",
        "service": "ACM",
        "confidenceScore": 90,
        "proposedAction": "WAIT_AND_RETRY",
        "fingerprintId": "abc123def456",
        "policyVersion": "v1.0.0",
        "createdAt": "2024-01-15T09:45:30.000Z"
      }
    ],
    "kpis": {
      "totalVerdicts": 245,
      "avgConfidence": 87,
      "consistencyScore": 98,
      "byAction": {
        "waitAndRetry": 120,
        "openIssue": 100,
        "humanRequired": 25
      },
      "topErrorClasses": [
        {
          "errorClass": "ACM_DNS_VALIDATION_PENDING",
          "count": 50,
          "avgConfidence": 90
        },
        {
          "errorClass": "MISSING_SECRET",
          "count": 45,
          "avgConfidence": 85
        }
      ]
    }
  }
}
```

### Error Response (400 Bad Request)

```json
{
  "error": "limit must be between 1 and 100"
}
```

### Error Response (500 Internal Server Error)

```json
{
  "error": "Failed to retrieve factory status",
  "message": "Database connection error"
}
```

## Response Schema

### FactoryStatusResponse

| Field | Type | Description |
|-------|------|-------------|
| `api` | ApiVersion | API version information |
| `timestamp` | string | ISO 8601 timestamp of the status snapshot |
| `runs` | RunsData | Workflow execution run data |
| `errors` | ErrorsData | Error aggregation data |
| `kpis` | FactoryKPIs | Factory-wide KPI metrics |
| `verdicts` | VerdictsData | Verdict data (placeholder for future) |

### ApiVersion

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | API version (e.g., "1.0.0") |
| `deprecationDate` | string? | Optional deprecation date for this version |

### RunsData

| Field | Type | Description |
|-------|------|-------------|
| `recent` | FactoryRunSummary[] | Array of recent workflow runs |
| `total` | number | Total number of workflow executions |

### FactoryRunSummary

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique execution ID (UUID) |
| `workflowId` | string \| null | Associated workflow ID |
| `status` | string | Execution status: `pending`, `running`, `completed`, `failed`, `cancelled` |
| `startedAt` | string | ISO 8601 timestamp when execution started |
| `completedAt` | string \| null | ISO 8601 timestamp when execution completed |
| `durationMs` | number \| null | Execution duration in milliseconds |
| `triggeredBy` | string \| null | User or system that triggered the execution |
| `error` | string \| null | Error message if execution failed |

### ErrorsData

| Field | Type | Description |
|-------|------|-------------|
| `recent` | ErrorSummary[] | Array of recent errors from failed executions |
| `total` | number | Total number of errors |

### ErrorSummary

| Field | Type | Description |
|-------|------|-------------|
| `executionId` | string | Execution ID where error occurred |
| `workflowId` | string \| null | Associated workflow ID |
| `error` | string | Error message |
| `timestamp` | string | ISO 8601 timestamp when error occurred |
| `status` | string | Execution status (typically "failed") |

### FactoryKPIs

| Field | Type | Description |
|-------|------|-------------|
| `meanTimeToInsightMs` | number \| null | **Mean Time to Insight** - Average time for executions to complete (completed or failed) |
| `totalExecutions` | number | Total number of executions in the time period |
| `completedExecutions` | number | Number of successfully completed executions |
| `failedExecutions` | number | Number of failed executions |
| `successRate` | number | Success rate as percentage (0-100) |
| `avgExecutionDurationMs` | number \| null | Average duration of completed executions in milliseconds |
| `runningExecutions` | number | Currently running executions |

### VerdictsData (EPIC 2: Verdict Engine v1.1)

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether Verdict Engine is enabled (`true` in v1.1.0+) |
| `summary` | VerdictSummary[] | Array of recent verdicts |
| `kpis` | VerdictKPIs | Verdict-related KPI metrics |

### VerdictSummary

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique verdict ID (UUID) |
| `executionId` | string | Workflow execution that generated this verdict |
| `errorClass` | string | Classified error type (e.g., `ACM_DNS_VALIDATION_PENDING`) |
| `service` | string | AWS service involved (e.g., `ACM`, `SecretsManager`) |
| `confidenceScore` | number | Normalized confidence score (0-100) |
| `proposedAction` | string | Recommended action: `WAIT_AND_RETRY`, `OPEN_ISSUE`, or `HUMAN_REQUIRED` |
| `fingerprintId` | string | Stable fingerprint for error pattern |
| `policyVersion` | string | Policy snapshot version used (e.g., `v1.0.0`) |
| `createdAt` | string | ISO 8601 timestamp when verdict was created |

### VerdictKPIs

| Field | Type | Description |
|-------|------|-------------|
| `totalVerdicts` | number | Total number of verdicts in the time period |
| `avgConfidence` | number | Average confidence score (0-100) |
| `consistencyScore` | number | **Verdict Consistency** - Percentage of fingerprint groups with consistent verdicts (0-100) |
| `byAction` | object | Count of verdicts by proposed action |
| `byAction.waitAndRetry` | number | Number of verdicts proposing wait and retry |
| `byAction.openIssue` | number | Number of verdicts proposing to open an issue |
| `byAction.humanRequired` | number | Number of verdicts requiring human intervention |
| `topErrorClasses` | array | Top 5 most common error classes with counts and average confidence |

## KPIs Explained

### Mean Time to Insight (MTTI)

The primary KPI tracked by this API. MTTI measures the average time from when a workflow execution starts until it reaches a terminal state (completed or failed). This metric is critical for understanding how quickly the factory can process work items and provide feedback.

**Calculation:**
```
MTTI = AVG(completion_time - start_time) for all executions in period
```

**Use Cases:**
- Monitor factory efficiency
- Identify performance degradation
- Track improvement initiatives
- Set SLA targets

### Success Rate

Percentage of executions that complete successfully versus fail.

**Calculation:**
```
Success Rate = (completed_executions / (completed_executions + failed_executions)) * 100
```

### Verdict Consistency Score (EPIC 2)

**New in v1.1.0** - Measures the determinism and reliability of the Verdict Engine.

The consistency score indicates the percentage of error fingerprint groups where all verdicts have consistent error classifications and confidence scores. A high consistency score (>95%) indicates that the Verdict Engine produces deterministic, repeatable verdicts.

**Calculation:**
```
Consistency Score = (consistent_fingerprint_groups / total_fingerprint_groups) * 100

Where a fingerprint group is "consistent" if all verdicts with the same fingerprint have:
- Identical error_class
- Identical confidence_score
```

**Target:** >95% consistency

**Use Cases:**
- Validate Verdict Engine determinism
- Monitor policy changes impact
- Track verdict quality over time
- Ensure governance compliance

### Auditability (EPIC 2)

**New in v1.1.0** - Every verdict includes:
- **Policy Reference**: Immutable policy snapshot ID and version
- **Full Traceability**: From verdict → policy → execution → workflow
- **Timestamps**: When verdict was created
- **Raw Signals**: Original failure data preserved

This enables complete audit trails for compliance and governance requirements.

## HTTP Methods

| Method | Supported | Response |
|--------|-----------|----------|
| GET | ✅ Yes | Returns factory status |
| POST | ❌ No | 405 Method Not Allowed |
| PUT | ❌ No | 405 Method Not Allowed |
| DELETE | ❌ No | 405 Method Not Allowed |
| PATCH | ❌ No | 405 Method Not Allowed |

This API is **read-only** by design. Any write operations return `405 Method Not Allowed`.

## Examples

### Get Status with Default Parameters

```bash
curl http://localhost:3000/api/v1/factory/status
```

### Get Extended Run History

```bash
curl "http://localhost:3000/api/v1/factory/status?limit=50&errorLimit=20"
```

### Get Weekly KPIs

```bash
curl "http://localhost:3000/api/v1/factory/status?kpiPeriodHours=168"
```

### Using with jq for Pretty Output

```bash
curl -s http://localhost:3000/api/v1/factory/status | jq '.'
```

### Extract Just the KPIs

```bash
curl -s http://localhost:3000/api/v1/factory/status | jq '.kpis'
```

### Check Mean Time to Insight

```bash
curl -s http://localhost:3000/api/v1/factory/status | jq '.kpis.meanTimeToInsightMs'
```

## Integration

### TypeScript/JavaScript

```typescript
import type { FactoryStatusResponse } from './src/lib/types/factory-status';

async function getFactoryStatus(): Promise<FactoryStatusResponse> {
  const response = await fetch('http://localhost:3000/api/v1/factory/status');
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

// Usage
const status = await getFactoryStatus();
console.log(`MTTI: ${status.kpis.meanTimeToInsightMs}ms`);
console.log(`Success Rate: ${status.kpis.successRate}%`);
```

### Python

```python
import requests

def get_factory_status():
    response = requests.get('http://localhost:3000/api/v1/factory/status')
    response.raise_for_status()
    return response.json()

# Usage
status = get_factory_status()
print(f"MTTI: {status['kpis']['meanTimeToInsightMs']}ms")
print(f"Success Rate: {status['kpis']['successRate']}%")
```

### Shell Script

```bash
#!/bin/bash

# Fetch status and extract MTTI
MTTI=$(curl -s http://localhost:3000/api/v1/factory/status | jq -r '.kpis.meanTimeToInsightMs')

# Alert if MTTI exceeds threshold (5 minutes = 300000ms)
if [ "$MTTI" -gt 300000 ]; then
  echo "Alert: MTTI is high: ${MTTI}ms"
fi
```

## Future Enhancements

### Verdict Engine Integration (EPIC 2)

When the Verdict Engine is implemented, the API will include:

```json
{
  "verdicts": {
    "enabled": true,
    "summary": [
      {
        "executionId": "...",
        "status": "approved",
        "confidenceScore": 95
      }
    ]
  }
}
```

See [AFU-9 Roadmap v0.3 EPIC 2](../../docs/roadmaps/afu9_roadmap_v0_3_issues.md) for details.

### Additional Planned Features

- Time-series data for trending
- Filtering by workflow ID
- Filtering by date range
- Pagination for large result sets
- WebSocket support for real-time updates
- GraphQL endpoint variant

## Versioning

This API uses URL-based versioning (`/api/v1/...`). Future versions will be released at `/api/v2/`, `/api/v3/`, etc.

**Current Version:** 1.0.0

**Deprecation Policy:** When a new version is released, the previous version will be supported for a minimum of 6 months before deprecation.

## Performance Considerations

- The API executes three database queries in parallel for optimal performance
- Default limits are set conservatively (10 items) to ensure fast responses
- KPI calculations are performed in the database using SQL aggregations
- Results are not cached; each request queries live data

**Recommended Query Patterns:**
- Use smaller limits for dashboard refresh (10-20 items)
- Use larger limits for detailed analysis (50-100 items)
- Adjust `kpiPeriodHours` based on your needs (24h for daily, 168h for weekly)

## Support

For issues or questions:
- Check the [main README](../../README.md)
- Review [Architecture Documentation](../../docs/architecture/README.md)
- See [Workflow Schema](../../docs/WORKFLOW-SCHEMA.md)

## Related Documentation

- [AFU-9 Roadmap v0.3](../../docs/roadmaps/afu9_roadmap_v0_3_issues.md)
- [Workflow Engine](../../docs/WORKFLOW-ENGINE.md)
- [Database Schema](../../docs/architecture/database-schema.md)
- [Observability](../../docs/OBSERVABILITY.md)
