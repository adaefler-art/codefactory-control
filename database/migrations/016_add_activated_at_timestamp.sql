-- Migration 016: Add activated_at timestamp to afu9_issues
-- Tracks when an issue was last activated (set to IMPLEMENTING status)
-- Updates single-active constraint to check IMPLEMENTING status

-- ========================================
-- Add activated_at column
-- ========================================
ALTER TABLE afu9_issues ADD COLUMN activated_at TIMESTAMP;

-- ========================================
-- Update single-active enforcement to check IMPLEMENTING
-- ========================================
DROP TRIGGER IF EXISTS trg_enforce_single_active_issue ON afu9_issues;
DROP FUNCTION IF EXISTS enforce_single_active_issue();

CREATE OR REPLACE FUNCTION enforce_single_active_issue()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  -- Check if the new/updated status is IMPLEMENTING (new active status)
  IF NEW.status = 'IMPLEMENTING' THEN
    -- Count other IMPLEMENTING issues (excluding this one)
    SELECT COUNT(*) INTO active_count
    FROM afu9_issues
    WHERE status = 'IMPLEMENTING' 
      AND id != NEW.id;
    
    -- Raise error if another IMPLEMENTING issue exists
    IF active_count > 0 THEN
      RAISE EXCEPTION 'Single-Active constraint violation: Only one issue can have status=IMPLEMENTING. Found % other implementing issue(s). Current implementing issues: %',
        active_count,
        (SELECT array_agg(id::text || ':' || COALESCE(title, '<no title>')) FROM afu9_issues WHERE status = 'IMPLEMENTING' AND id != NEW.id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_single_active_issue
  BEFORE INSERT OR UPDATE OF status ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_active_issue();

-- ========================================
-- Comments
-- ========================================
COMMENT ON COLUMN afu9_issues.activated_at IS 'Timestamp when the issue status was last changed to IMPLEMENTING (i.e., when the issue was activated for work)';
COMMENT ON TRIGGER trg_enforce_single_active_issue ON afu9_issues IS 'Ensures only one issue can have status=IMPLEMENTING at a time (Single-Issue-Mode)';

