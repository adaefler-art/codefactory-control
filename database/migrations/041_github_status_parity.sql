-- Migration 041: GitHub Status Parity (E7_extra)
-- 
-- Adds columns to track GitHub project/label status and sync it to AFU9 canonical status.
-- This enables AFU9 to be "issue-state aware" and react to GitHub status changes.
--
-- Problem: AFU9 only shows Handoff State = SYNCED, but doesn't track GitHub Project Status.
-- Solution: Pull GitHub Status (Project v2 field or labels) and map to AFU9 canonical status.

-- ========================================
-- Add GitHub Status Tracking Columns
-- ========================================

ALTER TABLE afu9_issues
  ADD COLUMN github_status_raw VARCHAR(100),
  ADD COLUMN github_status_updated_at TIMESTAMPTZ,
  ADD COLUMN status_source VARCHAR(20) CHECK (status_source IN ('manual', 'github_project', 'github_label', 'github_state'));

-- ========================================
-- Indexes for GitHub Status Columns
-- ========================================

-- Index for querying by status source
CREATE INDEX idx_afu9_issues_status_source ON afu9_issues(status_source) 
  WHERE status_source IS NOT NULL;

-- Index for querying by GitHub status update time
CREATE INDEX idx_afu9_issues_github_status_updated_at ON afu9_issues(github_status_updated_at DESC) 
  WHERE github_status_updated_at IS NOT NULL;

-- ========================================
-- Comments
-- ========================================

COMMENT ON COLUMN afu9_issues.github_status_raw IS 'Raw GitHub status value (from Project v2 field, label, or state)';
COMMENT ON COLUMN afu9_issues.github_status_updated_at IS 'When the GitHub status was last fetched and updated';
COMMENT ON COLUMN afu9_issues.status_source IS 'Source of the current AFU9 status: manual, github_project, github_label, or github_state';
