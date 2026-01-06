# E78.1: KPI Store + Compute - Implementation Summary

## Overview
Implemented deterministic KPI measurement and aggregation system for AFU-9 velocity and ops metrics.

## KPI Definitions and Formulas

### Velocity KPIs

#### D2D (Decision-to-Deploy)
**Formula**: `EXTRACT(EPOCH FROM (deploy_at - decision_at)) / 3600.0`
- **Decision timestamp**: When issue state enters `SPEC_READY`
- **Deploy timestamp**: First successful deploy event for that issue/PR
- **Unit**: hours
- **Source**: `afu9_issue_events` (to_status='SPEC_READY'), `deploy_events` (status='success'), linked via `timeline_nodes` and `timeline_edges`

#### HSH (Human Steering Hours)
**Status**: Schema ready, computation placeholder
- **Formula**: TBD (requires explicit tracking)
- **Unit**: hours
- **Source**: To be determined when tracking mechanism is implemented

#### DCU (Delivered Capability Units)
**Status**: Schema ready, computation placeholder
- **Formula**: Parse from issue labels/body deterministically
- **Unit**: count
- **Source**: To be determined when parsing rules are defined

#### AVS (Autonomy Velocity Score)
**Formula**: `DCU / HSH`
- **Condition**: Only computed when both DCU and HSH are present
- **Unit**: ratio
- **Source**: Derived from DCU and HSH measurements

### Ops KPIs

#### Incident Rate
**Formula**: `COUNT(incidents) / window_days`
- **Unit**: incidents_per_day
- **Source**: `incidents` table filtered by `created_at` in time window
- **SQL Function**: `calculate_incident_rate_for_window(window_start, window_end)`

#### MTTR (Mean Time To Resolve)
**Formula**: `AVG(EXTRACT(EPOCH FROM (closed_at - opened_at)) / 3600.0)`
- **Unit**: hours
- **Source**: `incidents` (opened_at) joined with `incident_events` (closed_at where event_type='CLOSED')
- **Filter**: Only closed incidents within the time window
- **SQL Function**: `calculate_mttr_for_window(window_start, window_end)`

#### Auto-fix Rate
**Formula**: `(COUNT(remediation_runs WHERE status='SUCCEEDED') / COUNT(remediation_runs)) * 100`
- **Unit**: percentage
- **Source**: `remediation_runs` table filtered by `created_at` in time window
- **Caveat**: Currently assumes SUCCEEDED remediation runs are auto-fixed without human intervention (no explicit human intervention flag yet)
- **SQL Function**: `calculate_autofix_rate_for_window(window_start, window_end)`

## Database Schema

### kpi_measurements
Atomic measurements or event-derived facts:
- **Unique constraint**: `(kpi_name, entity_type, entity_id, occurred_at)`
- **Purpose**: Store raw measurement data with evidence linkage
- **Indexed by**: kpi_name, entity_type, occurred_at, source_refs (GIN index)

### kpi_aggregates
Windowed aggregates with versioning:
- **Unique constraint**: `(window, window_start, window_end, kpi_name, compute_version, inputs_hash)`
- **Purpose**: Store computed aggregates idempotently
- **Indexed by**: kpi_name, window, window_start, window_end, compute_version

## Deterministic Computation

### Inputs Hash
- **Algorithm**: SHA-256 of canonical JSON representation
- **Purpose**: Ensure same inputs → same hash → idempotent recompute
- **Implementation**: Keys sorted before JSON serialization

### Compute Version
- **Current**: 0.7.0
- **Purpose**: Track computation algorithm version for reproducibility
- **Stored in**: `kpi_aggregates.compute_version`

## API Endpoints

### GET /api/kpis
Query KPI aggregates:
```
GET /api/kpis?window=daily&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z&kpiNames=incident_rate,mttr,autofix_rate&limit=100
```

Response:
```json
{
  "aggregates": [...],
  "count": 3,
  "filters": {
    "window": "daily",
    "fromDate": "2024-01-01T00:00:00Z",
    "toDate": "2024-01-02T00:00:00Z",
    "kpiNames": ["incident_rate", "mttr", "autofix_rate"],
    "limit": 100
  }
}
```

### POST /api/kpis/recompute
Trigger KPI recomputation (admin-only):
```json
{
  "window": "daily",
  "windowStart": "2024-01-01T00:00:00Z",
  "windowEnd": "2024-01-02T00:00:00Z",
  "kpiNames": ["incident_rate", "mttr", "autofix_rate"],
  "forceRecompute": false
}
```

Response:
```json
{
  "aggregates": [...],
  "inputsHash": "sha256...",
  "computeVersion": "0.7.0",
  "computedAt": "2024-01-01T12:00:00Z",
  "windowStart": "2024-01-01T00:00:00Z",
  "windowEnd": "2024-01-02T00:00:00Z"
}
```

## Files Changed

### Database
- `database/migrations/042_kpi_measurements_and_aggregates.sql`
  - New tables: `kpi_measurements`, `kpi_aggregates`
  - Helper functions: `calculate_d2d_hours`, `calculate_mttr_for_window`, `calculate_incident_rate_for_window`, `calculate_autofix_rate_for_window`

