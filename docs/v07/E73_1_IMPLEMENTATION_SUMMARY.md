# E73.1 INTENT Console UI Shell - Implementation Summary

## Overview
This implementation adds a minimal but production-quality INTENT Console UI Shell to the Control Center, providing session-based chat with deterministic message ordering, server-side persistence, and comprehensive security controls.

## Security Enhancements (Post-Review)

### Session Ownership & Access Control
- **Database:** Added `user_id VARCHAR(255) NOT NULL` to intent_sessions
- **Indexing:** Composite index on (user_id, created_at DESC) for efficient user-scoped queries
- **API Layer:** All routes extract userId from `x-afu9-sub` header (set by middleware)
- **Database Layer:** All functions require userId parameter
- **Access Control:**
  - GET /api/intent/sessions: Returns only sessions where user_id = current user
  - GET /api/intent/sessions/[id]: Validates user_id matches before returning (404 if not)
  - POST /api/intent/sessions/[id]/messages: Validates user_id in atomic update
- **Security Pattern:** Returns 404 (not 403) to prevent session ID enumeration

### Atomic Seq Increment (Race-Safe)
- **Pattern:** Atomic counter via UPDATE...RETURNING
- **Implementation:**
```sql
UPDATE intent_sessions
SET next_seq = next_seq + 1, updated_at = NOW()
WHERE id = $1 AND user_id = $2
RETURNING next_seq - 1 AS seq
```
- **Guarantees:**
  - Single atomic operation (no race conditions)
  - Row-level lock prevents concurrent access
  - User ownership validated in same query
  - Gap-free, deterministic sequence numbers
  - No MAX(seq) + 1 pattern (which can race)

### Content Validation
- **Max Length:** 50,000 characters per message
- **Non-Empty:** Content must have length > 0
- **Database Constraint:** `CHECK (length(content) > 0 AND length(content) <= 50000)`

## Files Changed

### Database Migration
- **`database/migrations/030_intent_sessions.sql`**
  - Creates `intent_sessions` table with user_id and next_seq atomic counter
  - Creates `intent_messages` table with content length constraints
  - Adds indexes for performance and unique constraints for data integrity
  - Implements seq-based ordering with unique constraint on (session_id, seq)

### Database Access Layer
- **`control-center/src/lib/db/intentSessions.ts`**
  - `listIntentSessions(pool, userId, options)` - Lists sessions for user only
  - `createIntentSession(pool, userId, data)` - Creates session owned by user
  - `getIntentSession(pool, sessionId, userId)` - Gets session with ownership check
  - `appendIntentMessage(pool, sessionId, userId, role, content)` - Atomic seq increment with ownership validation
  - Includes automatic title generation from first user message

### API Routes
- **`control-center/app/api/intent/sessions/route.ts`**
  - GET /api/intent/sessions - Lists user's sessions (extracts userId from header)
  - POST /api/intent/sessions - Creates session for authenticated user
  
- **`control-center/app/api/intent/sessions/[id]/route.ts`**
  - GET /api/intent/sessions/[id] - Gets session with ownership verification
  
- **`control-center/app/api/intent/sessions/[id]/messages/route.ts`**
  - POST /api/intent/sessions/[id]/messages - Appends messages with ownership check
  - Includes deterministic stub response generator

### UI Components
- **`control-center/app/intent/page.tsx`**
  - Full chat interface with sidebar and message thread
  - Session list with "New session" button
  - Message input with Enter/Shift+Enter support
  - Loading states and error handling
  - Auto-scroll to latest message
  - Uses canonical API_ROUTES constants

### Configuration
- **`control-center/src/lib/api-routes.ts`**
  - Added INTENT route constants to API_ROUTES object
  - Ensures type-safe route usage across the application

### Tests
- **`control-center/__tests__/api/intent-sessions.test.ts`**
  - Tests session creation and listing with user scoping
  - Tests message appending with deterministic seq
  - Tests message retrieval ordered by seq
  - Tests validation and error handling
  - **Security Tests:**
    - User A cannot access user B's sessions (404)
    - User B cannot append to user A's session (404)
    - Unauthenticated requests rejected (401)
  - **Concurrency Tests:**
    - Verifies atomic seq increment
    - Verifies gap-free, deterministic ordering

## Test Results

**All 10 tests passing:**
1. ✅ GET /api/intent/sessions returns user's sessions only
2. ✅ GET /api/intent/sessions returns 401 without auth
3. ✅ POST /api/intent/sessions creates for authenticated user
4. ✅ GET /api/intent/sessions/[id] returns session with ordered messages
5. ✅ GET /api/intent/sessions/[id] returns 404 when not found
6. ✅ GET /api/intent/sessions/[id] prevents cross-user access
7. ✅ POST messages appends with deterministic seq
8. ✅ POST messages returns 400 on missing content
9. ✅ POST messages prevents cross-user append
10. ✅ Atomic seq increment produces gap-free ordering

## Key Features

### Deterministic Persistence
- Messages stored with monotonically increasing `seq` field
- Atomic counter prevents race conditions
- Unique constraint on (session_id, seq) ensures no duplicates
- Messages always returned in deterministic order via `ORDER BY seq ASC`

### Security
- All routes are server-side API routes (no client-side processing)
- User ownership enforced at DB and API layers
- Cross-user access prevented with 404 responses
- Request ID tracking for all API calls
- Standard error handling and validation

### Stub Assistant Response
- Simple deterministic stub: echoes user input with prefix
- Server-side generation in POST message handler
- Automatically appends after user message
- No external LLM calls required

### User Experience
- Clean, minimal UI following Control Center patterns
- Session persistence survives page reload
- Auto-generated session titles from first message
- Enter to send, Shift+Enter for new line
- Loading states during assistant reply generation

