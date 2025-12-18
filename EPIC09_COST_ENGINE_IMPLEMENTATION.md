# EPIC 09: Cost & Efficiency Engine - Implementation Summary

**EPIC:** 9 - Cost & Efficiency Engine  
**Issue:** 9.1 - Cost Attribution per Run  
**Status:** ✅ Implemented  
**Date:** 2025-12-18  
**Version:** 1.0.0

## Overview

Successfully implemented the Cost & Efficiency Engine for AFU-9 Factory, providing transparent and verursachungsgerecht (fair/causal) cost attribution for all workflow runs. The system enables economic steering, budget planning, cost optimization, and export capabilities for controlling and financial analysis.

## Implementation Summary

### 1. Database Schema ✅

**Migration:** `database/migrations/009_cost_tracking.sql`

**Tables Created:**
- `aws_cost_attribution`: Per-execution cost records with detailed breakdown
  - Cost breakdown: Lambda, ECS, RDS, S3, CloudWatch, Secrets Manager, LLM
  - Calculated columns for total AWS and total cost
  - Support for multiple calculation methods (estimated, cost_explorer, manual)
  - Automatic tracking via trigger on execution completion

- `cost_allocation_rules`: Configurable cost allocation strategies
  - Per AWS service rules (ECS, RDS, Lambda, etc.)
  - Flexible allocation methods (per_minute, per_execution, shared_pool)
  - Base rates and configuration per rule
  - 6 default rules initialized

**Materialized Views:**
- `mv_cost_per_outcome`: Factory-level Cost per Outcome KPI (24 hours)
- `mv_product_cost_analysis`: Product-level cost aggregation (7 days)

**Functions:**
- `calculate_estimated_cost()`: Calculate costs for an execution
- `refresh_cost_materialized_views()`: Refresh cost views
- `auto_calculate_execution_cost()`: Trigger function for automatic cost calculation

**Triggers:**
- Auto-calculate costs on workflow execution completion
- Update timestamps on cost records

### 2. Cost Service ✅

**File:** `control-center/src/lib/cost-service.ts`

**Core Functions:**
- `getExecutionCost()`: Get cost for specific execution
- `getRecentExecutionCosts()`: Get recent execution costs (paginated)
- `getProductCostAnalysis()`: Product-level cost aggregation
- `getFactoryCostOverview()`: Factory-level KPI and overview
- `getCostDataForExport()`: Export data with date filtering
- `convertCostDataToCSV()`: CSV conversion utility
- `getCostAllocationRules()`: Retrieve allocation rules
- `updateCostAllocationRule()`: Update rule configuration
- `refreshCostViews()`: Refresh materialized views

**Type Definitions:**
- `ExecutionCost`: Per-run cost breakdown
- `ProductCostSummary`: Product-level aggregation
- `FactoryCostOverview`: Factory-level KPI data
- `CostExportRow`: Export format
- `CostAllocationRule`: Rule configuration

### 3. API Endpoints ✅

**Endpoints Implemented:**

1. **GET /api/v1/costs/runs**
   - Query params: `executionId`, `limit`
   - Returns: Recent execution costs or specific execution cost
   - Use case: Run-level cost tracking and analysis

2. **GET /api/v1/costs/products**
   - Query params: `refresh`
   - Returns: Product-level cost aggregation (7 days)
   - Use case: Product cost comparison and optimization

3. **GET /api/v1/costs/factory**
   - Query params: `refresh`
   - Returns: Factory-level overview with Cost per Outcome KPI (24 hours)
   - Use case: Economic steering and KPI monitoring

4. **GET /api/v1/costs/export**
   - Query params: `format` (json/csv), `startDate`, `endDate`
   - Returns: Cost data in JSON or CSV format
   - Use case: Financial reporting and controlling integration

### 4. KPI Integration ✅

**KPI: Cost per Outcome**

**Formula:**
```
Cost per Outcome = Total Costs / Successful Outcomes

Where:
- Total Costs = AWS Infrastructure Cost + LLM Cost
- Successful Outcomes = COUNT(executions WHERE status = 'completed')
```

