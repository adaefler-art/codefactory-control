# KPI System API Documentation

**Version:** 1.0.0  
**EPIC:** 3 - KPI System & Telemetry  
**Base Path:** `/api/v1/kpi`

## Overview

The KPI API provides access to the AFU-9 Factory KPI system, including real-time metrics, historical data, and freshness indicators. All endpoints are read-only and return JSON responses.

**Related Documentation:**
- [KPI Definitions](./KPI_DEFINITIONS.md) - Canonical KPI definitions and formulas
- [Factory Status API](./FACTORY_STATUS_API.md) - Consolidated factory status
- [Observability Guide](./OBSERVABILITY.md) - Complete observability documentation

## Authentication

Currently no authentication required (internal API). Future versions may require API tokens.

## Endpoints

### GET /api/v1/kpi/factory

Get extended factory-level KPIs including steering accuracy and KPI freshness.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `periodHours` | integer | 24 | Time period in hours (1-168) |

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/kpi/factory?periodHours=48"
```

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "meanTimeToInsightMs": 285000,
    "totalExecutions": 45,
    "completedExecutions": 38,
    "failedExecutions": 7,
    "successRate": 84.44,
    "avgExecutionDurationMs": 275000,
    "runningExecutions": 2,
    "steeringAccuracy": {
      "steeringAccuracyPct": 92.5,
      "totalDecisions": 80,
      "acceptedDecisions": 74,
      "overriddenDecisions": 4,
      "escalatedDecisions": 2,
      "periodStart": "2025-12-15T20:00:00.000Z",
      "periodEnd": "2025-12-16T20:00:00.000Z"
    },
    "kpiFreshness": [
      {
        "kpiName": "mtti",
        "freshnessSeconds": 45,
        "lastCalculatedAt": "2025-12-16T19:59:15.000Z",
        "isFresh": true,
        "status": "fresh"
      }
    ],
    "calculatedAt": "2025-12-16T20:00:00.000Z",
    "periodHours": 48,
    "kpiVersion": "1.0.0"
  },
  "timestamp": "2025-12-16T20:00:00.000Z"
}
```

**Error Response (400):**
```json
{
  "error": "periodHours must be between 1 and 168 (1 week)"
}
```

---

### GET /api/v1/kpi/products

Get product-level KPIs aggregated by repository.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repositoryId` | UUID | - | Filter to specific repository (optional) |
| `periodDays` | integer | 7 | Time period in days (1-90) |

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/kpi/products?periodDays=14"
```

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "products": [
      {
        "repositoryId": "550e8400-e29b-41d4-a716-446655440000",
        "productName": "owner/repo1",
        "successRatePct": 90.5,
        "dailyThroughput": 5.2,
        "totalExecutions": 73,
        "completedExecutions": 66,
        "failedExecutions": 7,
        "avgDurationMs": 250000,
        "periodStart": "2025-12-02T20:00:00.000Z",
        "periodEnd": "2025-12-16T20:00:00.000Z",
        "calculatedAt": "2025-12-16T20:00:00.000Z"
      }
    ],
    "count": 1
  },
  "timestamp": "2025-12-16T20:00:00.000Z"
}
```

---

### GET /api/v1/kpi/history

Get time-series history for a specific KPI.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kpiName` | string | Yes | KPI name (e.g., 'mtti', 'success_rate') |
| `level` | string | No | Aggregation level: 'factory', 'product', 'run' (default: 'factory') |
| `scopeId` | UUID | No | Scope ID (repository_id for product, execution_id for run) |
| `fromDate` | ISO 8601 | No | Start date for history |
| `toDate` | ISO 8601 | No | End date for history |
| `limit` | integer | No | Max data points (1-1000, default: 100) |

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/kpi/history?kpiName=mtti&limit=50"
```

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "kpiName": "mtti",
    "level": "factory",
    "scopeId": null,
    "unit": "milliseconds",
    "dataPoints": [
      {
        "timestamp": "2025-12-16T20:00:00.000Z",
        "value": 285000,
        "metadata": {}
      },
      {
        "timestamp": "2025-12-16T19:55:00.000Z",
        "value": 290000,
        "metadata": {}
      }
    ],
    "summary": {
      "min": 250000,
      "max": 320000,
      "avg": 285000,
      "latest": 285000
    },
    "periodStart": "2025-12-15T20:00:00.000Z",
    "periodEnd": "2025-12-16T20:00:00.000Z"
  },
  "timestamp": "2025-12-16T20:00:00.000Z"
}
```

**Error Response (400):**
```json
{
  "error": "kpiName query parameter is required"
}
```

---

### GET /api/v1/kpi/freshness

