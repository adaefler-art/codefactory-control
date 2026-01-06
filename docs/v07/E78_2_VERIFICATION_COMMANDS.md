# E78.2 Verification Commands

## Prerequisites

```powershell
# Ensure you're in the repository root
cd /path/to/codefactory-control

# Ensure database is running and DATABASE_URL is set
$env:DATABASE_URL = "postgresql://..."
```

## Database Migration

```powershell
# Apply migration 045
cd control-center
npm run db:migrate

# Verify migration applied
psql $env:DATABASE_URL -c "SELECT * FROM pg_tables WHERE tablename = 'outcome_records';"

# Check indexes
psql $env:DATABASE_URL -c "\d outcome_records"
```

Expected output should show:
- Table: `outcome_records` exists
- Unique index: `outcome_records_idempotency_idx` on `(outcome_key, postmortem_hash)`
- Indexes on `entity_type`, `entity_id`, `created_at`, etc.

## Run Tests

```powershell
# Run all tests
cd control-center
npm test

# Run postmortem generator tests specifically
npm test -- postmortem-generator.test.ts

# Run API tests specifically
npm test -- outcomes-api.test.ts

# Run with coverage
npm test -- --coverage --testPathPattern="postmortem|outcomes"
```

Expected: All tests pass (or skip if no DATABASE_URL set)

## Build Project

```powershell
# Build control-center
cd control-center
npm run build
```

Expected: Build completes successfully

## Verify Repository

```powershell
# From repository root
npm run repo:verify
```

Expected: All verification checks pass

## Manual API Testing

### 1. Start Development Server

```powershell
cd control-center
npm run dev
```

Server should start on http://localhost:3000

### 2. Create Test Incident (via psql or existing incident)

```sql
-- Insert test incident
INSERT INTO incidents (
  incident_key, severity, status, title, lawbook_version,
  source_primary, tags
) VALUES (
  'test:e78_2:manual:' || NOW()::text,
  'RED',
  'OPEN',
  'E78.2 Manual Test Incident',
  'v1.0.0-test',
  '{"kind": "deploy_status", "ref": {"env": "test", "deployId": "test-123"}}'::jsonb,
  ARRAY['test', 'e78_2']
) RETURNING id;
```

Copy the returned UUID.

### 3. Generate Postmortem

```powershell
# Replace <INCIDENT_ID> with UUID from step 2
# Replace <AUTH_TOKEN> with valid JWT token

curl -X POST http://localhost:3000/api/outcomes/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -d '{"incidentId": "<INCIDENT_ID>"}'
```

Expected response (201 Created):
```json
{
  "success": true,
  "outcomeRecord": {
    "id": "...",
    "entity_type": "incident",
    "entity_id": "<INCIDENT_ID>",
    "outcome_key": "...",
    "status": "RECORDED",
    "postmortem_json": { ... },
    "postmortem_hash": "...",
    ...
  },
  "postmortem": {
    "version": "0.7.0",
    "incident": { ... },
    "detection": { ... },
    "impact": { ... },
    "remediation": { ... },
    "verification": { ... },
    "outcome": { ... },
    "learnings": { ... },
    "references": { ... }
  },
  "isNew": true
}
```

### 4. Test Idempotency

```powershell
# Run the same curl command again
curl -X POST http://localhost:3000/api/outcomes/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -d '{"incidentId": "<INCIDENT_ID>"}'
```

Expected response (200 OK):
- Same `outcomeRecord.id` as before
- `isNew: false`

### 5. List Outcomes

```powershell
curl -X GET "http://localhost:3000/api/outcomes?incidentId=<INCIDENT_ID>" \
  -H "Authorization: Bearer <AUTH_TOKEN>"
```

Expected response (200 OK):
```json
{
  "success": true,
  "outcomes": [
    {
      "id": "...",
      "entity_type": "incident",
      "entity_id": "<INCIDENT_ID>",
      ...
    }
  ],
  "count": 1,
  "hasMore": false
}
```

### 6. Get Outcome by ID

```powershell
# Replace <OUTCOME_ID> with id from previous response
curl -X GET "http://localhost:3000/api/outcomes/<OUTCOME_ID>" \
  -H "Authorization: Bearer <AUTH_TOKEN>"
```

Expected response (200 OK):
```json
{
  "success": true,
  "outcome": {
    "id": "<OUTCOME_ID>",
    ...
  }
}
```

## Verify Deterministic Hashing

