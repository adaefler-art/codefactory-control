-- Migration 089: Add REVIEW_READY Status for S4 Review Gate (E9.3-CTRL-01)
--
-- Adds REVIEW_READY status to afu9_issues table to support S4 review gate.
-- This implements the explicit review request gate where issues transition
-- from IMPLEMENTING_PREP to REVIEW_READY after explicit review request.
--
-- Intent: Enable fail-closed review gate with explicit review-intent recording.
-- No implicit entry into review state allowed.

-- ========================================
-- Step 1: Drop existing status constraint
-- ========================================

ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS chk_afu9_issue_status;

-- ========================================
-- Step 2: Add new constraint with REVIEW_READY and loop states
-- ========================================

-- Add new constraint with extended states including loop states (S1-S4)
-- and REVIEW_READY for S4 Review Gate
ALTER TABLE afu9_issues ADD CONSTRAINT chk_afu9_issue_status CHECK (status IN (
  'CREATED',
  'DRAFT_READY',
  'VERSION_COMMITTED',
  'CR_BOUND',
  'SPEC_READY',
  'PUBLISHING',
  'PUBLISHED',
  'IMPLEMENTING',
  'IMPLEMENTING_PREP',
  'REVIEW_READY',
  'VERIFIED',
  'MERGE_READY',
  'DONE',
  'HOLD',
  'KILLED'
));

-- ========================================
-- Step 3: Add comment documenting new status
-- ========================================

COMMENT ON CONSTRAINT chk_afu9_issue_status ON afu9_issues IS 
  'E9.3-CTRL-01: Enforces canonical state machine states including REVIEW_READY for S4 review gate';

-- ========================================
-- Step 4: Safety check
-- ========================================

-- Report any issues with status values not in the new set
DO $$
DECLARE
  unknown_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unknown_count
  FROM afu9_issues
  WHERE status NOT IN (
    'CREATED',
    'DRAFT_READY',
    'VERSION_COMMITTED',
    'CR_BOUND',
    'SPEC_READY',
    'PUBLISHING',
    'PUBLISHED',
    'IMPLEMENTING',
    'IMPLEMENTING_PREP',
    'REVIEW_READY',
    'VERIFIED',
    'MERGE_READY',
    'DONE',
    'HOLD',
    'KILLED'
  );
  
  IF unknown_count > 0 THEN
    RAISE NOTICE 'Warning: Found % issue(s) with status values not in canonical set. These need manual migration.', unknown_count;
  END IF;
END $$;

-- ========================================
-- Notes
-- ========================================

-- REVIEW_READY is the new status that S4 (Review Gate) transitions to.
-- Valid transition path:
--   IMPLEMENTING_PREP → [S4 Review Gate] → REVIEW_READY
--
-- This enforces explicit review request (fail-closed):
-- - No implicit entry into review state
-- - Review-intent event must be recorded
-- - S4 step executor validates preconditions
