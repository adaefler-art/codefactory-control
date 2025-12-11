# AFU-9 Network Stack Deployment Guide

This guide covers deploying the AFU-9 network infrastructure stack to AWS.

## Overview

The `Afu9NetworkStack` provides the network foundation for AFU-9 v0.2:
- VPC with public and private subnets across 2 availability zones
- Security groups with least privilege access
- Application Load Balancer for internet-facing traffic
- NAT Gateway for private subnet egress

## Prerequisites

1. **AWS Account** with appropriate permissions:
   - VPC creation and management
   - EC2 (security groups, subnets, etc.)
   - Elastic Load Balancing
   
2. **AWS CLI** installed and configured:
   ```bash
   aws configure
   aws sts get-caller-identity  # Verify access
   ```

3. **Node.js 20+** and npm installed:
   ```bash
   node --version  # Should be 20.x or higher
   npm --version
   ```

4. **AWS CDK** (automatically installed via npx):
   ```bash
   npx cdk --version
   ```

## Deployment Steps

### 1. Install Dependencies

```bash
cd /path/to/codefactory-control
npm install
```

### 2. Build the CDK Stack

```bash
npm run build
```

This compiles the TypeScript code to JavaScript.

### 3. Bootstrap CDK (First Time Only)

If this is your first CDK deployment in this AWS account/region:

```bash
npx cdk bootstrap aws://ACCOUNT-ID/eu-central-1
```

Replace `ACCOUNT-ID` with your AWS account ID.

### 4. Review the Changes

Preview what will be deployed:

```bash
npx cdk synth Afu9NetworkStack
```

This generates the CloudFormation template. Review the resources that will be created.

For a more readable diff:

```bash
npx cdk diff Afu9NetworkStack
```

### 5. Deploy the Network Stack

```bash
npx cdk deploy Afu9NetworkStack
```

Review the changes and confirm when prompted. Deployment takes approximately 5-10 minutes.

### 6. Verify Deployment

After deployment completes, you'll see the stack outputs:

```
Outputs:
Afu9NetworkStack.VpcId = vpc-xxxxx
Afu9NetworkStack.LoadBalancerDNS = afu9-alb-xxxxxxxx.eu-central-1.elb.amazonaws.com
Afu9NetworkStack.AlbSecurityGroupId = sg-xxxxx
Afu9NetworkStack.EcsSecurityGroupId = sg-xxxxx
Afu9NetworkStack.DbSecurityGroupId = sg-xxxxx
...
```

Save these outputs - they'll be needed for deploying other stacks (ECS, RDS, etc.).

### 7. Test the Load Balancer

The ALB is deployed but has no targets yet (ECS service will be deployed later):

```bash
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

curl http://$ALB_DNS
```

Expected response: "AFU-9 Control Center - Configure HTTPS listener for production use"

## Stack Resources

The deployment creates:

- **1 VPC** (10.0.0.0/16)
- **4 Subnets** (2 public, 2 private)
- **3 Security Groups** (ALB, ECS, RDS)
- **1 Application Load Balancer**
- **1 Target Group** (port 3000, health check on /api/health)
- **1 NAT Gateway** (for private subnet egress)
- **1 Internet Gateway**
- **Route tables and associations**

Total: ~30 AWS resources

## Cost Estimation

Monthly costs for the network infrastructure (eu-central-1):

| Resource | Monthly Cost |
|----------|--------------|
| NAT Gateway | ~$32 (744 hours × $0.045/hour) |
| NAT Data Transfer | ~$5 (50 GB × $0.045/GB) |
| Application Load Balancer | ~$16 (744 hours × $0.0225/hour) |
| ALB LCU (usage-based) | Variable (~$5-10) |
| **Total** | **~$58-63/month** |

VPC, subnets, Internet Gateway, and security groups are free.

## Configuration Options

### Change AWS Region

Edit `bin/codefactory-control.ts`:

```typescript
new Afu9NetworkStack(app, 'Afu9NetworkStack', {
  env: {
    region: 'us-east-1',  // Change this
  },
  ...
});
```

### Change VPC CIDR

Edit `lib/afu9-network-stack.ts`:

```typescript
this.vpc = new ec2.Vpc(this, 'Afu9Vpc', {
  ipAddresses: ec2.IpAddresses.cidr('10.1.0.0/16'),  // Change this
  ...
});
```

### Add Second NAT Gateway

For production redundancy, edit `lib/afu9-network-stack.ts`:

```typescript
this.vpc = new ec2.Vpc(this, 'Afu9Vpc', {
  ...
  natGateways: 2,  // Change from 1 to 2
});
```

## Troubleshooting

### Issue: "CDK bootstrap required"

**Solution**: Run `npx cdk bootstrap` for the target account/region

### Issue: "Resource limit exceeded"

**Solution**: Check AWS service limits (VPCs per region, Elastic IPs, etc.)

### Issue: "Insufficient permissions"

**Solution**: Ensure your IAM user/role has the following permissions:
- `ec2:*` (VPC, subnets, security groups)
- `elasticloadbalancing:*`
- `cloudformation:*`

### Issue: Deployment hangs on "Creating resources"

**Solution**: This is normal for VPC creation. Wait 5-10 minutes. If it fails, check CloudFormation console for error details.

## Updating the Stack

To update the network infrastructure:

1. Make changes to `lib/afu9-network-stack.ts`
2. Run `npm run build`
3. Review changes: `npx cdk diff Afu9NetworkStack`
4. Deploy updates: `npx cdk deploy Afu9NetworkStack`

**Warning**: Some changes (like VPC CIDR) require recreating the VPC, which will cause downtime.

## Deleting the Stack

To remove all network infrastructure:

```bash
npx cdk destroy Afu9NetworkStack
```

**Warning**: This will delete:
- The VPC and all subnets
- All security groups
- The Application Load Balancer
- NAT and Internet Gateways

Ensure no other resources (ECS services, RDS instances) are using this VPC first.

## Next Steps

After deploying the network stack:

1. **Deploy ECS Infrastructure**: Create ECS cluster, task definitions, and services
2. **Deploy RDS Database**: Create PostgreSQL database in private subnets
3. **Configure HTTPS**: Request ACM certificate and add HTTPS listener to ALB
4. **Set up DNS**: Create Route 53 records pointing to ALB
5. **Enable Monitoring**: Configure CloudWatch alarms and VPC Flow Logs

## Support

For issues or questions:
- Review CloudFormation stack events in AWS Console
- Check CloudWatch logs for CDK deployment details
- See [architecture documentation](architecture/network-architecture.md) for design details
- See [security documentation](architecture/network-security.md) for security analysis

## References

- [AWS CDK VPC Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.Vpc.html)
- [AWS ALB Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/)
- [AFU-9 Architecture Documentation](architecture/afu9-v0.2-overview.md)
