# AFU-9 Factory KPI Definitions

**Version:** 1.2.0  
**Status:** Canonical  
**EPIC:** 3 - KPI System & Telemetry  
**Last Updated:** 2025-12-18

This document defines all Key Performance Indicators (KPIs) for the AFU-9 Factory Control Plane. It serves as the **Single Source of Truth** for KPI calculations, ensuring consistent measurement and steering across all factory operations.

## 📋 Governance Documents

This is the **canonical KPI definition document**. All changes must follow the governance process:

- **[KPI Governance](./KPI_GOVERNANCE.md)** - Change management process and governance framework
- **[KPI Changelog](./KPI_CHANGELOG.md)** - Complete version history with detailed change records
- **[KPI API](./KPI_API.md)** - REST API documentation for accessing KPI data

**⚠️ Important:** Any changes to KPI formulas, calculations, or definitions MUST be:
1. Documented in the KPI Changelog
2. Reviewed and approved by the Platform Team
3. Validated with the KPI version validator
4. Communicated to all stakeholders

## Overview

The AFU-9 Factory tracks KPIs at three levels:
- **Run Level**: Individual workflow execution metrics
- **Product Level**: Aggregated metrics per product/repository
- **Factory Level**: Global metrics across all products

All KPIs are:
- **Versioned**: Changes to KPI definitions require version increments
- **Documented**: Formula and rationale clearly specified
- **Reproducible**: Same inputs always produce same outputs
- **Historized**: Time-series data retained for trending

## Core Factory KPIs

### 1. Mean Time to Insight (MTTI)

**Category:** Efficiency  
**Level:** Factory, Product, Run  
**Unit:** Milliseconds  
**Target:** < 300,000 ms (5 minutes)

**Definition:**  
Average time from workflow execution start until a terminal state (completed or failed) is reached, providing actionable insight.

**Formula:**
```
MTTI = AVG(completion_time - start_time) for all executions in period
     = SUM(duration_ms) / COUNT(executions)
     WHERE status IN ('completed', 'failed')
```

**Calculation:**
```sql
SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as mtti_ms
FROM workflow_executions
WHERE status IN ('completed', 'failed')
  AND started_at >= NOW() - INTERVAL '24 hours';
```

**Rationale:**  
MTTI measures how quickly the factory can process work items and provide feedback. Lower MTTI enables faster iteration cycles and better developer experience.

---

### 2. Success Rate

**Category:** Reliability  
**Level:** Factory, Product  
**Unit:** Percentage (0-100)  
**Target:** > 85%

**Definition:**  
Percentage of workflow executions that complete successfully without errors.

**Formula:**
```
Success Rate = (completed_executions / (completed_executions + failed_executions)) × 100
```

**Calculation:**
```sql
SELECT 
  ROUND(
    (COUNT(*) FILTER (WHERE status = 'completed')::DECIMAL / 
     COUNT(*) FILTER (WHERE status IN ('completed', 'failed'))) * 100,
    2
  ) as success_rate_pct
FROM workflow_executions
WHERE started_at >= NOW() - INTERVAL '24 hours';
```

**Rationale:**  
Success rate indicates factory reliability and stability. High success rates build confidence in autonomous operations.

---

### 3. Steering Accuracy

**Category:** Quality  
**Level:** Factory  
**Unit:** Percentage (0-100)  
**Target:** > 90%  
**KPI for:** Issue 3.1 (Canonical KPI Definition)

**Definition:**  
Measures how well factory autonomous decisions align with expected or validated outcomes. Tracks the percentage of verdicts and automated actions that are accepted (not reverted, overridden, or escalated).

**Formula:**
```
Steering Accuracy = (accepted_decisions / total_decisions) × 100

Where:
- accepted_decisions: Verdicts/actions not overridden by humans
- total_decisions: All verdicts and autonomous actions taken
```

**Calculation:**
```sql
-- Track decisions through verdict outcomes
SELECT 
  ROUND(
    (COUNT(*) FILTER (WHERE outcome = 'accepted')::DECIMAL / 
     COUNT(*)) * 100,
    2
  ) as steering_accuracy_pct
FROM verdict_outcomes
WHERE created_at >= NOW() - INTERVAL '24 hours';
```

