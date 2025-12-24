# AFU-9 API Boundary Normalization & Output-Contract Safety

## Overview

This document defines the **mandatory AFU-9 pattern** for safely serializing database data at API boundaries to systematically prevent "Output contract validation failed" errors caused by type mismatches between PostgreSQL data types and API contracts.

## Motivation

### The Problem

In AFU-9, all API responses are strictly validated against Output Contracts (e.g., using Zod validators or TypeScript type guards like `is*Output`). However, PostgreSQL returns certain data types in formats that don't match JSON serialization expectations:

- **`timestamptz` columns** → returned as JavaScript `Date` objects
- **API contracts** → expect ISO 8601 strings (e.g., `"2025-12-18T15:14:27.368Z"`)

Without explicit normalization, this type mismatch causes HTTP 500 errors in otherwise functional API flows (authentication works, routing works, database query succeeds), making these errors difficult to debug.

### Real-World Impact

- ✅ Database query succeeds and returns valid data
- ✅ User authentication and authorization pass
- ✅ Route handler executes correctly
- ❌ Output contract validation fails with cryptic error
- ❌ User receives HTTP 500 error
- ❌ No data is returned despite everything being "correct"

This pattern eliminates this entire class of implicit, hard-to-debug failures.

## Goals

1. **Establish a clear, reusable boundary rule** for all DB-to-API data flow
2. **Ensure consistency** across all current and future API routes
3. **Prevent implicit type errors** that bypass TypeScript's compile-time checks
4. **Maintain strict contracts** without loosening type safety

## Canonical Pattern (Mandatory)

### 1. DB → API Boundary Rule

**Database rows MUST NEVER be passed directly to API responses or Output Contract validators.**

Every API route that returns database data MUST normalize before validation.

### 2. Normalization Requirements

All API routes MUST use the central normalization utility:

**Location**: `control-center/src/lib/api/normalize-output.ts`

**Transformation Rules**:
- `Date` objects → ISO 8601 strings (via `.toISOString()`)
- `BigInt` → string representation
- `Buffer` → base64 string
- Arrays → recursively normalized
- Plain objects → recursively normalized (deep copy)
- Primitives (string, number, boolean, null, undefined) → unchanged

**Key Properties**:
- ✅ Recursive (handles nested objects and arrays)
- ✅ Non-mutating (creates new objects, preserves input)
- ✅ Circular reference safe (uses WeakMap tracking)
- ✅ Type-safe (TypeScript aware)

### 3. Mandatory Handler Sequence

Every API route handler MUST follow this exact sequence:

```typescript
// 1. Query database
const result = await pool.query('SELECT * FROM ...');

// 2. Normalize output (BEFORE validation)
const normalized = normalizeOutput(result.rows);

// 3. Validate against output contract
if (!isWorkflowOutput(normalized)) {
  throw new Error('Output contract validation failed');
}

// 4. Return JSON response
return NextResponse.json({ data: normalized });
```

**This order is not negotiable.**

### 4. Debugging Support (Optional, Gated)

For troubleshooting contract validation failures, DEBUG-only logging is permitted:

**Environment Flag**: `AFU9_DEBUG_API=1` or `AFU9_DEBUG_API=true`

**What MAY be logged**:
- Type evidence (`typeof`, `instanceof Date`, `instanceof String`)
- Field names from the contract schema
- Non-sensitive metadata (row counts, field presence)

**What MUST NOT be logged**:
- Sensitive user data
- Complete row contents
- Authentication tokens
- Personal information

**Example Debug Helper**:

```typescript
function logContractTypeEvidence(params: {
  route: string;
  requestId: string | null;
  candidate: Record<string, unknown>;
}) {
  if (!debugApiEnabled()) return;

  const pick = (key: string) => {
    const value = params.candidate?.[key];
    return {
      type: typeof value,
      isDate: value instanceof Date,
      isString: typeof value === 'string',
      isNull: value === null,
    };
  };

  console.log(
    JSON.stringify({
      level: 'debug',
      route: params.route,
      requestId: params.requestId,
      evidence: {
        created_at: pick('created_at'),
        updated_at: pick('updated_at'),
      },
      timestamp: new Date().toISOString(),
    })
  );
}
```

## Code Examples

### ✅ Correct Implementation

