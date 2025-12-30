---
Doc-ID: REVIEW-CHECKLIST-V06
Version: 0.6
Status: CANONICAL
Last-Updated: 2025-12-30
---

# AFU-9 Review Checklist - v0.6

**Purpose:** Binding review gates for code changes, evidence items, and releases.

## Pre-Commit Review Gates

### Code Quality
- [ ] Code follows project style guidelines (ESLint, TypeScript strict mode)
- [ ] No unused imports or variables
- [ ] Proper error handling in place
- [ ] TypeScript types are properly defined (no `any` without justification)

### Security
- [ ] No secrets or credentials in code
- [ ] Input validation for user-facing endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] Proper authentication/authorization checks

### Testing
- [ ] Unit tests added for new functionality
- [ ] Existing tests pass
- [ ] Integration tests updated if applicable
- [ ] Edge cases considered and tested

### Documentation
- [ ] Code comments for complex logic
- [ ] API documentation updated if endpoints changed
- [ ] README or relevant docs updated
- [ ] Migration scripts documented if schema changed

### Database
- [ ] Migration scripts are idempotent
- [ ] Transactions used for multi-step operations (G-08)
- [ ] Proper indexing for query performance
- [ ] Rollback plan documented

## Evidence Review Gates

### Evidence Item Completion
- [ ] Evidence ID matches canonical order (RELEASE.md)
- [ ] Implementation summary document created
- [ ] All acceptance criteria met
- [ ] Manual testing performed and documented
- [ ] Integration points verified

### Artifacts
- [ ] Code changes committed and pushed
- [ ] Database migrations applied (if applicable)
- [ ] Configuration updates documented
- [ ] Deployment notes prepared

### Cross-Cutting Concerns
- [ ] Guardrails compliance verified (SCOPE_GUARD.md)
- [ ] No breaking changes to existing APIs without justification
- [ ] Performance impact assessed
- [ ] Monitoring/observability considered

## Release Review Gates

### Pre-Release
- [ ] All evidence items in canonical order completed
- [ ] Integration testing complete
- [ ] Deploy determinism verified (E64.2)
- [ ] Deploy status monitor operational (E65.1)
- [ ] Post-deploy verification playbook ready (E65.2)

### Release Execution
- [ ] Deployment plan reviewed and approved
- [ ] Rollback plan documented and tested
- [ ] Stakeholder notification sent
- [ ] Deployment window scheduled

### Post-Release
- [ ] Deploy status confirmed GREEN
- [ ] Post-deploy verification passed
- [ ] No critical incidents within 24 hours
- [ ] Release notes published
- [ ] Version tag created

## Guardrail Compliance

All changes must comply with:
- [Scope Guard](./SCOPE_GUARD.md) - Binding guardrails (G-00 through G-13)
- [Release Scope](../releases/v0.6/RELEASE.md) - v0.6 canonical boundaries

## Escalation

If any review gate cannot be satisfied:
1. Document the blocker in issue comments
2. Update issue status to `blocked`
3. Escalate to project lead
4. Do NOT proceed with merge until resolved

## Review Checklist Version History

- v0.6 (2025-12-30): Initial canonical checklist for v0.6 release
