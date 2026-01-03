-- Migration 037: Incident Schema (E76.1 / I761)
-- 
-- Canonical incident schema for self-debugging, capturing:
-- - Sources + evidence + classification + lifecycle status
-- - Idempotent ingestion via unique incident_key
-- - Lawbook version tracking for transparency
-- - Linkage to timeline nodes for correlation
--
-- Features:
-- - Deterministic IDs, stable timestamps, stable ordering
-- - Evidence-first: references + hashes, not secrets
-- - Compatible with Deploy Status Monitor (GREEN/YELLOW/RED)
-- - Compatible with E65.2 verification outputs

-- ========================================
-- Table: incidents
-- ========================================

CREATE TABLE IF NOT EXISTS incidents (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Idempotency key (deterministic, stable)
  -- Format examples:
  --   deploy_status:<env>:<deployId>:<statusAt>
  --   verification:<deployId>:<reportHash>
  --   ecs_stopped:<cluster>:<taskArn>:<stoppedAt>
  --   runner:<runId>:<stepName>:<conclusion>
  incident_key TEXT NOT NULL,
  
  -- Severity: YELLOW (warning) or RED (critical)
  severity TEXT NOT NULL CHECK (severity IN ('YELLOW', 'RED')),
  
  -- Status: lifecycle state
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKED', 'MITIGATED', 'CLOSED')),
  
  -- Title and summary
  title TEXT NOT NULL,
  summary TEXT,
  
  -- Classification (filled by I763 classifier)
  -- Example: {"category": "deploy_failure", "confidence": 0.95, "tags": ["ecs", "timeout"]}
  classification JSONB,
  
  -- Lawbook version for transparency
  -- Nullable for legacy, required going forward
  lawbook_version TEXT,
  
  -- Primary source signal
  -- Example: {"kind": "deploy_status", "ref": {"env": "prod", "deployId": "..."}}
  -- Example: {"kind": "verification", "ref": {"runId": "...", "playbookId": "..."}}
  -- Example: {"kind": "ecs_event", "ref": {"cluster": "...", "taskArn": "..."}}
  -- Example: {"kind": "runner", "ref": {"runId": "...", "step": "..."}}
  source_primary JSONB NOT NULL,
  
  -- Tags for filtering/grouping
  tags TEXT[] NOT NULL DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uq_incidents_key UNIQUE (incident_key),
  CONSTRAINT valid_source_primary CHECK (jsonb_typeof(source_primary) = 'object'),
  CONSTRAINT valid_classification CHECK (classification IS NULL OR jsonb_typeof(classification) = 'object')
);

-- Indexes for incidents
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents(status);
CREATE INDEX IF NOT EXISTS incidents_severity_idx ON incidents(severity);
CREATE INDEX IF NOT EXISTS incidents_last_seen_at_idx ON incidents(last_seen_at DESC, id);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_tags_idx ON incidents USING GIN(tags);
CREATE INDEX IF NOT EXISTS incidents_lawbook_version_idx ON incidents(lawbook_version) WHERE lawbook_version IS NOT NULL;

-- ========================================
-- Table: incident_evidence
-- ========================================

CREATE TABLE IF NOT EXISTS incident_evidence (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to incident
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  
  -- Evidence kind
  kind TEXT NOT NULL CHECK (kind IN (
    'runner',
    'ecs',
    'alb',
    'http',
    'verification',
    'deploy_status',
    'log_pointer',
    'github_run'
  )),
  
  -- Reference (pointers: runId, taskArn, logGroup/stream, url, snippetHash, etc.)
  -- Example: {"runId": "...", "step": "...", "url": "..."}
  -- Example: {"taskArn": "...", "cluster": "...", "stoppedReason": "..."}
  -- Example: {"logGroup": "...", "logStream": "...", "snippetHash": "..."}
  ref JSONB NOT NULL,
  
  -- SHA256 hash (if evidence has a hash for deduplication)
  sha256 TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_ref CHECK (jsonb_typeof(ref) = 'object')
);

-- Indexes for incident_evidence
CREATE INDEX IF NOT EXISTS incident_evidence_incident_id_idx ON incident_evidence(incident_id);
CREATE INDEX IF NOT EXISTS incident_evidence_kind_idx ON incident_evidence(kind);
CREATE INDEX IF NOT EXISTS incident_evidence_sha256_idx ON incident_evidence(sha256) WHERE sha256 IS NOT NULL;

