# AFU-9 Network Architecture Documentation

## Overview

This document describes the network architecture for AFU-9 v0.2, including VPC design, subnet allocation, security groups, and port strategy.

## Architecture Goals

1. **High Availability**: Multi-AZ deployment across 2 availability zones
2. **Security**: Least privilege network access with layered security groups
3. **Scalability**: Network design supports horizontal scaling of ECS tasks
4. **Cost Optimization**: Single NAT Gateway for v0.2, upgradable to multi-NAT for production
5. **Isolation**: Private subnets for compute and database, public subnets only for load balancer

## VPC Design

### CIDR Block Allocation

**VPC CIDR**: `10.0.0.0/16` (65,536 IP addresses)

This provides sufficient IP space for:
- Multiple availability zones
- Future expansion of services
- Reserved blocks for additional subnets

### Subnet Strategy

The VPC is divided into public and private subnets across 2 availability zones:

#### Public Subnets (Internet-Facing)
- **AZ1 Public**: `10.0.1.0/24` (251 usable IPs)
- **AZ2 Public**: `10.0.2.0/24` (251 usable IPs)
- **Purpose**: Application Load Balancer, NAT Gateway
- **Internet Access**: Via Internet Gateway

#### Private Subnets (Internal Only)
- **AZ1 Private**: `10.0.11.0/24` (251 usable IPs)
- **AZ2 Private**: `10.0.12.0/24` (251 usable IPs)
- **Purpose**: ECS Fargate tasks, RDS database
- **Internet Access**: Via NAT Gateway (outbound only)

### Rationale for CIDR Allocation

- `/24` subnets provide 251 usable IP addresses each, sufficient for ECS tasks and load balancers
- Private subnets use `10.0.11.x` and `10.0.12.x` for easy identification
- Reserved ranges (10.0.3-10 and 10.0.13-255) allow for future expansion:
  - Additional private subnets for other services
  - Dedicated subnets for VPN/Bastion hosts
  - Reserved for database subnet groups in multiple AZs

## Network Components

### Internet Gateway (IGW)
- Attached to VPC
- Routes traffic to/from public subnets
- Used by ALB for incoming requests

### NAT Gateway
- Deployed in **one** public subnet (cost optimization for v0.2)
- Provides outbound internet access for private subnets
- Required for:
  - ECS tasks to pull Docker images from ECR
  - ECS tasks to call GitHub API
  - ECS tasks to call external LLM APIs
  - ECS tasks to send CloudWatch logs

**Production Upgrade Path**: Deploy NAT Gateways in both AZs for high availability.

### Route Tables

#### Public Route Table
- Routes `0.0.0.0/0` to Internet Gateway
- Associated with public subnets in both AZs

#### Private Route Table
- Routes `0.0.0.0/0` to NAT Gateway
- Routes VPC CIDR (`10.0.0.0/16`) locally
- Associated with private subnets in both AZs

## Security Groups (Least Privilege)

### ALB Security Group (`afu9-alb-sg`)

**Purpose**: Allow internet traffic to Application Load Balancer

**Inbound Rules**:
| Port | Protocol | Source | Description |
|------|----------|--------|-------------|
| 443 | TCP | 0.0.0.0/0 | HTTPS from internet (production) |
| 80 | TCP | 0.0.0.0/0 | HTTP from internet (development/redirect) |

**Outbound Rules**:
| Port | Protocol | Destination | Description |
|------|----------|-------------|-------------|
| All | All | 0.0.0.0/0 | Allow all outbound (ALB needs to reach ECS) |

### ECS Security Group (`afu9-ecs-sg`)

**Purpose**: Allow traffic from ALB to ECS tasks, block all other inbound

**Inbound Rules**:
| Port | Protocol | Source | Description |
|------|----------|--------|-------------|
| 3000 | TCP | afu9-alb-sg | Control Center from ALB only |

**Outbound Rules**:
| Port | Protocol | Destination | Description |
|------|----------|-------------|-------------|
| All | All | 0.0.0.0/0 | Internet access for GitHub API, LLM APIs, ECR, CloudWatch |

**Note**: Internal MCP server ports (3001, 3002, 3003) do not need security group rules because they communicate via localhost within the same ECS task.

### RDS Security Group (`afu9-rds-sg`)

**Purpose**: Allow PostgreSQL access only from ECS tasks

**Inbound Rules**:
| Port | Protocol | Source | Description |
|------|----------|--------|-------------|
| 5432 | TCP | afu9-ecs-sg | PostgreSQL from ECS tasks only |

**Outbound Rules**:
| Port | Protocol | Destination | Description |
|------|----------|-------------|-------------|
| None | - | - | No outbound needed for RDS |

## Port Strategy

### External Ports (Internet-Facing)

| Port | Service | Protocol | Purpose |
|------|---------|----------|---------|
| 443 | HTTPS | TCP | Production traffic to ALB (requires ACM certificate) |
| 80 | HTTP | TCP | Development traffic or HTTPS redirect |

