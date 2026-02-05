-- Migration 091: Issue Closures and Remediation Records (E9.3-CTRL-07)
-- 
-- Creates tables for S8 (Close) and S9 (Remediate):
-- - issue_closures: Immutable closure records for VERIFIED → CLOSED transitions
-- - remediation_records: Explicit remediation tracking for HOLD state
--
-- Guarantees:
-- - Immutable closures: CLOSED state is terminal, cannot be modified
-- - Explicit remediation: All HOLD transitions require reason
-- - Full audit trail: Complete tracking of closures and remediations
-- - Fail-closed semantics: No silent state changes

-- ========================================
-- Step 1: Update afu9_issues status constraint to include CLOSED
-- ========================================

-- Drop old constraint
ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS chk_afu9_issue_status;

-- Add new constraint with CLOSED state
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
  'CLOSED',
  'KILLED'
));

-- ========================================
-- Step 2: Create issue_closures table (S8)
-- ========================================

CREATE TABLE IF NOT EXISTS issue_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_verdict_id UUID REFERENCES verification_verdicts(id) ON DELETE RESTRICT,
  closure_reason TEXT NOT NULL DEFAULT 'VERIFIED_SUCCESS',
  
  -- Immutability: One closure per issue (prevents re-closure)
  CONSTRAINT issue_closures_unique_issue UNIQUE(issue_id)
);

-- Index for querying closures by issue
CREATE INDEX idx_issue_closures_issue_id ON issue_closures(issue_id);

-- Index for querying closures by run
CREATE INDEX idx_issue_closures_run_id ON issue_closures(run_id);

-- Index for querying closures by verdict
CREATE INDEX idx_issue_closures_verification_verdict_id 
  ON issue_closures(verification_verdict_id) 
  WHERE verification_verdict_id IS NOT NULL;

-- Index for querying recent closures
CREATE INDEX idx_issue_closures_closed_at ON issue_closures(closed_at DESC);

-- ========================================
-- Step 3: Create remediation_records table (S9)
-- ========================================

