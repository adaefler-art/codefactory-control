# AFU-9 Runner MCP Server

**Canonical Server Name:** `afu9-runner`  
**Contract Version:** `0.6.0`  
**Port:** `3002` (default)

## Overview

The AFU-9 Runner is a Model Context Protocol (MCP) server that provides workflow run management and execution capabilities for the AFU-9 autonomous fabrication system.

### Purpose

- Create and manage workflow runs with strict type-safe contracts
- Execute runs through pluggable runtime adapters
- Track run status and results with comprehensive metadata
- Provide playbook templates for common workflows

### DummyExecutor Scope (I631 MVP)

**What DummyExecutor Does:**
- Accepts valid RunSpec contracts and creates runs
- Simulates execution with dummy stdout/stderr outputs
- Tracks status transitions (created → running → success)
- Records timestamps and durations
- Validates all inputs with Zod schemas

**What DummyExecutor Does NOT Do:**
- ❌ Execute actual commands (simulated only)
- ❌ Persist runs to database (in-memory only)
- ❌ Store artifacts to S3
- ❌ Integrate with GitHub Runners
- ❌ Support real bash/pwsh execution

Future adapters (post-I631): `GitHubRunnerAdapter`, `ECSTaskAdapter`, `SSMAdapter`

## Tool Contracts

All tools follow JSON-RPC 2.0 protocol with MCP conventions. Tool names are scoped to the server.

### 1. run.create

Creates a new run from a RunSpec. Returns immediately with `created` status.

**Input:**
```typescript
{
  spec: {
    runId?: string,        // Optional, auto-generated if omitted
    issueId?: string,      // Optional GitHub issue reference
    title: string,         // Required, human-readable title
    runtime: "dummy" | "github-runner" | "ecs-task" | "ssm",
    steps: Array<{
      name: string,        // Required, step identifier
      shell: "bash" | "pwsh",
      command: string,     // Required, command to execute
      cwd?: string,        // Optional working directory
      timeoutSec?: number, // Optional timeout in seconds
      expect?: {           // Optional validation rules
        exitCode?: number,
        stdoutRegex?: string[],
        stderrRegex?: string[],
        fileExists?: string[]
      },
      artifacts?: string[] // Optional artifact glob patterns (metadata only in I631)
    }>,
    envRefs?: Record<string, string>  // Optional environment variables
  }
}
```

**Output:**
```typescript
{
  runId: string,
  issueId?: string,
  title: string,
  runtime: string,
  status: "created",
  steps: Array<{
    name: string,
    status: "pending"
  }>,
  createdAt: string  // ISO 8601 timestamp
}
```

**Example:**
```json
{
  "spec": {
    "title": "Build and Test",
    "runtime": "dummy",
    "steps": [
      {
        "name": "Install Dependencies",
        "shell": "bash",
        "command": "npm install"
      }
    ]
  }
}
```

**Errors:**
- Validation error if `title` missing or empty
- Validation error if `steps` array empty
- Error if `runtime` not "dummy" in DummyExecutor
- Duplicate `runId` error if custom runId already exists

### 2. run.execute

Executes a previously created run. Can only be called once per run.

**Input:**
```typescript
{
  runId: string  // Required
}
```

**Output:**
```typescript
{
  runId: string,
  status: "success" | "failed",
  steps: Array<{
    name: string,
    status: "success" | "failed" | "timeout" | "skipped",
    exitCode?: number,
    stdout?: string,
    stderr?: string,
    startedAt?: string,    // ISO 8601
    completedAt?: string,  // ISO 8601
    durationMs?: number
  }>,
  startedAt: string,       // ISO 8601
  completedAt: string,     // ISO 8601
  durationMs: number
}
```

**Example:**
```json
{
  "runId": "run-1735536000000-1"
}
```

**Errors:**
- `Run {runId} not found` if runId doesn't exist
- `Run {runId} has already been executed (status: {status})` if called twice

### 3. run.status

Gets current status of a run. Read-only, no side effects.

**Input:**
```typescript
{
  runId: string  // Required
}
```

**Output:**
```typescript
{
  runId: string,
  status: "created" | "running" | "success" | "failed" | "timeout" | "cancelled",
  createdAt: string,
  startedAt?: string,
  completedAt?: string,
  durationMs?: number
}
```

**Example:**
```json
{
  "runId": "run-1735536000000-1"
}
```

**Errors:**
- `Run {runId} not found` if runId doesn't exist

### 4. run.read

Reads full results of a run including all step outputs. Read-only, no side effects.

**Input:**
```typescript
{
  runId: string  // Required
}
```

**Output:** Same as run.status but includes full `steps` array with outputs.

