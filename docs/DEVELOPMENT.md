# AFU-9 v0.2 Development Guide

This guide covers local development setup for AFU-9 Control Center and MCP servers.

## Prerequisites

- **Node.js**: 20.x or higher
- **npm**: 10.x or higher
- **Docker**: Latest version
- **Docker Compose**: v2.0 or higher
- **PostgreSQL** (optional, if not using Docker)
- **Git**: Latest version

## Quick Start with Docker Compose

The fastest way to get started is using Docker Compose, which runs all services together:

### 1. Clone and Configure

```bash
# Clone the repository
git clone https://github.com/adaefler-art/codefactory-control.git
cd codefactory-control

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env  # or your preferred editor
```

Required environment variables:
- `GITHUB_TOKEN` - GitHub personal access token
- `OPENAI_API_KEY` - OpenAI API key
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - For MCP servers (optional for local dev)

### 2. Start All Services

```bash
# Build and start all containers
docker-compose up -d

# View logs
docker-compose logs -f

# Check service health
curl http://localhost:3000/api/health  # Control Center
curl http://localhost:3001/health      # GitHub MCP Server
curl http://localhost:3002/health      # Deploy MCP Server
curl http://localhost:3003/health      # Observability MCP Server
```

### 3. Initialize Database

The database will be automatically initialized with the schema on first run (via `docker-entrypoint-initdb.d`).

To manually run migrations:

```bash
docker exec -i afu9-postgres psql -U afu9_admin -d afu9 < database/migrations/001_initial_schema.sql
```

### 4. Access Services

- **Control Center UI**: http://localhost:3000
- **MCP GitHub Server**: http://localhost:3001
- **MCP Deploy Server**: http://localhost:3002
- **MCP Observability Server**: http://localhost:3003
- **PostgreSQL**: localhost:5432 (user: afu9_admin, password: dev_password, db: afu9)

### 5. Stop Services

```bash
# Stop containers
docker-compose down

# Stop and remove volumes (deletes database data)
docker-compose down -v
```

## Local Development (Without Docker)

For faster iteration during development, you can run services locally without Docker:

### 1. Install Dependencies

```bash
# Root (CDK infrastructure)
npm install

# Control Center
cd control-center
npm install
cd ..

# MCP Servers
cd mcp-servers/base && npm install && cd ../..
cd mcp-servers/github && npm install && cd ../..
cd mcp-servers/deploy && npm install && cd ../..
cd mcp-servers/observability && npm install && cd ../..
```

### 2. Start PostgreSQL

```bash
# Using Docker
docker run -d \
  --name afu9-postgres \
  -e POSTGRES_DB=afu9 \
  -e POSTGRES_USER=afu9_admin \
  -e POSTGRES_PASSWORD=dev_password \
  -p 5432:5432 \
  postgres:15-alpine

# Or use local PostgreSQL installation
createdb -U postgres afu9
```

### 3. Run Migrations

```bash
psql -h localhost -U afu9_admin -d afu9 -f database/migrations/001_initial_schema.sql
```

### 4. Start Services (in separate terminals)

```bash
# Terminal 1: Control Center
cd control-center
cp .env.local.template .env.local
# Edit .env.local with your credentials
npm run dev

# Terminal 2: GitHub MCP Server
cd mcp-servers/github
export GITHUB_TOKEN=your_token
npm run dev

# Terminal 3: Deploy MCP Server
cd mcp-servers/deploy
export AWS_REGION=eu-central-1
npm run dev

# Terminal 4: Observability MCP Server
cd mcp-servers/observability
export AWS_REGION=eu-central-1
npm run dev
```

## Development Workflows

### Making Changes to Control Center

```bash
cd control-center

# Start development server (hot reload)
npm run dev

# Lint code
npm run lint

# Build for production
npm run build

# Test production build locally
npm run build && npm start
```

### Making Changes to MCP Servers

```bash
cd mcp-servers/github  # or deploy, observability

# Start in development mode (auto-restart on changes)
npm run dev

# Build TypeScript
npm run build

# Run built version
npm start

# Test with curl
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "test",
    "method": "tools/list",
    "params": {}
  }'
```

### Making Changes to CDK Infrastructure

```bash
# Build TypeScript
npm run build

# Synthesize CloudFormation templates
npm run synth

# Check for differences
npx cdk diff

# Deploy changes
npx cdk deploy
```

## Testing

### Unit Tests (TODO)

```bash
# Control Center
cd control-center
npm test

# MCP Servers
cd mcp-servers/github
npm test
```

### Integration Tests

Test MCP protocol communication:

```bash
# Save test script
cat > test-mcp.sh << 'EOF'
#!/bin/bash

# Test GitHub MCP Server
echo "Testing GitHub MCP Server..."
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/list",
    "params": {}
  }' | jq

# Test tool call
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
  }' | jq
EOF

chmod +x test-mcp.sh
./test-mcp.sh
```

### Manual Testing Checklist

- [ ] Control Center loads at http://localhost:3000
- [ ] Health check endpoints return 200 OK
- [ ] Database connection works (check Control Center logs)
- [ ] MCP servers respond to tool list requests
- [ ] GitHub MCP server can fetch issues
- [ ] Deploy MCP server can get ECS service status (if AWS configured)
- [ ] Observability MCP server can query CloudWatch (if AWS configured)

## Database Management

### View Database Contents

