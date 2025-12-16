-- AFU-9 Verdict Engine v1.1 Schema
-- Implements EPIC 2: Governance & Auditability
-- Issue 2.1: Policy Snapshotting per Run
-- Issue 2.2: Confidence Score Normalization

-- ========================================
-- Policy Snapshots
-- ========================================

CREATE TABLE policy_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) NOT NULL,
  policies JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX idx_policy_snapshots_version ON policy_snapshots(version);
CREATE INDEX idx_policy_snapshots_created_at ON policy_snapshots(created_at DESC);

COMMENT ON TABLE policy_snapshots IS 'Immutable snapshots of classification policies per run';
COMMENT ON COLUMN policy_snapshots.version IS 'Policy version identifier (e.g., v1.0.0)';
COMMENT ON COLUMN policy_snapshots.policies IS 'Complete policy definition including classification rules and playbooks';
COMMENT ON COLUMN policy_snapshots.metadata IS 'Additional metadata about policy creation';

-- ========================================
-- Verdicts
-- ========================================

CREATE TABLE verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  policy_snapshot_id UUID REFERENCES policy_snapshots(id) ON DELETE RESTRICT,
  fingerprint_id VARCHAR(64) NOT NULL,
  error_class VARCHAR(100) NOT NULL,
  service VARCHAR(255) NOT NULL,
  confidence_score INTEGER NOT NULL,
  proposed_action VARCHAR(50) NOT NULL,
  tokens TEXT[] NOT NULL DEFAULT '{}',
  signals JSONB NOT NULL,
  playbook_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB,
  CONSTRAINT chk_confidence_score CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CONSTRAINT chk_proposed_action CHECK (proposed_action IN ('WAIT_AND_RETRY', 'OPEN_ISSUE', 'HUMAN_REQUIRED'))
);

CREATE INDEX idx_verdicts_execution_id ON verdicts(execution_id);
CREATE INDEX idx_verdicts_policy_snapshot_id ON verdicts(policy_snapshot_id);
CREATE INDEX idx_verdicts_fingerprint_id ON verdicts(fingerprint_id);
CREATE INDEX idx_verdicts_error_class ON verdicts(error_class);
CREATE INDEX idx_verdicts_confidence_score ON verdicts(confidence_score DESC);
CREATE INDEX idx_verdicts_created_at ON verdicts(created_at DESC);

COMMENT ON TABLE verdicts IS 'Immutable verdicts for workflow execution failures';
COMMENT ON COLUMN verdicts.execution_id IS 'Reference to workflow execution that generated this verdict';
COMMENT ON COLUMN verdicts.policy_snapshot_id IS 'Immutable reference to policy version used for this verdict';
COMMENT ON COLUMN verdicts.fingerprint_id IS 'Stable fingerprint for failure pattern';
COMMENT ON COLUMN verdicts.confidence_score IS 'Normalized confidence score (0-100): deterministic and comparable';
COMMENT ON COLUMN verdicts.proposed_action IS 'Recommended factory action';
COMMENT ON COLUMN verdicts.signals IS 'Raw failure signals that led to this verdict';
COMMENT ON COLUMN verdicts.playbook_id IS 'Reference to remediation playbook';

-- ========================================
-- Verdict Audit Log
-- ========================================

CREATE TABLE verdict_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verdict_id UUID REFERENCES verdicts(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255)
);

CREATE INDEX idx_verdict_audit_verdict_id ON verdict_audit_log(verdict_id);
CREATE INDEX idx_verdict_audit_event_type ON verdict_audit_log(event_type);
CREATE INDEX idx_verdict_audit_created_at ON verdict_audit_log(created_at DESC);

COMMENT ON TABLE verdict_audit_log IS 'Audit trail for verdict lifecycle events';
COMMENT ON COLUMN verdict_audit_log.event_type IS 'Type of audit event (e.g., created, reviewed, overridden)';
COMMENT ON COLUMN verdict_audit_log.created_by IS 'User or system that created the event';

-- ========================================
-- Initial Policy Snapshot
-- ========================================

