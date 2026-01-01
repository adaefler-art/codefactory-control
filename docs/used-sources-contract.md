# used_sources Contract Documentation

## Overview

The `used_sources` contract provides evidence/provenance tracking for INTENT assistant messages. Each assistant response can include references to the sources that informed it, enabling transparent AI reasoning and auditability.

## Source Types

### 1. File Snippet
References to code file sections with line ranges.

```typescript
{
  kind: "file_snippet",
  repo: { owner: "org", repo: "repo" },
  branch: "main",
  path: "src/file.ts",
  startLine: 10,
  endLine: 50,
  snippetHash: "abc123",      // Short hash of snippet content
  contentSha256?: "e3b0c..."   // Optional full file SHA256
}
```

### 2. GitHub Issue
References to GitHub issues.

```typescript
{
  kind: "github_issue",
  repo: { owner: "org", repo: "repo" },
  number: 123,
  url?: "https://github.com/org/repo/issues/123",
  title?: "Issue Title",
  updatedAt?: "2025-12-31T16:00:00.000Z"
}
```

### 3. GitHub Pull Request
References to GitHub pull requests.

```typescript
{
  kind: "github_pr",
  repo: { owner: "org", repo: "repo" },
  number: 456,
  url?: "https://github.com/org/repo/pull/456",
  title?: "PR Title",
  updatedAt?: "2025-12-31T16:00:00.000Z"
}
```

### 4. AFU-9 Artifact
References to internal AFU-9 artifacts (verdicts, executions, etc.).

```typescript
{
  kind: "afu9_artifact",
  artifactType: "verdict",
  artifactId: "verdict-001",
  sha256?: "abc123...",
  ref?: { executionId: "exec-001" }  // Flexible metadata
}
```

## API Usage

### POST Message with Sources

```typescript
// Request
POST /api/intent/sessions/{sessionId}/messages
Content-Type: application/json

{
  "content": "User message here",
  "used_sources": [
    {
      "kind": "file_snippet",
      "repo": { "owner": "org", "repo": "repo" },
      "branch": "main",
      "path": "file.ts",
      "startLine": 1,
      "endLine": 10,
      "snippetHash": "abc"
    }
  ]
}

// Response
{
  "userMessage": { ... },
  "assistantMessage": {
    "id": "msg-123",
    "content": "[Stub] Response",
    "used_sources": [...],         // Canonical form
    "used_sources_hash": "e3b0c..."  // SHA256 of canonical JSON
  }
}
```

### GET Session with Sources

```typescript
// Request
GET /api/intent/sessions/{sessionId}

// Response
{
  "id": "session-123",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "...",
      "used_sources": null,
      "used_sources_hash": null
    },
    {
      "id": "msg-2",
      "role": "assistant",
      "content": "...",
      "used_sources": [...],
      "used_sources_hash": "abc123..."
    }
  ]
}
```

## Canonicalization

Sources are automatically canonicalized on storage:

1. **Sorting**: By kind, then kind-specific fields
2. **Deduplication**: Exact duplicates removed
3. **Hashing**: SHA256 of canonical JSON

### Example

```typescript
import { prepareUsedSourcesForStorage } from '@/lib/utils/sourceCanonicalizer';

const sources = [
  { kind: 'github_pr', repo: {...}, number: 2 },
  { kind: 'github_issue', repo: {...}, number: 1 }
];

const { canonical, hash } = prepareUsedSourcesForStorage(sources);
// canonical: Sorted by kind (github_issue first)
// hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

**Guarantee**: Same sources in different order -> same hash

## Database Schema

```sql
-- intent_messages table
ALTER TABLE intent_messages
ADD COLUMN used_sources_json JSONB DEFAULT NULL,
ADD COLUMN used_sources_hash TEXT DEFAULT NULL;

-- Only assistant messages can have sources
-- Constraint enforced in code, not DB
```

## UI Integration

The SourcesPanel component displays sources in a collapsible right-side panel:

```tsx
import { SourcesPanel, SourcesBadge } from '@/app/intent/components/SourcesPanel';

// Show sources panel
<SourcesPanel sources={message.used_sources} />

// Show badge on message
<SourcesBadge count={message.used_sources?.length || 0} />
```

## Constraints

1. **Assistant Only**: Only assistant messages can have `used_sources`
2. **Immutable**: Sources stored as-is; no post-hoc modification
3. **Server-Side**: Canonicalization happens server-side only
4. **No Content**: Store refs/hashes, not full file contents

## Testing

```bash
# Run tests
npm --prefix control-center test

# Test canonicalization
npm --prefix control-center test sourceCanonicalizer

# Test API validation
npm --prefix control-center test intent-used-sources
```

## Security

- ✅ No secrets in sources (references only)
- ✅ Server-side validation prevents injection
- ✅ Hash prevents tampering
- ✅ User-owned sessions prevent cross-user access

## Future Enhancements

1. Source navigation (click to view)
2. Source filtering in UI
3. Export for audit/compliance
4. Analytics on source usage
5. Real INTENT pipeline integration

## Related Files

- `src/lib/schemas/usedSources.ts` - Types & Zod schemas
- `src/lib/utils/sourceCanonicalizer.ts` - Canonicalization & hashing
- `app/intent/components/SourcesPanel.tsx` - UI component
- `database/migrations/031_used_sources.sql` - Schema migration
- `E73_2_IMPLEMENTATION_SUMMARY.md` - Full implementation details
