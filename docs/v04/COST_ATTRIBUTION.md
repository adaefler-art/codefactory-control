# AFU-9 Cost Attribution Guide

**EPIC:** 9 - Cost & Efficiency Engine  
**Issue:** 9.1 - Cost Attribution per Run  
**Status:** Canonical  
**Version:** 1.0.0  
**Last Updated:** 2025-12-18

## Overview

The Cost & Efficiency Engine provides transparent and verursachungsgerecht (fair/causal) cost attribution for all Factory workflow runs. It enables economic steering, budget planning, and cost optimization by tracking AWS infrastructure and LLM costs per execution.

## Key Features

1. **Per-Run Cost Tracking**: Automatic cost calculation for every workflow execution
2. **Cost Breakdown**: Detailed breakdown by AWS service (ECS, RDS, S3, CloudWatch, Secrets Manager)
3. **LLM Cost Integration**: Token-based costs from agent runs included in total cost
4. **Product-Level Aggregation**: Cost analysis per product/repository
5. **Factory-Level KPI**: Cost per Outcome metric for overall efficiency
6. **Export Capabilities**: CSV and JSON export for controlling and financial analysis
7. **Configurable Allocation**: Flexible cost allocation rules for different AWS services

## Architecture

### Database Schema

**Tables:**
- `aws_cost_attribution`: Per-execution cost records with detailed breakdown
- `cost_allocation_rules`: Configurable rules for cost calculation
- `mv_cost_per_outcome`: Materialized view for factory-level KPI (24 hours)
- `mv_product_cost_analysis`: Materialized view for product-level analysis (7 days)

**Triggers:**
- Automatic cost calculation on workflow execution completion
- Auto-population of cost attribution records

### Cost Calculation Methods

1. **Estimated (Default)**: 
   - Uses `cost_allocation_rules` to calculate costs
   - Based on execution duration and resource allocation
   - Immediate availability (no external API calls)

2. **Cost Explorer (Planned)**:
   - Integration with AWS Cost Explorer API
   - Actual AWS costs with resource tagging
   - Batch updates (daily/weekly)

3. **Manual**:
   - Manual override for corrections or adjustments
   - Audit trail maintained

## Cost Attribution Formula

```
Total Cost per Execution = AWS Infrastructure Cost + LLM Cost

Where:
  AWS Infrastructure Cost = 
    ECS Cost (per-minute) +
    RDS Cost (shared pool) +
    S3 Cost (per-execution) +
    CloudWatch Cost (per-execution) +
    Secrets Manager Cost (shared pool) +
    Lambda Cost (per-invocation, if applicable)
  
  LLM Cost = 
    SUM(agent_runs.cost_usd for execution)
```

### Default Cost Allocation Rules

| AWS Service | Allocation Method | Base Rate (USD) | Notes |
|-------------|-------------------|-----------------|-------|
| ECS Fargate | Per Minute | 0.0000116667 | 0.25 vCPU, 0.5 GB RAM |
| RDS PostgreSQL | Shared Pool | 0.0001/min | db.t3.micro, shared across runs |
| S3 | Per Execution | 0.000001 | Minimal per-execution cost |
| CloudWatch | Per Execution | 0.00001 | Log ingestion and storage |
| Secrets Manager | Shared Pool | 0.00001 | Shared secret access cost |
| Lambda | Per Invocation | 0.0000002 | If applicable (v0.1 only) |

**Note:** These are estimated rates based on AWS pricing (December 2025, eu-central-1). Adjust in `cost_allocation_rules` table for accuracy.

## API Endpoints

### 1. Run-Level Costs

**GET /api/v1/costs/runs**

Returns cost data for recent workflow executions.

**Query Parameters:**
- `executionId` (optional): Get cost for specific execution
- `limit` (optional, default: 50, max: 100): Number of recent runs to return

**Response:**
```json
{
  "api": {
    "version": "1.0.0",
    "endpoint": "/api/v1/costs/runs"
  },
  "timestamp": "2025-12-18T10:30:00Z",
  "data": [
    {
      "executionId": "uuid",
      "workflowId": "uuid",
      "status": "completed",
      "startedAt": "2025-12-18T10:00:00Z",
      "completedAt": "2025-12-18T10:05:00Z",
      "durationMinutes": 5.0,
      "lambdaCost": 0,
      "ecsCost": 0.000583,
      "rdsCost": 0.0005,
      "s3Cost": 0.000001,
      "cloudwatchCost": 0.00001,
      "secretsManagerCost": 0.00001,
      "otherAwsCost": 0,
      "llmCost": 0.002456,
      "totalAwsCost": 0.001094,
      "totalCost": 0.00355,
      "calculationMethod": "estimated",
      "calculatedAt": "2025-12-18T10:05:01Z"
    }
  ],
  "meta": {
    "count": 50,
    "limit": 50
  }
}
```

