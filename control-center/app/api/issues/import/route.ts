/**
 * API Route: /api/issues/import
 * 
 * Bulk import issues from text/markdown content
 * Issue #AFU9-C: Issues UX Acceleration
 * 
 * Supports:
 * - Multiple issues separated by "---"
 * - First non-empty line = title
 * - Rest = body
 * - Optional meta-lines: "Labels: tag1, tag2" and "Status: CREATED"
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { createAfu9Issue } from '../../../../src/lib/db/afu9Issues';
import { Afu9IssueStatus, isValidStatus } from '../../../../src/lib/contracts/afu9Issue';
import { normalizeIssueForApi } from '../_shared';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

interface ParsedIssue {
  title: string;
  body: string;
  labels: string[];
  status: Afu9IssueStatus;
}

/**
 * Parse a single issue block from text
 * 
 * Format:
 * - First non-empty line = title
 * - Optional meta-lines: "Labels: tag1, tag2" or "Status: CREATED"
 * - Remaining lines = body
 * 
 * @param text - Issue text block
 * @returns Parsed issue data
 */
function parseIssueBlock(text: string): ParsedIssue | null {
  const lines = text.split('\n');
  let title = '';
  let body = '';
  const labels: string[] = [];
  let status: Afu9IssueStatus = Afu9IssueStatus.CREATED;
  
  const bodyLines: string[] = [];
  let titleFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines at the start
    if (!titleFound && !line) {
      continue;
    }

    // First non-empty line is the title (unless it's a meta-line)
    if (!titleFound && line && !line.match(/^(Labels|Status):/i)) {
      title = line;
      titleFound = true;
      continue;
    }

    // Check for meta-lines
    const labelsMatch = line.match(/^Labels:\s*(.+)$/i);
    if (labelsMatch) {
      const labelStr = labelsMatch[1];
      labels.push(...labelStr.split(',').map(l => l.trim()).filter(l => l));
      continue;
    }

    const statusMatch = line.match(/^Status:\s*(.+)$/i);
    if (statusMatch) {
      const statusStr = statusMatch[1].trim().toUpperCase();
      if (isValidStatus(statusStr)) {
        status = statusStr as Afu9IssueStatus;
      }
      continue;
    }

    // Everything else is body
    bodyLines.push(lines[i]); // Keep original formatting
  }

  // Join body lines and trim
  body = bodyLines.join('\n').trim();

  // Validate that we have at least a title
  if (!title) {
    return null;
  }

  return {
    title,
    body,
    labels,
    status,
  };
}

/**
 * POST /api/issues/import
 * Bulk import issues from text/markdown
 * 
 * Body:
 * - content: string (required) - Markdown/text content with issues
 * 
 * Format:
 * - Issues separated by "---" on its own line
 * - Each issue: first line = title, rest = body
 * - Optional meta-lines: "Labels: tag1, tag2" or "Status: CREATED"
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const pool = getPool();
    const body = await request.json();

    // Validate input
    if (!body.content || typeof body.content !== 'string') {
      return errorResponse('Invalid input: content is required and must be a string', {
        status: 400,
        requestId,
      });
    }

    const content = body.content.trim();
    if (!content) {
      return errorResponse('Invalid input: content cannot be empty', {
        status: 400,
        requestId,
      });
    }

    // Split content by "---" separator
    const blocks = content.split(/\n---\n/).map(block => block.trim()).filter(block => block);

    if (blocks.length === 0) {
      return errorResponse('No issues found in content', {
        status: 400,
        requestId,
      });
    }

    // Parse each block
    const parsedIssues: ParsedIssue[] = [];
    const parseErrors: string[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const parsed = parseIssueBlock(blocks[i]);
      if (parsed) {
        parsedIssues.push(parsed);
      } else {
        parseErrors.push(`Block ${i + 1}: Could not parse (no title found)`);
      }
    }

    if (parsedIssues.length === 0) {
      return errorResponse('No valid issues found in content', {
        status: 400,
        requestId,
        details: parseErrors.join('; '),
      });
    }

    // Create issues in database
    const createdIssues: any[] = [];
    const createErrors: string[] = [];

    for (const parsed of parsedIssues) {
      const result = await createAfu9Issue(pool, {
        title: parsed.title,
        body: parsed.body || null,
        labels: parsed.labels,
        status: parsed.status,
        priority: null,
        assignee: null,
      });

      if (result.success && result.data) {
        createdIssues.push(normalizeIssueForApi(result.data));
      } else {
        createErrors.push(`"${parsed.title}": ${result.error || 'Unknown error'}`);
      }
    }

    // Return results
    const response: any = {
      success: true,
      imported: createdIssues.length,
      total: parsedIssues.length,
      issues: createdIssues,
    };

    if (parseErrors.length > 0) {
      response.parseErrors = parseErrors;
    }

    if (createErrors.length > 0) {
      response.createErrors = createErrors;
    }

    return jsonResponse(response, { 
      status: createdIssues.length > 0 ? 201 : 207, // 207 Multi-Status if some failed
      requestId,
    });
  } catch (error) {
    console.error('[API /api/issues/import] Error importing issues:', error);
    return errorResponse('Failed to import issues', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
