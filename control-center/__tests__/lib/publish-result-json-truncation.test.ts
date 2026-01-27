/**
 * Tests for result_json truncation logic
 * Issue E89.7: Publish Audit Trail (DB table + session-scoped UI view; append-only, bounded result_json)
 */

import { truncateResultJson } from '@/lib/db/intentIssueSetPublishLedger';

describe('truncateResultJson', () => {
  it('should return null data and not truncate for null input', () => {
    const result = truncateResultJson(null);
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('should return null data and not truncate for undefined input', () => {
    const result = truncateResultJson(undefined);
    expect(result.data).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('should not truncate small objects', () => {
    const data = { message: 'Hello, world!' };
    const result = truncateResultJson(data);
    expect(result.data).toEqual(data);
    expect(result.truncated).toBe(false);
  });

  it('should not truncate objects exactly at the limit', () => {
    // Create an object that's exactly 32KB when serialized
    const maxBytes = 32768;
    const overhead = Buffer.byteLength(JSON.stringify({ data: '' }), 'utf8');
    const largeString = 'x'.repeat(Math.max(0, maxBytes - overhead));
    const data = { data: largeString };
    const result = truncateResultJson(data);
    
    // Should not be truncated if under or at limit
    expect(result.truncated).toBe(false);
  });

  it('should truncate objects exceeding 32KB limit', () => {
    // Create an object that exceeds 32KB
    const largeString = 'x'.repeat(40000);
    const data = { data: largeString };
    const result = truncateResultJson(data);

    expect(result.data).toEqual({});
    expect(result.truncated).toBe(true);
  });

  it('should truncate large arrays', () => {
    // Create a large array
    const largeArray = Array(5000).fill({ id: 1, name: 'test', description: 'A long description' });
    const result = truncateResultJson(largeArray);

    expect(result.data).toEqual({});
    expect(result.truncated).toBe(true);
  });

  it('should handle nested objects correctly', () => {
    const data = {
      level1: {
        level2: {
          level3: {
            message: 'Nested data',
            value: 42,
          },
        },
      },
    };
    const result = truncateResultJson(data);
    expect(result.data).toEqual(data);
    expect(result.truncated).toBe(false);
  });

  it('should handle arrays of objects', () => {
    const data = [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ];
    const result = truncateResultJson(data);
    expect(result.data).toEqual(data);
    expect(result.truncated).toBe(false);
  });

  it('should truncate complex objects with mixed data types', () => {
    // Create a complex object that exceeds the limit
    const complexData = {
      strings: Array(1000).fill('This is a long string that will contribute to the size'),
      numbers: Array(1000).fill(123456789),
      booleans: Array(1000).fill(true),
      nested: {
        more: Array(1000).fill({ a: 'test', b: 123 }),
      },
    };
    const result = truncateResultJson(complexData);

    expect(result.data).toEqual({});
    expect(result.truncated).toBe(true);
  });
});
