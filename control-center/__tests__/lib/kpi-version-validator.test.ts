/**
 * Tests for KPI Version Validator
 * 
 * Ensures KPI version validation and compatibility checking works correctly
 */

import {
  CANONICAL_KPI_VERSION,
  validateKpiVersion,
  validateKpiSnapshot,
  isVersionCompatible,
  getKpiVersions,
  validateKpiDefinition,
  validateAllCanonicalKpis,
  generateMigrationGuide,
} from '../../lib/kpi-version-validator';

describe('KPI Version Validator', () => {
  describe('validateKpiVersion', () => {
    it('should validate matching version as compatible', () => {
      const result = validateKpiVersion('mtti', '1.0.0');
      
      expect(result.isCompatible).toBe(true);
      expect(result.severity).toBe('info');
      expect(result.currentVersion).toBe('1.0.0');
    });

    it('should detect major version mismatch as error', () => {
      const result = validateKpiVersion('mtti', '2.0.0');
      
      expect(result.isCompatible).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('Major version mismatch');
    });

    it('should detect outdated minor version as warning', () => {
      const result = validateKpiVersion('mtti', '0.9.0');
      
      expect(result.isCompatible).toBe(true);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('outdated version');
    });

    it('should handle unknown KPI as error', () => {
      const result = validateKpiVersion('unknown_kpi', '1.0.0');
      
      expect(result.isCompatible).toBe(false);
      expect(result.severity).toBe('error');
      expect(result.message).toContain('not found in canonical definitions');
    });
  });

  describe('validateKpiSnapshot', () => {
    it('should validate snapshot with all correct versions', () => {
      const snapshot = [
        { kpiName: 'mtti', kpiVersion: '1.0.0' },
        { kpiName: 'success_rate', kpiVersion: '1.0.0' },
      ];

      const result = validateKpiSnapshot(snapshot);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect version errors in snapshot', () => {
      const snapshot = [
        { kpiName: 'mtti', kpiVersion: '2.0.0' },
        { kpiName: 'success_rate', kpiVersion: '1.0.0' },
      ];

      const result = validateKpiSnapshot(snapshot);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].currentVersion).toBe('2.0.0');
    });

    it('should collect warnings for outdated versions', () => {
      const snapshot = [
        { kpiName: 'mtti', kpiVersion: '0.9.0' },
      ];

      const result = validateKpiSnapshot(snapshot);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('warning');
    });
  });

  describe('isVersionCompatible', () => {
    it('should accept same major version', () => {
      expect(isVersionCompatible('1.0.0', '1.0.0')).toBe(true);
      expect(isVersionCompatible('1.1.0', '1.0.0')).toBe(true);
      expect(isVersionCompatible('1.0.1', '1.0.0')).toBe(true);
    });

    it('should reject different major versions', () => {
      expect(isVersionCompatible('2.0.0', '1.0.0')).toBe(false);
      expect(isVersionCompatible('0.9.0', '1.0.0')).toBe(false);
    });

    it('should handle minor version compatibility', () => {
      expect(isVersionCompatible('1.2.0', '1.0.0')).toBe(true);
      expect(isVersionCompatible('1.0.0', '1.2.0')).toBe(false);
    });
  });

  describe('getKpiVersions', () => {
    it('should return all KPI versions', () => {
      const versions = getKpiVersions();
      
      expect(versions).toHaveProperty('mtti');
      expect(versions).toHaveProperty('success_rate');
      expect(versions).toHaveProperty('steering_accuracy');
      expect(versions.mtti.version).toBe('1.0.0');
    });

    it('should include name and category', () => {
      const versions = getKpiVersions();
      
      expect(versions.mtti.name).toBe('Mean Time to Insight');
      expect(versions.mtti.category).toBe('efficiency');
    });
  });

  describe('validateKpiDefinition', () => {
    it('should validate complete KPI definition', () => {
      const kpi = {
        name: 'Test KPI',
        version: '1.0.0',
        category: 'efficiency' as const,
        level: ['factory' as const],
        unit: 'milliseconds',
        formula: 'AVG(x)',
        description: 'Test description',
        rationale: 'Test rationale',
      };

      const result = validateKpiDefinition(kpi);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const kpi = {
        name: 'Test KPI',
        version: '1.0.0',
      };

      const result = validateKpiDefinition(kpi);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors).toContain('Missing required field: category');
    });

    it('should validate version format', () => {
      const kpi = {
        name: 'Test KPI',
        version: 'invalid',
        category: 'efficiency' as const,
        level: ['factory' as const],
        unit: 'ms',
        formula: 'AVG(x)',
        description: 'Test',
        rationale: 'Test',
      };

      const result = validateKpiDefinition(kpi);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining('Invalid version format')
      );
    });

    it('should validate category values', () => {
      const kpi = {
        name: 'Test KPI',
        version: '1.0.0',
        category: 'invalid' as any,
        level: ['factory' as const],
        unit: 'ms',
        formula: 'AVG(x)',
        description: 'Test',
        rationale: 'Test',
      };

      const result = validateKpiDefinition(kpi);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining('Invalid category')
      );
    });

    it('should validate level values', () => {
      const kpi = {
        name: 'Test KPI',
        version: '1.0.0',
        category: 'efficiency' as const,
        level: ['invalid' as any],
        unit: 'ms',
        formula: 'AVG(x)',
        description: 'Test',
        rationale: 'Test',
      };

      const result = validateKpiDefinition(kpi);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        expect.stringContaining('Invalid level')
      );
    });
  });

  describe('validateAllCanonicalKpis', () => {
    it('should validate all canonical KPIs', () => {
      const result = validateAllCanonicalKpis();
      
      expect(result.isValid).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should report KPI-specific validation results', () => {
      const result = validateAllCanonicalKpis();
      
      const mttiResult = result.results.find(r => r.kpiKey === 'mtti');
      expect(mttiResult).toBeDefined();
      expect(mttiResult?.isValid).toBe(true);
      expect(mttiResult?.kpiName).toBe('Mean Time to Insight');
    });
  });

  describe('generateMigrationGuide', () => {
    it('should detect breaking change for major version', () => {
      const guide = generateMigrationGuide('1.0.0', '2.0.0');
      
      expect(guide.isBreaking).toBe(true);
      expect(guide.changes).toContainEqual({
        type: 'major',
        description: expect.stringContaining('Breaking change'),
      });
      expect(guide.migrationSteps.length).toBeGreaterThan(0);
    });

    it('should detect non-breaking change for minor version', () => {
      const guide = generateMigrationGuide('1.0.0', '1.1.0');
      
      expect(guide.isBreaking).toBe(false);
      expect(guide.changes).toContainEqual({
        type: 'minor',
        description: expect.stringContaining('Non-breaking'),
      });
    });

    it('should detect patch-only change', () => {
      const guide = generateMigrationGuide('1.0.0', '1.0.1');
      
      expect(guide.isBreaking).toBe(false);
      expect(guide.changes).toContainEqual({
        type: 'patch',
        description: expect.stringContaining('Documentation'),
      });
    });

    it('should provide no migration for same version', () => {
      const guide = generateMigrationGuide('1.0.0', '1.0.0');
      
      expect(guide.isBreaking).toBe(false);
      expect(guide.changes).toHaveLength(0);
      expect(guide.migrationSteps[0]).toContain('No migration required');
    });
  });

  describe('CANONICAL_KPI_VERSION', () => {
    it('should be defined and valid semver', () => {
      expect(CANONICAL_KPI_VERSION).toBeDefined();
      expect(CANONICAL_KPI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
