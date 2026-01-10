/**
 * POST /api/intent/issue-draft/preview
 * 
 * Preview IssueDraft batch publishing without side effects (E82.2)
 * 
 * Shows action (create/update/skip) + reason + diff for each item.
 * No GitHub API calls, no database writes (read-only preview).
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * AUTH POLICY: All authenticated users allowed (read-only operation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApi } from '@/lib/http/withApi';
import { generatePreview, type PreviewInput, type ExistingIssueInfo } from '@/lib/github/issue-draft-preview';
import { IssueDraftSchema } from '@/lib/schemas/issueDraft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_SIZE_BYTES = 500 * 1024; // 500KB (multiple drafts)

/**
 * Request body schema
 */
const PreviewRequestSchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  drafts: z.array(IssueDraftSchema).min(1).max(20),
  existingIssues: z.record(
    z.string(), // canonicalId
    z.object({
      issueNumber: z.number().int().positive(),
      title: z.string(),
      body: z.string(),
      labels: z.array(z.string()),
      assignees: z.array(z.string()).optional(),
      milestone: z.string().nullable().optional(),
    })
  ).optional(),
}).strict();

export const POST = withApi(async (request: NextRequest) => {
  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

  // CONTENT-TYPE CHECK: Enforce application/json
  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { 
        error: 'Unsupported Media Type', 
        message: 'Content-Type must be application/json' 
      },
      { status: 415 }
    );
  }

  // BODY SIZE CHECK: Enforce max body size before parsing
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > MAX_BODY_SIZE_BYTES) {
      return NextResponse.json(
        { 
          error: 'Payload Too Large', 
          message: `Request body must not exceed ${MAX_BODY_SIZE_BYTES} bytes` 
        },
        { status: 413 }
      );
    }
  }

  let body: any;
  let bodyText: string;
  
  try {
    bodyText = await request.text();
    
    // Additional size check after reading body (defense in depth)
    if (bodyText.length > MAX_BODY_SIZE_BYTES) {
      return NextResponse.json(
        { 
          error: 'Payload Too Large', 
          message: `Request body must not exceed ${MAX_BODY_SIZE_BYTES} bytes` 
        },
        { status: 413 }
      );
    }
    
    body = JSON.parse(bodyText);
  } catch (parseError) {
    return NextResponse.json(
      { 
        error: 'Invalid JSON body',
        details: parseError instanceof Error ? parseError.message : 'Parse error'
      },
      { status: 400 }
    );
  }

  // Validate request schema
  const parseResult = PreviewRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Invalid request schema',
        details: parseResult.error.errors,
      },
      { status: 400 }
    );
  }

  const { owner, repo, drafts, existingIssues } = parseResult.data;

  // Convert existingIssues object to Map
  const existingIssuesMap = new Map<string, ExistingIssueInfo>();
  if (existingIssues) {
    Object.entries(existingIssues).forEach(([canonicalId, issue]) => {
      existingIssuesMap.set(canonicalId, issue);
    });
  }

  // Generate preview (no side effects)
  const previewInput: PreviewInput = {
    owner,
    repo,
    drafts,
    existingIssues: existingIssuesMap,
  };

  const preview = generatePreview(previewInput);

  return NextResponse.json(
    {
      preview,
      meta: {
        requestedBy: userId,
        timestamp: new Date().toISOString(),
        noSideEffects: true,
      },
    },
    { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to generate preview',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
