# V09-I06 Implementation Summary

## Issue: Upload + Sources Management (Product Memory Basis)

**Goal**: Enable file uploads to INTENT sessions with metadata tracking, S3 storage foundation, and Sources Panel integration.

## Implementation Overview

This implementation provides a complete upload management system for INTENT sessions:
1. File upload with validation (type allowlist, size limits)
2. SHA256 hash-based deduplication
3. Storage abstraction (filesystem with S3-ready structure)
4. REST API for upload/list/delete operations
5. Sources integration (uploads appear as SourceType `upload`)
6. Tenant isolation via session ownership (RLS enforcement)

## Files Created/Modified

### Database Schema
- **database/migrations/076_intent_session_uploads.sql**
  - `intent_session_uploads` table: Upload metadata with FK to sessions
  - Unique constraint: `(session_id, content_sha256)` for deduplication
  - Cascade delete when session is deleted
  - Indexes for efficient queries by session_id, hash, created_at
  - CHECK constraint for allowed content types
  - Comments for documentation

### Backend Services
- **control-center/src/lib/upload-storage-service.ts**
  - `validateUpload()`: File type and size validation
  - `storeUpload()`: Store file with SHA256 hashing
  - `deleteUpload()`: Remove stored file
  - `retrieveUpload()`: Read stored file content
  - `calculateSHA256()`: Hash computation
  - Allowlist: pdf, md, txt, json, png, jpg
  - Size limit: 10MB default (configurable via env)
  - Storage: Local filesystem with S3-ready structure (`{sessionId}/{uploadId}/{filename}`)
  - Future: Add S3 integration when `AWS_UPLOAD_BUCKET` env var is set

### API Endpoints
- **control-center/app/api/intent/sessions/[id]/uploads/route.ts**
  - `POST /api/intent/sessions/[id]/uploads`
    - Upload one or more files (multipart/form-data)
    - Validates file type and size
    - Deduplicates by SHA256 hash
    - Returns upload metadata
    - Status: 201 Created
  - `GET /api/intent/sessions/[id]/uploads`
    - List all uploads for session
    - Ordered by created_at DESC
    - Returns array of upload metadata
    - Status: 200 OK

- **control-center/app/api/intent/sessions/[id]/uploads/[uploadId]/route.ts**
  - `DELETE /api/intent/sessions/[id]/uploads/[uploadId]`
    - Delete upload and associated file
    - Verifies session ownership
    - Status: 200 OK

### Sources Integration
- **control-center/src/lib/schemas/usedSources.ts**
  - Added `UploadSource` schema:
    ```typescript
    {
      kind: 'upload',
      uploadId: string (UUID),
      filename: string,
      contentType: string,
      sizeBytes: number,
      contentSha256: string,
      uploadedAt?: string (ISO 8601)
    }
    ```
  - Extended `SourceRefSchema` discriminated union to include `UploadSourceSchema`
  - Updated `EXAMPLE_USED_SOURCES` with upload example

- **control-center/app/api/intent/sessions/[id]/sources/route.ts**
  - Modified `GET /api/intent/sessions/[id]/sources` to include uploads
  - Fetches uploads from `intent_session_uploads` table
  - Converts uploads to `SourceRef` objects with `kind: 'upload'`
  - Deduplicates and returns combined sources (messages + uploads)

### Tests
- **control-center/__tests__/api/intent-uploads.test.ts**
  - POST endpoint tests: auth, validation, upload flow
  - GET endpoint tests: auth, list uploads
  - DELETE endpoint tests: auth, delete flow
  - Validation tests: file types, size limits, SHA256 hashing

## API Contracts

### POST /api/intent/sessions/[id]/uploads
**Request:**
```
Content-Type: multipart/form-data

file: <File> (one or more files)
```