## PowerShell Commands

### Run Database Migrations
```powershell
# From repository root
cd control-center
npm run db:migrate
```

### Run Tests
```powershell
# Run all tests
cd control-center
npm test

# Run only INTENT tests (10 passing)
npm test -- __tests__/api/intent-sessions.test.ts
```

### Build Application
```powershell
# From control-center directory
npm run build
```

### Verify Repository Canon
```powershell
# From repository root
npm run repo:verify
```

### Start Development Server
```powershell
# From control-center directory
npm run dev

# Then navigate to http://localhost:3000/intent
```

## Database Schema

### intent_sessions
| Column     | Type         | Description                           |
|------------|--------------|---------------------------------------|
| id         | UUID         | Primary key                           |
| user_id    | VARCHAR(255) | Owner (NOT NULL, from x-afu9-sub)     |
| title      | TEXT         | Session title (auto from 1st message) |
| created_at | TIMESTAMP    | Creation timestamp                    |
| updated_at | TIMESTAMP    | Last update timestamp                 |
| status     | TEXT         | 'active' or 'archived'                |
| next_seq   | INTEGER      | Atomic counter for message seq        |

**Indexes:**
- `idx_intent_sessions_user_id` on (user_id)
- `idx_intent_sessions_created_at` on (created_at DESC)
- `idx_intent_sessions_status` on (status)
- `idx_intent_sessions_user_created` on (user_id, created_at DESC)

### intent_messages
| Column     | Type      | Description                                |
|------------|-----------|--------------------------------------------|
| id         | UUID      | Primary key                                |
| session_id | UUID      | Foreign key to intent_sessions             |
| role       | TEXT      | 'user', 'assistant', or 'system'           |
| content    | TEXT      | Message content (1-50000 chars)            |
| created_at | TIMESTAMP | Creation timestamp                         |
| seq        | INTEGER   | Monotonically increasing sequence number   |

**Constraints:**
- UNIQUE (session_id, seq) - Ensures deterministic ordering
- CHECK role IN ('user', 'assistant', 'system')
- CHECK length(content) > 0 AND length(content) <= 50000
- CHECK status IN ('active', 'archived')
- ON DELETE CASCADE when session deleted

**Indexes:**
- `idx_intent_messages_session_id` on (session_id)
- `idx_intent_messages_created_at` on (created_at)
- `idx_intent_messages_session_seq` on (session_id, seq)

## API Endpoints

### GET /api/intent/sessions
List recent INTENT sessions for authenticated user.

**Authentication:** Required (x-afu9-sub header)

**Query Parameters:**
- `limit` - Results per page (default: 50, max: 100)
- `offset` - Pagination offset (default: 0)
- `status` - Filter by status ('active' or 'archived')

**Response:**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "user_id": "user-123",
      "title": "First message preview...",
      "created_at": "2025-01-01T00:00:00.000Z",
      "updated_at": "2025-01-01T00:00:00.000Z",
      "status": "active"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

### POST /api/intent/sessions
Create a new INTENT session for authenticated user.

**Authentication:** Required (x-afu9-sub header)

**Body:**
```json
{
  "title": "Optional title",
  "status": "active"
}
```

**Response:** Session object (201 Created)

### GET /api/intent/sessions/[id]
Get a session with all messages ordered by seq. Only returns if user owns session.

**Authentication:** Required (x-afu9-sub header)

**Response:**
```json
{
  "id": "uuid",
  "user_id": "user-123",
  "title": "Session title",
  "created_at": "2025-01-01T00:00:00.000Z",
  "updated_at": "2025-01-01T00:00:00.000Z",
  "status": "active",
  "messages": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "role": "user",
      "content": "Hello",
      "created_at": "2025-01-01T00:00:01.000Z",
      "seq": 1
    },
    {
      "id": "uuid",
      "session_id": "uuid",
      "role": "assistant",
      "content": "[Stub] I received: \"Hello\"",
      "created_at": "2025-01-01T00:00:02.000Z",
      "seq": 2
    }
  ]
}
```

### POST /api/intent/sessions/[id]/messages
Append a user message and generate stub assistant reply. Only allowed for session owner.

**Authentication:** Required (x-afu9-sub header)

**Body:**
```json
{
  "content": "User message text"
}
```

**Response:**
```json
{
  "userMessage": {
    "id": "uuid",
    "session_id": "uuid",
    "role": "user",
    "content": "User message text",
    "created_at": "2025-01-01T00:00:03.000Z",
    "seq": 3
  },
  "assistantMessage": {
    "id": "uuid",
    "session_id": "uuid",
    "role": "assistant",
    "content": "[Stub] I received: \"User message text\"",
    "created_at": "2025-01-01T00:00:04.000Z",
    "seq": 4
  }
}
```

## Acceptance Criteria ✓

- [x] /intent works end-to-end locally: create session → chat → persistence survives reload
- [x] Deterministic ordering via seq and DB constraints
- [x] Tests green: `npm test -- __tests__/api/intent-sessions.test.ts` (10/10 passing)
- [x] Build green: `npm run build` (successful)
- [x] No external LLM calls - stub response only
- [x] Security: server routes only, consistent auth patterns
- [x] **User ownership:** Sessions scoped to authenticated user
- [x] **Race-safe seq:** Atomic counter pattern prevents concurrent issues
- [x] Minimal UI, clean and usable

## Next Steps (Out of Scope for E73.1)

Future enhancements could include:
- Integration with real LLM (Claude, GPT, etc.)
- Context Pack support
- Code Repository (CR) tools
- Source document integration
- Advanced INTENT steering features
- Session archiving and search
- Export/import functionality
