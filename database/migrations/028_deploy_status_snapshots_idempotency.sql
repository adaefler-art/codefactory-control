-- AFU-9 E65.1: Deploy Status Monitor (Idempotency hardening)
-- Enforce at-most-one snapshot per (env, correlationKey, verificationRun.runId)
--
-- Notes:
-- - correlationKey is derived from signals.correlationId (camelCase) / signals.correlation_id (legacy)
--   and falls back to verificationRun.runId when correlationId is missing.
-- - runId is derived from signals.verificationRun.runId (camelCase) / signals.verification_run.run_id (legacy)
-- - We only enforce uniqueness when a runId exists.

-- 1) De-duplicate any existing rows that would violate the unique index.
WITH normalized AS (
  SELECT
    id,
    env,
    observed_at,
    created_at,
    COALESCE(
      signals #>> '{verificationRun,runId}',
      signals #>> '{verification_run,run_id}'
    ) AS run_id,
    COALESCE(
      signals->>'correlationId',
      signals->>'correlation_id',
      signals #>> '{verificationRun,runId}',
      signals #>> '{verification_run,run_id}'
    ) AS correlation_key
  FROM deploy_status_snapshots
), ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY env, correlation_key, run_id
      ORDER BY observed_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM normalized
  WHERE run_id IS NOT NULL AND correlation_key IS NOT NULL
)
DELETE FROM deploy_status_snapshots d
USING ranked r
WHERE d.id = r.id
  AND r.rn > 1;

-- 2) Create a unique index enforcing idempotency for verification-derived snapshots.
-- Uses IF NOT EXISTS for repeatable migrations in dev environments.
CREATE UNIQUE INDEX IF NOT EXISTS ux_deploy_status_snapshots_env_corr_run
ON deploy_status_snapshots (
  env,
  (
    COALESCE(
      signals->>'correlationId',
      signals->>'correlation_id',
      signals #>> '{verificationRun,runId}',
      signals #>> '{verification_run,run_id}'
    )
  ),
  (
    COALESCE(
      signals #>> '{verificationRun,runId}',
      signals #>> '{verification_run,run_id}'
    )
  )
)
WHERE (
  COALESCE(
    signals #>> '{verificationRun,runId}',
    signals #>> '{verification_run,run_id}'
  )
) IS NOT NULL;
