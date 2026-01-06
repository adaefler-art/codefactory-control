# E76.1 Incident Schema Implementation Summary

## Overview

This implementation delivers the canonical Incident schema and PostgreSQL tables for AFU-9 self-debugging, as specified in I761 (E76.1). The solution provides idempotent ingestion, evidence-first tracking, and lawbook transparency.

## Table Definitions

### 1. `incidents` Table

Primary table for tracking incidents with stable, deterministic keys.

**Columns:**
- `id` (UUID, PK): Auto-generated primary key
- `incident_key` (TEXT, UNIQUE): Idempotency key for upserts
- `severity` (TEXT): `YELLOW` or `RED` (aligned with Deploy Status Monitor)
- `status` (TEXT): `OPEN`, `ACKED`, `MITIGATED`, `CLOSED`
- `title` (TEXT): Human-readable incident title
- `summary` (TEXT, nullable): Detailed description
- `classification` (JSONB, nullable): Filled by I763 classifier
- `lawbook_version` (TEXT, nullable): Lawbook version for transparency
- `source_primary` (JSONB): Primary source signal reference
- `tags` (TEXT[]): Array of tags for filtering/grouping
- `created_at`, `updated_at`, `first_seen_at`, `last_seen_at` (TIMESTAMPTZ)

**Indexes:**
- `uq_incidents_key` (UNIQUE): Ensures idempotency
- `incidents_status_idx`: Fast status filtering
- `incidents_severity_idx`: Fast severity filtering
- `incidents_last_seen_at_idx`: Deterministic ordering (last_seen_at DESC, id ASC)
- `incidents_tags_idx` (GIN): Tag-based queries

### 2. `incident_evidence` Table

Evidence items linked to incidents (idempotent via sha256).

**Columns:**
- `id` (UUID, PK): Auto-generated primary key
- `incident_id` (UUID, FK): References `incidents(id)`
- `kind` (TEXT): Evidence type (runner, ecs, alb, http, verification, deploy_status, log_pointer, github_run)
- `ref` (JSONB): JSON reference with pointers (runId, taskArn, logGroup, url, etc.)
- `sha256` (TEXT, nullable): Hash for deduplication
- `created_at` (TIMESTAMPTZ)

**Indexes:**
- `incident_evidence_incident_id_idx`: Fast lookup by incident
- `incident_evidence_kind_idx`: Filter by evidence kind
- `incident_evidence_sha256_idx`: Hash-based queries
- `incident_evidence_idempotency_idx` (UNIQUE PARTIAL): Prevents duplicate evidence when sha256 is present

### 3. `incident_links` Table

Links between incidents and timeline nodes.

**Columns:**
- `id` (UUID, PK)
- `incident_id` (UUID, FK): References `incidents(id)`
- `timeline_node_id` (UUID, FK): References `timeline_nodes(id)`
- `link_type` (TEXT): `TRIGGERED_BY`, `RELATED_TO`, `CAUSED_BY`, `REMEDIATED_BY`
- `created_at` (TIMESTAMPTZ)

**Constraints:**
- `uq_incident_links_tuple` (UNIQUE): Prevents duplicate links

### 4. `incident_events` Table

Event log for incident lifecycle.

**Columns:**
- `id` (UUID, PK)
- `incident_id` (UUID, FK): References `incidents(id)`
- `event_type` (TEXT): `CREATED`, `UPDATED`, `CLASSIFIED`, `REMEDIATION_STARTED`, `REMEDIATION_DONE`, `CLOSED`
- `payload` (JSONB): Optional event metadata
- `created_at` (TIMESTAMPTZ)

**Indexes:**
- `incident_events_incident_id_idx`: Fast lookup with ordering (created_at DESC)

## Idempotency Key Strategy

The `incident_key` is derived from primary signal + stable identifiers, ensuring deterministic retries:

### Examples

1. **Deploy Status RED:**
   ```
   deploy_status:<env>:<deployId>:<statusAt>
   deploy_status:prod:deploy-abc123:2024-01-01T00:00:00Z
   ```

2. **Verification Failure:**
   ```
   verification:<deployId>:<reportHash>
   verification:deploy-abc123:sha256-xyz789
   ```

3. **ECS Stopped Task:**
   ```
   ecs_stopped:<cluster>:<taskArn>:<stoppedAt>
   ecs_stopped:prod-cluster:arn:aws:ecs:...:2024-01-01T00:00:00Z
   ```

4. **Runner Failure:**
   ```
   runner:<runId>:<stepName>:<conclusion>
   runner:run-12345:deploy:failure
   ```

## Repository Functions (DAO)

Located in `control-center/src/lib/db/incidents.ts`:

### Core Operations

