# Prompt Library Governance

**Version:** 1.0.0  
**Effective Date:** 2024-12-17  
**Status:** ✅ Active

## Overview

This document defines the governance framework for managing versioned prompts in the AFU-9 Canonical Prompt Library. It establishes rules for versioning, breaking changes, deprecation, and change management to ensure Factory Intelligence stability and quality.

## Governance Principles

### 1. Semantic Versioning (SemVer)

All prompts follow **strict semantic versioning** (MAJOR.MINOR.PATCH):

```
MAJOR.MINOR.PATCH
  │     │     │
  │     │     └─── Bug fixes, typos, non-functional changes
  │     └───────── New features, backward-compatible changes
  └─────────────── Breaking changes, incompatible API changes
```

### 2. Breaking Change Threshold

A change is considered **breaking** if:

1. **Variable Changes:**
   - Removing a required variable
   - Renaming a variable
   - Changing variable type or structure

2. **Content Changes:**
   - System prompt changed by >50% (measured by character difference)
   - Behavioral changes that affect output structure
   - Changes that require workflow modifications

3. **Schema Changes:**
   - Modified expected input/output format
   - Changed model configuration significantly

### 3. Traceability Requirement

**Every agent run MUST track:**
- Prompt version ID used
- Prompt content snapshot
- Variable values provided
- Execution ID for correlation

This enables:
- Debugging issues with specific prompt versions
- Measuring prompt effectiveness
- Rolling back problematic versions
- Compliance and audit trails

## Versioning Rules

### MAJOR Version Increment (X.0.0)

**When to use:**
- Removing required variables from template
- Renaming variables (breaking existing workflows)
- Changing variable types incompatibly
- System prompt changes >50% different
- Behavioral changes affecting downstream systems

**Requirements:**
1. ✅ Document all breaking changes
2. ✅ Provide migration guide
3. ✅ Specify affected workflows
4. ✅ Test migration path
5. ✅ Notify all stakeholders
6. ✅ Grace period: minimum 7 days before enforcing

**Example:**
```json
{
  "version": "2.0.0",
  "changeType": "major",
  "breakingChanges": "Renamed variable 'issue_text' to 'issue_body', added required variable 'issue_title'",
  "migrationGuide": "Update all workflows to use 'issue_body' instead of 'issue_text'. Add 'issue_title' to variable context."
}
```

### MINOR Version Increment (X.Y.0)

**When to use:**
- Adding optional variables
- Enhancing prompt without changing core behavior
- Improving clarity or instructions
- Adding examples to system prompt
- Performance improvements maintaining compatibility

**Requirements:**
1. ✅ Document changes and improvements
2. ✅ Verify backward compatibility
3. ✅ Test with existing workflows

**Example:**
```json
{
  "version": "1.1.0",
  "changeType": "minor",
  "changeDescription": "Added optional 'repository_context' variable to provide additional context about the repository structure"
}
```

### PATCH Version Increment (X.Y.Z)

**When to use:**
- Fixing typos or grammatical errors
- Correcting formatting issues
- Documentation clarifications
- Bug fixes that don't change behavior

**Requirements:**
1. ✅ Brief description of fix
2. ✅ Confirm no behavioral change

**Example:**
```json
{
  "version": "1.0.1",
  "changeType": "patch",
  "changeDescription": "Fixed typo in system prompt: 'anaysis' → 'analysis'"
}
```

## Change Management Process

### 1. Proposal Phase

**For MAJOR changes:**
1. Create change proposal document
2. Identify affected workflows
3. Estimate migration effort
4. Get stakeholder approval

**For MINOR/PATCH changes:**
1. Document change rationale
2. Verify backward compatibility

### 2. Development Phase

1. Create new version via API: `POST /api/prompts/{id}/versions`
2. Test with real scenarios
3. Validate against affected workflows
4. Run automated breaking change detection

### 3. Review Phase

**Required Reviews:**
- Technical review: Verify versioning correctness
- Content review: Ensure prompt quality
- Impact review: Assess workflow changes
- Security review: Check for injection risks

