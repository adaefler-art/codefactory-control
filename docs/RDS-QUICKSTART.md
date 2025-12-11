# RDS Postgres Quick Start Guide

Quick reference for deploying and connecting to the AFU-9 RDS Postgres database.

## Deployment

### 1. Prerequisites

```bash
# Install AWS CLI and configure credentials
aws configure

# Install PostgreSQL client
# macOS: brew install postgresql
# Ubuntu: sudo apt-get install postgresql-client

# Install jq for JSON parsing
# macOS: brew install jq
# Ubuntu: sudo apt-get install jq
```

### 2. Deploy Infrastructure

```bash
cd codefactory-control

# Install dependencies
npm install

# Build TypeScript
npm run build

# Deploy network stack (if not already deployed)
npx cdk deploy Afu9NetworkStack

# Deploy database stack
npx cdk deploy Afu9DatabaseStack
```

**Note**: RDS deployment takes 10-15 minutes.

### 3. Run Migrations

Choose one of these methods:

#### Option A: Using the Migration Script (Easiest)

```bash
# From project root
./scripts/deploy-migrations.sh
```

This script automatically:
- Retrieves credentials from Secrets Manager
- Tests database connectivity
- Runs all migrations
- Shows database statistics

#### Option B: Manual Migration

```bash
# Get credentials
export $(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r 'to_entries|map("PG\(.key|ascii_upcase)=\(.value|tostring)")|.[]')

export PGSSLMODE=require

# Run migration (requires network access to RDS)
psql -f database/migrations/001_initial_schema.sql
```

### 4. Set Up Network Access

Since the database is in a private subnet, you need to establish network connectivity:

#### Quick Method: Temporary Security Group Rule (Development Only)

⚠️ **Warning**: Only for development/testing. Remove the rule when done.

```bash
# Get your public IP
MY_IP=$(curl -s https://checkip.amazonaws.com)

# Get security group ID
SG_ID=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --region eu-central-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DbSecurityGroupId'].OutputValue" \
  --output text)

# Add ingress rule
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32 \
  --region eu-central-1

# Run migrations
./scripts/deploy-migrations.sh

# IMPORTANT: Remove the rule
aws ec2 revoke-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32 \
  --region eu-central-1
```

#### Recommended Method: Session Manager Port Forwarding

For production-safe access, use AWS Systems Manager Session Manager.

See [DATABASE-LOCAL-DEVELOPMENT.md](./DATABASE-LOCAL-DEVELOPMENT.md) for full instructions.

## Connection Info

### Get Database Endpoint

```bash
# From CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name Afu9DatabaseStack \
  --region eu-central-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DbEndpoint'].OutputValue" \
  --output text

# From Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r '.host'
```

### Get Database Credentials

```bash
# Get all credentials
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r '.'

# Output:
# {
#   "host": "afu9-postgres.xxxxx.eu-central-1.rds.amazonaws.com",
#   "port": "5432",
#   "database": "afu9",
#   "username": "afu9_admin",
#   "password": "xxxxxxxxxxxxxxxx"
# }
```

## Common Commands

### Connect to Database

```bash
# Load credentials
export $(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r 'to_entries|map("PG\(.key|ascii_upcase)=\(.value|tostring)")|.[]')

export PGSSLMODE=require

# Connect
psql
```

### List Tables

```bash
psql -c "\dt"
```

### View Table Schema

```bash
psql -c "\d workflows"
```

### Query Data

```bash
# List all workflows
psql -c "SELECT id, name, enabled FROM workflows;"

# List recent executions
psql -c "SELECT id, status, started_at FROM workflow_executions ORDER BY started_at DESC LIMIT 10;"
```

### Run Query from File

```bash
psql -f your-query.sql
```

## Database Info

- **Engine**: PostgreSQL 15.5
- **Instance**: db.t4g.micro (1 vCPU, 1 GB RAM)
- **Storage**: 20 GB GP3 (auto-scaling to 100 GB)
- **Backups**: Daily automated backups, 7-day retention
- **Encryption**: AES-256 at rest, TLS in transit
- **Multi-AZ**: Optional (default: single-AZ for cost optimization)

## Stack Outputs

After deployment, get stack outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name Afu9DatabaseStack \
  --region eu-central-1 \
  --query "Stacks[0].Outputs"
```

Key outputs:
- `DbEndpoint`: Database hostname
- `DbPort`: Database port (5432)
- `DbName`: Database name (afu9)
- `DbSecretArn`: ARN of the connection secret
- `DbInstanceId`: RDS instance identifier

## Monitoring

### Check RDS Status

```bash
aws rds describe-db-instances \
  --db-instance-identifier afu9-postgres \
  --region eu-central-1 \
  --query "DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,Port:Endpoint.Port}"