### Internal Ports (Within VPC)

| Port | Service | Protocol | Purpose |
|------|---------|----------|---------|
| 3000 | Control Center | TCP | Main Next.js application (ALB → ECS) |
| 3001 | MCP GitHub | TCP | GitHub operations (localhost in ECS task) |
| 3002 | MCP Deploy | TCP | ECS deployment operations (localhost in ECS task) |
| 3003 | MCP Observability | TCP | CloudWatch monitoring (localhost in ECS task) |
| 5432 | PostgreSQL | TCP | Database access (ECS → RDS) |

### Port Access Matrix

| Source | Destination | Port | Allowed |
|--------|-------------|------|---------|
| Internet | ALB | 443, 80 | ✅ Yes |
| ALB | ECS | 3000 | ✅ Yes |
| ECS | RDS | 5432 | ✅ Yes |
| ECS | Internet | All | ✅ Yes (via NAT) |
| Internet | ECS | Any | ❌ No (private subnet) |
| Internet | RDS | Any | ❌ No (private subnet) |
| ALB | RDS | 5432 | ❌ No (not in ECS SG) |

## Application Load Balancer (ALB)

### Configuration

- **Type**: Application Load Balancer (Layer 7)
- **Scheme**: Internet-facing
- **Subnets**: Public subnets in both AZs
- **IP Address Type**: IPv4

### Listeners

#### HTTP Listener (Port 80)
- **Default Action**: Fixed response (ready for forwarding rule)
- **Purpose**: Development access, can be configured to redirect to HTTPS
- **Target**: AFU-9 Target Group

### Target Group

- **Name**: `afu9-tg`
- **Protocol**: HTTP
- **Port**: 3000
- **Target Type**: IP (required for Fargate)
- **Health Check**:
  - Path: `/api/health`
  - Interval: 30 seconds
  - Timeout: 5 seconds
  - Healthy threshold: 2 consecutive successes
  - Unhealthy threshold: 3 consecutive failures
- **Deregistration Delay**: 30 seconds (faster deployments)

### HTTPS Configuration (Production)

For production deployment, configure HTTPS:

1. **Request ACM Certificate** for your domain
2. **Create HTTPS Listener** on port 443
3. **Configure HTTP Listener** to redirect to HTTPS
4. **Update Route 53** DNS to point to ALB

## Network Flow

### Incoming Request Flow

```
Internet → ALB (Public Subnet) → ECS Task (Private Subnet) → RDS (Private Subnet)
```

1. User makes HTTPS request to `afu9.yourdomain.com`
2. DNS resolves to ALB in public subnet
3. ALB terminates TLS and forwards HTTP to ECS task on port 3000
4. ECS Control Center processes request
5. If needed, Control Center connects to RDS on port 5432
6. Response flows back through ALB to user

### Outbound API Call Flow

```
ECS Task (Private Subnet) → NAT Gateway (Public Subnet) → Internet Gateway → Internet
```

1. ECS task needs to call GitHub API or LLM API
2. Traffic routes to NAT Gateway via private route table
3. NAT Gateway performs source NAT
4. Traffic flows through Internet Gateway to internet
5. Response flows back to ECS task

### Internal MCP Communication Flow

```
Control Center ↔ MCP Servers (all in same ECS task, localhost)
```

1. Control Center calls MCP server on `http://localhost:3001`
2. Communication happens within the same ECS task (no network required)
3. MCP server responds via localhost

## High Availability

### Multi-AZ Deployment

- **VPC**: Spans 2 availability zones in eu-central-1
- **ALB**: Automatically load balances across AZs
- **ECS Tasks**: Can be deployed in multiple AZs
- **RDS**: Can be configured with Multi-AZ for automatic failover

### Failure Scenarios

| Scenario | Impact | Recovery |
|----------|--------|----------|
| Single AZ failure | 50% capacity remains | ALB routes to healthy AZ |
| NAT Gateway failure | No outbound internet | Tasks can't call external APIs (downtime) |
| ALB failure | Service unavailable | AWS replaces ALB (rare) |
| RDS primary failure | Database unavailable | Multi-AZ: automatic failover in ~60s |

### Production Recommendations

1. **Deploy 2 NAT Gateways** (one per AZ) for NAT redundancy
2. **Enable RDS Multi-AZ** for automatic database failover
3. **Run 2+ ECS tasks** across multiple AZs for redundancy
4. **Configure Auto Scaling** based on CPU/memory metrics

## Security Best Practices

### Network Security

1. **✅ Private Subnets**: ECS and RDS in private subnets with no direct internet access
2. **✅ Least Privilege**: Security groups only allow necessary traffic
3. **✅ Layered Security**: ALB → ECS → RDS with separate security groups
4. **✅ No Bastion Needed**: AWS Systems Manager Session Manager for private access

### Recommended Additions

