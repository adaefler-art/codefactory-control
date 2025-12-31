-- Migration 029: Timeline/Linkage Model (E72.1 / I721)
-- 
-- Adds normalized timeline + linkage graph for tracking:
-- Issue ↔ PR ↔ Run ↔ Deploy ↔ Verdict ↔ Artifact
--
-- Features:
-- - Deterministic node identity via (source_system, source_type, source_id)
-- - Idempotent ingestion via unique constraints
-- - Ordered timeline events
-- - Evidence/source tracking with hashes

-- ========================================
-- Table: timeline_nodes
-- ========================================

CREATE TABLE IF NOT EXISTS timeline_nodes (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Natural key components
  source_system TEXT NOT NULL CHECK (source_system IN ('github', 'afu9')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  
  -- Node type (constrained enum)
  node_type TEXT NOT NULL CHECK (node_type IN ('ISSUE', 'PR', 'RUN', 'DEPLOY', 'VERDICT', 'ARTIFACT', 'COMMENT')),
  
  -- Metadata
  title TEXT,
  url TEXT,
  payload_json JSONB DEFAULT '{}',
  
  -- Evidence fields
  lawbook_version TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint for natural key (enables idempotent upserts)
  CONSTRAINT uq_timeline_nodes_natural_key UNIQUE (source_system, source_type, source_id)
);

-- Indexes for timeline_nodes
CREATE INDEX IF NOT EXISTS timeline_nodes_node_type_idx ON timeline_nodes(node_type);
CREATE INDEX IF NOT EXISTS timeline_nodes_source_system_idx ON timeline_nodes(source_system);
CREATE INDEX IF NOT EXISTS timeline_nodes_created_at_idx ON timeline_nodes(created_at DESC);
CREATE INDEX IF NOT EXISTS timeline_nodes_updated_at_idx ON timeline_nodes(updated_at DESC);

-- ========================================
-- Table: timeline_edges
-- ========================================

CREATE TABLE IF NOT EXISTS timeline_edges (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Edge endpoints
  from_node_id UUID NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  
  -- Edge type (relationship)
  edge_type TEXT NOT NULL CHECK (edge_type IN (
    'ISSUE_HAS_PR',
    'PR_HAS_RUN',
    'RUN_HAS_DEPLOY',
    'DEPLOY_HAS_VERDICT',
    'ISSUE_HAS_ARTIFACT',
    'PR_HAS_ARTIFACT',
    'RUN_HAS_ARTIFACT',
    'ISSUE_HAS_COMMENT',
    'PR_HAS_COMMENT'
  )),
  
  -- Metadata
  payload_json JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate edges (enables idempotent inserts)
  CONSTRAINT uq_timeline_edges_relationship UNIQUE (from_node_id, to_node_id, edge_type)
);

-- Indexes for timeline_edges
CREATE INDEX IF NOT EXISTS timeline_edges_from_node_idx ON timeline_edges(from_node_id);
CREATE INDEX IF NOT EXISTS timeline_edges_to_node_idx ON timeline_edges(to_node_id);
CREATE INDEX IF NOT EXISTS timeline_edges_edge_type_idx ON timeline_edges(edge_type);
CREATE INDEX IF NOT EXISTS timeline_edges_created_at_idx ON timeline_edges(created_at DESC);

-- ========================================
-- Table: timeline_events
-- ========================================

CREATE TABLE IF NOT EXISTS timeline_events (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Associated node
  node_id UUID NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  
  -- Event details
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  
  -- Payload
  payload_json JSONB DEFAULT '{}',
  
  -- Source reference
  source_ref TEXT,
  
  -- Timestamps (insertion time)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for timeline_events (deterministic ordering)
CREATE INDEX IF NOT EXISTS timeline_events_node_id_idx ON timeline_events(node_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS timeline_events_occurred_at_idx ON timeline_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS timeline_events_event_type_idx ON timeline_events(event_type);

-- ========================================
-- Table: timeline_sources
-- ========================================

CREATE TABLE IF NOT EXISTS timeline_sources (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Associated node
  node_id UUID NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  
  -- Source kind
  source_kind TEXT NOT NULL CHECK (source_kind IN ('github_api', 'github_web', 'afu9_db', 'artifact')),
  
  -- Reference (JSON with url/path/sha/snippetHash/runId/deployId etc.)
  ref_json JSONB NOT NULL,
  
  -- Evidence hashes
  sha256 TEXT,
  content_hash TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for timeline_sources
CREATE INDEX IF NOT EXISTS timeline_sources_node_id_idx ON timeline_sources(node_id);
CREATE INDEX IF NOT EXISTS timeline_sources_source_kind_idx ON timeline_sources(source_kind);
CREATE INDEX IF NOT EXISTS timeline_sources_sha256_idx ON timeline_sources(sha256) WHERE sha256 IS NOT NULL;

-- ========================================
-- Trigger: Update timestamp on timeline_nodes
-- ========================================

CREATE OR REPLACE FUNCTION update_timeline_node_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_timeline_node_timestamp
  BEFORE UPDATE ON timeline_nodes
  FOR EACH ROW
  EXECUTE FUNCTION update_timeline_node_timestamp();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE timeline_nodes IS 'Generic timeline node table for Issue/PR/Run/Deploy/Verdict/Artifact tracking';
COMMENT ON TABLE timeline_edges IS 'Links between timeline nodes with idempotent relationship constraints';
COMMENT ON TABLE timeline_events IS 'Ordered events attached to timeline nodes';
COMMENT ON TABLE timeline_sources IS 'Evidence and source references for timeline nodes';

COMMENT ON COLUMN timeline_nodes.source_system IS 'Source system: github or afu9';
COMMENT ON COLUMN timeline_nodes.source_type IS 'Source type: issue, pull_request, run, deploy_event, verdict, artifact';
COMMENT ON COLUMN timeline_nodes.source_id IS 'Stable external ID (GitHub issue number/node_id, AFU-9 runId)';
COMMENT ON COLUMN timeline_nodes.lawbook_version IS 'Lawbook version if applicable (nullable)';

COMMENT ON COLUMN timeline_edges.edge_type IS 'Relationship type between nodes';
COMMENT ON CONSTRAINT uq_timeline_edges_relationship ON timeline_edges IS 'Ensures idempotent edge creation - no duplicate relationships';

COMMENT ON COLUMN timeline_events.occurred_at IS 'Event occurrence timestamp (for deterministic ordering)';
COMMENT ON CONSTRAINT uq_timeline_nodes_natural_key ON timeline_nodes IS 'Ensures idempotent node creation via natural key';

COMMENT ON COLUMN timeline_sources.ref_json IS 'JSON reference with url/path/sha/snippetHash/runId/deployId etc.';
COMMENT ON COLUMN timeline_sources.sha256 IS 'SHA256 hash for evidence verification';
