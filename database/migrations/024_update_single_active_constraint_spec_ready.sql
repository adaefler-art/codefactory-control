-- Migration 024: Update single-active constraint to enforce SPEC_READY
-- Issue E61.2 (I612): Activate-Semantik (maxActive=1) atomar erzwingen
-- Changes active status from IMPLEMENTING to SPEC_READY

-- ========================================
-- Update single-active enforcement to check SPEC_READY
-- ========================================
DROP TRIGGER IF EXISTS trg_enforce_single_active_issue ON afu9_issues;
DROP FUNCTION IF EXISTS enforce_single_active_issue();

CREATE OR REPLACE FUNCTION enforce_single_active_issue()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  -- E61.2: Check if the new/updated status is SPEC_READY (active status)
  IF NEW.status = 'SPEC_READY' THEN
    -- Count other SPEC_READY issues (excluding this one)
    SELECT COUNT(*) INTO active_count
    FROM afu9_issues
    WHERE status = 'SPEC_READY' 
      AND id != NEW.id;
    
    -- Raise error if another SPEC_READY issue exists
    IF active_count > 0 THEN
      RAISE EXCEPTION 'Single-Active constraint violation: Only one issue can have status=SPEC_READY. Found % other active issue(s). Current active issues: %',
        active_count,
        (SELECT array_agg(id::text || ':' || COALESCE(title, '<no title>')) FROM afu9_issues WHERE status = 'SPEC_READY' AND id != NEW.id);
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
COMMENT ON TRIGGER trg_enforce_single_active_issue ON afu9_issues IS 'E61.2: Ensures only one issue can have status=SPEC_READY at a time (Single-Active constraint)';
