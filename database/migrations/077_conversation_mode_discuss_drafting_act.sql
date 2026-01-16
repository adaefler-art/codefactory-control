-- Migration: 077_conversation_mode_discuss_drafting_act.sql
-- I903: Steering Modes: DISCUSS vs DRAFTING vs ACT
--
-- Extends conversation modes to support three-stage steering:
-- - DISCUSS: Free planning and discussion, no auto-drafting
-- - DRAFTING: Structured drafting mode, schema-guided
-- - ACT: Validation and write operations (commits, publishes)
--
-- Backward compatibility:
-- - Database migrates FREE → DISCUSS (this migration)
-- - Application layer normalizes FREE → DISCUSS before DB writes
-- - API schema accepts FREE temporarily but normalizes it
-- - Database constraint only allows DISCUSS/DRAFTING/ACT
--
-- This creates a clean separation:
-- - API: Accepts FREE (for old clients) and normalizes
-- - Database: Only stores DISCUSS/DRAFTING/ACT (canonical values)
--
-- Security:
--   - No PII
--   - User-owned data (session ownership enforced by existing guards)

-- ============================================================================
-- Update intent_sessions conversation_mode constraint
-- ============================================================================

-- Drop old constraint
ALTER TABLE intent_sessions
  DROP CONSTRAINT IF EXISTS chk_intent_session_conversation_mode;

-- Migrate existing FREE sessions to DISCUSS
UPDATE intent_sessions
  SET conversation_mode = 'DISCUSS'
  WHERE conversation_mode = 'FREE';

-- Add new constraint with three modes
ALTER TABLE intent_sessions
  ADD CONSTRAINT chk_intent_session_conversation_mode 
    CHECK (conversation_mode IN ('DISCUSS', 'DRAFTING', 'ACT'));

-- Update comment for documentation
COMMENT ON COLUMN intent_sessions.conversation_mode IS 
  'I903: Session conversation mode (DISCUSS/DRAFTING/ACT). Controls tool gating and validation enforcement. DISCUSS: free planning, DRAFTING: structured drafting, ACT: validation+commit+publish.';

-- ============================================================================
-- Update tool_execution_audit conversation_mode constraint
-- ============================================================================

-- Drop old constraint
ALTER TABLE tool_execution_audit
  DROP CONSTRAINT IF EXISTS chk_tool_execution_conversation_mode;

-- Migrate existing FREE audit records to DISCUSS
UPDATE tool_execution_audit
  SET conversation_mode = 'DISCUSS'
  WHERE conversation_mode = 'FREE';

-- Add new constraint
ALTER TABLE tool_execution_audit
  ADD CONSTRAINT chk_tool_execution_conversation_mode 
    CHECK (conversation_mode IN ('DISCUSS', 'DRAFTING', 'ACT'));

-- Update comment for documentation
COMMENT ON COLUMN tool_execution_audit.conversation_mode IS 
  'I903: Conversation mode at time of execution (DISCUSS/DRAFTING/ACT)';