**Components:**
1. **Verdict Acceptance**: Verdicts followed without human override
2. **Action Success**: Automated actions (wait/retry, open issue) that resolve correctly
3. **Escalation Rate**: Lower escalation to humans indicates higher accuracy

**Rationale:**  
Steering Accuracy validates that the factory's autonomous decision-making is trustworthy and aligned with human expectations. High accuracy enables increased autonomy.

**Implementation Notes:**
- Requires tracking verdict outcomes (accepted, overridden, escalated)
- Human feedback loop for verdict validation
- Confidence score correlation analysis

---

### 4. KPI Freshness

**Category:** Observability  
**Level:** Factory  
**Unit:** Seconds  
**Target:** < 60 seconds  
**KPI for:** Issue 3.2 (KPI Aggregation Pipeline)

**Definition:**  
Measures how current the displayed KPI data is. The time elapsed since the last KPI calculation/aggregation.

**Formula:**
```
KPI Freshness = NOW() - last_kpi_calculation_timestamp
```

**Calculation:**
```sql
SELECT 
  EXTRACT(EPOCH FROM (NOW() - MAX(calculated_at))) as freshness_seconds
FROM kpi_snapshots
WHERE kpi_version = '1.0.0';
```

**Targets by Context:**
- **Dashboard Display**: < 60 seconds (real-time monitoring)
- **Historical Analysis**: < 300 seconds (5 minutes)
- **Reporting**: < 3600 seconds (1 hour)

**Rationale:**  
Fresh KPIs enable timely decision-making and accurate situational awareness. Stale data can lead to incorrect steering decisions.

**Implementation Notes:**
- Snapshot timestamp tracked in `kpi_snapshots` table
- Aggregation pipeline runs periodically
- Alert on freshness > threshold

---

### 5. Verdict Consistency

**Category:** Quality  
**Level:** Factory  
**Unit:** Percentage (0-100)  
**Target:** > 95%

**Definition:**  
Percentage of error fingerprint groups where all verdicts have consistent classifications and confidence scores.

**Formula:**
```
Verdict Consistency = (consistent_fingerprint_groups / total_fingerprint_groups) × 100

Where a fingerprint group is "consistent" if all verdicts with same fingerprint have:
- Identical error_class
- Identical confidence_score
```

**Calculation:**
```sql
-- Implemented in factory-status.ts getRecentVerdicts()
-- Groups verdicts by fingerprint and checks for consistency
```

**Rationale:**  
High consistency indicates deterministic and reliable verdict generation, critical for governance and auditability.

---

### 6. Factory Uptime

**Category:** Availability  
**Level:** Factory  
**Unit:** Percentage (0-100)  
**Target:** > 99.5%

**Definition:**  
Percentage of time when all critical factory services are operational and healthy.

**Formula:**
```
Factory Uptime = (healthy_intervals / total_intervals) × 100
```

**Calculation:**
```
Based on CloudWatch health check metrics:
- Control Center healthy
- All MCP servers healthy
- Database accessible
```

**Rationale:**  
Uptime directly impacts factory availability and developer productivity.

---

### 7. Mean Time to Recovery (MTTR)

**Category:** Reliability  
**Level:** Factory  
**Unit:** Seconds  
**Target:** < 600 seconds (10 minutes)

**Definition:**  
Average time to recover from an incident or service failure.

**Formula:**
```
MTTR = AVG(recovery_time - incident_start_time) for all incidents
```

**Calculation:**
```sql
SELECT AVG(
  EXTRACT(EPOCH FROM (recovered_at - started_at))
) as mttr_seconds
FROM incidents
WHERE recovered_at IS NOT NULL
  AND started_at >= NOW() - INTERVAL '30 days';
```

**Rationale:**  
MTTR measures operational resilience and recovery capability.

---

### 8. Execution Duration

**Category:** Performance  
**Level:** Run, Product  
**Unit:** Milliseconds  
**Target:** Varies by workflow type

**Definition:**  
Time from execution start to completion for successful runs.

**Formula:**
```
Execution Duration = completed_at - started_at
```

