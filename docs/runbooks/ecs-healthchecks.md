# AFU-9 ECS healthchecks runbook

## Incident
- ECS circuit breaker triggered by false-negative container healthcheck on `control-center`.
- Tasks marked UNHEALTHY after ~5–6 minutes despite `/api/ready` returning Ready; deployments rolled back to desired=0.

## Symptoms
- ECS events: `Service ... (port 3000) is unhealthy in target-group ...` followed by circuit breaker rollback.
- Task status: desired=1 → running=1 → UNHEALTHY, then service scaled to 0.
- Application logs showed readiness success before task termination.

## Root cause
- Container-level HTTP health probe in `control-center` produced intermittent failures; ALB target group healthcheck was never reached, so tasks failed ECS health.

## Fix (current state)
- Disabled container healthcheck for `control-center` task definition.
- ALB target group `/api/ready` remains the health gate (HTTP 200 expected).
- MCP containers retain their existing health checks.

## Verification
- ECS service `afu9-control-center`: desired=1, running=1, no UNHEALTHY events for at least one full ALB healthcheck interval.
- Target group `afu9-tg`: healthy targets = 1.
- Manual check (optional): `curl https://afu-9.com/api/ready` or ALB DNS → expect HTTP 200 and readiness JSON.

## Optional follow-up
- Consider lighter container probes: TCP only, or HTTP no-op endpoint with zero dependencies.
- Harden `/api/ready`: ensure fast path, minimal dependencies, clear failure metrics.
- If re-enabling container checks, align intervals/timeouts with app startup and ALB health expectations to avoid overlap-induced false negatives.
