-- Migration 023: Add activated_by field to afu9_issues
-- Issue E61.2 (I612): Activate-Semantik (maxActive=1) atomar erzwingen
-- Tracks who activated the issue

-- ========================================
-- Add activated_by column
-- ========================================
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS activated_by VARCHAR(255);

-- ========================================
-- Comments
-- ========================================
COMMENT ON COLUMN afu9_issues.activated_by IS 'E61.2: User or system that activated the issue (set status to SPEC_READY)';
