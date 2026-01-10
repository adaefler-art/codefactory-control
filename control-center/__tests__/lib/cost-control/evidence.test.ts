/**
 * Tests for Cost Control evidence: redaction + deterministic hashing
 *
 * @jest-environment node
 */

import { createCostControlEvidence } from '../../../src/lib/cost-control/evidence';

describe('createCostControlEvidence', () => {
  it('is deterministic across key order and redacts secret fields', () => {
    const paramsA = {
      key: 'stagingEcsDesiredCount',
      value: 1,
      token: 'should-not-appear',
    };

    const paramsB = {
      token: 'should-not-appear',
      value: 1,
      key: 'stagingEcsDesiredCount',
    };

    const resultA = {
      updatedBy: 'user',
      updatedAt: '2026-01-10T00:00:00.000Z',
      ok: true,
      password: 'also-should-not-appear',
    };

    const resultB = {
      password: 'also-should-not-appear',
      ok: true,
      updatedAt: '2026-01-10T00:00:00.000Z',
      updatedBy: 'user',
    };

    const ev1 = createCostControlEvidence({ params: paramsA, result: resultA });
    const ev2 = createCostControlEvidence({ params: paramsB, result: resultB });

    expect(ev1.paramsHash).toBe(ev2.paramsHash);
    expect(ev1.resultHash).toBe(ev2.resultHash);

    expect(JSON.stringify(ev1.paramsJson)).not.toContain('should-not-appear');
    expect(JSON.stringify(ev1.resultJson)).not.toContain('also-should-not-appear');
  });
});
