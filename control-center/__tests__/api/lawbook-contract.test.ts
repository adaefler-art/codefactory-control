/**
 * Lawbook API contract tests
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

import { GET as getGuardrails } from '../../app/api/lawbook/guardrails/route';
import { GET as getParameters } from '../../app/api/lawbook/parameters/route';
import { GET as getMemory } from '../../app/api/lawbook/memory/route';

describe('Lawbook API contract', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AFU9_DEBUG_API;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('GET /api/lawbook/guardrails returns hash/version/guardrails', async () => {
    const req = new NextRequest('http://localhost/api/lawbook/guardrails');
    const res = await getGuardrails(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof body.version).toBe('number');
    expect(Array.isArray(body.guardrails)).toBe(true);
    expect(body.guardrails.length).toBeGreaterThan(0);

    const first = body.guardrails[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('scope');
    expect(first).toHaveProperty('category');
    expect(first).toHaveProperty('enforcement');
    expect(first).toHaveProperty('createdAt');
    expect(first).toHaveProperty('updatedAt');
  });

  test('GET /api/lawbook/parameters returns hash/version/parameters', async () => {
    const req = new NextRequest('http://localhost/api/lawbook/parameters');
    const res = await getParameters(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof body.version).toBe('number');
    expect(Array.isArray(body.parameters)).toBe(true);
    expect(body.parameters.length).toBeGreaterThan(0);

    const first = body.parameters[0];
    expect(first).toHaveProperty('key');
    expect(first).toHaveProperty('type');
    expect(first).toHaveProperty('createdAt');
    expect(first).toHaveProperty('updatedAt');
  });

  test('GET /api/lawbook/memory returns seed + empty session (Stage A)', async () => {
    const req = new NextRequest('http://localhost/api/lawbook/memory');
    const res = await getMemory(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hash).toMatch(/^[a-f0-9]{64}$/);

    expect(body.seed).toBeDefined();
    expect(body.seed.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof body.seed.version).toBe('number');
    expect(Array.isArray(body.seed.entries)).toBe(true);
    expect(body.seed.entries.length).toBeGreaterThan(0);

    expect(body.session).toBeDefined();
    expect(body.session.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof body.session.version).toBe('number');
    expect(Array.isArray(body.session.entries)).toBe(true);
    expect(body.session.entries).toEqual([]);
  });

  test('Lawbook endpoints include contextTrace when AFU9_DEBUG_API=true', async () => {
    process.env.AFU9_DEBUG_API = 'true';

    const req = new NextRequest('http://localhost/api/lawbook/guardrails?scope=issues');
    const res = await getGuardrails(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.contextTrace).toBeDefined();
    expect(body.contextTrace.paramsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(body.contextTrace.guardrailIdsApplied)).toBe(true);
    expect(Array.isArray(body.contextTrace.memoryIdsUsed)).toBe(true);
  });
});
