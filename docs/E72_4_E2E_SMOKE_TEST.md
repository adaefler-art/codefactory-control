# E72.4 E2E Smoke Test (Timeline Chain)

This document describes a minimal smoke test for the Timeline Chain API.

## Endpoint

- `GET /api/timeline/chain?issueId=<id>&sourceSystem=<github|afu9>`

## Optional Smoke-Auth (Stage-only via ENV)

The Control Center middleware supports a **staging-only** smoke-auth bypass allowlist for:

- `GET /api/timeline/chain`
- `GET /api/intent/sessions`
- `POST /api/intent/sessions`
- `GET /api/intent/sessions/<id>`
- `POST /api/intent/sessions/<id>/messages`

**Contract**

- Header: `X-AFU9-SMOKE-KEY`
- Env: `AFU9_SMOKE_KEY`
- If `AFU9_SMOKE_KEY` is not set, the bypass is disabled.

When used, the middleware sets response header:

- `x-afu9-smoke-auth-used: 1`

## PowerShell Example

```powershell
$BaseUrl = "https://stage.afu-9.com"
$IssueId = "123"
$SourceSystem = "afu9"

$Headers = @{
  "X-AFU9-SMOKE-KEY" = $env:AFU9_SMOKE_KEY
}

Invoke-RestMethod -Method GET `
  -Uri "$BaseUrl/api/timeline/chain?issueId=$IssueId&sourceSystem=$SourceSystem" `
  -Headers $Headers
```

---

# E2E Smoke Test (Intent Sessions)

This is a minimal HTTP-only E2E smoke test for **Intent Sessions Ownership + race-safe seq** (commit `1340724`).

## Endpoints used

- `POST /api/intent/sessions` (create)
- `GET /api/intent/sessions/<id>` (read by id, ownership-enforced)
- `POST /api/intent/sessions/<id>/messages` ("next" / seq increment via message append)

## PowerShell (Stage / any base URL)

```powershell
.\scripts\e2e-intent-sessions-smoke.ps1 `
  -BaseUrl "https://stage.afu-9.com" `
  -UserA "smoke-user-a" `
  -UserB "smoke-user-b" `
  -SmokeKey $env:AFU9_SMOKE_KEY
```

**Expected checks:**

- Create session as UserA -> 200/201 + session id
- UserA can GET the session -> 200
- UserB cannot GET the session -> 404 (anti-enumeration)
- 10 parallel POSTs to `/messages` -> seq values are unique and gap-free, and each request reserves a consecutive (user,assistant) seq pair
# E72.4 E2E Smoke Test Documentation

## Overview

This document provides complete end-to-end smoke testing instructions for the Timeline Chain Query API (E72.4).

**Cross-Platform Support:**
- ✅ **Windows**: PowerShell scripts (`.ps1`) - Primary/recommended
- ✅ **Linux/macOS**: Bash scripts (`.sh`) - Also supported
- ✅ **CI/CD**: Both PowerShell (Ubuntu) and Bash supported

## Quick Start

### Windows (PowerShell)

```powershell
# 1. Start the development server
cd control-center
npm run dev

# 2. In a new PowerShell terminal, create test data
$env:DATABASE_URL = "postgresql://localhost:5432/afu9"
$env:AFU9_SMOKE_ALLOW_BACKFILL = "1"
.\scripts\backfill-timeline-test-data.ps1

# 3. Run the smoke test
.\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"

# Or use npm scripts
npm run smoke:timeline:backfill
npm run smoke:timeline:chain
```

### Linux/macOS (Bash)

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

**PowerShell:**
```powershell
# Set up test data (requires DATABASE_URL for staging)
$env:DATABASE_URL = "postgresql://staging-host:5432/afu9"
$env:AFU9_SMOKE_ALLOW_BACKFILL = "1"
.\scripts\backfill-timeline-test-data.ps1

# Run smoke test against staging
.\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://afu9-alb-staging.elb.amazonaws.com"
```

**Bash:**
```bash
DATABASE_URL="postgresql://staging-host:5432/afu9" ./scripts/backfill-timeline-test-data.sh
./scripts/smoke-test-timeline-chain.sh http://afu9-alb-staging.elb.amazonaws.com
```

## Test Components

### 1. Backfill Script

**PowerShell**: `scripts/backfill-timeline-test-data.ps1`  
**Bash**: `scripts/backfill-timeline-test-data.sh`

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

**Usage (PowerShell):**
```powershell
$env:DATABASE_URL = "postgresql://user:pass@host:5432/dbname"
$env:AFU9_SMOKE_ALLOW_BACKFILL = "1"
.\scripts\backfill-timeline-test-data.ps1

# Or via npm
npm run smoke:timeline:backfill
```

**Usage (Bash):**
```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname" \
  ./scripts/backfill-timeline-test-data.sh
```

**Safety Guardrail (PowerShell only):**
The PowerShell version requires `$env:AFU9_SMOKE_ALLOW_BACKFILL = "1"` to prevent accidental data modification. This is an additional safety measure for Windows environments.

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

### 2. Smoke Test Script

**PowerShell**: `scripts/smoke-test-timeline-chain.ps1`  
**Bash**: `scripts/smoke-test-timeline-chain.sh`

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

**Usage (PowerShell):**
```powershell
# Local
.\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"

# Staging
.\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://afu9-alb-staging.elb.amazonaws.com"

# Custom issue ID
$env:TEST_ISSUE_ID = "my-issue-456"
.\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"

# Or via npm
npm run smoke:timeline:chain
```

**Usage (Bash):**
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

