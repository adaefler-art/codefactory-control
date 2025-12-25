/**
 * Date Contract Module
 * 
 * Provides standardized date handling for AFU-9 system.
 * Ensures dates are ISO strings or null, with UI formatters.
 */

/**
 * Convert various date representations to ISO string or null
 * 
 * @param value - Date value in various formats
 * @returns ISO 8601 string or null if invalid/missing
 * 
 * @example
 * toIsoStringOrNull(new Date('2024-01-01')) // '2024-01-01T00:00:00.000Z'
 * toIsoStringOrNull('2024-01-01') // '2024-01-01T00:00:00.000Z'
 * toIsoStringOrNull(null) // null
 * toIsoStringOrNull(undefined) // null
 */
export function toIsoStringOrNull(value: unknown): string | null {
  // Handle null/undefined
  if (value === null || value === undefined) return null;

  // Handle Date objects
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  // Handle numeric timestamps
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  // Handle string dates
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  // Handle objects with toISOString method
  if (typeof value === 'object') {
    const asAny = value as any;
    if (typeof asAny.toISOString === 'function') {
      try {
        const result = asAny.toISOString();
        return typeof result === 'string' ? result : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Format ISO date string for UI display
 * Returns "—" (em dash) if date is missing or invalid
 * 
 * @param isoString - ISO 8601 date string or null
 * @returns Formatted date string or "—"
 * 
 * @example
 * formatDateForUi('2024-01-01T12:00:00Z') // '2024-01-01 12:00:00'
 * formatDateForUi(null) // '—'
 * formatDateForUi('invalid') // '—'
 */
export function formatDateForUi(isoString: string | null | undefined): string {
  if (!isoString) return '—';

  try {
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return '—';

    // Format as YYYY-MM-DD HH:MM:SS
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch {
    return '—';
  }
}

/**
 * Validate that value is an ISO 8601 string or null
 * 
 * @param value - Value to validate
 * @returns true if valid ISO string or null
 */
export function isIsoStringOrNull(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;

  const date = new Date(value);
  return Number.isFinite(date.getTime());
}
