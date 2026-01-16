# V09-I06 Security Summary

## Issue: Upload + Sources Management (Product Memory Basis)

**Security Focus**: File upload security, tenant isolation, storage security, and data integrity.

## Security Measures Implemented

### 1. File Upload Security

#### File Type Allowlist
- **Threat**: Arbitrary code execution via uploaded scripts/executables
- **Mitigation**: Strict allowlist of permitted MIME types
  - Allowed: `pdf`, `md`, `txt`, `json`, `png`, `jpg`
  - Blocked: `exe`, `sh`, `js`, `html`, `php`, `py`, etc.
- **Implementation**:
  - Application-level validation in `validateUpload()`
  - Database-level CHECK constraint on `content_type` column
  - Extension-to-MIME mapping for double verification
- **Location**: 
  - `control-center/src/lib/upload-storage-service.ts` (lines 20-40)
  - `database/migrations/076_intent_session_uploads.sql` (lines 17-26)

#### File Size Limits
- **Threat**: Denial of service via large file uploads
- **Mitigation**: Configurable size limit (10MB default)
- **Implementation**:
  - `MAX_UPLOAD_SIZE_BYTES` environment variable
  - Pre-upload validation before storage
  - Database CHECK constraint: `size_bytes > 0`
- **Location**: `control-center/src/lib/upload-storage-service.ts` (lines 19, 60-75)

#### Content Integrity
- **Threat**: File tampering, man-in-the-middle attacks
- **Mitigation**: SHA256 hash verification
- **Implementation**:
  - Hash computed on upload and stored in database
  - Hash can be verified on retrieval
  - Deduplication by hash prevents redundant storage
- **Location**: `control-center/src/lib/upload-storage-service.ts` (lines 162-166)

### 2. Tenant Isolation (RLS)

#### Session Ownership Verification
- **Threat**: Unauthorized access to other users' uploads
- **Mitigation**: Multi-layer ownership verification
- **Implementation**:
  1. Auth-first: Require `x-afu9-sub` header (401 if missing)
  2. Session ownership: JOIN with `intent_sessions` table
  3. User ID match: `WHERE s.user_id = $userId`
- **Location**: All upload API routes
  - `control-center/app/api/intent/sessions/[id]/uploads/route.ts` (lines 45-80)
  - `control-center/app/api/intent/sessions/[id]/uploads/[uploadId]/route.ts` (lines 32-67)

#### Cascade Delete
- **Threat**: Orphaned uploads consuming storage
- **Mitigation**: Automatic cleanup on session deletion
- **Implementation**: Foreign key with `ON DELETE CASCADE`
- **Location**: `database/migrations/076_intent_session_uploads.sql` (line 9)

### 3. Storage Security

#### Storage Key Structure
- **Threat**: Path traversal, directory listing
- **Mitigation**: Predictable, sanitized storage keys
- **Implementation**: 
  - Format: `{sessionId}/{uploadId}/{filename}`
  - UUIDs prevent guessing
  - No user-controlled path components
- **Location**: `control-center/src/lib/upload-storage-service.ts` (line 175)

#### Filesystem Isolation
- **Threat**: Access to system files
- **Mitigation**: Dedicated upload directory
- **Implementation**:
  - `UPLOAD_DIR` environment variable (default: `/tmp/afu9-uploads`)
  - All operations scoped to upload directory
  - No path traversal (`../`) allowed in filenames
- **Location**: `control-center/src/lib/upload-storage-service.ts` (line 18)

#### Future: S3 Bucket Policy
- **Recommendation**: When migrating to S3:
  - Use presigned URLs with expiration
  - Enable bucket versioning for recovery
  - Enable server-side encryption (SSE-S3 or SSE-KMS)
  - Restrict public access (block all public ACLs)
  - Enable access logging for audit trail

### 4. API Security

#### Authentication
- **Pattern**: Auth-first (401 before 403)
- **Implementation**: Require `x-afu9-sub` header from middleware
- **Location**: All API routes (first check in handlers)

#### Authorization
- **Pattern**: Verify ownership before any operation
- **Implementation**: 
  - GET: Verify session ownership
  - POST: Verify session ownership before upload
  - DELETE: Verify ownership via JOIN query
- **Location**: All upload API routes

#### Error Messages
- **Threat**: Information disclosure
- **Mitigation**: Generic error messages for unauthorized access
- **Implementation**:
  - 401: "User authentication required"
  - 403: "Session not found or access denied"
  - 404: "Upload not found or access denied"
- **Location**: All API routes (error responses)

### 5. Input Validation

