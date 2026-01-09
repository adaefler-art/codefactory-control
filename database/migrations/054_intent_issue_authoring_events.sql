-- Migration 054: INTENT Issue Authoring Evidence Events
-- Issue E81.5: Evidence Pack for Issue Authoring (inputs, outputs, hashes, lawbookVersion)
-- Creates append-only audit table for INTENT issue authoring operations

-- ========================================
-- INTENT Issue Authoring Events (Append-Only)
-- ========================================
CREATE TABLE intent_issue_authoring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  session_id UUID REFERENCES intent_sessions(id) ON DELETE CASCADE,
  sub TEXT NOT NULL,
  action TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  lawbook_version TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  params_json JSONB,
  result_json JSONB,
  CONSTRAINT chk_intent_authoring_action CHECK (
    action IN ('draft_save', 'draft_validate', 'draft_commit', 'issue_set_generate', 'issue_set_export')
  )
);

-- Indexes for efficient queries
CREATE INDEX idx_intent_authoring_events_request_id ON intent_issue_authoring_events(request_id);
CREATE INDEX idx_intent_authoring_events_session_id ON intent_issue_authoring_events(session_id);
CREATE INDEX idx_intent_authoring_events_sub ON intent_issue_authoring_events(sub);
CREATE INDEX idx_intent_authoring_events_action ON intent_issue_authoring_events(action);
CREATE INDEX idx_intent_authoring_events_created_at ON intent_issue_authoring_events(created_at DESC);

-- Composite index for session-based queries
CREATE INDEX idx_intent_authoring_events_session_action ON intent_issue_authoring_events(session_id, action, created_at DESC);

-- ========================================
-- Append-Only Policy (E81.5 requirement)
-- ========================================
-- Prevent UPDATE and DELETE operations on this table
-- Only INSERT is allowed to maintain audit integrity

CREATE OR REPLACE FUNCTION prevent_intent_authoring_events_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_issue_authoring_events is append-only: UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_update_intent_authoring_events
  BEFORE UPDATE ON intent_issue_authoring_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_intent_authoring_events_modification();

CREATE TRIGGER prevent_delete_intent_authoring_events
  BEFORE DELETE ON intent_issue_authoring_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_intent_authoring_events_modification();