**Updates to KPI_DEFINITIONS.md:**
- Version bumped to 1.2.0
- Added Cost per Outcome KPI definition (#12)
- Detailed breakdown of cost components
- Interpretation guidelines
- Optimization strategies
- Related metrics

**Data Sources:**
- `aws_cost_attribution.total_cost_usd`
- `workflow_executions.status`
- Aggregated via `mv_cost_per_outcome`

### 5. Documentation ✅

**Created:**
- `docs/COST_ATTRIBUTION.md` - Comprehensive canonical guide (15KB)
  - Architecture and design
  - Cost calculation formulas
  - API documentation with examples
  - Default cost allocation rules
  - Configuration guide
  - Optimization strategies
  - Troubleshooting
  - Integration with controlling systems

**Updated:**
- `docs/KPI_DEFINITIONS.md` - Added Cost per Outcome KPI
- `README.md` - Added EPIC 9 section and references

### 6. Testing ✅

**File:** `control-center/__tests__/lib/cost-service.test.ts`

**Test Coverage:**
- `getExecutionCost()` - Single execution and non-existent
- `getRecentExecutionCosts()` - List and pagination
- `getProductCostAnalysis()` - Product aggregation
- `getFactoryCostOverview()` - Factory KPI calculation
- `getCostDataForExport()` - Export data and filtering
- `convertCostDataToCSV()` - CSV format validation
- `getCostAllocationRules()` - Rule retrieval and defaults
- Cost calculation integration tests
- KPI: Cost per Outcome validation

## Cost Attribution Model

### Calculation Methods

1. **Estimated (Default)**
   - Uses `cost_allocation_rules` table
   - Immediate calculation on execution completion
   - Based on duration and resource allocation
   - No external API calls required

2. **Cost Explorer (Planned)**
   - AWS Cost Explorer API integration
   - Actual AWS costs with resource tagging
   - Batch updates (daily/weekly)
   - Higher accuracy, delayed availability

3. **Manual**
   - Manual overrides for corrections
   - Audit trail maintained
   - Use case: Adjustments and special cases

### Default Cost Allocation Rules

| Service | Method | Rate (USD) | Notes |
|---------|--------|------------|-------|
| ECS Fargate | Per Minute | 0.0000116667 | 0.25 vCPU, 0.5 GB |
| RDS PostgreSQL | Shared Pool | 0.0001/min | db.t3.micro |
| S3 | Per Execution | 0.000001 | Minimal cost |
| CloudWatch | Per Execution | 0.00001 | Logs ingestion |
| Secrets Manager | Shared Pool | 0.00001 | Shared access |
| Lambda | Per Invocation | 0.0000002 | v0.1 only |

### Cost Breakdown

**Per Execution:**
```
Total Cost = AWS Infrastructure Cost + LLM Cost

AWS Infrastructure Cost = 
  ECS Cost (per-minute × duration) +
  RDS Cost (shared pool rate × duration) +
  S3 Cost (per-execution) +
  CloudWatch Cost (per-execution) +
  Secrets Manager Cost (shared pool) +
  Lambda Cost (per-invocation, if applicable)

LLM Cost = 
  SUM(agent_runs.cost_usd WHERE execution_id = X)
```

## Key Features

### 1. Automatic Cost Tracking
- Trigger-based automatic calculation on execution completion
- No manual intervention required
- Immediate availability of cost data

### 2. Multi-Level Aggregation
- **Run Level**: Per-execution granular cost tracking
- **Product Level**: Aggregated by repository (7 days)
- **Factory Level**: Global KPI and overview (24 hours)

### 3. Export Capabilities
- JSON format for API integration
- CSV format for spreadsheet and controlling tools
- Date range filtering
- Automated daily exports possible

### 4. Configurable Allocation
- Flexible cost allocation rules
- Per-service configuration
- Hot-swappable without code changes
- Supports multiple allocation methods

### 5. Cost Optimization Support
- Identifies expensive executions and products
- Tracks cost trends over time
- Provides optimization recommendations
- Enables cost-based steering decisions

## API Usage Examples

### Get Recent Execution Costs
```bash
curl http://localhost:3000/api/v1/costs/runs?limit=10
```

### Get Cost for Specific Execution
```bash
curl http://localhost:3000/api/v1/costs/runs?executionId=abc-123
```

### Get Product Cost Analysis
```bash
curl http://localhost:3000/api/v1/costs/products
```

### Get Factory Cost Overview with KPI
```bash
curl http://localhost:3000/api/v1/costs/factory
```

### Export Costs as CSV
```bash
curl "http://localhost:3000/api/v1/costs/export?format=csv&startDate=2025-12-01&endDate=2025-12-31" -o costs.csv
```

### Export Costs as JSON
```bash
curl http://localhost:3000/api/v1/costs/export?format=json
```

## Integration Points

### 1. Workflow Execution
- Automatic cost calculation on completion
- No changes required to workflow execution logic
- Transparent integration

### 2. Agent Runs
- LLM token costs from `agent_runs.cost_usd`
- Aggregated per execution
- Included in total cost

### 3. KPI System
- Cost per Outcome integrated into KPI dashboard
- Materialized views for performance
- Refreshable on-demand or scheduled

### 4. Controlling Systems
- CSV/JSON export for external systems
- Date range filtering for reporting periods
- Automated export workflows possible

## Cost Optimization Strategies

### 1. Reduce Execution Duration
- Optimize agent logic and tool calls
- Use parallel execution where possible
- Cache frequently accessed data
- **Impact:** Lower ECS per-minute costs

### 2. Optimize LLM Token Usage
- Use shorter, focused prompts
- Implement prompt caching
- Choose appropriate models
- **Impact:** Reduce LLM costs (often largest component)

### 3. Batch Operations
- Group related operations in single execution
- Amortize fixed costs
- **Impact:** Lower per-operation cost

### 4. Right-Size Resources
- Monitor actual CPU/memory usage
- Adjust ECS task allocation
- **Impact:** Lower infrastructure costs

### 5. Implement Caching
- Cache successful operation results
- Skip redundant executions
- Use deterministic build outputs
- **Impact:** Reduce total execution count

## Database Migration

**File:** `database/migrations/009_cost_tracking.sql`
**Lines:** 431

**Migration Steps:**
1. Create `aws_cost_attribution` table
2. Create `cost_allocation_rules` table
3. Insert default allocation rules (6 rules)
4. Create materialized views
5. Create cost calculation functions
6. Add automatic cost calculation trigger
7. Add indexes for query performance

**Rollback:** Not provided (one-way migration)

## Performance Considerations

### 1. Materialized Views
- Pre-aggregated for fast queries
- Refreshable on-demand (`?refresh=true`)
- Scheduled refresh recommended (e.g., every 5 minutes)

### 2. Indexes
- Execution ID, calculated_at, period, total_cost indexed
- Efficient filtering and sorting
- Fast cost queries at all levels

### 3. Automatic Calculation
- Trigger-based, minimal overhead
- Only calculates on completion
- No impact on running executions

## Monitoring and Observability

### Recommended Metrics
- Cost per Outcome trend
- Total daily factory cost
- Cost breakdown by service
- Most expensive products/executions
- LLM cost percentage of total

### Recommended Alarms
1. **High Cost per Outcome**: > $0.10
2. **Daily Cost Spike**: > 150% of 7-day average
3. **LLM Cost Dominance**: > 75% of total cost

## Future Enhancements

1. **AWS Cost Explorer Integration**
   - Real actual costs via API
   - Resource tagging for attribution
   - Batch daily/weekly updates

2. **Cost Forecasting**
   - Predict future costs based on trends
   - Budget planning support
   - Anomaly detection

3. **Budget Alerts**
   - Automatic alerts when exceeding budgets
   - Per-product budget tracking
   - Email/Slack notifications

4. **Product Chargeback**
   - Automated cost allocation to teams
   - Monthly chargeback reports
   - Cost center attribution

5. **Spot Instance Support**
   - Lower ECS costs with spot pricing
   - Fallback to on-demand
   - Cost savings tracking

## Files Changed

### Created (9 files)
1. `database/migrations/009_cost_tracking.sql` - Database schema
2. `control-center/src/lib/cost-service.ts` - Cost service layer
3. `control-center/app/api/v1/costs/runs/route.ts` - Run-level API
4. `control-center/app/api/v1/costs/products/route.ts` - Product-level API
5. `control-center/app/api/v1/costs/factory/route.ts` - Factory-level API
6. `control-center/app/api/v1/costs/export/route.ts` - Export API
7. `control-center/__tests__/lib/cost-service.test.ts` - Tests
8. `docs/COST_ATTRIBUTION.md` - Canonical documentation
9. `EPIC09_COST_ENGINE_IMPLEMENTATION.md` - This summary

### Modified (2 files)
1. `docs/KPI_DEFINITIONS.md` - Added Cost per Outcome KPI (v1.2.0)
2. `README.md` - Added EPIC 9 section

## Compliance and Governance

### Canonical Documents
- `docs/COST_ATTRIBUTION.md` - Single source of truth for cost attribution
- `docs/KPI_DEFINITIONS.md` - Cost per Outcome KPI definition

### Change Management
All changes to cost allocation rules must follow:
1. Propose with justification
2. Financial controller approval
3. Test on staging
4. Deploy to production
5. Monitor impact
6. Document changes

### Audit Trail
- Calculation method tracked per record
- Timestamp of calculation
- Metadata for reproducibility
- Version tracking in KPI system

## Acceptance Criteria

✅ **All acceptance criteria met:**

1. **Cost Attribution per Run**
   - ✅ AWS costs assignable per run
   - ✅ Cost breakdown by AWS service
   - ✅ LLM costs integrated
   - ✅ Automatic calculation on completion

2. **Exportability**
   - ✅ CSV export for controlling
   - ✅ JSON export for API integration
   - ✅ Date range filtering
   - ✅ Product-level aggregation

3. **Economic Steering**
   - ✅ Cost per Outcome KPI
   - ✅ Factory-level overview
   - ✅ Product cost comparison
   - ✅ Optimization recommendations

4. **Transparency**
   - ✅ Detailed cost breakdown
   - ✅ Calculation method tracking
   - ✅ Configurable allocation rules
   - ✅ Comprehensive documentation

## Next Steps

### Deployment
1. Run database migration `009_cost_tracking.sql`
2. Verify cost allocation rules are correct for your environment
3. Deploy control-center with new API endpoints
4. Test cost calculation with real executions
5. Set up scheduled materialized view refresh
6. Configure CloudWatch metrics and alarms

### Configuration
1. Review and adjust cost allocation rules for accurate AWS pricing
2. Set up automated daily CSV exports for controlling
3. Configure budget alerts and thresholds
4. Create cost dashboard in Control Center

### Monitoring
1. Track Cost per Outcome KPI daily
2. Monitor cost trends and anomalies
3. Review most expensive products/executions
4. Optimize based on cost data

## References

- **Issue**: EPIC 9, Issue 9.1 from AFU-9 Roadmap v0.3
- **Documentation**: `docs/COST_ATTRIBUTION.md`
- **KPI Definition**: `docs/KPI_DEFINITIONS.md#12-cost-per-outcome`
- **Database Schema**: `database/migrations/009_cost_tracking.sql`
- **Service Layer**: `control-center/src/lib/cost-service.ts`
- **API Routes**: `control-center/app/api/v1/costs/*`
- **Tests**: `control-center/__tests__/lib/cost-service.test.ts`

## Support

For questions or issues:
- **Documentation**: `docs/COST_ATTRIBUTION.md` (canonical)
- **GitHub Issues**: Tag with `cost`, `epic-9`
- **Slack**: `#factory-costs` channel

---

**Status:** ✅ Implementation Complete  
**Version:** 1.0.0  
**Date:** 2025-12-18  
**Maintained By:** Factory Platform Team

---

_End of EPIC 09 Implementation Summary_
