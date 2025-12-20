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

# 5. Run post-deployment verification (automated in GitHub Actions)
./scripts/post-deploy-verification.sh stage afu9-cluster afu9-control-center-stage <ALB_DNS>

# 6. Run smoke tests
./scripts/smoke-test-staging.sh <ALB_DNS>
```

**Automated Verification:**

All deployments via GitHub Actions automatically run post-deployment verification checks:
- ECS service events (no Circuit Breaker issues)
- ALB target health (all targets green)
- Service stability (desired task count reached)
- Health and readiness endpoints

See [docs/POST_DEPLOY_VERIFICATION.md](docs/POST_DEPLOY_VERIFICATION.md) for details.

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
- [Control Plane Specification](docs/CONTROL_PLANE_SPEC.md) - Standardized health/readiness endpoints for all services
- [Factory Status API](docs/FACTORY_STATUS_API.md) - Central Factory Status API for aggregated runs, errors, and KPIs

**📊 KPI System (EPIC 3):**
- [KPI Definitions](docs/KPI_DEFINITIONS.md) - **CANONICAL**: Single source of truth for all Factory KPIs
- [KPI Governance](docs/KPI_GOVERNANCE.md) - **NEW**: Change management and governance framework
- [KPI Changelog](docs/KPI_CHANGELOG.md) - **NEW**: Complete version history and change tracking
- [KPI API](docs/KPI_API.md) - REST API documentation and usage examples

**💰 Cost & Efficiency Engine (EPIC 9):**
- [Cost Attribution Guide](docs/COST_ATTRIBUTION.md) - **CANONICAL**: Transparent cost tracking and economic steering
- Cost per Outcome KPI in [KPI Definitions](docs/KPI_DEFINITIONS.md#12-cost-per-outcome)
- API: `/api/v1/costs/{runs,products,factory,export}` - Cost data and export endpoints

**🎯 Prompt Library (EPIC 6):**
- [Prompt Library Canon](docs/PROMPT_LIBRARY_CANON.md) - **CANONICAL**: Single source of truth for all Factory prompts
- [Prompt Governance](docs/PROMPT_GOVERNANCE.md) - **NEW**: Versioning rules and change management
- [Prompt Library Integration](docs/PROMPT_LIBRARY_INTEGRATION.md) - **NEW**: Integration guide for workflows and agents
- [Prompt Library Changelog](docs/PROMPT_LIBRARY_CHANGELOG.md) - **NEW**: Complete change history and audit trail
- [Prompt Library](docs/PROMPT_LIBRARY.md) - Technical implementation and API reference

**🔒 Governance & Standards:**
- [Confidence Score Schema](docs/CONFIDENCE_SCORE_SCHEMA.md) - Confidence score normalization (0-100 scale, deterministic)
- [Sync & Deployment Process](docs/SYNC_DEPLOYMENT_PROCESS.md) - Safe synchronization and deployment procedures

**🔒 Security (EPIC 07):**
- [Security Validation Guide](docs/SECURITY_VALIDATION_GUIDE.md) - **QUICK REFERENCE**: IAM policy validation and security checks
- [Security Implementation](EPIC07_SECURITY_IMPLEMENTATION.md) - Complete security hardening implementation
- [IAM Roles Justification](docs/IAM-ROLES-JUSTIFICATION.md) - Detailed IAM permissions and justifications
- [Security & IAM Guide](docs/SECURITY-IAM.md) - Security architecture and best practices
- [Secret Management](SECURITY.md) - Secrets Manager integration and credential management

**🔧 Workflow System:**
- [Workflow Schema](docs/WORKFLOW-SCHEMA.md) - Complete workflow model and JSON format specification
- [Workflow Engine](docs/WORKFLOW-ENGINE.md) - Workflow execution and agent runner documentation
- [Database Schema](docs/architecture/database-schema.md) - Database structure and workflow persistence
- [Logging Concept](docs/LOGGING.md) - Structured logging, CloudWatch integration, and log searching
- [Observability](docs/OBSERVABILITY.md) - Monitoring, alarms, KPI system, and observability features
- [Secret Validation](docs/SECRET_VALIDATION.md) - Pre-deployment secret key validation guardrail

### v0.1 Architecture (Legacy)

Lambda-based pipeline with Step Functions orchestration. Still functional for simple workflows.

## Components

### Infrastructure (CDK)

AWS CDK infrastructure for deploying the complete stack.

```bash
npm install

# Security checks (EPIC 07)
npm run security:check

# Build with automatic secret validation (Issue I-01-02)
npm run build

# Generate CloudFormation with automatic secret validation
npm run synth

# Deploy to AWS (includes automatic secret validation)
npm run deploy

# Or validate secrets separately
npm run validate-secrets
```

Stacks:
- `CodefactoryControlStack` - v0.1 Lambda-based pipeline
- `Afu9InfrastructureStack` - v0.2 ECS-based infrastructure

**Pre-deployment Checks:**
- **Security validation** ensures IAM policies follow least privilege principles (EPIC 07)
- **Secret preflight check** (Issue I-01-02): Build/synth/deploy **fail** if required secret keys are missing
  - Validates secrets in AWS Secrets Manager before any build/synth operation
  - Explicitly names secret and missing keys in error messages
  - Works locally and in CI
- See [Secret Validation Guide](docs/SECRET_VALIDATION.md) for details
- See [Security Validation Guide](docs/SECURITY_VALIDATION_GUIDE.md) for security details

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

## Health Checks & Reliability

AFU-9 implements standardized health and readiness endpoints for reliable deployments:

**Health Check Endpoints**:
- 🔍 **`/api/health`** (Liveness): Always returns 200 when process is running - used by ALB and ECS
- ✅ **`/api/ready`** (Readiness): Returns 200/503 based on dependencies - used for manual verification

**Contract Enforcement**:
- CI/CD tests ensure `/api/health` always returns 200 OK
- ALB health checks use `/api/health` to avoid false negatives during startup
- Container health checks validate process liveness
- Post-deployment verification tests all endpoints

**Documentation**:
- [ECS + ALB Status Signals](docs/ECS_ALB_STATUS_SIGNALS.md) - **CANONICAL**: Go/No-Go decision criteria for deployments
- [Health Check Decision Summary](docs/HEALTH_CHECK_DECISION_SUMMARY.md) - Complete decision tree and related issues
- [Health & Readiness Verification](docs/HEALTH_READINESS_VERIFICATION.md) - Endpoint specifications
- [ECS Health Checks Runbook](docs/runbooks/ecs-healthchecks.md) - Troubleshooting guide

