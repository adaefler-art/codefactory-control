Architektur: Control Center + MCP Sidecars (GitHub/Deploy/Observability)

AWS: VPC/ALB/RDS/ECS/ECR/IAM/Secrets/DNS (Issues #40–#43, #58–#61)

Workflow Engine + Runner + Client Layer (#44–#47)

Webhooks + UI (#37, #48, #53–#57)

Observability/Security (#38, #60–#61)

## 2025-12-17 - EPIC 5: Deterministic Build Graphs

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

## 2025-12-17 - Epic-4: Smoke/Debug Harness + DB Toggle Hardening

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
