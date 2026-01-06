# E7.0.3 MCP Catalog Sync/Verify — Evidence & Testing

## Issue Context
**E7.0.3 MCP Catalog Runtime Sync + Verify Gate (false-green verhindern)**

### Problem
Catalog/Ports/Endpoints können von ECS Realität abweichen → Health/Debug zeigt "grün" gegen falsches Target.

### Goal
Catalog ist runtime-konsistent oder wird strikt validiert; drift wird als Gate geblockt.

---

## Implementation Summary

### 1. Effective MCP Config Endpoint
**Endpoint:** `GET /api/mcp/config`

**Purpose:** Returns the effective MCP configuration showing which endpoints and ports are actually being used by Control Center at runtime. Enables detection of catalog drift vs. reality.

**Response Schema:**
```typescript
{
  ok: boolean;
  effectiveConfig: Array<{
    name: string;
    endpoint: string;
    enabled: boolean;
    catalogEndpoint?: string;
    catalogPort?: number;
    catalogContractVersion?: string;
    endpointMismatch: boolean | null;
    missingInCatalog: boolean;
  }>;
  catalogOnlyServers: Array<{
    name: string;
    catalogEndpoint: string;
    catalogPort: number;
    catalogContractVersion: string;
    missingInRuntime: true;
  }>;
  hasDrift: boolean;
  catalogVersion: string;
  timestamp: string;
}
```

### 2. MCP Catalog Verification Endpoint
**Endpoint:** `GET /api/mcp/verify`

**Purpose:** Validates that the MCP catalog matches runtime reality by checking endpoint reachability and contract versions against actual servers. Used as a CI/CD gate.

**Verification Checks:**
1. **Catalog Completeness:** All catalog servers exist in runtime config
2. **Runtime Completeness:** All runtime servers exist in catalog
3. **Endpoint Consistency:** Endpoints match between catalog and runtime
4. **Reachability:** Each server passes health check
5. **Contract Version:** Servers respond with expected contract version

**Response Schema:**
```typescript
{
  ok: boolean;
  status: 'pass' | 'fail' | 'error';
  results: Array<{
    server: string;
    ok: boolean;
    catalogEndpoint?: string;
    catalogPort?: number;
    catalogContractVersion?: string;
    runtimeEndpoint?: string;
    reachable?: boolean;
    actualContractVersion?: string;
    healthCheckPassed?: boolean;
    errors: string[];
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  errors?: string[];
  catalogVersion: string;
  timestamp: string;
}
```

### 3. CI/Deploy Gate Script
**Script:** `scripts/mcp-catalog-verify-gate.ts`

**Purpose:** Runs during CI/CD deployment workflow as a hard gate. Calls the `/api/mcp/verify` endpoint and blocks deployment if verification fails.

**Exit Codes:**
- `0`: Verification passed — deploy proceeds
- `1`: Verification failed (catalog mismatch or unreachable endpoints) — deploy blocked
- `2`: Script error (catalog not found, endpoint unreachable, etc.) — deploy blocked

**Environment Variables:**
- `MCP_VERIFY_ENDPOINT`: URL of verify endpoint (default: `http://localhost:3000/api/mcp/verify`)
- `MCP_VERIFY_TIMEOUT_MS`: Timeout in milliseconds (default: `30000`)
- `SKIP_MCP_VERIFY`: Set to `'true'` to skip (dev only, never in production)

### 4. Workflow Integration
**File:** `.github/workflows/deploy-ecs.yml`

The MCP catalog verification gate is integrated into the deploy workflow after the post-deploy image verification step:

```yaml
- name: MCP Catalog Verification Gate (E7.0.3)
  shell: bash
  env:
    MCP_VERIFY_ENDPOINT: https://${{ steps.target.outputs.ready_host }}/api/mcp/verify
    MCP_VERIFY_TIMEOUT_MS: '60000'
  run: |
    set -euo pipefail
    echo "🔍 Running MCP Catalog Verification Gate (E7.0.3)"
    echo "Verifying catalog matches runtime MCP server configuration..."
    echo "Endpoint: ${MCP_VERIFY_ENDPOINT}"
    echo ""
    
    npx ts-node scripts/mcp-catalog-verify-gate.ts
    
    echo ""
    echo "✅ MCP catalog verification passed"
```

---

## Test Evidence

### Test Suite: `__tests__/api/mcp-config-verify.test.ts`

**Status:** ✅ All 10 tests passing

