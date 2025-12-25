-- Migration 015: Extend AFU9 Issue Status Enum
-- Adds SPEC_READY, IMPLEMENTING, and FAILED statuses
-- Migrates existing ACTIVE issues to IMPLEMENTING

-- ========================================
-- Step 1: Drop old constraint
-- ========================================
ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS chk_afu9_issue_status;

-- ========================================
-- Step 2: Add new constraint with extended values
-- ========================================
ALTER TABLE afu9_issues ADD CONSTRAINT chk_afu9_issue_status CHECK (status IN (
  'CREATED',
  'SPEC_READY',
  'IMPLEMENTING',
  'ACTIVE',
  'BLOCKED',
  'DONE',
  'FAILED'
));

-- ========================================
-- Step 3: Migrate existing ACTIVE issues to IMPLEMENTING
-- ========================================
UPDATE afu9_issues 
SET status = 'IMPLEMENTING' 
WHERE status = 'ACTIVE';

-- ========================================
-- Comments
-- ========================================
COMMENT ON CONSTRAINT chk_afu9_issue_status ON afu9_issues IS 'Enforces valid status values: CREATED, SPEC_READY, IMPLEMENTING, ACTIVE, BLOCKED, DONE, FAILED';
