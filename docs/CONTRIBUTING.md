# Contributing

## Tests

Run `npm test` before pushing or opening a PR. This executes the shared Jest suite (including context-validator) to catch breaking changes in CDK context handling.

## Admin Endpoint Guidelines

All admin endpoints (`/api/ops/*`, `/api/admin/*`) MUST use standardized authentication and authorization patterns to prevent security vulnerabilities.

### Required Security Pattern

Admin endpoints **MUST** implement guards in strict order:
1. **AUTH CHECK (401-first)** - Verify `x-afu9-sub` header, NO DB calls
2. **ADMIN CHECK (403)** - Verify admin allowlist, NO DB calls  
3. **DB OPERATIONS** - Only executed if all guards pass

### Option 1: Use `checkProdWriteGuard()` (Recommended)

```typescript
import { checkProdWriteGuard } from '@/lib/guards/prod-write-guard';
import { getRequestId } from '@/lib/api/response-helpers';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const guard = checkProdWriteGuard(request, { 
    requireAdmin: true, 
    requestId 
  });
  
  if (guard.errorResponse) {
    return guard.errorResponse; // Returns 401/409/403 automatically
  }
  
  const userId = guard.userId!;
  // DB operations...
}
```

### Option 2: Implement Local `isAdminUser()` Function

For endpoints that don't need production gating, implement a local admin check:

```typescript
/**
 * Check if user sub is in admin allowlist
 * Fail-closed: empty/missing AFU9_ADMIN_SUBS → deny all
 */
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    // Fail-closed: no admin allowlist configured → deny all
    return false;
  }
  
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  // 1. AUTH CHECK (401-first)
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required',
    });
  }
  
  // 2. ADMIN CHECK (403)
  if (!isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required',
    });
  }
  
  // 3. DB operations...
}
```

### Environment Configuration

Admin access requires the `AFU9_ADMIN_SUBS` environment variable with comma-separated sub IDs:

```bash
AFU9_ADMIN_SUBS=user1@example.com,user2@example.com,admin@example.com
```

**Security Note**: If `AFU9_ADMIN_SUBS` is empty or missing, all admin checks fail (fail-closed behavior).

### Audit Before Committing

Run the audit script to verify all admin endpoints are compliant:

```powershell
.\scripts\audit-admin-endpoints.ps1
```

The script will:
- ✅ Pass if all endpoints use standardized patterns
- ❌ Fail if any endpoints are missing admin checks
- Show detailed compliance report

### Common Mistakes to Avoid

❌ **Don't** skip admin checks on "internal" endpoints:
```typescript
// WRONG: Only auth check, no admin verification
const userId = request.headers.get('x-afu9-sub');
if (!userId) return 401;
// Missing admin check!
```

❌ **Don't** use non-standard auth patterns:
```typescript
// WRONG: Using x-afu9-groups instead of AFU9_ADMIN_SUBS
const groups = request.headers.get('x-afu9-groups');
if (!groups.includes('admin')) return 403;
```

✅ **Do** use standardized patterns:
```typescript
// CORRECT: Standard guard or isAdminUser()
const guard = checkProdWriteGuard(request, { requireAdmin: true, requestId });
if (guard.errorResponse) return guard.errorResponse;
```

### Security Principles

1. **Auth-first**: Always check authentication (401) before anything else
2. **Fail-closed**: Empty/missing `AFU9_ADMIN_SUBS` → deny all admin access
3. **No DB before guards**: Never execute database operations before auth/admin checks pass
4. **Consistent error responses**: Use standard error codes (401, 403, 409)
