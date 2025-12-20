# AFU-9 HTTPS & DNS Configuration Guide

This guide covers setting up HTTPS and DNS for the AFU-9 Control Center using AWS Certificate Manager (ACM) and Route53.

## Overview

AFU-9 supports secure HTTPS access through:
- **ACM Certificate**: TLS certificate for your domain
- **Route53 DNS**: DNS management and routing
- **ALB HTTPS Listener**: Automatic HTTPS termination at the load balancer
- **HTTP to HTTPS Redirect**: Automatic redirect from HTTP to HTTPS

## Architecture

```
User → Route53 (afu9.yourdomain.com) → ALB (HTTPS:443) → ECS Tasks (HTTP:3000)
                                          ↓ redirect
                                        HTTP:80
```

## Prerequisites

1. **Domain Name**: You must own a domain (e.g., `yourdomain.com`)
2. **AWS Account**: With permissions for Route53, ACM, and CloudFormation
3. **CDK Environment**: Node.js, AWS CLI, and CDK already configured

## Deployment Options

### Option 1: New Hosted Zone (Recommended for New Domains)

Use this if you want Route53 to manage your domain's DNS.

#### Step 1: Deploy DNS Stack

```bash
cd /path/to/codefactory-control

# Deploy with your domain name
npx cdk deploy Afu9DnsStack -c afu9-domain=afu9.yourdomain.com
```

This creates:
- Route53 hosted zone
- ACM certificate with automatic DNS validation
- Exports certificate ARN for the network stack

#### Step 2: Configure Domain Registrar

After deployment, CDK outputs the name servers. Configure these at your domain registrar:

```bash
# Get the name servers from CDK output
aws cloudformation describe-stacks \
  --stack-name Afu9DnsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`HostedZoneNameServers`].OutputValue' \
  --output text \
  --region eu-central-1
```

Example output:
```
ns-123.awsdns-12.com, ns-456.awsdns-34.org, ns-789.awsdns-56.net, ns-012.awsdns-78.co.uk
```

Go to your domain registrar (GoDaddy, Namecheap, etc.) and update the name servers for your domain.

**Note**: DNS propagation can take up to 48 hours, but usually completes within minutes to hours.

#### Step 3: Deploy Network Stack with Certificate

```bash
# Deploy network stack - it will automatically use the certificate
npx cdk deploy Afu9NetworkStack
```

The network stack will:
- Import the certificate from the DNS stack
- Configure HTTPS listener on port 443
- Configure HTTP to HTTPS redirect on port 80
- Create Route53 A record pointing to the ALB

#### Step 4: Verify Certificate

Wait for the certificate to be validated (usually 5-10 minutes):

```bash
# Check certificate status
aws acm describe-certificate \
  --certificate-arn $(aws cloudformation describe-stacks \
    --stack-name Afu9DnsStack \
    --query 'Stacks[0].Outputs[?OutputKey==`CertificateArn`].OutputValue' \
    --output text --region eu-central-1) \
  --region eu-central-1 \
  --query 'Certificate.Status'
```

Status should be `ISSUED`.

### Option 2: Existing Hosted Zone

Use this if you already have a Route53 hosted zone.

#### Step 1: Find Your Hosted Zone Details

```bash
aws route53 list-hosted-zones --query 'HostedZones[*].[Id,Name]' --output table
```

Note your hosted zone ID and name.

#### Step 2: Deploy DNS Stack with Existing Zone

```bash
npx cdk deploy Afu9DnsStack \
  -c afu9-domain=afu9.yourdomain.com \
  -c afu9-hosted-zone-id=Z1234567890ABC \
  -c afu9-hosted-zone-name=yourdomain.com
```

This will:
- Use your existing hosted zone
- Create ACM certificate with DNS validation
- Automatically add validation records to your hosted zone

#### Step 3: Deploy Network Stack

```bash
npx cdk deploy Afu9NetworkStack
```

### Option 3: Deploy Without HTTPS (Development Only)

For development or testing without a domain:

```bash
# Disable HTTPS
npx cdk deploy Afu9NetworkStack -c afu9-enable-https=false
```

This deploys:
- HTTP listener only (port 80)
- No certificate required
- Access via ALB DNS name: `http://afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com`

## Complete Deployment Workflow

For a complete deployment with HTTPS:

```bash
# 1. Deploy DNS and certificate
npx cdk deploy Afu9DnsStack -c afu9-domain=afu9.yourdomain.com

# 2. Configure name servers at your domain registrar (see output above)

# 3. Wait for certificate validation (5-10 minutes)
# Watch status in AWS Console: ACM → Certificates

# 4. Deploy network infrastructure
npx cdk deploy Afu9NetworkStack

# 5. Deploy database
npx cdk deploy Afu9DatabaseStack

# 6. Deploy ECS service
npx cdk deploy Afu9EcsStack

# 7. Access your Control Center
# URL from CDK output: https://afu9.yourdomain.com
```

## URL Mappings

Once deployed with HTTPS, the following endpoints are available:

| Endpoint | URL | Purpose | Access |
|----------|-----|---------|--------|
| **Control Center UI** | `https://afu9.yourdomain.com` | Web interface for AFU-9 | Public |
| **Health Check** | `https://afu9.yourdomain.com/api/health` | Service health status | Public |
| **GitHub Webhooks** | `https://afu9.yourdomain.com/api/webhooks/github` | Receive GitHub events | Public (from GitHub) |
| **API Endpoints** | `https://afu9.yourdomain.com/api/*` | Control Center API | Public |
| **MCP Servers** | `localhost:3001-3003` | MCP protocol servers | Internal only |

