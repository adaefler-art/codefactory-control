# codefactory-control

Control-plane for AFU-9 (Autonomous Fabrication Unit – Ninefold Architecture).

`codefactory-control` orchestrates autonomous code fabrication across GitHub repositories using:
- AWS Lambda
- AWS Step Functions
- GitHub Actions
- External LLMs (optional)

v0.1 implements a walking skeleton for the flow:
**Issue → AFU-9 Pipeline → Patch → Branch → Pull Request → CI Feedback**.

## Getting Started

```bash
npm install
npx cdk synth
npx cdk deploy
```

Then configure in your target repo a GitHub Action that calls the AFU-9 orchestrator Lambda
(see `.github/workflows/afu9-bugfix.yml`).