```powershell
# From control-center directory
node -e "
const { computePostmortemHash } = require('./src/lib/contracts/outcome');

const postmortem1 = {
  version: '0.7.0',
  incident: { id: 'test-1', key: 'key-1', severity: 'RED' },
  // ... (complete postmortem object)
};

const postmortem2 = { ...postmortem1 }; // Same content

console.log('Hash 1:', computePostmortemHash(postmortem1));
console.log('Hash 2:', computePostmortemHash(postmortem2));
console.log('Equal:', computePostmortemHash(postmortem1) === computePostmortemHash(postmortem2));
"
```

Expected: Both hashes are identical

## Database Queries for Verification

```sql
-- Count outcome records
SELECT COUNT(*) FROM outcome_records;

-- View recent outcomes
SELECT 
  id, entity_type, entity_id, created_at, status,
  outcome_key, postmortem_hash,
  lawbook_version
FROM outcome_records
ORDER BY created_at DESC
LIMIT 10;

-- Check postmortem JSON structure
SELECT 
  id,
  postmortem_json->>'version' as version,
  postmortem_json->'incident'->>'severity' as severity,
  postmortem_json->'outcome'->>'resolved' as resolved,
  jsonb_array_length(postmortem_json->'learnings'->'facts') as facts_count,
  jsonb_array_length(postmortem_json->'learnings'->'unknowns') as unknowns_count
FROM outcome_records
LIMIT 5;

-- Verify idempotency constraint
SELECT outcome_key, postmortem_hash, COUNT(*) as count
FROM outcome_records
GROUP BY outcome_key, postmortem_hash
HAVING COUNT(*) > 1;
-- Should return 0 rows (no duplicates)

-- View metrics
SELECT 
  id,
  metrics_json->>'mttr_hours' as mttr_hours,
  metrics_json->>'auto_fixed' as auto_fixed,
  metrics_json->>'playbooks_attempted' as playbooks_attempted
FROM outcome_records
WHERE metrics_json IS NOT NULL
LIMIT 10;
```

## Check for Unknowns Population

```sql
-- Find outcomes with unknowns (evidence gaps)
SELECT 
  id,
  entity_id,
  jsonb_array_length(postmortem_json->'learnings'->'unknowns') as unknowns_count,
  postmortem_json->'learnings'->'unknowns' as unknowns
FROM outcome_records
WHERE jsonb_array_length(postmortem_json->'learnings'->'unknowns') > 0
LIMIT 5;
```

## Performance Checks

```sql
-- Check query performance on indexes
EXPLAIN ANALYZE
SELECT * FROM outcome_records
WHERE entity_type = 'incident'
  AND entity_id = '<SOME_UUID>'
ORDER BY created_at DESC;
-- Should use index: outcome_records_entity_type_id_idx

EXPLAIN ANALYZE
SELECT * FROM outcome_records
WHERE outcome_key = 'test:key'
  AND postmortem_hash = 'test:hash';
-- Should use unique index: outcome_records_idempotency_idx
```

## Cleanup Test Data

```sql
-- Remove test incidents and cascading outcome records
DELETE FROM incidents WHERE tags @> ARRAY['test', 'e78_2'];

-- Or remove specific outcome records
DELETE FROM outcome_records WHERE outcome_key LIKE 'test:%';
```

## Success Criteria

✅ Migration 045 applied successfully  
✅ All tests pass (or skip with no DATABASE_URL)  
✅ Build completes without errors  
✅ API endpoints return expected responses  
✅ Idempotency works (same inputs → same record)  
✅ Deterministic hashing works (same postmortem → same hash)  
✅ Unknowns populated when evidence missing  
✅ No duplicate records (unique constraint enforced)  
✅ Query performance acceptable (uses indexes)

## Troubleshooting

### Migration fails
```powershell
# Check current migration version
psql $env:DATABASE_URL -c "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5;"

# Rollback if needed (manual)
psql $env:DATABASE_URL -c "DROP TABLE IF EXISTS outcome_records CASCADE;"
```

### Tests fail with "Cannot find module"
```powershell
# Reinstall dependencies
cd control-center
rm -rf node_modules
npm install
```

### Build fails
```powershell
# Clear build cache
cd control-center
rm -rf .next
npm run build
```

### API returns 401 Unauthorized
- Ensure valid JWT token in Authorization header
- Check x-afu9-sub header is being set by proxy

### Postmortem hash changes unexpectedly
- Verify all inputs are truly identical
- Check generatedAt field (should be normalized for comparison)
- Verify stableStringify is sorting keys correctly
