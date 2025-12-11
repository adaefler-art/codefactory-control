#!/bin/bash
set -e

# AFU-9 Database Migration Deployment Script
# 
# This script deploys database migrations to the RDS Postgres instance.
# It retrieves credentials from AWS Secrets Manager and runs migrations.
#
# Usage:
#   ./scripts/deploy-migrations.sh [migration_file]
#
# Examples:
#   ./scripts/deploy-migrations.sh                              # Run all migrations
#   ./scripts/deploy-migrations.sh 001_initial_schema.sql       # Run specific migration

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$PROJECT_ROOT/database/migrations"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-eu-central-1}"
SECRET_NAME="${DB_SECRET_NAME:-afu9/database}"
MIGRATION_FILE="${1:-}"

echo "=================================================="
echo "AFU-9 Database Migration Deployment"
echo "=================================================="
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}Error: PostgreSQL client (psql) is not installed${NC}"
    echo "Please install PostgreSQL client:"
    echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
    echo "  macOS: brew install postgresql"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is not installed${NC}"
    echo "Please install jq:"
    echo "  Ubuntu/Debian: sudo apt-get install jq"
    echo "  macOS: brew install jq"
    exit 1
fi

echo -e "${YELLOW}Retrieving database credentials from AWS Secrets Manager...${NC}"
echo "Secret Name: $SECRET_NAME"
echo "Region: $AWS_REGION"
echo ""

# Retrieve secret from AWS Secrets Manager
SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --region "$AWS_REGION" \
    --query SecretString \
    --output text 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to retrieve secret from AWS Secrets Manager${NC}"
    echo "$SECRET_JSON"
    echo ""
    echo "Please ensure:"
    echo "  1. AWS credentials are configured (aws configure)"
    echo "  2. You have permissions to read the secret"
    echo "  3. The RDS database stack has been deployed"
    exit 1
fi

# Parse secret JSON
DB_HOST=$(echo "$SECRET_JSON" | jq -r '.host')
DB_PORT=$(echo "$SECRET_JSON" | jq -r '.port')
DB_NAME=$(echo "$SECRET_JSON" | jq -r '.database')
DB_USER=$(echo "$SECRET_JSON" | jq -r '.username')
DB_PASSWORD=$(echo "$SECRET_JSON" | jq -r '.password')

if [ -z "$DB_HOST" ] || [ "$DB_HOST" = "null" ]; then
    echo -e "${RED}Error: Could not parse database credentials from secret${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Successfully retrieved database credentials${NC}"
echo "Host: $DB_HOST"
echo "Port: $DB_PORT"
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo ""

# Set PostgreSQL environment variables
export PGHOST="$DB_HOST"
export PGPORT="$DB_PORT"
export PGDATABASE="$DB_NAME"
export PGUSER="$DB_USER"
export PGPASSWORD="$DB_PASSWORD"
export PGSSLMODE="require"

# Test database connection
echo -e "${YELLOW}Testing database connection...${NC}"
if ! psql -c "SELECT version();" > /dev/null 2>&1; then
    echo -e "${RED}Error: Could not connect to database${NC}"
    echo ""
    echo "Please ensure:"
    echo "  1. The database is running and accessible"
    echo "  2. Security group allows access from your IP (for local development)"
    echo "  3. You are connected to the correct network (VPN, AWS VPC, etc.)"
    echo ""
    echo "For local development, you may need to set up port forwarding:"
    echo "  See docs/DEVELOPMENT.md for instructions"
    exit 1
fi

echo -e "${GREEN}✓ Database connection successful${NC}"
echo ""

# Determine which migrations to run
if [ -n "$MIGRATION_FILE" ]; then
    # Run specific migration
    MIGRATION_PATH="$MIGRATIONS_DIR/$MIGRATION_FILE"
    
    if [ ! -f "$MIGRATION_PATH" ]; then
        echo -e "${RED}Error: Migration file not found: $MIGRATION_PATH${NC}"
        exit 1
    fi
    
    echo "=================================================="
    echo "Running migration: $MIGRATION_FILE"
    echo "=================================================="
    echo ""
    
    psql -f "$MIGRATION_PATH"
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✓ Migration completed successfully: $MIGRATION_FILE${NC}"
    else
        echo ""
        echo -e "${RED}✗ Migration failed: $MIGRATION_FILE${NC}"
        exit 1
    fi
else
    # Run all migrations in order
    echo "=================================================="
    echo "Running all migrations"
    echo "=================================================="
    echo ""
    
    # Check if migrations directory exists
    if [ ! -d "$MIGRATIONS_DIR" ]; then
        echo -e "${RED}Error: Migrations directory not found: $MIGRATIONS_DIR${NC}"
        exit 1
    fi
    
    # Get list of migration files (sorted)
    MIGRATION_FILES=$(find "$MIGRATIONS_DIR" -name "*.sql" -type f | sort)
    
    if [ -z "$MIGRATION_FILES" ]; then
        echo -e "${YELLOW}No migration files found in $MIGRATIONS_DIR${NC}"
        exit 0
    fi
    
    # Run each migration
    FAILED=0
    for migration in $MIGRATION_FILES; do
        filename=$(basename "$migration")
        echo "Running: $filename"
        
        if psql -f "$migration" > /tmp/migration_output.log 2>&1; then
            echo -e "${GREEN}✓ Success: $filename${NC}"
        else
            echo -e "${RED}✗ Failed: $filename${NC}"
            cat /tmp/migration_output.log
            FAILED=1
            break
        fi
        echo ""
    done
    
    if [ $FAILED -eq 0 ]; then
        echo "=================================================="
        echo -e "${GREEN}✓ All migrations completed successfully${NC}"
        echo "=================================================="
    else
        echo "=================================================="
        echo -e "${RED}✗ Migration failed${NC}"
        echo "=================================================="
        exit 1
    fi
fi

# Show database statistics
echo ""
echo "=================================================="
echo "Database Statistics"
echo "=================================================="
psql -c "
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"

echo ""
echo "=================================================="
echo "Table Row Counts"
echo "=================================================="
psql -c "
SELECT 
    schemaname,
    tablename,
    n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
"

echo ""
echo -e "${GREEN}Migration deployment complete!${NC}"
