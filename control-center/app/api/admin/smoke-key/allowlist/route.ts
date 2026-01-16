/**
 * API: /api/admin/smoke-key/allowlist
 * 
 * I906 - Runtime-configurable allowlist for smoke-key authenticated endpoints
 * 
 * Endpoints:
 * - GET: List current allowlist and stats
 * - POST: Add or remove route patterns
 * 
 * Security:
 * - Admin role required (AFU9_ADMIN_SUBS)
 * - Full audit logging
 * - Input validation
 * - Hard limits enforced
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import {
  getActiveAllowlist,
  getAllowlistHistory,
  getAllowlistStats,
  addRouteToAllowlist,
  removeRouteFromAllowlist,
  type AddRouteInput,
  type RemoveRouteInput,
} from '@/lib/db/smokeKeyAllowlist';

export const dynamic = 'force-dynamic';

// ========================================
// Admin Check
// ========================================

/**
 * Check if user is admin (based on AFU9_ADMIN_SUBS env var)
 */
function isAdminUser(userId: string | null): boolean {
  if (!userId) return false;
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

// ========================================
// GET - List Allowlist
// ========================================

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  // Authentication check (admin only - no smoke key bypass for this endpoint)
  const userId = request.headers.get('x-afu9-sub');
  
  if (!isAdminUser(userId)) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Admin privileges required',
    });
  }
  
  try {
    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get('history') === 'true';
    
    // Get allowlist
    const allowlistResult = includeHistory
      ? await getAllowlistHistory()
      : await getActiveAllowlist();
    
    if (!allowlistResult.success) {
      return errorResponse('Failed to fetch allowlist', {
        status: 500,
        requestId,
        details: allowlistResult.error,
      });
    }
    
    // Get stats
    const stats = await getAllowlistStats();
    
    return jsonResponse({
      ok: true,
      allowlist: allowlistResult.data || [],
      stats,
      includeHistory,
    }, { requestId });
  } catch (error) {
    console.error('[API /api/admin/smoke-key/allowlist GET] Error:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// ========================================
// POST - Add/Remove Route
// ========================================

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  
  // Authentication check (admin only)
  const userId = request.headers.get('x-afu9-sub');
  
  if (!isAdminUser(userId)) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Admin privileges required',
    });
  }
  
  try {
    const body = await request.json();
    const { op, route, method, isRegex, description } = body;
    
    // Validate operation
    if (!op || !['add', 'remove'].includes(op)) {
      return errorResponse('Invalid operation', {
        status: 400,
        requestId,
        details: 'Operation must be "add" or "remove"',
      });
    }
    
    // Validate route
    if (!route || typeof route !== 'string' || !route.trim()) {
      return errorResponse('Invalid route', {
        status: 400,
        requestId,
        details: 'Route pattern is required',
      });
    }
    
    const actor = userId || 'unknown';
    
    // Audit log
    console.log(JSON.stringify({
      level: 'info',
      event: 'smoke_key_allowlist_change',
      requestId,
      operation: op,
      route,
      method: method || '*',
      isRegex: isRegex || false,
      actor,
      timestamp: new Date().toISOString(),
    }));
    
    if (op === 'add') {
      const input: AddRouteInput = {
        routePattern: route,
        method: method || '*',
        isRegex: isRegex || false,
        description: description || null,
        addedBy: actor,
      };
      
      const result = await addRouteToAllowlist(input);
      
      if (!result.success) {
        const statusCode = 
          result.code === 'LIMIT_EXCEEDED' ? 429 :
          result.code === 'DUPLICATE' ? 409 :
          result.code === 'INVALID_INPUT' ? 400 :
          500;
        
        return errorResponse(result.error || 'Failed to add route', {
          status: statusCode,
          requestId,
          details: result.error,
        });
      }
      
      return jsonResponse({
        ok: true,
        operation: 'add',
        data: result.data,
      }, { requestId, status: 201 });
    } else {
      // op === 'remove'
      const input: RemoveRouteInput = {
        routePattern: route,
        method: method || '*',
        removedBy: actor,
      };
      
      const result = await removeRouteFromAllowlist(input);
      
      if (!result.success) {
        return errorResponse(result.error || 'Failed to remove route', {
          status: 500,
          requestId,
          details: result.error,
        });
      }
      
      if (!result.removed) {
        return errorResponse('Route not found', {
          status: 404,
          requestId,
          details: 'Route not found in active allowlist',
        });
      }
      
      return jsonResponse({
        ok: true,
        operation: 'remove',
        removed: true,
      }, { requestId });
    }
  } catch (error) {
    console.error('[API /api/admin/smoke-key/allowlist POST] Error:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