-- Create initial policy snapshot with current classification rules
INSERT INTO policy_snapshots (version, policies, metadata) VALUES (
  'v1.0.0',
  '{
    "classification_rules": [
      {
        "errorClass": "ACM_DNS_VALIDATION_PENDING",
        "service": "ACM",
        "patterns": ["DNS validation.*pending", "Certificate.*validation.*not complete"],
        "confidence": 0.9,
        "tokens": ["ACM", "DNS", "validation", "pending"]
      },
      {
        "errorClass": "ROUTE53_DELEGATION_PENDING",
        "service": "Route53",
        "patterns": ["delegation.*pending", "NS.*records.*not.*configured"],
        "confidence": 0.9,
        "tokens": ["Route53", "delegation", "NS", "pending"]
      },
      {
        "errorClass": "CFN_ROLLBACK_LOCK",
        "service": "CloudFormation",
        "patterns": ["Stack.*is in.*ROLLBACK", "rollback.*in progress"],
        "confidence": 0.95,
        "tokens": ["CloudFormation", "ROLLBACK", "locked"]
      },
      {
        "errorClass": "CFN_IN_PROGRESS_LOCK",
        "service": "CloudFormation",
        "patterns": ["Stack.*is in.*IN_PROGRESS", "cannot.*update.*stack.*in progress"],
        "confidence": 0.95,
        "tokens": ["CloudFormation", "IN_PROGRESS", "locked"]
      },
      {
        "errorClass": "MISSING_SECRET",
        "service": "SecretsManager",
        "patterns": ["ResourceNotFoundException.*Secrets Manager", "secret.*not found"],
        "confidence": 0.85,
        "tokens": ["SecretsManager", "secret", "not found"]
      },
      {
        "errorClass": "MISSING_ENV_VAR",
        "service": "Configuration",
        "patterns": ["missing required configuration", "environment variable.*not set"],
        "confidence": 0.8,
        "tokens": ["configuration", "environment", "missing"]
      },
      {
        "errorClass": "DEPRECATED_CDK_API",
        "service": "CDK",
        "patterns": ["deprecated.*API", "method.*deprecated"],
        "confidence": 0.75,
        "tokens": ["CDK", "deprecated", "API"]
      },
      {
        "errorClass": "UNIT_MISMATCH",
        "service": "Configuration",
        "patterns": ["expected.*MB.*but got.*KB", "unit mismatch"],
        "confidence": 0.8,
        "tokens": ["unit", "mismatch", "configuration"]
      }
    ],
    "playbooks": {
      "ACM_DNS_VALIDATION_PENDING": "WAIT_AND_RETRY",
      "ROUTE53_DELEGATION_PENDING": "HUMAN_REQUIRED",
      "CFN_IN_PROGRESS_LOCK": "WAIT_AND_RETRY",
      "CFN_ROLLBACK_LOCK": "OPEN_ISSUE",
      "MISSING_SECRET": "OPEN_ISSUE",
      "MISSING_ENV_VAR": "OPEN_ISSUE",
      "DEPRECATED_CDK_API": "OPEN_ISSUE",
      "UNIT_MISMATCH": "OPEN_ISSUE"
    },
    "confidence_normalization": {
      "scale": "0-100",
      "formula": "raw_confidence * 100",
      "deterministic": true
    }
  }'::jsonb,
  '{
    "created_by": "AFU-9 Verdict Engine v1.1",
    "description": "Initial policy snapshot with classification rules and playbooks"
  }'::jsonb
);

-- ========================================
-- Views for Common Queries
-- ========================================

-- View for verdicts with policy information
CREATE VIEW verdicts_with_policy AS
SELECT 
  v.id,
  v.execution_id,
  v.fingerprint_id,
  v.error_class,
  v.service,
  v.confidence_score,
  v.proposed_action,
  v.tokens,
  v.playbook_id,
  v.created_at,
  ps.version as policy_version,
  ps.policies as policy_definition,
  we.workflow_id,
  we.status as execution_status,
  we.started_at as execution_started_at
FROM verdicts v
INNER JOIN policy_snapshots ps ON v.policy_snapshot_id = ps.id
INNER JOIN workflow_executions we ON v.execution_id = we.id;

COMMENT ON VIEW verdicts_with_policy IS 'Verdicts with policy and execution information for auditability';

-- View for verdict statistics
CREATE VIEW verdict_statistics AS
SELECT 
  error_class,
  service,
  COUNT(*) as total_count,
  AVG(confidence_score) as avg_confidence,
  MIN(confidence_score) as min_confidence,
  MAX(confidence_score) as max_confidence,
  mode() WITHIN GROUP (ORDER BY proposed_action) as most_common_action,
  COUNT(DISTINCT execution_id) as affected_executions
FROM verdicts
GROUP BY error_class, service;

COMMENT ON VIEW verdict_statistics IS 'Aggregated statistics for verdict analysis and KPIs';
