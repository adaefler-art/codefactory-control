-- Migration 053: INTENT Issue Sets
-- Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
-- Creates tables for storing issue sets and their items per INTENT session

-- ========================================
-- INTENT Issue Sets (1 active per session)
-- ========================================
CREATE TABLE intent_issue_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source_hash TEXT NOT NULL,
  briefing_text TEXT,
  constraints_json JSONB,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_committed BOOLEAN NOT NULL DEFAULT FALSE,
  committed_at TIMESTAMP,
  CONSTRAINT uniq_intent_issue_set_session UNIQUE (session_id)
);

CREATE INDEX idx_intent_issue_sets_session_id ON intent_issue_sets(session_id);
CREATE INDEX idx_intent_issue_sets_source_hash ON intent_issue_sets(source_hash);
CREATE INDEX idx_intent_issue_sets_committed ON intent_issue_sets(is_committed);

-- ========================================
-- INTENT Issue Set Items (multiple per set)
-- ========================================
CREATE TABLE intent_issue_set_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_set_id UUID NOT NULL REFERENCES intent_issue_sets(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  issue_json JSONB NOT NULL,
  issue_hash TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  last_validation_status TEXT NOT NULL DEFAULT 'unknown',
  last_validation_at TIMESTAMP,
  last_validation_result JSONB,
  position INTEGER NOT NULL,
  CONSTRAINT chk_intent_issue_set_item_validation_status CHECK (
    last_validation_status IN ('unknown', 'valid', 'invalid')
  ),
  CONSTRAINT chk_intent_issue_set_item_position CHECK (position >= 0)
);

CREATE INDEX idx_intent_issue_set_items_set_id ON intent_issue_set_items(issue_set_id);
CREATE INDEX idx_intent_issue_set_items_canonical_id ON intent_issue_set_items(canonical_id);
CREATE INDEX idx_intent_issue_set_items_hash ON intent_issue_set_items(issue_hash);
CREATE INDEX idx_intent_issue_set_items_validation_status ON intent_issue_set_items(last_validation_status);
CREATE INDEX idx_intent_issue_set_items_position ON intent_issue_set_items(issue_set_id, position);
