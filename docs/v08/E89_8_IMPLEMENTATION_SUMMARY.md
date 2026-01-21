# E89.8 Implementation Summary

## Issue: Capabilities Registry + "Tools" UI

**Goal**: Operator sees what INTENT can: Tools/Capabilities, Status, Health, versioned manifest. Basis for Guardrails + proactive behavior.

## Implementation Overview

This implementation provides a comprehensive capabilities registry system that:
1. Tracks all tools and capabilities available to the system
2. Probes their health status with audit trail
3. Provides versioned, deterministic manifest with SHA256 hash
4. Displays capabilities in a user-friendly UI with filters
5. Enforces staging-only guardrails for active probing

## Files Created/Modified

### Database Schema
- **database/migrations/072_capabilities_registry.sql**
  - `afu9_capability_probes` table: Append-only audit log of all capability health probes
  - `afu9_capability_manifest_view` view: Latest probe status per capability
  - Indexes for efficient querying by capability name, status, and time

### Backend Services
- **control-center/src/lib/capability-probe-service.ts**
  - `probeAllCapabilities()`: Probes all MCP endpoints, intent tools, and feature flags
  - `getLatestProbeResults()`: Retrieves latest probe status from database view
  - `storeProbeResults()`: Stores probe results in append-only table
  - Bounded error messages (max 500 chars)
  - Timeout handling (max 5 seconds per probe)

### API Endpoints
- **control-center/app/api/ops/capabilities/manifest/route.ts**
  - `GET /api/ops/capabilities/manifest`
  - Returns versioned capability manifest with probe status
  - Deterministic hash (SHA256 of sorted capabilities)
  - ETag support for caching (304 Not Modified)
  - Auth-protected (requires x-afu9-sub header)

- **control-center/app/api/ops/capabilities/probe/route.ts**
  - `POST /api/ops/capabilities/probe`
  - Triggers health probe of all capabilities
  - Staging-only (blocked in production with 403)
  - Stores results in append-only audit log
  - Returns probe summary

### UI Components
- **control-center/app/ops/capabilities/page.tsx**
  - Tools & Capabilities dashboard
  - Displays all capabilities with probe status
  - Filters: Status (enabled/disabled/ok/error/timeout/unreachable), Source, Search
  - Shows: Capability ID, Kind, Source, Status, Last Probe, Latency, Version
  - Copy manifest hash button
  - Probe Now button (triggers on-demand probe)
  - Real-time probe result display

### Configuration
- **control-center/src/lib/api-routes.ts**
  - Added `ops.capabilities.manifest` route
  - Added `ops.capabilities.probe` route

### Tests
- **control-center/__tests__/api/capabilities-registry.test.ts**
  - Tests for manifest endpoint (auth, response structure, probe data)
  - Tests for probe endpoint (auth, staging guard, probe execution)
  - Tests for manifest determinism (hash stability)
  - Tests for ETag caching (304 Not Modified)

## Key Features

### 1. Versioned Manifest
- Version format: ISO date (YYYY-MM-DD)
- Deterministic hash: SHA256 of sorted capabilities
- Stable ordering: Capabilities always sorted by ID
- Cacheable with ETag support

### 2. Capability Probe
- Probes all MCP servers, intent tools, feature flags
- Records: Status, latency, errors, timestamp
- Append-only audit trail (no updates/deletes)
- Bounded error messages (prevents log flooding)

### 3. Staging Guardrails
- Probe endpoint blocked in production (403 Forbidden)
- Allowed in staging and development only
- Environment detection via `DEPLOYMENT_ENV` or `NODE_ENV`

### 4. UI Features
- Real-time filtering (status, source, search)
- Probe status badges (OK/Error/Timeout/Unreachable)
- Latency display (milliseconds)
- Error messages (truncated for display)
- Copy manifest hash to clipboard
- Source counts (Intent Tools, MCP Tools, Feature Flags, Lawbook)

## API Contracts

### GET /api/ops/capabilities/manifest
**Response:**
```json
{
  "version": "2026-01-15",
  "hash": "sha256:abc123...",
  "capabilities": [
    {
      "id": "github.list_repos",
      "kind": "mcp_tool",
      "source": "mcp",
      "description": "List repositories",
      "enabled": true,
      "requiresApproval": false,
      "version": "1.0.0",
      "lastProbeAt": "2026-01-15T10:00:00Z",
      "lastProbeStatus": "ok",
      "lastProbeLatencyMs": 50,
      "lastProbeError": null
    }
  ],
  "sources": {
    "intentTools": 10,
    "mcpTools": 25,
    "featureFlags": 30,
    "lawbookConstraints": 3
  },
  "timestamp": "2026-01-15T10:00:00Z"
}
```

