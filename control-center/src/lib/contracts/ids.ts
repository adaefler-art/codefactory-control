/**
 * ID Contract Module
 * 
 * Provides standardized ID parsing and validation for AFU-9 system.
 * 
 * **Identifier Semantics (Issue #3: Identifier Consistency):**
 * - `id` = UUID v4 (canonical, internal identifier)
 * - `publicId` = 8-hex prefix display format (derived from first 8 chars of UUID)
 * 
 * **API Acceptance:**
 * - Full UUID v4: e.g., "c300abd8-1234-5678-90ab-cdef12345678"
 * - 8-hex prefix (read-only): e.g., "c300abd8"
 * 
 * **Response Codes:**
 * - 200: Resource found
 * - 404: Resource not found
 * - 400: Invalid ID format (neither valid UUID nor valid 8-hex)
 */

import { isValidUUID } from '../utils/uuid-validator';

/**
 * Type of issue identifier
 * 
 * - 'uuid': Full UUID v4 format (canonical identifier)
 * - 'shortHex8': 8-character hex prefix (publicId/display format)
 * - 'invalid': Neither valid UUID nor valid 8-hex
 */
export type IssueIdentifierKind = 'uuid' | 'shortHex8' | 'invalid';

/**
 * 8-character hex pattern (publicId derived from UUID prefix)
 * 
 * Example: UUID "c300abd8-1234-..." → publicId "c300abd8"
 */
const SHORT_HEX8_REGEX = /^[0-9a-f]{8}$/i;

/**
 * Parse result for issue identifiers
 * 
 * **Contract Guarantee (Issue #3):**
 * - isValid=true means the identifier is acceptable (will not return 400)
 * - isValid=false means the identifier is malformed (returns 400)
 */
export interface ParsedIssueId {
  kind: IssueIdentifierKind;
  value: string;
  isValid: boolean;
}

/**
 * Parse and classify an issue identifier
 * 
 * This is the authoritative function for identifier validation.
 * Any valid UUID or 8-hex prefix will have isValid=true.
 * 
 * @param value - The identifier string to parse
 * @returns Parsed result with kind and validity
 * 
 * @example
 * // Full UUID (canonical id)
 * parseIssueId('c300abd8-1234-5678-90ab-cdef12345678')
 * // → { kind: 'uuid', value: 'c300abd8-1234-5678-90ab-cdef12345678', isValid: true }
 * 
 * // 8-hex prefix (publicId)
 * parseIssueId('c300abd8')
 * // → { kind: 'shortHex8', value: 'c300abd8', isValid: true }
 * 
 * // Invalid format
 * parseIssueId('invalid')
 * // → { kind: 'invalid', value: 'invalid', isValid: false }
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

  // Check for UUID v4 (canonical identifier)
  if (isValidUUID(trimmed)) {
    return {
      kind: 'uuid',
      value: trimmed,
      isValid: true,
    };
  }

  // Check for 8-hex publicId (display format)
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
 * Extract 8-character publicId from UUID
 * 
 * The publicId is the display format derived from the first 8 hex characters
 * of the canonical UUID identifier.
 * 
 * @param uuid - UUID string (canonical identifier)
 * @returns 8-character hex publicId or null if invalid
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