-- Idempotency constraint for evidence: prevent duplicate evidence based on (incident_id, kind, sha256)
-- If sha256 is null, allow multiple entries (different refs can exist for same kind without hash)
CREATE UNIQUE INDEX IF NOT EXISTS incident_evidence_idempotency_idx 
  ON incident_evidence(incident_id, kind, sha256) 
  WHERE sha256 IS NOT NULL;

-- ========================================
-- Table: incident_links
-- ========================================

CREATE TABLE IF NOT EXISTS incident_links (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign keys
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  timeline_node_id UUID NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  
  -- Link type
  link_type TEXT NOT NULL CHECK (link_type IN (
    'TRIGGERED_BY',
    'RELATED_TO',
    'CAUSED_BY',
    'REMEDIATED_BY'
  )),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate links
  CONSTRAINT uq_incident_links_tuple UNIQUE (incident_id, timeline_node_id, link_type)
);

-- Indexes for incident_links
CREATE INDEX IF NOT EXISTS incident_links_incident_id_idx ON incident_links(incident_id);
CREATE INDEX IF NOT EXISTS incident_links_timeline_node_id_idx ON incident_links(timeline_node_id);
CREATE INDEX IF NOT EXISTS incident_links_link_type_idx ON incident_links(link_type);

-- ========================================
-- Table: incident_events
-- ========================================

CREATE TABLE IF NOT EXISTS incident_events (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to incident
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  
  -- Event type
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CREATED',
    'UPDATED',
    'CLASSIFIED',
    'REMEDIATION_STARTED',
    'REMEDIATION_DONE',
    'CLOSED'
  )),
  
  -- Payload (optional metadata)
  payload JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_payload CHECK (jsonb_typeof(payload) = 'object')
);

-- Indexes for incident_events
CREATE INDEX IF NOT EXISTS incident_events_incident_id_idx ON incident_events(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS incident_events_event_type_idx ON incident_events(event_type);
CREATE INDEX IF NOT EXISTS incident_events_created_at_idx ON incident_events(created_at DESC);

-- ========================================
-- Trigger: Update timestamp on incidents
-- ========================================

CREATE OR REPLACE FUNCTION update_incident_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_incident_timestamp
  BEFORE UPDATE ON incidents
  FOR EACH ROW
  EXECUTE FUNCTION update_incident_timestamp();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE incidents IS 'Canonical incident schema for self-debugging (E76.1/I761)';
COMMENT ON COLUMN incidents.incident_key IS 'Idempotency key derived from primary signal + stable identifiers';
COMMENT ON COLUMN incidents.severity IS 'YELLOW (warning) or RED (critical) - aligned with Deploy Status Monitor';
COMMENT ON COLUMN incidents.status IS 'Lifecycle state: OPEN, ACKED, MITIGATED, CLOSED';
COMMENT ON COLUMN incidents.classification IS 'Filled by I763 classifier: category, confidence, tags';
COMMENT ON COLUMN incidents.lawbook_version IS 'Lawbook version for transparency (nullable for legacy)';
COMMENT ON COLUMN incidents.source_primary IS 'Primary source signal reference (kind + ref)';
COMMENT ON COLUMN incidents.first_seen_at IS 'When this incident was first observed';
COMMENT ON COLUMN incidents.last_seen_at IS 'When this incident was last observed (updated on upsert)';

COMMENT ON TABLE incident_evidence IS 'Evidence items linked to incidents';
COMMENT ON COLUMN incident_evidence.kind IS 'Evidence kind: runner, ecs, alb, http, verification, deploy_status, log_pointer, github_run';
COMMENT ON COLUMN incident_evidence.ref IS 'JSON reference: runId, taskArn, logGroup/stream, url, snippetHash, etc.';
COMMENT ON COLUMN incident_evidence.sha256 IS 'SHA256 hash for evidence deduplication (nullable)';

COMMENT ON TABLE incident_links IS 'Links between incidents and timeline nodes';
COMMENT ON COLUMN incident_links.link_type IS 'Relationship type: TRIGGERED_BY, RELATED_TO, CAUSED_BY, REMEDIATED_BY';

COMMENT ON TABLE incident_events IS 'Event log for incident lifecycle';
COMMENT ON COLUMN incident_events.event_type IS 'Event type: CREATED, UPDATED, CLASSIFIED, REMEDIATION_STARTED, REMEDIATION_DONE, CLOSED';
