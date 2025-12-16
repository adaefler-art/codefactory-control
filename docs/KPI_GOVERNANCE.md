# KPI Governance & Change Management

**Version:** 1.0.0  
**Status:** Active  
**Owner:** Factory Platform Team  
**Last Updated:** 2024-12-16

---

## Purpose

This document establishes the governance framework for managing AFU-9 Factory KPIs, ensuring they remain:
- **Canonical** - Single source of truth for all metrics
- **Consistent** - Uniformly applied across all factory components
- **Auditable** - All changes tracked and versioned
- **Reliable** - Reproducible calculations with documented formulas

---

## Governance Principles

### 1. Single Source of Truth

The **canonical KPI definitions** are maintained in:
```
docs/KPI_DEFINITIONS.md
```

All other KPI-related artifacts (types, code, dashboards) must derive from this document.

**Forbidden:**
- ❌ Defining KPI formulas directly in code
- ❌ Creating "shadow" KPI definitions in dashboards
- ❌ Using undocumented KPI variations

**Required:**
- ✅ All KPIs reference the canonical definition
- ✅ All formula changes update the canonical document first
- ✅ All implementations cite the KPI version they implement

### 2. Versioning Discipline

All KPI definition changes follow **Semantic Versioning** and are tracked in:
```
docs/KPI_CHANGELOG.md
```

**Version Increment Rules:**
- `MAJOR.x.x` - Breaking formula change requiring data migration
- `x.MINOR.x` - New KPI added or non-breaking enhancement
- `x.x.PATCH` - Documentation clarification, no calculation change

**Enforcement:**
- KPI definitions include explicit version field (`kpi_version`)
- Database stores version with each snapshot (`kpi_snapshots.kpi_version`)
- API responses include KPI version for transparency
- Version mismatches trigger warnings in aggregation pipeline

### 3. Change Traceability

Every KPI change must be:
1. **Documented** - Full entry in `KPI_CHANGELOG.md`
2. **Reviewed** - Platform team approval
3. **Tested** - Validation of calculations
4. **Migrated** - Historical data updated if needed
5. **Communicated** - Stakeholders notified

---

## KPI Definition Requirements

### Mandatory Fields

Every canonical KPI must include:

```typescript
{
  name: string;              // Human-readable name
  version: string;           // Semantic version (e.g., "1.0.0")
  category: Category;        // efficiency | reliability | quality | observability | availability | performance | cost
  level: Level[];            // factory | product | run
  unit: string;              // milliseconds | percentage | seconds | count
  target?: number;           // Performance target (optional)
  formula: string;           // Mathematical formula
  description: string;       // What this KPI measures
  rationale: string;         // Why this KPI matters
  implementedIn?: string;    // Reference to implementation issue/PR
}
```

### Documentation Standards

Each KPI in `KPI_DEFINITIONS.md` must include:

1. **Header Section**
   - Category
   - Level(s)
   - Unit
   - Target (if applicable)

2. **Definition Section**
   - Clear, concise definition (1-2 sentences)
   - Formula in mathematical notation
   - Formula components explained

3. **Calculation Section**
   - SQL query example
   - Data source tables
   - Time period considerations

4. **Rationale Section**
   - Business justification
   - How it drives decisions
   - Link to factory objectives

5. **Implementation Notes** (if applicable)
   - Special considerations
   - Dependencies on other systems
   - Known limitations

---

## Change Management Process

### Step 1: Proposal

**Who:** Any team member can propose KPI changes  
**How:** Create RFC document or GitHub issue

**RFC Template:**
```markdown
# KPI Change Request

## Type
[ ] New KPI
[ ] Modify existing KPI (breaking)
[ ] Modify existing KPI (non-breaking)
[ ] Deprecate KPI
[ ] Documentation only

## Proposed Change
### Current State
[Current formula, calculation, or absence]

### Proposed State
[New formula, calculation, or addition]

## Rationale
[Why this change is needed]

## Impact Assessment
### Affected Systems
- [ ] KPI_DEFINITIONS.md
- [ ] KPI service layer
- [ ] Database schema
- [ ] API endpoints
- [ ] Dashboards
- [ ] Alerts
- [ ] Reports

### Breaking Changes
[List any breaking changes]

### Migration Required
[ ] Yes - Historical data needs recalculation
[ ] No - Backward compatible

### Effort Estimate
[Development time estimate]

## Version Increment
[ ] MAJOR (x.0.0)
[ ] MINOR (x.x.0)
[ ] PATCH (x.x.x)

## Testing Plan
[How to validate the change]
```

