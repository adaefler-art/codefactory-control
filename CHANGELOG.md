# Changelog

Alle wesentlichen Änderungen an diesem Projekt werden hier dokumentiert.

## 2024-12-20 - v0.5 Go/No-Go Decision Template (Issue I-06-02)

### Added - v0.5 Planning Documentation

**Issue #I-06-02-V05-GO: Entscheidungsvorlage für v0.5**

Comprehensive decision template for evaluating v0.5 release readiness with clear Go/No-Go criteria.

#### v0.5 Decision Document
- **docs/v05/V05_GO_NOGO_DECISION.md**: Complete v0.5 Go/No-Go decision template
  - Executive summary with quick assessment (DNS/HTTPS, Features, Stability)
  - Detailed Go/No-Go criteria (MUSS vs. SOLL criteria)
  - DNS/HTTPS status and deployment scenarios
  - Feature readiness assessment (v0.4 stable foundation + v0.5 candidates)
  - Stability evaluation (no critical blockers identified)
  - Risk analysis with mitigation strategies
  - Recommended actions (pre-v0.5, during development, pre-release)
  - Decision matrix with weighted scoring
  - Deployment commands and validation checklists

#### v0.5 Documentation Hub
- **docs/v05/README.md**: Central hub for v0.5 documentation
  - Quick links to decision documents
  - v0.5 scope overview (P1/P2 features)
  - Timeline and milestones
  - Key decision points
  - Stability assessment
  - Risk management summary

#### Key Findings

**DNS/HTTPS Status:**
- ✅ Infrastructure fully implemented and tested
- ✅ CDK stacks (Afu9DnsStack, Afu9NetworkStack) production-ready
- ✅ Complete documentation available (HTTPS-DNS-SETUP.md)
- 🟡 Optional for v0.5 (requires domain name decision)

**Feature Work Readiness:**
- ✅ Solid v0.4 foundation (7 production-ready components)
- ✅ Experimental features documented with clear limitations
- ✅ v0.5 candidate features identified and prioritized (5 P1 features)
- 🟡 Scope decision required (P1 focus recommended)

**Stability Assessment:**
- ✅ No critical stability blockers
- ✅ All MUSS-criteria fulfilled
- ✅ Known limitations documented and acceptable
- ✅ Automated safety gates operational

**Overall Recommendation:** ✅ **GO for v0.5** (Score: 4.65/5.0)

**Conditions:**
1. DNS/HTTPS decision within 2 weeks
2. Focus on P1 features
3. Ensure team capacity
4. Maintain continuous validation

**Status**: ✅ Complete - v0.5 Decision Template Ready

---

## 2024-12-20 - v0.4 Release Review (Issue I-06-01)

### Added - Release Documentation

**Issue #I-06-01-RELEASE-REVIEW: v0.4 Abschluss-Review & Referenzstand**

Comprehensive v0.4 release review documentation establishing clear scope and reference state.

#### Release Review Document
- **docs/v04/V04_RELEASE_REVIEW.md**: Complete v0.4 release review and reference documentation
  - Executive summary of v0.4 achievements
  - Clear delineation: What is stable & production-ready vs. experimental/unstable
  - Architecture overview with diagrams
  - Complete deployment guides and runbooks reference
  - Security & governance documentation
  - KPI system and observability details
  - Known limitations and constraints
  - Foundation for v0.5 planning with candidate features
  - Quick reference links to all canonical documentation

#### What is Stable & Production-Ready
- ✅ Core Infrastructure (v0.2 ECS Architecture)
- ✅ MCP Pattern Implementation (GitHub, Deploy, Observability servers)
- ✅ Deployment Workflows (GitHub Actions with safety gates)
- ✅ Database & Persistence (PostgreSQL with migrations)
- ✅ Security Implementation (EPIC 07 - Least privilege IAM)
- ✅ Build Determinism (EPIC 05 - ≥95% reproducibility)
- ✅ Health & Monitoring System (Red/Yellow/Green indicators)
- ✅ Comprehensive Documentation (150+ production-ready docs)
- ✅ KPI System (EPIC 03 - 12 Factory KPIs)
- ✅ Cost Attribution Engine (EPIC 09)
- ✅ Prompt Library (EPIC 06)

