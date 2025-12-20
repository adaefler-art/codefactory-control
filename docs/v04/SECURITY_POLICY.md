# AFU-9 Security Policy

**Version**: 1.0  
**Last Updated**: 2024-12-17  
**Next Review**: 2025-03-17

## Security Principles

AFU-9 follows these core security principles to protect the autonomous code fabrication system:

### 1. Least Privilege
All IAM policies grant **minimal permissions** required for operation:
- ✅ Resource-scoped to `afu9/*`, `afu9-cluster`, or `/ecs/afu9/*` namespaces
- ✅ Action-specific (no wildcard actions like `*` or `service:*`)
- ✅ Wildcard-minimized (only 2 wildcards, both AWS service limitations)
- ✅ Role separation (Task Execution, Task, Deploy roles)

### 2. Defense in Depth
Multiple layers of security controls:
- IAM role-based access control
- VPC network isolation (private subnets)
- Security group restrictions
- Secrets Manager encryption
- CloudTrail audit logging
- Automated security validation

### 3. Zero Trust
No implicit trust, verify all access:
- OIDC for GitHub Actions (no long-term credentials)
- IAM roles for AWS services (no access keys)
- Secrets in Secrets Manager (never in code)
- TLS for all data in transit

### 4. Secrets Management
All sensitive data stored securely:
- AWS Secrets Manager for all credentials
- KMS encryption at rest
- No secrets in code or configuration files
- Regular rotation procedures

### 5. Audit and Monitoring
Comprehensive logging and alerting:
- CloudTrail for all API calls
- CloudWatch for metrics and logs
- Security validation in CI/CD
- Regular manual audits

### 6. Regular Reviews
Continuous security improvement:
- **Quarterly** IAM policy audits
- **Monthly** security incident reviews
- **Continuous** automated validation
- **Annual** comprehensive security assessment

## IAM Policy Governance

### Current Status

**Security Score**: 98/100 ✅

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Wildcard Resources | 2 | ≤2 | ✅ PASS |
| Resource Scoping | 100% | 100% | ✅ PASS |
| Security Incidents | 0 | 0 | ✅ PASS |
| Documentation Coverage | 100% | 100% | ✅ PASS |

See [SECURITY_METRICS.md](docs/SECURITY_METRICS.md) for detailed tracking.

### Least Privilege Enforcement

**Automated Validation**: Every pull request with IAM changes triggers automated security checks.

**What's Validated**:
- ✅ No wildcard resources on forbidden actions (IAM, RDS, EC2, ECS destructive ops)
- ✅ All resources properly scoped to AFU-9 namespaces
- ✅ No broad action permissions (`*` or `service:*`)
- ✅ Wildcard usage justified with AWS documentation
- ✅ All policies have justification comments

**CI/CD Integration**: See [.github/workflows/security-validation.yml](.github/workflows/security-validation.yml)

### Policy Review Process

**Automated Reviews**: 
- Every PR triggers validation script
- Security team notified of IAM changes
- Must pass before merge

**Manual Reviews**: 
- Quarterly comprehensive audits
- Security team approval required for IAM changes
- Documented in audit reports

**Audit Schedule**: 
- Next Quarterly Audit: 2025-03-17
- See [IAM_POLICY_AUDIT_PROCEDURE.md](docs/IAM_POLICY_AUDIT_PROCEDURE.md)

### Wildcard Policy

**Current Wildcards**: 2 (both justified by AWS service limitations)

✅ **Allowed Wildcards** (with AWS documentation):
1. `ecr:GetAuthorizationToken` - [AWS service limitation](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonelasticcontainerregistry.html) - does not support resource-level permissions
2. CloudWatch Metrics actions (`GetMetricStatistics`, `GetMetricData`, etc.) - [AWS service limitation](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncloudwatch.html) - global service without resource-level permissions

❌ **Prohibited Wildcards**:
Wildcards are **strictly forbidden** on all sensitive/destructive actions:
- IAM operations (CreateRole, DeleteRole, AttachPolicy, etc.)
- Secrets management (CreateSecret, DeleteSecret, UpdateSecret)
- Database operations (DeleteDBInstance, ModifyDBInstance)
- Compute operations (TerminateInstances, DeleteService, DeleteCluster)
- Storage operations (DeleteBucket, DeleteObject)

See [validate-iam-policies.ts](scripts/validate-iam-policies.ts) for complete list.

### Resource Scoping

**100% Compliance**: All resources are scoped to AFU-9 namespaces

**Namespace Conventions**:
- Secrets: `afu9-*` prefix (e.g., `afu9-github`, `afu9-llm`, `afu9-database`)
- ECR Repositories: `afu9/*` (e.g., `afu9/control-center`, `afu9/mcp-github`)
- ECS Resources: `afu9-cluster`, `afu9-*` task definitions, `afu9-*` services
- CloudWatch Logs: `/ecs/afu9/*` log groups
- IAM Roles: `afu9-*` prefix (e.g., `afu9-ecs-task-role`, `afu9-github-actions-deploy-role`)

**Cross-Application Isolation**: No AFU-9 role can access resources from other applications.

