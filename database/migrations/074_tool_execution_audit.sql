-- Migration 074: Tool Execution Audit Trail
-- Issue: V09-I02: Tool Gating: Action-Gated Draft Ops (No Auto-Snap)
--
-- Purpose: Track all tool executions with trigger type for audit and gating enforcement
-- Dependencies: 073_intent_session_conversation_mode.sql

-- Tool execution audit trail
CREATE TABLE IF NOT EXISTS tool_execution_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  conversation_mode TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  error_code TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT fk_tool_execution_session 
    FOREIGN KEY (session_id) 
    REFERENCES intent_sessions(id) 
    ON DELETE CASCADE,
  
  CONSTRAINT chk_tool_execution_trigger_type 
    CHECK (trigger_type IN ('AUTO_BLOCKED', 'USER_EXPLICIT', 'UI_ACTION', 'AUTO_ALLOWED')),
    
  CONSTRAINT chk_tool_execution_conversation_mode 
    CHECK (conversation_mode IN ('FREE', 'DRAFTING'))
);

-- Indexes for querying audit trail
CREATE INDEX idx_tool_execution_session_id 
  ON tool_execution_audit(session_id, executed_at DESC);

CREATE INDEX idx_tool_execution_user_id 
  ON tool_execution_audit(user_id, executed_at DESC);

CREATE INDEX idx_tool_execution_trigger_type 
  ON tool_execution_audit(trigger_type);

CREATE INDEX idx_tool_execution_tool_name 
  ON tool_execution_audit(tool_name);

-- Comments for documentation
COMMENT ON TABLE tool_execution_audit IS 
  'Audit trail for all INTENT tool executions with trigger type tracking (V09-I02)';

COMMENT ON COLUMN tool_execution_audit.trigger_type IS 
  'AUTO_BLOCKED: Draft-mutating tool blocked in FREE mode | USER_EXPLICIT: Explicit command | UI_ACTION: UI button/action | AUTO_ALLOWED: Auto execution allowed (non-draft or DRAFTING mode)';

COMMENT ON COLUMN tool_execution_audit.conversation_mode IS 
  'Conversation mode at time of execution (FREE or DRAFTING)';
