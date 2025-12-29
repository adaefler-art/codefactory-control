# AFU-9 MCP Runner

MCP Server for AFU-9 run management and execution (Issue I631 / E63.1).

## Overview

The AFU-9 MCP Runner provides a Model Context Protocol (MCP) interface for creating, executing, and monitoring workflow runs. This is the MVP skeleton implementation with strict type-safe contracts using Zod.

## Features (I631 Scope)

### Contracts
- **RunSpec**: Input contract for run creation with Zod validation
- **RunResult**: Output contract for run execution results
- **Strict typing**: Full TypeScript types generated from Zod schemas
- **Runtime support**: Extensible runtime types (dummy, github-runner, ecs-task, ssm)

### MCP Tools
1. **run.create**: Create a new run from a RunSpec
2. **run.execute**: Execute a previously created run
3. **run.status**: Get current status of a run
4. **run.read**: Read full results including step outputs
5. **playbook.list**: List available playbooks
6. **playbook.get**: Get a specific playbook by ID

### DummyExecutorAdapter
- In-memory execution simulation
- No actual command execution (MVP)
- Complete create→execute→read flow
- No persistence (DynamoDB in I632)

## Not In Scope (I631)

- ❌ DB persistence (I632)
- ❌ UI integration (I633)
- ❌ GitHub Runner Adapter (I641)
- ❌ Real command execution
- ❌ Artifact storage

## Installation

```bash
npm install
```

## Usage

### Start Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Server runs on port 3002 by default (configurable via PORT env var).

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
