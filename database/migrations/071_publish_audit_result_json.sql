-- Migration 071: Add result_json with 32KB bound to Publish Audit Trail
-- Issue E89.7: Publish Audit Trail (DB table + session-scoped UI view; append-only, bounded result_json)
-- Adds bounded result_json and result_truncated columns to publish batch and item events

-- ========================================
-- Add result_json columns to batch events
-- ========================================

ALTER TABLE intent_issue_set_publish_batch_events
  ADD COLUMN result_json JSONB,
  ADD COLUMN result_truncated BOOLEAN DEFAULT FALSE NOT NULL;

COMMENT ON COLUMN intent_issue_set_publish_batch_events.result_json IS 'Bounded result summary (max 32KB), truncated if overflow';
COMMENT ON COLUMN intent_issue_set_publish_batch_events.result_truncated IS 'TRUE if result_json was truncated due to size limit';

-- ========================================
-- Add result_json columns to item events
-- ========================================

ALTER TABLE intent_issue_set_publish_item_events
  ADD COLUMN result_json JSONB,
  ADD COLUMN result_truncated BOOLEAN DEFAULT FALSE NOT NULL;

COMMENT ON COLUMN intent_issue_set_publish_item_events.result_json IS 'Bounded result summary (max 32KB), truncated if overflow';
COMMENT ON COLUMN intent_issue_set_publish_item_events.result_truncated IS 'TRUE if result_json was truncated due to size limit';

-- ========================================
-- Function to enforce 32KB limit on result_json
-- ========================================

CREATE OR REPLACE FUNCTION enforce_result_json_size_limit()
RETURNS TRIGGER AS $$
DECLARE
  json_size INTEGER;
  max_size INTEGER := 32768; -- 32KB in bytes
BEGIN
  IF NEW.result_json IS NOT NULL THEN
    -- Calculate size of JSONB in bytes (approximate)
    json_size := octet_length(NEW.result_json::text);
    
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
-- Apply size limit triggers
-- ========================================

CREATE TRIGGER trg_enforce_batch_result_json_size
  BEFORE INSERT ON intent_issue_set_publish_batch_events
  FOR EACH ROW
  EXECUTE FUNCTION enforce_result_json_size_limit();

CREATE TRIGGER trg_enforce_item_result_json_size
  BEFORE INSERT ON intent_issue_set_publish_item_events
  FOR EACH ROW
  EXECUTE FUNCTION enforce_result_json_size_limit();

-- ========================================
-- Update views to include new columns
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
