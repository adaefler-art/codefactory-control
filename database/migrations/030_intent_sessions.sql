-- Migration 030: INTENT Sessions and Messages
-- Issue E73.1: INTENT Console UI Shell
-- Creates tables for storing INTENT sessions and chat messages with deterministic ordering

-- ========================================
-- INTENT Sessions
-- ========================================
CREATE TABLE intent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active',
  CONSTRAINT chk_intent_session_status CHECK (status IN ('active', 'archived'))
);

CREATE INDEX idx_intent_sessions_created_at ON intent_sessions(created_at DESC);
CREATE INDEX idx_intent_sessions_status ON intent_sessions(status);

-- ========================================
-- INTENT Messages
-- ========================================
CREATE TABLE intent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  seq INTEGER NOT NULL,
  CONSTRAINT chk_intent_message_role CHECK (role IN ('user', 'assistant', 'system')),
  CONSTRAINT uniq_intent_message_session_seq UNIQUE (session_id, seq)
);

CREATE INDEX idx_intent_messages_session_id ON intent_messages(session_id);
CREATE INDEX idx_intent_messages_created_at ON intent_messages(created_at);
CREATE INDEX idx_intent_messages_session_seq ON intent_messages(session_id, seq);