### GitHub Actions Workflow (Bash - Ubuntu)

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
  smoke-test-bash:
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
      
      - name: Backfill test data (Bash)
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
      
      - name: Run smoke test (Bash)
        run: |
          chmod +x scripts/smoke-test-timeline-chain.sh
          ./scripts/smoke-test-timeline-chain.sh http://localhost:3000
```

### GitHub Actions Workflow (PowerShell - Ubuntu)

PowerShell Core is available on Ubuntu runners:

```yaml
name: E72.4 Timeline Chain Smoke Test (PowerShell)

on:
  push:
    branches: [main, staging]

jobs:
  smoke-test-pwsh:
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
        run: npm run db:migrate
      
      - name: Backfill test data (PowerShell)
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
          AFU9_SMOKE_ALLOW_BACKFILL: "1"
        run: |
          pwsh -File scripts/backfill-timeline-test-data.ps1
      
      - name: Start dev server
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
        run: |
          cd control-center
          npm run dev &
          sleep 10
      
      - name: Run smoke test (PowerShell)
        run: |
          pwsh -File scripts/smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"
```

### GitHub Actions Workflow (Windows)

For Windows runners:

```yaml
name: E72.4 Timeline Chain Smoke Test (Windows)

on:
  push:
    branches: [main, staging]

jobs:
  smoke-test-windows:
    runs-on: windows-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Setup PostgreSQL
        run: |
          # Use Chocolatey or Docker to set up PostgreSQL on Windows
          # Or use external database service
      
      - name: Install dependencies
        run: |
          cd control-center
          npm install
      
      - name: Run migrations
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
        run: npm run db:migrate
      
      - name: Backfill test data
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
          AFU9_SMOKE_ALLOW_BACKFILL: "1"
        run: |
          .\scripts\backfill-timeline-test-data.ps1
      
      - name: Start dev server
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/afu9_test
        run: |
          cd control-center
          Start-Process npm -ArgumentList "run", "dev" -NoNewWindow
          Start-Sleep -Seconds 10
      
      - name: Run smoke test
        run: |
          .\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"
```

## NPM Scripts

The package.json includes convenient npm scripts:

**PowerShell scripts:**
```json
{
  "scripts": {
    "smoke:timeline:backfill": "pwsh -File ../scripts/backfill-timeline-test-data.ps1",
    "smoke:timeline:chain": "pwsh -File ../scripts/smoke-test-timeline-chain.ps1 -BaseUrl http://localhost:3000"
  }
}
```

**Usage:**
```powershell
# Windows/Linux with PowerShell
cd control-center
npm run smoke:timeline:backfill
npm run smoke:timeline:chain
```

Note: These scripts require PowerShell to be available on your system. On Windows it's built-in. On Linux/macOS, install PowerShell Core.
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
   
   **PowerShell:**
   ```powershell
   $env:DATABASE_URL = "postgresql://localhost:5432/afu9"
   $env:AFU9_SMOKE_ALLOW_BACKFILL = "1"
   .\scripts\backfill-timeline-test-data.ps1
   ```
   
   **Bash:**
   ```bash
   DATABASE_URL="postgresql://localhost:5432/afu9" ./scripts/backfill-timeline-test-data.sh
   ```

3. **Query API Manually**
   
   **PowerShell:**
   ```powershell
   Invoke-RestMethod 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123&sourceSystem=afu9' | ConvertTo-Json -Depth 10
   ```
   
   **Bash:**
   ```bash
   curl 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123&sourceSystem=afu9' | jq
   ```

4. **Verify Response**
   - Check nodeCount = 6
   - Check edgeCount = 5
   - Verify first node is ISSUE type
   - Verify all nodes have UUIDs and timestamps

5. **Test Ordering Stability**
   
   **PowerShell:**
   ```powershell
   # Query 1
   $response1 = Invoke-RestMethod 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123'
   $ids1 = $response1.nodes | ForEach-Object { $_.id }
   
   # Query 2
   $response2 = Invoke-RestMethod 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123'
   $ids2 = $response2.nodes | ForEach-Object { $_.id }
   
   # Compare
   if (($ids1 -join ',') -eq ($ids2 -join ',')) {
       Write-Host "✓ Ordering is stable" -ForegroundColor Green
   } else {
       Write-Host "✗ Ordering changed" -ForegroundColor Red
   }
   ```
   
   **Bash:**
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

**Solution (PowerShell):**
```powershell
# Re-run backfill
$env:DATABASE_URL = "postgresql://localhost:5432/afu9"
$env:AFU9_SMOKE_ALLOW_BACKFILL = "1"
.\scripts\backfill-timeline-test-data.ps1

# Verify data exists
psql $env:DATABASE_URL -c "SELECT source_id, node_type FROM timeline_nodes WHERE source_id = 'test-issue-123';"
```

**Solution (Bash):**
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

# Verify server is running (PowerShell)
Invoke-RestMethod http://localhost:3000/api/health

# Verify server is running (Bash)
curl http://localhost:3000/api/health
```

### Database connection error

**Cause:** DATABASE_URL not set or incorrect

**Solution (PowerShell):**
```powershell
# Check connection
psql $env:DATABASE_URL -c "SELECT version();"

# Set DATABASE_URL
$env:DATABASE_URL = "postgresql://user:password@host:5432/database"
```

**Solution (Bash):**
```bash
# Check connection
psql "$DATABASE_URL" -c "SELECT version();"

# Common format
export DATABASE_URL="postgresql://user:password@host:5432/database"
```

### PowerShell not found (Linux/macOS)

**Cause:** PowerShell Core not installed

**Solution:**
```bash
# Install PowerShell on Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y powershell

# Install PowerShell on macOS
brew install --cask powershell

# Verify installation
pwsh --version

# Alternative: Use bash scripts instead
./scripts/smoke-test-timeline-chain.sh http://localhost:3000
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