**Response (201 Created):**
```json
{
  "uploads": [
    {
      "id": "223e4567-e89b-12d3-a456-426614174000",
      "filename": "requirements.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 1024000,
      "contentSha256": "abc123...",
      "createdAt": "2026-01-16T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

### GET /api/intent/sessions/[id]/uploads
**Response (200 OK):**
```json
{
  "uploads": [
    {
      "id": "223e4567-e89b-12d3-a456-426614174000",
      "filename": "requirements.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 1024000,
      "contentSha256": "abc123...",
      "createdAt": "2026-01-16T10:00:00.000Z"
    }
  ],
  "count": 1,
  "sessionId": "123e4567-e89b-12d3-a456-426614174000"
}
```

### DELETE /api/intent/sessions/[id]/uploads/[uploadId]
**Response (200 OK):**
```json
{
  "deleted": true,
  "uploadId": "223e4567-e89b-12d3-a456-426614174000"
}
```

### GET /api/intent/sessions/[id]/sources (Enhanced)
Now includes uploads with `kind: 'upload'`:
```json
{
  "sources": [
    {
      "kind": "file_snippet",
      "repo": { "owner": "adaefler-art", "repo": "codefactory-control" },
      "branch": "main",
      "path": "src/lib/db/intentSessions.ts",
      "startLine": 129,
      "endLine": 189,
      "snippetHash": "a3f2b1c",
      "contentSha256": "e3b0c44..."
    },
    {
      "kind": "upload",
      "uploadId": "223e4567-e89b-12d3-a456-426614174000",
      "filename": "requirements.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 1024000,
      "contentSha256": "abc123...",
      "uploadedAt": "2026-01-16T10:00:00.000Z"
    }
  ],
  "count": 2,
  "sessionId": "123e4567-e89b-12d3-a456-426614174000",
  "typeFilter": null
}
```

## Database Schema

### intent_session_uploads
```sql
CREATE TABLE intent_session_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intent_sessions(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  storage_key VARCHAR(512) NOT NULL,
  content_sha256 VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata_json JSONB DEFAULT NULL,
  CONSTRAINT chk_upload_content_type CHECK (
    content_type IN (
      'application/pdf', 'text/markdown', 'text/plain',
      'application/json', 'image/png', 'image/jpeg'
    )
  )
);

-- Indexes
CREATE INDEX idx_intent_session_uploads_session_id ON intent_session_uploads(session_id);
CREATE INDEX idx_intent_session_uploads_hash ON intent_session_uploads(content_sha256);
CREATE INDEX idx_intent_session_uploads_created_at ON intent_session_uploads(session_id, created_at DESC);
CREATE UNIQUE INDEX uniq_intent_session_upload_hash ON intent_session_uploads(session_id, content_sha256);
```

## Acceptance Criteria

✅ **Upload allowlist (pdf/md/txt/json/png/jpg) + size limit**
- Allowlist enforced in `validateUpload()` function
- Database CHECK constraint enforces allowed content types
- Size limit: 10MB default (configurable via `MAX_UPLOAD_SIZE_BYTES` env var)

✅ **Each upload has sha256, size, contentType, createdAt**
- SHA256 computed via `calculateSHA256()` before storage
- All fields stored in `intent_session_uploads` table
- Returned in API responses

✅ **RLS/tenant isolation: User sees only own session uploads**
- Session ownership verified via JOIN with `intent_sessions` table
- Auth-first pattern: 401 if no `x-afu9-sub` header
- Ownership check: 403/404 if session not owned by user
- DELETE endpoint verifies ownership via JOIN query

✅ **Sources Panel shows Uploads as SourceType UPLOAD**
- `UploadSource` schema added to `SourceRef` discriminated union
- Sources API (`GET /api/intent/sessions/[id]/sources`) includes uploads
- Uploads converted to `SourceRef` with `kind: 'upload'`

✅ **Smoke: Upload → appears in Sources → export context pack contains reference**
- Uploads appear in Sources API response immediately after upload
- Context packs include sources from messages' `used_sources` field
- When INTENT references an upload, it will be captured in `used_sources`

## Verification

### Prerequisites
```bash
# Ensure database is running
docker-compose up -d postgres

