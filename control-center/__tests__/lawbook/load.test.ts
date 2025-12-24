/**
 * Lawbook loader/unit tests
 *
 * @jest-environment node
 */

import { computeStableHash, loadGuardrails } from '@/lawbook/load';

describe('lawbook/load', () => {
  test('computeStableHash is stable across key order', () => {
    const a = { b: 2, a: 1, nested: { z: 1, y: 2 } };
    const b = { nested: { y: 2, z: 1 }, a: 1, b: 2 };

    expect(computeStableHash(a)).toBe(computeStableHash(b));
  });

  test('computeStableHash changes when value changes', () => {
    const a = { a: 1 };
    const b = { a: 2 };

    expect(computeStableHash(a)).not.toBe(computeStableHash(b));
  });

  test('loadGuardrails returns a deterministic sha256 hash', async () => {
    const first = await loadGuardrails();
    const second = await loadGuardrails();

    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hash).toBe(second.hash);
    expect(first.data.version).toBeDefined();
    expect(Array.isArray(first.data.guardrails)).toBe(true);
    expect(first.data.guardrails.length).toBeGreaterThan(0);
  });

  test('loadGuardrails rejects invalid ISO timestamps', async () => {
    jest.resetModules();

    jest.doMock('fs', () => ({
      promises: {
        access: jest.fn(async () => undefined),
        readFile: jest.fn(async () =>
          JSON.stringify({
            version: 1,
            guardrails: [
              {
                id: 'LB-GR-TEST',
                title: 'Bad',
                description: 'Bad',
                scope: 'global',
                category: 'safety',
                enforcement: 'advisory',
                createdAt: 'not-an-iso',
                updatedAt: '2024-01-01T00:00:00Z',
              },
            ],
          })
        ),
      },
    }));

    const { loadGuardrails: mockedLoadGuardrails } = await import('@/lawbook/load');

    await expect(mockedLoadGuardrails()).rejects.toThrow(/createdAt must be an ISO string/);
  });
});
