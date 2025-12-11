# AFU-9 v0.2: Workflow Engine & Agent Runner

This document describes the Workflow Engine and Agent Runner implementation for AFU-9 v0.2.

## Overview

The AFU-9 v0.2 architecture introduces three core components for orchestrating autonomous code fabrication:

1. **MCP Client Layer** - Handles communication with MCP servers using JSON-RPC 2.0
2. **Workflow Engine** - Executes workflows as sequences of tool calls
3. **Agent Runner** - Integrates LLMs with MCP tools for autonomous task execution

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Control Center                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  Agent Runner                           │  │
│  │  - LLM Integration (OpenAI, Anthropic, Bedrock)       │  │
│  │  - Dynamic Tool Calling                                │  │
│  │  - Multi-iteration Execution                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 Workflow Engine                         │  │
│  │  - Step-by-step Execution                             │  │
│  │  - Variable Substitution                               │  │
│  │  - Error Handling & Retries                            │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  MCP Client Layer                       │  │
│  │  - JSON-RPC 2.0 Protocol                              │  │
│  │  - Server Health Checks                                │  │
│  │  - Tool Discovery                                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
└────────────────────────────┼──────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐        ┌─────▼────┐       ┌─────▼────┐
    │ GitHub  │        │  Deploy  │       │   Obs    │
    │  MCP    │        │   MCP    │       │   MCP    │
    └─────────┘        └──────────┘       └──────────┘
```

## Components

### 1. MCP Client Layer

**Location**: `control-center/src/lib/mcp-client.ts`

The MCP Client handles all communication with MCP servers using the JSON-RPC 2.0 protocol.

#### Features

- **Tool Calling**: Execute tools on any MCP server
- **Tool Discovery**: List available tools from servers
- **Health Checking**: Monitor server availability
- **Server Management**: Add/remove servers dynamically

#### Usage

```typescript
import { getMCPClient } from './lib/mcp-client';

const client = getMCPClient();

// Call a tool
const result = await client.callTool('github', 'getIssue', {
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  number: 1,
});

// List tools
const tools = await client.listTools('github');

// Check health
const health = await client.checkHealth('github');
```

#### Configuration

MCP servers are configured via environment variables:

```bash
MCP_GITHUB_ENDPOINT=http://localhost:3001
MCP_DEPLOY_ENDPOINT=http://localhost:3002
MCP_OBSERVABILITY_ENDPOINT=http://localhost:3003
```

### 2. Workflow Engine

**Location**: `control-center/src/lib/workflow-engine.ts`

The Workflow Engine executes workflows defined as sequences of tool calls with variable substitution and error handling.

#### Features

- **Step-by-step Execution**: Execute workflow steps sequentially
- **Variable Substitution**: Use `${variable.path}` syntax for dynamic values
- **Error Handling**: Continue on error or stop execution
- **Retries**: Configurable retry logic for failed steps
- **Conditional Steps**: Skip steps based on conditions

#### Workflow Definition

A workflow is defined as a JSON object:

```json
{
  "steps": [
    {
      "name": "fetch_issue",
      "tool": "github.getIssue",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "number": "${input.issue_number}"
      },
      "assign": "issue"
    },
    {
      "name": "create_branch",
      "tool": "github.createBranch",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "branch": "fix/${issue.number}",
        "from": "${repo.default_branch}"
      },
      "assign": "branch"
    }
  ]
}
```

#### Usage

```typescript
import { getWorkflowEngine } from './lib/workflow-engine';
import { WorkflowDefinition, WorkflowContext } from './lib/types/workflow';

const engine = getWorkflowEngine();

const workflow: WorkflowDefinition = {
  steps: [
    // ... workflow steps
  ],
};

const context: WorkflowContext = {
  variables: {},
  input: {
    issue_number: 1,
  },
  repo: {
    owner: 'adaefler-art',
    name: 'codefactory-control',
    default_branch: 'main',
  },
};

const result = await engine.execute(workflow, context);
console.log(result.status); // 'completed' | 'failed'
console.log(result.output); // Final context variables
```

#### Configuration

```typescript
const config = {
  timeoutMs: 300000, // 5 minutes
  maxRetries: 2,
  continueOnError: false,
};