#### Test Results Summary:
```
PASS __tests__/api/mcp-config-verify.test.ts
  GET /api/mcp/config
    ✓ should return effective MCP configuration (27 ms)
    ✓ should detect endpoint mismatch drift (3 ms)
    ✓ should detect servers missing from catalog (3 ms)
    ✓ should detect servers in catalog but missing from runtime (3 ms)
  GET /api/mcp/verify
    ✓ should pass verification when all servers match and are healthy (11 ms)
    ✓ should fail verification when server endpoints mismatch (3 ms)
    ✓ should fail verification when server is unreachable (3 ms)
    ✓ should fail verification when server is missing from runtime (2 ms)
    ✓ should fail verification when runtime has server not in catalog (2 ms)
    ✓ should handle catalog loading failure (6 ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

### Scenario 1: PASS - All Servers Match and Healthy

**Test Case:** Valid catalog with all servers reachable

**Mock Setup:**
```typescript
// Runtime config matches catalog exactly
mockMCPClient.getServers.mockReturnValue([
  {
    name: 'github',
    endpoint: 'http://localhost:3003',
    enabled: true,
  },
  {
    name: 'deploy',
    endpoint: 'http://localhost:3002',
    enabled: true,
  },
]);

// All servers pass health check
mockMCPClient.checkHealth.mockResolvedValue({
  status: 'ok',
  server: 'github',
  timestamp: new Date().toISOString(),
});

// Tools list works (contract valid)
mockMCPClient.listTools.mockResolvedValue([
  { name: 'getIssue', description: 'Get issue', inputSchema: {...} },
]);
```

**Expected Response:**
```json
{
  "ok": true,
  "status": "pass",
  "results": [
    {
      "server": "github",
      "ok": true,
      "catalogEndpoint": "http://localhost:3003",
      "catalogPort": 3003,
      "catalogContractVersion": "0.6.0",
      "runtimeEndpoint": "http://localhost:3003",
      "reachable": true,
      "healthCheckPassed": true,
      "errors": []
    },
    {
      "server": "deploy",
      "ok": true,
      "catalogEndpoint": "http://localhost:3002",
      "catalogPort": 3002,
      "catalogContractVersion": "0.6.0",
      "runtimeEndpoint": "http://localhost:3002",
      "reachable": true,
      "healthCheckPassed": true,
      "errors": []
    }
  ],
  "summary": {
    "total": 2,
    "passed": 2,
    "failed": 0
  },
  "catalogVersion": "0.6.0",
  "timestamp": "2026-01-02T13:00:00.000Z"
}
```

**HTTP Status:** `200 OK`

**Gate Action:** ✅ Deploy proceeds

---

### Scenario 2: FAIL - Endpoint Mismatch Drift

**Test Case:** Runtime endpoint differs from catalog

**Mock Setup:**
```typescript
// Runtime uses different endpoint than catalog
mockMCPClient.getServers.mockReturnValue([
  {
    name: 'github',
    endpoint: 'http://wrong-endpoint:9999', // ❌ Mismatch!
    enabled: true,
  },
]);

mockMCPClient.checkHealth.mockResolvedValue({
  status: 'ok',
  server: 'github',
  timestamp: new Date().toISOString(),
});
```

**Expected Response:**
```json
{
  "ok": false,
  "status": "fail",
  "results": [
    {
      "server": "github",
      "ok": false,
      "catalogEndpoint": "http://localhost:3003",
      "catalogPort": 3003,
      "catalogContractVersion": "0.6.0",
      "runtimeEndpoint": "http://wrong-endpoint:9999",
      "reachable": true,
      "healthCheckPassed": true,
      "errors": [
        "Endpoint mismatch: catalog='http://localhost:3003' runtime='http://wrong-endpoint:9999'"
      ]
    }
  ],
  "summary": {
    "total": 1,
    "passed": 0,
    "failed": 1
  },
  "errors": [
    "Endpoint mismatch for github"
  ],
  "catalogVersion": "0.6.0",
  "timestamp": "2026-01-02T13:00:00.000Z"
}
```

**HTTP Status:** `422 Unprocessable Entity`

**Gate Action:** ❌ Deploy blocked — catalog drift detected

**CLI Output:**
```
🔍 MCP Catalog Verification Gate
================================

✓ Catalog file found: docs/mcp/catalog.json
✓ Catalog version: 0.6.0
✓ Server count: 2

📡 Calling verification endpoint: https://afu-9.com/api/mcp/verify
   Timeout: 60000ms

Verification Results
===================

Status: FAIL
Total servers: 1
Passed: 0
Failed: 1

Server Details:
---------------
✗ github
  Catalog endpoint: http://localhost:3003
  Runtime endpoint: http://wrong-endpoint:9999
  Reachable: yes
  Contract version: 0.6.0
  Errors:
    - Endpoint mismatch: catalog='http://localhost:3003' runtime='http://wrong-endpoint:9999'

