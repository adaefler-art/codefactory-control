/**
 * Tests for ID parsing contract
 * 
 * @jest-environment node
 */

import {
  parseIssueId,
  toShortHex8FromUuid,
  type IssueIdentifierKind,
} from '../../../src/lib/contracts/ids';

describe('parseIssueId', () => {
  describe('UUID v4 parsing', () => {
    test('recognizes valid UUID v4', () => {
      const result = parseIssueId('c300abd8-1234-5678-90ab-cdef12345678');
      expect(result.kind).toBe('uuid');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('c300abd8-1234-5678-90ab-cdef12345678');
    });

    test('handles uppercase UUID', () => {
      const result = parseIssueId('C300ABD8-1234-5678-90AB-CDEF12345678');
      expect(result.kind).toBe('uuid');
      expect(result.isValid).toBe(true);
    });

    test('handles UUID with whitespace', () => {
      const result = parseIssueId('  c300abd8-1234-5678-90ab-cdef12345678  ');
      expect(result.kind).toBe('uuid');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('c300abd8-1234-5678-90ab-cdef12345678');
    });
  });

  describe('8-hex shortId parsing', () => {
    test('recognizes valid 8-hex shortId', () => {
      const result = parseIssueId('c300abd8');
      expect(result.kind).toBe('shortHex8');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('c300abd8');
    });

    test('normalizes to lowercase', () => {
      const result = parseIssueId('C300ABD8');
      expect(result.kind).toBe('shortHex8');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('c300abd8');
    });

    test('handles shortId with whitespace', () => {
      const result = parseIssueId('  c300abd8  ');
      expect(result.kind).toBe('shortHex8');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('c300abd8');
    });

    test('rejects 7-char hex', () => {
      const result = parseIssueId('c300abd');
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });

    test('rejects 9-char hex', () => {
      const result = parseIssueId('c300abd88');
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });

    test('rejects non-hex characters', () => {
      const result = parseIssueId('c300abxz');
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });
  });

  describe('invalid input handling', () => {
    test('rejects empty string', () => {
      const result = parseIssueId('');
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });

    test('rejects whitespace-only string', () => {
      const result = parseIssueId('   ');
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });

    test('rejects non-string input', () => {
      const result = parseIssueId(12345);
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });

    test('rejects null', () => {
      const result = parseIssueId(null);
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });

    test('rejects undefined', () => {
      const result = parseIssueId(undefined);
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });

    test('rejects random string', () => {
      const result = parseIssueId('not-a-valid-id');
      expect(result.kind).toBe('invalid');
      expect(result.isValid).toBe(false);
    });
  });
});

describe('toShortHex8FromUuid', () => {
  test('extracts first 8 chars from UUID', () => {
    const result = toShortHex8FromUuid('c300abd8-1234-5678-90ab-cdef12345678');
    expect(result).toBe('c300abd8');
  });

  test('normalizes to lowercase', () => {
    const result = toShortHex8FromUuid('C300ABD8-1234-5678-90AB-CDEF12345678');
    expect(result).toBe('c300abd8');
  });

  test('handles non-standard UUID format', () => {
    const result = toShortHex8FromUuid('c300abd8abcd1234');
    expect(result).toBe('c300abd8');
  });

  test('returns null for invalid input', () => {
    expect(toShortHex8FromUuid('invalid')).toBeNull();
    expect(toShortHex8FromUuid('abc')).toBeNull();
    expect(toShortHex8FromUuid('')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(toShortHex8FromUuid(12345 as any)).toBeNull();
    expect(toShortHex8FromUuid(null as any)).toBeNull();
    expect(toShortHex8FromUuid(undefined as any)).toBeNull();
  });
});