### Step 2: Review

**Reviewers:**
- **Platform Team** (mandatory) - Technical feasibility
- **SRE Team** (for availability/performance KPIs) - Operational impact
- **Product Team** (for new KPIs) - Business alignment
- **EPIC Owner** (for breaking changes) - Strategic approval

**Review Criteria:**
1. ✅ Clear business value
2. ✅ Technically feasible
3. ✅ Reproducible calculation
4. ✅ Reasonable target/threshold
5. ✅ Aligned with factory goals
6. ✅ Migration plan (if breaking)

**Review Outcome:**
- **Approved** - Proceed to implementation
- **Approved with Changes** - Modify proposal and re-review
- **Rejected** - Document rationale

### Step 3: Implementation

**Implementation Order:**
1. Update `KPI_DEFINITIONS.md` with new version
2. Update `KPI_CHANGELOG.md` with detailed change entry
3. Update type definitions (`kpi.ts`)
4. Update service layer (`kpi-service.ts`)
5. Update database schema (if needed)
6. Update API endpoints (if needed)
7. Update tests
8. Update documentation

**Pull Request Requirements:**
- Title: `[KPI v{version}] {Change description}`
- Description: Link to RFC/issue
- Labels: `kpi`, `governance`
- Reviewers: Platform team + 1 domain expert

### Step 4: Validation

**Pre-Deployment:**
1. Run unit tests for KPI calculations
2. Compare new vs. old calculations (for changes)
3. Validate against test dataset
4. Review with stakeholders

**Post-Deployment:**
1. Monitor KPI freshness
2. Verify dashboard updates
3. Confirm alert thresholds
4. Check historical data migration (if applicable)

**Rollback Plan:**
- For breaking changes: Keep old version for 30 days
- For critical issues: Emergency revert process
- Document rollback in changelog

### Step 5: Communication

**Notification Channels:**
- Slack: `#factory-platform` (all changes)
- Email: Platform team mailing list
- Documentation: Update relevant guides

**Communication Template:**
```
📊 KPI Update: {KPI Name} v{version}

**What Changed:**
{Brief description}

**Impact:**
{Who/what is affected}

**Action Required:**
{What users need to do, if anything}

**Documentation:**
- Definitions: docs/KPI_DEFINITIONS.md
- Changelog: docs/KPI_CHANGELOG.md
- API: docs/KPI_API.md
```

---

## KPI Lifecycle

### New KPI Introduction

1. **Proposal Phase** (1-2 weeks)
   - RFC created and reviewed
   - Prototype calculation
   - Gather feedback

2. **Alpha Phase** (2-4 weeks)
   - Implementation in dev environment
   - Initial data collection
   - Validation with small dataset

3. **Beta Phase** (4-8 weeks)
   - Production deployment
   - Limited visibility (internal only)
   - Tune targets and thresholds

4. **GA (General Availability)**
   - Public in dashboards
   - Alerts configured
   - Documentation complete

### KPI Modification

**Non-Breaking Changes:**
- Can be deployed immediately after review
- No migration required
- PATCH or MINOR version bump

**Breaking Changes:**
- Require migration plan
- 30-day notice to stakeholders
- MAJOR version bump
- Dual calculation period (old + new in parallel)

### KPI Deprecation

1. **Deprecation Notice** (Minimum 3 months)
   - Mark as deprecated in `KPI_DEFINITIONS.md`
   - Add deprecation warning to API responses
   - Notify all consumers

2. **Removal Timeline**
   - Active deprecation: 6 months
   - Historical data retained: 2 years
   - Archive: Permanent (read-only)

---

## Quality Standards

### Calculation Quality

1. **Deterministic**
   - Same inputs always produce same output
   - No randomness or sampling
   - Explicit time ranges

