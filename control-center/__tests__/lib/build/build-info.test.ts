/**
 * Build Info Module Tests
 * 
 * Ensures the build info module provides deterministic build identity
 * and never throws errors, even with missing environment variables.
 * 
 * @jest-environment node
 */

import { getBuildInfo, BuildInfo } from '../../../src/lib/build/build-info';

describe('getBuildInfo', () => {
  // Store original environment
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env.APP_VERSION;
    delete process.env.GIT_SHA;
    delete process.env.BUILD_TIME;
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  test('returns BuildInfo with all fields', () => {
    const info = getBuildInfo();
    
    expect(info).toBeDefined();
    expect(info).toHaveProperty('appVersion');
    expect(info).toHaveProperty('gitSha');
    expect(info).toHaveProperty('buildTime');
  });

  test('reads APP_VERSION from environment', () => {
    process.env.APP_VERSION = '0.5.0';
    
    const info = getBuildInfo();
    
    expect(info.appVersion).toBe('0.5.0');
  });

  test('reads GIT_SHA from environment', () => {
    process.env.GIT_SHA = 'a1b2c3d';
    
    const info = getBuildInfo();
    
    expect(info.gitSha).toBe('a1b2c3d');
  });

  test('reads BUILD_TIME from environment', () => {
    const timestamp = '2025-12-28T13:48:20Z';
    process.env.BUILD_TIME = timestamp;
    
    const info = getBuildInfo();
    
    expect(info.buildTime).toBe(timestamp);
  });

  test('returns "unknown" for missing APP_VERSION', () => {
    delete process.env.APP_VERSION;
    
    const info = getBuildInfo();
    
    expect(info.appVersion).toBe('unknown');
  });

  test('returns "unknown" for missing GIT_SHA', () => {
    delete process.env.GIT_SHA;
    
    const info = getBuildInfo();
    
    expect(info.gitSha).toBe('unknown');
  });

  test('returns "unknown" for missing BUILD_TIME', () => {
    delete process.env.BUILD_TIME;
    
    const info = getBuildInfo();
    
    expect(info.buildTime).toBe('unknown');
  });

  test('handles all environment variables missing', () => {
    delete process.env.APP_VERSION;
    delete process.env.GIT_SHA;
    delete process.env.BUILD_TIME;
    
    const info = getBuildInfo();
    
    expect(info.appVersion).toBe('unknown');
    expect(info.gitSha).toBe('unknown');
    expect(info.buildTime).toBe('unknown');
  });

  test('handles all environment variables present', () => {
    process.env.APP_VERSION = '1.2.3';
    process.env.GIT_SHA = 'abc123f';
    process.env.BUILD_TIME = '2025-01-15T10:30:00Z';
    
    const info = getBuildInfo();
    
    expect(info.appVersion).toBe('1.2.3');
    expect(info.gitSha).toBe('abc123f');
    expect(info.buildTime).toBe('2025-01-15T10:30:00Z');
  });

  test('never throws errors', () => {
    // Even with bizarre environment state, should never throw
    expect(() => getBuildInfo()).not.toThrow();
    
    process.env.APP_VERSION = '';
    process.env.GIT_SHA = '';
    process.env.BUILD_TIME = '';
    expect(() => getBuildInfo()).not.toThrow();
    
    delete process.env.APP_VERSION;
    delete process.env.GIT_SHA;
    delete process.env.BUILD_TIME;
    expect(() => getBuildInfo()).not.toThrow();
  });

  test('handles empty string as fallback to "unknown"', () => {
    process.env.APP_VERSION = '';
    process.env.GIT_SHA = '';
    process.env.BUILD_TIME = '';
    
    const info = getBuildInfo();
    
    // Empty string is falsy, so should fall back to 'unknown'
    expect(info.appVersion).toBe('unknown');
    expect(info.gitSha).toBe('unknown');
    expect(info.buildTime).toBe('unknown');
  });

  test('is idempotent - multiple calls return same values', () => {
    process.env.APP_VERSION = '2.0.0';
    process.env.GIT_SHA = 'xyz789';
    process.env.BUILD_TIME = '2025-12-01T00:00:00Z';
    
    const info1 = getBuildInfo();
    const info2 = getBuildInfo();
    
    expect(info1).toEqual(info2);
  });

  test('returns new object on each call', () => {
    const info1 = getBuildInfo();
    const info2 = getBuildInfo();
    
    // Should be equal but not the same reference
    expect(info1).toEqual(info2);
    expect(info1).not.toBe(info2);
  });

  test('respects environment changes between calls', () => {
    process.env.APP_VERSION = '1.0.0';
    const info1 = getBuildInfo();
    expect(info1.appVersion).toBe('1.0.0');
    
    process.env.APP_VERSION = '2.0.0';
    const info2 = getBuildInfo();
    expect(info2.appVersion).toBe('2.0.0');
  });

  test('handles realistic production values', () => {
    // Simulate real production environment
    process.env.APP_VERSION = '0.5.0';
    process.env.GIT_SHA = 'a1b2c3d';
    process.env.BUILD_TIME = '2025-12-28T13:48:20.253Z';
    
    const info = getBuildInfo();
    
    expect(info.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info.gitSha).toMatch(/^[a-f0-9]{7}$/);
    expect(info.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