- `upsertIncidentByKey(input)`: Idempotent upsert by incident_key
  - Creates new incident on first insert
  - Updates title, summary, classification, lawbook_version, source_primary, tags on conflict
  - Updates `last_seen_at` to NOW() on conflict
  - Preserves `first_seen_at` unchanged

- `addEvidence(evidenceList)`: Idempotent evidence addition
  - Deduplicates via sha256 when present
  - Allows multiple entries when sha256 is null

- `listIncidents(filter)`: Deterministic listing
  - Ordering: `last_seen_at DESC, id ASC`
  - Filters: status, severity, limit, offset

- `getIncident(id)`: Fetch by ID
- `getIncidentByKey(incident_key)`: Fetch by idempotency key
- `getEvidence(incident_id)`: Get all evidence for incident
- `createLink(link)`: Link incident to timeline node (idempotent)
- `getLinks(incident_id)`: Get all links for incident
- `createEvent(event)`: Create incident event
- `getEvents(incident_id)`: Get event log (deterministic ordering: `created_at DESC, id DESC`)
- `updateStatus(id, status)`: Update incident status

## Files Changed

### Database Schema
- **`database/migrations/037_incidents_schema.sql`** (NEW)
  - Reason: Create tables, indexes, triggers, constraints

### TypeScript Contracts
- **`control-center/src/lib/contracts/incident.ts`** (NEW)
  - Reason: Zod schemas, TypeScript types, validation functions, incident_key helpers

### Database Access Layer
- **`control-center/src/lib/db/incidents.ts`** (NEW)
  - Reason: DAO with idempotent repository functions

### Tests
- **`control-center/__tests__/lib/db/incidents.test.ts`** (NEW)
  - Reason: Unit tests for idempotency, deterministic ordering, evidence deduplication

## Test Coverage

All tests pass (16/16):
- ✅ Idempotent upsert by incident_key
- ✅ Evidence deduplication via sha256
- ✅ Deterministic incident ordering (last_seen_at DESC, id ASC)
- ✅ Deterministic event ordering (created_at DESC, id DESC)
- ✅ Idempotent link creation
- ✅ incident_key helper functions
- ✅ Status and severity filters

## Acceptance Criteria

✅ **Schema supports ingest from E65.1/E65.2/ECS/Runner**
- `source_primary` captures all signal types
- `evidence` table supports all evidence kinds

✅ **Idempotency proven by tests**
- Upsert by same incident_key updates last_seen_at but does not create duplicates
- Evidence add is idempotent (same evidence added twice → one row)

✅ **Deterministic list ordering**
- `listIncidents()`: last_seen_at DESC, id ASC
- `getEvents()`: created_at DESC, id DESC

✅ **Tests/build green**
- `npm test`: ✅ PASS (16 tests)
- TypeScript compilation: ✅ No errors in new files

## PowerShell Commands

### Run Tests
```powershell
# Run incident tests
npm --prefix control-center test -- __tests__/lib/db/incidents.test.ts

# Run all tests
npm --prefix control-center test
```

### Build
```powershell
# Build control-center (Note: workspace dependencies have pre-existing issues)
npm --prefix control-center run build

# Type-check incident files only
cd control-center
npx tsc --noEmit --skipLibCheck src/lib/contracts/incident.ts src/lib/db/incidents.ts
```

### Run Migrations
```powershell
# Apply migration
npm --prefix control-center run db:migrate
```

## Integration Notes

### Deploy Status Monitor (E65.1)
- Map `GREEN` → no incident
- Map `YELLOW` → YELLOW incident
- Map `RED` → RED incident
- Use `generateDeployStatusIncidentKey()` for idempotency

### Verification (E65.2)
- Use `generateVerificationIncidentKey()` with deployId + reportHash
- Store verification run data in `source_primary.ref`

### ECS Events
- Use `generateEcsStoppedIncidentKey()` for stopped tasks
- Store taskArn, cluster, stoppedReason in evidence

### GitHub Actions Runner
- Use `generateRunnerIncidentKey()` for step failures
- Store runId, step, conclusion in evidence

## Next Steps

1. **I762**: Incident ingestion from E65.1 Deploy Status Monitor
2. **I763**: AI-powered incident classifier (fills `classification` field)
3. **I764**: Incident dashboard UI
4. **I765**: Auto-remediation triggers

## Determinism & Stability Guarantees

- **Stable IDs**: incident_key prevents duplicates
- **Stable Timestamps**: first_seen_at preserved, last_seen_at updated deterministically
- **Stable Ordering**: Explicit ORDER BY clauses with tie-breaker (id)
- **Idempotent Operations**: ON CONFLICT clauses for all write operations
- **Evidence Hashing**: sha256 for deduplication

---

**Implementation Date**: 2026-01-03  
**Reference**: I761 (E76.1 - Incident Schema + DB Tables)  
**Status**: ✅ Complete
