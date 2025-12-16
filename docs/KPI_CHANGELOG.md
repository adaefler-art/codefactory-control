# KPI Definitions Changelog

**Document Purpose:** This changelog tracks all changes to the canonical KPI definitions in `KPI_DEFINITIONS.md`.  
**Governance:** All KPI definition changes must be documented here with version, date, rationale, and impact assessment.

## Version Format

KPI definitions follow **Semantic Versioning**: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking change to KPI formula, calculation method, or semantics (requires data migration)
- **MINOR**: New KPI added, non-breaking enhancement, or clarification
- **PATCH**: Documentation-only changes, typo fixes, no formula/calculation changes

---

## [1.0.0] - 2024-12-16

**Status:** Initial Release  
**Epic:** EPIC 3 - KPI System & Telemetry  
**Issues:** #3.1 (Canonical KPI Definition), #3.2 (KPI Aggregation Pipeline)

### Added

#### Factory-Level KPIs (7)

1. **Mean Time to Insight (MTTI)**
   - **Category:** Efficiency
   - **Formula:** `AVG(completion_time - start_time)`
   - **Target:** < 300 seconds
   - **Rationale:** Measures factory response time and developer experience

2. **Success Rate**
   - **Category:** Reliability
   - **Formula:** `(completed_executions / (completed + failed)) × 100`
   - **Target:** > 85%
   - **Rationale:** Indicates overall factory reliability and stability

3. **Steering Accuracy** ⭐ Key KPI for Issue 3.1
   - **Category:** Quality
   - **Formula:** `(accepted_decisions / total_decisions) × 100`
   - **Target:** > 90%
   - **Rationale:** Validates autonomous decision-making quality
   - **Implementation:** Tracks verdict outcomes (accepted/overridden/escalated)

4. **KPI Freshness** ⭐ Key KPI for Issue 3.2
   - **Category:** Observability
   - **Formula:** `NOW() - last_kpi_calculation_timestamp`
   - **Target:** < 60 seconds
   - **Rationale:** Ensures KPI data currency for timely decisions

5. **Verdict Consistency**
   - **Category:** Quality
   - **Formula:** `(consistent_fingerprint_groups / total_fingerprint_groups) × 100`
   - **Target:** > 95%
   - **Rationale:** Ensures deterministic verdict generation

6. **Factory Uptime**
   - **Category:** Availability
   - **Formula:** `(healthy_intervals / total_intervals) × 100`
   - **Target:** > 99.5%
   - **Rationale:** Measures factory availability

7. **Mean Time to Recovery (MTTR)**
   - **Category:** Reliability
   - **Formula:** `AVG(recovery_time - incident_start_time)`
   - **Target:** < 600 seconds
   - **Rationale:** Measures operational resilience

#### Product-Level KPIs (2)

8. **Product Success Rate**
   - **Category:** Reliability
   - **Scope:** Per repository
   - **Formula:** Same as Success Rate, scoped to product
   - **Rationale:** Enables per-repository quality tracking

9. **Product Throughput**
   - **Category:** Efficiency
   - **Unit:** Runs per day
   - **Formula:** `COUNT(executions) / period_days`
   - **Rationale:** Measures repository activity and utilization

#### Run-Level KPIs (4)

10. **Run Duration**
    - **Category:** Performance
    - **Unit:** Milliseconds
    - **Formula:** `completed_at - started_at`
    - **Rationale:** Individual run performance metric

11. **Token Usage**
    - **Category:** Cost
    - **Unit:** Token count
    - **Formula:** `SUM(token_usage) per execution`
    - **Rationale:** Cost tracking for LLM operations

12. **Tool Call Success Rate**
    - **Category:** Reliability
    - **Formula:** `(successful_tool_calls / total_tool_calls) × 100`
    - **Rationale:** Measures tool integration reliability

13. **Execution Duration**
    - **Category:** Performance
    - **Unit:** Milliseconds
    - **Formula:** `execution_completed_at - execution_started_at`
    - **Rationale:** Fine-grained execution performance

### Database Schema

