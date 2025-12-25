# AFU-9 Test Runs (Testläufe)

This directory contains documentation for all AFU-9 end-to-end test runs (Testläufe).
Each test run validates a specific aspect of the AFU-9 system with a comprehensive,
reproducible procedure and a clear verdict.

## Test Run Structure

Each test run follows this canonical structure:

1. **Zweck (Purpose)**: What is being tested and why
2. **Scope**: What is included and explicitly excluded
3. **Intent**: Success criteria and validation goals
4. **Ablauf (Procedure)**: Step-by-step test execution plan
5. **Erwartetes Ergebnis (Expected Results)**: Clear pass/fail criteria
6. **Ist-Ergebnis (Actual Results)**: Documented findings from execution
7. **Artefakte (Artifacts)**: Links to code, commits, issues, and logs
8. **Abweichungen (Deviations)**: Any issues found and their resolution
9. **Lessons Learned**: Insights and improvements discovered
10. **Entscheidung (Verdict)**: Go / Adjust / Drop with justification

## Test Runs

### AFU9-TL-001: Deploy Event DB→API→UI
**Status**: ✅ ADOPT  
**Date**: Prior to 2025-12-25  
**Focus**: Deploy event workflow validation

Validates the complete deploy event lifecycle:
- Deploy workflow writes to internal API
- API persists to `deploy_events` table
- UI displays latest deploy event
- Error handling and validation

**Key Result**: Full DB→API→UI pipeline works reliably for deploy tracking.

**Files**:
- [AFU9-TL-001.md](./AFU9-TL-001.md)

---

### AFU9-TL-E2E-001: AFU-9 Issue Workflow
**Status**: ✅ ADOPT (Documented, execution pending)  
**Date**: 2025-12-25  
**Focus**: Complete AFU-9 issue lifecycle validation

Validates the autonomous issue management system:
- Issue creation and CRUD operations via API
- State transitions (CREATED → SPEC_READY → IMPLEMENTING → DONE)
- Single-Issue-Mode enforcement (DB trigger)
- GitHub handoff with idempotency
- Event logging and audit trail
- UI integration and visualization

**Key Result**: AFU-9 issue system is production-ready for autonomous issue tracking
and GitHub integration.

**Files**:
- [AFU9-TL-E2E-001.md](./AFU9-TL-E2E-001.md)
- [Test Script](../../test/e2e/afu9-issue-workflow.test.ts)

---

## Test Run Naming Convention

Test runs follow this naming pattern:

```
AFU9-TL-{CATEGORY}-{NUMBER}
```

**Categories**:
- `001-099`: Infrastructure and deployment tests
- `E2E-001-099`: End-to-end workflow tests
- `PERF-001-099`: Performance and load tests
- `SEC-001-099`: Security validation tests
- `INT-001-099`: Integration tests

**Examples**:
- `AFU9-TL-001`: First infrastructure test (deploy events)
- `AFU9-TL-E2E-001`: First E2E test (issue workflow)
- `AFU9-TL-PERF-001`: First performance test
- `AFU9-TL-SEC-001`: First security test

## Verdict Types

Each test run must end with one of three verdicts:

### ✅ ADOPT (Go)
The feature/system is production-ready and should be adopted.
- All critical tests passed
- Known issues are minor and documented
- System meets acceptance criteria

### ⚠️ ADJUST (Adjust)
The feature/system needs adjustments before production use.
- Some tests failed or revealed issues
- Issues are fixable with targeted changes
- Re-test required after adjustments

### ❌ DROP (Drop)
The feature/system should not be used in production.
- Critical failures or fundamental design flaws
- Unacceptable risk or complexity
- Alternative approach recommended

## Test Execution Guidelines

### Prerequisites
1. **Environment Setup**:
   - Local: Docker Compose with PostgreSQL
   - Staging: AWS ECS environment
   - GitHub: Valid token with repo permissions

2. **Database**:
   - Migrations applied (`database/migrations/*.sql`)
   - Clean state or known baseline

3. **Services**:
   - Control Center running (port 3000)
   - MCP servers healthy (if applicable)
   - GitHub API accessible

### Execution Steps
1. **Review Test Plan**: Read the test run document completely
2. **Setup Environment**: Follow prerequisites in the document
3. **Execute Tests**: Run commands step-by-step as documented
4. **Capture Results**: Log all outputs, errors, and observations
5. **Update Document**: Fill in "Ist-Ergebnis" section with actual findings
6. **Analyze**: Compare expected vs. actual results
7. **Verdict**: Determine Go/Adjust/Drop with clear justification
8. **Commit**: Update the test run document and commit to repository

### Best Practices
- ✅ Execute tests in isolation (clean environment)
- ✅ Document exact commands and outputs
- ✅ Take screenshots of UI validations
- ✅ Save log files and artifacts
- ✅ Note any deviations from expected results
- ✅ Include timestamps for all observations
- ❌ Don't skip negative test cases
- ❌ Don't edit expected results to match actuals
- ❌ Don't commit without a clear verdict

## Related Documentation

- [AFU9 Issue Model](../issues/AFU9_ISSUE_MODEL.md)
- [AFU9 Issues API](../AFU9-ISSUES-API.md)
- [Architecture Overview](../architecture/afu9-v0.2-overview.md)
- [Database Migrations](../../database/migrations/)
- [E2E Tests](../../test/e2e/)

## Contributing Test Runs

When creating a new test run:

1. **Copy Template**: Use AFU9-TL-001.md or AFU9-TL-E2E-001.md as template
2. **Choose ID**: Select next available number in appropriate category
3. **Define Scope**: Clearly state what is tested and what is not
4. **Write Procedure**: Document every command and expected output
5. **Execute**: Run the test and capture real results
6. **Verdict**: Provide clear Go/Adjust/Drop decision
7. **Submit PR**: Include test run document and any test scripts

### Template Checklist
- [ ] Purpose clearly stated
- [ ] Scope includes and excludes defined
- [ ] Test phases broken down logically
- [ ] Expected results are measurable
- [ ] Commands are copy-pasteable
- [ ] Negative tests included
- [ ] Verdict includes justification
- [ ] Artifacts referenced with links
- [ ] Lessons learned captured

---

**Maintained by**: AFU-9 Team  
**Last Updated**: 2025-12-25  
**Version**: 1.0
