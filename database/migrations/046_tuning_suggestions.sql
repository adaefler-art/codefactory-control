-- Migration 046: Tuning Suggestions (E78.3 / I783)
-- 
-- Deterministic tuning suggestions for playbooks/rules/guardrails:
-- - Evidence-based suggestions (linked to outcomes, KPIs, incidents)
-- - Deterministic generation (same inputs → same suggestion_hash)
-- - Suggestions only (no automatic application)
-- - Conservative approach: prefer collecting evidence over risky actions
--
-- Features:
-- - Idempotency via window + suggestion_hash
-- - Version-controlled suggestion JSON schema (v0.7.0)
-- - Windowed aggregation tracking
-- - Evidence references for transparency

-- ========================================
-- Table: tuning_suggestions
-- ========================================

CREATE TABLE IF NOT EXISTS tuning_suggestions (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Window classification (same as kpi_aggregates)
  window TEXT NOT NULL CHECK (window IN ('daily', 'weekly', 'release', 'custom')),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  
  -- Suggestion hash (SHA-256 of stable JSON content, excluding generatedAt/suggestionId)
  -- Deterministic: same suggestion content → same hash
  suggestion_hash TEXT NOT NULL,
  
  -- Suggestion JSON artifact (version-controlled schema)
  -- See TuningSuggestionV0_7_0Schema in contracts/tuning-suggestions.ts
  suggestion_json JSONB NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_suggestion_json CHECK (jsonb_typeof(suggestion_json) = 'object'),
  CONSTRAINT valid_window_times CHECK (window_start < window_end)
);

-- Unique constraint: prevent duplicate suggestions for same window
-- Same window + suggestion_hash = idempotent
CREATE UNIQUE INDEX IF NOT EXISTS tuning_suggestions_window_hash_idx 
  ON tuning_suggestions(window, window_start, window_end, suggestion_hash);

-- Index for querying suggestions by window
CREATE INDEX IF NOT EXISTS tuning_suggestions_window_idx 
  ON tuning_suggestions(window, window_start DESC);

-- Index for querying by creation time
CREATE INDEX IF NOT EXISTS tuning_suggestions_created_at_idx 
  ON tuning_suggestions(created_at DESC);

-- Index for suggestion_hash lookups
CREATE INDEX IF NOT EXISTS tuning_suggestions_hash_idx 
  ON tuning_suggestions(suggestion_hash);

-- GIN index on suggestion_json for JSONB queries
CREATE INDEX IF NOT EXISTS tuning_suggestions_json_idx 
  ON tuning_suggestions USING GIN(suggestion_json);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE tuning_suggestions IS 'Deterministic tuning suggestions for playbooks/rules/guardrails (E78.3/I783)';
COMMENT ON COLUMN tuning_suggestions.window IS 'Aggregation window: daily, weekly, release, custom';
COMMENT ON COLUMN tuning_suggestions.window_start IS 'Window start timestamp (inclusive)';
COMMENT ON COLUMN tuning_suggestions.window_end IS 'Window end timestamp (exclusive)';
COMMENT ON COLUMN tuning_suggestions.suggestion_hash IS 'SHA-256 hash of stable suggestion content (deterministic)';
COMMENT ON COLUMN tuning_suggestions.suggestion_json IS 'Version-controlled suggestion JSON artifact (v0.7.0)';
