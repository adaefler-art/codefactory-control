/**
 * API Route: Weekly Report Export (E88.3)
 * 
 * GET /api/ops/reports/weekly?periodStart=...&periodEnd=...&format=json|markdown
 * 
 * Returns automated weekly evidence report for:
 * - Reviews
 * - Audits
 * - Stakeholder updates
 * - Archiving (Lawbook-compliant)
 * 
 * Content:
 * - Time period
 * - Releases in period
 * - KPIs (D2D, HSH, DCU, Automation Coverage %)
 * - Top Incidents
 * - Manual Touchpoint count
 * - Lawbook/Guardrails changes
 * 
 * Formats:
 * - JSON (machine-readable, default)
 * - Markdown (human-readable)
 * 
 * Features:
 * - Deterministic structure (stable keys)
 * - Versioned schema (reportVersion)
 * - Reproducible (same inputs → same output, except timestamp)
 * - Lawbook hash + version for traceability
 * 
 * Authentication: Required (x-afu9-sub header)
 * Authorization: Admin-only (AFU9_ADMIN_SUBS)
 * 
 * AFU-9 GUARDRAILS (strict ordering for fail-closed security):
 * 1. AUTH CHECK (401-first) - Verify x-afu9-sub, no DB calls
 * 2. ADMIN CHECK (403) - Verify admin allowlist, no DB calls
 * 3. DB OPERATIONS - Only executed if all gates pass
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { generateWeeklyReport, reportToMarkdown } from '@/lib/weekly-report-service';
import { z } from 'zod';

/**
 * Check if user sub is in admin allowlist
 * Fail-closed: empty/missing AFU9_ADMIN_SUBS → deny all
 */
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    return false;
  }
  
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}

/**
 * GET /api/ops/reports/weekly
 * 
 * Query parameters:
 * - periodStart: ISO 8601 timestamp (optional, defaults to 7 days ago)
 * - periodEnd: ISO 8601 timestamp (optional, defaults to now)
 * - format: 'json' or 'markdown' (optional, defaults to 'json')
 * - environment: Filter releases by environment (optional)
 * - includeAllIncidents: Include all incidents instead of top 10 (optional)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    // 1. AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
        details: 'Authentication required - no verified user context',
      });
    }
    
    // 2. AUTHORIZATION CHECK: Admin-only (fail-closed)
    if (!isAdminUser(userId)) {
      return errorResponse('Forbidden', {
        status: 403,
        requestId,
        code: 'FORBIDDEN',
        details: 'Admin privileges required to access weekly reports',
      });
    }
    
    // 3. PARSE QUERY PARAMETERS
    const { searchParams } = new URL(request.url);
    
    const querySchema = z.object({
      periodStart: z.string().datetime().optional(),
      periodEnd: z.string().datetime().optional(),
      format: z.enum(['json', 'markdown']).optional(),
      environment: z.string().optional(),
      includeAllIncidents: z.enum(['true', 'false']).optional(),
    });
    
    const validationResult = querySchema.safeParse({
      periodStart: searchParams.get('periodStart') || undefined,
      periodEnd: searchParams.get('periodEnd') || undefined,
      format: searchParams.get('format') || undefined,
      environment: searchParams.get('environment') || undefined,
      includeAllIncidents: searchParams.get('includeAllIncidents') || undefined,
    });
    
    if (!validationResult.success) {
      return errorResponse('Invalid query parameters', {
        status: 400,
        requestId,
        details: validationResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
    }
    
    const params = validationResult.data;
    
    // 4. GENERATE REPORT
    const reportResponse = await generateWeeklyReport({
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      format: params.format,
      environment: params.environment,
      includeAllIncidents: params.includeAllIncidents === 'true',
    });
    
    // 5. RETURN RESPONSE BASED ON FORMAT
    if (reportResponse.format === 'markdown') {
      const markdownContent = reportToMarkdown(reportResponse.report);
      
      return new Response(markdownContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="weekly-report-${reportResponse.report.period.start.split('T')[0]}.md"`,
          'X-Request-ID': requestId,
          'X-Inputs-Hash': reportResponse.inputsHash,
          'X-Report-Version': reportResponse.report.reportVersion,
        },
      });
    }
    
    // JSON format (default)
    return jsonResponse(reportResponse, {
      requestId,
      headers: {
        'Content-Disposition': `attachment; filename="weekly-report-${reportResponse.report.period.start.split('T')[0]}.json"`,
        'X-Inputs-Hash': reportResponse.inputsHash,
        'X-Report-Version': reportResponse.report.reportVersion,
      },
    });
  } catch (error) {
    console.error('[API] Error generating weekly report:', error);
    
    return errorResponse('Failed to generate weekly report', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
