# AFU-9 Online System

## Database-enabled deployments
When `enableDatabase` is true (CDK context or stack prop), the ECS task expects the Secrets Manager JSON secret to contain these keys:
- `host`
- `port`
- `database`
- `username`
- `password`

If `enableDatabase` is false or the secret/keys are absent, the task skips injecting database env vars and the `/api/ready` endpoint reports `database: not_configured` (current behavior).

- DB migrations v0.3 runbook: [docs/runbooks/v03/db-migrations.md](docs/runbooks/v03/db-migrations.md)

## Healthchecks
- Current ECS healthcheck setup and incident notes: see [docs/runbooks/ecs-healthchecks.md](docs/runbooks/ecs-healthchecks.md).
