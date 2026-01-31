# AFU-9 Low-Cost Pause Mode

> **OBSOLETE:** This runbook predates the current runtime policy. Prod is now permanently offline (desiredCount=0) and must not be resumed via low-cost mode. See [AFU-9 Runtime Policy & Service Auth](../architecture/afu9-runtime-policy.md).

**Feature Version:** v0.6  
**Status:** Production-Ready  
**Owner:** AFU-9 Team  

## Overview

Low-Cost Pause Mode allows you to temporarily pause the PROD environment to reduce AWS costs while maintaining infrastructure integrity and keeping critical resources (RDS database) running. This is a **reversible**, **IaC-controlled** operation with no drift and no data loss.

### Key Benefits

- **Cost Reduction:** Reduces PROD environment costs by ~90-95% by stopping ECS tasks and disabling unnecessary routing
- **Reversible:** Resume PROD at any time with a single CDK deploy command
- **No Drift:** All changes are managed through CDK infrastructure as code
- **STAGE Unaffected:** Staging environment continues to run normally
- **RDS Active:** Database remains running to maintain a realistic production-like environment
- **No Data Loss:** All infrastructure and configuration is preserved

## What Gets Paused

When Low-Cost Pause Mode is enabled (`-c afu9-prod-paused=true`):

### ECS (PROD Only)
- ✅ **desiredCount** set to `0` (no running tasks)
- ✅ **Cost Impact:** Eliminates Fargate compute charges for PROD
- ⚠️ Service remains configured and can be scaled back up instantly

### Application Load Balancer
- ✅ **PROD Listener Rules** return HTTP 503 (Service Unavailable)
- ✅ **Cost Impact:** Eliminates target health check charges
- ✅ **STAGE Rules** remain fully functional
- ⚠️ ALB itself continues running (shared resource)

### NAT Gateway
- ✅ **PROD Traffic** eliminated (no tasks running)
- ✅ **Cost Impact:** Eliminates NAT data processing charges for PROD
- ✅ **STAGE Traffic** continues normally

### Public IPv4 / Elastic IPs
- ✅ **No PROD-specific EIPs** allocated
- ✅ **Cost Impact:** Eliminates unnecessary IPv4 charges

## What Stays Active

### RDS Database
- ✅ **Continues running** with no changes
- ✅ **Backups** continue on schedule
- ✅ **Security Groups** remain configured
- ⚠️ This is intentional to maintain a production-like environment

### Networking (VPC, Subnets, Security Groups)
- ✅ All network infrastructure remains active
- ✅ STAGE environment fully functional

### Monitoring & Alarms
- ✅ CloudWatch Alarms remain active
- ⚠️ PROD ECS alarms may trigger due to zero tasks (expected behavior)

## Commands

### Pause PROD (Enable Low-Cost Mode)

```bash
# Set the context flag and deploy
cdk deploy Afu9EcsProdStack Afu9RoutingStack -c afu9-prod-paused=true

# Optional: Use helper script (PowerShell)
.\scripts\pause-prod.ps1
```

**Expected Changes:**
- PROD ECS service desired count: `2` → `0`
- PROD ALB listener rules: Forward to target group → Return 503
- Deployment time: ~2-5 minutes

### Resume PROD (Disable Low-Cost Mode)

```bash
# Remove the context flag and deploy
cdk deploy Afu9EcsProdStack Afu9RoutingStack -c afu9-prod-paused=false

# Or deploy without the flag (defaults to false)
cdk deploy Afu9EcsProdStack Afu9RoutingStack

# Optional: Use helper script (PowerShell)
.\scripts\resume-prod.ps1
```

**Expected Changes:**
- PROD ECS service desired count: `0` → `2`
- PROD ALB listener rules: Return 503 → Forward to target group
- Deployment time: ~3-7 minutes (includes task startup)

### Check Current Status

```bash
# View current stack configuration
cdk synth Afu9RoutingStack | grep -A 5 "ProdPauseMode"

# Check ECS service status
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-prod \
  --query 'services[0].[desiredCount,runningCount]' \
  --output table

# Test PROD endpoint
curl -I https://prod.afu-9.com
# Expected: HTTP 503 when paused, HTTP 200 when active
```

## Cost Impact