```typescript
/**
 * Example: /api/workflows
 * Demonstrates proper normalization before contract validation
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { isWorkflowOutput } from '@/lib/contracts/outputContracts';
import { normalizeOutput } from '@/lib/api/normalize-output';

export async function GET(request: NextRequest) {
  const pool = getPool();
  
  // 1. Query database
  const result = await pool.query(`
    SELECT id, name, description, created_at, updated_at
    FROM workflows
    ORDER BY name ASC
  `);
  
  // 2. Normalize BEFORE validation
  const normalized = normalizeOutput(result.rows);
  
  // 3. Validate each row
  for (const row of normalized) {
    if (!isWorkflowOutput(row)) {
      console.error('Contract validation failed', { id: row?.id });
      throw new Error('Workflow output contract validation failed');
    }
  }
  
  // 4. Return validated data
  return NextResponse.json({ workflows: normalized });
}
```

### ✅ Handling Joined Data

```typescript
/**
 * Example: /api/executions/[id]
 * Shows how to handle data with joined fields that aren't in the base contract
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = getPool();
  
  // Query includes joined fields from workflows table
  const result = await pool.query(`
    SELECT 
      we.*,
      w.name as workflow_name,
      w.description as workflow_description
    FROM workflow_executions we
    LEFT JOIN workflows w ON w.id = we.workflow_id
    WHERE we.id = $1
  `, [id]);
  
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  
  // Normalize the entire row
  const normalized = normalizeOutput(result.rows[0]);
  
  // Separate joined fields from contract fields
  const { workflow_name, workflow_description, ...executionData } = normalized;
  
  // Validate ONLY the contract fields
  if (!isWorkflowExecutionOutput(executionData)) {
    throw new Error('Execution output contract validation failed');
  }
  
  // Return validated contract data + joined fields
  return NextResponse.json({
    ...executionData,
    workflow_name,
    workflow_description,
  });
}
```

### ✅ Array of Results with Nested Objects

```typescript
/**
 * Example: /api/workflows with last_run data
 * Demonstrates normalization of nested structures
 */
const result = await pool.query(`
  SELECT 
    w.*,
    (
      SELECT json_build_object(
        'id', we.id,
        'status', we.status,
        'started_at', we.started_at,
        'completed_at', we.completed_at
      )
      FROM workflow_executions we
      WHERE we.workflow_id = w.id
      ORDER BY we.started_at DESC
      LIMIT 1
    ) as last_run
  FROM workflows w
`);

// Normalize handles nested json_build_object Date fields
const workflows = result.rows.map((row) => {
  const normalized = normalizeOutput(row);
  const { last_run, ...workflowData } = normalized;
  
  if (!isWorkflowOutput(workflowData)) {
    throw new Error('Workflow output contract validation failed');
  }
  
  return { ...workflowData, last_run };
});

return NextResponse.json({ workflows });
```

### ❌ Anti-Pattern: Direct Row Usage

```typescript
// ❌ WRONG: Passing DB rows directly to validator
const result = await pool.query('SELECT * FROM workflows');

for (const row of result.rows) {
  if (!isWorkflowOutput(row)) {  // Will fail! row.created_at is a Date
    throw new Error('Validation failed');
  }
}

// ❌ WRONG: Normalizing AFTER validation
const result = await pool.query('SELECT * FROM workflows');

for (const row of result.rows) {
  if (!isWorkflowOutput(row)) {  // Still fails before normalization
    throw new Error('Validation failed');
  }
}

const normalized = normalizeOutput(result.rows);  // Too late!
return NextResponse.json({ workflows: normalized });
```

### ❌ Anti-Pattern: Global Type Parser Override

```typescript
// ❌ WRONG: Setting global pg type parsers
import { types } from 'pg';

// This affects ALL queries globally and has unpredictable side effects
types.setTypeParser(1184 /* timestamptz */, (val) => {
  return val === null ? null : new Date(val).toISOString();
});

// Use normalizeOutput at API boundaries instead!
```

### ❌ Anti-Pattern: Loosening Contracts

```typescript
// ❌ WRONG: Making contracts accept Date | string
export interface WorkflowOutput {
  id: string;
  name: string;
  created_at: Date | string;  // BAD! Defeats type safety
  updated_at: Date | string;  // BAD! Client doesn't know what to expect
}

// ✅ CORRECT: Keep contracts strict, normalize at boundary
export interface WorkflowOutput {
  id: string;
  name: string;
  created_at: string;  // Always a string in JSON
  updated_at: string;  // Always a string in JSON
}
```

## Implementation Reference

### Core Utility

**File**: `control-center/src/lib/api/normalize-output.ts`

Key function:
```typescript
export function normalizeOutput<T>(input: T): any
```

### Test Coverage

**Unit Tests**: `control-center/src/lib/api/normalize-output.test.ts`
- Date conversion
- Nested object handling
- Array handling
- Non-mutation guarantee