#### What is Experimental/Unstable
- ⚠️ Workflow Engine & Execution (functional but needs refinement)
- ⚠️ Control Center UI (functional MVP, needs UX polish)
- ⚠️ LLM Integration & Agent System (basic integration)
- ⚠️ Webhook Event Processing (basic implementation)
- ⚠️ v0.1 Lambda Pipeline (legacy, deprecated)

#### Documentation Updates
- Updated `docs/v04/README.md` to highlight release review as canonical reference
- Updated main `README.md` to reference v0.4 release review
- Added comprehensive quick reference links to all documentation

#### Foundation for v0.5
- Established clear scope for v0.4 stable features
- Identified v0.5 candidate features based on v0.4 limitations
- Documented Go/No-Go criteria for v0.5 planning
- References Issue I-06-02-V05-GO for v0.5 decision process

**Status**: ✅ Complete - v0.4 Reference State Established

---

## 2024-12-17 - EPIC 07: Security & Blast Radius – Minimale Angriffsfläche

### Added - Security Hardening & Policy Validation

**Issue #7: Security & Blast Radius – Minimale Angriffsfläche**

Comprehensive security hardening to minimize attack surface and enforce least privilege principles across all MCP servers and infrastructure components.

#### Automated Security Validation
- **IAM Policy Validator**: `scripts/validate-iam-policies.ts` - Parses and validates all IAM policies
  - Checks for forbidden wildcard actions (iam:DeleteRole, rds:DeleteDBInstance, etc.)
  - Verifies resource scoping to `afu9/*` prefix
  - Validates least privilege principles
  - Documents justified wildcards (AWS service limitations)
- **Test Suite**: `scripts/test-iam-validation.ts` - Comprehensive validation logic tests
- **npm Scripts**: `validate-iam` and `security:check` commands for easy validation

#### CI/CD Integration
- **GitHub Actions Workflow**: `.github/workflows/security-validation.yml`
  - Automated validation on all PRs
  - Detects IAM policy changes
  - Posts security review checklist to PRs
  - Blocks deployment on validation failures
  - Exit code 0 = compliant, 1 = violations detected

#### Security Enhancements
- **Resource Scoping**: All IAM resources include `afu9` prefix
  - Secrets Manager: `afu9/*`
  - ECR Repositories: `afu9/*`
  - ECS Cluster: `afu9-cluster`
  - CloudWatch Logs: `/ecs/afu9/*`
- **Wildcard Justification**: Only 2 wildcards remaining, both AWS limitations:
  - `ecr:GetAuthorizationToken` - No resource-level support
  - `cloudwatch:*` metrics actions - Global service limitation
- **No Broad Actions**: Zero `service:*` or `*` action permissions
- **Separation of Concerns**: Clear boundaries between infrastructure, application, and deployment roles

#### Documentation
- **Quick Reference**: `docs/SECURITY_VALIDATION_GUIDE.md` - Day-to-day security validation guide
- **Implementation**: `EPIC07_SECURITY_IMPLEMENTATION.md` - Complete security hardening documentation
- **IAM Justification**: Enhanced `docs/IAM-ROLES-JUSTIFICATION.md` with detailed permission rationale
- **Security Guide**: Enhanced `docs/SECURITY-IAM.md` with security architecture
- **Updated README**: Added security validation section with quick links

#### Validation Results
- ✅ 10 IAM policy statements validated across all CDK stacks
- ✅ 0 errors found
- ✅ 0 warnings
- ✅ 2 info messages (justified AWS limitations)
- ✅ All policies comply with least privilege principle

#### KPI
- **Security Incidents**: Zero incidents related to IAM misconfiguration
- **Attack Surface**: Minimized through strict resource scoping
- **Blast Radius**: Contained through least privilege enforcement

## 2024-12-17 - EPIC 5: Deterministic Build Graphs

Architektur: Control Center + MCP Sidecars (GitHub/Deploy/Observability)

