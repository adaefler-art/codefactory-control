-- Migration 032: intent_context_packs
-- Issue E73.3: Context Pack Generator (audit JSON per session) + Export/Download
-- Creates table for storing immutable context pack snapshots

-- ========================================
-- INTENT Context Packs
-- ========================================
CREATE TABLE intent_context_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  pack_json JSONB NOT NULL,
  pack_hash TEXT NOT NULL,
  version TEXT NOT NULL,
  CONSTRAINT uniq_context_pack_hash UNIQUE (pack_hash, session_id)
);

-- Index on session_id for efficient lookup
CREATE INDEX idx_intent_context_packs_session_id ON intent_context_packs(session_id);

-- Index on pack_hash for deduplication checks
CREATE INDEX idx_intent_context_packs_hash ON intent_context_packs(pack_hash);

-- Index on created_at for ordering
CREATE INDEX idx_intent_context_packs_created_at ON intent_context_packs(created_at DESC);

-- ========================================
-- Comments for documentation
-- ========================================

COMMENT ON TABLE intent_context_packs IS 
'Immutable snapshots of INTENT sessions containing messages, used_sources, and metadata for audit/export purposes.';

COMMENT ON COLUMN intent_context_packs.pack_json IS 
'Complete context pack JSON following ContextPack schema v1. Includes session metadata, messages with used_sources, and derived hashes.';

COMMENT ON COLUMN intent_context_packs.pack_hash IS 
'SHA256 hash of canonical pack JSON (excluding generatedAt) for deterministic deduplication.';

COMMENT ON COLUMN intent_context_packs.version IS 
'Context pack schema version (e.g., "0.7.0") for forward compatibility.';
