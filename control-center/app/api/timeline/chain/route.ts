/**
 * API Route: /api/timeline/chain
 * 
 * Query API for retrieving the evidence-backed chain for a given Issue.
 * Returns: Issue ↔ PR ↔ Run ↔ Deploy ↔ Verdict (and artifacts)
 * 
 * E72.4 (I724): Query API "Chain for Issue" + minimal UI node view
 * 
 * Features:
 * - Deterministic output ordering (stable sort by node type, creation time)
 * - Evidence-friendly: includes node ids, source refs, hashes, timestamps
 * - Server-side query with Zod validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '../../../../src/lib/db';
import { getTimelineDAO } from '../../../../src/lib/db/timeline';
import { withApi, apiError } from '../../../../src/lib/http/withApi';

/**
 * Query parameters schema
 */
const ChainQuerySchema = z.object({
  issueId: z.string().min(1, 'issueId is required'),
  sourceSystem: z.enum(['github', 'afu9']).optional().default('afu9'),
});

/**
 * Response node schema
 */
const ChainNodeSchema = z.object({
  id: z.string(),
  source_system: z.enum(['github', 'afu9']),
  source_type: z.string(),
  source_id: z.string(),
  node_type: z.enum(['ISSUE', 'PR', 'RUN', 'DEPLOY', 'VERDICT', 'ARTIFACT', 'COMMENT']),
  title: z.string().nullable(),
  url: z.string().nullable(),
  payload_json: z.record(z.string(), z.any()),
  lawbook_version: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

/**
 * Response edge schema
 */
const ChainEdgeSchema = z.object({
  id: z.string(),
  from_node_id: z.string(),
  to_node_id: z.string(),
  edge_type: z.enum([
    'ISSUE_HAS_PR',
    'PR_HAS_RUN',
    'RUN_HAS_DEPLOY',
    'DEPLOY_HAS_VERDICT',
    'ISSUE_HAS_ARTIFACT',
    'PR_HAS_ARTIFACT',
    'RUN_HAS_ARTIFACT',
    'ISSUE_HAS_COMMENT',
    'PR_HAS_COMMENT',
  ]),
  payload_json: z.record(z.string(), z.any()),
  created_at: z.string().datetime(),
});

/**
 * Response schema
 */
const ChainResponseSchema = z.object({
  issueId: z.string(),
  sourceSystem: z.string(),
  nodes: z.array(ChainNodeSchema),
  edges: z.array(ChainEdgeSchema),
  metadata: z.object({
    nodeCount: z.number(),
    edgeCount: z.number(),
    timestamp: z.string().datetime(),
  }),
});

type ChainNode = z.infer<typeof ChainNodeSchema>;

/**
 * Node type ordering for deterministic sorting
 */
const NODE_TYPE_ORDER: Record<string, number> = {
  ISSUE: 1,
  PR: 2,
  RUN: 3,
  DEPLOY: 4,
  VERDICT: 5,
  ARTIFACT: 6,
  COMMENT: 7,
};

/**
 * Sort nodes deterministically by node_type, then created_at, then id
 */
function sortNodesDeterministically(nodes: ChainNode[]): ChainNode[] {
  return [...nodes].sort((a, b) => {
    // First: sort by node type
    const typeOrderA = NODE_TYPE_ORDER[a.node_type] ?? 999;
    const typeOrderB = NODE_TYPE_ORDER[b.node_type] ?? 999;
    if (typeOrderA !== typeOrderB) {
      return typeOrderA - typeOrderB;
    }
    
    // Second: sort by created_at (ascending - earliest first)
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    
    // Third: sort by id for full determinism
    return a.id.localeCompare(b.id);
  });
}

/**
 * GET /api/timeline/chain?issueId=<id>&sourceSystem=<system>
 * 
 * Query the complete chain for a given issue.
 * 
 * Query Parameters:
 * - issueId: Issue identifier (required)
 * - sourceSystem: Source system ('github' | 'afu9', default: 'afu9')
 * 
 * Returns:
 * - nodes: Array of timeline nodes in deterministic order
 * - edges: Array of edges connecting the nodes
 * - metadata: Query metadata (counts, timestamp)
 */
export const GET = withApi(async (request: NextRequest) => {
  const pool = getPool();
  const dao = getTimelineDAO(pool);

  // Parse and validate query parameters
  const searchParams = request.nextUrl.searchParams;
  const issueIdParam = searchParams.get('issueId');
  const sourceSystemParam = searchParams.get('sourceSystem');

  // Prepare data for validation (empty string should be treated as invalid, not undefined)
  const issueId = issueIdParam === null ? undefined : issueIdParam;
  const sourceSystem = sourceSystemParam || 'afu9';

  // Validate query parameters
  const validation = ChainQuerySchema.safeParse({ issueId, sourceSystem });
  if (!validation.success) {
    const errorIssues = validation.error.issues || [];
    const errors = errorIssues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return apiError(
      'Invalid query parameters',
      400,
      errors
    );
  }

  const { issueId: validatedIssueId, sourceSystem: validatedSourceSystem } = validation.data;

  try {
    // Query the chain using TimelineDAO
    const chain = await dao.listChainForIssue(validatedSourceSystem, validatedIssueId);

    // Sort nodes deterministically
    const sortedNodes = sortNodesDeterministically(chain.nodes);

    // Build response
    const response = {
      issueId: validatedIssueId,
      sourceSystem: validatedSourceSystem,
      nodes: sortedNodes,
      edges: chain.edges,
      metadata: {
        nodeCount: sortedNodes.length,
        edgeCount: chain.edges.length,
        timestamp: new Date().toISOString(),
      },
    };

    // Validate response schema
    const validatedResponse = ChainResponseSchema.parse(response);

    return NextResponse.json(validatedResponse, { status: 200 });
  } catch (error) {
    console.error('[/api/timeline/chain] Error querying chain:', error);
    return apiError(
      'Failed to query timeline chain',
      500,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
});