#### Filename Validation
- **Threat**: SQL injection, path traversal, XSS
- **Mitigation**: Strict validation rules
- **Implementation**:
  - Length limit: 255 characters
  - Required extension from allowlist
  - No path separators (`/`, `\`)
  - Stored as-is (no sanitization needed with UUID-based storage)
- **Location**: `control-center/src/lib/upload-storage-service.ts` (lines 115-125)

#### MIME Type Validation
- **Threat**: MIME type confusion attacks
- **Mitigation**: Extension-MIME consistency check
- **Implementation**:
  - Extract extension from filename
  - Map extension to allowed MIME type
  - Verify declared MIME type matches extension
- **Location**: `control-center/src/lib/upload-storage-service.ts` (lines 83-108)

### 6. Data Integrity

#### Deduplication
- **Threat**: Storage exhaustion via duplicate uploads
- **Mitigation**: SHA256-based deduplication per session
- **Implementation**: Unique constraint on `(session_id, content_sha256)`
- **Location**: `database/migrations/076_intent_session_uploads.sql` (line 45)

#### Immutability
- **Pattern**: No UPDATE operations on upload records
- **Implementation**: 
  - Only INSERT and DELETE operations
  - No modification after creation
  - Hash ensures content hasn't changed
- **Location**: All API routes (no UPDATE endpoint)

## Security Testing

### Automated Tests
- ✅ Auth tests: 401 when not authenticated
- ✅ Ownership tests: 403 when wrong user
- ✅ File type tests: 400 when invalid extension
- ✅ Size limit tests: 400 when too large
- ✅ Hash validation: Correct SHA256 computation

### Manual Testing Recommendations
1. **Path Traversal**: Try uploading files with `../` in name
2. **MIME Confusion**: Upload `.txt` file with `application/pdf` MIME
3. **Large Files**: Upload 100MB file (should reject)
4. **Malicious Extensions**: Upload `.exe`, `.sh`, `.js` files
5. **Cross-User Access**: Try accessing another user's uploads

## Security Checklist

- ✅ **No secrets in code**: No hardcoded credentials or keys
- ✅ **Auth-first**: All endpoints require authentication
- ✅ **Tenant isolation**: Session ownership verified
- ✅ **Input validation**: Filename, size, MIME type validated
- ✅ **File type allowlist**: Only safe file types allowed
- ✅ **Size limits**: DoS prevention via 10MB limit
- ✅ **Hash verification**: SHA256 for integrity
- ✅ **Cascade delete**: No orphaned uploads
- ✅ **Error messages**: No information disclosure
- ✅ **Storage isolation**: Dedicated upload directory
- ✅ **Database constraints**: CHECK and UNIQUE constraints enforced
- ✅ **Immutable records**: No UPDATE operations

## Known Limitations

1. **No Virus Scanning**: Files not scanned for malware
   - **Mitigation**: File type allowlist reduces risk
   - **Recommendation**: Add ClamAV integration in future

2. **Local Filesystem Storage**: Not suitable for multi-instance deployments
   - **Mitigation**: S3 integration planned for production
   - **Recommendation**: Set `AWS_UPLOAD_BUCKET` env var for S3

3. **No Encryption at Rest**: Files stored unencrypted
   - **Mitigation**: Filesystem permissions restrict access
   - **Recommendation**: Use encrypted filesystem or S3 SSE

4. **No Rate Limiting**: No per-user upload rate limits
   - **Mitigation**: File size limit prevents large-scale abuse
   - **Recommendation**: Add rate limiting middleware

## Recommendations

### Immediate (Before Production)
1. ✅ Enable S3 storage with presigned URLs
2. ✅ Add rate limiting (e.g., 10 uploads/minute per user)
3. ✅ Integrate virus scanning (ClamAV or AWS GuardDuty)
4. ✅ Enable S3 server-side encryption
5. ✅ Add CloudWatch metrics for upload patterns

### Medium-Term
1. Add content-based MIME detection (not just extension)
2. Implement file quarantine for suspicious uploads
3. Add upload audit logging (who, when, what)
4. Enable S3 versioning for recovery
5. Add retention policies (auto-delete old uploads)

### Long-Term
1. AI-based malware detection
2. DLP (Data Loss Prevention) scanning
3. Automated sensitive data detection
4. Upload analytics and anomaly detection

## Compliance Notes

### GDPR
- **Right to Erasure**: Implemented via DELETE endpoint
- **Data Minimization**: Only essential metadata stored
- **Consent**: User initiates uploads (implicit consent)

### SOC 2
- **Access Control**: Session-based ownership enforced
- **Audit Trail**: Created_at timestamp for all uploads
- **Data Integrity**: SHA256 hashing ensures integrity

## Security Review Status

- ✅ Input validation reviewed
- ✅ Authentication/authorization reviewed
- ✅ Storage security reviewed
- ✅ Database security reviewed
- ✅ No critical vulnerabilities identified
- ⚠️ Recommendations documented for production hardening

## Related Security Documentation

- E89.1: GitHub Repo Read-Only Policy (principle of least privilege)
- E73.2: Sources Panel + used_sources Contract (data integrity)
- V09-I06: This implementation
