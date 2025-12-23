# DB Contract Pattern Implementation Guide

## Overview
This document describes the DB contract pattern implemented for AFU-9 write paths, starting with `deploy_events`.

## Pattern Components

### 1. Contract Schema (`src/lib/contracts/<table>.ts`)
Defines the data contract for a database table:

```typescript
// Input type (what the API accepts)
export interface DeployEventInput {
  env: string;
  service: string;
  version: string;
  commit_hash: string;
  status: string;
  message?: string | null;
}

// Row type (what the DB returns)
export interface DeployEventRow {
  id: string;
  created_at: string;
  // ... other fields
}

// Constraints (must match DB schema)
export const DEPLOY_EVENT_CONSTRAINTS = {
  env: 32,
  service: 64,
  // ... other limits
} as const;
```

### 2. Validation Function
Validates input against the contract:

```typescript
export function validateDeployEventInput(input: unknown): ValidationResult {
  // 1. Check input is an object
  // 2. Validate required fields exist and are non-empty strings
  // 3. Validate field lengths
  // 4. Validate optional fields
  // Returns: { valid: boolean, errors: ValidationError[] }
}
```

### 3. Sanitization Function
Cleans and normalizes validated input:

```typescript
export function sanitizeDeployEventInput(input: DeployEventInput): DeployEventInput {
  // 1. Guard: ensure input was validated
  // 2. Trim whitespace
  // 3. Clamp to max lengths
  // 4. Normalize null/undefined values
}
```

### 4. DB Helper (`src/lib/db/<table>.ts`)
Type-safe database operations:

```typescript
export async function insertDeployEvent(
  pool: Pool,
  input: DeployEventInput
): Promise<InsertResult> {
  const sanitized = sanitizeDeployEventInput(input);
  
  try {
    const result = await pool.query<DeployEventRow>(
      `INSERT INTO deploy_events (...) VALUES (...) RETURNING *`,
      [sanitized.env, sanitized.service, ...]
    );
    
    return { success: true, event: result.rows[0] };
  } catch (error) {
    // Log without sensitive data
    return { success: false, error: error.message };
  }
}
```

### 5. API Route Integration
Use the pattern in API routes:

```typescript
// 1. Check if DB is enabled (503 if not)
// 2. Check auth (401 if fails)
// 3. Parse JSON (400 if invalid)
// 4. Validate using contract (400 if invalid)
// 5. Insert using helper (503 if DB fails)
// 6. Return success (200)
```

## Status Code Contract

| Code | Meaning | When to Use |
|------|---------|-------------|
| 200  | Success | Data inserted successfully |
| 400  | Bad Request | Validation failed, missing fields, invalid format |
| 401  | Unauthorized | Auth token missing or invalid |
| 503  | Service Unavailable | DB disabled or DB operation failed |

**NEVER return 500 for NOT NULL violations** - validation prevents this.

## Testing Requirements

For each table implementing this pattern:

1. **Contract Tests** (27+ tests)
   - Valid input acceptance
   - Required field validation
   - Length constraint validation
   - Sanitization behavior

2. **API Route Tests** (12+ tests)
   - All status codes (200, 400, 401, 503)
   - NOT NULL violation prevention
   - Optional field handling

## Benefits

1. **Schema Synchronization**: Contract enforces DB schema constraints
2. **Type Safety**: TypeScript types prevent runtime errors
3. **Predictable Errors**: Consistent status codes across APIs
4. **Security**: No sensitive data in logs, validation prevents injection
5. **Maintainability**: Clear separation of concerns
6. **Testability**: Easy to unit test each component

## Extending to New Tables

To add this pattern to a new table:

1. Create `src/lib/contracts/<table>.ts` with Input/Row types, constraints, validation, and sanitization
2. Create `src/lib/db/<table>.ts` with insert/update helpers
3. Update API routes to use validation → helper pattern
4. Add comprehensive tests (contract + API)
5. Verify status codes match the contract

## Example: Adding to `workflow_executions`

```typescript
// src/lib/contracts/workflowExecution.ts
export interface WorkflowExecutionInput {
  workflow_id: string;
  issue_number: number;
  // ... other fields
}

export const WORKFLOW_EXECUTION_CONSTRAINTS = {
  workflow_id: 64,
  // ... from DB schema
} as const;

// src/lib/db/workflowExecutions.ts
export async function insertWorkflowExecution(
  pool: Pool,
  input: WorkflowExecutionInput
): Promise<InsertResult> {
  // ... same pattern
}
```

## References

- DB Schema: `database/migrations/013_deploy_events.sql`
- Test Run: AFU9-TL-001 (if available)
- Implementation: PR #[number]
