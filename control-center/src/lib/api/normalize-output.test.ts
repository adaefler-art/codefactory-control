/**
 * @jest-environment node
 */

import { normalizeOutput } from './normalize-output';

describe('normalizeOutput', () => {
  test('converts Date in object to ISO string', () => {
    const input = { created_at: new Date('2025-01-01T00:00:00.000Z') };
    const out = normalizeOutput(input);

    expect(out).toEqual({ created_at: '2025-01-01T00:00:00.000Z' });
  });

  test('converts Date in array to ISO string', () => {
    const input = [new Date('2025-01-01T00:00:00.000Z')];
    const out = normalizeOutput(input);

    expect(out).toEqual(['2025-01-01T00:00:00.000Z']);
  });

  test('converts nested Dates to ISO strings', () => {
    const input = {
      a: {
        b: [{ c: new Date('2025-01-01T00:00:00.000Z') }],
      },
    };

    const out = normalizeOutput(input);

    expect(out).toEqual({
      a: {
        b: [{ c: '2025-01-01T00:00:00.000Z' }],
      },
    });
  });

  test('does not mutate input (deep)', () => {
    const date = new Date('2025-01-01T00:00:00.000Z');
    const input = {
      created_at: date,
      nested: { when: date },
      arr: [date],
    };

    const copyBefore = {
      created_at: input.created_at,
      nested: { when: input.nested.when },
      arr: [input.arr[0]],
    };

    const out = normalizeOutput(input);

    // Output normalized
    expect(out.created_at).toBe('2025-01-01T00:00:00.000Z');
    expect(out.nested.when).toBe('2025-01-01T00:00:00.000Z');
    expect(out.arr[0]).toBe('2025-01-01T00:00:00.000Z');

    // Input preserved (same Date references)
    expect(input.created_at).toBe(copyBefore.created_at);
    expect(input.nested.when).toBe(copyBefore.nested.when);
    expect(input.arr[0]).toBe(copyBefore.arr[0]);
    expect(input.created_at).toBeInstanceOf(Date);
  });
});
