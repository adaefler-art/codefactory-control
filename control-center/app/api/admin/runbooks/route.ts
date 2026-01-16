/**
 * API: GET /api/admin/runbooks
 * Returns list of all runbooks with metadata
 * I905 - Runbooks UX
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateManifest } from '@/lib/runbooks/manifest';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const manifest = generateManifest();
    
    return NextResponse.json({
      ok: true,
      ...manifest
    });
  } catch (error) {
    console.error('Error loading runbooks:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load runbooks',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
