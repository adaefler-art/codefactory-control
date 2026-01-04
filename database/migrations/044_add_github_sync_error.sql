-- Migration 044: Add github_sync_error column
-- 
-- Adds error tracking for GitHub sync operations.
-- Used to store and display sync errors in the API without failing the entire sync.
--
-- Issue: Fix GitHub Mirror Status: Persist snapshot via REST fetch

-- ========================================
-- Add github_sync_error Column
-- ========================================

ALTER TABLE afu9_issues
  ADD COLUMN github_sync_error TEXT;

-- ========================================
-- Index for Error Tracking
-- ========================================

CREATE INDEX idx_afu9_issues_github_sync_error ON afu9_issues(github_sync_error) 
  WHERE github_sync_error IS NOT NULL;

-- ========================================
-- Comments
-- ========================================

COMMENT ON COLUMN afu9_issues.github_sync_error IS 'Last sync error message (null on success)';