**Example:**
```json
{
  "runId": "run-1735536000000-1"
}
```

**Errors:**
- `Run {runId} not found` if runId doesn't exist

### 5. playbook.list

Lists all available playbooks. Read-only, no side effects.

**Input:**
```typescript
{}  // No parameters
```

**Output:**
```typescript
{
  playbooks: Array<{
    id: string,
    name: string,
    description?: string,
    spec: RunSpec
  }>
}
```

**Example:**
```json
{}
```

**Errors:** None expected.

### 6. playbook.get

Gets a specific playbook by ID. Read-only, no side effects.

**Input:**
```typescript
{
  id: string  // Required
}
```

**Output:**
```typescript
{
  id: string,
  name: string,
  description?: string,
  spec: RunSpec
}
```

**Example:**
```json
{
  "id": "hello-world"
}
```

**Errors:**
- `Playbook {id} not found` if id doesn't exist

## State Machine

### Run Status Transitions

```
created → running → success
                 ↘ failed
                 ↘ timeout
                 ↘ cancelled
```

**Valid Transitions:**
- `created` → `running` (via run.execute)
- `running` → `success` (automatic on successful execution)
- `running` → `failed` (automatic on execution failure)
- `running` → `timeout` (automatic on timeout)
- `running` → `cancelled` (future: manual cancellation)

**Invalid Transitions:**
- Cannot execute a run that is not in `created` status
- Cannot transition from terminal states (`success`, `failed`, `timeout`, `cancelled`)

### Step Status Transitions

```
pending → running → success
                 ↘ failed
                 ↘ timeout
                 ↘ skipped
```

**Behavior:**
- All steps start as `pending` when run is created
- Steps transition to `running` during execution
- Steps reach terminal state (`success`, `failed`, `timeout`, `skipped`)

### Allowed Operations by Status

| Operation | created | running | success | failed | timeout | cancelled |
|-----------|---------|---------|---------|--------|---------|-----------|
| execute   | ✅      | ❌      | ❌      | ❌     | ❌      | ❌        |
| status    | ✅      | ✅      | ✅      | ✅     | ✅      | ✅        |
| read      | ✅      | ✅      | ✅      | ✅     | ✅      | ✅        |

## Idempotency

### run.execute - NOT Idempotent

**Behavior:** Calling `run.execute` twice on the same runId results in an error.

**First Call:**
```json
Request: {"runId": "run-123"}
Response: {
  "runId": "run-123",
  "status": "success",
  ...
}
```

**Second Call:**
```json
Request: {"runId": "run-123"}
Error: {
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Run run-123 has already been executed (status: success)"
  }
}
```

### run.status - Idempotent & Side-Effect Free

**Behavior:** Can be called multiple times without changing state.

```json
Request: {"runId": "run-123"}
Response: {"runId": "run-123", "status": "success", ...}

Request: {"runId": "run-123"}  // Same response
Response: {"runId": "run-123", "status": "success", ...}
```

### run.read - Idempotent & Side-Effect Free

**Behavior:** Can be called multiple times without changing state.

```json
Request: {"runId": "run-123"}
Response: {"runId": "run-123", "steps": [...], ...}

Request: {"runId": "run-123"}  // Same response
Response: {"runId": "run-123", "steps": [...], ...}
```

## Error Model

All errors follow JSON-RPC 2.0 error format wrapped in MCP response structure.

### Error Format

```typescript
{
  "jsonrpc": "2.0",
  "id": number,
  "error": {
    "code": number,
    "message": string,
    "data"?: any
  }
}
```

### Error Types

#### 1. Unknown RunId

Occurs when requesting a run that doesn't exist.

**Example (run.status):**
```json
Request: {"runId": "unknown-run-id"}
Response: {
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "Run unknown-run-id not found"
  }
}
```

**Example (run.read):**
```json
Request: {"runId": "missing-id"}
Response: {
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32000,
    "message": "Run missing-id not found"
  }
}
```

**Error Message Pattern:** `Run {runId} not found`

#### 2. Execute Already Executed

Occurs when calling run.execute on a run that's not in `created` status.

**Example:**
```json
Request: {"runId": "run-123"}  // Second execute call
Response: {
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32000,
    "message": "Run run-123 has already been executed (status: success)"
  }
}
```

**Error Message Pattern:** `Run {runId} has already been executed (status: {status})`

#### 3. Validation Error

Occurs when RunSpec doesn't conform to schema.

**Example (missing title):**
```json
Request: {
  "spec": {
    "runtime": "dummy",
    "steps": [{"name": "Test", "shell": "bash", "command": "echo"}]
  }
}
Response: {
  "jsonrpc": "2.0",
  "id": 4,
  "error": {
    "code": -32000,
    "message": "Validation error: title: Required"
  }
}
```