const result = await engine.execute(workflow, context, config);
```

### 3. Agent Runner

**Location**: `control-center/src/lib/agent-runner.ts`

The Agent Runner integrates LLMs with MCP tools, allowing AI agents to autonomously call tools during execution.

#### Features

- **LLM Integration**: OpenAI (with support for Anthropic and Bedrock)
- **Dynamic Tool Calling**: LLM decides which tools to call and when
- **Multi-iteration**: Agent can call multiple tools in sequence
- **Tool Discovery**: Automatically load tools from MCP servers
- **Token Tracking**: Monitor API usage and costs

#### Usage

```typescript
import { getAgentRunner } from './lib/agent-runner';
import { AgentConfig, AgentContext } from './lib/types/agent';

const runner = getAgentRunner();

// Load tools from MCP servers
const tools = await runner.loadToolsFromMCP(['github', 'deploy']);

// Example 1: Using OpenAI (GPT)
const openaiConfig: AgentConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxIterations: 10,
  systemPrompt: 'You are a helpful assistant for managing GitHub repositories.',
};

// Example 2: Using DeepSeek
const deepseekConfig: AgentConfig = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  temperature: 0.7,
  maxIterations: 10,
  systemPrompt: 'You are a helpful assistant for managing GitHub repositories.',
};

// Example 3: Using Anthropic Claude
const claudeConfig: AgentConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxIterations: 10,
  systemPrompt: 'You are a helpful assistant for managing GitHub repositories.',
};

const context: AgentContext = {
  prompt: 'Create a branch called "feature/new-feature" from main in the codefactory-control repo',
  tools,
};

const result = await runner.execute(context, openaiConfig); // or deepseekConfig, or claudeConfig
console.log(result.response); // Final LLM response
console.log(result.toolCalls); // All tools called by the agent
console.log(result.usage); // Token usage statistics
```

#### Provider-Specific Configuration

**OpenAI:**
- Environment variable: `OPENAI_API_KEY`
- Models: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
- API: OpenAI API

**DeepSeek:**
- Environment variable: `DEEPSEEK_API_KEY`
- Models: `deepseek-chat`, `deepseek-coder`
- API: OpenAI-compatible API at `https://api.deepseek.com`

