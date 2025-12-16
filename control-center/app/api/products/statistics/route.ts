/**
 * API Route: /api/products/statistics
 * 
 * Product statistics endpoint
 * EPIC 4: Product Registry & Templates
 */

import { NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { ProductService } from '../../../../src/lib/product-service';

/**
 * GET /api/products/statistics
 * Get aggregate statistics about products
 */
export async function GET() {
  try {
    const pool = getPool();
    const productService = new ProductService(pool);

    const statistics = await productService.getProductStatistics();

    return NextResponse.json(statistics);
  } catch (error) {
    console.error('[API /api/products/statistics] Error fetching statistics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch product statistics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
