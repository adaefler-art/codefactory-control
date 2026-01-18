-- Migration 080: Add canonical_id to afu9_issues
-- 
-- Implements AFU9-I-P1.4: Create canonical AFU-9 Issue on committed IssueDraft
-- 
-- Features:
-- 1. Add canonical_id column to afu9_issues table
-- 2. Add unique constraint for idempotent issue creation
-- 3. Add index for fast lookup by canonical_id

-- ========================================
-- Step 1: Add canonical_id column
-- ========================================

ALTER TABLE afu9_issues
  ADD COLUMN IF NOT EXISTS canonical_id VARCHAR(50);

-- ========================================
-- Step 2: Add unique constraint for idempotency
-- ========================================

-- Ensure only one AFU-9 Issue exists per canonical_id
-- This enables idempotent creation on commit
CREATE UNIQUE INDEX IF NOT EXISTS idx_afu9_issues_canonical_id_unique
  ON afu9_issues(canonical_id)
  WHERE canonical_id IS NOT NULL AND deleted_at IS NULL;

-- ========================================
-- Step 3: Add index for fast lookup
-- ========================================

CREATE INDEX IF NOT EXISTS idx_afu9_issues_canonical_id
  ON afu9_issues(canonical_id)
  WHERE canonical_id IS NOT NULL;

-- ========================================
-- Step 4: Comments
-- ========================================

COMMENT ON COLUMN afu9_issues.canonical_id IS 'Canonical ID from IssueDraft (e.g., I811, E81.1, CID:E81.1). Enables idempotent AFU-9 Issue creation on commit.';
