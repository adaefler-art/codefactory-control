# E73.1 INTENT Console UI Shell - Implementation Summary

## Overview
This implementation adds a minimal but production-quality INTENT Console UI Shell to the Control Center, providing session-based chat with deterministic message ordering and server-side persistence.

## Files Changed

### Database Migration
- **`database/migrations/030_intent_sessions.sql`**
  - Creates `intent_sessions` table for managing chat sessions
  - Creates `intent_messages` table for storing messages with deterministic ordering
  - Adds indexes for performance and unique constraints for data integrity
  - Implements seq-based ordering with unique constraint on (session_id, seq)

### Database Access Layer
- **`control-center/src/lib/db/intentSessions.ts`**
  - `listIntentSessions()` - Lists recent sessions with pagination
  - `createIntentSession()` - Creates new chat session
  - `getIntentSession()` - Retrieves session with all messages ordered by seq
  - `appendIntentMessage()` - Appends message with transaction-based seq increment
  - Includes automatic title generation from first user message

### API Routes
- **`control-center/app/api/intent/sessions/route.ts`**
  - GET /api/intent/sessions - Lists recent sessions
  - POST /api/intent/sessions - Creates new session
  
- **`control-center/app/api/intent/sessions/[id]/route.ts`**
  - GET /api/intent/sessions/[id] - Gets session with messages
  
- **`control-center/app/api/intent/sessions/[id]/messages/route.ts`**
  - POST /api/intent/sessions/[id]/messages - Appends user message and generates stub assistant reply
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
  - Tests session creation and listing
  - Tests message appending with deterministic seq
  - Tests message retrieval ordered by seq
  - Tests validation and error handling
  - Verifies concurrency safety via seq ordering

## Key Features

### Deterministic Persistence
- Messages stored with monotonically increasing `seq` field
- Transaction-based seq calculation prevents race conditions
- Unique constraint on (session_id, seq) ensures no duplicates
- Messages always returned in deterministic order via `ORDER BY seq ASC`

### Security
- All routes are server-side API routes (no client-side processing)
- Uses existing auth patterns consistent with AFU-9 admin UI
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

# Run only INTENT tests
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
| Column     | Type      | Description                           |
|------------|-----------|---------------------------------------|
| id         | UUID      | Primary key                           |
| title      | TEXT      | Session title (auto from 1st message) |
| created_at | TIMESTAMP | Creation timestamp                    |
| updated_at | TIMESTAMP | Last update timestamp                 |
| status     | TEXT      | 'active' or 'archived'                |

### intent_messages
| Column     | Type      | Description                                |
|------------|-----------|--------------------------------------------|
| id         | UUID      | Primary key                                |
| session_id | UUID      | Foreign key to intent_sessions             |
| role       | TEXT      | 'user', 'assistant', or 'system'           |
| content    | TEXT      | Message content                            |
| created_at | TIMESTAMP | Creation timestamp                         |
| seq        | INTEGER   | Monotonically increasing sequence number   |

**Constraints:**
- UNIQUE (session_id, seq) - Ensures deterministic ordering
- CHECK role IN ('user', 'assistant', 'system')
- CHECK status IN ('active', 'archived')

## API Endpoints

### GET /api/intent/sessions
List recent INTENT sessions.

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
Create a new INTENT session.

**Body:**
```json
{
  "title": "Optional title",
  "status": "active"
}
```

**Response:** Session object (201 Created)

### GET /api/intent/sessions/[id]
Get a session with all messages ordered by seq.

**Response:**
```json
{
  "id": "uuid",
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
Append a user message and generate stub assistant reply.

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

## Testing

All tests pass with 7 test cases covering:
1. Session listing with pagination
2. Session creation
3. Session retrieval with messages in seq order
4. 404 handling for non-existent sessions
5. Message appending with deterministic seq
6. Input validation (400 on missing content)
7. Multi-message seq ordering verification

## Acceptance Criteria ✓

- [x] /intent works end-to-end locally: create session → chat → persistence survives reload
- [x] Deterministic ordering via seq and DB constraints
- [x] Tests green: `npm test -- __tests__/api/intent-sessions.test.ts`
- [x] Build green: `npm run build`
- [x] No external LLM calls - stub response only
- [x] Security: server routes only, consistent auth patterns
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
