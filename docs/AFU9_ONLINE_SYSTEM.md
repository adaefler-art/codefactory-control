# AFU-9 Online System (Staging)

- ALB URL: http://afu9-alb-376872021.eu-central-1.elb.amazonaws.com
- Health check: GET /api/health → 200 with status/service/version/timestamp (version from APP_VERSION or IMAGE_TAG)
- Readiness check: GET /api/ready → 200 with ready=true when dependencies are satisfied (503 otherwise); version matches APP_VERSION or IMAGE_TAG
- Logs: CloudWatch log groups (control-center, mcp-github, mcp-deploy, mcp-observability) under /ecs/afu9/* via AWS Console

## Smoke-Test Expectations

1. Deploy the stack (scripts/deploy-staging.ps1 -Tag <image> [-DeployCdk] [-Profile <name>]).
2. Wait for ECS service to reach desiredCount and report running tasks.
3. Wait for the ALB target group to report all tasks healthy.
4. Perform HTTP checks against /api/ready and /api/health; both should return 200, ready=true, and aligned versions.
5. Result reporting: a run is **successful** only if all steps complete and HTTP checks pass; **failure** is reported immediately with the failing step and diagnostic context.
