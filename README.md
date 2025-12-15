# codefactory-control

Control-plane for AFU-9 (Autonomous Fabrication Unit – Ninefold Architecture).

`codefactory-control` orchestrates autonomous code fabrication across GitHub repositories using:
- AWS ECS Fargate (Control Center + MCP Servers)
- AWS Lambda & Step Functions (v0.1 pipeline)
- RDS Postgres (workflow state)
- GitHub Actions
- External LLMs (optional)

## Versions

- **v0.1**: Walking skeleton with Lambda-based pipeline  
  **Flow**: Issue → AFU-9 Pipeline → Patch → Branch → Pull Request → CI Feedback
  
- **v0.2**: Production-ready architecture on ECS with MCP pattern  
  **Features**: Control Center UI, MCP-based tool architecture, RDS persistence, scalable infrastructure, comprehensive alerting and monitoring with Red/Yellow/Green health indicators

## Repository Structure

```
codefactory-control/
├── bin/                      # CDK entry point
├── lib/                      # CDK stack definitions
│   ├── codefactory-control-stack.ts       # v0.1 Lambda stack
│   └── afu9-infrastructure-stack.ts       # v0.2 ECS stack (WIP)
├── infra/lambdas/            # Lambda function implementations (v0.1)
├── control-center/           # Next.js Control Center app
├── mcp-servers/              # MCP server implementations (v0.2)
│   ├── base/                 # Base MCP server
│   ├── github/               # GitHub operations
│   ├── deploy/               # AWS ECS deployments
│   └── observability/        # CloudWatch monitoring
├── database/migrations/      # Database schema migrations
├── docs/                     # Architecture documentation
│   ├── architecture/         # Detailed architecture docs
│   └── DEPLOYMENT.md         # Deployment guide
└── scripts/                  # Utility scripts
```

### Infrastructure & CDK
The root directory contains AWS CDK infrastructure:
- `bin/` - CDK entry point
- `lib/` - CDK stack definitions (Lambda v0.1 + ECS v0.2)
- `infra/` - Lambda function implementations
- `package.json` - Infrastructure dependencies

### Control Center (Next.js)
The `control-center/` directory contains the web application:
- Next.js 16 App Router
- TypeScript
- Tailwind CSS
- See [`control-center/README.md`](control-center/README.md) for details

### MCP Servers
The `mcp-servers/` directory contains specialized microservices:
- GitHub operations (issues, PRs, branches)
- AWS ECS deployments
- CloudWatch observability
- See [`mcp-servers/README.md`](mcp-servers/README.md) for details

## Quick Start

### Development (Local)

1. **Install dependencies**:
```bash
npm install
cd control-center && npm install && cd ..
```

2. **Run Control Center locally**:
```bash
cd control-center
cp .env.local.template .env.local
# Edit .env.local with your credentials
npm run dev
```

3. **Enable Debug Mode** (optional):
Debug mode provides verbose logging for troubleshooting workflows, agents, and MCP communication.
```bash
# In .env.local or .env
AFU9_DEBUG_MODE=true
```

When debug mode is enabled:
- Detailed workflow step execution logs
- LLM request/response tracking
- MCP JSON-RPC request/response details
- Variable substitution and context updates
- Tool call parameter inspection

4. **Run MCP servers locally** (optional):
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

### Deployment (AWS)

**v0.2 ECS Deployment (Recommended):**

See [docs/AWS_DEPLOY_RUNBOOK.md](docs/AWS_DEPLOY_RUNBOOK.md) for the **complete staging deployment runbook** (Source of Truth).

Also available:
- [docs/ECS-DEPLOYMENT.md](docs/ECS-DEPLOYMENT.md) - Detailed ECS deployment guide
- [docs/HTTPS-DNS-SETUP.md](docs/HTTPS-DNS-SETUP.md) - HTTPS/DNS configuration

**Quick Staging Deploy:**

