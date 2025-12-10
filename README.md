# codefactory-control

Control-plane for AFU-9 (Autonomous Fabrication Unit – Ninefold Architecture).

`codefactory-control` orchestrates autonomous code fabrication across GitHub repositories using:
- AWS Lambda
- AWS Step Functions
- GitHub Actions
- External LLMs (optional)

v0.1 implements a walking skeleton for the flow:
**Issue → AFU-9 Pipeline → Patch → Branch → Pull Request → CI Feedback**.

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
# Edit .env.local with your credentials
npm run dev
```

The Control Center provides:
- Feature briefing input form
- LLM-powered technical specification generation
- Automatic GitHub issue creation
- Feature tracking dashboard
