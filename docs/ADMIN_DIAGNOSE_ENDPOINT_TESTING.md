# Admin Diagnose Endpoint - Testing Guide

## Endpoint Details

**URL:** `/api/admin/diagnose-mirror-status`  
**Method:** `GET`  
**Auth:** Requires `x-afu9-sub` header and `afu9-admin` group membership

## Quick Test Commands

### Local Testing (Control Center running on localhost:3000)

```bash
# Basic test
curl http://localhost:3000/api/admin/diagnose-mirror-status \
  -H "x-afu9-sub: admin" \
  -H "x-afu9-groups: afu9-admin" \
  | jq '.'

# Pretty-printed with specific fields
curl http://localhost:3000/api/admin/diagnose-mirror-status \
  -H "x-afu9-sub: admin" \
  -H "x-afu9-groups: afu9-admin" \
  | jq '{
    status: .diagnosis.status,
    message: .diagnosis.message,
    issuesFound: .diagnosis.issuesFound,
    unknownCount: (.results.statusDistribution[] | select(.github_mirror_status == "UNKNOWN") | .count),
    neverSynced: .results.neverSyncedCount,
    lastSync: .results.lastSync.last_sync_time
  }'

# Test without auth (should return 401)
curl http://localhost:3000/api/admin/diagnose-mirror-status \
  -v | jq '.'

# Test with wrong group (should return 401)
curl http://localhost:3000/api/admin/diagnose-mirror-status \
  -H "x-afu9-sub: user" \
  -H "x-afu9-groups: afu9-users" \
  -v | jq '.'
```

### Staging Testing

```bash
# Staging URL (replace with actual staging domain)
curl https://stage.afu-9.com/api/admin/diagnose-mirror-status \
  -H "x-afu9-sub: admin" \
  -H "x-afu9-groups: afu9-admin" \
  | jq '.'

# With AFU9_ADMIN_SUBS secret (if using secret-based auth)
AFU9_ADMIN_SUB=$(aws secretsmanager get-secret-value \
  --secret-id afu9/stage/admin-subs \
  --region eu-central-1 \
  --query SecretString \
  --output text)

curl https://stage.afu-9.com/api/admin/diagnose-mirror-status \
  -H "x-afu9-sub: $AFU9_ADMIN_SUB" \
  -H "x-afu9-groups: afu9-admin" \
  | jq '.'
```

### PowerShell Testing

```powershell
# Local test
$headers = @{
    "x-afu9-sub" = "admin"
    "x-afu9-groups" = "afu9-admin"
}

Invoke-RestMethod -Uri "http://localhost:3000/api/admin/diagnose-mirror-status" `
    -Headers $headers `
    -Method Get | ConvertTo-Json -Depth 10

# Staging test with admin subs secret
$adminSub = aws secretsmanager get-secret-value `
    --secret-id afu9/stage/admin-subs `
    --region eu-central-1 `
    --query SecretString `
    --output text

$headers = @{
    "x-afu9-sub" = $adminSub
    "x-afu9-groups" = "afu9-admin"
}

Invoke-RestMethod -Uri "https://stage.afu-9.com/api/admin/diagnose-mirror-status" `
    -Headers $headers `
    -Method Get | ConvertTo-Json -Depth 10
```

## Expected Responses

### Scenario 1: Critical - All Issues UNKNOWN (Issue #624 Active)