## Security Documentation

### Quick Links

**Implementation Guides**:
- [IAM Roles Justification](docs/IAM-ROLES-JUSTIFICATION.md) - Detailed rationale for all IAM permissions
- [Security IAM Guide](docs/SECURITY-IAM.md) - Implementation guidelines and best practices
- [Secrets Management](SECURITY.md) - AWS Secrets Manager integration and usage

**Audit & Compliance**:
- [IAM Policy Audit Procedure](docs/IAM_POLICY_AUDIT_PROCEDURE.md) - Quarterly audit checklist
- [Security Metrics Dashboard](docs/SECURITY_METRICS.md) - KPI tracking and trends

**Architecture**:
- [Network Architecture](docs/architecture/network-architecture.md) - VPC, subnets, security groups
- [AFU-9 v0.2 Overview](docs/architecture/afu9-v0.2-overview.md) - System architecture

## Supported Versions

| Version | Supported | Status | Security Updates |
|---------|-----------|--------|------------------|
| v0.2.x | ✅ Yes | **Current** - ECS/MCP architecture | Active |
| v0.1.x | ❌ No | **Legacy** - Lambda architecture | None |

**Production Environment**: v0.2.x only  
**Recommendation**: Migrate from v0.1.x to v0.2.x immediately

## Reporting Security Vulnerabilities

### Responsible Disclosure

We take security seriously. If you discover a security vulnerability:

**DO**:
1. ✅ Report privately via GitHub Security Advisory
2. ✅ Email security@yourdomain.com with details
3. ✅ Wait for acknowledgment before public disclosure
4. ✅ Provide detailed reproduction steps
5. ✅ Suggest remediation if possible

**DON'T**:
1. ❌ Open public GitHub issues for security vulnerabilities
2. ❌ Discuss vulnerabilities on social media
3. ❌ Exploit vulnerabilities beyond proof-of-concept
4. ❌ Access unauthorized data
5. ❌ Perform destructive testing in production

### Response Timeline

- **Initial Response**: Within 24 hours
- **Triage & Assessment**: Within 72 hours
- **Fix Development**: 1-7 days (depending on severity)
- **Security Advisory**: Published after fix is deployed
- **Credit**: Reporter credited in advisory (if desired)

### Severity Classification

**Critical** (Fix within 24 hours):
- Remote code execution
- Authentication bypass
- Privilege escalation to admin
- Secrets exposure

**High** (Fix within 72 hours):
- IAM privilege escalation
- Data breach potential
- Denial of service
- Cross-service access

**Medium** (Fix within 7 days):
- Information disclosure
- Overly broad permissions
- Missing security headers
- Incomplete input validation

**Low** (Fix within 30 days):
- Documentation issues
- Best practice violations
- Non-exploitable weaknesses

## Security Contacts

**Primary Contact**: security@yourdomain.com  
**Escalation**: CTO / Head of Engineering  
**Security Team**: See [MAINTAINERS.md](MAINTAINERS.md)

## Incident Response

### Detection
- CloudWatch alarms for suspicious activity
- CloudTrail monitoring
- Application error tracking
- Automated security scans

### Response Procedure

1. **Detect**: Automated alert or manual report
2. **Assess**: Determine severity and impact
3. **Contain**: Isolate affected systems
4. **Eradicate**: Remove threat and fix vulnerability
5. **Recover**: Restore normal operations
6. **Learn**: Post-mortem and prevention measures

See detailed runbooks in [docs/RUNBOOK_ECS_DEPLOY.md](docs/RUNBOOK_ECS_DEPLOY.md)

### Emergency Contacts

**Available 24/7 for Critical Issues**:
- On-call Engineer: [PagerDuty/Slack]
- Security Team: security@yourdomain.com
- CTO: [contact info]

## Compliance

### Standards

AFU-9 follows industry best practices:
- ✅ [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/) - Security Pillar
- ✅ [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
- ✅ [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- ✅ [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)

### Certifications

- SOC 2 Type II: [Status]
- ISO 27001: [Status]
- GDPR Compliance: [Status]

## Security Training

**Required for All Team Members**:
- AWS Security Fundamentals
- IAM Best Practices
- Secrets Management
- Incident Response Procedures

**Frequency**: Annually + when joining team

**Security Champions**: [Names/Contact]

## External Security Testing

**Bug Bounty Program**: [Status/Link]  
**Penetration Testing**: [Schedule - e.g., Annually]  
**Security Audits**: [Schedule - e.g., Quarterly]

## Updates to This Policy

This security policy is reviewed and updated:
- **Quarterly**: During IAM policy audits
- **As Needed**: After security incidents or major changes
- **Annually**: Comprehensive security review

**Version History**:
- v1.0 (2024-12-17): Initial policy document

## Acknowledgments

Security researchers and contributors who have helped improve AFU-9 security:
- [List contributors who reported issues]

---

**Policy Owner**: Security Team  
**Approved By**: CTO  
**Effective Date**: 2024-12-17  
**Next Review**: 2025-03-17

For questions about this policy, contact: security@yourdomain.com
