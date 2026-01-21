# AFU-9 Runner MCP Server

**Canonical Server Name:** `afu9-runner`  
**Contract Version:** `0.6.0`  
**Port:** `3002` (standalone default), `3004` (ECS task)

MCP Server for AFU-9 run management and execution (Issue I631 / E63.1).

## 📚 Full Documentation

**Complete reference:** [../../docs/mcp/servers/afu9-runner.md](../../docs/mcp/servers/afu9-runner.md)

The full documentation includes:
- ✅ Complete tool contracts with schemas
- ✅ State machine and transitions
- ✅ Idempotency guarantees
- ✅ Error model with examples
- ✅ Timestamp guarantees
- ✅ API usage examples

## Overview

The AFU-9 MCP Runner provides a Model Context Protocol (MCP) interface for creating, executing, and monitoring workflow runs. This is the MVP skeleton implementation with strict type-safe contracts using Zod.

## Features

### I631: Core MCP Server with Contracts
- **RunSpec**: Input contract for run creation with Zod validation
- **RunResult**: Output contract for run execution results
- **Strict typing**: Full TypeScript types generated from Zod schemas
- **Runtime support**: Extensible runtime types (dummy, github-runner, ecs-task, ssm)
- **DummyExecutorAdapter**: In-memory execution simulation

### I632: Database Persistence (Runs Ledger)
- **PostgreSQL persistence**: Runs, steps, and artifacts stored in database
- **Immutable specs**: Run specs are never modified, re-runs create new entries
- **Deterministic playbook IDs**: Consistent playbook references
- **Stdout/stderr capping**: Tails limited to 4000 characters
- **DatabaseExecutorAdapter**: Full database-backed execution

### MCP Tools
1. **run.create**: Create a new run from a RunSpec
2. **run.execute**: Execute a previously created run
3. **run.status**: Get current status of a run
4. **run.read**: Read full results including step outputs
5. **playbook.list**: List available playbooks
6. **playbook.get**: Get a specific playbook by ID

## Not In Scope (I631/I632)

- ❌ UI integration (I633)
- ❌ GitHub Runner Adapter (I641)
- ❌ Real command execution (still dummy mode)
- ❌ Artifact blob storage (metadata only)

## Installation

```bash
npm install
```

## Usage

### Start Server (In-Memory Mode - I631)

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Start Server (Database Mode - I632)

```bash
# With environment variables
USE_DATABASE=true \
DATABASE_HOST=localhost \
DATABASE_PORT=5432 \
DATABASE_NAME=afu9 \
DATABASE_USER=postgres \
DATABASE_PASSWORD=yourpassword \
npm start
```

Environment variables:
- `USE_DATABASE`: Set to `true` to enable database persistence
- `DATABASE_HOST`: PostgreSQL host (default: localhost)
- `DATABASE_PORT`: PostgreSQL port (default: 5432)
- `DATABASE_NAME`: Database name (default: afu9)
- `DATABASE_USER`: Database user (default: postgres)
- `DATABASE_PASSWORD`: Database password
- `DATABASE_SSL`: Set to `true` to enable SSL

Server runs on port 3002 by default (configurable via PORT env var).

When deployed as an optional sidecar container in the AFU-9 ECS task, the runner uses port 3004 (to avoid conflict with `mcp-deploy` on 3002).

### Database Schema (I632)

See `database/migrations/026_afu9_runs_ledger.sql` for the complete schema.

**Tables:**
- `runs`: Run metadata, spec, and status
- `run_steps`: Individual step execution results
- `run_artifacts`: Artifact metadata (logs, files)

### Example: Create and Execute a Run

```typescript
// 1. Create a run
const createRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    tool: 'run.create',
    arguments: {
      spec: {
        title: 'Build and Test',
        runtime: 'dummy',
        steps: [
          {
            name: 'Install Dependencies',
            shell: 'bash',
            command: 'npm install',
            cwd: '/app',
          },
          {
            name: 'Run Tests',
            shell: 'bash',
            command: 'npm test',
            expect: {
              exitCode: 0,
            },
          },
        ],
        envRefs: {
          NODE_ENV: 'production',
        },
      },
    },
  },
};

// 2. Execute the run
const executeRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    tool: 'run.execute',
    arguments: {
      runId: '<runId-from-create-response>',
    },
  },
};

// 3. Read results
const readRequest = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    tool: 'run.read',
    arguments: {
      runId: '<runId>',
    },
  },
};
```

### Example: Using Playbooks

```bash
# List playbooks
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "tool": "playbook.list",
      "arguments": {}
    }
  }'

# Get specific playbook
curl -X POST http://localhost:3002 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "tool": "playbook.get",
      "arguments": {
        "id": "hello-world"
      }
    }
  }'
```

## Development

### Run Tests

```bash
npm test
```

### Test Coverage

```bash
npm test -- --coverage
```

### Build

```bash
npm run build
```

## RunSpec Schema

```typescript
{
  runId?: string;          // Optional, auto-generated if not provided
  issueId?: string;        // Optional GitHub issue ID
  title: string;           // Required
  runtime: 'dummy' | 'github-runner' | 'ecs-task' | 'ssm';
  steps: Array<{
    name: string;
    shell: 'bash' | 'pwsh';
    command: string;
    cwd?: string;
    timeoutSec?: number;
    expect?: {
      exitCode?: number;
      stdoutRegex?: string[];
      stderrRegex?: string[];
      fileExists?: string[];
    };
    artifacts?: string[];  // Glob patterns (metadata only in I631)
  }>;
  envRefs?: Record<string, string>;
}
```

## RunResult Schema

```typescript
{
  runId: string;
  issueId?: string;
  title: string;
  runtime: 'dummy' | 'github-runner' | 'ecs-task' | 'ssm';
  status: 'created' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled';
  steps: Array<{
    name: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'skipped';
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    startedAt?: string;    // ISO 8601
    completedAt?: string;  // ISO 8601
    durationMs?: number;
    error?: string;
  }>;
  createdAt: string;       // ISO 8601
  startedAt?: string;      // ISO 8601
  completedAt?: string;    // ISO 8601
  durationMs?: number;
  error?: string;
}
```

## Health & Readiness

```bash
# Liveness probe
curl http://localhost:3002/health

# Readiness probe (checks dependencies)
curl http://localhost:3002/ready
```

## Architecture

```
afu9-runner/
├── src/
│   ├── contracts/          # Zod schemas and types
│   │   └── schemas.ts
│   ├── adapters/           # Runtime adapters
│   │   ├── executor.ts     # DummyExecutorAdapter
│   │   └── playbook-manager.ts
│   └── index.ts            # AFU9RunnerMCPServer
├── __tests__/
│   ├── contracts/          # Schema validation tests
│   ├── adapters/           # Adapter unit tests
│   └── integration/        # Tool roundtrip tests
└── package.json
```

## Future Enhancements (Post-I631)

- I632: DynamoDB persistence for runs
- I633: UI integration
- I641: GitHub Runner Adapter for real execution
- Artifact storage in S3
- Step result caching
- Webhook notifications
- Advanced error handling

## License

Private - AFU-9 Project
