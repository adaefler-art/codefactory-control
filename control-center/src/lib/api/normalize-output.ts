/**
 * normalizeOutput
 *
 * Central DB→API output normalization for Next.js route handlers.
 *
 * Goal: make DB rows JSON-safe and compatible with output contracts.
 * - Date -> ISO string
 * - BigInt -> string
 * - Buffer -> base64 string
 * - Arrays/Plain objects -> deep copy
 * - Primitives -> unchanged
 *
 * NOTE: This is intentionally explicit and used at API boundaries.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isBuffer(value: unknown): value is Buffer {
  // Buffer may not exist in some runtimes; guard safely.
  // eslint-disable-next-line no-undef
  return typeof Buffer !== 'undefined' && (Buffer as any).isBuffer?.(value);
}

export function normalizeOutput<T>(input: T): any {
  const seen = new WeakMap<object, any>();

  const visit = (value: any): any => {
    if (value === null) return null;

    const valueType = typeof value;

    // Primitives
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean' || valueType === 'undefined') {
      return value;
    }

    if (valueType === 'bigint') {
      return value.toString();
    }

    // Dates
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Buffers
    if (isBuffer(value)) {
      return value.toString('base64');
    }

    // Arrays
    if (Array.isArray(value)) {
      if (seen.has(value)) return seen.get(value);
      const out: any[] = [];
      seen.set(value, out);
      for (const item of value) out.push(visit(item));
      return out;
    }

    // Plain objects
    if (isPlainObject(value)) {
      if (seen.has(value)) return seen.get(value);
      const out: Record<string, any> = {};
      seen.set(value, out);
      for (const [k, v] of Object.entries(value)) {
        out[k] = visit(v);
      }
      return out;
    }

    // Other objects (Map, Set, Error, RegExp, etc.)
    // We intentionally do not deep-clone these by default. DB rows should not contain them.
    return value;
  };

  return visit(input);
}
