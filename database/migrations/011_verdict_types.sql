-- Migration 011: Add Verdict Types to Verdict Engine
-- EPIC B: Verdict Engine & Decision Authority
-- Date: 2025-12-20
-- 
-- This migration adds the verdict_type column to the verdicts table
-- to support canonical verdict types for decision authority.

-- ========================================
-- Add verdict_type column to verdicts table
-- ========================================

ALTER TABLE verdicts 
  ADD COLUMN verdict_type VARCHAR(50) NOT NULL DEFAULT 'PENDING';

COMMENT ON COLUMN verdicts.verdict_type IS 'Canonical verdict type representing overall decision outcome (APPROVED, REJECTED, DEFERRED, ESCALATED, WARNING, BLOCKED, PENDING)';

-- Add check constraint for valid verdict types
ALTER TABLE verdicts 
  ADD CONSTRAINT chk_verdict_type 
  CHECK (verdict_type IN (
    'APPROVED',
    'REJECTED', 
    'DEFERRED',
    'ESCALATED',
    'WARNING',
    'BLOCKED',
    'PENDING'
  ));

-- Create index for verdict_type queries
CREATE INDEX idx_verdicts_verdict_type ON verdicts(verdict_type);

-- ========================================
-- Update existing verdicts with verdict types
-- ========================================

-- Set verdict types based on error class and proposed action
-- Special case: CloudFormation locks are BLOCKED
UPDATE verdicts 
SET verdict_type = 'BLOCKED' 
WHERE error_class IN ('CFN_IN_PROGRESS_LOCK', 'CFN_ROLLBACK_LOCK');

-- Special case: Deprecated APIs are WARNING
UPDATE verdicts 
SET verdict_type = 'WARNING' 
WHERE error_class = 'DEPRECATED_CDK_API';

-- Low confidence verdicts are ESCALATED
UPDATE verdicts 
SET verdict_type = 'ESCALATED' 
WHERE confidence_score < 60 
  AND verdict_type = 'PENDING';

-- Map based on proposed action
UPDATE verdicts 
SET verdict_type = 'DEFERRED' 
WHERE proposed_action = 'WAIT_AND_RETRY' 
  AND verdict_type = 'PENDING';

UPDATE verdicts 
SET verdict_type = 'REJECTED' 
WHERE proposed_action = 'OPEN_ISSUE' 
  AND verdict_type = 'PENDING';

UPDATE verdicts 
SET verdict_type = 'ESCALATED' 
WHERE proposed_action = 'HUMAN_REQUIRED' 
  AND verdict_type = 'PENDING';

-- ========================================
-- Update verdicts_with_policy view
-- ========================================

-- Drop and recreate view with verdict_type
DROP VIEW IF EXISTS verdicts_with_policy;

CREATE VIEW verdicts_with_policy AS
SELECT 
  v.id,
  v.execution_id,
  v.fingerprint_id,
  v.error_class,
  v.service,
  v.confidence_score,
  v.proposed_action,
  v.verdict_type,
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

COMMENT ON VIEW verdicts_with_policy IS 'Verdicts with policy and execution information for auditability, including verdict types';

-- ========================================
-- Update verdict_statistics view
-- ========================================

-- Drop and recreate view with verdict_type statistics
DROP VIEW IF EXISTS verdict_statistics;

CREATE VIEW verdict_statistics AS
SELECT 
  error_class,
  service,
  verdict_type,
  COUNT(*) as total_count,
  AVG(confidence_score) as avg_confidence,
  MIN(confidence_score) as min_confidence,
  MAX(confidence_score) as max_confidence,
  mode() WITHIN GROUP (ORDER BY proposed_action) as most_common_action,
  COUNT(DISTINCT execution_id) as affected_executions
FROM verdicts
GROUP BY error_class, service, verdict_type;

COMMENT ON VIEW verdict_statistics IS 'Aggregated statistics for verdict analysis and KPIs, grouped by verdict type';

-- ========================================
-- Create new view for verdict type summary
-- ========================================

CREATE VIEW verdict_type_summary AS
SELECT 
  verdict_type,
  COUNT(*) as total_count,
  AVG(confidence_score) as avg_confidence,
  COUNT(DISTINCT error_class) as distinct_error_classes,
  COUNT(DISTINCT service) as distinct_services,
  COUNT(DISTINCT execution_id) as affected_executions,
  MIN(created_at) as first_seen,
  MAX(created_at) as last_seen
FROM verdicts
GROUP BY verdict_type
ORDER BY total_count DESC;

COMMENT ON VIEW verdict_type_summary IS 'Summary statistics grouped by verdict type for KPI reporting and dashboards';

-- ========================================
-- Migration Complete
-- ========================================

-- Verify migration
DO $$
DECLARE
  verdict_count INTEGER;
  pending_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO verdict_count FROM verdicts;
  SELECT COUNT(*) INTO pending_count FROM verdicts WHERE verdict_type = 'PENDING';
  
  RAISE NOTICE 'Migration 011 complete:';
  RAISE NOTICE '- Total verdicts: %', verdict_count;
  RAISE NOTICE '- Pending verdicts: %', pending_count;
  RAISE NOTICE '- verdict_type column added with constraint';
  RAISE NOTICE '- Index created on verdict_type';
  RAISE NOTICE '- Views updated to include verdict_type';
END $$;
