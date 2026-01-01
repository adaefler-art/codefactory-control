# Context Pack Example Output

This file shows an example of a generated Context Pack JSON.

## Example Context Pack JSON

```json
{
  "contextPackVersion": "0.7.0",
  "generatedAt": "2026-01-01T12:00:00.000Z",
  "session": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Implement authentication flow",
    "createdAt": "2026-01-01T10:00:00.000Z",
    "updatedAt": "2026-01-01T11:30:00.000Z"
  },
  "messages": [
    {
      "seq": 1,
      "role": "user",
      "content": "How can I implement authentication with JWT tokens?",
      "createdAt": "2026-01-01T10:00:01.000Z",
      "used_sources": null,
      "used_sources_hash": null
    },
    {
      "seq": 2,
      "role": "assistant",
      "content": "I can help you implement JWT authentication. Based on the codebase, here's what you need to do...",
      "createdAt": "2026-01-01T10:00:02.000Z",
      "used_sources": [
        {
          "kind": "file_snippet",
          "repo": {
            "owner": "adaefler-art",
            "repo": "codefactory-control"
          },
          "branch": "main",
          "path": "control-center/middleware.ts",
          "startLine": 1,
          "endLine": 50,
          "snippetHash": "a3f2b1c",
          "contentSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        },
        {
          "kind": "github_issue",
          "repo": {
            "owner": "adaefler-art",
            "repo": "codefactory-control"
          },
          "number": 732,
          "url": "https://github.com/adaefler-art/codefactory-control/issues/732",
          "title": "E73.2: Sources Panel + used_sources Contract",
          "updatedAt": "2025-12-31T16:00:00.000Z"
        }
      ],
      "used_sources_hash": "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890"
    },
    {
      "seq": 3,
      "role": "user",
      "content": "Can you show me an example with the jose library?",
      "createdAt": "2026-01-01T10:01:00.000Z",
      "used_sources": null,
      "used_sources_hash": null
    },
    {
      "seq": 4,
      "role": "assistant",
      "content": "Sure! Here's an example using the jose library for JWT verification...",
      "createdAt": "2026-01-01T10:01:01.000Z",
      "used_sources": [
        {
          "kind": "file_snippet",
          "repo": {
            "owner": "adaefler-art",
            "repo": "codefactory-control"
          },
          "branch": "main",
          "path": "control-center/src/lib/auth/jwt.ts",
          "startLine": 10,
          "endLine": 60,
          "snippetHash": "def456",
          "contentSha256": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
        }
      ],
      "used_sources_hash": "b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890ab"
    }
  ],
  "derived": {
    "sessionHash": "9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",
    "messageCount": 4,
    "sourcesCount": 2
  },
  "warnings": []
}
```

## Schema Details

### Top-Level Fields

- **contextPackVersion**: Version of the context pack schema (currently "0.7.0")
- **generatedAt**: ISO 8601 timestamp when the pack was generated
- **session**: Session metadata
- **messages**: Array of messages ordered by seq (ascending)
- **derived**: Computed metadata
- **warnings**: Optional array of warning messages (empty if none)

### Session Fields

- **id**: Session UUID
- **title**: Session title (nullable)
- **createdAt**: ISO 8601 timestamp when session was created
- **updatedAt**: ISO 8601 timestamp when session was last updated

### Message Fields

- **seq**: Sequential message number (deterministic ordering)
- **role**: Message role ("user", "assistant", or "system")
- **content**: Message content text
- **createdAt**: ISO 8601 timestamp when message was created
- **used_sources**: Array of source references (only for assistant messages, null otherwise)
- **used_sources_hash**: SHA256 hash of canonical used_sources (null if no sources)

### Derived Fields

- **sessionHash**: SHA256 hash of canonical pack (excluding generatedAt) for deterministic comparison
- **messageCount**: Total number of messages in the session
- **sourcesCount**: Number of unique source hashes referenced across all messages

## Determinism Guarantees

1. **Same DB state → Same sessionHash**: The `sessionHash` is computed from the canonical representation of the pack (excluding `generatedAt`), ensuring identical hashes for identical session content.

2. **Stable ordering**: Messages are always sorted by `seq` in ascending order.

3. **Canonical used_sources**: Sources within each message are canonicalized and deduplicated using the same algorithm as I732.

## Idempotency

Generating a context pack multiple times for the same unchanged session will:
- Return the same pack record from the database
- Not create duplicate rows
- Use pack_hash as the deduplication key

## Security & Redaction

The context pack JSON contains only whitelisted fields:
- ✅ Session metadata (id, title, timestamps)
- ✅ Message content and metadata
- ✅ used_sources references
- ✅ Derived hashes and counts

The pack does NOT contain:
- ❌ API tokens or secrets
- ❌ Environment variables
- ❌ User passwords or authentication data
- ❌ Database connection strings
- ❌ Any sensitive configuration