```bash
# 1. Bootstrap CDK (first time only)
npx cdk bootstrap

# 2. Deploy infrastructure stacks (staging config)
npx cdk deploy Afu9NetworkStack --context environment=staging --context afu9-enable-https=false
npx cdk deploy Afu9DatabaseStack --context environment=staging
npx cdk deploy Afu9EcsStack --context environment=staging

# 3. Configure secrets in AWS Secrets Manager
# (See AWS_DEPLOY_RUNBOOK.md for details)

# 4. Build and push Docker images
# (Use GitHub Actions or manual build - see runbook)

# 5. Run smoke tests
./scripts/smoke-test-staging.sh <ALB_DNS>
```

**v0.1 Lambda Deployment (Legacy):**

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Lambda-based deployment.

## Architecture

### v0.2 Architecture (Current)

AFU-9 v0.2 uses a modern, scalable architecture:

- **ECS Fargate**: Control Center + 3 MCP server sidecars
- **RDS Postgres**: Workflow state and execution history
- **ALB**: HTTPS termination and load balancing
- **S3**: Artifacts, logs, and backup storage
- **CloudWatch**: Centralized logging and monitoring
- **Secrets Manager**: Secure credential storage

**MCP Pattern**: AFU-9 acts as an MCP-Client, consuming specialized MCP-Servers for different domains (GitHub, Deploy, Observability).

**📚 Documentation:**
- [Architecture Overview](docs/architecture/README.md) - Technical architecture details
- [Complete Architecture Guide (German)](docs/architecture/afu9-v0.2-overview.md) - Comprehensive guide with AWS components, MCP pattern, and development workflow integration
- [Workflow Schema](docs/WORKFLOW-SCHEMA.md) - Complete workflow model and JSON format specification
- [Workflow Engine](docs/WORKFLOW-ENGINE.md) - Workflow execution and agent runner documentation
- [Database Schema](docs/architecture/database-schema.md) - Database structure and workflow persistence
- [Logging Concept](docs/LOGGING.md) - Structured logging, CloudWatch integration, and log searching
- [Observability](docs/OBSERVABILITY.md) - Monitoring, alarms, and observability features

### v0.1 Architecture (Legacy)

Lambda-based pipeline with Step Functions orchestration. Still functional for simple workflows.

## Components

### Infrastructure (CDK)

AWS CDK infrastructure for deploying the complete stack.

```bash
npm install
npx cdk synth              # Generate CloudFormation
npx cdk deploy            # Deploy to AWS
```

Stacks:
- `CodefactoryControlStack` - v0.1 Lambda-based pipeline
- `Afu9InfrastructureStack` - v0.2 ECS-based infrastructure

### Control Center (Next.js)

Web UI for workflow management and feature intake.

Features:
- Feature briefing input form
- LLM-powered specification generation
- Automatic GitHub issue creation
- Workflow execution dashboard
- MCP server status monitoring
- **System Health Dashboard**: Red/Yellow/Green health status indicators
- **Real-time Alerting**: CloudWatch alarms visualization and monitoring

See [`control-center/README.md`](control-center/README.md) for details.

### MCP Servers

Specialized microservices providing domain-specific tools:

- **GitHub** (port 3001): Issue/PR/branch operations
- **Deploy** (port 3002): ECS service deployments
- **Observability** (port 3003): CloudWatch logs/metrics

See [`mcp-servers/README.md`](mcp-servers/README.md) for details.

## Alerting & Monitoring

AFU-9 includes comprehensive infrastructure monitoring with CloudWatch alarms and visual health indicators:

**Dashboard Features**:
- 🟢 **Green (Healthy)**: All systems operational
- 🟡 **Yellow (Warning)**: Degraded performance or insufficient data
- 🔴 **Red (Critical)**: Active alarms requiring attention

**Notification Channels**:
- Email notifications via Amazon SNS
- Slack/Teams/webhook notifications via Lambda function

**Monitored Metrics**:
- ECS service health (CPU, Memory, Task count)
- RDS database performance (CPU, Storage, Connections)
- ALB health (5xx errors, Response time, Unhealthy targets)

See [`docs/ALERTING.md`](docs/ALERTING.md) for complete setup guide.
