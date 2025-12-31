# E72.4 E2E Smoke Test Documentation

## Overview

This document provides complete end-to-end smoke testing instructions for the Timeline Chain Query API (E72.4).

## Quick Start

### Local Development

```bash
# 1. Start the development server
cd control-center
npm run dev

# 2. In a new terminal, create test data
DATABASE_URL="postgresql://localhost:5432/afu9" ./scripts/backfill-timeline-test-data.sh

# 3. Run the smoke test
./scripts/smoke-test-timeline-chain.sh http://localhost:3000
```

### Staging Environment

```bash
# 1. Set up test data (requires DATABASE_URL for staging)
DATABASE_URL="postgresql://staging-host:5432/afu9" ./scripts/backfill-timeline-test-data.sh

# 2. Run smoke test against staging
./scripts/smoke-test-timeline-chain.sh http://afu9-alb-staging.elb.amazonaws.com
```

## Test Components

### 1. Backfill Script (`backfill-timeline-test-data.sh`)

**Purpose:** Creates minimal test data for timeline chain testing.

**Test Data Created:**
- 1 ISSUE node (test-issue-123)
- 1 PR node (test-pr-456)
- 1 RUN node (run:test-run-789)
- 1 DEPLOY node (deploy:test-deploy-abc)
- 1 VERDICT node (verdict:test-verdict-xyz)
- 1 ARTIFACT node (artifact:test-log-001)
- 5 edges connecting the chain

**Chain Structure:**
```
ISSUE (test-issue-123)
  └─> PR (test-pr-456)
       └─> RUN (run:test-run-789)
            ├─> DEPLOY (deploy:test-deploy-abc)
            │    └─> VERDICT (verdict:test-verdict-xyz)
            └─> ARTIFACT (artifact:test-log-001)
```

**Usage:**
```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname" \
  ./scripts/backfill-timeline-test-data.sh
```

**Output:**
```
=== E72.4 Timeline Chain - Backfill Test Data ===

Database: postgresql://localhost:5432/afu9

Executing SQL to create test data...

 category     | count
--------------+-------
 Nodes created|     6
 Edges created|     5

 node_type |      source_id        |           title                | created_at
-----------+-----------------------+--------------------------------+------------
 ISSUE     | test-issue-123        | E72.4 Smoke Test Issue         | ...
 PR        | test-pr-456           | E72.4 Test Pull Request        | ...
 RUN       | run:test-run-789      | E72.4 Test Run                 | ...
 ARTIFACT  | artifact:test-log-001 | test-run.log                   | ...
 DEPLOY    | deploy:test-deploy-abc| E72.4 Test Deploy to Staging   | ...
 VERDICT   | verdict:test-verdict-xyz | E72.4 Test Verdict: PASS    | ...

✓ Test data created successfully!
```

### 2. Smoke Test Script (`smoke-test-timeline-chain.sh`)

**Purpose:** Validates the timeline chain API with comprehensive checks.

**Test Coverage:**

1. **Health Checks**
   - API health endpoint
   - Timeline chain endpoint accessibility

2. **Response Structure**
   - issueId field present
   - sourceSystem field present
   - nodes array present
   - edges array present
   - metadata object with counts and timestamp

3. **Deterministic Ordering**
   - Nodes ordered by: node_type → created_at → id
   - First node is ISSUE (for typical chains)
   - Stable ordering across multiple queries

4. **Evidence Fields**
   - Node ID (UUID)
   - source_system, source_type, source_id
   - node_type
   - created_at and updated_at timestamps

5. **Ordering Stability**
   - Re-queries API and verifies identical ordering

**Usage:**
```bash
# Local
./scripts/smoke-test-timeline-chain.sh http://localhost:3000

# Staging
./scripts/smoke-test-timeline-chain.sh http://afu9-alb-staging.elb.amazonaws.com

# Custom issue ID
TEST_ISSUE_ID=my-issue-456 ./scripts/smoke-test-timeline-chain.sh http://localhost:3000
```

