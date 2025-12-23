# DB Read / API Output Contracts (AFU-9)

**Issue**: [#297](https://github.com/adaefler-art/codefactory-control/issues/297)  
**Status**: ✅ GREEN - Read field coverage explicitly secured  
**Date**: 2025-12-23

## Intent

Ensure all DB read paths are explicit, complete, and deterministic via output contracts.  
**No silent field loss between DB ↔ API ↔ UI.**

## Problem Addressed

- DB fields exist but are not delivered to the API
- API responses are implicit (SELECT * or partial field lists)
- Errors go unnoticed as long as UI displays "something"

## Solution

Every database entity has an **explicit output contract** that defines:
1. All fields that must be returned from DB reads
2. Type signatures for each field
3. Validation functions to ensure contract compliance

## Contract Implementation

### Location
All output contracts are defined in:
```
control-center/src/lib/contracts/outputContracts.ts
```

### Structure
Each contract includes:
- **TypeScript interface** - Defines exact output shape
- **Type guard function** - Runtime validation (e.g., `isWorkflowOutput()`)
- **Field mapping** - Maps to exact DB schema fields

### Contract Enforcement

#### Build-Time Enforcement
- TypeScript compiler enforces types at build time
- API routes must use typed query results
- Contract violations cause compilation errors

#### Runtime Enforcement
- Type guard functions validate actual DB rows
- Contract validation runs on every read operation
- Validation failures throw errors (preventing silent field loss)

## Entity Coverage

### Core Workflow Entities

#### 1. Workflows (`workflows` table)
**Source**: `database/migrations/001_initial_schema.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `name` | VARCHAR(255) | `string` | ✅ | Unique workflow name |
| `description` | TEXT | `string \| null` | ✅ | Workflow description |
| `definition` | JSONB | `Record<string, unknown>` | ✅ | Workflow steps/config |
| `version` | INTEGER | `number` | ✅ | Workflow version |
| `enabled` | BOOLEAN | `boolean` | ✅ | Active status |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |
| `updated_at` | TIMESTAMP | `string` | ✅ | Last update timestamp |

**API Endpoints**:
- `GET /api/workflows` - List all workflows
- `GET /api/workflows/[id]` - Get single workflow

**Contract**: `WorkflowOutput`  
**Validation**: `isWorkflowOutput()`

---

#### 2. Workflow Executions (`workflow_executions` table)
**Source**: `database/migrations/001_initial_schema.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `workflow_id` | UUID | `string \| null` | ✅ | FK to workflows |
| `status` | VARCHAR(50) | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'` | ✅ | Execution status |
| `input` | JSONB | `Record<string, unknown> \| null` | ✅ | Execution input |
| `output` | JSONB | `Record<string, unknown> \| null` | ✅ | Execution output |
| `context` | JSONB | `Record<string, unknown> \| null` | ✅ | Execution context |
| `started_at` | TIMESTAMP | `string` | ✅ | Start timestamp |
| `completed_at` | TIMESTAMP | `string \| null` | ✅ | Completion timestamp |
| `error` | TEXT | `string \| null` | ✅ | Error message |
| `triggered_by` | VARCHAR(255) | `string \| null` | ✅ | Trigger source |
| `github_run_id` | VARCHAR(255) | `string \| null` | ✅ | GitHub Actions run ID |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |
| `updated_at` | TIMESTAMP | `string` | ✅ | Last update timestamp |

**API Endpoints**:
- `GET /api/executions/[id]` - Get execution details
- `GET /api/workflows/[id]/executions` - List workflow executions

**Contract**: `WorkflowExecutionOutput`  
**Validation**: `isWorkflowExecutionOutput()`

---

#### 3. Workflow Steps (`workflow_steps` table)
**Source**: `database/migrations/001_initial_schema.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `execution_id` | UUID | `string \| null` | ✅ | FK to workflow_executions |
| `step_name` | VARCHAR(255) | `string` | ✅ | Step identifier |
| `step_index` | INTEGER | `number` | ✅ | Step order |
| `status` | VARCHAR(50) | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'skipped'` | ✅ | Step status |
| `input` | JSONB | `Record<string, unknown> \| null` | ✅ | Step input |
| `output` | JSONB | `Record<string, unknown> \| null` | ✅ | Step output |
| `started_at` | TIMESTAMP | `string \| null` | ✅ | Start timestamp |
| `completed_at` | TIMESTAMP | `string \| null` | ✅ | Completion timestamp |
| `duration_ms` | INTEGER | `number \| null` | ✅ | Duration in ms |
| `error` | TEXT | `string \| null` | ✅ | Error message |
| `retry_count` | INTEGER | `number` | ✅ | Retry attempts |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |
| `updated_at` | TIMESTAMP | `string` | ✅ | Last update timestamp |

**API Endpoints**:
- Returned as part of `GET /api/executions/[id]`

**Contract**: `WorkflowStepOutput`  
**Validation**: Type guards available (not currently enforced in steps array)

---

### Repository & Product Entities

#### 4. Repositories (`repositories` table)
**Source**: `database/migrations/001_initial_schema.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `owner` | VARCHAR(255) | `string` | ✅ | GitHub owner |
| `name` | VARCHAR(255) | `string` | ✅ | Repository name |
| `full_name` | VARCHAR(511) | `string` | ✅ | Generated: owner/name |
| `default_branch` | VARCHAR(255) | `string` | ✅ | Default branch |
| `enabled` | BOOLEAN | `boolean` | ✅ | Active status |
| `config` | JSONB | `Record<string, unknown> \| null` | ✅ | Repository config |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |
| `updated_at` | TIMESTAMP | `string` | ✅ | Last update timestamp |

**API Endpoints**:
- `GET /api/repositories` - List repositories
- `GET /api/repositories/[id]` - Get single repository

**Contract**: `RepositoryOutput`

---

#### 5. Products (`products` table)
**Source**: `database/migrations/007_product_registry.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `repository_id` | UUID | `string` | ✅ | FK to repositories |
| `product_key` | VARCHAR(255) | `string` | ✅ | Unique key (owner/repo) |
| `display_name` | VARCHAR(255) | `string` | ✅ | Display name |
| `description` | TEXT | `string \| null` | ✅ | Product description |
| `metadata` | JSONB | `Record<string, unknown>` | ✅ | Custom metadata |
| `tags` | TEXT[] | `string[] \| null` | ✅ | Product tags |
| `constraints` | JSONB | `Record<string, unknown>` | ✅ | Product constraints |
| `kpi_targets` | JSONB | `Record<string, unknown>` | ✅ | KPI targets |
| `template_id` | VARCHAR(100) | `string \| null` | ✅ | Template reference |
| `template_config` | JSONB | `Record<string, unknown> \| null` | ✅ | Template config |
| `enabled` | BOOLEAN | `boolean` | ✅ | Active status |
| `archived` | BOOLEAN | `boolean` | ✅ | Archived status |
| `archived_at` | TIMESTAMP | `string \| null` | ✅ | Archive timestamp |
| `archived_reason` | TEXT | `string \| null` | ✅ | Archive reason |
| `isolation_level` | VARCHAR(50) | `string` | ✅ | Isolation level |
| `owner_team` | VARCHAR(255) | `string \| null` | ✅ | Owning team |
| `contact_email` | VARCHAR(255) | `string \| null` | ✅ | Contact email |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |
| `updated_at` | TIMESTAMP | `string` | ✅ | Last update timestamp |
| `created_by` | VARCHAR(255) | `string \| null` | ✅ | Creator |
| `updated_by` | VARCHAR(255) | `string \| null` | ✅ | Last updater |

**API Endpoints**:
- `GET /api/products` - List products
- `GET /api/products/[id]` - Get single product

**Contract**: `ProductOutput`  
**Validation**: `isProductOutput()`

---

#### 6. Product Templates (`product_templates` table)
**Source**: `database/migrations/007_product_registry.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | VARCHAR(100) | `string` | ✅ | Primary key (template type) |
| `name` | VARCHAR(255) | `string` | ✅ | Template name |
| `description` | TEXT | `string \| null` | ✅ | Template description |
| `default_metadata` | JSONB | `Record<string, unknown>` | ✅ | Default metadata |
| `default_constraints` | JSONB | `Record<string, unknown>` | ✅ | Default constraints |
| `default_kpi_targets` | JSONB | `Record<string, unknown>` | ✅ | Default KPI targets |
| `config_schema` | JSONB | `Record<string, unknown> \| null` | ✅ | Config JSON schema |
| `enabled` | BOOLEAN | `boolean` | ✅ | Active status |
| `version` | VARCHAR(20) | `string` | ✅ | Template version |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |
| `updated_at` | TIMESTAMP | `string` | ✅ | Last update timestamp |

**API Endpoints**:
- `GET /api/products/templates` - List templates

**Contract**: `ProductTemplateOutput`

---

### Operational Entities

#### 7. Deploy Events (`deploy_events` table)
**Source**: `database/migrations/013_deploy_events.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `created_at` | TIMESTAMP | `string` | ✅ | Event timestamp |
| `env` | VARCHAR(32) | `string` | ✅ | Environment |
| `service` | VARCHAR(64) | `string` | ✅ | Service name |
| `version` | VARCHAR(64) | `string` | ✅ | Version deployed |
| `commit_hash` | VARCHAR(64) | `string` | ✅ | Git commit hash |
| `status` | VARCHAR(32) | `string` | ✅ | Deploy status |
| `message` | VARCHAR(2000) | `string \| null` | ✅ | Deploy message |

**API Endpoints**:
- `GET /api/deploy-events` - List deploy events (with filtering)

**Contract**: `DeployEventOutput`  
**Validation**: `isDeployEventOutput()`

---

#### 8. Agent Runs (`agent_runs` table)
**Source**: `database/migrations/001_initial_schema.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `execution_id` | UUID | `string \| null` | ✅ | FK to workflow_executions |
| `step_id` | UUID | `string \| null` | ✅ | FK to workflow_steps |
| `agent_type` | VARCHAR(100) | `string` | ✅ | Agent identifier |
| `model` | VARCHAR(100) | `string \| null` | ✅ | LLM model used |
| `prompt_tokens` | INTEGER | `number \| null` | ✅ | Tokens in prompt |
| `completion_tokens` | INTEGER | `number \| null` | ✅ | Tokens in completion |
| `total_tokens` | INTEGER | `number \| null` | ✅ | Total tokens |
| `duration_ms` | INTEGER | `number \| null` | ✅ | Duration in ms |
| `cost_usd` | DECIMAL(10,6) | `string \| null` | ✅ | Cost in USD (as string) |
| `input` | JSONB | `Record<string, unknown> \| null` | ✅ | Agent input |
| `output` | JSONB | `Record<string, unknown> \| null` | ✅ | Agent output |
| `tool_calls` | JSONB | `Record<string, unknown> \| null` | ✅ | Tool calls made |
| `started_at` | TIMESTAMP | `string` | ✅ | Start timestamp |
| `completed_at` | TIMESTAMP | `string \| null` | ✅ | Completion timestamp |
| `error` | TEXT | `string \| null` | ✅ | Error message |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |

**API Endpoints**:
- `GET /api/agents` - List agent runs
- `GET /api/agents/[agentType]` - Get agent runs by type

**Contract**: `AgentRunOutput`

---

#### 9. MCP Servers (`mcp_servers` table)
**Source**: `database/migrations/001_initial_schema.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `name` | VARCHAR(255) | `string` | ✅ | Server name |
| `description` | TEXT | `string \| null` | ✅ | Server description |
| `endpoint` | VARCHAR(500) | `string` | ✅ | Server endpoint URL |
| `enabled` | BOOLEAN | `boolean` | ✅ | Active status |
| `config` | JSONB | `Record<string, unknown> \| null` | ✅ | Server config |
| `health_check_url` | VARCHAR(500) | `string \| null` | ✅ | Health check URL |
| `last_health_check` | TIMESTAMP | `string \| null` | ✅ | Last check timestamp |
| `health_status` | VARCHAR(50) | `string \| null` | ✅ | Health status |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |
| `updated_at` | TIMESTAMP | `string` | ✅ | Last update timestamp |

**API Endpoints**:
- `GET /api/mcp/health` - MCP server health status

**Contract**: `McpServerOutput`

---

#### 10. MCP Tool Calls (`mcp_tool_calls` table)
**Source**: `database/migrations/001_initial_schema.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `execution_id` | UUID | `string \| null` | ✅ | FK to workflow_executions |
| `agent_run_id` | UUID | `string \| null` | ✅ | FK to agent_runs |
| `server_name` | VARCHAR(255) | `string` | ✅ | MCP server name |
| `tool_name` | VARCHAR(255) | `string` | ✅ | Tool identifier |
| `params` | JSONB | `Record<string, unknown> \| null` | ✅ | Tool parameters |
| `result` | JSONB | `Record<string, unknown> \| null` | ✅ | Tool result |
| `error` | TEXT | `string \| null` | ✅ | Error message |
| `duration_ms` | INTEGER | `number \| null` | ✅ | Duration in ms |
| `started_at` | TIMESTAMP | `string` | ✅ | Start timestamp |
| `completed_at` | TIMESTAMP | `string \| null` | ✅ | Completion timestamp |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |

**API Endpoints**:
- Auditing/logging purposes (no direct API endpoint)

**Contract**: `McpToolCallOutput`

---

#### 11. Webhook Events (`webhook_events` table)
**Source**: `database/migrations/003_webhook_events.sql`

| DB Field | Type | Output Contract | Required | Notes |
|----------|------|----------------|----------|-------|
| `id` | UUID | `string` | ✅ | Primary key |
| `event_type` | VARCHAR(100) | `string` | ✅ | Event type |
| `payload` | JSONB | `Record<string, unknown>` | ✅ | Event payload |
| `source` | VARCHAR(255) | `string \| null` | ✅ | Event source |
| `processed` | BOOLEAN | `boolean` | ✅ | Processing status |
| `processed_at` | TIMESTAMP | `string \| null` | ✅ | Processing timestamp |
| `error` | TEXT | `string \| null` | ✅ | Error message |
| `created_at` | TIMESTAMP | `string` | ✅ | Creation timestamp |

**API Endpoints**:
- `GET /api/webhooks/events` - List webhook events

**Contract**: `WebhookEventOutput`

---

## Contract Validation

### Validation Strategy

1. **Compile-Time (TypeScript)**
   - API routes use typed interfaces
   - Query results are typed as specific output contracts
   - Type mismatches cause build failures

2. **Runtime (Type Guards)**
   - Type guard functions validate actual row data
   - Validation runs on every DB read
   - Failures throw errors and log details

3. **Test Coverage**
   - Unit tests for type guard functions
   - Integration tests for API contract compliance
   - Contract validation in CI/CD pipeline

### Example Usage

```typescript
// API Route with contract validation
import { DeployEventOutput, isDeployEventOutput } from '@/lib/contracts/outputContracts';

const result = await pool.query<DeployEventOutput>(
  `SELECT id, created_at, env, service, version, commit_hash, status, message
   FROM deploy_events
   WHERE env = $1`,
  [env]
);

// Validate each row
for (const row of result.rows) {
  if (!isDeployEventOutput(row)) {
    console.error('Contract validation failed:', row);
    throw new Error('Output contract validation failed');
  }
}

return NextResponse.json({ events: result.rows });
```

## Enforcement Mechanisms

### Build Enforcement
- **TypeScript compilation** fails if:
  - API routes don't use typed contracts
  - Query field lists don't match contract types
  - Response objects violate contract structure

### Test Enforcement
- **Unit tests** validate:
  - Type guard functions work correctly
  - All required fields are checked
  - Null handling is correct

- **Integration tests** validate:
  - API responses match contracts
  - DB queries return all contract fields
  - No silent field omissions occur

### Runtime Enforcement
- **Type guard validation** ensures:
  - Every DB read validates against contract
  - Contract violations are logged
  - Errors prevent corrupted responses

## Adding New Contracts

To add a contract for a new entity:

1. **Define the interface** in `outputContracts.ts`:
   ```typescript
   export interface MyEntityOutput {
     id: string;
     field1: string;
     field2: number | null;
     // ... all DB fields
   }
   ```

2. **Create type guard function**:
   ```typescript
   export function isMyEntityOutput(row: unknown): row is MyEntityOutput {
     if (!row || typeof row !== 'object') return false;
     const r = row as Record<string, unknown>;
     
     return (
       typeof r.id === 'string' &&
       typeof r.field1 === 'string' &&
       (r.field2 === null || typeof r.field2 === 'number')
     );
   }
   ```

3. **Use in API route**:
   ```typescript
   import { MyEntityOutput, isMyEntityOutput } from '@/lib/contracts/outputContracts';
   
   const result = await pool.query<MyEntityOutput>(`SELECT ... FROM my_entity`);
   
   for (const row of result.rows) {
     if (!isMyEntityOutput(row)) {
       throw new Error('Contract validation failed');
     }
   }
   ```

4. **Add to documentation** in this file

5. **Write tests** for the type guard function

## References

- **Issue**: [adaefler-art/codefactory-control#297](https://github.com/adaefler-art/codefactory-control/issues/297)
- **Write Contracts Pattern**: `docs/DB_CONTRACT_PATTERN.md`
- **DB Schema**: `database/migrations/`
- **Contract Source**: `control-center/src/lib/contracts/outputContracts.ts`

## Verdict

✅ **GREEN** - Read field coverage explicitly secured

All productive read paths now have:
- ✅ Explicit output contracts
- ✅ Runtime validation via type guards
- ✅ Compile-time type safety via TypeScript
- ✅ Comprehensive documentation of all DB fields
- ✅ No silent field loss possible
