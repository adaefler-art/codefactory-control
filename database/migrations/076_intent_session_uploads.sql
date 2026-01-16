-- Migration 076: INTENT Session Uploads
-- Issue V09-I06: Upload + Sources Management (Product Memory Basis)
-- Creates table for storing uploaded files metadata with S3 references

-- ========================================
-- INTENT Session Uploads
-- ========================================
CREATE TABLE intent_session_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  storage_key VARCHAR(512) NOT NULL, -- S3 key or filesystem path
  content_sha256 VARCHAR(64) NOT NULL, -- SHA256 hash of file content
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata_json JSONB DEFAULT NULL, -- Additional metadata (dimensions for images, etc.)
  CONSTRAINT chk_upload_content_type CHECK (
    content_type IN (
      'application/pdf',
      'text/markdown',
      'text/plain',
      'application/json',
      'image/png',
      'image/jpeg'
    )
  )
);

-- ========================================
-- Indexes
-- ========================================

-- Index for finding all uploads in a session (main access pattern)
CREATE INDEX idx_intent_session_uploads_session_id 
  ON intent_session_uploads(session_id);

-- Index for finding uploads by hash (deduplication check)
CREATE INDEX idx_intent_session_uploads_hash 
  ON intent_session_uploads(content_sha256);

-- Index for finding uploads by creation time (chronological ordering)
CREATE INDEX idx_intent_session_uploads_created_at 
  ON intent_session_uploads(session_id, created_at DESC);

-- Unique constraint to prevent duplicate uploads in same session
CREATE UNIQUE INDEX uniq_intent_session_upload_hash 
  ON intent_session_uploads(session_id, content_sha256);

-- ========================================
-- Comments for documentation
-- ========================================

COMMENT ON TABLE intent_session_uploads IS 
'Metadata for files uploaded to INTENT sessions. Files stored in S3 with key referenced in storage_key. Cascade deletes when session is deleted.';

COMMENT ON COLUMN intent_session_uploads.storage_key IS 
'S3 key or filesystem path where file content is stored. Format: {sessionId}/{uploadId}/{filename}';

COMMENT ON COLUMN intent_session_uploads.content_sha256 IS 
'SHA256 hash of file content for deduplication and integrity verification.';

COMMENT ON COLUMN intent_session_uploads.metadata_json IS 
'Optional additional metadata. For images: width, height. For documents: page count, etc.';
