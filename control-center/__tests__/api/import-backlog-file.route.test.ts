/**
 * @jest-environment node
 */

import { POST } from '../../app/api/import/backlog-file/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(async () => ({ rows: [] })),
  })),
}));

jest.mock('../../src/lib/db/importRuns', () => ({
  createImportRun: jest.fn(async () => ({ success: true, data: { id: 123 } })),
  updateImportRun: jest.fn(async () => ({ success: true })),
}));

jest.mock('../../src/lib/github/fetch-file', () => ({
  fetchGitHubFile: jest.fn(),
}));

describe('/api/import/backlog-file status mapping', () => {
  it('returns 500 when GitHub App auth/config fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetchGitHubFile } = require('../../src/lib/github/fetch-file');
    (fetchGitHubFile as any).mockResolvedValue({
      success: false,
      statusCode: 500,
      error: 'GitHub App private key must be a PEM string',
    });

    const req = new Request('http://localhost/api/import/backlog-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'docs/roadmaps/afu9_v0_6_backlog.md', ref: 'main' }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 404 when file is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fetchGitHubFile } = require('../../src/lib/github/fetch-file');
    (fetchGitHubFile as any).mockResolvedValue({
      success: false,
      statusCode: 404,
      error: 'File not found',
    });

    const req = new Request('http://localhost/api/import/backlog-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'missing.md', ref: 'main' }),
    });

    const res = await POST(req as any);
    expect(res.status).toBe(404);
  });
});