Summary Errors:
  - Endpoint mismatch for github

❌ MCP catalog verification FAILED
   One or more servers have configuration drift or are unreachable
   Deploy should be blocked until issues are resolved
```

**Exit Code:** `1` (verification failed)

---

### Scenario 3: FAIL - Server Unreachable

**Test Case:** Server exists in catalog but health check fails

**Mock Setup:**
```typescript
mockMCPClient.getServers.mockReturnValue([
  {
    name: 'github',
    endpoint: 'http://localhost:3003',
    enabled: true,
  },
]);

// Health check fails (server down/unreachable)
mockMCPClient.checkHealth.mockResolvedValue({
  status: 'error',
  server: 'github',
  timestamp: new Date().toISOString(),
  error: 'Connection refused',
});
```

**Expected Response:**
```json
{
  "ok": false,
  "status": "fail",
  "results": [
    {
      "server": "github",
      "ok": false,
      "catalogEndpoint": "http://localhost:3003",
      "catalogPort": 3003,
      "catalogContractVersion": "0.6.0",
      "runtimeEndpoint": "http://localhost:3003",
      "reachable": false,
      "healthCheckPassed": false,
      "errors": [
        "Health check failed: Connection refused"
      ]
    }
  ],
  "summary": {
    "total": 1,
    "passed": 0,
    "failed": 1
  },
  "errors": [
    "Unreachable: github"
  ],
  "catalogVersion": "0.6.0",
  "timestamp": "2026-01-02T13:00:00.000Z"
}
```

**HTTP Status:** `422 Unprocessable Entity`

**Gate Action:** ❌ Deploy blocked — MCP server unreachable

**CLI Output:**
```
Verification Results
===================

Status: FAIL
Total servers: 1
Passed: 0
Failed: 1

Server Details:
---------------
✗ github
  Catalog endpoint: http://localhost:3003
  Runtime endpoint: http://localhost:3003
  Reachable: no
  Contract version: 0.6.0
  Errors:
    - Health check failed: Connection refused

Summary Errors:
  - Unreachable: github

❌ MCP catalog verification FAILED
   One or more servers have configuration drift or are unreachable
   Deploy should be blocked until issues are resolved
