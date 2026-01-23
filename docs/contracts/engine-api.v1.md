# Engine HTTP Contract v1

**Scope:** codefactory-engine HTTP API exposed under `/api/*`.

**Source of truth:** codefactory-control/docs/contracts/engine-api.v1.md

## Conventions
- **Request envelope** (for POST endpoints):
  - `schemaVersion` is the envelope version and is currently `"v1"`.
  - `requestId` is required and must be echoed in responses when present.
- **Response `schemaVersion`** is endpoint-specific (e.g., `engine.health.v1`).
- **Auth** is taken from `ENGINE_ENDPOINTS` where available.

## Endpoints

### 1) Health Check

**Purpose:** Return basic liveness information for the engine runtime.

**Method + Route:** `GET /api/health`

**Auth:** `public`

**Request:**
- Path: none
- Query: none
- Headers: TBD
- Body: none

**Response (example):**
```json
{
  "ok": true,
  "schemaVersion": "engine.health.v1",
  "service": "codefactory-engine",
  "version": "0.6.5",
  "commitSha": "abcdef123456",
  "time": "2026-01-21T12:34:56.789Z"
}
```

**Status Codes + Semantics:**
- `200`: Always returned; `ok=false` indicates a handler error.

**Determinism notes:**
- Deterministic for a given build + environment variables.

**Open Questions:**
- TBD: Align serverless vs. express response fields (optional fields may vary by runtime).

---

### 2) Readiness Check

**Purpose:** Indicate whether required engine dependencies/config are present.

**Method + Route:** `GET /api/ready`

**Auth:** `public`

**Request:**
- Path: none
- Query: none
- Headers: TBD
- Body: none

**Response (example):**
```json
{
  "ready": true,
  "configured": true,
  "missing": [],
  "schemaVersion": "engine.ready.v1"
}
```

**Status Codes + Semantics:**
- `200`: Ready check executed; `ready=true` means configuration is present.
- `503`: Readiness failure (e.g., missing required configuration or handler error).

**Determinism notes:**
- Depends on environment configuration at runtime.

**Open Questions:**
- TBD: Confirm the canonical required-env list across runtimes.

---

### 3) Status / Signals

**Purpose:** Return operational status and signal summary for the engine.

**Method + Route:** `GET /api/status`

**Auth:** `public`

**Request:**
- Path: none
- Query: none
- Headers: TBD
- Body: none

**Response (example):**
```json
{
  "schemaVersion": "engine.status.v1",
  "ok": true,
  "service": "codefactory-engine",
  "version": "0.6.5",
  "commitSha": "abcdef123456",
  "generatedAt": "2026-01-21T12:34:56.789Z",
  "degraded": false,
  "signals": {
    "runner": { "status": "unknown", "reason": "no_probe_configured", "lastProbeAt": null },
    "deploy": { "status": "unknown", "reason": "no_probe_configured", "lastProbeAt": null },
    "logs": { "status": "unknown", "reason": "no_probe_configured", "lastProbeAt": null }
  }
}
```

**Status Codes + Semantics:**
- `200`: Always returned; `ok=false` indicates a handler error.

**Determinism notes:**
- Deterministic for a given build + environment variables.

**Open Questions:**
- TBD: Clarify when `degraded` should become `true` based on signals.

---

### 4) Endpoint Catalog

**Purpose:** Return the current set of engine endpoints for discovery.

**Method + Route:** `GET /api/dev/endpoints`

**Auth:** `public`

**Request:**
- Path: none
- Query: none
- Headers: TBD
- Body: none

**Response (example):**
```json
{
  "success": true,
  "service": "codefactory-engine",
  "version": "0.6.5",
  "commitSha": "abcdef123456",
  "generatedAt": "2026-01-21T12:34:56.789Z",
  "baseUrl": "https://codefactory-engine.vercel.app",
  "schemaVersion": "engine.endpoints.v1",
  "count": 8,
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/health",
      "auth": "public",
      "notes": "Health check endpoint",
      "purpose": "Health check endpoint"
    }
  ]
}
```

**Status Codes + Semantics:**
- `200`: Always returned; errors fall back to an empty endpoint list.

**Determinism notes:**
- Deterministic for a given build (derived from `ENGINE_ENDPOINTS`).

**Open Questions:**
- TBD: Confirm whether `notes` or `purpose` should be canonical for endpoint descriptions.

---

### 5) Run Evidence

**Purpose:** Return deterministic evidence for an engine run.

**Method + Route:** `GET /api/engine/runs/{runId}/evidence`

**Auth:** `public`

**Request:**
- Path: `runId` (string)
- Query: none
- Headers: TBD
- Body: none

