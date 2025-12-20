-- Issue B4: Add support for workflow pause/resume (HOLD enforcement)
-- 
-- This migration adds:
-- 1. 'paused' status to workflow executions
-- 2. pause_metadata JSONB column for tracking pause/resume information
-- 
-- HOLD enforcement: When an issue enters HOLD state, workflows must pause
-- and can only be resumed by explicit human action (no automatic timeout).

-- Add 'paused' status to workflow_executions constraint
ALTER TABLE workflow_executions 
  DROP CONSTRAINT IF EXISTS chk_execution_status;

ALTER TABLE workflow_executions 
  ADD CONSTRAINT chk_execution_status 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'paused'));

-- Add pause_metadata column to track pause/resume information
ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS pause_metadata JSONB;

-- Create index on paused workflows for efficient querying
CREATE INDEX IF NOT EXISTS idx_executions_paused 
  ON workflow_executions(status) 
  WHERE status = 'paused';

-- Add comment documenting the pause metadata structure
COMMENT ON COLUMN workflow_executions.pause_metadata IS 
'Issue B4: HOLD enforcement metadata
Structure: {
  "pausedAt": "ISO 8601 timestamp",
  "pausedBy": "user_id or system",
  "reason": "HOLD state triggered",
  "resumedAt": "ISO 8601 timestamp (optional)",
  "resumedBy": "user_id (optional)",
  "pausedAtStepIndex": integer (optional)
}';
