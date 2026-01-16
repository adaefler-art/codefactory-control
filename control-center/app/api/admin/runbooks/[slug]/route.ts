/**
 * API: GET /api/admin/runbooks/[slug]
 * Returns specific runbook by slug including full content
 * I905 - Runbooks UX
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadRunbookBySlug } from '@/lib/runbooks/loader';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    
    const runbook = loadRunbookBySlug(slug);
    
    if (!runbook) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Runbook not found'
        },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      ok: true,
      runbook
    });
  } catch (error) {
    console.error('Error loading runbook:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load runbook',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
