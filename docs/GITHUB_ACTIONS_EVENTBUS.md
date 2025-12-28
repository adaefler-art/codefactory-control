# GitHub Actions Event Bus (AFU-9 Option 2)

AFU-9 supports publishing GitHub events from GitHub Actions into AWS via an **SQS “event bus”**.

This is **Option 2: “GitHub Actions Event Bus”**.

- No inbound webhook endpoints are used.
- GitHub Actions assumes an AWS IAM role via OIDC.
- The workflow publishes JSON messages to an SQS queue.

## Provisioned AWS Resources

Deployed by the AFU-9 CDK IAM stack:

- SQS queue: `afu9-github-events`
- SQS DLQ: `afu9-github-events-dlq`
- IAM role: `afu9-github-actions-eventbus-role`
  - Trusts `token.actions.githubusercontent.com`
  - Restricted to repo: `adaefler-art/codefactory-control` via `sub` condition
  - Permissions: **only** `sqs:SendMessage` to `afu9-github-events`

The stack exports these outputs:

- `Afu9GithubEventsQueueUrl`
- `Afu9GithubActionsEventBusRoleArn`

## GitHub Repository Secrets

Add the following repository secrets in **Settings → Secrets and variables → Actions**:

- `AWS_EVENTBUS_ROLE_ARN`
  - Value: CloudFormation output `Afu9GithubActionsEventBusRoleArn`
- `AFU9_GITHUB_EVENTS_QUEUE_URL`
  - Value: CloudFormation output `Afu9GithubEventsQueueUrl`
- `AWS_REGION`
  - Example: `eu-central-1`

## Example Workflow Snippet

This example assumes the role via OIDC and publishes a single JSON message to SQS.

```yaml
name: Publish GitHub Event
on:
  issues:
    types: [opened, edited, closed]

permissions:
  id-token: write
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_EVENTBUS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Publish event to AFU-9 SQS event bus
        shell: bash
        run: |
          aws sqs send-message \
            --queue-url "${{ secrets.AFU9_GITHUB_EVENTS_QUEUE_URL }}" \
            --message-body '${{ toJson(github) }}'
```

## Message Format

AFU-9 does not require a strict schema for the event bus message, but a practical default is:

- `message-body`: `toJson(github)` (includes `event_name`, `repository`, `actor`, and the event payload)

If you need routing/dispatch later, add a `--message-attributes` block (e.g. `event_name`, `repo_full_name`) and keep it stable.
