-- Migration 092: Clinical Intakes Table
-- Issue #10: Clinical Intake Synthesis (CRE-konform)
-- 
-- Creates table for storing clinical intake records with structured medical data
-- and human-readable clinical summaries.

-- Create clinical intakes table
CREATE TABLE IF NOT EXISTS clinical_intakes (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL,
    patient_identifier VARCHAR(100),
    
    -- Core outputs
    structured_intake JSONB NOT NULL,
    clinical_summary TEXT NOT NULL CHECK (char_length(clinical_summary) <= 5000),
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by VARCHAR(100),
    
    -- Versioning
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    previous_version_id UUID REFERENCES clinical_intakes(id),
    
    -- Constraints
    CONSTRAINT clinical_summary_not_empty CHECK (char_length(clinical_summary) > 0)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_clinical_intakes_session_id 
    ON clinical_intakes(session_id);

CREATE INDEX IF NOT EXISTS idx_clinical_intakes_created_at 
    ON clinical_intakes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_intakes_status 
    ON clinical_intakes((structured_intake->>'status'));

CREATE INDEX IF NOT EXISTS idx_clinical_intakes_version 
    ON clinical_intakes(session_id, version DESC);

-- Index for finding latest active intake per session
CREATE INDEX IF NOT EXISTS idx_clinical_intakes_latest_active 
    ON clinical_intakes(session_id, version DESC, created_at DESC)
    WHERE (structured_intake->>'status' IN ('draft', 'active'));

-- GIN index for JSONB queries on structured_intake
CREATE INDEX IF NOT EXISTS idx_clinical_intakes_structured_intake_gin 
    ON clinical_intakes USING GIN (structured_intake);

-- Comments for documentation
COMMENT ON TABLE clinical_intakes IS 
    'Clinical intake records with structured medical data and clinical summaries. Issue #10.';

COMMENT ON COLUMN clinical_intakes.id IS 
    'Unique identifier for this intake record';

COMMENT ON COLUMN clinical_intakes.session_id IS 
    'Associated conversation/session identifier';

COMMENT ON COLUMN clinical_intakes.patient_identifier IS 
    'De-identified patient reference (optional)';

COMMENT ON COLUMN clinical_intakes.structured_intake IS 
    'Machine-readable clinical data (STRUCTURED_INTAKE) as JSONB';

COMMENT ON COLUMN clinical_intakes.clinical_summary IS 
    'Doctor-readable clinical summary (CLINICAL_SUMMARY)';

COMMENT ON COLUMN clinical_intakes.version IS 
    'Version number for this intake (increments on updates)';

COMMENT ON COLUMN clinical_intakes.previous_version_id IS 
    'Reference to previous version if this is an update';
