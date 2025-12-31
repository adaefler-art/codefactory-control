# E72.4: Timeline Chain Query API + Minimal UI

**Issue:** I724 (E72.4) Query API "Chain for Issue" + minimal UI node view

## Overview

This implementation provides a deterministic Query API that returns the evidence-backed chain for a given Issue, along with a minimal UI for viewing the chain.

The chain represents the flow: **Issue ↔ PR ↔ Run ↔ Deploy ↔ Verdict** (including artifacts)

## API Endpoint

### GET /api/timeline/chain

Query the complete timeline chain for an issue.

**Query Parameters:**
- `issueId` (required): The issue identifier
- `sourceSystem` (optional): Source system (`'github'` | `'afu9'`), defaults to `'afu9'`

**Example Request:**
```
GET /api/timeline/chain?issueId=123&sourceSystem=afu9
```

**Response Schema:**
```typescript
{
  issueId: string;
  sourceSystem: string;
  nodes: TimelineNode[];
  edges: TimelineEdge[];
  metadata: {
    nodeCount: number;
    edgeCount: number;
    timestamp: string; // ISO 8601
  };
}
```

**TimelineNode:**
```typescript
{
  id: string;
  source_system: 'github' | 'afu9';
  source_type: string;
  source_id: string;
  node_type: 'ISSUE' | 'PR' | 'RUN' | 'DEPLOY' | 'VERDICT' | 'ARTIFACT' | 'COMMENT';
  title: string | null;
  url: string | null;
  payload_json: Record<string, unknown>;
  lawbook_version: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}
```

**TimelineEdge:**
```typescript
{
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: 'ISSUE_HAS_PR' | 'PR_HAS_RUN' | 'RUN_HAS_DEPLOY' | 'DEPLOY_HAS_VERDICT' | 'ISSUE_HAS_ARTIFACT' | 'PR_HAS_ARTIFACT' | 'RUN_HAS_ARTIFACT' | 'ISSUE_HAS_COMMENT' | 'PR_HAS_COMMENT';
  payload_json: Record<string, unknown>;
  created_at: string; // ISO 8601
}
```

**Status Codes:**
- `200 OK`: Chain retrieved successfully
- `400 Bad Request`: Invalid query parameters
- `500 Internal Server Error`: Server error

## UI Page

### /timeline/[issueId]

Minimal UI page for viewing the timeline chain of an issue.

**Features:**
- Source system selector (AFU-9 or GitHub)
- Chain metadata display (node count, edge count, query timestamp)
- Deterministically ordered node list
- Node details including:
  - Node ID
  - Source information (system:type:id)
  - Creation and update timestamps
  - External links (if available)
  - Lawbook version (if applicable)
  - Connection information (incoming/outgoing edges)
- Edge relationship list

**Navigation:**
```
/timeline/[issueId]
```

Example: `/timeline/123`

## Implementation Details

### Deterministic Ordering

Nodes are sorted deterministically by:
1. Node type (ISSUE → PR → RUN → DEPLOY → VERDICT → ARTIFACT → COMMENT)
2. Creation timestamp (ascending - earliest first)
3. Node ID (alphabetical, for full determinism)

This ensures stable, reproducible results across multiple queries.

### Evidence Fields

All responses include evidence-friendly fields:
- **Node IDs**: UUIDs for all nodes and edges
- **Source References**: Natural keys (source_system:source_type:source_id)
- **Timestamps**: ISO 8601 formatted creation and update times
- **Lawbook Version**: Version tracking for governance compliance
- **Payload JSON**: Full context data for each node

### Data Flow

1. Client requests chain via `/api/timeline/chain?issueId=X`
2. API validates query parameters using Zod schemas
3. TimelineDAO queries database using recursive CTE to find connected nodes
4. Results are sorted deterministically
5. Response is validated against Zod schema
6. Client receives structured JSON response

## Testing

The implementation includes comprehensive unit tests:

**Test Coverage:**
- Query parameter validation (missing, empty, invalid)
- Default and custom source system handling
- Deterministic node sorting
- Edge inclusion in response
- Error handling (database errors)
- Metadata generation

**Run Tests:**
```bash
npm --prefix control-center test -- __tests__/app/api/timeline/chain.test.ts
```

## Usage Examples

### Fetch Chain via API

```typescript
import { API_ROUTES } from '@/lib/api-routes';

const issueId = '123';
const response = await fetch(API_ROUTES.timeline.chain(issueId, 'afu9'));
const chain = await response.json();

console.log(`Found ${chain.metadata.nodeCount} nodes`);
console.log(`Found ${chain.metadata.edgeCount} edges`);
chain.nodes.forEach(node => {
  console.log(`${node.node_type}: ${node.title || node.source_id}`);
});
```

### Navigate to UI

```typescript
import { useRouter } from 'next/navigation';

const router = useRouter();
const issueId = '123';

// Navigate to timeline chain view
router.push(`/timeline/${issueId}`);
```

## Files Modified/Created

### Created
- `control-center/app/api/timeline/chain/route.ts` - API route handler
- `control-center/app/timeline/[issueId]/page.tsx` - UI page component
- `control-center/__tests__/app/api/timeline/chain.test.ts` - Unit tests

### Modified
- `control-center/src/lib/api-routes.ts` - Added timeline API route definition

## Non-Negotiables ✓

- ✅ Deterministic output ordering (stable sort by node type, time, ID)
- ✅ Evidence-friendly (includes node IDs, source refs, timestamps)
- ✅ No heavy UI (minimal, functional node list view)
- ✅ Server-side query with Zod validation
- ✅ All tests passing

## Related

- E72.1 (I721): Timeline/Linkage Model
- E72.2: Ingestion
- E72.3: Evidence extraction
