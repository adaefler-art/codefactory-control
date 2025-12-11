# Local Development with RDS Postgres

This guide explains how to connect to and develop against the AFU-9 RDS Postgres database from your local machine.

## Prerequisites

- AWS CLI configured with appropriate credentials
- PostgreSQL client (`psql`) installed
- Access to the AWS VPC (via VPN, bastion host, or Session Manager)
- IAM permissions to read from AWS Secrets Manager

## Installation

### macOS

```bash
# Install PostgreSQL client
brew install postgresql

# Install AWS CLI (if not already installed)
brew install awscli

# Install jq (for JSON parsing)
brew install jq
```

### Ubuntu/Debian

```bash
# Install PostgreSQL client
sudo apt-get update
sudo apt-get install postgresql-client

# Install AWS CLI (if not already installed)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Install jq
sudo apt-get install jq
```

## Connection Methods

### Method 1: Session Manager Port Forwarding (Recommended)

This method uses AWS Systems Manager Session Manager to create a secure tunnel to the database without opening security group ports or requiring a bastion host.

#### Step 1: Install Session Manager Plugin

```bash
# macOS
brew install --cask session-manager-plugin

# Ubuntu/Debian
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
sudo dpkg -i session-manager-plugin.deb
```

#### Step 2: Launch an EC2 Instance in the VPC (if not already exists)

You need a bastion/jump EC2 instance in the same VPC as the RDS database. This can be a small instance (t3.micro) for cost optimization.

```bash
# Launch a bastion instance (only needed once)
aws ec2 run-instances \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2 \
  --instance-type t3.micro \
  --iam-instance-profile Name=SSMInstanceProfile \
  --security-group-ids sg-xxxxx \
  --subnet-id subnet-xxxxx \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=afu9-bastion}]'
```

#### Step 3: Set Up Port Forwarding

Get the database endpoint from the stack outputs:

```bash
# Get database credentials
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r '.'
```

Start port forwarding session:

```bash
# Get bastion instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=afu9-bastion" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text)

# Get DB endpoint from secret
DB_HOST=$(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r '.host')

# Start port forwarding (keep this terminal open)
aws ssm start-session \
  --target $INSTANCE_ID \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host="$DB_HOST",portNumber="5432",localPortNumber="5432"
```

#### Step 4: Connect to Database

In a new terminal:

```bash
# Get credentials from Secrets Manager
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text)

DB_USER=$(echo $DB_SECRET | jq -r '.username')
DB_PASSWORD=$(echo $DB_SECRET | jq -r '.password')
DB_NAME=$(echo $DB_SECRET | jq -r '.database')

# Connect via localhost (port forwarding)
PGPASSWORD=$DB_PASSWORD psql -h localhost -p 5432 -U $DB_USER -d $DB_NAME
```

### Method 2: Bastion Host with SSH Tunnel

If you prefer using SSH:

#### Step 1: Create/Use a Bastion EC2 Instance

Ensure you have an EC2 instance in the VPC with:
- Security group allowing SSH (port 22) from your IP
- Key pair for SSH access

#### Step 2: Set Up SSH Tunnel

```bash
# Get database endpoint
DB_HOST=$(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r '.host')

# SSH tunnel (replace with your bastion details)
ssh -i ~/.ssh/your-key.pem -L 5432:$DB_HOST:5432 ec2-user@bastion-public-ip -N
```

#### Step 3: Connect to Database

Same as Method 1, Step 4 above.

### Method 3: Temporary Security Group Rule (Development Only)

⚠️ **Warning**: This method opens the database to your public IP. Only use for development/debugging.

```bash
# Get your public IP
MY_IP=$(curl -s https://checkip.amazonaws.com)

# Get security group ID
SG_ID=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query "Stacks[0].Outputs[?OutputKey=='DbSecurityGroupId'].OutputValue" \
  --output text)

# Add temporary ingress rule
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32 \
  --region eu-central-1

# Connect directly
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text)

DB_HOST=$(echo $DB_SECRET | jq -r '.host')
DB_USER=$(echo $DB_SECRET | jq -r '.username')
DB_PASSWORD=$(echo $DB_SECRET | jq -r '.password')
DB_NAME=$(echo $DB_SECRET | jq -r '.database')

PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p 5432 -U $DB_USER -d $DB_NAME -c "SELECT version();"

# IMPORTANT: Remove the rule when done
aws ec2 revoke-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32 \
  --region eu-central-1
```

## Environment Variables

For local development, you can set environment variables to simplify connections:

