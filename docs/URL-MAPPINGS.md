# AFU-9 Control Center URL Mappings

This document provides a comprehensive overview of all URLs and their purposes for the AFU-9 Control Center.

## Production URLs (with HTTPS)

When deployed with a custom domain and HTTPS enabled:

### Base Domain
- **Domain**: `https://afu9.yourdomain.com` (configure via CDK context)
- **Protocol**: HTTPS (TLS 1.2+)
- **Certificate**: AWS Certificate Manager (ACM) with automatic renewal
- **DNS**: Route53 A record pointing to Application Load Balancer

### Endpoint Mappings

| Endpoint | Full URL | Purpose | Access Level | Used By |
|----------|----------|---------|--------------|---------|
| **Root** | `https://afu9.yourdomain.com` | Control Center Web UI | Public | Users, Browsers |
| **Health Check** | `https://afu9.yourdomain.com/api/health` | Service health status | Public | Monitoring, ALB |
| **GitHub Webhooks** | `https://afu9.yourdomain.com/api/webhooks/github` | GitHub event receiver | Public | GitHub |
| **API Endpoints** | `https://afu9.yourdomain.com/api/*` | Control Center API | Public | Clients, CI/CD |

### Internal Services (Not Exposed)

These services run within the ECS task and are not accessible from the internet:

| Service | Internal URL | Port | Purpose | Access |
|---------|-------------|------|---------|--------|
| **MCP GitHub Server** | `http://localhost:3001` | 3001 | GitHub operations (issues, PRs, branches) | Control Center only |
| **MCP Deploy Server** | `http://localhost:3002` | 3002 | ECS deployment operations | Control Center only |
| **MCP Observability Server** | `http://localhost:3003` | 3003 | CloudWatch logs and metrics | Control Center only |

## Development URLs (HTTP only)

When deployed without HTTPS (development mode):

### Base URL
- **URL**: `http://afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com`
- **Protocol**: HTTP (not secure)
- **DNS**: AWS-provided ALB DNS name

**Warning**: Do not use HTTP-only mode in production. Always enable HTTPS for security.

### Endpoint Mappings (HTTP)

| Endpoint | Full URL | Purpose |
|----------|----------|---------|
| **Root** | `http://afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com` | Control Center Web UI |
| **Health Check** | `http://afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com/api/health` | Service health status |
| **API Endpoints** | `http://afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com/api/*` | Control Center API |

## Webhook Configuration

### GitHub Webhooks Setup

Configure GitHub to send events to AFU-9:

1. Navigate to your GitHub repository
2. Go to **Settings** → **Webhooks** → **Add webhook**
3. Configure:
   - **Payload URL**: `https://afu9.yourdomain.com/api/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: (Optional) Store in AWS Secrets Manager and configure in Control Center
   - **SSL verification**: Enable SSL verification
   - **Which events**: Select events to trigger:
     - ✅ Issues
     - ✅ Pull requests
     - ✅ Pushes
     - ✅ Workflow runs
     - ✅ Repository

4. Click **Add webhook**

### Webhook Events Handled

AFU-9 processes the following GitHub webhook events:

| Event | Trigger | Action |
|-------|---------|--------|
| **issues** | Issue opened/edited | Parse issue, create AFU-9 workflow |
| **pull_request** | PR opened/synchronized | Update workflow status, run checks |
| **push** | Code pushed to branch | Trigger CI/CD, update deployment status |
| **workflow_run** | GitHub Action completed | Update AFU-9 workflow with CI results |

## URL Configuration

### Setting Custom Domain

Configure your domain via CDK context:

```bash
# Option 1: Via command line
npx cdk deploy Afu9DnsStack -c afu9-domain=afu9.yourdomain.com

# Option 2: Via cdk.json
{
  "context": {
    "afu9-domain": "afu9.yourdomain.com"
  }
}
```

### Multiple Domains (Future)

For advanced setups with multiple domains:

| Domain | Purpose | Configuration |
|--------|---------|---------------|
| `afu9.yourdomain.com` | Main Control Center UI | Primary domain |
| `api.yourdomain.com` | API-only endpoint | Subject Alternative Name (SAN) |
| `webhooks.yourdomain.com` | Dedicated webhook receiver | Subject Alternative Name (SAN) |

To configure SANs, modify `lib/afu9-dns-stack.ts`:

```typescript
this.certificate = new acm.Certificate(this, 'Certificate', {
  domainName: this.domainName,
  subjectAlternativeNames: [
    'api.yourdomain.com',
    'webhooks.yourdomain.com',
  ],
  validation: acm.CertificateValidation.fromDns(this.hostedZone),
});
```

## Network Architecture

```
┌─────────────┐
│   Internet  │
└──────┬──────┘
       │ HTTPS (443)
       │ HTTP (80) → Redirect to HTTPS
       │