```bash
# Connect to database
docker exec -it afu9-postgres psql -U afu9_admin -d afu9

# Or from host (if PostgreSQL client installed)
psql -h localhost -U afu9_admin -d afu9
```

Useful queries:

```sql
-- List all tables
\dt

-- View workflows
SELECT id, name, enabled FROM workflows;

-- View MCP servers
SELECT name, endpoint, enabled FROM mcp_servers;

-- View recent workflow executions
SELECT id, workflow_id, status, started_at 
FROM workflow_executions 
ORDER BY started_at DESC 
LIMIT 10;
```

### Reset Database

```bash
# Drop and recreate
docker exec -it afu9-postgres psql -U afu9_admin -d postgres -c "DROP DATABASE afu9;"
docker exec -it afu9-postgres psql -U afu9_admin -d postgres -c "CREATE DATABASE afu9;"
docker exec -i afu9-postgres psql -U afu9_admin -d afu9 < database/migrations/001_initial_schema.sql
```

### Backup and Restore

```bash
# Backup
docker exec afu9-postgres pg_dump -U afu9_admin afu9 > backup.sql

# Restore
docker exec -i afu9-postgres psql -U afu9_admin afu9 < backup.sql
```

## Debugging

### View Logs

```bash
# Docker Compose
docker-compose logs -f control-center
docker-compose logs -f mcp-github
docker-compose logs -f mcp-deploy
docker-compose logs -f mcp-observability
docker-compose logs -f postgres

# Individual containers
docker logs -f afu9-control-center
```

### Inspect Container

```bash
# Get shell in container
docker exec -it afu9-control-center sh

# Check environment variables
docker exec afu9-control-center env

# Check running processes
docker exec afu9-control-center ps aux
```

### Debug Node.js

Add `--inspect` flag to Node.js:

```bash
# In package.json
"dev": "NODE_OPTIONS='--inspect=0.0.0.0:9229' next dev"

# Connect with Chrome DevTools
# Open chrome://inspect in Chrome
```

## Code Style and Linting

### Control Center

```bash
cd control-center
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues (if available)
```

### TypeScript

```bash
# Type check without building
npx tsc --noEmit

# Type check specific file
npx tsc --noEmit control-center/app/page.tsx
```

## Common Issues

### Port Already in Use

```bash
# Find process using port
lsof -i :3000  # or 3001, 3002, 3003, 5432

# Kill process
kill -9 <PID>
```

### Docker Build Fails

```bash
# Clean up Docker
docker system prune -a

# Rebuild without cache
docker-compose build --no-cache
```

### Database Connection Fails

- Check PostgreSQL is running: `docker ps | grep postgres`
- Check database exists: `docker exec afu9-postgres psql -U afu9_admin -l`
- Check credentials in `.env` or `.env.local`
- Check network connectivity: `docker network inspect codefactory-control_default`

### MCP Server Not Responding

- Check server is running: `curl http://localhost:3001/health`
- Check logs for errors: `docker logs afu9-mcp-github`
- Verify environment variables: `docker exec afu9-mcp-github env`
- Test JSON-RPC directly with curl

## Performance Tips

- Use `npm run dev` for hot reload during development
- Use Docker Compose for full-stack integration testing
- Keep Docker images updated: `docker-compose pull`
- Monitor resource usage: `docker stats`
- Use `.dockerignore` to speed up builds

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "feat: your feature description"

# Push to remote
git push origin feature/your-feature-name

# Create pull request on GitHub
```

## Environment Variables Reference

### Control Center

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | HTTP port | No | 3000 |
| `NODE_ENV` | Environment | No | development |
| `DATABASE_URL` | Postgres connection string | Yes | - |
| `GITHUB_TOKEN` | GitHub PAT | Yes | - |
| `GITHUB_OWNER` | GitHub org/user | No | - |
| `GITHUB_REPO` | Target repo | No | - |
| `OPENAI_API_KEY` | OpenAI API key | Yes | - |
| `MCP_GITHUB_ENDPOINT` | GitHub MCP server URL | No | http://localhost:3001 |
| `MCP_DEPLOY_ENDPOINT` | Deploy MCP server URL | No | http://localhost:3002 |
| `MCP_OBSERVABILITY_ENDPOINT` | Observability MCP server URL | No | http://localhost:3003 |

### MCP Servers

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | HTTP port | No | 3001/3002/3003 |
| `NODE_ENV` | Environment | No | development |
| `GITHUB_TOKEN` | GitHub PAT (GitHub server only) | Yes | - |
| `AWS_REGION` | AWS region (Deploy/Obs servers) | No | eu-central-1 |
| `AWS_ACCESS_KEY_ID` | AWS credentials | No | - |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials | No | - |

## Additional Resources

- [Architecture Documentation](../docs/architecture/README.md)
- [Deployment Guide](../docs/DEPLOYMENT.md)
- [MCP Server Guide](../mcp-servers/README.md)
- [Control Center README](../control-center/README.md)
- [Next.js Documentation](https://nextjs.org/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Docker Documentation](https://docs.docker.com/)

## Getting Help

1. Check logs for error messages
2. Review this development guide
3. Check architecture documentation
4. Search existing GitHub issues
5. Create a new issue with:
   - Environment details (OS, Node version, Docker version)
   - Steps to reproduce
   - Error logs
   - Expected vs actual behavior
