-- Migration 056: INTENT Issue Set Publish Ledger
-- Issue E82.3: Publish Audit Log + Backlinks (AFU9 Issue ↔ GitHub Issue)
-- Creates tables for tracking issue set publishing to GitHub with full audit trail

-- ========================================
-- INTENT Issue Set Publish Batches
-- ========================================
CREATE TABLE intent_issue_set_publish_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_set_id UUID NOT NULL REFERENCES intent_issue_sets(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id TEXT NOT NULL,
  lawbook_version TEXT NOT NULL,
  
  -- Batch execution status
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Summary counts
  total_items INTEGER NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  
  -- Error details (if batch-level failure)
  error_message TEXT,
  error_details JSONB,
  
  -- Hash for idempotency
  batch_hash TEXT NOT NULL
);

CREATE INDEX idx_intent_issue_set_publish_batches_issue_set_id ON intent_issue_set_publish_batches(issue_set_id);
CREATE INDEX idx_intent_issue_set_publish_batches_session_id ON intent_issue_set_publish_batches(session_id);
CREATE INDEX idx_intent_issue_set_publish_batches_request_id ON intent_issue_set_publish_batches(request_id);
CREATE INDEX idx_intent_issue_set_publish_batches_status ON intent_issue_set_publish_batches(status);
CREATE INDEX idx_intent_issue_set_publish_batches_created_at ON intent_issue_set_publish_batches(created_at DESC);
CREATE INDEX idx_intent_issue_set_publish_batches_batch_hash ON intent_issue_set_publish_batches(batch_hash);

-- ========================================
-- INTENT Issue Set Publish Items (per-item audit)
-- ========================================
CREATE TABLE intent_issue_set_publish_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES intent_issue_set_publish_batches(id) ON DELETE CASCADE,
  issue_set_item_id UUID NOT NULL REFERENCES intent_issue_set_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Canonical identification
  canonical_id TEXT NOT NULL,
  issue_hash TEXT NOT NULL,
  
  -- GitHub details
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  github_issue_number INTEGER,
  github_issue_url TEXT,
  
  -- Action taken
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'skipped', 'failed')),
  
  -- Status
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  
  -- Error details (if failed)
  error_message TEXT,
  error_details JSONB,
  
  -- Metadata
  lawbook_version TEXT NOT NULL,
  rendered_issue_hash TEXT,
  labels_applied TEXT[],
  
  -- Request context
  request_id TEXT NOT NULL
);

CREATE INDEX idx_intent_issue_set_publish_items_batch_id ON intent_issue_set_publish_items(batch_id);
CREATE INDEX idx_intent_issue_set_publish_items_issue_set_item_id ON intent_issue_set_publish_items(issue_set_item_id);
CREATE INDEX idx_intent_issue_set_publish_items_canonical_id ON intent_issue_set_publish_items(canonical_id);
CREATE INDEX idx_intent_issue_set_publish_items_github_issue ON intent_issue_set_publish_items(owner, repo, github_issue_number);
CREATE INDEX idx_intent_issue_set_publish_items_action ON intent_issue_set_publish_items(action);
CREATE INDEX idx_intent_issue_set_publish_items_status ON intent_issue_set_publish_items(status);
CREATE INDEX idx_intent_issue_set_publish_items_created_at ON intent_issue_set_publish_items(created_at DESC);

-- ========================================
-- Prevent Updates (Append-Only Enforcement)
-- ========================================

-- Trigger function to prevent updates on batches
CREATE OR REPLACE FUNCTION prevent_publish_batch_updates()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_issue_set_publish_batches is append-only: updates are not allowed';
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce append-only on batches
CREATE TRIGGER trg_prevent_publish_batch_updates
  BEFORE UPDATE ON intent_issue_set_publish_batches
  FOR EACH ROW
  EXECUTE FUNCTION prevent_publish_batch_updates();

-- Trigger function to prevent updates on items
CREATE OR REPLACE FUNCTION prevent_publish_item_updates()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_issue_set_publish_items is append-only: updates are not allowed';
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce append-only on items
CREATE TRIGGER trg_prevent_publish_item_updates
  BEFORE UPDATE ON intent_issue_set_publish_items
  FOR EACH ROW
  EXECUTE FUNCTION prevent_publish_item_updates();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE intent_issue_set_publish_batches IS 'Append-only audit trail for issue set publishing batches (E82.3)';
COMMENT ON COLUMN intent_issue_set_publish_batches.batch_hash IS 'Hash of issue_set_id + source_hash for idempotency';
COMMENT ON COLUMN intent_issue_set_publish_batches.request_id IS 'Request ID for traceability';
COMMENT ON COLUMN intent_issue_set_publish_batches.lawbook_version IS 'Lawbook version at time of publish';

COMMENT ON TABLE intent_issue_set_publish_items IS 'Append-only audit trail for individual issue publishing (E82.3)';
COMMENT ON COLUMN intent_issue_set_publish_items.canonical_id IS 'Canonical ID of the issue for idempotency';
COMMENT ON COLUMN intent_issue_set_publish_items.action IS 'Action taken: created, updated, skipped, or failed';
COMMENT ON COLUMN intent_issue_set_publish_items.rendered_issue_hash IS 'Hash of rendered issue content for change detection';
