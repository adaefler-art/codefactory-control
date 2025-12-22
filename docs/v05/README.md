# AFU-9 v0.5 Documentation Hub

**Version:** 0.5  
**Status:** 🔄 In Planning  
**Basis:** v0.4 Release ([docs/v04/](../v04/))

---

## Overview

This directory contains all documentation related to AFU-9 v0.5 planning, implementation, and release.

### Quick Links

- **[v0.5 Go/No-Go Decision](V05_GO_NOGO_DECISION.md)** - **PRIMARY REFERENCE** for v0.5 readiness evaluation
- [v0.4 Release Review](../v04/V04_RELEASE_REVIEW.md) - Foundation for v0.5 planning

---

## v0.5 Planning Documents

### Decision Documents

| Document | Status | Description |
|----------|--------|-------------|
| [V05_GO_NOGO_DECISION.md](V05_GO_NOGO_DECISION.md) | ✅ Complete | Go/No-Go criteria for v0.5 start |

### Implementation Documents

*To be added as v0.5 features are implemented*

---

## v0.5 Scope

### Confirmed Features (from v0.4 Foundation)

Based on the [v0.5 Go/No-Go Decision](V05_GO_NOGO_DECISION.md), the following features are candidates for v0.5:

#### P1 Features (Recommended for v0.5)

1. **Advanced Workflow Engine**
   - Workflow versioning
   - Enhanced error compensation
   - Improved retry logic
   - **Status:** Planned

2. **Enhanced UI/UX**
   - Polished design system
   - Improved workflow visualization
   - Better filtering/search
   - **Status:** Planned

3. **Enhanced LLM Integration**
   - Additional LLM providers
   - Improved prompt engineering
   - Better token usage tracking
   - **Status:** Planned

4. **Webhook Robustness**
   - Event replay mechanism
   - Dead letter queue
   - Enhanced error handling
   - **Status:** Planned

5. **Workflow Versioning**
   - Version tracking
   - Migration support
   - Rollback capability
   - **Status:** Planned

#### P2 Features (Optional for v0.5)

1. **Multi-Region Architecture**
   - Active-passive setup
   - Cross-region replication
   - **Status:** Under evaluation

2. **Real-time WebSocket Updates**
   - Live dashboard updates
   - Real-time notifications
   - **Status:** Under evaluation

3. **Visual Workflow Builder**
   - Drag-and-drop interface
   - Visual workflow design
   - **Status:** Under evaluation

---

## v0.5 Backlog

### Self-Propelling

**Status:** Planned (explicitly deferred from v0.4; non-blocking for v0.4)

Background evidence (current implementation style):
- API route loads a workflow definition via filesystem path: [control-center/app/api/issues/[issueNumber]/self-propel/route.ts](../../control-center/app/api/issues/%5BissueNumber%5D/self-propel/route.ts)

Concrete tasks:
1. **Make runtime artifact access explicit**
   - Remove hidden filesystem dependency OR ensure the workflow definition is packaged and accessible in the runtime image.
2. **Add preflight runtime check + clear error**
   - Validate required artifacts/config at startup or at endpoint entry.
   - Return a clear, actionable error if missing (do not fail silently).
3. **Wire feature behind a flag and document activation**
   - Add a feature flag (env/context) to enable self-propelling explicitly.
   - Document the activation path and default (disabled by default until v0.5 completion).

### DNS/HTTPS Status

**Infrastructure:** ✅ Ready (fully implemented in v0.4)  
**Deployment:** 🟡 Optional (requires domain name decision)