### Before Pause Mode (Typical PROD Monthly Costs)
- **ECS Fargate (2 tasks):** ~$60-80/month
- **NAT Gateway:** ~$32/month (base) + data processing
- **ALB:** ~$16/month (shared with STAGE)
- **RDS:** ~$50-100/month (instance + storage)
- **Other (networking, logs, etc.):** ~$10-20/month
- **Total:** ~$168-248/month

### After Pause Mode (PROD Paused)
- **ECS Fargate:** $0 ✅
- **NAT Gateway:** ~$0-2/month (minimal STAGE spillover) ✅
- **ALB:** ~$16/month (shared, still used by STAGE) ⚠️
- **RDS:** ~$50-100/month (intentionally active) ⚠️
- **Other:** ~$10-20/month
- **Total:** ~$76-138/month

**Savings:** ~$92-110/month (~55-65% reduction)

> **Note:** Actual savings depend on usage patterns, data transfer, and resource sizing.

## Operational Procedures

### Pre-Pause Checklist

- [ ] Verify no critical PROD workloads are running
- [ ] Notify stakeholders that PROD will be unavailable
- [ ] Confirm recent RDS backup exists
- [ ] Document current PROD configuration (if needed)
- [ ] Ensure STAGE is healthy and accessible

### Pause Procedure

1. **Preview Changes:**
   ```bash
   cdk diff Afu9EcsProdStack -c afu9-prod-paused=true
   cdk diff Afu9RoutingStack -c afu9-prod-paused=true
   ```

2. **Verify Expected Changes:**
   - ECS desired count: `2` → `0`
   - No unexpected resource replacements
   - No changes to STAGE or RDS

3. **Deploy Changes:**
   ```bash
   cdk deploy Afu9EcsProdStack Afu9RoutingStack -c afu9-prod-paused=true
   ```

4. **Verify Pause State:**
   ```bash
   # Check no PROD tasks running
   aws ecs list-tasks --cluster afu9-cluster --service-name afu9-control-center-prod
   # Expected: Empty list

   # Verify 503 response
   curl -I https://prod.afu-9.com
   # Expected: HTTP/1.1 503 Service Unavailable

   # Verify STAGE still works
   curl -I https://stage.afu-9.com
   # Expected: HTTP/1.1 200 OK
   ```

### Resume Procedure

1. **Preview Changes:**
   ```bash
   cdk diff Afu9EcsProdStack -c afu9-prod-paused=false
   cdk diff Afu9RoutingStack -c afu9-prod-paused=false
   ```

2. **Verify Expected Changes:**
   - ECS desired count: `0` → `2`
   - ALB rules: Fixed 503 → Forward to target group
   - No unexpected changes

3. **Deploy Changes:**
   ```bash
   cdk deploy Afu9EcsProdStack Afu9RoutingStack -c afu9-prod-paused=false
   ```

4. **Verify Resume State:**
   ```bash
   # Wait for tasks to start (2-5 minutes)
   aws ecs wait services-stable --cluster afu9-cluster --services afu9-control-center-prod

   # Check tasks are running
   aws ecs describe-services \
     --cluster afu9-cluster \
     --services afu9-control-center-prod \
     --query 'services[0].[desiredCount,runningCount]'
   # Expected: [2, 2]

   # Verify PROD endpoint
   curl https://prod.afu-9.com/api/health
   # Expected: {"status":"healthy"}
   ```

## Fallback & Troubleshooting

### Issue: Resume deployment fails

**Symptoms:** CDK deploy errors during resume, tasks fail to start

**Diagnosis:**
```bash
# Check ECS events
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-prod \
  --query 'services[0].events[:5]'

# Check task failures
aws ecs describe-tasks \
  --cluster afu9-cluster \
  --tasks $(aws ecs list-tasks --cluster afu9-cluster --service afu9-control-center-prod --query 'taskArns[0]' --output text)
```

**Resolution:**
1. Check if ECR images are available
2. Verify IAM roles have necessary permissions
3. Check CloudWatch logs for application errors
4. If needed, manually scale service to 1 task first, then 2

### Issue: 503 errors after resume

**Symptoms:** PROD returns 503 even after resume deployment

**Diagnosis:**
```bash
# Check ALB listener rules
aws elbv2 describe-rules \
  --listener-arn $(aws elbv2 describe-load-balancers --names afu9-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)

# Check target group health
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups --names afu9-tg-prod --query 'TargetGroups[0].TargetGroupArn' --output text)
```

**Resolution:**
1. Wait 2-3 minutes for ALB health checks to pass
2. Check target group health status
3. If targets are unhealthy, check ECS task logs
4. Verify security group rules allow ALB → ECS traffic

