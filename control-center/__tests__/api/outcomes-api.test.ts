/**
 * Outcomes API Contract Tests (E78.2 / I782)
 * 
 * Tests for outcome records API endpoints:
 * - POST /api/outcomes/generate - Generate postmortem
 * - GET /api/outcomes - List outcome records
 * - GET /api/outcomes/[id] - Get single outcome record
 * 
 * @jest-environment node
 */

import { POST as generateHandler } from '../../app/api/outcomes/generate/route';
import { GET as listHandler } from '../../app/api/outcomes/route';
import { GET as getHandler } from '../../app/api/outcomes/[id]/route';
import { getPool } from '../../src/lib/db';
import { getIncidentDAO } from '../../src/lib/db/incidents';
import { Pool } from 'pg';

// Mock NextRequest for testing
function createMockRequest(options: {
  method?: string;
  body?: any;
  userId?: string;
  requestId?: string;
  url?: string;
}) {
  const headers = new Headers();
  if (options.userId) {
    headers.set('x-afu9-sub', options.userId);
  }
  if (options.requestId) {
    headers.set('x-request-id', options.requestId);
  }

  const url = options.url || 'http://localhost:3000/api/outcomes';

  return {
    method: options.method || 'GET',
    headers,
    url,
    json: async () => options.body || {},
  } as any;
}

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Outcomes API - Generate Endpoint', () => {
  let pool: Pool;
  let testIncidentId: string;

  beforeAll(() => {
    pool = getPool();
  });

  beforeEach(async () => {
    // Create a test incident
    const incidentDAO = getIncidentDAO(pool);
    
    const incident = await incidentDAO.upsertIncidentByKey({
      incident_key: `test:api:${Date.now()}:${Math.random()}`,
      severity: 'RED',
      status: 'OPEN',
      title: 'Test API Incident',
      lawbook_version: 'v1.0.0-test',
      source_primary: {
        kind: 'deploy_status',
        ref: { env: 'test' },
      },
      tags: ['test'],
    });

    testIncidentId = incident.id;
  });

  afterEach(async () => {
    if (testIncidentId) {
      await pool.query('DELETE FROM incidents WHERE id = $1', [testIncidentId]);
    }
  });

  test('POST /api/outcomes/generate requires authentication', async () => {
    const request = createMockRequest({
      method: 'POST',
      body: { incidentId: testIncidentId },
      // No userId - should fail
    });

    const response = await generateHandler(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  test('POST /api/outcomes/generate validates request body', async () => {
    const request = createMockRequest({
      method: 'POST',
      body: { invalid: 'data' },
      userId: 'test-user',
    });

    const response = await generateHandler(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid');
  });

  test('POST /api/outcomes/generate creates postmortem', async () => {
    const request = createMockRequest({
      method: 'POST',
      body: { incidentId: testIncidentId },
      userId: 'test-user',
    });

    const response = await generateHandler(request);
    expect(response.status).toBe(201); // Created

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.outcomeRecord).toBeDefined();
    expect(body.postmortem).toBeDefined();
    expect(body.isNew).toBe(true);
    expect(body.postmortem.version).toBe('0.7.0');
    expect(body.postmortem.incident.id).toBe(testIncidentId);
  });

  test('POST /api/outcomes/generate is idempotent', async () => {
    const requestBody = { incidentId: testIncidentId };

    // First call
    const request1 = createMockRequest({
      method: 'POST',
      body: requestBody,
      userId: 'test-user',
    });
    const response1 = await generateHandler(request1);
    expect(response1.status).toBe(201);
    const body1 = await response1.json();

    // Second call (same incident)
    const request2 = createMockRequest({
      method: 'POST',
      body: requestBody,
      userId: 'test-user',
    });
    const response2 = await generateHandler(request2);
    expect(response2.status).toBe(200); // OK (not created)
    const body2 = await response2.json();

    expect(body2.isNew).toBe(false);
    expect(body2.outcomeRecord.id).toBe(body1.outcomeRecord.id);
  });

  test('POST /api/outcomes/generate returns 404 for non-existent incident', async () => {
    const fakeIncidentId = '00000000-0000-0000-0000-000000000000';

    const request = createMockRequest({
      method: 'POST',
      body: { incidentId: fakeIncidentId },
      userId: 'test-user',
    });

    const response = await generateHandler(request);
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toContain('not found');
  });
});

describeIfDb('Outcomes API - List Endpoint', () => {
  test('GET /api/outcomes requires authentication', async () => {
    const request = createMockRequest({
      method: 'GET',
      // No userId - should fail
    });

    const response = await listHandler(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  test('GET /api/outcomes returns outcome list', async () => {
    const request = createMockRequest({
      method: 'GET',
      userId: 'test-user',
      url: 'http://localhost:3000/api/outcomes',
    });

    const response = await listHandler(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.outcomes).toBeInstanceOf(Array);
    expect(body.count).toBeDefined();
    expect(body.hasMore).toBeDefined();
  });

  test('GET /api/outcomes supports pagination', async () => {
    const request = createMockRequest({
      method: 'GET',
      userId: 'test-user',
      url: 'http://localhost:3000/api/outcomes?limit=10&offset=0',
    });

    const response = await listHandler(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  test('GET /api/outcomes filters by incidentId', async () => {
    const testIncidentId = '00000000-0000-0000-0000-000000000001';

    const request = createMockRequest({
      method: 'GET',
      userId: 'test-user',
      url: `http://localhost:3000/api/outcomes?incidentId=${testIncidentId}`,
    });

    const response = await listHandler(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.outcomes).toBeInstanceOf(Array);
    
    // All outcomes should be for the specified incident
    body.outcomes.forEach((outcome: any) => {
      if (outcome.entity_type === 'incident') {
        expect(outcome.entity_id).toBe(testIncidentId);
      }
    });
  });
});

describeIfDb('Outcomes API - Get by ID Endpoint', () => {
  test('GET /api/outcomes/[id] requires authentication', async () => {
    const request = createMockRequest({
      method: 'GET',
      // No userId - should fail
    });

    const response = await getHandler(request, {
      params: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  test('GET /api/outcomes/[id] returns 404 for non-existent outcome', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const request = createMockRequest({
      method: 'GET',
      userId: 'test-user',
    });

    const response = await getHandler(request, { params: { id: fakeId } });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error).toContain('not found');
  });
});
