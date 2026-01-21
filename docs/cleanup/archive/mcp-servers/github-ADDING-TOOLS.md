# Adding New GitHub Tools

This guide explains how to add new tools to the GitHub MCP Server.

## Overview

The GitHub MCP Server provides GitHub operations as tools through the JSON-RPC 2.0 based MCP protocol. Each tool represents a specific GitHub API operation.

## Prerequisites

- Understanding of GitHub API and Octokit
- TypeScript knowledge
- Familiarity with the MCP protocol

## Step-by-Step Guide

### 1. Register the Tool

Add the tool definition in the `registerTools()` method of `GitHubMCPServer` class in `src/index.ts`:

```typescript
this.tools.set('myNewTool', {
  name: 'myNewTool',
  description: 'Brief description of what the tool does',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      // Add more parameters as needed
      myParam: { 
        type: 'string', 
        description: 'Description of the parameter' 
      },
    },
    required: ['owner', 'repo', 'myParam'], // List required parameters
  },
});
```

**Tips:**
- Use descriptive names that clearly indicate the tool's purpose
- Always include helpful descriptions for the tool and each parameter
- Mark parameters as required only if they are truly mandatory
- Use appropriate JSON Schema types: `string`, `number`, `boolean`, `array`, `object`
- For enums, use: `{ type: 'string', enum: ['option1', 'option2'] }`

### 2. Add Tool Handler

Add a case in the `handleToolCall()` method to route calls to your implementation:

```typescript
protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
  switch (tool) {
    // ... existing cases
    case 'myNewTool':
      return this.myNewTool(args as { owner: string; repo: string; myParam: string });
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
```

### 3. Implement the Tool Method

Create a private method that implements the tool logic:

```typescript
private async myNewTool(args: { owner: string; repo: string; myParam: string }) {
  return this.handleGitHubAPICall(async () => {
    const { owner, repo, myParam } = args;
    
    // Use Octokit to call GitHub API
    const { data } = await this.octokit.rest.someCategory.someMethod({
      owner,
      repo,
      // ... other parameters
    });

    // Return a clean, structured response
    return {
      // Include only relevant fields
      id: data.id,
      name: data.name,
      // ... other fields
    };
  });
}
```

**Best Practices:**
- Always wrap API calls with `this.handleGitHubAPICall()` for consistent error handling
- Destructure arguments at the start for clarity
- Return clean, structured objects with only relevant fields
- Use descriptive variable names
- Add comments for complex logic

### 4. Error Handling

The `handleGitHubAPICall()` wrapper automatically handles common errors:

- **Rate Limits (403)**: Provides reset time and suggests using GitHub App
- **Authentication (401)**: Indicates invalid or expired token
- **Permissions (403)**: Explains missing scopes or permissions
- **Not Found (404)**: Suggests verifying resource identifiers
- **Other Errors**: Provides status code and error message

You can add custom error handling for specific cases:

```typescript
private async myNewTool(args: { owner: string; repo: string; myParam: string }) {
  return this.handleGitHubAPICall(async () => {
    const { owner, repo, myParam } = args;
    
    // Validate input
    if (!myParam || myParam.trim() === '') {
      throw new Error('myParam cannot be empty');
    }
    
    // Custom validation
    if (myParam.length > 100) {
      throw new Error('myParam must be 100 characters or less');
    }
    
    const { data } = await this.octokit.rest.someCategory.someMethod({
      owner,
      repo,
      my_param: myParam,
    });

    return { /* ... */ };
  });
}
```

### 5. Update Documentation

Update the tool list in the class documentation at the top of `src/index.ts`:

```typescript
/**
 * GitHub MCP Server
 * 
 * Provides GitHub operations as MCP tools:
 * - github.getIssue
 * - github.listIssues
 * - github.createBranch
 * - github.commitFileChanges
 * - github.createPullRequest
 * - github.mergePullRequest
 * - github.myNewTool  // <-- Add your tool here
 */
```

Also update the main `mcp-servers/README.md` if your tool is significant.

### 6. Test the Tool

#### 6.1 Build and Start the Server

```bash
cd mcp-servers/github
npm run build
export GITHUB_TOKEN=your_token_here
npm run dev
```

#### 6.2 List Available Tools

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

Verify your new tool appears in the response.

#### 6.3 Test Your Tool

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "tool": "myNewTool",
      "arguments": {
        "owner": "test-owner",
        "repo": "test-repo",
        "myParam": "test-value"
      }
    }
  }'
```

#### 6.4 Test Error Scenarios

Test with invalid inputs to verify error handling:

```bash
# Test with invalid token (401)
GITHUB_TOKEN=invalid npm run dev

# Test with non-existent repository (404)
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tools/call",
    "params": {
      "tool": "myNewTool",
      "arguments": {
        "owner": "nonexistent",
        "repo": "nonexistent",
        "myParam": "test"
      }
    }
  }'
```

## Examples

### Example 1: Get Repository Information

```typescript
// 1. Register the tool
this.tools.set('getRepository', {
  name: 'getRepository',
  description: 'Get repository information',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
    },
    required: ['owner', 'repo'],
  },
});

// 2. Add handler
case 'getRepository':
  return this.getRepository(args as { owner: string; repo: string });