- Created `kpi_snapshots` table for time-series historization
- Created `verdict_outcomes` table for steering accuracy tracking
- Created `kpi_aggregation_jobs` table for pipeline orchestration
- Materialized views: `mv_factory_kpis_24h`, `mv_product_kpis_7d`
- Functions: `calculate_steering_accuracy()`, `get_kpi_freshness()`

### Implementation Files

- `docs/KPI_DEFINITIONS.md` (537 lines) - Canonical definitions
- `docs/KPI_API.md` (480 lines) - API documentation
- `control-center/src/lib/kpi-service.ts` (481 lines) - Service layer
- `control-center/src/lib/types/kpi.ts` (347 lines) - Type system
- `database/migrations/006_kpi_aggregation.sql` (351 lines) - Schema
- `scripts/kpi-aggregation-scheduler.js` (169 lines) - Periodic aggregation
- API Routes: `/api/v1/kpi/*` (factory, products, history, freshness)

### Versioning Strategy

- KPI version stored in `kpi_snapshots.kpi_version` column
- Historical data preserved across version changes
- Migration path defined for breaking changes
- All KPI calculations reference version 1.0.0

### Data Retention Policy

- **Real-time:** 7 days at 5-minute granularity
- **Historical:** 90 days at 1-hour granularity  
- **Archives:** 2 years at daily granularity

---

## Change Management Process

### Proposing KPI Changes

1. **Create RFC Document**
   - Proposed change description
   - Rationale and business impact
   - Formula modification (before/after)
   - Affected systems and dashboards
   - Migration strategy for historical data

2. **Impact Assessment**
   - Identify all consumers (dashboards, alerts, reports)
   - Estimate migration effort
   - Breaking vs. non-breaking classification
   - Performance implications

3. **Review & Approval**
   - Platform team review
   - Stakeholder approval (for breaking changes)
   - EPIC-level approval (for major versions)

4. **Implementation**
   - Update `KPI_DEFINITIONS.md` with new version
   - Update this changelog with detailed change log
   - Update type definitions in `kpi.ts`
   - Migrate database schema if needed
   - Update all API consumers
   - Add version migration tests

5. **Validation**
   - Run KPI calculation comparison (old vs. new)
   - Validate historical data migration
   - Test all API endpoints
   - Update documentation

### Breaking Change Example

```
## [2.0.0] - YYYY-MM-DD

### Changed (Breaking)

- **MTTI Calculation Modified**
  - **Old Formula:** `AVG(completion_time - start_time)` (includes queued time)
  - **New Formula:** `AVG(execution_end - execution_start)` (only active execution)
  - **Rationale:** Better reflects actual processing time
  - **Migration:** Recalculate all historical MTTI values
  - **Breaking:** Dashboards must update to use new formula
```

### Non-Breaking Change Example

```
## [1.1.0] - YYYY-MM-DD

### Added

- **Code Coverage KPI**
  - **Category:** Quality
  - **Formula:** `(covered_lines / total_lines) × 100`
  - **Target:** > 80%
  - **Level:** Product, Run
  - **Rationale:** Track code quality improvements
```

### Documentation-Only Change Example

```
## [1.0.1] - YYYY-MM-DD

### Fixed

- Clarified MTTR calculation includes only production incidents
- Fixed typo in Verdict Consistency description
- Added SQL query example for Product Throughput
```

---

## Version Compatibility

| KPI Version | Database Schema | API Version | Compatible With |
|-------------|-----------------|-------------|-----------------|
| 1.0.0       | 006_kpi_aggregation.sql | v1 | Control Center v0.2+ |

---

## Deprecation Policy

- **Minor version deprecation:** 6 months notice
- **Major version support:** Minimum 12 months after successor release
- **Critical security fixes:** Backported to all supported versions

---

## Related Documentation

- [KPI Definitions (Canonical)](./KPI_DEFINITIONS.md) - Single source of truth
- [KPI API Documentation](./KPI_API.md) - REST API reference
- [Observability Guide](./OBSERVABILITY.md) - Monitoring and alerting
- [Factory Status API](./FACTORY_STATUS_API.md) - Status aggregation

---

**Maintenance:** This changelog is the authoritative record of all KPI definition changes.  
**Owner:** Factory Platform Team  
**Review:** Quarterly or per-change, whichever is more frequent

---

_Last Updated: 2024-12-16_