**Calculation:**
```sql
SELECT 
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration_ms,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY 
    EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
  ) as p50_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY 
    EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
  ) as p95_duration_ms
FROM workflow_executions
WHERE status = 'completed'
  AND started_at >= NOW() - INTERVAL '24 hours';
```

**Rationale:**  
Duration metrics help identify performance bottlenecks and optimize workflows.

---

## Product-Level KPIs

### 9. Product Success Rate

**Category:** Reliability  
**Level:** Product  
**Unit:** Percentage (0-100)

**Definition:**  
Success rate scoped to a specific product/repository.

**Formula:**
```
Product Success Rate = 
  (completed_runs_for_product / total_runs_for_product) × 100
```

**Calculation:**
```sql
SELECT 
  r.owner || '/' || r.name as product,
  ROUND(
    (COUNT(*) FILTER (WHERE we.status = 'completed')::DECIMAL / 
     COUNT(*)) * 100,
    2
  ) as product_success_rate
FROM workflow_executions we
JOIN repositories r ON we.repository_id = r.id
WHERE we.started_at >= NOW() - INTERVAL '24 hours'
GROUP BY r.owner, r.name;
```

---

### 10. Product Throughput

**Category:** Efficiency  
**Level:** Product  
**Unit:** Runs per hour

**Definition:**  
Number of workflow executions per time period for a product.

**Formula:**
```
Product Throughput = COUNT(executions) / time_period_hours
```

---

## Run-Level KPIs

### 11. Run Duration

**Category:** Performance  
**Level:** Run  
**Unit:** Milliseconds

**Definition:**  
Time to complete a single workflow run.

**Stored in:** `workflow_executions.completed_at - started_at`

---

### 12. Cost per Outcome

**Category:** Cost / Efficiency  
**Level:** Factory, Product  
**Unit:** USD  
**Target:** Minimize  
**EPIC:** 9 - Cost & Efficiency Engine  
**Issue:** 9.1 - Cost Attribution per Run

**Definition:**  
Average total cost (AWS infrastructure + LLM) per successful workflow outcome. Measures economic efficiency of the factory.

**Formula:**
```
Cost per Outcome = Total Costs / Successful Outcomes

Where:
- Total Costs = AWS Infrastructure Costs + LLM Costs
- AWS Infrastructure Costs = ECS + RDS + S3 + CloudWatch + Secrets Manager + Lambda
- LLM Costs = Sum of all token costs from agent runs
- Successful Outcomes = Workflow executions with status = 'completed'
```

**Calculation:**
```sql
-- Factory-level (from materialized view)
SELECT 
  SUM(ac.total_cost_usd) / NULLIF(COUNT(*) FILTER (WHERE we.status = 'completed'), 0) as cost_per_outcome_usd
FROM workflow_executions we
LEFT JOIN aws_cost_attribution ac ON we.id = ac.execution_id
WHERE we.started_at >= NOW() - INTERVAL '24 hours';

-- Product-level
SELECT 
  r.owner || '/' || r.name as product_name,
  SUM(ac.total_cost_usd) / NULLIF(COUNT(*) FILTER (WHERE we.status = 'completed'), 0) as cost_per_outcome_usd
FROM workflow_executions we
JOIN repositories r ON we.repository_id = r.id
LEFT JOIN aws_cost_attribution ac ON we.id = ac.execution_id
WHERE we.started_at >= NOW() - INTERVAL '7 days'
GROUP BY r.owner, r.name;
```

**Cost Breakdown:**
1. **ECS Fargate**: Per-minute cost based on vCPU/memory allocation
2. **RDS PostgreSQL**: Shared pool allocation across all runs
3. **S3**: Storage and operations per execution
4. **CloudWatch**: Logs ingestion and storage per execution
5. **Secrets Manager**: Shared pool allocation for secret access
6. **LLM**: Token-based costs aggregated from agent_runs table

**Data Sources:**
- `aws_cost_attribution` table: Per-run AWS cost breakdown
- `agent_runs.cost_usd`: LLM token costs
- `workflow_executions.status`: Success/failure status
- `cost_allocation_rules`: Configurable cost allocation strategies

