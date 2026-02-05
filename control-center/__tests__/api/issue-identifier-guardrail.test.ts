/**
 * Guardrail: issue routes must resolve shortId or UUID consistently.
 * Ensures handlers use shared resolver helpers and avoid ::uuid casts.
 *
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';

type RouteGuard = {
  file: string;
  requiredTokens: string[];
};

const guardrails: RouteGuard[] = [
  {
    file: 'app/api/issues/[id]/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/issues/[id]/activate/route.ts',
    requiredTokens: ['ensureIssueInControl'],
  },
  {
    file: 'app/api/issues/[id]/handoff/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/issues/[id]/runs/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/issues/[id]/events/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/issues/[id]/execution/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/issues/[id]/state-flow/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/loop/issues/[issueId]/run-next-step/route.ts',
    requiredTokens: ['ensureIssueInControl'],
  },
  {
    file: 'app/api/loop/issues/[issueId]/events/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/afu9/s1s3/issues/[id]/spec/route.ts',
    requiredTokens: ['parseIssueId'],
  },
  {
    file: 'app/api/afu9/s1s3/issues/[id]/route.ts',
    requiredTokens: ['parseIssueId'],
  },
  {
    file: 'app/api/afu9/issues/[id]/merge/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/afu9/issues/[id]/runs/start/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
  {
    file: 'app/api/afu9/issues/[id]/verdict/route.ts',
    requiredTokens: ['resolveIssueIdentifier'],
  },
];

describe('Guardrail: issue identifier resolution', () => {
  const rootDir = path.resolve(__dirname, '../../');

  test.each(guardrails)('route uses shared resolver (%s)', ({ file, requiredTokens }) => {
    const absolutePath = path.join(rootDir, file);
    const contents = fs.readFileSync(absolutePath, 'utf8');

    requiredTokens.forEach((token) => {
      expect(contents).toContain(token);
    });
  });

  test.each(guardrails)('route avoids ::uuid casts (%s)', ({ file }) => {
    const absolutePath = path.join(rootDir, file);
    const contents = fs.readFileSync(absolutePath, 'utf8');

    expect(contents).not.toContain('::uuid');
  });
});