See [DNS/HTTPS Status](V05_GO_NOGO_DECISION.md#dnshttps-status) section for details.

---

## v0.5 Timeline

**Target Start Date:** TBD (pending Go/No-Go decision)  
**Target Release Date:** TBD

### Milestones

1. ☐ **M1: Go/No-Go Decision** - Finalize v0.5 scope and DNS/HTTPS decision
2. ☐ **M2: Feature Development** - Implement P1 features
3. ☐ **M3: Testing & Validation** - Integration and security testing
4. ☐ **M4: Documentation** - Complete feature documentation and runbooks
5. ☐ **M5: Release** - Deploy to production and publish release review

---

## Key Decision Points

### DNS/HTTPS

**Decision Required:** Enable DNS/HTTPS for v0.5 or continue with ALB DNS?

**Options:**
- **Option A:** Enable DNS/HTTPS (requires domain name)
- **Option B:** Continue with ALB DNS (like v0.4 staging)

**Impact:** Low (infrastructure is ready, deployment process documented)

See [DNS/HTTPS Status](V05_GO_NOGO_DECISION.md#dnshttps-status) for full analysis.

### Feature Scope

**Decision Required:** Which P1/P2 features to include in v0.5?

**Recommendation:** Focus on P1 features, defer P2 features to v0.6

See [Feature Bereitschaft](V05_GO_NOGO_DECISION.md#feature-bereitschaft) for full analysis.

---

## Stability Assessment

**Status:** ✅ No critical blockers

### v0.4 Stable Components
- Core Infrastructure (ECS, RDS, ALB, VPC)
- MCP Pattern Implementation
- Deployment Workflows
- Security & Governance
- Build Determinism
- Documentation

### Experimental Components (Known Limitations)
- Workflow Engine (functional, needs refinement)
- Control Center UI (MVP, needs polish)
- LLM Integration (basic, needs enhancement)
- Webhook Processing (basic, needs robustness)

See [Stabilitätsbewertung](V05_GO_NOGO_DECISION.md#stabilitätsbewertung) for full analysis.

---

## Risk Management

### Top Risks for v0.5

1. **Scope Creep** - Mitigation: Clear P1/P2 prioritization
2. **Team Capacity** - Mitigation: 150+ runbooks, automated deployments
3. **Workflow Engine Instability** - Mitigation: Experimental status documented

See [Risikoanalyse](V05_GO_NOGO_DECISION.md#risikoanalyse) for full analysis.

---

## Reference Documents

### v0.4 Foundation

- [v0.4 Release Review](../v04/V04_RELEASE_REVIEW.md) - Complete v0.4 reference state
- [HTTPS/DNS Setup Guide](../v04/HTTPS-DNS-SETUP.md) - DNS/HTTPS configuration
- [ECS+ALB Status Signals](../v04/ECS_ALB_STATUS_SIGNALS.md) - Deployment Go/No-Go criteria
- [Security Validation Guide](../v04/SECURITY_VALIDATION_GUIDE.md) - Security checks
- [Deployment Guide](../v04/DEPLOYMENT_CONSOLIDATED.md) - Deployment procedures

### Architecture & Design

- [Architecture Overview](../architecture/README.md) - System architecture
- [v0.2 Summary](../v04/v0.2-SUMMARY.md) - v0.2 implementation overview
- [Database Schema](../architecture/database-schema.md) - Database design
- [Workflow Schema](../v04/WORKFLOW-SCHEMA.md) - Workflow model

### Operational

- [KPI Definitions](../v04/KPI_DEFINITIONS.md) - Factory KPIs
- [Observability Guide](../v04/OBSERVABILITY.md) - Monitoring and logging
- [Runbooks](../runbooks/) - Operational runbooks

---

## Next Steps

1. ☐ Review [V05_GO_NOGO_DECISION.md](V05_GO_NOGO_DECISION.md) with team
2. ☐ Make DNS/HTTPS decision
3. ☐ Finalize v0.5 feature scope
4. ☐ Define timeline and resource allocation
5. ☐ Begin v0.5 feature development
6. ☐ Create feature-specific implementation documents
7. ☐ Update this README as v0.5 progresses

---

## Contact

For questions about v0.5 planning:
- Technical Lead: [TBD]
- Product Owner: [TBD]
- DevOps Lead: [TBD]

---

**Last Updated:** 2024-12-20  
**Status:** Initial planning phase
