-- Migration 052: INTENT Issue Drafts and Versions
-- Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
-- Creates tables for storing issue drafts and immutable versions per INTENT session

-- ========================================
-- INTENT Issue Drafts (1 active per session)
-- ========================================
CREATE TABLE intent_issue_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  issue_json JSONB NOT NULL,
  issue_hash TEXT NOT NULL,
  last_validation_status TEXT NOT NULL DEFAULT 'unknown',
  last_validation_at TIMESTAMP,
  last_validation_result JSONB,
  CONSTRAINT chk_intent_issue_draft_validation_status CHECK (
    last_validation_status IN ('unknown', 'valid', 'invalid')
  ),
  CONSTRAINT uniq_intent_issue_draft_session UNIQUE (session_id)
);

CREATE INDEX idx_intent_issue_drafts_session_id ON intent_issue_drafts(session_id);
CREATE INDEX idx_intent_issue_drafts_hash ON intent_issue_drafts(issue_hash);
CREATE INDEX idx_intent_issue_drafts_validation_status ON intent_issue_drafts(last_validation_status);

-- ========================================
-- INTENT Issue Draft Versions (immutable commits)
-- ========================================
CREATE TABLE intent_issue_draft_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_sub TEXT NOT NULL,
  issue_json JSONB NOT NULL,
  issue_hash TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  CONSTRAINT uniq_intent_issue_draft_version_session_hash UNIQUE (session_id, issue_hash),
  CONSTRAINT uniq_intent_issue_draft_version_session_version UNIQUE (session_id, version_number),
  CONSTRAINT chk_intent_issue_draft_version_positive CHECK (version_number >= 1)
);

CREATE INDEX idx_intent_issue_draft_versions_session_id ON intent_issue_draft_versions(session_id);
CREATE INDEX idx_intent_issue_draft_versions_session_created ON intent_issue_draft_versions(session_id, created_at DESC);
CREATE INDEX idx_intent_issue_draft_versions_hash ON intent_issue_draft_versions(issue_hash);
CREATE INDEX idx_intent_issue_draft_versions_created_by ON intent_issue_draft_versions(created_by_sub);
