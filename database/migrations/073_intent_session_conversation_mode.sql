-- Migration: 073_intent_session_conversation_mode.sql
-- V09-I01: Session Conversation Mode (FREE vs DRAFTING) + Persistenz
--
-- Adds conversation_mode column to intent_sessions table to track session mode.
-- Mode controls tool gating and UX behavior in INTENT Console.
--
-- Changes:
--   - Add conversation_mode column with default 'FREE'
--   - Constraint: only 'FREE' or 'DRAFTING' allowed
--
-- Security:
--   - No PII
--   - User-owned data (session ownership enforced by existing guards)

-- ============================================================================
-- Add conversation_mode column to intent_sessions
-- ============================================================================
ALTER TABLE intent_sessions
  ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'FREE'
  CONSTRAINT chk_intent_session_conversation_mode 
    CHECK (conversation_mode IN ('FREE', 'DRAFTING'));

-- Index for filtering sessions by mode (if needed for future features)
CREATE INDEX idx_intent_sessions_conversation_mode 
  ON intent_sessions(conversation_mode);

-- Add comment for documentation
COMMENT ON COLUMN intent_sessions.conversation_mode IS 
  'V09-I01: Session conversation mode. Controls tool gating and UX. Values: FREE (default), DRAFTING.';
