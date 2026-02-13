/**
 * AFU9 Workflow Errors Tests
 *
 * @jest-environment node
 */

import { makeAfu9Error } from '../../src/lib/afu9/workflow-errors';

describe('makeAfu9Error', () => {
  test('throws on unknown code', () => {
    expect(() =>
      makeAfu9Error({
        stage: 'S2',
        code: 'UNKNOWN_CODE',
        phase: 'preflight',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry later',
        requestId: 'req-unknown',
        handler: 'control.s1s3.spec',
      })
    ).toThrow('Unknown AFU9 error code');
  });
});
