-- Migration 034: INTENT CR Versions and Diff
-- Issue E74.4: CR Versioning + Diff (immutable versions + latest pointer)
-- Creates tables for storing immutable CR versions with deterministic diffing

-- ========================================
-- INTENT CR Versions (immutable snapshots)
-- ========================================
CREATE TABLE intent_cr_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cr_json JSONB NOT NULL,
  cr_hash TEXT NOT NULL,
  cr_version INTEGER NOT NULL,
  CONSTRAINT uniq_intent_cr_version_session_hash UNIQUE (session_id, cr_hash),
  CONSTRAINT uniq_intent_cr_version_session_version UNIQUE (session_id, cr_version),
  CONSTRAINT chk_intent_cr_version_positive CHECK (cr_version >= 1)
);

CREATE INDEX idx_intent_cr_versions_session_id ON intent_cr_versions(session_id);
CREATE INDEX idx_intent_cr_versions_session_created ON intent_cr_versions(session_id, created_at DESC);
CREATE INDEX idx_intent_cr_versions_hash ON intent_cr_versions(cr_hash);

-- ========================================
-- INTENT CR Latest Pointer
-- ========================================
CREATE TABLE intent_cr_latest (
  session_id UUID PRIMARY KEY REFERENCES intent_sessions(id) ON DELETE CASCADE,
  latest_cr_version_id UUID NOT NULL REFERENCES intent_cr_versions(id) ON DELETE CASCADE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intent_cr_latest_version_id ON intent_cr_latest(latest_cr_version_id);