```json
{
  "ok": true,
  "timestamp": "2026-01-06T16:00:00.000Z",
  "results": {
    "issueI691": {
      "public_id": "6b707209",
      "title": "I691 (E69) — GitHub Auth Konsolidierung...",
      "github_issue_number": 477,
      "github_mirror_status": "UNKNOWN",
      "github_url": "https://github.com/adaefler-art/codefactory-control/issues/477",
      "github_repo": "adaefler-art/codefactory-control",
      "handoff_state": "SYNCED",
      "github_issue_last_sync_at": null,
      "github_sync_error": null
    },
    "statusDistribution": [
      {
        "github_mirror_status": "UNKNOWN",
        "count": "67"
      }
    ],
    "neverSyncedCount": 67,
    "lastSync": {
      "last_sync_time": null,
      "synced_issues_count": "0"
    }
  },
  "diagnosis": {
    "status": "CRITICAL",
    "problem": "ALL_UNKNOWN",
    "message": "Alle 67 Issues haben github_mirror_status = UNKNOWN",
    "recommendation": "Sync wurde nie erfolgreich ausgeführt oder Persist schlägt fehl. Prüfe Server-Logs nach \"Persist failed\" Fehlern. Verifiziere Type-Safety in control-center/app/api/ops/issues/sync/route.ts",
    "databaseConnection": "OK",
    "issuesFound": 67
  }
}
```

### Scenario 2: OK - All Issues Synced

```json
{
  "ok": true,
  "timestamp": "2026-01-06T16:00:00.000Z",
  "results": {
    "issueI691": {
      "public_id": "6b707209",
      "title": "I691 (E69) — GitHub Auth Konsolidierung...",
      "github_issue_number": 477,
      "github_mirror_status": "CLOSED",
      "github_url": "https://github.com/adaefler-art/codefactory-control/issues/477",
      "github_repo": "adaefler-art/codefactory-control",
      "handoff_state": "SYNCED",
      "github_issue_last_sync_at": "2026-01-06T15:30:00.000Z",
      "github_sync_error": null
    },
    "statusDistribution": [
      {
        "github_mirror_status": "CLOSED",
        "count": "45"
      },
      {
        "github_mirror_status": "OPEN",
        "count": "22"
      }
    ],
    "neverSyncedCount": 0,
    "lastSync": {
      "last_sync_time": "2026-01-06T15:30:15.000Z",
      "synced_issues_count": "67"
    }
  },
  "diagnosis": {
    "status": "OK",
    "message": "Alle 67 Issues haben korrekten Status",
    "databaseConnection": "OK",
    "issuesFound": 67
  }
}
```

### Scenario 3: Warning - Partial Failures

```json
{
  "ok": true,
  "timestamp": "2026-01-06T16:00:00.000Z",
  "results": {
    "issueI691": {
      "public_id": "6b707209",
      "github_issue_number": 477,
      "github_mirror_status": "OPEN",
      "github_issue_last_sync_at": "2026-01-06T15:30:00.000Z",
      "github_sync_error": null
    },
    "statusDistribution": [
      {
        "github_mirror_status": "OPEN",
        "count": "50"
      },
      {
        "github_mirror_status": "CLOSED",
        "count": "12"
      },
      {
        "github_mirror_status": "UNKNOWN",
        "count": "5"
      }
    ],
    "neverSyncedCount": 5,
    "lastSync": {
      "last_sync_time": "2026-01-06T15:30:15.000Z",
      "synced_issues_count": "62"
    }
  },
  "diagnosis": {
    "status": "WARNING",
    "problem": "PARTIAL_UNKNOWN",
    "message": "5 von 67 Issues haben UNKNOWN Status",
    "recommendation": "Einige Issues konnten nicht gesynct werden. Prüfe github_sync_error Spalte für Details.",
    "databaseConnection": "OK",
    "issuesFound": 67
  }
}
```

### Scenario 4: Info - No GitHub Issues

```json
{
  "ok": true,
  "timestamp": "2026-01-06T16:00:00.000Z",
  "results": {
    "issueI691": null,
    "statusDistribution": [],
    "neverSyncedCount": 0,
    "lastSync": {
      "last_sync_time": null,
      "synced_issues_count": "0"
    }
  },
  "diagnosis": {
    "status": "INFO",
    "message": "Keine Issues mit GitHub-Links gefunden",
    "databaseConnection": "OK",
    "issuesFound": 0
  }
}
```

### Scenario 5: Auth Error - Missing Headers

