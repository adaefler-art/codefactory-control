# Deploy Status Monitor (E65.1)

The Deploy Status Monitor provides a deterministic, testable status signal that determines deployment readiness **exclusively** from E65.2 **post-deploy verification** playbook runs (playbook: `post-deploy-verify`).

## Overview

The monitor provides a **GREEN/YELLOW/RED** traffic light status that indicates whether it's safe to deploy:

- **GREEN (GO)**: Latest post-deploy verification run succeeded
- **YELLOW (CAUTION)**: Verification is running/pending or missing
- **RED (HOLD)**: Latest post-deploy verification run failed/timeout/cancelled

## Architecture

### Components

1. **Database Layer** (`database/migrations/027_deploy_status_snapshots.sql`)
   - Stores historical status snapshots
   - Enables timeline views and trending analysis
   - Schema includes: status, reasons, signals, timestamps

2. **Verification Run Resolver** (`control-center/src/lib/deploy-status/verification-resolver.ts`)
  - Queries persisted playbook runs from the database
  - Selects the latest `post-deploy-verify` run (optionally correlation-aware)
  - Maps run status → traffic light deterministically

3. **API Endpoint** (`control-center/app/api/deploy/status/route.ts`)
   - GET `/api/deploy/status?env={env}`
   - 30-second cache with force refresh option
  - Requires database (`DATABASE_ENABLED=true`) because verification runs are persisted in DB

4. **UI Components**
   - `DeployStatusBadge`: Real-time status indicator in navigation
  - `/deploy/status` page: Detailed status view with evidence (derived from the verification run and its steps)

## Status Determination Rules

E65.1 v2 derives the traffic light **only** from the latest E65.2 `post-deploy-verify` run:

- Latest run `success` → **GREEN**
- Latest run `failed` / `timeout` / `cancelled` → **RED**
- Latest run `pending` / `running` → **YELLOW**
- No run found → **YELLOW**

## API Usage

### Query Current Status

```powershell
# Get status for production environment
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/deploy/status?env=prod"

# Force fresh check (bypass cache)
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/deploy/status?env=prod&force=true"
```

### Authentication

`/api/deploy/status` requires authentication.

Recommended:

- In the browser, open DevTools → Network, trigger the request, then use **Copy → Copy as PowerShell** to get an authenticated `Invoke-WebRequest` / `Invoke-RestMethod` call (with cookies/headers).
- If you need to call it manually, include the relevant session cookie header:

```powershell
$headers = @{ Cookie = "your_cookie_name=..." }
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/deploy/status?env=prod" -Headers $headers
```

### Response Format

```json
{
  "env": "prod",
  "status": "GREEN",
  "observedAt": "2024-01-01T12:00:00Z",
  "stalenessSeconds": 0,
  "reasons": [
    {
      "code": "VERIFICATION_SUCCESS",
      "severity": "info",
      "message": "Latest post-deploy verification run succeeded",
      "evidence": {
        "runId": "uuid-here",
        "runStatus": "success"
      }
    }
  ],
  "signals": {
    "checkedAt": "2024-01-01T12:00:00Z",
    "correlationId": "optional-correlation-id",
    "verificationRun": {
      "runId": "uuid-here",
      "playbookId": "post-deploy-verify",
      "playbookVersion": "v1",
      "env": "prod",
      "status": "success",
      "createdAt": "2024-01-01T12:00:00Z",
      "startedAt": "2024-01-01T12:00:01Z",
      "completedAt": "2024-01-01T12:00:10Z"
    }
  },
  "snapshotId": "uuid-here"
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
- Last verification run (E65.2) with link to run details
- Raw signals viewer

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

```powershell
# Resolver unit tests
npm --prefix control-center test -- __tests__/lib/deploy-status-verification-resolver.test.ts

# API contract tests
npm --prefix control-center test -- __tests__/api/deploy-status.test.ts

# Proof gates
npm --prefix control-center test -- __tests__/api/deploy-status-proof-gates.test.ts
```

### Test Coverage

- Resolver + API contract tests + proof gates cover: mapping, caching, correlation-aware caching, and idempotent persistence.

### Key Test Cases

1. All status combinations (GREEN, YELLOW, RED)
2. CorrelationId handling (UUID treated as runId)
3. Edge cases (no run, unknown status)
4. API validation and error handling
5. Caching behavior
6. Database required (fails closed when disabled)

## Configuration

### Environment Variables

- `DATABASE_ENABLED`: **REQUIRED**. Must be `true` for E65.1 v2 (verification runs are read from DB)
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`: PostgreSQL connection settings
- `DATABASE_SSL` / `PGSSLMODE=require`: enable SSL to Postgres where required

See [Environment Configuration Guide](./DEPLOY_STATUS_ENVIRONMENT_CONFIG.md) for detailed setup instructions.

### Customization

E65.1 v2 intentionally does not implement a local “signals collector” or threshold tuning for health/ready/latency. Any detailed evidence should come from the persisted E65.2 verification run steps.

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

### API returns 503

- Ensure `DATABASE_ENABLED=true`
- Ensure DB connectivity (see environment config guide)

### Status is YELLOW with no verification run

- Trigger / observe a `post-deploy-verify` run for the environment
- Use the "View run details" link on `/deploy/status` to validate the latest run

## Implementation Notes

### Design Principles

1. **Deterministic**: Same inputs always produce same outputs
2. **Testable**: Pure functions with comprehensive test coverage
3. **Fail-safe**: When DB is unavailable, the API returns 503 (no false “GO”)
4. **Evidence-based**: Every decision includes supporting data
5. **No trial & error**: Clear, documented rules

### Why These Rules?

- The deploy traffic light is a pure function of the latest post-deploy verification outcome.
- Any deeper evidence comes from the verification run steps, not from E65.1 actively probing endpoints.

## Contributing

When adding new status rules:

1. Update `verification-resolver.ts` mapping logic (run status → traffic light)
2. Add/adjust reason codes
3. Write comprehensive tests in `deploy-status-verification-resolver.test.ts`
4. Update this README with the change
5. Ensure tests pass: `npm -w control-center test`

## References

- Issue: E65.1 - Deploy Status Monitor
- Migration: `database/migrations/027_deploy_status_snapshots.sql`
- API: `/api/deploy/status`
- UI: `/deploy/status`
- Tests: `__tests__/lib/deploy-status-verification-resolver.test.ts`