**Interpretation:**
- **< $0.01 per outcome**: Excellent efficiency
- **$0.01 - $0.05 per outcome**: Good efficiency
- **$0.05 - $0.10 per outcome**: Acceptable efficiency
- **> $0.10 per outcome**: Review for optimization opportunities

**Rationale:**  
Cost per Outcome enables:
1. **Economic Steering**: Track factory cost efficiency over time
2. **Budget Planning**: Predict costs based on expected throughput
3. **Cost Optimization**: Identify expensive workflows and products
4. **Controlling**: Export data for financial reporting and analysis
5. **Transparency**: Verursachungsgerechte (fair/causal) cost attribution

**Cost Attribution Methods:**
- `estimated`: Calculated using cost_allocation_rules (default)
- `cost_explorer`: From AWS Cost Explorer API (planned)
- `manual`: Manually entered for correction/adjustment

**Export Capabilities:**
- JSON format: `/api/v1/costs/export?format=json`
- CSV format: `/api/v1/costs/export?format=csv`
- Date filtering: `?startDate=2025-12-01&endDate=2025-12-31`

**Optimization Strategies:**
1. Reduce execution duration (lower ECS costs)
2. Optimize LLM token usage (shorter prompts, better caching)
3. Batch operations to amortize fixed costs
4. Right-size ECS tasks based on actual resource usage
5. Implement result caching for repeated operations

**Related Metrics:**
- **Total Factory Costs**: Sum of all costs across time period
- **Cost Breakdown by Service**: Percentage allocation per AWS service
- **Cost Trend**: Change in cost per outcome over time
- **Product Cost Ranking**: Most expensive products/repositories

---

### 13. Token Usage

**Category:** Cost  
**Level:** Run  
**Unit:** Tokens

**Definition:**  
Total LLM tokens consumed during a run.

**Formula:**
```
Token Usage = prompt_tokens + completion_tokens
```

**Stored in:** `agent_runs.total_tokens`

---

### 14. Tool Call Success Rate

**Category:** Reliability  
**Level:** Run  
**Unit:** Percentage (0-100)

**Definition:**  
Percentage of MCP tool calls that succeed without errors.

**Formula:**
```
Tool Call Success Rate = (successful_calls / total_calls) × 100
```

**Calculation:**
```sql
SELECT 
  ROUND(
    (COUNT(*) FILTER (WHERE error IS NULL)::DECIMAL / COUNT(*)) * 100,
    2
  ) as tool_success_rate
FROM mcp_tool_calls
WHERE execution_id = $1;
```

---

### 10. Build Determinism

**Category:** Quality  
**Level:** Factory  
**Unit:** Percentage (0-100)  
**Target:** ≥ 95%

**EPIC:** 5 - Autonomous Build-Test-Deploy Loop  
**Issue:** 5.1 - Deterministic Build Graphs

**Definition:**  
Percentage of unique input combinations where all builds produced identical outputs, ensuring reproducibility and eliminating implicit state dependencies.

**Formula:**
```
Build Determinism = (deterministic_input_hashes / total_unique_input_hashes) × 100

Where:
- deterministic_input_hashes = Number of input hashes where all builds have identical outputs
- total_unique_input_hashes = Number of unique input hash combinations
```

**Calculation:**
```typescript
// For each unique input hash:
// 1. Get all builds with that input hash
// 2. Check if all builds produced identical output hashes
// 3. Count as deterministic if all outputs match

determinismScore = (deterministicInputHashes / totalInputHashes) * 100
```

**Data Sources:**
- Build manifests tracked by BuildDeterminismTracker
- Workflow execution records with input/output checksums
- Stored in `kpi_snapshots` table with `kpi_name = 'build_determinism'`

**Interpretation:**
- **100%**: Perfect determinism - all builds are reproducible
- **95-99%**: High determinism - production quality
- **80-94%**: Moderate determinism - needs investigation
- **<80%**: Low determinism - critical reproducibility issues

**Rationale:**  
Build Determinism is critical for:
1. **Reproducibility**: Same inputs must produce same outputs
2. **Caching**: Enable safe reuse of build artifacts
3. **Auditability**: Validate build consistency over time
4. **Efficiency**: Avoid redundant builds through intelligent caching

