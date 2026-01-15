/**
 * API Route: Automation KPI Dashboard (E88.2)
 * 
 * GET /api/ops/kpis?period=cycle|7d|30d&cycleId=...
 * 
 * Returns automation metrics for operational dashboard:
 * - D2D (Decision → Deploy) - Time from issue assignment to deploy
 * - HSH (Human Steering Hours) - Manual intervention time
 * - DCU (Delivered Capability Units) - Deployed features/fixes
 * - Automation Coverage % - automated_steps / (automated_steps + manual_touchpoints)
 * 
 * All data is deterministically calculated from existing tables.
 * No manual input required.
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
import { getPool } from '@/lib/db';
import { z } from 'zod';

// ========================================
// Type Definitions
// ========================================

interface KpiMetric {
  name: string;
  value: number | null;
  unit: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
}

interface TouchpointBreakdown {
  type: string;
  count: number;
  percentage: number;
}

interface CycleDetail {
  cycleId: string;
  d2d: number | null;
  hsh: number;
  dcu: number;
  automationCoverage: number;
  issueCount: number;
  touchpointCount: number;
  startedAt: string | null;
  deployedAt: string | null;
}

interface IssueDetail {
  issueId: string;
  ghIssueNumber: number | null;
  cycleId: string | null;
  touchpointCount: number;
  d2d: number | null;
  createdAt: string;
  deployedAt: string | null;
}

interface KpiDashboardResponse {
  summary: {
    d2d: KpiMetric;
    hsh: KpiMetric;
    dcu: KpiMetric;
    automationCoverage: KpiMetric;
  };
  touchpointBreakdown: TouchpointBreakdown[];
  cycles?: CycleDetail[];
  issues?: IssueDetail[];
  filters: {
    period: string;
    cycleId: string | null;
    from: string | null;
    to: string | null;
  };
  metadata: {
    calculatedAt: string;
    dataVersion: string;
  };
}

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
 * Calculate time window based on period parameter
 */
function getTimeWindow(period: string, cycleId: string | null): { from: string | null; to: string | null } {
  const now = new Date();
  
  if (cycleId) {
    // Cycle-specific: return null to query by cycle_id instead
    return { from: null, to: null };
  }
  
  switch (period) {
    case '7d':
      return {
        from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
      };
    case '30d':
      return {
        from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
      };
    case 'cycle':
    default:
      // Last cycle: get most recent cycle_id from touchpoints
      return { from: null, to: null };
  }
}

