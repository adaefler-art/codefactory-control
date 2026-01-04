/**
 * Environment Utilities Tests
 * 
 * Tests for canonical environment normalization
 * 
 * @jest-environment node
 */

import { normalizeEnvironment, isValidEnvironment } from '@/lib/utils/environment';

describe('Environment Utilities', () => {
  describe('normalizeEnvironment', () => {
    it('should normalize "production" to canonical "production"', () => {
      expect(normalizeEnvironment('production')).toBe('production');
    });

    it('should normalize "prod" to canonical "production"', () => {
      expect(normalizeEnvironment('prod')).toBe('production');
    });

    it('should normalize "staging" to canonical "staging"', () => {
      expect(normalizeEnvironment('staging')).toBe('staging');
    });

    it('should normalize "stage" to canonical "staging"', () => {
      expect(normalizeEnvironment('stage')).toBe('staging');
    });

    it('should be case-insensitive (PRODUCTION)', () => {
      expect(normalizeEnvironment('PRODUCTION')).toBe('production');
      expect(normalizeEnvironment('Prod')).toBe('production');
      expect(normalizeEnvironment('STAGING')).toBe('staging');
      expect(normalizeEnvironment('Stage')).toBe('staging');
    });

    it('should trim whitespace', () => {
      expect(normalizeEnvironment(' production ')).toBe('production');
      expect(normalizeEnvironment(' prod ')).toBe('production');
      expect(normalizeEnvironment(' staging ')).toBe('staging');
      expect(normalizeEnvironment(' stage ')).toBe('staging');
    });

    it('should throw error for unknown environment', () => {
      expect(() => normalizeEnvironment('dev')).toThrow('Invalid environment');
      expect(() => normalizeEnvironment('test')).toThrow('Invalid environment');
      expect(() => normalizeEnvironment('unknown')).toThrow('Invalid environment');
      expect(() => normalizeEnvironment('')).toThrow('Invalid environment');
    });
  });

  describe('isValidEnvironment', () => {
    it('should return true for valid environment values', () => {
      expect(isValidEnvironment('production')).toBe(true);
      expect(isValidEnvironment('prod')).toBe(true);
      expect(isValidEnvironment('staging')).toBe(true);
      expect(isValidEnvironment('stage')).toBe(true);
      expect(isValidEnvironment('PRODUCTION')).toBe(true);
      expect(isValidEnvironment('STAGING')).toBe(true);
    });

    it('should return false for invalid environment values', () => {
      expect(isValidEnvironment('dev')).toBe(false);
      expect(isValidEnvironment('test')).toBe(false);
      expect(isValidEnvironment('unknown')).toBe(false);
      expect(isValidEnvironment('')).toBe(false);
    });
  });
});