**Example (invalid runtime):**
```json
Request: {
  "spec": {
    "title": "Test",
    "runtime": "invalid",
    "steps": [{"name": "Test", "shell": "bash", "command": "echo"}]
  }
}
Response: {
  "jsonrpc": "2.0",
  "id": 5,
  "error": {
    "code": -32000,
    "message": "Validation error: runtime: Invalid enum value..."
  }
}
```

**Error Message Pattern:** `Validation error: {field}: {message}`

#### 4. Unsupported Runtime

Occurs when DummyExecutor receives non-"dummy" runtime.

**Example:**
```json
Request: {
  "spec": {
    "title": "GitHub Test",
    "runtime": "github-runner",
    "steps": [{"name": "Test", "shell": "bash", "command": "echo"}]
  }
}
Response: {
  "jsonrpc": "2.0",
  "id": 6,
  "error": {
    "code": -32000,
    "message": "Runtime github-runner not supported by DummyExecutorAdapter. Only 'dummy' runtime is supported in I631."
  }
}
```

## Timestamps

All timestamps are ISO 8601 format in UTC: `YYYY-MM-DDTHH:mm:ss.sssZ`

### Timestamp Guarantees

**Ordering Guarantee:**
```
createdAt ≤ startedAt ≤ completedAt
```

This ordering is guaranteed for all successfully executed runs.

### Timestamp Presence by Status

| Status    | createdAt | startedAt | completedAt | durationMs |
|-----------|-----------|-----------|-------------|------------|
| created   | ✅        | ❌        | ❌          | ❌         |
| running   | ✅        | ✅        | ❌          | ❌         |
| success   | ✅        | ✅        | ✅          | ✅         |
| failed    | ✅        | ✅        | ✅          | ✅         |
| timeout   | ✅        | ✅        | ✅          | ✅         |
| cancelled | ✅        | ✅        | ✅          | ✅         |

**Behavior:**
- `createdAt`: Always present
- `startedAt`: Present after execution begins
- `completedAt`: Present only after execution finishes
- `durationMs`: Present only after execution finishes

## Versioning

### Contract Version

**Current Version:** `0.6.0`

The `contractVersion` indicates the stability and compatibility of the tool contracts:
- Major version (0): Pre-1.0, breaking changes allowed
- Minor version (6): Feature additions, backward compatible
- Patch version (0): Bug fixes only

### Catalog Version

**Catalog Version:** `0.6.0` (matches contract version)

The catalog at `docs/mcp/catalog.json` documents all MCP servers. Each server entry includes:
- `name`: Canonical server name (`afu9-runner`)
- `contractVersion`: Server's contract version
- `tools`: Array of tool definitions with their schemas

**Relationship:**
- Server `contractVersion` MUST match the version in `catalog.json`
- Breaking changes require major version bump
- New tools or optional fields require minor version bump

## Development

### Prerequisites
```bash
Node.js 20+
npm 9+
```

### Installation
```bash
cd mcp-servers/afu9-runner
npm install
```

### Build
```bash
npm run build
```

### Test
```bash
npm test           # Run all tests
npm test:watch     # Watch mode
```

### Run Server
```bash
npm start          # Production
npm run dev        # Development with hot reload
```

### Docker
```bash
# Build
docker build -f Dockerfile -t afu9-runner:local ../

# Run
docker run -p 3002:3002 afu9-runner:local
```

## API Examples

### Complete Workflow

```bash
# 1. Create a run
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "tool": "run.create",
      "arguments": {
        "spec": {
          "title": "Build Project",
          "runtime": "dummy",
          "steps": [
            {
              "name": "Install",
              "shell": "bash",
              "command": "npm install"
            },
            {
              "name": "Build",
              "shell": "bash",
              "command": "npm run build"
            }
          ]
        }
      }
    }
  }'

# Response: {"result": {"content": [{"text": "{\"runId\":\"run-...\",\"status\":\"created\",...}"}]}}

# 2. Execute the run
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "tool": "run.execute",
      "arguments": {
        "runId": "run-1735536000000-1"
      }
    }
  }'

# 3. Check status
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "tool": "run.status",
      "arguments": {
        "runId": "run-1735536000000-1"
      }
    }
  }'

# 4. Read full results
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "tool": "run.read",
      "arguments": {
        "runId": "run-1735536000000-1"
      }
    }
  }'
```

## Health & Readiness

```bash
# Liveness probe
curl http://localhost:3002/health

# Readiness probe (includes dependency checks)
curl http://localhost:3002/ready
```

## License

Private - AFU-9 Project