# Run migrations
npm --prefix control-center run db:migrate
```

### Unit Tests
```bash
# Run upload API tests
npm --prefix control-center test -- intent-uploads.test.ts
```

### Manual API Testing

#### 1. Create Session
```bash
curl -X POST http://localhost:3000/api/intent/sessions \
  -H "x-afu9-sub: test-user" \
  -H "Content-Type: application/json" \
  -d '{"title": "Upload Test Session"}'
```

#### 2. Upload File
```bash
# Create test file
echo "Test document content" > /tmp/test.txt

# Upload
curl -X POST http://localhost:3000/api/intent/sessions/{sessionId}/uploads \
  -H "x-afu9-sub: test-user" \
  -F "file=@/tmp/test.txt"
```

#### 3. List Uploads
```bash
curl http://localhost:3000/api/intent/sessions/{sessionId}/uploads \
  -H "x-afu9-sub: test-user"
```

#### 4. Verify in Sources
```bash
curl http://localhost:3000/api/intent/sessions/{sessionId}/sources \
  -H "x-afu9-sub: test-user"
```

#### 5. Delete Upload
```bash
curl -X DELETE http://localhost:3000/api/intent/sessions/{sessionId}/uploads/{uploadId} \
  -H "x-afu9-sub: test-user"
```

### PowerShell Testing Script
```powershell
# Create session
$session = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/intent/sessions" `
  -Headers @{ "x-afu9-sub" = "test-user" } `
  -ContentType "application/json" `
  -Body '{"title": "Upload Test"}'

$sessionId = $session.id

# Create test file
"Test document" | Out-File -FilePath "$env:TEMP\test.txt" -Encoding utf8

# Upload file
$form = @{
  file = Get-Item "$env:TEMP\test.txt"
}
$upload = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/intent/sessions/$sessionId/uploads" `
  -Headers @{ "x-afu9-sub" = "test-user" } `
  -Form $form

Write-Host "✓ Upload successful: $($upload.uploads[0].filename)"

# List uploads
$uploads = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/intent/sessions/$sessionId/uploads" `
  -Headers @{ "x-afu9-sub" = "test-user" }

Write-Host "✓ Found $($uploads.count) upload(s)"

# Check sources
$sources = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/intent/sessions/$sessionId/sources" `
  -Headers @{ "x-afu9-sub" = "test-user" }

$uploadSources = $sources.sources | Where-Object { $_.kind -eq 'upload' }
Write-Host "✓ Found $($uploadSources.Count) upload source(s)"

# Delete upload
$uploadId = $upload.uploads[0].id
$delete = Invoke-RestMethod -Method Delete `
  -Uri "http://localhost:3000/api/intent/sessions/$sessionId/uploads/$uploadId" `
  -Headers @{ "x-afu9-sub" = "test-user" }

Write-Host "✓ Upload deleted: $($delete.deleted)"
```

## Security Considerations

1. **File Type Validation**: Allowlist prevents execution of arbitrary file types
2. **Size Limits**: Prevents DoS via large file uploads (10MB default)
3. **SHA256 Hashing**: Ensures content integrity and enables deduplication
4. **Tenant Isolation**: Session ownership verified for all operations
5. **Cascade Delete**: Uploads automatically cleaned up when session is deleted
6. **Auth-First**: All endpoints require `x-afu9-sub` header (401 before 403)
7. **Storage Isolation**: Files stored in session-scoped directories

## Future Enhancements

1. **S3 Integration**: Add S3 storage when `AWS_UPLOAD_BUCKET` env var is set
2. **Presigned URLs**: Generate presigned S3 URLs for direct download
3. **Image Thumbnails**: Generate thumbnails for image uploads
4. **Document Preview**: Extract text from PDFs for preview/search
5. **Virus Scanning**: Integrate ClamAV or similar for malware detection
6. **Upload Progress**: WebSocket-based upload progress tracking
7. **Batch Upload**: Optimize for multiple file uploads
8. **Compression**: Automatic compression for text-based files

## Related Issues

- E73.2: Sources Panel + used_sources Contract (foundation)
- E89.5: INTENT "Sources" Integration (uses same SourceRef schema)
- E73.3: Context Pack Generator (includes upload references)
- V09-I06: Upload + Sources Management (this implementation)
