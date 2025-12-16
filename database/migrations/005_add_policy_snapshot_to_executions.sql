-- Add policy_snapshot_id to workflow_executions
-- This enables tracking which policy version was used for each execution
-- Implements Issue 2.1: Policy Snapshotting per Run

-- Add policy_snapshot_id column to workflow_executions
ALTER TABLE workflow_executions
ADD COLUMN policy_snapshot_id UUID REFERENCES policy_snapshots(id) ON DELETE SET NULL;

-- Create index for efficient policy snapshot lookups
CREATE INDEX idx_executions_policy_snapshot_id ON workflow_executions(policy_snapshot_id);

-- Add comment
COMMENT ON COLUMN workflow_executions.policy_snapshot_id IS 'Reference to immutable policy snapshot used for this execution (Issue 2.1: Policy Snapshotting per Run)';

-- Create view for executions with policy information
CREATE OR REPLACE VIEW executions_with_policy AS
SELECT 
  e.id,
  e.workflow_id,
  e.status,
  e.input,
  e.output,
  e.context,
  e.started_at,
  e.completed_at,
  e.error,
  e.triggered_by,
  e.github_run_id,
  e.created_at,
  e.updated_at,
  e.policy_snapshot_id,
  ps.version as policy_version,
  ps.policies as policy_definition,
  ps.created_at as policy_created_at
FROM workflow_executions e
LEFT JOIN policy_snapshots ps ON e.policy_snapshot_id = ps.id;

COMMENT ON VIEW executions_with_policy IS 'Workflow executions with policy snapshot information for auditability';
