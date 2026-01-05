-- Migration 049: Fix github_mirror_status CHECK Constraint (Issue #5)
-- 
-- Fixes persistence issue where github_mirror_status values 'OPEN', 'CLOSED', and 'ERROR'
-- are rejected by the database CHECK constraint.
--
-- Problem: Migration 043 added github_mirror_status with CHECK constraint that only allows:
--   'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'UNKNOWN'
-- But the sync code (route.ts:470) sets 'OPEN' or 'CLOSED' based on GitHub issue state,
-- and 'ERROR' when fetch fails.
--
-- Solution: Drop and recreate the CHECK constraint to include all valid values from
-- the Afu9GithubMirrorStatus TypeScript enum:
--   'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'OPEN', 'CLOSED', 'ERROR', 'UNKNOWN'
--
-- This migration is idempotent and can be safely re-run.

-- ========================================
-- Drop the old CHECK constraint
-- ========================================

-- Drop the existing constraint (if it exists)
ALTER TABLE afu9_issues
  DROP CONSTRAINT IF EXISTS afu9_issues_github_mirror_status_check;

-- ========================================
-- Add the updated CHECK constraint
-- ========================================

-- Add the constraint with all valid enum values
ALTER TABLE afu9_issues
  ADD CONSTRAINT afu9_issues_github_mirror_status_check CHECK (
    github_mirror_status IN (
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
      'BLOCKED',
      'OPEN',
      'CLOSED',
      'ERROR',
      'UNKNOWN'
    )
  );

-- ========================================
-- Update comment for clarity
-- ========================================

COMMENT ON COLUMN afu9_issues.github_mirror_status IS 'Mapped GitHub status: TODO, IN_PROGRESS, IN_REVIEW, DONE, BLOCKED, OPEN, CLOSED, ERROR, or UNKNOWN (State Model v1)';
