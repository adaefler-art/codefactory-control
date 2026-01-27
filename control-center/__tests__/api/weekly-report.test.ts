/**
 * Tests for Weekly Report Export API (E88.3)
 * 
 * Verifies:
 * - Report generation with JSON and Markdown formats
 * - Deterministic structure and reproducibility
 * - Auth and admin gating
 * - Lawbook hash and version inclusion
 */

import { GET } from '../../app/api/ops/reports/weekly/route';
import { getPool } from '../../src/lib/db';
import { generateWeeklyReport } from '../../src/lib/weekly-report-service';

// Mock the database
jest.mock('../../src/lib/db');

describe('Weekly Report Export API', () => {
  const mockPool = {
    query: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getPool as jest.Mock).mockReturnValue(mockPool);
    
    // Set admin user for tests
    process.env.AFU9_ADMIN_SUBS = 'test-admin-user';
  });

  afterEach(() => {
    delete process.env.AFU9_ADMIN_SUBS;
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 when no auth header provided', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly');
      const response = await GET(request as any);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('should return 403 when user is not admin', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly', {
        headers: {
          'x-afu9-sub': 'non-admin-user',
        },
      });
      const response = await GET(request as any);
      
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.code).toBe('FORBIDDEN');
    });

    it('should return 403 when AFU9_ADMIN_SUBS is empty', async () => {
      process.env.AFU9_ADMIN_SUBS = '';
      
      const request = new Request('http://localhost/api/ops/reports/weekly', {
        headers: {
          'x-afu9-sub': 'any-user',
        },
      });
      const response = await GET(request as any);
      
      expect(response.status).toBe(403);
    });
  });

  describe('Query Parameter Validation', () => {
    it('should reject invalid date format', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly?periodStart=invalid-date', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid query parameters');
    });

    it('should reject invalid format parameter', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly?format=pdf', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      
      expect(response.status).toBe(400);
    });
  });

  describe('JSON Report Generation', () => {
    beforeEach(() => {
      // Mock all database queries
      mockPool.query.mockImplementation((query: string) => {
        if (query.includes('deploy_events')) {
          return Promise.resolve({
            rows: [
              {
                env: 'production',
                service: 'api',
                version: 'v1.0.0',
                commit_hash: 'abc123',
                created_at: new Date('2026-01-10T12:00:00Z'),
                status: 'success',
              },
            ],
          });
        }
        if (query.includes('kpi_measurements')) {
          return Promise.resolve({ rows: [{ avg_d2d: '5.5' }] });
        }
        if (query.includes('manual_touchpoints') && query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ touchpoint_count: '8' }] });
        }
        if (query.includes('manual_touchpoints') && query.includes('GROUP BY')) {
          return Promise.resolve({
            rows: [
              { type: 'REVIEW', count: '5' },
              { type: 'MERGE_APPROVAL', count: '3' },
            ],
          });
        }
        if (query.includes('incidents')) {
          return Promise.resolve({
            rows: [
              {
                incident_key: 'INC-001',
                severity: 'high',
                status: 'resolved',
                title: 'Test Incident',
                created_at: new Date('2026-01-09T10:00:00Z'),
                resolved_at: new Date('2026-01-09T15:00:00Z'),
              },
            ],
          });
        }
        if (query.includes('lawbook_events')) {
          return Promise.resolve({
            rows: [
              {
                lawbook_id: 'AFU9-LAWBOOK',
                event_type: 'version_activated',
                lawbook_version: '2026-01-08.1',
                created_at: new Date('2026-01-08T09:00:00Z'),
                previous_version: '2026-01-01.1',
              },
            ],
          });
        }
        if (query.includes('lawbook_active')) {
          return Promise.resolve({
            rows: [
              {
                lawbook_hash: 'abc123def456',
                lawbook_version: '2026-01-08.1',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should generate JSON report with default parameters', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');
      
      const data = await response.json();
      expect(data.report).toBeDefined();
      expect(data.report.reportVersion).toBe('1.0.0');
      expect(data.report.period).toBeDefined();
      expect(data.report.kpis).toBeDefined();
      expect(data.report.releases).toBeDefined();
      expect(data.report.topIncidents).toBeDefined();
      expect(data.report.manualTouchpoints).toBeDefined();
      expect(data.report.lawbookChanges).toBeDefined();
      expect(data.inputsHash).toBeDefined();
    });

    it('should include stable keys in report structure', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      const data = await response.json();
      
      // Verify stable keys exist
      expect(data.report).toHaveProperty('reportVersion');
      expect(data.report).toHaveProperty('generatedAt');
      expect(data.report).toHaveProperty('period');
      expect(data.report).toHaveProperty('releases');
      expect(data.report).toHaveProperty('kpis');
      expect(data.report).toHaveProperty('topIncidents');
      expect(data.report).toHaveProperty('manualTouchpoints');
      expect(data.report).toHaveProperty('lawbookChanges');
      expect(data.report).toHaveProperty('lawbookHash');
      expect(data.report).toHaveProperty('lawbookVersion');
    });

    it('should include KPI descriptions', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      const data = await response.json();
      
      expect(data.report.kpis.d2d.description).toBeDefined();
      expect(data.report.kpis.hsh.description).toBeDefined();
      expect(data.report.kpis.dcu.description).toBeDefined();
      expect(data.report.kpis.automationCoverage.description).toBeDefined();
    });

    it('should include lawbook hash and version', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      const data = await response.json();
      
      expect(data.report.lawbookHash).toBe('abc123def456');
      expect(data.report.lawbookVersion).toBe('2026-01-08.1');
    });

    it('should include inputs hash in headers', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      
      expect(response.headers.get('X-Inputs-Hash')).toBeDefined();
      expect(response.headers.get('X-Report-Version')).toBe('1.0.0');
    });
  });

  describe('Markdown Report Generation', () => {
    beforeEach(() => {
      // Mock database queries same as JSON tests
      mockPool.query.mockImplementation((query: string) => {
        if (query.includes('deploy_events')) {
          return Promise.resolve({
            rows: [
              {
                env: 'production',
                service: 'api',
                version: 'v1.0.0',
                commit_hash: 'abc123',
                created_at: new Date('2026-01-10T12:00:00Z'),
                status: 'success',
              },
            ],
          });
        }
        if (query.includes('manual_touchpoints') && query.includes('COUNT(*)')) {
          return Promise.resolve({ rows: [{ touchpoint_count: '0' }] });
        }
        if (query.includes('manual_touchpoints') && query.includes('GROUP BY')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should generate Markdown report when format=markdown', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly?format=markdown', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/markdown');
      
      const markdown = await response.text();
      expect(markdown).toContain('# Weekly Evidence Report');
      expect(markdown).toContain('## Key Performance Indicators');
      expect(markdown).toContain('## Releases');
      expect(markdown).toContain('## Top Incidents');
      expect(markdown).toContain('## Manual Touchpoints');
      expect(markdown).toContain('## Lawbook & Guardrails Changes');
    });

    it('should include Content-Disposition header for download', async () => {
      const request = new Request('http://localhost/api/ops/reports/weekly?format=markdown', {
        headers: {
          'x-afu9-sub': 'test-admin-user',
        },
      });
      const response = await GET(request as any);
      
      const disposition = response.headers.get('Content-Disposition');
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('weekly-report-');
      expect(disposition).toContain('.md');
    });
  });

  describe('Reproducibility', () => {
    const fixedPeriodStart = '2026-01-08T00:00:00.000Z';
    const fixedPeriodEnd = '2026-01-15T00:00:00.000Z';

    beforeEach(() => {
      mockPool.query.mockResolvedValue({ rows: [] });
    });

    it('should produce same inputsHash for same parameters', async () => {
      const request1 = new Request(
        `http://localhost/api/ops/reports/weekly?periodStart=${fixedPeriodStart}&periodEnd=${fixedPeriodEnd}`,
        {
          headers: {
            'x-afu9-sub': 'test-admin-user',
          },
        }
      );
      
      const request2 = new Request(
        `http://localhost/api/ops/reports/weekly?periodStart=${fixedPeriodStart}&periodEnd=${fixedPeriodEnd}`,
        {
          headers: {
            'x-afu9-sub': 'test-admin-user',
          },
        }
      );
      
      const response1 = await GET(request1 as any);
      const response2 = await GET(request2 as any);
      
      const data1 = await response1.json();
      const data2 = await response2.json();
      
      expect(data1.inputsHash).toBe(data2.inputsHash);
    });

    it('should produce different inputsHash for different periods', async () => {
      const request1 = new Request(
        `http://localhost/api/ops/reports/weekly?periodStart=${fixedPeriodStart}&periodEnd=${fixedPeriodEnd}`,
        {
          headers: {
            'x-afu9-sub': 'test-admin-user',
          },
        }
      );
      
      const request2 = new Request(
        `http://localhost/api/ops/reports/weekly?periodStart=2026-01-01T00:00:00.000Z&periodEnd=2026-01-08T00:00:00.000Z`,
        {
          headers: {
            'x-afu9-sub': 'test-admin-user',
          },
        }
      );
      
      const response1 = await GET(request1 as any);
      const response2 = await GET(request2 as any);
      
      const data1 = await response1.json();
      const data2 = await response2.json();
      
      expect(data1.inputsHash).not.toBe(data2.inputsHash);
    });
  });

  describe('Custom Time Periods', () => {
    beforeEach(() => {
      mockPool.query.mockResolvedValue({ rows: [] });
    });

    it('should accept custom periodStart and periodEnd', async () => {
      const periodStart = '2026-01-01T00:00:00.000Z';
      const periodEnd = '2026-01-08T00:00:00.000Z';
      
      const request = new Request(
        `http://localhost/api/ops/reports/weekly?periodStart=${periodStart}&periodEnd=${periodEnd}`,
        {
          headers: {
            'x-afu9-sub': 'test-admin-user',
          },
        }
      );
      const response = await GET(request as any);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.report.period.start).toBe(periodStart);
      expect(data.report.period.end).toBe(periodEnd);
    });

    it('should filter by environment when specified', async () => {
      const request = new Request(
        'http://localhost/api/ops/reports/weekly?environment=production',
        {
          headers: {
            'x-afu9-sub': 'test-admin-user',
          },
        }
      );
      const response = await GET(request as any);
      
      expect(response.status).toBe(200);
      
      // Verify query was called with environment filter
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('deploy_events'),
        expect.arrayContaining([expect.anything(), expect.anything(), 'production'])
      );
    });
  });
});