**Expected Output:**
```
=== E72.4 Timeline Chain API - E2E Smoke Test ===
Base URL: http://localhost:3000
Test Issue ID: test-issue-123
Source System: afu9

=== Step 1: Health Check ===

Testing API Health endpoint... PASSED
Testing Timeline chain endpoint exists... PASSED

=== Step 2: Backfill Documentation ===
[Documentation displayed]

=== Step 3: Query Timeline Chain ===

Querying: http://localhost:3000/api/timeline/chain?issueId=test-issue-123&sourceSystem=afu9

Response:
{
  "issueId": "test-issue-123",
  "sourceSystem": "afu9",
  "nodes": [...],
  "edges": [...],
  "metadata": {
    "nodeCount": 6,
    "edgeCount": 5,
    "timestamp": "2025-12-31T10:00:00.000Z"
  }
}

=== Step 4: Verify Response Structure ===

Testing Response has issueId field... PASSED
Testing Response has sourceSystem field... PASSED
Testing Response has nodes array... PASSED
Testing Response has edges array... PASSED
Testing Response has metadata object... PASSED
Testing Metadata has nodeCount... PASSED
Testing Metadata has edgeCount... PASSED
Testing Metadata has timestamp... PASSED

=== Step 5: Verify Deterministic Ordering ===

Node type sequence:
     1  ISSUE
     2  PR
     3  RUN
     4  ARTIFACT
     5  DEPLOY
     6  VERDICT

✓ First node is ISSUE (correct deterministic ordering)

=== Step 6: Verify Evidence Fields ===

Testing Node has id (UUID)... PASSED
Testing Node has source_system... PASSED
Testing Node has source_type... PASSED
Testing Node has source_id... PASSED
Testing Node has node_type... PASSED
Testing Node has created_at timestamp... PASSED
Testing Node has updated_at timestamp... PASSED

First node details:
{
  "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
  "source_system": "afu9",
  "source_type": "issue",
  "source_id": "test-issue-123",
  "node_type": "ISSUE",
  "created_at": "2025-12-26T10:00:00.000Z"
}

=== Step 7: Verify Stable Ordering (Re-query) ===

✓ Node ordering is stable across queries

=== Test Summary ===
Passed: 17
Failed: 0
Total:  17

✓ All E72.4 smoke tests passed!
✓ Timeline chain API is operational
```

## CI/CD Integration

### GitHub Actions Workflow

Add to `.github/workflows/`:

```yaml
name: E72.4 Timeline Chain Smoke Test

on:
  push:
    branches: [main, staging]
  pull_request:
    paths:
      - 'control-center/app/api/timeline/**'
      - 'control-center/src/lib/db/timeline.ts'

jobs:
  smoke-test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: afu9_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: |
          cd control-center
          npm install
      
      - name: Run migrations
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
        run: |
          npm run db:migrate
      
      - name: Backfill test data
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
        run: |
          chmod +x scripts/backfill-timeline-test-data.sh
          ./scripts/backfill-timeline-test-data.sh
      
      - name: Start dev server
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
        run: |
          cd control-center
          npm run dev &
          sleep 10
      
      - name: Run smoke test
        run: |
          chmod +x scripts/smoke-test-timeline-chain.sh
          ./scripts/smoke-test-timeline-chain.sh http://localhost:3000
```

## Manual Testing Steps

### Step-by-Step Verification

1. **Verify Database Schema**
   ```sql
   -- Check tables exist
   SELECT tablename FROM pg_tables 
   WHERE tablename IN ('timeline_nodes', 'timeline_edges', 'timeline_events', 'timeline_sources');
   ```

2. **Create Test Data**
   ```bash
   DATABASE_URL="postgresql://localhost:5432/afu9" ./scripts/backfill-timeline-test-data.sh
   ```

3. **Query API Manually**
   ```bash
   curl 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123&sourceSystem=afu9' | jq
   ```

4. **Verify Response**
   - Check nodeCount = 6
   - Check edgeCount = 5
   - Verify first node is ISSUE type
   - Verify all nodes have UUIDs and timestamps

5. **Test Ordering Stability**
   ```bash
   # Query 1
   curl -s 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123' | jq '.nodes[].id' > /tmp/order1.txt
   
   # Query 2 (should be identical)
   curl -s 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123' | jq '.nodes[].id' > /tmp/order2.txt
   
   # Compare
   diff /tmp/order1.txt /tmp/order2.txt
   # Should output nothing (identical)
   ```

## Troubleshooting

### No nodes returned

**Cause:** Test data not created or using wrong issueId/sourceSystem

**Solution:**
```bash
# Re-run backfill
DATABASE_URL="postgresql://localhost:5432/afu9" ./scripts/backfill-timeline-test-data.sh

# Verify data exists
psql "$DATABASE_URL" -c "SELECT source_id, node_type FROM timeline_nodes WHERE source_id = 'test-issue-123';"
```

### Connection refused

**Cause:** Dev server not running or wrong BASE_URL

**Solution:**
```bash
# Start dev server
cd control-center
npm run dev

# Verify server is running
curl http://localhost:3000/api/health
```

### Database connection error

**Cause:** DATABASE_URL not set or incorrect

**Solution:**
```bash
# Check connection
psql "$DATABASE_URL" -c "SELECT version();"

# Common format
export DATABASE_URL="postgresql://user:password@host:5432/database"
```

## Expected Results Summary

✅ **All tests should pass with these numbers:**
- Health checks: 2/2
- Response structure: 8/8
- Evidence fields: 7/7
- Deterministic ordering: Verified
- Stable ordering: Verified

✅ **Total:** 17+ passing tests

✅ **Response structure:**
```json
{
  "issueId": "test-issue-123",
  "sourceSystem": "afu9",
  "nodes": [6 nodes in deterministic order],
  "edges": [5 edges],
  "metadata": {
    "nodeCount": 6,
    "edgeCount": 5,
    "timestamp": "<ISO-8601>"
  }
}
```

## Next Steps

After successful smoke test:

1. **Integrate into CI:** Add GitHub Actions workflow
2. **Staging validation:** Run against staging environment
3. **Production verification:** Create prod-safe test issue
4. **Monitoring:** Add alerts for API response time/errors
5. **Documentation:** Update user-facing docs with examples
