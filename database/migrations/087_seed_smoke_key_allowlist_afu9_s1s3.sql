-- Migration: Seed smoke-key allowlist for AFU9 S1-S3 smoke routes (E9.1)
-- Purpose: Allow smoke-key bypass for AFU9 S1-S3 proof routes in stage
-- Security: Fail-closed; only adds explicit allowlist entries

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '/api/afu9/s1s3/issues/pick', 'POST', false, 'AFU9 S1S3 pick issue (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '/api/afu9/s1s3/issues/pick' AND method = 'POST' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '/api/afu9/github/issues', 'GET', false, 'AFU9 GitHub issues list (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '/api/afu9/github/issues' AND method = 'GET' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '/api/afu9/s1s3/issues', 'GET', false, 'AFU9 S1S3 issues list (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '/api/afu9/s1s3/issues' AND method = 'GET' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '^/api/afu9/s1s3/issues/[^/]+$', 'GET', true, 'AFU9 S1S3 issue detail (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '^/api/afu9/s1s3/issues/[^/]+$' AND method = 'GET' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '^/api/afu9/s1s3/issues/[^/]+/spec$', 'POST', true, 'AFU9 S1S3 issue spec (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '^/api/afu9/s1s3/issues/[^/]+/spec$' AND method = 'POST' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '^/api/afu9/s1s3/issues/[^/]+/implement$', 'POST', true, 'AFU9 S1S3 issue implement (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '^/api/afu9/s1s3/issues/[^/]+/implement$' AND method = 'POST' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '^/api/afu9/s1s3/prs/[^/]+/checks$', 'GET', true, 'AFU9 S1S3 PR checks (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '^/api/afu9/s1s3/prs/[^/]+/checks$' AND method = 'GET' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '^/api/loop/issues/[^/]+/run-next-step$', 'POST', true, 'AFU9 loop run-next-step (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '^/api/loop/issues/[^/]+/run-next-step$' AND method = 'POST' AND removed_at IS NULL
);

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by)
SELECT '^/api/loop/issues/[^/]+/events$', 'GET', true, 'AFU9 loop issue events (E9.1 smoke)', 'system:migration:087'
WHERE NOT EXISTS (
  SELECT 1 FROM smoke_key_allowlist
  WHERE route_pattern = '^/api/loop/issues/[^/]+/events$' AND method = 'GET' AND removed_at IS NULL
);

-- Verification
-- SELECT route_pattern, method, is_regex FROM smoke_key_allowlist
-- WHERE removed_at IS NULL AND added_by = 'system:migration:087'
-- ORDER BY route_pattern, method;