**Example:**
```bash
# Get recent execution costs
curl http://localhost:3000/api/v1/costs/runs?limit=10

# Get cost for specific execution
curl http://localhost:3000/api/v1/costs/runs?executionId=abc-123
```

### 2. Product-Level Costs

**GET /api/v1/costs/products**

Returns aggregated cost data per product/repository (last 7 days).

**Query Parameters:**
- `refresh` (optional): Set to `true` to refresh materialized views before query

**Response:**
```json
{
  "api": {
    "version": "1.0.0",
    "endpoint": "/api/v1/costs/products"
  },
  "timestamp": "2025-12-18T10:30:00Z",
  "data": [
    {
      "repositoryId": "uuid",
      "productName": "owner/repo",
      "totalCost": 0.145,
      "avgCostPerRun": 0.0048,
      "costPerOutcome": 0.0055,
      "lambdaCost": 0,
      "ecsCost": 0.025,
      "rdsCost": 0.020,
      "llmCost": 0.100,
      "totalExecutions": 30,
      "successfulOutcomes": 26,
      "periodStart": "2025-12-11T00:00:00Z",
      "periodEnd": "2025-12-18T10:30:00Z"
    }
  ],
  "meta": {
    "count": 5,
    "period": "7 days"
  }
}
```

**Example:**
```bash
# Get product cost analysis
curl http://localhost:3000/api/v1/costs/products

# Force refresh materialized views
curl http://localhost:3000/api/v1/costs/products?refresh=true
```

### 3. Factory-Level Costs

**GET /api/v1/costs/factory**

Returns factory-wide cost overview and Cost per Outcome KPI (last 24 hours).

**Query Parameters:**
- `refresh` (optional): Set to `true` to refresh materialized views before query

**Response:**
```json
{
  "api": {
    "version": "1.0.0",
    "endpoint": "/api/v1/costs/factory"
  },
  "timestamp": "2025-12-18T10:30:00Z",
  "kpi": {
    "costPerOutcome": 0.0052,
    "unit": "usd",
    "description": "Total costs divided by successful outcomes"
  },
  "data": {
    "costPerOutcome": 0.0052,
    "totalLambdaCost": 0,
    "totalEcsCost": 0.456,
    "totalRdsCost": 0.288,
    "totalS3Cost": 0.001,
    "totalCloudwatchCost": 0.012,
    "totalLlmCost": 1.245,
    "totalAwsCost": 0.757,
    "totalCost": 2.002,
    "totalExecutions": 120,
    "successfulOutcomes": 105,
    "failedExecutions": 15,
    "periodStart": "2025-12-17T10:30:00Z",
    "periodEnd": "2025-12-18T10:30:00Z",
    "calculatedAt": "2025-12-18T10:30:00Z"
  },
  "meta": {
    "period": "24 hours"
  }
}
```

**Example:**
```bash
# Get factory cost overview
curl http://localhost:3000/api/v1/costs/factory

# Force refresh
curl http://localhost:3000/api/v1/costs/factory?refresh=true
```

### 4. Cost Export

**GET /api/v1/costs/export**

Exports cost data in CSV or JSON format for controlling and financial analysis.

**Query Parameters:**
- `format` (optional, default: json): Export format (`json` or `csv`)
- `startDate` (optional): ISO 8601 date string for filtering (e.g., `2025-12-01`)
- `endDate` (optional): ISO 8601 date string for filtering (e.g., `2025-12-31`)

**Response (JSON):**
```json
{
  "api": {
    "version": "1.0.0",
    "endpoint": "/api/v1/costs/export"
  },
  "timestamp": "2025-12-18T10:30:00Z",
  "data": [
    {
      "executionId": "uuid",
      "workflowId": "uuid",
      "productName": "owner/repo",
      "status": "completed",
      "startedAt": "2025-12-18T10:00:00Z",
      "completedAt": "2025-12-18T10:05:00Z",
      "durationMinutes": 5.0,
      "totalCost": 0.00355,
      "awsCost": 0.001094,
      "llmCost": 0.002456,
      "ecsCost": 0.000583,
      "rdsCost": 0.0005,
      "calculationMethod": "estimated"
    }
  ],
  "meta": {
    "count": 150,
    "format": "json",
    "startDate": "2025-12-01",
    "endDate": "2025-12-31"
  }
}
```

