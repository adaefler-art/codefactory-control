-- Migration 085: Loop Timeline Events (E9.1-CTRL-8)
-- 
-- Adds event tracking for Loop execution lifecycle:
-- - loop_events: Timeline events for loop runs with strict payload schema
--
-- Intent: Nach jedem Run ist nachvollziehbar, was passiert ist.
-- Events: loop_run_started, loop_run_finished, loop_step_s1_completed, 
--         loop_step_s2_spec_ready, loop_step_s3_implement_prep,
--         loop_run_blocked, loop_run_failed
-- Payload Allowlist: { runId, step, stateBefore, stateAfter, blockerCode?, requestId }

-- ========================================
-- Table: loop_events
-- ========================================

CREATE TABLE IF NOT EXISTS loop_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL,
  run_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'loop_run_started',
      'loop_run_finished',
      'loop_step_s1_completed',
      'loop_step_s2_spec_ready',
      'loop_step_s3_implement_prep',
      'loop_run_blocked',
      'loop_run_failed'
    )
  ),
  event_data JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Foreign key constraint
  CONSTRAINT fk_loop_events_run FOREIGN KEY (run_id) 
    REFERENCES loop_runs(id) ON DELETE CASCADE
);

-- ========================================
-- Indexes
-- ========================================

-- Query events by issue ID (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_loop_events_issue_id 
  ON loop_events(issue_id, occurred_at DESC);

-- Query events by run ID
CREATE INDEX IF NOT EXISTS idx_loop_events_run_id 
  ON loop_events(run_id, occurred_at);

-- Filter by event type
CREATE INDEX IF NOT EXISTS idx_loop_events_type 
  ON loop_events(event_type);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE loop_events IS 
  'Timeline events for loop execution lifecycle (E9.1-CTRL-8). Provides full traceability of loop runs.';

COMMENT ON COLUMN loop_events.id IS 
  'Unique event identifier (UUID)';

COMMENT ON COLUMN loop_events.issue_id IS 
  'Issue ID for which the loop was executed';

COMMENT ON COLUMN loop_events.run_id IS 
  'Loop run ID (references loop_runs.id)';

COMMENT ON COLUMN loop_events.event_type IS 
  'Event type: loop_run_started, loop_run_finished, loop_step_s1_completed, loop_step_s2_spec_ready, loop_step_s3_implement_prep, loop_run_blocked, loop_run_failed';

COMMENT ON COLUMN loop_events.event_data IS 
  'Event payload with allowlist: { runId, step, stateBefore, stateAfter?, blockerCode?, requestId }. No secrets allowed.';

COMMENT ON COLUMN loop_events.occurred_at IS 
  'Timestamp when the event occurred';

-- ========================================
-- Acceptance Criteria Verification
-- ========================================

-- Test: Events are queryable by issueId
-- SELECT * FROM loop_events WHERE issue_id = 'AFU9-123' ORDER BY occurred_at DESC;

-- Test: At least 2 events per run (started + finished/blocked/failed)
-- SELECT run_id, COUNT(*) as event_count 
-- FROM loop_events 
-- GROUP BY run_id 
-- HAVING COUNT(*) >= 2;

-- Test: No secrets in event_data (manual inspection required)
-- Payload allowlist enforced in application layer