```

### View CloudWatch Logs

```bash
# PostgreSQL logs
aws logs tail /aws/rds/instance/afu9-postgres/postgresql --follow --region eu-central-1
```

### Check Database Connections

```bash
psql -c "SELECT count(*) as active_connections FROM pg_stat_activity WHERE state = 'active';"
```

### Database Size

```bash
psql -c "SELECT pg_size_pretty(pg_database_size('afu9'));"
```

## Backup and Recovery

### Create Manual Snapshot

```bash
aws rds create-db-snapshot \
  --db-instance-identifier afu9-postgres \
  --db-snapshot-identifier afu9-snapshot-$(date +%Y%m%d-%H%M%S) \
  --region eu-central-1
```

### List Snapshots

```bash
aws rds describe-db-snapshots \
  --db-instance-identifier afu9-postgres \
  --region eu-central-1 \
  --query "DBSnapshots[*].{ID:DBSnapshotIdentifier,Status:Status,Time:SnapshotCreateTime}"
```

### Restore from Snapshot

```bash
# This creates a NEW database instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier afu9-postgres-restored \
  --db-snapshot-identifier afu9-snapshot-20241211-120000 \
  --region eu-central-1
```

## Troubleshooting

### Cannot Connect

1. **Check RDS status**:
   ```bash
   aws rds describe-db-instances \
     --db-instance-identifier afu9-postgres \
     --region eu-central-1 \
     --query "DBInstances[0].DBInstanceStatus"
   ```
   Expected: `available`

2. **Verify security group allows your IP**:
   ```bash
   aws ec2 describe-security-groups \
     --group-ids $(aws cloudformation describe-stacks \
       --stack-name Afu9NetworkStack \
       --query "Stacks[0].Outputs[?OutputKey=='DbSecurityGroupId'].OutputValue" \
       --output text) \
     --region eu-central-1
   ```

3. **Test network connectivity**:
   ```bash
   DB_HOST=$(aws secretsmanager get-secret-value \
     --secret-id afu9/database \
     --region eu-central-1 \
     --query SecretString \
     --output text | jq -r '.host')
   
   nc -zv $DB_HOST 5432
   ```

### Slow Queries

```sql
-- Find slow queries
SELECT pid, now() - query_start as duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - query_start > interval '5 seconds';
```

### Connection Limit Reached

```sql
-- Check current connections
SELECT count(*) FROM pg_stat_activity;

-- Max connections
SHOW max_connections;

-- Kill idle connections (if needed)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle' AND state_change < now() - interval '10 minutes';
```

## Cost Estimation

Monthly costs for db.t4g.micro in eu-central-1:

| Component | Cost (EUR/month) |
|-----------|------------------|
| RDS Instance (single-AZ) | ~€14 |
| Storage (20 GB GP3) | ~€2.5 |
| Backups (7 days) | ~€2 |
| **Total** | **~€18.50** |

Notes:
- Costs may vary based on actual usage
- Multi-AZ deployment doubles instance cost
- Additional data transfer charges may apply

## Security Checklist

- [x] Database in private subnet (no public access)
- [x] Security group allows only ECS access
- [x] Credentials stored in Secrets Manager
- [x] Encryption at rest enabled (AES-256)
- [x] SSL/TLS required for connections
- [x] Automated backups enabled
- [x] CloudWatch logging enabled
- [ ] Enable Multi-AZ for production
- [ ] Set up read replicas (if needed)
- [ ] Configure automated secret rotation
- [ ] Set up CloudWatch alarms
- [ ] Enable RDS audit logging (if required)

## Next Steps

1. **Enable Multi-AZ** (for production):
   ```bash
   aws rds modify-db-instance \
     --db-instance-identifier afu9-postgres \
     --multi-az \
     --apply-immediately \
     --region eu-central-1
   ```

2. **Set up CloudWatch Alarms**:
   - CPU Utilization > 80%
   - Free Storage Space < 2 GB
   - Database Connections > 80

3. **Configure Secret Rotation**:
   ```bash
   aws secretsmanager rotate-secret \
     --secret-id afu9/database/master \
     --rotation-lambda-arn arn:aws:lambda:... \
     --rotation-rules AutomaticallyAfterDays=90 \
     --region eu-central-1
   ```

4. **Deploy ECS services** to use the database

## Additional Resources

- [Complete Database Documentation](../database/README.md)
- [Local Development Guide](./DATABASE-LOCAL-DEVELOPMENT.md)
- [Full Deployment Guide](./DEPLOYMENT.md)
- [Architecture Overview](./architecture/afu9-v0.2-overview.md)
- [AWS RDS PostgreSQL Docs](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)