Get KPI freshness metrics showing how current each KPI is.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kpiName` | string | No | Filter to specific KPI (optional) |

**Example Request:**
```bash
curl "http://localhost:3000/api/v1/kpi/freshness"
```

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "kpis": [
      {
        "kpiName": "mtti",
        "freshnessSeconds": 45,
        "lastCalculatedAt": "2025-12-16T19:59:15.000Z",
        "isFresh": true,
        "status": "fresh"
      },
      {
        "kpiName": "success_rate",
        "freshnessSeconds": 120,
        "lastCalculatedAt": "2025-12-16T19:58:00.000Z",
        "isFresh": false,
        "status": "stale"
      },
      {
        "kpiName": "steering_accuracy",
        "freshnessSeconds": 400,
        "lastCalculatedAt": "2025-12-16T19:53:20.000Z",
        "isFresh": false,
        "status": "expired"
      }
    ],
    "overall": {
      "status": "expired",
      "freshCount": 1,
      "staleCount": 1,
      "expiredCount": 1
    }
  },
  "timestamp": "2025-12-16T20:00:00.000Z"
}
```

**Freshness Status:**
- **fresh**: < 60 seconds (real-time)
- **stale**: 60-300 seconds (acceptable for dashboards)
- **expired**: > 300 seconds (requires refresh)

---

## Data Types

### ExtendedFactoryKPIs

```typescript
interface ExtendedFactoryKPIs {
  // Base KPIs
  meanTimeToInsightMs: number | null;
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  successRate: number; // 0-100
  avgExecutionDurationMs: number | null;
  runningExecutions: number;
  
  // EPIC 3 KPIs
  steeringAccuracy?: SteeringAccuracyMetrics;
  kpiFreshness?: KpiFreshnessMetrics[];
  
  // Metadata
  calculatedAt: string; // ISO 8601
  periodHours: number;
  kpiVersion: string; // e.g., "1.0.0"
}
```

### SteeringAccuracyMetrics

```typescript
interface SteeringAccuracyMetrics {
  steeringAccuracyPct: number; // 0-100
  totalDecisions: number;
  acceptedDecisions: number;
  overriddenDecisions: number;
  escalatedDecisions: number;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
}
```

### ProductKPIs

```typescript
interface ProductKPIs {
  repositoryId: string;
  productName: string; // owner/name
  successRatePct: number; // 0-100
  dailyThroughput: number; // runs per day
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  avgDurationMs: number | null;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
  calculatedAt: string; // ISO 8601
}
```

### KpiFreshnessMetrics

```typescript
interface KpiFreshnessMetrics {
  kpiName: string;
  freshnessSeconds: number;
  lastCalculatedAt: string; // ISO 8601
  isFresh: boolean; // < 60 seconds
  status: 'fresh' | 'stale' | 'expired';
}
```

---

## Usage Examples

### TypeScript/JavaScript

```typescript
// Get factory KPIs
async function getFactoryKPIs() {
  const response = await fetch('/api/v1/kpi/factory?periodHours=24');
  const { data } = await response.json();
  
  console.log(`MTTI: ${data.meanTimeToInsightMs}ms`);
  console.log(`Success Rate: ${data.successRate}%`);
  
  if (data.steeringAccuracy) {
    console.log(`Steering Accuracy: ${data.steeringAccuracy.steeringAccuracyPct}%`);
  }
}

// Get product KPIs
async function getProductKPIs() {
  const response = await fetch('/api/v1/kpi/products?periodDays=7');
  const { data } = await response.json();
  
  data.products.forEach(product => {
    console.log(`${product.productName}: ${product.successRatePct}% success rate`);
  });
}

// Check KPI freshness
async function checkKpiFreshness() {
  const response = await fetch('/api/v1/kpi/freshness');
  const { data } = await response.json();
  
  const staleKpis = data.kpis.filter(k => !k.isFresh);
  if (staleKpis.length > 0) {
    console.warn('Stale KPIs detected:', staleKpis.map(k => k.kpiName));
  }
}
```

### Python

```python
import requests

def get_factory_kpis(period_hours=24):
    response = requests.get(
        'http://localhost:3000/api/v1/kpi/factory',
        params={'periodHours': period_hours}
    )
    response.raise_for_status()
    return response.json()['data']

# Usage
kpis = get_factory_kpis(period_hours=48)
print(f"MTTI: {kpis['meanTimeToInsightMs']}ms")
print(f"Success Rate: {kpis['successRate']}%")

if kpis.get('steeringAccuracy'):
    accuracy = kpis['steeringAccuracy']
    print(f"Steering Accuracy: {accuracy['steeringAccuracyPct']}%")
```

### Shell/curl

