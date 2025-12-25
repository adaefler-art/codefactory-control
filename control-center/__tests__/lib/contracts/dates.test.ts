/**
 * Tests for date handling contract
 * 
 * @jest-environment node
 */

import {
  toIsoStringOrNull,
  formatDateForUi,
  isIsoStringOrNull,
} from '../../../src/lib/contracts/dates';

describe('toIsoStringOrNull', () => {
  test('converts Date object to ISO string', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    const result = toIsoStringOrNull(date);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  test('converts ISO string to ISO string', () => {
    const result = toIsoStringOrNull('2024-01-15T10:30:00Z');
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  test('converts timestamp number to ISO string', () => {
    const timestamp = new Date('2024-01-15T10:30:00Z').getTime();
    const result = toIsoStringOrNull(timestamp);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  test('converts date-like string to ISO string', () => {
    const result = toIsoStringOrNull('2024-01-15');
    expect(result).toBe('2024-01-15T00:00:00.000Z');
  });

  test('returns null for null input', () => {
    expect(toIsoStringOrNull(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(toIsoStringOrNull(undefined)).toBeNull();
  });

  test('returns null for invalid date string', () => {
    expect(toIsoStringOrNull('not-a-date')).toBeNull();
  });

  test('returns null for invalid Date object', () => {
    const invalidDate = new Date('invalid');
    expect(toIsoStringOrNull(invalidDate)).toBeNull();
  });

  test('handles object with toISOString method', () => {
    const obj = {
      toISOString: () => '2024-01-15T10:30:00.000Z',
    };
    const result = toIsoStringOrNull(obj);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  test('returns null if toISOString throws', () => {
    const obj = {
      toISOString: () => {
        throw new Error('fail');
      },
    };
    const result = toIsoStringOrNull(obj);
    expect(result).toBeNull();
  });

  test('returns null if toISOString returns non-string', () => {
    const obj = {
      toISOString: () => 123,
    };
    const result = toIsoStringOrNull(obj);
    expect(result).toBeNull();
  });
});

describe('formatDateForUi', () => {
  test('formats valid ISO string for UI', () => {
    const result = formatDateForUi('2024-01-15T10:30:45.000Z');
    expect(result).toBe('2024-01-15 10:30:45');
  });

  test('formats date with single-digit values correctly', () => {
    const result = formatDateForUi('2024-01-05T09:08:07.000Z');
    expect(result).toBe('2024-01-05 09:08:07');
  });

  test('returns em dash for null', () => {
    expect(formatDateForUi(null)).toBe('—');
  });

  test('returns em dash for undefined', () => {
    expect(formatDateForUi(undefined)).toBe('—');
  });

  test('returns em dash for empty string', () => {
    expect(formatDateForUi('')).toBe('—');
  });

  test('returns em dash for invalid date string', () => {
    expect(formatDateForUi('not-a-date')).toBe('—');
  });

  test('handles date near epoch', () => {
    const result = formatDateForUi('1970-01-01T00:00:00.000Z');
    expect(result).toBe('1970-01-01 00:00:00');
  });

  test('handles date far in future', () => {
    const result = formatDateForUi('2099-12-31T23:59:59.000Z');
    expect(result).toBe('2099-12-31 23:59:59');
  });
});

describe('isIsoStringOrNull', () => {
  test('returns true for valid ISO string', () => {
    expect(isIsoStringOrNull('2024-01-15T10:30:00.000Z')).toBe(true);
  });

  test('returns true for parseable date string', () => {
    expect(isIsoStringOrNull('2024-01-15')).toBe(true);
  });

  test('returns true for null', () => {
    expect(isIsoStringOrNull(null)).toBe(true);
  });

  test('returns false for undefined', () => {
    expect(isIsoStringOrNull(undefined)).toBe(false);
  });

  test('returns false for number', () => {
    expect(isIsoStringOrNull(123456789)).toBe(false);
  });

  test('returns false for invalid date string', () => {
    expect(isIsoStringOrNull('not-a-date')).toBe(false);
  });

  test('returns false for object', () => {
    expect(isIsoStringOrNull({})).toBe(false);
  });

  test('returns false for array', () => {
    expect(isIsoStringOrNull([])).toBe(false);
  });
});