### 4. Publication Phase

1. Publish version: Set `published: true`
2. Update canonical registry: [PROMPT_LIBRARY_CANON.md](./PROMPT_LIBRARY_CANON.md)
3. Notify stakeholders
4. Monitor metrics: Track adoption and issues

### 5. Monitoring Phase

**Track these KPIs:**
- Prompt Stability: Usage count, error rate
- Version adoption: How quickly new version is adopted
- Rollback rate: How often versions are reverted
- Breaking change impact: Workflow failures after major versions

Query: `SELECT * FROM prompt_stability_metrics WHERE prompt_name = 'your_prompt'`

## Deprecation Policy

### Deprecation Process

1. **Mark as Deprecated:**
   ```bash
   PATCH /api/prompts/{id}
   {
     "deprecate": true,
     "reason": "Replaced with more efficient version",
     "replacementPromptId": "new-prompt-uuid"
   }
   ```

2. **Grace Period:**
   - MAJOR version: 30 days minimum
   - MINOR version: 14 days minimum
   - PATCH version: 7 days minimum

3. **Migration Support:**
   - Provide detailed migration guide
   - Offer migration assistance
   - Monitor deprecated usage

4. **Sunset:**
   - After grace period, mark as archived
   - Keep in database for historical reference
   - Prevent new workflows from using it

### Deprecation Alerts

Alert when:
- Deprecated prompt is still used after grace period
- Usage count of deprecated prompt increases
- No replacement prompt is specified

## Quality Standards

### Prompt Quality Checklist

Every canonical prompt must meet:

- [ ] **Clear Purpose:** Well-defined use case documented
- [ ] **Variable Documentation:** All variables explained with types
- [ ] **Example Values:** Sample variable values provided
- [ ] **Test Coverage:** Tested with real scenarios
- [ ] **Error Handling:** Expected errors documented
- [ ] **Performance:** Response time within acceptable limits
- [ ] **Security:** No prompt injection vulnerabilities
- [ ] **Maintainability:** Clear, readable prompt structure

### Code Review Requirements

**For MAJOR versions:**
- 2+ reviewers required
- Security review mandatory
- Impact analysis required

**For MINOR versions:**
- 1+ reviewer required
- Compatibility check required

**For PATCH versions:**
- 1 reviewer recommended
- Quick sanity check

## Breaking Change Detection

### Automatic Detection

The system automatically detects potential breaking changes:

```typescript
// Example from prompt-library-service.ts
const analysis = this.detectBreakingChanges(currentVersion, newRequest);

if (analysis.hasBreakingChanges) {
  // Require MAJOR version increment
  // Require migration guide
  // Alert stakeholders
}
```

**Detection Rules:**
1. Variable removed: HIGH impact
2. Variable type changed: HIGH impact  
3. Content change >50%: HIGH impact
4. Schema incompatibility: HIGH impact

### Manual Override

In rare cases, auto-detection may be incorrect:

1. Review detection results
2. Document why override is needed
3. Get approval from 2+ reviewers
4. Explicitly set `changeType` in version creation

## Rollback Procedures

### When to Rollback

Rollback a prompt version when:
- Error rate spikes >10% after deployment
- Critical bug discovered
- Breaking change affects more workflows than expected
- Security vulnerability found

### Rollback Process

1. **Identify Issue:**
   - Monitor `prompt_stability_metrics`
   - Check error logs
   - Review stakeholder reports

2. **Execute Rollback:**
   ```bash
   PATCH /api/prompts/{id}
   {
     "currentVersionId": "previous-version-uuid"
   }
   ```

3. **Notify Stakeholders:**
   - Alert team about rollback
   - Explain root cause
   - Provide timeline for fix

4. **Root Cause Analysis:**
   - Document what went wrong
   - Update testing procedures
   - Improve detection rules

## Audit and Compliance

### Audit Trail

The system maintains complete audit trails:

- **prompt_versions table:** All version history
- **agent_runs table:** Tracks which version was used
- **prompt_stability_metrics view:** Usage patterns

### Compliance Reports

Generate compliance reports:

```sql
-- Prompts used in last 30 days
SELECT 
  p.name,
  pv.version,
  COUNT(ar.id) as usage_count
FROM prompts p
JOIN prompt_versions pv ON p.current_version_id = pv.id
JOIN agent_runs ar ON ar.prompt_version_id = pv.id
WHERE ar.started_at > NOW() - INTERVAL '30 days'
GROUP BY p.name, pv.version
ORDER BY usage_count DESC;
```

## Roles and Responsibilities

### Prompt Owner

**Responsibilities:**
- Maintain prompt quality
- Review and approve changes
- Monitor prompt metrics
- Respond to issues

### Release Manager

**Responsibilities:**
- Oversee version releases
- Ensure governance compliance
- Coordinate stakeholder notifications
- Manage deprecation timelines

### Quality Assurance

**Responsibilities:**
- Test prompt versions
- Validate breaking change detection
- Review migration guides
- Monitor KPIs

## Escalation Path

**For conflicts or governance violations:**

1. **Level 1:** Prompt Owner
2. **Level 2:** Release Manager
3. **Level 3:** Technical Lead
4. **Level 4:** Engineering Director

## Governance Review

This governance document is reviewed:

- **Quarterly:** Routine review of rules and processes
- **After Major Incidents:** Review and update as needed
- **When Issues Arise:** Ad-hoc reviews for specific problems

**Next Review:** 2025-03-17

## Related Documentation

- [PROMPT_LIBRARY_CANON.md](./PROMPT_LIBRARY_CANON.md) - Canonical prompt registry
- [PROMPT_LIBRARY.md](./PROMPT_LIBRARY.md) - Technical implementation
- [KPI_DEFINITIONS.md](./KPI_DEFINITIONS.md) - KPI tracking
- [KPI_GOVERNANCE.md](./KPI_GOVERNANCE.md) - KPI change management

## Appendix A: Change Examples

### Example 1: Adding Optional Variable (MINOR)

**Before (v1.0.0):**
```typescript
{
  variables: {
    "issue_title": "string",
    "issue_body": "string"
  }
}
```

**After (v1.1.0):**
```typescript
{
  variables: {
    "issue_title": "string",
    "issue_body": "string",
    "repository_url": "string (optional)"  // Added
  },
  changeType: "minor",
  changeDescription: "Added optional repository_url for enhanced context"
}
```

### Example 2: Renaming Variable (MAJOR)

**Before (v1.5.0):**
```typescript
{
  variables: {
    "issue_text": "string"
  }
}
```

**After (v2.0.0):**
```typescript
{
  variables: {
    "issue_body": "string"  // Renamed from issue_text
  },
  changeType: "major",
  breakingChanges: "Variable 'issue_text' renamed to 'issue_body'",
  migrationGuide: "Update all workflow variable references from 'issue_text' to 'issue_body'"
}
```

### Example 3: Bug Fix (PATCH)

**Before (v1.2.0):**
```
System prompt: "You are an expert analyer..."  // Typo
```

**After (v1.2.1):**
```
System prompt: "You are an expert analyzer..."  // Fixed
```
```typescript
{
  changeType: "patch",
  changeDescription: "Fixed typo: 'analyer' → 'analyzer'"
}
```

## Appendix B: Breaking Change Checklist

Before creating a MAJOR version, verify:

- [ ] All breaking changes documented
- [ ] Migration guide created and tested
- [ ] Affected workflows identified
- [ ] Stakeholders notified (7+ days advance notice)
- [ ] Rollback plan prepared
- [ ] Monitoring alerts configured
- [ ] Test coverage for new version
- [ ] Security review completed
- [ ] Performance impact assessed

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-12-17  
**Next Review:** 2025-03-17  
**Maintained by:** AFU-9 Factory Intelligence Team
