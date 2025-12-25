/**
 * ID Contract Module
 * 
 * Provides standardized ID parsing and validation for AFU-9 system.
 * Supports both UUID v4 and 8-character hex shortIds.
 */

import { isValidUUID } from '../utils/uuid-validator';

/**
 * Type of issue identifier
 */
export type IssueIdentifierKind = 'uuid' | 'shortHex8' | 'invalid';

/**
 * 8-character hex pattern (shortId derived from UUID prefix)
 */
const SHORT_HEX8_REGEX = /^[0-9a-f]{8}$/i;

/**
 * Parse result for issue identifiers
 */
export interface ParsedIssueId {
  kind: IssueIdentifierKind;
  value: string;
  isValid: boolean;
}

/**
 * Parse and classify an issue identifier
 * 
 * @param value - The identifier string to parse
 * @returns Parsed result with kind and validity
 * 
 * @example
 * parseIssueId('c300abd8-1234-5678-90ab-cdef12345678') // { kind: 'uuid', value: 'c300abd8-1234-5678-90ab-cdef12345678', isValid: true }
 * parseIssueId('c300abd8') // { kind: 'shortHex8', value: 'c300abd8', isValid: true }
 * parseIssueId('invalid') // { kind: 'invalid', value: 'invalid', isValid: false }
 */
export function parseIssueId(value: unknown): ParsedIssueId {
  // Validate input type
  if (typeof value !== 'string') {
    return {
      kind: 'invalid',
      value: String(value),
      isValid: false,
    };
  }

  const trimmed = value.trim();

  // Empty string is invalid
  if (trimmed.length === 0) {
    return {
      kind: 'invalid',
      value: trimmed,
      isValid: false,
    };
  }

  // Check for UUID v4
  if (isValidUUID(trimmed)) {
    return {
      kind: 'uuid',
      value: trimmed,
      isValid: true,
    };
  }

  // Check for 8-hex shortId
  if (SHORT_HEX8_REGEX.test(trimmed)) {
    return {
      kind: 'shortHex8',
      value: trimmed.toLowerCase(),
      isValid: true,
    };
  }

  // Neither format matches
  return {
    kind: 'invalid',
    value: trimmed,
    isValid: false,
  };
}

/**
 * Extract 8-character shortId from UUID
 * 
 * @param uuid - UUID string
 * @returns 8-character hex shortId or null if invalid
 * 
 * @example
 * toShortHex8FromUuid('c300abd8-1234-5678-90ab-cdef12345678') // 'c300abd8'
 */
export function toShortHex8FromUuid(uuid: string): string | null {
  if (typeof uuid !== 'string') return null;

  // Try to match UUID format and extract first 8 chars
  const match = uuid.match(/^([0-9a-f]{8})-/i);
  if (match) return match[1].toLowerCase();

  // Fallback: check if first 8 chars are hex
  const fallback = uuid.match(/^([0-9a-f]{8})/i);
  return fallback ? fallback[1].toLowerCase() : null;
}