**Response (CSV):**
```csv
Execution ID,Workflow ID,Product Name,Status,Started At,Completed At,Duration (minutes),Total Cost (USD),AWS Cost (USD),LLM Cost (USD),ECS Cost (USD),RDS Cost (USD),Calculation Method
"uuid","uuid","owner/repo","completed","2025-12-18T10:00:00Z","2025-12-18T10:05:00Z","5.00","0.003550","0.001094","0.002456","0.000583","0.000500","estimated"
```

**Examples:**
```bash
# Export as JSON
curl http://localhost:3000/api/v1/costs/export?format=json

# Export as CSV
curl http://localhost:3000/api/v1/costs/export?format=csv -o costs.csv

# Export with date filter
curl "http://localhost:3000/api/v1/costs/export?format=csv&startDate=2025-12-01&endDate=2025-12-31" -o costs-december.csv
```

## Cost per Outcome KPI

**Definition:** Total costs (AWS + LLM) divided by successful workflow outcomes.

**Formula:**
```
Cost per Outcome = Total Costs / Successful Outcomes

Where:
- Total Costs = SUM(aws_cost_attribution.total_cost_usd)
- Successful Outcomes = COUNT(workflow_executions WHERE status = 'completed')
```

**Target Values:**
- **< $0.01**: Excellent efficiency
- **$0.01 - $0.05**: Good efficiency
- **$0.05 - $0.10**: Acceptable efficiency
- **> $0.10**: Review for optimization

**KPI Dashboard:**
Available in Control Center at `/observability` and via API at `/api/v1/costs/factory`.

## Configuration

### Updating Cost Allocation Rules

Cost allocation rules can be updated in the database to reflect accurate AWS pricing:

```sql
-- Update ECS Fargate rate
UPDATE cost_allocation_rules
SET base_rate_usd = 0.0000125, -- New rate
    config = '{"vcpu": 0.25, "memory_gb": 0.5, "pricing_model": "fargate"}'::jsonb
WHERE rule_name = 'ECS Fargate Per Minute';

-- Update RDS shared pool rate
UPDATE cost_allocation_rules
SET base_rate_usd = 0.00012
WHERE rule_name = 'RDS PostgreSQL Shared';

-- Disable a rule
UPDATE cost_allocation_rules
SET enabled = false
WHERE rule_name = 'Lambda Invocation';
```

### Adding Custom Rules

```sql
INSERT INTO cost_allocation_rules (
  rule_name,
  description,
  aws_service,
  allocation_method,
  base_rate_usd,
  config,
  enabled
) VALUES (
  'Custom Service Cost',
  'Custom AWS service cost allocation',
  'custom_service',
  'per_execution',
  0.00005,
  '{"service_type": "custom"}'::jsonb,
  true
);
```

## Optimization Strategies

### 1. Reduce Execution Duration
- Optimize agent logic and tool calls
- Use parallel execution where possible
- Cache frequently accessed data

**Impact:** Lower ECS per-minute costs

### 2. Optimize LLM Token Usage
- Use shorter, more focused prompts
- Implement prompt caching
- Choose appropriate models (not always largest)

**Impact:** Direct reduction in LLM costs (often largest component)

### 3. Batch Operations
- Group related operations in single execution
- Amortize fixed costs across multiple operations

**Impact:** Lower per-operation cost

### 4. Right-Size ECS Tasks
- Monitor actual CPU/memory usage
- Adjust vCPU and memory allocation accordingly
- Use spot instances for non-critical workloads (planned)

**Impact:** Lower ECS costs without performance loss

### 5. Implement Result Caching
- Cache successful operation results
- Skip redundant executions
- Use deterministic build outputs

**Impact:** Reduce total number of executions

## Monitoring and Alerts

### CloudWatch Metrics

The Cost & Efficiency Engine emits CloudWatch metrics for monitoring:

```
Namespace: AFU9/Costs
Metrics:
  - CostPerOutcome (USD)
  - TotalFactoryCost (USD)
  - ExecutionCost (USD per execution)
Dimensions:
  - Environment (staging/production)
  - Period (24h/7d/30d)
```

