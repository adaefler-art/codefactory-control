# GitHub MCP Server

MCP (Model Context Protocol) server providing GitHub operations as tools for AFU-9.

## Overview

The GitHub MCP Server exposes GitHub API operations through a JSON-RPC 2.0 interface, allowing the AFU-9 Control Center to interact with GitHub repositories programmatically.

## Features

### Implemented Tools

1. **getIssue** - Get details of a specific GitHub issue
2. **listIssues** - List issues in a repository with filtering
3. **createBranch** - Create a new branch from an existing branch or commit
4. **commitFileChanges** - Commit one or multiple file changes to a branch
5. **createPullRequest** - Create a pull request between branches
6. **mergePullRequest** - Merge a pull request with different merge strategies

### Authentication

The server uses **GitHub App server-to-server authentication** exclusively:

- **GitHub App**: JWT + installation tokens (recommended, production-ready)
- **No PAT support**: Personal Access Tokens are not supported

#### Local Development

Set GitHub App credentials via environment variables:

```bash
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY_PEM="__PASTE_GITHUB_APP_PRIVATE_KEY_PEM_HERE__"
```

#### Production (AWS ECS)

In production, credentials are automatically loaded from AWS Secrets Manager:

- **Secret Name**: `afu9/github/app` (configurable via `GITHUB_APP_SECRET_ID`)
- **Secret Format**:
  ```json
  {
    "appId": "123456",
    "privateKeyPem": "__PASTE_GITHUB_APP_PRIVATE_KEY_PEM_HERE__"
  }
  ```

The ECS task definition is configured with IAM permissions to read this secret.

### Error Handling

The server provides comprehensive error handling for common GitHub API issues:

#### Rate Limiting (403 with rate limit exceeded)

```json
{
  "error": {
    "message": "GitHub API rate limit exceeded. Resets at 2025-12-12T11:00:00Z. Consider using a GitHub App for higher rate limits."
  }
}
```

#### Invalid Credentials (401)

```json
{
  "error": {
    "message": "Invalid GitHub credentials. Please check your GITHUB_TOKEN. The token may be expired or invalid."
  }
}
```

#### Missing Permissions (403)

```json
{
  "error": {
    "message": "Insufficient permissions for this operation. Please ensure your GitHub token has the required scopes."
  }
}
```

#### Resource Not Found (404)

```json
{
  "error": {
    "message": "Resource not found. Please verify the repository owner, name, and resource identifier."
  }
}
```

## Installation

### Prerequisites

- Node.js 20+
- npm 10+
- Valid GitHub token with appropriate permissions

### Install Dependencies

```bash
cd mcp-servers/github
npm install
```

## Usage

### Development Mode

Start the server with auto-reload:

```bash
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY_PEM="__PASTE_GITHUB_APP_PRIVATE_KEY_PEM_HERE__"
npm run dev
```

The server will start on port 3001 (configurable via `PORT` environment variable).

### Production Mode

Build and start the server:

```bash
npm run build
npm start
```

### Docker

Build the Docker image:

```bash
cd /path/to/mcp-servers
docker build -t afu9/mcp-github:latest -f github/Dockerfile .
```

Run the container:

```bash
docker run -d \
  --name mcp-github \
  -p 3001:3001 \
  -e GITHUB_APP_ID="123456" \
  -e GITHUB_APP_PRIVATE_KEY_PEM="..." \
  afu9/mcp-github:latest
```

## API Examples

### Health Check

```bash
curl http://localhost:3001/health
```

Response:

```json
{
  "status": "ok",
  "server": "mcp-github",
  "timestamp": "2025-12-12T10:00:00.000Z"
}
```

### List Available Tools

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/list",
    "params": {}
  }'
```

### Get Issue

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "tool": "getIssue",
      "arguments": {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "number": 1
      }
    }
  }'
```

### Create Branch

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tools/call",
    "params": {
      "tool": "createBranch",
      "arguments": {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "branch": "feature/new-feature",
        "from": "main"
      }
    }
  }'
```

### Commit File Changes

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "4",
    "method": "tools/call",
    "params": {
      "tool": "commitFileChanges",
      "arguments": {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "branch": "feature/new-feature",
        "message": "Add new feature implementation",
        "files": [
          {
            "path": "src/feature.ts",
            "content": "export const feature = () => { return \"Hello\"; };"
          },
          {
            "path": "README.md",
            "content": "# Updated README"
          }
        ]
      }
    }
  }'
```

### Create Pull Request

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "5",
    "method": "tools/call",
    "params": {
      "tool": "createPullRequest",
      "arguments": {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "title": "Add new feature",
        "body": "This PR adds a new feature to the application",
        "head": "feature/new-feature",
        "base": "main"
      }
    }
  }'