### Service Layer
- `control-center/src/lib/kpi-service.ts`
  - New functions: `calculateD2DForIssue`, `calculateMTTRForWindow`, `calculateIncidentRateForWindow`, `calculateAutoFixRateForWindow`
  - Compute engine: `computeKpisForWindow` (deterministic, idempotent)
  - Data access: `createKpiMeasurement`, `getKpiAggregates`

### Type Definitions
- `control-center/src/lib/types/kpi.ts`
  - New types: `KpiMeasurement`, `KpiAggregate`, `AggregationWindow`, `KpiEntityType`
  - Velocity KPI types: `D2DMetrics`, `HSHMetrics`, `DCUMetrics`, `AVSMetrics`
  - Ops KPI types: `IncidentRateMetrics`, `MTTRMetrics`, `AutoFixRateMetrics`
  - Request/response types: `ComputeKpisForWindowRequest`, `ComputeKpisForWindowResponse`

### API Routes
- `control-center/app/api/kpis/route.ts` - GET endpoint for querying aggregates
- `control-center/app/api/kpis/recompute/route.ts` - POST endpoint for triggering recompute

### Tests
- `control-center/__tests__/lib/kpi-measurements-aggregates.test.ts`
  - 11 tests covering MTTR, Incident Rate, Auto-fix Rate, compute engine, idempotency

## Test Results
✅ All 11 new tests passing
✅ 138 test suites passed overall (8 pre-existing failures in unrelated packages)

## PowerShell Verification Commands

### Run migration
```powershell
# Apply the new migration
psql -h localhost -U postgres -d afu9 -f database/migrations/042_kpi_measurements_and_aggregates.sql
```

### Run tests
```powershell
# Run KPI measurement tests
npm --prefix control-center test -- kpi-measurements-aggregates.test.ts

# Run all tests
npm --prefix control-center test
```

### Build verification
```powershell
# Build control center (note: may fail on pre-existing package dependencies)
npm --prefix control-center run build

# Type check only (our files)
cd control-center
npx tsc --noEmit --skipLibCheck src/lib/types/kpi.ts
```

### Test API endpoints (after server start)
```powershell
# Start server
npm --prefix control-center run dev

# Query KPI aggregates
Invoke-RestMethod -Uri "http://localhost:3000/api/kpis?window=daily&limit=10" -Method Get

# Trigger recompute
$body = @{
  window = "daily"
  windowStart = "2024-01-01T00:00:00Z"
  windowEnd = "2024-01-02T00:00:00Z"
  kpiNames = @("incident_rate", "mttr", "autofix_rate")
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/kpis/recompute" -Method Post -Body $body -ContentType "application/json"
```

### Database verification
```powershell
# Check tables exist
psql -h localhost -U postgres -d afu9 -c "\dt kpi_*"

# Check functions exist
psql -h localhost -U postgres -d afu9 -c "\df calculate_*"

# Sample MTTR calculation (replace dates with actual data range)
psql -h localhost -U postgres -d afu9 -c "SELECT * FROM calculate_mttr_for_window('2024-01-01'::timestamptz, '2024-01-02'::timestamptz);"

# Sample Incident Rate calculation
psql -h localhost -U postgres -d afu9 -c "SELECT * FROM calculate_incident_rate_for_window('2024-01-01'::timestamptz, '2024-01-02'::timestamptz);"

# Sample Auto-fix Rate calculation
psql -h localhost -U postgres -d afu9 -c "SELECT * FROM calculate_autofix_rate_for_window('2024-01-01'::timestamptz, '2024-01-02'::timestamptz);"
```

## Acceptance Criteria

✅ DB schema exists
  - `kpi_measurements` table with unique constraints and indexes
  - `kpi_aggregates` table with idempotency constraint
  - Helper functions for MTTR, Incident Rate, Auto-fix Rate, D2D

✅ Compute engine produces deterministic aggregates
  - `computeKpisForWindow()` calculates inputs_hash
  - Idempotent recompute (same inputs → same hash → no duplicate rows)
  - Daily aggregates for Ops KPIs (Incident Rate, MTTR, Auto-fix Rate)

✅ Velocity KPI stubs ready
  - D2D calculation implemented (database function)
  - HSH/DCU/AVS schema ready, computation placeholders in service

✅ Tests/build verification
  - ✅ `npm test` - 11/11 new tests passing
  - ⚠️ `npm --prefix control-center run build` - pre-existing package dependency issues (unrelated to E78.1)

## Notes
- D2D calculation requires populated `timeline_nodes` and `timeline_edges` for linking issues to deploys
- HSH and DCU require additional tracking/parsing mechanisms before full implementation
- Auto-fix Rate currently assumes SUCCEEDED remediation runs are auto-fixed (no explicit human intervention flag yet - noted in caveat field)
- Build failures are in pre-existing packages (`@codefactory/deploy-memory`, `@codefactory/verdict-engine`) and not related to E78.1 changes