### Recommended Alarms

1. **High Cost per Outcome**:
   - Threshold: > $0.10
   - Action: Review expensive executions

2. **Daily Cost Spike**:
   - Threshold: > 150% of 7-day average
   - Action: Investigate anomaly

3. **LLM Cost Dominance**:
   - Threshold: LLM costs > 75% of total
   - Action: Optimize prompt usage

## Integration with Controlling

### Export Workflow

1. **Daily Export**: Automated daily CSV export for controlling team
2. **Monthly Reporting**: Aggregated cost reports per product
3. **Budget Tracking**: Track actual vs. budgeted costs
4. **Chargeback**: Allocate costs to product teams

### Example Automation

```bash
#!/bin/bash
# Daily cost export for controlling

DATE=$(date +%Y-%m-%d)
START_DATE=$(date -d "1 month ago" +%Y-%m-%d)

curl "http://localhost:3000/api/v1/costs/export?format=csv&startDate=$START_DATE&endDate=$DATE" \
  -o "/exports/costs-$DATE.csv"

# Upload to S3 for controlling team
aws s3 cp "/exports/costs-$DATE.csv" "s3://controlling-bucket/factory-costs/$DATE.csv"
```

## Data Retention

- **Detailed Cost Records**: 90 days in `aws_cost_attribution` table
- **Aggregated Snapshots**: 2 years in `kpi_snapshots` table
- **Export Archives**: Indefinite in S3 for compliance

## Governance

### Change Management

All changes to cost allocation rules must follow:

1. **Propose**: Document rate changes with justification
2. **Review**: Financial controller approval required
3. **Test**: Validate on staging environment first
4. **Deploy**: Update production rules
5. **Monitor**: Track impact on Cost per Outcome KPI
6. **Document**: Update this guide with changes

### Audit Trail

All cost calculations include:
- Calculation method (estimated/cost_explorer/manual)
- Timestamp of calculation
- Version of cost allocation rules used
- Metadata for reproducibility

## Troubleshooting

### Cost Data Missing for Execution

**Issue:** No cost record in `aws_cost_attribution` for completed execution.

**Solution:**
```sql
-- Manually trigger cost calculation
SELECT calculate_estimated_cost('execution-uuid');
```

### Cost Seems Too High/Low

**Issue:** Cost attribution doesn't match expectations.

**Solution:**
1. Check execution duration: `SELECT completed_at - started_at FROM workflow_executions WHERE id = 'uuid';`
2. Review allocation rules: `SELECT * FROM cost_allocation_rules WHERE enabled = TRUE;`
3. Check LLM costs: `SELECT SUM(cost_usd) FROM agent_runs WHERE execution_id = 'uuid';`
4. Verify calculation method: `SELECT calculation_method FROM aws_cost_attribution WHERE execution_id = 'uuid';`

### Materialized Views Out of Date

**Issue:** Cost KPIs showing stale data.

**Solution:**
```sql
-- Manually refresh views
SELECT refresh_cost_materialized_views();
```

Or via API:
```bash
curl http://localhost:3000/api/v1/costs/factory?refresh=true
```

## Future Enhancements

1. **AWS Cost Explorer Integration**: Real actual costs via API
2. **Cost Forecasting**: Predict future costs based on trends
3. **Budget Alerts**: Automatic alerts when exceeding budgets
4. **Product Chargeback**: Automated cost allocation to teams
5. **Spot Instance Support**: Lower ECS costs with spot pricing
6. **Reserved Instance Tracking**: Account for RI discounts

## References

- **Database Schema**: `database/migrations/009_cost_tracking.sql`
- **Service Layer**: `control-center/src/lib/cost-service.ts`
- **API Routes**: `control-center/app/api/v1/costs/*`
- **KPI Definition**: [KPI_DEFINITIONS.md](./KPI_DEFINITIONS.md#12-cost-per-outcome)
- **AWS Pricing**: [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)

## Support

For questions or issues with cost attribution:
- **Documentation**: This guide (canonical reference)
- **GitHub Issues**: Tag with `cost`, `epic-9`
- **Slack**: `#factory-costs` channel
- **On-call**: Page for critical cost anomalies

---

**Document Status:** Canonical ✅  
**Version:** 1.0.0  
**Maintained By:** Factory Platform Team  
**Next Review:** 2025-03-18

---

_End of Cost Attribution Guide v1.0.0_
