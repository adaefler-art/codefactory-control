# AFU-9 Control — Autonomous Code Fabrication Platform

**AFU-9** (Autonomous Fabrication Unit - Ninefold Architecture) orchestrates autonomous code fabrication through issue lifecycle management, MCP-based debugging, and deployment guardrails.

**Current Version:** v0.8  
**Status:** Production-Ready  
**Architecture:** AWS (Lambda, Step Functions, ECS Fargate) + GitHub Actions + LLM-based patching

---

## 🚀 Quick Start

### Prerequisites

- **Node.js**: 20.x or higher
- **npm**: 10.x or higher
- **PostgreSQL**: 15.x or higher (for local development)
- **Docker**: Optional, for containerized development

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/adaefler-art/codefactory-control.git
   cd codefactory-control
   ```

2. **Install dependencies**
   ```bash
   npm install
   npm --prefix control-center install
   ```

3. **Configure environment**
   ```bash
   cp control-center/.env.local.template control-center/.env.local
   # Edit .env.local with your GitHub token, OpenAI key, etc.
   ```

4. **Start Control Center**
   ```bash
   npm run dev:control-center
   ```
   
   Access the UI at: [http://localhost:3000](http://localhost:3000)

5. **Verify repository integrity**
   ```bash
   npm run repo:verify
   ```

### Build & Test

```bash
# Build the project
npm run build

# Run tests
npm test
npm --prefix control-center test

# Verify IAM policies
npm run validate-iam

# Check deployment determinism
npm run determinism:check
```

---

## 📖 Documentation

### Version-Specific Documentation

- **[v0.6 Documentation](docs/v06/README.md)** - Current stable release (E61-E65)
  - Issue lifecycle and activation
  - MCP-based debugging infrastructure
  - GitHub Actions runner integration
  - Deploy monitoring and verification
  
- **[v0.6.5 Documentation](docs/v065/README.md)** - Security hardening release
  - Repository security hardening
  - Secret scanning and push protection
  - History rewrite procedures
  - Breaking changes and migration guide

### Core Documentation

- **[Release Notes](docs/releases/)** - Version history and changelogs
  - [v0.6 Release](docs/releases/v0.6/RELEASE.md)
  - [v0.6.5 Release](docs/releases/v0.6.5.md)
   - [v0.8 Release](docs/releases/v0.8.md)
  
- **[Architecture](docs/architecture/README.md)** - System architecture overview
  - AWS infrastructure (VPC, ECS, RDS)
  - MCP-based component design
  - Security and observability
  
- **[API Documentation](docs/API_ROUTES.md)** - REST API reference
- **[Glossary](docs/canon/GLOSSARY.md)** - Canonical AFU-9 terminology
- **[Contributing Guide](docs/CONTRIBUTING.md)** - How to contribute

### Operational Documentation

- **[Deployment Guide](docs/deploy/)** - AWS deployment procedures
- **[Runbooks](docs/runbooks/)** - Operational procedures and incident response
- **[Debugging Guide](docs/DEBUGGING_QUICK_START.md)** - MCP-based debugging workflows

---

## 🏗️ Repository Structure

```
codefactory-control/
├── control-center/          # Next.js Control Center UI
│   ├── src/
│   │   ├── app/            # Next.js 16 app router pages
│   │   ├── components/     # React components
│   │   └── lib/            # Core libraries (GitHub, runners, build)
│   └── package.json
├── infra/                   # AWS CDK infrastructure (DO NOT MODIFY without infra-scope)
├── lib/                     # Shared TypeScript libraries
├── mcp-servers/            # MCP server implementations
│   ├── afu9-runner/        # AFU-9 runner MCP server
│   └── github/             # GitHub integration MCP server
├── packages/               # Internal packages
│   ├── deploy-memory/      # Deployment memory module
│   └── verdict-engine/     # Verdict evaluation engine
├── scripts/                # Automation scripts
├── docs/                   # Documentation
│   ├── v06/               # v0.6 documentation
│   ├── v065/              # v0.6.5 documentation
│   ├── releases/          # Release notes
│   └── architecture/      # Architecture docs
└── .github/workflows/     # GitHub Actions workflows

