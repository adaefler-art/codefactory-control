/**
 * Tests for Product Service
 * 
 * Tests the Product Registry service layer
 * EPIC 4: Product Registry & Templates
 */

import { ProductService } from '../../src/lib/product-service';
import type { 
  CreateProductRequest, 
  UpdateProductRequest,
  ProductQueryParams 
} from '../../src/lib/types/product';

// Mock the database pool
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

describe('ProductService', () => {
  let productService: ProductService;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    productService = new ProductService(mockPool);
    jest.clearAllMocks();
  });

  describe('getProduct', () => {
    test('should return a product by ID', async () => {
      const mockProduct = {
        id: 'product-uuid',
        repository_id: 'repo-uuid',
        product_key: 'owner/repo',
        display_name: 'My Product',
        description: 'Test product',
        metadata: { primaryLanguage: 'TypeScript' },
        tags: ['web', 'api'],
        constraints: { maxBuildDurationMs: 600000 },
        kpi_targets: { successRate: 90 },
        template_id: 'web-service',
        template_config: null,
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: 'platform',
        contact_email: 'team@example.com',
        created_at: new Date('2024-12-16T00:00:00Z'),
        updated_at: new Date('2024-12-16T00:00:00Z'),
        created_by: 'system',
        updated_by: null,
      };

      mockPool.query.mockResolvedValue({ rows: [mockProduct] });

      const result = await productService.getProduct('product-uuid');

      expect(result).toBeDefined();
      expect(result?.id).toBe('product-uuid');
      expect(result?.productKey).toBe('owner/repo');
      expect(result?.displayName).toBe('My Product');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['product-uuid']
      );
    });

    test('should return null if product not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await productService.getProduct('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getProductByKey', () => {
    test('should return a product by product key', async () => {
      const mockProduct = {
        id: 'product-uuid',
        repository_id: 'repo-uuid',
        product_key: 'owner/repo',
        display_name: 'My Product',
        description: null,
        metadata: {},
        tags: [],
        constraints: {},
        kpi_targets: {},
        template_id: null,
        template_config: null,
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: null,
        contact_email: null,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: 'system',
        updated_by: null,
      };

      mockPool.query.mockResolvedValue({ rows: [mockProduct] });

      const result = await productService.getProductByKey('owner/repo');

      expect(result).toBeDefined();
      expect(result?.productKey).toBe('owner/repo');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE product_key = $1'),
        ['owner/repo']
      );
    });
  });

  describe('listProducts', () => {
    test('should list products with default parameters', async () => {
      const mockProducts = [
        {
          id: 'product-1',
          repository_id: 'repo-1',
          product_key: 'owner/repo1',
          display_name: 'Product 1',
          description: null,
          metadata: {},
          tags: [],
          constraints: {},
          kpi_targets: {},
          template_id: null,
          template_config: null,
          enabled: true,
          archived: false,
          archived_at: null,
          archived_reason: null,
          isolation_level: 'standard',
          owner_team: null,
          contact_email: null,
          created_at: new Date(),
          updated_at: new Date(),
          created_by: 'system',
          updated_by: null,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }] }) // Count query
        .mockResolvedValueOnce({ rows: mockProducts }); // List query

      const result = await productService.listProducts();

      expect(result.products).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    test('should filter products by enabled status', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const params: ProductQueryParams = {
        enabled: true,
        archived: false,
      };

      const result = await productService.listProducts(params);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE enabled = $1 AND archived = $2'),
        expect.any(Array)
      );
    });

    test('should search products by text', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const params: ProductQueryParams = {
        search: 'payment',
      };

      await productService.listProducts(params);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.arrayContaining(['%payment%'])
      );
    });
  });

  describe('createProduct', () => {
    test('should create a new product', async () => {
      const createRequest: CreateProductRequest = {
        repositoryId: 'repo-uuid',
        productKey: 'owner/repo',
        displayName: 'New Product',
        description: 'A new test product',
        templateId: 'web-service',
        metadata: { primaryLanguage: 'TypeScript' },
        tags: ['web'],
        constraints: { maxBuildDurationMs: 600000 },
        kpiTargets: { successRate: 90 },
        ownerTeam: 'platform',
        contactEmail: 'team@example.com',
        createdBy: 'api',
      };

      const mockCreatedProduct = {
        id: 'new-product-uuid',
        repository_id: createRequest.repositoryId,
        product_key: createRequest.productKey,
        display_name: createRequest.displayName,
        description: createRequest.description,
        metadata: createRequest.metadata,
        tags: createRequest.tags,
        constraints: createRequest.constraints,
        kpi_targets: createRequest.kpiTargets,
        template_id: createRequest.templateId,
        template_config: null,
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: createRequest.ownerTeam,
        contact_email: createRequest.contactEmail,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: createRequest.createdBy,
        updated_by: null,
      };

      mockPool.query.mockResolvedValue({ rows: [mockCreatedProduct] });

      const result = await productService.createProduct(createRequest);

      expect(result).toBeDefined();
      expect(result.id).toBe('new-product-uuid');
      expect(result.productKey).toBe(createRequest.productKey);
      expect(result.displayName).toBe(createRequest.displayName);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO products'),
        expect.any(Array)
      );
    });
  });

  describe('updateProduct', () => {
    test('should update a product', async () => {
      const updateRequest: UpdateProductRequest = {
        displayName: 'Updated Name',
        constraints: { maxBuildDurationMs: 900000 },
        updatedBy: 'api',
      };

      const mockUpdatedProduct = {
        id: 'product-uuid',
        repository_id: 'repo-uuid',
        product_key: 'owner/repo',
        display_name: updateRequest.displayName,
        description: null,
        metadata: {},
        tags: [],
        constraints: updateRequest.constraints,
        kpi_targets: {},
        template_id: null,
        template_config: null,
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: null,
        contact_email: null,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: 'system',
        updated_by: updateRequest.updatedBy,
      };

      mockPool.query.mockResolvedValue({ rows: [mockUpdatedProduct] });

      const result = await productService.updateProduct('product-uuid', updateRequest);

      expect(result).toBeDefined();
      expect(result.displayName).toBe(updateRequest.displayName);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE products'),
        expect.any(Array)
      );
    });

    test('should throw error if no fields to update', async () => {
      await expect(
        productService.updateProduct('product-uuid', {})
      ).rejects.toThrow('No fields to update');
    });

    test('should throw error if product not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(
        productService.updateProduct('non-existent', { displayName: 'Test' })
      ).rejects.toThrow('Product not found');
    });
  });

  describe('archiveProduct', () => {
    test('should archive a product', async () => {
      const mockArchivedProduct = {
        id: 'product-uuid',
        repository_id: 'repo-uuid',
        product_key: 'owner/repo',
        display_name: 'Archived Product',
        description: null,
        metadata: {},
        tags: [],
        constraints: {},
        kpi_targets: {},
        template_id: null,
        template_config: null,
        enabled: true,
        archived: true,
        archived_at: new Date(),
        archived_reason: 'No longer needed',
        isolation_level: 'standard',
        owner_team: null,
        contact_email: null,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: 'system',
        updated_by: 'api',
      };

      mockPool.query.mockResolvedValue({ rows: [mockArchivedProduct] });

      const result = await productService.archiveProduct('product-uuid', {
        reason: 'No longer needed',
        archivedBy: 'api',
      });

      expect(result).toBeDefined();
      expect(result.archived).toBe(true);
      expect(result.archivedReason).toBe('No longer needed');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE products'),
        expect.arrayContaining(['No longer needed', 'api', 'product-uuid'])
      );
    });
  });

  describe('deleteProduct', () => {
    test('should delete a product', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await productService.deleteProduct('product-uuid');

      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM products WHERE id = $1',
        ['product-uuid']
      );
    });
  });

  describe('getProductStatistics', () => {
    test('should return product statistics', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            total_products: '25',
            active_products: '20',
            archived_products: '5',
            avg_executions_per_product: '45',
          }],
        })
        .mockResolvedValueOnce({
          rows: [
            { template_id: 'web-service', count: '10' },
            { template_id: 'library', count: '5' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { isolation_level: 'standard', count: '20' },
            { isolation_level: 'strict', count: '3' },
          ],
        });

      const result = await productService.getProductStatistics();

      expect(result).toBeDefined();
      expect(result.totalProducts).toBe(25);
      expect(result.activeProducts).toBe(20);
      expect(result.archivedProducts).toBe(5);
      expect(result.averageExecutionsPerProduct).toBe(45);
      expect(result.productsByTemplate['web-service']).toBe(10);
      expect(result.productsByIsolationLevel['standard']).toBe(20);
    });
  });

  describe('listTemplates', () => {
    test('should list product templates', async () => {
      const mockTemplates = [
        {
          id: 'web-service',
          name: 'Web Service',
          description: 'Standard web service',
          default_metadata: {},
          default_constraints: { maxBuildDurationMs: 600000 },
          default_kpi_targets: { successRate: 90 },
          config_schema: null,
          enabled: true,
          version: '1.0.0',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: mockTemplates });

      const result = await productService.listTemplates();

      expect(result.templates).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.templates[0].id).toBe('web-service');
    });
  });
});
