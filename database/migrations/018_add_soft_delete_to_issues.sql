-- Migration 018: Add soft delete support to AFU9 issues
-- Adds deleted_at column for soft delete functionality

-- Add deleted_at column to afu9_issues table
ALTER TABLE afu9_issues
ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;

-- Add index on deleted_at for filtering deleted issues
CREATE INDEX idx_afu9_issues_deleted_at ON afu9_issues(deleted_at) WHERE deleted_at IS NOT NULL;

-- Update afu9_active_issues view to exclude deleted issues
CREATE OR REPLACE VIEW afu9_active_issues AS
SELECT 
  id,
  title,
  status,
  priority,
  assignee,
  handoff_state,
  github_issue_number,
  github_url,
  created_at,
  updated_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as hours_since_creation,
  EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 as hours_since_update
FROM afu9_issues
WHERE status IN ('CREATED', 'ACTIVE', 'BLOCKED')
  AND deleted_at IS NULL  -- Exclude soft-deleted issues
ORDER BY 
  CASE status
    WHEN 'ACTIVE' THEN 1
    WHEN 'BLOCKED' THEN 2
    WHEN 'CREATED' THEN 3
  END,
  priority NULLS LAST,
  created_at ASC;

-- Update afu9_pending_handoff view to exclude deleted issues
CREATE OR REPLACE VIEW afu9_pending_handoff AS
SELECT 
  id,
  title,
  status,
  handoff_state,
  last_error,
  created_at,
  updated_at
FROM afu9_issues
WHERE handoff_state IN ('NOT_SENT', 'FAILED')
  AND status != 'DONE'
  AND deleted_at IS NULL  -- Exclude soft-deleted issues
ORDER BY 
  CASE handoff_state
    WHEN 'FAILED' THEN 1
    WHEN 'NOT_SENT' THEN 2
  END,
  created_at ASC;

-- Update afu9_issue_stats view to exclude deleted issues
CREATE OR REPLACE VIEW afu9_issue_stats AS
SELECT 
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN handoff_state = 'SYNCED' THEN 1 END) as synced_to_github,
  COUNT(CASE WHEN handoff_state = 'FAILED' THEN 1 END) as failed_handoff,
  AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600) as avg_age_hours
FROM afu9_issues
WHERE deleted_at IS NULL  -- Exclude soft-deleted issues
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'ACTIVE' THEN 1
    WHEN 'CREATED' THEN 2
    WHEN 'BLOCKED' THEN 3
    WHEN 'DONE' THEN 4
  END;

-- Add comment for documentation
COMMENT ON COLUMN afu9_issues.deleted_at IS 'Soft delete timestamp. NULL means not deleted, timestamp means soft-deleted.';