**Anthropic:**
- Environment variable: `ANTHROPIC_API_KEY`
- Models: `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`, `claude-3-sonnet-20240229`
- API: Anthropic API
```

#### Agent Execution Flow

1. Agent receives a prompt from the user
2. LLM processes the prompt with available tools
3. If LLM wants to call tools:
   - Tools are executed via MCP Client
   - Results are fed back to the LLM
   - Process repeats until LLM has a final response
4. Final response is returned to the user

#### Supported Providers

- **OpenAI** (GPT-4, GPT-4o, GPT-3.5): ✅ Implemented
- **DeepSeek**: ✅ Implemented (OpenAI-compatible API)
- **Anthropic** (Claude 3.5 Sonnet, Claude 3 Opus): ✅ Implemented
- **AWS Bedrock**: 🚧 Coming soon

## API Endpoints

Three new API endpoints are available for interacting with the workflow system:

### POST /api/workflow/execute

Execute a workflow.

**Request Body:**

```json
{
  "workflow": {
    "steps": [
      {
        "name": "example_step",
        "tool": "github.listIssues",
        "params": {
          "owner": "adaefler-art",
          "repo": "codefactory-control"
        },
        "assign": "issues"
      }
    ]
  },
  "context": {
    "variables": {},
    "input": {},
    "repo": {
      "owner": "adaefler-art",
      "name": "codefactory-control"
    }
  }
}
```

**Response:**

```json
{
  "executionId": "exec-1234567890-abc123",
  "status": "completed",
  "output": {
    "issues": [...]
  },
  "metadata": {
    "startedAt": "2025-12-11T20:00:00.000Z",
    "completedAt": "2025-12-11T20:00:05.000Z",
    "durationMs": 5000,
    "stepsCompleted": 1,
    "stepsTotal": 1
  }
}
```

### POST /api/agent/execute

Execute an LLM-based agent with tool calling.

**Request Body:**

```json
{
  "prompt": "List all open issues in the codefactory-control repository",
  "config": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.7
  },
  "serverNames": ["github"]
}
```

**Example with DeepSeek:**

```json
{
  "prompt": "Create a new branch called feature/add-tests",
  "config": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "temperature": 0.5
  },
  "serverNames": ["github"]
}
```

**Example with Anthropic Claude:**

```json
{
  "prompt": "Analyze the recent issues and create a summary",
  "config": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "serverNames": ["github"]
}
```

**Response:**

```json
{
  "response": "I found 5 open issues in the codefactory-control repository...",
  "messages": [...],
  "toolCalls": [
    {
      "tool": "github.listIssues",
      "arguments": {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "state": "open"
      },
      "result": [...]
    }
  ],
  "usage": {
    "promptTokens": 1234,
    "completionTokens": 567,
    "totalTokens": 1801
  },
  "metadata": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "iterations": 2,
    "durationMs": 3456
  }
}
```

### GET /api/mcp/health

Check the health of all MCP servers.

**Response:**

```json
{
  "status": "healthy",
  "servers": {
    "github": {
      "status": "ok",
      "server": "github",
      "timestamp": "2025-12-11T20:00:00.000Z"
    },
    "deploy": {
      "status": "ok",
      "server": "deploy",
      "timestamp": "2025-12-11T20:00:00.000Z"
    },
    "observability": {
      "status": "ok",
      "server": "observability",
      "timestamp": "2025-12-11T20:00:00.000Z"
    }
  },
  "timestamp": "2025-12-11T20:00:00.000Z"
}
```

## Type Definitions

### Workflow Types

**Location**: `control-center/src/lib/types/workflow.ts`

- `WorkflowDefinition` - Workflow structure
- `WorkflowStep` - Single workflow step
- `WorkflowContext` - Execution context with variables
- `WorkflowStatus` - Execution status
- `WorkflowExecutionResult` - Result of execution
- `WorkflowExecutionConfig` - Configuration options

### MCP Types

**Location**: `control-center/src/lib/types/mcp.ts`

- `JSONRPCRequest` - JSON-RPC 2.0 request
- `JSONRPCResponse` - JSON-RPC 2.0 response
- `MCPTool` - Tool definition
- `MCPServerConfig` - Server configuration
- `MCPServerHealth` - Health status

### Agent Types

**Location**: `control-center/src/lib/types/agent.ts`

- `AgentConfig` - Agent configuration
- `AgentTool` - Tool definition for agents
- `AgentMessage` - Message in conversation
- `AgentToolCall` - Tool call by agent
- `AgentExecutionResult` - Result of agent execution
- `AgentContext` - Agent execution context

## Examples

### Example 1: Simple Workflow

Execute a workflow to list issues:

```typescript
const workflow: WorkflowDefinition = {
  steps: [
    {
      name: 'list_issues',
      tool: 'github.listIssues',
      params: {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        state: 'open',
      },
      assign: 'issues',
    },
  ],
};

const context: WorkflowContext = {
  variables: {},
  input: {},
};

const engine = getWorkflowEngine();
const result = await engine.execute(workflow, context);
console.log(result.output.issues);
```

### Example 2: Agent with Tools

Let an agent autonomously work with GitHub:

```typescript
const runner = getAgentRunner();
const tools = await runner.loadToolsFromMCP(['github']);

const config: AgentConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: 'You help manage GitHub repositories.',
};

const context: AgentContext = {
  prompt: 'Create a new issue titled "Bug: Fix deployment" in codefactory-control',
  tools,
};

const result = await runner.execute(context, config);
console.log(result.response);
console.log(`Called ${result.toolCalls.length} tools`);
```

### Example 3: Complex Workflow with Variables

```typescript
const workflow: WorkflowDefinition = {
  steps: [
    {
      name: 'get_issue',
      tool: 'github.getIssue',
      params: {
        owner: '${repo.owner}',
        repo: '${repo.name}',
        number: '${input.issue_number}',
      },
      assign: 'issue',
    },
    {
      name: 'create_branch',
      tool: 'github.createBranch',
      params: {
        owner: '${repo.owner}',
        repo: '${repo.name}',
        branch: 'fix/${issue.number}',
        from: '${repo.default_branch}',
      },
      assign: 'branch',
    },
    {
      name: 'create_pr',
      tool: 'github.createPullRequest',
      params: {
        owner: '${repo.owner}',
        repo: '${repo.name}',
        title: 'Fix: ${issue.title}',
        body: 'Fixes #${issue.number}',
        head: 'fix/${issue.number}',
        base: '${repo.default_branch}',
      },
      assign: 'pr',
    },
  ],
};