High build determinism enables the autonomous build-test-deploy loop to operate reliably and efficiently without implicit state dependencies.

**Related Metrics:**
- Cache Hit Rate: Percentage of builds that reused cached artifacts
- Total Builds: Number of builds tracked
- Unique Inputs: Number of distinct input combinations

---

### 11. Prompt Stability

**Category:** Quality / Governance  
**Level:** Factory, Prompt  
**Unit:** Multiple metrics (count, percentage, days)  
**Target:** 
- Version count < 5 per quarter
- Breaking changes < 1 per year per prompt
- Usage > 10 runs per active prompt

**EPIC:** 6 - Prompt & Action Canon  
**Issue:** 6.1 - Canonical Prompt Library

**Definition:**  
Measures the stability, consistency, and quality of prompts in the Canonical Prompt Library. Tracks prompt usage, version changes, and breaking change frequency to ensure Factory Intelligence reliability.

**Metrics Tracked:**

1. **Total Uses**: Number of times prompt has been used in agent runs
2. **Days Used**: Number of unique days with at least one use
3. **Executions Using Prompt**: Number of workflow executions using the prompt
4. **Version Count**: Total number of published versions
5. **Last Breaking Change**: Date of most recent MAJOR version
6. **Deprecation Status**: Whether prompt is marked deprecated

**Formula:**
```
Prompt Stability Score = weighted_average([
  version_stability_score,    // Weight: 40%
  usage_consistency_score,    // Weight: 30%
  breaking_change_score       // Weight: 30%
])

Where:
- version_stability_score = max(0, 100 - (version_count * 10))
- usage_consistency_score = min(100, days_used / days_in_period * 100)
- breaking_change_score = days_since_last_breaking / 365 * 100
```

**Calculation:**
```sql
-- Available via database view
SELECT 
  prompt_id,
  prompt_name,
  category,
  current_version,
  current_version_published_at,
  total_uses,
  days_used,
  executions_using_prompt,
  last_used_at,
  first_used_at,
  version_count,
  last_breaking_change_at,
  is_deprecated
FROM prompt_stability_metrics
ORDER BY total_uses DESC;
```

**Data Sources:**
- `prompts` table: Prompt definitions and metadata
- `prompt_versions` table: Version history with change types
- `agent_runs` table: Usage tracking via `prompt_version_id`
- `prompt_stability_metrics` view: Pre-aggregated metrics

**Interpretation:**

**Version Stability:**
- **1-3 versions**: Excellent - Stable prompt with minimal changes
- **4-6 versions**: Good - Normal evolution
- **7-10 versions**: Moderate - Frequent changes, review needed
- **>10 versions**: Poor - Unstable prompt, refactor recommended

**Usage Consistency:**
- **Used daily**: High confidence in prompt quality
- **Used weekly**: Moderate usage, track trends
- **Used rarely**: Consider deprecation or improvement
- **Not used**: Candidate for archival

**Breaking Changes:**
- **0 per year**: Excellent stability
- **1 per year**: Acceptable for evolving prompts
- **2-3 per year**: High churn, governance review needed
- **>3 per year**: Critical instability

**Rationale:**  
Prompt Stability is critical for:
1. **Predictability**: Stable prompts produce consistent results
2. **Reliability**: Fewer breaking changes reduce workflow failures
3. **Governance**: Track compliance with versioning rules
4. **Quality**: Identify problematic or unused prompts
5. **Traceability**: Complete audit trail of prompt usage

High prompt stability enables the Factory Intelligence system to operate reliably with predictable, versioned prompts that follow governance rules.

**Related Metrics:**
- **Action Usage Metrics**: Similar tracking for MCP tool actions
- **Prompt Version Adoption Rate**: Speed of migration to new versions
- **Deprecated Prompt Usage**: Usage of prompts past grace period

**Query Examples:**