// 3. Implement method
private async getRepository(args: { owner: string; repo: string }) {
  return this.handleGitHubAPICall(async () => {
    const { owner, repo } = args;
    
    const { data } = await this.octokit.rest.repos.get({
      owner,
      repo,
    });

    return {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      description: data.description,
      private: data.private,
      html_url: data.html_url,
      default_branch: data.default_branch,
      stars: data.stargazers_count,
      forks: data.forks_count,
    };
  });
}
```

### Example 2: Create Label

```typescript
// 1. Register the tool
this.tools.set('createLabel', {
  name: 'createLabel',
  description: 'Create a label in a repository',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      name: { type: 'string', description: 'Label name' },
      color: { type: 'string', description: 'Label color (hex without #)' },
      description: { type: 'string', description: 'Label description' },
    },
    required: ['owner', 'repo', 'name', 'color'],
  },
});

// 2. Add handler
case 'createLabel':
  return this.createLabel(args as {
    owner: string;
    repo: string;
    name: string;
    color: string;
    description?: string;
  });

// 3. Implement method
private async createLabel(args: {
  owner: string;
  repo: string;
  name: string;
  color: string;
  description?: string;
}) {
  return this.handleGitHubAPICall(async () => {
    const { owner, repo, name, color, description } = args;
    
    // Validate color format
    if (!/^[0-9A-Fa-f]{6}$/.test(color)) {
      throw new Error('Color must be a 6-character hex code without #');
    }

    const { data } = await this.octokit.rest.issues.createLabel({
      owner,
      repo,
      name,
      color,
      description,
    });

    return {
      id: data.id,
      name: data.name,
      color: data.color,
      description: data.description,
      url: data.url,
    };
  });
}
```

### Example 3: List Commits

```typescript
// 1. Register the tool
this.tools.set('listCommits', {
  name: 'listCommits',
  description: 'List commits in a repository',
  inputSchema: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      sha: { type: 'string', description: 'SHA or branch to list commits from' },
      per_page: { type: 'number', description: 'Results per page (max 100)' },
    },
    required: ['owner', 'repo'],
  },
});

// 2. Add handler
case 'listCommits':
  return this.listCommits(args as {
    owner: string;
    repo: string;
    sha?: string;
    per_page?: number;
  });

// 3. Implement method
private async listCommits(args: {
  owner: string;
  repo: string;
  sha?: string;
  per_page?: number;
}) {
  return this.handleGitHubAPICall(async () => {
    const { owner, repo, sha, per_page = 30 } = args;
    
    const { data } = await this.octokit.rest.repos.listCommits({
      owner,
      repo,
      sha,
      per_page: Math.min(per_page, 100), // Enforce max
    });

    return data.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name,
      date: commit.commit.author?.date,
      html_url: commit.html_url,
    }));
  });
}
```

## Common Patterns

### Working with Files

```typescript
// Read file content
const { data } = await this.octokit.rest.repos.getContent({
  owner,
  repo,
  path: 'path/to/file.txt',
});

// Ensure data is a file, not a directory
if (!('content' in data)) {
  throw new Error('Path is a directory, not a file');
}

const content = Buffer.from(data.content, 'base64').toString('utf-8');
```

### Working with References

```typescript
// Get branch SHA
const { data: refData } = await this.octokit.rest.git.getRef({
  owner,
  repo,
  ref: `heads/${branch}`,
});
const sha = refData.object.sha;

// Create/update a tag
await this.octokit.rest.git.createRef({
  owner,
  repo,
  ref: `refs/tags/${tag}`,
  sha,
});
```

### Pagination

```typescript
// Use iterator for large result sets
const issues = await this.octokit.paginate(
  this.octokit.rest.issues.listForRepo,
  {
    owner,
    repo,
    state: 'all',
    per_page: 100,
  }
);
```

## GitHub Token Scopes

Different operations require different token scopes:

| Operation | Required Scopes |
|-----------|----------------|
| Read public repos | No token needed (rate limited) |
| Read private repos | `repo` or `read:org` |
| Create issues/PRs | `repo` or `public_repo` |
| Create branches | `repo` |
| Commit files | `repo` |
| Merge PRs | `repo` |
| Manage webhooks | `admin:repo_hook` |
| Manage team members | `admin:org` |

For GitHub Apps, see [GitHub Apps Permissions](https://docs.github.com/en/rest/overview/permissions-required-for-github-apps).

## Troubleshooting

### Tool Not Found

**Symptom**: `Tool not found: myNewTool`

**Solution**: 
- Verify tool name matches exactly in `registerTools()` and `handleToolCall()`
- Rebuild the server: `npm run build`
- Restart the server

### Type Errors

**Symptom**: TypeScript compilation errors

**Solution**:
- Ensure proper type casting in `handleToolCall()`: `args as { ... }`
- Check that method signature matches the cast type
- Run `npm run build` to see detailed errors

### API Errors

**Symptom**: 404, 403, or other GitHub API errors

**Solution**:
- Check [GitHub API documentation](https://docs.github.com/en/rest) for correct endpoint
- Verify token has required scopes
- Test with Octokit directly in a script first
- Check parameter names match GitHub API (e.g., `issue_number` not `number`)

## Resources

- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [Octokit Documentation](https://octokit.github.io/rest.js/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
- [JSON Schema Documentation](https://json-schema.org/)

## Getting Help

If you encounter issues:

1. Check the server logs for detailed error messages
2. Test the GitHub API call directly with Octokit
3. Verify your token has the required permissions
4. Review existing tool implementations for patterns
5. Consult GitHub API documentation for the specific endpoint

Happy coding! 🚀
