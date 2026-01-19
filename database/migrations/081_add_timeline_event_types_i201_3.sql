-- Migration 081: Add Timeline Event Types for I201.3
-- 
-- I201.3: Timeline API + Minimal Event Contract (append-only)
-- 
-- Adds new event types to issue_timeline table:
-- - RUN_STARTED: When a run is started for an issue
-- - VERDICT_SET: When a verdict is set for a run
-- - STATE_CHANGED: Explicit state change event (complement to STATE_TRANSITION)
-- - EVIDENCE_LINKED: When evidence is linked to an issue (optional)

-- ========================================
-- Step 1: Drop existing constraint
-- ========================================

ALTER TABLE issue_timeline DROP CONSTRAINT IF EXISTS chk_issue_timeline_event_type;

-- ========================================
-- Step 2: Add new constraint with extended event types
-- ========================================

ALTER TABLE issue_timeline ADD CONSTRAINT chk_issue_timeline_event_type CHECK (event_type IN (
  'ISSUE_CREATED',
  'DRAFT_COMMITTED',
  'CR_BOUND',
  'CR_UNBOUND',
  'PUBLISHING_STARTED',
  'PUBLISHED',
  'PUBLISH_FAILED',
  'GITHUB_MIRRORED',
  'CP_ASSIGNED',
  'CP_UNASSIGNED',
  'STATE_TRANSITION',
  'STATE_CHANGED',
  'FIELD_UPDATED',
  'ERROR_OCCURRED',
  'RUN_STARTED',
  'VERDICT_SET',
  'EVIDENCE_LINKED'
));

-- ========================================
-- Step 3: Add comments
-- ========================================

COMMENT ON CONSTRAINT chk_issue_timeline_event_type ON issue_timeline IS 'I201.3: Extended event types for minimal timeline contract';
