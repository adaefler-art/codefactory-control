# Repository View - GitHub Integration

## Overview

The Repository View provides a comprehensive interface to monitor and manage GitHub repositories integrated with the AFU-9 system. It displays repository information from both the AFU-9 database and live GitHub API data.

## Features

### Repository List (`/repositories`)
- Display all registered repositories from the database
- Show repository name, owner, default branch
- Display enabled/disabled status
- Quick links to:
  - Detailed repository view with PRs and Issues
  - Repository information modal
  - GitHub repository page

### Repository Details (`/repositories/[id]`)

#### Three-Tab Interface

1. **Overview Tab**
   - **Summary Cards**: Quick statistics for PRs, Issues, and Workflow executions
   - **Automated PRs Section**: Highlights pull requests created by bots or AFU-9
     - Detects PRs created by bot accounts
     - Identifies PRs with `automated`, `afu-9`, or `bot` labels
   - **Important Issues Section**: Showcases critical issues
     - Issues with `bug`, `critical`, or `high-priority` labels
     - Issues with more than 5 comments
   - **Pipeline Status Section**: Recent workflow executions
     - Last 5 workflow runs for the repository
     - Status indicators (completed, failed, running, pending)
     - Links to GitHub Actions if available

2. **Pull Requests Tab**
   - Complete list of all open pull requests
   - Displays: number, title, author, creation date, branch info
   - Labels with color coding
   - Draft status indicator
   - Automated PR badge
   - Direct link to GitHub PR

3. **Issues Tab**
   - Complete list of all open issues
   - Displays: number, title, author, creation date, comment count
   - Labels with color coding
   - Important issue badge
   - Direct link to GitHub issue

## API Endpoints

### GET `/api/repositories/[id]`

Fetches comprehensive repository data including GitHub information.

**Response:**
```json
{
  "repository": {
    "id": "uuid",
    "owner": "string",
    "name": "string",
    "fullName": "owner/name",
    "defaultBranch": "main",
    "enabled": true,
    "config": {},
    "createdAt": "timestamp",
    "updatedAt": "timestamp",
    "executionsCount": 10
  },
  "pullRequests": [
    {
      "number": 123,
      "title": "string",
      "state": "open",
      "htmlUrl": "https://github.com/...",
      "createdAt": "timestamp",
      "updatedAt": "timestamp",
      "author": "username",
      "draft": false,
      "head": "feature-branch",
      "base": "main",
      "labels": [
        {"name": "enhancement", "color": "a2eeef"}
      ],
      "automated": false
    }
  ],
  "issues": [
    {
      "number": 456,
      "title": "string",
      "state": "open",
      "htmlUrl": "https://github.com/...",
      "createdAt": "timestamp",
      "updatedAt": "timestamp",
      "author": "username",
      "labels": [
        {"name": "bug", "color": "d73a4a"}
      ],
      "comments": 3,
      "important": true
    }
  ],
  "recentExecutions": [
    {
      "id": "uuid",
      "workflowId": "uuid",
      "status": "completed",
      "startedAt": "timestamp",
      "completedAt": "timestamp",
      "error": null,
      "triggeredBy": "username",
      "githubRunId": "123456"
    }
  ]
}
```

## Configuration

### Required Environment Variables

```bash
# GitHub API access
GITHUB_TOKEN=ghp_your_token_here

# Database connection (for workflow data)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=afu9
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
```

### GitHub Token Permissions

The GitHub token requires the following permissions:
- `repo:read` - Read repository information
- `issues:read` - Read issues
- `pull_requests:read` - Read pull requests

## Automated PR Detection

A pull request is marked as "automated" if:
1. The PR author's type is `Bot`, OR
2. The PR has one of the following labels:
   - `automated`
   - `afu-9`
   - `bot`

## Important Issue Detection

An issue is marked as "important" if:
1. It has one of the following labels:
   - `bug`
   - `critical`
   - `high-priority`
2. OR it has more than 5 comments

## UI/UX Features

### Dark Theme
- Consistent with AFU-9 Control Center design
- GitHub-inspired color scheme
- Responsive layout

### Navigation
- Breadcrumb navigation to return to repository list
- Tab-based interface for different views
- Quick actions buttons

### Status Indicators
- Color-coded workflow statuses:
  - Green: Completed successfully
  - Red: Failed
  - Blue: Running (with spinner animation)
  - Yellow: Pending

### External Links
- All GitHub links open in new tabs
- External link icons for clarity
- Hover states for better UX

## Technical Implementation

### Technologies Used
- **Next.js 16**: App Router with dynamic routes
- **TypeScript**: Full type safety
- **Octokit**: GitHub API client
- **PostgreSQL**: Workflow execution data
- **Tailwind CSS**: Styling

### Architecture
```
┌─────────────────────────────────────────────┐
│         Repository Details Page             │
│         (/repositories/[id])                │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
      ┌─────────────────────────┐
      │  API Route              │
      │  /api/repositories/[id] │
      └──────┬──────────┬───────┘
             │          │
    ┌────────▼──┐   ┌──▼─────────┐
    │ Database  │   │ GitHub API │
    │ (Postgres)│   │ (Octokit)  │
    └───────────┘   └────────────┘
```

### Error Handling
- Graceful degradation when GitHub token is missing
- Empty state messages for repositories without PRs/issues
- Proper error logging for debugging
- User-friendly error messages

## Future Enhancements

### Potential Features (Post v0.2)
- [ ] Filter PRs and issues by label
- [ ] Sort PRs and issues by date, comments, etc.
- [ ] Search functionality
- [ ] PR review status indicators
- [ ] CI/CD status checks display
- [ ] Merged PRs history
- [ ] Closed issues history
- [ ] Repository statistics and graphs
- [ ] Branch protection rules display
- [ ] Collaborator management
- [ ] Webhook configuration UI

## Troubleshooting

### No Data Displayed
- **Check GitHub token**: Ensure `GITHUB_TOKEN` is set in `.env.local`
- **Verify repository exists**: Check database for repository entry
- **Check API rate limits**: GitHub API has rate limits

### Database Connection Errors
- **Verify database is running**: Check PostgreSQL service
- **Check credentials**: Verify database environment variables
- **Run migrations**: Ensure database schema is up to date

### GitHub API Errors
- **Rate limit exceeded**: Wait or use authenticated token
- **Repository not found**: Verify repository name and access
- **Invalid token**: Generate new GitHub token

## Related Documentation
- [Control Center README](README.md)
- [Workflows Documentation](WORKFLOWS_UI.md)
- [Database Schema](../database/README.md)
