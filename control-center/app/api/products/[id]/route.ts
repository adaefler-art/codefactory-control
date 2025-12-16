/**
 * API Route: /api/products/[id]
 * 
 * Manages individual products
 * EPIC 4: Product Registry & Templates
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { ProductService } from '../../../../src/lib/product-service';
import { UpdateProductRequest, ArchiveProductRequest } from '../../../../src/lib/types/product';

/**
 * GET /api/products/[id]
 * Get a specific product by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const productService = new ProductService(pool);
    const { id } = await params;

    // Check if requesting with template resolution
    const searchParams = request.nextUrl.searchParams;
    const withTemplate = searchParams.get('withTemplate') === 'true';

    const product = withTemplate
      ? await productService.getProductWithTemplate(id)
      : await productService.getProduct(id);

    if (!product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(product);
  } catch (error) {
    console.error('[API /api/products/[id]] Error fetching product:', error);
    return NextResponse.json(
      { error: 'Failed to fetch product', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/products/[id]
 * Update a product
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const productService = new ProductService(pool);
    const { id } = await params;

    const body = await request.json();

    // Check if product exists
    const existingProduct = await productService.getProduct(id);
    if (!existingProduct) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    const updateRequest: UpdateProductRequest = {
      displayName: body.displayName,
      description: body.description,
      metadata: body.metadata,
      tags: body.tags,
      constraints: body.constraints,
      kpiTargets: body.kpiTargets,
      templateId: body.templateId,
      templateConfig: body.templateConfig,
      enabled: body.enabled,
      isolationLevel: body.isolationLevel,
      ownerTeam: body.ownerTeam,
      contactEmail: body.contactEmail,
      updatedBy: body.updatedBy || 'api',
    };

    const product = await productService.updateProduct(id, updateRequest);

    return NextResponse.json(product);
  } catch (error) {
    console.error('[API /api/products/[id]] Error updating product:', error);
    return NextResponse.json(
      { error: 'Failed to update product', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/products/[id]
 * Delete a product (hard delete) or archive if query param archive=true
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const productService = new ProductService(pool);
    const { id } = await params;

    // Check if product exists
    const existingProduct = await productService.getProduct(id);
    if (!existingProduct) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const archive = searchParams.get('archive') === 'true';

    if (archive) {
      // Archive product
      const reason = searchParams.get('reason') || 'Archived via API';
      const archivedBy = searchParams.get('archivedBy') || 'api';

      const archiveRequest: ArchiveProductRequest = {
        reason,
        archivedBy,
      };

      const product = await productService.archiveProduct(id, archiveRequest);
      return NextResponse.json({
        message: 'Product archived successfully',
        product,
      });
    } else {
      // Hard delete
      await productService.deleteProduct(id);
      return NextResponse.json({
        message: 'Product deleted successfully',
      });
    }
  } catch (error) {
    console.error('[API /api/products/[id]] Error deleting product:', error);
    return NextResponse.json(
      { error: 'Failed to delete product', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