```bash
# Add to ~/.bashrc or ~/.zshrc
export AFU9_AWS_REGION="eu-central-1"
export AFU9_DB_SECRET_NAME="afu9/database"

# Helper function to load database credentials
afu9_db_env() {
  local secret=$(aws secretsmanager get-secret-value \
    --secret-id $AFU9_DB_SECRET_NAME \
    --region $AFU9_AWS_REGION \
    --query SecretString \
    --output text)
  
  export PGHOST=$(echo $secret | jq -r '.host')
  export PGPORT=$(echo $secret | jq -r '.port')
  export PGDATABASE=$(echo $secret | jq -r '.database')
  export PGUSER=$(echo $secret | jq -r '.username')
  export PGPASSWORD=$(echo $secret | jq -r '.password')
  export PGSSLMODE="require"
  
  echo "Database credentials loaded. Use 'psql' to connect."
}

# Usage:
# afu9_db_env
# psql
```

## Running Database Migrations

### Deploy All Migrations

From the project root:

```bash
./scripts/deploy-migrations.sh
```

### Deploy Specific Migration

```bash
./scripts/deploy-migrations.sh 001_initial_schema.sql
```

### Manual Migration

```bash
# Load credentials
source <(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r 'to_entries|map("export PG\(.key|ascii_upcase)=\(.value|tostring)")|.[]')

# Run migration
psql -f database/migrations/001_initial_schema.sql
```

## Common Tasks

### Check Database Connection

```bash
psql -c "SELECT version();"
```

### List All Tables

```bash
psql -c "\dt"
```

### View Table Schema

```bash
psql -c "\d workflows"
```

### Query Data

```bash
psql -c "SELECT * FROM workflows LIMIT 10;"
```

### Run SQL File

```bash
psql -f path/to/your/query.sql
```

### Interactive Mode

```bash
psql
```

Then use interactive commands:
```sql
-- List databases
\l

-- Connect to database
\c afu9

-- List tables
\dt

-- Describe table
\d workflows

-- Run queries
SELECT * FROM workflows;

-- Quit
\q
```

## Troubleshooting

### Cannot Connect to Database

1. **Check if port forwarding is active**
   ```bash
   netstat -an | grep 5432
   ```

2. **Verify database endpoint**
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id afu9/database \
     --region eu-central-1 | jq -r '.SecretString | fromjson'
   ```

3. **Check security group rules**
   ```bash
   aws ec2 describe-security-groups \
     --group-ids $(aws cloudformation describe-stacks \
       --stack-name Afu9NetworkStack \
       --query "Stacks[0].Outputs[?OutputKey=='DbSecurityGroupId'].OutputValue" \
       --output text) \
     --region eu-central-1
   ```

4. **Verify RDS instance is running**
   ```bash
   aws rds describe-db-instances \
     --db-instance-identifier afu9-postgres \
     --region eu-central-1 \
     --query "DBInstances[0].DBInstanceStatus"
   ```

### SSL Connection Issues

If you get SSL errors, ensure you're using `sslmode=require`:

```bash
export PGSSLMODE=require
psql
```

Or in connection string:
```bash
psql "postgresql://user:password@host:5432/database?sslmode=require"
```

### Permission Denied

Ensure your AWS credentials have permissions to:
- Read from Secrets Manager (`secretsmanager:GetSecretValue`)
- Describe CloudFormation stacks (`cloudformation:DescribeStacks`)
- Start SSM sessions (if using Session Manager)

## Database Tools

### pgAdmin

Configure a new server connection in pgAdmin:
1. Set up SSH tunnel or Session Manager port forwarding first
2. In pgAdmin, create new server:
   - Host: `localhost`
   - Port: `5432`
   - Database: `afu9`
   - Username: (from Secrets Manager)
   - Password: (from Secrets Manager)
   - SSL Mode: `Require`

### DBeaver

Similar to pgAdmin:
1. Create SSH tunnel or port forwarding
2. Add new PostgreSQL connection
3. Use localhost:5432 as endpoint
4. Enable SSL/TLS

### VS Code

Install the PostgreSQL extension and configure:
```json
{
  "host": "localhost",
  "port": 5432,
  "database": "afu9",
  "user": "afu9_admin",
  "password": "***",
  "ssl": true
}
```

## Security Best Practices

1. **Never commit credentials**: Always use Secrets Manager or environment variables
2. **Use port forwarding**: Avoid exposing database directly to internet
3. **Limit security group access**: Only allow specific IPs when necessary
4. **Rotate credentials**: Use AWS Secrets Manager rotation
5. **Monitor access**: Enable RDS logging and CloudTrail
6. **Use read-only user**: Create separate user with read-only permissions for development queries

## Creating Read-Only User (Recommended)

```sql
-- Connect as admin
psql

-- Create read-only role
CREATE ROLE afu9_readonly WITH LOGIN PASSWORD 'your-secure-password';

-- Grant connect
GRANT CONNECT ON DATABASE afu9 TO afu9_readonly;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO afu9_readonly;

-- Grant select on all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO afu9_readonly;

-- Grant select on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO afu9_readonly;
```

Then use this user for development queries to avoid accidental data modifications.

## Additional Resources

- [AWS RDS PostgreSQL Documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/15/)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