```sql
-- Most stable prompts (low version count, high usage)
SELECT prompt_name, version_count, total_uses
FROM prompt_stability_metrics
WHERE total_uses > 10
ORDER BY version_count ASC, total_uses DESC
LIMIT 10;

-- Prompts needing attention (deprecated but still used)
SELECT p.name, p.deprecation_reason, COUNT(ar.id) as recent_uses
FROM prompts p
JOIN prompt_versions pv ON p.current_version_id = pv.id
JOIN agent_runs ar ON ar.prompt_version_id = pv.id
WHERE p.deprecated = true
  AND ar.started_at > NOW() - INTERVAL '7 days'
GROUP BY p.id, p.name, p.deprecation_reason;

-- Version adoption tracking
SELECT pv.version, COUNT(DISTINCT ar.execution_id) as execution_count
FROM prompt_versions pv
JOIN agent_runs ar ON ar.prompt_version_id = pv.id
WHERE pv.prompt_id = 'your-prompt-id'
GROUP BY pv.version
ORDER BY pv.created_at DESC;
```

**API Endpoint:**
```bash
GET /api/metrics?type=prompt-stability
GET /api/prompts/{id}/metrics
```

**Dashboard Visualization:**
- Time series chart: Prompt usage over time
- Bar chart: Version count by prompt
- Table: Top prompts by stability score
- Alert indicators: Deprecated prompts still in use

---

## KPI Aggregation Levels

### Level 1: Run (Individual Execution)
- Execution Duration
- Token Usage
- Tool Call Success Rate
- Error Count

### Level 2: Product (Repository/Service)
- Product Success Rate
- Product Throughput
- Average Run Duration
- Error Rate by Product

### Level 3: Factory (Global)
- MTTI
- Success Rate
- Steering Accuracy
- KPI Freshness
- Verdict Consistency
- Factory Uptime
- Build Determinism
- Prompt Stability

### Level 4: Prompt/Action (Governance)
- Prompt Stability (per prompt)
- Action Usage Metrics (per action)
- Version adoption rates
- Breaking change frequency
- MTTR
- Build Determinism

## KPI Versioning

KPI definitions follow semantic versioning:

**Version Format:** `MAJOR.MINOR.PATCH`

**Version Changes:**
- **MAJOR**: Breaking change to KPI formula or semantics
- **MINOR**: New KPI added or non-breaking enhancement
- **PATCH**: Documentation clarification, no formula change

**Current Version:** 1.2.0

**Change Process:**
1. Propose KPI change with rationale
2. Review impact on existing dashboards/alerts
3. Update this document with new version
4. Migrate historical data if needed
5. Update all consumers to use new version

**Version History:**
- `1.2.0` (2025-12-18): Added Cost per Outcome KPI (EPIC 9, Issue 9.1)
- `1.1.0` (2025-12-17): Added Build Determinism KPI (EPIC 5, Issue 5.1)
- `1.0.0` (2024-12-16): Initial canonical KPI definitions for EPIC 3

---

## Data Retention

**KPI Snapshots:**
- Real-time: 7 days (5-minute granularity)
- Historical: 90 days (1-hour granularity)
- Archives: 2 years (daily granularity)

**Raw Execution Data:**
- Active: 30 days (full detail)
- Historical: 1 year (aggregated)

---

## API Integration

All KPIs are accessible via:

**Factory Status API:**
```
GET /api/v1/factory/status?kpiPeriodHours=24
```

**KPI Snapshots API:**
```
GET /api/v1/kpi/snapshots?from=2025-12-01&to=2025-12-16
GET /api/v1/kpi/history/{kpi_name}?period=7d
```

---

## Dashboard Integration

**Primary Dashboard:** `/observability`
**KPI Dashboard:** `/kpi` (planned)

**Widget Requirements:**
- Real-time updates (< 60 second freshness)
- Historical trending (7d, 30d, 90d views)
- Target lines and thresholds
- Alert indicators

---

## Alert Thresholds

| KPI | Warning | Critical |
|-----|---------|----------|
| MTTI | > 300s | > 600s |
| Success Rate | < 90% | < 85% |
| Steering Accuracy | < 92% | < 90% |
| KPI Freshness | > 120s | > 300s |
| Verdict Consistency | < 97% | < 95% |
| Factory Uptime | < 99.7% | < 99.5% |
| MTTR | > 600s | > 1200s |

---

## Implementation References