```

### Merge Pull Request

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "6",
    "method": "tools/call",
    "params": {
      "tool": "mergePullRequest",
      "arguments": {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "pull_number": 42,
        "commit_title": "Merge feature PR",
        "merge_method": "squash"
      }
    }
  }'
```

## Required GitHub App Permissions

Different operations require different permissions:

| Tool | Required Permissions |
|------|---------------------|
| `getIssue` | **Issues**: Read |
| `listIssues` | **Issues**: Read |
| `createBranch` | **Contents**: Read & Write |
| `commitFileChanges` | **Contents**: Read & Write |
| `createPullRequest` | **Pull Requests**: Read & Write, **Contents**: Read |
| `mergePullRequest` | **Pull Requests**: Read & Write |

For GitHub Apps, configure these permissions in your app settings:

- **Contents**: Read & Write (for branches and commits)
- **Pull Requests**: Read & Write (for PR operations)
- **Issues**: Read & Write (for issue operations)
- **Metadata**: Read (automatic, required)

## Creating a GitHub App

See the comprehensive guide in `docs/v065/GITHUB_AUTH_APP_ONLY.md` for step-by-step instructions on creating and configuring a GitHub App for AFU-9.

## Adding New Tools

See [ADDING-TOOLS.md](./ADDING-TOOLS.md) for a comprehensive guide on how to extend the server with new GitHub operations.

## Architecture

The server is built on the base MCP server implementation (`@afu9/mcp-base`) and uses the Octokit library for GitHub API interactions.

```
GitHubMCPServer
├── Extends: MCPServer (from @afu9/mcp-base)
├── Dependencies:
│   ├── express - HTTP server
│   ├── octokit - GitHub API client
│   └── @afu9/mcp-base - Base MCP server implementation
└── Features:
    ├── JSON-RPC 2.0 protocol
    ├── Tool registration and discovery
    ├── Comprehensive error handling
    └── Health check endpoint
```

## Testing

### Manual Testing

Use the provided example script:

```bash
./example-usage.sh
```

### Integration Testing

The server integrates with the AFU-9 Control Center, which can be tested end-to-end:

1. Start the GitHub MCP server
2. Start the Control Center
3. Create a feature briefing in the Control Center
4. Verify the GitHub operations are executed correctly

## Troubleshooting

### Server won't start

**Problem**: Server fails to start with GitHub App configuration errors

**Solution**: 
- Set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PEM` environment variables for local dev
- Ensure AWS Secrets Manager secret `afu9/github/app` exists and is accessible in production
- Verify IAM permissions allow reading the secret

### Rate limit errors

**Problem**: Getting 403 errors with rate limit messages

**Solution**: 
- GitHub Apps have higher rate limits than PATs (5,000 requests/hour per installation)
- Installation tokens are repository-scoped and reset independently
- Wait for the rate limit to reset or use different repositories

### Installation not found

**Problem**: "Failed to get installation for owner/repo"

**Solution**:
- Install the GitHub App on the target repository
- Verify the app has access to the organization/user
- Check that the repository owner and name are correct

### Permission errors

**Problem**: Getting 403 errors for specific operations

**Solution**: 
- Verify your token has the required scopes
- For organization repositories, ensure the token has access to the organization
- Check if repository-level permissions are configured correctly

### Tool calls timing out

**Problem**: Operations take too long or time out

**Solution**:
- Check GitHub API status: https://www.githubstatus.com/
- Verify network connectivity
- For large file operations, consider batching or using Git LFS

## Monitoring

The server logs all operations in structured JSON format:

```json
{
  "timestamp": "2025-12-12T10:00:00.000Z",
  "level": "info",
  "component": "mcp-github",
  "tool": "getIssue",
  "duration_ms": 234,
  "status": "success"
}
```

In production (ECS), logs are sent to CloudWatch Logs:

- **Log Group**: `/ecs/afu9/mcp-github`
- **Retention**: 7 days

## Security

- **Never commit private keys**: Always use environment variables or Secrets Manager
- **Use least privilege**: Grant only the minimum required permissions
- **Rotate keys regularly**: Implement a key rotation policy (see docs/v065/GITHUB_AUTH_APP_ONLY.md)
- **Audit access**: Review GitHub audit logs regularly
- **Installation tokens**: Short-lived (1 hour), automatically rotated per operation

## Performance

- **Connection pooling**: Octokit reuses connections automatically
- **Rate limiting**: Built-in Octokit rate limit handling
- **Timeouts**: 30-second default timeout for GitHub API calls
- **Caching**: Consider implementing caching for frequently accessed data

## Resources

- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [Octokit Documentation](https://octokit.github.io/rest.js/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [GitHub Apps Documentation](https://docs.github.com/en/apps)
- [GitHub API Rate Limits](https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api)

## Support

For issues or questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Review server logs for detailed error messages
3. Consult the [main MCP servers README](../README.md)
4. Open an issue in the repository

## License

Part of the AFU-9 (codefactory-control) project.