### Issue: Cannot pause due to validation errors

**Symptoms:** CDK diff or deploy fails with validation errors

**Diagnosis:**
```bash
# Check current context
cdk context
```

**Resolution:**
1. Ensure you're using canonical context key: `afu9-prod-paused`
2. Verify multi-env mode is enabled: `afu9-multi-env=true`
3. Check for conflicting context in `cdk.context.json`

## Governance & Compliance

### Change Management

- **Change Type:** Standard (reversible, no data impact)
- **Approval Required:** Yes (before first use in production)
- **Rollback Plan:** Resume procedure (documented above)
- **Testing Required:** Yes (test in non-prod first)

### Audit Trail

All pause/resume operations are tracked via:
- CloudFormation stack events
- CloudWatch Logs (deployment logs)
- Git commits (infrastructure as code changes)
- AWS Config (resource configuration history)

### Security Considerations

- **No secrets exposed:** All credentials remain in Secrets Manager
- **No network changes:** Security groups and VPC configuration unchanged
- **RDS access:** Database continues to accept connections (ensure proper security group rules)
- **Reduced attack surface:** Fewer running tasks = smaller attack surface (benefit)

## Testing & Validation

### Local Testing

```bash
# Build the infrastructure
npm run build

# Test pause mode synthesis
cdk synth Afu9RoutingStack -c afu9-prod-paused=true -c afu9-multi-env=true

# Test resume mode synthesis
cdk synth Afu9RoutingStack -c afu9-prod-paused=false -c afu9-multi-env=true
```

### Diff Gate Validation

```bash
# Preview pause changes
cdk diff Afu9EcsProdStack -c afu9-prod-paused=true -c afu9-multi-env=true

# Verify:
# ✅ ECS service desired count changes to 0
# ✅ No RDS changes
# ✅ No STAGE changes
# ✅ ALB listener rules change from Forward to FixedResponse
# ❌ No unexpected resource replacements
```

### Post-Deploy Verification

```bash
# After pause
curl -I https://prod.afu-9.com  # Expect: 503
curl -I https://stage.afu-9.com  # Expect: 200

# After resume
curl https://prod.afu-9.com/api/health  # Expect: {"status":"healthy"}
curl https://prod.afu-9.com/api/ready   # Expect: {"status":"ready"}
```

## FAQ

### Q: Will pausing PROD affect STAGE?
**A:** No. STAGE runs on a separate ECS service and target group. It is completely unaffected by PROD pause mode.

### Q: Can I pause STAGE instead of PROD?
**A:** Not with this feature. Low-Cost Pause Mode is specifically designed for PROD. STAGE should remain active for development and testing.

### Q: What happens to RDS during pause?
**A:** RDS continues running normally. This is intentional to maintain a realistic production-like environment and avoid cold-start issues.

### Q: Can I pause PROD indefinitely?
**A:** Yes. There is no time limit. However, consider stopping RDS manually if pausing for extended periods (weeks/months).

### Q: Will I lose data when pausing?
**A:** No. All infrastructure, configuration, and data is preserved. Only the running tasks are stopped.

### Q: How long does it take to resume PROD?
**A:** Typically 3-7 minutes, including:
- CloudFormation stack update: ~2 minutes
- ECS task startup: ~1-3 minutes
- ALB health checks: ~1-2 minutes

### Q: Can I automate pause/resume with a schedule?
**A:** Yes. You can use AWS EventBridge or GitHub Actions workflows to run the pause/resume commands on a schedule.

### Q: What if I forget to resume PROD?
**A:** PROD will remain paused until you explicitly resume it. Consider setting up monitoring alerts if PROD is paused for longer than expected.

### Q: Does pause mode affect backups?
**A:** No. RDS automated backups continue on schedule regardless of ECS task state.

## Related Documentation

- [ECS Service Management](./ecs-healthchecks.md)
- [Deployment Process](./deploy-process.md)
- [Cost Optimization Guide](../architecture/cost-optimization.md)
- [Infrastructure Stack Documentation](../../README.md)

## Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-28 | AFU-9 Team | Initial release for v0.6 |

## Support

For issues or questions about Low-Cost Pause Mode:
1. Check this runbook first
2. Review CloudFormation and ECS service events
3. Contact AFU-9 team via GitHub issues
4. For urgent issues, follow standard incident response procedures