- **Database Schema:** `database/migrations/006_kpi_aggregation.sql`
- **Service Layer:** `control-center/src/lib/kpi-service.ts`
- **API Route:** `control-center/app/api/v1/kpi/*`
- **Types:** `control-center/src/lib/types/kpi.ts`

---

## Related Documentation

- [Factory Status API](./FACTORY_STATUS_API.md)
- [Observability Guide](./OBSERVABILITY.md)
- [Confidence Score Schema](./CONFIDENCE_SCORE_SCHEMA.md)
- [AFU-9 Roadmap v0.3](./roadmaps/afu9_roadmap_v0_3_issues.md)

---

## Governance & Compliance

### Canonical Status

This document holds **canonical status** for AFU-9 Factory KPIs:
- All KPI implementations MUST reference this document
- No "shadow" KPI definitions are permitted in code or dashboards
- All formula changes require updating this document first
- Version mismatches trigger validation warnings

### Change Process

**All KPI changes must follow the governance framework:**

1. **Propose** - Create RFC using template in [KPI Governance](./KPI_GOVERNANCE.md)
2. **Review** - Platform team + stakeholders review for impact
3. **Approve** - Platform team (minor/patch) or EPIC owner (major)
4. **Document** - Update this document + [KPI Changelog](./KPI_CHANGELOG.md)
5. **Implement** - Update code, tests, and infrastructure
6. **Validate** - Run KPI version validator and calculation tests
7. **Deploy** - Roll out with monitoring and rollback plan
8. **Communicate** - Notify all stakeholders

**Version Increment Rules:**
- `MAJOR.x.x` - Breaking formula change (e.g., 1.0.0 → 2.0.0)
- `x.MINOR.x` - New KPI or enhancement (e.g., 1.0.0 → 1.1.0)
- `x.x.PATCH` - Documentation only (e.g., 1.0.0 → 1.0.1)

### Validation & Enforcement

**Automated Validation:**
```typescript
// All KPI calculations must use version validator
import { validateKpiVersion } from '@/lib/kpi-version-validator';

const validation = validateKpiVersion('mtti', '1.0.0');
if (!validation.isCompatible) {
  throw new Error(validation.message);
}
```

**CI/CD Checks:**
- KPI type definitions match canonical document
- All KPI versions are compatible
- Calculation tests pass for all KPIs

**Runtime Monitoring:**
- Alert on KPI version mismatches
- Track KPI freshness violations
- Monitor calculation errors

### Audit Trail

All KPI changes are tracked in:
- **[KPI Changelog](./KPI_CHANGELOG.md)** - Complete change history
- **Git History** - All document commits
- **Database** - `kpi_snapshots.kpi_version` for every calculation

### Ownership & Responsibilities

**Owner:** Factory Platform Team  
**Approval Authority:**
- Platform Team: MINOR and PATCH changes
- EPIC Owner: MAJOR changes (breaking)

**Review Cycle:** Quarterly or per-change  
**Next Review:** 2025-03-16

**Escalation:**
- Questions: GitHub issue with label `kpi`
- Urgent: Slack `#factory-platform-alerts`
- Critical: Page on-call engineer

---

## References

### Documentation
- [KPI Governance](./KPI_GOVERNANCE.md) - Change management framework
- [KPI Changelog](./KPI_CHANGELOG.md) - Version history
- [KPI API](./KPI_API.md) - REST API documentation
- [Observability Guide](./OBSERVABILITY.md) - Monitoring and alerting
- [Factory Status API](./FACTORY_STATUS_API.md) - Status aggregation

### Implementation
- Type Definitions: `control-center/src/lib/types/kpi.ts`
- Service Layer: `control-center/src/lib/kpi-service.ts`
- Version Validator: `control-center/src/lib/kpi-version-validator.ts`
- Database Schema: `database/migrations/006_kpi_aggregation.sql`
- Tests: `control-center/__tests__/lib/kpi-service.test.ts`

---

**Document Status:** Canonical ✅  
**Current Version:** 1.0.0  
**Maintained By:** Factory Platform Team  
**Compliance:** All implementations must reference this document

---

_End of Canonical KPI Definitions v1.0.0_