**Modification Rules:**
- ✅ **Allowed:** control-center/**, docs/**, scripts/**, .github/**
- ❌ **Forbidden (without infra-scope):** .next/**, .worktrees/**, standalone/**, lib/**, infra/**
```

---

## 🔧 Core Features

### v0.6 — Foundation Release

**Epic E61 — Issue Lifecycle & GitHub Handoff**
- Issue state machine with activation semantics
- GitHub issue integration and handoff
- Events ledger for audit trail

**Epic E62 — Control Center UX**
- Issue list with filtering and sorting
- Issue detail view with timeline
- Real-time status updates

**Epic E63 — MCP Server Zero-Copy Debugging**
- Runs ledger database (runs, run_steps, run_artifacts)
- Issue UI runs tab with execution history
- RunSpec/RunResult contracts

**Epic E64 — Runner Adapter**
- GitHub Actions runner integration
- Workflow dispatch and polling
- Deploy determinism playbook

**Epic E65 — Deploy & Operate Guardrails**
- Deploy status monitor (GREEN/YELLOW/RED)
- Post-deploy verification playbook
- Automated health checks

### v0.6.5 — Security Hardening

**Epic E66 — Repository Security**
- Secret scanning with Gitleaks (history + working tree)
- Push protection for secrets
- Git history sanitization procedures
- Enhanced `.gitignore` patterns
- CI security gates (security-gates.yml)

---

## 🛡️ Security

AFU-9 follows security-by-default principles:

- **Secrets Management**: All secrets in AWS Secrets Manager (never in code)
- **Secret Scanning**: Gitleaks CI gates on every commit
- **Push Protection**: GitHub secret scanning enabled
- **IAM Least Privilege**: Validated via `npm run validate-iam`
- **History Scanning**: Full git history scanned for secrets

### Security Workflow

```bash
# Local secret scanning
gitleaks detect --source . --config .gitleaks.toml --verbose

# Validate IAM policies
npm run validate-iam

# Repository verification
npm run repo:verify
```

See [Security Documentation](docs/v065/README.md) for detailed procedures.

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run Control Center tests
npm --prefix control-center test

# Run with coverage
npm test -- --coverage
```

---

## 🚢 Deployment

### AWS Deployment

```bash
# Synthesize CloudFormation template
npm run synth

# Deploy to AWS
npm run deploy

# Destroy stack (caution!)
npm run destroy
```

See [Deployment Documentation](docs/deploy/) for detailed procedures.

---

## 📊 Monitoring & Observability

- **CloudWatch Logs**: Structured logging for all components
- **Deploy Status**: Real-time deployment health monitoring
- **Metrics**: Custom metrics for workflow execution
- **Alerts**: SNS-based alerting for critical failures

Access monitoring dashboards in the Control Center UI.

---

## 🗺️ Roadmap

- **v0.6** ✅ - Foundation (Issue lifecycle, MCP debugging, runner adapter)
- **v0.6.5** ✅ - Security hardening
- **v0.7** 🚧 - Advanced playbook orchestration, multi-repository support
- **v0.8** 📋 - Context packs, advanced incident management

See [Roadmap Documentation](docs/roadmaps/) for detailed planning.

---

## 📝 Version History

| Version | Date | Description |
|---------|------|-------------|
| v0.6.5  | 2025-12-30 | Security hardening, secret scanning, history sanitization |
| v0.6    | 2025-12-30 | Foundation release (E61-E65) |
| v0.5    | 2025-12-xx | Legacy version |
| v0.4    | 2025-12-xx | Legacy version |

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

---

## 🤝 Contributing

We welcome contributions! Please see:

- **[Contributing Guide](docs/CONTRIBUTING.md)** - Contribution guidelines
- **[Code of Conduct](docs/lawbook/repo-canon.md)** - Repository rules
- **[Development Guide](control-center/README.md)** - Local development setup

---

## 📄 License

Copyright © 2025 adaefler-art

---

## 🔗 Links

- **GitHub Repository**: [adaefler-art/codefactory-control](https://github.com/adaefler-art/codefactory-control)
- **Issues**: [GitHub Issues](https://github.com/adaefler-art/codefactory-control/issues)
- **Documentation**: [docs/](docs/)

---

**Maintained by:** AFU-9 Team  
**Last Updated:** 2025-12-30  
**Current Version:** v0.6.5