### POST /api/ops/capabilities/probe
**Response:**
```json
{
  "ok": true,
  "summary": {
    "totalProbed": 68,
    "successCount": 65,
    "errorCount": 2,
    "timeoutCount": 1,
    "unreachableCount": 0,
    "probedAt": "2026-01-15T10:00:00Z"
  },
  "environment": "staging",
  "triggeredBy": "user-123",
  "timestamp": "2026-01-15T10:00:00Z"
}
```

## Database Schema

### afu9_capability_probes
```sql
CREATE TABLE afu9_capability_probes (
  probe_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_name   TEXT NOT NULL,
  capability_kind   TEXT NOT NULL,  -- 'tool' | 'mcp_tool' | 'feature_flag' | 'constraint'
  capability_source TEXT NOT NULL,  -- 'intent_registry' | 'mcp' | 'flags' | 'lawbook'
  probed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  probe_status      TEXT NOT NULL,  -- 'ok' | 'error' | 'timeout' | 'unreachable'
  response_time_ms  INTEGER,
  error_message     TEXT,           -- Max 500 chars, truncated
  error_code        TEXT,
  enabled           BOOLEAN NOT NULL,
  requires_approval BOOLEAN DEFAULT FALSE,
  version           TEXT
);
```

### afu9_capability_manifest_view
```sql
CREATE VIEW afu9_capability_manifest_view AS
SELECT DISTINCT ON (capability_name)
  capability_name,
  capability_kind,
  capability_source,
  probed_at AS last_probe_at,
  probe_status AS last_probe_status,
  response_time_ms AS last_probe_latency_ms,
  error_message AS last_probe_error,
  error_code AS last_probe_error_code,
  enabled,
  requires_approval,
  version
FROM afu9_capability_probes
ORDER BY capability_name, probed_at DESC;
```

## Acceptance Criteria

✅ **Manifest deterministic (stable ordering) + hash**
- Capabilities always sorted by ID
- SHA256 hash of sorted JSON
- Same inputs → same hash

✅ **UI shows Tools + Status consistent with API**
- Fetches from `/api/ops/capabilities/manifest`
- Displays all capability fields
- Filters work correctly
- Probe status badges accurate

✅ **Probe writes audit record (append-only) and updates view**
- All probes written to `afu9_capability_probes` table
- No updates or deletes (INSERT only)
- View automatically shows latest status per capability

✅ **Staging guardrails enforced**
- Probe endpoint returns 403 in production
- Allowed in staging/development only
- Environment check via `DEPLOYMENT_ENV`

## Verification

Run the verification script:
```powershell
pwsh verify-e89-8.ps1
```

Or test manually:
```powershell
# Get manifest
Invoke-RestMethod -Uri "http://localhost:3000/api/ops/capabilities/manifest" `
  -Headers @{ "x-afu9-sub" = "test-user" }

# Trigger probe (staging/dev only)
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/ops/capabilities/probe" `
  -Headers @{ "x-afu9-sub" = "test-user" }

# Access UI
Start-Process "http://localhost:3000/ops/capabilities"
```

Or test on staging:
```powershell
$env:AFU9_SMOKE_KEY = "your-smoke-key"
Invoke-RestMethod -Uri "https://stage.afu-9.com/api/ops/capabilities/manifest" `
  -Headers @{ "x-afu9-smoke-key" = $env:AFU9_SMOKE_KEY }
```

## Security Considerations

1. **Authentication Required**: All endpoints require `x-afu9-sub` header (set by auth middleware)
2. **Staging-Only Probes**: Probe endpoint blocked in production to prevent load
3. **Bounded Errors**: Error messages truncated to 500 chars to prevent log flooding
4. **Read-Only Probes**: Health checks are read-only, no mutations to external systems
5. **Append-Only Audit**: Probe results never updated/deleted, maintaining audit trail
6. **No Secrets**: Manifest contains metadata only, no secrets or credentials

## Future Enhancements

1. **Scheduled Probes**: Cron job to probe capabilities periodically
2. **Alerting**: Notify when critical capabilities become unhealthy
3. **Historical Trends**: Chart probe latency and success rate over time
4. **Capability Groups**: Group related capabilities for easier management
5. **Approval Workflows**: UI for approving capability usage
6. **Rate Limiting**: Per-capability rate limits based on probe data

## Related Issues

- E86.2: Capability Manifest Endpoint (foundation for this work)
- E89.X: Guardrails implementation (uses capability data)
- Future: Proactive behavior based on capability health
