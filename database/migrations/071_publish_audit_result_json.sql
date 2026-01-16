-- Migration 071: Add result_json with 32KB bound to Publish Audit Trail
-- Issue E89.7: Publish Audit Trail (DB table + session-scoped UI view; append-only, bounded result_json)
-- Adds bounded result_json and result_truncated columns to publish batch and item events
--
-- IDEMPOTENCY FIX (2026-01-16):
-- - Creates tables if they don't exist (evidence: 056_intent_issue_set_publish_ledger.sql)
-- - Adds columns only if missing (ADD COLUMN IF NOT EXISTS)
-- - Safe to re-run multiple times

-- ========================================
-- STEP 1: Ensure base tables exist (from 056)
-- Creates tables if migration 056 was not applied or failed
-- ========================================

-- Create batch events table if not exists (exact schema from 056)
CREATE TABLE IF NOT EXISTS intent_issue_set_publish_batch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  issue_set_id UUID NOT NULL,
  session_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id TEXT NOT NULL,
  lawbook_version TEXT NOT NULL,
  total_items INTEGER,
  created_count INTEGER,
  updated_count INTEGER,
  skipped_count INTEGER,
  failed_count INTEGER,
  error_message TEXT,
  error_details JSONB,
  batch_hash TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL
);

-- Create item events table if not exists (exact schema from 056)
CREATE TABLE IF NOT EXISTS intent_issue_set_publish_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  item_id UUID NOT NULL,
  issue_set_item_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'succeeded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canonical_id TEXT NOT NULL,
  issue_hash TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  github_issue_number INTEGER,
  github_issue_url TEXT,
  action TEXT CHECK (action IN ('created', 'updated', 'skipped', 'failed')),
  error_message TEXT,
  error_details JSONB,
  lawbook_version TEXT NOT NULL,
  rendered_issue_hash TEXT,
  labels_applied TEXT[],
  request_id TEXT NOT NULL
);

-- Create indexes if not exist (idempotent via IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_publish_batch_events_batch_id ON intent_issue_set_publish_batch_events(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_batch_events_issue_set_id ON intent_issue_set_publish_batch_events(issue_set_id);
CREATE INDEX IF NOT EXISTS idx_publish_batch_events_session_id ON intent_issue_set_publish_batch_events(session_id);
CREATE INDEX IF NOT EXISTS idx_publish_batch_events_request_id ON intent_issue_set_publish_batch_events(request_id);
CREATE INDEX IF NOT EXISTS idx_publish_batch_events_batch_hash ON intent_issue_set_publish_batch_events(batch_hash);
CREATE INDEX IF NOT EXISTS idx_publish_batch_events_created_at ON intent_issue_set_publish_batch_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_item_events_batch_id ON intent_issue_set_publish_item_events(batch_id);
CREATE INDEX IF NOT EXISTS idx_publish_item_events_item_id ON intent_issue_set_publish_item_events(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_item_events_issue_set_item_id ON intent_issue_set_publish_item_events(issue_set_item_id);
CREATE INDEX IF NOT EXISTS idx_publish_item_events_canonical_id ON intent_issue_set_publish_item_events(canonical_id);
CREATE INDEX IF NOT EXISTS idx_publish_item_events_github_issue ON intent_issue_set_publish_item_events(owner, repo, github_issue_number);
CREATE INDEX IF NOT EXISTS idx_publish_item_events_created_at ON intent_issue_set_publish_item_events(created_at DESC);

-- ========================================
-- STEP 2: Add result_json columns to batch events (IF NOT EXISTS)
-- ========================================

ALTER TABLE intent_issue_set_publish_batch_events
  ADD COLUMN IF NOT EXISTS result_json JSONB,
  ADD COLUMN IF NOT EXISTS result_truncated BOOLEAN DEFAULT FALSE NOT NULL;

COMMENT ON COLUMN intent_issue_set_publish_batch_events.result_json IS 'Bounded result summary (max 32KB), truncated if overflow';
COMMENT ON COLUMN intent_issue_set_publish_batch_events.result_truncated IS 'TRUE if result_json was truncated due to size limit';

-- ========================================
-- STEP 3: Add result_json columns to item events (IF NOT EXISTS)
-- ========================================

ALTER TABLE intent_issue_set_publish_item_events
  ADD COLUMN IF NOT EXISTS result_json JSONB,
  ADD COLUMN IF NOT EXISTS result_truncated BOOLEAN DEFAULT FALSE NOT NULL;

COMMENT ON COLUMN intent_issue_set_publish_item_events.result_json IS 'Bounded result summary (max 32KB), truncated if overflow';
COMMENT ON COLUMN intent_issue_set_publish_item_events.result_truncated IS 'TRUE if result_json was truncated due to size limit';

-- ========================================
-- STEP 4: Function to enforce 32KB limit on result_json
-- ========================================

CREATE OR REPLACE FUNCTION enforce_result_json_size_limit()
RETURNS TRIGGER AS $$
DECLARE
  json_size INTEGER;
  max_size INTEGER := 32768; -- 32KB in bytes
BEGIN
  IF NEW.result_json IS NOT NULL THEN
    -- Calculate actual storage size of JSONB column
    json_size := pg_column_size(NEW.result_json);
    
    IF json_size > max_size THEN
      -- Truncate to empty object and set flag
      NEW.result_json := '{}'::jsonb;
      NEW.result_truncated := TRUE;
      
      -- Log truncation (for monitoring)
      RAISE NOTICE 'result_json truncated: size=% bytes, max=% bytes, table=%', 
        json_size, max_size, TG_TABLE_NAME;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- STEP 5: Apply size limit triggers (idempotent via DROP IF EXISTS)
-- ========================================

DROP TRIGGER IF EXISTS trg_enforce_batch_result_json_size ON intent_issue_set_publish_batch_events;
CREATE TRIGGER trg_enforce_batch_result_json_size
  BEFORE INSERT ON intent_issue_set_publish_batch_events
  FOR EACH ROW
  EXECUTE FUNCTION enforce_result_json_size_limit();

DROP TRIGGER IF EXISTS trg_enforce_item_result_json_size ON intent_issue_set_publish_item_events;
CREATE TRIGGER trg_enforce_item_result_json_size
  BEFORE INSERT ON intent_issue_set_publish_item_events
  FOR EACH ROW
  EXECUTE FUNCTION enforce_result_json_size_limit();

-- ========================================
-- STEP 6: Update views to include new columns (CREATE OR REPLACE is idempotent)
-- ========================================

CREATE OR REPLACE VIEW v_latest_publish_batch_state AS
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
  repo,
  result_json,
  result_truncated
FROM intent_issue_set_publish_batch_events
ORDER BY batch_id, created_at DESC;

CREATE OR REPLACE VIEW v_latest_publish_item_state AS
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
  labels_applied,
  result_json,
  result_truncated
FROM intent_issue_set_publish_item_events
ORDER BY item_id, created_at DESC;

COMMENT ON COLUMN v_latest_publish_batch_state.result_json IS 'Latest batch result summary (bounded to 32KB)';
COMMENT ON COLUMN v_latest_publish_batch_state.result_truncated IS 'Indicates if result was truncated';
COMMENT ON COLUMN v_latest_publish_item_state.result_json IS 'Latest item result summary (bounded to 32KB)';
COMMENT ON COLUMN v_latest_publish_item_state.result_truncated IS 'Indicates if result was truncated';