**Integration Tests**:
- `control-center/__tests__/api/workflows-normalization.test.ts`
- `control-center/__tests__/api/executions-normalization.test.ts`
- `control-center/__tests__/api/deploy-events-normalization.test.ts`

### Current API Routes Using This Pattern

All routes returning database data use normalization:

1. **Workflows**:
   - `GET /api/workflows`
   - `GET /api/workflows/[id]`
   - `GET /api/workflows/[id]/executions`

2. **Executions**:
   - `GET /api/executions/[id]`

3. **Deploy Events**:
   - `GET /api/deploy-events`

## When to Apply This Pattern

### ✅ MUST Use Normalization

- Any API route that queries the database
- Any handler returning `timestamptz`, `date`, or `timestamp` columns
- Any route with output contract validation
- Any data structure that will be JSON serialized

### ⚠️ Consider Normalization

- Internal utilities that transform DB data before passing to API layer
- Helper functions that construct response objects from DB rows
- Middleware that enriches request context with DB data

### ✗ NOT Required

- API routes that only accept input (no DB reads)
- Internal services that don't cross the API boundary
- Data structures that never leave the server process

## Adding Normalization to New Routes

**Checklist for new API routes**:

- [ ] Import `normalizeOutput` from `@/lib/api/normalize-output`
- [ ] Call `normalizeOutput()` immediately after DB query
- [ ] Validate normalized data against output contract
- [ ] Add integration test verifying Date fields are strings
- [ ] Add debug logging helper if contract is complex

**Template**:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { normalizeOutput } from '@/lib/api/normalize-output';
import { is<YourTable>Output } from '@/lib/contracts/outputContracts';

export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT * FROM your_table');
    
    // Normalize before validation
    const normalized = normalizeOutput(result.rows);
    
    // Validate
    for (const row of normalized) {
      if (!is<YourTable>Output(row)) {
        throw new Error('Output contract validation failed');
      }
    }
    
    // Return
    return NextResponse.json({ data: normalized });
  } catch (error) {
    console.error('[API Route] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## Debugging Contract Validation Failures

If you encounter "Output contract validation failed" errors:

1. **Enable debug logging**:
   ```bash
   export AFU9_DEBUG_API=1
   ```

2. **Check the evidence output** in logs:
   ```json
   {
     "level": "debug",
     "route": "/api/workflows",
     "evidence": {
       "created_at": {
         "type": "object",
         "isDate": true,
         "isString": false
       }
     }
   }
   ```

3. **Common fixes**:
   - **`isDate: true`** → Missing `normalizeOutput()` call
   - **`type: "undefined"`** → Field missing in SELECT query
   - **`type: "object"` but not Date** → Unexpected data structure (check JSONB columns)

4. **Verify normalization order**:
   - Ensure `normalizeOutput()` is called BEFORE validation
   - Check that you're validating the normalized result, not the raw rows

## Related Patterns

- **[DB Contract Pattern](../DB_CONTRACT_PATTERN.md)**: Input validation and sanitization for write paths
- **[Output Contracts](../../control-center/src/lib/contracts/outputContracts.ts)**: TypeScript type definitions and validators
- **[Database Schema](./database-schema.md)**: PostgreSQL schema including column types

## Benefits

1. **Prevents Silent Failures**: Type mismatches caught explicitly, not via runtime JSON serialization
2. **Consistent Behavior**: All API routes handle DB types the same way
3. **Debuggable**: Clear error messages with optional type evidence logging
4. **Maintainable**: Single source of truth for type conversions
5. **Type-Safe**: Works with TypeScript's type system
6. **Testable**: Easy to unit test normalization logic independently

## Migration Guide

For existing routes not yet using normalization:

1. **Identify affected routes**: Any route querying tables with `timestamptz` columns
2. **Add normalization**:
   ```typescript
   // Before
   const result = await pool.query('...');
   if (!isOutput(result.rows[0])) { /* ... */ }
   
   // After
   const result = await pool.query('...');
   const normalized = normalizeOutput(result.rows);
   if (!isOutput(normalized[0])) { /* ... */ }
   ```
3. **Update tests**: Verify Date fields are strings in response
4. **Deploy and monitor**: Check for contract validation errors in logs

## Summary

**The Rule**: Never pass raw database rows across API boundaries.

**The Pattern**: Query → Normalize → Validate → Respond

**The Tool**: `normalizeOutput()` from `@/lib/api/normalize-output`

**The Goal**: Zero "Output contract validation failed" errors from type mismatches

---

**Last Updated**: 2025-12-24  
**Status**: Mandatory for all API routes  
**Applies To**: AFU-9 v0.2 and later