**Response (example):**
```json
{
  "schemaVersion": "engine.runEvidence.v1",
  "payload": {
    "version": "1.0.0",
    "deployStatus": "GREEN",
    "logs": [
      {
        "timestamp": "2026-01-19T14:00:00.000Z",
        "level": "info",
        "message": "Run 123 started"
      }
    ],
    "timestamps": {
      "created": "2026-01-19T14:00:00.000Z",
      "updated": "2026-01-19T14:30:00.000Z"
    },
    "evidenceHash": "<sha256>"
  }
}
```

**Status Codes + Semantics:**
- `200`: Evidence returned.
- `400`: `invalid_run_id`.

**Determinism notes:**
- Deterministic by `runId` (mock evidence is stable across calls).

**Open Questions:**
- TBD: Confirm how evidence data will be sourced in non-mock mode.

---

### 6) Repo List Tree

**Purpose:** List repository tree entries for a given ref.

**Method + Route:** `POST /api/repo/listTree`

**Auth:** `public`

**Request:**
- Path: none
- Query: none
- Headers: TBD
- Body (Envelope v1):
```json
{
  "schemaVersion": "v1",
  "requestId": "req-123",
  "payload": {
    "owner": "octo",
    "repo": "demo",
    "ref": "HEAD",
    "recursive": true,
    "maxEntries": 2000
  }
}
```

**Response (example):**
```json
{
  "schemaVersion": "engine.repo.listTree.v1",
  "requestId": "req-123",
  "payload": {
    "owner": "octo",
    "repo": "demo",
    "ref": "HEAD",
    "entries": [
      {
        "path": "README.md",
        "type": "blob",
        "sha": "abcdef",
        "size": 1234
      }
    ]
  }
}
```

**Status Codes + Semantics:**
- `200`: Successful response.
- Error cases: TBD (e.g., invalid envelope, repo not allowed, GitHub errors).

**Determinism notes:**
- Not strictly deterministic; depends on external GitHub state at request time.

**Open Questions:**
- TBD: Standardize error response envelope for GitHub failures.

---

### 7) Repo Read File

**Purpose:** Read file contents (base64) and metadata for a given path.

**Method + Route:** `POST /api/repo/readFile`

**Auth:** `public`

**Request:**
- Path: none
- Query: none
- Headers: TBD
- Body (Envelope v1):
```json
{
  "schemaVersion": "v1",
  "requestId": "req-456",
  "payload": {
    "owner": "octo",
    "repo": "demo",
    "ref": "HEAD",
    "path": "README.md",
    "range": { "start": 0, "endExclusive": 1024 }
  }
}
```

**Response (example):**
```json
{
  "schemaVersion": "engine.repo.readFile.v1",
  "requestId": "req-456",
  "payload": {
    "owner": "octo",
    "repo": "demo",
    "ref": "HEAD",
    "path": "README.md",
    "blobSha": "abcdef",
    "byteCount": 512,
    "sha256": "<sha256>",
    "contentBase64": "...",
    "range": { "start": 0, "endExclusive": 512 },
    "size": 4096
  }
}
```

**Status Codes + Semantics:**
- `200`: Successful response.
- Error cases: TBD (e.g., invalid range, repo not allowed, GitHub errors).

**Determinism notes:**
- Not strictly deterministic; depends on external GitHub state at request time.

**Open Questions:**
- TBD: Standardize error response envelope for invalid ranges or GitHub errors.

---

### 8) Repo Search Code

**Purpose:** Search repository code for a query string.

**Method + Route:** `POST /api/repo/searchCode`

**Auth:** `public`

**Request:**
- Path: none
- Query: none
- Headers: TBD
- Body (Envelope v1):
```json
{
  "schemaVersion": "v1",
  "requestId": "req-789",
  "payload": {
    "owner": "octo",
    "repo": "demo",
    "query": "TODO",
    "page": 1,
    "perPage": 30
  }
}
```

**Response (example):**
```json
{
  "schemaVersion": "engine.repo.searchCode.v1",
  "requestId": "req-789",
  "payload": {
    "owner": "octo",
    "repo": "demo",
    "query": "TODO",
    "page": 1,
    "perPage": 30,
    "totalCount": 42,
    "matches": [
      {
        "path": "src/index.ts",
        "sha": "abcdef",
        "fragments": ["// TODO: refactor"]
      }
    ]
  }
}
```

**Status Codes + Semantics:**
- `200`: Successful response.
- Error cases: TBD (e.g., repo not allowed, GitHub errors).

**Determinism notes:**
- Not strictly deterministic; depends on external GitHub search results at request time.

**Open Questions:**
- TBD: Standardize error response envelope for GitHub search failures.

---

## Open Questions (Global)
- TBD: Standard error envelope for non-200 responses across all endpoints.
- TBD: Canonical header requirements (e.g., tracing IDs).
