/**
 * DB Repair Registry - Canonical registry of approved DB repair playbooks
 * 
 * Issue: E86.5 - Staging DB Repair Mechanism
 * 
 * Registry Properties:
 * - Deterministic: Stable-sorted by repairId
 * - Idempotent: All SQL is CREATE IF NOT EXISTS, no DROP
 * - Audited: Each playbook has SHA-256 hash of canonical SQL
 * - Stage-only: All repairs are staging-only
 * - Fail-closed: Hash verification required for execution
 */

import { createHash } from 'crypto';
import { DbRepairPlaybook } from '../contracts/db-repair';

/**
 * Maximum length for SQL statement display (for preview/logs)
 */
export const MAX_SQL_DISPLAY_LENGTH = 500;

/**
 * Truncate SQL statement for display
 */
export function truncateSqlForDisplay(sql: string): string {
  if (sql.length <= MAX_SQL_DISPLAY_LENGTH) {
    return sql;
  }
  return sql.substring(0, MAX_SQL_DISPLAY_LENGTH) + '...';
}

/**
 * Compute SHA-256 hash of SQL statements (canonical form)
 */
function computeSqlHash(sql: string[]): string {
  const canonical = sql.join('\n').trim();
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * R-DB-INTENT-AUTH-EVENTS-001
 * Ensure intent_issue_authoring_events table exists with indexes and triggers
 */
const REPAIR_INTENT_AUTH_EVENTS: DbRepairPlaybook = {
  repairId: 'R-DB-INTENT-AUTH-EVENTS-001',
  description: 'Ensure intent_issue_authoring_events table with indexes and append-only triggers',
  stageOnly: true,
  requiresAdmin: true,
  version: '1.0.0',
  requiredTablesBefore: [],
  requiredTablesAfter: ['intent_issue_authoring_events'],
  sql: [
    `CREATE TABLE IF NOT EXISTS intent_issue_authoring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  session_id UUID,
  sub TEXT NOT NULL,
  action TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  lawbook_version TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  params_json JSONB,
  result_json JSONB,
  CONSTRAINT chk_intent_authoring_action CHECK (
    action IN ('draft_save', 'draft_validate', 'draft_commit', 'issue_set_generate', 'issue_set_export')
  )
)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_request_id ON intent_issue_authoring_events(request_id)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_session_id ON intent_issue_authoring_events(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_sub ON intent_issue_authoring_events(sub)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_action ON intent_issue_authoring_events(action)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_created_at ON intent_issue_authoring_events(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_session_action ON intent_issue_authoring_events(session_id, action, created_at DESC)`,
    `CREATE OR REPLACE FUNCTION prevent_intent_authoring_events_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_issue_authoring_events is append-only: UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'prevent_update_intent_authoring_events'
  ) THEN
    CREATE TRIGGER prevent_update_intent_authoring_events
      BEFORE UPDATE ON intent_issue_authoring_events
      FOR EACH ROW
      EXECUTE FUNCTION prevent_intent_authoring_events_modification();
  END IF;
END $$`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'prevent_delete_intent_authoring_events'
  ) THEN
    CREATE TRIGGER prevent_delete_intent_authoring_events
      BEFORE DELETE ON intent_issue_authoring_events
      FOR EACH ROW
      EXECUTE FUNCTION prevent_intent_authoring_events_modification();
  END IF;
END $$`,
  ],
  hash: '', // Computed below
};

/**
 * R-DB-INTENT-DRAFTS-001
 * Ensure intent_issue_drafts and intent_issue_sets tables exist
 */
const REPAIR_INTENT_DRAFTS: DbRepairPlaybook = {
  repairId: 'R-DB-INTENT-DRAFTS-001',
  description: 'Ensure intent_issue_drafts and intent_issue_sets tables',
  stageOnly: true,
  requiresAdmin: true,
  version: '1.0.0',
  requiredTablesBefore: [],
  requiredTablesAfter: ['intent_issue_drafts', 'intent_issue_sets'],
  sql: [
    `CREATE TABLE IF NOT EXISTS intent_issue_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  draft_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_intent_draft_status CHECK (
    status IN ('DRAFT', 'VALIDATED', 'COMMITTED')
  )
)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_issue_drafts_session_id ON intent_issue_drafts(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_issue_drafts_status ON intent_issue_drafts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_issue_drafts_created_at ON intent_issue_drafts(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS intent_issue_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  set_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  issues_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'GENERATED',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_intent_set_status CHECK (
    status IN ('GENERATED', 'EXPORTED')
  )
)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_issue_sets_session_id ON intent_issue_sets(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_issue_sets_status ON intent_issue_sets(status)`,
    `CREATE INDEX IF NOT EXISTS idx_intent_issue_sets_created_at ON intent_issue_sets(created_at DESC)`,
  ],
  hash: '', // Computed below
};

/**
 * R-DB-MIGRATIONS-LEDGER-001
 * Ensure afu9_migrations_ledger table exists
 */
const REPAIR_MIGRATIONS_LEDGER: DbRepairPlaybook = {
  repairId: 'R-DB-MIGRATIONS-LEDGER-001',
  description: 'Ensure afu9_migrations_ledger table exists (no history rewriting)',
  stageOnly: true,
  requiresAdmin: true,
  version: '1.0.0',
  requiredTablesBefore: [],
  requiredTablesAfter: ['afu9_migrations_ledger'],
  sql: [
    `CREATE TABLE IF NOT EXISTS afu9_migrations_ledger (
  filename TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_by TEXT NOT NULL,
  runner_version TEXT NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS idx_afu9_migrations_ledger_applied_at ON afu9_migrations_ledger(applied_at DESC)`,
    `CREATE OR REPLACE FUNCTION prevent_afu9_migrations_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'afu9_migrations_ledger is append-only: UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'prevent_update_afu9_migrations_ledger'
  ) THEN
    CREATE TRIGGER prevent_update_afu9_migrations_ledger
      BEFORE UPDATE ON afu9_migrations_ledger
      FOR EACH ROW
      EXECUTE FUNCTION prevent_afu9_migrations_ledger_modification();
  END IF;
END $$`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'prevent_delete_afu9_migrations_ledger'
  ) THEN
    CREATE TRIGGER prevent_delete_afu9_migrations_ledger
      BEFORE DELETE ON afu9_migrations_ledger
      FOR EACH ROW
      EXECUTE FUNCTION prevent_afu9_migrations_ledger_modification();
  END IF;
END $$`,
  ],
  hash: '', // Computed below
};

// Compute hashes
REPAIR_INTENT_AUTH_EVENTS.hash = computeSqlHash(REPAIR_INTENT_AUTH_EVENTS.sql);
REPAIR_INTENT_DRAFTS.hash = computeSqlHash(REPAIR_INTENT_DRAFTS.sql);
REPAIR_MIGRATIONS_LEDGER.hash = computeSqlHash(REPAIR_MIGRATIONS_LEDGER.sql);

/**
 * Registry of all approved repair playbooks
 * Stable-sorted by repairId for deterministic output
 */
const ALL_REPAIRS: DbRepairPlaybook[] = [
  REPAIR_INTENT_AUTH_EVENTS,
  REPAIR_INTENT_DRAFTS,
  REPAIR_MIGRATIONS_LEDGER,
].sort((a, b) => a.repairId.localeCompare(b.repairId));

/**
 * Get all repair playbooks (stable-sorted)
 */
export function getAllRepairPlaybooks(): DbRepairPlaybook[] {
  return [...ALL_REPAIRS];
}

/**
 * Get repair playbook by ID
 */
export function getRepairPlaybook(repairId: string): DbRepairPlaybook | null {
  return ALL_REPAIRS.find(r => r.repairId === repairId) || null;
}

/**
 * Validate repair hash matches expected
 */
export function validateRepairHash(repairId: string, expectedHash: string): boolean {
  const playbook = getRepairPlaybook(repairId);
  if (!playbook) return false;
  return playbook.hash === expectedHash;
}