1. **VPC Flow Logs**: Enable for network traffic analysis and security auditing
2. **AWS WAF**: Attach to ALB to protect against common web exploits
3. **AWS Shield Standard**: Automatically enabled for DDoS protection
4. **CloudTrail**: Enable for audit logging of network changes

## Cost Optimization

### Current Configuration (v0.2)

| Component | Monthly Cost (Estimate) |
|-----------|-------------------------|
| NAT Gateway | ~$32 (744 hours × $0.045/hour) |
| NAT Gateway Data | ~$5 (50 GB × $0.045/GB) |
| ALB | ~$16 (744 hours × $0.0225/hour) |
| ALB LCU | Variable (usage-based) |
| **Total Network Costs** | **~$53-60/month** |

### Cost Optimization Tips

1. **Single NAT Gateway**: Saves $32/month vs dual NAT (current setup)
2. **VPC Endpoints**: Consider for AWS services (S3, ECR, Secrets Manager) to avoid NAT data charges
3. **ALB Idle Timeout**: Configure appropriate timeout to reduce unnecessary connections
4. **Reserved Capacity**: Not available for network components

### Production Cost Considerations

For production, budget for:
- **Dual NAT Gateways**: +$37/month (redundancy)
- **Increased NAT Data Transfer**: +$10-20/month
- **AWS WAF**: +$5/month base + $1/million requests
- **VPC Flow Logs**: +$5-10/month (CloudWatch storage)

## Monitoring and Observability

### CloudWatch Metrics

Monitor these key metrics:

**ALB Metrics**:
- `TargetResponseTime`: Response latency
- `HealthyHostCount`: Number of healthy ECS tasks
- `UnHealthyHostCount`: Number of unhealthy tasks
- `HTTPCode_Target_4XX_Count`: Application errors
- `HTTPCode_Target_5XX_Count`: Server errors

**NAT Gateway Metrics**:
- `BytesInFromSource`: Inbound data
- `BytesOutToDestination`: Outbound data
- `ErrorPortAllocation`: Port exhaustion (increase task count if high)

**VPC Flow Logs**:
- Rejected connections (security group blocks)
- Unusual traffic patterns
- Source/destination analysis

### Alarms

Recommended CloudWatch alarms:

1. **No Healthy Targets**: Alert if ALB has zero healthy targets
2. **High 5XX Errors**: Alert if 5XX error rate > 5%
3. **High Response Time**: Alert if P99 latency > 2 seconds
4. **NAT Gateway Data**: Alert if data transfer > expected threshold (potential issue)

## Scaling Considerations

### Horizontal Scaling

The network is designed to support:
- **Up to 250 ECS tasks** per AZ (251 IPs per subnet)
- **Multiple load balancers** if needed for different services
- **Additional services** in reserved subnet ranges

### Vertical Scaling

- **NAT Gateway**: Supports up to 55 Gbps bandwidth, scales automatically
- **ALB**: Scales automatically based on traffic
- **VPC**: No inherent limits, subnet size is the constraint

### When to Add Capacity

1. **IP Exhaustion**: When subnet has <20% free IPs, add new subnet
2. **NAT Bottleneck**: When NAT data transfer consistently >10 Gbps, add second NAT
3. **ALB Capacity**: ALB scales automatically, no action needed

## Maintenance and Operations

### Regular Tasks

- **Monthly**: Review VPC Flow Logs for anomalies
- **Monthly**: Review security group rules for unused rules
- **Quarterly**: Test failover scenarios
- **Annually**: Review CIDR allocation and plan for expansion

### Troubleshooting

**Issue: ECS tasks can't reach internet**
- Check route table has route to NAT Gateway
- Verify NAT Gateway is in public subnet
- Verify NAT Gateway has route to Internet Gateway
- Check security group allows outbound traffic

**Issue: ALB health checks failing**
- Verify security group allows ALB → ECS on port 3000
- Check ECS task is listening on 0.0.0.0:3000
- Verify `/api/health` endpoint returns 200 OK
- Check CloudWatch logs for errors

**Issue: Can't connect to RDS**
- Verify security group allows ECS → RDS on port 5432
- Check connection string is correct
- Verify RDS is in same VPC
- Check RDS subnet group configuration

## Disaster Recovery

### Backup Strategy

- **Network Configuration**: Stored in CDK code (Infrastructure as Code)
- **Deployment**: Can recreate entire network stack from CDK
- **Recovery Time Objective (RTO)**: ~15-20 minutes to recreate network stack

### Failover Procedures

1. **AZ Failure**: Automatic - ALB routes to healthy AZ
2. **Complete Stack Failure**: Redeploy from CDK in ~20 minutes
3. **VPC Corruption**: Deploy to new VPC, update DNS

## References

- [AWS VPC Documentation](https://docs.aws.amazon.com/vpc/)
- [AWS Application Load Balancer Guide](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/)
- [ECS Networking Guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking.html)
- [VPC Security Best Practices](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-best-practices.html)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12-11 | Initial network architecture for AFU-9 v0.2 |
