-- Migration 056: INTENT Issue Set Publish Ledger (Event-Based)
-- Issue E82.3: Publish Audit Log + Backlinks (AFU9 Issue ↔ GitHub Issue)
-- Event-based append-only ledger - no UPDATEs, only INSERTs
-- Latest state determined by querying most recent event per batch/item

-- ========================================
-- INTENT Issue Set Publish Events (Batch-level)
-- ========================================
CREATE TABLE intent_issue_set_publish_batch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL, -- Logical batch ID (not FK to allow orphan detection)
  issue_set_id UUID NOT NULL REFERENCES intent_issue_sets(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id TEXT NOT NULL,
  lawbook_version TEXT NOT NULL,
  
  -- Metadata for this event
  total_items INTEGER,
  created_count INTEGER,
  updated_count INTEGER,
  skipped_count INTEGER,
  failed_count INTEGER,
  error_message TEXT,
  error_details JSONB,
  
  -- Hash for idempotency (repo-specific)
  batch_hash TEXT NOT NULL,
  
  -- Metadata
  owner TEXT NOT NULL,
  repo TEXT NOT NULL
);

CREATE INDEX idx_publish_batch_events_batch_id ON intent_issue_set_publish_batch_events(batch_id, created_at DESC);
CREATE INDEX idx_publish_batch_events_issue_set_id ON intent_issue_set_publish_batch_events(issue_set_id);
CREATE INDEX idx_publish_batch_events_session_id ON intent_issue_set_publish_batch_events(session_id);
CREATE INDEX idx_publish_batch_events_request_id ON intent_issue_set_publish_batch_events(request_id);
CREATE INDEX idx_publish_batch_events_batch_hash ON intent_issue_set_publish_batch_events(batch_hash);
CREATE INDEX idx_publish_batch_events_created_at ON intent_issue_set_publish_batch_events(created_at DESC);

-- ========================================
-- INTENT Issue Set Publish Events (Item-level)
-- ========================================
CREATE TABLE intent_issue_set_publish_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL, -- Matches parent batch_id
  item_id UUID NOT NULL, -- Logical item ID (not FK)
  issue_set_item_id UUID NOT NULL REFERENCES intent_issue_set_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'succeeded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Canonical identification
  canonical_id TEXT NOT NULL,
  issue_hash TEXT NOT NULL,
  
  -- GitHub details (populated on success)
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  github_issue_number INTEGER,
  github_issue_url TEXT,
  
  -- Action taken (populated on success/failure)
  action TEXT CHECK (action IN ('created', 'updated', 'skipped', 'failed')),
  
  -- Error details (populated on failure)
  error_message TEXT,
  error_details JSONB,
  
  -- Metadata
  lawbook_version TEXT NOT NULL,
  rendered_issue_hash TEXT,
  labels_applied TEXT[],
  request_id TEXT NOT NULL
);

CREATE INDEX idx_publish_item_events_batch_id ON intent_issue_set_publish_item_events(batch_id);
CREATE INDEX idx_publish_item_events_item_id ON intent_issue_set_publish_item_events(item_id, created_at DESC);
CREATE INDEX idx_publish_item_events_issue_set_item_id ON intent_issue_set_publish_item_events(issue_set_item_id);
CREATE INDEX idx_publish_item_events_canonical_id ON intent_issue_set_publish_item_events(canonical_id);
CREATE INDEX idx_publish_item_events_github_issue ON intent_issue_set_publish_item_events(owner, repo, github_issue_number);
CREATE INDEX idx_publish_item_events_created_at ON intent_issue_set_publish_item_events(created_at DESC);

-- ========================================
-- Prevent Updates/Deletes (Append-Only Enforcement)
-- ========================================

-- Prevent updates on batch events
CREATE OR REPLACE FUNCTION prevent_publish_batch_event_updates()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_issue_set_publish_batch_events is append-only: updates/deletes not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_publish_batch_event_updates
  BEFORE UPDATE ON intent_issue_set_publish_batch_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_publish_batch_event_updates();

CREATE TRIGGER trg_prevent_publish_batch_event_deletes
  BEFORE DELETE ON intent_issue_set_publish_batch_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_publish_batch_event_updates();

-- Prevent updates on item events
CREATE OR REPLACE FUNCTION prevent_publish_item_event_updates()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_issue_set_publish_item_events is append-only: updates/deletes not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_publish_item_event_updates
  BEFORE UPDATE ON intent_issue_set_publish_item_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_publish_item_event_updates();

CREATE TRIGGER trg_prevent_publish_item_event_deletes
  BEFORE DELETE ON intent_issue_set_publish_item_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_publish_item_event_updates();

-- ========================================
-- Helper Views for Latest State
-- ========================================

-- Latest batch state per batch_id
CREATE VIEW v_latest_publish_batch_state AS
SELECT DISTINCT ON (batch_id)
  batch_id,
  event_type as status,
  created_at as status_updated_at,
  issue_set_id,
  session_id,
  request_id,
  lawbook_version,
  total_items,
  created_count,
  updated_count,
  skipped_count,
  failed_count,
  error_message,
  batch_hash,
  owner,
  repo
FROM intent_issue_set_publish_batch_events
ORDER BY batch_id, created_at DESC;

-- Latest item state per item_id
CREATE VIEW v_latest_publish_item_state AS
SELECT DISTINCT ON (item_id)
  item_id,
  batch_id,
  event_type as status,
  created_at as status_updated_at,
  canonical_id,
  issue_hash,
  owner,
  repo,
  github_issue_number,
  github_issue_url,
  action,
  error_message,
  lawbook_version,
  rendered_issue_hash,
  labels_applied
FROM intent_issue_set_publish_item_events
ORDER BY item_id, created_at DESC;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE intent_issue_set_publish_batch_events IS 'Event-based append-only audit trail for batch-level publish events (E82.3) - INSERT only';
COMMENT ON COLUMN intent_issue_set_publish_batch_events.event_type IS 'Event type: started, completed, failed';
COMMENT ON COLUMN intent_issue_set_publish_batch_events.batch_id IS 'Logical batch identifier - multiple events share same batch_id';
COMMENT ON COLUMN intent_issue_set_publish_batch_events.batch_hash IS 'Hash of issue_set_id + source_hash + owner + repo for idempotency';

COMMENT ON TABLE intent_issue_set_publish_item_events IS 'Event-based append-only audit trail for item-level publish events (E82.3) - INSERT only';
COMMENT ON COLUMN intent_issue_set_publish_item_events.event_type IS 'Event type: started, succeeded, failed';
COMMENT ON COLUMN intent_issue_set_publish_item_events.item_id IS 'Logical item identifier - multiple events share same item_id';
COMMENT ON COLUMN intent_issue_set_publish_item_events.action IS 'Action taken: created, updated, skipped (only on succeeded/failed events)';

COMMENT ON VIEW v_latest_publish_batch_state IS 'Latest state per batch_id (deterministic query of most recent event)';
COMMENT ON VIEW v_latest_publish_item_state IS 'Latest state per item_id (deterministic query of most recent event)';
