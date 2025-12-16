/**
 * API Route: /api/products
 * 
 * Manages products in the AFU-9 Product Registry
 * EPIC 4: Product Registry & Templates
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';
import { ProductService } from '../../../src/lib/product-service';
import { CreateProductRequest, ProductQueryParams, PRODUCT_KEY_REGEX, ProductIsolationLevel } from '../../../src/lib/types/product';

// Valid sort fields
const VALID_SORT_FIELDS = ['created_at', 'updated_at', 'display_name', 'product_key'] as const;
const VALID_SORT_ORDERS = ['asc', 'desc'] as const;
const VALID_ISOLATION_LEVELS: ProductIsolationLevel[] = ['standard', 'strict', 'relaxed'];

/**
 * Validate and parse sort field
 */
function parseValidSortBy(value: string | null): ProductQueryParams['sortBy'] {
  if (!value) return 'created_at';
  if (VALID_SORT_FIELDS.includes(value as typeof VALID_SORT_FIELDS[number])) {
    return value as ProductQueryParams['sortBy'];
  }
  return 'created_at';
}

/**
 * Validate and parse sort order
 */
function parseValidSortOrder(value: string | null): ProductQueryParams['sortOrder'] {
  if (!value) return 'desc';
  if (VALID_SORT_ORDERS.includes(value as typeof VALID_SORT_ORDERS[number])) {
    return value as ProductQueryParams['sortOrder'];
  }
  return 'desc';
}

/**
 * Validate and parse isolation level
 */
function parseValidIsolationLevel(value: string | null): ProductIsolationLevel | undefined {
  if (!value) return undefined;
  return VALID_ISOLATION_LEVELS.includes(value as ProductIsolationLevel)
    ? (value as ProductIsolationLevel)
    : undefined;
}

/**
 * GET /api/products
 * List all products with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    const productService = new ProductService(pool);

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const params: ProductQueryParams = {
      enabled: searchParams.get('enabled') === 'true' ? true : searchParams.get('enabled') === 'false' ? false : undefined,
      archived: searchParams.get('archived') === 'true' ? true : searchParams.get('archived') === 'false' ? false : undefined,
      templateId: searchParams.get('templateId') || undefined,
      ownerTeam: searchParams.get('ownerTeam') || undefined,
      isolationLevel: parseValidIsolationLevel(searchParams.get('isolationLevel')),
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0,
      sortBy: parseValidSortBy(searchParams.get('sortBy')),
      sortOrder: parseValidSortOrder(searchParams.get('sortOrder')),
    };

    // Parse tags if provided (comma-separated)
    const tagsParam = searchParams.get('tags');
    if (tagsParam) {
      params.tags = tagsParam.split(',').map(t => t.trim());
    }

    const response = await productService.listProducts(params);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[API /api/products] Error listing products:', error);
    return NextResponse.json(
      { error: 'Failed to list products', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/products
 * Create a new product
 */
export async function POST(request: NextRequest) {
  try {
    const pool = getPool();
    const productService = new ProductService(pool);

    const body = await request.json();

    // Validate required fields
    if (!body.repositoryId) {
      return NextResponse.json(
        { error: 'repositoryId is required' },
        { status: 400 }
      );
    }

    if (!body.productKey) {
      return NextResponse.json(
        { error: 'productKey is required' },
        { status: 400 }
      );
    }

    if (!body.displayName) {
      return NextResponse.json(
        { error: 'displayName is required' },
        { status: 400 }
      );
    }

    // Validate product key format (owner/repo)
    if (!PRODUCT_KEY_REGEX.test(body.productKey)) {
      return NextResponse.json(
        { error: 'productKey must be in format "owner/repo"' },
        { status: 400 }
      );
    }

    // Check if product key already exists
    const existingProduct = await productService.getProductByKey(body.productKey);
    if (existingProduct) {
      return NextResponse.json(
        { error: 'Product with this key already exists' },
        { status: 409 }
      );
    }

    const request_data: CreateProductRequest = {
      repositoryId: body.repositoryId,
      productKey: body.productKey,
      displayName: body.displayName,
      description: body.description,
      metadata: body.metadata,
      tags: body.tags,
      constraints: body.constraints,
      kpiTargets: body.kpiTargets,
      templateId: body.templateId,
      templateConfig: body.templateConfig,
      isolationLevel: body.isolationLevel,
      ownerTeam: body.ownerTeam,
      contactEmail: body.contactEmail,
      createdBy: body.createdBy || 'api',
    };

    const product = await productService.createProduct(request_data);

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    console.error('[API /api/products] Error creating product:', error);
    return NextResponse.json(
      { error: 'Failed to create product', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
