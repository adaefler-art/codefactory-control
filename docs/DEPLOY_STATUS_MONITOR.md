# Deploy Status Monitor (E65.1)

The Deploy Status Monitor provides a deterministic, testable health check system that determines deployment readiness based on real-time signals from cloud infrastructure and runtime health endpoints.

## Overview

The monitor provides a **GREEN/YELLOW/RED** traffic light status that indicates whether it's safe to deploy:

- **GREEN (GO)**: All health checks passing, safe to deploy
- **YELLOW (CAUTION)**: Warnings detected, proceed with care
- **RED (HOLD)**: Critical issues detected, do not deploy

## Architecture

### Components

1. **Database Layer** (`database/migrations/027_deploy_status_snapshots.sql`)
   - Stores historical status snapshots
   - Enables timeline views and trending analysis
   - Schema includes: status, reasons, signals, timestamps

2. **Rules Engine** (`src/lib/deploy-status/rules-engine.ts`)
   - Pure, deterministic functions
   - Priority-based rule evaluation
   - 52 comprehensive unit tests covering all scenarios

3. **Signal Collector** (`src/lib/deploy-status/signal-collector.ts`)
   - Fetches health data from `/api/health` and `/api/ready`
   - Queries recent deploy events from database
   - Designed for extensibility (future: ECS/ALB metrics)

4. **API Endpoint** (`app/api/deploy/status/route.ts`)
   - GET `/api/deploy/status?env={env}`
   - 30-second cache with force refresh option
   - Works with or without database

5. **UI Components**
   - `DeployStatusBadge`: Real-time status indicator in navigation
   - `/deploy/status` page: Detailed status view with evidence

## Status Determination Rules

The rules are evaluated in priority order:

### RED (Critical Failures)

1. **SIGNALS_MISSING**: Health or ready check data unavailable
2. **HEALTH_FAIL**: `/api/health` returns non-200 or error
3. **READY_FAIL**: `/api/ready` returns non-200 or ready=false
4. **DEPLOY_FAILED**: Recent deploy event has failed status (within 30 min)

### YELLOW (Warnings)

5. **STALE_DATA**: Signal data older than 5 minutes
6. **DEPLOY_WARNING**: Recent deploy with warnings (within 30 min)
7. **HIGH_LATENCY**: Health check latency > 2000ms

### GREEN (All Healthy)

8. **ALL_HEALTHY**: All checks pass, no warnings

## API Usage

### Query Current Status

```bash
# Get status for production environment
curl http://localhost:3000/api/deploy/status?env=prod

# Force fresh check (bypass cache)
curl http://localhost:3000/api/deploy/status?env=prod&force=true
```

### Response Format

```json
{
  "env": "prod",
  "status": "GREEN",
  "observed_at": "2024-01-01T12:00:00Z",
  "staleness_seconds": 0,
  "reasons": [
    {
      "code": "ALL_HEALTHY",
      "severity": "info",
      "message": "All health checks passing",
      "evidence": {
        "health_ok": true,
        "ready_ok": true,
        "no_recent_failures": true
      }
    }
  ],
  "signals": {
    "checked_at": "2024-01-01T12:00:00Z",
    "health": {
      "status": 200,
      "ok": true,
      "latency_ms": 45
    },
    "ready": {
      "status": 200,
      "ok": true,
      "ready": true,
      "latency_ms": 120
    },
    "deploy_events": []
  },
  "snapshot_id": "uuid-here"
}
```

## UI Components

### Status Badge

The badge appears in the navigation bar and auto-refreshes every 60 seconds:

```tsx
import DeployStatusBadge from "@/app/components/DeployStatusBadge";

<DeployStatusBadge 
  env="prod"           // Environment to monitor
  showLabel={true}     // Show status text
  refreshInterval={60000}  // Refresh every 60s
/>
```

### Detail Page

Visit `/deploy/status` to see:
- Current status with recommendation
- Detailed reason codes and evidence
- Health signal breakdown
- Recent deploy events
- Raw JSON signals viewer

## Database Schema