AWS: VPC/ALB/RDS/ECS/ECR/IAM/Secrets/DNS (Issues #40–#43, #58–#61)

Workflow Engine + Runner + Client Layer (#44–#47)

Webhooks + UI (#37, #48, #53–#57)

Observability/Security (#38, #60–#61)

## 2024-12-17 - EPIC 5: Deterministic Build Graphs

### Added - Build Determinism Implementation

**Issue 5.1: Deterministic Build Graphs – Reproduzierbare Build-Prozesse**

Build determinism has been fully implemented to ensure reproducible builds with no uncontrolled side effects.

#### Docker Build Improvements
- Pinned Node.js version to `node:20.10.0-alpine` for all Docker images
- Changed from `npm install` to `npm ci` in all Dockerfiles to use lockfiles
- Added `SOURCE_DATE_EPOCH=0` environment variable for deterministic timestamps
- Created `.dockerignore` files to exclude non-deterministic files

#### GitHub Actions Enhancements
- Added documentation explaining git SHA as primary deterministic identifier
- Clarified timestamp tags are supplementary for human readability only
- Created automated build determinism verification workflow (`.github/workflows/build-determinism.yml`)
- Added explicit security permissions to workflows

#### Verification Tools
- New verification script: `scripts/verify-build-determinism.sh`
- Automated CI/CD enforcement via GitHub Actions
- Builds components twice and verifies identical image digests
- Improved error handling with full logs and clear error messages

#### Documentation
- `docs/BUILD_DETERMINISM_CRITERIA.md` - Complete determinism rules and validation procedures
- `docs/BUILD_DEPENDENCY_GRAPH.md` - Visual build pipeline documentation and audit trail
- `docs/BUILD_DETERMINISM_IMPLEMENTATION_SUMMARY.md` - Implementation overview and status
- Updated `docs/BUILD_DETERMINISM.md` with status and quick links

#### Acceptance Criteria Met
- ✅ Gleiche Inputs → gleicher Output: Docker builds with pinned versions ensure identical outputs
- ✅ Auditierbare Build-Pipeline: Build manifests, KPI tracking, and dependency graphs provide full audit trail
- ✅ Build Determinism KPI: Tracked via BuildDeterminismTracker, target ≥95%

#### Security
- CodeQL analysis: Zero vulnerabilities found
- Explicit permissions in GitHub Actions workflows
- Secure build process with pinned versions

**Priority**: P0 ✅ Complete

---

## 2024-12-17 - Epic-4: Smoke/Debug Harness + DB Toggle Hardening

### Added
- **scripts/smoke_epic4.ps1**: Comprehensive smoke tests for health/ready endpoints with database toggle assertions
  - Tests all 4 services (Control Center + 3 MCP servers)
  - Validates database configuration: `not_configured` when enableDatabase=false, `ok` when enableDatabase=true
  - Supports auto-detection mode for flexible testing
- **scripts/ecs_debug.ps1**: ECS debugging harness for diagnosing deployment issues
  - Service information, events, and deployment status
  - Stopped tasks with exit codes and failure reasons
  - Target health from ALB
  - Recent logs from /ecs/afu9/* log groups with color-coded output
  - Diagnostic summary with actionable recommendations
- **docs/TESTING_EPIC4.md**: Comprehensive testing guide
  - Test matrix for DB on/off configurations
  - Deployment scenarios with step-by-step instructions
  - Script reference with examples
  - Validation checklist
  - Common issues and solutions
  - Expected outputs for successful tests
- **scripts/validate_epic4_implementation.ps1**: Automated validation of Epic-4 implementation correctness
- **package.json scripts**:
  - `npm run smoke:epic4`: Run Epic-4 smoke tests
  - `npm run ecs:debug`: Run ECS debugging harness

### Verified
- ✅ enableDatabase=false deploys without SecretsManager DB access
  - DB secret grants are conditional in ECS stack
  - No DATABASE_* env vars injected when dbSecret is undefined
  - Control Center /ready reports `database:not_configured`
- ✅ enableDatabase=true requires dbSecretArn + IAM grants
  - CDK validation throws error if enableDatabase=true without dbSecretArn
  - DATABASE_ENABLED env var set based on enableDatabase flag
  - DB secrets injected via ECS task definition
  - Task execution role granted SecretsManager read permissions

### Acceptance Criteria Met
- ✅ enableDatabase=false deploys without SecretsManager DB access
- ✅ enableDatabase=true only works with dbSecretArn + IAM grant
- ✅ Health/ready endpoints validated with database toggle assertions
- ✅ ECS debugging tools for service events, stopped tasks, and logs
- ✅ Testing documentation with matrix and expected outputs
