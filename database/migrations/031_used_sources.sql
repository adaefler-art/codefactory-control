-- Migration 031: used_sources for INTENT Messages
-- Issue E73.2: Sources Panel + used_sources Contract
-- Adds evidence/provenance tracking columns to intent_messages

-- ========================================
-- Add used_sources columns to intent_messages
-- ========================================

-- Add used_sources_json column to store canonical source references
ALTER TABLE intent_messages
ADD COLUMN used_sources_json JSONB DEFAULT NULL;

-- Add used_sources_hash column for efficient lookups and deduplication
ALTER TABLE intent_messages
ADD COLUMN used_sources_hash TEXT DEFAULT NULL;

-- ========================================
-- Indexes
-- ========================================

-- Index on used_sources_hash for fast lookups
CREATE INDEX idx_intent_messages_sources_hash ON intent_messages(used_sources_hash)
WHERE used_sources_hash IS NOT NULL;

-- Index on session + role for finding assistant messages with sources
CREATE INDEX idx_intent_messages_session_assistant ON intent_messages(session_id, role)
WHERE role = 'assistant';

-- ========================================
-- Comments for documentation
-- ========================================

COMMENT ON COLUMN intent_messages.used_sources_json IS 
'Canonical array of SourceRef objects (file_snippet, github_issue, github_pr, afu9_artifact). Only populated for assistant messages.';

COMMENT ON COLUMN intent_messages.used_sources_hash IS 
'SHA256 hash of canonical used_sources_json for efficient deduplication and lookups.';