┌──────▼───────────────────────────────┐
│   Route53 DNS                        │
│   afu9.yourdomain.com → ALB          │
└──────┬───────────────────────────────┘
       │
┌──────▼───────────────────────────────┐
│   Application Load Balancer (ALB)   │
│   - HTTPS Termination                │
│   - Health Checks                    │
│   - Target Group Routing             │
└──────┬───────────────────────────────┘
       │ HTTP (3000)
       │
┌──────▼───────────────────────────────┐
│   ECS Fargate Task                   │
│   ┌────────────────────────────┐    │
│   │ Control Center (Port 3000) │    │
│   └────────────┬───────────────┘    │
│                │                     │
│   ┌────────────▼───────────────┐    │
│   │ MCP Servers (localhost)    │    │
│   │ - GitHub (3001)            │    │
│   │ - Deploy (3002)            │    │
│   │ - Observability (3003)     │    │
│   └────────────────────────────┘    │
└──────────────────────────────────────┘
```

## Port Strategy

| Port | Protocol | Direction | Purpose | Security |
|------|----------|-----------|---------|----------|
| 443 | HTTPS | Internet → ALB | Production traffic | TLS 1.2+, ACM certificate |
| 80 | HTTP | Internet → ALB | Redirect to HTTPS | Automatic redirect to 443 |
| 3000 | HTTP | ALB → ECS | Control Center app | Private subnet, ALB only |
| 3001 | HTTP | localhost | MCP GitHub Server | Internal only, same task |
| 3002 | HTTP | localhost | MCP Deploy Server | Internal only, same task |
| 3003 | HTTP | localhost | MCP Observability | Internal only, same task |
| 5432 | PostgreSQL | ECS → RDS | Database connection | Private subnet, ECS only |

## Security Considerations

### TLS/SSL
- **Protocol**: TLS 1.2 minimum (configurable to TLS 1.3)
- **Certificate**: ACM managed, auto-renewal every 13 months
- **Cipher Suites**: AWS managed security policy (ELBSecurityPolicy-TLS13-1-2-2021-06)

### Network Security
- **ALB**: Public subnets, security group allows 443/80 from internet
- **ECS Tasks**: Private subnets, security group allows 3000 from ALB only
- **RDS**: Private subnets, security group allows 5432 from ECS only

### Access Control
- **Public Endpoints**: Root, /api/health, /api/webhooks/github, /api/*
- **Private Services**: MCP servers (localhost only)
- **Authentication**: Implement in Control Center application layer
- **Webhook Validation**: Use GitHub webhook secrets (configure in Secrets Manager)

## Monitoring URLs

### CloudWatch Dashboards
Access via AWS Console:
- **Logs**: CloudWatch Logs → Log Groups → `/ecs/afu9/*`
- **Metrics**: CloudWatch → Dashboards → AFU-9 Metrics
- **Alarms**: CloudWatch → Alarms → AFU-9-*

### Health Check Endpoint

```bash
# Check service health
curl https://afu9.yourdomain.com/api/health

# Expected response (example):
{
  "status": "healthy",
  "timestamp": "2025-12-11T20:00:00Z",
  "version": "0.2.0",
  "services": {
    "database": "connected",
    "mcp-github": "available",
    "mcp-deploy": "available",
    "mcp-observability": "available"
  }
}
```

## Troubleshooting

### Cannot Access URL

1. **Check DNS Resolution**:
   ```bash
   dig afu9.yourdomain.com
   nslookup afu9.yourdomain.com
   ```

2. **Check Certificate Status**:
   ```bash
   aws acm describe-certificate --certificate-arn <ARN> --region eu-central-1
   ```

3. **Check ALB Health**:
   ```bash
   aws elbv2 describe-target-health --target-group-arn <ARN>
   ```

### SSL Certificate Errors

- Verify certificate is issued (not pending validation)
- Check name servers are configured at domain registrar
- Wait for DNS propagation (up to 48 hours)

### Webhook Not Receiving Events

1. Check GitHub webhook settings → Recent Deliveries
2. Verify webhook URL is correct
3. Check ECS task logs for webhook handler errors
4. Verify security groups allow traffic from GitHub IPs

## References

- [HTTPS & DNS Setup Guide](./HTTPS-DNS-SETUP.md) - Complete HTTPS configuration
- [ECS Deployment Guide](./ECS-DEPLOYMENT.md) - Full deployment instructions
- [Network Architecture](./architecture/network-architecture.md) - Detailed network design
- [AWS ALB Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/)
- [GitHub Webhooks Documentation](https://docs.github.com/en/developers/webhooks-and-events/webhooks)
