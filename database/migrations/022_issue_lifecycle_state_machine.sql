-- Migration 022: Issue Lifecycle State Machine & Events Ledger
-- Implements canonical state machine with deterministic transitions
-- Issue E61.1 (I611)

-- ========================================
-- Step 1: Update status constraint to match canonical states
-- ========================================

-- Drop old constraint
ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS chk_afu9_issue_status;

-- Add new constraint with canonical states
ALTER TABLE afu9_issues ADD CONSTRAINT chk_afu9_issue_status CHECK (status IN (
  'CREATED',
  'SPEC_READY',
  'IMPLEMENTING',
  'VERIFIED',
  'MERGE_READY',
  'DONE',
  'HOLD',
  'KILLED'
));

-- ========================================
-- Step 2: Migrate existing status values to canonical states
-- ========================================

-- Map ACTIVE → IMPLEMENTING (already done in migration 015, but ensure consistency)
UPDATE afu9_issues SET status = 'IMPLEMENTING' WHERE status = 'ACTIVE';

-- Map BLOCKED → HOLD (blocked issues go on hold)
UPDATE afu9_issues SET status = 'HOLD' WHERE status = 'BLOCKED';

-- Map FAILED → KILLED (failed issues are terminated)
UPDATE afu9_issues SET status = 'KILLED' WHERE status = 'FAILED';

-- ========================================
-- Step 3: Refactor issue_events table to match spec
-- ========================================

-- Rename columns to match spec
ALTER TABLE afu9_issue_events RENAME COLUMN created_at TO at;
ALTER TABLE afu9_issue_events RENAME COLUMN created_by TO actor;
ALTER TABLE afu9_issue_events RENAME COLUMN event_type TO type;
ALTER TABLE afu9_issue_events RENAME COLUMN old_status TO from_status;
ALTER TABLE afu9_issue_events RENAME COLUMN new_status TO to_status;
ALTER TABLE afu9_issue_events RENAME COLUMN event_data TO payload_json;

-- Drop columns not in spec (handoff state tracking - not part of lifecycle state machine)
ALTER TABLE afu9_issue_events DROP COLUMN IF EXISTS old_handoff_state;
ALTER TABLE afu9_issue_events DROP COLUMN IF EXISTS new_handoff_state;

-- Update constraint to reflect canonical event types
ALTER TABLE afu9_issue_events DROP CONSTRAINT IF EXISTS chk_afu9_event_type;
ALTER TABLE afu9_issue_events ADD CONSTRAINT chk_afu9_event_type CHECK (type IN (
  'CREATED',
  'STATUS_CHANGED',
  'FIELD_UPDATED',
  'GITHUB_SYNCED',
  'ERROR_OCCURRED',
  'TRANSITION'
));

-- ========================================
-- Step 4: Update trigger to use new column names
-- ========================================

-- Drop old trigger
DROP TRIGGER IF EXISTS trg_log_afu9_issue_event ON afu9_issues;

-- Recreate trigger function with new column names
CREATE OR REPLACE FUNCTION log_afu9_issue_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT (creation)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO afu9_issue_events (
      issue_id,
      type,
      payload_json,
      to_status,
      actor
    ) VALUES (
      NEW.id,
      'CREATED',
      jsonb_build_object(
        'title', NEW.title,
        'priority', NEW.priority,
        'assignee', NEW.assignee
      ),
      NEW.status,
      'system'
    );
    RETURN NEW;
  END IF;
  
  -- Handle UPDATE - status changes
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        type,
        from_status,
        to_status,
        actor
      ) VALUES (
        NEW.id,
        'STATUS_CHANGED',
        OLD.status,
        NEW.status,
        'system'
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER trg_log_afu9_issue_event
  AFTER INSERT OR UPDATE ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION log_afu9_issue_event();

-- ========================================
-- Step 5: Update indexes
-- ========================================

-- Drop old indexes
DROP INDEX IF EXISTS idx_afu9_issue_events_created_at;
DROP INDEX IF EXISTS idx_afu9_issue_events_event_type;
DROP INDEX IF EXISTS idx_afu9_issue_events_issue_id_created_at;

-- Create new indexes with updated column names
CREATE INDEX idx_afu9_issue_events_at ON afu9_issue_events(at DESC);
CREATE INDEX idx_afu9_issue_events_type ON afu9_issue_events(type);
CREATE INDEX idx_afu9_issue_events_issue_id_at ON afu9_issue_events(issue_id, at DESC);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE afu9_issue_events IS 'E61.1: Issue lifecycle events ledger for deterministic state transitions';
COMMENT ON COLUMN afu9_issue_events.at IS 'Event timestamp';
COMMENT ON COLUMN afu9_issue_events.actor IS 'Who/what triggered the event (user, system, etc.)';
COMMENT ON COLUMN afu9_issue_events.type IS 'Event type (CREATED, STATUS_CHANGED, TRANSITION, etc.)';
COMMENT ON COLUMN afu9_issue_events.from_status IS 'Previous status (for transitions)';
COMMENT ON COLUMN afu9_issue_events.to_status IS 'New status (for transitions)';
COMMENT ON COLUMN afu9_issue_events.payload_json IS 'Event metadata and context';

COMMENT ON CONSTRAINT chk_afu9_issue_status ON afu9_issues IS 'E61.1: Enforces canonical state machine states';
COMMENT ON TRIGGER trg_log_afu9_issue_event ON afu9_issues IS 'E61.1: Automatically logs lifecycle events with canonical column names';