const context: WorkflowContext = {
  variables: {},
  input: {
    issue_number: 1,
  },
  repo: {
    owner: 'adaefler-art',
    name: 'codefactory-control',
    default_branch: 'main',
  },
};

const result = await engine.execute(workflow, context);
console.log(`Created PR: ${result.output.pr.html_url}`);
```

## Testing

### Manual Testing

1. **Start MCP Servers**:

```bash
# Terminal 1: GitHub server
cd mcp-servers/github
npm install && npm run dev

# Terminal 2: Deploy server
cd mcp-servers/deploy
npm install && npm run dev

# Terminal 3: Observability server
cd mcp-servers/observability
npm install && npm run dev
```

2. **Start Control Center**:

```bash
cd control-center
npm run dev
```

3. **Test Health Check**:

```bash
curl http://localhost:3000/api/mcp/health
```

4. **Test Workflow Execution**:

```bash
curl -X POST http://localhost:3000/api/workflow/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "steps": [
        {
          "name": "list_issues",
          "tool": "github.listIssues",
          "params": {
            "owner": "adaefler-art",
            "repo": "codefactory-control"
          },
          "assign": "issues"
        }
      ]
    },
    "context": {
      "variables": {},
      "input": {}
    }
  }'
```

5. **Test Agent Execution**:

```bash
curl -X POST http://localhost:3000/api/agent/execute \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "List all issues in codefactory-control",
    "config": {
      "provider": "openai",
      "model": "gpt-4o-mini"
    },
    "serverNames": ["github"]
  }'
```

## Future Enhancements

- [ ] **Workflow Persistence**: Store workflows and executions in database
- [ ] **Workflow Scheduler**: Trigger workflows on events or schedules
- [ ] **Parallel Execution**: Execute independent steps concurrently
- [ ] **Workflow Visualization**: UI for viewing workflow progress
- [ ] **Agent Memory**: Persist agent conversation history
- [ ] **Custom Tools**: Allow users to define custom tools
- [x] **DeepSeek Integration**: Add DeepSeek support
- [x] **Anthropic Integration**: Add Claude support
- [ ] **Bedrock Integration**: Add AWS Bedrock support
- [ ] **Streaming Responses**: Stream agent responses in real-time
- [ ] **Cost Tracking**: Detailed cost analysis for LLM usage

## Troubleshooting

### MCP Server Connection Errors

**Problem**: Cannot connect to MCP server

**Solution**:
- Verify server is running: `curl http://localhost:3001/health`
- Check environment variables for server endpoints
- Ensure firewall allows connections

### Workflow Execution Fails

**Problem**: Workflow execution fails with tool errors

**Solution**:
- Check MCP server logs for errors
- Verify tool parameters are correct
- Test tool call directly using MCP Client
- Check that required environment variables are set (e.g., `GITHUB_TOKEN`)

### Agent Not Calling Tools

**Problem**: Agent responds without calling tools

**Solution**:
- Verify tools are loaded: check `tools` array in context
- Make prompt more explicit about what needs to be done
- Increase `maxIterations` if agent is stopping early
- Check API key is valid for your chosen provider:
  - OpenAI: `OPENAI_API_KEY`
  - DeepSeek: `DEEPSEEK_API_KEY`
  - Anthropic: `ANTHROPIC_API_KEY`

### LLM Provider Errors

**Problem**: Provider-specific errors

**OpenAI/DeepSeek:**
- Error: "OPENAI_API_KEY/DEEPSEEK_API_KEY is not configured"
  - Set the appropriate API key in environment variables
- Rate limit errors
  - Implement backoff or use a different model tier

**Anthropic:**
- Error: "ANTHROPIC_API_KEY is not configured"
  - Set your Anthropic API key in environment variables
- Model not found
  - Verify you're using a valid Claude model name
  - Example: `claude-3-5-sonnet-20241022`

## References

- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [AFU-9 Architecture Overview](./architecture/README.md)
- [MCP Servers README](../mcp-servers/README.md)
