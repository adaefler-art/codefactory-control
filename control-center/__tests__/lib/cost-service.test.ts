/**
 * Cost Service Tests
 * 
 * Tests for EPIC 9: Cost & Efficiency Engine
 * Issue 9.1: Cost Attribution per Run
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  getExecutionCost,
  getRecentExecutionCosts,
  getProductCostAnalysis,
  getFactoryCostOverview,
  getCostDataForExport,
  convertCostDataToCSV,
  getCostAllocationRules,
} from '@/lib/cost-service';
import { getPool } from '@/lib/db';

describe('Cost Service', () => {
  describe('getExecutionCost', () => {
    it('should return null for non-existent execution', async () => {
      const cost = await getExecutionCost('non-existent-uuid');
      expect(cost).toBeNull();
    });

    it('should return cost data for valid execution (if exists)', async () => {
      // This test assumes there's cost data in the database
      // In a real test, you'd set up test data first
      const pool = getPool();
      const result = await pool.query(
        'SELECT execution_id FROM aws_cost_attribution LIMIT 1'
      );
      
      if (result.rows.length > 0) {
        const executionId = result.rows[0].execution_id;
        const cost = await getExecutionCost(executionId);
        
        expect(cost).not.toBeNull();
        expect(cost?.executionId).toBe(executionId);
        expect(cost?.totalCost).toBeGreaterThanOrEqual(0);
        expect(cost?.totalAwsCost).toBeGreaterThanOrEqual(0);
        expect(cost?.calculationMethod).toMatch(/estimated|cost_explorer|manual/);
      }
    });
  });

  describe('getRecentExecutionCosts', () => {
    it('should return an array of execution costs', async () => {
      const costs = await getRecentExecutionCosts(10);
      
      expect(Array.isArray(costs)).toBe(true);
      expect(costs.length).toBeLessThanOrEqual(10);
      
      if (costs.length > 0) {
        const firstCost = costs[0];
        expect(firstCost).toHaveProperty('executionId');
        expect(firstCost).toHaveProperty('totalCost');
        expect(firstCost).toHaveProperty('totalAwsCost');
        expect(firstCost).toHaveProperty('llmCost');
        expect(firstCost).toHaveProperty('calculationMethod');
      }
    });

    it('should respect the limit parameter', async () => {
      const costs = await getRecentExecutionCosts(5);
      expect(costs.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getProductCostAnalysis', () => {
    it('should return product cost summaries', async () => {
      const products = await getProductCostAnalysis();
      
      expect(Array.isArray(products)).toBe(true);
      
      if (products.length > 0) {
        const firstProduct = products[0];
        expect(firstProduct).toHaveProperty('repositoryId');
        expect(firstProduct).toHaveProperty('productName');
        expect(firstProduct).toHaveProperty('totalCost');
        expect(firstProduct).toHaveProperty('avgCostPerRun');
        expect(firstProduct).toHaveProperty('totalExecutions');
        expect(firstProduct.totalCost).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getFactoryCostOverview', () => {
    it('should return factory-level cost overview', async () => {
      const overview = await getFactoryCostOverview();
      
      expect(overview).toHaveProperty('totalCost');
      expect(overview).toHaveProperty('totalAwsCost');
      expect(overview).toHaveProperty('totalLlmCost');
      expect(overview).toHaveProperty('totalExecutions');
      expect(overview).toHaveProperty('successfulOutcomes');
      expect(overview).toHaveProperty('costPerOutcome');
      
      expect(overview.totalCost).toBeGreaterThanOrEqual(0);
      expect(overview.totalExecutions).toBeGreaterThanOrEqual(0);
    });

    it('should calculate Cost per Outcome correctly', async () => {
      const overview = await getFactoryCostOverview();
      
      if (overview.successfulOutcomes > 0 && overview.totalCost > 0) {
        const expectedCostPerOutcome = overview.totalCost / overview.successfulOutcomes;
        expect(overview.costPerOutcome).toBeCloseTo(expectedCostPerOutcome, 4);
      } else {
        // If no successful outcomes, costPerOutcome should be null
        expect(overview.costPerOutcome).toBeNull();
      }
    });
  });

  describe('getCostDataForExport', () => {
    it('should return export data without filters', async () => {
      const data = await getCostDataForExport();
      
      expect(Array.isArray(data)).toBe(true);
      
      if (data.length > 0) {
        const firstRow = data[0];
        expect(firstRow).toHaveProperty('executionId');
        expect(firstRow).toHaveProperty('workflowId');
        expect(firstRow).toHaveProperty('status');
        expect(firstRow).toHaveProperty('totalCost');
        expect(firstRow).toHaveProperty('awsCost');
        expect(firstRow).toHaveProperty('llmCost');
      }
    });

    it('should filter by date range', async () => {
      const startDate = '2025-12-01';
      const endDate = '2025-12-31';
      
      const data = await getCostDataForExport(startDate, endDate);
      
      expect(Array.isArray(data)).toBe(true);
      
      // Verify all dates are within range
      data.forEach(row => {
        const startedAt = new Date(row.startedAt);
        expect(startedAt >= new Date(startDate)).toBe(true);
        expect(startedAt <= new Date(endDate)).toBe(true);
      });
    });
  });

  describe('convertCostDataToCSV', () => {
    it('should convert data to CSV format', () => {
      const testData = [
        {
          executionId: 'test-uuid-1',
          workflowId: 'workflow-uuid-1',
          productName: 'owner/repo',
          status: 'completed',
          startedAt: '2025-12-18T10:00:00Z',
          completedAt: '2025-12-18T10:05:00Z',
          durationMinutes: 5.0,
          totalCost: 0.00355,
          awsCost: 0.001094,
          llmCost: 0.002456,
          ecsCost: 0.000583,
          rdsCost: 0.0005,
          calculationMethod: 'estimated',
        },
      ];
      
      const csv = convertCostDataToCSV(testData);
      
      expect(csv).toContain('Execution ID');
      expect(csv).toContain('Total Cost (USD)');
      expect(csv).toContain('test-uuid-1');
      expect(csv).toContain('0.003550');
      
      // Check CSV structure
      const lines = csv.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2); // Header + at least 1 data row
    });

    it('should handle empty data array', () => {
      const csv = convertCostDataToCSV([]);
      
      const lines = csv.split('\n');
      expect(lines.length).toBe(1); // Only header
      expect(lines[0]).toContain('Execution ID');
    });
  });

  describe('getCostAllocationRules', () => {
    it('should return cost allocation rules', async () => {
      const rules = await getCostAllocationRules();
      
      expect(Array.isArray(rules)).toBe(true);
      
      if (rules.length > 0) {
        const firstRule = rules[0];
        expect(firstRule).toHaveProperty('id');
        expect(firstRule).toHaveProperty('ruleName');
        expect(firstRule).toHaveProperty('awsService');
        expect(firstRule).toHaveProperty('allocationMethod');
        expect(firstRule).toHaveProperty('enabled');
      }
    });

    it('should include default rules from migration', async () => {
      const rules = await getCostAllocationRules();
      
      const expectedRules = [
        'ECS Fargate Per Minute',
        'RDS PostgreSQL Shared',
        'Lambda Invocation',
        'CloudWatch Logs',
        'S3 Storage Operations',
        'Secrets Manager',
      ];
      
      const ruleNames = rules.map(r => r.ruleName);
      
      expectedRules.forEach(expectedName => {
        expect(ruleNames).toContain(expectedName);
      });
    });
  });

  describe('Cost Calculation Integration', () => {
    it('should calculate costs that sum correctly', async () => {
      const costs = await getRecentExecutionCosts(10);
      
      costs.forEach(cost => {
        const calculatedAwsTotal = 
          cost.lambdaCost + 
          cost.ecsCost + 
          cost.rdsCost + 
          cost.s3Cost + 
          cost.cloudwatchCost + 
          cost.secretsManagerCost + 
          cost.otherAwsCost;
        
        expect(cost.totalAwsCost).toBeCloseTo(calculatedAwsTotal, 6);
        
        const calculatedTotal = cost.totalAwsCost + cost.llmCost;
        expect(cost.totalCost).toBeCloseTo(calculatedTotal, 6);
      });
    });
  });

  describe('KPI: Cost per Outcome', () => {
    it('should calculate Cost per Outcome KPI', async () => {
      const overview = await getFactoryCostOverview();
      
      // Cost per Outcome should be null if no successful outcomes
      if (overview.successfulOutcomes === 0) {
        expect(overview.costPerOutcome).toBeNull();
      } else {
        // Cost per Outcome should be positive
        expect(overview.costPerOutcome).toBeGreaterThan(0);
        
        // Cost per Outcome should match formula
        const expected = overview.totalCost / overview.successfulOutcomes;
        expect(overview.costPerOutcome).toBeCloseTo(expected, 6);
      }
    });
  });
});

describe('CSV Export Format', () => {
  it('should generate valid CSV with proper quoting', () => {
    const testData = [
      {
        executionId: 'uuid-with-"quotes"',
        workflowId: 'workflow-uuid',
        productName: 'owner/repo',
        status: 'completed',
        startedAt: '2025-12-18T10:00:00Z',
        completedAt: '2025-12-18T10:05:00Z',
        durationMinutes: 5.5,
        totalCost: 0.00355,
        awsCost: 0.001094,
        llmCost: 0.002456,
        ecsCost: 0.000583,
        rdsCost: 0.0005,
        calculationMethod: 'estimated',
      },
    ];
    
    const csv = convertCostDataToCSV(testData);
    
    // Should quote all fields
    expect(csv).toContain('"uuid-with-\\"quotes\\""');
    expect(csv).toContain('"completed"');
    expect(csv).toContain('"5.50"');
  });
});