```

**Exit Code:** `1` (verification failed)

---

### Scenario 4: FAIL - Missing in Runtime

**Test Case:** Catalog defines server but runtime config doesn't include it

**Mock Setup:**
```typescript
// Runtime config is empty (servers not configured)
mockMCPClient.getServers.mockReturnValue([]);
```

**Expected Response:**
```json
{
  "ok": false,
  "status": "fail",
  "results": [
    {
      "server": "github",
      "ok": false,
      "catalogEndpoint": "http://localhost:3003",
      "catalogPort": 3003,
      "catalogContractVersion": "0.6.0",
      "errors": [
        "Server 'github' exists in catalog but not in runtime configuration"
      ]
    },
    {
      "server": "deploy",
      "ok": false,
      "catalogEndpoint": "http://localhost:3002",
      "catalogPort": 3002,
      "catalogContractVersion": "0.6.0",
      "errors": [
        "Server 'deploy' exists in catalog but not in runtime configuration"
      ]
    }
  ],
  "summary": {
    "total": 2,
    "passed": 0,
    "failed": 2
  },
  "errors": [
    "Missing in runtime: github",
    "Missing in runtime: deploy"
  ],
  "catalogVersion": "0.6.0",
  "timestamp": "2026-01-02T13:00:00.000Z"
}
```

**HTTP Status:** `422 Unprocessable Entity`

**Gate Action:** ❌ Deploy blocked — runtime missing catalog servers

---

### Scenario 5: FAIL - Not in Catalog

**Test Case:** Runtime has server that doesn't exist in catalog

**Mock Setup:**
```typescript
mockMCPClient.getServers.mockReturnValue([
  {
    name: 'github',
    endpoint: 'http://localhost:3003',
    enabled: true,
  },
  {
    name: 'unknown-server', // ❌ Not in catalog!
    endpoint: 'http://localhost:9999',
    enabled: true,
  },
]);
```

**Expected Response:**
```json
{
  "ok": false,
  "status": "fail",
  "results": [
    {
      "server": "github",
      "ok": true,
      "catalogEndpoint": "http://localhost:3003",
      "catalogPort": 3003,
      "catalogContractVersion": "0.6.0",
      "runtimeEndpoint": "http://localhost:3003",
      "reachable": true,
      "healthCheckPassed": true,
      "errors": []
    },
    {
      "server": "unknown-server",
      "ok": false,
      "runtimeEndpoint": "http://localhost:9999",
      "errors": [
        "Server 'unknown-server' exists in runtime configuration but not in catalog"
      ]
    }
  ],
  "summary": {
    "total": 2,
    "passed": 1,
    "failed": 1
  },
  "errors": [
    "Not in catalog: unknown-server"
  ],
  "catalogVersion": "0.6.0",
  "timestamp": "2026-01-02T13:00:00.000Z"
}
```

**HTTP Status:** `422 Unprocessable Entity`

**Gate Action:** ❌ Deploy blocked — undocumented server in runtime

---

## Acceptance Criteria Verification

### ✅ AC1: API Endpoint liefert "effective MCP config"
**Implemented:** `GET /api/mcp/config`

Returns:
- Which endpoints/ports are actually in use (runtime config)
- Comparison with catalog definitions
- Drift detection flags (endpointMismatch, missingInCatalog, missingInRuntime)

### ✅ AC2: Verify-Endpoint prüft Erreichbarkeit/ContractVersion
**Implemented:** `GET /api/mcp/verify`

Checks:
- Endpoint reachability via health checks
- Contract version validity (via tools/list)
- Catalog-runtime consistency
- Returns detailed verification results per server

### ✅ AC3: CI/Deploy Gate blocks on mismatch or verify fail
**Implemented:** Workflow step in `deploy-ecs.yml` + `scripts/mcp-catalog-verify-gate.ts`

Behavior:
- Runs after deployment completes
- Calls `/api/mcp/verify` endpoint
- Exit code 0 = proceed, Exit code 1/2 = block
- Hard fail on any verification error

### ✅ AC4: Evidence of verify pass + fail cases
**Provided:** 
- 10 automated tests covering all scenarios
- This document with detailed pass/fail examples
- CLI output examples for both success and failure

---

## Integration Points

### 1. Catalog Source
- **File:** `docs/mcp/catalog.json`
- **Loaded by:** `src/lib/mcp-catalog.ts`
- **Version:** 0.6.0

### 2. Runtime Config
- **Source:** `src/lib/mcp-client.ts` (DEFAULT_SERVERS)
- **Environment variables:** `MCP_*_ENDPOINT` for each server
- **Managed by:** MCPClient singleton

### 3. Deploy Workflow
- **File:** `.github/workflows/deploy-ecs.yml`
- **Step:** "MCP Catalog Verification Gate (E7.0.3)"
- **Position:** After post-deploy image verification, before deploy event recording
- **Fail behavior:** Workflow stops, deploy marked as failed

---

## Security & Reliability

### No False Greens
The verify endpoint prevents scenarios where:
- Health checks pass but point to wrong endpoints
- Catalog documents ports that aren't actually used
- Runtime uses undocumented MCP servers
- Contract versions drift between catalog and reality

### Fail-Closed Behavior
- Missing catalog → verification fails
- Unreachable endpoint → verification fails
- Endpoint mismatch → verification fails
- Unknown server in runtime → verification fails

### Timeout Protection
- Default 30s timeout for verify calls
- Configurable via `MCP_VERIFY_TIMEOUT_MS`
- Prevents hanging on slow/dead servers

---

## Developer Experience

### Local Development
```bash
# Skip verification (dev only, never in CI)
export SKIP_MCP_VERIFY=true
npx ts-node scripts/mcp-catalog-verify-gate.ts
```

### Manual Verification
```bash
# Check effective config
curl http://localhost:3000/api/mcp/config | jq

# Run full verification
curl http://localhost:3000/api/mcp/verify | jq

# CLI gate (as in CI)
npx ts-node scripts/mcp-catalog-verify-gate.ts
```

### Debugging Failures
1. Check `/api/mcp/config` for drift details
2. Review `/api/mcp/verify` for specific errors
3. Verify catalog at `docs/mcp/catalog.json`
4. Check runtime config in `src/lib/mcp-client.ts`

---

## Files Changed

### New Files
- `control-center/app/api/mcp/config/route.ts` — Effective config endpoint
- `control-center/app/api/mcp/verify/route.ts` — Verification endpoint
- `control-center/__tests__/api/mcp-config-verify.test.ts` — Test suite (10 tests)
- `scripts/mcp-catalog-verify-gate.ts` — CI gate script
- `E7_0_3_EVIDENCE.md` — This documentation

### Modified Files
- `.github/workflows/deploy-ecs.yml` — Added verification gate step

### Total LOC: ~700 lines (excl. this doc)
- Endpoints: ~250 lines
- Tests: ~280 lines
- Gate script: ~170 lines