```json
{
  "ok": false,
  "error": "Missing x-afu9-sub header",
  "timestamp": "2026-01-06T16:00:00.000Z"
}
```

### Scenario 6: Auth Error - Wrong Group

```json
{
  "ok": false,
  "error": "Requires afu9-admin group membership",
  "timestamp": "2026-01-06T16:00:00.000Z"
}
```

### Scenario 7: Database Error

```json
{
  "ok": false,
  "error": "Database query failed: connection timeout",
  "timestamp": "2026-01-06T16:00:00.000Z",
  "diagnosis": {
    "status": "CRITICAL",
    "message": "Database connection failed",
    "databaseConnection": "FAILED",
    "issuesFound": 0
  }
}
```

## Integration Tests

### Test Suite (Jest/Vitest)

```typescript
describe('GET /api/admin/diagnose-mirror-status', () => {
  it('should return 401 without auth headers', async () => {
    const response = await fetch('/api/admin/diagnose-mirror-status');
    expect(response.status).toBe(401);
  });

  it('should return 401 with wrong group', async () => {
    const response = await fetch('/api/admin/diagnose-mirror-status', {
      headers: {
        'x-afu9-sub': 'user',
        'x-afu9-groups': 'afu9-users',
      },
    });
    expect(response.status).toBe(401);
  });

  it('should return diagnosis with admin auth', async () => {
    const response = await fetch('/api/admin/diagnose-mirror-status', {
      headers: {
        'x-afu9-sub': 'admin',
        'x-afu9-groups': 'afu9-admin',
      },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.diagnosis).toBeDefined();
    expect(data.results).toBeDefined();
  });

  it('should detect CRITICAL status when all issues UNKNOWN', async () => {
    // Setup: Insert test data with all UNKNOWN status
    // ...
    
    const response = await fetch('/api/admin/diagnose-mirror-status', {
      headers: {
        'x-afu9-sub': 'admin',
        'x-afu9-groups': 'afu9-admin',
      },
    });
    const data = await response.json();
    expect(data.diagnosis.status).toBe('CRITICAL');
    expect(data.diagnosis.problem).toBe('ALL_UNKNOWN');
  });
});
```

## Monitoring & Alerts

### CloudWatch Logs Query

```
fields @timestamp, @message
| filter @message like /diagnose-mirror-status/
| stats count() by diagnosis.status
```

### Alerting Rules

- **CRITICAL**: All issues UNKNOWN → Page on-call engineer
- **WARNING**: Some issues UNKNOWN → Create ticket
- **Database FAILED**: → Page on-call engineer

## Related Files

- **Endpoint**: `control-center/app/api/admin/diagnose-mirror-status/route.ts`
- **CLI Script**: `scripts/diagnose-github-mirror-status.ts`
- **Sync Endpoint**: `control-center/app/api/ops/issues/sync/route.ts`
- **Type Safety Fix**: Commit `6c8bb67d` (Issue #624)

## Next Steps After Testing

1. **Verify Fix**: After deploying type safety fix from PR #636:
   ```bash
   # Should show OK status after fix is deployed
   curl https://stage.afu-9.com/api/admin/diagnose-mirror-status \
     -H "x-afu9-sub: admin" \
     -H "x-afu9-groups: afu9-admin" \
     | jq '.diagnosis.status'
   ```

2. **Monitor Sync Progress**: 
   - Call endpoint every 5 minutes
   - Watch `neverSyncedCount` decrease
   - Watch `statusDistribution` change from UNKNOWN to OPEN/CLOSED

3. **Verify Issue I691**: 
   ```bash
   curl https://stage.afu-9.com/api/admin/diagnose-mirror-status \
     -H "x-afu9-sub: admin" \
     -H "x-afu9-groups: afu9-admin" \
     | jq '.results.issueI691.github_mirror_status'
   # Should be "CLOSED" or "OPEN", not "UNKNOWN"
   ```
