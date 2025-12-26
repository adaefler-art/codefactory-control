# Runbook: Purge AFU-9 Issues (STAGING ONLY)

This runbook describes how to preview and purge old/duplicate AFU-9 issues from the **staging** Postgres database.

## Safety guardrails

- **Never run against prod.** The script will refuse to run unless **either**:
  - `AFU9_STAGE=staging`, **or**
  - `NODE_ENV=staging`

- Default is **DryRun** (no deletes).
- Delete mode requires explicit `-Confirm`.
- Delete mode writes a JSON backup of deleted rows to `./artifacts/`.
- Deletion is chunked (500 rows per transaction).

## Confirmed schema

From DB migrations:
- Table: `afu9_issues`
  - Primary key: `id UUID`
  - Key columns used by purge filters: `title`, `status`, `source`, `created_at`
- Child table: `afu9_issue_events`
  - FK: `issue_id UUID REFERENCES afu9_issues(id) ON DELETE CASCADE`

Note: `publicId` is **not** a DB column; it’s derived from the UUID prefix (`LOWER(LEFT(id::text, 8))`).

## Prereqs

- Set staging gate env var:
  - PowerShell: `setx AFU9_STAGE "staging"` (new terminals) or `$env:AFU9_STAGE="staging"` (current session)

- Provide DB connection env vars (how you do this depends on your staging setup):
  - `DATABASE_HOST`
  - `DATABASE_PORT`
  - `DATABASE_NAME`
  - `DATABASE_USER`
  - `DATABASE_PASSWORD`

The script uses the Control Center DB helper ([control-center/src/lib/db.ts](../../control-center/src/lib/db.ts)).

## DryRun examples (recommended first)

From repo root:

- Preview issues older than 14 days:
  - `pwsh -File scripts/purge_issues_staging.ps1 -Mode DryRun -OlderThanDays 14`

Note: `-Source` defaults to `afu9`. Current DB migrations enforce `source='afu9'`, so source filtering usually won’t change results.

- Filter by status:
  - `pwsh -File scripts/purge_issues_staging.ps1 -Mode DryRun -OlderThanDays 30 -Status CREATED`

- Filter by title substring:
  - `pwsh -File scripts/purge_issues_staging.ps1 -Mode DryRun -OlderThanDays 30 -TitleContains "test"`

- Target a specific issue:
  - `pwsh -File scripts/purge_issues_staging.ps1 -Mode DryRun -OlderThanDays 0 -Id "<uuid>"`
  - `pwsh -File scripts/purge_issues_staging.ps1 -Mode DryRun -OlderThanDays 0 -PublicId "c300abd8"`

DryRun output includes:
- Total match count
- Sample (max 20): `id`, `publicId`, `title`, `status`, `created_at`

## Delete examples (staging only)

Deletes are chunked and backed up.

- Delete issues older than 30 days with title containing "test":
  - `pwsh -File scripts/purge_issues_staging.ps1 -Mode Delete -OlderThanDays 30 -TitleContains "test" -Confirm`

Artifacts:
- Backup file is written to `./artifacts/purge_issues_<timestamp>_<runId>.json`

## Verification

After delete, the script prints:
- initial matched count
- deleted count
- remaining matched count

It also attempts a bounded referential integrity check (if <= 5000 ids deleted) by counting remaining `afu9_issue_events` rows for deleted issue IDs.