2. **Reproducible**
   - Formula documented completely
   - Data sources identified
   - Edge cases handled

3. **Auditable**
   - Calculation logged
   - Version tracked
   - Historical snapshots retained

### Performance Standards

1. **Calculation Time**
   - Factory-level KPIs: < 5 seconds
   - Product-level KPIs: < 2 seconds
   - Run-level KPIs: < 100ms

2. **Freshness**
   - Dashboard display: < 60 seconds
   - Historical analysis: < 300 seconds
   - Reporting: < 3600 seconds

3. **Availability**
   - KPI API uptime: > 99.9%
   - Aggregation pipeline: > 99.5%

---

## Roles & Responsibilities

### Platform Team
- **Owner** of canonical KPI definitions
- **Reviewer** for all KPI changes
- **Maintainer** of KPI infrastructure
- **Escalation point** for KPI issues

### SRE Team
- **Monitor** KPI pipeline health
- **Respond** to KPI freshness alerts
- **Optimize** calculation performance

### Product Team
- **Propose** new business KPIs
- **Define** targets and thresholds
- **Consume** KPI data for decisions

### Engineering Teams
- **Implement** KPI calculations correctly
- **Reference** canonical definitions
- **Report** KPI anomalies

---

## Audit & Compliance

### Quarterly Review

**Agenda:**
1. Review all KPIs for continued relevance
2. Assess target achievement
3. Identify missing metrics
4. Propose deprecations
5. Update documentation

### Annual Audit

**Scope:**
1. Validate all KPI calculations match definitions
2. Check version consistency across systems
3. Verify historical data integrity
4. Assess governance compliance
5. Update targets based on performance trends

---

## Escalation Process

### Issue Severity Levels

**P0 - Critical**
- KPI pipeline failure (no new snapshots)
- Incorrect calculations affecting decisions
- Security vulnerability in KPI system

**P1 - High**
- KPI freshness > 5 minutes
- Dashboard display errors
- API performance degradation

**P2 - Medium**
- Documentation inconsistencies
- Non-critical calculation issues
- Feature requests

**P3 - Low**
- Cosmetic issues
- Enhancement ideas

### Escalation Path

1. **P3-P2:** Create GitHub issue, platform team triages
2. **P1:** Slack `#factory-platform-alerts`, platform team responds
3. **P0:** Page on-call engineer, immediate response

---

## Enforcement

### Automated Checks

1. **CI/CD Pipeline**
   - Validate KPI type definitions match canonical document
   - Check version consistency
   - Run calculation tests

2. **Runtime Monitoring**
   - Alert on version mismatches
   - Track KPI freshness
   - Monitor calculation errors

3. **Code Review**
   - Require platform team approval for KPI changes
   - Verify changelog updates
   - Check test coverage

### Manual Reviews

- **Weekly:** Review KPI calculation logs for anomalies
- **Monthly:** Check dashboard consistency
- **Quarterly:** Full governance compliance audit

---

## Tools & Resources

### Documentation
- [KPI Definitions (Canonical)](./KPI_DEFINITIONS.md)
- [KPI Changelog](./KPI_CHANGELOG.md)
- [KPI API Documentation](./KPI_API.md)

### Code
- Type Definitions: `control-center/src/lib/types/kpi.ts`
- Service Layer: `control-center/src/lib/kpi-service.ts`
- Database Schema: `database/migrations/006_kpi_aggregation.sql`

### Monitoring
- KPI Dashboard: `/observability` (Control Center)
- CloudWatch Metrics: `AFU9/KPI/*`
- Logs: CloudWatch Log Group `/afu9/kpi-aggregation`

---

## Contact

**Questions or Proposals:**
- GitHub: Open issue with label `kpi`
- Slack: `#factory-platform`
- Email: factory-platform-team@example.com

**Emergency Contact:**
- On-call: PagerDuty rotation
- Escalation: Platform team lead

---

**Governance Owner:** Factory Platform Team  
**Approval Authority:** EPIC Owner (for breaking changes)  
**Review Cycle:** Quarterly  
**Next Review:** 2025-03-16

---

_This document is authoritative for all KPI governance decisions._
