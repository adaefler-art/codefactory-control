-- Migration 033: INTENT CR Drafts
-- Issue E74.3: CR Preview/Edit UI + Validation Gate
-- Creates table for storing CR drafts per INTENT session

-- ========================================
-- INTENT CR Drafts
-- ========================================
CREATE TABLE intent_cr_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cr_json JSONB NOT NULL,
  cr_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  CONSTRAINT chk_intent_cr_draft_status CHECK (status IN ('draft', 'valid', 'invalid')),
  CONSTRAINT uniq_intent_cr_draft_session UNIQUE (session_id)
);

CREATE INDEX idx_intent_cr_drafts_session_id ON intent_cr_drafts(session_id);
CREATE INDEX idx_intent_cr_drafts_status ON intent_cr_drafts(status);
CREATE INDEX idx_intent_cr_drafts_hash ON intent_cr_drafts(cr_hash);