CREATE TABLE IF NOT EXISTS remediation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  run_id UUID REFERENCES loop_runs(id) ON DELETE SET NULL,
  remediation_reason TEXT NOT NULL,
  failed_step TEXT,
  blocker_code TEXT,
  red_verdict BOOLEAN DEFAULT FALSE,
  failed_checks TEXT[] DEFAULT '{}',
  remediation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (remediation_status IN ('pending', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  -- Composite index for querying by issue and creation time
  -- Note: No UNIQUE constraint - multiple remediation attempts allowed
  CONSTRAINT remediation_records_created_at_check CHECK (created_at IS NOT NULL)
);

-- Index for querying remediation records by issue
CREATE INDEX idx_remediation_records_issue_id ON remediation_records(issue_id, created_at DESC);

-- Index for querying by run
CREATE INDEX idx_remediation_records_run_id 
  ON remediation_records(run_id) 
  WHERE run_id IS NOT NULL;

-- Index for querying by status
CREATE INDEX idx_remediation_records_status ON remediation_records(remediation_status);

-- Index for querying pending remediations
CREATE INDEX idx_remediation_records_pending 
  ON remediation_records(created_at DESC) 
  WHERE remediation_status = 'pending';

-- Index for querying by blocker code
CREATE INDEX idx_remediation_records_blocker_code 
  ON remediation_records(blocker_code) 
  WHERE blocker_code IS NOT NULL;

-- ========================================
-- Step 4: Add helper functions
-- ========================================

-- Function to close an issue (S8)
CREATE OR REPLACE FUNCTION close_issue(
  p_issue_id UUID,
  p_run_id UUID,
  p_verification_verdict_id UUID DEFAULT NULL,
  p_closure_reason TEXT DEFAULT 'VERIFIED_SUCCESS'
)
RETURNS UUID AS $$
DECLARE
  v_closure_id UUID;
  v_current_status TEXT;
BEGIN
  -- Check current status
  SELECT status INTO v_current_status FROM afu9_issues WHERE id = p_issue_id;
  
  -- Verify issue is in VERIFIED state
  IF v_current_status != 'VERIFIED' THEN
    RAISE EXCEPTION 'Issue must be in VERIFIED state to close (current: %)', v_current_status;
  END IF;
  
  -- Create closure record
  INSERT INTO issue_closures (
    issue_id,
    run_id,
    verification_verdict_id,
    closure_reason
  ) VALUES (
    p_issue_id,
    p_run_id,
    p_verification_verdict_id,
    p_closure_reason
  )
  ON CONFLICT (issue_id) DO NOTHING
  RETURNING id INTO v_closure_id;
  
  -- Update issue status to CLOSED
  IF v_closure_id IS NOT NULL THEN
    UPDATE afu9_issues 
    SET status = 'CLOSED', updated_at = NOW() 
    WHERE id = p_issue_id;
  END IF;
  
  RETURN v_closure_id;
END;
$$ LANGUAGE plpgsql;

-- Function to record remediation (S9)
CREATE OR REPLACE FUNCTION record_remediation(
  p_issue_id UUID,
  p_remediation_reason TEXT,
  p_run_id UUID DEFAULT NULL,
  p_failed_step TEXT DEFAULT NULL,
  p_blocker_code TEXT DEFAULT NULL,
  p_red_verdict BOOLEAN DEFAULT FALSE,
  p_failed_checks TEXT[] DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_remediation_id UUID;
  v_current_status TEXT;
BEGIN
  -- Check current status
  SELECT status INTO v_current_status FROM afu9_issues WHERE id = p_issue_id;
  
  -- Verify issue is not already CLOSED (immutable)
  IF v_current_status = 'CLOSED' THEN
    RAISE EXCEPTION 'Cannot remediate CLOSED issue (immutable)';
  END IF;
  
  -- Create remediation record
  INSERT INTO remediation_records (
    issue_id,
    run_id,
    remediation_reason,
    failed_step,
    blocker_code,
    red_verdict,
    failed_checks
  ) VALUES (
    p_issue_id,
    p_run_id,
    p_remediation_reason,
    p_failed_step,
    p_blocker_code,
    p_red_verdict,
    p_failed_checks
  )
  RETURNING id INTO v_remediation_id;
  
  -- Update issue status to HOLD if not already
  IF v_current_status != 'HOLD' THEN
    UPDATE afu9_issues 
    SET status = 'HOLD', updated_at = NOW() 
    WHERE id = p_issue_id;
  END IF;
  
  RETURN v_remediation_id;
END;
$$ LANGUAGE plpgsql;

-- Function to resolve remediation
CREATE OR REPLACE FUNCTION resolve_remediation(
  p_remediation_id UUID,
  p_resolution_notes TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE remediation_records
  SET 
    remediation_status = 'resolved',
    resolved_at = NOW(),
    resolution_notes = p_resolution_notes
  WHERE id = p_remediation_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Step 5: Create helper views
-- ========================================

-- View: Recently closed issues
CREATE OR REPLACE VIEW recently_closed_issues AS
SELECT 
  i.id,
  i.title,
  i.status,
  i.github_url,
  c.id as closure_id,
  c.closed_at,
  c.verification_verdict_id,
  c.closure_reason
FROM afu9_issues i
INNER JOIN issue_closures c ON i.id = c.issue_id
WHERE i.status = 'CLOSED'
  AND i.deleted_at IS NULL
ORDER BY c.closed_at DESC;

-- View: Issues pending remediation
CREATE OR REPLACE VIEW issues_pending_remediation AS
SELECT 
  i.id,
  i.title,
  i.status,
  i.github_url,
  r.id as remediation_id,
  r.remediation_reason,
  r.failed_step,
  r.blocker_code,
  r.created_at as held_at
FROM afu9_issues i
INNER JOIN remediation_records r ON i.id = r.issue_id
WHERE i.status = 'HOLD'
  AND r.remediation_status = 'pending'
  AND i.deleted_at IS NULL
ORDER BY r.created_at ASC;

-- View: Remediation history by issue
CREATE OR REPLACE VIEW remediation_history AS
SELECT 
  i.id as issue_id,
  i.title,
  i.status,
  r.id as remediation_id,
  r.remediation_reason,
  r.failed_step,
  r.blocker_code,
  r.remediation_status,
  r.created_at,
  r.resolved_at,
  r.resolution_notes
FROM afu9_issues i
LEFT JOIN remediation_records r ON i.id = r.issue_id
WHERE i.deleted_at IS NULL
ORDER BY i.id, r.created_at DESC;

-- ========================================
-- Step 6: Add comments
-- ========================================

COMMENT ON TABLE issue_closures IS 'E9.3-CTRL-07: Immutable closure records for S8 (Close) step';
COMMENT ON TABLE remediation_records IS 'E9.3-CTRL-07: Explicit remediation tracking for S9 (Remediate) step';

COMMENT ON COLUMN issue_closures.issue_id IS 'Issue that was closed (immutable)';
COMMENT ON COLUMN issue_closures.verification_verdict_id IS 'Link to S7 GREEN verdict that enabled closure';
COMMENT ON COLUMN issue_closures.closure_reason IS 'Reason for closure (default: VERIFIED_SUCCESS)';

COMMENT ON COLUMN remediation_records.remediation_reason IS 'Explicit reason for placing issue on HOLD';
COMMENT ON COLUMN remediation_records.failed_step IS 'Which step failed (e.g., S7_VERIFY_GATE)';
COMMENT ON COLUMN remediation_records.blocker_code IS 'Blocker code that caused HOLD';
COMMENT ON COLUMN remediation_records.red_verdict IS 'True if HOLD was due to S7 RED verdict';
COMMENT ON COLUMN remediation_records.failed_checks IS 'Specific checks that failed';
COMMENT ON COLUMN remediation_records.remediation_status IS 'Status: pending, in_progress, or resolved';

COMMENT ON FUNCTION close_issue IS 'E9.3-CTRL-07: S8 Close - Transition VERIFIED issue to CLOSED (immutable)';
COMMENT ON FUNCTION record_remediation IS 'E9.3-CTRL-07: S9 Remediate - Place issue on HOLD with explicit reason';
COMMENT ON FUNCTION resolve_remediation IS 'E9.3-CTRL-07: Mark remediation as resolved';
