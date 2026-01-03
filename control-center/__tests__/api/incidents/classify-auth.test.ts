/**
 * API Auth Tests: Classify Incident Endpoint
 * 
 * Tests authentication and authorization for POST /api/incidents/[id]/classify
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/incidents/[id]/classify/route';

// Mock dependencies
jest.mock('../../../src/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('../../../src/lib/db/incidents', () => ({
  getIncidentDAO: jest.fn(),
}));

jest.mock('../../../src/lib/classifier', () => ({
  classifyIncident: jest.fn(),
  computeClassificationHash: jest.fn(() => 'mock-hash'),
}));

describe('POST /api/incidents/[id]/classify - Authentication', () => {
  test('returns 401 when x-afu9-sub header is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/incidents/test-id/classify', {
      method: 'POST',
      headers: {},
    });

    const params = Promise.resolve({ id: 'test-id' });

    const response = await POST(request, { params });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
    expect(data.details).toBe('User authentication required');
  });

  test('returns 401 when x-afu9-sub header is empty', async () => {
    const request = new NextRequest('http://localhost:3000/api/incidents/test-id/classify', {
      method: 'POST',
      headers: {
        'x-afu9-sub': '',
      },
    });

    const params = Promise.resolve({ id: 'test-id' });

    const response = await POST(request, { params });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  test('returns 400 when incident ID is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/incidents//classify', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'user-123',
      },
    });

    const params = Promise.resolve({ id: '' });

    const response = await POST(request, { params });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Incident ID is required');
  });
});