```sql
CREATE TABLE deploy_status_snapshots (
  id UUID PRIMARY KEY,
  env TEXT NOT NULL,
  status TEXT CHECK (status IN ('GREEN', 'YELLOW', 'RED')),
  observed_at TIMESTAMPTZ NOT NULL,
  reasons JSONB NOT NULL,  -- Array of reason objects
  signals JSONB NOT NULL,  -- Raw signal data
  related_deploy_event_id UUID REFERENCES deploy_events(id),
  staleness_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Testing

### Run Tests

```bash
# Rules engine tests (52 tests)
npm test -- __tests__/lib/deploy-status-rules-engine.test.ts

# API contract tests (12 tests)
npm test -- __tests__/api/deploy-status.test.ts

# All tests
npm test
```

### Test Coverage

- **Rules Engine**: 52 tests covering all combinatorial cases
- **API Contracts**: 12 tests for request validation, caching, error handling
- **Total**: 64 new tests, all passing ✅

### Key Test Cases

1. All status combinations (GREEN, YELLOW, RED)
2. Priority and cascading rules
3. Edge cases (boundaries, empty data)
4. API validation and error handling
5. Caching behavior
6. Database enabled/disabled modes

## Configuration

### Environment Variables

- `DATABASE_ENABLED`: Enable/disable database persistence (default: false)
- `NEXT_PUBLIC_APP_URL`: Base URL for health checks (default: http://localhost:3000)

### Customization

Adjust thresholds in `rules-engine.ts`:

```typescript
// Lookback window for deploy events (default: 30 minutes)
hasRecentDeployFailure(signals, lookbackMinutes: 30)

// Staleness threshold (default: 5 minutes)
isDataStale(signals, currentTime, thresholdSeconds: 300)

// High latency threshold (default: 2 seconds)
hasHighLatency(signals, thresholdMs: 2000)
```

## Integration with Self-Propelling Mode

The status monitor provides a recommendation for AFU-9's Self-Propelling Mode:

- **RED**: System should HOLD and not proceed with automated deployments
- **YELLOW**: System should proceed with CAUTION and increased monitoring
- **GREEN**: System is safe to ADVANCE autonomously

This recommendation appears on the `/deploy/status` detail page.

## Future Enhancements

1. **AWS Integration**
   - ECS task health metrics
   - ALB target group health
   - CloudWatch alarms

2. **Trending & Analytics**
   - Status history charts
   - MTTR (Mean Time To Recovery) metrics
   - Uptime percentage

3. **Alerting**
   - Slack/email notifications on RED status
   - PagerDuty integration for critical failures

4. **Advanced Rules**
   - Custom rule definitions via configuration
   - Per-service health checks
   - Dependency health aggregation

## Troubleshooting

### Status shows RED with SIGNALS_MISSING

- Verify `/api/health` and `/api/ready` endpoints are accessible
- Check network connectivity
- Review browser console for fetch errors

### Status shows STALE_DATA

- Data is older than 5 minutes
- Check if signal collection is running
- Verify auto-refresh is enabled in UI

### Status badge not updating

- Verify refreshInterval is set (default: 60000ms)
- Check browser console for errors
- Try force refresh on detail page

## Implementation Notes

### Design Principles

1. **Deterministic**: Same inputs always produce same outputs
2. **Testable**: Pure functions with comprehensive test coverage
3. **Fail-safe**: Errors default to RED (safe mode)
4. **Evidence-based**: Every decision includes supporting data
5. **No trial & error**: Clear, documented rules

### Why These Rules?

- **Health before Ready**: If the process isn't alive, readiness doesn't matter
- **Recent failures matter**: 30-minute window catches ongoing issues
- **Staleness indicates problems**: Old data suggests monitoring breakdown
- **High latency is a warning sign**: May indicate resource exhaustion

## Contributing

When adding new status rules:

1. Add the rule to `rules-engine.ts`
2. Add reason code to `REASON_CODES`
3. Write comprehensive tests in `deploy-status-rules-engine.test.ts`
4. Update this README with the new rule
5. Ensure tests pass: `npm test`

## References

- Issue: E65.1 - Deploy Status Monitor
- Migration: `database/migrations/027_deploy_status_snapshots.sql`
- API: `/api/deploy/status`
- UI: `/deploy/status`
- Tests: `__tests__/lib/deploy-status-rules-engine.test.ts`
