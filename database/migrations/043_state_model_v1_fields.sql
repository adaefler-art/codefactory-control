-- Migration 043: State Model v1 Fields (I2)
-- 
-- Adds github_mirror_status column for State Model v1.
-- Completes the backend persistence layer for State Model v1.
--
-- Issue I2: Backend Persist + API Surface for State Model v1
-- 
-- Fields Added:
-- - github_mirror_status: Mapped GitHub status (enum)
--
-- Note: effective_status is computed server-side and NOT stored (per State Model v1 design)
-- Note: github_status_raw already exists from migration 041
-- Note: github_issue_last_sync_at already exists from migration 025

-- ========================================
-- Add State Model v1 Column
-- ========================================

ALTER TABLE afu9_issues
  ADD COLUMN github_mirror_status VARCHAR(50) CHECK (
    github_mirror_status IN ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'UNKNOWN')
  ) DEFAULT 'UNKNOWN';

-- ========================================
-- Index for GitHub Mirror Status
-- ========================================

CREATE INDEX idx_afu9_issues_github_mirror_status ON afu9_issues(github_mirror_status) 
  WHERE github_mirror_status IS NOT NULL;

-- ========================================
-- Comments
-- ========================================

COMMENT ON COLUMN afu9_issues.github_mirror_status IS 'Mapped GitHub status: TODO, IN_PROGRESS, IN_REVIEW, DONE, BLOCKED, or UNKNOWN (State Model v1)';
