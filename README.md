# codefactory-control

Control-plane for AFU-9 (Autonomous Fabrication Unit – Ninefold Architecture).

`codefactory-control` orchestrates autonomous code fabrication across GitHub repositories using:
- AWS Lambda
- AWS Step Functions
- GitHub Actions
- External LLMs (optional)

v0.1 implements a walking skeleton for the flow:
**Issue → AFU-9 Pipeline → Patch → Branch → Pull Request → CI Feedback**.

## Repository Structure

This repository is organized into two main parts:

### Root: Infrastructure & CDK
The root directory contains AWS CDK infrastructure and orchestration logic:
- `bin/` - CDK entry point
- `infra/` - Lambda function implementations
- `lib/` - CDK stack definitions
- `cdk.json` - CDK configuration
- `package.json` - Infrastructure dependencies (AWS CDK, TypeScript, etc.)
- `tsconfig.json` - TypeScript configuration for infrastructure

### Subdirectory: Control Center App
The `control-center/` directory contains a standalone Next.js application:
- Complete Next.js App Router application
- TypeScript-based
- Own `package.json` and dependencies
- Dedicated README with setup instructions

## Components

### Infrastructure (CDK)

AWS CDK infrastructure for deploying Lambda functions and Step Functions state machine.

```bash
npm install
npx cdk synth
npx cdk deploy
```

Then configure in your target repo a GitHub Action that calls the AFU-9 orchestrator Lambda
(see `.github/workflows/afu9-bugfix.yml`).

### Control Center (Next.js)

Web UI for feature intake and GitHub issue generation. See [`control-center/README.md`](control-center/README.md) for details.

```bash
cd control-center
npm install
cp .env.local.template .env.local
# Edit .env.local with your credentials:
#   - GITHUB_TOKEN: Personal Access Token from GitHub Settings
#                   (requires repo:issues read/write permission)
#   - GITHUB_OWNER: Your GitHub username or organization
#   - GITHUB_REPO: Target repository for issues
#   - OPENAI_API_KEY: API key from OpenAI Platform
npm run dev
```

The Control Center provides:
- Feature briefing input form
- LLM-powered technical specification generation
- Automatic GitHub issue creation
- Feature tracking dashboard
