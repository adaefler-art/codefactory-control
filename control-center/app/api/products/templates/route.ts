/**
 * API Route: /api/products/templates
 * 
 * Product templates endpoint
 * EPIC 4: Product Registry & Templates
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { ProductService } from '../../../../src/lib/product-service';
import { TemplateQueryParams } from '../../../../src/lib/types/product';

/**
 * GET /api/products/templates
 * List all product templates
 */
export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    const productService = new ProductService(pool);

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const params: TemplateQueryParams = {
      enabled: searchParams.get('enabled') === 'true' ? true : searchParams.get('enabled') === 'false' ? false : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0,
    };

    const response = await productService.listTemplates(params);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[API /api/products/templates] Error listing templates:', error);
    return NextResponse.json(
      { error: 'Failed to list templates', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
