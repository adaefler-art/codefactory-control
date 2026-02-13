/**
 * AFU-9 Guardrails Audit Tests
 *
 * @jest-environment node
 */

import { GET as guardrailsAudit } from '../../app/api/afu9/guardrails/audit/route';

describe('GET /api/afu9/guardrails/audit', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  test('returns audit snapshot with headers and findings', async () => {
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [{ owner: 'allowed', repo: 'repo', branches: ['main'] }],
    });
    process.env.AFU9_GUARDRAILS_TOKEN_SCOPE = 'readonly';
    process.env.AFU9_SECRET_REDACTION = 'on';

    const request = new Request('http://localhost/api/afu9/guardrails/audit', {
      method: 'GET',
      headers: { 'x-request-id': 'req-guardrails-audit' },
    }) as unknown as Parameters<typeof guardrailsAudit>[0];

    const response = await guardrailsAudit(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('string');
    expect(Number.isNaN(Date.parse(body.ts))).toBe(false);
    expect(body.summary).toEqual({
      critical: expect.any(Number),
      warn: expect.any(Number),
      info: expect.any(Number),
    });
    expect(Array.isArray(body.findings)).toBe(true);
    expect(body.findings.length).toBeGreaterThanOrEqual(4);
    body.findings.forEach((finding: { level: string; code: string; messageSafe: string }) => {
      expect(finding.level).toMatch(/^(critical|warn|info)$/);
      expect(typeof finding.code).toBe('string');
      expect(typeof finding.messageSafe).toBe('string');
    });
    expect(response.headers.get('x-afu9-request-id')).toBe('req-guardrails-audit');
    expect(response.headers.get('x-afu9-handler')).toBe('guardrails.audit');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('reports egress allowlist not implemented by default', async () => {
    const request = new Request('http://localhost/api/afu9/guardrails/audit', {
      method: 'GET',
    }) as unknown as Parameters<typeof guardrailsAudit>[0];

    const response = await guardrailsAudit(request);
    const body = await response.json();

    const egress = body.findings.find(
      (finding: { code: string }) => finding.code === 'EGRESS_ALLOWLIST_NOT_IMPLEMENTED'
    );
    expect(egress).toBeTruthy();
    expect(egress.messageSafe).toContain('not implemented');
  });
});
