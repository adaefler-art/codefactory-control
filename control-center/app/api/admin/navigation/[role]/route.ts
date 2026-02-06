/**
 * API Route: Admin Navigation Management
 * V09-I01: Navigation Management
 *
 * - GET /api/admin/navigation/[role]
 * - PUT /api/admin/navigation/[role]
 *
 * Admin-only access to manage navigation items per role.
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import {
  getNavigationItemsByRole,
  updateNavigationItems,
  type NavigationItemInput,
} from '@/lib/db/navigationItems';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_SIZE_BYTES = 100 * 1024; // 100KB cap

function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

function isValidRole(role: string): role is 'admin' | 'user' | 'guest' | '*' {
  return ['admin', 'user', 'guest', '*'].includes(role);
}

async function readBoundedJson(request: NextRequest, requestId: string): Promise<any | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > MAX_BODY_SIZE_BYTES) {
      return null;
    }
  }

  const bodyText = await request.text();
  const bytes = Buffer.byteLength(bodyText, 'utf8');
  if (bytes > MAX_BODY_SIZE_BYTES) {
    return null;
  }

  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { role: string } }
) {
  const requestId = getRequestId(request);

  // Auth check
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  if (!isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required',
    });
  }

  // Validate role
  const role = params.role;
  if (!isValidRole(role)) {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_ROLE',
      details: 'Role must be one of: admin, user, guest, *',
    });
  }

  try {
    const items = await getNavigationItemsByRole(role);

    return jsonResponse(
      {
        ok: true,
        role,
        items: items.map(item => ({
          id: item.id,
          href: item.href,
          label: item.label,
          position: item.position,
          enabled: item.enabled,
          icon: item.icon,
        })),
      },
      { requestId, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[API /api/admin/navigation/[role] GET] Error:', error);
    return errorResponse('Failed to load navigation items', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { role: string } }
) {
  const requestId = getRequestId(request);

  // Auth check
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  if (!isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required',
    });
  }

  // Validate role
  const role = params.role;
  if (!isValidRole(role)) {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_ROLE',
      details: 'Role must be one of: admin, user, guest, *',
    });
  }

  // Parse body
  const body = await readBoundedJson(request, requestId);
  if (!body || typeof body !== 'object') {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_JSON',
      details: `Request body must be valid JSON and not exceed ${MAX_BODY_SIZE_BYTES} bytes`,
    });
  }

  const items = body.items;
  if (!Array.isArray(items)) {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_ITEMS',
      details: 'Request body must include an "items" array',
    });
  }

  // Validate items structure
  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      return errorResponse('Bad Request', {
        status: 400,
        requestId,
        code: 'INVALID_ITEM',
        details: 'Each item must be an object',
      });
    }
    if (typeof item.href !== 'string' || !item.href.trim()) {
      return errorResponse('Bad Request', {
        status: 400,
        requestId,
        code: 'INVALID_HREF',
        details: 'Each item must have a valid href string',
      });
    }
    if (typeof item.label !== 'string' || !item.label.trim()) {
      return errorResponse('Bad Request', {
        status: 400,
        requestId,
        code: 'INVALID_LABEL',
        details: 'Each item must have a valid label string',
      });
    }
    if (typeof item.position !== 'number' || item.position < 0) {
      return errorResponse('Bad Request', {
        status: 400,
        requestId,
        code: 'INVALID_POSITION',
        details: 'Each item must have a valid position number >= 0',
      });
    }
  }

  try {
    const updatedItems = await updateNavigationItems(role, items as NavigationItemInput[]);

    return jsonResponse(
      {
        ok: true,
        role,
        items: updatedItems.map(item => ({
          id: item.id,
          href: item.href,
          label: item.label,
          position: item.position,
          enabled: item.enabled,
          icon: item.icon,
        })),
      },
      { requestId }
    );
  } catch (error) {
    console.error('[API /api/admin/navigation/[role] PUT] Error:', error);
    return errorResponse('Failed to update navigation items', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