### Webhook Configuration

Configure GitHub webhooks to send events to your AFU-9 instance:

1. Go to your GitHub repository → Settings → Webhooks
2. Add webhook:
   - **Payload URL**: `https://afu9.yourdomain.com/api/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: (Configure in Secrets Manager - see ECS deployment guide)
   - **Events**: Issues, Pull Requests, Push, Workflow runs

## Security Considerations

### TLS/SSL Configuration

- **TLS Version**: ACM certificates use TLS 1.2+ (configurable on ALB)
- **Cipher Suites**: AWS managed policies (ELBSecurityPolicy-TLS13-1-2-2021-06)
- **Certificate Validation**: Automatic DNS validation via Route53

### Best Practices

1. **Enable HTTPS for Production**: Always use HTTPS in production environments
2. **Keep Certificates Updated**: ACM auto-renews certificates; ensure DNS records remain
3. **Use Strong Security Policies**: Review ALB SSL/TLS policies regularly
4. **Monitor Certificate Expiry**: CloudWatch alarms for certificate expiry (ACM handles renewal)
5. **Rotate Secrets**: Regularly rotate GitHub tokens and API keys in Secrets Manager

## Troubleshooting

### Certificate Stuck in "Pending Validation"

**Cause**: DNS validation records not accessible or name servers not configured

**Solution**:
1. Verify name servers are configured at your domain registrar
2. Wait for DNS propagation (can take up to 48 hours)
3. Check Route53 hosted zone has validation CNAME records:
   ```bash
   aws route53 list-resource-record-sets \
     --hosted-zone-id Z1234567890ABC \
     --query 'ResourceRecordSets[?Type==`CNAME`]'
   ```

### Cannot Access via HTTPS

**Cause**: Certificate not validated or ALB not configured correctly

**Solution**:
1. Verify certificate status is `ISSUED`:
   ```bash
   aws acm describe-certificate --certificate-arn <ARN> --region eu-central-1
   ```
2. Check ALB has HTTPS listener:
   ```bash
   aws elbv2 describe-listeners --load-balancer-arn <ARN>
   ```
3. Verify security group allows port 443

### HTTP to HTTPS Redirect Not Working

**Cause**: HTTP listener not configured for redirect

**Solution**:
1. Redeploy network stack with certificate ARN
2. Verify HTTP listener has redirect action:
   ```bash
   aws elbv2 describe-listeners --load-balancer-arn <ARN>
   ```

### DNS Resolution Fails

**Cause**: Route53 A record not created or DNS propagation pending

**Solution**:
1. Verify A record exists:
   ```bash
   aws route53 list-resource-record-sets \
     --hosted-zone-id <ZONE-ID> \
     --query 'ResourceRecordSets[?Name==`afu9.yourdomain.com.`]'
   ```
2. Test DNS resolution:
   ```bash
   dig afu9.yourdomain.com
   nslookup afu9.yourdomain.com
   ```
3. Wait for DNS propagation (usually minutes, up to 48 hours)

## Cost Estimation

### Additional Costs for HTTPS/DNS

| Service | Monthly Cost | Notes |
|---------|--------------|-------|
| **Route53 Hosted Zone** | $0.50 | Per hosted zone |
| **Route53 Queries** | $0.40/million | Standard queries |
| **ACM Certificate** | Free | Managed certificates are free |
| **ALB HTTPS Processing** | Included | No extra cost vs HTTP |

**Total additional cost**: ~$0.50-2.00/month (depending on traffic)

## Updating Configuration

### Change Domain Name

1. Update context in `cdk.json`:
   ```json
   {
     "context": {
       "afu9-domain": "new-domain.com"
     }
   }
   ```

2. Redeploy DNS stack:
   ```bash
   npx cdk deploy Afu9DnsStack
   ```

3. Update name servers at domain registrar

### Add Multiple Domains (SANs)

Modify `lib/afu9-dns-stack.ts`:

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

### Disable HTTPS (Rollback)

```bash
# Deploy without HTTPS
npx cdk deploy Afu9NetworkStack -c afu9-enable-https=false
```

## Advanced Configuration

### Custom TLS Policy

Edit `lib/afu9-network-stack.ts`:

```typescript
this.httpsListener = this.loadBalancer.addListener('HttpsListener', {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  certificates: [certificate],
  sslPolicy: elbv2.SslPolicy.TLS13_RES, // Custom TLS 1.3 policy
  defaultAction: elbv2.ListenerAction.forward([this.targetGroup]),
});
```

### Custom Domain Structure

For complex domain structures:

- **Apex domain**: `yourdomain.com` → Control Center
- **Subdomain**: `afu9.yourdomain.com` → Control Center
- **API subdomain**: `api.yourdomain.com` → API Gateway (future)
- **Webhooks subdomain**: `webhooks.yourdomain.com` → Webhook handler (future)

Configure multiple A records in Route53 pointing to the same ALB, or use ALB host-based routing.

## References

- [AWS ACM Documentation](https://docs.aws.amazon.com/acm/)
- [AWS Route53 Documentation](https://docs.aws.amazon.com/route53/)
- [ALB HTTPS Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html)
- [AFU-9 Network Architecture](./architecture/network-architecture.md)
- [AFU-9 ECS Deployment Guide](./ECS-DEPLOYMENT.md)

## Support

For issues:
- Check CloudFormation stack events for deployment errors
- Review ACM certificate validation status
- Verify Route53 records are correct
- Test DNS resolution with `dig` or `nslookup`
- Open an issue in the GitHub repository