/**
 * GET /api/ops/kpis
 * 
 * Query parameters:
 * - period: Time period (cycle, 7d, 30d) - default: cycle
 * - cycleId: Specific cycle ID to filter by - optional
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
        details: 'Admin privileges required to access automation KPI dashboard',
      });
    }
    
    // 3. PARSE QUERY PARAMETERS
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'cycle';
    const cycleIdParam = searchParams.get('cycleId');
    
    const querySchema = z.object({
      period: z.enum(['cycle', '7d', '30d']),
      cycleId: z.string().optional(),
    });
    
    const validationResult = querySchema.safeParse({
      period: periodParam,
      cycleId: cycleIdParam || undefined,
    });
    
    if (!validationResult.success) {
      return errorResponse('Invalid query parameters', {
        status: 400,
        requestId,
        details: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
    }
    
    const { period, cycleId } = validationResult.data;
    const { from, to } = getTimeWindow(period, cycleId || null);
    
    const pool = getPool();
    
    // 4. FETCH TOUCHPOINT DATA
    // Get touchpoints with time/cycle filter
    const touchpointQuery = `
      SELECT 
        type,
        cycle_id,
        issue_id,
        gh_issue_number,
        pr_number,
        created_at,
        actor
      FROM manual_touchpoints
      WHERE 
        ($1::VARCHAR IS NULL OR cycle_id = $1)
        AND ($2::TIMESTAMPTZ IS NULL OR created_at >= $2)
        AND ($3::TIMESTAMPTZ IS NULL OR created_at <= $3)
      ORDER BY created_at DESC
    `;
    
    const touchpointResult = await pool.query(touchpointQuery, [cycleId || null, from, to]);
    const touchpoints = touchpointResult.rows;
    
    // 5. CALCULATE HSH (Human Steering Hours)
    // Assumption: Each touchpoint = 0.25 hours (15 minutes) average
    // This can be refined with actual timing data later
    const HOURS_PER_TOUCHPOINT = 0.25;
    const totalTouchpoints = touchpoints.length;
    const hshValue = totalTouchpoints * HOURS_PER_TOUCHPOINT;
    
    // 6. CALCULATE TOUCHPOINT BREAKDOWN
    const touchpointByType = touchpoints.reduce((acc, row) => {
      acc[row.type] = (acc[row.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const touchpointBreakdown: TouchpointBreakdown[] = Object.entries(touchpointByType)
      .map(([type, count]) => ({
        type,
        count,
        percentage: totalTouchpoints > 0 ? parseFloat(((count / totalTouchpoints) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    
    // 7. FETCH DEPLOY EVENTS (for DCU and D2D)
    const deployQuery = `
      SELECT 
        id,
        created_at,
        env,
        service,
        version,
        status
      FROM deploy_events
      WHERE 
        status = 'success'
        AND ($1::TIMESTAMPTZ IS NULL OR created_at >= $1)
        AND ($2::TIMESTAMPTZ IS NULL OR created_at <= $2)
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    
    const deployResult = await pool.query(deployQuery, [from, to]);
    const deploys = deployResult.rows;
    
    // DCU = number of successful deploys
    const dcuValue = deploys.length;
    
    // 8. CALCULATE D2D (Decision → Deploy)
    // For each cycle/issue, calculate time from first touchpoint to deploy
    // Average across all cycles/issues
    const cycleMap = new Map<string, { firstTouchpoint: Date; lastDeploy: Date | null }>();
    
    for (const tp of touchpoints) {
      if (!tp.cycle_id) continue;
      
      if (!cycleMap.has(tp.cycle_id)) {
        cycleMap.set(tp.cycle_id, {
          firstTouchpoint: new Date(tp.created_at),
          lastDeploy: null,
        });
      } else {
        const existing = cycleMap.get(tp.cycle_id)!;
        const tpDate = new Date(tp.created_at);
        if (tpDate < existing.firstTouchpoint) {
          existing.firstTouchpoint = tpDate;
        }
      }
    }
    
    // Match deploys to cycles (simplified: use creation time proximity)
    // In a real system, this would use explicit cycle → deploy mapping
    for (const deploy of deploys) {
      const deployDate = new Date(deploy.created_at);
      
      // Find closest cycle based on touchpoint timing
      let closestCycle: string | null = null;
      let closestDiff = Infinity;
      
      for (const [cycleId, data] of cycleMap.entries()) {
        const diff = Math.abs(deployDate.getTime() - data.firstTouchpoint.getTime());
        if (diff < closestDiff && deployDate >= data.firstTouchpoint) {
          closestDiff = diff;
          closestCycle = cycleId;
        }
      }
      
      if (closestCycle && closestDiff < 7 * 24 * 60 * 60 * 1000) { // Within 7 days
        const cycleData = cycleMap.get(closestCycle)!;
        if (!cycleData.lastDeploy || deployDate > cycleData.lastDeploy) {
          cycleData.lastDeploy = deployDate;
        }
      }
    }
    
    // Calculate average D2D
    const d2dValues: number[] = [];
    for (const [, data] of cycleMap.entries()) {
      if (data.lastDeploy) {
        const d2dHours = (data.lastDeploy.getTime() - data.firstTouchpoint.getTime()) / (1000 * 60 * 60);
        d2dValues.push(d2dHours);
      }
    }
    
    const d2dValue = d2dValues.length > 0
      ? d2dValues.reduce((sum, v) => sum + v, 0) / d2dValues.length
      : null;
    
    // 9. CALCULATE AUTOMATION COVERAGE %
    // Formula: automated_steps / (automated_steps + manual_touchpoints)
    // automated_steps = successful deploys without errors
    // manual_touchpoints = total touchpoints
    const automatedSteps = dcuValue; // Each successful deploy represents automated work
    const manualTouchpoints = totalTouchpoints;
    const totalSteps = automatedSteps + manualTouchpoints;
    
    const automationCoverageValue = totalSteps > 0
      ? parseFloat(((automatedSteps / totalSteps) * 100).toFixed(2))
      : 100; // 100% if no touchpoints yet (fully automated)
    
    // 10. BUILD RESPONSE
    const response: KpiDashboardResponse = {
      summary: {
        d2d: {
          name: 'Decision → Deploy',
          value: d2dValue !== null ? parseFloat(d2dValue.toFixed(2)) : null,
          unit: 'hours',
          trend: 'stable',
        },
        hsh: {
          name: 'Human Steering Hours',
          value: parseFloat(hshValue.toFixed(2)),
          unit: 'hours',
          trend: 'stable',
        },
        dcu: {
          name: 'Delivered Capability Units',
          value: dcuValue,
          unit: 'deploys',
          trend: 'stable',
        },
        automationCoverage: {
          name: 'Automation Coverage',
          value: automationCoverageValue,
          unit: '%',
          trend: automationCoverageValue >= 80 ? 'up' : automationCoverageValue >= 50 ? 'stable' : 'down',
        },
      },
      touchpointBreakdown,
      filters: {
        period,
        cycleId: cycleId || null,
        from,
        to,
      },
      metadata: {
        calculatedAt: new Date().toISOString(),
        dataVersion: '1.0.0',
      },
    };
    
    return jsonResponse(response, { requestId });
  } catch (error) {
    console.error('[API] Error fetching automation KPI data:', error);
    
    return errorResponse('Failed to fetch automation KPI data', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