```bash
#!/bin/bash

# Get factory KPIs and extract MTTI
MTTI=$(curl -s http://localhost:3000/api/v1/kpi/factory | jq -r '.data.meanTimeToInsightMs')
echo "Mean Time to Insight: ${MTTI}ms"

# Check for stale KPIs
STALE_COUNT=$(curl -s http://localhost:3000/api/v1/kpi/freshness | jq -r '.data.overall.staleCount')
if [ "$STALE_COUNT" -gt 0 ]; then
  echo "Warning: $STALE_COUNT KPIs are stale"
fi

# Get product throughput
curl -s 'http://localhost:3000/api/v1/kpi/products?periodDays=7' | \
  jq -r '.data.products[] | "\(.productName): \(.dailyThroughput) runs/day"'
```

---

## Performance Considerations

- **Factory KPIs**: Optimized with materialized views, refresh every 5 minutes
- **Product KPIs**: Calculated on-demand, cached for 5 minutes
- **History**: Indexed by KPI name and timestamp for fast queries
- **Freshness**: Lightweight query, safe to call frequently

**Recommended Polling:**
- Dashboard refresh: Every 30-60 seconds
- Background monitoring: Every 5 minutes
- Historical analysis: On-demand

---

## Error Handling

All errors follow the standard format:

```json
{
  "status": "error",
  "error": "Brief error description",
  "message": "Detailed error message"
}
```

---

## POST /api/v1/kpi/aggregate

**NEW in Issue 3.2** - Trigger on-demand KPI aggregation pipeline execution.

**Description:**  
Manually triggers the complete KPI aggregation pipeline (Run → Product → Factory). This endpoint executes the same aggregation logic as the periodic scheduler, useful for:
- On-demand KPI updates after system changes
- Backfilling historical data
- Testing and validation

**Request Body (Optional):**
```json
{
  "periodHours": 24
}
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `periodHours` | integer | 24 | Time period for aggregation (1-168 hours) |

**Example Request:**
```bash
curl -X POST http://localhost:3000/api/v1/kpi/aggregate \
  -H "Content-Type: application/json" \
  -d '{"periodHours": 48}'
```

**Success Response (200):**
```json
{
  "success": true,
  "job": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "jobType": "incremental",
    "status": "completed",
    "kpiNames": [
      "run_duration",
      "token_usage",
      "product_success_rate",
      "product_throughput",
      "mtti",
      "success_rate",
      "steering_accuracy"
    ],
    "periodStart": "2025-12-15T20:00:00.000Z",
    "periodEnd": "2025-12-16T20:00:00.000Z",
    "startedAt": "2025-12-16T20:00:01.000Z",
    "completedAt": "2025-12-16T20:00:05.523Z",
    "durationMs": 5523,
    "snapshotsCreated": 142,
    "metadata": {
      "pipeline": "run->product->factory",
      "triggered_by": "api"
    },
    "createdAt": "2025-12-16T20:00:01.000Z"
  },
  "message": "KPI aggregation pipeline triggered successfully"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "Database connection failed",
  "message": "Failed to trigger KPI aggregation pipeline"
}
```

**Method Not Allowed (405):**
```json
{
  "success": false,
  "error": "Method not allowed",
  "message": "Use POST to trigger aggregation"
}
```

**Pipeline Stages:**
1. **Run-Level Aggregation**: Calculate metrics for individual workflow executions (duration, tokens, tool calls)
2. **Product-Level Aggregation**: Roll up metrics per repository (success rate, throughput, avg duration)
3. **Factory-Level Aggregation**: Global metrics across all products (MTTI, success rate, steering accuracy)
4. **Materialized View Refresh**: Update optimized query views for performance

**Notes:**
- Aggregation jobs are tracked in `kpi_aggregation_jobs` table
- Only processes runs that haven't been aggregated yet (idempotent)
- Safe to run multiple times - won't create duplicate snapshots
- Typical execution time: 2-10 seconds depending on data volume

---

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Invalid parameters
- `404` - Resource not found
- `405` - Method not allowed (only GET supported)
- `500` - Internal server error

---

## Monitoring & Alerting

**Alert Conditions:**
- KPI freshness > 300 seconds (expired)
- Steering accuracy < 90%
- Success rate < 85%
- MTTI > 300 seconds (5 minutes)

**CloudWatch Metrics:**
All KPIs are also published to CloudWatch under namespace `AFU9/Factory` for integration with existing monitoring.

---

## Related APIs

- **Factory Status API**: `/api/v1/factory/status` - Consolidated status including runs and errors
- **Observability API**: `/api/observability/*` - Infrastructure metrics and logs
- **Health API**: `/api/health`, `/api/ready` - Service health checks

---

## Versioning

API version is included in the URL path (`/api/v1/kpi/*`).

**Current Version:** 1.0.0  
**Deprecation Policy:** 6-month notice for breaking changes

---

## Future Enhancements

- [ ] WebSocket support for real-time KPI updates
- [ ] Batch export for historical data (CSV, Parquet)
- [ ] GraphQL endpoint variant
- [ ] KPI target/threshold configuration API
- [ ] Custom KPI definition API

---

_End of KPI System API Documentation v1.0.0_
